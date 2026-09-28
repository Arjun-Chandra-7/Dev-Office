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
  const size = quality === 'high' ? 4096 : 1024;
  return (
    <>
      <primitive object={target} />
      <directionalLight
        key={size}
        ref={light}
        color="#ffc38a"
        intensity={5.2}
        castShadow
        shadow-mapSize={[size, size]}
        shadow-bias={-0.00025}
        shadow-normalBias={0.035}
      />
    </>
  );
}

/** Interior fill: a few fixed lights (constant count → no shader recompiles). */
function InteriorLights({ plan }: { plan: BuildingPlan }) {
  const xs = [4, plan.length * 0.4, plan.length * 0.8];
  return (
    <>
      {[0, 1].flatMap((f) =>
        xs.map((x, i) => <pointLight key={`${f}${i}`} position={[x, f * H + 2.85, 0]} intensity={16} distance={18} decay={1.7} color="#ffdcae" />),
      )}
    </>
  );
}

/**
 * The sun and the building are static, so re-rendering the 4K shadow map every frame is wasted
 * work (it was the single biggest cost: ~29 → ~80 fps). Refresh it ~5×/s instead, which is
 * plenty for agents' small motions and the lift.
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
    if (clock.elapsedTime - last.current > 0.2) {
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
      <hemisphereLight args={['#9cc4ff', '#4a3526', 0.12]} />
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
      dpr={high ? [1, 2] : 1}
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
      camera={{ fov: 38, near: 0.1, far: 1500, position: [40, 40, 40] }}
    >
      <Sky distance={900} sunPosition={SUN_DIR.clone().multiplyScalar(100).toArray()} turbidity={7} rayleigh={2.2} mieCoefficient={0.006} mieDirectionalG={0.86} />
      {!dbgOff('env') && <Environment resolution={256} frames={1} environmentIntensity={0.45}>
        <Sky sunPosition={SUN_DIR.clone().multiplyScalar(100).toArray()} turbidity={7} rayleigh={2.2} mieCoefficient={0.006} mieDirectionalG={0.86} />
        <Lightformer form="rect" intensity={2.5} color="#fff3e0" position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[20, 20, 1]} />
        <Lightformer form="rect" intensity={1.2} color="#ffb070" position={[-10, 2, -10]} scale={[10, 4, 1]} />
      </Environment>}
      <fog attach="fog" args={['#e7b88f', 120, 520]} />
      <World />
      {!dbgOff('post') && <EffectComposer multisampling={0} enableNormalPass={false}>
        {high ? <N8AO aoRadius={0.9} distanceFalloff={0.6} intensity={2.6} halfRes quality="medium" /> : <></>}
        <Bloom intensity={0.55} luminanceThreshold={1.0} luminanceSmoothing={0.25} mipmapBlur />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <HueSaturation saturation={0.1} />
        <BrightnessContrast contrast={0.1} />
        {high ? <SMAA /> : <></>}
        <Vignette offset={0.3} darkness={0.45} />
      </EffectComposer>}
    </Canvas>
  );
}
