import type { LineStyleGlyphKind, LineStyleModel } from '../adapter';
import { type GlyphCommand, glyphCommandsPathD, lineStyleGlyphCommands } from '@/engine/lineStyle';
import { clamp01 } from '../appTheme';

// The Style page's pure parts: its three faces, what its glyph row offers,
// the Size and Rotation rows' ranges, and the drawing pad's arithmetic — a
// touch in pad units, the strokes a lifted finger commits, and what the
// pad draws. The component (components/LineStyleBar.tsx) is React Native
// and holds the views; these are what a node test can reach.

/** The page's three faces, the Copies page's inner tabs over again: which
 *  glyph and how it is laid (with the pad), how it is turned, how big it
 *  is. One section, one at a time. */
export type LineStyleSection = 'glyph' | 'rotation' | 'scale';

export const LINE_STYLE_SECTIONS: readonly { value: LineStyleSection; label: string }[] = [
  { value: 'glyph', label: 'Glyph' },
  { value: 'rotation', label: 'Rotation' },
  { value: 'scale', label: 'Scale' },
];

/** The glyph row's choices, in the order they stand. Icons are names from
 *  the Material Community set the segmented rows draw. */
export const LINE_STYLE_GLYPH_OPTIONS: readonly { value: LineStyleGlyphKind; label: string; icon: string }[] = [
  { value: 'line', label: 'Dash', icon: 'minus' },
  { value: 'circle', label: 'Circle', icon: 'circle-outline' },
  { value: 'sparkle', label: 'Sparkle', icon: 'star-four-points-outline' },
  { value: 'heart', label: 'Heart', icon: 'heart-outline' },
  { value: 'custom', label: 'Draw', icon: 'pencil-outline' },
];

// ── Ranges (world cells; design pt ÷ 16) ─────────────────────────────
/** The smallest glyph the Size row offers: 2pt — a dot. */
export const MIN_GLYPH_SIZE = 0.125;
/** …and the largest: 64pt. */
export const MAX_GLYPH_SIZE = 4;
/** The Rotation row runs a full turn, in degrees. */
export const MAX_GLYPH_ROTATION = 360;

/** How much of the pad a built-in glyph's preview spans. */
const PREVIEW_SPAN = 0.7;
/** The least a stroke has to span, in pad units, to be a drawing: under
 *  this it is a tap or a tremor — and a tremor fitted to its own bounds
 *  would stamp as a full-size dash at whatever angle the finger shook. */
export const MIN_DRAW_EXTENT = 0.03;

/** The pad's own point for a touch: pad units, 0…1 each way, clamped to the
 *  square so a finger that runs off the edge keeps drawing along it. */
export function padPointFromTouch(x: number, y: number, size: number): [number, number] | null {
  if (!(size > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [clamp01(x / size), clamp01(y / size)];
}

/** How far a stroke reaches, in pad units: the longer side of its box. */
function strokeExtent(stroke: readonly (readonly [number, number])[]): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of stroke) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return stroke.length ? Math.max(maxX - minX, maxY - minY) : 0;
}

/** The strokes a lifted finger commits: the new stroke after the ones a
 *  drawn glyph already holds, or on its own when the glyph was a built-in
 *  one — a first stroke starts a new drawing rather than adding to the
 *  sketch Draw remembered. A stroke that spans less than
 *  {@link MIN_DRAW_EXTENT} — a tap, a tremor — draws nothing: the pad
 *  always holds a point where the finger landed, so a point count cannot
 *  tell a tap from a line. */
export function strokesAfterDraw(
  style: LineStyleModel, stroke: readonly [number, number][],
): [number, number][][] | null {
  if (stroke.length < 2 || strokeExtent(stroke) < MIN_DRAW_EXTENT) return null;
  const copy = stroke.map(([x, y]): [number, number] => [x, y]);
  return style.glyph === 'custom' && style.custom ? [...style.custom, copy] : [copy];
}

/** A run of pad-unit points as a path's `d`, in pad pixels — the live
 *  stroke under the finger, and each stroke of a drawn glyph. The engine's
 *  own command walk, fed lines. */
export function padPolylinePathD(points: readonly (readonly [number, number])[], padSize: number): string {
  const commands: GlyphCommand[] = points.map(([x, y], i) => [i === 0 ? 'M' : 'L', x, y]);
  return glyphCommandsPathD(commands, (x, y) => [x * padSize, y * padSize]);
}

/** What the pad draws, as one path's `d` in pad pixels: a drawn glyph as
 *  it was drawn; a built-in one from its unit box, spanning PREVIEW_SPAN of
 *  the pad — its CURVES kept as curves (the engine's own commands, which is
 *  what the path will stamp), so a circle previews as the circle it is and
 *  not as a chain of pieces. Draw with nothing drawn yet shows the circle it
 *  will stamp. */
export function padGlyphPathD(style: LineStyleModel, padSize: number): string {
  if (style.glyph === 'custom' && style.custom && style.custom.length > 0) {
    return style.custom.map((stroke) => padPolylinePathD(stroke, padSize)).join(' ');
  }
  const commands = lineStyleGlyphCommands({
    glyph: style.glyph === 'custom' ? 'circle' : style.glyph,
    density: style.density, size: style.size, rotation: 0,
    randomPlacement: 0, randomRotation: 0, randomSize: 0,
  });
  return glyphCommandsPathD(commands, (x, y) => [
    (0.5 + x * PREVIEW_SPAN) * padSize, (0.5 + y * PREVIEW_SPAN) * padSize,
  ]);
}
