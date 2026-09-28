import { useThree, type ThreeEvent } from '@react-three/fiber';
import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Project } from '../../../shared/types';
import { deskStatus, matchesFilter, useOffice } from '../../store';
import { Agent } from '../agents/Agent';
import { M } from '../building/materials';
import { DOOR_LOCAL_X, OFF_D, OFF_W, type OfficeSpot } from '../building/plan';
import { register } from '../interact';
import { createScreen, drawScreen } from '../screen';
import { openProject } from '../actions';
import { dbgOff } from '../debug';

// Per-project, data-driven parts of an office: laptop + wall TV (live screens), door sign,
// agents (one per live Claude session), selection outline and click targets.

const SEATS: { pos: [number, number, number]; rotY: number; pose: 'desk' | 'visitor' }[] = [
  { pos: [0.3, 0, 1.86], rotY: 0, pose: 'desk' },
  { pos: [-0.25, 0, 0.15], rotY: Math.PI, pose: 'visitor' },
  { pos: [0.85, 0, 0.15], rotY: Math.PI, pose: 'visitor' },
  { pos: [2.0, 0, -1.8], rotY: Math.PI / 2, pose: 'visitor' },
  { pos: [2.0, 0, -0.9], rotY: Math.PI / 2, pose: 'visitor' },
];

function signTexture(p: Project) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const g = c.getContext('2d')!;
  const st = deskStatus(p);
  g.fillStyle = '#101417';
  g.fillRect(0, 0, 512, 160);
  g.fillStyle = st === 'working' ? '#67e8f9' : st === 'live' ? '#a5f3fc' : '#3a4650';
  g.fillRect(0, 0, 10, 160);
  g.fillStyle = '#f4f7f8';
  g.font = '700 54px "Inter", system-ui, sans-serif';
  g.textBaseline = 'middle';
  let name = p.name;
  while (g.measureText(name).width > 460 && name.length > 3) name = name.slice(0, -2);
  if (name !== p.name) name += '…';
  g.fillText(name, 36, 62);
  g.font = '500 26px "JetBrains Mono", monospace';
  g.fillStyle = '#8b9aa5';
  const sub =
    st === 'working' ? `● ${p.claude.working} working` : st === 'live' ? `● ${p.claude.live} live session${p.claude.live > 1 ? 's' : ''}` : 'no live session';
  g.fillText(sub, 36, 118);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const LAPTOP = { x: 0.3, z: 1.34 };

export const OfficeUnit = memo(function OfficeUnit({ project, spot, visible }: { project: Project; spot: OfficeSpot; visible: boolean }) {
  const m = M();
  const invalidate = useThree((s) => s.invalidate);
  const selected = useOffice((s) => s.selectedId === project.id);
  const hovered = useOffice((s) => s.hoveredId === project.id);
  const filter = useOffice((s) => s.filter);
  const hover = useOffice((s) => s.hover);
  const status = deskStatus(project);
  const dimmed = !matchesFilter(project, filter);

  const screen = useMemo(createScreen, []);
  const screenMat = useRef<THREE.MeshBasicMaterial>(null);
  const tvMat = useRef<THREE.MeshBasicMaterial>(null);
  const laptopHit = useRef<THREE.Mesh>(null);
  const sign = useMemo(() => signTexture(project), [project]);
  useEffect(() => () => screen.texture.dispose(), [screen]);
  useEffect(() => () => sign.dispose(), [sign]);

  // Live screen: redraw on data change; animate only while Claude is actually working.
  useEffect(() => {
    let tick = 0;
    drawScreen(screen, project, tick, false);
    invalidate();
    if (status !== 'working' || !visible) return;
    const t = setInterval(() => {
      drawScreen(screen, project, ++tick, false);
      invalidate();
    }, 600);
    return () => clearInterval(t);
  }, [project, status, screen, invalidate, visible]);

  useEffect(() => {
    const b = dimmed ? 0.35 : status === 'working' ? 1.7 : status === 'live' ? 1.35 : 0.55;
    screenMat.current?.color.setScalar(b);
    tvMat.current?.color.setScalar(b * 0.85);
    invalidate();
  }, [status, dimmed, invalidate]);

  useEffect(() => register(laptopHit.current, { kind: 'laptop', projectId: project.id, label: `Open Claude sessions · ${project.name}` }), [project.id, project.name]);

  const agents = project.claude.sessions.filter((s) => s.activity !== 'standby').slice(0, SEATS.length);
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
        <mesh material={m.laptopBody} position={[0, 0.009, 0]} castShadow>
          <boxGeometry args={[0.34, 0.016, 0.24]} />
        </mesh>
        <mesh material={m.keyboardKeys} position={[0, 0.0175, 0.01]}>
          <boxGeometry args={[0.29, 0.002, 0.11]} />
        </mesh>
        <group position={[0, 0.017, -0.118]} rotation={[-0.28, 0, 0]}>
          <mesh material={m.laptopBody} position={[0, 0.11, -0.004]} castShadow>
            <boxGeometry args={[0.34, 0.225, 0.008]} />
          </mesh>
          <mesh position={[0, 0.112, 0.0005]}>
            <planeGeometry args={[0.315, 0.195]} />
            <meshBasicMaterial ref={screenMat} map={screen.texture} toneMapped={false} />
          </mesh>
        </group>
        {/* generous click / aim target around the laptop */}
        <mesh ref={laptopHit} position={[0, 0.12, -0.04]} onClick={click} onPointerOver={over} onPointerOut={out}>
          <boxGeometry args={[0.5, 0.34, 0.42]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      </group>

      {/* wall TV mirroring the laptop (visible through the glass from the corridor) */}
      <group position={[-OFF_W / 2 + 0.09, 1.55, 0.9]} rotation={[0, Math.PI / 2, 0]}>
        <mesh material={m.screenBezel} castShadow>
          <boxGeometry args={[1.46, 0.84, 0.04]} />
        </mesh>
        <mesh position={[0, 0, 0.021]}>
          <planeGeometry args={[1.4, 0.788]} />
          <meshBasicMaterial ref={tvMat} map={screen.texture} toneMapped={false} />
        </mesh>
      </group>

      {/* door sign on the corridor glass */}
      <mesh position={[DOOR_LOCAL_X + 1.05, 1.55, -OFF_D / 2 - 0.02]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.9, 0.28]} />
        <meshBasicMaterial map={sign} toneMapped={false} />
      </mesh>

      {/* agents: one per live Claude session */}
      {!dbgOff('agents') && agents.map((s, i) => <Agent key={s.id} seed={s.sessionId ?? s.id} activity={s.activity} pose={SEATS[i].pose} position={SEATS[i].pos} rotY={SEATS[i].rotY} />)}

      {/* selection outline on the floor */}
      {outline &&
        [
          [0, -OFF_D / 2 + 0.12, OFF_W - 0.3, 0.05],
          [0, OFF_D / 2 - 0.12, OFF_W - 0.3, 0.05],
          [-OFF_W / 2 + 0.12, 0, 0.05, OFF_D - 0.3],
          [OFF_W / 2 - 0.12, 0, 0.05, OFF_D - 0.3],
        ].map(([x, z, w, d], i) => (
          <mesh key={i} position={[x, 0.012, z]}>
            <boxGeometry args={[w, 0.004, d]} />
            <meshBasicMaterial color={selected ? '#67e8f9' : '#cbd5e1'} toneMapped={false} transparent opacity={selected ? 0.95 : 0.55} />
          </mesh>
        ))}

      {/* whole-room click target for the overview */}
      <mesh position={[0, 0.03, 0]} onClick={click} onPointerOver={over} onPointerOut={out}>
        <boxGeometry args={[OFF_W - 0.3, 0.04, OFF_D - 0.3]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
});
