/**
 * What a shape with NO FILL casts.
 *
 * Every cast effect is the object's own silhouette, blurred. A filled shape's
 * silhouette is a slab and the blur barely dents it; an unfilled one's is its
 * OUTLINE — a hairline beside the blur these effects are authored with, which
 * spreads its ink over four times its width and leaves about a twentieth of
 * the opacity behind. "Adding a shadow does nothing", then "adding a glow does
 * nothing", were both true of exactly the shapes with no fill.
 *
 * One rule answers all three: cast from an outline no narrower than the blur
 * about to soften it. These pin that the floor is scaled to each effect's OWN
 * softness (so a tight glow stays tight beside a soft shadow), that the
 * authored spread still applies on top of it, and that an INNER glow — whose
 * spread erodes where the other two dilate — gets the floor as a separate
 * dilation of the silhouette it gathers inside.
 *
 * The companion at the other end: a node whose silhouette IS a solid must
 * come out byte for byte as it did before the rule existed.
 */

import {
  castSoftness, effectsFilterOutset, effectsToSvgFilter,
  outlineCastDilate, outlineCastSourceCells, outlineCastSpread,
} from '../paintSvg';
import { GlowEffect, ShadowEffect } from '../types';

/** The panel's own defaults — the numbers a first press of each + button
 *  puts on the object, so these are the case actually reported. */
const SHADOW: ShadowEffect = {
  dx: 0.75, dy: 0.875, blur: 1.125, spread: 0.125,
  color: { r: 0, g: 0, b: 0 }, alpha: 0.45,
};
const GLOW: GlowEffect = {
  radius: 1.125, spread: 0.125, color: { r: 255, g: 255, b: 255 }, alpha: 0.6,
};
/** The default vector stroke: the hairline the bug was about. */
const HAIRLINE = 0.3125;
/** SVG attributes are written at six decimals (paintSvg's `fmt`), so an
 *  expected radius has to be read back the same way. */
const attr = (n: number) => String(Number(n.toFixed(6)));

describe('the softness an effect carries, whichever field names it', () => {
  it('is a shadow’s blur and a glow’s radius', () => {
    // The one thing the rule reads about an effect — which is what lets a
    // single rule serve a shadow, an outer glow and an inner one.
    expect(castSoftness(SHADOW)).toBe(1.125);
    expect(castSoftness(GLOW)).toBe(1.125);
    expect(castSoftness({ ...GLOW, radius: 4 })).toBe(4);
  });
});

describe('the width an outline casts at', () => {
  it('a hairline casts at the effect’s own softness, not its own width', () => {
    // The ring is as wide as the blur, plus the authored spread either side.
    expect(outlineCastSourceCells(HAIRLINE, SHADOW)).toBeCloseTo(1.125 + 2 * 0.125, 9);
    // …and a glow, whose radius IS its blur, lands in exactly the same place:
    // the two effects share one rule and one number.
    expect(outlineCastSourceCells(HAIRLINE, GLOW))
      .toBeCloseTo(outlineCastSourceCells(HAIRLINE, SHADOW), 9);
  });

  it('a stroke already wider than its softness casts at its own width', () => {
    // The floor is a floor: a fat line is its own silhouette, and inflating
    // it would draw an effect the shape never had.
    expect(outlineCastSourceCells(3, { ...SHADOW, blur: 1 })).toBeCloseTo(3 + 2 * 0.125, 9);
    expect(outlineCastDilate(3, 1)).toBe(0);
  });

  it('a sharp effect is cast by the line itself', () => {
    // No blur to hide in, nothing to widen for.
    expect(outlineCastSourceCells(HAIRLINE, { ...SHADOW, blur: 0, spread: 0 }))
      .toBeCloseTo(HAIRLINE, 9);
    expect(outlineCastDilate(HAIRLINE, 0)).toBe(0);
  });

  it('a NEGATIVE spread never eats into the floor', () => {
    // Eroding a hairline erases it, and the rule is about being seen.
    expect(outlineCastSourceCells(HAIRLINE, { ...SHADOW, spread: -0.5 })).toBeCloseTo(1.125, 9);
    expect(outlineCastSourceCells(HAIRLINE, { ...GLOW, spread: -0.5 })).toBeCloseTo(1.125, 9);
  });

  it('…and the same rule, stated as the spread the export dilates by', () => {
    // The export has no second mechanism for the outward pair: it raises the
    // `feMorphology` radius the authored spread already goes through.
    for (const fx of [SHADOW, GLOW]) {
      expect(outlineCastSpread(HAIRLINE, fx))
        .toBeCloseTo((outlineCastSourceCells(HAIRLINE, fx) - HAIRLINE) / 2, 9);
    }
    // Which is the floor's own dilation with the authored spread on top.
    expect(outlineCastSpread(HAIRLINE, SHADOW))
      .toBeCloseTo(outlineCastDilate(HAIRLINE, 1.125) + 0.125, 9);
  });
});

describe('effectsToSvgFilter, given an outline to cast from', () => {
  it('an outer GLOW dilates the hairline before blurring it', () => {
    const { defs } = effectsToSvgFilter({ glow: GLOW }, 'fx', undefined, HAIRLINE);
    const r = attr(outlineCastSpread(HAIRLINE, GLOW));
    expect(defs).toContain(`<feMorphology in="SourceAlpha" operator="dilate" radius="${r}" result="glowSpread"/>`);
    // …and the blur reads the dilated silhouette, not the raw one.
    expect(defs).toContain('<feGaussianBlur in="glowSpread"');
  });

  it('a SHADOW does the same, through the primitive its spread already used', () => {
    const { defs } = effectsToSvgFilter({ shadow: SHADOW }, 'fx', undefined, HAIRLINE);
    const r = attr(outlineCastSpread(HAIRLINE, SHADOW));
    expect(defs).toContain(`<feMorphology in="SourceAlpha" operator="dilate" radius="${r}" result="shSpread"/>`);
    // feDropShadow has no spread, so the widened form is the long chain —
    // the same one an authored spread has always taken.
    expect(defs).not.toContain('feDropShadow');
  });

  it('an INNER glow gets an inside to gather in, and gathers inside THAT', () => {
    // A hairline has no interior at all, so the band had nowhere to be. The
    // floor dilates the silhouette first; the complement is taken of the
    // dilated one, and the band is clipped back to it rather than to the
    // hairline — clipping to the hairline would erase it again.
    const plain = { ...GLOW, spread: 0 };
    const { defs } = effectsToSvgFilter({ innerGlow: plain }, 'fx', undefined, HAIRLINE);
    const d = attr(outlineCastDilate(HAIRLINE, plain.radius));
    expect(defs).toContain(`<feMorphology in="SourceAlpha" operator="dilate" radius="${d}" result="innerSrc"/>`);
    expect(defs).toContain('<feComponentTransfer in="innerSrc" result="innerInv">');
    expect(defs).toContain('<feComposite in="innerBlur" in2="innerSrc" operator="in" result="innerMask"/>');
  });

  it('…and its own spread still erodes, off the widened silhouette', () => {
    // The two go opposite ways — the floor dilates, the spread erodes — so
    // they cannot be folded into one number the way the outward pair's are.
    const { defs } = effectsToSvgFilter(
      { innerGlow: { ...GLOW, spread: 0.25 } }, 'fx', undefined, HAIRLINE,
    );
    expect(defs).toContain('<feMorphology in="innerSrc" operator="erode" radius="0.25" result="innerSpread"/>');
    expect(defs).toContain('<feComponentTransfer in="innerSpread" result="innerInv">');
    // Still clipped to the silhouette the floor built, not to the eroded one:
    // eroding is what lets the band reach further IN, not what bounds it.
    expect(defs).toContain('in2="innerSrc"');
  });

  it('all three stack from one outline, each at its own softness', () => {
    // A tight glow beside a soft shadow stays tight: the floor is scaled per
    // effect, not once for the node.
    const tight: GlowEffect = { ...GLOW, radius: 0.4, spread: 0 };
    const { defs } = effectsToSvgFilter(
      { shadow: SHADOW, glow: tight, innerGlow: tight }, 'fx', undefined, HAIRLINE,
    );
    expect(defs).toContain('result="shSpread"');
    expect(defs).toContain(`radius="${attr(outlineCastSpread(HAIRLINE, tight))}" result="glowSpread"`);
    expect(defs).toContain(`radius="${attr(outlineCastDilate(HAIRLINE, 0.4))}" result="innerSrc"`);
    // …and the shadow's floor is bigger than the tight glow's, because its
    // blur is.
    expect(outlineCastSpread(HAIRLINE, SHADOW)).toBeGreaterThan(outlineCastSpread(HAIRLINE, tight));
  });

  it('the region grows with the floor, so the widened ring isn’t cropped', () => {
    const box = { x: 0, y: 0, width: 4, height: 4 };
    const solid = effectsToSvgFilter({ glow: GLOW }, 'fx', box);
    const outline = effectsToSvgFilter({ glow: GLOW }, 'fx', box, HAIRLINE);
    expect(outline.defs).not.toBe(solid.defs);
    const plain = effectsFilterOutset({ glow: GLOW });
    const wide = effectsFilterOutset({ glow: GLOW }, HAIRLINE);
    expect(wide.left).toBeCloseTo(plain.left + outlineCastDilate(HAIRLINE, GLOW.radius), 9);
    // An inner glow reaches nowhere either way — it is clipped to the
    // silhouette that casts it, dilated or not.
    expect(effectsFilterOutset({ innerGlow: GLOW }, HAIRLINE))
      .toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });
});

describe('a SOLID silhouette is left exactly as it was', () => {
  it('every effect comes out byte for byte without an outline width', () => {
    // The rule is for casters that are only a line. Passing no width is the
    // case every other node in the document is in, and it must not have
    // moved by a character.
    const fx = { shadow: SHADOW, glow: GLOW, innerGlow: GLOW };
    const box = { x: 0, y: 0, width: 4, height: 4 };
    expect(effectsToSvgFilter(fx, 'fx', box).defs)
      .toBe(effectsToSvgFilter(fx, 'fx', box, undefined).defs);
    expect(effectsFilterOutset(fx)).toEqual(effectsFilterOutset(fx, undefined));
  });

  it('a zero width is NOT the same as no width', () => {
    // A shape can carry a shadow with no stroke to cast it — the floor then
    // builds the whole ring out of nothing, which is the point.
    const { defs } = effectsToSvgFilter({ glow: GLOW }, 'fx', undefined, 0);
    expect(defs).toContain('operator="dilate"');
    expect(outlineCastSourceCells(0, GLOW)).toBeCloseTo(1.125 + 2 * 0.125, 9);
  });
});
