import crypto from 'node:crypto';
import * as pty from 'node-pty';
import type { WebSocket } from 'ws';
import type { LaunchedSession, PtyServerMessage } from '../shared/types.ts';
import { LIMITS } from './config.ts';

// Opt-in only: logs raw keystrokes, so never enabled by default.
const DEBUG_INPUT = process.env.DEV_OFFICE_DEBUG_INPUT === '1';

interface Entry {
  info: LaunchedSession;
  proc: pty.IPty | null;
  chunks: string[];
  bytes: number;
  clients: Set<WebSocket>;
  killTimer: NodeJS.Timeout | null;
}

/**
 * Environment for launched Claude sessions. When the office server itself is started from
 * inside a Claude Code session, session-scoped variables leak into our env; passing them on
 * would make the new process believe it is a child of that session.
 */
function launchEnv(): Record<string, string> {
  const drop =
    /^(CLAUDECODE|CLAUDE_PID|CLAUDE_JOB_DIR|CLAUDE_EFFORT|CLAUDE_CODE_(CHILD_SESSION|SESSION_ID|SESSION_ATTENDED|AGENT|ENTRYPOINT|EXECPATH|MESSAGING_.*|BRIDGE_.*))$/;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !drop.test(k)) env[k] = v;
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  return env;
}

export class PtyManager {
  private sessions = new Map<string, Entry>();

  constructor(
    private claudeBin: () => string | null,
    private onChange: () => void,
  ) {
    setInterval(() => this.prune(), 60_000).unref();
  }

  list(): LaunchedSession[] {
    return [...this.sessions.values()].map((e) => ({ ...e.info, clients: e.clients.size }));
  }

  get(id: string) {
    return this.sessions.get(id);
  }

  /** pid → office session id, for correlating /proc scan results. */
  pidMap(): Map<number, { id: string; lastOutputAt: number | null }> {
    const m = new Map<number, { id: string; lastOutputAt: number | null }>();
    for (const e of this.sessions.values())
      if (e.info.state === 'running' && e.info.pid) m.set(e.info.pid, { id: e.info.id, lastOutputAt: e.info.lastOutputAt });
    return m;
  }

  /**
   * Start Claude Code in `cwd` (already validated to be a known project directory).
   * argv is fixed server-side: [claude, --, prompt]. No shell is involved, and `--` ends option
   * parsing so prompt text can never be interpreted as a CLI flag.
   */
  launch(projectId: string, projectName: string, cwd: string, prompt: string, cols = 120, rows = 34): LaunchedSession {
    const running = [...this.sessions.values()].filter((e) => e.info.state === 'running').length;
    if (running >= LIMITS.maxRunningPtys) throw new Error(`Too many running sessions (${running}). Stop one first.`);
    const bin = this.claudeBin();
    if (!bin) throw new Error('Claude Code CLI not found on PATH');

    const id = crypto.randomBytes(6).toString('hex');
    const info: LaunchedSession = {
      id,
      projectId,
      projectName,
      pid: null,
      state: 'running',
      startedAt: Date.now(),
      endedAt: null,
      exitCode: null,
      signal: null,
      error: null,
      lastOutputAt: null,
      promptPreview: prompt.length > 140 ? prompt.slice(0, 137) + '…' : prompt,
      clients: 0,
    };
    const entry: Entry = { info, proc: null, chunks: [], bytes: 0, clients: new Set(), killTimer: null };
    this.sessions.set(id, entry);

    const args = prompt.trim() ? ['--', prompt] : [];
    try {
      const proc = pty.spawn(bin, args, {
        name: 'xterm-256color',
        cols: clamp(cols, 20, 400),
        rows: clamp(rows, 5, 200),
        cwd,
        env: launchEnv(),
      });
      entry.proc = proc;
      info.pid = proc.pid;
      proc.onData((d) => this.onData(entry, d));
      proc.onExit(({ exitCode, signal }) => {
        if (entry.killTimer) clearTimeout(entry.killTimer);
        info.state = 'exited';
        info.endedAt = Date.now();
        info.exitCode = exitCode;
        info.signal = signal ?? null;
        entry.proc = null;
        this.onData(entry, `\r\n\x1b[2m[dev-office] process exited (code ${exitCode}${signal ? `, signal ${signal}` : ''})\x1b[0m\r\n`);
        this.broadcastStatus(entry);
        this.onChange();
      });
    } catch (e) {
      info.state = 'failed';
      info.endedAt = Date.now();
      info.error = `Could not create terminal: ${(e as Error).message}`;
    }
    this.onChange();
    return { ...info };
  }

  private onData(entry: Entry, data: string) {
    entry.info.lastOutputAt = Date.now();
    entry.chunks.push(data);
    entry.bytes += data.length;
    while (entry.bytes > LIMITS.ptyBufferBytes && entry.chunks.length > 1) entry.bytes -= entry.chunks.shift()!.length;
    const msg = JSON.stringify({ type: 'output', data } satisfies PtyServerMessage);
    for (const ws of entry.clients) if (ws.readyState === 1) ws.send(msg);
  }

  private broadcastStatus(entry: Entry) {
    const msg = JSON.stringify({ type: 'status', session: { ...entry.info, clients: entry.clients.size } } satisfies PtyServerMessage);
    for (const ws of entry.clients) if (ws.readyState === 1) ws.send(msg);
  }

  attach(id: string, ws: WebSocket) {
    const entry = this.sessions.get(id);
    if (!entry) {
      ws.send(JSON.stringify({ type: 'error', message: 'Unknown session' } satisfies PtyServerMessage));
      ws.close(4404, 'unknown session');
      return;
    }
    entry.clients.add(ws);
    // Replay scrollback so reconnecting clients see the full terminal state.
    ws.send(JSON.stringify({ type: 'replay', data: entry.chunks.join('') } satisfies PtyServerMessage));
    this.broadcastStatus(entry);

    ws.on('message', (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!entry.proc) return;
      if (msg?.type === 'input' && typeof msg.data === 'string' && msg.data.length < 64 * 1024) {
        if (DEBUG_INPUT) console.log(`[pty ${id}] input ${JSON.stringify(msg.data)}`);
        entry.proc.write(msg.data);
      }
      else if (msg?.type === 'resize' && Number.isFinite(msg.cols) && Number.isFinite(msg.rows))
        entry.proc.resize(clamp(msg.cols, 20, 400), clamp(msg.rows, 5, 200));
    });
    // Browser disconnects do NOT kill the session: Claude keeps working and the user can reconnect.
    ws.on('close', () => {
      entry.clients.delete(ws);
      this.onChange();
    });
    this.onChange();
  }

  stop(id: string): boolean {
    const entry = this.sessions.get(id);
    if (!entry?.proc) return false;
    const proc = entry.proc;
    try {
      proc.kill('SIGTERM');
    } catch {
      /* already gone */
    }
    // Escalate if Claude does not exit promptly.
    entry.killTimer = setTimeout(() => {
      try {
        if (entry.proc) process.kill(proc.pid, 'SIGKILL');
      } catch {
        /* gone */
      }
    }, 4000);
    return true;
  }

  dismiss(id: string): boolean {
    const entry = this.sessions.get(id);
    if (!entry || entry.info.state === 'running') return false;
    for (const ws of entry.clients) ws.close(4410, 'dismissed');
    this.sessions.delete(id);
    this.onChange();
    return true;
  }

  private prune() {
    const now = Date.now();
    let changed = false;
    for (const [id, e] of this.sessions)
      if (e.info.state !== 'running' && e.info.endedAt && now - e.info.endedAt > LIMITS.exitedSessionRetentionMs && !e.clients.size) {
        this.sessions.delete(id);
        changed = true;
      }
    if (changed) this.onChange();
  }

  /** Called on server shutdown: never leave orphaned Claude processes behind. */
  killAll() {
    for (const e of this.sessions.values()) {
      if (!e.proc) continue;
      try {
        e.proc.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
  }

  killAllHard() {
    for (const e of this.sessions.values()) {
      if (!e.proc) continue;
      try {
        process.kill(e.proc.pid, 'SIGKILL');
      } catch {
        /* ignore */
      }
    }
  }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}
