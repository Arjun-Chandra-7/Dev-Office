import { CameraControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import CameraControlsImpl from 'camera-controls';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { initialPersisted, savePersisted, useOffice } from '../store';
import { H, HZ, type BuildingPlan } from './building/plan';

/** Dollhouse camera: orbit/pan/zoom around the building, smooth focus on an office. */
export function OverviewRig({ plan }: { plan: BuildingPlan }) {
  const ref = useRef<CameraControlsImpl>(null);
  const selectedId = useOffice((s) => s.selectedId);
  const focusNonce = useOffice((s) => s.focusNonce);
  const overviewNonce = useOffice((s) => s.overviewNonce);
  const panelOpen = useOffice((s) => s.panelOpen);
  const viewFloor = useOffice((s) => s.viewFloor);
  const size = useThree((s) => s.size);
  const restored = useRef(false);

  const overview = (animate: boolean) => {
    const c = ref.current;
    if (!c) return;
    const y = viewFloor * H;
    const aspect = size.width / Math.max(1, size.height);
    const span = Math.max(2 * HZ * 1.4, (plan.length * 1.25) / Math.max(0.6, aspect));
    const dist = span * 2.3;
    c.setFocalOffset(0, 0, 0, animate);
    c.setLookAt(plan.length * 0.42, y + dist * 0.72, dist * 0.7, plan.length / 2, y, 0.3, animate);
  };

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.mouseButtons.left = CameraControlsImpl.ACTION.TRUCK;
    c.mouseButtons.right = CameraControlsImpl.ACTION.ROTATE;
    c.mouseButtons.wheel = CameraControlsImpl.ACTION.DOLLY;
    c.touches.one = CameraControlsImpl.ACTION.TOUCH_TRUCK;
    c.touches.two = CameraControlsImpl.ACTION.TOUCH_DOLLY_ROTATE;
    c.dollyToCursor = true;
    c.smoothTime = 0.4;
    c.draggingSmoothTime = 0.12;
    c.minDistance = 2;
    c.maxDistance = 160;
    c.minPolarAngle = 0.15;
    c.maxPolarAngle = 1.35;
    c.setBoundary(new THREE.Box3(new THREE.Vector3(-20, 0, -HZ - 20), new THREE.Vector3(plan.length + 20, 2 * H + 4, HZ + 20)));
    if (!restored.current) {
      restored.current = true;
      const saved = initialPersisted.camera;
      if (saved && !initialPersisted.selectedId) c.setLookAt(...saved.pos, ...saved.target, false);
      else if (!initialPersisted.selectedId) overview(false);
    }
    let t: ReturnType<typeof setTimeout> | undefined;
    const persist = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const p = c.getPosition(new THREE.Vector3());
        const g = c.getTarget(new THREE.Vector3());
        savePersisted({ camera: { pos: [p.x, p.y, p.z], target: [g.x, g.y, g.z] } });
      }, 400);
    };
    c.addEventListener('rest', persist);
    return () => c.removeEventListener('rest', persist);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  // focus the selected office (switching the visible floor if needed)
  useEffect(() => {
    const c = ref.current;
    if (!c || !selectedId) return;
    const o = plan.byId.get(selectedId);
    if (!o) return;
    const st = useOffice.getState();
    if (st.viewFloor !== o.floor) st.setViewFloor(o.floor as 0 | 1);
    const f = Math.max(1, 1.25 / (size.width / Math.max(1, size.height)));
    // look into the room from above the corridor side
    const back = -o.side; // towards the corridor
    c.setLookAt(o.x + 1.2 * f, o.y + 6.2 * f, o.z + back * 6.4 * f, o.x, o.y + 0.6, o.z + o.side * 0.3, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce, selectedId, plan]);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const open = panelOpen && !!selectedId;
    if (size.width > 900) c.setFocalOffset(open ? 1.6 : 0, 0, 0, true);
    else c.setFocalOffset(0, open ? 2.4 : 0, 0, true);
  }, [panelOpen, size.width, selectedId]);

  useEffect(() => {
    if (overviewNonce) overview(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overviewNonce]);

  // switching floors re-frames the camera at the new height
  const lastFloor = useRef(viewFloor);
  useEffect(() => {
    const c = ref.current;
    if (!c || lastFloor.current === viewFloor) return;
    const dy = (viewFloor - lastFloor.current) * H;
    lastFloor.current = viewFloor;
    const p = c.getPosition(new THREE.Vector3());
    const g = c.getTarget(new THREE.Vector3());
    c.setLookAt(p.x, p.y + dy, p.z, g.x, g.y + dy, g.z, true);
  }, [viewFloor]);

  return <CameraControls ref={ref} makeDefault />;
}
