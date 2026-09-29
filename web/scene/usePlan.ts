import { useMemo } from 'react';
import type { PortfolioProject as Project } from '../../shared/types';
import { useOffice } from '../store';
import { makeBuildingPlan, type BuildingPlan } from './building/plan';

/** Latest plan for non-React code (physics, keyboard navigation). */
export let currentPlan: BuildingPlan = makeBuildingPlan([]);

export function orderedIds(projects: Project[] | undefined) {
  return (projects ?? []).slice().sort((a, b) => a.slot - b.slot).map((p) => p.id);
}

/** Office layout derived from the project list; recomputed only when projects are added/removed. */
export function usePlan() {
  const key = useOffice((s) => orderedIds(s.snapshot?.projects).join('\n'));
  return useMemo(() => {
    currentPlan = makeBuildingPlan(key ? key.split('\n') : []);
    return currentPlan;
  }, [key]);
}
