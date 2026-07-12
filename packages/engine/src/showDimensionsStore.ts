import { loadShowDimensions, saveShowDimensions } from './persistence';

let value = true;
const listeners = new Set<() => void>();
let loaded = false;

function emit() {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!loaded) {
    loaded = true;
    loadShowDimensions().then(stored => {
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

export function setShowDimensions(next: boolean): void {
  if (value === next) return;
  value = next;
  emit();
  saveShowDimensions(next);
}

// Test-only: reset module-local state.
export function __resetShowDimensionsStoreForTest(initial: boolean = true): void {
  value = initial;
  loaded = false;
  listeners.clear();
}
