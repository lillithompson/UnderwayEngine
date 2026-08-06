import { OBJECT_PANEL_HEIGHT } from '../theme';

// Bottom-edge layout for the object-properties panel and its slide-up submenus.
//
// Both surfaces end in a row of carousel dots. Where those dots sit depends on
// the device: on a notched phone they drop *into* the home-indicator strip (the
// "unsafe" space at the very bottom) rather than sitting above it, so the panel
// reclaims the dot row's height and the whole sheet reads shorter. With no
// inset (desktop web) there is no strip to drop into, so the dots stay in flow.
// Callers pass `dotsInSafeArea` — keyed off a measured inset, not the platform:
// the editor runs as the web bundle even inside the native iOS WebView.

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

/** Offset of the submenu dots from the bottom of the slide-up layer: clear of
 *  the inset normally, inside it when the dots take the strip over. */
export function submenuDotsBottom(safeBottom: number, dotsInSafeArea: boolean): number {
  return (dotsInSafeArea ? 0 : safeBottom) + OBJECT_DOTS_BOTTOM;
}

/** Flex weight of the empty cell flanking each side of a button row that has
 *  fewer buttons than the row has columns.
 *
 *  The row holds `columns` equal cells — fixed at the larger page's count so a
 *  swipe between the common actions and the type options can't resize them —
 *  and the smaller page is centred by padding both ends. Returning one
 *  fractional weight per side rather than a whole number of unit cells is the
 *  point: an odd pad (3 text options in 6 columns, 5 image options in 6) has no
 *  whole-cell split, and rounding it left the group sitting half a column left
 *  of centre. Half of an odd pad is 1.5, which flex handles exactly. */
export function optionRowSidePad(columns: number, buttons: number): number {
  return Math.max(0, columns - buttons) / 2;
}
