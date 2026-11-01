// Where a sideways-scrolling tab row comes to rest so the SELECTED tab is in
// view — the whole of the decision, kept clear of the view so it can be read
// and tested as arithmetic. The Edit sheet's tab row (components/EditSheet's
// EditTabs) and any host's own tab row (DrawBots' Studio page of an Inkling,
// six tabs on a phone) scroll by it, so a tab picked from off the edge, or
// lit by the host, is never left behind the fade.
//
// Everything is in the row's content coordinates: `tab` is the selected
// tab's box (`x` from the content's left edge), `viewW` the row's visible
// width, `scrollX` where it rests now and `contentW` how wide its content
// is.

/** How much of the next tab stays showing past a tab scrolled in from
 *  either edge: enough to say there is more that way, and to clear the
 *  44 pt fade the Edit sheet lays over a cut edge. */
export const TAB_REVEAL = 48;

/**
 * The scroll offset that brings `tab` into view, or null when it already
 * is (or nothing is measured yet). A tab cut at the right edge comes in
 * with `reveal` to spare beyond it, one cut at the left the same, never
 * past either end of the content; a tab wider than the view lines up its
 * left edge.
 */
export function scrollToShowTab(
  tab: { x: number; width: number }, viewW: number, scrollX: number, contentW: number, reveal = TAB_REVEAL,
): number | null {
  if (viewW <= 0 || contentW <= viewW) return null;
  const max = contentW - viewW;
  const left = tab.x - reveal;
  const right = tab.x + tab.width + reveal;
  let to = scrollX;
  if (tab.width + 2 * reveal >= viewW) to = tab.x - Math.max(0, (viewW - tab.width) / 2);
  else if (left < scrollX) to = left;
  else if (right > scrollX + viewW) to = right - viewW;
  to = Math.max(0, Math.min(max, to));
  return Math.abs(to - scrollX) < 0.5 ? null : to;
}
