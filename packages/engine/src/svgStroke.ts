import type { PathSegment, SVGObject, SVGStroke } from './types';
import { isClosedPath } from './compositionArcMath';
import { SVG_STROKE_WIDTH } from './svgExport';

// Everything the per-object SVG stroke needs: how to classify a vector object
// into the subtype whose option menu it gets, how wide its stroke is, and the
// two geometry/markup tricks behind the Radius and Position rows.
//
// All of this is RENDER-TIME only — `roundPathCorners` returns new segments
// for the markup builder and never writes them back onto the object. Stored
// `segments` stay the authored geometry, so bbox math, hit testing, join and
// union keep seeing the shape the user actually drew; Radius and Position are
// presentation, exactly like the border effect's radius is for an image.

/**
 * Which option menu an SVG object gets. Derived from GEOMETRY (plus the
 * persisted `shapeKind`), never from `name` — a rename must not change which
 * controls the object offers.
 *
 * - `line`   — a single straight segment (the line tool)
 * - `arc`    — a single curved segment (the arc tool)
 * - `rectangle` — a closed axis-aligned 4-line box (line tool, rectangle mode)
 * - `circle` — a closed path made entirely of arcs (the arc tool, circle mode)
 * - `shape`  — any other closed path (the preset shapes, join/union results)
 * - `stroke` — any other open path: the freehand draw tool's polyline
 */
export type SVGSubtype = 'line' | 'arc' | 'rectangle' | 'circle' | 'shape' | 'stroke';

const EPS = 1e-6;

/** True when every segment is axis-aligned (a rectangle drawn by the line
 *  tool, as opposed to an arbitrary 4-sided closed polyline). */
function allAxisAligned(segments: readonly PathSegment[]): boolean {
  return segments.every((s) =>
    Math.abs(s.start[0] - s.end[0]) <= EPS || Math.abs(s.start[1] - s.end[1]) <= EPS);
}

/** Classify a vector object for the subtype-specific option menu. */
export function svgSubtype(obj: Pick<SVGObject, 'segments' | 'shapeKind'>): SVGSubtype {
  const segs = obj.segments;
  if (segs.length === 0) return 'stroke';
  if (segs.length === 1) return segs[0].kind === 'arc' ? 'arc' : 'line';
  // `shapeKind` is the authored truth for a rectangle and survives scaling and
  // rotation, so it outranks the geometric sniff below.
  if (obj.shapeKind === 'rectangle') return 'rectangle';
  if (!isClosedPath(segs)) return 'stroke';
  if (segs.every((s) => s.kind === 'arc')) return 'circle';
  if (segs.length === 4 && segs.every((s) => s.kind === 'line') && allAxisAligned(segs)) {
    return 'rectangle';
  }
  return 'shape';
}

/**
 * The object's stroke width in the units {@link buildSVGObjectContent} emits.
 *
 * `unitsPerCell` is how many of those units one world cell spans — the caller
 * owns it because the unit depends on where the markup lands. The DOM node
 * layer strokes with `vector-effect="non-scaling-stroke"` inside a world
 * container laid out at `BASE_CELL_PX` per cell, so for it the unit is that
 * base pixel.
 *
 * With no per-object width this is the legacy composition-wide value, so an
 * object that has never visited the Stroke bar renders exactly as before.
 */
export function svgStrokeWidthUnits(
  obj: Pick<SVGObject, 'stroke'>,
  strokeScale: number,
  unitsPerCell: number,
): number {
  const w = obj.stroke?.width;
  if (w == null) return SVG_STROKE_WIDTH * strokeScale;
  return Math.max(0, w) * unitsPerCell;
}

/** The same width expressed in world cells — what the Stroke bar's Width
 *  slider reads, so an untouched object seeds the slider at the width it is
 *  actually being drawn with rather than at zero. */
export function svgStrokeWidthCells(
  obj: Pick<SVGObject, 'stroke'>,
  strokeScale: number,
  unitsPerCell: number,
): number {
  return svgStrokeWidthUnits(obj, strokeScale, unitsPerCell) / unitsPerCell;
}

/** Corner radius in world cells for an object whose `stroke.radius` is a
 *  0–0.5 fraction of the shorter bbox side (the same parameterization the
 *  image Border bar's Radius row uses, so the two sliders feel identical). */
export function svgStrokeRadiusCells(
  obj: Pick<SVGObject, 'stroke' | 'cellWidth' | 'cellHeight'>,
): number {
  const f = obj.stroke?.radius;
  if (!f || f <= 0) return 0;
  return Math.min(0.5, f) * Math.min(obj.cellWidth, obj.cellHeight);
}

// ── Corner rounding ──────────────────────────────────────────────────

type Pt = readonly [number, number];

const sub = (a: Pt, b: Pt): [number, number] => [a[0] - b[0], a[1] - b[1]];
const len = (v: Pt): number => Math.hypot(v[0], v[1]);
const norm = (v: Pt): [number, number] => {
  const l = len(v);
  return l <= EPS ? [0, 0] : [v[0] / l, v[1] / l];
};

/**
 * Round the LINE→LINE joins of a path to `radius` world cells, returning new
 * segments. Each rounded corner trims both edges back by the tangent length
 * and splices in the arc that meets them, so the result is still the engine's
 * ordinary line/arc segment chain (it exports, hit-tests and draws with no
 * special casing).
 *
 * Joins that already involve an arc are left alone — they are curved by
 * construction and trimming an arc would change its radius, which the segment
 * type cannot express (one radius per arc, derived from start↔center).
 *
 * Per-corner the radius is clamped so neither adjacent edge is trimmed past
 * its midpoint; two tight corners on a short edge therefore both shrink
 * rather than crossing over each other.
 */
export function roundPathCorners(
  segments: readonly PathSegment[],
  radius: number,
): PathSegment[] {
  if (radius <= EPS || segments.length < 2) return segments.slice();
  const closed = isClosedPath(segments);
  const out: PathSegment[] = segments.map((s) => ({ ...s } as PathSegment));
  const n = out.length;
  // Corner i sits between out[i] and out[i+1]. An open path has no corner at
  // its two loose ends; a closed one wraps.
  const corners = closed ? n : n - 1;
  // Trim amounts are computed against the ORIGINAL edge lengths and applied
  // afterwards, so a corner never measures an edge its neighbour already cut.
  const inserts: { at: number; arc: PathSegment; aEnd: [number, number]; bStart: [number, number] }[] = [];
  for (let i = 0; i < corners; i++) {
    const a = out[i];
    const b = out[(i + 1) % n];
    if (a.kind !== 'line' || b.kind !== 'line') continue;
    const p: Pt = a.end;
    if (Math.abs(p[0] - b.start[0]) > EPS || Math.abs(p[1] - b.start[1]) > EPS) continue;
    const d1 = norm(sub(p, a.start)); // incoming direction
    const d2 = norm(sub(b.end, p)); // outgoing direction
    if (len(d1) <= EPS || len(d2) <= EPS) continue;
    // Interior half-angle between the reversed incoming edge and the outgoing
    // one. cos = (-d1)·d2; collinear (straight-through or doubled-back) joins
    // have nothing to round.
    const cos = Math.max(-1, Math.min(1, -d1[0] * d2[0] + -d1[1] * d2[1]));
    const theta = Math.acos(cos);
    if (theta <= EPS || Math.PI - theta <= EPS) continue;
    const half = theta / 2;
    // Trim length along each edge, clamped to half of the shorter neighbour so
    // adjacent corners cannot consume the same span twice.
    const maxT = Math.min(len(sub(a.end, a.start)), len(sub(b.end, b.start))) / 2;
    let t = radius / Math.tan(half);
    let r = radius;
    if (t > maxT) { t = maxT; r = t * Math.tan(half); }
    if (t <= EPS || r <= EPS) continue;
    const aEnd: [number, number] = [p[0] - d1[0] * t, p[1] - d1[1] * t];
    const bStart: [number, number] = [p[0] + d2[0] * t, p[1] + d2[1] * t];
    // Centre lies along the interior bisector at r / sin(half).
    const bis = norm([-d1[0] + d2[0], -d1[1] + d2[1]]);
    const dist = r / Math.sin(half);
    const center: [number, number] = [p[0] + bis[0] * dist, p[1] + bis[1] * dist];
    inserts.push({ at: i, arc: { kind: 'arc', start: aEnd, end: bStart, center }, aEnd, bStart });
  }
  if (inserts.length === 0) return out;
  for (const ins of inserts) {
    const a = out[ins.at];
    const b = out[(ins.at + 1) % n];
    if (a.kind === 'line') a.end = ins.aEnd;
    if (b.kind === 'line') b.start = ins.bStart;
  }
  // Splice the arcs in back-to-front so earlier indices stay valid. A wrapping
  // corner (the closed path's seam, at index n-1) appends at the end.
  const result = out.slice();
  for (let k = inserts.length - 1; k >= 0; k--) {
    result.splice(inserts[k].at + 1, 0, inserts[k].arc);
  }
  return result;
}

// ── Stroke alignment ─────────────────────────────────────────────────

/**
 * Whether an object's stroke can be aligned inside / outside at all.
 *
 * Alignment means "keep the half of the stroke that falls on one side of the
 * path", which only has an answer when the path encloses an area. An open
 * path — a line, an arc, a freehand stroke — has no inside, so the Position
 * row is inert for it (the user was told as much when the row was specified).
 */
export function svgStrokeCanAlign(obj: Pick<SVGObject, 'segments'>): boolean {
  return obj.segments.length > 1 && isClosedPath(obj.segments);
}

/** The effective alignment: 'center' whenever the path cannot be aligned, so
 *  render and UI agree on what an open path is doing.
 *
 *  The `p === 'center'` test short-circuiting BEFORE `svgStrokeCanAlign` is
 *  load-bearing, not tidiness: this runs per object per markup build, and
 *  `isClosedPath` walks (and for an unordered bag, re-chains) every segment —
 *  which a several-hundred-segment freehand stroke would pay on every render
 *  for a question it never asks. The default and overwhelmingly common case
 *  is an unset position, and it must stay O(1). */
export function svgStrokeAlignment(
  obj: Pick<SVGObject, 'segments' | 'stroke'>,
): NonNullable<SVGStroke['position']> {
  const p = obj.stroke?.position ?? 'center';
  if (p === 'center' || !svgStrokeCanAlign(obj)) return 'center';
  return p;
}

/** A node id reduced to DOM-id-safe characters, for per-object defs ids. */
export function svgDefIdSafe(nodeId: string): string {
  return nodeId.replace(/[^A-Za-z0-9_-]/g, '_');
}

/** A DOM-id-safe suffix derived from a node id, for the per-object clip/mask
 *  defs an aligned stroke needs. */
export function svgStrokeDefId(nodeId: string, kind: 'clip' | 'mask'): string {
  return `uw-stroke-${kind}-${svgDefIdSafe(nodeId)}`;
}
