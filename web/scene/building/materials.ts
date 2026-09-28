import * as THREE from 'three';

// Procedural PBR material library. Every texture is generated on a canvas at startup, so the
// app needs no downloaded assets and works offline.

type Paint = (g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => void;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number, paint: Paint, seed = 1) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d', { willReadFrequently: true })!, w, h, rng(seed));
  return c;
}

function noise(g: CanvasRenderingContext2D, w: number, h: number, amp: number, rnd: () => number) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amp;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

/** Luminance of a canvas → tangent-space normal map (Sobel). */
function normalFrom(src: HTMLCanvasElement, strength: number) {
  const w = src.width;
  const h = src.height;
  const s = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const g = out.getContext('2d')!;
  const img = g.createImageData(w, h);
  const L = (x: number, y: number) => {
    const i = (((y + h) % h) * w + ((x + w) % w)) * 4;
    return (s[i] + s[i + 1] + s[i + 2]) / 765;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (L(x + 1, y) - L(x - 1, y)) * strength;
      const dy = (L(x, y + 1) - L(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len) * 255;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return out;
}

function tex(c: HTMLCanvasElement, repeat: [number, number], color = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- painters ---------------------------------------------------------------------------------

const oakPlanks: Paint = (g, w, h, rnd) => {
  const rows = 8;
  const ph = h / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rnd() * w * 0.5;
    while (x < w) {
      const len = w * (0.35 + rnd() * 0.45);
      const base = 138 + rnd() * 18;
      g.fillStyle = `rgb(${base + 30},${base - 4},${base - 52})`;
      g.fillRect(x, r * ph, len, ph);
      // grain
      for (let k = 0; k < 26; k++) {
        const y = r * ph + rnd() * ph;
        g.strokeStyle = `rgba(${70 + rnd() * 30},${40 + rnd() * 20},${20},${0.08 + rnd() * 0.12})`;
        g.lineWidth = 0.6 + rnd() * 1.4;
        g.beginPath();
        g.moveTo(x, y);
        g.bezierCurveTo(x + len * 0.3, y + (rnd() - 0.5) * 4, x + len * 0.7, y + (rnd() - 0.5) * 4, x + len, y + (rnd() - 0.5) * 3);
        g.stroke();
      }
      g.fillStyle = 'rgba(30,18,8,0.55)';
      g.fillRect(x, r * ph, 2, ph);
      x += len;
    }
    g.fillStyle = 'rgba(30,18,8,0.5)';
    g.fillRect(0, r * ph, w, 1.5);
  }
  noise(g, w, h, 10, rnd);
};

const walnut: Paint = (g, w, h, rnd) => {
  g.fillStyle = '#5a3a24';
  g.fillRect(0, 0, w, h);
  for (let k = 0; k < 220; k++) {
    const y = rnd() * h;
    g.strokeStyle = `rgba(${30 + rnd() * 30},${15 + rnd() * 15},8,${0.1 + rnd() * 0.25})`;
    g.lineWidth = 0.5 + rnd() * 2.5;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= w; x += w / 8) g.lineTo(x, y + Math.sin(x * 0.02 + k) * 3 + (rnd() - 0.5) * 2);
    g.stroke();
  }
  noise(g, w, h, 8, rnd);
};

const concrete: Paint = (g, w, h, rnd) => {
  g.fillStyle = '#7d7f80';
  g.fillRect(0, 0, w, h);
  for (let k = 0; k < 900; k++) {
    const r = rnd() * 40 + 5;
    const v = 100 + rnd() * 50;
    g.fillStyle = `rgba(${v},${v},${v + 2},0.05)`;
    g.beginPath();
    g.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2);
    g.fill();
  }
  for (let k = 0; k < 1500; k++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? 60 : 200},${rnd() < 0.5 ? 60 : 200},${rnd() < 0.5 ? 60 : 200},0.25)`;
    g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5);
  }
  // saw-cut control joints
  g.fillStyle = 'rgba(40,40,40,0.35)';
  g.fillRect(0, 0, w, 2);
  g.fillRect(0, 0, 2, h);
  noise(g, w, h, 14, rnd);
};

const plaster: Paint = (g, w, h, rnd) => {
  g.fillStyle = '#e9e6e0';
  g.fillRect(0, 0, w, h);
  for (let k = 0; k < 400; k++) {
    const v = 220 + rnd() * 30;
    g.fillStyle = `rgba(${v},${v - 2},${v - 6},0.08)`;
    g.beginPath();
    g.arc(rnd() * w, rnd() * h, rnd() * 30 + 4, 0, Math.PI * 2);
    g.fill();
  }
  noise(g, w, h, 8, rnd);
};

const fabric: Paint = (g, w, h, rnd) => {
  g.fillStyle = '#808080';
  g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 2)
    for (let x = 0; x < w; x += 2) {
      const v = ((x + y) / 2) % 2 ? 150 : 110;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, y, 2, 2);
    }
  noise(g, w, h, 40, rnd);
};

const grassPaint: Paint = (g, w, h, rnd) => {
  g.fillStyle = '#44632f';
  g.fillRect(0, 0, w, h);
  for (let k = 0; k < 6000; k++) {
    const v = rnd();
    g.fillStyle = v < 0.5 ? `rgba(30,55,20,${0.2 + rnd() * 0.3})` : `rgba(110,140,60,${0.15 + rnd() * 0.25})`;
    g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 2 + rnd() * 4);
  }
  noise(g, w, h, 18, rnd);
};

const carpet: Paint = (g, w, h, rnd) => {
  g.fillStyle = '#6f6a64';
  g.fillRect(0, 0, w, h);
  noise(g, w, h, 60, rnd);
  // subtle border pattern
  g.strokeStyle = 'rgba(40,36,32,0.5)';
  g.lineWidth = 10;
  g.strokeRect(14, 14, w - 28, h - 28);
  g.strokeStyle = 'rgba(210,190,150,0.25)';
  g.lineWidth = 3;
  g.strokeRect(30, 30, w - 60, h - 60);
};

// ---- material library -------------------------------------------------------------------------

function build() {
  const oakC = canvas(1024, 1024, oakPlanks, 7);
  const walC = canvas(512, 512, walnut, 3);
  const conC = canvas(1024, 1024, concrete, 11);
  const plaC = canvas(512, 512, plaster, 5);
  const fabC = canvas(256, 256, fabric, 9);
  const carC = canvas(512, 512, carpet, 13);

  const oak = tex(oakC, [1, 1]);
  const oakN = tex(normalFrom(oakC, 2.2), [1, 1], false);
  const con = tex(conC, [1, 1]);
  const conN = tex(normalFrom(conC, 1.2), [1, 1], false);
  const pla = tex(plaC, [1, 1]);
  const plaN = tex(normalFrom(plaC, 1.5), [1, 1], false);
  const wal = tex(walC, [1, 1]);
  const walN = tex(normalFrom(walC, 1.5), [1, 1], false);
  const fab = tex(fabC, [4, 4]);
  const fabN = tex(normalFrom(fabC, 3), [4, 4], false);
  const car = tex(carC, [1, 1]);
  const grs = tex(canvas(512, 512, grassPaint, 19), [90, 90]);

  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
  return {
    textures: { oak, oakN, con, conN, pla, plaN, wal, walN, fab, fabN, car },
    // floors use world-space UVs set by geometry (1 texture repeat = 4 m / 6 m)
    oakFloor: std({ map: oak, normalMap: oakN, normalScale: new THREE.Vector2(0.25, 0.25), roughness: 0.35, metalness: 0.02, envMapIntensity: 1.15 }),
    concreteFloor: std({ map: con, normalMap: conN, normalScale: new THREE.Vector2(0.18, 0.18), roughness: 0.22, metalness: 0.05, envMapIntensity: 1.25 }),
    plaster: std({ map: pla, normalMap: plaN, normalScale: new THREE.Vector2(0.18, 0.18), roughness: 0.92, color: '#f5f3ec' }),
    accentWall: std({ color: '#2b353a', roughness: 0.82 }),
    ceiling: std({ color: '#dad7cf', roughness: 0.95 }),
    walnut: std({ map: wal, normalMap: walN, normalScale: new THREE.Vector2(0.25, 0.25), roughness: 0.32, metalness: 0.02, envMapIntensity: 1.2 }),
    whiteLaminate: std({ color: '#f0efe9', roughness: 0.32 }),
    blackMetal: std({ color: '#16181b', roughness: 0.34, metalness: 0.9 }),
    aluminium: std({ color: '#d0d4d8', roughness: 0.25, metalness: 1 }),
    chrome: std({ color: '#ffffff', roughness: 0.06, metalness: 1 }),
    brass: std({ color: '#dfb76c', roughness: 0.24, metalness: 0.9, envMapIntensity: 1.5 }),
    fabricCharcoal: std({ map: fab, normalMap: fabN, color: '#383b40', roughness: 0.95 }),
    fabricTeal: std({ map: fab, normalMap: fabN, color: '#27686d', roughness: 0.95 }),
    fabricMustard: std({ map: fab, normalMap: fabN, color: '#b5832a', roughness: 0.95 }),
    leather: std({ color: '#7e4c2c', roughness: 0.52, metalness: 0.05, envMapIntensity: 0.9 }),
    rug: std({ map: car, roughness: 1 }),
    potCeramic: std({ color: '#e8e4dc', roughness: 0.38 }),
    potDark: std({ color: '#252628', roughness: 0.55 }),
    leaf: std({ color: '#3f6e35', roughness: 0.65, side: THREE.DoubleSide }),
    leafDark: std({ color: '#2b522f', roughness: 0.7, side: THREE.DoubleSide }),
    soil: std({ color: '#241a11', roughness: 1 }),
    laptopBody: std({ color: '#bfc3c8', roughness: 0.28, metalness: 0.92 }),
    screenBezel: std({ color: '#090a0b', roughness: 0.28, metalness: 0.3 }),
    keyboardKeys: std({ color: '#1a1b1d', roughness: 0.6 }),
    book: std({ color: '#ffffff', roughness: 0.8 }), // tinted per instance
    artCanvas: std({ color: '#ffffff', roughness: 0.9 }),
    lampShade: std({ color: '#f5ebcf', roughness: 0.75, emissive: '#ffdfa8', emissiveIntensity: 0.7, side: THREE.DoubleSide }),
    ceilingPanel: std({ color: '#ffffff', emissive: '#fff6e5', emissiveIntensity: 3.2, roughness: 0.9 }),
    glass: std({
      color: '#e2f3fa',
      roughness: 0.05,
      metalness: 0.1,
      transparent: true,
      opacity: 0.2,
      envMapIntensity: 2.2,
      depthWrite: false,
      side: THREE.FrontSide,
    }),
    frostedGlass: std({
      color: '#eaf4f7',
      roughness: 0.45,
      metalness: 0.05,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.FrontSide,
    }),
    mullion: std({ color: '#222528', roughness: 0.36, metalness: 0.85 }),
    stairTread: std({ color: '#dedad2', roughness: 0.45 }),
    stairStringer: std({ color: '#1e2124', roughness: 0.36, metalness: 0.85 }),
    liftCabin: std({ color: '#91989e', roughness: 0.2, metalness: 1 }),
    liftDoor: std({ color: '#bcc1c7', roughness: 0.16, metalness: 1 }),
    grass: std({ map: grs, roughness: 1 }),
    asphalt: std({ color: '#25272a', roughness: 0.88 }),
    pavement: std({ map: con, color: '#c2beb7', roughness: 0.72 }),
  };
}

let lib: ReturnType<typeof build> | null = null;
export function M() {
  return (lib ??= build());
}
export type MaterialLib = ReturnType<typeof build>;
