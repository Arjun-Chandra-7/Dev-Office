import { Environment, Lightformer, Sky } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, BrightnessContrast, EffectComposer, HueSaturation, N8AO, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useOffice } from '../store';
import { Building } from './building/Building';
import { Core } from './building/Core';
import { InstancedKit } from './building/Furniture';
import { officeKit } from './building/kits';
import { lift, Lift } from './building/Lift';
import { H, HZ, type BuildingPlan } from './building/plan';
import { LabelProjector } from './labels';
import { OfficeUnit } from './offices/OfficeUnit';
import { OverviewRig } from './OverviewRig';
import { Player } from './player/Player';
import { usePlan } from './usePlan';
import { dbgOff, DebugExpose } from './debug';

// Golden-hour sun low in the south-west, so light rakes through the glass façades.
const SUN_DIR = new THREE.Vector3(-0.55, 0.3, -0.78).normalize();

function Sun({ plan, quality }: { plan: BuildingPlan; quality: 'high' | 'low' }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    const l = light.current;
    if (!l) return;
    target.position.set(plan.length / 2, 0, 0);
    l.target = target;
    l.position.copy(target.position).addScaledVector(SUN_DIR, 60);
    const cam = l.shadow.camera as THREE.OrthographicCamera;
    const s = Math.max(plan.length, 2 * HZ) * 0.62 + 4;
    cam.left = -s;
    cam.right = s;
    cam.top = s;
    cam.bottom = -s;
    cam.near = 1;
    cam.far = 140;
    cam.updateProjectionMatrix();
    l.shadow.needsUpdate = true;
  }, [plan, target]);
  const size = quality === 'high' ? 2048 : 1024;
  return (
    <>
      <primitive object={target} />
      <directionalLight
        key={size}
        ref={light}
        color="#ffd2a8"
        intensity={5.4}
        castShadow
        shadow-mapSize={[size, size]}
        shadow-bias={-0.0003}
        shadow-normalBias={0.035}
      />
    </>
  );
}

/** Interior fill: warm architectural downlights. */
function InteriorLights({ plan }: { plan: BuildingPlan }) {
  const xs = [5, plan.length * 0.45, plan.length * 0.85];
  return (
    <>
      {[0, 1].flatMap((f) =>
        xs.map((x, i) => (
          <pointLight
            key={`${f}${i}`}
            position={[x, f * H + 2.8, 0]}
            intensity={14}
            distance={16}
            decay={1.8}
            color="#ffe2ba"
          />
        )),
      )}
    </>
  );
}

/**
 * Shadow update policy: keep static shadows cached; refresh rapidly only when the lift moves,
 * and gently (1.5s) when idle, eliminating the 5Hz frame stutter.
 */
function ShadowThrottle() {
  const gl = useThree((s) => s.gl);
  const last = useRef(0);
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl]);
  useFrame(({ clock }) => {
    const moving = lift.busy();
    const interval = moving ? 0.08 : 1.5;
    if (clock.elapsedTime - last.current > interval) {
      last.current = clock.elapsedTime;
      gl.shadowMap.needsUpdate = true;
    }
  });
  return null;
}

/** Frame loop policy: sleep when nothing moves; 30 fps while agents/lift animate; walking self-drives. */
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

function World() {
  const plan = usePlan();
  const projects = useOffice((s) => s.snapshot?.projects);
  const mode = useOffice((s) => s.mode);
  const viewFloor = useOffice((s) => s.viewFloor);
  const quality = useOffice((s) => s.quality);
  const walking = mode === 'walk';
  const floors: [boolean, boolean] = walking ? [true, true] : [true, viewFloor === 1];
  const ceilings: [boolean, boolean] = walking ? [true, true] : [viewFloor === 1, false];
  const kit = useMemo(officeKit, []);
  const placements = useMemo(
    () => [0, 1].map((f) => plan.offices.filter((o) => o.floor === f).map((o) => ({ x: o.x, y: o.y, z: o.z, rotY: o.rotY }))),
    [plan],
  );
  const anyAgents = !!projects?.some((p) => p.claude.live > 0);

  return (
    <>
      <Building plan={plan} visibleFloors={floors} ceilings={ceilings} />
      <Core plan={plan} floors={floors} />
      <Lift floors={floors} />
      {!dbgOff('kits') && (
        <>
          <group visible={floors[0]}>
            <InstancedKit parts={kit} at={placements[0]} />
          </group>
          <group visible={floors[1]}>
            <InstancedKit parts={kit} at={placements[1]} />
          </group>
        </>
      )}
      {projects?.map((p) => {
        const spot = plan.byId.get(p.id);
        return spot ? <OfficeUnit key={p.id} project={p} spot={spot} visible={floors[spot.floor]} /> : null;
      })}
      <Sun plan={plan} quality={quality} />
      <hemisphereLight args={['#9cc4ff', '#4a3526', 0.14]} />
      {!dbgOff('lights') && <InteriorLights plan={plan} />}
      {walking ? <Player key="player" plan={plan} /> : <OverviewRig plan={plan} />}
      {!walking && <LabelProjector plan={plan} />}
      <FrameDriver animated={anyAgents && !walking} />
      <DebugExpose />
      <ShadowThrottle />
    </>
  );
}

export function Scene() {
  const quality = useOffice((s) => s.quality);
  const high = quality === 'high';
  return (
    <Canvas
      shadows={!dbgOff('shadow')}
      frameloop="demand"
      dpr={high ? Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 1.35) : 1}
      gl={{
        antialias: false,
        powerPreference: 'high-performance',
        stencil: false,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.06,
      }}
      camera={{ fov: 38, near: 0.1, far: 1500, position: [40, 40, 40] }}
    >
      <Sky distance={900} sunPosition={SUN_DIR.clone().multiplyScalar(100).toArray()} turbidity={6.5} rayleigh={2.0} mieCoefficient={0.005} mieDirectionalG={0.88} />
      {!dbgOff('env') && (
        <Environment resolution={256} frames={1} environmentIntensity={0.5}>
          <Sky sunPosition={SUN_DIR.clone().multiplyScalar(100).toArray()} turbidity={6.5} rayleigh={2.0} mieCoefficient={0.005} mieDirectionalG={0.88} />
          <Lightformer form="rect" intensity={2.2} color="#fff1dc" position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[20, 20, 1]} />
          <Lightformer form="rect" intensity={1.1} color="#ffa868" position={[-10, 2, -10]} scale={[10, 4, 1]} />
        </Environment>
      )}
      <fog attach="fog" args={['#e8be96', 110, 500]} />
      <World />
      {!dbgOff('post') && (
        <EffectComposer multisampling={0} enableNormalPass={false}>
          {high && (
            <N8AO
              aoRadius={1.1}
              distanceFalloff={0.7}
              intensity={2.2}
              halfRes
              quality="low"
            />
          )}
          <Bloom
            intensity={0.42}
            luminanceThreshold={1.1}
            luminanceSmoothing={0.35}
            mipmapBlur
          />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <BrightnessContrast contrast={0.08} brightness={0.02} />
          <HueSaturation saturation={0.08} />
          {high && <SMAA />}
          <Vignette offset={0.32} darkness={0.4} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
