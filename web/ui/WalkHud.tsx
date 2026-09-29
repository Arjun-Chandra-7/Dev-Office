import { useEffect, useRef } from 'react';
import { deskStatus, useOffice } from '../store';
import { lift } from '../scene/building/Lift';
import { HZ } from '../scene/building/plan';
import { player } from '../scene/player/Player';
import { currentPlan } from '../scene/usePlan';

/** Top-down minimap of the floor you're on: walls, offices coloured by Claude status, you. */
function MiniMap() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const projects = useOffice((s) => s.snapshot?.projects);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 66) return; // ~15 fps is plenty
      last = t;
      const c = canvas.current;
      if (!c) return;
      const g = c.getContext('2d')!;
      const plan = currentPlan;
      const W = c.width;
      const Hh = c.height;
      const pad = 10;
      const sc = Math.min((W - pad * 2) / (plan.length + 2), (Hh - pad * 2) / (2 * HZ + 2));
      const X = (x: number) => pad + (x + 1) * sc;
      const Z = (z: number) => Hh / 2 + z * sc;
      g.clearRect(0, 0, W, Hh);
      g.fillStyle = 'rgba(6,10,12,0.78)';
      g.fillRect(0, 0, W, Hh);
      const floor = player.floor;
      // offices
      const byId = new Map(projects?.map((p) => [p.id, p]));
      for (const o of plan.offices) {
        if (o.floor !== floor) continue;
        const p = byId.get(o.id);
        const st = p ? deskStatus(p) : 'none';
        g.fillStyle = st === 'working' ? 'rgba(103,232,249,0.55)' : st === 'live' ? 'rgba(165,243,252,0.3)' : 'rgba(148,163,184,0.12)';
        g.fillRect(X(o.x - 2.5), Z(o.z - 2.7), 5 * sc, 5.4 * sc);
      }
      // walls
      g.fillStyle = 'rgba(203,213,225,0.75)';
      for (const w of plan.walls) {
        if (w.floor !== floor || w.kind === 'collider') continue;
        g.fillRect(X(w.minX), Z(w.minZ), Math.max(1, (w.maxX - w.minX) * sc), Math.max(1, (w.maxZ - w.minZ) * sc));
      }
      // lift cabin state
      g.fillStyle = lift.floor === floor && lift.phase !== 'moving' ? 'rgba(255,179,71,0.8)' : 'rgba(255,179,71,0.25)';
      g.fillRect(X(8.1), Z(-4.5), 2.2 * sc, 2.2 * sc);
      // player
      g.save();
      g.translate(X(player.x), Z(player.z));
      g.rotate(-player.yaw);
      g.fillStyle = '#67e8f9';
      g.beginPath();
      g.moveTo(0, -7);
      g.lineTo(5, 5);
      g.lineTo(0, 2);
      g.lineTo(-5, 5);
      g.closePath();
      g.fill();
      g.restore();
      g.fillStyle = '#e2e8f0';
      g.font = '600 11px "JetBrains Mono", monospace';
      g.fillText(floor === 0 ? 'GROUND' : 'LEVEL 1', 8, 14);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [projects]);
  return <canvas ref={canvas} className="minimap" width={300} height={170} />;
}

export function WalkHud() {
  const mode = useOffice((s) => s.mode);
  const locked = useOffice((s) => s.pointerLocked);
  const hint = useOffice((s) => s.hint);
  const panelOpen = useOffice((s) => s.panelOpen && !!s.selectedId);
  const setMode = useOffice((s) => s.setMode);
  if (mode !== 'walk') return null;
  return (
    <>
      {locked && <div className="crosshair" />}
      {locked && hint && (
        <div className="walk-hint">
          <kbd>E</kbd> {hint}
        </div>
      )}
      <MiniMap />
      {!locked && !panelOpen && (
        <div className="walk-pause">
          <div className="walk-card">
            <div className="eyebrow">First-person</div>
            <h2>Walk the office</h2>
            <p className="muted">Click anywhere to take control.</p>
            <dl>
              <dt>W A S D</dt>
              <dd>move · hold Shift to sprint</dd>
              <dt>Space</dt>
              <dd>jump</dd>
              <dt>Mouse</dt>
              <dd>look around</dd>
              <dt>E / click</dt>
              <dd>read about a project at its laptop · ride the lift</dd>
              <dt>Lift</dt>
              <dd>step in front of it and it comes to you · inside, press E (or 1 / 2)</dd>
              <dt>Esc</dt>
              <dd>release the mouse</dd>
              <dt>V</dt>
              <dd>back to the overview</dd>
            </dl>
            <button className="btn ghost" onClick={() => setMode('overview')}>
              Exit to overview
            </button>
          </div>
        </div>
      )}
    </>
  );
}
