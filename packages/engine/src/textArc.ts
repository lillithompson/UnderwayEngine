import { TextStyle } from './types';

// Arc-bent text (`TextStyle.bend`): the geometry both renderers place their
// glyphs with — the SVG exporter's <textPath> (compositionSVGCore) and the
// editor's inline-SVG line layer (the app's NodeLayer) — kept in one place so
// the stored image and the on-canvas preview cannot bow differently.
//
// The model: a text node bends as ONE block around one centre. Its widest
// line sets the curve — that line keeps its flat width W as its ARC length
// (glyph advances and letter spacing unchanged along the path) and sweeps
// |bend| half-turns (bend ±1 = a 180° arc); its arc is symmetric about the
// line's centre with both endpoints ON the flat baseline — positive bend
// bows the middle up, negative down — so the slider reads as the middle of
// the block lifting or dipping in place, and bend → 0 converges on the flat
// lines the renderers draw without it. Every other line rides a CONCENTRIC
// ring: the same centre, its radius the widest line's shifted by the line's
// distance from it (a line nearer the centre is a smaller ring), and its
// own flat width as its arc length. So the curvature is the block's, never
// a line's — a short line bends as gently as the long one beside it, only
// through a smaller angle — and every line's apex bows off its baseline by
// the same rise.

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
 * The arc for the block's widest line, of flat width `width`, at bend `bend`
 * (both non-zero): the ring every other line is concentric with. Pure
 * numbers so the outset math (how far bent ink can spill past a box) can
 * share it with the path builder.
 */
export function textArcGeometry(width: number, bend: number): TextArcGeometry {
  const sweep = Math.min(1, Math.abs(bend)) * MAX_SWEEP;
  const radius = width / sweep;
  const halfChord = radius * Math.sin(sweep / 2);
  const rise = radius * (1 - Math.cos(sweep / 2));
  return { radius, sweep, halfChord, rise };
}

/** One flat line of a block, in the units the paths come back in. */
export interface TextArcLine {
  /** Where the FLAT line starts: its left edge. */
  x: number;
  /** The flat line's glyph midline — the `central` baseline the glyphs center on. */
  y: number;
  /** The flat line's width, which its arc keeps as its arc length. */
  width: number;
}

/**
 * SVG paths for a block's bent baselines, one per line in `lines`' order:
 * `M … A …` from each line's left end to its right. The block bends around
 * the one centre its widest line sets (see the header); a line's ring is
 * that radius shifted by the line's distance from the widest one, never
 * tighter than the half circle its own width makes (a block far taller
 * than its widest line is wide would otherwise curl its inner lines past
 * a full turn). Each line's arc sits over its own flat centre. Lines of no
 * width get '' (nothing to bend; callers draw no path for them). Callers
 * handle bend = 0 themselves (flat text needs no path at all).
 */
export function textArcPaths(lines: readonly TextArcLine[], bend: number): string[] {
  let ref = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].width > 0 && (ref < 0 || lines[i].width > lines[ref].width)) ref = i;
  }
  if (ref < 0 || bend === 0) return lines.map(() => '');
  const widest = lines[ref];
  const { radius, rise } = textArcGeometry(widest.width, bend);
  // Which way the centre lies from the baselines: below them for an upward
  // bow (screen y grows downward), above for a downward one.
  const s = bend > 0 ? 1 : -1;
  const cx = widest.x + widest.width / 2;
  const cy = widest.y + s * (radius - rise);
  // Left→right over the top is clockwise on screen (y-down): sweep flag 1.
  // Under the bottom is the counterclockwise arc: sweep flag 0.
  const sweepFlag = s > 0 ? 1 : 0;
  return lines.map((line) => {
    if (line.width <= 0) return '';
    const r = Math.max(radius - s * (line.y - widest.y), line.width / MAX_SWEEP);
    // Angles from the apex direction; the line's own centre maps to the
    // angle its flat centre subtends on its ring (|r·sin θ| ≤ |r·θ|, so
    // every point lands nearer the block's centre line than it lay flat —
    // nothing reaches past the block's flat extent).
    const half = line.width / (2 * r);
    const mid = (line.x + line.width / 2 - cx) / r;
    const px = (a: number) => cx + r * Math.sin(a);
    const py = (a: number) => cy - s * r * Math.cos(a);
    return `M ${px(mid - half)} ${py(mid - half)} A ${r} ${r} 0 0 ${sweepFlag} ${px(mid + half)} ${py(mid + half)}`;
  });
}
