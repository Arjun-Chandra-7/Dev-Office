import * as THREE from 'three';
import type { Project } from '../../shared/types';
import { deskStatus, gitDirtyCount, type DeskStatus } from '../store';

export const SCREEN_W = 512;
export const SCREEN_H = 290;

const MONO = '"JetBrains Mono", "SFMono-Regular", ui-monospace, Menlo, Consolas, monospace';

export interface ScreenHandle {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
}

export function createScreen(): ScreenHandle {
  const canvas = document.createElement('canvas');
  canvas.width = SCREEN_W;
  canvas.height = SCREEN_H;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { canvas, texture };
}

/**
 * Lines shown on a monitor. They are a terse readout of *observed* state for this project —
 * never decorative fake log output.
 */
export function screenLines(p: Project): string[] {
  const lines: string[] = [];
  for (const s of p.claude.sessions) {
    if (s.activity === 'standby') continue;
    const what =
      s.activity === 'working' ? 'busy' : s.activity === 'streaming' ? 'output streaming' : s.activity === 'idle' ? 'idle' : 'activity unknown';
    lines.push(`● claude pid ${s.pid} · ${s.kind} · ${what}`);
    if (s.name) lines.push(`  └ ${s.name}`);
    if (s.relCwd) lines.push(`  └ ./${s.relCwd}`);
  }
  const root = p.repos[0];
  for (const r of p.repos.slice(0, 3)) {
    const label = r.relPath ? `${r.relPath}: ` : '';
    if (!r.valid) {
      lines.push(`${label}git: ${r.error ?? 'invalid repository'}`);
      continue;
    }
    const dirty = r.counts.staged + r.counts.modified + r.counts.untracked;
    lines.push(`${label}⎇ ${r.branch ?? 'detached'} ${dirty ? `± ${dirty} changed` : '✓ clean'}`);
  }
  if (root?.lastCommit) lines.push(`↳ ${root.lastCommit.subject}`);
  if (!p.repos.length) lines.push('no git repository');
  return lines;
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

export function drawScreen(h: ScreenHandle, p: Project, tick: number, dimmed: boolean) {
  const ctx = h.canvas.getContext('2d')!;
  const status: DeskStatus = deskStatus(p);
  const on = status === 'working' || status === 'live';
  const W = SCREEN_W;
  const H = SCREEN_H;

  // Background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  if (on) {
    bg.addColorStop(0, '#07181d');
    bg.addColorStop(1, '#041014');
  } else {
    bg.addColorStop(0, '#07090b');
    bg.addColorStop(1, '#040506');
  }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const accent = status === 'working' ? '#67e8f9' : status === 'live' ? '#a5f3fc' : '#475569';

  // Header
  ctx.fillStyle = on ? 'rgba(103,232,249,0.10)' : 'rgba(148,163,184,0.05)';
  ctx.fillRect(0, 0, W, 50);
  ctx.fillStyle = on ? '#e6fbff' : '#8b98a5';
  ctx.font = `700 26px ${MONO}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(fit(ctx, p.name.toUpperCase(), W - 150), 18, 26);

  ctx.font = `600 15px ${MONO}`;
  ctx.textAlign = 'right';
  const label =
    status === 'working' ? 'CLAUDE WORKING' : status === 'live' ? 'CLAUDE LIVE' : status === 'standby' ? 'STANDBY' : 'NO SESSION';
  ctx.fillStyle = accent;
  ctx.fillText(label, W - 18, 26);
  ctx.textAlign = 'left';

  // Body
  const lines = screenLines(p);
  ctx.font = `500 16px ${MONO}`;
  const lh = 24;
  const top = 72;
  const maxLines = Math.floor((H - top - 16) / lh);
  let shown = lines;
  if (status === 'working' && lines.length > maxLines) {
    const off = tick % lines.length;
    shown = [...lines.slice(off), ...lines.slice(0, off)];
  }
  shown.slice(0, maxLines).forEach((ln, i) => {
    ctx.fillStyle = ln.startsWith('●') ? accent : on ? '#b6d5dc' : '#56626d';
    ctx.fillText(fit(ctx, ln, W - 36), 18, top + i * lh);
  });

  // Cursor — blinks only when a session is actually working.
  if (status === 'working') {
    const y = top + Math.min(shown.length, maxLines) * lh;
    if (tick % 2 === 0 && y < H - 10) {
      ctx.fillStyle = accent;
      ctx.fillRect(18, y - 9, 10, 18);
    }
  }

  // Git dirty stripe along the bottom edge
  if (gitDirtyCount(p) > 0) {
    ctx.fillStyle = 'rgba(251,191,36,0.55)';
    ctx.fillRect(0, H - 4, W, 4);
  }

  // Scanline sheen
  if (on) {
    ctx.fillStyle = 'rgba(255,255,255,0.018)';
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  }
  if (dimmed) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, W, H);
  }
  h.texture.needsUpdate = true;
}

export function drawVacant(h: ScreenHandle) {
  const ctx = h.canvas.getContext('2d')!;
  ctx.fillStyle = '#030405';
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  h.texture.needsUpdate = true;
}
