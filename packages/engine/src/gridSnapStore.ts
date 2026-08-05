import { loadGridSnap, saveGridSnap } from './persistence';

// App-level "Grid Snap" preference (View Settings): when on, dragging an
// object moves it in whole grid steps and a corner-resize lands the grabbed
// corner on a gridline. Same shape as showDimensionsStore — a module-local
// value plus a listener set, read through useSyncExternalStore, persisted
// lazily on the first subscribe. Defaults OFF: freeform placement is the
// editor's normal mode and snapping would otherwise silently shift existing
// off-grid objects the first time they're touched.

let value = false;
const listeners = new Set<() => void>();
let loaded = false;

function emit() {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!loaded) {
    loaded = true;
    loadGridSnap().then(stored => {
      if (stored !== value) {
        value = stored;
        emit();
      }
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): boolean {
  return value;
}

export function setGridSnap(next: boolean): void {
  if (value === next) return;
  value = next;
  emit();
  saveGridSnap(next);
}

// Test-only: reset module-local state.
export function __resetGridSnapStoreForTest(initial: boolean = false): void {
  value = initial;
  loaded = false;
  listeners.clear();
}
