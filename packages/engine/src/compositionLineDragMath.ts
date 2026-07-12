/**
 * Snap math for the Line tool's drag-to-draw gesture. The drag is
 * constrained to 8 directions (multiples of 45°) and each new vertex
 * snaps to a grid intersection along the locked ray.
 */

const TAU = Math.PI * 2;
const STEP_RAD = Math.PI / 4;

/**
 * Snap an angle (radians) to the nearest 45° bucket and return an
 * integer 0..7 where:
 *   0 = east (+x), 1 = south-east, 2 = south (+y, screen y-down),
 *   3 = south-west, 4 = west, 5 = north-west, 6 = north (-y), 7 = north-east.
 *
 * Integer comparison avoids float-equality fragility when detecting
 * direction changes during a drag.
 */
export function snapAngleIndex(angleRad: number): number {
  // Wrap to [0, 2π) so Math.round produces a non-negative result.
  let a = angleRad % TAU;
  if (a < 0) a += TAU;
  const idx = Math.round(a / STEP_RAD) % 8;
  return idx;
}

/** Unit vector for a 0..7 angle index (y-down screen coords). */
export function angleIndexToUnitVector(idx: number): { ux: number; uy: number } {
  const theta = idx * STEP_RAD;
  return { ux: Math.cos(theta), uy: Math.sin(theta) };
}

/**
 * Project the cursor onto the ray from `(anchorX, anchorY)` along the
 * direction identified by `angleIndex`, then snap the projected
 * distance to the grid lattice.
 *
 * - Cardinal directions (0, 2, 4, 6) advance one axis by `gridStep`
 *   per step; the orthogonal axis stays at the anchor's value.
 * - Diagonal directions (1, 3, 5, 7) advance both axes by `gridStep`
 *   per step; along-ray spacing is `gridStep * √2`.
 *
 * The projection is clamped to ≥ 0 so a cursor behind the anchor
 * collapses the trailing vertex back onto the anchor (a degenerate
 * zero-length segment, dropped at finalize-time by dedupe).
 *
 * Pre-condition: the anchor itself lies on a grid intersection. The
 * caller (canvas pointer-down) ensures this via
 * `screenToNearestGridIntersection`.
 */
export function snapDragVertex(
  anchorX: number, anchorY: number,
  cursorX: number, cursorY: number,
  angleIndex: number,
  gridStep: number,
): [number, number] {
  const { ux, uy } = angleIndexToUnitVector(angleIndex);
  // Signed projection of (cursor - anchor) onto the unit ray.
  const t = (cursorX - anchorX) * ux + (cursorY - anchorY) * uy;
  const isDiagonal = (angleIndex & 1) === 1;
  const tStep = isDiagonal ? gridStep * Math.SQRT2 : gridStep;
  const snappedT = Math.max(0, Math.round(t / tStep) * tStep);
  return [anchorX + snappedT * ux, anchorY + snappedT * uy];
}
