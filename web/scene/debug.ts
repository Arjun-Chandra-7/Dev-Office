// Dev-only bisect switches: ?off=post,shadow,lights,glass,agents,env,kits,city
const off = new Set(
  import.meta.env.DEV ? (new URLSearchParams(location.search).get('off') ?? '').split(',').filter(Boolean) : [],
);
export const dbgOff = (k: string) => off.has(k);

import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';

/** Dev-only: expose renderer + scene for in-page diagnostics. */
export function DebugExpose() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    if (import.meta.env.DEV) (window as any).__three = { gl, scene };
  }, [gl, scene]);
  return null;
}
