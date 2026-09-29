import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useOffice } from '../../store';
import { openProject } from '../actions';
import { lift } from '../building/Lift';
import { DOOR_LOCAL_X, H, hits, inLift, inStairs, LIFT, OFF_D, stairsY, toWorld, type Box, type BuildingPlan } from '../building/plan';
import { cachedInteractablesList, interactables, type Interactable } from '../interact';
import { currentPlan } from '../usePlan';

// First person: pointer-lock mouse look, WASD, sprint, jump, collisions, stairs and the lift.

export const player = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, floor: 0 };

const EYE = 1.64;
const RADIUS = 0.28;
const WALK = 3.2;
const SPRINT = 6.4;
const JUMP_V = 4.4;
const GRAVITY = 13;
const REACH = 3.2;
const FOV = 70;
const keys = new Set<string>();
let actRef: () => void = () => undefined;

// Dev-only automation hook (stripped from production builds): automated browsers can't take
// pointer lock, so tests drive the same key state the controls use.
if (import.meta.env.DEV) (window as any).__walk = { player, keys, lift, act: () => actRef(), plan: () => currentPlan };

let cachedPlan: BuildingPlan | null = null;
let boxes0: Box[] = [];
let boxes1: Box[] = [];
let solid0: Box[] = [];
let solid1: Box[] = [];

function staticBlockers(plan: BuildingPlan, floor: number): Box[] {
  if (cachedPlan !== plan) {
    cachedPlan = plan;
    boxes0 = [];
    boxes1 = [];
    solid0 = [];
    solid1 = [];
    for (const w of plan.walls) {
      (w.floor === 0 ? boxes0 : boxes1).push(w);
      if (w.kind === 'solid') (w.floor === 0 ? solid0 : solid1).push(w);
    }
    for (const b of plan.furnitureBoxes) (b.floor === 0 ? boxes0 : boxes1).push(b);
  }
  return floor === 1 ? boxes1 : boxes0;
}

function collides(x: number, z: number, boxes: Box[]) {
  for (const b of boxes) if (hits(x, z, RADIUS, b)) return true;
  return false;
}

/** The lift lobby in front of the landing doors: standing here summons the lift. */
function inLiftLobby(x: number, z: number) {
  return x > LIFT.doorX0 - 0.6 && x < LIFT.doorX1 + 0.6 && z > LIFT.z1 && z < LIFT.z1 + 1.6;
}

export function spawnFor(plan: BuildingPlan, projectId: string | null) {
  const spot = projectId ? plan.byId.get(projectId) : undefined;
  if (spot) {
    const [dx, dz] = toWorld(spot, DOOR_LOCAL_X, -OFF_D / 2 - 1.0);
    return { x: dx, z: dz, y: spot.y, yaw: spot.side === 1 ? Math.PI : 0 };
  }
  // just inside the entrance, facing the lobby (and the About wall)
  return { x: plan.spawn.x, z: plan.spawn.z, y: 0, yaw: plan.spawn.yaw };
}

export function Player({ plan }: { plan: BuildingPlan }) {
  const { camera, gl } = useThree();
  const aim = useRef<{ obj: THREE.Object3D; info: Interactable } | null>(null);
  const ray = useRef(new THREE.Raycaster());
  const center = useRef(new THREE.Vector2(0, 0));
  const bob = useRef(0);
  const jump = useRef({ h: 0, v: 0 });

  useEffect(() => {
    const s = spawnFor(plan, useOffice.getState().selectedId);
    Object.assign(player, { x: s.x, z: s.z, y: s.y, yaw: s.yaw, pitch: 0, floor: s.y > H / 2 ? 1 : 0 });
    jump.current = { h: 0, v: 0 };
    (camera as THREE.PerspectiveCamera).fov = FOV;
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
    const other = () => (lift.floor === 0 ? 1 : 0);
    const act = () => {
      // riding the lift needs no aiming: E anywhere inside the cabin
      if (inLift(player.x, player.z) && !lift.busy()) return lift.request(other());
      const a = aim.current;
      if (!a) return;
      if (a.info.kind === 'laptop') openProject(a.info.projectId, true);
      else if (a.info.kind === 'lift-call') lift.request(a.info.floor);
      else if (a.info.kind === 'lift-panel') lift.request(other());
      else if (a.info.kind === 'about') {
        useOffice.getState().setAbout(true);
        if (document.pointerLockElement) document.exitPointerLock();
      }
    };
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== el) return;
      player.yaw -= e.movementX * 0.0022;
      player.pitch = Math.max(-1.35, Math.min(1.35, player.pitch - e.movementY * 0.0022));
    };
    const onDown = (e: KeyboardEvent) => {
      if (document.pointerLockElement !== el) return;
      keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
      if (e.code === 'KeyE') act();
      if (inLift(player.x, player.z) && (e.code === 'Digit1' || e.code === 'Digit2')) lift.request(e.code === 'Digit1' ? 0 : 1);
    };
    const onUp = (e: KeyboardEvent) => keys.delete(e.code);
    const onClick = () => {
      const s = useOffice.getState();
      if (s.paletteOpen || s.aboutOpen) return;
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

    // --- horizontal movement ---
    const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const strafe = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const sprinting = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && fwd > 0;
    const speed = sprinting ? SPRINT : WALK;
    let vx = 0;
    let vz = 0;
    if (fwd || strafe) {
      const len = Math.hypot(fwd, strafe);
      const sy = Math.sin(player.yaw);
      const cy = Math.cos(player.yaw);
      vx = ((-sy * fwd + cy * strafe) / len) * speed * dt;
      vz = ((-cy * fwd - sy * strafe) / len) * speed * dt;
    }
    const floor = player.y > H / 2 ? 1 : 0;
    const staticList = staticBlockers(plan, floor);
    const liftList = lift.blockers(floor);
    const boxes = liftList.length ? [...staticList, ...liftList] : staticList;
    const steps = Math.ceil(Math.max(Math.abs(vx), Math.abs(vz)) / 0.08) || 1;
    for (let i = 0; i < steps; i++) {
      const nx = player.x + vx / steps;
      if (!collides(nx, player.z, boxes)) player.x = nx;
      const nz = player.z + vz / steps;
      if (!collides(player.x, nz, boxes)) player.z = nz;
    }
    const cx = plan.length / 2;
    const d = Math.hypot(player.x - cx, player.z);
    if (d > 70) {
      player.x = cx + ((player.x - cx) / d) * 70;
      player.z = (player.z / d) * 70;
    }

    // --- ground height: stairs ramp, lift cabin, or the floor ---
    const riding = inLift(player.x, player.z);
    let ground: number;
    if (inStairs(player.x, player.z)) ground = stairsY(player.x);
    else if (riding) ground = lift.y;
    else ground = floor * H;
    player.y = riding ? ground : THREE.MathUtils.lerp(player.y, ground, Math.min(1, dt * 14));
    player.floor = player.y > H / 2 ? 1 : 0;

    // --- jump ---
    const j = jump.current;
    if (keys.has('Space') && j.h <= 0.0001 && !riding) j.v = JUMP_V;
    if (j.v !== 0 || j.h > 0) {
      j.v -= GRAVITY * dt;
      j.h = Math.max(0, j.h + j.v * dt);
      if (j.h === 0 && j.v < 0) j.v = 0;
    }

    // --- lift: standing in the lobby summons it ---
    if (inLiftLobby(player.x, player.z) && !lift.busy() && lift.floor !== player.floor) lift.request(player.floor);

    // --- camera ---
    const moving = fwd !== 0 || strafe !== 0;
    bob.current += moving && j.h === 0 ? dt * (sprinting ? 14 : 9) : 0;
    const bobY = moving && j.h === 0 ? Math.sin(bob.current) * (sprinting ? 0.05 : 0.035) : 0;
    camera.position.set(player.x, player.y + EYE + bobY + j.h, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    const cam = camera as THREE.PerspectiveCamera;
    const targetFov = sprinting && moving ? FOV + 7 : FOV;
    if (Math.abs(cam.fov - targetFov) > 0.05) {
      cam.fov = THREE.MathUtils.lerp(cam.fov, targetFov, Math.min(1, dt * 8));
      cam.updateProjectionMatrix();
    }

    // --- aim ---
    ray.current.setFromCamera(center.current, camera);
    ray.current.far = REACH;
    const top = ray.current.intersectObjects(cachedInteractablesList, false)[0];
    let info = top ? interactables.get(top.object) ?? null : null;
    if (top && info?.kind === 'laptop') {
      // never target a laptop through a solid wall
      const p = camera.position;
      const q = top.point;
      const minX = Math.min(p.x, q.x);
      const maxX = Math.max(p.x, q.x);
      const minZ = Math.min(p.z, q.z);
      const maxZ = Math.max(p.z, q.z);
      for (const b of player.floor === 1 ? solid1 : solid0)
        if (b.maxX > minX && b.minX < maxX && b.maxZ > minZ && b.minZ < maxZ) {
          info = null;
          break;
        }
    }
    aim.current = top && info ? { obj: top.object, info } : null;
    let hint = info ? info.label : null;
    if (riding) hint = lift.busy() ? 'Lift moving…' : `Ride to ${lift.floor === 0 ? 'Level 1' : 'the ground floor'}`;
    else if (!hint && inLiftLobby(player.x, player.z) && lift.busy()) hint = 'Lift on its way…';
    if (useOffice.getState().hint !== hint) useOffice.setState({ hint });
  });

  return null;
}
