import type { LineStyleGlyphKind, LineStyleModel } from '../adapter';
import { lineStyleGlyphPreview } from '@/engine/lineStyle';
import { clamp01 } from '../appTheme';

// The Style page's pure parts: what its glyph row offers, the Size row's
// range, and the drawing pad's arithmetic — a touch in pad units, the
// strokes a lifted finger commits, and what the pad draws. The component
// (components/LineStyleBar.tsx) is React Native and holds the views; these
// are what a node test can reach.

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

/** How much of the pad a built-in glyph's preview spans. */
const PREVIEW_SPAN = 0.7;

/** The pad's own point for a touch: pad units, 0…1 each way, clamped to the
 *  square so a finger that runs off the edge keeps drawing along it. */
export function padPointFromTouch(x: number, y: number, size: number): [number, number] | null {
  if (!(size > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [clamp01(x / size), clamp01(y / size)];
}

/** The strokes a lifted finger commits: the new stroke after the ones a
 *  drawn glyph already holds, or on its own when the glyph was a built-in
 *  one — a first stroke starts a new drawing rather than adding to the
 *  sketch Draw remembered. A stroke of one point (a tap) draws nothing. */
export function strokesAfterDraw(
  style: LineStyleModel, stroke: readonly [number, number][],
): [number, number][][] | null {
  if (stroke.length < 2) return null;
  const copy = stroke.map(([x, y]): [number, number] => [x, y]);
  return style.glyph === 'custom' && style.custom ? [...style.custom, copy] : [copy];
}

/** What the pad draws: a drawn glyph as it was drawn, in pad units; a
 *  built-in one from its unit box, spanning PREVIEW_SPAN of the pad. Draw
 *  with nothing drawn yet shows the circle it will stamp. */
export function padPolylines(style: LineStyleModel): [number, number][][] {
  if (style.glyph === 'custom' && style.custom && style.custom.length > 0) return style.custom;
  return lineStyleGlyphPreview({
    glyph: style.glyph === 'custom' ? 'circle' : style.glyph,
    density: style.density, size: style.size,
    randomPlacement: 0, randomRotation: 0, randomSize: 0,
  }).map((poly) => poly.map(([x, y]): [number, number] => [0.5 + x * PREVIEW_SPAN, 0.5 + y * PREVIEW_SPAN]));
}
