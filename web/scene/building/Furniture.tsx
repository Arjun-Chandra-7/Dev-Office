import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { KitPart } from './kits';

export interface Placement {
  x: number;
  y: number;
  z: number;
  rotY: number;
}

/** Renders a kit at many placements: one InstancedMesh per kit part. */
export function InstancedKit({ parts, at }: { parts: KitPart[]; at: Placement[] }) {
  const meshes = useMemo(() => {
    const world = at.map((p) =>
      new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.rotY, 0)), new THREE.Vector3(1, 1, 1)),
    );
    return parts.map((part) => {
      const count = world.length * part.locals.length;
      const im = new THREE.InstancedMesh(part.geo, part.mat, Math.max(1, count));
      im.count = count;
      const tmp = new THREE.Matrix4();
      let i = 0;
      for (const w of world)
        part.locals.forEach((l, li) => {
          im.setMatrixAt(i, tmp.multiplyMatrices(w, l));
          if (part.colors) im.setColorAt(i, part.colors[li % part.colors.length]);
          i++;
        });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = part.castShadow;
      im.receiveShadow = true;
      if (count) im.computeBoundingSphere();
      return im;
    });
  }, [parts, at]);
  useEffect(() => () => meshes.forEach((m) => m.dispose()), [meshes]);
  return (
    <group>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
}
