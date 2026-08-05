import type { PathSegment, SVGEndCap, SVGEndMarker, SVGEndpoints, SVGObject } from './types';
import { arcMotionAt, isClosedPath } from './compositionArcMath';
import { SVG_UNITS_PER_L0_CELL } from './svgExport';

// What sits at the two loose ends of an OPEN path — the Endpoints bar. Each
// end independently gets a decoration (none / circle / arrow) and a cap
// (rounded / square).
//
// Everything here is RENDER-TIME only, like `svgStroke.ts`: nothing is written
// back onto the object, so bbox math, hit testing, join and union keep seeing
// the path the user actually drew. The decorations are emitted as ordinary
// FILLED geometry rather than SVG `<marker>` defs, because a marker's sizing is
// tied to `stroke-width`, and the node layer strokes with
// `vector-effect="non-scaling-stroke"` — the two would disagree about scale.
// Plain geometry in the same coordinate space as the path can't.
//
// The cap is deliberately NOT `stroke-linecap`: that attribute is per-path (it
// can't say "round at one end, square at the other") and it also caps every
// DASH, so switching it would silently restyle a dashed stroke. Instead the
// path keeps its `stroke-linecap="round"` and a square end gets a filled quad
// laid over the round cap. A square cap geometrically CONTAINS the round cap it
// replaces (a w/2 half-square vs. a w/2 half-disc on the same axis), so the
// union is exactly the square cap, and a round end emits nothing at all — an
// undecorated object's markup is byte-identical to what it was.

/** Decoration sizes, in multiples of the stroke width — the same
 *  `markerUnits="strokeWidth"` proportionality SVG markers use, so a decoration
 *  keeps its weight relative to the line at any stroke width. */
const ARROW_LENGTH_W = 4;
const ARROW_HALF_W = 2;
const CIRCLE_RADIUS_W = 1.75;
/** A square cap extends half the stroke width past the endpoint — the SVG
 *  `stroke-linecap="square"` definition, reproduced as geometry. */
const SQUARE_CAP_W = 0.5;

const EPS = 1e-9;

/** One loose end of an open path. */
export interface PathEnd {
  /** The endpoint itself, in world cells. */
  at: readonly [number, number];
  /** Unit vector pointing AWAY from the path — the direction a decoration
   *  grows in. */
  dir: readonly [number, number];
}

/** True when an endpoints block asks for anything to be drawn. Defaults
 *  ('none' markers, 'round' caps) draw nothing, so this is the cheap guard
 *  every render path checks BEFORE touching the segment chain — see
 *  {@link svgEndpointsMarkup}. */
export function svgEndpointsActive(ep: SVGEndpoints | undefined): ep is SVGEndpoints {
  if (!ep) return false;
  return (!!ep.startMarker && ep.startMarker !== 'none')
    || (!!ep.endMarker && ep.endMarker !== 'none')
    || ep.startCap === 'square'
    || ep.endCap === 'square';
}

/** The travel direction at one end of a segment (`f` = 0 start, 1 end), or
 *  null for a degenerate segment that has no direction. */
function travelDir(seg: PathSegment, f: 0 | 1): readonly [number, number] | null {
  if (seg.kind === 'arc') {
    const t = arcMotionAt(seg, f);
    return Number.isFinite(t[0]) && Number.isFinite(t[1]) ? t : null;
  }
  const dx = seg.end[0] - seg.start[0];
  const dy = seg.end[1] - seg.start[1];
  const len = Math.hypot(dx, dy);
  return len <= EPS ? null : [dx / len, dy / len];
}

/**
 * The two ends of an open path, in the order it is drawn. Returns null for an
 * empty or CLOSED path — a closed path has no loose end to decorate, exactly
 * as `svgStrokeCanAlign` treats an open one as having no inside.
 *
 * The segments are taken in array order because that is the order
 * {@link buildPathD} walks them (it emits an `M` at each discontinuity), so
 * these are the ends of the path as actually drawn even for a freehand chain
 * that was never re-chained.
 */
export function pathEnds(
  segments: readonly PathSegment[],
): { start: PathEnd; end: PathEnd } | null {
  if (segments.length === 0 || isClosedPath(segments)) return null;
  const first = segments[0];
  const last = segments[segments.length - 1];
  const t0 = travelDir(first, 0);
  const t1 = travelDir(last, 1);
  if (!t0 || !t1) return null;
  return {
    start: { at: first.start, dir: [-t0[0], -t0[1]] },
    end: { at: last.end, dir: t1 },
  };
}

/** cell-space length → the SVG-unit coordinate space the path markup is
 *  emitted in, trimmed of float noise. */
const u = (v: number): number => Math.round(v * SVG_UNITS_PER_L0_CELL * 1e3) / 1e3;

/** The square-cap quad: the endpoint's stroke-width-wide butt edge, extruded
 *  half a stroke width outward. */
function capQuad(e: PathEnd, w: number, paint: string): string {
  const [px, py] = e.at;
  const [dx, dy] = e.dir;
  const nx = -dy, ny = dx; // left normal
  const h = w / 2;
  const ext = w * SQUARE_CAP_W;
  const ax = px + nx * h, ay = py + ny * h;
  const bx = px - nx * h, by = py - ny * h;
  return `<path d="M ${u(ax)},${u(ay)} L ${u(ax + dx * ext)},${u(ay + dy * ext)} `
    + `L ${u(bx + dx * ext)},${u(by + dy * ext)} L ${u(bx)},${u(by)} Z" ${paint} />`;
}

/** The arrowhead: an isoceles triangle whose BASE is centred on the endpoint
 *  and whose tip points outward. Growing outward (rather than tucking the tip
 *  back onto the endpoint) keeps the point crisp — the path's own round cap
 *  ends up buried inside the triangle instead of bulging past the tip. */
function arrowPath(e: PathEnd, w: number, paint: string): string {
  const [px, py] = e.at;
  const [dx, dy] = e.dir;
  const nx = -dy, ny = dx;
  const half = w * ARROW_HALF_W;
  const len = w * ARROW_LENGTH_W;
  return `<path d="M ${u(px + nx * half)},${u(py + ny * half)} `
    + `L ${u(px + dx * len)},${u(py + dy * len)} `
    + `L ${u(px - nx * half)},${u(py - ny * half)} Z" ${paint} />`;
}

function endMarkup(e: PathEnd, marker: SVGEndMarker | undefined, cap: SVGEndCap | undefined, w: number, paint: string): string {
  // The cap goes down first: when there is also a marker it covers the cap
  // completely (both decorations are wider than the stroke and share its
  // color), so the two never fight over the same pixels.
  let out = cap === 'square' ? capQuad(e, w, paint) : '';
  if (marker === 'circle') {
    out += `<circle cx="${u(e.at[0])}" cy="${u(e.at[1])}" r="${u(w * CIRCLE_RADIUS_W)}" ${paint} />`;
  } else if (marker === 'arrow') {
    out += arrowPath(e, w, paint);
  }
  return out;
}

/**
 * The markup for an open path's decorated ends, to be appended AFTER the
 * stroke path so the decorations sit on top of it. Returns '' when there is
 * nothing to draw.
 *
 * Shared by the live DOM node layer (`buildSVGObjectContent`) and the SVG
 * exporter, so an endpoint can't render one way on the canvas and another in
 * the export — the same rule `svgStrokePresentation` and
 * `svgFillPresentation` follow.
 *
 * `segments` is the chain the stroke is actually drawn from (corner-rounded,
 * if it is), and `strokeWidthCells` is that stroke's width in world cells —
 * `svgStrokeWidthCells` with the caller's own `unitsPerCell`, so a decoration
 * always matches the weight of the line it caps in the context it is drawn in.
 *
 * The `svgEndpointsActive` guard is load-bearing, not tidiness: the closed-path
 * test inside `pathEnds` walks (and may re-chain) every segment, which a
 * several-hundred-segment freehand stroke would otherwise pay on every render
 * for a question it never asks. Undecorated is the overwhelmingly common case
 * and it must stay O(1).
 */
export function svgEndpointsMarkup(
  obj: Pick<SVGObject, 'endpoints' | 'color' | 'tileMode'>,
  segments: readonly PathSegment[],
  strokeWidthCells: number,
): string {
  if (!svgEndpointsActive(obj.endpoints)) return '';
  // A tiled object draws one authored tile repeated across a region; its ends
  // are interior seams of the pattern, not ends of a line.
  if (obj.tileMode === 'repeat' || !(strokeWidthCells > 0)) return '';
  const ends = pathEnds(segments);
  if (!ends) return '';
  const ep = obj.endpoints;
  const { r, g, b } = obj.color;
  const paint = `fill="rgb(${r},${g},${b})" stroke="none"`;
  return endMarkup(ends.start, ep.startMarker, ep.startCap, strokeWidthCells, paint)
    + endMarkup(ends.end, ep.endMarker, ep.endCap, strokeWidthCells, paint);
}
