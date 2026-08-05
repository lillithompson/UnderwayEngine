import type { RGBLike } from '../adapter';

// Pure HSV↔RGB math, alpha helpers, and a palette generator for the fallback
// ColorPickerModal (no WebGL, no engine dep). Channels: r/g/b 0–255, h 0–360,
// s/v/a 0–1.

export interface HSV {
  h: number;
  s: number;
  v: number;
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/** A color's alpha, 0–1. Absent (or non-finite) means fully opaque, so every
 *  color written before the picker gained its Opacity slider reads as 1. */
export const colorAlpha = (c: RGBLike): number =>
  typeof c.a === 'number' && Number.isFinite(c.a) ? clamp01(c.a) : 1;

/** `c` at alpha `a` (0–1). Fully opaque drops the field rather than storing
 *  `a: 1`, so an opaque color stays structurally `{r,g,b}` — hosts diffing or
 *  serializing colors see no change until an opacity is actually set. */
export function withAlpha(c: RGBLike, a: number): RGBLike {
  const alpha = clamp01(Number.isFinite(a) ? a : 1);
  const { r, g, b } = c;
  return alpha >= 1 ? { r, g, b } : { r, g, b, a: alpha };
}

/** Whether the color is see-through — i.e. anything painted with it needs a
 *  checkerboard behind it to read as transparent rather than as a color that
 *  merely happens to sit closer to the surface behind it. */
export const isTranslucent = (c: RGBLike): boolean => colorAlpha(c) < 1;

/** RGBLike → a CSS color string (works as a react-native color value):
 *  `rgb(...)` when opaque, `rgba(...)` once an alpha is set. Every swatch,
 *  gradient stop and canvas paint in the package goes through this, so a
 *  color's opacity follows it everywhere it is used. */
export const rgbCss = (c: RGBLike): string => {
  const [r, g, b] = [Math.round(c.r), Math.round(c.g), Math.round(c.b)];
  const a = colorAlpha(c);
  return a < 1 ? `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})` : `rgb(${r}, ${g}, ${b})`;
};

export function rgbToHsv({ r, g, b }: RGBLike): HSV {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

export function hsvToRgb({ h, s, v }: HSV): RGBLike {
  const c = v * s;
  const hh = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

const PALETTE_HUES = [0, 25, 45, 60, 120, 170, 200, 220, 260, 300, 330];
// light → saturated → dark for each hue column.
const PALETTE_STEPS: Array<{ s: number; v: number }> = [
  { s: 0.35, v: 1.0 },
  { s: 0.6, v: 1.0 },
  { s: 0.85, v: 0.95 },
  { s: 1.0, v: 0.8 },
  { s: 1.0, v: 0.55 },
];

/** A grid of swatches: one row per hue (light→dark), plus a trailing
 *  grayscale row. Deterministic, so the picker layout is stable. */
export function buildPaletteGrid(): RGBLike[][] {
  const rows = PALETTE_HUES.map((h) => PALETTE_STEPS.map((step) => hsvToRgb({ h, s: step.s, v: step.v })));
  const grays: RGBLike[] = [];
  for (let i = 0; i < PALETTE_STEPS.length; i++) {
    const v = 1 - i / (PALETTE_STEPS.length - 1);
    const c = Math.round(v * 255);
    grays.push({ r: c, g: c, b: c });
  }
  rows.push(grays);
  return rows;
}
