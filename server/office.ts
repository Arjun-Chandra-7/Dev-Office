import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { AboutInfo, AgentActivity, PortfolioProject, PortfolioSnapshot, ProjectStatus, PublicAgent } from '../shared/types.ts';
import { classifyActivity, initProcInfo, scanClaudeProcesses, type RawClaudeProc } from './claude.ts';
import { CONTENT_FILE, DATA_DIR, DEV_ROOT, IGNORED_TOP_LEVEL, INTERVALS } from './config.ts';

// ---- curated content -------------------------------------------------------------------------

interface ContentProject {
  title?: string;
  summary?: string;
  github?: string[];
  link?: string | null;
  aliases?: string[];
}
interface Content {
  about?: AboutInfo;
  merge?: Record<string, string[]>;
  projects?: Record<string, ContentProject>;
}

const lower = (s: string) => s.toLowerCase();

export function loadContent(file = CONTENT_FILE): Content {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Content;
  } catch (e) {
    console.warn('[office] content file unreadable:', (e as Error).message);
    return {};
  }
}

/** alias folder (lowercase) → target folder (lowercase) */
export function mergeMap(content: Content) {
  const m = new Map<string, string>();
  for (const [target, aliases] of Object.entries(content.merge ?? {})) for (const a of aliases) m.set(lower(a), lower(target));
  return m;
}

export function contentFor(content: Content, folder: string): ContentProject | null {
  const f = lower(folder);
  for (const [key, c] of Object.entries(content.projects ?? {})) {
    if (lower(key) === f || c.aliases?.some((a) => lower(a) === f)) return c;
  }
  return null;
}

// ---- status ----------------------------------------------------------------------------------

export function statusOf(procs: RawClaudeProc[]): { status: ProjectStatus; agents: PublicAgent[] } {
  const agents: PublicAgent[] = [];
  for (const p of procs) {
    const { activity } = classifyActivity(p);
    if (activity === 'standby') continue; // daemon pre-warm, not a session
    const a: AgentActivity = activity === 'working' ? 'working' : 'idle';
    const id = crypto.createHash('sha1').update(`${p.pid}:${p.procStart}`).digest('hex').slice(0, 12);
    agents.push({ id, activity: a });
  }
  const status: ProjectStatus = agents.some((a) => a.activity === 'working') ? 'working' : agents.length ? 'online' : 'offline';
  return { status, agents };
}

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

function safeRealpath(p: string) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

const LAYOUT_FILE = path.join(DATA_DIR, 'layout.json');

// ---- engine ----------------------------------------------------------------------------------

interface Folder {
  name: string;
  path: string;
}

export class Office extends EventEmitter {
  private content: Content = {};
  private folders = new Map<string, Folder>(); // key: folder name
  private slots: Record<string, number> = {};
  private procs: RawClaudeProc[] = [];
  private procfs = false;
  private lastHash = '';
  private snapshot: PortfolioSnapshot | null = null;
  private timers: NodeJS.Timeout[] = [];
  private watchers: fs.FSWatcher[] = [];
  private rescanTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    try {
      this.slots = JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf8')).slots ?? {};
    } catch {
      this.slots = {};
    }
  }

  async start() {
    this.procfs = await initProcInfo();
    this.content = loadContent();
    this.rescan();
    this.scan();
    this.watch(DEV_ROOT, () => this.rescan());
    this.watch(path.dirname(CONTENT_FILE), () => {
      this.content = loadContent();
      this.rescan();
    });
    this.timers.push(
      setInterval(() => this.scan(), INTERVALS.claudeScanMs),
      setInterval(() => this.rescan(), INTERVALS.rootRescanMs),
    );
    this.emitIfChanged();
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    for (const w of this.watchers) w.close();
  }

  private watch(dir: string, fn: () => void) {
    try {
      const w = fs.watch(dir, () => {
        if (this.rescanTimer) clearTimeout(this.rescanTimer);
        this.rescanTimer = setTimeout(fn, 250);
      });
      w.on('error', () => w.close());
      this.watchers.push(w);
    } catch {
      /* periodic rescan covers it */
    }
  }

  private scan() {
    this.procs = this.procfs ? scanClaudeProcesses() : [];
    this.emitIfChanged();
  }

  /** Immediate children of DEV_ROOT (hidden/ignored excluded). Merged aliases stay listed so their sessions count. */
  rescan() {
    let ents: fs.Dirent[] = [];
    try {
      ents = fs.readdirSync(DEV_ROOT, { withFileTypes: true });
    } catch {
      ents = [];
    }
    const seen = new Set<string>();
    for (const e of ents) {
      if (e.name.startsWith('.') || IGNORED_TOP_LEVEL.has(e.name)) continue;
      const full = path.join(DEV_ROOT, e.name);
      let isDir = e.isDirectory();
      if (e.isSymbolicLink()) {
        try {
          isDir = fs.statSync(full).isDirectory();
        } catch {
          isDir = false;
        }
      }
      if (!isDir) continue;
      seen.add(e.name);
      if (!this.folders.has(e.name)) this.folders.set(e.name, { name: e.name, path: safeRealpath(full) });
    }
    for (const n of [...this.folders.keys()]) if (!seen.has(n)) this.folders.delete(n);
    this.assignSlots();
    this.emitIfChanged();
  }

  private visibleNames() {
    const merged = mergeMap(this.content);
    return [...this.folders.keys()].filter((n) => !merged.has(lower(n))).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  /** Stable slots: a project keeps its position until it disappears. */
  private assignSlots() {
    const names = this.visibleNames();
    let dirty = false;
    for (const n of Object.keys(this.slots))
      if (!names.includes(n)) {
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

  build(): PortfolioSnapshot {
    const merged = mergeMap(this.content);
    const names = this.visibleNames();
    const ids = new Map<string, number>();
    const projects: PortfolioProject[] = names.map((name) => {
      const own = this.folders.get(name)!;
      // the project's own folder plus every folder merged into it
      const dirs = [own.path, ...[...this.folders.values()].filter((f) => merged.get(lower(f.name)) === lower(name)).map((f) => f.path)];
      const procs = this.procs.filter((p) => dirs.some((d) => p.cwd === d || p.cwd.startsWith(d + path.sep)));
      const { status, agents } = statusOf(procs);
      const c = contentFor(this.content, name);
      const base = slugify(name);
      const n = (ids.get(base) ?? 0) + 1;
      ids.set(base, n);
      return {
        id: n > 1 ? `${base}-${n}` : base,
        name,
        title: c?.title ?? name,
        status,
        slot: this.slots[name] ?? 0,
        agents,
        summary: c?.summary ?? null,
        github: c?.github ?? [],
        link: c?.link ?? null,
      };
    });
    projects.sort((a, b) => a.slot - b.slot);
    return { generatedAt: Date.now(), statusAvailable: this.procfs, about: this.content.about ?? null, projects };
  }

  current() {
    return this.snapshot ?? this.build();
  }

  private emitIfChanged() {
    const snap = this.build();
    const { generatedAt: _g, ...rest } = snap;
    const hash = crypto.createHash('sha1').update(JSON.stringify(rest)).digest('hex');
    this.snapshot = snap;
    if (hash === this.lastHash) return;
    this.lastHash = hash;
    this.emit('snapshot', snap);
  }
}
