import { DEFAULT_THUMBNAIL_LINE_WIDTH, loadThumbnailLineWidth, saveThumbnailLineWidth } from './persistence';

let value = DEFAULT_THUMBNAIL_LINE_WIDTH;
const listeners = new Set<() => void>();
let loaded = false;

function emit() {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!loaded) {
    loaded = true;
    loadThumbnailLineWidth().then(stored => {
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

export function getSnapshot(): number {
  return value;
}

/** Synchronous accessor for non-React callers (e.g. the thumbnail
 *  generation pipeline). Returns the cached value; the persisted value
 *  is hydrated lazily on the first React subscription. */
export function getThumbnailLineWidth(): number {
  // Kick off the load even when nothing is subscribed yet so the
  // thumbnail pipeline sees the user's persisted value as soon as
  // possible after app launch.
  if (!loaded) {
    loaded = true;
    loadThumbnailLineWidth().then(stored => {
      if (stored !== value) {
        value = stored;
        emit();
      }
    });
  }
  return value;
}

export function setThumbnailLineWidth(next: number): void {
  if (!Number.isFinite(next) || next <= 0) return;
  if (value === next) return;
  value = next;
  emit();
  saveThumbnailLineWidth(next);
}
