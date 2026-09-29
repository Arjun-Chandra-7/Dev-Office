import { Environment, Lightformer, Sky } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useOffice } from '../store';
import { AboutWall } from './building/AboutWall';
import { BakedBuilding, cutPlane } from './building/BakedBuilding';
import { Exterior } from './building/Exterior';
import { lift, Lift } from './building/Lift';
import { CEIL, H } from './building/plan';
import { DebugExpose } from './debug';
import { LabelProjector } from './labels';
import { OfficeUnit } from './offices/OfficeUnit';
import { OverviewRig } from './OverviewRig';
import { Player } from './player/Player';
import { usePlan } from './usePlan';

// Golden-hour sun, matching the sky baked into the Blender kit.
const SUN_DIR = new THREE.Vector3(-0.55, 0.32, -0.77).normalize();
const SUN_POS = SUN_DIR.clone().multiplyScalar(100).toArray() as [number, number, number];

/**
 * Frame policy. Static surfaces are baked, so a frame is cheap — but an idle page still shouldn't
 * burn the GPU: render on demand, 30 fps while agents/screens animate, every frame while walking.
 */
function FrameDriver({ animated }: { animated: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!animated) return;
    const t = setInterval(() => invalidate(), 1000 / 30);
    return () => clearInterval(t);
  }, [animated, invalidate]);
  useFrame(({ invalidate: inv }) => {
    if (lift.busy()) inv();
  });
  return null;
}

/** Dollhouse cut: in the overview, slice away the ceiling of the floor being viewed. */
function CutControl({ active, floor }: { active: boolean; floor: number }) {
  const { gl, invalidate } = useThree();
  useEffect(() => {
    gl.localClippingEnabled = true;
    cutPlane.constant = active ? floor * H + CEIL - 0.08 : 1e6;
    invalidate();
  }, [active, floor, gl, invalidate]);
  return null;
}

function World() {
  const plan = usePlan();
  const projects = useOffice((s) => s.snapshot?.projects);
  const about = useOffice((s) => s.snapshot?.about);
  const mode = useOffice((s) => s.mode);
  const viewFloor = useOffice((s) => s.viewFloor);
  const walking = mode === 'walk';
  const floors: [boolean, boolean] = walking ? [true, true] : [true, viewFloor === 1];
  const anyAgents = useMemo(() => !!projects?.some((p) => p.agents.length > 0), [projects]);

  return (
    <>
      <BakedBuilding plan={plan} floors={floors} />
      <Exterior plan={plan} roof={walking} />
      <Lift floors={floors} />
      {about && <AboutWall about={about} />}
      {projects?.map((p) => {
        const spot = plan.byId.get(p.id);
        return spot ? <OfficeUnit key={p.id} project={p} spot={spot} visible={floors[spot.floor]} /> : null;
      })}
      {walking ? <Player key="player" plan={plan} /> : <OverviewRig plan={plan} />}
      {!walking && <LabelProjector plan={plan} />}
      <CutControl active={!walking} floor={viewFloor} />
      <FrameDriver animated={anyAgents && !walking} />
      <DebugExpose />
    </>
  );
}

export function Scene() {
  const quality = useOffice((s) => s.quality);
  const high = quality === 'high';
  const dpr = high ? Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 1.75) : 1;
  return (
    <Canvas
      frameloop="demand"
      dpr={dpr}
      gl={{ antialias: high, powerPreference: 'high-performance', stencil: false, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
      camera={{ fov: 38, near: 0.1, far: 1500, position: [40, 40, 40] }}
    >
      <Sky distance={900} sunPosition={SUN_POS} turbidity={6} rayleigh={1.8} mieCoefficient={0.005} mieDirectionalG={0.88} />
      {/* image-based light for the few real-time objects (agents, lift, trees); rendered once */}
      <Environment resolution={128} frames={1} environmentIntensity={0.9}>
        <Sky sunPosition={SUN_POS} turbidity={6} rayleigh={1.8} mieCoefficient={0.005} mieDirectionalG={0.88} />
        <Lightformer form="rect" intensity={1.6} color="#fff1dc" position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[20, 20, 1]} />
      </Environment>
      <directionalLight position={SUN_POS} intensity={2.2} color="#ffd9b0" />
      <hemisphereLight args={['#bcd6ff', '#5a4632', 0.35]} />
      <fog attach="fog" args={['#e9c9a4', 140, 600]} />
      <Suspense fallback={null}>
        <World />
      </Suspense>
    </Canvas>
  );
}
