import { PathSegment, SVGObject } from './types';

const INV_SQRT2 = 1 / Math.SQRT2;

/**
 * Constrain a drag endpoint to form a square bounding box with the start
 * point. Returns the constrained endpoint in L0-cell space.
 *
 * `gridStep > 0` snaps the side length to that step; pass `0` (or any
 * non-positive value) for a FREEFORM square that follows the cursor exactly —
 * which is how CozyJournal's arc / circle tools create off-grid shapes.
 */
export function constrainToSquare(
  sx: number, sy: number,
  rawEndX: number, rawEndY: number,
  gridStep: number,
): [number, number] {
  const dx = rawEndX - sx;
  const dy = rawEndY - sy;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const raw = Math.min(absDx, absDy);
  const side = gridStep > 0 ? Math.round(raw / gridStep) * gridStep : raw;
  // A perfectly axis-aligned drag has min extent 0, so it yields no square —
  // and past this guard both deltas are non-zero, so neither sign is 0.
  if (side === 0) return [sx, sy];
  return [sx + side * Math.sign(dx), sy + side * Math.sign(dy)];
}

/**
 * Is this segment chain a full circle — every piece a same-center,
 * same-radius arc, closing back on itself?
 *
 * Structural rather than a stored `shapeKind` tag, so it also recognizes
 * circles drawn before the tag existed and can't drift when an object is
 * renamed. Used to keep circles circular under a corner-handle resize:
 * scaling one axis alone maps each arc's start / end / center independently,
 * which leaves the radius disagreeing with the endpoints and renders a shape
 * that is neither a circle nor an ellipse.
 */
export function isCircleSegments(segments: readonly PathSegment[]): boolean {
  if (segments.length < 2) return false;
  const first = segments[0];
  if (first.kind !== 'arc') return false;
  const [cx, cy] = first.center;
  const r = arcRadius(first);
  if (!(r > 0)) return false;
  // Relative tolerance: these coordinates have been through float scaling.
  const eps = r * 1e-6;
  for (const seg of segments) {
    if (seg.kind !== 'arc') return false;
    if (Math.abs(seg.center[0] - cx) > eps || Math.abs(seg.center[1] - cy) > eps) return false;
    if (Math.abs(arcRadius(seg) - r) > eps) return false;
    if (Math.abs(Math.hypot(seg.end[0] - cx, seg.end[1] - cy) - r) > eps) return false;
  }
  return isClosedPath(segments);
}

/**
 * Choose the arc center so the rounded part bulges based on the
 * horizontal drag direction: rightward drags (ex > sx) bulge up,
 * leftward drags (ex < sx) bulge down. For a square bounding box with
 * diagonal corners at (sx,sy) and (ex,ey), two candidate centers
 * exist: (sx,ey) and (ex,sy). We pick the one whose arc midpoint has
 * the smaller Y (bulges up) for rightward drags, or the larger Y
 * (bulges down) for leftward drags.
 */
export function pickCenter(
  sx: number, sy: number,
  ex: number, ey: number,
): [number, number] {
  // Candidate centers
  const c1x = sx, c1y = ey;
  const c2x = ex, c2y = sy;
  // Arc midpoints: M = C + (S + E - 2C) / sqrt(2)
  const m1y = c1y + (sy + ey - 2 * c1y) * INV_SQRT2;
  const m2y = c2y + (sy + ey - 2 * c2y) * INV_SQRT2;
  // Rightward drag → bulge up (smaller midpoint Y).
  // Leftward drag → bulge down (larger midpoint Y).
  const preferSmaller = ex > sx;
  const pickC1 = preferSmaller ? m1y <= m2y : m1y >= m2y;
  return pickC1 ? [c1x, c1y] : [c2x, c2y];
}

/**
 * Compute the SVG sweep-flag for an arc segment.
 * Returns 1 for clockwise (screen-y-down), 0 for counterclockwise.
 */
export function computeSweepFlag(
  start: readonly [number, number],
  end: readonly [number, number],
  center: readonly [number, number],
): 0 | 1 {
  const cross =
    (start[0] - center[0]) * (end[1] - center[1]) -
    (start[1] - center[1]) * (end[0] - center[0]);
  return cross > 0 ? 1 : 0;
}

/**
 * Compute the radius of an arc-curve segment from its center and start
 * point. Only valid for `kind: 'arc'` — line segments have no radius.
 */
export function arcRadius(seg: { start: readonly [number, number]; center: readonly [number, number] }): number {
  const dx = seg.start[0] - seg.center[0];
  const dy = seg.start[1] - seg.center[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Return the first and last endpoints of a multi-segment arc/line chain.
 */
export function arcEndpoints(arc: SVGObject): { first: [number, number]; last: [number, number] } {
  return {
    first: arc.segments[0].start,
    last: arc.segments[arc.segments.length - 1].end,
  };
}

/**
 * Collect all points of an arc's segments for bounding box / group
 * transforms. Includes start + end always, and center for arc-curve
 * segments (which can bow outside the start/end AABB).
 */
export function arcAllPoints(segments: readonly PathSegment[]): [number, number][] {
  const points: [number, number][] = [];
  for (const seg of segments) {
    points.push(seg.start, seg.end);
    if (seg.kind === 'arc') points.push(seg.center);
  }
  return points;
}

/**
 * Produce 4 quarter-circle arc segments forming a closed circle inscribed
 * in the square defined by opposite corners (sx, sy) and (ex, ey).
 * All arcs share the same center (midpoint of the square). Cardinal
 * points sit at the midpoints of each edge. Winding is clockwise in
 * screen-y-down coords: top → right → bottom → left → top.
 */
export function computeCircleSegments(
  sx: number, sy: number,
  ex: number, ey: number,
): PathSegment[] {
  const minX = Math.min(sx, ex);
  const maxX = Math.max(sx, ex);
  const minY = Math.min(sy, ey);
  const maxY = Math.max(sy, ey);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const top: [number, number] = [cx, minY];
  const right: [number, number] = [maxX, cy];
  const bottom: [number, number] = [cx, maxY];
  const left: [number, number] = [minX, cy];
  const center: [number, number] = [cx, cy];
  return [
    { kind: 'arc', start: top, end: right, center },
    { kind: 'arc', start: right, end: bottom, center },
    { kind: 'arc', start: bottom, end: left, center },
    { kind: 'arc', start: left, end: top, center },
  ];
}

/**
 * Translate all points in an arc's segments by (dx, dy).
 */
export function translateSegments(segments: PathSegment[], dx: number, dy: number): PathSegment[] {
  return segments.map(seg => seg.kind === 'arc' ? {
    kind: 'arc' as const,
    start: [seg.start[0] + dx, seg.start[1] + dy] as [number, number],
    end: [seg.end[0] + dx, seg.end[1] + dy] as [number, number],
    center: [seg.center[0] + dx, seg.center[1] + dy] as [number, number],
  } : {
    kind: 'line' as const,
    start: [seg.start[0] + dx, seg.start[1] + dy] as [number, number],
    end: [seg.end[0] + dx, seg.end[1] + dy] as [number, number],
  });
}

/**
 * Reverse a path segment: swap start and end, preserve center for arcs.
 */
export function reverseSegment(seg: PathSegment): PathSegment {
  if (seg.kind === 'line') {
    return { kind: 'line', start: seg.end, end: seg.start };
  }
  return { kind: 'arc', start: seg.end, end: seg.start, center: seg.center };
}

/**
 * Reorder an unordered bag of segments into a single connected chain,
 * reversing individual segments as needed.  Returns null if the segments
 * cannot be assembled into a single connected chain.
 */
export function chainSegments(segments: readonly PathSegment[]): PathSegment[] | null {
  const n = segments.length;
  if (n === 0) return null;

  // Fast path: already sequential end-to-start
  let sequential = true;
  for (let i = 0; i < n; i++) {
    const next = segments[(i + 1) % n];
    const [ex, ey] = segments[i].end;
    const [sx, sy] = next.start;
    if (Math.abs(ex - sx) > 1e-6 || Math.abs(ey - sy) > 1e-6) {
      sequential = false;
      break;
    }
  }
  if (sequential) return segments.map(s => ({ ...s } as PathSegment));

  // Greedy chain building with reversal
  const chain: PathSegment[] = [{ ...segments[0] } as PathSegment];
  const used = new Array<boolean>(n).fill(false);
  used[0] = true;
  let usedCount = 1;

  let progressed = true;
  while (progressed && usedCount < n) {
    progressed = false;
    const head = chain[0].start;
    const tail = chain[chain.length - 1].end;
    for (let i = 1; i < n; i++) {
      if (used[i]) continue;
      const seg = segments[i];
      const [sx, sy] = seg.start;
      const [ex, ey] = seg.end;

      if (Math.abs(tail[0] - sx) <= 1e-6 && Math.abs(tail[1] - sy) <= 1e-6) {
        chain.push({ ...seg } as PathSegment);
      } else if (Math.abs(tail[0] - ex) <= 1e-6 && Math.abs(tail[1] - ey) <= 1e-6) {
        chain.push(reverseSegment(seg));
      } else if (Math.abs(head[0] - ex) <= 1e-6 && Math.abs(head[1] - ey) <= 1e-6) {
        chain.unshift({ ...seg } as PathSegment);
      } else if (Math.abs(head[0] - sx) <= 1e-6 && Math.abs(head[1] - sy) <= 1e-6) {
        chain.unshift(reverseSegment(seg));
      } else {
        continue;
      }
      used[i] = true;
      usedCount++;
      progressed = true;
      break;
    }
  }

  return usedCount === n ? chain : null;
}

/**
 * Chain an unordered bag of segments into one or more closed loops (greedy,
 * with reversal). Returns null if any chain stays open. Used to count and
 * separate the loops in a union result (outer boundary + holes).
 */
export function chainSegmentsLoops(segments: readonly PathSegment[]): PathSegment[][] | null {
  const n = segments.length;
  if (n === 0) return null;
  const eq = (a: readonly [number, number], b: readonly [number, number]) =>
    Math.abs(a[0] - b[0]) <= 1e-6 && Math.abs(a[1] - b[1]) <= 1e-6;
  const used = new Array<boolean>(n).fill(false);
  const loops: PathSegment[][] = [];

  for (let s = 0; s < n; s++) {
    if (used[s]) continue;
    const loop: PathSegment[] = [{ ...segments[s] } as PathSegment];
    used[s] = true;
    let progressed = true;
    while (progressed) {
      const head = loop[0].start;
      const tail = loop[loop.length - 1].end;
      // Loop closed: stop before greedily absorbing a disjoint loop that
      // happens to touch this one's seam vertex.
      if (loop.length > 1 && eq(head, tail)) break;
      progressed = false;
      for (let i = 0; i < n; i++) {
        if (used[i]) continue;
        const seg = segments[i];
        if (eq(tail, seg.start)) loop.push({ ...seg } as PathSegment);
        else if (eq(tail, seg.end)) loop.push(reverseSegment(seg));
        else if (eq(head, seg.end)) loop.unshift({ ...seg } as PathSegment);
        else if (eq(head, seg.start)) loop.unshift(reverseSegment(seg));
        else continue;
        used[i] = true;
        progressed = true;
        break;
      }
    }
    if (!eq(loop[0].start, loop[loop.length - 1].end)) return null; // open chain
    loops.push(loop);
  }
  return loops.length > 0 ? loops : null;
}

/**
 * Returns true when the segments form a single closed loop.  Handles both
 * sequentially-ordered paths (end-to-start) and unordered segment bags
 * produced by join (greedy chaining with reversal).  Tolerance: 1e-6.
 */
export function isClosedPath(segments: readonly PathSegment[]): boolean {
  const n = segments.length;
  if (n === 0) return false;

  // Fast path: sequential end-to-start connectivity
  let sequential = true;
  for (let i = 0; i < n; i++) {
    const next = segments[(i + 1) % n];
    const [ex, ey] = segments[i].end;
    const [sx, sy] = next.start;
    if (Math.abs(ex - sx) > 1e-6 || Math.abs(ey - sy) > 1e-6) {
      sequential = false;
      break;
    }
  }
  if (sequential) return true;

  // Slow path: assemble the unordered bag into one or more closed loops
  // (join output is a single chain; a geometric union result is multi-loop —
  // outer boundary plus holes — and is still "closed").
  return chainSegmentsLoops(segments) !== null;
}

/**
 * Compute the signed area of a closed segment chain using Green's theorem.
 * Positive = clockwise in screen-y-down coordinates.
 * Segments must already be chained (sequential end-to-start connectivity).
 */
export function computeSignedArea(segments: readonly PathSegment[]): number {
  let area2 = 0; // accumulate 2× area, divide at end
  for (const seg of segments) {
    const [x1, y1] = seg.start;
    const [x2, y2] = seg.end;
    if (seg.kind === 'line') {
      area2 += x1 * y2 - x2 * y1;
    } else {
      // Arc: use Green's theorem integral ∮ (x dy − y dx) over the arc curve.
      // Parametrize as x = cx + r cos(θ), y = cy + r sin(θ).
      // Integral = cx·r·(sin β − sin α) − cy·r·(cos β − cos α) + r²·(β − α)
      const [cx, cy] = seg.center;
      const dx1 = x1 - cx, dy1 = y1 - cy;
      const dx2 = x2 - cx, dy2 = y2 - cy;
      const r = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      if (r < 1e-12) { area2 += x1 * y2 - x2 * y1; continue; }
      const alpha = Math.atan2(dy1, dx1);
      const beta = Math.atan2(dy2, dx2);
      // Determine sweep direction from cross product (same as computeSweepFlag).
      // cross > 0 → CW screen (angle increases in atan2) → β − α positive.
      const cross = dx1 * dy2 - dy1 * dx2;
      let dTheta = beta - alpha;
      if (cross > 0) {
        // CW screen sweep: dTheta should be positive
        if (dTheta <= 0) dTheta += 2 * Math.PI;
      } else {
        // CCW screen sweep: dTheta should be negative
        if (dTheta >= 0) dTheta -= 2 * Math.PI;
      }
      area2 += cx * r * (Math.sin(beta) - Math.sin(alpha))
             - cy * r * (Math.cos(beta) - Math.cos(alpha))
             + r * r * dTheta;
    }
  }
  return area2 / 2;
}

// ── Arc geometry helpers for boolean outline ops (engine/outlineUnion.ts) ──
// Ported alongside the geometric Union feature. Shared so outlineUnion and any
// future boolean op reuse one arc-parametrization implementation.

const OUTLINE_EPS = 1e-6;

interface ArcLike {
  start: readonly [number, number];
  end: readonly [number, number];
  center: readonly [number, number];
}

/** Normalized angular span of an arc: start angle, signed sweep delta. */
export function arcAngles(seg: ArcLike): { a0: number; da: number } {
  const [cx, cy] = seg.center;
  const a0 = Math.atan2(seg.start[1] - cy, seg.start[0] - cx);
  let a1 = Math.atan2(seg.end[1] - cy, seg.end[0] - cx);
  const cross = (seg.start[0] - cx) * (seg.end[1] - cy) - (seg.start[1] - cy) * (seg.end[0] - cx);
  if (cross > 0) { if (a1 <= a0) a1 += 2 * Math.PI; } else { if (a1 >= a0) a1 -= 2 * Math.PI; }
  return { a0, da: a1 - a0 };
}

/** Unit tangent along the direction of travel at fraction f of an arc. */
export function arcMotionAt(seg: ArcLike, f: number): [number, number] {
  const { a0, da } = arcAngles(seg);
  const a = a0 + da * f;
  return da >= 0 ? [-Math.sin(a), Math.cos(a)] : [Math.sin(a), -Math.cos(a)];
}

/** Whether world angle `a` lies within an arc's angular span. */
export function angleOnArc(seg: ArcLike, a: number): boolean {
  const { a0, da } = arcAngles(seg);
  let rel = a - a0;
  const tau = 2 * Math.PI;
  rel = ((rel % tau) + tau) % tau;          // [0, 2π)
  if (da >= 0) return rel <= da + OUTLINE_EPS;
  return rel >= tau + da - OUTLINE_EPS || rel <= OUTLINE_EPS;
}

/** Point at fraction f along a piece (f maps linearly to angle on arcs). */
export function piecePointAt(seg: PathSegment, f: number): [number, number] {
  if (seg.kind === 'line') {
    return [seg.start[0] + (seg.end[0] - seg.start[0]) * f, seg.start[1] + (seg.end[1] - seg.start[1]) * f];
  }
  const { a0, da } = arcAngles(seg);
  const a = a0 + da * f;
  const r = Math.hypot(seg.start[0] - seg.center[0], seg.start[1] - seg.center[1]);
  return [seg.center[0] + r * Math.cos(a), seg.center[1] + r * Math.sin(a)];
}

/** Arc length of a line or arc segment. */
export function segLength(seg: PathSegment): number {
  if (seg.kind === 'line') return Math.hypot(seg.end[0] - seg.start[0], seg.end[1] - seg.start[1]);
  const r = Math.hypot(seg.start[0] - seg.center[0], seg.start[1] - seg.center[1]);
  const { da } = arcAngles(seg);
  return Math.abs(da) * r;
}

/**
 * Sub-piece of a segment between fractions f0 < f1 (fractions map linearly
 * to angle on arcs; sub-arcs keep the center). Exact endpoints are reused at
 * f0 ≤ 0 / f1 ≥ 1.
 */
export function subSegment(seg: PathSegment, f0: number, f1: number): PathSegment {
  const eps = 1e-6;
  const a: [number, number] = f0 <= eps ? [seg.start[0], seg.start[1]] : piecePointAt(seg, f0);
  const b: [number, number] = f1 >= 1 - eps ? [seg.end[0], seg.end[1]] : piecePointAt(seg, f1);
  if (seg.kind === 'line') return { kind: 'line', start: a, end: b };
  return { kind: 'arc', start: a, end: b, center: [seg.center[0], seg.center[1]] };
}

/** Merge consecutive collinear same-direction line segments — and consecutive
 *  co-circular same-direction arcs — (incl. the last→first wraparound) so e.g.
 *  a pure straight extension stays a clean 4-segment rectangle, and an arc that
 *  a union split into co-circular pieces re-emerges as one smooth arc. Mutates
 *  the surviving segments' endpoints. */
export function mergeCollinear(outline: PathSegment[]): PathSegment[] {
  // Co-circular contiguous arcs merge only when their combined sweep stays
  // under 180°, so the surviving (start,end,center) still round-trips its
  // direction unambiguously (the sweep is inferred from the chord's cross sign).
  const arcSweep = (s: readonly [number, number], e: readonly [number, number], c: readonly [number, number]): number => {
    const r2 = (s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2;
    if (r2 <= OUTLINE_EPS) return 0;
    const dot = (s[0] - c[0]) * (e[0] - c[0]) + (s[1] - c[1]) * (e[1] - c[1]);
    return Math.acos(Math.min(Math.max(dot / r2, -1), 1));
  };
  const canMerge = (a: PathSegment, b: PathSegment): boolean => {
    if (Math.abs(a.end[0] - b.start[0]) > OUTLINE_EPS || Math.abs(a.end[1] - b.start[1]) > OUTLINE_EPS) return false;
    if (a.kind === 'line' && b.kind === 'line') {
      const ax = a.end[0] - a.start[0], ay = a.end[1] - a.start[1];
      const bx = b.end[0] - b.start[0], by = b.end[1] - b.start[1];
      return Math.abs(ax * by - ay * bx) <= OUTLINE_EPS && ax * bx + ay * by >= -OUTLINE_EPS;
    }
    if (a.kind === 'arc' && b.kind === 'arc') {
      const c = a.center;
      if (Math.abs(c[0] - b.center[0]) > OUTLINE_EPS || Math.abs(c[1] - b.center[1]) > OUTLINE_EPS) return false;
      const ra = Math.hypot(a.start[0] - c[0], a.start[1] - c[1]);
      const rb = Math.hypot(b.end[0] - c[0], b.end[1] - c[1]);
      const rj = Math.hypot(a.end[0] - c[0], a.end[1] - c[1]);
      const tol = OUTLINE_EPS * Math.max(1, rj);
      if (Math.abs(ra - rj) > tol || Math.abs(rb - rj) > tol) return false;
      const crossA = (a.start[0] - c[0]) * (a.end[1] - c[1]) - (a.start[1] - c[1]) * (a.end[0] - c[0]);
      const crossB = (b.start[0] - c[0]) * (b.end[1] - c[1]) - (b.start[1] - c[1]) * (b.end[0] - c[0]);
      if (crossA * crossB < -OUTLINE_EPS) return false; // opposite sweep directions
      return arcSweep(a.start, a.end, c) + arcSweep(b.start, b.end, c) < Math.PI - OUTLINE_EPS;
    }
    return false;
  };
  if (outline.length < 2) return outline;
  const merged: PathSegment[] = [];
  for (const seg of outline) {
    const prev = merged[merged.length - 1];
    if (prev && canMerge(prev, seg)) {
      prev.end = [seg.end[0], seg.end[1]];
    } else {
      merged.push(seg);
    }
  }
  while (merged.length > 1 && canMerge(merged[merged.length - 1], merged[0])) {
    merged[0].start = [merged[merged.length - 1].start[0], merged[merged.length - 1].start[1]];
    merged.pop();
  }
  return merged;
}

/**
 * Chain an unordered bag of segments, merge coincident vertices,
 * and ensure clockwise winding for closed paths.
 * Returns a shallow copy of the input if segments cannot be chained.
 */
export function normalizeClosedSegments(segments: readonly PathSegment[]): PathSegment[] {
  if (segments.length === 0) return [];
  const chained = chainSegments(segments);
  if (!chained) return segments.map(s => ({ ...s }) as PathSegment);

  // Merge coincident vertices: snap each segment's start to the previous end
  for (let i = 1; i < chained.length; i++) {
    chained[i].start = [chained[i - 1].end[0], chained[i - 1].end[1]];
  }

  // Check closure
  const first = chained[0].start;
  const last = chained[chained.length - 1].end;
  const closed = Math.abs(first[0] - last[0]) <= 1e-6
              && Math.abs(first[1] - last[1]) <= 1e-6;
  if (closed) {
    // Close the loop exactly
    chained[0].start = [last[0], last[1]];
    // Ensure CW winding (positive signed area in screen-y-down)
    const area = computeSignedArea(chained);
    if (area < 0) {
      // Reverse to CW
      const reversed: PathSegment[] = [];
      for (let i = chained.length - 1; i >= 0; i--) {
        reversed.push(reverseSegment(chained[i]));
      }
      return reversed;
    }
  }
  return chained;
}
