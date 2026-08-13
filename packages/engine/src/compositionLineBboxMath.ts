import { PathSegment } from './types';

export type LineDirection = 'horizontal' | 'vertical' | 'diagonal';

/** 15 degrees: the default axis zone, wide enough to draw a clean H/V line
 *  freehand but leaving a 60-degree band in the middle for free-angle
 *  diagonals (Facet's zones). */
export const AXIS_ZONE_RAD = Math.PI / 12;

/** 22.5 degrees: the zone that makes the three answers the NEAREST multiple of
 *  45 degrees — the axis zones and the diagonal band meet exactly halfway
 *  between H/V and the diagonal, with no free-angle band left over. For
 *  callers that go on to force the line onto that exact angle. */
export const OCTANT_ZONE_RAD = Math.PI / 8;

/**
 * Detect whether a drag produces a horizontal, vertical, or diagonal line.
 * Angles within `threshold` of the horizontal axis are H, within `threshold`
 * of vertical are V, and the band in between is diagonal.
 *
 * The default 15-degree zones leave a wide diagonal band, which makes it
 * easier to draw a diagonal without frequent flipping — the right call when
 * the diagonal is drawn at whatever angle the drag had. Pass
 * {@link OCTANT_ZONE_RAD} instead when the diagonal will be forced to 45
 * degrees, so the answer is the nearest of the eight directions rather than a
 * 30-degree drag snapping to 45.
 */
export function detectLineDirection(
  dx: number,
  dy: number,
  threshold: number = AXIS_ZONE_RAD,
): LineDirection {
  if (dx === 0 && dy === 0) return 'horizontal';
  const angle = Math.abs(Math.atan2(dy, dx)); // 0..PI
  // Normalize to 0..PI/2 (first quadrant) since H/V/diag are symmetric
  const a = angle > Math.PI / 2 ? Math.PI - angle : angle;
  if (a < threshold) return 'horizontal';
  if (a > Math.PI / 2 - threshold) return 'vertical';
  return 'diagonal';
}

/**
 * Constrain the drag endpoint to produce the correct bounding box shape,
 * snapped to the grid step.
 *
 * - Horizontal: width snaps freely, height forced to one gridStep
 * - Vertical: height snaps freely, width forced to one gridStep
 * - Diagonal: constrained to a square (like arc creation)
 *
 * Direction is determined from the snapped grid cell counts, not
 * angles. This avoids flicker at zone boundaries during the drag.
 * A box wider than 2:1 is horizontal, taller than 1:2 is vertical,
 * and anything in between is diagonal (constrained to square).
 *
 * In the H/V branches the perpendicular thickness is fixed at +gridStep
 * (right of start for vertical, below start for horizontal). Letting it
 * follow the live cursor sign would flip the bbox one cell on a hair of
 * jitter, taking the start cell out of the bbox; this keeps the start
 * cell as a corner of the bbox at all times.
 */
export function constrainLineBbox(
  sx: number, sy: number,
  rawEndX: number, rawEndY: number,
  gridStep: number,
): [number, number] {
  const dx = rawEndX - sx;
  const dy = rawEndY - sy;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  // Snap both axes to the grid to determine cell counts.
  const cellsW = Math.round(absDx / gridStep);
  const cellsH = Math.round(absDy / gridStep);

  if (cellsW === 0 && cellsH === 0) return [sx, sy];

  // Ratio-based direction: > 2:1 → horizontal, < 1:2 → vertical, else diagonal.
  if (cellsW > cellsH * 2) {
    // Horizontal
    const snappedW = Math.round(dx / gridStep) * gridStep;
    if (snappedW === 0) return [sx, sy];
    return [sx + snappedW, sy + gridStep];
  }
  if (cellsH > cellsW * 2) {
    // Vertical
    const snappedH = Math.round(dy / gridStep) * gridStep;
    if (snappedH === 0) return [sx, sy];
    return [sx + gridStep, sy + snappedH];
  }
  // Diagonal: constrain to square
  const side = Math.max(1, Math.min(cellsW, cellsH)) * gridStep;
  return [sx + side * Math.sign(dx || 1), sy + side * Math.sign(dy || 1)];
}

/**
 * Determine direction from constrained box dimensions.
 * Used after constrainLineBbox has shaped the box — the aspect ratio
 * is the sole authority on direction at this point.
 */
export function directionFromBox(
  sx: number, sy: number, ex: number, ey: number,
): LineDirection {
  const w = Math.abs(ex - sx);
  const h = Math.abs(ey - sy);
  if (w > h) return 'horizontal';
  if (h > w) return 'vertical';
  return 'diagonal';
}

/**
 * Compute the two line vertices from the constrained bounding box corners.
 *
 * - Horizontal: vertices at the vertical midpoint, spanning full width
 * - Vertical: vertices at the horizontal midpoint, spanning full height
 * - Diagonal: vertices at opposite corners (preserving drag direction)
 */
export function computeLineVertices(
  sx: number, sy: number,
  ex: number, ey: number,
  direction: LineDirection,
): [[number, number], [number, number]] {
  if (direction === 'horizontal') {
    const midY = (sy + ey) / 2;
    return [[Math.min(sx, ex), midY], [Math.max(sx, ex), midY]];
  }
  if (direction === 'vertical') {
    const midX = (sx + ex) / 2;
    return [[midX, Math.min(sy, ey)], [midX, Math.max(sy, ey)]];
  }
  // Diagonal: corner to corner, preserving drag direction
  return [[sx, sy], [ex, ey]];
}

/**
 * Recenter a constrained H/V box on the anchor grid line so the drawn line
 * lands exactly on the grid instead of half a step off.
 *
 * `constrainLineBbox` produces a box whose perpendicular extent is one grid
 * step with the start point on the anchor edge; `computeLineVertices` then
 * places the line at the box's perpendicular midpoint, which sits half a step
 * off the grid. Shifting both corners by half the perpendicular thickness
 * moves that midpoint back onto the start grid line. The box then straddles
 * the grid (half a cell either side), and the line stays centered in it — so
 * every downstream box-based op (scale/rotate/snap) remains consistent.
 *
 * The perpendicular thickness equals one gridStep, so the shift is derived
 * from the box dimensions — no gridStep argument needed. Diagonal boxes are
 * already corner-to-corner on the grid and pass through unchanged.
 */
export function recenterLineBoxOnGrid(
  sx: number, sy: number,
  ex: number, ey: number,
  direction: LineDirection,
): [number, number, number, number] {
  if (direction === 'horizontal') {
    const half = Math.abs(ey - sy) / 2;
    return [sx, sy - half, ex, ey - half];
  }
  if (direction === 'vertical') {
    const half = Math.abs(ex - sx) / 2;
    return [sx - half, sy, ex - half, ey];
  }
  return [sx, sy, ex, ey];
}

/**
 * Compute the AABB creation box from two corner points.
 */
export function computeCreationBox(
  sx: number, sy: number,
  ex: number, ey: number,
): { minX: number; minY: number; width: number; height: number } {
  const minX = Math.min(sx, ex);
  const minY = Math.min(sy, ey);
  return {
    minX,
    minY,
    width: Math.abs(ex - sx),
    height: Math.abs(ey - sy),
  };
}

/**
 * Constrain a drag endpoint for the rectangle tool. Both axes snap
 * independently to the grid — no H/V/diagonal forcing.
 */
export function constrainRectBbox(
  sx: number, sy: number,
  rawEndX: number, rawEndY: number,
  gridStep: number,
): [number, number] {
  const snappedX = sx + Math.round((rawEndX - sx) / gridStep) * gridStep;
  const snappedY = sy + Math.round((rawEndY - sy) / gridStep) * gridStep;
  if (snappedX === sx && snappedY === sy) return [sx, sy];
  return [snappedX, snappedY];
}

/**
 * Produce 4 line segments forming a closed rectangle from two opposite
 * corners. Winding order: top → right → bottom → left (clockwise in
 * screen-y-down coords).
 */
export function computeRectSegments(
  sx: number, sy: number,
  ex: number, ey: number,
): PathSegment[] {
  return [
    { kind: 'line', start: [sx, sy], end: [ex, sy] },
    { kind: 'line', start: [ex, sy], end: [ex, ey] },
    { kind: 'line', start: [ex, ey], end: [sx, ey] },
    { kind: 'line', start: [sx, ey], end: [sx, sy] },
  ];
}

/**
 * Produce `sides` line segments forming a closed polygon inscribed in the
 * box with opposite corners (sx, sy) and (ex, ey): center at the box's
 * midpoint, vertices on the box's inscribed ELLIPSE (half-width out along
 * x, half-height along y). The first vertex sits at the top (12 o'clock)
 * and winding is clockwise in screen-y-down coords, matching {@link
 * computeRectSegments} and computeCircleSegments.
 *
 * A SQUARE box gives the regular polygon — the two radii coincide, so this
 * is the inscribed circle — which is what the polygon tool drags with Grid
 * Snap on and what every non-tool caller passes. A non-square box (snap
 * off, freeform creation) gives that same polygon stretched to fill it, so
 * the shape matches the box the finger drew.
 *
 * Each vertex is computed once and its coordinates reused for both the
 * incoming end and the outgoing start, so consecutive endpoints compare
 * bit-for-bit equal and the chain closes without an epsilon.
 */
export function computeRegularPolygonSegments(
  sx: number, sy: number,
  ex: number, ey: number,
  sides: number,
): PathSegment[] {
  const n = Math.max(3, Math.round(sides));
  const cx = (sx + ex) / 2;
  const cy = (sy + ey) / 2;
  const rx = Math.abs(ex - sx) / 2;
  const ry = Math.abs(ey - sy) / 2;
  const verts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    verts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  const segments: PathSegment[] = [];
  for (let i = 0; i < n; i++) {
    const s = verts[i];
    const e = verts[(i + 1) % n];
    segments.push({ kind: 'line', start: [s[0], s[1]], end: [e[0], e[1]] });
  }
  return segments;
}
