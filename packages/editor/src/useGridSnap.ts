import { useSyncExternalStore } from 'react';
import { getSnapshot, setGridSnap, subscribe } from '@/engine/gridSnapStore';

// React binding for the engine's app-level "Grid Snap" preference (the View
// Settings toggle). The store owns the value and its persistence (idb-keyval,
// key `app_grid_snap`); this is only the subscription. Sibling of
// useShowDimensions — the snap MATH lives in ./gridSnap.

export function useGridSnap(): {
  gridSnap: boolean;
  setGridSnap: (v: boolean) => void;
} {
  const gridSnap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { gridSnap, setGridSnap };
}

// (The per-format snap DEFAULT is no longer a hook here: it seeded the
// store's fallback layer, which the native settings ride-along — always on
// the URL, always seeding the user-choice layer — outranked on device, so
// Reimagine never actually opened snapped. The format's ask is seeded in
// EditorShell's boot effect now, after the host's own seeding.)
