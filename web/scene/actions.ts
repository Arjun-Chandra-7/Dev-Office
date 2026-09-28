import { useOffice } from '../store';
import { currentPlan } from './usePlan';

/**
 * Open a project's details. From the laptop this goes straight to Claude: if the office launched
 * a session for this project that is still running, its terminal opens too.
 */
export function openProject(id: string, fromLaptop: boolean) {
  const s = useOffice.getState();
  const spot = currentPlan.byId.get(id);
  if (spot && s.mode === 'overview' && s.viewFloor !== spot.floor) s.setViewFloor(spot.floor as 0 | 1);
  s.select(id, { openPanel: true });
  if (fromLaptop) {
    const running = s.snapshot?.launched.find((l) => l.projectId === id && l.state === 'running');
    if (running) s.openTerminal(running.id);
  }
  if (s.mode === 'walk' && document.pointerLockElement) document.exitPointerLock();
}
