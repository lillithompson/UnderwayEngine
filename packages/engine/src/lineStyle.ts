import type { LineStyleEffect, LineStyleGlyph, PathSegment, RGBColor, SVGObject } from './types';
import { arcMotionAt, piecePointAt, segLength } from './compositionArcMath';
import { fnv1a32, mulberry32 } from './seededRandom';
import { SVG_UNITS_PER_L0_CELL } from './svgExport';

// A LINE STYLE: the path is not stroked; a glyph is stamped along it instead
// — a heart every so often, each one turned to face the way the path runs
// where it stands. The stamps are OUTLINED in the path's own ink, width and
// dash, so the Stroke page dresses the glyphs exactly as it dressed the line
// they replace (`svgStrokesMarkup` in svgPathBuilder.ts hands the same
// stroke attrs to both).
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

/**
 * A drawn glyph fitted to its own bounds: the polylines' box is centred on
 * the origin and its longer side scaled to 1, so a sketch in one corner of
 * the pad stamps as large as one across the whole of it. Null when there is
 * nothing to fit — no strokes, or a single point (a tap) — and the caller
 * falls back to a built-in glyph rather than stamping nothing.
 */
function fittedCustomGlyph(custom: LineStyleEffect['custom']): readonly GlyphCommand[] | null {
  if (!custom) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let points = 0;
  for (const stroke of custom) {
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
  const out: GlyphCommand[] = [];
  for (const stroke of custom) {
    let first = true;
    for (const [x, y] of stroke) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      out.push([first ? 'M' : 'L', (x - cx) / span, (y - cy) / span]);
      first = false;
    }
  }
  return out;
}

/** The outline a style stamps: its glyph in the unit box. A custom glyph
 *  that cannot be fitted (never drawn, or a single tap) stamps a circle, so
 *  choosing Draw never makes the path vanish. */
export function lineStyleGlyphCommands(style: LineStyleEffect): readonly GlyphCommand[] {
  if (style.glyph === 'custom') return fittedCustomGlyph(style.custom) ?? GLYPHS.circle;
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
 *  across the path. What a caller grows a clip or a filter region by. */
export function lineStyleReachCells(style: LineStyleEffect): number {
  const size = Math.max(0, style.size);
  const biggest = size * (1 + 0.75 * clamp01(style.randomSize));
  return biggest * Math.SQRT1_2 + 0.75 * size * clamp01(style.randomPlacement);
}

/** The PRNG seed a given object's stamps are drawn from. The outline casts
 *  the node layer draws for a shadow carry the object's id too, so a cast
 *  lands under the very glyphs it shadows. */
export function lineStyleSeed(objectId: string, subpath = 0): number {
  return fnv1a32(objectId) ^ (subpath * 0x9e3779b9);
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
 * sliders are independent of one another.
 */
export function lineStylePlacements(
  segments: readonly PathSegment[], style: LineStyleEffect, seed: number,
): GlyphPlacement[] {
  const walk = measurePath(segments);
  const spacing = lineStyleSpacing(style);
  if (walk.total <= EPS || !(spacing > EPS) || !(style.size > 0)) return [];
  const rng = mulberry32(seed);
  const baseTurn = (style.rotation || 0) * Math.PI / 180;
  const placement = clamp01(style.randomPlacement);
  const rotation = clamp01(style.randomRotation);
  const sizing = clamp01(style.randomSize);

  let count: number;
  let step: number;
  let start = 0;
  if (walk.total < spacing * 0.5) {
    count = 1;
    step = 0;
    start = walk.total / 2;
  } else if (walk.closed) {
    count = Math.max(1, Math.round(walk.total / spacing));
    step = walk.total / count;
  } else {
    count = Math.max(2, Math.round(walk.total / spacing) + 1);
    step = walk.total / (count - 1);
  }

  const out: GlyphPlacement[] = [];
  const cursor = { k: 0 };
  for (let i = 0; i < count; i++) {
    const along = (rng() * 2 - 1) * 0.5 * (step || spacing) * placement;
    const across = (rng() * 2 - 1) * 0.75 * style.size * placement;
    const turn = (rng() * 2 - 1) * Math.PI * rotation;
    const grow = 1 + (rng() * 2 - 1) * 0.75 * sizing;
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
 * Every stamp of a style along a chain as ONE path's `d`, in the SVG-unit
 * space the engine's path markup is emitted in (`buildPathD`'s projection):
 * each glyph's commands placed, turned and scaled into world cells, then
 * projected. '' when there is nothing to stamp.
 */
export function lineStylePathD(
  segments: readonly PathSegment[], style: LineStyleEffect, seed: number,
  unitsPerCell = SVG_UNITS_PER_L0_CELL,
): string {
  const glyph = lineStyleGlyphCommands(style);
  const stamps = lineStylePlacements(segments, style, seed);
  if (stamps.length === 0 || glyph.length === 0) return '';
  return stamps.map((s) => {
    const cos = Math.cos(s.angle) * s.scale;
    const sin = Math.sin(s.angle) * s.scale;
    return glyphCommandsPathD(glyph, (gx, gy) => [
      (s.x + gx * cos - gy * sin) * unitsPerCell,
      (s.y + gx * sin + gy * cos) * unitsPerCell,
    ]);
  }).join(' ');
}

/**
 * The markup a styled chain draws in place of its stroke: the stamps as one
 * outlined path in the given ink, wearing the stroke attrs the caller
 * would have put on the line (`svgStrokePresentation`'s — width, dash,
 * caps). '' when there is nothing to stamp.
 */
export function lineStyleMarkup(
  segments: readonly PathSegment[], style: LineStyleEffect, seed: number,
  strokeAttrs: string, color: RGBColor,
): string {
  const d = lineStylePathD(segments, style, seed);
  if (!d) return '';
  const { r, g, b } = color;
  return `<path d="${d}" ${strokeAttrs} stroke="rgb(${r},${g},${b})" />`;
}
