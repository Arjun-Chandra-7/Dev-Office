import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  ClaudeSession,
  GithubResult,
  OfficeSnapshot,
  Project,
  ProjectDescription,
  RepoInfo,
  SystemInfo,
} from '../shared/types.ts';
import {
  classifyActivity,
  detectClaudeCli,
  initProcInfo,
  latestTranscriptMtime,
  listTranscriptDirs,
  scanClaudeProcesses,
  type RawClaudeProc,
} from './claude.ts';
import { DATA_DIR, DEV_ROOT, HEAVY_DIRS, IGNORED_TOP_LEVEL, INTERVALS } from './config.ts';
import { mapLimit } from './exec.ts';
import { gitVersion, inspectRepo } from './git.ts';
import { GithubClient, readmeDescription } from './github.ts';
import { PtyManager } from './pty.ts';

interface ProjectEntry {
  id: string;
  name: string;
  path: string;
  kind: Project['kind'];
  repoPaths: string[]; // relative paths of repos ('' = root)
  repos: RepoInfo[];
  readme: { text: string; file: string } | null;
  dirMtime: number | null;
  transcriptAt: number | null;
  gitWatchers: fs.FSWatcher[];
}

const LAYOUT_FILE = path.join(DATA_DIR, 'layout.json');
const STREAMING_WINDOW_MS = 4000;

export function slugify(name: string) {
  const s = name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s || 'project';
}

function hasGitMarker(dir: string) {
  try {
    const st = fs.statSync(path.join(dir, '.git'));
    return st.isDirectory() || st.isFile(); // .git file = worktree / submodule
  } catch {
    return false;
  }
}

/** Find nested repos up to two levels deep in a project that is not itself a repo. */
function findNestedRepos(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (!e.isDirectory() || e.name.startsWith('.') || HEAVY_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (hasGitMarker(full)) found.push(path.relative(root, full));
      else if (depth < 2) walk(full, depth + 1);
    }
  };
  walk(root, 1);
  return found.sort((a, b) => a.localeCompare(b));
}

function safeRealpath(p: string) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

function shallowMtime(dir: string): number | null {
  let best: number | null = null;
  let ents: fs.Dirent[];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of ents) {
    if (HEAVY_DIRS.has(e.name)) continue;
    try {
      const m = fs.lstatSync(path.join(dir, e.name)).mtimeMs;
      if (best === null || m > best) best = m;
    } catch {
      /* ignore */
    }
  }
  return best;
}

export class Office extends EventEmitter {
  private projects = new Map<string, ProjectEntry>(); // key: directory name
  private slots: Record<string, number> = {};
  private claudeProcs: RawClaudeProc[] = [];
  private rootWatcher: fs.FSWatcher | null = null;
  private rescanTimer: NodeJS.Timeout | null = null;
  private emitTimer: NodeJS.Timeout | null = null;
  private lastHash = '';
  private snapshot: OfficeSnapshot | null = null;
  private timers: NodeJS.Timeout[] = [];
  private gitQueue = new Set<string>();
  private gitRunning = false;

  readonly github: GithubClient;
  readonly ptys: PtyManager;
  system: SystemInfo = {
    root: DEV_ROOT,
    rootExists: false,
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    node: process.version,
    claude: { available: false, path: null, version: null, error: 'not checked yet' },
    git: { available: false, version: null },
    gh: { available: false, authenticated: false, account: null },
    procfs: false,
    startedAt: Date.now(),
  };

  constructor() {
    super();
    this.github = new GithubClient(() => this.scheduleEmit());
    this.ptys = new PtyManager(() => this.system.claude.path, () => {
      this.scanClaude();
      this.scheduleEmit();
    });
    try {
      this.slots = JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf8')).slots ?? {};
    } catch {
      this.slots = {};
    }
  }

  async start() {
    const [procfs, gv, cli] = await Promise.all([initProcInfo(), gitVersion(), detectClaudeCli(), this.github.detect()]);
    this.system.procfs = procfs;
    this.system.git = { available: !!gv, version: gv };
    this.system.claude = { available: !!cli.version, ...cli };
    this.system.gh = {
      available: this.github.ghAvailable,
      authenticated: this.github.ghAuthenticated,
      account: this.github.ghAccount,
    };

    this.rescanRoot();
    this.scanClaude();
    await this.refreshAllGit();
    this.refreshActivity();
    this.watchRoot();

    this.timers.push(
      setInterval(() => {
        this.scanClaude();
        this.scheduleEmit();
      }, INTERVALS.claudeScanMs),
      setInterval(() => this.rescanRoot(), INTERVALS.rootRescanMs),
      setInterval(() => this.refreshAllGit(), INTERVALS.gitRefreshMs),
      setInterval(() => {
        this.refreshActivity();
        this.scheduleEmit();
      }, INTERVALS.activityRefreshMs),
    );
    this.emitNow();
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.rootWatcher?.close();
    for (const p of this.projects.values()) for (const w of p.gitWatchers) w.close();
  }

  // ---------- discovery ----------

  private watchRoot() {
    try {
      this.rootWatcher = fs.watch(DEV_ROOT, { persistent: true }, () => {
        if (this.rescanTimer) clearTimeout(this.rescanTimer);
        this.rescanTimer = setTimeout(() => this.rescanRoot(), 250);
      });
      this.rootWatcher.on('error', () => {
        this.rootWatcher = null; // root deleted/renamed: periodic rescan takes over
        setTimeout(() => this.watchRoot(), 5000);
      });
    } catch {
      setTimeout(() => this.watchRoot(), 5000);
    }
  }

  /** Re-read the immediate children of DEV_ROOT. Cheap: one readdir + a few stats. */
  rescanRoot() {
    let ents: fs.Dirent[] = [];
    try {
      ents = fs.readdirSync(DEV_ROOT, { withFileTypes: true });
      this.system.rootExists = true;
    } catch {
      this.system.rootExists = false;
    }
    let realRoot = DEV_ROOT;
    try {
      realRoot = fs.realpathSync(DEV_ROOT);
    } catch {
      /* root missing */
    }

    const seen = new Set<string>();
    for (const e of ents) {
      if (e.name.startsWith('.') || IGNORED_TOP_LEVEL.has(e.name)) continue;
      const full = path.join(DEV_ROOT, e.name);
      let isDir = e.isDirectory();
      if (e.isSymbolicLink()) {
        // Allow symlinked projects only if they resolve inside the root.
        try {
          const real = fs.realpathSync(full);
          isDir = fs.statSync(real).isDirectory() && real.startsWith(realRoot + path.sep);
        } catch {
          isDir = false;
        }
      }
      if (!isDir) continue;
      seen.add(e.name);
      const existing = this.projects.get(e.name);
      const rootRepo = hasGitMarker(full);
      const repoPaths = rootRepo ? [''] : findNestedRepos(full);
      const kind: Project['kind'] = rootRepo ? 'git' : repoPaths.length ? 'nested-git' : 'plain';
      if (existing) {
        const changed = existing.kind !== kind || existing.repoPaths.join('|') !== repoPaths.join('|');
        existing.kind = kind;
        existing.readme = readmeDescription(full);
        if (changed) {
          existing.repoPaths = repoPaths;
          existing.repos = existing.repos.filter((r) => repoPaths.includes(r.relPath));
          this.watchGit(existing);
          this.queueGit(e.name);
        }
        continue;
      }
      const entry: ProjectEntry = {
        id: '',
        name: e.name,
        path: safeRealpath(full),
        kind,
        repoPaths,
        repos: [],
        readme: readmeDescription(full),
        dirMtime: shallowMtime(full),
        transcriptAt: null,
        gitWatchers: [],
      };
      this.projects.set(e.name, entry);
      this.watchGit(entry);
      this.queueGit(e.name);
    }

    for (const [name, p] of this.projects)
      if (!seen.has(name)) {
        for (const w of p.gitWatchers) w.close();
        this.projects.delete(name);
      }

    this.assignIdsAndSlots();
    this.scheduleEmit();
  }

  /** Stable ids (slugs) and stable desk slots: a project keeps its desk until it is removed. */
  private assignIdsAndSlots() {
    const names = [...this.projects.keys()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const used = new Map<string, number>();
    for (const n of names) {
      const base = slugify(n);
      const count = used.get(base) ?? 0;
      used.set(base, count + 1);
      this.projects.get(n)!.id = count ? `${base}-${count + 1}` : base;
    }
    let dirty = false;
    for (const n of Object.keys(this.slots))
      if (!this.projects.has(n)) {
        delete this.slots[n];
        dirty = true;
      }
    const taken = new Set(Object.values(this.slots));
    let next = 0;
    for (const n of names) {
      if (this.slots[n] !== undefined) continue;
      while (taken.has(next)) next++;
      this.slots[n] = next;
      taken.add(next);
      dirty = true;
    }
    if (dirty) {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(LAYOUT_FILE, JSON.stringify({ slots: this.slots }, null, 1));
      } catch {
        /* best effort */
      }
    }
  }

  findById(id: string): ProjectEntry | undefined {
    for (const p of this.projects.values()) if (p.id === id) return p;
    return undefined;
  }

  /**
   * Resolve a project id to a directory that is guaranteed to be an existing direct child of
   * DEV_ROOT. This is the only way browser input can reach the filesystem.
   */
  resolveProjectDir(id: string): ProjectEntry | null {
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,120}$/.test(id)) return null;
    const p = this.findById(id);
    if (!p) return null;
    const resolved = path.resolve(DEV_ROOT, p.name);
    if (path.dirname(resolved) !== path.resolve(DEV_ROOT)) return null;
    try {
      const real = fs.realpathSync(resolved);
      const realRoot = fs.realpathSync(DEV_ROOT);
      if (!(real === path.join(realRoot, p.name) || real.startsWith(realRoot + path.sep))) return null;
      if (!fs.statSync(real).isDirectory()) return null;
      return { ...p, path: real };
    } catch {
      return null;
    }
  }

  // ---------- git ----------

  /** Watch .git metadata so commits/checkouts/stages show up without waiting for the poll. */
  private watchGit(p: ProjectEntry) {
    for (const w of p.gitWatchers) w.close();
    p.gitWatchers = [];
    for (const rel of p.repoPaths) {
      const gitDir = path.join(p.path, rel, '.git');
      try {
        if (!fs.statSync(gitDir).isDirectory()) continue;
        const w = fs.watch(gitDir, (_ev, file) => {
          if (file && /^(index|HEAD|ORIG_HEAD|FETCH_HEAD|packed-refs)$/.test(String(file))) this.queueGit(p.name);
        });
        w.on('error', () => w.close());
        p.gitWatchers.push(w);
      } catch {
        /* not a dir / gone */
      }
    }
  }

  private queueGit(name: string) {
    this.gitQueue.add(name);
    if (!this.gitRunning) setTimeout(() => this.drainGit(), 150);
  }

  private async drainGit() {
    if (this.gitRunning) return;
    this.gitRunning = true;
    try {
      while (this.gitQueue.size) {
        const names = [...this.gitQueue];
        this.gitQueue.clear();
        await mapLimit(names, 4, (n) => this.refreshGit(n));
        this.scheduleEmit();
      }
    } finally {
      this.gitRunning = false;
    }
  }

  private async refreshGit(name: string) {
    const p = this.projects.get(name);
    if (!p) return;
    const repos = await Promise.all(p.repoPaths.map((rel) => inspectRepo(path.join(p.path, rel), rel)));
    if (this.projects.get(name) === p) p.repos = repos;
  }

  async refreshAllGit() {
    for (const n of this.projects.keys()) this.gitQueue.add(n);
    await this.drainGit();
  }

  private refreshActivity() {
    const dirs = listTranscriptDirs();
    for (const p of this.projects.values()) {
      p.dirMtime = shallowMtime(p.path);
      p.transcriptAt = latestTranscriptMtime(p.path, dirs);
    }
  }

  // ---------- claude ----------

  private scanClaude() {
    this.claudeProcs = this.system.procfs ? scanClaudeProcesses() : [];
  }

  private sessionsFor(p: ProjectEntry, launchedPids: ReturnType<PtyManager['pidMap']>): ClaudeSession[] {
    const out: ClaudeSession[] = [];
    for (const c of this.claudeProcs) {
      if (c.cwd !== p.path && !c.cwd.startsWith(p.path + path.sep)) continue;
      let { activity, source, raw } = classifyActivity(c);
      const launched = launchedPids.get(c.pid);
      if (launched && activity === 'unknown' && launched.lastOutputAt && Date.now() - launched.lastOutputAt < STREAMING_WINDOW_MS) {
        activity = 'streaming';
        source = 'pty-output';
      }
      out.push({
        id: `proc:${c.pid}`,
        pid: c.pid,
        projectId: p.id,
        cwd: c.cwd,
        relCwd: path.relative(p.path, c.cwd),
        startedAt: c.startedAt,
        procState: c.procState,
        kind: c.kind,
        activity,
        activitySource: source,
        rawStatus: raw,
        name: c.sessionFile?.name && c.sessionFile.name !== c.sessionFile.sessionId?.slice(0, 8) ? c.sessionFile.name : null,
        version: c.sessionFile?.version ?? null,
        sessionId: c.sessionFile?.sessionId ?? null,
        command: c.command,
        launchedBy: launched?.id ?? null,
      });
    }
    return out.sort((a, b) => a.startedAt - b.startedAt);
  }

  // ---------- snapshot ----------

  private describe(p: ProjectEntry, gh: Record<string, GithubResult>): ProjectDescription {
    const rootRepo = p.repos.find((r) => r.relPath === '');
    if (rootRepo?.github) {
      const g = gh[`${rootRepo.github.owner}/${rootRepo.github.repo}`];
      if (g?.status === 'ok' && g.data.description) return { text: g.data.description, source: 'github', from: g.data.fullName };
    }
    if (p.readme) return { text: p.readme.text, source: 'readme', from: p.readme.file };
    for (const r of p.repos) {
      if (!r.github || r.relPath === '') continue;
      const g = gh[`${r.github.owner}/${r.github.repo}`];
      if (g?.status === 'ok' && g.data.description)
        return { text: g.data.description, source: 'github-subrepo', from: `${g.data.fullName} (${r.relPath}/)` };
    }
    return { text: null, source: 'none', from: null };
  }

  build(): OfficeSnapshot {
    const launchedPids = this.ptys.pidMap();
    const assigned = new Set<number>();
    const projects: Project[] = [];
    for (const p of this.projects.values()) {
      const gh: Record<string, GithubResult> = {};
      for (const r of p.repos) if (r.github) gh[`${r.github.owner}/${r.github.repo}`] = this.github.get(r.github);
      const sessions = this.sessionsFor(p, launchedPids);
      for (const s of sessions) assigned.add(s.pid);
      const lastCommitAt = p.repos.reduce<number | null>((m, r) => (r.lastCommit && (!m || r.lastCommit.at > m) ? r.lastCommit.at : m), null);
      projects.push({
        id: p.id,
        name: p.name,
        path: p.path,
        kind: p.kind,
        repos: p.repos,
        github: gh,
        description: this.describe(p, gh),
        activity: { dirMtime: p.dirMtime, lastCommitAt, claudeTranscriptAt: p.transcriptAt },
        claude: {
          sessions,
          live: sessions.filter((s) => s.activity !== 'standby').length,
          working: sessions.filter((s) => s.activity === 'working' || s.activity === 'streaming').length,
          standby: sessions.filter((s) => s.activity === 'standby').length,
        },
        slot: this.slots[p.name] ?? 0,
      });
    }
    projects.sort((a, b) => a.slot - b.slot);
    return {
      generatedAt: Date.now(),
      system: this.system,
      projects,
      launched: this.ptys.list(),
      unassignedClaude: this.claudeProcs.filter((c) => !assigned.has(c.pid) && classifyActivity(c).activity !== 'standby').length,
    };
  }

  current(): OfficeSnapshot {
    return this.snapshot ?? this.build();
  }

  private scheduleEmit() {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emitNow();
    }, 120);
  }

  /** Broadcast only when something observable actually changed. */
  private emitNow() {
    const snap = this.build();
    const { generatedAt: _g, ...rest } = snap;
    const hash = crypto.createHash('sha1').update(JSON.stringify(rest)).digest('hex');
    this.snapshot = snap;
    if (hash === this.lastHash) return;
    this.lastHash = hash;
    this.emit('snapshot', snap);
  }

  forceRefresh() {
    this.rescanRoot();
    this.refreshActivity();
    for (const p of this.projects.values()) for (const r of p.repos) if (r.github) this.github.refresh(r.github);
    return this.refreshAllGit();
  }
}
