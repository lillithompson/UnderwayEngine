/**
 * Regression: dragging a rectangle SVGObject (shapeKind='rectangle', no
 * lineDirection) used to snap to half-grid increments on one axis,
 * because the down-handler's snap-step picker fell back to inferring a
 * "direction" from any non-square bbox when lineDirection was absent.
 *
 * Per docs/composition_objects.md: half-grid snap is an H/V-line-only
 * rule, gated on the lineDirection field. Rectangles, joined paths,
 * and arcs use whole-cell steps on both axes.
 *
 * The picker logic now lives inline in CompositionCanvas.tsx's
 * handlePointerDown. This file mirrors that pick + dispatches
 * computeMoveSnapDelta to verify the snap outcomes the user actually
 * sees on screen — same pattern groupMixedLineMoveSnap.test.ts uses.
 */

import { computeMoveSnapDelta } from '../compositionCellMath';
import { CELL_COUNTS, GridLevel, SVGObject } from '../types';

/** Mirror of the snap-step picker in CompositionCanvas.handlePointerDown.
 *  Half-grid step on the perpendicular axis is granted only when the
 *  hit SVG carries an explicit horizontal/vertical lineDirection. */
function pickSnapSteps(hitSvg: Pick<SVGObject, 'lineDirection'> | null, gridLevel: GridLevel, soloDrag: boolean): { stepX: number; stepY: number } {
  const baseStep = 32 / CELL_COUNTS[gridLevel];
  let stepX = baseStep;
  let stepY = baseStep;
  if (soloDrag && hitSvg) {
    const dir = hitSvg.lineDirection;
    if (dir === 'horizontal') stepY = baseStep / 2;
    else if (dir === 'vertical') stepX = baseStep / 2;
  }
  return { stepX, stepY };
}

/** Run one drag tick from the rect's bbox center by raw deltas, then
 *  return the snapped delta the canvas would commit. */
function dragTick(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  rawDx: number, rawDy: number,
  stepX: number, stepY: number,
): { dx: number; dy: number } {
  const cursorX = (bbox.minX + bbox.maxX) / 2 + rawDx;
  const cursorY = (bbox.minY + bbox.maxY) / 2 + rawDy;
  const dirX = rawDx > 0 ? 1 : rawDx < 0 ? -1 : 0;
  const dirY = rawDy > 0 ? 1 : rawDy < 0 ? -1 : 0;
  return computeMoveSnapDelta(bbox, cursorX, cursorY, rawDx, rawDy, stepX, stepY, dirX, dirY);
}

describe('move-snap step selection respects lineDirection only', () => {
  // L2 step is 4 cells (32 / CELL_COUNTS[2] = 32 / 8 = 4).
  const L2: GridLevel = 2;
  const L2_STEP = 4;

  test('rectangle drag snaps to whole cells (regression: used to half-snap)', () => {
    // 4×4 rectangle starting grid-aligned at (0,0,4,4). rawDy=2.5 is past
    // the half-cell threshold but inside the whole-cell threshold: with
    // the buggy half-snap it would land at dy=2 (a half-cell move at L2),
    // with the correct whole-cell snap it lands at dy=4.
    const bbox = { minX: 0, minY: 0, maxX: 4, maxY: 4 };
    const { stepX, stepY } = pickSnapSteps({ lineDirection: undefined }, L2, true);
    const { dy } = dragTick(bbox, 0, 2.5, stepX, stepY);
    expect(dy).toBe(L2_STEP);
    // Whole bbox stays grid-aligned after the move.
    expect((bbox.minY + dy) % L2_STEP).toBe(0);
    expect((bbox.maxY + dy) % L2_STEP).toBe(0);
  });

  test('rectangle drag with non-square bbox snaps whole-cell (bbox shape doesn\'t matter)', () => {
    // 8×4 rectangle — non-square bbox is exactly the shape the buggy
    // fallback used to infer as "horizontal" and half-snap on Y.
    const bbox = { minX: 0, minY: 0, maxX: 8, maxY: 4 };
    const { stepX, stepY } = pickSnapSteps({ lineDirection: undefined }, L2, true);
    expect(stepX).toBe(L2_STEP);
    expect(stepY).toBe(L2_STEP);
    const { dy } = dragTick(bbox, 0, 2.5, stepX, stepY);
    expect(dy).toBe(L2_STEP);
  });

});
