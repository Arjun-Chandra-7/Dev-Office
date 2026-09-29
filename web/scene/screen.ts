import * as THREE from 'three';
import type { PortfolioProject } from '../../shared/types';
import { STATUS_LABEL, deskStatus } from '../store';

export const SCREEN_W = 512;
export const SCREEN_H = 290;
const SANS = '"Inter", system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';

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

function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

/** Name + status only. While a session is working, a calm waveform animates along the bottom. */
export function drawScreen(h: ScreenHandle, p: PortfolioProject, tick: number) {
  const g = h.canvas.getContext('2d')!;
  const st = deskStatus(p);
  const accent = st === 'working' ? '#67e8f9' : st === 'live' ? '#86efac' : '#64748b';
  const bg = g.createLinearGradient(0, 0, SCREEN_W, SCREEN_H);
  bg.addColorStop(0, st === 'none' ? '#0b0e11' : '#081a20');
  bg.addColorStop(1, '#05070a');
  g.fillStyle = bg;
  g.fillRect(0, 0, SCREEN_W, SCREEN_H);

  g.fillStyle = '#f2f7f8';
  g.font = `800 52px ${SANS}`;
  g.textBaseline = 'alphabetic';
  g.fillText(fit(g, p.title, SCREEN_W - 60), 30, 118);

  g.font = `600 22px ${MONO}`;
  g.fillStyle = accent;
  g.beginPath();
  g.arc(38, 160, 7, 0, Math.PI * 2);
  g.fill();
  g.fillText(STATUS_LABEL[p.status].toUpperCase(), 56, 168);

  if (st === 'working') {
    g.strokeStyle = accent;
    g.globalAlpha = 0.85;
    g.lineWidth = 3;
    g.beginPath();
    for (let x = 0; x <= SCREEN_W; x += 6) {
      const y = 238 + Math.sin(x * 0.035 + tick * 0.9) * 12 * Math.sin(x * 0.011 + tick * 0.3);
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.globalAlpha = 1;
  } else {
    g.fillStyle = 'rgba(148,163,184,0.25)';
    g.fillRect(30, 236, SCREEN_W - 60, 2);
  }
  h.texture.needsUpdate = true;
}
