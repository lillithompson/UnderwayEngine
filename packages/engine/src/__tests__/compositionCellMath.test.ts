import {
  screenToContainingCompCell,
  screenToNearestGridIntersection,
  snapCellToCompGrid,
  pickFigureGridLevel,
  computeMoveSnapDelta,
} from '../compositionCellMath';
import { CELL_COUNTS, GridLevel } from '../types';

// A trivial camera that maps the 32-cell-wide canvas exactly onto the
// viewport: each L0 cell is `viewport.width / 32` pixels.
const VIEWPORT = { width: 320, height: 320 };
const CAMERA = { offsetX: 0, offsetY: 0, zoom: 1 };
const PX_PER_CELL = VIEWPORT.width / 32; // 10

function pointInCell(cellIndex: number, fraction: number): number {
  // fraction is 0..1 within the cell
  return cellIndex * PX_PER_CELL + fraction * PX_PER_CELL;
}

describe('snapCellToCompGrid', () => {
  it('rounds to the nearest gridline at the level step', () => {
    expect(snapCellToCompGrid(3.4, 0)).toBe(3);
    expect(snapCellToCompGrid(3.6, 0)).toBe(4);
    expect(snapCellToCompGrid(9, 2)).toBe(8);   // step 4
    expect(snapCellToCompGrid(11, 2)).toBe(12);
  });

  it('handles sub-cell steps at negative levels', () => {
    expect(snapCellToCompGrid(1.2, -1)).toBe(1);   // step 0.5
    expect(snapCellToCompGrid(1.4, -1)).toBe(1.5);
  });

  it('snaps negative coordinates symmetrically', () => {
    expect(snapCellToCompGrid(-9, 2)).toBe(-8);
    expect(snapCellToCompGrid(-11, 2)).toBe(-12);
  });

  it('is the rounding screenToNearestGridIntersection performs', () => {
    // Under the trivial camera, screen px / PX_PER_CELL is the raw cell
    // coordinate — so the intersection helper must equal snapping that raw
    // projection. Guards the two from drifting apart.
    const rawX = 9.3;
    const rawY = 11.8;
    expect(
      screenToNearestGridIntersection(rawX * PX_PER_CELL, rawY * PX_PER_CELL, VIEWPORT, CAMERA, 2),
    ).toEqual({
      cellX: snapCellToCompGrid(rawX, 2),
      cellY: snapCellToCompGrid(rawY, 2),
    });
  });
});

describe('screenToContainingCompCell', () => {
  it('returns the same cell for touches in either half of a single cell', () => {
    const left = screenToContainingCompCell(
      pointInCell(5, 0.1), pointInCell(7, 0.1), VIEWPORT, CAMERA, 0,
    );
    const right = screenToContainingCompCell(
      pointInCell(5, 0.9), pointInCell(7, 0.9), VIEWPORT, CAMERA, 0,
    );
    expect(left).toEqual({ cellX: 5, cellY: 7, step: 1 });
    expect(right).toEqual({ cellX: 5, cellY: 7, step: 1 });
  });

  it('returns the floor cell at L0 with step 1', () => {
    const r = screenToContainingCompCell(
      pointInCell(12, 0.5), pointInCell(3, 0.5), VIEWPORT, CAMERA, 0,
    );
    expect(r).toEqual({ cellX: 12, cellY: 3, step: 1 });
  });

  it('snaps to the containing L2 cell with step 4', () => {
    // L2: step = 32 / 8 = 4. A point inside cell index 6 should snap down to 4.
    const r = screenToContainingCompCell(
      pointInCell(6, 0.5), pointInCell(11, 0.25), VIEWPORT, CAMERA, 2,
    );
    expect(r).toEqual({ cellX: 4, cellY: 8, step: 4 });
  });

  it('inclusive region including the start cell on a rightward drag', () => {
    // Start in the right half of cell 5; drag into the right half of cell 6.
    // With nearest-gridline snapping the region would have been [6, 7] (cell
    // 6 only). With containing-cell semantics it must be [5, 7) — cells 5+6.
    const start = screenToContainingCompCell(
      pointInCell(5, 0.9), pointInCell(2, 0.5), VIEWPORT, CAMERA, 0,
    );
    const end = screenToContainingCompCell(
      pointInCell(6, 0.9), pointInCell(2, 0.5), VIEWPORT, CAMERA, 0,
    );
    const region = {
      startCellX: Math.min(start.cellX, end.cellX),
      startCellY: Math.min(start.cellY, end.cellY),
      endCellX: Math.max(start.cellX, end.cellX) + start.step,
      endCellY: Math.max(start.cellY, end.cellY) + start.step,
    };
    expect(region).toEqual({ startCellX: 5, startCellY: 2, endCellX: 7, endCellY: 3 });
  });

  it('leftward drag still includes the start cell', () => {
    // Start in the left half of cell 5; drag leftward into cell 4.
    const start = screenToContainingCompCell(
      pointInCell(5, 0.1), pointInCell(2, 0.5), VIEWPORT, CAMERA, 0,
    );
    const end = screenToContainingCompCell(
      pointInCell(4, 0.1), pointInCell(2, 0.5), VIEWPORT, CAMERA, 0,
    );
    const region = {
      startCellX: Math.min(start.cellX, end.cellX),
      startCellY: Math.min(start.cellY, end.cellY),
      endCellX: Math.max(start.cellX, end.cellX) + start.step,
      endCellY: Math.max(start.cellY, end.cellY) + start.step,
    };
    // Region should span cells 4 and 5 → [4, 6).
    expect(region).toEqual({ startCellX: 4, startCellY: 2, endCellX: 6, endCellY: 3 });
  });

  it('a tap that does not move covers exactly the touched cell', () => {
    const start = screenToContainingCompCell(
      pointInCell(9, 0.4), pointInCell(9, 0.4), VIEWPORT, CAMERA, 0,
    );
    const region = {
      startCellX: start.cellX,
      startCellY: start.cellY,
      endCellX: start.cellX + start.step,
      endCellY: start.cellY + start.step,
    };
    expect(region).toEqual({ startCellX: 9, startCellY: 9, endCellX: 10, endCellY: 10 });
  });
});

describe('screenToContainingCompCell – levels 5 and 6', () => {
  it('L5 floor-snaps to multiples of 32 (step = 32)', () => {
    // Any point in [0, 32) L0 cells snaps to cellX=0, cellY=0.
    const r = screenToContainingCompCell(
      pointInCell(15, 0.5), pointInCell(20, 0.5), VIEWPORT, CAMERA, 5,
    );
    expect(r).toEqual({ cellX: 0, cellY: 0, step: 32 });
  });

  it('L6 floor-snaps to multiples of 64 (step = 64)', () => {
    const r = screenToContainingCompCell(
      pointInCell(15, 0.5), pointInCell(20, 0.5), VIEWPORT, CAMERA, 6,
    );
    expect(r).toEqual({ cellX: 0, cellY: 0, step: 64 });
  });
});

describe('screenToContainingCompCell – negative levels (sub-L0 snap)', () => {
  it('L-1 floor-snaps to multiples of 0.5 (step = 0.5)', () => {
    // L-1 step = 2^-1 = 0.5. A point at cell 5.25 snaps down to 5.0;
    // 5.75 snaps to 5.5.
    const lowHalf = screenToContainingCompCell(
      pointInCell(5, 0.25), pointInCell(0, 0), VIEWPORT, CAMERA, -1,
    );
    expect(lowHalf.cellX).toBeCloseTo(5);
    expect(lowHalf.step).toBe(0.5);
    const highHalf = screenToContainingCompCell(
      pointInCell(5, 0.75), pointInCell(0, 0), VIEWPORT, CAMERA, -1,
    );
    expect(highHalf.cellX).toBeCloseTo(5.5);
  });

  it('L-2 floor-snaps to multiples of 0.25 (step = 0.25)', () => {
    const r = screenToContainingCompCell(
      pointInCell(3, 0.6), pointInCell(0, 0), VIEWPORT, CAMERA, -2,
    );
    expect(r.cellX).toBeCloseTo(3.5);
    expect(r.step).toBe(0.25);
  });
});

describe('pickFigureGridLevel', () => {
  it('drops a 5×5 selection at L3 down to L2 (5×5 L3 = 40 L0 > 32)', () => {
    expect(pickFigureGridLevel(5, 5, 3)).toBe(2);
  });

  it('drops a 9×9 selection at L2 down to L1 (9×9 L2 = 36 L0 > 32)', () => {
    expect(pickFigureGridLevel(9, 9, 2)).toBe(1);
  });

  it('drops uniformly so aspect ratio is preserved (4×6 at L3 → L2)', () => {
    expect(pickFigureGridLevel(4, 6, 3)).toBe(2);
  });

  it('keeps the preferred level when the selection already fits', () => {
    expect(pickFigureGridLevel(1, 1, 3)).toBe(3);
    expect(pickFigureGridLevel(4, 4, 3)).toBe(3);
    expect(pickFigureGridLevel(8, 8, 2)).toBe(2);
  });

  it('returns L0 at the 32×32 boundary', () => {
    expect(pickFigureGridLevel(32, 32, 0)).toBe(0);
    expect(pickFigureGridLevel(32, 32, 3)).toBe(0);
  });

  it('drops to floor for extreme asymmetric selections (1×32 at L3 → L0)', () => {
    expect(pickFigureGridLevel(1, 32, 3)).toBe(0);
    expect(pickFigureGridLevel(32, 1, 3)).toBe(0);
  });

  it('result always satisfies the 32 L0 file budget', () => {
    // Drag clamp allows up to 32 cells at any current grid level, so cover
    // 1..32 selections for every preferredLevel.
    for (let lvl = 0; lvl <= 3; lvl++) {
      for (let w = 1; w <= 32; w++) {
        for (let h = 1; h <= 32; h++) {
          const out = pickFigureGridLevel(w, h, lvl as GridLevel);
          const step = 32 / CELL_COUNTS[out];
          expect(w * step).toBeLessThanOrEqual(32);
          expect(h * step).toBeLessThanOrEqual(32);
          expect(out).toBeLessThanOrEqual(lvl);
        }
      }
    }
  });

  it('caps at MAX_LAYER_LEVEL when preferred is 5 or 6', () => {
    // A 4×4 selection fits at L3 (CELL_COUNTS[3]=4 >= 4). Even though
    // preferred is 5 or 6, the result never exceeds 4.
    expect(pickFigureGridLevel(4, 4, 5)).toBe(3);
    expect(pickFigureGridLevel(4, 4, 6)).toBe(3);
    expect(pickFigureGridLevel(2, 2, 5)).toBe(4);
    expect(pickFigureGridLevel(2, 2, 6)).toBe(4);
    expect(pickFigureGridLevel(16, 16, 5)).toBe(1);
    expect(pickFigureGridLevel(16, 16, 6)).toBe(1);
  });

  it('never returns a level above MAX_LAYER_LEVEL', () => {
    for (let lvl = 0; lvl <= 6; lvl++) {
      for (let dim = 1; dim <= 32; dim++) {
        const out = pickFigureGridLevel(dim, dim, lvl as GridLevel);
        expect(out).toBeLessThanOrEqual(4);
      }
    }
  });

  // The Composer's Create tool always passes preferredLevel=2 so the dragged
  // cell count maps directly to L2 cells in the new file, regardless of the
  // composition's current grid level. L1 fallback kicks in above 8 cells.
  it('create-tool intent: ≤8 cells → L2, 9–16 cells → L1', () => {
    expect(pickFigureGridLevel(1, 1, 2)).toBe(2);
    expect(pickFigureGridLevel(4, 4, 2)).toBe(2);
    expect(pickFigureGridLevel(8, 8, 2)).toBe(2);
    expect(pickFigureGridLevel(9, 9, 2)).toBe(1);
    expect(pickFigureGridLevel(16, 16, 2)).toBe(1);
  });
});

describe('computeMoveSnapDelta', () => {
  // Helper: a degenerate bbox at a single point — recovers the pre-directional
  // (lower-left) snap behavior, since min/max collapse on each axis. Used by
  // the carry-over tests that pre-date directional snap.
  const pt = (x: number, y: number) => ({ minX: x, minY: y, maxX: x, maxY: y });
  // Carry-over tests treat sign(rawD) as the committed direction — they
  // pre-date the canvas-side direction tracking and just exercise the
  // snap math.
  const sgn = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);

  it('zero delta on an already-aligned anchor leaves position unchanged', () => {
    // Integer anchor + zero raw delta → no shift, no realignment pull.
    const r = computeMoveSnapDelta(pt(4, 8), 4, 8, 0, 0, 1, 1, 0, 0);
    expect(r).toEqual({ dx: 0, dy: 0 });
  });

  it('snaps the anchor to the nearest grid step', () => {
    // step=2 (L1), anchor at (4, 6). With rawDx=0.9 the anchor would land
    // at 4.9 — closer to 4 than 6 — so dx=0 (no shift). Cursor on the anchor
    // keeps the cell-containment clamp from firing.
    const r = computeMoveSnapDelta(pt(4, 6), 4, 6, 0.9, -0.9, 2, 2, sgn(0.9), sgn(-0.9));
    expect(r).toEqual({ dx: 0, dy: 0 });

    // rawDx=1.1 pushes the anchor past the half-step toward 6, snap dx=2.
    const r2 = computeMoveSnapDelta(pt(4, 6), 4, 6, 1.1, 1.1, 2, 2, 1, 1);
    expect(r2).toEqual({ dx: 2, dy: 2 });
  });

  it('pulls a fractional anchor onto the grid even with zero raw delta', () => {
    // Group with a 1.5x scale leaves bbox edges at (1.5, 7.5). The first
    // move tick past the tap threshold should realign both axes — the
    // delta is whatever lands the anchor on the nearest grid step.
    const r = computeMoveSnapDelta(pt(1.5, 7.5), 1.5, 7.5, 0, 0, 1, 1, 0, 0);
    // round(1.5) = 2 in JS (Math.round rounds .5 toward +Inf).
    expect(r.dx).toBeCloseTo(0.5);
    expect(r.dy).toBeCloseTo(0.5);
  });

  it('produces deltas that land the leading edge exactly on a grid step', () => {
    // Property: for any width/height/raw-delta combo, the leading edge after
    // snap (maxX if dir>0 else minX, maxY if dir>0 else minY) is an integer
    // multiple of the respective step.
    for (const step of [1, 2, 4, 8]) {
      for (const ax of [0, 1.3, -2.7, 5.5, 9.999]) {
        for (const ay of [0, 0.5, 7.25, -3.1, 11.7]) {
          for (const w of [0, 1, 3.7]) {
            for (const h of [0, 1, 2.5]) {
              for (const rdx of [-3, -0.4, 0, 0.6, 4.2]) {
                for (const rdy of [-2, -0.1, 0, 0.9, 3.4]) {
                  const bb = { minX: ax, minY: ay, maxX: ax + w, maxY: ay + h };
                  const dirX = sgn(rdx), dirY = sgn(rdy);
                  const cursorX = dirX > 0 ? bb.maxX : bb.minX;
                  const cursorY = dirY > 0 ? bb.maxY : bb.minY;
                  const { dx, dy } = computeMoveSnapDelta(bb, cursorX, cursorY, rdx, rdy, step, step, dirX, dirY);
                  const leadingX = (dirX > 0 ? bb.maxX : bb.minX) + dx;
                  const leadingY = (dirY > 0 ? bb.maxY : bb.minY) + dy;
                  expect(leadingX / step).toBeCloseTo(Math.round(leadingX / step));
                  expect(leadingY / step).toBeCloseTo(Math.round(leadingY / step));
                }
              }
            }
          }
        }
      }
    }
  });

  it('snaps X and Y independently when stepX !== stepY', () => {
    // Horizontal-line drag at L1: stepX=2 (full grid), stepY=1 (half grid).
    // rawDx=0.6 lands x at 4.6, closer to 4 → dx=0. rawDy=0.6 lands y at 6.6,
    // closer to 7 → dy=1.
    const r = computeMoveSnapDelta(pt(4, 6), 4, 6, 0.6, 0.6, 2, 1, 1, 1);
    expect(r).toEqual({ dx: 0, dy: 1 });
  });

  it('half-step snap pulls a fractional anchor onto a sub-grid boundary', () => {
    // Vertical-line at L0 dragged horizontally: stepX=0.5, stepY=1.
    // Anchor X = 4.25 with zero rawDx should pull onto 4.5 (nearest 0.5).
    const r = computeMoveSnapDelta(pt(4.25, 8), 4.25, 8, 0, 0, 0.5, 1, 0, 0);
    expect(r.dx).toBeCloseTo(0.25);
    expect(r.dy).toBeCloseTo(0);
  });

  it('L0 horizontal-line: stepY=0.5 produces half-cell Y movement', () => {
    // Anchor at (3, 5), tiny X drag, Y drag of 0.4 cells.
    // stepX=1 keeps X locked (rawDx=0.4 stays under 0.5 half-step).
    // stepY=0.5 sends Y to 5.5.
    const r = computeMoveSnapDelta(pt(3, 5), 3, 5, 0.4, 0.4, 1, 0.5, 1, 1);
    expect(r).toEqual({ dx: 0, dy: 0.5 });
  });

  it('negative deltas snap correctly with asymmetric steps', () => {
    // Vertical-line at L1: stepX=1 (half), stepY=2 (full).
    // rawDx=-1.6 from anchor 4 lands at 2.4, snap to 2 → dx=-2.
    // rawDy=-0.4 from anchor 8 lands at 7.6, snap to 8 → dy=0.
    const r = computeMoveSnapDelta(pt(4, 8), 4, 8, -1.6, -0.4, 1, 2, -1, -1);
    expect(r).toEqual({ dx: -2, dy: 0 });
  });

  describe('directional leading-edge snap', () => {
    // bbox is 3 wide on a step=2 grid → minX=4 (on grid), maxX=7 (off grid).
    // Whichever edge leads must end on a multiple of 2.
    const bbox = { minX: 4, minY: 4, maxX: 7, maxY: 7 };

    it('rightward motion snaps the right edge (maxX) to the grid', () => {
      // rawDx=0.4 → leading edge maxX=7 lands at 7.4, rounds to 8 → dx=1.
      const r = computeMoveSnapDelta(bbox, bbox.maxX, bbox.maxY, 0.4, 0, 2, 2, 1, 0);
      expect(r.dx).toBe(1);
      expect(bbox.maxX + r.dx).toBe(8);
    });

    it('leftward motion snaps the left edge (minX) to the grid', () => {
      // rawDx=-0.4 → leading edge minX=4 lands at 3.6, rounds to 4 → dx=0.
      // The right edge stays off-grid; the left edge stays on-grid. Good.
      const r = computeMoveSnapDelta(bbox, bbox.minX, bbox.maxY, -0.4, 0, 2, 2, -1, 0);
      expect(r.dx).toBe(0);
      expect(bbox.minX + r.dx).toBe(4);
    });

    it('downward motion snaps the bottom edge (maxY) to the grid', () => {
      const r = computeMoveSnapDelta(bbox, bbox.minX, bbox.maxY, 0, 0.4, 2, 2, 0, 1);
      expect(r.dy).toBe(1);
      expect(bbox.maxY + r.dy).toBe(8);
    });

    it('upward motion snaps the top edge (minY) to the grid', () => {
      const r = computeMoveSnapDelta(bbox, bbox.minX, bbox.minY, 0, -0.4, 2, 2, 0, -1);
      expect(r.dy).toBe(0);
      expect(bbox.minY + r.dy).toBe(4);
    });

    it('diagonal motion snaps both axes to their respective leading edges', () => {
      // Down-right: snap (maxX, maxY). Up-left: snap (minX, minY).
      const dr = computeMoveSnapDelta(bbox, bbox.maxX, bbox.maxY, 0.4, 0.4, 2, 2, 1, 1);
      expect(bbox.maxX + dr.dx).toBe(8);
      expect(bbox.maxY + dr.dy).toBe(8);

      const ul = computeMoveSnapDelta(bbox, bbox.minX, bbox.minY, -0.4, -0.4, 2, 2, -1, -1);
      expect(bbox.minX + ul.dx).toBe(4);
      expect(bbox.minY + ul.dy).toBe(4);
    });
  });

  describe('object smaller than a cell lands in any of 4 interior corners', () => {
    // A 0.5×0.5 object centered in an 8-unit cell at (3.5..4, 3.5..4). On a
    // step=8 grid only x=0 and x=8 (and y=0, y=8) are grid lines. Dragging
    // toward any corner takes the leading edges past the cell midpoint and
    // commits the matching corner.
    const bbox = { minX: 3.5, minY: 3.5, maxX: 4, maxY: 4 };
    const step = 8;

    it('down-right drag snaps to the bottom-right interior corner', () => {
      const r = computeMoveSnapDelta(bbox, bbox.maxX, bbox.maxY, 1, 1, step, step, 1, 1);
      expect(bbox.maxX + r.dx).toBe(8);
      expect(bbox.maxY + r.dy).toBe(8);
      expect(bbox.minX + r.dx).toBe(7.5);
      expect(bbox.minY + r.dy).toBe(7.5);
    });

    it('down-left drag snaps to the bottom-left interior corner', () => {
      const r = computeMoveSnapDelta(bbox, bbox.minX, bbox.maxY, -1, 1, step, step, -1, 1);
      expect(bbox.minX + r.dx).toBe(0);
      expect(bbox.maxY + r.dy).toBe(8);
      expect(bbox.maxX + r.dx).toBe(0.5);
      expect(bbox.minY + r.dy).toBe(7.5);
    });

    it('up-right drag snaps to the top-right interior corner', () => {
      const r = computeMoveSnapDelta(bbox, bbox.maxX, bbox.minY, 1, -1, step, step, 1, -1);
      expect(bbox.maxX + r.dx).toBe(8);
      expect(bbox.minY + r.dy).toBe(0);
      expect(bbox.minX + r.dx).toBe(7.5);
      expect(bbox.maxY + r.dy).toBe(0.5);
    });

    it('up-left drag snaps to the top-left interior corner', () => {
      const r = computeMoveSnapDelta(bbox, bbox.minX, bbox.minY, -1, -1, step, step, -1, -1);
      expect(bbox.minX + r.dx).toBe(0);
      expect(bbox.minY + r.dy).toBe(0);
      expect(bbox.maxX + r.dx).toBe(0.5);
      expect(bbox.maxY + r.dy).toBe(0.5);
    });
  });

  describe('cell-containment clamp: object never jumps to a cell the cursor is not in', () => {
    // Regression: after the canvas rebases on a direction flip, the bbox
    // can land with its new leading edge a fraction shy of the next grid
    // line. `Math.round` would otherwise pull that edge across the line
    // and dump the object into a cell the cursor isn't in. The clamp
    // bounds the snap target to the cursor's cell wall in the motion
    // direction.

    it('post-rebase leftward motion keeps a small object in the cursor cell', () => {
      // Mirrors the canvas after: drag right → object lands at (7.5..8) in
      // cell (0..8); reverse direction → rebase folds the snapped position
      // into the new origin, leaving bbox = (7.5..8). The cursor is still
      // at x=3.5, inside cell (0..8). Without the clamp the leading edge
      // minX=7.5 rounds to 8 and the object jumps to (8..8.5) in cell
      // (8..16). The clamp pulls it back to (0..0.5).
      const bbox = { minX: 7.5, minY: 7.5, maxX: 8, maxY: 8 };
      const r = computeMoveSnapDelta(bbox, 3.5, 3.5, -0.5, -0.5, 8, 8, -1, -1);
      expect(bbox.minX + r.dx).toBe(0);
      expect(bbox.maxX + r.dx).toBe(0.5);
      expect(bbox.minY + r.dy).toBe(0);
      expect(bbox.maxY + r.dy).toBe(0.5);
    });

    it('cursor crossing into a new cell pulls the object along', () => {
      // Object at (3.5..4) in cell (0..8). Cursor has moved past x=8 into
      // cell (8..16). The Math.round target on maxX=4 would lag at 8
      // (object stays at (7.5..8) in the old cell); the clamp advances
      // the leading edge to the cursor's cell right wall x=16.
      const bbox = { minX: 3.5, minY: 3.5, maxX: 4, maxY: 4 };
      const r = computeMoveSnapDelta(bbox, 9, 9, 5, 5, 8, 8, 1, 1);
      expect(bbox.maxX + r.dx).toBe(16);
      expect(bbox.maxY + r.dy).toBe(16);
      expect(bbox.minX + r.dx).toBe(15.5);
      expect(bbox.minY + r.dy).toBe(15.5);
    });
  });

  describe('orthogonal-axis stability: an uncommitted axis does not flicker', () => {
    // Regression: with `sign(rawDy)` inferring direction, touch jitter on the
    // idle axis flipped the snap target every frame — a small object
    // dragged purely horizontally bounced between the top and bottom of
    // its cell. With `dirY=0` the snap falls back to the lower-left
    // anchor and the Y axis is stable regardless of rawDy noise.

    it('idle Y axis: tiny rawDy noise produces the same dy across signs', () => {
      // A small object at (3.5..4, 3.5..4) on step=8. User drags purely
      // right; on different frames rawDy oscillates around 0 with touch
      // jitter. The Y delta must be identical regardless of rawDy's sign.
      const bbox = { minX: 3.5, minY: 3.5, maxX: 4, maxY: 4 };
      const a = computeMoveSnapDelta(bbox, 5, 3.78, 1.25, 0.03, 8, 8, 1, 0);
      const b = computeMoveSnapDelta(bbox, 5, 3.72, 1.25, -0.03, 8, 8, 1, 0);
      expect(a.dy).toBe(b.dy);
    });

    it('idle X axis: tiny rawDx noise produces the same dx across signs', () => {
      const bbox = { minX: 3.5, minY: 3.5, maxX: 4, maxY: 4 };
      const a = computeMoveSnapDelta(bbox, 3.78, 5, 0.03, 1.25, 8, 8, 0, 1);
      const b = computeMoveSnapDelta(bbox, 3.72, 5, -0.03, 1.25, 8, 8, 0, 1);
      expect(a.dx).toBe(b.dx);
    });
  });
});
