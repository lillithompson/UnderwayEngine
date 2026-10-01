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
  balancedRowCounts,
  gridColumnCount,
  gridGap,
  gridPlacements,
  gridRowCount,
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

describe('gridRowCount', () => {
  it('is the rows that rows of gridColumnCount would need', () => {
    expect([1, 2, 3, 4, 5, 7, 9, 10, 16, 17].map(gridRowCount))
      .toEqual([1, 1, 2, 2, 2, 3, 3, 3, 4, 4]);
  });

  it('never asks for no rows at all', () => {
    expect(gridRowCount(0)).toBe(1);
  });
});

describe('gridGap', () => {
  const sq = (n: number) => ({ width: n, height: n });

  it('is a tenth of the typical member — the median of the mean sides', () => {
    expect(gridGap([sq(2), sq(4), sq(6)])).toBeCloseTo(0.4);
    // An even count takes the middle of the two middle members.
    expect(gridGap([sq(1), sq(2), sq(3), sq(4)])).toBeCloseTo(0.25);
    // A member's size is the mean of its two sides.
    expect(gridGap([{ width: 6, height: 2 }])).toBeCloseTo(0.4);
  });

  it('is not set by one outsized or dot-sized member', () => {
    expect(gridGap([sq(2), sq(2), sq(2), sq(2), sq(200)])).toBeCloseTo(0.2);
    expect(gridGap([sq(0.01), sq(2), sq(2), sq(2), sq(2)])).toBeCloseTo(0.2);
  });

  it('gives hairlines a margin, and nothing a margin of none', () => {
    const line = { width: 10, height: 0 };
    expect(gridGap([line, line, line])).toBeCloseTo(0.5);
    expect(gridGap([])).toBe(0);
    expect(gridGap([{ width: 0, height: 0 }])).toBe(0);
  });

  it('reads sizes alone, so it is the same however the members are ordered', () => {
    const sizes = [sq(5), sq(1), sq(3), sq(2)];
    expect(gridGap([...sizes].reverse())).toBe(gridGap(sizes));
  });
});

describe('balancedRowCounts', () => {
  /** The total width of each row the counts cut `widths` into. */
  const rowWidths = (widths: number[], counts: number[], gap = 0) => {
    let start = 0;
    return counts.map((count) => {
      const row = widths.slice(start, start + count);
      start += count;
      return row.reduce((a, b) => a + b, 0) + gap * (count - 1);
    });
  };
  const spread = (ws: number[]) => Math.max(...ws) - Math.min(...ws);

  it('gives a row of small members more members than a row of big ones', () => {
    // The reported wedge: eight 1-wide and eight 4-wide, in rows of four,
    // came out 4 / 4 / 16 / 16 wide. Cut by width, the small ones share a
    // row and the big ones take two or three to a row.
    const widths = [1, 1, 1, 1, 1, 1, 1, 1, 4, 4, 4, 4, 4, 4, 4, 4];
    const counts = balancedRowCounts(widths, 4);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(16);
    expect(counts[0]).toBeGreaterThan(counts[3]);
    expect(counts[0]).toBeGreaterThanOrEqual(8);
    expect(spread(rowWidths(widths, counts))).toBeLessThanOrEqual(4);
    expect(spread(rowWidths(widths, [4, 4, 4, 4]))).toBe(12); // as it was
  });

  it('finds the cut with the least spread, not just a better one', () => {
    // 1..6 into 2 rows: 21 in all. [1,2,3,4 | 5,6] is 10 / 11 — no closer cut.
    expect(balancedRowCounts([1, 2, 3, 4, 5, 6], 2)).toEqual([4, 2]);
    // Into 3 rows: [1,2,3 | 4,5 | 6] is 6 / 9 / 6 (153); nothing beats it.
    expect(balancedRowCounts([1, 2, 3, 4, 5, 6], 3)).toEqual([3, 2, 1]);
  });

  it('is exact: no cut of the same rows has a smaller sum of squares', () => {
    const widths = [0.5, 0.5, 1, 1.5, 2, 2, 3, 5, 5, 8, 13];
    const rows = 4;
    const cost = (counts: number[]) =>
      rowWidths(widths, counts, 0.3).reduce((a, w) => a + w * w, 0);
    const got = cost(balancedRowCounts(widths, rows, 0.3));
    // Every way of cutting 11 members into 4 non-empty runs.
    let least = Infinity;
    for (let a = 1; a <= 8; a++) {
      for (let b = 1; a + b <= 9; b++) {
        for (let c = 1; a + b + c <= 10; c++) {
          least = Math.min(least, cost([a, b, c, 11 - a - b - c]));
        }
      }
    }
    expect(got).toBeCloseTo(least, 9);
  });

  it('counts the gaps as part of a row', () => {
    // Flush, four 1s weigh the same as one 4. With a gap of 1 the four are 7
    // wide, so the cut moves a member along to even the rows out.
    expect(balancedRowCounts([1, 1, 1, 1, 4, 4], 2, 0)).toEqual([5, 1]);
    expect(balancedRowCounts([1, 1, 1, 1, 4, 4], 2, 1)).toEqual([4, 2]);
  });

  it('gives equal members to the earlier rows first', () => {
    const ones = (n: number) => new Array<number>(n).fill(1);
    expect(balancedRowCounts(ones(4), 2)).toEqual([2, 2]);
    expect(balancedRowCounts(ones(5), 2)).toEqual([3, 2]);
    expect(balancedRowCounts(ones(7), 3)).toEqual([3, 2, 2]);
    expect(balancedRowCounts(ones(9), 3)).toEqual([3, 3, 3]);
    // Widths a rounding error apart still tie.
    expect(balancedRowCounts([0.1, 0.2, 0.3, 0.1 + 0.2, 0.2, 0.1], 2)).toEqual([3, 3]);
    expect(balancedRowCounts(new Array<number>(5).fill(0.1), 2)).toEqual([3, 2]);
  });

  it('never leaves a row empty, and never asks for more rows than members', () => {
    expect(balancedRowCounts([100, 1, 1], 3)).toEqual([1, 1, 1]);
    expect(balancedRowCounts([1, 2], 5)).toEqual([1, 1]);
    expect(balancedRowCounts([3], 1)).toEqual([1]);
    expect(balancedRowCounts([], 3)).toEqual([]);
    expect(balancedRowCounts([1, 2, 3], 0)).toEqual([3]);
  });

  it('holds up for a selection in the hundreds', () => {
    const widths = Array.from({ length: 400 }, (_, i) => 1 + (i % 17));
    const counts = balancedRowCounts(widths, gridRowCount(400), 0.5);
    expect(counts.length).toBe(20);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(400);
    expect(Math.min(...counts)).toBeGreaterThan(0);
  });
});

describe('gridPlacements', () => {
  const sq = (n: number) => ({ width: n, height: n });

  it('packs shortest-first into top-aligned rows of equal width', () => {
    // Four squares, given tallest-first so the sort has work to do. n=4 → 2
    // rows, 10 wide in all: the 1, the 2 and the 3 make a row of 6 and the 4
    // a row of its own, which is as even as the height order allows (rows of
    // two were 3 and 7). Row 2 starts at y = 3, the tallest of row 1.
    const sizes = [sq(4), sq(3), sq(2), sq(1)];
    expect(gridPlacements(sizes, 0, 0, 0)).toEqual([
      { x: 0, y: 3 }, // 4 — row 2, alone
      { x: 3, y: 0 }, // 3 — row 1, after the 2
      { x: 1, y: 0 }, // 2 — row 1, after the 1
      { x: 0, y: 0 }, // 1 — row 1, first
    ]);
  });

  it('puts more members in a row of small ones, so the rows match', () => {
    // The report: eight small and eight big. Rows of four made the top two
    // rows a quarter the width of the bottom two.
    const sizes = [...new Array(8).fill(sq(1)), ...new Array(8).fill(sq(4))];
    const at = gridPlacements(sizes, 0, 0, 0);
    const rows = new Map<number, number>();
    at.forEach((p, i) => rows.set(p.y, Math.max(rows.get(p.y) ?? 0, p.x + sizes[i].width)));
    const widths = [...rows.values()];
    expect(widths.length).toBe(4);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(4);
    // Every small member sits in the top row.
    expect(at.slice(0, 8).every((p) => p.y === 0)).toBe(true);
  });

  it('steps each row down by the TALLEST member of the row above', () => {
    // Nine equal-width members of heights 1..9 → three rows of three:
    // (1,2,3), (4,5,6), (7,8,9) → y = 0, 3, 9.
    const sizes = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((height) => ({ width: 2, height }));
    expect(gridPlacements(sizes, 0, 0, 0).map((p) => p.y))
      .toEqual([0, 0, 0, 3, 3, 3, 9, 9, 9]);
  });

  it('lays members flush across a row when the gap is 0', () => {
    // Equal heights, so the input order holds. 21 wide in all → two rows:
    // 5, 2, 4 (11) and 1, 3, 6 (10) — and each row restarts at the origin's x.
    const sizes = [5, 2, 4, 1, 3, 6].map((width) => ({ width, height: 1 }));
    expect(gridPlacements(sizes, 0, 0, 0).map((p) => p.x)).toEqual([0, 5, 7, 0, 1, 4]);
  });

  it('leaves the gap between neighbours, across a row and between rows', () => {
    const sizes = [sq(2), sq(2), sq(2), sq(2)];
    expect(gridPlacements(sizes, 0, 0, 0.5)).toEqual([
      { x: 0, y: 0 }, { x: 2.5, y: 0 }, { x: 0, y: 2.5 }, { x: 2.5, y: 2.5 },
    ]);
  });

  it('uses gridGap as the margin when none is given', () => {
    const sizes = [sq(4), sq(3), sq(2), sq(1)];
    const gap = gridGap(sizes);
    expect(gap).toBeCloseTo(0.25);
    expect(gridPlacements(sizes, 0, 0)).toEqual(gridPlacements(sizes, 0, 0, gap));
    // The 1, the 2 and the 3 a margin apart; the 4 a margin below the 3.
    const at = gridPlacements(sizes, 0, 0);
    expect(at[3]).toEqual({ x: 0, y: 0 });
    expect(at[2].x).toBeCloseTo(1.25);
    expect(at[1].x).toBeCloseTo(3.5);
    expect(at[0].x).toBe(0);
    expect(at[0].y).toBeCloseTo(3.25);
  });

  it('never overlaps two members, whatever the mix', () => {
    const sizes = [
      { width: 7, height: 1 }, sq(0.5), { width: 1, height: 6 }, sq(3), sq(3),
      { width: 12, height: 2 }, sq(0.25), sq(5), { width: 2, height: 2.5 }, sq(1),
    ];
    const at = gridPlacements(sizes, 0, 0);
    const gap = gridGap(sizes);
    for (let i = 0; i < sizes.length; i++) {
      for (let j = i + 1; j < sizes.length; j++) {
        const apartX = at[i].x + sizes[i].width + gap <= at[j].x + 1e-9
          || at[j].x + sizes[j].width + gap <= at[i].x + 1e-9;
        const apartY = at[i].y + sizes[i].height + gap <= at[j].y + 1e-9
          || at[j].y + sizes[j].height + gap <= at[i].y + 1e-9;
        expect(apartX || apartY).toBe(true);
      }
    }
  });

  it('anchors the whole grid at the origin it is given', () => {
    const at = gridPlacements([sq(1), sq(2)], 10, 20, 0);
    expect(at).toEqual([{ x: 10, y: 20 }, { x: 11, y: 20 }]);
  });

  it('keeps input order among equal heights, so re-gridding is stable', () => {
    const sizes = [sq(2), sq(2), sq(2), sq(2)];
    const first = gridPlacements(sizes, 0, 0, 0);
    expect(first).toEqual([
      { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }, { x: 2, y: 2 },
    ]);
    expect(gridPlacements(sizes, 0, 0, 0)).toEqual(first);
  });

  it('handles a partial last row and the degenerate sizes', () => {
    // n=5 → two rows, so the last row holds two.
    const p = gridPlacements([sq(1), sq(1), sq(1), sq(1), sq(1)], 0, 0, 0);
    expect(p.map((q) => q.y)).toEqual([0, 0, 0, 1, 1]);
    expect(gridPlacements([], 0, 0)).toEqual([]);
    expect(gridPlacements([sq(3)], 4, 5)).toEqual([{ x: 4, y: 5 }]);
  });
});
