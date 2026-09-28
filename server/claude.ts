import fs from 'node:fs';
import path from 'node:path';
import type { ClaudeActivity, ClaudeSession } from '../shared/types.ts';
import { CLAUDE_HOME } from './config.ts';
import { run } from './exec.ts';

/**
 * Claude Code session detection (Linux, procfs).
 *
 * Observed on this machine (Claude Code 2.1.x):
 *  - interactive sessions run as `claude [flags] [prompt]`, cwd = where the user launched them
 *  - background sessions run as `claude bg-spare ...`, managed by `claude daemon run`,
 *    each hosted by a `claude bg-pty-host ...` wrapper whose cwd is a spare dir
 *  - background sessions write ~/.claude/sessions/<pid>.json with {cwd, status: idle|busy,
 *    spare, name, procStart, ...}; procStart equals /proc/<pid>/stat field 22.
 *  - interactive sessions did not write such a file here, so their activity is "unknown".
 *
 * Liveness and cwd always come from /proc (authoritative). Session files are only used to
 * enrich a process that is verifiably the same process (pid + procStart match).
 */

export interface RawClaudeProc {
  pid: number;
  cwd: string;
  startedAt: number;
  procStart: string;
  procState: string;
  argv: string[];
  kind: ClaudeSession['kind'];
  command: string;
  sessionFile: SessionFile | null;
}

interface SessionFile {
  pid: number;
  sessionId?: string;
  cwd?: string;
  procStart?: string;
  version?: string;
  kind?: string;
  name?: string;
  status?: string;
  spare?: boolean;
  entrypoint?: string;
}

const NON_SESSION_SUBCOMMANDS = new Set([
  'daemon', 'bg-pty-host', 'attach', 'logs', 'agents', 'mcp', 'doctor', 'update', 'install',
  'config', 'stop', 'rm', 'migrate-installer', 'setup-token', 'plugin', '--version', '-v', '--help', '-h',
]);

let bootTimeSec: number | null = null;
let clkTck = 100;

export async function initProcInfo() {
  try {
    const stat = fs.readFileSync('/proc/stat', 'utf8');
    const m = stat.match(/^btime (\d+)/m);
    bootTimeSec = m ? Number(m[1]) : null;
  } catch {
    bootTimeSec = null;
  }
  const r = await run('getconf', ['CLK_TCK'], { timeoutMs: 2000 });
  if (r.ok && Number(r.stdout.trim()) > 0) clkTck = Number(r.stdout.trim());
  return bootTimeSec !== null;
}

function isClaudeExecutable(exe: string, argv: string[]): boolean {
  if (exe.includes('/claude/versions/') || path.basename(exe) === 'claude') return true;
  // npm-installed Claude Code runs under node
  if (path.basename(exe).startsWith('node') && argv.some((a) => a.includes('@anthropic-ai/claude-code'))) return true;
  return false;
}

function readSessionFile(pid: number): SessionFile | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(CLAUDE_HOME, 'sessions', `${pid}.json`), 'utf8'));
  } catch {
    return null;
  }
}

/** Command summary safe to display: executable name + flags only; positional args (prompts) omitted. */
function summarizeCommand(argv: string[]): string {
  const parts = ['claude'];
  const args = argv[0]?.includes('node') ? argv.slice(2) : argv.slice(1);
  if (args[0] === 'bg-spare') return 'claude bg-spare (daemon-managed background session)';
  for (const a of args) {
    if (a === '--') break;
    if (a.startsWith('-')) parts.push(a.split('=')[0]);
  }
  return parts.join(' ');
}

export function scanClaudeProcesses(): RawClaudeProc[] {
  let entries: string[];
  try {
    entries = fs.readdirSync('/proc');
  } catch {
    return [];
  }
  const out: RawClaudeProc[] = [];
  for (const e of entries) {
    if (!/^\d+$/.test(e)) continue;
    const pid = Number(e);
    try {
      const exe = fs.readlinkSync(`/proc/${pid}/exe`); // EACCES for other users' processes
      let argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
      // Claude rewrites its process title into one space-joined string for daemon processes.
      // (observed: argv[0] = "claude bg-pty-host", remaining args kept separate)
      if (argv[0]?.includes(' ') && !argv[0].includes('/')) argv = [...argv[0].split(' ').filter(Boolean), ...argv.slice(1)];
      if (!isClaudeExecutable(exe, argv)) continue;
      const sub = argv[0]?.includes('node') ? argv[2] : argv[1];
      if (sub && NON_SESSION_SUBCOMMANDS.has(sub)) continue;

      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const procState = rest[0];
      const procStart = rest[19];
      if (procState === 'Z') continue; // zombie: process already exited
      const cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
      const startedAt = bootTimeSec !== null ? Math.round((bootTimeSec + Number(procStart) / clkTck) * 1000) : 0;

      let sessionFile = readSessionFile(pid);
      if (sessionFile && String(sessionFile.procStart) !== procStart) sessionFile = null; // stale file, pid reused

      const hasPrintFlag = argv.includes('-p') || argv.includes('--print');
      const kind: ClaudeSession['kind'] =
        sub === 'bg-spare' || sessionFile?.kind === 'bg' ? 'background' : hasPrintFlag ? 'print' : 'interactive';

      out.push({ pid, cwd, startedAt, procStart, procState, argv, kind, command: summarizeCommand(argv), sessionFile });
    } catch {
      /* process vanished mid-scan or is not ours */
    }
  }
  return out;
}

export function classifyActivity(p: RawClaudeProc): {
  activity: ClaudeActivity;
  source: ClaudeSession['activitySource'];
  raw: string | null;
} {
  const sf = p.sessionFile;
  // A daemon spare that has not been claimed yet has no session file and sits in the daemon's
  // spare directory: it is a pre-warmed process, not a conversation.
  if (!sf && p.argv.includes('--bg-spare')) return { activity: 'standby', source: 'none', raw: null };
  if (!sf) return { activity: 'unknown', source: 'none', raw: null };
  if (sf.spare) return { activity: 'standby', source: 'session-file', raw: sf.status ?? null };
  if (sf.status === 'busy') return { activity: 'working', source: 'session-file', raw: 'busy' };
  if (sf.status === 'idle') return { activity: 'idle', source: 'session-file', raw: 'idle' };
  return { activity: 'unknown', source: 'session-file', raw: sf.status ?? null };
}

/** ~/.claude/projects/<cwd with every non-alphanumeric char replaced by '-'> */
export function encodeProjectDir(p: string) {
  return p.replace(/[^a-zA-Z0-9]/g, '-');
}

/** Newest Claude transcript mtime for a project (including worktrees under it). */
export function latestTranscriptMtime(projectPath: string, projectDirs: string[]): number | null {
  const enc = encodeProjectDir(projectPath);
  let best: number | null = null;
  for (const d of projectDirs) {
    if (d !== enc && !d.startsWith(enc + '--claude-worktrees-')) continue;
    const full = path.join(CLAUDE_HOME, 'projects', d);
    let files: string[];
    try {
      files = fs.readdirSync(full);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      try {
        const m = fs.statSync(path.join(full, f)).mtimeMs;
        if (best === null || m > best) best = m;
      } catch {
        /* ignore */
      }
    }
  }
  return best;
}

export function listTranscriptDirs(): string[] {
  try {
    return fs.readdirSync(path.join(CLAUDE_HOME, 'projects'));
  } catch {
    return [];
  }
}

export async function detectClaudeCli(): Promise<{ path: string | null; version: string | null; error: string | null }> {
  const which = await run('which', ['claude'], { timeoutMs: 3000 });
  const bin = which.ok ? which.stdout.trim() : null;
  if (!bin) return { path: null, version: null, error: 'claude CLI not found on PATH' };
  const v = await run(bin, ['--version'], { timeoutMs: 10000 });
  if (!v.ok) return { path: bin, version: null, error: `claude --version failed: ${v.error}` };
  return { path: bin, version: v.stdout.trim().split('\n')[0], error: null };
}
