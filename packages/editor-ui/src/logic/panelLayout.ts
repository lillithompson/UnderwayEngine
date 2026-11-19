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

// ── The common row under a mouse or trackpad ─────────────────────────
//
// On a touch screen the row's buttons share its width (flex: 1), each a
// finger's target as wide as the row allows. Under a fine pointer that
// spreads a handful of bare icons a window apart — some 200 px between
// neighbours on a 1440 laptop, with nothing to say what each is (DrawBot's
// report f651fb58) — so there each button is capped at a square, the row
// gathering in the panel's middle, and the button under the pointer names
// itself in a label over the panel's top edge, with the key the host binds
// to it. The panel's `finePointer` says which; off, the row is as it was.

/** The common row's inset from the panel's sides — the Edit sheet's content
 *  inset, so the row's ends land where the sheet's do. */
export const PANEL_ROW_INSET_PX = 16;
/** A common-row button's widest under a fine pointer: the row's height, so
 *  each is a square. */
export const FINE_POINTER_BUTTON_PX = 48;
/** The hover label's box at its widest, centred on its button: room for the
 *  longest name and its key on one line. */
export const COMMON_TIP_BOX_PX = 200;
/** The hover label's gap over the panel's top edge. */
export const COMMON_TIP_GAP_PX = 6;

/**
 * Where a hovered common-row button's label stands, in the box the panel
 * spans: `centerX` is the button's middle in the row (the button's own
 * layout), `panelHeight` the panel's (its inset included) and `panelWidth`
 * the panel's width. The box is centred on the button, so the label is; it
 * is as wide as COMMON_TIP_BOX_PX where that fits and narrower toward an
 * edge, never past one, so a label stays on screen and over its button.
 */
export function commonTipBox(
  centerX: number,
  panelHeight: number,
  panelWidth: number,
): { left: number; bottom: number; width: number } {
  const mid = PANEL_ROW_INSET_PX + centerX;
  const half = Math.max(0, Math.min(COMMON_TIP_BOX_PX / 2, mid, panelWidth - mid));
  return { left: mid - half, bottom: panelHeight + COMMON_TIP_GAP_PX, width: 2 * half };
}
