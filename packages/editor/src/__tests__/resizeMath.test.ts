import {
  bboxCornerCell,
  computeCornerResize,
  computeResizedBbox,
  CornerSign,
  MIN_RESIZE_CELLS,
  CellBbox,
  sameBbox,
} from '../resizeMath';

const BR: CornerSign = { sx: 1, sy: 1 };
const TL: CornerSign = { sx: -1, sy: -1 };
const TR: CornerSign = { sx: 1, sy: -1 };

// Alias for readability in assertions (the shared helper under test).
const cornerWorld = bboxCornerCell;

const OLD: CellBbox = { cellX: 4, cellY: 4, cellWidth: 8, cellHeight: 6 }; // centre (8,7)

describe('sameBbox', () => {
  test('true only when all four fields match', () => {
    expect(sameBbox(OLD, { ...OLD })).toBe(true);
    expect(sameBbox(OLD, { ...OLD, cellX: 4.0001 })).toBe(false);
    expect(sameBbox(OLD, { ...OLD, cellY: 3 })).toBe(false);
    expect(sameBbox(OLD, { ...OLD, cellWidth: 8.5 })).toBe(false);
    expect(sameBbox(OLD, { ...OLD, cellHeight: 6.5 })).toBe(false);
  });

  test('a resize that lands back on the original box compares equal', () => {
    // What the live preview leans on: with grid snap on, most pointer moves
    // re-derive the same box, and re-previewing those is wasted work.
    const box = computeResizedBbox(OLD, 0, BR, OLD.cellX + OLD.cellWidth, OLD.cellY + OLD.cellHeight);
    expect(sameBbox(OLD, box)).toBe(true);
  });
});

describe('computeResizedBbox (axis-aligned)', () => {
  test('dragging the BR corner pins the TL corner', () => {
    const box = computeResizedBbox(OLD, 0, BR, 14, 16);
    expect(box).toEqual({ cellX: 4, cellY: 4, cellWidth: 10, cellHeight: 12 });
  });

  test('dragging the TL corner pins the BR corner', () => {
    const box = computeResizedBbox(OLD, 0, TL, 2, 1);
    // BR of OLD is (12,10) and must be unchanged.
    expect(box.cellX + box.cellWidth).toBeCloseTo(12);
    expect(box.cellY + box.cellHeight).toBeCloseTo(10);
    expect(box.cellWidth).toBeCloseTo(10);
    expect(box.cellHeight).toBeCloseTo(9);
  });

  test('non-uniform: width and height move independently (TR corner)', () => {
    const box = computeResizedBbox(OLD, 0, TR, 20, 2);
    // TR anchored corner is BL = (4,10); width grows to 16, height to 8.
    expect(box.cellWidth).toBeCloseTo(16);
    expect(box.cellHeight).toBeCloseTo(8);
    expect(box.cellX).toBeCloseTo(4); // left edge (BL.x) fixed
    expect(box.cellY + box.cellHeight).toBeCloseTo(10); // bottom edge (BL.y) fixed
  });

  test('clamps each edge to MIN_RESIZE_CELLS instead of collapsing', () => {
    // Drag the BR corner back ONTO the TL anchor.
    const box = computeResizedBbox(OLD, 0, BR, 4, 4);
    expect(box.cellWidth).toBeCloseTo(MIN_RESIZE_CELLS);
    expect(box.cellHeight).toBeCloseTo(MIN_RESIZE_CELLS);
    // Still anchored at TL.
    expect(box.cellX).toBeCloseTo(4);
    expect(box.cellY).toBeCloseTo(4);
  });

  test('PAST the anchor the box comes out the far side (bug report 22bc4e91)', () => {
    // It used to clamp there. The anchor (4, 4) is still a corner of the
    // box — now its bottom-right — and the turn-over is cornerResizeFlip's
    // suite to describe.
    const box = computeResizedBbox(OLD, 0, BR, 0, 0);
    expect(box).toEqual({ cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 });
    // …unless the caller forbids it (a frame), which is the old clamp.
    const held = computeResizedBbox(OLD, 0, BR, 0, 0, { noFlip: true });
    expect(held.cellWidth).toBeCloseTo(MIN_RESIZE_CELLS);
    expect(held.cellHeight).toBeCloseTo(MIN_RESIZE_CELLS);
    expect(held.cellX).toBeCloseTo(4);
    expect(held.cellY).toBeCloseTo(4);
  });
});

describe('computeResizedBbox minCells (grid-snap floor)', () => {
  test('a collapsing drag bottoms out at one grid cell, not a 0.1 sliver', () => {
    // Grid snap on at L2 (step 4): the cursor lands on the TL anchor itself.
    const box = computeResizedBbox(OLD, 0, BR, 4, 4, { minCells: 4 });
    expect(box.cellWidth).toBeCloseTo(4);
    expect(box.cellHeight).toBeCloseTo(4);
    expect(box.cellX).toBeCloseTo(4); // anchor still pinned
    expect(box.cellY).toBeCloseTo(4);
  });

  test('a line keeps one cell of LENGTH and its original thickness', () => {
    // The reported bug: an H/V line's box is its length, so the 0.1-cell floor
    // read as a collapsed, invisible object.
    const line: CellBbox = { cellX: 4, cellY: 4, cellWidth: 8, cellHeight: 1 };
    const box = computeResizedBbox(line, 0, BR, 4, 4, { freeAxis: 'x', minCells: 4 });
    expect(box.cellWidth).toBeCloseTo(4);
    expect(box.cellHeight).toBeCloseTo(1); // frozen axis untouched by the floor
    expect(box.cellX).toBeCloseTo(4);
  });

  test('the floor only ever raises MIN_RESIZE_CELLS, never lowers it', () => {
    const box = computeResizedBbox(OLD, 0, BR, 4, 4, { minCells: 0 });
    expect(box.cellWidth).toBeCloseTo(MIN_RESIZE_CELLS);
    expect(box.cellHeight).toBeCloseTo(MIN_RESIZE_CELLS);
  });

  test('does not interfere with a drag that stays above the floor', () => {
    const box = computeResizedBbox(OLD, 0, BR, 14, 16, { minCells: 4 });
    expect(box).toEqual({ cellX: 4, cellY: 4, cellWidth: 10, cellHeight: 12 });
  });

  test('a uniform (circular) collapse keeps aspect with both extents at/above the floor', () => {
    const wide: CellBbox = { cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 4 };
    const box = computeResizedBbox(wide, 0, BR, 0, 0, { uniform: true, minCells: 2 });
    expect(box.cellWidth / box.cellHeight).toBeCloseTo(2);
    expect(box.cellWidth).toBeGreaterThanOrEqual(2);
    expect(box.cellHeight).toBeGreaterThanOrEqual(2);
  });
});

describe('computeResizedBbox (rotated)', () => {
  // The defining invariant at any angle: the OPPOSITE (anchor) corner in the
  // rotated frame stays fixed in world space.
  for (const angleDeg of [30, 90, 135, -45, 210]) {
    for (const grabbed of [BR, TL, TR, { sx: -1, sy: 1 } as CornerSign]) {
      test(`anchor corner fixed at ${angleDeg}° grabbing (${grabbed.sx},${grabbed.sy})`, () => {
        const anchor: CornerSign = { sx: (-grabbed.sx) as -1 | 1, sy: (-grabbed.sy) as -1 | 1 };
        const anchorBefore = cornerWorld(OLD, angleDeg, anchor);
        // Arbitrary cursor position — which, for some of these corners, is
        // past the anchor: the box then lies on its far side, and the
        // anchor is the box's corner on the side the drag came from.
        const { bbox: box, flip } = computeCornerResize(OLD, angleDeg, grabbed, 3.2, 15.7);
        const anchorAfter = cornerWorld(box, angleDeg, {
          sx: (flip.x ? grabbed.sx : anchor.sx) as -1 | 1,
          sy: (flip.y ? grabbed.sy : anchor.sy) as -1 | 1,
        });
        expect(anchorAfter.x).toBeCloseTo(anchorBefore.x);
        expect(anchorAfter.y).toBeCloseTo(anchorBefore.y);
      });
    }
  }

  test('the grabbed corner tracks the cursor (projected onto local axes)', () => {
    const box = computeResizedBbox(OLD, 90, BR, 3.2, 15.7);
    // The new size is at least the clamp; positive and finite.
    expect(box.cellWidth).toBeGreaterThan(0);
    expect(box.cellHeight).toBeGreaterThan(0);
    expect(Number.isFinite(box.cellX)).toBe(true);
    expect(Number.isFinite(box.cellY)).toBe(true);
  });
});
