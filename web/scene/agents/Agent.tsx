import { useFrame } from '@react-three/fiber';
import { memo, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ClaudeActivity } from '../../../shared/types';

// A stylised seated person. One agent = one real Claude session; its animation reflects the
// observed activity (typing only when the session is working / streaming output).

const SKIN = ['#f1c7a5', '#e0ac85', '#c68e65', '#9c6b48', '#704a32', '#f5d5bd'];
const HAIR = ['#1f1a17', '#3b2a1f', '#6b4a2b', '#a0714a', '#d8b27a', '#2b2b2e', '#8a3b25'];
const SHIRT = ['#1d4ed8', '#0f766e', '#7c3aed', '#be123c', '#334155', '#ea580c', '#0e7490', '#4d7c0f', '#f5f5f4', '#111827'];
const PANTS = ['#1f2937', '#27272a', '#1e3a5f', '#3f3f46', '#44403c'];

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, rough = 0.7) {
  const k = `${color}|${rough}`;
  let m = matCache.get(k);
  if (!m) matCache.set(k, (m = new THREE.MeshStandardMaterial({ color, roughness: rough })));
  return m;
}

const CAP = new THREE.CapsuleGeometry(1, 1, 6, 12);
const SPHERE = new THREE.SphereGeometry(1, 20, 16);
const HALF = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 1.8);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const RING = new THREE.TorusGeometry(0.11, 0.012, 8, 40);
const up = new THREE.Vector3(0, 1, 0);

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Capsule spanning two points. */
function Limb({ a, b, r, m, shadow = false }: { a: [number, number, number]; b: [number, number, number]; r: number; m: THREE.Material; shadow?: boolean }) {
  const { pos, quat, len } = useMemo(() => {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const dir = vb.clone().sub(va);
    const len = dir.length();
    return { pos: va.add(vb).multiplyScalar(0.5), quat: new THREE.Quaternion().setFromUnitVectors(up, dir.normalize()), len };
  }, [a, b]);
  return <mesh geometry={CAP} material={m} position={pos} quaternion={quat} scale={[r, Math.max(0.001, len) / 3, r]} castShadow={shadow} />;
}

export type AgentPose = 'desk' | 'visitor';

export const Agent = memo(function Agent({
  seed,
  activity,
  pose,
  position,
  rotY,
}: {
  seed: string;
  activity: ClaudeActivity;
  pose: AgentPose;
  position: [number, number, number];
  rotY: number;
}) {
  const h = hash(seed);
  const look = useMemo(
    () => ({
      skin: mat(SKIN[h % SKIN.length], 0.55),
      hair: mat(HAIR[(h >>> 3) % HAIR.length], 0.8),
      shirt: mat(SHIRT[(h >>> 7) % SHIRT.length], 0.85),
      pants: mat(PANTS[(h >>> 11) % PANTS.length], 0.9),
      shoe: mat('#141414', 0.5),
      longHair: (h >>> 15) % 3 === 0,
    }),
    [h],
  );
  const typing = pose === 'desk' && (activity === 'working' || activity === 'streaming');
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Mesh>(null);
  const phase = (h % 1000) / 159;

  useFrame(({ clock }) => {
    const t = clock.elapsedTime + phase;
    if (torso.current) {
      const lean = typing ? -0.14 : pose === 'desk' ? 0.1 : 0.05;
      torso.current.rotation.x = THREE.MathUtils.lerp(torso.current.rotation.x, lean + Math.sin(t * 1.4) * 0.012, 0.08);
    }
    if (head.current) {
      head.current.rotation.y = typing ? Math.sin(t * 0.7) * 0.18 : Math.sin(t * 0.25) * 0.35;
      head.current.rotation.x = typing ? 0.22 + Math.sin(t * 3.1) * 0.03 : -0.05 + Math.sin(t * 0.4) * 0.05;
    }
    if (armL.current && armR.current) {
      if (typing) {
        armL.current.rotation.x = Math.sin(t * 17) * 0.06;
        armR.current.rotation.x = Math.sin(t * 15 + 1.3) * 0.06;
      } else {
        armL.current.rotation.x = THREE.MathUtils.lerp(armL.current.rotation.x, 0, 0.1);
        armR.current.rotation.x = THREE.MathUtils.lerp(armR.current.rotation.x, 0, 0.1);
      }
    }
    if (halo.current) {
      halo.current.rotation.z = t * 0.8;
      const s = 1 + Math.sin(t * 3) * (typing ? 0.08 : 0.03);
      halo.current.scale.setScalar(s);
    }
  });

  // arm targets in shoulder space: hands on the keyboard while typing / attending the desk,
  // resting on the lap otherwise
  const reach = pose === 'desk' && activity !== 'idle' && activity !== 'unknown';
  const elbow = (sd: number): [number, number, number] => (reach ? [sd * 0.02, -0.21, -0.21] : [sd * 0.02, -0.27, -0.11]);
  const hand = (sd: number): [number, number, number] => (reach ? [sd * -0.08, -0.19, -0.47] : [sd * -0.06, -0.39, -0.33]);
  const haloColor = activity === 'working' || activity === 'streaming' ? '#67e8f9' : activity === 'idle' ? '#e0f2fe' : '#fde68a';

  const thighZ = pose === 'visitor' ? -0.32 : -0.4;
  const shinZ = pose === 'visitor' ? -0.36 : -0.46;
  const footZ = pose === 'visitor' ? -0.42 : -0.52;

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      {/* legs (seated) */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <Limb a={[s * 0.1, 0.52, 0.02]} b={[s * 0.11, 0.53, thighZ]} r={0.075} m={look.pants} />
          <Limb a={[s * 0.11, 0.52, thighZ - 0.02]} b={[s * 0.12, 0.1, shinZ]} r={0.062} m={look.pants} />
          <mesh geometry={BOX} material={look.shoe} position={[s * 0.12, 0.04, footZ]} scale={[0.1, 0.07, 0.22]} />
        </group>
      ))}
      <mesh geometry={SPHERE} material={look.pants} position={[0, 0.54, 0.02]} scale={[0.19, 0.1, 0.17]} castShadow />
      {/* upper body pivots at the hips */}
      <group ref={torso} position={[0, 0.55, 0.03]}>
        <mesh geometry={CAP} material={look.shirt} position={[0, 0.27, 0]} scale={[0.17, 0.2, 0.12]} castShadow />
        <mesh geometry={SPHERE} material={look.shirt} position={[0, 0.44, 0]} scale={[0.23, 0.09, 0.13]} />
        {/* arms: shoulder pivots */}
        {[-1, 1].map((s) => (
          <group key={s} ref={s < 0 ? armL : armR} position={[s * 0.21, 0.44, 0]}>
            <Limb a={[0, 0, 0]} b={elbow(s)} r={0.055} m={look.shirt} />
            <Limb a={elbow(s)} b={hand(s)} r={0.045} m={look.skin} />
          </group>
        ))}
        {/* head */}
        <group ref={head} position={[0, 0.56, 0]}>
          <mesh geometry={CAP} material={look.skin} position={[0, 0.03, 0]} scale={[0.045, 0.04, 0.045]} />
          <mesh geometry={SPHERE} material={look.skin} position={[0, 0.16, 0]} scale={[0.1, 0.12, 0.11]} castShadow />
          <mesh geometry={HALF} material={look.hair} position={[0, 0.18, 0.012]} scale={[0.108, 0.12, 0.118]} />
          {look.longHair && <mesh geometry={CAP} material={look.hair} position={[0, 0.08, 0.07]} scale={[0.1, 0.08, 0.05]} />}
          <mesh geometry={SPHERE} material={look.skin} position={[0.1, 0.15, 0]} scale={[0.018, 0.03, 0.02]} />
          <mesh geometry={SPHERE} material={look.skin} position={[-0.1, 0.15, 0]} scale={[0.018, 0.03, 0.02]} />
        </group>
      </group>
      {/* status halo: colour = observed activity */}
      <mesh ref={halo} geometry={RING} position={[0, 1.55, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <meshBasicMaterial color={haloColor} toneMapped={false} transparent opacity={0.9} />
      </mesh>
    </group>
  );
});
