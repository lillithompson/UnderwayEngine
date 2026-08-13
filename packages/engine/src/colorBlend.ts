import type { BlendMode, RGBColor } from './types';
import { hsvToRgb, rgbToHsv } from './colorConvert';

export type { BlendMode };

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

const HUE_ROTATE_STEP_DEG = 30;

/**
 * Modes whose `opacity` argument drives the EFFECT itself rather than a lerp
 * toward the result — currently just `rotate`, where it is the hue angle.
 *
 * Callers that apply their own weighting (a brush dab's falloff, say) must
 * ask before deciding what to pass: for these modes the strength belongs in
 * the opacity argument and the result is used as-is, because lerping a
 * rotated hue back toward its base cuts across the colour circle and
 * desaturates toward grey — the very thing the rotate mode exists to avoid.
 */
export function blendFoldsOpacity(mode: BlendMode): boolean {
  return mode === 'rotate';
}

/**
 * Blend `brush` over `base` under the given blend mode (Photoshop/SVG-style
 * separable and HSL modes), then
 * linearly interpolate toward the blended result by `opacity`. Channel
 * math is performed in normalized [0,1] and rounded back to 8-bit
 * integers. Returns a new RGBColor.
 *
 * Rotate is special: opacity scales the hue-rotation angle in HSV space
 * rather than RGB-lerping the rotated result back toward base (which
 * desaturates toward gray). At opacity 1 the rotation is the full
 * HUE_ROTATE_STEP_DEG; at opacity 0 the hue is unchanged.
 *
 * Used by the Composer's drag-paint Color tool to decide what color a
 * painted SVG segment (or figure tint) ends up at, given the segment's
 * current color and the brush's chosen mode + opacity.
 */
export function blendColor(
  base: RGBColor,
  brush: RGBColor,
  mode: BlendMode,
  opacity: number,
): RGBColor {
  const t = clamp01(opacity);
  if (blendFoldsOpacity(mode)) {
    // Opacity is folded into the rotation angle by applyBlend; skip the
    // RGB lerp so the result stays on the hue circle at full S/V.
    return applyBlend(base, brush, mode, t);
  }
  const blended = applyBlend(base, brush, mode, t);
  return {
    r: Math.round(base.r + (blended.r - base.r) * t),
    g: Math.round(base.g + (blended.g - base.g) * t),
    b: Math.round(base.b + (blended.b - base.b) * t),
  };
}

function applyBlend(base: RGBColor, brush: RGBColor, mode: BlendMode, opacity: number): RGBColor {
  switch (mode) {
    case 'normal':
      return brush;
    case 'multiply':
      return {
        r: clamp255(Math.round((base.r * brush.r) / 255)),
        g: clamp255(Math.round((base.g * brush.g) / 255)),
        b: clamp255(Math.round((base.b * brush.b) / 255)),
      };
    case 'dodge':
      return {
        r: dodgeChannel(base.r, brush.r),
        g: dodgeChannel(base.g, brush.g),
        b: dodgeChannel(base.b, brush.b),
      };
    case 'lighten':
      return {
        r: Math.max(base.r, brush.r),
        g: Math.max(base.g, brush.g),
        b: Math.max(base.b, brush.b),
      };
    case 'darken':
      return {
        r: Math.min(base.r, brush.r),
        g: Math.min(base.g, brush.g),
        b: Math.min(base.b, brush.b),
      };
    case 'burn':
      return {
        r: burnChannel(base.r, brush.r),
        g: burnChannel(base.g, brush.g),
        b: burnChannel(base.b, brush.b),
      };
    case 'invert':
      return { r: 255 - base.r, g: 255 - base.g, b: 255 - base.b };
    case 'rotate': {
      const [h, s, v] = rgbToHsv(base.r, base.g, base.b);
      const rotation = HUE_ROTATE_STEP_DEG * opacity;
      const [r, g, b] = hsvToRgb((h + rotation) % 360, s, v);
      return { r, g, b };
    }
    case 'randomize':
      // The randomness is the STROKE's, not the pixel's: the brush walks
      // smoothly between random colours as it is dragged (the caller owns
      // that walk and hands the current colour in as `brush`), so a random
      // stroke reads as a line drifting through colour rather than as
      // per-pixel confetti. Nothing to compute here — deposit what the
      // brush is carrying.
      return brush;
    case 'hue': {
      const [, sBase, vBase] = rgbToHsv(base.r, base.g, base.b);
      const [hBrush] = rgbToHsv(brush.r, brush.g, brush.b);
      const [r, g, b] = hsvToRgb(hBrush, sBase, vBase);
      return { r, g, b };
    }
    case 'color': {
      const [, , vBase] = rgbToHsv(base.r, base.g, base.b);
      const [hBrush, sBrush] = rgbToHsv(brush.r, brush.g, brush.b);
      const [r, g, b] = hsvToRgb(hBrush, sBrush, vBase);
      return { r, g, b };
    }
  }
}

/** Color-burn per channel. `result = 1 - (1 - base) / brush` in [0,1] space,
 *  with `brush === 0` saturating to black and `brush === 1` returning
 *  base unchanged (matches Photoshop / SVG spec). Inverse of `dodgeChannel`. */
function burnChannel(base: number, brush: number): number {
  if (brush <= 0) return 0;
  const denom = brush / 255;
  const out = 1 - (1 - base / 255) / denom;
  return clamp255(Math.round(out * 255));
}

/** Color-dodge per channel. `result = base / (1 - brush)` in [0,1] space,
 *  with `brush === 1` saturating to white and `brush === 0` returning
 *  base unchanged (matches Photoshop / SVG spec). */
function dodgeChannel(base: number, brush: number): number {
  if (brush >= 255) return 255;
  const denom = 1 - brush / 255;
  const out = (base / 255) / denom;
  return clamp255(Math.round(out * 255));
}

/**
 * Per-pixel luminance-weighted recolor: `lerp(base, tint, lum(base))` with
 * Rec. 709 luminance weights. White base → tint exactly, black stays black,
 * mid-tones shift toward tint without darkening. Mirrors the COMP_FIG_FRAG
 * shader; used to bake a figure's `colorOverride` directly into exported
 * SVG fill/stroke attributes so the result renders identically in any SVG
 * tool (including Figma, which silently drops advanced filter primitives).
 */
export function recolorPixel(base: RGBColor, tint: RGBColor): RGBColor {
  const lum = (0.2126 * base.r + 0.7152 * base.g + 0.0722 * base.b) / 255;
  return {
    r: clamp255(Math.round(base.r * (1 - lum) + tint.r * lum)),
    g: clamp255(Math.round(base.g * (1 - lum) + tint.g * lum)),
    b: clamp255(Math.round(base.b * (1 - lum) + tint.b * lum)),
  };
}

const GAUSSIAN_K = 4;
const GAUSSIAN_E_NEG_K = Math.exp(-GAUSSIAN_K);
const GAUSSIAN_DENOM = 1 - GAUSSIAN_E_NEG_K;

/**
 * Normalized Gaussian falloff multiplier for the drag-paint brush.
 *
 * `tSq` is the squared normalized distance from the brush center to the
 * sampled point — i.e. `(distance / radius) ** 2`, in `[0, 1]`. Working
 * in squared space lets callers skip a `Math.sqrt`: the Gaussian itself
 * only needs `(d/r)²`.
 *
 * The raw Gaussian `exp(-K * tSq)` returns ~0.018 at the edge for K=4,
 * which produces a visible step where segments cross in and out of the
 * brush as the cursor moves. Rescaling pins g(0)=1 and g(1)=0 so the
 * boundary is smooth and the falloff still looks Gaussian-shaped
 * (round, not pyramidal) for tSq in between.
 */
export function gaussianFalloff(tSq: number): number {
  if (tSq >= 1) return 0;
  if (tSq <= 0) return 1;
  return (Math.exp(-GAUSSIAN_K * tSq) - GAUSSIAN_E_NEG_K) / GAUSSIAN_DENOM;
}

export function colorsEqual(a: RGBColor, b: RGBColor): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}
