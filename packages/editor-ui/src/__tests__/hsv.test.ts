import { readFileSync } from 'fs';
import { resolve } from 'path';
import { rgbToHsv, hsvToRgb, buildPaletteGrid, colorAlpha, isTranslucent, rgbCss, withAlpha,
  hueRampColors,
  hueSliderSV,
  withHue,
} from '../logic/hsv';

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

describe('the hue row’s own arithmetic (ColorSliderRow)', () => {
  it('the ramp is the wheel: red round to red, at full strength by default', () => {
    const ramp = hueRampColors();
    expect(ramp).toHaveLength(7);
    expect(ramp[0]).toBe(ramp[6]);
    for (const css of ramp) expect(css).toMatch(/^rgb/);
    expect(rgbToHsv(hsvToRgb({ h: 0, s: 1, v: 1 }))).toMatchObject({ s: 1, v: 1 });
  });

  // The track promised a vivid hue and the slider wrote a dusty one: it was
  // a full-strength wheel whatever the colour was, while withHue keeps the
  // colour's own saturation and value.
  it('the ramp is drawn at the saturation and value it is given', () => {
    const ramp = hueRampColors(0.4, 0.6);
    expect(ramp).toHaveLength(7);
    for (const css of ramp) {
      const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(css)!;
      const hsv = rgbToHsv({ r: +m[1], g: +m[2], b: +m[3] });
      expect(hsv.s).toBeCloseTo(0.4, 1);
      expect(hsv.v).toBeCloseTo(0.6, 1);
    }
  });

  it('the stop under the thumb IS the colour the thumb writes', () => {
    // The whole point: track and result read off ONE rule (hueSliderSV).
    for (const c of [
      hsvToRgb({ h: 20, s: 0.4, v: 0.6 }),   // muted
      hsvToRgb({ h: 200, s: 1, v: 0.25 }),   // dark
      { r: 128, g: 128, b: 128 },            // grey — no hue to move
      { r: 0, g: 0, b: 0 },                  // black
    ]) {
      const { s, v } = hueSliderSV(c);
      const ramp = hueRampColors(s, v);
      // The ramp's 240° stop (index 4) against what the slider writes there.
      const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(ramp[4])!;
      const stop = { r: +m[1], g: +m[2], b: +m[3] };
      expect(withHue(c, 240)).toMatchObject(stop);
    }
  });

  it('hueSliderSV gives a grey and a black full strength, so their tracks are not flat', () => {
    // Without the substitution a black swatch would show a black track
    // under a slider that writes vivid hues.
    // Black has neither: both are substituted.
    expect(hueSliderSV({ r: 0, g: 0, b: 0 })).toEqual({ s: 1, v: 1 });
    // A grey has no saturation but a real brightness, and KEEPS it — the
    // track for mid-grey is a half-bright rainbow, which is exactly what
    // the slider writes there.
    expect(hueSliderSV({ r: 128, g: 128, b: 128 }).s).toBe(1);
    expect(hueSliderSV({ r: 128, g: 128, b: 128 }).v).toBeCloseTo(0.5, 2);
    expect(hueSliderSV({ r: 255, g: 255, b: 255 })).toEqual({ s: 1, v: 1 });
    // …and leaves a real colour alone.
    const sv = hueSliderSV(hsvToRgb({ h: 20, s: 0.4, v: 0.6 }));
    expect(sv.s).toBeCloseTo(0.4, 2);
    expect(sv.v).toBeCloseTo(0.6, 2);
  });

  it('the row memoizes the ramp on those two numbers, not on the colour object', () => {
    const eb = readFileSync(resolve(__dirname, '..', 'components', 'effectBar.tsx'), 'utf8');
    expect(eb).toContain('const { s: rampS, v: rampV } = hueSliderSV(color);');
    expect(eb).toContain('const ramp = useMemo(() => hueRampColors(rampS, rampV), [rampS, rampV]);');
  });

  it('withHue moves only the hue, keeping how saturated and how bright', () => {
    const muted = hsvToRgb({ h: 20, s: 0.4, v: 0.6 });
    const moved = rgbToHsv(withHue(muted, 200));
    expect(moved.h).toBeCloseTo(200, 0);
    expect(moved.s).toBeCloseTo(0.4, 2);
    expect(moved.v).toBeCloseTo(0.6, 2);
  });

  it('gives a grey a hue to move — sliding off grey walks into colour', () => {
    // s and v of 0 have no hue to turn: the row would sit inert on black.
    expect(rgbToHsv(withHue({ r: 128, g: 128, b: 128 }, 120)).h).toBeCloseTo(120, 0);
    expect(rgbToHsv(withHue({ r: 0, g: 0, b: 0 }, 240)).h).toBeCloseTo(240, 0);
  });

  it('keeps an alpha the colour came with', () => {
    expect(withHue({ r: 200, g: 40, b: 40, a: 0.5 }, 120).a).toBe(0.5);
    expect(withHue({ r: 200, g: 40, b: 40 }, 120).a).toBeUndefined();
  });
});
