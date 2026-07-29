import { rgbToHsv, hsvToRgb, buildPaletteGrid } from '../logic/hsv';

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
});
