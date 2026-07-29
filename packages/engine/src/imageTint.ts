/**
 * Pure image-tint math for `ImageObject.tint` (shader-time recolor; this
 * is the reference implementation the GPU path and SVG export must
 * match). All modes blend the base pixel toward a mode-specific target by
 * `amount` (0 = identity, 1 = full effect); channels round + clamp 0..255.
 *
 * Modes:
 *  - 'tint':    gray = luminance(base); target = gray * tintColor / 255
 *               per channel. Colorizes through the image's own luminance.
 *  - 'duotone': t = luminance(base) / 255; target = mix(black, tintColor, t).
 *               A shadow→tint ramp. With the current black endpoint this
 *               is numerically identical to 'tint'; kept as a distinct
 *               mode so the ramp endpoints can diverge without a format
 *               change.
 *  - 'wash':    target = mix(tintColor, white, 0.5), constant per pixel —
 *               a translucent color overlay.
 *
 * The per-channel lerp reuses `blendColor(_, _, 'normal', t)` from
 * colorBlend.ts so rounding matches the paint-brush math everywhere.
 */

import { ImageTint, RGBColor } from './types';
import { blendColor } from './colorBlend';

const WHITE: RGBColor = { r: 255, g: 255, b: 255 };

/** Rec. 709 luminance in the 0–255 range (same weights as
 *  `recolorPixel` in colorBlend.ts and the COMP_FIG_FRAG shader). */
export function luminance(c: RGBColor): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

export function applyImageTint(base: RGBColor, tint: ImageTint): RGBColor {
  const amount = clamp01(tint.amount);
  let target: RGBColor;
  switch (tint.mode) {
    case 'tint': {
      const gray = luminance(base);
      target = {
        r: (gray * tint.color.r) / 255,
        g: (gray * tint.color.g) / 255,
        b: (gray * tint.color.b) / 255,
      };
      break;
    }
    case 'duotone': {
      const t = luminance(base) / 255;
      target = { r: tint.color.r * t, g: tint.color.g * t, b: tint.color.b * t };
      break;
    }
    case 'wash':
      target = blendColor(tint.color, WHITE, 'normal', 0.5);
      break;
  }
  const mixed = blendColor(base, target, 'normal', amount);
  return { r: clamp255(mixed.r), g: clamp255(mixed.g), b: clamp255(mixed.b) };
}
