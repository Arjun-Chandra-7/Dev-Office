import * as THREE from 'three';

// The few materials that stay real-time (everything static is baked in Blender).

let lib: ReturnType<typeof build> | null = null;

function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(0.6, 'rgba(0,0,0,0.18)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function build() {
  return {
    laptopBody: new THREE.MeshStandardMaterial({ color: '#b9bcc1', roughness: 0.3, metalness: 0.9 }),
    keys: new THREE.MeshStandardMaterial({ color: '#1d1e20', roughness: 0.6 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: '#d6e8ea',
      roughness: 0.03,
      metalness: 0,
      transparent: true,
      opacity: 0.12,
      envMapIntensity: 1.4,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    liftCabin: new THREE.MeshStandardMaterial({ color: '#8d9399', roughness: 0.22, metalness: 1 }),
    liftDoor: new THREE.MeshStandardMaterial({ color: '#b8bdc2', roughness: 0.18, metalness: 1 }),
    aluminium: new THREE.MeshStandardMaterial({ color: '#c9ccd0', roughness: 0.28, metalness: 1 }),
    blackMetal: new THREE.MeshStandardMaterial({ color: '#1b1d20', roughness: 0.38, metalness: 0.85 }),
    chrome: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.08, metalness: 1 }),
    panel: new THREE.MeshBasicMaterial({ color: '#fff4e2' }),
    roof: new THREE.MeshStandardMaterial({ color: '#3a4146', roughness: 0.85 }),
    blob: new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }),
  };
}

export function R() {
  return (lib ??= build());
}
