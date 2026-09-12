import { OBJECT_PANEL_HEIGHT } from '../theme';
import type { SubmenuKey } from './submenuHeight';

// Bottom-edge layout for the object-properties panel, and the two pages it
// swipes between.
//
// The panel is its common-actions row and the device's bottom inset under it,
// and nothing else. It used to end in a row of carousel dots saying which of
// its two pages was showing, with a whole rule about where they sat: on a
// notched phone they dropped INTO the home-indicator strip so the panel could
// reclaim their height, and stayed in flow where there was no strip to drop
// into. The dots are gone — the sheet says which page is up by being up —
// and with them that rule, so the inset is simply padded and the panel is the
// same height everywhere.

/** Panel box for a given inset. `height` is the full slide distance (so the
 *  hidden position clears the screen edge); `paddingBottom` keeps the button
 *  row clear of the inset. */
export function objectPanelLayout(safeBottom: number): { height: number; paddingBottom: number } {
  return { height: OBJECT_PANEL_HEIGHT + safeBottom, paddingBottom: safeBottom };
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
