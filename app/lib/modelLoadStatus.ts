/**
 * Tiny module-level registry so separately-mounted 3D components (the hero
 * fighter lives in the route, the mascot lives in the page layout) can report
 * when their model is on screen, and one page-level loader can wait for all of
 * them.
 *
 * The map deliberately outlives route changes: once a model has loaded, later
 * visits must not show the loader again.
 */
export type ModelStatus = 'pending' | 'ready' | 'failed';

export const HERO_FIGHTER = 'hero-fighter';
export const BOXING_BUDDY = 'boxing-buddy';

const statuses = new Map<string, ModelStatus>();
const listeners = new Set<() => void>();

export function setModelStatus(key: string, status: ModelStatus) {
  if (statuses.get(key) === status) return;
  statuses.set(key, status);
  listeners.forEach((listener) => listener());
}

export function subscribeModelStatus(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True once every key has reported either success or failure. */
export function modelsSettled(keys: readonly string[]) {
  return keys.every((key) => (statuses.get(key) ?? 'pending') !== 'pending');
}
