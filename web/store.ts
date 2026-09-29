import { create } from 'zustand';
import type { PortfolioProject, PortfolioSnapshot, ProjectStatus, StateMessage } from '../shared/types';

export type Filter = 'all' | 'online' | 'working';

/** Visual state of an office (CSS classes / screen colours). */
export type DeskStatus = 'working' | 'live' | 'none';

export function deskStatus(p: PortfolioProject): DeskStatus {
  return p.status === 'working' ? 'working' : p.status === 'online' ? 'live' : 'none';
}

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  working: 'Working in background',
  online: 'Session online',
  offline: 'Session offline',
};

export function matchesFilter(p: PortfolioProject, f: Filter) {
  if (f === 'online') return p.status !== 'offline';
  if (f === 'working') return p.status === 'working';
  return true;
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

const STORAGE_KEY = 'dev-office:ui:v3';
function loadPersisted(): Persisted {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (v && typeof v === 'object')
      return {
        selectedId: v.selectedId ?? null,
        filter: ['all', 'online', 'working'].includes(v.filter) ? v.filter : 'all',
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadPersisted(), ...patch }));
  } catch {
    /* ignore */
  }
}
export const initialPersisted = loadPersisted();

interface UIState {
  snapshot: PortfolioSnapshot | null;
  connected: boolean;
  selectedId: string | null;
  hoveredId: string | null;
  panelOpen: boolean;
  filter: Filter;
  paletteOpen: boolean;
  /** the About Me card — shown on arrival */
  aboutOpen: boolean;
  focusNonce: number;
  overviewNonce: number;
  toast: string | null;
  mode: Mode;
  viewFloor: 0 | 1;
  quality: Quality;
  /** first-person: what the crosshair is on */
  hint: string | null;
  pointerLocked: boolean;
  /** kit assets loaded */
  ready: boolean;

  setMode: (m: Mode) => void;
  setViewFloor: (f: 0 | 1) => void;
  setQuality: (q: Quality) => void;
  select: (id: string | null, opts?: { openPanel?: boolean }) => void;
  hover: (id: string | null) => void;
  setFilter: (f: Filter) => void;
  setPalette: (open: boolean) => void;
  setAbout: (open: boolean) => void;
  closePanel: () => void;
  overview: () => void;
  notify: (text: string) => void;
}

export const useOffice = create<UIState>((set, get) => ({
  snapshot: null,
  connected: false,
  selectedId: null,
  hoveredId: null,
  panelOpen: false,
  filter: initialPersisted.filter,
  paletteOpen: false,
  aboutOpen: true,
  focusNonce: 0,
  overviewNonce: 0,
  toast: null,
  mode: 'overview',
  viewFloor: initialPersisted.viewFloor,
  quality: initialPersisted.quality,
  hint: null,
  pointerLocked: false,
  ready: false,

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
  },
  hover: (id) => get().hoveredId !== id && set({ hoveredId: id }),
  setFilter: (filter) => {
    set({ filter });
    savePersisted({ filter });
  },
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setAbout: (aboutOpen) => set({ aboutOpen }),
  closePanel: () => set({ panelOpen: false }),
  overview: () => set((s) => ({ selectedId: null, panelOpen: false, overviewNonce: s.overviewNonce + 1 })),
  notify: (text) => {
    set({ toast: text });
    setTimeout(() => get().toast === text && set({ toast: null }), 4000);
  },
}));

export function useProject(id: string | null) {
  return useOffice((s) => (id ? s.snapshot?.projects.find((p) => p.id === id) ?? null : null));
}

// ---- live state ------------------------------------------------------------------------------

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
    // structural sharing: unchanged projects keep their object identity (memoised offices skip renders)
    const prev = new Map((s.snapshot?.projects ?? []).map((p) => [p.id, p]));
    msg.data.projects = msg.data.projects.map((p) => {
      const old = prev.get(p.id);
      return old && JSON.stringify(old) === JSON.stringify(p) ? old : p;
    });
    const patch: Partial<UIState> = { snapshot: msg.data };
    if (s.selectedId && !msg.data.projects.some((p) => p.id === s.selectedId)) {
      patch.selectedId = null;
      patch.panelOpen = false;
    }
    useOffice.setState(patch);
  };
  ws.onclose = () => {
    useOffice.setState({ connected: false });
    setTimeout(connectState, Math.min(8000, 500 * 2 ** retry++));
  };
}

/** Minimal inline markdown: **bold** and `code` only (curated summaries). */
export function mdInline(text: string): (string | { b?: string; code?: string })[] {
  const out: (string | { b?: string; code?: string })[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(m[1] ? { b: m[1] } : { code: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
