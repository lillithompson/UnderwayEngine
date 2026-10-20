import { useSyncExternalStore } from 'react';
import { getSnapshot, setGridWeight, subscribe } from '@/engine/gridWeightStore';

// React binding for the engine's app-level "Grid Weight" preference (the
// Settings tab's View settings section). The store owns the value and its
// local persistence; this is only the subscription. Sibling of useGridSnap /
// useShowDimensions.

export function useGridWeight(): {
  gridWeight: number;
  setGridWeight: (v: number) => void;
} {
  const gridWeight = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { gridWeight, setGridWeight };
}
