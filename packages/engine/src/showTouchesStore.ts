import { loadShowTouches, saveShowTouches } from './persistence';

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
    loadShowTouches().then(stored => {
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

export function setShowTouches(next: boolean): void {
  if (value === next) return;
  value = next;
  emit();
  saveShowTouches(next);
}
