import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Box whose UVs are in metres (divided by `tile`), so textures keep a constant scale. */
export function boxWorldUV(w: number, h: number, d: number, tile = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // face order: +x, -x, +y, -y, +z, -z (4 vertices each)
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++)
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
    }
  uv.needsUpdate = true;
  return g;
}

/** Translate/rotate a geometry in place and return it (for merging). */
export function place(g: THREE.BufferGeometry, x: number, y: number, z: number, rotY = 0, rotX = 0, rotZ = 0) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ)),
    new THREE.Vector3(1, 1, 1),
  );
  g.applyMatrix4(m);
  return g;
}

export function merge(parts: THREE.BufferGeometry[]) {
  if (!parts.length) return null;
  const prepared = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  for (const p of prepared) {
    // mergeGeometries requires identical attribute sets
    for (const name of Object.keys(p.attributes)) if (!['position', 'normal', 'uv'].includes(name)) p.deleteAttribute(name);
  }
  return mergeGeometries(prepared, false);
}

/** Flat floor polygon (outer + holes) in world XZ with metre UVs. Points are [x, z]. */
export function floorShape(outer: [number, number][], holes: [number, number][][] = [], tile = 1, facingDown = false) {
  const toV = (p: [number, number]) => new THREE.Vector2(p[0], facingDown ? p[1] : -p[1]);
  const shape = new THREE.Shape(outer.map(toV));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(toV)));
  const g = new THREE.ShapeGeometry(shape);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / tile, uv.getY(i) / tile);
  g.rotateX(facingDown ? Math.PI / 2 : -Math.PI / 2);
  return g;
}

export const rect = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];
