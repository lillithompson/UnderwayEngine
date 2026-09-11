import { OBJECT_PANEL_HEIGHT } from '../theme';
import type { SubmenuKey } from './submenuHeight';

// Bottom-edge layout for the object-properties panel, and the two pages it
// swipes between.
//
// The panel ends in a row of carousel dots (which of its pages is showing).
// Where those dots sit depends on the device: on a notched phone they drop
// *into* the home-indicator strip (the "unsafe" space at the very bottom)
// rather than sitting above it, so the panel reclaims the dot row's height and
// the whole sheet reads shorter. With no inset (desktop web) there is no strip
// to drop into, so the dots stay in flow. Callers pass `dotsInSafeArea` — keyed
// off a measured inset, not the platform: the editor runs as the web bundle
// even inside the native iOS WebView.

/** Carousel dot diameter. */
export const OBJECT_DOT_SIZE = 12;
/** Clearance under the dots — how far they ride above the bottom edge, on both
 *  surfaces. Deep enough that the dots sit in the upper half of a home-indicator
 *  strip rather than against the screen edge. */
export const OBJECT_DOTS_BOTTOM = 18;
/** Dot row box: paddingTop (4) + dot + the bottom clearance. */
export const OBJECT_DOTS_ROW_HEIGHT = 4 + OBJECT_DOT_SIZE + OBJECT_DOTS_BOTTOM;

/** Panel box for a given inset. `height` is the full slide distance (so the
 *  hidden position clears the screen edge); `paddingBottom` keeps the button
 *  row clear of the inset — zero when the dots have taken the strip over, since
 *  the strip is then part of the panel's own content. */
export function objectPanelLayout(safeBottom: number, dotsInSafeArea: boolean): { height: number; paddingBottom: number } {
  if (!dotsInSafeArea) {
    return { height: OBJECT_PANEL_HEIGHT + safeBottom, paddingBottom: safeBottom };
  }
  // The strip replaces the dot row — unless it is shorter than the dots need,
  // in which case the dots set the floor and nothing is reclaimed.
  return {
    height: OBJECT_PANEL_HEIGHT - OBJECT_DOTS_ROW_HEIGHT + Math.max(safeBottom, OBJECT_DOTS_ROW_HEIGHT),
    paddingBottom: 0,
  };
}

// ── Pages ────────────────────────────────────────────────────────────
//
// The panel has at most two pages, a dot each:
//
//   common — the icon row (rotate / mirror / copy / lock / delete). Always
//            present and always FIRST; it is the one page every selection has.
//   edit   — the Edit sheet: everything the selection's KIND offers (crop /
//            shadow / border …) and everything the SELECTION offers (Layout ·
//            Group · Merge on a multi-selection), as tabs over a content
//            area. Present when the selection has any option at all. It is
//            not a row the panel swaps in: a swipe (or the second dot) pops
//            the sheet up OVER the panel, and a downward swipe on the sheet
//            drops it back.

export type PanelPage = 'common' | 'edit';

/** The pages this selection has, in dot order. */
export function objectPanelPages(hasOptions: boolean): PanelPage[] {
  return hasOptions ? ['common', 'edit'] : ['common'];
}

/**
 * The tab the Edit sheet opens on, given the pages `order` this selection
 * offers (each page is one tab; tabs that are one-press actions have no page
 * and aren't candidates).
 *
 * `remembered` is the page the sheet was last showing, and it wins whenever
 * the new selection has it: someone working through a drawing's shadows
 * wants the Shadow page on the next shape too, and re-landing them on the
 * first tab every time makes the sheet something to re-navigate rather than
 * a place to be. Otherwise the first page; null when the selection offers
 * no page at all (its tabs are all actions), and the sheet shows its tabs
 * alone.
 */
export function landingSubmenu(
  order: readonly SubmenuKey[],
  remembered: SubmenuKey | null,
): SubmenuKey | null {
  if (remembered && order.includes(remembered)) return remembered;
  return order.length > 0 ? order[0] : null;
}
