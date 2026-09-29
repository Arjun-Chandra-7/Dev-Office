import { useTexture } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { AboutInfo } from '../../../shared/types';
import { register } from '../interact';
import { R } from '../runtimeMats';
import { LIFT } from './plan';

/** Portrait + name on the lobby wall facing the entrance (click / E opens the About card). */
export function AboutWall({ about }: { about: AboutInfo }) {
  const photo = useTexture(about.photo);
  const text = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 512;
    const g = c.getContext('2d')!;
    g.fillStyle = '#0d1114';
    g.fillRect(0, 0, 1024, 512);
    g.fillStyle = '#f3f6f7';
    g.font = '800 92px "Inter", system-ui, sans-serif';
    g.fillText(about.name, 60, 190);
    g.fillStyle = '#67e8f9';
    g.font = '600 38px "JetBrains Mono", monospace';
    g.fillText(about.tagline, 62, 260);
    g.fillStyle = '#8b98a2';
    g.font = '500 30px "Inter", system-ui, sans-serif';
    g.fillText('Welcome — every office in this building is one of my projects.', 62, 360);
    g.fillText('Walk up to a laptop and press E to read about it.', 62, 405);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [about]);
  useEffect(() => () => text.dispose(), [text]);
  photo.colorSpace = THREE.SRGBColorSpace;
  const hit = useMemo(() => new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.8, 2.4), new THREE.MeshBasicMaterial({ visible: false })), []);
  useEffect(() => register(hit, { kind: 'about', label: `About ${about.name}` }), [hit, about.name]);

  // lift shaft west face (x = LIFT.x0 - 0.07), facing the entrance (-x)
  const x = LIFT.x0 - 0.075;
  const zc = (LIFT.z0 + LIFT.z1) / 2;
  return (
    <group position={[x, 0, zc]} rotation={[0, -Math.PI / 2, 0]}>
      <mesh material={R().blackMetal} position={[0, 1.65, -0.005]}>
        <boxGeometry args={[2.3, 1.62, 0.02]} />
      </mesh>
      <mesh position={[-0.62, 1.65, 0.01]}>
        <planeGeometry args={[0.95, 0.85]} />
        <meshBasicMaterial map={photo} transparent toneMapped={false} />
      </mesh>
      <mesh position={[0.52, 1.3, 0.01]}>
        <planeGeometry args={[1.2, 0.6]} />
        <meshBasicMaterial map={text} toneMapped={false} />
      </mesh>
      <primitive object={hit} position={[0, 1.65, 0.06]} />
    </group>
  );
}
