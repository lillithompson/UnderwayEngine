import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScrollView } from 'react-native';
import { scrollToShowTab } from '../logic/tabScroll';

// The plumbing every sideways-scrolling tab row shares to keep its
// SELECTED tab in view (logic/tabScroll holds the arithmetic): the row's
// and its content's widths, each tab's box, the scroll offset, and the
// effect that scrolls when the selection, a width or the selected tab's
// box changes. The Edit sheet's tab row (EditSheet's EditTabs) and any
// host's own (DrawBots' Studio tab row) draw their tabs their own way and
// wire them through this, so the two cannot drift. The boxes and the
// offset ride in refs: measuring and scrolling render nothing but the
// widths and the selected tab's first box.

export interface SelectedTabInView<K> {
  /** The row's ScrollView. */
  scrollView: React.RefObject<ScrollView | null>;
  viewW: number;
  contentW: number;
  /** The row's own width (its onLayout). */
  onViewWidth(w: number): void;
  /** The content's width (onContentSizeChange). */
  onContentWidth(w: number): void;
  /** The scroll offset (onScroll). */
  onScrollX(x: number): void;
  /** A tab's box in the content (its onLayout). */
  onTabBox(key: K, box: { x: number; width: number }): void;
}

export function useSelectedTabInView<K>(selected: K | null): SelectedTabInView<K> {
  const [viewW, setViewW] = useState(0);
  const [contentW, setContentW] = useState(0);
  // Measured late (a first layout), the tab is shown once it is known.
  const [measured, setMeasured] = useState(0);
  const scrollView = useRef<ScrollView | null>(null);
  const scrollX = useRef(0);
  const boxes = useRef(new Map<K, { x: number; width: number }>());
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useEffect(() => {
    const box = selected === null ? undefined : boxes.current.get(selected);
    if (!box) return;
    const to = scrollToShowTab(box, viewW, scrollX.current, contentW);
    if (to !== null) scrollView.current?.scrollTo({ x: to, animated: true });
  }, [selected, viewW, contentW, measured]);
  const onScrollX = useCallback((x: number) => { scrollX.current = x; }, []);
  const onTabBox = useCallback((key: K, box: { x: number; width: number }) => {
    boxes.current.set(key, box);
    if (key === selectedRef.current) setMeasured((n) => n + 1);
  }, []);
  return { scrollView, viewW, contentW, onViewWidth: setViewW, onContentWidth: setContentW, onScrollX, onTabBox };
}
