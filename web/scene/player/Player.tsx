import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useOffice } from '../../store';
import { openProject } from '../actions';
import { lift } from '../building/Lift';
import { DOOR_LOCAL_X, H, hits, inLift, inStairs, OFF_D, stairsY, toWorld, type Box, type BuildingPlan } from '../building/plan';
import { interactables, type Interactable } from '../interact';
import { currentPlan } from '../usePlan';

// First-person walking: pointer-lock mouse look, WASD, collisions, stairs and the lift.

export const player = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, floor: 0 };

const EYE = 1.64;
const RADIUS = 0.28;
const WALK = 3.0;
const SPRINT = 5.6;
const REACH = 3.2;
const keys = new Set<string>();
let actRef: () => void = () => undefined;

// Dev-only automation hook (stripped from production builds): lets tests drive the same key
// state the pointer-lock controls use, since automated browsers cannot take pointer lock.
if (import.meta.env.DEV) (window as any).__walk = { player, keys, lift, act: () => actRef(), plan: () => currentPlan };

function blockers(plan: BuildingPlan, floor: number): Box[] {
  const out: Box[] = [];
  for (const w of plan.walls) if (w.floor === floor) out.push(w);
  for (const b of plan.furnitureBoxes) if (b.floor === floor) out.push(b);
  out.push(...lift.blockers(floor));
  return out;
}

function collides(x: number, z: number, boxes: Box[]) {
  for (const b of boxes) if (hits(x, z, RADIUS, b)) return true;
  return false;
}

export function spawnFor(plan: BuildingPlan, projectId: string | null) {
  const spot = projectId ? plan.byId.get(projectId) : undefined;
  if (spot) {
    // stand in the corridor in front of the office door, facing it
    const [dx, dz] = toWorld(spot, DOOR_LOCAL_X, -OFF_D / 2 - 1.0);
    return { x: dx, z: dz, y: spot.y, yaw: spot.side === 1 ? Math.PI : 0 };
  }
  return { x: plan.spawn.x, z: plan.spawn.z, y: 0, yaw: plan.spawn.yaw };
}

export function Player({ plan }: { plan: BuildingPlan }) {
  const { camera, gl } = useThree();
  const aim = useRef<{ obj: THREE.Object3D; info: Interactable } | null>(null);
  const ray = useRef(new THREE.Raycaster());
  const bob = useRef(0);

  // spawn once on entering walk mode
  useEffect(() => {
    const s = spawnFor(plan, useOffice.getState().selectedId);
    Object.assign(player, { x: s.x, z: s.z, y: s.y, yaw: s.yaw, pitch: 0, floor: s.y > H / 2 ? 1 : 0 });
    (camera as THREE.PerspectiveCamera).fov = 70;
    camera.updateProjectionMatrix();
    return () => {
      (camera as THREE.PerspectiveCamera).fov = 38;
      camera.updateProjectionMatrix();
      keys.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = gl.domElement;
    const act = () => {
      const a = aim.current;
      if (!a) return;
      if (a.info.kind === 'laptop') openProject(a.info.projectId, true);
      else if (a.info.kind === 'lift-call') lift.request(a.info.floor);
      else if (a.info.kind === 'lift-panel') lift.request(lift.floor === 0 ? 1 : 0);
    };
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== el) return;
      player.yaw -= e.movementX * 0.0022;
      player.pitch = Math.max(-1.35, Math.min(1.35, player.pitch - e.movementY * 0.0022));
    };
    const onDown = (e: KeyboardEvent) => {
      if (document.pointerLockElement !== el) return;
      keys.add(e.code);
      if (e.code === 'KeyE') act();
    };
    const onUp = (e: KeyboardEvent) => keys.delete(e.code);
    const onClick = () => {
      const s = useOffice.getState();
      if (s.promptFor || s.paletteOpen) return;
      if (document.pointerLockElement !== el) el.requestPointerLock();
      else act();
    };
    const onLock = () => {
      const locked = document.pointerLockElement === el;
      useOffice.setState({ pointerLocked: locked });
      if (!locked) keys.clear();
    };
    const onBlur = () => keys.clear();
    actRef = act;
    document.addEventListener('mousemove', onMove);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    el.addEventListener('click', onClick);
    document.addEventListener('pointerlockchange', onLock);
    return () => {
      document.removeEventListener('mousemove', onMove);
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      el.removeEventListener('click', onClick);
      document.removeEventListener('pointerlockchange', onLock);
      if (document.pointerLockElement === el) document.exitPointerLock();
      useOffice.setState({ pointerLocked: false, hint: null });
    };
  }, [gl]);

  useFrame((state, dt0) => {
    const dt = Math.min(dt0, 0.05);
    state.invalidate(); // walking needs a continuous frame loop

    // --- movement ---
    const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const strafe = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? SPRINT : WALK;
    let vx = 0;
    let vz = 0;
    if (fwd || strafe) {
      const len = Math.hypot(fwd, strafe);
      const sy = Math.sin(player.yaw);
      const cy = Math.cos(player.yaw);
      // camera forward = (-sin yaw, -cos yaw); right = (cos yaw, -sin yaw)
      vx = ((-sy * fwd + cy * strafe) / len) * speed * dt;
      vz = ((-cy * fwd - sy * strafe) / len) * speed * dt;
    }
    const floor = player.y > H / 2 ? 1 : 0;
    const boxes = blockers(plan, floor);
    // resolve per axis so you slide along walls; sub-step to never tunnel through thin glass
    const steps = Math.ceil(Math.max(Math.abs(vx), Math.abs(vz)) / 0.08) || 1;
    for (let i = 0; i < steps; i++) {
      const nx = player.x + vx / steps;
      if (!collides(nx, player.z, boxes)) player.x = nx;
      const nz = player.z + vz / steps;
      if (!collides(player.x, nz, boxes)) player.z = nz;
    }
    // keep within the grounds
    const cx = plan.length / 2;
    const d = Math.hypot(player.x - cx, player.z);
    if (d > 70) {
      player.x = cx + ((player.x - cx) / d) * 70;
      player.z = (player.z / d) * 70;
    }

    // --- vertical: stairs ramp, lift cabin, or the current floor ---
    let targetY: number;
    if (inStairs(player.x, player.z)) targetY = stairsY(player.x);
    else if (inLift(player.x, player.z) && Math.abs(player.y - lift.y) < 1.2) targetY = lift.y;
    else targetY = floor * H;
    player.y = inLift(player.x, player.z) ? targetY : THREE.MathUtils.lerp(player.y, targetY, Math.min(1, dt * 14));
    player.floor = player.y > H / 2 ? 1 : 0;

    const moving = fwd !== 0 || strafe !== 0;
    bob.current += moving ? dt * (speed === SPRINT ? 13 : 9) : 0;
    const bobY = moving ? Math.sin(bob.current) * 0.035 : 0;
    camera.position.set(player.x, player.y + EYE + bobY, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');

    // --- aim: what is under the crosshair ---
    ray.current.setFromCamera(new THREE.Vector2(0, 0), camera);
    ray.current.far = REACH;
    const hitsList = ray.current.intersectObjects([...interactables.keys()], false);
    const top = hitsList[0];
    const info = top ? interactables.get(top.object) ?? null : null;
    aim.current = top && info ? { obj: top.object, info } : null;
    const hint = info ? info.label : null;
    if (useOffice.getState().hint !== hint) useOffice.setState({ hint });
  });

  return null;
}
