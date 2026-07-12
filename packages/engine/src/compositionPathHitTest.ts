import { CurveSegment, PathSegment, SVGObject } from './types';
import { arcRadius, chainSegmentsLoops, computeSweepFlag } from './compositionArcMath';
import { svgTileGrid } from './tileSegmentOverrides';

/**
 * Squared distance from point (px,py) to the closest point on the line
 * segment from (sx,sy) to (ex,ey). For zero-length segments this reduces
 * to squared point-to-point distance.
 */
export function pointToLineSegmentDistSq(
  px: number, py: number,
  sx: number, sy: number,
  ex: number, ey: number,
): number {
  const dx = ex - sx;
  const dy = ey - sy;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    // Degenerate: segment is a point
    const dpx = px - sx;
    const dpy = py - sy;
    return dpx * dpx + dpy * dpy;
  }
  // Project point onto the infinite line, clamp to [0,1]
  const t = Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / lenSq));
  const projX = sx + t * dx;
  const projY = sy + t * dy;
  const dpx = px - projX;
  const dpy = py - projY;
  return dpx * dpx + dpy * dpy;
}

/**
 * Normalize an angle to the range [0, 2*PI).
 */
function normalizeAngle(a: number): number {
  const TWO_PI = 2 * Math.PI;
  a = a % TWO_PI;
  if (a < 0) a += TWO_PI;
  return a;
}

/**
 * Check whether angle `a` lies within the arc swept from `startAngle`
 * to `endAngle` in the given direction.
 * @param sweepCW true if the arc sweeps clockwise (screen-y-down)
 */
function angleInArcSpan(a: number, startAngle: number, endAngle: number, sweepCW: boolean): boolean {
  // Normalize all angles to [0, 2*PI)
  const s = normalizeAngle(startAngle);
  const e = normalizeAngle(endAngle);
  const p = normalizeAngle(a);

  if (sweepCW) {
    // CW sweep (screen-y-down): angles increase from start to end
    if (s <= e) {
      return p >= s && p <= e;
    } else {
      // Wraps around 0: [s..2PI) ∪ [0..e]
      return p >= s || p <= e;
    }
  } else {
    // CCW sweep: angles decrease from start to end
    if (s >= e) {
      return p <= s && p >= e;
    } else {
      // Wraps around 0: [0..s] ∪ [e..2PI)
      return p <= s || p >= e;
    }
  }
}

/**
 * Squared distance from point (px,py) to the closest point on a circular
 * arc segment. If the point's angle from the arc center falls within the
 * arc's angular span, the distance is the radial offset from the circle.
 * Otherwise it's the distance to the nearest endpoint.
 */
export function pointToArcSegmentDistSq(
  px: number, py: number,
  seg: CurveSegment,
): number {
  const [cx, cy] = seg.center;
  const r = arcRadius(seg);

  // Squared distances to endpoints (fallback)
  const dsxSq = (px - seg.start[0]) ** 2 + (py - seg.start[1]) ** 2;
  const dexSq = (px - seg.end[0]) ** 2 + (py - seg.end[1]) ** 2;

  if (r < 1e-9) {
    // Degenerate arc: radius ~0, treat as point
    return Math.min(dsxSq, dexSq);
  }

  const angleP = Math.atan2(py - cy, px - cx);
  const angleS = Math.atan2(seg.start[1] - cy, seg.start[0] - cx);
  const angleE = Math.atan2(seg.end[1] - cy, seg.end[0] - cx);

  const sweepCW = computeSweepFlag(seg.start, seg.end, seg.center) === 1;

  if (angleInArcSpan(angleP, angleS, angleE, sweepCW)) {
    // Point's angle is within the arc — radial distance to the circle
    const d = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
    const radialDist = d - r;
    return radialDist * radialDist;
  }

  // Outside arc span — closest endpoint
  return Math.min(dsxSq, dexSq);
}

/**
 * Squared distance from point (px,py) to the nearest point on any
 * segment in the array.
 */
function minSegmentDistSq(
  segments: ReadonlyArray<PathSegment>,
  px: number, py: number,
): number {
  let best = Infinity;
  for (const seg of segments) {
    const d = seg.kind === 'arc'
      ? pointToArcSegmentDistSq(px, py, seg)
      : pointToLineSegmentDistSq(px, py, seg.start[0], seg.start[1], seg.end[0], seg.end[1]);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Test whether the point (px,py) is within `toleranceSq` (squared cell
 * distance) of any path segment in the SVGObject, including subpaths.
 */
export function svgPathHitsPoint(
  svg: SVGObject, px: number, py: number, toleranceSq: number,
): boolean {
  if (minSegmentDistSq(svg.segments, px, py) <= toleranceSq) return true;
  if (svg.subpaths) {
    for (const sub of svg.subpaths) {
      if (minSegmentDistSq(sub.segments, px, py) <= toleranceSq) return true;
    }
  }
  return false;
}

/** One brush hit: the flat segment index and its squared distance to the brush
 *  center. In sparse per-copy paint mode (`perInstance`), `col`/`row` identify
 *  WHICH repeated tile copy was hit (in the object's baked-world tile grid);
 *  they are undefined otherwise. */
export interface BrushHit {
  idx: number;
  distSq: number;
  col?: number;
  row?: number;
}

/**
 * Find every segment in `svg` whose closest point to (px,py) lies within
 * `radiusCells`, returning each as `{idx, distSq}`. `idx` is the flat
 * index into the same list `flattenSVGSegmentsWithColor` produces —
 * subpaths-only when subpaths are non-empty, main segments otherwise.
 * The caller uses these indices as stable identities through a paint
 * stroke; the flat ordering must match `flattenSVGSegmentsWithColor`'s
 * so painted segments line up with the regroup pass.
 *
 * `distSq` is surfaced (rather than discarded) so callers can compute a
 * per-segment falloff multiplier without re-running the distance test.
 *
 * Walking BOTH main and subpaths (the prior implementation) double-
 * counted geometry under the regroup invariant where `segments` and
 * `subpaths` describe the same geometry twice — that caused painted
 * SVGs' segment count to double on every stroke.
 *
 * Unlike `svgPathHitsPoint`, this does NOT short-circuit on first hit —
 * the drag-paint brush must collect every segment it crosses.
 *
 * For a `tileMode: 'repeat'` object the geometry is stored once (the origin
 * tile) but rendered as a grid of copies. `perInstance` selects between two
 * behaviours:
 *   - false (whole-object hit-test): the brush point is wrapped into the
 *     origin tile, so painting on any copy hits the same segments. `col`/`row`
 *     are undefined.
 *   - true (per-copy paint): every copy the brush footprint overlaps is tested
 *     in its own frame and its hits are tagged with that copy's `col`/`row`, so
 *     a dab spanning a tile boundary paints both copies with correct falloff.
 */
export function brushHitsSegments(
  svg: SVGObject,
  px: number, py: number,
  radiusCells: number,
  perInstance: boolean = false,
): BrushHit[] {
  const tolSq = radiusCells * radiusCells;
  const hits: BrushHit[] = [];

  // Test every segment against the local brush point (lpx,lpy) and push the
  // ones within tolerance, tagged with this copy's (col,row). Walks subpaths
  // when present, else main segments — the flat ordering must match
  // `flattenSVGSegmentsWithColor` (see header). idx restarts per copy.
  const accumulate = (lpx: number, lpy: number, col?: number, row?: number) => {
    let idx = 0;
    const test = (seg: PathSegment): number => seg.kind === 'arc'
      ? pointToArcSegmentDistSq(lpx, lpy, seg)
      : pointToLineSegmentDistSq(lpx, lpy, seg.start[0], seg.start[1], seg.end[0], seg.end[1]);
    const push = (d: number) => {
      if (d <= tolSq) hits.push({ idx, distSq: d, col, row });
      idx += 1;
    };
    if (Array.isArray(svg.subpaths) && svg.subpaths.length > 0) {
      for (const sub of svg.subpaths) for (const seg of sub.segments) push(test(seg));
    } else {
      for (const seg of svg.segments) push(test(seg));
    }
  };

  if (svg.tileMode === 'repeat') {
    const tw = svg.tileWidthL0 ?? svg.cellWidth;
    const th = svg.tileHeightL0 ?? svg.cellHeight;
    if (tw > 0 && th > 0) {
      if (perInstance) {
        // Per-copy paint: a single tile holds the geometry, but every repeated
        // copy is independently paintable. Test EACH copy the brush footprint
        // overlaps in its own frame — translating the brush point by −col·tile
        // preserves distance, so distSq is the true world distance to that
        // copy's segment. This lets a dab straddling a tile boundary paint both
        // neighbouring copies with correct falloff (matching the flat-expand
        // brush), instead of folding the spill back into one copy. The copy
        // range is the tiles whose span the brush radius reaches, clamped to
        // the region's visible tiles so we never record overrides for copies
        // that aren't rendered.
        const g = svgTileGrid(svg);
        const cLo = Math.max(g.colMin, Math.floor((px - radiusCells - g.anchorX) / tw));
        const cHi = Math.min(g.colMax, Math.floor((px + radiusCells - g.anchorX) / tw));
        const rLo = Math.max(g.rowMin, Math.floor((py - radiusCells - g.anchorY) / th));
        const rHi = Math.min(g.rowMax, Math.floor((py + radiusCells - g.anchorY) / th));
        for (let row = rLo; row <= rHi; row++) {
          for (let col = cLo; col <= cHi; col++) {
            accumulate(px - col * tw, py - row * th, col, row);
          }
        }
        return hits;
      }
      // Whole-object hit-test (e.g. recolor / selection): wrap the brush point
      // into the origin tile so painting on any repeated copy hits the same
      // segments, untagged by copy.
      const anchorX = svg.cellX + (svg.tileOffsetXL0 ?? 0);
      const anchorY = svg.cellY + (svg.tileOffsetYL0 ?? 0);
      accumulate(
        anchorX + (((px - anchorX) % tw) + tw) % tw,
        anchorY + (((py - anchorY) % th) + th) % th,
      );
      return hits;
    }
  }

  accumulate(px, py);
  return hits;
}

/** Samples per arc segment when flattening a closed path to a polygon.
 *  Hit testing uses 8 (a quarter-circle's max chord error ≪ one grid
 *  cell); the CSS tile-mask clip uses a denser count so a curved mask's
 *  polygon edge visually matches the SVG member's exact-arc `<path>`. */
const ARC_FLATTEN_SAMPLES = 8;
const ARC_FLATTEN_SAMPLES_DENSE = 24;

/** Flattened-polygon caches keyed by segments-array reference. World
 *  segments are replaced immutably on every edit/rematerialization, so
 *  reference identity is a valid cache key. Each entry is the array of
 *  per-loop polygons (outer + holes); `null` marks a bag that could not be
 *  chained into closed loops. Separate maps per sample count so the 8-sample
 *  (hit-test) and dense (CSS clip) results don't collide. */
const flattenedPolygonCache = new WeakMap<readonly PathSegment[], Float64Array[] | null>();
const denseFlattenedPolygonCache = new WeakMap<readonly PathSegment[], Float64Array[] | null>();

/**
 * Flatten one already-chained closed loop into a flat [x0,y0,…] polygon,
 * sampling each arc into `arcSamples` chords. Returns null if too few points.
 */
function flattenLoopToPolygon(
  loop: readonly PathSegment[], arcSamples: number,
): Float64Array | null {
  const pts: number[] = [];
  for (const seg of loop) {
    pts.push(seg.start[0], seg.start[1]);
    if (seg.kind !== 'arc') continue;
    const [cx, cy] = seg.center;
    const r = arcRadius(seg);
    if (r < 1e-9) continue;
    const a0 = Math.atan2(seg.start[1] - cy, seg.start[0] - cx);
    let a1 = Math.atan2(seg.end[1] - cy, seg.end[0] - cx);
    const sweepCW = computeSweepFlag(seg.start, seg.end, seg.center) === 1;
    // Traverse in sweep direction (CW = increasing angle, screen-y-down).
    if (sweepCW && a1 <= a0 + 1e-9) a1 += 2 * Math.PI;
    if (!sweepCW && a1 >= a0 - 1e-9) a1 -= 2 * Math.PI;
    for (let i = 1; i < arcSamples; i++) {
      const a = a0 + ((a1 - a0) * i) / arcSamples;
      pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    // Segment endpoints are shared with the next segment's start — no
    // explicit end point needed.
  }
  return pts.length >= 6 ? Float64Array.from(pts) : null;
}

/**
 * Chain `segments` into one or more closed loops (outer boundary + any holes)
 * and flatten each to a polygon. Returns null when the segments cannot be
 * chained into closed loops.
 */
function flattenClosedPathLoops(
  segments: readonly PathSegment[], arcSamples: number,
): Float64Array[] | null {
  const loops = chainSegmentsLoops(segments);
  if (!loops) return null;
  const polys: Float64Array[] = [];
  for (const loop of loops) {
    const poly = flattenLoopToPolygon(loop, arcSamples);
    if (poly) polys.push(poly);
  }
  return polys.length > 0 ? polys : null;
}

/** Cached array of per-loop flattened polygons (outer + holes), or null when
 *  open/unchainable. */
function getFlattenedClosedPathLoops(
  segments: readonly PathSegment[], dense: boolean,
): Float64Array[] | null {
  const cache = dense ? denseFlattenedPolygonCache : flattenedPolygonCache;
  let polys = cache.get(segments);
  if (polys === undefined) {
    polys = flattenClosedPathLoops(segments, dense ? ARC_FLATTEN_SAMPLES_DENSE : ARC_FLATTEN_SAMPLES);
    cache.set(segments, polys);
  }
  return polys;
}

/** Absolute polygon area (shoelace) of a flat [x0,y0,…] polygon. */
function polygonAbsArea(poly: Float64Array): number {
  const n = poly.length / 2;
  let a2 = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    a2 += poly[2 * j] * poly[2 * i + 1] - poly[2 * i] * poly[2 * j + 1];
  }
  return Math.abs(a2) / 2;
}

/**
 * Flatten each segment independently into straight chord edges, returning a
 * flat [ax,ay,bx,by, …] array (4 numbers per edge). A `line` contributes one
 * edge; an `arc` contributes `arcSamples` chord edges using the same
 * radius/sweep sampling as `flattenLoopToPolygon`. Unlike the closed-path
 * flatteners this does NOT chain or require a closed loop, so it works on open
 * or unordered segment bags (e.g. a lone line or arc member shape).
 */
export function flattenSegmentsToEdges(
  segments: readonly PathSegment[], arcSamples = ARC_FLATTEN_SAMPLES,
): Float64Array {
  const edges: number[] = [];
  for (const seg of segments) {
    if (seg.kind !== 'arc') {
      edges.push(seg.start[0], seg.start[1], seg.end[0], seg.end[1]);
      continue;
    }
    const [cx, cy] = seg.center;
    const r = arcRadius(seg);
    if (r < 1e-9) {
      edges.push(seg.start[0], seg.start[1], seg.end[0], seg.end[1]);
      continue;
    }
    const a0 = Math.atan2(seg.start[1] - cy, seg.start[0] - cx);
    let a1 = Math.atan2(seg.end[1] - cy, seg.end[0] - cx);
    const sweepCW = computeSweepFlag(seg.start, seg.end, seg.center) === 1;
    if (sweepCW && a1 <= a0 + 1e-9) a1 += 2 * Math.PI;
    if (!sweepCW && a1 >= a0 - 1e-9) a1 -= 2 * Math.PI;
    let px = seg.start[0], py = seg.start[1];
    for (let i = 1; i <= arcSamples; i++) {
      const a = a0 + ((a1 - a0) * i) / arcSamples;
      const nx = cx + r * Math.cos(a);
      const ny = cy + r * Math.sin(a);
      edges.push(px, py, nx, ny);
      px = nx; py = ny;
    }
  }
  return Float64Array.from(edges);
}

/**
 * True when line segment (ax,ay)->(bx,by) intersects segment (cx,cy)->(dx,dy).
 * Standard orientation (cross-product) test; collinear-overlap is treated as a
 * non-crossing (returns false) since the membership use only needs proper
 * boundary crossings.
 */
export function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/**
 * Cached flattened polygon for a closed path, as a flat [x0,y0,…] array in
 * the segments' own coordinate space (L0 cells), or null when open/
 * unchainable. For shapes with holes this returns the OUTER loop only (the
 * largest-area loop). Consumers: the CSS `clip-path: polygon()` tile-mask
 * (which cannot express holes) and the mask-region tests in
 * compositionMaskRegion.ts (bboxOverlapsMask, strokeIntersectsMaskRegion,
 * computeMaskMembership) — so mask membership also ignores holes. `dense`
 * selects the higher arc-sample count used by the CSS clip.
 */
export function getFlattenedClosedPath(
  segments: readonly PathSegment[], dense = false,
): Float64Array | null {
  const polys = getFlattenedClosedPathLoops(segments, dense);
  if (!polys || polys.length === 0) return null;
  let outer = polys[0];
  let bestArea = polygonAbsArea(outer);
  for (let i = 1; i < polys.length; i++) {
    const a = polygonAbsArea(polys[i]);
    if (a > bestArea) { bestArea = a; outer = polys[i]; }
  }
  return outer;
}

/** Signed winding contribution of one flat polygon at (px,py). */
function polygonWinding(poly: Float64Array, px: number, py: number): number {
  const n = poly.length / 2;
  let winding = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[2 * i], yi = poly[2 * i + 1];
    const xj = poly[2 * j], yj = poly[2 * j + 1];
    // Count signed crossings of the rightward ray from (px,py): an upward
    // edge crossing it adds +1, a downward edge subtracts 1.
    if (yi <= py) {
      if (yj > py && (xj - xi) * (py - yi) - (px - xi) * (yj - yi) > 0) winding++;
    } else if (yj <= py && (xj - xi) * (py - yi) - (px - xi) * (yj - yi) < 0) {
      winding--;
    }
  }
  return winding;
}

/**
 * True when the world-space point (px,py) lies inside the closed region
 * formed by `segments` (nonzero winding rule). Segments may be an unordered
 * bag and may describe multiple loops (an outer boundary plus inner holes);
 * arcs are flattened to short polylines. Open or unchainable paths return
 * false. Flattened polygons are cached by segments-array reference.
 *
 * Nonzero (not even-odd) matches the renderer, which always fills with
 * `fill-rule="nonzero"`. Winding is summed across every loop, so a hole
 * (counter-wound inner loop) cancels the outer loop to 0 → outside, while a
 * doubly-wound fold-back nets 2 → inside.
 */
export function pointInClosedPath(
  segments: readonly PathSegment[], px: number, py: number,
): boolean {
  const polys = getFlattenedClosedPathLoops(segments, false);
  if (!polys) return false;
  let winding = 0;
  for (const poly of polys) winding += polygonWinding(poly, px, py);
  return winding !== 0;
}

/** Screen pixels used as the hit radius for precise SVG path testing. */
const SCREEN_HIT_RADIUS_PX = 24;

/**
 * Compute the hit tolerance in L0-cell units, accounting for the current
 * zoom level. The visual stroke uses non-scaling-stroke, so the tolerance
 * must shrink (in cell space) as the user zooms in.
 */
export function computeHitToleranceCells(
  viewport: { width: number },
  camera: { zoom: number },
): number {
  const cellsToScreenPx = viewport.width * camera.zoom / 32;
  if (cellsToScreenPx <= 0) return 0.75; // fallback for degenerate viewport
  return SCREEN_HIT_RADIUS_PX / cellsToScreenPx;
}
