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
// grid). The packing below is only the where — which row a member lands in,
// rows cut to equal WIDTH rather than equal count, and the margin between
// neighbours; the host owns the un-rotation, and passes the sizes members
// will have ONCE upright.

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

/** How many members a grid of EQUAL members holds per row: the ceiling of
 *  the square root of the total, so the arrangement stays as square as it can
 *  (9 members → 3 across). It no longer fixes how many members a given row
 *  holds — {@link gridRowCount} turns it into a number of rows, and
 *  {@link gridPlacements} shares the members out between them by width.
 *  Never below 1, so an empty or single selection can't ask for a zero-wide
 *  row. */
export function gridColumnCount(count: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(count)));
}

/** How many rows a grid of `count` members has: as many as rows of
 *  {@link gridColumnCount} would need (7 members → 3 rows). Never below 1. */
export function gridRowCount(count: number): number {
  return Math.max(1, Math.ceil(count / gridColumnCount(count)));
}

/** The margin between grid members, as a share of the typical member. */
const GRID_GAP_FRACTION = 0.1;

/**
 * The margin a grid leaves between neighbours, across a row and between rows:
 * a tenth of the typical member, where a member's size is the mean of its two
 * sides and "typical" is the median over the selection.
 *
 * Relative rather than a fixed length, because members have no fixed scale —
 * a fine-grid page holds objects a fraction of a cell across beside pages
 * whose objects span ten — and a constant would swallow the one or vanish
 * beside the other. The median keeps one outsized (or dot-sized) member from
 * setting the margin for everything else, and the mean of the sides gives a
 * hairline (a zero-high line) a margin where its shorter side would give none.
 *
 * A function of the sizes ALONE — not of the camera or of where anything
 * sits — so gridding a gridded selection computes the same margin again and
 * moves nothing.
 */
export function gridGap(sizes: readonly GridSize[]): number {
  if (sizes.length === 0) return 0;
  const spans = sizes.map((s) => (s.width + s.height) / 2).sort((a, b) => a - b);
  const mid = spans.length >> 1;
  const median = spans.length % 2 === 1 ? spans[mid] : (spans[mid - 1] + spans[mid]) / 2;
  return median > 0 ? median * GRID_GAP_FRACTION : 0;
}

/**
 * Cut `widths` — the members' widths, in row order — into `rows` runs whose
 * total widths (each with `gap` between neighbours) are as equal as they can
 * be, returning the number of members in each run.
 *
 * "As equal as they can be" is the least sum of squared row widths: every way
 * of cutting into `rows` runs has the same total, so the least sum of squares
 * is the least spread. Runs stay contiguous — the height sort decides who
 * shares a row, this only decides where a row ends — which is what lets a
 * row of small members run long and a row of big ones stop short.
 *
 * Among cuts that tie (equal members cut 3/2 or 2/3), the EARLIER rows take
 * the extra members, so a grid of equal members reads top-heavy the way
 * filling rows in order would leave it. Ties are judged to within float
 * noise, so two cuts a rounding error apart don't flip the arrangement.
 *
 * Exact, by dynamic programming over (rows × members × cut point): for n
 * members that is about n² · √n / 2 steps of arithmetic — a few million for a
 * selection of hundreds, run once per tap of Grid, never per frame.
 */
export function balancedRowCounts(
  widths: readonly number[],
  rows: number,
  gap = 0,
): number[] {
  const n = widths.length;
  const r = Math.max(1, Math.min(rows, n));
  if (n === 0) return [];
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + widths[i];
  /** The width of a row holding members j .. i-1. */
  const span = (j: number, i: number) => prefix[i] - prefix[j] + gap * (i - j - 1);
  // cost[i]: the least sum of squares for the first i members in `row` rows;
  // cut[row * (n + 1) + i]: where the last of those rows starts.
  let cost = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) cost[i] = span(0, i) ** 2;
  const cut = new Int32Array(r * (n + 1));
  for (let row = 1; row < r; row++) {
    const next = new Float64Array(n + 1).fill(Infinity);
    // `row + 1` rows need at least that many members, and must leave one
    // for every row still to come.
    for (let i = row + 1; i <= n - (r - row - 1); i++) {
      let best = Infinity;
      let bestJ = row;
      // The latest cut first, and only a clearly better one replaces it: on a
      // tie the last row stays the shortest, so the earlier rows fill first.
      for (let j = i - 1; j >= row; j--) {
        const c = cost[j] + span(j, i) ** 2;
        if (best === Infinity || c < best - 1e-9 * Math.max(1, best)) {
          best = c;
          bestJ = j;
        }
      }
      next[i] = best;
      cut[row * (n + 1) + i] = bestJ;
    }
    cost = next;
  }
  const counts: number[] = new Array(r);
  let end = n;
  for (let row = r - 1; row >= 0; row--) {
    const start = row === 0 ? 0 : cut[row * (n + 1) + end];
    counts[row] = end - start;
    end = start;
  }
  return counts;
}

/**
 * Pack `sizes` into a grid whose top-left corner is (`originX`, `originY`),
 * returning each member's new top-left corner BY INPUT INDEX — so the caller
 * zips the result straight back onto whatever it measured, without tracking
 * the sort itself.
 *
 * Members are ordered by height, shortest first, then cut into
 * {@link gridRowCount} rows of as nearly EQUAL WIDTH as the order allows
 * ({@link balancedRowCounts}) — not of equal count. Rows of a fixed count
 * made a row of small members a fraction as wide as a row of big ones, so a
 * mixed selection came out as a wedge: narrow at the top, wide at the bottom.
 * Cutting by width gives the small members' rows more members instead.
 *
 * A row is top-aligned (every member in it shares the row's y) and its
 * members sit `gap` apart, each starting that far past where the previous one
 * ended. The next row's y steps down by the TALLEST member of the row above
 * plus the same `gap`, the smallest step that keeps the margin everywhere.
 * `gap` defaults to {@link gridGap}, so every host's grid has the one margin;
 * pass 0 for a flush pack.
 *
 * Ties in height keep the input order, so re-gridding an unchanged selection
 * reproduces the same arrangement rather than shuffling equal-height members.
 */
export function gridPlacements(
  sizes: readonly GridSize[],
  originX: number,
  originY: number,
  gap: number = gridGap(sizes),
): GridPlacement[] {
  const order = sizes.map((_, i) => i)
    .sort((a, b) => sizes[a].height - sizes[b].height || a - b);
  const counts = balancedRowCounts(
    order.map((i) => sizes[i].width), gridRowCount(order.length), gap,
  );
  const out: GridPlacement[] = new Array(sizes.length);
  let rowY = originY;
  let start = 0;
  for (const count of counts) {
    let x = originX;
    let rowHeight = 0;
    for (const i of order.slice(start, start + count)) {
      out[i] = { x, y: rowY };
      x += sizes[i].width + gap;
      if (sizes[i].height > rowHeight) rowHeight = sizes[i].height;
    }
    rowY += rowHeight + gap;
    start += count;
  }
  return out;
}
