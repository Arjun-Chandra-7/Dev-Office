import { create } from 'zustand';
import type { LaunchedSession, OfficeSnapshot, Project, StateMessage } from '../shared/types';

export type Filter = 'all' | 'claude' | 'working' | 'modified' | 'recent';

export const RECENT_MS = 24 * 3600_000;

/** Visual state of a desk, derived strictly from observed data. */
export type DeskStatus = 'working' | 'live' | 'standby' | 'none';

export function deskStatus(p: Project): DeskStatus {
  if (p.claude.working > 0) return 'working';
  if (p.claude.live > 0) return 'live';
  if (p.claude.standby > 0) return 'standby';
  return 'none';
}

export function gitDirtyCount(p: Project) {
  return p.repos.reduce((n, r) => n + (r.valid ? r.counts.staged + r.counts.modified + r.counts.untracked + r.counts.conflicted : 0), 0);
}

export function isRecent(p: Project, now = Date.now()) {
  const t = Math.max(p.activity.claudeTranscriptAt ?? 0, p.activity.lastCommitAt ?? 0);
  return t > 0 && now - t < RECENT_MS;
}

export function matchesFilter(p: Project, f: Filter) {
  switch (f) {
    case 'all':
      return true;
    case 'claude':
      return p.claude.live > 0;
    case 'working':
      return p.claude.working > 0;
    case 'modified':
      return gitDirtyCount(p) > 0;
    case 'recent':
      return isRecent(p);
  }
}

export type Mode = 'overview' | 'walk';
export type Quality = 'high' | 'low';

interface Persisted {
  selectedId: string | null;
  filter: Filter;
  camera: { pos: [number, number, number]; target: [number, number, number] } | null;
  viewFloor: 0 | 1;
  quality: Quality;
}

const STORAGE_KEY = 'dev-office:ui:v2';
function loadPersisted(): Persisted {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (v && typeof v === 'object')
      return {
        selectedId: v.selectedId ?? null,
        filter: v.filter ?? 'all',
        camera: v.camera ?? null,
        viewFloor: v.viewFloor === 1 ? 1 : 0,
        quality: v.quality === 'low' ? 'low' : 'high',
      };
  } catch {
    /* storage unavailable */
  }
  return { selectedId: null, filter: 'all', camera: null, viewFloor: 0, quality: 'high' };
}
export function savePersisted(patch: Partial<Persisted>) {
  try {
    const cur = loadPersisted();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...cur, ...patch }));
  } catch {
    /* ignore */
  }
}
export const initialPersisted = loadPersisted();

interface UIState {
  snapshot: OfficeSnapshot | null;
  connected: boolean;
  lastMessageAt: number;
  selectedId: string | null;
  hoveredId: string | null;
  panelOpen: boolean;
  filter: Filter;
  paletteOpen: boolean;
  promptFor: string | null;
  dockOpen: boolean;
  activeTerminal: string | null;
  /** increments to ask the camera to re-focus the selected desk */
  focusNonce: number;
  overviewNonce: number;
  toast: { text: string; kind: 'info' | 'error' } | null;
  mode: Mode;
  viewFloor: 0 | 1;
  quality: Quality;
  /** first-person: what the crosshair is on */
  hint: string | null;
  pointerLocked: boolean;

  setMode: (m: Mode) => void;
  setViewFloor: (f: 0 | 1) => void;
  setQuality: (q: Quality) => void;
  select: (id: string | null, opts?: { openPanel?: boolean }) => void;
  hover: (id: string | null) => void;
  setFilter: (f: Filter) => void;
  setPalette: (open: boolean) => void;
  openPrompt: (id: string | null) => void;
  openTerminal: (sid: string | null) => void;
  setDock: (open: boolean) => void;
  closePanel: () => void;
  overview: () => void;
  notify: (text: string, kind?: 'info' | 'error') => void;
}

export const useOffice = create<UIState>((set, get) => ({
  snapshot: null,
  connected: false,
  lastMessageAt: 0,
  selectedId: initialPersisted.selectedId,
  hoveredId: null,
  panelOpen: !!initialPersisted.selectedId,
  filter: initialPersisted.filter,
  paletteOpen: false,
  promptFor: null,
  dockOpen: false,
  activeTerminal: null,
  focusNonce: 0,
  overviewNonce: 0,
  toast: null,
  mode: 'overview',
  viewFloor: initialPersisted.viewFloor,
  quality: initialPersisted.quality,
  hint: null,
  pointerLocked: false,

  setMode: (mode) => set({ mode, hint: null, hoveredId: null }),
  setViewFloor: (viewFloor) => {
    set({ viewFloor });
    savePersisted({ viewFloor });
  },
  setQuality: (quality) => {
    set({ quality });
    savePersisted({ quality });
  },
  select: (id, opts) => {
    set((s) => ({ selectedId: id, panelOpen: id ? (opts?.openPanel ?? true) : false, focusNonce: s.focusNonce + 1 }));
    savePersisted({ selectedId: id });
  },
  hover: (id) => get().hoveredId !== id && set({ hoveredId: id }),
  setFilter: (filter) => {
    set({ filter });
    savePersisted({ filter });
  },
  setPalette: (paletteOpen) => set({ paletteOpen }),
  openPrompt: (promptFor) => set({ promptFor }),
  openTerminal: (sid) => set({ activeTerminal: sid, dockOpen: !!sid || get().dockOpen }),
  setDock: (dockOpen) => set({ dockOpen }),
  closePanel: () => set({ panelOpen: false }),
  overview: () => {
    set((s) => ({ selectedId: null, panelOpen: false, overviewNonce: s.overviewNonce + 1 }));
    savePersisted({ selectedId: null });
  },
  notify: (text, kind = 'info') => {
    set({ toast: { text, kind } });
    setTimeout(() => get().toast?.text === text && set({ toast: null }), 4500);
  },
}));

export function useProject(id: string | null) {
  return useOffice((s) => (id ? s.snapshot?.projects.find((p) => p.id === id) ?? null : null));
}

export function launchedFor(snapshot: OfficeSnapshot | null, projectId: string): LaunchedSession[] {
  return snapshot?.launched.filter((l) => l.projectId === projectId) ?? [];
}

// ---- live state connection -----------------------------------------------------------------

let retry = 0;
export function connectState() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws/state`);
  ws.onopen = () => {
    retry = 0;
    useOffice.setState({ connected: true });
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data) as StateMessage;
    if (msg.type !== 'snapshot') return;
    const s = useOffice.getState();
    // Structural sharing: keep the previous object for unchanged projects so memoised desks
    // skip re-rendering when some other project changed.
    const prev = new Map((s.snapshot?.projects ?? []).map((p) => [p.id, p]));
    msg.data.projects = msg.data.projects.map((p) => {
      const old = prev.get(p.id);
      return old && JSON.stringify(old) === JSON.stringify(p) ? old : p;
    });
    const patch: Partial<UIState> = { snapshot: msg.data, lastMessageAt: Date.now() };
    // A selected project that disappeared from disk: drop the selection gracefully.
    if (s.selectedId && !msg.data.projects.some((p) => p.id === s.selectedId)) {
      patch.selectedId = null;
      patch.panelOpen = false;
      if (s.snapshot) s.notify(`Project "${s.selectedId}" is no longer in ${msg.data.system.root}`, 'info');
    }
    if (s.promptFor && !msg.data.projects.some((p) => p.id === s.promptFor)) patch.promptFor = null;
    useOffice.setState(patch);
  };
  ws.onclose = () => {
    useOffice.setState({ connected: false });
    setTimeout(connectState, Math.min(8000, 500 * 2 ** retry++));
  };
}

// ---- API -----------------------------------------------------------------------------------

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

export const Api = {
  launch: (projectId: string, prompt: string, cols?: number, rows?: number) =>
    api<LaunchedSession>(`/api/projects/${encodeURIComponent(projectId)}/claude`, {
      method: 'POST',
      body: JSON.stringify({ prompt, cols, rows }),
    }),
  stop: (sid: string) => api<{ ok: boolean }>(`/api/sessions/${sid}/stop`, { method: 'POST', body: '{}' }),
  dismiss: (sid: string) => api<{ ok: boolean }>(`/api/sessions/${sid}`, { method: 'DELETE' }),
  refresh: () => api<{ ok: boolean }>('/api/refresh', { method: 'POST', body: '{}' }),
};

// ---- formatting ----------------------------------------------------------------------------

export function ago(t: number | null | undefined, now = Date.now()) {
  if (!t) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d}d ago`;
  return `${Math.round(d / 30)}mo ago`;
}

export function duration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(ss).padStart(2, '0')}s`;
}

export function tildify(p: string) {
  return p.replace(/^\/home\/[^/]+/, '~');
}
