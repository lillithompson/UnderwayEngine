// Planar faces: the regions a set of path segments cuts a box into. Came
// from CozyJournal's web/content/ (Patchwork's day deals its patches from
// it) and is the pattern tool's Make Colorable too, which cuts a pattern's
// drawing into the same faces (patternPatches.ts) — so it lives here, beside
// the session, and both read it.
import {
  arcAngles, arcMotionAt, arcRadius, computeSignedArea, piecePointAt, reverseSegment,
  segLength, subSegment,
} from '@/engine/compositionArcMath';
import { arcBoundingBox } from '@/engine/compositionArcHitTest';
import { pointInClosedPath } from '@/engine/compositionPathHitTest';
import { PathSegment } from '@/engine/types';

// Slicing a bag of curves into the REGIONS they cut the plane into — the
// planar arrangement of a set of `PathSegment` lines and circular arcs, and
// its bounded faces. Patchwork uses it to turn its frame and its loop into
// the patches they carve each other into (web/content/patchwork.ts); it is
// written against PathSegment and knows nothing about Patchwork, because the
// problem is the engine's kind of problem rather than that game's.
//
// (The engine would be this module's eventual home — it is general geometry
// over the engine's own segment type, and `outlineUnion` is its neighbour.
// It lives here for now because nothing in the engine asks for it yet.)
//
// How it works, in the order the code runs:
//
//   1. MEET. Every pair of input segments is intersected, as points rather
//      than as a yes/no. Overlaps count too: where two curves lie along one
//      another, the ends of the shared run are meeting points like any other.
//      Pairs whose boxes miss each other are never asked (see `meetingPairs`)
//      — the one thing standing between this and quadratic time on the
//      thousands of segments a baked pattern grid hands it.
//   2. SPLIT. Each input segment is cut at every fraction anything met it,
//      so no two pieces cross any more — they only ever share endpoints.
//   3. WELD. Piece endpoints within a hair of each other become one VERTEX,
//      and pieces that came out geometrically identical — the shared run
//      above, now cut to the same two vertices — become one EDGE. Skip this
//      and a shared run would bound a face of no area.
//   4. PRUNE. An edge with a loose end bounds nothing, so it and its dead end
//      go, and again for whatever that leaves loose. A closed input has none
//      and passes through untouched; a drawing that trails off — which is
//      most of what a pattern's tiles draw — loses exactly its hairs.
//   5. WALK. Each edge is taken as two half-edges, one each way. Around every
//      vertex they are sorted by the direction they leave in, and a face is
//      traced by repeatedly taking the neighbour clockwise of the way you
//      came. That walk visits every half-edge exactly once and the cycles it
//      makes are the faces.
//   6. DROP THE OUTSIDE. One of those cycles runs the other way round: it is
//      the unbounded face, the outside of the whole arrangement, and it is
//      the one thing here that is not a region.
//
// The result partitions exactly: every bounded face is returned, none
// overlaps another, and their areas sum to the area the curves enclose.

/**
 * HOW CLOSE IS THE SAME PLACE — the one tolerance the whole module is cut
 * to. Two points within it are one vertex; a piece shorter than it is the
 * rounding of a split that landed on an endpoint rather than a piece of
 * curve; a curve that passes this near another touches it.
 *
 * The default suits geometry built on a lattice, which is what Patchwork
 * hands in: its coordinates are small (a page is 32 cells across) and exact,
 * so a hair is very fine indeed.
 *
 * A caller whose curves are DRAWN rather than constructed wants a looser
 * one, and `sliceIntoFaces` takes it. Baked tile art is the case: two tiles'
 * strokes reach the border between them at coordinates that differ in the
 * third decimal of the 256-unit square the art is authored on — invisible,
 * and far too wide for this. Left at the default, those two strokes are two
 * loose ends rather than one line, which merges the regions either side of
 * them.
 */
const WELD = 1e-6;

/** Slack for "is this fraction still on the segment". A pure numeric
 *  allowance on a 0–1 parameter, not a distance, so it is the same whatever
 *  tolerance the geometry is read at. */
const EPS = 1e-9;

/** Directions this close apart are the same direction — which happens for
 *  real, wherever one curve runs TANGENT to another (Patchwork's loop touches
 *  its frame that way at all four sides). Angles that genuinely differ here
 *  are never anywhere near this close; they differ by tenths of a radian. */
const SAME_DIRECTION = 1e-9;

type Pt = [number, number];
type ArcSegment = Extract<PathSegment, { kind: 'arc' }>;

const sub2 = (a: readonly number[], b: readonly number[]): Pt => [a[0] - b[0], a[1] - b[1]];
const cross2 = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0];
const dot2 = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Unit tangent along the direction of travel at fraction `f`. The engine
 *  answers this for arcs; a line's is the same the whole way along it. */
function motionAt(seg: PathSegment, f: number): Pt {
  if (seg.kind === 'arc') return arcMotionAt(seg, f);
  const d = sub2(seg.end, seg.start);
  const len = Math.hypot(d[0], d[1]);
  return len < EPS ? [1, 0] : [d[0] / len, d[1] / len];
}

/**
 * The direction a piece leaves its start in, as an angle to sort a vertex's
 * pieces by.
 *
 * Two things are done to the raw `atan2`, and both are load-bearing. DUE
 * WEST comes back as +π or as −π depending on nothing but the sign of a
 * zero, and those sort to opposite ends of a ring — so the −π side is pulled
 * up to +π first, which puts the one seam in the circle at a direction
 * nothing can straddle. Then the angle is SNAPPED to a fine lattice, so that
 * two pieces leaving tangent to one another — which happens for real,
 * wherever one curve touches another — come out equal however the last bit
 * of the arithmetic fell, and the curvature below can break the tie.
 */
function leavingAngle(seg: PathSegment): number {
  const [mx, my] = motionAt(seg, 0);
  let a = Math.atan2(my, mx);
  if (a <= -Math.PI + SAME_DIRECTION) a += 2 * Math.PI;
  return Math.round(a / SAME_DIRECTION) * SAME_DIRECTION + 0;
}

/**
 * Signed curvature in the direction of travel — 0 for a line, ±1/r for an
 * arc by which way it bends, in the same sense `arcAngles` measures.
 *
 * Only ever used to break a tie between two pieces LEAVING A VERTEX IN THE
 * SAME DIRECTION, where the one that bends further anticlockwise is the one
 * further round. Two pieces alike in both would be the same piece, and those
 * have already been welded into one.
 */
function curvatureAt(seg: PathSegment): number {
  if (seg.kind !== 'arc') return 0;
  const r = arcRadius(seg);
  return r < EPS ? 0 : Math.sign(arcAngles(seg).da) / r;
}

/**
 * The fraction of `seg` at which `p` sits, or null when `p` is not on it.
 * Every meeting point is turned into a cut this way, so the arithmetic that
 * FINDS a point and the arithmetic that places it on a curve are separate —
 * a point found off one of the two curves is simply dropped rather than
 * cutting it in the wrong place.
 */
function paramAt(seg: PathSegment, p: Pt, weld: number): number | null {
  const len = segLength(seg);
  if (len < weld) return null;
  const slack = weld / len;
  if (seg.kind === 'line') {
    const d = sub2(seg.end, seg.start);
    const t = dot2(sub2(p, seg.start), d) / dot2(d, d);
    if (t < -slack || t > 1 + slack) return null;
    const clamped = Math.min(1, Math.max(0, t));
    return dist(pointAt(seg, clamped), p) <= weld ? clamped : null;
  }
  const r = arcRadius(seg);
  if (Math.abs(dist(p, seg.center) - r) > weld) return null;
  const { a0, da } = arcAngles(seg);
  if (Math.abs(da) < EPS) return null;
  const tau = 2 * Math.PI;
  let rel = Math.atan2(p[1] - seg.center[1], p[0] - seg.center[0]) - a0;
  rel = ((rel % tau) + tau) % tau;
  for (const f of [rel / da, (rel - tau) / da]) {
    if (f >= -slack && f <= 1 + slack) return Math.min(1, Math.max(0, f));
  }
  return null;
}

function pointAt(seg: PathSegment, f: number): Pt {
  if (seg.kind === 'line') {
    return [seg.start[0] + (seg.end[0] - seg.start[0]) * f, seg.start[1] + (seg.end[1] - seg.start[1]) * f];
  }
  const { a0, da } = arcAngles(seg);
  const r = arcRadius(seg);
  return [seg.center[0] + r * Math.cos(a0 + da * f), seg.center[1] + r * Math.sin(a0 + da * f)];
}

/**
 * Where two segments might meet, as POINTS — before any question of whether
 * the points are actually on either piece, which `paramAt` settles.
 *
 * The four endpoints are always candidates. That is what makes overlaps work
 * without a case of their own: where two curves run along one another, the
 * ends of the shared run are endpoints of one or the other, because both are
 * stretches of the same straight line or the same circle.
 */
function meetingCandidates(a: PathSegment, b: PathSegment, weld: number): Pt[] {
  const out: Pt[] = [a.start, a.end, b.start, b.end].map((p) => [p[0], p[1]]);
  if (a.kind === 'line' && b.kind === 'line') out.push(...lineLine(a, b));
  else if (a.kind === 'line') out.push(...lineCircle(a, b as ArcSegment, weld));
  else if (b.kind === 'line') out.push(...lineCircle(b, a, weld));
  else out.push(...circleCircle(a, b, weld));
  return out;
}

/** Where two non-parallel infinite lines cross. Parallel ones give nothing:
 *  either they never meet, or they are collinear and the endpoints above
 *  already carry the overlap. */
function lineLine(a: PathSegment, b: PathSegment): Pt[] {
  const r = sub2(a.end, a.start);
  const s = sub2(b.end, b.start);
  const denom = cross2(r, s);
  if (Math.abs(denom) < EPS) return [];
  const t = cross2(sub2(b.start, a.start), s) / denom;
  return [[a.start[0] + r[0] * t, a.start[1] + r[1] * t]];
}

/** Where an infinite line meets a circle: two points, one where it is
 *  tangent, none where it misses. */
function lineCircle(line: PathSegment, arc: ArcSegment, weld: number): Pt[] {
  const d = sub2(line.end, line.start);
  const len2 = dot2(d, d);
  if (len2 < EPS) return [];
  const r = arcRadius(arc);
  const t = dot2(sub2(arc.center, line.start), d) / len2;
  const foot: Pt = [line.start[0] + d[0] * t, line.start[1] + d[1] * t];
  const gap = dist(foot, arc.center);
  if (gap > r + weld) return [];
  const half = Math.sqrt(Math.max(0, r * r - gap * gap)) / Math.sqrt(len2);
  return half < EPS
    ? [foot]
    : [[foot[0] + d[0] * half, foot[1] + d[1] * half], [foot[0] - d[0] * half, foot[1] - d[1] * half]];
}

/** Where two circles meet. Concentric ones give nothing: either they never
 *  meet, or they are the same circle and the endpoints already carry the
 *  overlap. */
function circleCircle(a: ArcSegment, b: ArcSegment, weld: number): Pt[] {
  const ra = arcRadius(a);
  const rb = arcRadius(b);
  const between = sub2(b.center, a.center);
  const d = Math.hypot(between[0], between[1]);
  if (d < weld || d > ra + rb + weld || d < Math.abs(ra - rb) - weld) return [];
  const along = (ra * ra - rb * rb + d * d) / (2 * d);
  const half = Math.sqrt(Math.max(0, ra * ra - along * along));
  const mid: Pt = [a.center[0] + (between[0] / d) * along, a.center[1] + (between[1] / d) * along];
  if (half < EPS) return [mid];
  const off: Pt = [(-between[1] / d) * half, (between[0] / d) * half];
  return [[mid[0] + off[0], mid[1] + off[1]], [mid[0] - off[0], mid[1] - off[1]]];
}

/** A box that certainly holds `seg`, grown by the weld so two curves that
 *  only just touch are still offered to each other. An arc's bulge is in it
 *  (`arcBoundingBox` walks the cardinals its sweep crosses), so the box is
 *  the curve's own extent rather than its chord's or its whole circle's. */
function segBox(seg: PathSegment, weld: number): [number, number, number, number] {
  const bb = arcBoundingBox([seg])!;
  return [bb.minX - weld, bb.minY - weld, bb.maxX + weld, bb.maxY + weld];
}

/**
 * The pairs of curves that could possibly meet — a plane sweep, in place of
 * asking every pair.
 *
 * Patchwork hands this module two curves' worth of segments and would not
 * notice either way. A pattern object's baked grid hands it THOUSANDS, and
 * every pair of those is millions of intersections whose answer is almost
 * always "nowhere near": the tile two cells over cannot cross this one.
 * Sorted by left edge, each curve is offered only those whose boxes still
 * overlap its own span, which for drawings made of short strokes is a
 * handful apiece.
 *
 * It only ever REMOVES pairs whose boxes are disjoint, and a meeting point
 * lies on both curves, so nothing that meets is lost: the boxes hold their
 * curves, and both are grown by the weld that decides what "touching" means.
 */
function meetingPairs(
  boxes: readonly [number, number, number, number][],
  visit: (i: number, j: number) => void,
): void {
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a][0] - boxes[b][0]);
  for (let a = 0; a < order.length; a++) {
    const i = order[a];
    const [, iy0, ix1, iy1] = boxes[i];
    for (let b = a + 1; b < order.length; b++) {
      const j = order[b];
      const [jx0, jy0, , jy1] = boxes[j];
      // Sorted by left edge: once one box starts to the right of this one's
      // right edge, so does every box after it.
      if (jx0 > ix1) break;
      if (jy0 > iy1 || iy0 > jy1) continue;
      visit(i, j);
    }
  }
}

/** Every input segment cut at every fraction anything else met it, so the
 *  pieces that come back cross nothing and only ever share endpoints. */
function splitAtMeetings(curves: readonly PathSegment[], weld: number): PathSegment[] {
  const cuts: number[][] = curves.map(() => [0, 1]);
  meetingPairs(curves.map((seg) => segBox(seg, weld)), (i, j) => {
    for (const p of meetingCandidates(curves[i], curves[j], weld)) {
      const fi = paramAt(curves[i], p, weld);
      if (fi === null) continue;
      const fj = paramAt(curves[j], p, weld);
      if (fj === null) continue;
      cuts[i].push(fi);
      cuts[j].push(fj);
    }
  });
  const pieces: PathSegment[] = [];
  curves.forEach((seg, i) => {
    const len = segLength(seg);
    if (len < weld) return;
    const keep = [...cuts[i]].sort((x, y) => x - y)
      .filter((f, k, all) => k === 0 || (f - all[k - 1]) * len > weld);
    for (let k = 1; k < keep.length; k++) pieces.push(subSegment(seg, keep[k - 1], keep[k]));
  });
  return pieces;
}

/**
 * The pieces' shared endpoints, welded: each distinct point once, and the
 * index of the point each piece starts and ends at.
 *
 * Points are filed in buckets a WELD across, and a point looks only in its
 * own bucket and the eight around it — the nine that can possibly hold
 * anything within a weld of it, since two points that close can be at most
 * one bucket apart on either axis. Scanning every point found so far instead
 * is the same quadratic this module's other half was (`meetingPairs`), and
 * it bites at the same size: a pattern's grid welds tens of thousands of
 * endpoints.
 */
function weldVertices(
  pieces: readonly PathSegment[], weld: number,
): { points: Pt[]; ends: [number, number][] } {
  const points: Pt[] = [];
  const buckets = new Map<string, number[]>();
  const idOf = (p: readonly number[]): number => {
    const gx = Math.round(p[0] / weld);
    const gy = Math.round(p[1] / weld);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const near = buckets.get(`${gx + dx},${gy + dy}`);
        if (!near) continue;
        for (const i of near) if (dist(points[i], p) <= weld) return i;
      }
    }
    points.push([p[0], p[1]]);
    const id = points.length - 1;
    const key = `${gx},${gy}`;
    const own = buckets.get(key);
    if (own) own.push(id); else buckets.set(key, [id]);
    return id;
  };
  return { points, ends: pieces.map((seg) => [idOf(seg.start), idOf(seg.end)]) };
}

/** A piece's identity as an EDGE: which two vertices it runs between, which
 *  kind of curve it is, and — for an arc, whose centre settles which of the
 *  two ways round it goes — where its centre is. Direction is deliberately
 *  not in it: a piece and the same piece backwards are one edge. */
function edgeKey(seg: PathSegment, a: number, b: number, weld: number): string {
  const ends = a < b ? `${a}-${b}` : `${b}-${a}`;
  const centre = seg.kind === 'arc'
    ? `@${Math.round(seg.center[0] / weld)},${Math.round(seg.center[1] / weld)}`
    : '';
  return `${seg.kind}:${ends}${centre}`;
}

interface HalfEdge {
  from: number;
  to: number;
  seg: PathSegment;
  /** The other way along the same edge. */
  twin: number;
  /** Direction it leaves `from` in, and how it bends as it goes — the two
   *  keys it is sorted by around that vertex. */
  angle: number;
  curvature: number;
}

/**
 * The bounded faces of the arrangement of `curves`: the regions those curves
 * cut the plane into, each returned as a closed, chained run of segments
 * wound clockwise (positive signed area, as the engine measures it).
 *
 * The curves need not CLOSE. Whatever trails off — a stroke with a loose
 * end, and whatever that end's removal leaves loose in turn — is pruned
 * before the walk, because an edge with a free end bounds no region. A
 * closed input has nothing to prune and goes through untouched, which is
 * what Patchwork hands it; a pattern's baked tile grid trails off all over.
 *
 * `weld` is how close counts as the same place, and it is the one knob worth
 * turning: see {@link WELD}. Too tight for the curves in hand and lines that
 * were drawn as one come apart into loose ends, which the prune then eats;
 * too loose and features closer together than it are welded into one.
 */
export function sliceIntoFaces(
  curves: readonly PathSegment[], weld: number = WELD,
): PathSegment[][] {
  // The floor on a region's AREA. A face thinner than the weld all the way
  // round is the arrangement's own rounding rather than a region, and how
  // much area that is scales with the weld squared, not with the weld.
  const areaFloor = weld * weld;
  const pieces = splitAtMeetings(curves, weld);
  if (pieces.length === 0) return [];
  const { points, ends } = weldVertices(pieces, weld);

  // One EDGE per distinct piece. Two pieces that came out as the same curve
  // — the shared run of an overlap — collapse to one here; left as two they
  // would bound a face of no area between them.
  const edges: { a: number; b: number; seg: PathSegment }[] = [];
  const seen = new Set<string>();
  pieces.forEach((seg, i) => {
    const [a, b] = ends[i];
    if (a === b) return; // a piece that starts and ends nowhere
    const key = edgeKey(seg, a, b, weld);
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ a, b, seg });
  });

  // PRUNE the loose ends. A vertex only one edge reaches is the end of a
  // line that goes nowhere: it bounds nothing, so the edge goes, and the
  // vertex at its other end may be left loose in turn — hence the queue
  // rather than one pass. Without this a hair inside a region joins that
  // region's boundary and is walked down and back, which fills and strokes
  // as a slit cut into the patch.
  const degree = new Array<number>(points.length).fill(0);
  for (const e of edges) { degree[e.a]++; degree[e.b]++; }
  const dropped = new Array<boolean>(edges.length).fill(false);
  const atVertex: number[][] = points.map(() => []);
  edges.forEach((e, i) => { atVertex[e.a].push(i); atVertex[e.b].push(i); });
  const loose: number[] = [];
  degree.forEach((d, v) => { if (d === 1) loose.push(v); });
  while (loose.length > 0) {
    const v = loose.pop()!;
    if (degree[v] !== 1) continue;
    for (const i of atVertex[v]) {
      if (dropped[i]) continue;
      dropped[i] = true;
      const far = edges[i].a === v ? edges[i].b : edges[i].a;
      degree[v]--;
      degree[far]--;
      if (degree[far] === 1) loose.push(far);
    }
  }

  // One half-edge each way per surviving edge.
  const half: HalfEdge[] = [];
  edges.forEach(({ a, b, seg }, i) => {
    if (dropped[i]) return;
    const back = reverseSegment(seg);
    const h = half.length;
    half.push({ from: a, to: b, seg, twin: h + 1, angle: 0, curvature: 0 });
    half.push({ from: b, to: a, seg: back, twin: h, angle: 0, curvature: 0 });
  });
  if (half.length === 0) return [];
  for (const h of half) {
    h.angle = leavingAngle(h.seg);
    h.curvature = curvatureAt(h.seg);
  }

  // Around each vertex, the half-edges leaving it in anticlockwise order —
  // by the direction they leave in, then by how they bend, which is what
  // separates two that leave tangent to one another.
  const around: number[][] = points.map(() => []);
  half.forEach((h, i) => around[h.from].push(i));
  for (const ring of around) {
    ring.sort((i, j) => (half[i].angle - half[j].angle) || (half[i].curvature - half[j].curvature));
  }
  const place = new Map<number, number>();
  around.forEach((ring) => ring.forEach((h, k) => place.set(h, k)));

  // Which CONNECTED PIECE of the drawing each vertex belongs to — the
  // islands, which the hole-finding below has to be able to tell apart from
  // the face they sit in. A vertex joins its neighbour's piece for every
  // edge that survived the prune.
  const root = new Array<number>(points.length).fill(0).map((_, i) => i);
  const find = (v: number): number => {
    let r = v;
    while (root[r] !== r) r = root[r];
    while (root[v] !== r) { const up = root[v]; root[v] = r; v = up; }
    return r;
  };
  for (const h of half) {
    const a = find(h.from);
    const b = find(h.to);
    if (a !== b) root[a] = b;
  }

  // Trace: arrive along `h`, and leave by the neighbour CLOCKWISE of the way
  // you came. Every half-edge belongs to exactly one face, so one pass over
  // them collects every face exactly once.
  const faces: PathSegment[][] = [];
  /** The piece of the drawing each cycle was walked on. */
  const component: number[] = [];
  const walked = new Array<boolean>(half.length).fill(false);
  for (let start = 0; start < half.length; start++) {
    if (walked[start]) continue;
    const cycle: PathSegment[] = [];
    let h = start;
    do {
      walked[h] = true;
      cycle.push(half[h].seg);
      const ring = around[half[h].to];
      h = ring[(place.get(half[h].twin)! - 1 + ring.length) % ring.length];
    } while (h !== start && !walked[h]);
    faces.push(cycle);
    component.push(find(half[start].from));
  }

  // The walk's winding is not a coin toss: a bounded face always comes back
  // CLOCKWISE (positive, as the engine measures area) and the cycle that
  // runs the OUTSIDE of a connected piece of the drawing always comes back
  // the other way. So the sign sorts them, and faces of no area are rounding
  // and belong to neither.
  const areas = faces.map((f) => computeSignedArea(f));
  const inner: number[] = [];
  const outer: number[] = [];
  areas.forEach((a, i) => {
    if (a > areaFloor) inner.push(i);
    else if (a < -areaFloor) outer.push(i);
  });

  // HOLES. There is one `outer` cycle per CONNECTED PIECE of the drawing —
  // not one in total — and only the piece that nothing encloses is the
  // outside of the world. Every other one is an island sitting in some
  // face's middle, and that face is not the island's outline all over
  // again: it is everything but. So each island's outline joins the
  // smallest face that holds it as a second, counter-wound loop, which is
  // exactly how the renderer spells a hole (`buildClosedFillPathD`,
  // fill-rule nonzero).
  //
  // Skip this and two patches claim the same ground — a pattern whose tiles
  // do not reach its frame hands back the whole frame AND the ring inside
  // it, overlapping, which is the one thing this module promises never to
  // return.
  const holes: number[][] = faces.map(() => []);
  for (const o of outer) {
    // A point ON the island's outline: inside every face that holds the
    // island, on the boundary of none of them — the islands are separate
    // pieces, so nothing of another piece passes through it. Its own
    // piece's faces are the ones that WOULD, and they are skipped by name.
    const [px, py] = piecePointAt(faces[o][0], 0.5);
    let best = -1;
    for (const f of inner) {
      if (component[f] === component[o]) continue;
      if (best >= 0 && areas[f] >= areas[best]) continue;
      if (pointInClosedPath(faces[f], px, py)) best = f;
    }
    if (best >= 0) holes[best].push(o);
  }

  // Each face, welded LOOP BY LOOP — its own outline first, then the
  // outline of every island it holds. (One weld across the lot would join
  // the end of one loop to the start of the next and draw them as one
  // path.)
  return inner.map((f) => [
    ...weldShut(faces[f]),
    ...holes[f].flatMap((o) => weldShut(faces[o])),
  ]);
}

/**
 * A face's joins made BIT-EXACT: each piece's start set to the literal end
 * of the piece before it, right round to the first.
 *
 * The pieces already meet — they were cut at one welded vertex — but they
 * were cut off different curves, so the two copies of that vertex can differ
 * in the last bits. That is close enough for everything that asks whether a
 * path is closed (all of which allow a tolerance) and not close enough for
 * the path builder, which starts a NEW subpath the moment a piece's start
 * is not the exact number the last piece ended on. A patch whose outline
 * broke into subpaths that way would stroke and fill as several shapes.
 */
function weldShut(face: readonly PathSegment[]): PathSegment[] {
  const out = face.map((seg): PathSegment => (seg.kind === 'arc'
    ? { kind: 'arc', start: [...seg.start], end: [...seg.end], center: [...seg.center] }
    : { kind: 'line', start: [...seg.start], end: [...seg.end] }));
  for (let i = 0; i < out.length; i++) {
    const prev = out[(i - 1 + out.length) % out.length];
    out[i].start = [prev.end[0], prev.end[1]];
  }
  return out;
}
