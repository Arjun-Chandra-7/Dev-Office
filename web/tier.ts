// Quality tiers + a first guess from hardware hints (no store import: used by the store itself).

/**
 * Quality tiers. "aaloo" (🥔) is for potato computers: quarter-size textures, sub-native resolution,
 * no sky shader / environment map / city, calmer animation.
 */
export type Tier = 'high' | 'low' | 'aaloo';
export const ORDER: Tier[] = ['aaloo', 'low', 'high'];

export const TIER = {
  high: { dpr: 1.75, antialias: true, tex: '', sky: true, env: true, city: true, trees: 1, animFps: 30 },
  low: { dpr: 1, antialias: false, tex: '@2k', sky: true, env: true, city: true, trees: 1, animFps: 24 },
  aaloo: { dpr: 0.7, antialias: false, tex: '@1k', sky: false, env: false, city: false, trees: 0.5, animFps: 12 },
} as const;

function gpuName(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
    if (!gl) return 'none';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch {
    return 'none';
  }
}

/** First guess from hardware hints, before any frame has been rendered. */
export function guessTier(): Tier {
  const gpu = gpuName().toLowerCase();
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (gpu === 'none' || /swiftshader|llvmpipe|softpipe|software|basic render/.test(gpu)) return 'aaloo';
  if (cores <= 2 || mem <= 2 || /mali-[4t]|adreno \(tm\) [2-5]\d\d|powervr/.test(gpu)) return 'aaloo';
  if (cores <= 4 || mem <= 4 || coarse || /intel.*(hd|uhd) graphics|mali|adreno/.test(gpu)) return 'low';
  return 'high';
}

