import { useFrame, useThree } from '@react-three/fiber';
import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import type { PortfolioProject as Project } from '../../shared/types';
import { deskStatus, matchesFilter, useOffice } from '../store';
import { OFF_W, type BuildingPlan } from './building/plan';

// One DOM layer for all desk labels, positioned from the render loop. (A React root per label
// — drei <Html> — was both heavier with dozens of desks and dropped the first label.)

const els = new Map<string, HTMLDivElement>();
const LABEL_HEIGHT = 3.35;
const tmp = new THREE.Vector3();

/** Inside <Canvas>: projects desk anchors to screen space each rendered frame. */
export function LabelProjector({ plan }: { plan: BuildingPlan }) {
  const projects = useOffice((s) => s.snapshot?.projects);
  const viewFloor = useOffice((s) => s.viewFloor);
  const invalidate = useThree((s) => s.invalidate);
  // new/changed desks need one frame so their labels get positioned
  useEffect(() => {
    requestAnimationFrame(() => invalidate());
  }, [projects, viewFloor, invalidate]);
  useFrame(({ camera, size }) => {
    if (!projects) return;
    const cam = camera as THREE.PerspectiveCamera;
    const k = size.height / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    for (const p of projects) {
      const el = els.get(p.id);
      if (!el) continue;
      const o = plan.byId.get(p.id);
      if (!o || o.floor !== viewFloor) {
        el.style.visibility = 'hidden';
        continue;
      }
      tmp.set(o.x, o.y + LABEL_HEIGHT, o.z);
      const dist = tmp.distanceTo(cam.position);
      tmp.project(cam);
      if (tmp.z > 1 || tmp.x < -1.3 || tmp.x > 1.3 || tmp.y < -1.3 || tmp.y > 1.3) {
        el.style.visibility = 'hidden';
        continue;
      }
      const sx = ((tmp.x + 1) / 2) * size.width;
      const sy = ((1 - tmp.y) / 2) * size.height;
      el.style.visibility = 'visible';
      el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -50%)`;
      el.style.zIndex = String(Math.max(1, Math.round(10000 - dist * 50)));
      // level of detail: how many pixels a desk's width occupies at this distance
      const deskPx = (OFF_W * 0.5 * k) / dist;
      const lod = deskPx < 34 ? 'dot' : deskPx < 80 ? 'compact' : 'full';
      if (el.dataset.lod !== lod) el.dataset.lod = lod;
    }
  });
  return null;
}

const Label = memo(function Label({ p, selected, hovered, dimmed }: { p: Project; selected: boolean; hovered: boolean; dimmed: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    els.set(p.id, el);
    return () => {
      if (els.get(p.id) === el) els.delete(p.id);
    };
  }, [p.id]);
  const status = deskStatus(p);
  return (
    <div ref={ref} className="desk-anchor" style={{ visibility: 'hidden' }}>
      <div className={`desk-label s-${status}${selected ? ' is-selected' : ''}${hovered ? ' is-hover' : ''}${dimmed ? ' is-dim' : ''}`}>
        <span className="dot" />
        <span className="name">{p.title}</span>
        {p.agents.length > 1 && <span className="count">×{p.agents.length}</span>}
      </div>
    </div>
  );
});

/** Outside <Canvas>: the label elements themselves. */
export function DeskLabels() {
  const projects = useOffice((s) => s.snapshot?.projects);
  const selectedId = useOffice((s) => s.selectedId);
  const hoveredId = useOffice((s) => s.hoveredId);
  const filter = useOffice((s) => s.filter);
  const mode = useOffice((s) => s.mode);
  if (!projects || mode === 'walk') return null;
  return (
    <div className="label-layer" aria-hidden>
      {projects.map((p) => (
        <Label key={p.id} p={p} selected={p.id === selectedId} hovered={p.id === hoveredId} dimmed={!matchesFilter(p, filter)} />
      ))}
    </div>
  );
}
