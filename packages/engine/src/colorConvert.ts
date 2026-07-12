/** Pure HSV ↔ RGB conversion — zero dependencies */

/**
 * Convert HSV to RGB.
 * @param h Hue in [0, 360)
 * @param s Saturation in [0, 1]
 * @param v Value in [0, 1]
 * @returns [r, g, b] each in [0, 255]
 */
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const hh = h / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = v - c;

  let r1: number, g1: number, b1: number;
  if (hh < 1)      { r1 = c; g1 = x; b1 = 0; }
  else if (hh < 2) { r1 = x; g1 = c; b1 = 0; }
  else if (hh < 3) { r1 = 0; g1 = c; b1 = x; }
  else if (hh < 4) { r1 = 0; g1 = x; b1 = c; }
  else if (hh < 5) { r1 = x; g1 = 0; b1 = c; }
  else             { r1 = c; g1 = 0; b1 = x; }

  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}

/**
 * Convert RGB to HSV.
 * @param r Red in [0, 255]
 * @param g Green in [0, 255]
 * @param b Blue in [0, 255]
 * @returns [h, s, v] where h in [0, 360), s in [0, 1], v in [0, 1]
 */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const d = max - min;

  let h: number;
  if (d === 0) {
    h = 0;
  } else if (max === rf) {
    h = 60 * (((gf - bf) / d) % 6);
    if (h < 0) h += 360;
  } else if (max === gf) {
    h = 60 * ((bf - rf) / d + 2);
  } else {
    h = 60 * ((rf - gf) / d + 4);
  }

  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

/**
 * Format an RGB triple as a 7-character hex string ("#RRGGBB", uppercase).
 * Channels outside [0, 255] are clamped.
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const toHex = (n: number) => clamp(n).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
