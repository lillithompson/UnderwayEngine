/**
 * The Line tool places a vertex at the clicked grid intersection — not at
 * the top-left of the containing cell (which is what figure placement
 * uses). These tests pin down the snap behavior with the same math the
 * canvas uses for the Line tool.
 */
import { screenToNearestGridIntersection as screenToCompCell } from '../compositionCellMath';

const VIEWPORT = { width: 800, height: 800 };
const CAMERA = { offsetX: 0, offsetY: 0, zoom: 1 };

describe('Line vertex snap (round-to-nearest-intersection)', () => {
  // gridLevel 0 → step = 32/32 = 1 cell. screenToCompCell rounds to the
  // nearest grid intersection. Viewport is 800×800 with zoom 1 and
  // offset 0, so the canvas spans 32 L0 cells = 25 px per cell.
  const PX_PER_CELL = VIEWPORT.width / 32; // 25

  test('click in middle of a cell snaps to the nearer corner', () => {
    // Click at screen px (25 * 5.4) ≈ 135 → cell 5.4 → rounds to 5.
    const v = screenToCompCell(5.4 * PX_PER_CELL, 0, VIEWPORT, CAMERA, 0);
    expect(v.cellX).toBe(5);
  });

  test('click past the half-cell snaps to the next intersection', () => {
    // Click at cell 5.6 → rounds up to 6.
    const v = screenToCompCell(5.6 * PX_PER_CELL, 0, VIEWPORT, CAMERA, 0);
    expect(v.cellX).toBe(6);
  });

  test('click exactly on a grid intersection lands on it', () => {
    const v = screenToCompCell(7 * PX_PER_CELL, 3 * PX_PER_CELL, VIEWPORT, CAMERA, 0);
    expect(v.cellX).toBe(7);
    expect(v.cellY).toBe(3);
  });

  test('coarser grid level snaps to a coarser step', () => {
    // gridLevel 2 → step = 32/8 = 4 L0 cells. A click at cell 5 should
    // snap to either 4 or 8 depending on which is closer; cell 5 is
    // closer to 4.
    const v = screenToCompCell(5 * PX_PER_CELL, 0, VIEWPORT, CAMERA, 2);
    expect(v.cellX).toBe(4);
    // And a click at cell 7 snaps to 8.
    const v2 = screenToCompCell(7 * PX_PER_CELL, 0, VIEWPORT, CAMERA, 2);
    expect(v2.cellX).toBe(8);
  });

  test('vertex never lands more than half a step from the click', () => {
    // Property check: for any click in [0, 32), the rounded vertex is
    // within 0.5 cells of the click position. (Half-step = 0.5 at L0.)
    for (let raw = 0; raw < 32; raw += 0.13) {
      const v = screenToCompCell(raw * PX_PER_CELL, 0, VIEWPORT, CAMERA, 0);
      expect(Math.abs(v.cellX - raw)).toBeLessThanOrEqual(0.5);
    }
  });
});
