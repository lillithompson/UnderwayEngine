import { createAppPrefStore } from './appPrefStore';
import { loadShowDimensions, saveShowDimensions } from './persistence';

// App-level "Dimensions" preference: the live size HUD on canvas gestures.
// All the machinery is createAppPrefStore's — this module is only the
// preference's identity (default, storage keys) and its named exports.

const store = createAppPrefStore<boolean>({
  initial: true,
  load: loadShowDimensions,
  save: (v) => { void saveShowDimensions(v); },
});

export const subscribe = store.subscribe;
export const getSnapshot = store.getSnapshot;
export const setShowDimensions = store.set;
/** Adopt the native settings screen's value at boot (see appPrefStore). */
export const seedShowDimensionsFromHost = store.seedFromHost;

// Test-only: reset module-local state.
export function __resetShowDimensionsStoreForTest(initial: boolean = true): void {
  store.__resetForTest(initial);
}
