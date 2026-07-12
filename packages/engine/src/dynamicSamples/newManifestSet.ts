/**
 * Persistent "new" set for dynamic-sample manifest entries.
 *
 * Two IndexedDB-backed sets:
 *  - newSet: ids currently flagged for the gradient "new" outline on the
 *    composition card. Cleared when the user opens the card.
 *  - everDisplayedSet: ids the app has ever shown to the user as visible
 *    (past the sidecar-date filter). The ever-set is what makes "new"
 *    marking idempotent across WebView reloads — once an entry has been
 *    shown, we won't re-mark it on every subsequent visibility evaluation.
 *
 * The set used to be in-memory only and was wiped by the overnight WebView
 * reload (added for the long-background black-screen fix), which made the
 * "new" outline silently disappear by morning for any pre-listed daily
 * entries whose sidecar date crossed midnight while the device slept.
 *
 * The set is now driven by visibility transitions via recomputeFromVisible,
 * not by manifest-membership transitions. The app's compositions-list screen calls this once
 * the post-sidecar-filter visible list is known.
 *
 * Formerly sessionNewManifestSet with `*ThisSession*` export names — renamed
 * when the semantics became persistent across reloads. Facet's copy still
 * carries the old names; map them when it migrates to this package.
 */

import storage from '../storage';

const NEW_KEY = 'dynamic_samples_new_set';
const EVER_KEY = 'dynamic_samples_ever_displayed_set';

type Listener = (ids: Set<string>) => void;

let newSet = new Set<string>();
let everDisplayed = new Set<string>();
let hydrated = false;
let hydratePromise: Promise<void> | null = null;

const listeners = new Set<Listener>();

function hasIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

function parseStoredSet(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

async function hydrateOnce(): Promise<void> {
  if (hydrated) return;
  if (!hasIndexedDB()) {
    hydrated = true;
    return;
  }
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    const [rawNew, rawEver] = await Promise.all([
      storage.getItem(NEW_KEY),
      storage.getItem(EVER_KEY),
    ]);
    newSet = parseStoredSet(rawNew);
    everDisplayed = parseStoredSet(rawEver);
    hydrated = true;
    if (newSet.size > 0) notify();
  })();
  return hydratePromise;
}

if (hasIndexedDB()) {
  void Promise.resolve().then(() => hydrateOnce());
}

function persistNew(): void {
  if (!hasIndexedDB()) return;
  void storage.setItem(NEW_KEY, JSON.stringify(Array.from(newSet)));
}

function persistEver(): void {
  if (!hasIndexedDB()) return;
  void storage.setItem(EVER_KEY, JSON.stringify(Array.from(everDisplayed)));
}

function notify(): void {
  const snapshot = new Set(newSet);
  for (const fn of listeners) {
    try {
      fn(snapshot);
    } catch {
      // a thrown listener must not block other listeners
    }
  }
}

/**
 * For each visible id not yet in everDisplayed, add it to both newSet and
 * everDisplayed. Returns the ids that were freshly marked new so the caller
 * can fire follow-on signals (toast, OS notification, bridge message).
 */
export function recomputeFromVisible(visibleIds: Iterable<string>): string[] {
  if (!hydrated) {
    // Pre-hydration: refuse to mark anything new — we'd race the persisted
    // everDisplayed read and re-mark already-seen entries on every cold
    // start. Caller should re-invoke after hydration completes.
    return [];
  }
  const added: string[] = [];
  for (const id of visibleIds) {
    if (everDisplayed.has(id)) continue;
    everDisplayed.add(id);
    newSet.add(id);
    added.push(id);
  }
  if (added.length === 0) return [];
  persistNew();
  persistEver();
  notify();
  return added;
}

export function clearManifestEntryNew(manifestId: string): void {
  if (!newSet.has(manifestId)) return;
  newSet = new Set(newSet);
  newSet.delete(manifestId);
  persistNew();
  notify();
}

export function getNewManifestSet(): Set<string> {
  return newSet;
}

export function subscribeNewManifestSet(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function ensureNewManifestSetHydrated(): Promise<void> {
  return hydrateOnce();
}

export function __resetForTests(): void {
  newSet = new Set<string>();
  everDisplayed = new Set<string>();
  hydrated = true;
  hydratePromise = null;
  listeners.clear();
}
