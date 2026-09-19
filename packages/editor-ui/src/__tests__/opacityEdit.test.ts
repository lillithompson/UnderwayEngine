import { readFileSync } from 'fs';
import { resolve } from 'path';
import { composeFade, fadeMix } from '../logic/opacityEdit';

// The Opacity page's Fade row is RELATIVE: it always opens at the left, on
// the object as it draws right now, and says how much FURTHER toward the
// target. composeFade turns that back into the absolute fade the scene
// stores.

describe('fadeMix', () => {
  const RED = { r: 200, g: 40, b: 40 };
  const WHITE = { r: 255, g: 255, b: 255 };

  it('is the ends at the ends', () => {
    expect(fadeMix(RED, WHITE, 0)).toEqual(RED);
    expect(fadeMix(RED, WHITE, 1)).toEqual(WHITE);
  });

  it('rounds to whole channels, as every colour in a scene is', () => {
    const half = fadeMix(RED, WHITE, 0.5);
    expect(half).toEqual({ r: 228, g: 148, b: 148 });
    expect(Object.values(half).every(Number.isInteger)).toBe(true);
  });

  it('clamps, so a slider that overshoots still names a colour', () => {
    expect(fadeMix(RED, WHITE, 2)).toEqual(WHITE);
    expect(fadeMix(RED, WHITE, -1)).toEqual(RED);
    expect(fadeMix(RED, WHITE, Number.NaN)).toEqual(RED);
  });

  it('matches the engine fade the render actually performs', () => {
    // engine/fade.ts's fadeRgb, restated here because the package stays
    // engine-import-free: same mix, same rounding. If they drifted the
    // slider would promise a colour the render does not produce.
    const fadeRgb = (c: typeof RED, t: number, target: typeof RED) => {
      const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
      return { r: mix(c.r, target.r), g: mix(c.g, target.g), b: mix(c.b, target.b) };
    };
    for (const t of [0.1, 0.33, 0.5, 0.77, 0.9]) {
      expect(fadeMix(RED, WHITE, t)).toEqual(fadeRgb(RED, t, WHITE));
    }
  });
});

describe('composeFade', () => {
  it('a fade from an unfaded object is the fade itself', () => {
    expect(composeFade(0, 0)).toBe(0);
    expect(composeFade(0, 0.4)).toBeCloseTo(0.4, 10);
    expect(composeFade(0, 1)).toBe(1);
  });

  it('the left end costs nothing — which is what makes the re-base free', () => {
    // Open the page over a standing fade and let go without dragging: the
    // object must be exactly where it was, or merely looking at the page
    // would change the drawing.
    for (const base of [0, 0.15, 0.5, 0.8, 1]) expect(composeFade(base, 0)).toBeCloseTo(base, 10);
  });

  it('the right end is the target, from wherever the object stands', () => {
    for (const base of [0, 0.3, 0.9]) expect(composeFade(base, 1)).toBe(1);
  });

  it('composes exactly as the mix it stands for', () => {
    // mix(mix(c, T, base), T, t) = mix(c, T, composeFade(base, t)). Checked
    // against the arithmetic itself on one channel: 0 walking toward 255.
    const mix = (a: number, b: number, k: number) => a + (b - a) * k;
    for (const base of [0.2, 0.5, 0.75]) {
      for (const t of [0, 0.25, 0.6, 1]) {
        const twice = mix(mix(0, 255, base), 255, t);
        expect(mix(0, 255, composeFade(base, t))).toBeCloseTo(twice, 10);
      }
    }
  });

  it('an object already AT the target has nowhere further to walk', () => {
    expect(composeFade(1, 0.5)).toBe(1);
  });

  it('clamps both ends, so the answer is always a fade the scene can hold', () => {
    expect(composeFade(-1, 0.5)).toBeCloseTo(0.5, 10);
    expect(composeFade(0.5, 2)).toBe(1);
    expect(composeFade(0.5, -2)).toBeCloseTo(0.5, 10);
    expect(composeFade(Number.NaN, 0.5)).toBeCloseTo(0.5, 10);
    expect(composeFade(0.5, Number.NaN)).toBeCloseTo(0.5, 10);
  });

  it('the panel composes through this helper, not by hand', () => {
    const panel = readFileSync(
      resolve(__dirname, '..', 'components', 'ObjectPropertiesPanel.tsx'), 'utf8',
    );
    expect(panel).toContain("import { composeFade, fadeMix } from '../logic/opacityEdit';");
    expect(panel).toContain(
      'model.onObjectOpacity?.({ ...o, fade: composeFade(fadeBaseRef.current, o.fade) }, committed);',
    );
  });
});
