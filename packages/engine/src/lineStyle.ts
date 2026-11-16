import type { LineStyleArtPath, LineStyleEffect, LineStyleGlyph, PathSegment, RGBColor, SVGObject } from './types';
import { arcMotionAt, piecePointAt, segLength } from './compositionArcMath';
import { fnv1a32, mulberry32At } from './seededRandom';
import { SVG_UNITS_PER_L0_CELL } from './svgExport';

// A LINE STYLE: the path is not stroked; a glyph is stamped along it instead
// — a heart every so often, each one turned to face the way the path runs
// where it stands. The stamps are OUTLINED in the path's own ink, width and
// dash, so the Stroke page dresses the glyphs exactly as it dressed the line
// they replace (`svgStrokesMarkup` in svgPathBuilder.ts hands the same
// stroke attrs to both).
//
// The one exception is a drawn glyph's ART (v72, `LineStyleEffect.art`): a
// drawing stamped exactly as it was drawn, each of its paths in its own
// colours, width, fill and opacity, which the Stroke page does not dress.
// A reader that draws in one ink still reads one outline for it
// (`lineStyleGlyphCommands`), so nothing that stamps had to learn of it.
//
// Everything here is pure geometry over the engine's own segment chain:
// `segLength` measures each piece, `piecePointAt` and `arcMotionAt` give the
// point and the direction a given way along it, so an arc is sampled
// exactly and never flattened. The random sliders draw from mulberry32
// seeded by the object's id, in a FIXED order per stamp, so moving one
// slider cannot reshuffle what the others did — and a page reopens with
// every glyph where it was.
//
// Shared by the live DOM node layer and the SVG export through
// svgPathBuilder's `svgStrokesMarkup`, the same rule the endpoint
// decorations and the stroke presentation follow: one builder, so a styled
// line cannot stamp one way on the canvas and another in the file.

/** One stamp: where it stands (world cells), which way it faces (radians,
 *  the path's direction of travel) and how big it is (world cells — the
 *  side of the glyph's unit box). */
export interface GlyphPlacement {
  x: number;
  y: number;
  angle: number;
  scale: number;
}

/** A glyph's outline in its UNIT box — (−0.5,−0.5) top-left to (0.5,0.5)
 *  bottom-right, y down, +x the direction the path runs. Path commands so a
 *  circle and a heart stay curves at any size; a drawn glyph is lines. */
export type GlyphCommand =
  | readonly ['M', number, number]
  | readonly ['L', number, number]
  | readonly ['C', number, number, number, number, number, number]
  | readonly ['Z'];

// Kappa for a quarter circle of radius 0.5.
const K = 0.5522847498 * 0.5;

/** The built-in glyphs, each in the unit box. */
const GLYPHS: Record<Exclude<LineStyleGlyph, 'custom'>, readonly GlyphCommand[]> = {
  // A dash along the path: the one glyph that makes a dashed line.
  line: [['M', -0.5, 0], ['L', 0.5, 0]],
  circle: [
    ['M', 0.5, 0],
    ['C', 0.5, K, K, 0.5, 0, 0.5],
    ['C', -K, 0.5, -0.5, K, -0.5, 0],
    ['C', -0.5, -K, -K, -0.5, 0, -0.5],
    ['C', K, -0.5, 0.5, -K, 0.5, 0],
    ['Z'],
  ],
  // A four-point sparkle: tips on the axes, sides curving in toward the
  // centre.
  sparkle: [
    ['M', 0, -0.5],
    ['C', 0.04, -0.12, 0.12, -0.04, 0.5, 0],
    ['C', 0.12, 0.04, 0.04, 0.12, 0, 0.5],
    ['C', -0.04, 0.12, -0.12, 0.04, -0.5, 0],
    ['C', -0.12, -0.04, -0.04, -0.12, 0, -0.5],
    ['Z'],
  ],
  // A heart, point down, lobes up.
  heart: [
    ['M', 0, 0.5],
    ['C', -0.4, 0.15, -0.5, -0.05, -0.5, -0.2],
    ['C', -0.5, -0.4, -0.35, -0.5, -0.25, -0.5],
    ['C', -0.12, -0.5, -0.03, -0.42, 0, -0.3],
    ['C', 0.03, -0.42, 0.12, -0.5, 0.25, -0.5],
    ['C', 0.35, -0.5, 0.5, -0.4, 0.5, -0.2],
    ['C', 0.5, -0.05, 0.4, 0.15, 0, 0.5],
    ['Z'],
  ],
};

const EPS = 1e-9;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

// ── Ranges and budgets ───────────────────────────────────────────────
/** The smallest glyph a style can stamp, in world cells: 2pt, a dot. */
export const MIN_GLYPH_SIZE = 0.125;
/** …and the largest: 64pt. */
export const MAX_GLYPH_SIZE = 4;

/** A glyph size held to the range: the Size row's floor and ceiling, and
 *  the reader's, because a `.tile` comes from outside and carries a raw f32. */
export function clampGlyphSize(size: number): number {
  if (!Number.isFinite(size)) return MIN_GLYPH_SIZE;
  return Math.min(MAX_GLYPH_SIZE, Math.max(MIN_GLYPH_SIZE, size));
}

// A styled path is one `d` string, rebuilt whenever the object changes (a
// slider's every step), so what it may hold is bounded here: past a budget
// the stamps spread out evenly over the whole path and a drawing loses
// points, rather than the WebView paying for it. The floor on the size does
// not bound this by itself, since a stamp count grows with the path's length.
/** The most stamps one path draws. */
export const MAX_LINE_STYLE_STAMPS = 512;
/** The most path commands one path's stamps may come to, whatever the glyph. */
export const MAX_LINE_STYLE_COMMANDS = 8192;
/** The most points a drawn glyph stamps with, the ends of each stroke apart.
 *  The pad records a point per finger move; the file keeps them all. */
export const MAX_DRAWN_GLYPH_POINTS = 64;

/** The most paths a drawn glyph's ART stamps with, and the most points
 *  they come to between them (each path's ends apart): art is several
 *  `<path>`s per styled chain where a drawn glyph is one, so it is bounded
 *  by both. The two are one number: a line drawn in a colour that changes
 *  along it is a path per segment, and a budget of paths under the budget
 *  of points stamped the first part of such a mark and none of the rest. */
export const MAX_ART_PATHS = 96;
export const MAX_ART_GLYPH_POINTS = 96;

type Polyline = readonly (readonly [number, number])[];

const finitePoint = ([x, y]: readonly [number, number]): boolean =>
  Number.isFinite(x) && Number.isFinite(y);

/**
 * Polylines fitted to their own bounds: the box of all of them is centred
 * on the origin and its longer side scaled to 1, so a sketch in one corner
 * of the pad stamps as large as one across the whole of it. Each polyline
 * comes back as its own run of commands (M, then Ls), and `span` is the
 * side that was scaled to 1 — what a length drawn in the polylines' units
 * is divided by to be in the glyph's. Past `maxPoints` in all, the lines
 * lose points by stride, each keeping its ends. Null when there is nothing
 * to fit — no lines, or a single point (a tap).
 *
 * The ONE fit for both drawn forms, the pad's strokes and the art's paths,
 * so the two cannot come to stand differently in the unit box.
 */
function fitPolylines(
  lines: readonly Polyline[], maxPoints: number,
): { paths: GlyphCommand[][]; span: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let points = 0;
  for (const stroke of lines) {
    for (const [x, y] of stroke) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      points++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (points < 2) return null;
  const span = Math.max(maxX - minX, maxY - minY);
  if (span <= EPS) return null;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const stride = Math.ceil(points / maxPoints);
  const paths = lines.map((stroke) => {
    const out: GlyphCommand[] = [];
    const finite = stroke.filter(finitePoint);
    finite.forEach(([x, y], i) => {
      if (i % stride !== 0 && i !== finite.length - 1) return;
      out.push([i === 0 ? 'M' : 'L', (x - cx) / span, (y - cy) / span]);
    });
    return out;
  });
  return { paths, span };
}

const joined = (paths: readonly (readonly GlyphCommand[])[]): GlyphCommand[] =>
  ([] as GlyphCommand[]).concat(...paths);

/**
 * A drawn glyph fitted to its own bounds ({@link fitPolylines}). Null when
 * there is nothing to fit — no strokes, or a single point (a tap) — and the
 * caller falls back to a built-in glyph rather than stamping nothing.
 */
function fittedCustomGlyph(custom: LineStyleEffect['custom']): readonly GlyphCommand[] | null {
  if (!custom) return null;
  const fit = fitPolylines(custom, MAX_DRAWN_GLYPH_POINTS);
  return fit ? joined(fit.paths) : null;
}

// ── Art: a drawn glyph that keeps its own paint ──────────────────────
/** One path of a style's art as it stamps: its commands in the glyph's unit
 *  box (closed with `Z` when it is filled), and its own paint. `color` and
 *  `width` come together or not at all, the width in the unit box's own
 *  units — times the style's `size` it is world cells. */
export interface FittedArtPath {
  commands: readonly GlyphCommand[];
  color?: RGBColor;
  width?: number;
  fill?: RGBColor;
  /** Under 1 when present; an opaque path carries none. */
  opacity?: number;
  fillOpacity?: number;
}

/** Whether an art path draws an outline: a colour AND a width above
 *  nothing. The one reading of "outlined" for the fit, the file and a
 *  recolour, so a path cannot be outlined to one and bare to another. */
export function lineStyleArtPathOutlined(path: LineStyleArtPath): boolean {
  return !!path.color && Number.isFinite(path.width) && (path.width as number) > 0;
}

/** An opacity as art carries it: under 1 or absent. */
function artOpacity(v: number | undefined): number | undefined {
  if (v === undefined || !Number.isFinite(v) || v >= 1) return undefined;
  return Math.max(0, v);
}

/** The art's paths that draw something — two finite points at the least,
 *  and an outline or a fill — in their own order, the budget's first
 *  {@link MAX_ART_PATHS} of them. Empty unless the glyph is the drawn one. */
function drawableArt(style: LineStyleEffect): LineStyleArtPath[] {
  if (style.glyph !== 'custom' || !Array.isArray(style.art)) return [];
  const out: LineStyleArtPath[] = [];
  for (const path of style.art) {
    if (out.length >= MAX_ART_PATHS) break;
    if (!path || !Array.isArray(path.points)) continue;
    if (!lineStyleArtPathOutlined(path) && !path.fill) continue;
    let finite = 0;
    for (const p of path.points) if (finitePoint(p)) finite++;
    if (finite >= 2) out.push(path);
  }
  return out;
}

/** The art fitted, with the side its box was scaled by (see
 *  {@link fitPolylines}), or null when the style has none to draw. */
function fitArt(style: LineStyleEffect): { paths: FittedArtPath[]; span: number } | null {
  const drawable = drawableArt(style);
  if (drawable.length === 0) return null;
  const fit = fitPolylines(drawable.map((path) => path.points), MAX_ART_GLYPH_POINTS);
  if (!fit) return null;
  const paths = drawable.map((path, i): FittedArtPath => {
    const out: FittedArtPath = { commands: path.fill ? [...fit.paths[i], ['Z']] : fit.paths[i] };
    if (lineStyleArtPathOutlined(path)) {
      out.color = path.color;
      out.width = (path.width as number) / fit.span;
    }
    const opacity = artOpacity(path.opacity);
    if (opacity !== undefined) out.opacity = opacity;
    if (path.fill) {
      out.fill = path.fill;
      const fillOpacity = artOpacity(path.fillOpacity);
      if (fillOpacity !== undefined) out.fillOpacity = fillOpacity;
    }
    return out;
  });
  return { paths, span: fit.span };
}

/**
 * A style's ART as it stamps: every drawable path fitted, as ONE drawing,
 * to the glyph's unit box — the box of all their points centred on the
 * origin, its longer side scaled to 1, the outline widths by the same
 * factor — in the art's own order (the first is the bottom). Null when the
 * style has no drawable art, and its `custom` strokes (or a circle) are
 * what it stamps. Fitted afresh on every call: nothing is kept between
 * them, so a caller on a per-frame path holds the result itself.
 */
export function lineStyleArt(style: LineStyleEffect): readonly FittedArtPath[] | null {
  return fitArt(style)?.paths ?? null;
}

/** The art's whole outline, every path's commands end to end: what a
 *  reader that draws a glyph in one ink stamps for it. */
const artOutline = (art: readonly FittedArtPath[]): GlyphCommand[] =>
  joined(art.map((path) => path.commands));

/**
 * An art colour as a path in `ink` draws it: the two MULTIPLIED, channel
 * by channel. A white path (255) leaves the art exactly as it was drawn;
 * a coloured one shifts every colour of it toward its own — white art
 * becomes the ink, black stays black. The one colour shift for art,
 * shared by the markup here and by a host that stamps a path still being
 * drawn (DrawBot's trail canvas).
 */
export function lineStyleArtTint(art: RGBColor, ink: RGBColor): RGBColor {
  return {
    r: Math.round((art.r * ink.r) / 255),
    g: Math.round((art.g * ink.g) / 255),
    b: Math.round((art.b * ink.b) / 255),
  };
}

/** The art colour the ink alone decides: white, which the shift
 *  ({@link lineStyleArtTint}) turns into the path's own colour. */
const ART_NEUTRAL: RGBColor = Object.freeze({ r: 255, g: 255, b: 255 });

/**
 * A style as ONE ink draws it: its art's outlines in `color`, and its
 * fills too when `floodFills` — the rule `withSVGObjectStrokeColor` keeps
 * for a shape's subpaths, here for the paint a style carries itself, so a
 * silhouette (a cutout, a pattern's ink, a shadow's cast) is not left in
 * the art's own colours. The art is made NEUTRAL (white) there, which the
 * ink of the object it is stamped along then colours
 * ({@link lineStyleArtTint}): the caller gives that object `color` as its
 * own, as both do (`withSVGObjectStrokeColor`, the node layer's cast).
 * `widenCells` grows every outline by that many
 * world cells, for a cast that has to be as wide as it is soft. A style
 * with no drawable art comes back as it is, the same object.
 */
export function lineStyleWithInk(
  style: LineStyleEffect, _color: RGBColor,
  opts?: { floodFills?: boolean; widenCells?: number },
): LineStyleEffect {
  const fit = fitArt(style);
  if (!fit || !style.art) return style;
  // An art width is in the drawing's own units: world cells ÷ the glyph's
  // size, × the side the fit scales to 1.
  const widen = opts?.widenCells && style.size > 0 ? (opts.widenCells * fit.span) / style.size : 0;
  return {
    ...style,
    art: style.art.map((path) => {
      const outlined = lineStyleArtPathOutlined(path);
      const flood = !!path.fill && !!opts?.floodFills;
      if (!outlined && !flood) return path;
      return {
        ...path,
        ...(outlined ? { color: ART_NEUTRAL, width: (path.width as number) + widen } : {}),
        ...(flood ? { fill: ART_NEUTRAL } : {}),
      };
    }),
  };
}

/** The outline a style stamps: its glyph in the unit box. A drawn glyph is
 *  its art's whole outline when it has art to draw, its pad strokes when it
 *  has not; one that cannot be fitted either way (never drawn, or a single
 *  tap) stamps a circle, so choosing Draw never makes the path vanish. */
export function lineStyleGlyphCommands(style: LineStyleEffect): readonly GlyphCommand[] {
  if (style.glyph === 'custom') {
    const art = lineStyleArt(style);
    if (art) return artOutline(art);
    return fittedCustomGlyph(style.custom) ?? GLYPHS.circle;
  }
  return GLYPHS[style.glyph] ?? GLYPHS.circle;
}

/** The style a vector object draws its stroke as, or null when it strokes
 *  plainly: no style, or a REPEAT-mode tile, whose one authored tile is
 *  repeated across a region and has no path of its own to lay glyphs along. */
export function lineStyleOf(obj: Pick<SVGObject, 'effects' | 'tileMode'>): LineStyleEffect | null {
  const style = obj.effects?.lineStyle;
  if (!style || obj.tileMode === 'repeat') return null;
  return style;
}

/** The distance between stamps, in world cells: sparse at density 0 (a gap
 *  of three glyph-widths), touching at 1. */
export function lineStyleSpacing(style: LineStyleEffect): number {
  const size = Math.max(0, style.size);
  return size * (4 - 3.25 * clamp01(style.density));
}

/** How far past the path a stamp can reach, in world cells — the biggest
 *  stamp's half-diagonal plus the furthest the placement slider can push one
 *  across the path. What a caller grows a clip or a filter region by. Art
 *  reaches half its widest outline further: its outlines are its own, so
 *  the stroke width a caller adds for the path's does not cover them. */
export function lineStyleReachCells(style: LineStyleEffect): number {
  const size = Math.max(0, style.size);
  const biggest = size * (1 + 0.75 * clamp01(style.randomSize));
  let widest = 0;
  for (const path of lineStyleArt(style) ?? []) widest = Math.max(widest, path.width ?? 0);
  return biggest * (Math.SQRT1_2 + widest / 2) + 0.75 * size * clamp01(style.randomPlacement);
}

/** The PRNG seed a given object's stamps are drawn from. The outline casts
 *  the node layer draws for a shadow carry the object's id too, so a cast
 *  lands under the very glyphs it shadows. */
export function lineStyleSeed(objectId: string, subpath = 0): number {
  return fnv1a32(objectId) ^ (subpath * 0x9e3779b9);
}

/** How the random sliders move one stamp from its place: along the path
 *  and across it (world cells), about its centre (radians) and in size (a
 *  factor of the style's `size`). */
export interface StampJitter {
  along: number;
  across: number;
  turn: number;
  grow: number;
}

/**
 * Stamp `i`'s share of the random sliders, written into `out` (and
 * returned): its four draws are the seed's stream at `4i … 4i + 3`, in that
 * fixed order — placement along, placement across, rotation, size — so the
 * sliders are independent of one another and a stamp's draws do not depend
 * on how many stamps stand before it. `gap` is the distance between stamps
 * where it stands, which is what the placement along is a share of.
 *
 * The one rule for {@link lineStylePlacements} and for a reader that lays
 * a style's stamps along a path it is still drawing (a canvas layer that
 * may not allocate, which is why this takes its result as a parameter): the
 * same seed and index give the same glyph, turned and sized the same.
 */
export function lineStyleStampJitter(
  style: LineStyleEffect, seed: number, i: number, gap: number, out: StampJitter,
): StampJitter {
  const placement = clamp01(style.randomPlacement);
  out.along = (mulberry32At(seed, 4 * i) * 2 - 1) * 0.5 * gap * placement;
  out.across = (mulberry32At(seed, 4 * i + 1) * 2 - 1) * 0.75 * style.size * placement;
  out.turn = (mulberry32At(seed, 4 * i + 2) * 2 - 1) * Math.PI * clamp01(style.randomRotation);
  out.grow = 1 + (mulberry32At(seed, 4 * i + 3) * 2 - 1) * 0.75 * clamp01(style.randomSize);
  return out;
}

interface PathWalk {
  segments: PathSegment[];
  cumulative: number[];
  total: number;
  closed: boolean;
}

/** The chain as a run of measured pieces, zero-length ones dropped. */
function measurePath(segments: readonly PathSegment[]): PathWalk {
  const kept: PathSegment[] = [];
  const cumulative: number[] = [0];
  let total = 0;
  for (const seg of segments) {
    const len = segLength(seg);
    if (!(len > EPS)) continue;
    kept.push(seg);
    total += len;
    cumulative.push(total);
  }
  const first = kept[0];
  const last = kept[kept.length - 1];
  const closed = kept.length > 1
    && Math.hypot(first.start[0] - last.end[0], first.start[1] - last.end[1]) <= 1e-6;
  return { segments: kept, cumulative, total, closed };
}

/** The point a distance along the walk, and the direction of travel
 *  there. `cursor` is the piece the last sample fell in: the stamps come
 *  in order along the path (scattered a little either way), so the search
 *  steps from there rather than from the start, and a run of stamps over a
 *  long freehand chain costs the chain's length once, not once per stamp. */
function sampleWalk(
  walk: PathWalk, distance: number, cursor: { k: number },
): { at: [number, number]; dir: [number, number] } {
  const d = Math.max(0, Math.min(walk.total, distance));
  // The piece this distance falls in — the last whose start is at or before
  // it, so the very end of the path samples the last piece at f = 1.
  const last = walk.segments.length - 1;
  let k = Math.max(0, Math.min(last, cursor.k));
  while (k > 0 && d < walk.cumulative[k]) k--;
  while (k < last && d >= walk.cumulative[k + 1]) k++;
  cursor.k = k;
  const seg = walk.segments[k];
  const len = walk.cumulative[k + 1] - walk.cumulative[k];
  const f = Math.max(0, Math.min(1, (d - walk.cumulative[k]) / len));
  const at = piecePointAt(seg, f);
  let dir: [number, number];
  if (seg.kind === 'line') {
    dir = [(seg.end[0] - seg.start[0]) / len, (seg.end[1] - seg.start[1]) / len];
  } else {
    dir = arcMotionAt(seg, f);
  }
  return { at, dir };
}

/**
 * Where a style stamps its glyphs along a chain, in world cells.
 *
 * A closed path takes its stamps evenly all the way round, so the last gap
 * is the same as every other; an open one stands a glyph at each end and
 * spaces the rest evenly between them. A path shorter than half a spacing
 * gets one glyph at its middle. Every stamp faces along the path, turned
 * by the style's `rotation`; the random sliders then move each from its
 * place: along the path and across it (placement), about its centre
 * (rotation) and in size — each drawn once per stamp in that order, so the
 * sliders are independent of one another. A path that would take more than
 * the budget's stamps takes the budget's, spaced evenly over all of it.
 */
export function lineStylePlacements(
  segments: readonly PathSegment[], style: LineStyleEffect, seed: number,
): GlyphPlacement[] {
  return placementsFor(segments, style, seed, lineStyleGlyphCommands(style).length);
}

/** {@link lineStylePlacements} for a glyph of `commandCount` commands —
 *  what one stamp costs, and so how many the command budget allows. Art's
 *  count is all its paths' together, the same number its outline has. */
function placementsFor(
  segments: readonly PathSegment[], style: LineStyleEffect, seed: number, commandCount: number,
): GlyphPlacement[] {
  const walk = measurePath(segments);
  const spacing = lineStyleSpacing(style);
  if (walk.total <= EPS || !(spacing > EPS) || !(style.size > 0)) return [];
  const baseTurn = (style.rotation || 0) * Math.PI / 180;

  // Two stamps at the least, so an open path keeps a glyph at each end.
  const limit = Math.max(2, Math.min(
    MAX_LINE_STYLE_STAMPS,
    Math.floor(MAX_LINE_STYLE_COMMANDS / Math.max(1, commandCount)),
  ));
  let count: number;
  let step: number;
  let start = 0;
  if (walk.total < spacing * 0.5) {
    count = 1;
    step = 0;
    start = walk.total / 2;
  } else if (walk.closed) {
    count = Math.min(limit, Math.max(1, Math.round(walk.total / spacing)));
    step = walk.total / count;
  } else {
    count = Math.min(limit, Math.max(2, Math.round(walk.total / spacing) + 1));
    step = walk.total / (count - 1);
  }

  const out: GlyphPlacement[] = [];
  const cursor = { k: 0 };
  const jitter: StampJitter = { along: 0, across: 0, turn: 0, grow: 1 };
  for (let i = 0; i < count; i++) {
    const { along, across, turn, grow } = lineStyleStampJitter(style, seed, i, step || spacing, jitter);
    let distance = start + i * step + along;
    if (walk.closed) distance = ((distance % walk.total) + walk.total) % walk.total;
    const { at, dir } = sampleWalk(walk, distance, cursor);
    // The left-hand normal (y down), the way across the path.
    const nx = -dir[1], ny = dir[0];
    out.push({
      x: at[0] + nx * across,
      y: at[1] + ny * across,
      angle: Math.atan2(dir[1], dir[0]) + baseTurn + turn,
      scale: style.size * grow,
    });
  }
  return out;
}

const fmt = (v: number): number => Math.round(v * 1e3) / 1e3;

/**
 * Glyph commands as a path's `d`, every point put through `point` — the one
 * walk over {@link GlyphCommand} for every reader of one: the stamps along
 * a path (below, placed, turned, scaled and projected) and the Style page's
 * pad (editor-ui's `padGlyphPathD`, scaled into the pad). Numbers are
 * trimmed to a thousandth, enough for SVG units and for pad pixels alike.
 */
export function glyphCommandsPathD(
  commands: readonly GlyphCommand[],
  point: (x: number, y: number) => readonly [number, number],
): string {
  const px = (x: number, y: number): string => {
    const [px0, py0] = point(x, y);
    return `${fmt(px0)},${fmt(py0)}`;
  };
  const parts: string[] = [];
  for (const c of commands) {
    switch (c[0]) {
      case 'M': parts.push(`M ${px(c[1], c[2])}`); break;
      case 'L': parts.push(`L ${px(c[1], c[2])}`); break;
      case 'C': parts.push(`C ${px(c[1], c[2])} ${px(c[3], c[4])} ${px(c[5], c[6])}`); break;
      case 'Z': parts.push('Z'); break;
    }
  }
  return parts.join(' ');
}

/**
 * Glyph commands stamped at every placement as ONE path's `d`, in the
 * SVG-unit space the engine's path markup is emitted in (`buildPathD`'s
 * projection): each stamp's copy placed, turned and scaled into world
 * cells, then projected. The one transform for a style's single outline
 * and for each path of its art.
 */
function stampsPathD(
  commands: readonly GlyphCommand[], stamps: readonly GlyphPlacement[], unitsPerCell: number,
): string {
  return stamps.map((s) => {
    const cos = Math.cos(s.angle) * s.scale;
    const sin = Math.sin(s.angle) * s.scale;
    return glyphCommandsPathD(commands, (gx, gy) => [
      (s.x + gx * cos - gy * sin) * unitsPerCell,
      (s.y + gx * sin + gy * cos) * unitsPerCell,
    ]);
  }).join(' ');
}

/**
 * Every stamp of a style along a chain as ONE path's `d` ({@link
 * stampsPathD}) — for a style with art, its outline. '' when there is
 * nothing to stamp.
 */
export function lineStylePathD(
  segments: readonly PathSegment[], style: LineStyleEffect, seed: number,
  unitsPerCell = SVG_UNITS_PER_L0_CELL,
): string {
  const glyph = lineStyleGlyphCommands(style);
  const stamps = placementsFor(segments, style, seed, glyph.length);
  if (stamps.length === 0 || glyph.length === 0) return '';
  return stampsPathD(glyph, stamps, unitsPerCell);
}

const rgb = ({ r, g, b }: RGBColor): string => `rgb(${r},${g},${b})`;

/**
 * A style's art along a chain: ONE `<path>` per art path, holding every
 * stamp's copy of it, in the art's order (the first is the bottom) — so a
 * stamp's paths are layered path by path across the whole run, not stamp
 * by stamp, and the markup stays a path per colour however many stamps
 * there are. Each is painted in its OWN fill, outline and opacity, each
 * colour shifted by the path's `ink` ({@link lineStyleArtTint}); the
 * outline's width is the fitted one at the style's `size` (one width per
 * path, so the Size slider scales it and the random size does not), with
 * round caps and joins, as a drawing's strokes are.
 */
function lineStyleArtMarkup(
  segments: readonly PathSegment[], style: LineStyleEffect, seed: number,
  art: readonly FittedArtPath[], unitsPerCell: number, ink: RGBColor,
): string {
  const commandCount = art.reduce((n, path) => n + path.commands.length, 0);
  const stamps = placementsFor(segments, style, seed, commandCount);
  if (stamps.length === 0) return '';
  let out = '';
  for (const path of art) {
    const fill = path.fill
      ? `fill="${rgb(lineStyleArtTint(path.fill, ink))}"${path.fillOpacity !== undefined ? ` fill-opacity="${fmt(path.fillOpacity)}"` : ''}`
      : 'fill="none"';
    const stroke = path.color && path.width !== undefined
      ? `stroke="${rgb(lineStyleArtTint(path.color, ink))}" stroke-width="${fmt(path.width * style.size * unitsPerCell)}" stroke-linecap="round" stroke-linejoin="round"`
      : 'stroke="none"';
    const opacity = path.opacity !== undefined ? ` opacity="${fmt(path.opacity)}"` : '';
    out += `<path d="${stampsPathD(path.commands, stamps, unitsPerCell)}" ${fill} ${stroke}${opacity} />`;
  }
  return out;
}

/**
 * The markup a styled chain draws in place of its stroke: the stamps as one
 * outlined path in the given ink, wearing the stroke attrs the caller
 * would have put on the line (`svgStrokePresentation`'s — width, dash,
 * caps). A style with ART draws that instead, in the art's own paint
 * SHIFTED by the ink ({@link lineStyleArtTint}: a white path draws the art
 * exactly as drawn, a coloured one tints it), so a styled path is
 * recoloured as any path is — by its own `color`, a subpath's, the Color
 * brush's; the stroke attrs do not dress it. '' when there is nothing to
 * stamp.
 */
export function lineStyleMarkup(
  segments: readonly PathSegment[], style: LineStyleEffect, seed: number,
  strokeAttrs: string, color: RGBColor,
): string {
  const art = lineStyleArt(style);
  if (art) return lineStyleArtMarkup(segments, style, seed, art, SVG_UNITS_PER_L0_CELL, color);
  const d = lineStylePathD(segments, style, seed);
  if (!d) return '';
  return `<path d="${d}" ${strokeAttrs} stroke="${rgb(color)}" />`;
}
