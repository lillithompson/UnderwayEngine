import {
  snapAngleIndex,
  angleIndexToUnitVector,
  snapDragVertex,
} from '../compositionLineDragMath';

const D = (deg: number) => (deg * Math.PI) / 180;

describe('snapAngleIndex', () => {
  test('axis-aligned angles map to their bucket', () => {
    expect(snapAngleIndex(D(0))).toBe(0);    // east
    expect(snapAngleIndex(D(45))).toBe(1);   // south-east
    expect(snapAngleIndex(D(90))).toBe(2);   // south
    expect(snapAngleIndex(D(135))).toBe(3);  // south-west
    expect(snapAngleIndex(D(180))).toBe(4);  // west
    expect(snapAngleIndex(D(225))).toBe(5);  // north-west
    expect(snapAngleIndex(D(270))).toBe(6);  // north
    expect(snapAngleIndex(D(315))).toBe(7);  // north-east
  });

  test('negative angles wrap into [0,7]', () => {
    // -45° == 315° == NE bucket
    expect(snapAngleIndex(D(-45))).toBe(7);
    expect(snapAngleIndex(D(-90))).toBe(6);
    expect(snapAngleIndex(D(-135))).toBe(5);
  });

  test('input near a bucket boundary rounds to the nearest bucket', () => {
    // 22.5° is exactly between east (0) and south-east (1) — Math.round
    // breaks the tie toward the higher index in JS.
    expect(snapAngleIndex(D(20))).toBe(0);
    expect(snapAngleIndex(D(25))).toBe(1);
    expect(snapAngleIndex(D(67))).toBe(1);
    expect(snapAngleIndex(D(70))).toBe(2);
  });

  test('inputs > 360° wrap', () => {
    expect(snapAngleIndex(D(360))).toBe(0);
    expect(snapAngleIndex(D(405))).toBe(1);
    expect(snapAngleIndex(D(720 + 90))).toBe(2);
  });
});

describe('angleIndexToUnitVector', () => {
  test('cardinal directions are exact unit vectors', () => {
    expect(angleIndexToUnitVector(0)).toEqual({ ux: 1, uy: 0 });          // east
    const south = angleIndexToUnitVector(2);
    expect(south.ux).toBeCloseTo(0);
    expect(south.uy).toBeCloseTo(1);
    const west = angleIndexToUnitVector(4);
    expect(west.ux).toBeCloseTo(-1);
    expect(west.uy).toBeCloseTo(0);
    const north = angleIndexToUnitVector(6);
    expect(north.ux).toBeCloseTo(0);
    expect(north.uy).toBeCloseTo(-1);
  });

  test('diagonal directions are √2/2 components', () => {
    const halfRoot2 = Math.SQRT1_2;
    const se = angleIndexToUnitVector(1);
    expect(se.ux).toBeCloseTo(halfRoot2);
    expect(se.uy).toBeCloseTo(halfRoot2);
    const nw = angleIndexToUnitVector(5);
    expect(nw.ux).toBeCloseTo(-halfRoot2);
    expect(nw.uy).toBeCloseTo(-halfRoot2);
  });
});

describe('snapDragVertex', () => {
  const STEP = 1;
  const ANCHOR_X = 5;
  const ANCHOR_Y = 7;

  test('east cardinal: trailing slides along +x in step increments', () => {
    // Cursor at (5+3.4, 7) → 3.4 / 1 → round 3 → trailing at (8, 7).
    expect(snapDragVertex(ANCHOR_X, ANCHOR_Y, ANCHOR_X + 3.4, ANCHOR_Y, 0, STEP)).toEqual([8, 7]);
    // Cursor at (5+3.7, 7) → rounds up to 4 → (9, 7).
    expect(snapDragVertex(ANCHOR_X, ANCHOR_Y, ANCHOR_X + 3.7, ANCHOR_Y, 0, STEP)).toEqual([9, 7]);
  });

  test('south cardinal: trailing slides along +y', () => {
    expect(snapDragVertex(ANCHOR_X, ANCHOR_Y, ANCHOR_X, ANCHOR_Y + 2.6, 2, STEP)).toEqual([5, 10]);
  });

  test('south-east diagonal lands on lattice points (both axes step by gridStep)', () => {
    // Diagonal step length = √2. Cursor 4 cells diagonally out:
    // along-ray distance ≈ 4√2; round(4√2 / √2) = 4 → 4 steps each axis.
    const cursorX = ANCHOR_X + 4;
    const cursorY = ANCHOR_Y + 4;
    expect(snapDragVertex(ANCHOR_X, ANCHOR_Y, cursorX, cursorY, 1, STEP)).toEqual([9, 11]);
  });

  test('cursor behind the anchor clamps the projection to 0', () => {
    // East ray, cursor to the west → projection negative → clamped to 0
    // → trailing collapses onto the anchor.
    expect(snapDragVertex(ANCHOR_X, ANCHOR_Y, ANCHOR_X - 5, ANCHOR_Y, 0, STEP)).toEqual([5, 7]);
    // SE ray, cursor to the NW → same.
    expect(snapDragVertex(ANCHOR_X, ANCHOR_Y, ANCHOR_X - 3, ANCHOR_Y - 3, 1, STEP)).toEqual([5, 7]);
  });

  test('off-axis cursor projects onto the locked ray, then snaps', () => {
    // East ray, cursor 5 cells right but 2 cells down. Projection onto
    // east ray = 5 (the +x component). Snap → trailing (10, 7), not
    // (10, 9). The diagonal information is intentionally lost — that's
    // how directional locking works.
    expect(snapDragVertex(ANCHOR_X, ANCHOR_Y, ANCHOR_X + 5, ANCHOR_Y + 2, 0, STEP)).toEqual([10, 7]);
  });

  test('coarser grid step gives coarser snaps', () => {
    // Cardinal east, step=4. Cursor 5 cells east: round(5/4)=1 → trailing
    // 4 cells east of anchor, NOT 5.
    expect(snapDragVertex(0, 0, 5, 0, 0, 4)).toEqual([4, 0]);
    // Cursor 6.5 cells east: round(6.5/4)=2 → trailing 8 cells east.
    expect(snapDragVertex(0, 0, 6.5, 0, 0, 4)).toEqual([8, 0]);
  });
});
