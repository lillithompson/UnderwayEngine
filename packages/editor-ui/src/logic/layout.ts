// The Layout submenu the ObjectPropertiesPanel offers a MULTI-selection: the
// six alignment actions that push every selected object to one edge (or the
// centre line) of the selection's combined box, plus Grid, which reflows the
// members into rows instead. Kept pure (no react-native) so the option order,
// the axis split and the grid packing are unit-tested in node; the bar
// component only owns the chrome.
//
// Layout is the one type-option that needs nothing of its members but their
// boxes, so unlike Tint / Stroke / Type it is offered whatever the selection
// is made of — a mixed image + shape + text multi-selection still aligns.

import type { AlignEdge } from '../adapter';

export interface AlignOption {
  edge: AlignEdge;
  /** Accessibility name (the bar labels these with icons only). */
  label: string;
  /** MaterialCommunityIcons glyph name. */
  icon: string;
}

/** The horizontal row, in display order: left → center → right. */
export const HORIZONTAL_ALIGN_OPTIONS: readonly AlignOption[] = [
  { edge: 'left', label: 'Align left', icon: 'align-horizontal-left' },
  { edge: 'center', label: 'Align center', icon: 'align-horizontal-center' },
  { edge: 'right', label: 'Align right', icon: 'align-horizontal-right' },
];

/** The vertical row, in display order: top → middle → bottom. */
export const VERTICAL_ALIGN_OPTIONS: readonly AlignOption[] = [
  { edge: 'top', label: 'Align top', icon: 'align-vertical-top' },
  { edge: 'middle', label: 'Align middle', icon: 'align-vertical-center' },
  { edge: 'bottom', label: 'Align bottom', icon: 'align-vertical-bottom' },
];

/** Which axis an edge moves things along — 'h' for the left/center/right
 *  three, 'v' for top/middle/bottom. The host reads this to know which of a
 *  member's two deltas is non-zero (an align never moves both axes). */
export function alignAxis(edge: AlignEdge): 'h' | 'v' {
  return edge === 'left' || edge === 'center' || edge === 'right' ? 'h' : 'v';
}

/**
 * Where a member of `span` length lands inside a combined box of `boxSpan`
 * length starting at `boxStart`, for one axis. Returns the member's new start
 * coordinate: flush to the low edge, centred, or flush to the high edge.
 * `position` is 0 = low edge (left / top), 0.5 = centre, 1 = high edge
 * (right / bottom) — the same number for both axes, which is why the six
 * actions need only this one function.
 */
export function alignedStart(
  boxStart: number,
  boxSpan: number,
  span: number,
  position: number,
): number {
  return boxStart + (boxSpan - span) * position;
}

/** The 0 / 0.5 / 1 position an edge aligns to along its axis. */
export function alignPosition(edge: AlignEdge): number {
  switch (edge) {
    case 'left':
    case 'top':
      return 0;
    case 'center':
    case 'middle':
      return 0.5;
    default:
      return 1;
  }
}

// ── Grid ────────────────────────────────────────────────────────────
// The seventh Layout action, and the one that isn't an align: rather than
// pushing members at an edge along one axis, it re-lays them all out as a
// grid. It gets its own row on the bar because it moves things on BOTH axes —
// and, at the host's end, unturns them too (a grid of tilted members isn't a
// grid). The packing below is only the where; the host owns the un-rotation,
// and passes the sizes members will have ONCE upright.

/** One member's rendered size, in the same units the caller measures boxes in. */
export interface GridSize {
  width: number;
  height: number;
}

/** Where {@link gridPlacements} wants a member's top-left corner. */
export interface GridPlacement {
  x: number;
  y: number;
}

/** How many members a grid row holds: the ceiling of the square root of the
 *  total, so the arrangement stays as square as it can (7 members → 3 across,
 *  in rows of 3 / 3 / 1). Never below 1, so an empty or single selection can't
 *  ask for a zero-width row. */
export function gridColumnCount(count: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(count)));
}

/**
 * Pack `sizes` into a grid whose top-left corner is (`originX`, `originY`),
 * returning each member's new top-left corner BY INPUT INDEX — so the caller
 * zips the result straight back onto whatever it measured, without tracking
 * the sort itself.
 *
 * Members are ordered by height, shortest first, then filled left-to-right
 * into rows of {@link gridColumnCount} members. A row is top-aligned (every
 * member in it shares the row's y) and its members sit flush, each starting
 * where the previous one ended. The next row's y steps down by the TALLEST
 * member of the row above, which is the smallest step that can't overlap it —
 * and because the rows are height-sorted, those steps grow as you go down.
 *
 * Ties in height keep the input order, so re-gridding an unchanged selection
 * reproduces the same arrangement rather than shuffling equal-height members.
 */
export function gridPlacements(
  sizes: readonly GridSize[],
  originX: number,
  originY: number,
): GridPlacement[] {
  const order = sizes.map((_, i) => i)
    .sort((a, b) => sizes[a].height - sizes[b].height || a - b);
  const cols = gridColumnCount(order.length);
  const out: GridPlacement[] = new Array(sizes.length);
  let rowY = originY;
  for (let start = 0; start < order.length; start += cols) {
    let x = originX;
    let rowHeight = 0;
    for (const i of order.slice(start, start + cols)) {
      out[i] = { x, y: rowY };
      x += sizes[i].width;
      if (sizes[i].height > rowHeight) rowHeight = sizes[i].height;
    }
    rowY += rowHeight;
  }
  return out;
}
