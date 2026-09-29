import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { R } from '../runtimeMats';
import { useOffice } from '../../store';
import { TIER } from '../../tier';
import { cutPlane } from './BakedBuilding';
import { CEIL, CORR, H, HZ, type BuildingPlan } from './plan';

// Everything outside the baked modules: site, trees, city, roof and the east-end closure.
// Lit by the environment + one unshadowed sun; trees get cheap baked-looking blob shadows.

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function canvasTex(w: number, h: number, paint: (g: CanvasRenderingContext2D, r: () => number) => void, repeat: [number, number]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d')!, rng(7));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  return t;
}

function useSiteMaterials() {
  return useMemo(() => {
    const grass = canvasTex(
      256,
      256,
      (g, r) => {
        g.fillStyle = '#4a6b33';
        g.fillRect(0, 0, 256, 256);
        for (let k = 0; k < 7000; k++) {
          const v = r();
          g.fillStyle = v < 0.5 ? `rgba(28,52,18,${0.2 + r() * 0.3})` : `rgba(120,150,62,${0.12 + r() * 0.22})`;
          g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 2 + r() * 4);
        }
      },
      [140, 140],
    );
    const paving = canvasTex(
      256,
      256,
      (g, r) => {
        g.fillStyle = '#b9b3a9';
        g.fillRect(0, 0, 256, 256);
        for (let y = 0; y < 256; y += 32)
          for (let x = 0; x < 256; x += 64) {
            const v = 170 + r() * 26;
            g.fillStyle = `rgb(${v},${v - 5},${v - 12})`;
            g.fillRect(x + ((y / 32) % 2) * 32 + 1, y + 1, 62, 30);
          }
      },
      [16, 8],
    );
    return {
      grass: new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }),
      paving: new THREE.MeshStandardMaterial({ map: paving, roughness: 0.85 }),
      asphalt: new THREE.MeshStandardMaterial({ color: '#2d3033', roughness: 0.9 }),
      bark: new THREE.MeshStandardMaterial({ color: '#4a3728', roughness: 0.95 }),
      leaves: new THREE.MeshStandardMaterial({ color: '#3f6d31', roughness: 0.85, flatShading: true }),
      leaves2: new THREE.MeshStandardMaterial({ color: '#2f5a28', roughness: 0.85, flatShading: true }),
      clad: new THREE.MeshStandardMaterial({ color: '#2c3439', roughness: 0.7, clippingPlanes: [cutPlane] }),
    };
  }, []);
}

function Trees({ spots, mats }: { spots: [number, number, number][]; mats: ReturnType<typeof useSiteMaterials> }) {
  const meshes = useMemo(() => {
    const trunkG = new THREE.CylinderGeometry(0.1, 0.17, 3, 7);
    trunkG.translate(0, 1.5, 0);
    const blobG = new THREE.IcosahedronGeometry(1, 1);
    const shadowG = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const blobs: [number, number, number, number][] = [
      [0, 3.6, 0, 1.4],
      [0.8, 3.1, 0.3, 0.9],
      [-0.7, 3.2, -0.4, 1.0],
      [0.1, 4.4, -0.2, 0.9],
    ];
    const n = spots.length;
    const trunk = new THREE.InstancedMesh(trunkG, mats.bark, n);
    const leafA = new THREE.InstancedMesh(blobG, mats.leaves, n * 2);
    const leafB = new THREE.InstancedMesh(blobG, mats.leaves2, n * 2);
    const shade = new THREE.InstancedMesh(shadowG, R().blob, n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    spots.forEach(([x, z, s], i) => {
      q.setFromEuler(new THREE.Euler(0, i * 1.7, 0));
      trunk.setMatrixAt(i, m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s, s)));
      shade.setMatrixAt(i, m.compose(new THREE.Vector3(x + 0.8, 0.02, z + 0.6), q, new THREE.Vector3(4.2 * s, 1, 4.2 * s)));
      blobs.forEach(([bx, by, bz, bs], j) => {
        const target = j % 2 ? leafB : leafA;
        const off = new THREE.Vector3(bx, by, bz).applyQuaternion(q).multiplyScalar(s);
        target.setMatrixAt(i * 2 + (j >> 1), m.compose(new THREE.Vector3(x, 0, z).add(off), q, new THREE.Vector3(bs * s, bs * 0.86 * s, bs * s)));
      });
    });
    for (const im of [trunk, leafA, leafB, shade]) {
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    }
    return [trunk, leafA, leafB, shade];
  }, [spots, mats]);
  useEffect(() => () => meshes.forEach((m) => m.dispose()), [meshes]);
  return (
    <>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </>
  );
}

function City({ center }: { center: number }) {
  const mesh = useMemo(() => {
    const r = rng(42);
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 512;
    const g = c.getContext('2d')!;
    g.fillStyle = '#28323b';
    g.fillRect(0, 0, 256, 512);
    for (let y = 8; y < 512; y += 16)
      for (let x = 6; x < 256; x += 12) {
        g.fillStyle = r() < 0.22 ? `rgba(255,${210 + r() * 30},${150 + r() * 60},${0.5 + r() * 0.4})` : `rgba(140,170,190,${0.35 + r() * 0.3})`;
        g.fillRect(x, y, 8, 10);
      }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.25, roughness: 0.35, metalness: 0.4 });
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const im = new THREE.InstancedMesh(geo, mat, 150);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 150; i++) {
      const a = r() * Math.PI * 2;
      const d = 140 + r() * 200;
      im.setMatrixAt(i, m.compose(new THREE.Vector3(center + Math.cos(a) * d, 0, Math.sin(a) * d), new THREE.Quaternion(), new THREE.Vector3(10 + r() * 22, 12 + r() * r() * 120, 10 + r() * 22)));
    }
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    return im;
  }, [center]);
  useEffect(() => () => mesh.dispose(), [mesh]);
  return <primitive object={mesh} />;
}

export function Exterior({ plan, roof }: { plan: BuildingPlan; roof: boolean }) {
  const mats = useSiteMaterials();
  const tier = TIER[useOffice((s) => s.tier)];
  const L = plan.length;
  const trees = useMemo(() => {
    const r = rng(9);
    const out: [number, number, number][] = [];
    for (let x = -4; x < L + 8; x += 6.5) out.push([x + r(), HZ + 5.5 + r(), 0.8 + r() * 0.5], [x + r(), -HZ - 5.5 - r(), 0.8 + r() * 0.5]);
    for (let z = -HZ; z <= HZ; z += 7) out.push([L + 7 + r(), z, 0.9 + r() * 0.4]);
    return tier.trees < 1 ? out.filter((_, i) => i % 2 === 0) : out;
  }, [L, tier.trees]);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[L / 2, -0.03, 0]} material={mats.grass}>
        <circleGeometry args={[300, 48]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[L / 2 - 3, -0.015, 0]} material={mats.paving}>
        <planeGeometry args={[L + 20, 2 * HZ + 8]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-16, -0.01, 0]} material={mats.asphalt}>
        <planeGeometry args={[9, 500]} />
      </mesh>
      <Trees spots={trees} mats={mats} />
      {tier.city && <City center={L / 2} />}
      {/* east end closure: cladding over the office bays + a window at the corridor end */}
      {[0, 1].map((f) => (
        <group key={f}>
          {[1, -1].map((s) => (
            <mesh key={s} material={mats.clad} position={[L + 0.03, f * H + H / 2 - 0.11, s * (CORR / 2 + (HZ - CORR / 2) / 2)]}>
              <boxGeometry args={[0.06, H, HZ - CORR / 2 + 0.06]} />
            </mesh>
          ))}
          <mesh material={mats.clad} position={[L + 0.03, f * H + CEIL + (H - CEIL) / 2, 0]}>
            <boxGeometry args={[0.06, H - CEIL, CORR]} />
          </mesh>
          <mesh material={R().glass} position={[L + 0.01, f * H + CEIL / 2, 0]} rotation={[0, Math.PI / 2, 0]} renderOrder={2}>
            <planeGeometry args={[CORR, CEIL]} />
          </mesh>
        </group>
      ))}
      {/* roof (only when walking — the overview is a cut-away dollhouse) */}
      <group visible={roof}>
        <mesh material={R().roof} position={[L / 2, 2 * H + 0.11, 0]}>
          <boxGeometry args={[L + 0.4, 0.22, 2 * HZ + 0.4]} />
        </mesh>
        {[1, -1].map((s) => (
          <mesh key={s} material={R().roof} position={[L / 2, 2 * H + 0.55, s * (HZ + 0.1)]}>
            <boxGeometry args={[L + 0.4, 0.7, 0.2]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
