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

/** Flex weight of the empty cell flanking each side of the COMMON-ACTIONS row
 *  when it has fewer buttons than the row has columns.
 *
 *  That row holds `columns` equal cells — fixed at the larger page's count so
 *  the icons keep one size whatever the selection's option set costs — and is
 *  centred by padding both ends. Returning one fractional weight per side
 *  rather than a whole number of unit cells is the point: an odd pad (5 icons
 *  against 6 options) has no whole-cell split, and rounding it left the group
 *  sitting half a column left of centre. Half of an odd pad is 1.5, which flex
 *  handles exactly.
 *
 *  The type-options row does NOT use this: its cells size to their own words
 *  and share out the slack, so it always fills the row (see OptionPill). */
export function optionRowSidePad(columns: number, buttons: number): number {
  return Math.max(0, columns - buttons) / 2;
}

/** Gap between cells in the option row. */
export const OPTION_ROW_GAP = 8;
/** Ceiling on ONE option cell — the toolbar line-mode pushdown's capsule width,
 *  so a wide window doesn't stretch the words into slabs. It is a ceiling only:
 *  a cell hugs its own word (plus its share of the row's slack) below this, and
 *  the row centres the group once every cell has hit the cap. It must stay
 *  above the longest option word at 13/600 plus OPTION_PILL_PAD either side —
 *  today's longest is "Endpoints", comfortably inside it — or that word would
 *  ellipsize on every screen instead of none. */
export const OPTION_CAPSULE_MAX_WIDTH = 88;
/** Capsule height: a 13pt word with the pushdown's 4pt vertical padding. */
export const OPTION_CAPSULE_HEIGHT = 26;
/** Breathing room either side of an option's word, inside its capsule. The
 *  floor on a cell's width: a cell is never narrower than its word plus this. */
export const OPTION_PILL_PAD = 10;

/** Left offset of each option cell, given every cell's laid-out width.
 *
 *  The cells size themselves to their words, so their WIDTHS come from the
 *  layout (each cell's onLayout) — but their positions can't: onLayout rides a
 *  ResizeObserver, which says nothing when a cell keeps its width and merely
 *  moves (every cell at the width cap, and the row widening around them). So
 *  the offsets are reproduced here from the row's own rules instead: cells in
 *  order, one `gap` between neighbours, and the group centred in whatever it
 *  doesn't fill — the same `justifyContent: 'center'` the row carries.
 *
 *  `rowWidth` is the row's measured width; 0 (or no widths) before the first
 *  layout pass, which yields no offsets and a capsule the caller skips. */
export function optionCapsuleLefts(
  rowWidth: number,
  widths: readonly number[],
  gap: number = OPTION_ROW_GAP,
): number[] {
  if (rowWidth <= 0 || widths.length === 0) return [];
  const total = widths.reduce((a, w) => a + w, 0) + gap * (widths.length - 1);
  // Overfull (the words outgrew the screen and flex shrank them) starts flush
  // left, exactly as the row does.
  let x = Math.max(0, (rowWidth - total) / 2);
  return widths.map((w) => {
    const left = x;
    x += w + gap;
    return left;
  });
}
