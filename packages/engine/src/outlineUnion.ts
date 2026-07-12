/**
 * Boolean-union geometry for closed line+arc outlines: clean a closed,
 * possibly self-intersecting / multi-loop outline into non-self-intersecting
 * boundary contours. Two entry points:
 *   - `unionOutline`         → the outer boundary only (holes collapsed).
 *   - `unionRegionContours`  → outer boundary + enclosed holes, ready to fill
 *                              with `fill-rule="nonzero"`.
 *
 * Inputs are expected CW-wound (screen y-down). Arcs are exact in and out:
 * sub-arcs keep their center, nothing is flattened. Runs on tens of segments —
 * O(N²) pairwise intersection is fine for that scale.
 *
 * Self-contained: depends only on `./types` and arc helpers in
 * `./compositionArcMath`.
 */

import { PathSegment } from './types';
import {
  arcAngles,
  arcRadius,
  angleOnArc,
  arcMotionAt,
  segLength,
  subSegment,
  mergeCollinear,
  computeSignedArea,
  reverseSegment,
} from './compositionArcMath';

const EPS = 1e-6;
/** Vertex-pool merge radius: crossings closer than this collapse to one vertex. */
const SNAP = 4e-6;

type Vec = [number, number];

function cloneSeg(seg: PathSegment): PathSegment {
  return seg.kind === 'arc'
    ? { kind: 'arc', start: [seg.start[0], seg.start[1]], end: [seg.end[0], seg.end[1]], center: [seg.center[0], seg.center[1]] }
    : { kind: 'line', start: [seg.start[0], seg.start[1]], end: [seg.end[0], seg.end[1]] };
}


// ---------------------------------------------------------------------------
// 1. Normalize
// ---------------------------------------------------------------------------

/**
 * Drop degenerate segments; split arcs sweeping > 135° at their midpoint
 * (keeps chord math well-conditioned); split any arc through the bottom of
 * its circle (angle π/2, y-down) there, so the outline's global max-y point
 * is always a vertex — the boundary walk starts at it.
 */
function normalize(segments: readonly PathSegment[]): PathSegment[] {
  const out: PathSegment[] = [];
  const maxSweep = (3 * Math.PI) / 4;
  const visit = (seg: PathSegment) => {
    if (segLength(seg) <= EPS) return;
    if (seg.kind === 'arc') {
      const { a0, da } = arcAngles(seg);
      if (Math.abs(da) > maxSweep + EPS) {
        visit(subSegment(seg, 0, 0.5));
        visit(subSegment(seg, 0.5, 1));
        return;
      }
      // Interior crossing of the circle-bottom angle π/2?
      const target = Math.PI / 2;
      const tau = 2 * Math.PI;
      const rel = da >= 0
        ? (((target - a0) % tau) + tau) % tau
        : (((a0 - target) % tau) + tau) % tau;
      const f = rel / Math.abs(da);
      if (rel > EPS && f > EPS && f < 1 - EPS && rel <= Math.abs(da) - EPS) {
        visit(subSegment(seg, 0, f));
        visit(subSegment(seg, f, 1));
        return;
      }
    }
    out.push(cloneSeg(seg));
  };
  for (const seg of segments) visit(seg);
  return out;
}

// ---------------------------------------------------------------------------
// 2. Pairwise intersections
// ---------------------------------------------------------------------------

/** Fraction of point `p` along `seg` (angle fraction on arcs), clamped. */
function fractionOn(seg: PathSegment, p: Vec): number {
  if (seg.kind === 'line') {
    const dx = seg.end[0] - seg.start[0];
    const dy = seg.end[1] - seg.start[1];
    const len2 = dx * dx + dy * dy;
    if (len2 <= EPS * EPS) return 0;
    const t = ((p[0] - seg.start[0]) * dx + (p[1] - seg.start[1]) * dy) / len2;
    return Math.min(Math.max(t, 0), 1);
  }
  const { a0, da } = arcAngles(seg);
  if (Math.abs(da) <= EPS) return 0;
  const pa = Math.atan2(p[1] - seg.center[1], p[0] - seg.center[0]);
  const tau = 2 * Math.PI;
  if (da >= 0) {
    const rel = (((pa - a0) % tau) + tau) % tau;
    return rel <= da + EPS ? Math.min(rel / da, 1) : (rel - da < (tau - da) / 2 ? 1 : 0);
  }
  const rel = (((a0 - pa) % tau) + tau) % tau;
  return rel <= -da + EPS ? Math.min(rel / -da, 1) : (rel + da < (tau + da) / 2 ? 1 : 0);
}

/** Whether param t lies on [0,1] with tolerance scaled to segment length. */
function onSpan(seg: PathSegment, t: number): boolean {
  const tol = (EPS * 4) / Math.max(segLength(seg), EPS);
  return t >= -tol && t <= 1 + tol;
}

type SplitRecorder = (fa: number, fb: number) => void;

function intersectLineLine(a: PathSegment, b: PathSegment, rec: SplitRecorder) {
  const r: Vec = [a.end[0] - a.start[0], a.end[1] - a.start[1]];
  const s: Vec = [b.end[0] - b.start[0], b.end[1] - b.start[1]];
  const denom = r[0] * s[1] - r[1] * s[0];
  const qp: Vec = [b.start[0] - a.start[0], b.start[1] - a.start[1]];
  const rl = Math.hypot(r[0], r[1]);
  if (Math.abs(denom) > EPS * rl * Math.hypot(s[0], s[1])) {
    const t = (qp[0] * s[1] - qp[1] * s[0]) / denom;
    const u = (qp[0] * r[1] - qp[1] * r[0]) / denom;
    if (onSpan(a, t) && onSpan(b, u)) rec(t, u);
    return;
  }
  // Parallel. Collinear overlap → record overlap endpoints as splits on both.
  if (rl <= EPS) return;
  if (Math.abs(qp[0] * r[1] - qp[1] * r[0]) / rl > EPS) return; // offset parallel
  const rl2 = rl * rl;
  for (const p of [b.start, b.end]) {
    const t = ((p[0] - a.start[0]) * r[0] + (p[1] - a.start[1]) * r[1]) / rl2;
    if (onSpan(a, t)) rec(t, fractionOn(b, [p[0], p[1]]));
  }
  for (const p of [a.start, a.end]) {
    const u = fractionOn(b, [p[0], p[1]]);
    const exact = Math.hypot(
      b.start[0] + (b.end[0] - b.start[0]) * u - p[0],
      b.start[1] + (b.end[1] - b.start[1]) * u - p[1],
    ) <= EPS * 4;
    if (exact) rec(fractionOn(a, [p[0], p[1]]), u);
  }
}

function intersectLineArc(line: PathSegment, arc: PathSegment, rec: SplitRecorder) {
  if (line.kind !== 'line' || arc.kind !== 'arc') return;
  const r = arcRadius(arc);
  const d: Vec = [line.end[0] - line.start[0], line.end[1] - line.start[1]];
  const fx = line.start[0] - arc.center[0];
  const fy = line.start[1] - arc.center[1];
  const A = d[0] * d[0] + d[1] * d[1];
  if (A <= EPS * EPS) return;
  const B = 2 * (fx * d[0] + fy * d[1]);
  const C = fx * fx + fy * fy - r * r;
  const disc = B * B - 4 * A * C;
  // Tangency window scaled to the geometry (EPS·max(1,r) in distance units).
  const tol = EPS * Math.max(1, r);
  const discTol = 4 * A * tol * Math.max(r, 1);
  const roots: number[] = [];
  if (disc > discTol) {
    const sq = Math.sqrt(disc);
    roots.push((-B - sq) / (2 * A), (-B + sq) / (2 * A));
  } else if (disc > -discTol) {
    roots.push(-B / (2 * A)); // tangency: single root
  }
  for (const t of roots) {
    if (!onSpan(line, t)) continue;
    const p: Vec = [line.start[0] + d[0] * t, line.start[1] + d[1] * t];
    const ang = Math.atan2(p[1] - arc.center[1], p[0] - arc.center[0]);
    if (!angleOnArc(arc, ang)) continue;
    rec(t, fractionOn(arc, p));
  }
}

function intersectArcArc(a: PathSegment, b: PathSegment, rec: SplitRecorder) {
  if (a.kind !== 'arc' || b.kind !== 'arc') return;
  const ra = arcRadius(a);
  const rb = arcRadius(b);
  const dx = b.center[0] - a.center[0];
  const dy = b.center[1] - a.center[1];
  const d = Math.hypot(dx, dy);
  if (d <= EPS) {
    // Concentric. Co-circular overlap → split each at the other's endpoints.
    if (Math.abs(ra - rb) > EPS) return;
    for (const p of [b.start, b.end]) {
      const ang = Math.atan2(p[1] - a.center[1], p[0] - a.center[0]);
      if (angleOnArc(a, ang)) rec(fractionOn(a, [p[0], p[1]]), fractionOn(b, [p[0], p[1]]));
    }
    for (const p of [a.start, a.end]) {
      const ang = Math.atan2(p[1] - b.center[1], p[0] - b.center[0]);
      if (angleOnArc(b, ang)) rec(fractionOn(a, [p[0], p[1]]), fractionOn(b, [p[0], p[1]]));
    }
    return;
  }
  if (d > ra + rb + EPS || d < Math.abs(ra - rb) - EPS) return;
  // Radical-line construction.
  const u = (d * d + ra * ra - rb * rb) / (2 * d);
  const h = Math.sqrt(Math.max(ra * ra - u * u, 0));
  const mx = a.center[0] + (dx / d) * u;
  const my = a.center[1] + (dy / d) * u;
  const pts: Vec[] = h <= EPS
    ? [[mx, my]] // external/internal tangency
    : [
        [mx - (dy / d) * h, my + (dx / d) * h],
        [mx + (dy / d) * h, my - (dx / d) * h],
      ];
  for (const p of pts) {
    const angA = Math.atan2(p[1] - a.center[1], p[0] - a.center[0]);
    const angB = Math.atan2(p[1] - b.center[1], p[0] - b.center[0]);
    if (!angleOnArc(a, angA) || !angleOnArc(b, angB)) continue;
    rec(fractionOn(a, p), fractionOn(b, p));
  }
}

function intersectPair(a: PathSegment, b: PathSegment, rec: SplitRecorder) {
  if (a.kind === 'line' && b.kind === 'line') intersectLineLine(a, b, rec);
  else if (a.kind === 'line') intersectLineArc(a, b, rec);
  else if (b.kind === 'line') intersectLineArc(b, a, (fb, fa) => rec(fa, fb));
  else intersectArcArc(a, b, rec);
}

/**
 * Count strictly-interior transversal crossings between two segments —
 * exact, no flattening. Endpoint touches, tangencies, collinear overlaps and
 * co-circular overlaps do NOT count. Useful for asserting an outline is a
 * clean simple boundary (zero proper self-crossings) without the phantom hits
 * a chord-flattened approximation would report against geometry the outline
 * legitimately touches.
 */
export function properCrossings(a: PathSegment, b: PathSegment): number {
  const T = 1e-9;
  const interior = (seg: PathSegment, f: number): boolean => {
    const tol = (EPS * 4) / Math.max(segLength(seg), EPS);
    return f > tol && f < 1 - tol;
  };
  if (a.kind === 'line' && b.kind === 'line') {
    const d = (p: readonly [number, number], q: readonly [number, number], c: readonly [number, number]) =>
      (q[0] - p[0]) * (c[1] - p[1]) - (q[1] - p[1]) * (c[0] - p[0]);
    const d1 = d(b.start, b.end, a.start);
    const d2 = d(b.start, b.end, a.end);
    const d3 = d(a.start, a.end, b.start);
    const d4 = d(a.start, a.end, b.end);
    return ((d1 > T && d2 < -T) || (d1 < -T && d2 > T))
      && ((d3 > T && d4 < -T) || (d3 < -T && d4 > T)) ? 1 : 0;
  }
  if (a.kind === 'line' || b.kind === 'line') {
    const line = a.kind === 'line' ? a : b;
    const arc = a.kind === 'line' ? b : a;
    if (arc.kind !== 'arc') return 0;
    const r = arcRadius(arc);
    const d: Vec = [line.end[0] - line.start[0], line.end[1] - line.start[1]];
    const A = d[0] * d[0] + d[1] * d[1];
    if (A <= EPS * EPS) return 0;
    const fx = line.start[0] - arc.center[0];
    const fy = line.start[1] - arc.center[1];
    const B = 2 * (fx * d[0] + fy * d[1]);
    const C = fx * fx + fy * fy - r * r;
    const disc = B * B - 4 * A * C;
    const discTol = 4 * A * (EPS * Math.max(1, r)) * Math.max(r, 1);
    if (disc <= discTol) return 0; // miss or tangency — not transversal
    const sq = Math.sqrt(disc);
    let count = 0;
    for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
      if (!interior(line, t)) continue;
      const p: Vec = [line.start[0] + d[0] * t, line.start[1] + d[1] * t];
      const ang = Math.atan2(p[1] - arc.center[1], p[0] - arc.center[0]);
      if (!angleOnArc(arc, ang)) continue;
      if (!interior(arc, fractionOn(arc, p))) continue;
      count++;
    }
    return count;
  }
  // arc × arc
  const ra = arcRadius(a);
  const rb = arcRadius(b);
  const dx = b.center[0] - a.center[0];
  const dy = b.center[1] - a.center[1];
  const dist = Math.hypot(dx, dy);
  if (dist <= EPS) return 0; // concentric: co-circular overlap or no contact
  if (dist > ra + rb - EPS || dist < Math.abs(ra - rb) + EPS) return 0; // miss or tangency
  const u = (dist * dist + ra * ra - rb * rb) / (2 * dist);
  const h = Math.sqrt(Math.max(ra * ra - u * u, 0));
  if (h <= EPS) return 0; // tangency — not transversal
  const mx = a.center[0] + (dx / dist) * u;
  const my = a.center[1] + (dy / dist) * u;
  let count = 0;
  for (const p of [
    [mx - (dy / dist) * h, my + (dx / dist) * h],
    [mx + (dy / dist) * h, my - (dx / dist) * h],
  ] as Vec[]) {
    const angA = Math.atan2(p[1] - a.center[1], p[0] - a.center[0]);
    const angB = Math.atan2(p[1] - b.center[1], p[0] - b.center[0]);
    if (!angleOnArc(a, angA) || !angleOnArc(b, angB)) continue;
    if (!interior(a, fractionOn(a, p)) || !interior(b, fractionOn(b, p))) continue;
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// 3. Split + vertex pool
// ---------------------------------------------------------------------------

interface Edge {
  seg: PathSegment;
  from: number; // vertex-pool indices
  to: number;
}

class VertexPool {
  points: Vec[] = [];
  /** Find-or-add with SNAP merge (linear scan — N is tiny). */
  index(p: readonly [number, number]): number {
    for (let i = 0; i < this.points.length; i++) {
      const q = this.points[i];
      if (Math.abs(q[0] - p[0]) <= SNAP && Math.abs(q[1] - p[1]) <= SNAP) return i;
    }
    this.points.push([p[0], p[1]]);
    return this.points.length - 1;
  }
}

/** Split every segment at its recorded fractions; snap ends into the pool. */
function buildEdges(segments: PathSegment[], splits: number[][], pool: VertexPool): Edge[] {
  const edges: Edge[] = [];
  segments.forEach((seg, i) => {
    const fs = (splits[i] || [])
      .filter((f) => f > EPS && f < 1 - EPS)
      .sort((x, y) => x - y);
    const cuts = [0, ...fs, 1];
    for (let k = 0; k + 1 < cuts.length; k++) {
      const f0 = cuts[k];
      const f1 = cuts[k + 1];
      if (f1 - f0 <= EPS) continue;
      const piece = subSegment(seg, f0, f1);
      if (segLength(piece) <= SNAP) continue;
      const from = pool.index(piece.start);
      const to = pool.index(piece.end);
      if (from === to && piece.kind === 'line') continue; // collapsed by snapping
      // Re-anchor endpoints to the pooled vertices so the walk is watertight.
      piece.start = [pool.points[from][0], pool.points[from][1]];
      piece.end = [pool.points[to][0], pool.points[to][1]];
      edges.push({ seg: piece, from, to });
    }
  });
  return edges;
}

// ---------------------------------------------------------------------------
// 4. Leftmost-turn walk
//
// Coincident edges need no dedup pass: duplicated boundary edges tie in the
// turn ordering (one copy is used, the rest go unused), opposite-direction
// folds (a face traversed out-and-back, e.g. a wrap's radial start face on a
// corridor face) are walked once from the exterior side, and interior seams
// hang inside the boundary where the leftmost walk never turns onto them.
// ---------------------------------------------------------------------------

interface DirectedEdge {
  edge: Edge;
  reversed: boolean;
  from: number;
  to: number;
  used: boolean;
}

/** Outgoing unit direction of a directed edge at its `from` end. */
function dirOut(d: DirectedEdge): Vec {
  const seg = d.edge.seg;
  if (seg.kind === 'arc') {
    const m = arcMotionAt(seg, d.reversed ? 1 : 0);
    return d.reversed ? [-m[0], -m[1]] : m;
  }
  const a = d.reversed ? seg.end : seg.start;
  const b = d.reversed ? seg.start : seg.end;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return len <= EPS ? [1, 0] : [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
}

/** Unit tangent at the END of a directed edge (direction of travel). */
function dirIn(d: DirectedEdge): Vec {
  const seg = d.edge.seg;
  if (seg.kind === 'arc') {
    const m = arcMotionAt(seg, d.reversed ? 0 : 1);
    return d.reversed ? [-m[0], -m[1]] : m;
  }
  return dirOut(d);
}

/**
 * Signed curvature traversing the edge in its directed sense: positive =
 * bending clockwise on screen (rightward), negative = leftward.
 */
function signedCurvature(d: DirectedEdge): number {
  const seg = d.edge.seg;
  if (seg.kind === 'line') return 0;
  const { da } = arcAngles(seg);
  const k = (da >= 0 ? 1 : -1) / Math.max(arcRadius(seg), EPS);
  return d.reversed ? -k : k;
}

/**
 * Walk the outer boundary. The outline is CW (interior on the right of
 * travel, y-down); hugging the exterior means taking the sharpest LEFT turn
 * at every vertex: minimum signed turn φ = atan2(d_out) − atan2(d_in)
 * normalized to (−π, π], curvature tie-break (more left-bending wins).
 * Start at the global max-y vertex (normalize() guaranteed the true bottom
 * extremum is a vertex) with a westward seed direction — at the bottom of a
 * CW loop travel is westward. Each directed edge is used at most once, so
 * the walk terminates. Returns null on failure (caller falls back).
 */
function walkOuter(edges: Edge[], pool: VertexPool): PathSegment[] | null {
  if (edges.length < 2) return null;
  const outgoing = new Map<number, DirectedEdge[]>();
  const add = (d: DirectedEdge) => {
    const g = outgoing.get(d.from);
    if (g) g.push(d);
    else outgoing.set(d.from, [d]);
  };
  for (const e of edges) {
    add({ edge: e, reversed: false, from: e.from, to: e.to, used: false });
    add({ edge: e, reversed: true, from: e.to, to: e.from, used: false });
  }

  let startV = -1;
  let bestY = -Infinity;
  let bestX = -Infinity;
  for (const i of outgoing.keys()) {
    const [x, y] = pool.points[i];
    if (y > bestY + SNAP || (y > bestY - SNAP && x > bestX)) {
      bestY = y;
      bestX = x;
      startV = i;
    }
  }
  if (startV < 0) return null;

  let inDir: Vec = [-1, 0];
  let prev: DirectedEdge | null = null;
  let v = startV;
  const chain: PathSegment[] = [];
  const maxSteps = edges.length * 2 + 1;
  for (let step = 0; step < maxSteps; step++) {
    const cands = outgoing.get(v);
    if (!cands) return null;
    let best: DirectedEdge | null = null;
    let bestPhi = Infinity;
    let bestCurv = Infinity;
    const inAng = Math.atan2(inDir[1], inDir[0]);
    for (const d of cands) {
      if (d.used) continue;
      // Never U-turn back along the edge we just traversed.
      if (prev && d.edge === prev.edge && d.reversed !== prev.reversed) continue;
      const od = dirOut(d);
      let phi = Math.atan2(od[1], od[0]) - inAng;
      while (phi <= -Math.PI + 1e-12) phi += 2 * Math.PI;
      while (phi > Math.PI) phi -= 2 * Math.PI;
      const curv = signedCurvature(d);
      if (phi < bestPhi - 1e-9 || (phi < bestPhi + 1e-9 && curv < bestCurv)) {
        best = d;
        bestPhi = phi;
        bestCurv = curv;
      }
    }
    if (!best) return null;
    best.used = true;
    chain.push(best.reversed ? reverseSegment(cloneSeg(best.edge.seg)) : cloneSeg(best.edge.seg));
    inDir = dirIn(best);
    prev = best;
    v = best.to;
    if (v === startV) return chain;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 5. Post-process
// ---------------------------------------------------------------------------

function postProcess(chain: PathSegment[]): PathSegment[] {
  // Exact closure: snap each start to the previous end, first to last.
  for (let i = 1; i < chain.length; i++) {
    chain[i].start = [chain[i - 1].end[0], chain[i - 1].end[1]];
  }
  chain[0].start = [chain[chain.length - 1].end[0], chain[chain.length - 1].end[1]];
  // The renderer draws arc sweeps ≤ 180° only — split anything at/above.
  const split: PathSegment[] = [];
  for (const seg of chain) {
    if (seg.kind === 'arc' && Math.abs(arcAngles(seg).da) >= Math.PI - EPS) {
      split.push(subSegment(seg, 0, 0.5), subSegment(seg, 0.5, 1));
    } else {
      split.push(seg);
    }
  }
  return mergeCollinear(split);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Outer boundary of one closed, CW-wound, possibly self-intersecting
 * line+arc outline. Simple inputs pass through (modulo collinear merging).
 * Defensive: on any internal failure returns the merged input — never throws.
 */
export function unionOutline(segments: readonly PathSegment[]): PathSegment[] {
  const fallback = () => mergeCollinear(segments.map(cloneSeg));
  if (segments.length < 2) return fallback();

  const segs = normalize(segments);
  if (segs.length < 2) return fallback();

  const splits: number[][] = segs.map(() => []);
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      intersectPair(segs[i], segs[j], (fi, fj) => {
        if (fi > EPS && fi < 1 - EPS) splits[i].push(fi);
        if (fj > EPS && fj < 1 - EPS) splits[j].push(fj);
      });
    }
  }

  const pool = new VertexPool();
  const edges = buildEdges(segs, splits, pool);
  if (edges.length < 2) return fallback();

  const walked = walkOuter(edges, pool);
  if (!walked || walked.length === 0) return fallback();

  const result = postProcess(walked);
  // Sanity: the outer boundary must be CW (positive signed area, y-down).
  if (computeSignedArea(result) <= 0) return fallback();
  return result;
}

// ---------------------------------------------------------------------------
// Full-region extraction (outer boundary + holes)
//
// Like unionOutline, but instead of collapsing to the outer boundary it emits
// the full boundary of the nonzero-winding region: the outer loop plus every
// enclosed hole, as clean non-self-intersecting contours. This is what keeps a
// union that encloses empty space (e.g. a ring) hollow rather than solid,
// matching a nonzero-filled render.
// ---------------------------------------------------------------------------

/**
 * Winding number of the original directed outline around (px,py), computed
 * exactly against lines and arcs (horizontal ray to +x, signed crossings).
 * Sign convention is arbitrary but consistent; only `!== 0` (filled) and the
 * relative left/right comparison matter downstream.
 */
function windingAtPoint(segs: readonly PathSegment[], px: number, py: number): number {
  const T = 1e-9;
  let wn = 0;
  for (const seg of segs) {
    if (seg.kind === 'line') {
      const sy = seg.start[1], ey = seg.end[1];
      if ((sy <= py && ey > py) || (sy > py && ey <= py)) {
        const t = (py - sy) / (ey - sy);
        const xc = seg.start[0] + t * (seg.end[0] - seg.start[0]);
        if (xc > px) wn += ey > sy ? 1 : -1;
      }
    } else {
      const cx = seg.center[0], cy = seg.center[1];
      const r = arcRadius(seg);
      const dyc = py - cy;
      if (Math.abs(dyc) > r) continue;
      const dxc = Math.sqrt(Math.max(r * r - dyc * dyc, 0));
      const sweepCW = arcAngles(seg).da >= 0; // CW (screen y-down) ⇒ travels +angle
      for (const s of dxc < T ? [0] : [1, -1]) {
        const xc = cx + s * dxc;
        if (xc <= px || Math.abs(xc - cx) < T) continue;
        const ang = Math.atan2(py - cy, xc - cx);
        if (!angleOnArc(seg, ang)) continue;
        // Vertical motion sign in the sweep direction ∝ (sweepCW ? +1 : −1)·cosθ,
        // and cosθ has the sign of (xc − cx). Positive = moving down-screen
        // (y-down convention), mirroring the line branch's `ey > sy` test.
        const dySign = (sweepCW ? 1 : -1) * (xc - cx);
        wn += dySign > 0 ? 1 : -1;
      }
    }
  }
  return wn;
}

/** Midpoint and right-hand unit normal (relative to stored travel direction,
 *  screen y-down) of a split edge — the two probe directions for winding. */
function edgeProbe(seg: PathSegment): { mx: number; my: number; nx: number; ny: number } {
  if (seg.kind === 'line') {
    const dx = seg.end[0] - seg.start[0];
    const dy = seg.end[1] - seg.start[1];
    const len = Math.hypot(dx, dy) || 1;
    return {
      mx: (seg.start[0] + seg.end[0]) / 2,
      my: (seg.start[1] + seg.end[1]) / 2,
      nx: -dy / len,
      ny: dx / len,
    };
  }
  const { a0, da } = arcAngles(seg);
  const r = arcRadius(seg);
  const aMid = a0 + da / 2;
  const t = arcMotionAt(seg, 0.5); // unit tangent in sweep direction
  return {
    mx: seg.center[0] + r * Math.cos(aMid),
    my: seg.center[1] + r * Math.sin(aMid),
    nx: -t[1],
    ny: t[0],
  };
}

/** Chain a set of consistently-oriented boundary edges (filled region on the
 *  right of travel) into closed loops, resolving junctions with the same
 *  sharpest-left-turn rule as walkOuter. Returns null on any open chain. */
function chainBoundaryLoops(boundary: DirectedEdge[]): PathSegment[][] | null {
  const outgoing = new Map<number, DirectedEdge[]>();
  for (const d of boundary) {
    const g = outgoing.get(d.from);
    if (g) g.push(d);
    else outgoing.set(d.from, [d]);
  }
  const loops: PathSegment[][] = [];
  for (const startE of boundary) {
    if (startE.used) continue;
    const chain: PathSegment[] = [];
    let cur: DirectedEdge = startE;
    const startV = startE.from;
    let closed = false;
    for (let step = 0; step <= boundary.length; step++) {
      cur.used = true;
      chain.push(cur.reversed ? reverseSegment(cloneSeg(cur.edge.seg)) : cloneSeg(cur.edge.seg));
      if (cur.to === startV) { closed = true; break; }
      const inDir = dirIn(cur);
      const inAng = Math.atan2(inDir[1], inDir[0]);
      let best: DirectedEdge | null = null;
      let bestPhi = Infinity;
      let bestCurv = Infinity;
      for (const d of outgoing.get(cur.to) || []) {
        if (d.used) continue;
        if (d.edge === cur.edge && d.reversed !== cur.reversed) continue; // no U-turn
        const od = dirOut(d);
        let phi = Math.atan2(od[1], od[0]) - inAng;
        while (phi <= -Math.PI + 1e-12) phi += 2 * Math.PI;
        while (phi > Math.PI) phi -= 2 * Math.PI;
        const curv = signedCurvature(d);
        if (phi < bestPhi - 1e-9 || (phi < bestPhi + 1e-9 && curv < bestCurv)) {
          best = d; bestPhi = phi; bestCurv = curv;
        }
      }
      if (!best) break; // dead end → open chain
      cur = best;
    }
    if (!closed) return null;
    loops.push(chain);
  }
  return loops.length > 0 ? loops : null;
}

/**
 * Whether the directed outline forms balanced closed loops: every vertex is
 * left exactly as many times as it is entered (in-degree === out-degree). This
 * is the precondition `unionRegionContours`' nonzero-winding hole extraction
 * relies on; an imbalanced vertex means the segments do not chain into
 * consistently-oriented loops, so the winding probe cannot be trusted.
 * Endpoints are snapped to TOL (the planner emits exact coordinates).
 */
function isDirectionallyBalanced(segs: readonly PathSegment[]): boolean {
  const TOL = 1e-4;
  const verts: { x: number; y: number; bal: number }[] = [];
  const bump = (p: readonly [number, number], d: number) => {
    let v = verts.find((q) => Math.abs(q.x - p[0]) <= TOL && Math.abs(q.y - p[1]) <= TOL);
    if (!v) { v = { x: p[0], y: p[1], bal: 0 }; verts.push(v); }
    v.bal += d;
  };
  for (const s of segs) { bump(s.start, 1); bump(s.end, -1); }
  return verts.every((v) => v.bal === 0);
}

/**
 * Full boundary (outer + holes) of one closed, possibly self-intersecting
 * line+arc outline, as clean non-self-intersecting contours concatenated into
 * one array: the outer loop(s) (CW, positive area) first, then hole loops
 * (CCW, negative area). With `fill-rule="nonzero"` this renders the holes.
 *
 * A simple (non-self-crossing) outline returns its single loop unchanged
 * (modulo collinear merge) — identical to `unionOutline`. Arcs stay exact.
 * Defensive: on any internal failure returns the merged input — never throws.
 */
export function unionRegionContours(segments: readonly PathSegment[]): PathSegment[] {
  const fallback = () => mergeCollinear(segments.map(cloneSeg));
  if (segments.length < 2) return fallback();

  // The winding-based hole extraction below assumes the input is a set of
  // consistently-oriented closed loops (see file header). A directionally-
  // inconsistent input — in/out-degree imbalance at some vertex, i.e. a
  // "segment soup" that does not chain head-to-tail — makes `windingAtPoint`
  // meaningless (it reports a phantom nonzero lobe OUTSIDE the real region, so a
  // genuine outer-boundary edge is misclassified as interior and dropped, the
  // chain dead-ends, and the raw self-overlapping outline is returned). Such an
  // input cannot encode a winding-determined hole anyway, so extract the clean
  // boundary with the orientation-independent outer-boundary walk instead.
  if (!isDirectionallyBalanced(segments)) return unionOutline(segments);

  const segs = normalize(segments);
  if (segs.length < 2) return fallback();

  const splits: number[][] = segs.map(() => []);
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      intersectPair(segs[i], segs[j], (fi, fj) => {
        if (fi > EPS && fi < 1 - EPS) splits[i].push(fi);
        if (fj > EPS && fj < 1 - EPS) splits[j].push(fj);
      });
    }
  }

  const pool = new VertexPool();
  const allEdges = buildEdges(segs, splits, pool);
  if (allEdges.length < 2) return fallback();

  // Collapse coincident duplicate edges (out-and-back fold-backs traverse the
  // same geometry twice; buildEdges emits one Edge per original segment). The
  // winding probe below already accounts for the doubled coverage, so the
  // boundary must reference each geometric edge once — otherwise the duplicate
  // gets walked into a second, overlapping loop.
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const e of allEdges) {
    const a = Math.min(e.from, e.to);
    const b = Math.max(e.from, e.to);
    const ck = e.seg.kind === 'arc'
      ? `${Math.round(e.seg.center[0] * 1e3)},${Math.round(e.seg.center[1] * 1e3)}`
      : '';
    const key = `${a}-${b}-${e.seg.kind}-${ck}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push(e);
  }
  if (edges.length < 2) return fallback();

  // Classify each split edge: probe just left and right of its midpoint and
  // keep it only where the filled (nonzero) region is on exactly one side.
  // Orient the kept edge so the filled region lies on its right (→ CW outer,
  // CCW holes), matching unionOutline's outer-boundary winding.
  const boundary: DirectedEdge[] = [];
  for (const e of edges) {
    const { mx, my, nx, ny } = edgeProbe(e.seg);
    const eps = Math.max(1e-3, Math.min(0.05 * segLength(e.seg), 0.25));
    const filledRight = windingAtPoint(segments, mx + nx * eps, my + ny * eps) !== 0;
    const filledLeft = windingAtPoint(segments, mx - nx * eps, my - ny * eps) !== 0;
    if (filledRight === filledLeft) continue; // interior or exterior edge
    const reversed = !filledRight; // make the filled side the right of travel
    boundary.push({
      edge: e,
      reversed,
      from: reversed ? e.to : e.from,
      to: reversed ? e.from : e.to,
      used: false,
    });
  }
  if (boundary.length < 2) return fallback();

  const loops = chainBoundaryLoops(boundary);
  if (!loops) return fallback();

  // Post-process and classify each loop; drop numerical slivers.
  const processed = loops
    .map((loop) => {
      const pp = postProcess(loop);
      return { pp, area: computeSignedArea(pp) };
    })
    .filter((p) => Math.abs(p.area) > 1e-7);
  if (processed.length === 0 || !processed.some((p) => p.area > 0)) return fallback();

  // Outer loops (positive area) first, holes (negative) last.
  processed.sort((a, b) => b.area - a.area);
  const result: PathSegment[] = [];
  for (const p of processed) result.push(...p.pp);

  // Sanity: net region area must be positive (outer dominates holes).
  if (computeSignedArea(result) <= 0) return fallback();
  return result;
}
