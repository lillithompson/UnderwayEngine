// Cutting a path with a disc (bug report 6b36fe8b; bug 9a6bd320): the
// fractions of a segment a circle covers, the intervals left once a cover
// is taken out, and which paths may be cut at all. Shared by the editor's
// vector eraser (`@/editor/vectorEraser`, the Color brush's eraser) and
// DrawBots' Erase effect, whose kernel imports the engine alone.

import type { PathSegment, SVGObject } from './types';
import { arcAngles, arcRadius, piecePointAt } from './compositionArcMath';
import { pointToArcSegmentDistSq, pointToLineSegmentDistSq } from './compositionPathHitTest';
import { svgIsFilled, svgIsStroked } from './svgPathBuilder';

/** A run of one segment, as fractions of it: [from, to], from < to. */
export type SegmentInterval = readonly [number, number];

/** Pieces shorter than this (cells) are dropped rather than kept: a sliver
 *  the eye cannot see is still a vertex pair a later edit has to carry. */
export const MIN_ERASE_PIECE_CELLS = 1e-3;

const EPS = 1e-9;

/**
 * The fractions of `seg` that lie INSIDE the circle (cx, cy, r), as sorted,
 * disjoint intervals. The boundaries are the exact crossings of the circle
 * with the segment — the cut vertices — so the kept remainder meets the
 * erased part on the disc's edge.
 */
export function segmentCircleCover(
  seg: PathSegment, cx: number, cy: number, r: number,
): SegmentInterval[] {
  const rSq = r * r;
  const dSq = seg.kind === 'arc'
    ? pointToArcSegmentDistSq(cx, cy, seg)
    : pointToLineSegmentDistSq(cx, cy, seg.start[0], seg.start[1], seg.end[0], seg.end[1]);
  if (dSq >= rSq) return [];

  // Every crossing of the circle with the segment, as a fraction.
  const cuts: number[] = [0, 1];
  if (seg.kind === 'line') {
    const dx = seg.end[0] - seg.start[0];
    const dy = seg.end[1] - seg.start[1];
    const fx = seg.start[0] - cx;
    const fy = seg.start[1] - cy;
    const a = dx * dx + dy * dy;
    if (a > EPS) {
      const b = 2 * (fx * dx + fy * dy);
      const c = fx * fx + fy * fy - rSq;
      const disc = b * b - 4 * a * c;
      if (disc > 0) {
        const s = Math.sqrt(disc);
        cuts.push((-b - s) / (2 * a), (-b + s) / (2 * a));
      }
    }
  } else {
    // Circle–circle: the brush disc against the arc's own circle.
    const [ax, ay] = seg.center;
    const R = arcRadius(seg);
    const d = Math.hypot(cx - ax, cy - ay);
    if (R > EPS && d > EPS && d < R + r && d > Math.abs(R - r)) {
      const along = (d * d + R * R - rSq) / (2 * d);
      const h = Math.sqrt(Math.max(0, R * R - along * along));
      const ux = (cx - ax) / d;
      const uy = (cy - ay) / d;
      const mx = ax + ux * along;
      const my = ay + uy * along;
      const { a0, da } = arcAngles(seg);
      const TAU = 2 * Math.PI;
      for (const sgn of [1, -1]) {
        const px = mx - sgn * h * uy;
        const py = my + sgn * h * ux;
        const ang = Math.atan2(py - ay, px - ax);
        // The crossing's angle as a fraction of the sweep, walked in the
        // sweep's own direction from the start.
        let rel = da >= 0 ? ang - a0 : a0 - ang;
        rel = ((rel % TAU) + TAU) % TAU;
        cuts.push(rel / Math.abs(da));
      }
    }
  }

  const sorted = cuts.filter((f) => f >= 0 && f <= 1).sort((p, q) => p - q);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const f0 = sorted[i];
    const f1 = sorted[i + 1];
    if (f1 - f0 < EPS) continue;
    const [px, py] = piecePointAt(seg, (f0 + f1) / 2);
    if ((px - cx) ** 2 + (py - cy) ** 2 >= rSq) continue;
    const last = out[out.length - 1];
    if (last && f0 - last[1] < EPS) last[1] = f1;
    else out.push([f0, f1]);
  }
  return out;
}

/** `kept` minus `cut`: both sorted and disjoint, and so is the result. */
export function subtractIntervals(
  kept: readonly SegmentInterval[], cut: readonly SegmentInterval[],
): SegmentInterval[] {
  if (cut.length === 0) return kept as SegmentInterval[];
  const out: SegmentInterval[] = [];
  for (const [k0, k1] of kept) {
    let from = k0;
    for (const [c0, c1] of cut) {
      if (c1 <= from || c0 >= k1) continue;
      if (c0 > from) out.push([from, c0]);
      from = Math.max(from, c1);
      if (from >= k1) break;
    }
    if (from < k1) out.push([from, k1]);
  }
  return out;
}

/** Whether the eraser may cut `svg` at all.
 *
 *  Only a STROKED path is cut. A filled shape's outline is also the edge of
 *  its fill (and of a pattern fill or brushwork clipped to it), so cutting
 *  it would open the fill rather than remove a line; a repeat-mode path
 *  stores one tile of a pattern, which no single dab is "on". Those are
 *  left whole.
 *
 *  `cutFills` lets a plain filled shape that draws an outline be cut too:
 *  its caller takes the fill off what is left (`svgObjectStrokesOnly`), as
 *  a DrawBots Erase effect does (bug 9a6bd320). A pattern fill, brushwork
 *  or a shape with no outline stays whole even then. */
export function vectorErasable(svg: SVGObject, cutFills = false): boolean {
  if (svg.tileMode === 'repeat') return false;
  if (svg.isPatternFill || svg.patternFill || svg.paintOverlay) return false;
  if (svgIsFilled(svg) && !(cutFills && svgIsStroked(svg))) return false;
  // A FILL subpath (a figure bake's painted cell) is a closed drawing in
  // one colour — the filled-shape case again, inside a path.
  if (svg.subpaths?.some((sub) => sub.fill)) return false;
  return true;
}
