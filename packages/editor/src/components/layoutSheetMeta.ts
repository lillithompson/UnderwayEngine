// The Layout sheet's table — its eight actions, in the order the grid
// draws them. Kept component-free in its own .ts module so node tests can
// import it (the TOOL_META pattern, as symmetryModalMeta is for Symmetry).
//
// The aligns are the shared tables the engine's builders serve
// (HORIZONTAL / VERTICAL align options), read here rather than restated,
// so the sheet can never offer an align the engine doesn't.

import type { AlignEdge } from '@/editor-ui';
import { HORIZONTAL_ALIGN_OPTIONS, VERTICAL_ALIGN_OPTIONS } from '@/editor-ui/logic/layout';

/** One cell of the Layout sheet: an align to an edge, or one of the two
 *  actions that are not aligns. */
export type LayoutSheetAction =
  | { kind: 'align'; edge: AlignEdge; label: string; icon: string }
  | { kind: 'grid' | 'straighten'; label: string; icon: string };

/** The Shapes grid's own columns, so the cells are the size of its and
 *  Symmetry's: three aligns and one action to a row. */
export const LAYOUT_SHEET_COLS = 4;

/** The sheet's cells in display order. The sheet has no section labels, so
 *  the ROWS carry the grouping: the horizontal aligns across the first,
 *  the vertical across the second, and the two actions that are not aligns
 *  down the last column — Arrange in grid, then Straighten under it. */
export const LAYOUT_SHEET_ACTIONS: readonly LayoutSheetAction[] = [
  ...HORIZONTAL_ALIGN_OPTIONS.map((o) => ({ kind: 'align' as const, ...o })),
  { kind: 'grid', label: 'Arrange in grid', icon: 'view-grid-outline' },
  ...VERTICAL_ALIGN_OPTIONS.map((o) => ({ kind: 'align' as const, ...o })),
  { kind: 'straighten', label: 'Straighten', icon: 'format-rotate-90' },
];
