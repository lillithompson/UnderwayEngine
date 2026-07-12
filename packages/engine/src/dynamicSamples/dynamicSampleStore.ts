/**
 * Persistence + in-memory cache for the dynamic-samples manifest.
 *
 * The store exposes a synchronous read path so the list screen can render
 * remote placeholders in the first frame after a cold start. Disk
 * hydration runs once at module init; subscribers are notified after it
 * resolves and again whenever a fresh manifest is written.
 *
 * "New"-marking and native seen-set updates are NOT done here — both are
 * driven by user-visibility transitions from the app's compositions-list screen, which
 * combines the manifest with the per-entry sidecar publishDate. Marking
 * here on manifest membership would fire too early for pre-listed daily
 * entries (the entry sits in the manifest for days before its sidecar
 * date arrives and the card actually appears on screen).
 */

import storage from '../storage';
import { parseManifest, type DynamicSampleManifest } from './manifestSchema';

const MANIFEST_KEY = 'dynamic_samples_manifest';
const ETAG_KEY = 'dynamic_samples_manifest_etag';
const FETCHED_AT_KEY = 'dynamic_samples_manifest_at';

interface CachedState {
  manifest: DynamicSampleManifest | null;
  etag: string | null;
  hydrated: boolean;
}

const state: CachedState = {
  manifest: null,
  etag: null,
  hydrated: false,
};

type Listener = (manifest: DynamicSampleManifest | null) => void;
const listeners = new Set<Listener>();

let _hydratePromise: Promise<void> | null = null;

function notify(): void {
  for (const fn of listeners) {
    try {
      fn(state.manifest);
    } catch {
      // a thrown listener must not block other listeners
    }
  }
}

/**
 * True when IndexedDB is available. False in static-export SSR (Node),
 * where the underlying `idb-keyval` would throw at first access. In SSR
 * the store still works as an in-memory no-op so module evaluation
 * succeeds; real hydration runs once the bundle ships to a browser /
 * WebView and the hook re-mounts.
 */
function hasIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

async function hydrateOnce(): Promise<void> {
  if (state.hydrated) return;
  if (!hasIndexedDB()) {
    state.hydrated = true;
    return;
  }
  if (_hydratePromise) return _hydratePromise;
  _hydratePromise = (async () => {
    const [rawManifest, etag] = await Promise.all([
      storage.getItem(MANIFEST_KEY),
      storage.getItem(ETAG_KEY),
    ]);
    if (rawManifest) {
      const parsed = parseManifest(rawManifest);
      if (parsed) state.manifest = parsed;
    }
    state.etag = etag ?? null;
    state.hydrated = true;
    notify();
  })();
  return _hydratePromise;
}

// Fire-and-forget on module load, but only when persistence is actually
// available. Defer via a microtask so module evaluation itself never
// dereferences storage — that's what blew up under static-export SSR.
if (hasIndexedDB()) {
  void Promise.resolve().then(() => hydrateOnce());
}

export function ensureHydrated(): Promise<void> {
  return hydrateOnce();
}

/** Synchronous snapshot — may be empty before disk hydration completes. */
export function getCachedManifest(): DynamicSampleManifest | null {
  return state.manifest;
}

export function getCachedEtag(): string | null {
  return state.etag;
}

export function subscribeManifest(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Persist a freshly-fetched manifest + its ETag and notify subscribers.
 *  Does not mark entries "new" or update the native seen-set — both happen
 *  in the app's compositions-list screen once the sidecar-filtered visible list is known. */
export async function setManifest(
  manifest: DynamicSampleManifest,
  etag: string | null,
): Promise<void> {
  state.manifest = manifest;
  state.etag = etag;
  if (hasIndexedDB()) {
    await Promise.all([
      storage.setItem(MANIFEST_KEY, JSON.stringify(manifest)),
      etag != null
        ? storage.setItem(ETAG_KEY, etag)
        : storage.removeItem(ETAG_KEY),
      storage.setItem(FETCHED_AT_KEY, String(Date.now())),
    ]);
  }
  notify();
}
