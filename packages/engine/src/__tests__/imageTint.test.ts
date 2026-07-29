/**
 * Reference tint math (imageTint.ts). This is the implementation the GPU
 * path and the SVG export matrix must match, so the expected values here
 * are computed by hand from the documented per-mode formulas.
 */

import { applyImageTint, luminance } from '../imageTint';
import { ImageTint, RGBColor } from '../types';

const TINT_COLOR: RGBColor = { r: 200, g: 100, b: 50 };
const WHITE: RGBColor = { r: 255, g: 255, b: 255 };
const BLACK: RGBColor = { r: 0, g: 0, b: 0 };
const GRAY: RGBColor = { r: 128, g: 128, b: 128 };

const tint = (mode: ImageTint['mode'], amount: number): ImageTint =>
  ({ color: TINT_COLOR, amount, mode });

describe('luminance', () => {
  test('uses Rec. 709 weights in the 0-255 range', () => {
    expect(luminance({ r: 255, g: 0, b: 0 })).toBeCloseTo(0.2126 * 255, 10);
    expect(luminance({ r: 0, g: 255, b: 0 })).toBeCloseTo(0.7152 * 255, 10);
    expect(luminance({ r: 0, g: 0, b: 255 })).toBeCloseTo(0.0722 * 255, 10);
  });

  test('weights sum to 1: white maps to 255, gray to itself', () => {
    expect(luminance(WHITE)).toBeCloseTo(255, 10);
    expect(luminance(GRAY)).toBeCloseTo(128, 10);
  });
});

describe.each(['tint', 'duotone', 'wash'] as const)('applyImageTint %s', (mode) => {
  test('amount 0 is the identity', () => {
    const base: RGBColor = { r: 10, g: 200, b: 37 };
    expect(applyImageTint(base, tint(mode, 0))).toEqual(base);
  });

  test('negative amount clamps to identity', () => {
    const base: RGBColor = { r: 91, g: 12, b: 240 };
    expect(applyImageTint(base, tint(mode, -1))).toEqual(base);
  });

  test('amount > 1 clamps to the full effect', () => {
    const base: RGBColor = { r: 40, g: 90, b: 220 };
    expect(applyImageTint(base, tint(mode, 5)))
      .toEqual(applyImageTint(base, tint(mode, 1)));
  });

  test('channels are rounded to integers and clamped to 0..255', () => {
    for (const base of [BLACK, GRAY, WHITE, { r: 3, g: 254, b: 128 }]) {
      for (const amount of [0, 0.25, 0.5, 0.99, 1]) {
        const out = applyImageTint(base, tint(mode, amount));
        for (const ch of [out.r, out.g, out.b]) {
          expect(Number.isInteger(ch)).toBe(true);
          expect(ch).toBeGreaterThanOrEqual(0);
          expect(ch).toBeLessThanOrEqual(255);
        }
      }
    }
  });
});

describe('tint mode known values', () => {
  test('white base at amount 1 becomes exactly the tint color', () => {
    // luminance(white) = 255, so target = tintColor exactly.
    expect(applyImageTint(WHITE, tint('tint', 1))).toEqual(TINT_COLOR);
  });

  test('gray base at amount 1 scales the tint by luminance', () => {
    // luminance(128-gray) = 128; target = 128 * color / 255, rounded.
    expect(applyImageTint(GRAY, tint('tint', 1))).toEqual({
      r: Math.round((128 * 200) / 255), // 100
      g: Math.round((128 * 100) / 255), // 50
      b: Math.round((128 * 50) / 255),  // 25
    });
  });

  test('black base stays black at any amount', () => {
    expect(applyImageTint(BLACK, tint('tint', 1))).toEqual(BLACK);
    expect(applyImageTint(BLACK, tint('tint', 0.5))).toEqual(BLACK);
  });

  test('partial amount lerps base toward the target', () => {
    // White base, amount 0.5: 255 + (target - 255) * 0.5 per channel.
    expect(applyImageTint(WHITE, tint('tint', 0.5))).toEqual({
      r: Math.round(255 + (200 - 255) * 0.5), // 228
      g: Math.round(255 + (100 - 255) * 0.5), // 178
      b: Math.round(255 + (50 - 255) * 0.5),  // 153
    });
  });
});

describe('duotone mode', () => {
  test('is numerically identical to tint with the current black endpoint', () => {
    // Documented: mix(black, tintColor, lum/255) === lum * tintColor / 255.
    const bases: RGBColor[] = [
      BLACK, GRAY, WHITE,
      { r: 12, g: 240, b: 99 },
      { r: 200, g: 30, b: 128 },
    ];
    for (const base of bases) {
      for (const amount of [0.3, 0.7, 1]) {
        expect(applyImageTint(base, tint('duotone', amount)))
          .toEqual(applyImageTint(base, tint('tint', amount)));
      }
    }
  });
});

describe('wash mode', () => {
  // Overlay = mix(tintColor, white, 0.5), rounded per blendColor:
  // (round(227.5), round(177.5), round(152.5)) = (228, 178, 153).
  const OVERLAY: RGBColor = { r: 228, g: 178, b: 153 };

  test('amount 1 replaces every base with the constant overlay', () => {
    expect(applyImageTint(BLACK, tint('wash', 1))).toEqual(OVERLAY);
    expect(applyImageTint(WHITE, tint('wash', 1))).toEqual(OVERLAY);
    expect(applyImageTint({ r: 37, g: 99, b: 250 }, tint('wash', 1))).toEqual(OVERLAY);
  });

  test('partial amount lerps toward the overlay', () => {
    expect(applyImageTint(BLACK, tint('wash', 0.5))).toEqual({
      r: Math.round(OVERLAY.r * 0.5), // 114
      g: Math.round(OVERLAY.g * 0.5), // 89
      b: Math.round(OVERLAY.b * 0.5), // 77 (76.5 rounds up)
    });
  });
});
