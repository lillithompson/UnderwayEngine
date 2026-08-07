import { createAppPrefStore } from './appPrefStore';
import { loadGridSnap, saveGridSnap } from './persistence';

// App-level "Grid Snap" preference: when on, dragging an object moves it in
// whole grid steps and a corner-resize lands the grabbed corner on a gridline.
//
// Two layers, because the preference is app-global but some formats want to
// open snapped (Reimagine: every locked stroke endpoint already sits on a
// gridline):
//   - `chosen` — the user's explicit choice (the settings screen's Grid Snap
//     row, or the editor's snap capsule). Persisted, and null until they have
//     ever touched it. This is the layer createAppPrefStore holds.
//   - `fallback` — what the OPEN FORMAT asks for (EditorShell seeds it from
//     EditorConfig.canvas.gridSnapDefault on mount). Never persisted, and a
//     purely local concern, so it stays module state here.
// The user's choice always wins, so a format default never silently rewrites
// the preference for every other format. With neither set the answer is OFF:
// freeform placement is the editor's normal mode and snapping would otherwise
// silently shift existing off-grid objects the first time they're touched.

const chosenStore = createAppPrefStore<boolean | null>({
  initial: null,
  load: loadGridSnap,
  // A null never reaches here: setGridSnap only ever writes a real choice.
  save: (v) => { if (v !== null) void saveGridSnap(v); },
});

let fallback = false;

function effective(): boolean {
  return chosenStore.getSnapshot() ?? fallback;
}

// Subscribers see the EFFECTIVE value, so they are only told when THAT moves.
// Setting `chosen` to the value the fallback was already producing (the very
// first tap of a toggle that was showing its default) changes this store's
// internals but nothing a subscriber can observe, and must stay silent.
const listeners = new Set<() => void>();
let lastEffective = effective();
let bridged: (() => void) | null = null;

function emitIfChanged(): void {
  const now = effective();
  if (now === lastEffective) return;
  lastEffective = now;
  for (const listener of Array.from(listeners)) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (bridged === null) {
    // One internal subscription relays the chosen layer (and kicks off its
    // lazy load). Never torn down: it is module-scoped and costs one closure.
    lastEffective = effective();
    bridged = chosenStore.subscribe(emitIfChanged);
  }
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): boolean {
  return effective();
}

export function setGridSnap(next: boolean): void {
  chosenStore.set(next);
}

/** Adopt the native settings screen's value at boot (see appPrefStore). It is
 *  a user choice — it outranks the format default, exactly as if they had just
 *  set the toggle — but it came from the host, so it is not written back. */
export function seedGridSnapFromHost(next: boolean): void {
  chosenStore.seedFromHost(next);
}

/**
 * Seed the default the open format wants (not a user choice: never persisted,
 * and ignored once the user has set the toggle themselves).
 */
export function setGridSnapDefault(next: boolean): void {
  if (fallback === next) return;
  fallback = next;
  emitIfChanged();
}

// Test-only: reset module-local state. `initial` is the USER's choice —
// null (the default) means they have never set the toggle.
export function __resetGridSnapStoreForTest(initial: boolean | null = null): void {
  chosenStore.__resetForTest(initial);
  fallback = false;
  listeners.clear();
  bridged = null;
  lastEffective = effective();
}
