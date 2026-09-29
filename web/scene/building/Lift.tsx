import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { register } from '../interact';
import { R } from '../runtimeMats';
import { CEIL, H, LIFT, type Box } from './plan';

// Working lift: a tiny state machine shared by the renderer and the walking physics.
type Phase = 'idle' | 'closing' | 'moving' | 'opening';
export const lift = {
  y: 0,
  floor: 0,
  target: 0,
  phase: 'idle' as Phase,
  door: 1, // 0 closed … 1 open (at `floor`)
  request(f: number) {
    if (f === this.target && this.phase !== 'idle') return;
    if (f === this.floor && this.phase === 'idle') return;
    this.target = f;
    if (this.phase === 'idle' || this.phase === 'opening') this.phase = 'closing';
  },
  step(dt: number) {
    if (this.phase === 'closing') {
      this.door = Math.max(0, this.door - dt / 0.9);
      if (this.door === 0) this.phase = this.target === this.floor ? 'opening' : 'moving';
    } else if (this.phase === 'moving') {
      const goal = this.target * H;
      const dir = Math.sign(goal - this.y);
      this.y += dir * Math.min(Math.abs(goal - this.y), dt * 1.3);
      if (Math.abs(goal - this.y) < 1e-4) {
        this.y = goal;
        this.floor = this.target;
        this.phase = 'opening';
      }
    } else if (this.phase === 'opening') {
      this.door = Math.min(1, this.door + dt / 0.9);
      if (this.door === 1) this.phase = 'idle';
    }
  },
  /** how open the landing door on floor f is (0..1) */
  doorAt(f: number) {
    return this.phase !== 'moving' && this.floor === f ? this.door : 0;
  },
  /** collision boxes for closed/closing landing doors */
  blockers(f: number): Box[] {
    return this.doorAt(f) < 0.85 ? [{ minX: LIFT.doorX0, maxX: LIFT.doorX1, minZ: LIFT.z1 - 0.08, maxZ: LIFT.z1 + 0.08 }] : [];
  },
  busy() {
    return this.phase !== 'idle';
  },
};

const DOOR_W = (LIFT.doorX1 - LIFT.doorX0) / 2;

function indicatorTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const draw = () => {
    const g = c.getContext('2d')!;
    g.fillStyle = '#050607';
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#ffb347';
    g.font = '700 40px "JetBrains Mono", monospace';
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    const arrow = lift.phase === 'moving' ? (lift.target > lift.floor ? '▲' : '▼') : '';
    g.fillText(`${arrow}${lift.phase === 'moving' ? '' : lift.floor === 0 ? 'G' : '1'}`, 64, 34);
    t.needsUpdate = true;
  };
  draw();
  return { t, draw };
}

function Landing({ floor }: { floor: number }) {
  const m = R();
  const left = useRef<THREE.Mesh>(null);
  const right = useRef<THREE.Mesh>(null);
  const call = useRef<THREE.Mesh>(null);
  const ind = useMemo(indicatorTexture, []);
  const last = useRef('');
  useEffect(() => () => ind.t.dispose(), [ind]);
  useEffect(() => register(call.current, { kind: 'lift-call', floor, label: `Call lift to ${floor === 0 ? 'ground floor' : 'level 1'}` }), [floor]);
  useFrame(() => {
    const open = lift.doorAt(floor);
    if (left.current) left.current.position.x = LIFT.doorX0 + DOOR_W / 2 - open * (DOOR_W - 0.04);
    if (right.current) right.current.position.x = LIFT.doorX1 - DOOR_W / 2 + open * (DOOR_W - 0.04);
    const key = `${lift.phase}${lift.floor}${lift.target}`;
    if (key !== last.current) {
      last.current = key;
      ind.draw();
    }
  });
  const y0 = floor * H;
  const z = LIFT.z1 + 0.02;
  return (
    <group>
      <mesh ref={left} material={m.liftDoor} position={[LIFT.doorX0 + DOOR_W / 2, y0 + 1.1, z]} castShadow>
        <boxGeometry args={[DOOR_W, 2.2, 0.04]} />
      </mesh>
      <mesh ref={right} material={m.liftDoor} position={[LIFT.doorX1 - DOOR_W / 2, y0 + 1.1, z]} castShadow>
        <boxGeometry args={[DOOR_W, 2.2, 0.04]} />
      </mesh>
      {/* frame + header */}
      <mesh material={m.aluminium} position={[(LIFT.doorX0 + LIFT.doorX1) / 2, y0 + 2.25, z + 0.03]}>
        <boxGeometry args={[LIFT.doorX1 - LIFT.doorX0 + 0.16, 0.1, 0.06]} />
      </mesh>
      <mesh position={[(LIFT.doorX0 + LIFT.doorX1) / 2, y0 + 2.5, LIFT.z1 + 0.09]}>
        <planeGeometry args={[0.3, 0.15]} />
        <meshBasicMaterial map={ind.t} toneMapped={false} />
      </mesh>
      {/* call button */}
      <group position={[LIFT.doorX1 + 0.25, y0 + 1.15, LIFT.z1 + 0.09]}>
        <mesh material={m.aluminium}>
          <boxGeometry args={[0.12, 0.22, 0.02]} />
        </mesh>
        <mesh position={[0, 0, 0.012]}>
          <circleGeometry args={[0.035, 24]} />
          <meshBasicMaterial color="#ffb347" toneMapped={false} />
        </mesh>
        {/* generous aim target */}
        <mesh ref={call} position={[0, 0, 0.05]}>
          <boxGeometry args={[0.4, 0.5, 0.1]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      </group>
    </group>
  );
}

function Cabin() {
  const m = R();
  const group = useRef<THREE.Group>(null);
  const panel = useRef<THREE.Mesh>(null);
  useEffect(() => register(panel.current, { kind: 'lift-panel', label: 'Ride the lift' }), []);
  useFrame((_, dt) => {
    lift.step(Math.min(dt, 0.1));
    if (group.current) group.current.position.y = lift.y;
  });
  const w = LIFT.x1 - LIFT.x0 - 0.3;
  const d = LIFT.z1 - LIFT.z0 - 0.25;
  const cx = (LIFT.x0 + LIFT.x1) / 2;
  const cz = (LIFT.z0 + LIFT.z1) / 2 - 0.05;
  return (
    <group ref={group}>
      <mesh material={m.blackMetal} position={[cx, 0.01, cz]} receiveShadow>
        <boxGeometry args={[w, 0.04, d]} />
      </mesh>
      <mesh material={m.liftCabin} position={[cx, CEIL / 2, cz - d / 2]}>
        <boxGeometry args={[w, CEIL - 0.3, 0.04]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} material={m.liftCabin} position={[cx + (s * w) / 2, CEIL / 2, cz]}>
          <boxGeometry args={[0.04, CEIL - 0.3, d]} />
        </mesh>
      ))}
      <mesh material={m.panel} position={[cx, CEIL - 0.2, cz]}>
        <boxGeometry args={[w - 0.2, 0.03, d - 0.2]} />
      </mesh>
      {/* handrail + mirror */}
      <mesh material={m.chrome} position={[cx, 0.95, cz - d / 2 + 0.06]}>
        <boxGeometry args={[w - 0.2, 0.04, 0.04]} />
      </mesh>
      {/* control panel */}
      <group position={[cx + w / 2 - 0.03, 1.2, cz + d / 2 - 0.35]} rotation={[0, -Math.PI / 2, 0]}>
        <mesh material={m.aluminium}>
          <boxGeometry args={[0.2, 0.45, 0.02]} />
        </mesh>
        <mesh position={[0, 0.06, 0.012]}>
          <circleGeometry args={[0.04, 24]} />
          <meshBasicMaterial color="#67e8f9" toneMapped={false} />
        </mesh>
        <mesh ref={panel} position={[0, 0, 0.05]}>
          <boxGeometry args={[0.45, 0.6, 0.1]} />
          <meshBasicMaterial visible={false} />
        </mesh>
        <mesh position={[0, -0.08, 0.012]}>
          <circleGeometry args={[0.04, 24]} />
          <meshBasicMaterial color="#ffb347" toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

export function Lift({ floors }: { floors: [boolean, boolean] }) {
  return (
    <group>
      <Cabin />
      <group visible={floors[0]}>
        <Landing floor={0} />
      </group>
      <group visible={floors[1]}>
        <Landing floor={1} />
      </group>
    </group>
  );
}
