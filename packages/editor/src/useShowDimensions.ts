import { useSyncExternalStore } from 'react';
import { getSnapshot, setShowDimensions, subscribe } from '@/engine/showDimensionsStore';

// React binding for the engine's app-level "Dimensions" preference (the View
// Settings toggle). The store owns the value and its persistence (idb-keyval,
// key `app_show_dimensions`); this is only the subscription. Same shape as
// Facet's hooks/useShowDimensions.

export function useShowDimensions(): {
  showDimensions: boolean;
  setShowDimensions: (v: boolean) => void;
} {
  const showDimensions = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { showDimensions, setShowDimensions };
}
