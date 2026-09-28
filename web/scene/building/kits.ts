import * as THREE from 'three';
import { M } from './materials';

// Furniture "kits" in office-local space (origin = office centre on the floor, +z = towards the
// exterior window, the desk faces the door). A kit is rendered with one InstancedMesh per
// (geometry, material) pair across every office, so 50 offices cost the same draw calls as 1.

export interface KitPart {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  locals: THREE.Matrix4[];
  colors?: THREE.Color[];
  castShadow: boolean;
}

class KitBuilder {
  private parts = new Map<string, KitPart>();
  add(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: [number, number, number],
    rot: [number, number, number] = [0, 0, 0],
    scale: [number, number, number] = [1, 1, 1],
    opts: { color?: THREE.Color; shadow?: boolean } = {},
  ) {
    const key = `${geo.uuid}|${mat.uuid}`;
    let p = this.parts.get(key);
    if (!p) {
      p = { geo, mat, locals: [], castShadow: opts.shadow ?? true };
      this.parts.set(key, p);
    }
    p.locals.push(
      new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale)),
    );
    if (opts.color) (p.colors ??= []).push(opts.color);
    return this;
  }
  build() {
    return [...this.parts.values()];
  }
}

// Unit geometries, scaled per use.
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 20),
  cylLo: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
  cone: new THREE.CylinderGeometry(0.32, 0.5, 1, 20, 1, true),
  sphere: new THREE.SphereGeometry(0.5, 16, 12),
  foliage: new THREE.IcosahedronGeometry(0.5, 1),
  round: (() => {
    // rounded cushion: box with bevelled look via a squashed sphere-ish shape
    const g = new THREE.CapsuleGeometry(0.5, 1, 6, 12);
    g.rotateZ(Math.PI / 2);
    return g;
  })(),
};

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function officeChair(k: KitBuilder, x: number, z: number, rotY: number) {
  const m = M();
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const at = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  // five-star base
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const [px, pz] = at(Math.cos(a) * 0.17, Math.sin(a) * 0.17);
    k.add(G.box, m.blackMetal, [px, 0.07, pz], [0, -a + rotY, 0], [0.34, 0.035, 0.05]);
    const [wx, wz] = at(Math.cos(a) * 0.33, Math.sin(a) * 0.33);
    k.add(G.sphere, m.blackMetal, [wx, 0.035, wz], [0, 0, 0], [0.06, 0.06, 0.06], { shadow: false });
  }
  k.add(G.cylLo, m.chrome, [x, 0.27, z], [0, 0, 0], [0.05, 0.38, 0.05]);
  k.add(G.box, m.fabricCharcoal, [x, 0.49, z], [0, rotY, 0], [0.52, 0.08, 0.5]);
  const [bx, bz] = at(0, 0.27);
  k.add(G.box, m.fabricCharcoal, [bx, 0.9, bz], [0.12 * Math.cos(rotY), rotY, 0], [0.5, 0.64, 0.07]);
  const [hx, hz] = at(0, 0.3);
  k.add(G.box, m.fabricCharcoal, [hx, 1.28, hz], [0.12 * Math.cos(rotY), rotY, 0], [0.34, 0.16, 0.06]);
  for (const side of [-1, 1]) {
    const [ax, az] = at(side * 0.28, 0.02);
    k.add(G.box, m.blackMetal, [ax, 0.68, az], [0, rotY, 0], [0.05, 0.03, 0.3]);
    const [px, pz] = at(side * 0.28, 0.1);
    k.add(G.box, m.blackMetal, [px, 0.6, pz], [0, rotY, 0], [0.03, 0.16, 0.03]);
  }
}

function visitorChair(k: KitBuilder, x: number, z: number, rotY: number) {
  const m = M();
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const at = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  k.add(G.box, m.leather, [x, 0.46, z], [0, rotY, 0], [0.48, 0.07, 0.46]);
  const [bx, bz] = at(0, -0.22);
  k.add(G.box, m.leather, [bx, 0.74, bz], [-0.1 * Math.cos(rotY), rotY, 0], [0.46, 0.46, 0.06]);
  for (const [lx, lz] of [
    [-0.2, -0.2],
    [0.2, -0.2],
    [-0.2, 0.2],
    [0.2, 0.2],
  ]) {
    const [px, pz] = at(lx, lz);
    k.add(G.cylLo, m.chrome, [px, 0.21, pz], [0, 0, 0], [0.025, 0.42, 0.025]);
  }
}

function plant(k: KitBuilder, x: number, z: number, scale: number, seed: number, y = 0) {
  const m = M();
  const r = seeded(seed);
  k.add(G.cyl, m.potCeramic, [x, y + 0.28 * scale, z], [0, 0, 0], [0.5 * scale, 0.56 * scale, 0.5 * scale]);
  k.add(G.cyl, m.soil, [x, y + 0.55 * scale, z], [0, 0, 0], [0.44 * scale, 0.02, 0.44 * scale], { shadow: false });
  for (let i = 0; i < 6; i++) {
    const a = r() * Math.PI * 2;
    const d = r() * 0.18 * scale;
    k.add(
      G.foliage,
      i % 2 ? m.leaf : m.leafDark,
      [x + Math.cos(a) * d, y + (0.8 + r() * 0.8) * scale, z + Math.sin(a) * d],
      [r(), r(), r()],
      [(0.45 + r() * 0.3) * scale, (0.55 + r() * 0.4) * scale, (0.45 + r() * 0.3) * scale],
    );
  }
}

function sofa(k: KitBuilder, x: number, z: number, rotY: number, len: number, mat: THREE.Material) {
  const m = M();
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const at = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  k.add(G.box, mat, [x, 0.3, z], [0, rotY, 0], [len, 0.26, 0.85]);
  const [bx, bz] = at(0, -0.34);
  k.add(G.box, mat, [bx, 0.62, bz], [0, rotY, 0], [len, 0.5, 0.2]);
  for (const side of [-1, 1]) {
    const [ax, az] = at(side * (len / 2 - 0.08), 0);
    k.add(G.box, mat, [ax, 0.5, az], [0, rotY, 0], [0.16, 0.34, 0.85]);
  }
  const seats = Math.max(1, Math.round(len / 0.8));
  for (let i = 0; i < seats; i++) {
    const [cx, cz] = at(-len / 2 + 0.16 + ((len - 0.32) * (i + 0.5)) / seats, 0.06);
    k.add(G.box, mat, [cx, 0.47, cz], [0, rotY, 0], [(len - 0.36) / seats - 0.02, 0.1, 0.68]);
  }
  for (const [lx, lz] of [
    [-len / 2 + 0.1, -0.35],
    [len / 2 - 0.1, -0.35],
    [-len / 2 + 0.1, 0.35],
    [len / 2 - 0.1, 0.35],
  ]) {
    const [px, pz] = at(lx, lz);
    k.add(G.cylLo, m.blackMetal, [px, 0.08, pz], [0, 0, 0], [0.04, 0.16, 0.04], { shadow: false });
  }
}

/** Private office: executive desk, chairs, bookshelf, lounge corner, plants, lamp, art. */
export function officeKit(): KitPart[] {
  const m = M();
  const k = new KitBuilder();
  // rug + desk
  k.add(G.box, m.rug, [0.3, 0.004, 1.15], [0, 0, 0], [3.4, 0.008, 2.7], { shadow: false });
  k.add(G.box, m.walnut, [0.3, 0.745, 1.2], [0, 0, 0], [1.9, 0.05, 0.9]);
  for (const sx of [-0.9, 0.9]) k.add(G.box, m.blackMetal, [0.3 + sx, 0.36, 1.2], [0, 0, 0], [0.05, 0.72, 0.82]);
  k.add(G.box, m.walnut, [0.3, 0.48, 0.8], [0, 0, 0], [1.72, 0.42, 0.025]);
  // mug
  k.add(G.cyl, m.potCeramic, [0.98, 0.815, 1.42], [0, 0, 0], [0.08, 0.1, 0.08]);
  officeChair(k, 0.3, 1.86, 0);
  visitorChair(k, -0.25, 0.15, 0);
  visitorChair(k, 0.85, 0.15, 0);
  // bookshelf along +x wall
  const bx = 2.4;
  for (const z of [0.12, 2.08]) k.add(G.box, m.walnut, [bx, 0.95, z], [0, 0, 0], [0.36, 1.9, 0.04]);
  k.add(G.box, m.walnut, [bx + 0.17, 0.95, 1.1], [0, 0, 0], [0.02, 1.9, 1.96]);
  const r = seeded(5);
  const palette = ['#7c2d12', '#1e3a5f', '#e5e0d3', '#3f6212', '#1f2937', '#b45309', '#6b21a8', '#0f766e', '#be123c', '#d6d3d1'];
  for (let s = 0; s < 5; s++) {
    const y = 0.05 + s * 0.44;
    k.add(G.box, m.walnut, [bx, y, 1.1], [0, 0, 0], [0.36, 0.03, 1.96]);
    if (s === 4) continue;
    let z = 0.18;
    while (z < 2.0) {
      const w = 0.03 + r() * 0.04;
      const h = 0.24 + r() * 0.12;
      if (r() < 0.12) {
        z += 0.12; // gap / decor space
        continue;
      }
      k.add(G.box, m.book, [bx - 0.02, y + 0.015 + h / 2, z + w / 2], [0, 0, r() < 0.08 ? 0.18 : 0], [0.24, h, w], {
        color: new THREE.Color(palette[Math.floor(r() * palette.length)]),
      });
      z += w + 0.004;
    }
  }
  // credenza under the TV on the -x wall
  k.add(G.box, m.walnut, [-2.28, 0.3, 0.9], [0, 0, 0], [0.45, 0.6, 1.7]);
  k.add(G.box, m.blackMetal, [-2.28, 0.03, 0.9], [0, 0, 0], [0.4, 0.06, 1.6]);
  // lounge corner by the door: sofa + coffee table + art above
  sofa(k, 2.05, -1.35, -Math.PI / 2, 1.8, m.fabricTeal);
  k.add(G.cyl, m.walnut, [1.05, 0.4, -1.35], [0, 0, 0], [0.7, 0.04, 0.7]);
  k.add(G.cylLo, m.blackMetal, [1.05, 0.2, -1.35], [0, 0, 0], [0.05, 0.38, 0.05]);
  k.add(G.box, m.blackMetal, [2.56, 1.75, -1.35], [0, 0, 0], [0.03, 0.85, 1.25]);
  k.add(G.box, m.artCanvas, [2.54, 1.75, -1.35], [0, 0, 0], [0.01, 0.78, 1.18], { shadow: false, color: new THREE.Color('#c9b28a') });
  // plants + floor lamp
  plant(k, -2.05, 2.3, 1.15, 11);
  plant(k, 2.2, -2.4, 0.8, 17);
  k.add(G.cyl, m.blackMetal, [1.62, 0.015, 2.45], [0, 0, 0], [0.3, 0.03, 0.3]);
  k.add(G.cylLo, m.blackMetal, [1.62, 0.8, 2.45], [0, 0, 0], [0.025, 1.6, 0.025]);
  k.add(G.cone, m.lampShade, [1.62, 1.62, 2.45], [0, 0, 0], [0.42, 0.32, 0.42], { shadow: false });
  return k.build();
}

/** Open lounge used where a bay has no project (never a desk). */
export function loungeKit(): KitPart[] {
  const m = M();
  const k = new KitBuilder();
  k.add(G.box, m.rug, [0, 0.004, 0.6], [0, 0, 0], [3.6, 0.008, 3], { shadow: false });
  sofa(k, 0, 1.9, Math.PI, 2.4, m.leather);
  sofa(k, -1.6, 0.4, Math.PI / 2, 1, m.fabricMustard);
  sofa(k, 1.6, 0.4, -Math.PI / 2, 1, m.fabricMustard);
  k.add(G.cyl, m.walnut, [0, 0.38, 0.5], [0, 0, 0], [1.1, 0.05, 1.1]);
  k.add(G.cylLo, m.blackMetal, [0, 0.18, 0.5], [0, 0, 0], [0.08, 0.36, 0.08]);
  plant(k, -2.1, 2.3, 1.3, 23);
  plant(k, 2.1, 2.3, 1.1, 29);
  plant(k, 0, 0.5, 0.35, 31, 0.4);
  return k.build();
}

export function decorKit(): KitPart[] {
  const k = new KitBuilder();
  plant(k, 0, 0, 1, 3);
  return k.build();
}
