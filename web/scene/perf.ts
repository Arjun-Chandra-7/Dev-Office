import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { useOffice } from '../store';
import { ORDER } from '../tier';

/**
 * Auto mode governor: watches frame times while the scene renders continuously (walking,
 * animations, camera moves) and steps the tier down when frames are slow — or back up after
 * sustained headroom. Idle (on-demand) gaps are ignored.
 */
export function PerfGovernor() {
  const samples = useRef<number[]>([]);
  const lastT = useRef(0);
  const lastChange = useRef(performance.now());
  const fastWindows = useRef(0);

  useFrame(() => {
    const s = useOffice.getState();
    if (s.quality !== 'auto') return;
    const now = performance.now();
    const dt = now - lastT.current;
    lastT.current = now;
    if (dt <= 0 || dt > 120) return; // not a continuous run of frames
    samples.current.push(dt);
    if (samples.current.length < 90) return;
    const sorted = samples.current.sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    samples.current = [];
    const idx = ORDER.indexOf(s.tier);
    if (median > 30 && idx > 0 && now - lastChange.current > 2500) {
      lastChange.current = now;
      fastWindows.current = 0;
      useOffice.setState({ tier: ORDER[idx - 1] });
      s.notify(idx - 1 === 0 ? 'Aaloo mode on 🥔 — lighter graphics for this computer' : 'Graphics lowered to keep things smooth');
    } else if (median < 11 && idx < ORDER.length - 1) {
      // only well above a 60 Hz budget, and only after a while, so it never flip-flops
      if (++fastWindows.current >= 4 && now - lastChange.current > 15000) {
        lastChange.current = now;
        fastWindows.current = 0;
        useOffice.setState({ tier: ORDER[idx + 1] });
      }
    } else fastWindows.current = 0;
  });
  return null;
}
