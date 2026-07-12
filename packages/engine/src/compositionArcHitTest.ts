import { SVGObject, PathSegment } from './types';
import { arcRadius, arcAngles } from './compositionArcMath';

// Cardinal angles (screen y-down): right, bottom, left, top. Where an arc's
// sweep crosses one of these, the circle reaches an axis-aligned extreme that
// is the true min/max. Editor quarter-arcs start/end on cardinals (so their
// endpoints already cover the extreme), but a geometric-union outline arc can
// span across a cardinal with no vertex there — that extreme must be added
// explicitly or the AABB collapses inward (too small).
const CARDINAL_ANGLES: readonly number[] = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
const TAU = 2 * Math.PI;

/**
 * Tight bounding box of an arc/line shape in L0-cell space. Considers each
 * segment's endpoints plus, for arcs, the axis-aligned circle extremes that
 * fall STRICTLY inside the arc's angular sweep (a cardinal coinciding with an
 * endpoint is already covered by that exact endpoint — recomputing it via trig
 * would only inject rounding error).
 */
export function arcBoundingBox(
  segments: ReadonlyArray<PathSegment>,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (segments.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const consider = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const seg of segments) {
    consider(seg.start[0], seg.start[1]);
    consider(seg.end[0], seg.end[1]);
    if (seg.kind === 'arc') {
      const [cx, cy] = seg.center;
      const r = arcRadius(seg);
      const { a0, da } = arcAngles(seg);
      for (const a of CARDINAL_ANGLES) {
        const rel = (((a - a0) % TAU) + TAU) % TAU; // [0, 2π) forward from a0
        const inside = da >= 0
          ? rel > 1e-9 && rel < da - 1e-9
          : rel - TAU < -1e-9 && rel - TAU > da + 1e-9;
        if (inside) consider(cx + r * Math.cos(a), cy + r * Math.sin(a));
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

/** Single-item hit-test: does this arc accept a click at (rawX, rawY)? */
export function arcHitsCell(arc: SVGObject, rawX: number, rawY: number): boolean {
  if (arc.hidden) return false;
  if (arc.locked) return false;
  if (arc.tileMode === 'repeat') {
    return rawX >= arc.cellX && rawX <= arc.cellX + arc.cellWidth
      && rawY >= arc.cellY && rawY <= arc.cellY + arc.cellHeight;
  }
  const bb = arcBoundingBox(arc.segments);
  if (!bb) return false;
  const minSize = 0.25;
  let { minX, minY, maxX, maxY } = bb;
  if (maxX - minX < minSize) {
    const cx = (minX + maxX) / 2;
    minX = cx - minSize / 2; maxX = cx + minSize / 2;
  }
  if (maxY - minY < minSize) {
    const cy = (minY + maxY) / 2;
    minY = cy - minSize / 2; maxY = cy + minSize / 2;
  }
  return rawX >= minX && rawX <= maxX && rawY >= minY && rawY <= maxY;
}

