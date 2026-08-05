import { rgbToHsv, hsvToRgb, buildPaletteGrid, colorAlpha, isTranslucent, rgbCss, withAlpha } from '../logic/hsv';

describe('rgbToHsv / hsvToRgb', () => {
  test('round-trips primary colors', () => {
    for (const c of [
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 },
      { r: 0, g: 0, b: 255 },
      { r: 255, g: 255, b: 255 },
      { r: 0, g: 0, b: 0 },
      { r: 128, g: 64, b: 200 },
    ]) {
      const back = hsvToRgb(rgbToHsv(c));
      expect(back.r).toBeCloseTo(c.r, -0.5);
      expect(back.g).toBeCloseTo(c.g, -0.5);
      expect(back.b).toBeCloseTo(c.b, -0.5);
    }
  });

  test('known hue mappings', () => {
    expect(Math.round(rgbToHsv({ r: 255, g: 0, b: 0 }).h)).toBe(0);
    expect(Math.round(rgbToHsv({ r: 0, g: 255, b: 0 }).h)).toBe(120);
    expect(Math.round(rgbToHsv({ r: 0, g: 0, b: 255 }).h)).toBe(240);
    expect(rgbToHsv({ r: 80, g: 80, b: 80 }).s).toBe(0); // gray has no saturation
  });
});

describe('color alpha', () => {
  test('a missing alpha reads as fully opaque', () => {
    expect(colorAlpha({ r: 10, g: 20, b: 30 })).toBe(1);
    expect(isTranslucent({ r: 10, g: 20, b: 30 })).toBe(false);
  });

  test('alpha is clamped into 0…1, and garbage reads as opaque', () => {
    expect(colorAlpha({ r: 0, g: 0, b: 0, a: 0.4 })).toBe(0.4);
    expect(colorAlpha({ r: 0, g: 0, b: 0, a: -3 })).toBe(0);
    expect(colorAlpha({ r: 0, g: 0, b: 0, a: 8 })).toBe(1);
    expect(colorAlpha({ r: 0, g: 0, b: 0, a: NaN })).toBe(1);
  });

  test('isTranslucent is true only below full opacity', () => {
    expect(isTranslucent({ r: 0, g: 0, b: 0, a: 1 })).toBe(false);
    expect(isTranslucent({ r: 0, g: 0, b: 0, a: 0.999 })).toBe(true);
    expect(isTranslucent({ r: 0, g: 0, b: 0, a: 0 })).toBe(true);
  });

  test('withAlpha stores an alpha but drops it again at full opacity', () => {
    expect(withAlpha({ r: 1, g: 2, b: 3 }, 0.5)).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
    // Back to opaque leaves a plain {r,g,b} — no `a: 1` for hosts to diff on.
    expect(withAlpha({ r: 1, g: 2, b: 3, a: 0.5 }, 1)).toEqual({ r: 1, g: 2, b: 3 });
    expect('a' in withAlpha({ r: 1, g: 2, b: 3, a: 0.5 }, 1)).toBe(false);
  });

  test('withAlpha clamps and does not mutate its input', () => {
    const source = { r: 1, g: 2, b: 3, a: 0.5 };
    expect(withAlpha(source, 2)).toEqual({ r: 1, g: 2, b: 3 });
    expect(withAlpha(source, -1)).toEqual({ r: 1, g: 2, b: 3, a: 0 });
    expect(source.a).toBe(0.5);
  });

  test('withAlpha keeps only the color channels (no stray fields)', () => {
    expect(Object.keys(withAlpha({ r: 1, g: 2, b: 3, a: 0.25 }, 0.75)).sort())
      .toEqual(['a', 'b', 'g', 'r']);
  });
});

describe('rgbCss', () => {
  test('opaque colors stay rgb(...)', () => {
    expect(rgbCss({ r: 10, g: 20, b: 30 })).toBe('rgb(10, 20, 30)');
    expect(rgbCss({ r: 10, g: 20, b: 30, a: 1 })).toBe('rgb(10, 20, 30)');
  });

  test('a set opacity emits rgba(...), so every swatch and paint carries it', () => {
    expect(rgbCss({ r: 10, g: 20, b: 30, a: 0.5 })).toBe('rgba(10, 20, 30, 0.5)');
    expect(rgbCss({ r: 255, g: 0, b: 0, a: 0 })).toBe('rgba(255, 0, 0, 0)');
  });

  test('channels round and alpha is trimmed to 3 decimals', () => {
    expect(rgbCss({ r: 10.6, g: 20.4, b: 30.5, a: 1 / 3 })).toBe('rgba(11, 20, 31, 0.333)');
  });
});

describe('buildPaletteGrid', () => {
  test('returns hue rows plus a grayscale row, all valid RGB', () => {
    const grid = buildPaletteGrid();
    expect(grid.length).toBeGreaterThan(1);
    for (const row of grid) {
      expect(row.length).toBeGreaterThan(0);
      for (const c of row) {
        for (const ch of [c.r, c.g, c.b]) {
          expect(ch).toBeGreaterThanOrEqual(0);
          expect(ch).toBeLessThanOrEqual(255);
          expect(Number.isInteger(ch)).toBe(true);
        }
      }
    }
    const last = grid[grid.length - 1];
    // grayscale row: r === g === b
    expect(last.every((c) => c.r === c.g && c.g === c.b)).toBe(true);
  });

  test('every swatch is opaque — the grid picks hue, the slider picks opacity', () => {
    expect(buildPaletteGrid().flat().every((c) => colorAlpha(c) === 1)).toBe(true);
  });
});
