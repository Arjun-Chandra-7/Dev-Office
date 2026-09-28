import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { boxWorldUV, floorShape, merge, place, rect } from './geom';
import { dbgOff } from '../debug';
import { M } from './materials';
import { CEIL, CORE, CORR, H, HZ, LIFT, OFF_W, SLAB, STAIRS, type BuildingPlan } from './plan';

const MULLION = 1.3; // curtain-wall module width

const TREE = {
  geo: new THREE.IcosahedronGeometry(1, 1),
  bark: new THREE.MeshStandardMaterial({ color: '#4a3728', roughness: 0.95 }),
  leaves: ['#2f5a28', '#3c6b30', '#4d7a36'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, flatShading: true })),
  blobs: [
    { p: [0, 3.6, 0] as [number, number, number], s: [1.4, 1.2, 1.4] as [number, number, number] },
    { p: [0.8, 3.1, 0.3] as [number, number, number], s: [0.9, 0.8, 0.9] as [number, number, number] },
    { p: [-0.7, 3.2, -0.4] as [number, number, number], s: [1.0, 0.85, 1.0] as [number, number, number] },
    { p: [0.1, 4.4, -0.2] as [number, number, number], s: [0.9, 0.8, 0.9] as [number, number, number] },
  ],
};

function useDispose(...geos: (THREE.BufferGeometry | null | undefined)[]) {
  useEffect(() => () => geos.forEach((g) => g?.dispose()), geos); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Floors, walls, glass and ceilings of one storey, merged into a handful of meshes. */
function Storey({ plan, floor, showCeiling }: { plan: BuildingPlan; floor: number; showCeiling: boolean }) {
  const m = M();
  const y0 = floor * H;
  const L = plan.length;

  const geos = useMemo(() => {
    // --- floor finishes ---
    const coreOuter: [number, number][] = [
      [0, -HZ],
      [CORE, -HZ],
      [CORE, -CORR / 2],
      [L, -CORR / 2],
      [L, CORR / 2],
      [CORE, CORR / 2],
      [CORE, HZ],
      [0, HZ],
    ];
    const holes = floor === 1 ? [rect(STAIRS.x0, STAIRS.z0, STAIRS.x1, STAIRS.z1), rect(LIFT.x0, LIFT.z0, LIFT.x1, LIFT.z1)] : [];
    const concrete = place(floorShape(coreOuter, holes, 3), 0, y0 + 0.001, 0);
    const oakParts: THREE.BufferGeometry[] = [];
    for (let c = 0; c < plan.cols; c++)
      for (const side of [1, -1]) {
        const x0 = CORE + c * OFF_W;
        const z0 = side === 1 ? CORR / 2 : -HZ;
        oakParts.push(place(floorShape(rect(x0, z0, x0 + OFF_W, z0 + (HZ - CORR / 2)), [], 3.4), 0, y0 + 0.002, 0));
      }
    const oak = merge(oakParts);

    // --- walls ---
    const solid: THREE.BufferGeometry[] = [];
    const glass: THREE.BufferGeometry[] = [];
    const frames: THREE.BufferGeometry[] = [];
    for (const w of plan.walls) {
      if (w.floor !== floor || w.kind === 'collider') continue;
      const sx = w.maxX - w.minX;
      const sz = w.maxZ - w.minZ;
      const cx = (w.minX + w.maxX) / 2;
      const cz = (w.minZ + w.maxZ) / 2;
      if (w.kind === 'solid') {
        solid.push(place(boxWorldUV(sx, w.height, sz, 2), cx, y0 + w.height / 2, cz));
      } else if (w.kind === 'glass' || w.kind === 'exterior') {
        const along = Math.max(sx, sz);
        const alongX = sx >= sz;
        glass.push(place(new THREE.BoxGeometry(alongX ? along : 0.02, w.height, alongX ? 0.02 : along), cx, y0 + w.height / 2, cz));
        // mullions + head/sill frames
        const n = Math.max(1, Math.round(along / MULLION));
        for (let i = 0; i <= n; i++) {
          const t = -along / 2 + (along * i) / n;
          frames.push(
            place(new THREE.BoxGeometry(alongX ? 0.05 : 0.08, w.height, alongX ? 0.08 : 0.05), alongX ? cx + t : cx, y0 + w.height / 2, alongX ? cz : cz + t),
          );
        }
        for (const hy of [0.03, w.height - 0.03])
          frames.push(place(new THREE.BoxGeometry(alongX ? along : 0.09, 0.06, alongX ? 0.09 : along), cx, y0 + hy, cz));
      } else if (w.kind === 'rail') {
        const along = Math.max(sx, sz);
        const alongX = sx >= sz;
        glass.push(place(new THREE.BoxGeometry(alongX ? along : 0.02, 1.0, alongX ? 0.02 : along), cx, y0 + 0.5, cz));
        frames.push(place(new THREE.BoxGeometry(alongX ? along : 0.06, 0.05, alongX ? 0.06 : along), cx, y0 + 1.05, cz));
      }
    }

    // --- ceiling + slab edge ---
    const ceilHoles = floor === 0 ? [rect(STAIRS.x0, STAIRS.z0, STAIRS.x1, STAIRS.z1), rect(LIFT.x0, LIFT.z0, LIFT.x1, LIFT.z1)] : [rect(LIFT.x0, LIFT.z0, LIFT.x1, LIFT.z1)];
    const ceiling = place(floorShape(rect(0, -HZ, L, HZ), ceilHoles, 3, true), 0, y0 + CEIL, 0);
    // spandrel band between ceiling and the next floor (seen from outside)
    const band: THREE.BufferGeometry[] = [];
    const bandH = H - CEIL;
    band.push(
      place(new THREE.BoxGeometry(L + 0.3, bandH, 0.3), L / 2, y0 + CEIL + bandH / 2, HZ + 0.05),
      place(new THREE.BoxGeometry(L + 0.3, bandH, 0.3), L / 2, y0 + CEIL + bandH / 2, -HZ - 0.05),
      place(new THREE.BoxGeometry(0.3, bandH, 2 * HZ + 0.3), -0.05, y0 + CEIL + bandH / 2, 0),
      place(new THREE.BoxGeometry(0.3, bandH, 2 * HZ + 0.3), L + 0.05, y0 + CEIL + bandH / 2, 0),
    );

    // ceiling light panels: corridor run + a panel per bay + lobby grid
    const panels: THREE.BufferGeometry[] = [];
    for (let x = 1.5; x < L - 0.5; x += 2.6) panels.push(place(new THREE.BoxGeometry(1.8, 0.02, 0.35), x, y0 + CEIL - 0.012, 0));
    for (let c = 0; c < plan.cols; c++)
      for (const side of [1, -1]) panels.push(place(new THREE.BoxGeometry(1.2, 0.02, 1.2), CORE + c * OFF_W + OFF_W / 2, y0 + CEIL - 0.012, side * (CORR / 2 + 2.4)));
    for (const [x, z] of [
      [2, -5.5],
      [5, -5.5],
      [2, 5.8],
      [5.6, -1],
      [9.6, 5.5],
    ])
      panels.push(place(new THREE.BoxGeometry(1.2, 0.02, 1.2), x, y0 + CEIL - 0.012, z));

    return {
      concrete,
      oak,
      solid: merge(solid),
      glass: merge(glass),
      frames: merge(frames),
      ceiling,
      band: merge(band),
      panels: merge(panels),
    };
  }, [plan, floor, y0, L]);
  useDispose(...Object.values(geos));

  return (
    <group>
      <mesh geometry={geos.concrete} material={m.concreteFloor} receiveShadow />
      {geos.oak && <mesh geometry={geos.oak} material={m.oakFloor} receiveShadow />}
      {geos.solid && <mesh geometry={geos.solid} material={m.plaster} castShadow receiveShadow />}
      {geos.frames && <mesh geometry={geos.frames} material={m.mullion} castShadow />}
      {geos.glass && !dbgOff('glass') && <mesh geometry={geos.glass} material={m.glass} renderOrder={2} />}
      {geos.band && <mesh geometry={geos.band} material={m.accentWall} castShadow receiveShadow />}
      <group visible={showCeiling}>
        <mesh geometry={geos.ceiling} material={m.ceiling} castShadow />
        {geos.panels && <mesh geometry={geos.panels} material={m.ceilingPanel} />}
      </group>
    </group>
  );
}

function Stairs() {
  const m = M();
  const geos = useMemo(() => {
    const steps = 20;
    const run = (STAIRS.x1 - STAIRS.x0) / steps;
    const rise = H / steps;
    const w = STAIRS.z1 - STAIRS.z0;
    const cz = (STAIRS.z0 + STAIRS.z1) / 2;
    const treads: THREE.BufferGeometry[] = [];
    for (let i = 0; i < steps; i++) treads.push(place(new THREE.BoxGeometry(run + 0.02, 0.05, w - 0.1), STAIRS.x0 + (i + 0.5) * run, (i + 1) * rise - 0.025, cz));
    // steel stringers: sloped plates along both sides
    const len = Math.hypot(STAIRS.x1 - STAIRS.x0, H);
    const ang = Math.atan2(H, STAIRS.x1 - STAIRS.x0);
    const stringers = [STAIRS.z0 + 0.04, STAIRS.z1 - 0.04].map((z) => place(new THREE.BoxGeometry(len, 0.3, 0.05), (STAIRS.x0 + STAIRS.x1) / 2, H / 2 - 0.12, z, 0, 0, ang));
    // glass balustrade + handrail on the open (south) side
    const glass = place(new THREE.BoxGeometry(len, 0.95, 0.02), (STAIRS.x0 + STAIRS.x1) / 2, H / 2 + 0.5, STAIRS.z0 + 0.02, 0, 0, ang);
    const rail = place(new THREE.BoxGeometry(len, 0.05, 0.06), (STAIRS.x0 + STAIRS.x1) / 2, H / 2 + 1.0, STAIRS.z0 + 0.02, 0, 0, ang);
    return { treads: merge(treads), stringers: merge([...stringers, rail]), glass };
  }, []);
  useDispose(geos.treads, geos.stringers, geos.glass);
  return (
    <group>
      {geos.treads && <mesh geometry={geos.treads} material={m.stairTread} castShadow receiveShadow />}
      {geos.stringers && <mesh geometry={geos.stringers} material={m.stairStringer} castShadow />}
      <mesh geometry={geos.glass} material={m.glass} renderOrder={2} />
      {/* solid wall beneath the flight (keeps ground-floor walkers out from under it) */}
      <mesh position={[(STAIRS.x0 + 0.4 + STAIRS.x1) / 2, H / 4, STAIRS.z0 - 0.02]} material={m.walnut} castShadow receiveShadow>
        <boxGeometry args={[STAIRS.x1 - STAIRS.x0 - 0.4, H / 2, 0.1]} />
      </mesh>
    </group>
  );
}

function Roof({ plan, visible }: { plan: BuildingPlan; visible: boolean }) {
  const m = M();
  const L = plan.length;
  return (
    <group visible={visible}>
      <mesh position={[L / 2, 2 * H - SLAB / 2, 0]} material={m.accentWall} castShadow receiveShadow>
        <boxGeometry args={[L + 0.6, SLAB, 2 * HZ + 0.6]} />
      </mesh>
      {/* parapet */}
      <mesh position={[L / 2, 2 * H + 0.45, HZ + 0.2]} material={m.accentWall} castShadow>
        <boxGeometry args={[L + 0.6, 0.9, 0.2]} />
      </mesh>
      <mesh position={[L / 2, 2 * H + 0.45, -HZ - 0.2]} material={m.accentWall} castShadow>
        <boxGeometry args={[L + 0.6, 0.9, 0.2]} />
      </mesh>
      {/* rooftop plant (HVAC) */}
      <mesh position={[L * 0.6, 2 * H + 0.6, -2]} material={m.aluminium} castShadow>
        <boxGeometry args={[3, 1.2, 2]} />
      </mesh>
    </group>
  );
}

/** Ground, plaza, road, trees and a low-poly city skyline around the building. */
function Surroundings({ plan }: { plan: BuildingPlan }) {
  const m = M();
  const L = plan.length;
  const city = useMemo(() => {
    const rnd = (() => {
      let s = 42;
      return () => ((s = (s * 16807) % 2147483647) / 2147483647);
    })();
    const boxes: { x: number; z: number; w: number; d: number; h: number; tone: number }[] = [];
    for (let i = 0; i < 140; i++) {
      const ang = rnd() * Math.PI * 2;
      const r = 70 + rnd() * 160;
      const x = L / 2 + Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      boxes.push({ x, z, w: 10 + rnd() * 22, d: 10 + rnd() * 22, h: 12 + rnd() * rnd() * 110, tone: rnd() });
    }
    // building façades: lit-window texture
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 512;
    const g = c.getContext('2d')!;
    g.fillStyle = '#1b2127';
    g.fillRect(0, 0, 256, 512);
    for (let y = 8; y < 512; y += 16)
      for (let x = 6; x < 256; x += 12) {
        const lit = rnd() < 0.28;
        g.fillStyle = lit ? `rgba(255,${200 + rnd() * 40},${140 + rnd() * 60},${0.55 + rnd() * 0.4})` : `rgba(90,110,130,${0.25 + rnd() * 0.25})`;
        g.fillRect(x, y, 8, 10);
      }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    const mat = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.55, roughness: 0.4, metalness: 0.3 });
    return { boxes, mat, tex: t };
  }, [L]);
  useEffect(() => () => {
    city.mat.dispose();
    city.tex.dispose();
  }, [city]);

  const inst = useMemo(() => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mesh = new THREE.InstancedMesh(geo, city.mat, city.boxes.length);
    const mtx = new THREE.Matrix4();
    city.boxes.forEach((b, i) => {
      mtx.compose(new THREE.Vector3(b.x, 0, b.z), new THREE.Quaternion(), new THREE.Vector3(b.w, b.h, b.d));
      mesh.setMatrixAt(i, mtx);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }, [city]);
  useEffect(() => () => inst.geometry.dispose(), [inst]);

  const trees = useMemo(() => {
    const out: [number, number][] = [];
    for (let x = -4; x < L + 6; x += 6) out.push([x, HZ + 5], [x, -HZ - 5]);
    return out;
  }, [L]);

  const treeMeshes = useMemo(() => {
    const trunkGeo = new THREE.CylinderGeometry(0.1, 0.17, 3, 7);
    const leafMat = new THREE.MeshStandardMaterial({ roughness: 0.82, flatShading: true });
    const leafColors = ['#2f5a28', '#3c6b30', '#4d7a36'].map((c) => new THREE.Color(c));

    const trunkMesh = new THREE.InstancedMesh(trunkGeo, TREE.bark, trees.length);
    trunkMesh.castShadow = true;
    trunkMesh.receiveShadow = false;

    const totalBlobs = trees.length * TREE.blobs.length;
    const leafMesh = new THREE.InstancedMesh(TREE.geo, leafMat, totalBlobs);
    leafMesh.castShadow = true;
    leafMesh.receiveShadow = false;

    const mtx = new THREE.Matrix4();
    const rot = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();

    let blobIdx = 0;
    trees.forEach(([x, z], i) => {
      const sc = 0.8 + ((i * 37) % 10) / 20;
      const rotY = i * 1.7;
      rot.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);

      pos.set(x, 1.5 * sc, z);
      scl.set(sc, sc, sc);
      mtx.compose(pos, rot, scl);
      trunkMesh.setMatrixAt(i, mtx);

      TREE.blobs.forEach((b, j) => {
        const bp = new THREE.Vector3(...b.p).applyQuaternion(rot).multiplyScalar(sc);
        pos.set(x + bp.x, b.p[1] * sc, z + bp.z);
        scl.set(b.s[0] * sc, b.s[1] * sc, b.s[2] * sc);
        mtx.compose(pos, rot, scl);
        leafMesh.setMatrixAt(blobIdx, mtx);
        leafMesh.setColorAt(blobIdx, leafColors[(i + j) % leafColors.length]);
        blobIdx++;
      });
    });

    trunkMesh.instanceMatrix.needsUpdate = true;
    leafMesh.instanceMatrix.needsUpdate = true;
    if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;

    return { trunkMesh, leafMesh, trunkGeo, leafMat };
  }, [trees]);
  useEffect(() => () => {
    treeMeshes.trunkMesh.dispose();
    treeMeshes.leafMesh.dispose();
    treeMeshes.trunkGeo.dispose();
    treeMeshes.leafMat.dispose();
  }, [treeMeshes]);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[L / 2, -0.02, 0]} material={m.grass} receiveShadow>
        <circleGeometry args={[260, 48]} />
      </mesh>
      {/* plaza */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[L / 2 - 4, -0.01, 0]} material={m.pavement} receiveShadow>
        <planeGeometry args={[L + 22, 2 * HZ + 10]} />
      </mesh>
      {/* road */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-16, -0.005, 0]} material={m.asphalt} receiveShadow>
        <planeGeometry args={[9, 400]} />
      </mesh>
      <primitive object={treeMeshes.trunkMesh} />
      <primitive object={treeMeshes.leafMesh} />
      {!dbgOff('city') && <primitive object={inst} />}
    </group>
  );
}

export function Building({ plan, visibleFloors, ceilings }: { plan: BuildingPlan; visibleFloors: [boolean, boolean]; ceilings: [boolean, boolean] }) {
  return (
    <group>
      <group visible={visibleFloors[0]}>
        <Storey plan={plan} floor={0} showCeiling={ceilings[0]} />
        <Stairs />
      </group>
      <group visible={visibleFloors[1]}>
        <Storey plan={plan} floor={1} showCeiling={ceilings[1]} />
      </group>
      <Roof plan={plan} visible={visibleFloors[1] && ceilings[1]} />
      <Surroundings plan={plan} />
    </group>
  );
}
