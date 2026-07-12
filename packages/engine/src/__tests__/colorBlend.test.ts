import { blendColor, colorsEqual, gaussianFalloff, recolorPixel } from '@/engine/colorBlend';
import type { BlendMode, RGBColor } from '@/engine/types';

const rgb = (r: number, g: number, b: number): RGBColor => ({ r, g, b });

describe('blendColor', () => {
  const red = rgb(255, 0, 0);
  const green = rgb(0, 255, 0);
  const blue = rgb(0, 0, 255);
  const white = rgb(255, 255, 255);
  const black = rgb(0, 0, 0);
  const mid = rgb(128, 128, 128);

  describe('opacity', () => {
    it('opacity 0 returns base unchanged regardless of mode', () => {
      expect(blendColor(red, blue, 'normal', 0)).toEqual(red);
      expect(blendColor(red, blue, 'multiply', 0)).toEqual(red);
      expect(blendColor(red, blue, 'dodge', 0)).toEqual(red);
      expect(blendColor(red, blue, 'lighten', 0)).toEqual(red);
    });

    it('opacity 1 returns fully-blended result', () => {
      expect(blendColor(red, blue, 'normal', 1)).toEqual(blue);
    });

    it('opacity 0.5 lerps halfway from base to blended', () => {
      // normal mode: out = lerp(red, blue, 0.5) = (128, 0, 128) (rounded)
      const out = blendColor(red, blue, 'normal', 0.5);
      expect(out).toEqual(rgb(128, 0, 128));
    });

    it('clamps opacity > 1 to 1', () => {
      expect(blendColor(red, blue, 'normal', 5)).toEqual(blue);
    });

    it('clamps opacity < 0 to 0', () => {
      expect(blendColor(red, blue, 'normal', -1)).toEqual(red);
    });
  });

  describe('normal mode', () => {
    it('replaces base with brush', () => {
      expect(blendColor(red, green, 'normal', 1)).toEqual(green);
    });
  });

  describe('multiply mode', () => {
    it('white brush leaves base unchanged', () => {
      expect(blendColor(red, white, 'multiply', 1)).toEqual(red);
    });

    it('black brush produces black', () => {
      expect(blendColor(red, black, 'multiply', 1)).toEqual(black);
    });

    it('mid-gray brush halves base channels', () => {
      // 255 * 128 / 255 ≈ 128
      expect(blendColor(red, mid, 'multiply', 1)).toEqual(rgb(128, 0, 0));
    });
  });

  describe('dodge mode', () => {
    it('black brush returns base unchanged', () => {
      expect(blendColor(red, black, 'dodge', 1)).toEqual(red);
    });

    it('white brush saturates to white per channel where base > 0', () => {
      // any base channel / (1 - 1) → infinity → clamp to 255
      const out = blendColor(rgb(64, 0, 0), white, 'dodge', 1);
      expect(out.r).toBe(255);
      // base channels of 0 stay 0 even at full dodge (0 / x = 0)
      // but our impl short-circuits brush=255 to 255 for all channels
      expect(out.g).toBe(255);
      expect(out.b).toBe(255);
    });

    it('mid-gray brush brightens base by ~2x', () => {
      // base=64 brush=128: 64 / (1 - 128/255) ≈ 64 / 0.498 ≈ 128.5 → 128
      const out = blendColor(rgb(64, 0, 0), mid, 'dodge', 1);
      expect(out.r).toBeGreaterThanOrEqual(127);
      expect(out.r).toBeLessThanOrEqual(129);
    });
  });

  describe('lighten mode', () => {
    it('takes the max of base and brush per channel', () => {
      expect(blendColor(rgb(100, 200, 50), rgb(150, 100, 50), 'lighten', 1)).toEqual(rgb(150, 200, 50));
    });

    it('black brush leaves base unchanged', () => {
      expect(blendColor(red, black, 'lighten', 1)).toEqual(red);
    });

    it('white brush saturates to white', () => {
      expect(blendColor(red, white, 'lighten', 1)).toEqual(white);
    });
  });

  describe('darken mode', () => {
    it('takes the min of base and brush per channel', () => {
      expect(blendColor(rgb(100, 200, 50), rgb(150, 100, 50), 'darken', 1)).toEqual(rgb(100, 100, 50));
    });

    it('white brush leaves base unchanged', () => {
      expect(blendColor(red, white, 'darken', 1)).toEqual(red);
    });

    it('black brush produces black', () => {
      expect(blendColor(red, black, 'darken', 1)).toEqual(black);
    });
  });

  describe('burn mode', () => {
    it('white brush leaves base unchanged', () => {
      expect(blendColor(rgb(192, 128, 64), white, 'burn', 1)).toEqual(rgb(192, 128, 64));
    });

    it('black brush produces black', () => {
      expect(blendColor(red, black, 'burn', 1)).toEqual(black);
    });

    it('mid-gray brush darkens base', () => {
      // base=192 brush=128: 1 - (1 - 192/255) / (128/255) = 1 - 0.247/0.502 ≈ 0.508 → 130
      const out = blendColor(rgb(192, 0, 0), mid, 'burn', 1);
      expect(out.r).toBeGreaterThanOrEqual(128);
      expect(out.r).toBeLessThanOrEqual(131);
      // base=0 in burn: 1 - 1/0.5 = -1 → clamp to 0
      expect(out.g).toBe(0);
      expect(out.b).toBe(0);
    });

    it('is the inverse of dodge for inverted-base/brush pairs', () => {
      // Color-burn(base, brush) = 1 - dodge(1 - base, 1 - brush) by spec.
      const base = rgb(180, 90, 30);
      const brush = rgb(60, 150, 200);
      const burn = blendColor(base, brush, 'burn', 1);
      const invBase = rgb(255 - base.r, 255 - base.g, 255 - base.b);
      const invBrush = rgb(255 - brush.r, 255 - brush.g, 255 - brush.b);
      const dodge = blendColor(invBase, invBrush, 'dodge', 1);
      // Allow off-by-one from independent rounding in each pipeline.
      expect(Math.abs((255 - dodge.r) - burn.r)).toBeLessThanOrEqual(1);
      expect(Math.abs((255 - dodge.g) - burn.g)).toBeLessThanOrEqual(1);
      expect(Math.abs((255 - dodge.b) - burn.b)).toBeLessThanOrEqual(1);
    });
  });

  describe('invert mode', () => {
    it('flips RGB to complement; brush color is ignored', () => {
      expect(blendColor(rgb(255, 128, 0), red, 'invert', 1)).toEqual(rgb(0, 127, 255));
      expect(blendColor(rgb(255, 128, 0), blue, 'invert', 1)).toEqual(rgb(0, 127, 255));
    });

    it('opacity 0.5 lerps halfway toward complement', () => {
      // base=(200,100,50), invert=(55,155,205); halfway = (128, 128, 128) (rounded)
      expect(blendColor(rgb(200, 100, 50), red, 'invert', 0.5)).toEqual(rgb(128, 128, 128));
    });

    it('inverting twice returns to base', () => {
      const base = rgb(180, 90, 30);
      const once = blendColor(base, white, 'invert', 1);
      const twice = blendColor(once, white, 'invert', 1);
      expect(twice).toEqual(base);
    });
  });

  describe('rotate mode', () => {
    it('rotates hue by +30 degrees; brush color is ignored', () => {
      // Pure red (h=0) → h=30 (orange). hsvToRgb(30, 1, 1) = (255, 128, 0) (rounded).
      expect(blendColor(red, blue, 'rotate', 1)).toEqual(rgb(255, 128, 0));
    });

    it('preserves saturation and value', () => {
      const base = rgb(128, 64, 64); // muted red
      const out = blendColor(base, white, 'rotate', 1);
      // Roundtripping through HSV at 30° step shouldn't change brightness/sat much.
      const maxIn = Math.max(base.r, base.g, base.b);
      const maxOut = Math.max(out.r, out.g, out.b);
      expect(Math.abs(maxOut - maxIn)).toBeLessThanOrEqual(1);
    });

    it('grayscale base stays grayscale (no hue to rotate)', () => {
      const gray = rgb(96, 96, 96);
      expect(blendColor(gray, red, 'rotate', 1)).toEqual(gray);
    });

    it('opacity 0 returns base unchanged (no rotation)', () => {
      expect(blendColor(red, blue, 'rotate', 0)).toEqual(red);
      expect(blendColor(rgb(200, 100, 50), white, 'rotate', 0)).toEqual(rgb(200, 100, 50));
    });

    it('opacity scales the rotation angle (15° at opacity 0.5)', () => {
      // Pure red (h=0) at opacity 0.5 → h=15. hsvToRgb(15, 1, 1) = (255, 64, 0) (rounded).
      expect(blendColor(red, blue, 'rotate', 0.5)).toEqual(rgb(255, 64, 0));
    });

    it('twelve rotations cycle back near the starting hue', () => {
      let cur: RGBColor = red;
      for (let i = 0; i < 12; i++) cur = blendColor(cur, white, 'rotate', 1);
      // Each HSV roundtrip can drift by ~1/channel from rounding; allow
      // cumulative drift across 12 steps.
      expect(Math.abs(cur.r - red.r)).toBeLessThanOrEqual(8);
      expect(Math.abs(cur.g - red.g)).toBeLessThanOrEqual(8);
      expect(Math.abs(cur.b - red.b)).toBeLessThanOrEqual(8);
    });
  });

  describe('randomize mode', () => {
    it('opacity 0 returns base unchanged', () => {
      expect(blendColor(red, blue, 'randomize', 0)).toEqual(red);
      expect(blendColor(mid, green, 'randomize', 0)).toEqual(mid);
    });

    it('opacity 1 produces a fully random color (ignores brush)', () => {
      // Mock Math.random to return deterministic values.
      const spy = jest.spyOn(Math, 'random')
        .mockReturnValueOnce(0.5)   // r = 128
        .mockReturnValueOnce(0.25)  // g = 64
        .mockReturnValueOnce(0.75); // b = 192
      const out = blendColor(red, blue, 'randomize', 1);
      expect(out).toEqual(rgb(128, 64, 192));
      spy.mockRestore();
    });

    it('opacity 0.5 lerps halfway from base to random color', () => {
      const spy = jest.spyOn(Math, 'random')
        .mockReturnValueOnce(0)     // r = 0
        .mockReturnValueOnce(1 - 1/256) // g = 255
        .mockReturnValueOnce(0.5);  // b = 128
      // base = (255, 0, 0), random = (0, 255, 128)
      // lerp at 0.5: (128, 128, 64)
      const out = blendColor(red, white, 'randomize', 0.5);
      expect(out).toEqual(rgb(128, 128, 64));
      spy.mockRestore();
    });

    it('produces valid 0-255 integer channels', () => {
      for (let i = 0; i < 20; i++) {
        const out = blendColor(mid, red, 'randomize', 1);
        expect(out.r).toBeGreaterThanOrEqual(0);
        expect(out.r).toBeLessThanOrEqual(255);
        expect(out.g).toBeGreaterThanOrEqual(0);
        expect(out.g).toBeLessThanOrEqual(255);
        expect(out.b).toBeGreaterThanOrEqual(0);
        expect(out.b).toBeLessThanOrEqual(255);
        expect(Number.isInteger(out.r)).toBe(true);
        expect(Number.isInteger(out.g)).toBe(true);
        expect(Number.isInteger(out.b)).toBe(true);
      }
    });
  });

  describe('hue mode', () => {
    it('replaces base hue with brush hue; keeps base S and V', () => {
      // Red base (h=0, s=1, v=1) + green brush (h=120) → HSV(120, 1, 1) = green.
      expect(blendColor(red, green, 'hue', 1)).toEqual(green);
    });

    it('preserves base value when shifting to brush hue', () => {
      // Dark red (h=0, s=1, v≈0.502) + blue brush (h=240) → HSV(240, 1, 0.502).
      const darkRed = rgb(128, 0, 0);
      expect(blendColor(darkRed, blue, 'hue', 1)).toEqual(rgb(0, 0, 128));
    });

    it('grayscale base (s=0) stays grayscale regardless of brush hue', () => {
      // s=0 collapses the brush hue: HSV(any, 0, v) = grayscale at v.
      expect(blendColor(mid, red, 'hue', 1)).toEqual(mid);
      expect(blendColor(mid, blue, 'hue', 1)).toEqual(mid);
    });

    it('opacity 0 returns base unchanged', () => {
      expect(blendColor(red, blue, 'hue', 0)).toEqual(red);
    });

    it('identity (brush hue equals base hue) leaves base unchanged at full opacity', () => {
      expect(blendColor(red, red, 'hue', 1)).toEqual(red);
    });
  });

  describe('color mode', () => {
    it('overlays brush hue+saturation while keeping base value', () => {
      // Mid-gray (s=0, v≈0.502) + saturated red brush → HSV(0, 1, 0.502) = (128,0,0).
      expect(blendColor(mid, red, 'color', 1)).toEqual(rgb(128, 0, 0));
    });

    it('black base stays black (v=0 swallows any hue/sat)', () => {
      expect(blendColor(black, red, 'color', 1)).toEqual(black);
      expect(blendColor(black, blue, 'color', 1)).toEqual(black);
    });

    it('opacity 0 returns base unchanged', () => {
      expect(blendColor(red, blue, 'color', 0)).toEqual(red);
    });

    it('opacity 0.5 lerps halfway from base to fully-tinted result', () => {
      // base=mid-gray (128,128,128), full color w/ red = (128,0,0); halfway = (128,64,64).
      expect(blendColor(mid, red, 'color', 0.5)).toEqual(rgb(128, 64, 64));
    });

    it('desaturated brush (s=0) strips base color toward gray at base value', () => {
      // White brush has s=0, so result = HSV(any, 0, v_base) = grayscale at base value.
      expect(blendColor(red, white, 'color', 1)).toEqual(rgb(255, 255, 255));
    });
  });
});

describe('recolorPixel', () => {
  const red = rgb(255, 0, 0);
  const blue = rgb(0, 0, 255);
  const white = rgb(255, 255, 255);
  const black = rgb(0, 0, 0);

  it('white base becomes exactly the tint', () => {
    expect(recolorPixel(white, red)).toEqual(red);
    expect(recolorPixel(white, blue)).toEqual(blue);
  });

  it('black base stays black regardless of tint', () => {
    expect(recolorPixel(black, red)).toEqual(black);
    expect(recolorPixel(black, blue)).toEqual(black);
  });

  it('any base tinted with white is left at base luminance', () => {
    // White tint preserves base color: r = base·(1−L) + 255·L. For pure
    // primaries that becomes (255, 255·L, 255·L) for red, etc. — locks in
    // the Rec. 709 weights via the green/blue lift.
    expect(recolorPixel(red, white)).toEqual(rgb(255, 54, 54));   // L(red)   ≈ 0.2126
    expect(recolorPixel(rgb(0, 255, 0), white)).toEqual(rgb(182, 255, 182)); // L(green) ≈ 0.7152
    expect(recolorPixel(blue, white)).toEqual(rgb(18, 18, 255));  // L(blue)  ≈ 0.0722
  });

  it('mid-gray tinted shifts halfway toward tint', () => {
    // L(0.5 gray) ≈ 0.5; output ≈ lerp(gray, tint, 0.5).
    expect(recolorPixel(rgb(128, 128, 128), red)).toEqual(rgb(192, 64, 64));
  });

  it('identity tint (base = tint) leaves base unchanged', () => {
    expect(recolorPixel(red, red)).toEqual(red);
    expect(recolorPixel(blue, blue)).toEqual(blue);
  });
});

describe('gaussianFalloff', () => {
  it('returns 1 at the brush center', () => {
    expect(gaussianFalloff(0)).toBeCloseTo(1);
  });

  it('clamps to 1 for negative tSq inputs', () => {
    expect(gaussianFalloff(-0.5)).toBe(1);
  });

  it('returns exactly 0 at the brush edge', () => {
    expect(gaussianFalloff(1)).toBe(0);
  });

  it('clamps to 0 for tSq beyond the edge', () => {
    expect(gaussianFalloff(1.5)).toBe(0);
    expect(gaussianFalloff(100)).toBe(0);
  });

  it('is monotonically decreasing across [0, 1]', () => {
    let prev = gaussianFalloff(0);
    for (let i = 1; i <= 20; i++) {
      const v = gaussianFalloff(i / 20);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });

  it('falls below 0.5 by halfway through the brush', () => {
    // Gaussian (not linear) means the value at tSq=0.5 should be smaller
    // than the linear interpolation 0.5 — the brush is rounder than
    // pyramidal.
    const halfway = gaussianFalloff(0.5);
    expect(halfway).toBeGreaterThan(0);
    expect(halfway).toBeLessThan(0.5);
  });
});

describe('colorsEqual', () => {
  it('returns true for identical colors', () => {
    expect(colorsEqual(rgb(255, 0, 0), rgb(255, 0, 0))).toBe(true);
    expect(colorsEqual(rgb(0, 0, 0), rgb(0, 0, 0))).toBe(true);
    expect(colorsEqual(rgb(128, 64, 32), rgb(128, 64, 32))).toBe(true);
  });

  it('returns false when any channel differs', () => {
    expect(colorsEqual(rgb(255, 0, 0), rgb(254, 0, 0))).toBe(false);
    expect(colorsEqual(rgb(0, 255, 0), rgb(0, 254, 0))).toBe(false);
    expect(colorsEqual(rgb(0, 0, 255), rgb(0, 0, 254))).toBe(false);
  });
});

describe('identity blend mode invariant', () => {
  // Verifies the mathematical basis for skipping figure expansion when the
  // brush color matches the existing tint: blendColor(c, c, mode, opacity)
  // must equal c for all identity modes at any opacity.
  const colors: RGBColor[] = [
    rgb(255, 0, 0), rgb(0, 128, 255), rgb(0, 0, 0), rgb(255, 255, 255), rgb(42, 99, 173),
  ];
  const identityModes: BlendMode[] = ['normal', 'lighten', 'darken'];
  const opacities = [0, 0.25, 0.5, 0.75, 1];

  for (const mode of identityModes) {
    for (const c of colors) {
      for (const op of opacities) {
        it(`${mode} mode: blendColor(${JSON.stringify(c)}, same, ${op}) === base`, () => {
          expect(blendColor(c, c, mode, op)).toEqual(c);
        });
      }
    }
  }

  it('multiply is NOT identity for mid-gray', () => {
    const mid = rgb(128, 128, 128);
    expect(blendColor(mid, mid, 'multiply', 1)).not.toEqual(mid);
  });
});
