// Maximum line width in SVG units. The "Line Width" slider in the composer
// is a 0–1 percentage of this value.
export const MAX_LINE_WIDTH = 1000;

// Rendering code multiplies SVG_STROKE_WIDTH (5) by a literal multiplier to
// get the displayed stroke width. With strokeScale now in [0, 1], the
// equivalent multiplier is strokeScale × (MAX_LINE_WIDTH / SVG_STROKE_WIDTH).
// Convert at the rendering boundary so downstream code can stay unchanged.
export const STROKE_SCALE_RENDER_MULTIPLIER = MAX_LINE_WIDTH / 5;

// Default strokeScale (percentage), used only as a fallback for input that
// records none: pre-v4 binary files and legacy JSON. Renders at 200 SVG units
// of stroke width — 5× the old 40-unit default (legacy 8× SVG_STROKE_WIDTH),
// so files with no recorded width land near the current app default rather
// than a fifth of it.
export const DEFAULT_STROKE_SCALE = 200 / MAX_LINE_WIDTH;

// Validate a strokeScale value and fill in the default for missing/bad input.
// v4+ strokeScale is a number in [0, 1] (rendered = scale × MAX_LINE_WIDTH).
// v23+ allows values > 1 because composition normalization multiplies it by
// the inverse content scale factor (up to ~32×). The legacy ">1 means
// pre-v4-format multiplier" migration is handled by `migrateLegacyStrokeScale`
// at the binary-format boundary, not here.
export function normalizeStrokeScale(v: number | undefined | null): number {
  if (v == null || !Number.isFinite(v)) return DEFAULT_STROKE_SCALE;
  return v;
}

// One-shot migration for v22-and-earlier values. Pre-v4 binary files stored
// strokeScale as a literal multiplier in [5, 40] (rendered = scale ×
// SVG_STROKE_WIDTH); v4–v22 stored it as a percentage in [0, 1]. The
// `>1 ⇒ divide by STROKE_SCALE_RENDER_MULTIPLIER` heuristic preserves the
// rendered width across that format change. Call only from v22- readers.
export function migrateLegacyStrokeScale(v: number | undefined | null): number {
  if (v == null || !Number.isFinite(v)) return DEFAULT_STROKE_SCALE;
  return v > 1 ? v / STROKE_SCALE_RENDER_MULTIPLIER : v;
}

export function effectiveStrokeMultiplier(strokeScale: number): number {
  return strokeScale * STROKE_SCALE_RENDER_MULTIPLIER;
}
