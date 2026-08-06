import { loadGridSnap, saveGridSnap } from './persistence';

// App-level "Grid Snap" preference (View Settings): when on, dragging an
// object moves it in whole grid steps and a corner-resize lands the grabbed
// corner on a gridline. Same shape as showDimensionsStore — a module-local
// value plus a listener set, read through useSyncExternalStore, persisted
// lazily on the first subscribe.
//
// Two layers, because the preference is app-global but some formats want to
// open snapped (Reimagine: every locked stroke endpoint already sits on a
// gridline):
//   - `chosen` — the user's explicit View Settings toggle. Persisted, and
//     null until they have ever touched it.
//   - `fallback` — what the OPEN FORMAT asks for (EditorShell seeds it from
//     EditorConfig.canvas.gridSnapDefault on mount).
// The user's choice always wins, so a format default never silently rewrites
// the preference for every other format. With neither set the answer is OFF:
// freeform placement is the editor's normal mode and snapping would otherwise
// silently shift existing off-grid objects the first time they're touched.

let chosen: boolean | null = null;
let fallback = false;
const listeners = new Set<() => void>();
let loaded = false;

function effective(): boolean {
  return chosen ?? fallback;
}

function emit() {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!loaded) {
    loaded = true;
    loadGridSnap().then(stored => {
      // Nothing stored, or the user beat the read to it with a live toggle:
      // either way the in-memory choice is the newer one.
      if (stored === null || chosen !== null) return;
      const before = effective();
      chosen = stored;
      if (effective() !== before) emit();
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): boolean {
  return effective();
}

export function setGridSnap(next: boolean): void {
  if (chosen === next) return;
  const before = effective();
  chosen = next;
  if (effective() !== before) emit();
  saveGridSnap(next);
}

/**
 * Seed the default the open format wants (not a user choice: never persisted,
 * and ignored once the user has set the toggle themselves).
 */
export function setGridSnapDefault(next: boolean): void {
  if (fallback === next) return;
  const before = effective();
  fallback = next;
  if (effective() !== before) emit();
}

// Test-only: reset module-local state. `initial` is the USER's choice —
// null (the default) means they have never set the toggle.
export function __resetGridSnapStoreForTest(initial: boolean | null = null): void {
  chosen = initial;
  fallback = false;
  loaded = false;
  listeners.clear();
}
