import { useThree, type ThreeEvent } from '@react-three/fiber';
import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { PortfolioProject } from '../../../shared/types';
import { STATUS_LABEL, deskStatus, matchesFilter, useOffice } from '../../store';
import { openProject } from '../actions';
import { Agent } from '../agents/Agent';
import { DOOR_LOCAL_X, OFF_D, OFF_W, type OfficeSpot } from '../building/plan';
import { register } from '../interact';
import { R } from '../runtimeMats';
import { createScreen, drawScreen } from '../screen';

// Per-project live parts of an office (the room itself is baked): laptop + wall-TV screen showing
// the name and status, the door sign, one agent per live Claude session, and click targets.

const SEATS: { pos: [number, number, number]; rotY: number; pose: 'desk' | 'visitor' }[] = [
  { pos: [0.3, 0, 1.86], rotY: 0, pose: 'desk' },
  { pos: [-0.25, 0, 0.15], rotY: Math.PI, pose: 'visitor' },
  { pos: [0.85, 0, 0.15], rotY: Math.PI, pose: 'visitor' },
  { pos: [2.0, 0, -1.8], rotY: Math.PI / 2, pose: 'visitor' },
  { pos: [2.0, 0, -0.9], rotY: Math.PI / 2, pose: 'visitor' },
];

function signTexture(p: PortfolioProject, live: boolean) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const g = c.getContext('2d')!;
  const st = deskStatus(p);
  g.fillStyle = '#0f1316';
  g.fillRect(0, 0, 512, 160);
  g.fillStyle = st === 'working' ? '#67e8f9' : st === 'live' ? '#86efac' : '#3a4650';
  g.fillRect(0, 0, 10, 160);
  g.fillStyle = '#f4f7f8';
  g.font = '700 54px "Inter", system-ui, sans-serif';
  g.textBaseline = 'middle';
  let name = p.title;
  while (g.measureText(name).width > 460 && name.length > 3) name = name.slice(0, -2);
  if (name !== p.title) name += '…';
  g.fillText(name, 36, 62);
  g.font = '500 26px "JetBrains Mono", monospace';
  g.fillStyle = st === 'none' ? '#7b8893' : st === 'working' ? '#67e8f9' : '#86efac';
  if (!live) g.fillStyle = '#67e8f9';
  g.fillText(live ? `● ${STATUS_LABEL[p.status]}` : 'step inside · press E at the laptop', 36, 118);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const LAPTOP = { x: 0.3, z: 1.34 };

export const OfficeUnit = memo(function OfficeUnit({ project, spot, visible }: { project: PortfolioProject; spot: OfficeSpot; visible: boolean }) {
  const m = R();
  const invalidate = useThree((s) => s.invalidate);
  const selected = useOffice((s) => s.selectedId === project.id);
  const hovered = useOffice((s) => s.hoveredId === project.id);
  const filter = useOffice((s) => s.filter);
  const hover = useOffice((s) => s.hover);
  const liveStatus = useOffice((s) => s.snapshot?.statusAvailable ?? false);
  const status = deskStatus(project);
  const dimmed = !matchesFilter(project, filter);

  const screen = useMemo(createScreen, []);
  const screenMat = useRef<THREE.MeshBasicMaterial>(null);
  const tvMat = useRef<THREE.MeshBasicMaterial>(null);
  const laptopHit = useRef<THREE.Mesh>(null);
  const sign = useMemo(() => signTexture(project, liveStatus), [project, liveStatus]);
  useEffect(() => () => screen.texture.dispose(), [screen]);
  useEffect(() => () => sign.dispose(), [sign]);

  // screen: redrawn on change; animated (2 fps) only while a session is working and visible
  useEffect(() => {
    let tick = 0;
    drawScreen(screen, project, tick, liveStatus);
    invalidate();
    if (status !== 'working' || !visible) return;
    const t = setInterval(() => {
      drawScreen(screen, project, ++tick, liveStatus);
      invalidate();
    }, 500);
    return () => clearInterval(t);
  }, [project, status, screen, invalidate, visible, liveStatus]);

  useEffect(() => {
    const b = dimmed ? 0.3 : status === 'none' ? 0.6 : 1;
    screenMat.current?.color.setScalar(b);
    tvMat.current?.color.setScalar(b * 0.95);
    invalidate();
  }, [status, dimmed, invalidate]);

  useEffect(() => register(laptopHit.current, { kind: 'laptop', projectId: project.id, label: `About ${project.title}` }), [project.id, project.title]);

  const outline = selected || hovered;
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (useOffice.getState().mode !== 'overview') return;
    e.stopPropagation();
    openProject(project.id, e.object === laptopHit.current);
  };
  const over = (e: ThreeEvent<PointerEvent>) => {
    if (useOffice.getState().mode !== 'overview') return;
    e.stopPropagation();
    hover(project.id);
    document.body.style.cursor = 'pointer';
  };
  const out = () => {
    hover(null);
    document.body.style.cursor = '';
  };

  return (
    <group position={[spot.x, spot.y, spot.z]} rotation={[0, spot.rotY, 0]} visible={visible}>
      {/* laptop */}
      <group position={[LAPTOP.x, 0.772, LAPTOP.z]}>
        <mesh material={m.laptopBody} position={[0, 0.009, 0]}>
          <boxGeometry args={[0.34, 0.016, 0.24]} />
        </mesh>
        <mesh material={m.keys} position={[0, 0.0175, 0.01]}>
          <boxGeometry args={[0.29, 0.002, 0.11]} />
        </mesh>
        <group position={[0, 0.017, -0.118]} rotation={[-0.28, 0, 0]}>
          <mesh material={m.laptopBody} position={[0, 0.11, -0.004]}>
            <boxGeometry args={[0.34, 0.225, 0.008]} />
          </mesh>
          <mesh position={[0, 0.112, 0.0005]}>
            <planeGeometry args={[0.315, 0.195]} />
            <meshBasicMaterial ref={screenMat} map={screen.texture} toneMapped={false} />
          </mesh>
        </group>
        <mesh material={m.blob} position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.5, 0.36, 1]}>
          <planeGeometry />
        </mesh>
        {/* generous click / aim target */}
        <mesh ref={laptopHit} position={[0, 0.12, -0.04]} onClick={click} onPointerOver={over} onPointerOut={out}>
          <boxGeometry args={[0.5, 0.34, 0.42]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      </group>

      {/* wall-TV screen (the TV housing is baked) */}
      <mesh position={[-OFF_W / 2 + 0.111, 1.55, 0.9]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[1.4, 0.788]} />
        <meshBasicMaterial ref={tvMat} map={screen.texture} toneMapped={false} />
      </mesh>

      {/* door sign on the corridor glass */}
      <mesh position={[DOOR_LOCAL_X + 1.05, 1.55, -OFF_D / 2 - 0.02]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.9, 0.28]} />
        <meshBasicMaterial map={sign} toneMapped={false} />
      </mesh>

      {/* agents: one per live Claude session */}
      {project.agents.slice(0, SEATS.length).map((a, i) => (
        <Agent key={a.id} seed={a.id} activity={a.activity} pose={SEATS[i].pose} position={SEATS[i].pos} rotY={SEATS[i].rotY} />
      ))}

      {outline &&
        [
          [0, -OFF_D / 2 + 0.12, OFF_W - 0.3, 0.05],
          [0, OFF_D / 2 - 0.12, OFF_W - 0.3, 0.05],
          [-OFF_W / 2 + 0.12, 0, 0.05, OFF_D - 0.3],
          [OFF_W / 2 - 0.12, 0, 0.05, OFF_D - 0.3],
        ].map(([x, z, w, d], i) => (
          <mesh key={i} position={[x, 0.014, z]}>
            <boxGeometry args={[w, 0.004, d]} />
            <meshBasicMaterial color={selected ? '#67e8f9' : '#cbd5e1'} toneMapped={false} transparent opacity={selected ? 0.95 : 0.55} />
          </mesh>
        ))}

      {/* whole-room click target (overview) */}
      <mesh position={[0, 0.03, 0]} onClick={click} onPointerOver={over} onPointerOut={out}>
        <boxGeometry args={[OFF_W - 0.3, 0.04, OFF_D - 0.3]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
});
