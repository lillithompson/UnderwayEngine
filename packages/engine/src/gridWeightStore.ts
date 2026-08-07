import { createAppPrefStore } from './appPrefStore';
import { loadGridWeight, saveGridWeight } from './persistence';

// App-level "Grid Weight" preference: how strongly the canvas grid lines are
// drawn (the GL grid pass's u_gridIntensity, 0..1). It used to be per
// composition — CompositionState.gridIntensity, written into the page file —
// which meant the same user setting had to be re-made on every page. It is now
// one app preference, and the composition field is a mirror of it (see
// EditorShell); the binary format keeps the field so older files still load.

export const GRID_WEIGHT_MIN = 0;
export const GRID_WEIGHT_MAX = 1;
export const GRID_WEIGHT_DEFAULT = 0.5;

/** Clamp to the usable range, rejecting NaN/Infinity from a parsed URL param
 *  or a stored value written by an older build. */
export function clampGridWeight(value: number): number {
  if (!Number.isFinite(value)) return GRID_WEIGHT_DEFAULT;
  return Math.max(GRID_WEIGHT_MIN, Math.min(GRID_WEIGHT_MAX, value));
}

const store = createAppPrefStore<number>({
  initial: GRID_WEIGHT_DEFAULT,
  load: loadGridWeight,
  save: (v) => { void saveGridWeight(v); },
});

export const subscribe = store.subscribe;
export const getSnapshot = store.getSnapshot;

export function setGridWeight(next: number): void {
  store.set(clampGridWeight(next));
}

/** Adopt the native settings screen's value at boot (see appPrefStore). */
export function seedGridWeightFromHost(next: number): void {
  store.seedFromHost(clampGridWeight(next));
}

// Test-only: reset module-local state.
export function __resetGridWeightStoreForTest(initial: number = GRID_WEIGHT_DEFAULT): void {
  store.__resetForTest(initial);
}
