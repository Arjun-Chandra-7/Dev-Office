import { useGLTF, useTexture } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useOffice } from '../../store';
import { R } from '../runtimeMats';
import { TIER } from '../../tier';
import { CORE, H, OFF_W, type BuildingPlan } from './plan';

// The building is a set of Blender-baked modules (see blender/build_kit.py): every static surface
// carries its path-traced lighting in a texture atlas and renders unlit. Offices, lounges and
// corridor segments are instanced, so the whole building is a couple of dozen draw calls.

export const MODULES = ['office', 'lounge', 'corridor', 'core0', 'core1'] as const;
type ModuleName = (typeof MODULES)[number];
const url = (f: string) => `/kit/${f}`;

/** Shared clipping plane for the dollhouse overview (cuts away the ceiling of the viewed floor). */
export const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);
const CLIP = [cutPlane];

interface KitModule {
  parts: { name: string; geometry: THREE.BufferGeometry; material: THREE.Material }[];
  glass: THREE.BufferGeometry | null;
}

function bakedMaterial(tex: THREE.Texture) {
  tex.flipY = false; // glTF UV convention
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, clippingPlanes: CLIP });
}

/**
 * Meshopt/KHR_mesh_quantization stores positions as normalised int16 with the scale on the node.
 * Baking the node transform into such an attribute would clamp every value to ±1, so expand
 * attributes to float32 first.
 */
function toFloat(g: THREE.BufferGeometry) {
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name) as THREE.BufferAttribute;
    if (a.array instanceof Float32Array && !a.normalized) continue;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  return g;
}

/** Load one module: baked meshes (world-space geometry) + merged glass panes. */
function useModule(name: ModuleName): KitModule {
  const gltf = useGLTF(url(`${name}.glb`), false, true);
  const sfx = TIER[useOffice((s) => s.tier)].tex; // 4096 / 2048 / 1024 atlases
  const [arch, props] = useTexture([url(`${name}_arch${sfx}.webp`), url(`${name}_props${sfx}.webp`)].slice(0, name === 'corridor' ? 1 : 2));
  return useMemo(() => {
    gltf.scene.updateMatrixWorld(true);
    const parts: KitModule['parts'] = [];
    const glass: THREE.BufferGeometry[] = [];
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = toFloat(mesh.geometry.clone()).applyMatrix4(mesh.matrixWorld);
      if (mesh.name.startsWith('glass')) {
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
        glass.push(g.index ? g.toNonIndexed() : g);
      } else if (mesh.name.endsWith('_arch') && arch) parts.push({ name: mesh.name, geometry: g, material: bakedMaterial(arch) });
      else if (mesh.name.endsWith('_props') && props) parts.push({ name: mesh.name, geometry: g, material: bakedMaterial(props) });
    });
    return { parts, glass: glass.length ? mergeGeometries(glass, false) : null };
  }, [gltf, arch, props]);
}

interface Place {
  x: number;
  y: number;
  z: number;
  rotY: number;
}

/** One module rendered at many places: one InstancedMesh per baked part (+ one for glass). */
function Instanced({ mod, at, glassMat }: { mod: KitModule; at: Place[]; glassMat: THREE.Material }) {
  const meshes = useMemo(() => {
    if (!at.length) return [];
    const mats = at.map((p) =>
      new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.rotY, 0)), new THREE.Vector3(1, 1, 1)),
    );
    const make = (g: THREE.BufferGeometry, m: THREE.Material, order = 0) => {
      const im = new THREE.InstancedMesh(g, m, mats.length);
      mats.forEach((mx, i) => im.setMatrixAt(i, mx));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.renderOrder = order;
      return im;
    };
    const out = mod.parts.map((p) => make(p.geometry, p.material));
    if (mod.glass) out.push(make(mod.glass, glassMat, 2));
    return out;
  }, [mod, at, glassMat]);
  useEffect(() => () => meshes.forEach((m) => m.dispose()), [meshes]);
  return (
    <group>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
}

function Single({ mod, y, glassMat }: { mod: KitModule; y: number; glassMat: THREE.Material }) {
  return <Instanced mod={mod} at={useMemo(() => [{ x: 0, y, z: 0, rotY: 0 }], [y])} glassMat={glassMat} />;
}

export function BakedBuilding({ plan, floors }: { plan: BuildingPlan; floors: [boolean, boolean] }) {
  const office = useModule('office');
  const lounge = useModule('lounge');
  const corridor = useModule('corridor');
  const core0 = useModule('core0');
  const core1 = useModule('core1');
  const glassMat = useMemo(() => {
    const g = R().glass.clone();
    g.clippingPlanes = CLIP;
    return g;
  }, []);

  useEffect(() => {
    useOffice.setState({ ready: true });
  }, []);

  const place = useMemo(() => {
    const byFloor = (f: number) => ({
      offices: plan.offices.filter((o) => o.floor === f).map((o) => ({ x: o.x, y: o.y, z: o.z, rotY: o.rotY })),
      lounges: plan.empty.filter((e) => e.floor === f).map((e) => ({ x: e.x, y: e.y, z: e.z, rotY: e.rotY })),
      corridor: Array.from({ length: plan.cols }, (_, c) => ({ x: CORE + c * OFF_W + OFF_W / 2, y: f * H, z: 0, rotY: 0 })),
    });
    return [byFloor(0), byFloor(1)];
  }, [plan]);

  return (
    <group>
      {[0, 1].map((f) => (
        <group key={f} visible={floors[f]}>
          <Single mod={f === 0 ? core0 : core1} y={f * H} glassMat={glassMat} />
          <Instanced mod={office} at={place[f].offices} glassMat={glassMat} />
          <Instanced mod={lounge} at={place[f].lounges} glassMat={glassMat} />
          <Instanced mod={corridor} at={place[f].corridor} glassMat={glassMat} />
        </group>
      ))}
    </group>
  );
}

for (const m of MODULES) useGLTF.preload(url(`${m}.glb`), false, true);
