import { TextStyle } from './types';

// Arc-bent text (`TextStyle.bend`): the geometry both renderers place their
// glyphs with — the SVG exporter's <textPath> (compositionSVGCore) and the
// editor's inline-SVG line layer (the app's NodeLayer) — kept in one place so
// the stored image and the on-canvas preview cannot bow differently.
//
// The model: a line of flat width W keeps W as its ARC length, so glyph
// advances (and letter spacing) are unchanged along the path; the sweep is
// |bend| half-turns (bend ±1 = a 180° arc). The arc is symmetric about the
// line's center with both endpoints ON the flat baseline — positive bend
// bows the middle up, negative down — so a bend slider reads as the middle
// of the line lifting or dipping in place, and bend → 0 converges on the
// flat line the renderers draw without it.

/** Sweep angle at |bend| = 1: a half circle. */
const MAX_SWEEP = Math.PI;

/** The style's bend, clamped to −1…1; 0 (flat) when absent. */
export function textBend(style: TextStyle): number {
  const b = style.bend ?? 0;
  if (!Number.isFinite(b)) return 0;
  return Math.max(-1, Math.min(1, b));
}

export interface TextArcGeometry {
  /** Circle radius (same unit as `width`). */
  radius: number;
  /** Sweep angle in radians (0 < sweep ≤ π). */
  sweep: number;
  /** Half the chord between the arc's endpoints. */
  halfChord: number;
  /** How far the apex bows off the baseline (the arc's sagitta, ≥ 0). */
  rise: number;
}

/**
 * The arc for a line of flat width `width` at bend `bend` (both non-zero).
 * Pure numbers so the outset math (how far bent ink can spill past a box)
 * can share it with the path builder.
 */
export function textArcGeometry(width: number, bend: number): TextArcGeometry {
  const sweep = Math.min(1, Math.abs(bend)) * MAX_SWEEP;
  const radius = width / sweep;
  const halfChord = radius * Math.sin(sweep / 2);
  const rise = radius * (1 - Math.cos(sweep / 2));
  return { radius, sweep, halfChord, rise };
}

/**
 * SVG path for one line's bent baseline: `M … A …` from the line's left end
 * to its right, in the same units as the inputs. (`x`, `y`) is where the
 * FLAT line starts (its left edge on the baseline the glyphs center on);
 * `width` is the flat line width, which the arc keeps as its arc length.
 * Callers handle bend = 0 themselves (flat text needs no path at all).
 */
export function textArcPath(x: number, y: number, width: number, bend: number): string {
  const { radius, halfChord } = textArcGeometry(width, bend);
  const mid = x + width / 2;
  // Left→right over the top is clockwise on screen (y-down): sweep flag 1.
  // Under the bottom is the counterclockwise arc: sweep flag 0.
  const sweepFlag = bend > 0 ? 1 : 0;
  return `M ${mid - halfChord} ${y} A ${radius} ${radius} 0 0 ${sweepFlag} ${mid + halfChord} ${y}`;
}
