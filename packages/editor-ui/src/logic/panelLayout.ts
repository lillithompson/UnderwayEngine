import { OBJECT_PANEL_HEIGHT } from '../theme';

// Bottom-edge layout for the object-properties panel and its submenus.
//
// The panel ends in a row of carousel dots (which of its two pages is showing).
// Where those dots sit depends on the device: on a notched phone they drop
// *into* the home-indicator strip (the "unsafe" space at the very bottom)
// rather than sitting above it, so the panel reclaims the dot row's height and
// the whole sheet reads shorter. With no inset (desktop web) there is no strip
// to drop into, so the dots stay in flow. Callers pass `dotsInSafeArea` — keyed
// off a measured inset, not the platform: the editor runs as the web bundle
// even inside the native iOS WebView.
//
// The submenu bars carry no dots of their own: they stack directly above the
// panel, so the lit option in its type row is what says which bar is open.

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

/** Gap between cells in the option row. Shared with the row's own style so the
 *  capsule maths and the layout can't disagree about it. */
export const OPTION_ROW_GAP = 8;
/** Capsule width ceiling — the toolbar line-mode pushdown's capsule, so a wide
 *  window doesn't stretch these into slabs. Below it the capsule takes the
 *  whole cell. */
export const OPTION_CAPSULE_MAX_WIDTH = 88;
/** Capsule height: a 13pt word with the pushdown's 4pt vertical padding. */
export const OPTION_CAPSULE_HEIGHT = 26;

export interface OptionCapsuleLayout {
  /** One width for every option — the point of the capsule being constant is
   *  that it can slide between options without resizing on the way. */
  width: number;
  /** Left offset of the capsule when option i is selected, one per option. */
  lefts: number[];
}

/** Where the sliding selection capsule sits over each option.
 *
 *  The row is `columns` equal cells (fixed at the larger page's count) plus a
 *  weighted pad at each end; see {@link optionRowSidePad}. One flex unit is
 *  therefore the cell width, and every offset falls out of it. `rowWidth` comes
 *  from the row's own onLayout — 0 before the first measure, which yields a
 *  zero-width capsule the caller can skip drawing. */
export function optionCapsuleLayout(
  rowWidth: number,
  columns: number,
  buttons: number,
  gap: number = OPTION_ROW_GAP,
  maxWidth: number = OPTION_CAPSULE_MAX_WIDTH,
): OptionCapsuleLayout {
  if (rowWidth <= 0 || columns <= 0 || buttons <= 0) return { width: 0, lefts: [] };
  const sidePad = optionRowSidePad(columns, buttons);
  // The pads are real children, so they carry gaps of their own.
  const children = buttons + (sidePad > 0 ? 2 : 0);
  const gapTotal = Math.max(0, children - 1) * gap;
  const unit = Math.max(0, rowWidth - gapTotal) / columns;
  const width = Math.min(unit, maxWidth);
  // Centre the capsule in its cell, so a capped width stays put rather than
  // hugging the cell's left edge.
  const inset = (unit - width) / 2;
  const start = sidePad > 0 ? sidePad * unit + gap : 0;
  return {
    width,
    lefts: Array.from({ length: buttons }, (_, i) => start + i * (unit + gap) + inset),
  };
}
