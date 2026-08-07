/**
 * The Layout submenu's align tables and placement maths — what the multi-
 * selection's Layout bar renders and where each action puts a member inside
 * the combined box. Mirrors `svgEdit.test.ts` for the vector option menus.
 */

import {
  HORIZONTAL_ALIGN_OPTIONS,
  VERTICAL_ALIGN_OPTIONS,
  alignAxis,
  alignPosition,
  alignedStart,
  gridColumnCount,
  gridPlacements,
} from '../logic/layout';
import type { AlignEdge } from '../adapter';

const ALL: AlignEdge[] = ['left', 'center', 'right', 'top', 'middle', 'bottom'];

describe('align option tables', () => {
  it('offers the six alignments, three per row, in reading order', () => {
    expect(HORIZONTAL_ALIGN_OPTIONS.map((o) => o.edge)).toEqual(['left', 'center', 'right']);
    expect(VERTICAL_ALIGN_OPTIONS.map((o) => o.edge)).toEqual(['top', 'middle', 'bottom']);
  });

  it('names and glyphs every option — the bar labels cells with icons alone', () => {
    for (const o of [...HORIZONTAL_ALIGN_OPTIONS, ...VERTICAL_ALIGN_OPTIONS]) {
      expect(o.label.length).toBeGreaterThan(0);
      expect(o.icon.length).toBeGreaterThan(0);
    }
  });

  it('splits the two rows cleanly by axis', () => {
    for (const o of HORIZONTAL_ALIGN_OPTIONS) expect(alignAxis(o.edge)).toBe('h');
    for (const o of VERTICAL_ALIGN_OPTIONS) expect(alignAxis(o.edge)).toBe('v');
  });

  it('covers every AlignEdge exactly once across the two rows', () => {
    const edges = [...HORIZONTAL_ALIGN_OPTIONS, ...VERTICAL_ALIGN_OPTIONS].map((o) => o.edge);
    expect([...edges].sort()).toEqual([...ALL].sort());
  });
});

describe('alignPosition', () => {
  it('reads the low edge as 0, the centre as 0.5 and the high edge as 1', () => {
    expect(alignPosition('left')).toBe(0);
    expect(alignPosition('top')).toBe(0);
    expect(alignPosition('center')).toBe(0.5);
    expect(alignPosition('middle')).toBe(0.5);
    expect(alignPosition('right')).toBe(1);
    expect(alignPosition('bottom')).toBe(1);
  });
});

describe('alignedStart', () => {
  // A 4-wide member inside a box spanning 10 from x=2.
  it('puts a member flush to the low edge, centred, and flush to the high edge', () => {
    expect(alignedStart(2, 10, 4, 0)).toBe(2);
    expect(alignedStart(2, 10, 4, 0.5)).toBe(5);
    expect(alignedStart(2, 10, 4, 1)).toBe(8);
  });

  it('leaves a member that already spans the whole box alone, whichever edge', () => {
    for (const position of [0, 0.5, 1]) {
      expect(alignedStart(2, 10, 10, position)).toBe(2);
    }
  });

  it('is idempotent — aligning an already-aligned member is a no-op', () => {
    for (const position of [0, 0.5, 1]) {
      const first = alignedStart(2, 10, 4, position);
      expect(alignedStart(2, 10, 4, position)).toBe(first);
    }
  });
});

describe('gridColumnCount', () => {
  it('is the ceiling of the square root of the total', () => {
    expect([1, 2, 3, 4, 5, 8, 9, 10, 16, 17].map(gridColumnCount))
      .toEqual([1, 2, 2, 2, 3, 3, 3, 4, 4, 5]);
  });

  it('never asks for a zero-wide row', () => {
    expect(gridColumnCount(0)).toBe(1);
  });
});

describe('gridPlacements', () => {
  const sq = (n: number) => ({ width: n, height: n });

  it('packs shortest-first into top-aligned rows of ceil(sqrt(n))', () => {
    // Four squares, given tallest-first so the sort has work to do. n=4 → 2
    // per row: row 1 gets the 1 and the 2 (y=0, x 0 then 1), row 2 starts at
    // y = 2 (the tallest of row 1) and gets the 3 and the 4.
    const sizes = [sq(4), sq(3), sq(2), sq(1)];
    expect(gridPlacements(sizes, 0, 0)).toEqual([
      { x: 3, y: 2 }, // 4 — row 2, after the 3
      { x: 0, y: 2 }, // 3 — row 2, first
      { x: 1, y: 0 }, // 2 — row 1, after the 1
      { x: 0, y: 0 }, // 1 — row 1, first
    ]);
  });

  it('steps each row down by the TALLEST member of the row above', () => {
    // n=9 → 3 per row. Heights 1..9 sorted ascending: rows of (1,2,3),
    // (4,5,6), (7,8,9) → y = 0, 3, 9.
    const ys = gridPlacements([1, 2, 3, 4, 5, 6, 7, 8, 9].map(sq), 0, 0).map((p) => p.y);
    expect(ys).toEqual([0, 0, 0, 3, 3, 3, 9, 9, 9]);
  });

  it('lays members flush across a row, each starting where the last ended', () => {
    // Equal heights, so the input order holds. n=6 → 3 per row: widths
    // 5, 2, 4 make the first row, 1, 3, 6 the second — and each row restarts
    // at the origin's x.
    const sizes = [5, 2, 4, 1, 3, 6].map((width) => ({ width, height: 1 }));
    expect(gridPlacements(sizes, 0, 0).map((p) => p.x)).toEqual([0, 5, 7, 0, 1, 4]);
  });

  it('anchors the whole grid at the origin it is given', () => {
    const at = gridPlacements([sq(1), sq(2)], 10, 20);
    expect(at).toEqual([{ x: 10, y: 20 }, { x: 11, y: 20 }]);
  });

  it('keeps input order among equal heights, so re-gridding is stable', () => {
    const sizes = [sq(2), sq(2), sq(2), sq(2)];
    const first = gridPlacements(sizes, 0, 0);
    expect(first).toEqual([
      { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }, { x: 2, y: 2 },
    ]);
    expect(gridPlacements(sizes, 0, 0)).toEqual(first);
  });

  it('handles a partial last row and the degenerate sizes', () => {
    // n=5 → 3 per row, so the last row holds two.
    const p = gridPlacements([sq(1), sq(1), sq(1), sq(1), sq(1)], 0, 0);
    expect(p.map((q) => q.y)).toEqual([0, 0, 0, 1, 1]);
    expect(gridPlacements([], 0, 0)).toEqual([]);
    expect(gridPlacements([sq(3)], 4, 5)).toEqual([{ x: 4, y: 5 }]);
  });
});
