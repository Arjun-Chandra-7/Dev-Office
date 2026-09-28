import type * as THREE from 'three';

/** Things the first-person player can aim at and use with E / click. */
export type Interactable =
  | { kind: 'laptop'; projectId: string; label: string }
  | { kind: 'lift-call'; floor: number; label: string }
  | { kind: 'lift-panel'; label: string };

export const interactables = new Map<THREE.Object3D, Interactable>();

export function register(obj: THREE.Object3D | null, info: Interactable) {
  if (!obj) return () => undefined;
  interactables.set(obj, info);
  return () => {
    if (interactables.get(obj) === info) interactables.delete(obj);
  };
}
