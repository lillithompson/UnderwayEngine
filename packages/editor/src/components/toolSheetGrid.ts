// The tool sheets' grid, as numbers: how wide a cell is, how big the glyph
// in it is, and where the rows break. Blend, Shapes, Symmetry and Layout
// are one kind of sheet (ToolGridSheet), so the sizing they share lives
// here once rather than as a constant block at the top of each — four
// copies of one formula is how one sheet's buttons came out a third bigger
// than its neighbour's. No sheet passes a cap or a ratio of its own: the
// only thing a sheet chooses is how many columns it has.
//
// Kept component-free in its own .ts module so node tests can import it,
// the TOOL_META pattern (anything importing react-native is untestable
// under jest's node environment).

/** The air left either side of a grid: the cells split the window's width
 *  minus this on each edge. */
export const TOOL_SHEET_GUTTER = 16;

/** The widest a cell grows. On a phone the columns split the window, so
 *  the buttons are finger-sized; on desktop web this cap keeps a wide
 *  window from ballooning them. The Shapes grid's own figure, which the
 *  other sheets now take. */
export const TOOL_SHEET_MAX_CELL = 96;

/** Cell edge over glyph edge: the glyph rides the cell, so it grows with
 *  the button. One ratio for every picker grid, so a 4-wide Symmetry cell
 *  and a 4-wide Shapes cell draw glyphs of one size. */
export const TOOL_SHEET_GLYPH_RATIO = 2.2;

/** The edge of one square cell when `cols` of them share a window
 *  `windowWidth` wide: an even split of the width inside the gutters,
 *  capped at TOOL_SHEET_MAX_CELL. Never negative, so an unmeasured window
 *  (0) draws nothing rather than a mirrored grid. */
export function toolSheetCellSize(windowWidth: number, cols: number): number {
  const fit = Math.floor((windowWidth - TOOL_SHEET_GUTTER * 2) / cols);
  return Math.max(0, Math.min(TOOL_SHEET_MAX_CELL, fit));
}

/** The glyph's edge inside a cell `cellSize` wide. */
export function toolSheetGlyphSize(cellSize: number): number {
  return Math.round(cellSize / TOOL_SHEET_GLYPH_RATIO);
}

/** `items` cut into rows of `cols`, in order. A short last row stays
 *  short: the grid's width is fixed by its container, so the cells of a
 *  part row sit under the first columns with no padding cells to make. */
export function toolSheetRows<T>(items: readonly T[], cols: number): T[][] {
  const rows: T[][] = [];
  const step = Math.max(1, Math.floor(cols));
  for (let i = 0; i < items.length; i += step) {
    rows.push(items.slice(i, i + step));
  }
  return rows;
}
