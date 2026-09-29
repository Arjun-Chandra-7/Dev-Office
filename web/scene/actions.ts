import { useOffice } from '../store';
import { currentPlan } from './usePlan';

/** Open a project's card (switching the viewed floor in the overview; releasing the mouse when walking). */
export function openProject(id: string, _fromLaptop: boolean) {
  const s = useOffice.getState();
  const spot = currentPlan.byId.get(id);
  if (spot && s.mode === 'overview' && s.viewFloor !== spot.floor) s.setViewFloor(spot.floor as 0 | 1);
  s.select(id, { openPanel: true });
  if (s.mode === 'walk' && document.pointerLockElement) document.exitPointerLock();
}
