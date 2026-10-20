import {
  effectsBoxShadow,
  innerGlowSvgFilter,
  shadowGlowBoxShadow,
  shadowGlowDropShadow,
  textShadowCss,
  textShadowFilter,
  worldOffsetInNodeFrame,
} from '../effectsBoxShadow';
import { BLUR_SIGMA_PER_RADIUS } from '@/engine/paintSvg';
import { castSoftness, effectsToSvgFilter, outlineCastSourceCells, outlineCastSpread } from '@/engine/paintSvg';
import { GlowEffect, NodeEffects, ShadowEffect } from '@/engine/types';

// effectsBoxShadow builds the CSS box-shadow approximation of a NodeEffects
// block (shadow / glow / border). This is what the editor uses to render a
// node's — and, since the frame fix, a FRAME's — shadow + border visibly (the
// frame routes its effects to its boundary rect; the CanvasSurface clip wrapper
// carries the resulting box-shadow so it isn't cropped at the frame edge).
// px = BASE_CELL_PX = 16, so world-cell magnitudes are ×16 here.

describe('effectsBoxShadow', () => {
  test('undefined / empty effects produce no shadow', () => {
    expect(effectsBoxShadow(undefined)).toBeUndefined();
    expect(effectsBoxShadow({})).toBeUndefined();
  });

  test('a drop shadow maps dx/dy/blur/spread to px and carries alpha', () => {
    const effects: NodeEffects = {
      shadow: { dx: 0.5, dy: 1, blur: 2, spread: 0.25, color: { r: 0, g: 0, b: 0 }, alpha: 0.4 },
    };
    expect(effectsBoxShadow(effects)).toBe('8px 16px 32px 4px rgba(0, 0, 0, 0.4)');
  });

  test('a border becomes a solid outset ring (0 0 0 width) in an opaque color', () => {
    const effects: NodeEffects = {
      border: { width: 0.375, position: 'center', dash: 0, color: { r: 214, g: 40, b: 40 } },
    };
    expect(effectsBoxShadow(effects)).toBe('0 0 0 6px rgb(214, 40, 40)');
  });

  test('shadow + border combine into one comma-joined box-shadow', () => {
    const effects: NodeEffects = {
      shadow: { dx: 0, dy: 1, blur: 1, spread: 0, color: { r: 0, g: 0, b: 0 }, alpha: 0.5 },
      border: { width: 0.25, color: { r: 58, g: 53, b: 50 } },
    };
    // A frame with BOTH a shadow and a border renders both — the case the frame
    // wrapper relies on for "visible borders and shadows, as if it were an image".
    expect(effectsBoxShadow(effects)).toBe(
      '0px 16px 16px 0px rgba(0, 0, 0, 0.5), 0 0 0 4px rgb(58, 53, 50)',
    );
  });
});

// ── The glows ───────────────────────────────────────────────────────
// A glow is a shadow with nowhere to fall, so the box-shadow it maps to is
// the shadow's with the offset dropped. The INNER one is the same band laid
// inside the edge — which `inset` draws exactly, for every node that really
// is a box; a SHAPE takes the export's own filter instead.

describe('effectsBoxShadow — the glows', () => {
  const GLOW = { radius: 0.5, color: { r: 255, g: 200, b: 0 }, alpha: 0.6 };

  test('an outer glow is a spread-able halo with no offset', () => {
    expect(effectsBoxShadow({ glow: GLOW })).toBe('0 0 8px 0px rgba(255, 200, 0, 0.6)');
    expect(effectsBoxShadow({ glow: { ...GLOW, spread: 0.25 } }))
      .toBe('0 0 8px 4px rgba(255, 200, 0, 0.6)');
  });

  test('an inner glow is that same halo, inset', () => {
    expect(effectsBoxShadow({ innerGlow: GLOW })).toBe('inset 0 0 8px 0px rgba(255, 200, 0, 0.6)');
    expect(effectsBoxShadow({ innerGlow: { ...GLOW, spread: 0.25 } }))
      .toBe('inset 0 0 8px 4px rgba(255, 200, 0, 0.6)');
  });

  test('all three stack in one box-shadow, the border last', () => {
    expect(effectsBoxShadow({
      shadow: { dx: 0, dy: 1, blur: 1, spread: 0, color: { r: 0, g: 0, b: 0 }, alpha: 0.5 },
      glow: GLOW,
      innerGlow: GLOW,
      border: { width: 0.25, color: { r: 58, g: 53, b: 50 } },
    })).toBe(
      '0px 16px 16px 0px rgba(0, 0, 0, 0.5), '
      + '0 0 8px 0px rgba(255, 200, 0, 0.6), '
      + 'inset 0 0 8px 0px rgba(255, 200, 0, 0.6), '
      + '0 0 0 4px rgb(58, 53, 50)',
    );
  });
});

describe('innerGlowSvgFilter (a shape’s inner glow)', () => {
  const GLOW = { radius: 0.5, spread: 0.25, color: { r: 255, g: 200, b: 0 }, alpha: 0.6 };

  test('a node with no inner glow mounts no filter at all', () => {
    expect(innerGlowSvgFilter(undefined, 'ig', 4)).toEqual({ defs: null, filterRef: null });
    expect(innerGlowSvgFilter({}, 'ig', 4)).toEqual({ defs: null, filterRef: null });
    // …nor does one that wears only the effects CSS can already draw.
    expect(innerGlowSvgFilter(
      { shadow: { dx: 1, dy: 1, blur: 1, spread: 0, color: { r: 0, g: 0, b: 0 }, alpha: 1 } },
      'ig', 4,
    )).toEqual({ defs: null, filterRef: null });
  });

  test('it is the export’s own filter, in the inline svg’s units', () => {
    const { defs, filterRef } = innerGlowSvgFilter({ innerGlow: GLOW }, 'ig_n1', 4);
    expect(filterRef).toBe('url(#ig_n1)');
    expect(defs).toContain('<filter id="ig_n1"');
    // The band's own chain — the same one effectsToSvgFilter builds.
    expect(defs).toContain('<feFuncA type="table" tableValues="1 0"/>');
    expect(defs).toContain('operator="in" result="innerMask"');
    // Lengths scaled by u: spread 0.25 cells × 4 = 1, blur 0.5 → σ 0.25 × 4 = 1.
    expect(defs).toContain('radius="1"');
    expect(defs).toContain('stdDeviation="1"');
  });

  test('it carries ONLY the inner glow — the other two are already drawn', () => {
    // Passing the whole block would draw the shadow and the halo a second
    // time, over the CSS drop-shadow chain that already casts them.
    const { defs } = innerGlowSvgFilter({
      shadow: { dx: 1, dy: 1, blur: 1, spread: 0, color: { r: 0, g: 0, b: 0 }, alpha: 1 },
      glow: { radius: 1, color: { r: 0, g: 0, b: 255 }, alpha: 1 },
      innerGlow: GLOW,
    }, 'ig', 4);
    expect(defs).not.toContain('feDropShadow');
    expect(defs).not.toContain('result="glowBlur"');
    expect(defs).toContain('result="innerGlow"');
  });
});

describe('shadowGlowBoxShadow (frame wrapper — shadow/glow, never border)', () => {
  test('a border alone yields no box-shadow, so a border never implies a shadow', () => {
    const effects: NodeEffects = {
      border: { width: 0.375, position: 'center', dash: 0, color: { r: 214, g: 40, b: 40 } },
    };
    // The frame's border renders as a stroked-rect overlay instead; the wrapper
    // box-shadow stays empty (request: "don't add a shadow by default").
    expect(shadowGlowBoxShadow(effects)).toBeUndefined();
  });

  test('a shadow still renders', () => {
    const effects: NodeEffects = {
      shadow: { dx: 0.5, dy: 1, blur: 2, spread: 0.25, color: { r: 0, g: 0, b: 0 }, alpha: 0.4 },
    };
    expect(shadowGlowBoxShadow(effects)).toBe('8px 16px 32px 4px rgba(0, 0, 0, 0.4)');
  });

  test('shadow + border keeps only the shadow (border excluded)', () => {
    const effects: NodeEffects = {
      shadow: { dx: 0, dy: 1, blur: 1, spread: 0, color: { r: 0, g: 0, b: 0 }, alpha: 0.5 },
      border: { width: 0.25, color: { r: 58, g: 53, b: 50 } },
    };
    expect(shadowGlowBoxShadow(effects)).toBe('0px 16px 16px 0px rgba(0, 0, 0, 0.5)');
  });

  test('undefined effects yield no box-shadow', () => {
    expect(shadowGlowBoxShadow(undefined)).toBeUndefined();
  });
});

// A text node's shadow is cast by its glyphs, so the preview uses CSS
// text-shadow rather than the bbox box-shadow above — matching the export,
// which runs its drop-shadow filter over the <text> elements.
const TEXT_SHADOW: ShadowEffect = {
  dx: 0.5, dy: 1, blur: 2, spread: 0, color: { r: 0, g: 0, b: 0 }, alpha: 0.4,
};

// A SHAPE's shadow is cast from its own outline, not from the box around it.
// The box-shadow above is right where the node IS a box (an image, a frame, a
// sticker's card) and was a different picture entirely for a path: a 3×1-cell
// ellipse threw a blurred rectangle, with the ellipse — edge-softened to
// nothing — invisible on top of it.
describe('shadowGlowDropShadow (a vector casts its own silhouette)', () => {
  test('nothing to cast, no filter', () => {
    expect(shadowGlowDropShadow(undefined)).toBeUndefined();
    expect(shadowGlowDropShadow({})).toBeUndefined();
    // A border is a box, and stays one: it never implies a filter.
    expect(shadowGlowDropShadow({ border: { width: 0.25, color: { r: 0, g: 0, b: 0 } } }))
      .toBeUndefined();
  });

  test('dx / dy / blur reach px, and the alpha rides the colour', () => {
    const effects: NodeEffects = {
      shadow: { dx: 0.5, dy: 1, blur: 2, spread: 0.25, color: { r: 0, g: 0, b: 0 }, alpha: 0.4 },
    };
    // …and no spread: CSS drop-shadow has no such parameter. The export
    // dilates the alpha instead; the preview shows the un-spread outline,
    // which is still nearer than inflating a box that was never the shape.
    expect(shadowGlowDropShadow(effects)).toBe('drop-shadow(8px 16px 32px rgba(0, 0, 0, 0.4))');
  });

  test('the blur number means the same blur here as in the export', () => {
    // Both halve the authored radius to a Gaussian σ — the export through
    // BLUR_SIGMA_PER_RADIUS, CSS by its own definition of drop-shadow's
    // radius — so the number passes straight through and the two agree.
    expect(BLUR_SIGMA_PER_RADIUS).toBe(0.5);
    const blurPx = /drop-shadow\(\S+ \S+ (\S+)px/.exec(
      shadowGlowDropShadow({ shadow: { dx: 0, dy: 0, blur: 3, color: { r: 0, g: 0, b: 0 }, alpha: 1 } })!,
    )![1];
    expect(Number(blurPx)).toBe(3 * 16);
  });

  test('glow leads the chain, so the shadow lands behind it', () => {
    const both = shadowGlowDropShadow({
      shadow: { dx: 0.5, dy: 0.5, blur: 1, color: { r: 0, g: 0, b: 0 }, alpha: 0.5 },
      glow: { radius: 0.5, color: { r: 255, g: 0, b: 0 }, alpha: 1 },
    })!;
    expect(both.indexOf('rgb(255, 0, 0)')).toBeLessThan(both.indexOf('rgba(0, 0, 0, 0.5)'));
    expect(both).toBe(
      'drop-shadow(0 0 8px rgb(255, 0, 0)) drop-shadow(8px 8px 16px rgba(0, 0, 0, 0.5))',
    );
  });
});

// AN UNFILLED SHAPE'S CAST EFFECTS (the reported bug: "adding a drop shadow
// does nothing", and then the same of both glows). A cast effect is the
// silhouette, blurred — and an unfilled shape's silhouette is its OUTLINE, a
// hairline beside the blur these effects carry. Blurring a 0.3-cell line with
// a 1.1-cell radius leaves about a twentieth of the opacity behind, which is
// indistinguishable from nothing. So the ring is cast from an outline no
// narrower than the blur about to soften it (paintSvg.outlineCastDilate) —
// the same rule both renderers read, for all three effects.
//
// The rule's own arithmetic is pinned engine-side (outlineCastEffects.test.ts);
// what matters here is that the two CSS renderers read it.
describe('the width an outline casts at', () => {
  const shadow = (over: Partial<ShadowEffect> = {}): ShadowEffect => ({
    dx: 0.75, dy: 0.875, blur: 1.125, spread: 0.125,
    color: { r: 0, g: 0, b: 0 }, alpha: 0.45, ...over,
  });
  const glow = (over: Partial<GlowEffect> = {}): GlowEffect => ({
    radius: 1.125, spread: 0.125, color: { r: 255, g: 255, b: 255 }, alpha: 0.6, ...over,
  });

  test('a hairline casts at the effect’s own softness, not its own width', () => {
    // The default stroke (0.3125 cells) under the default shadow: the ring
    // is as wide as the blur, plus the authored spread either side.
    expect(outlineCastSourceCells(0.3125, shadow()))
      .toBeCloseTo(1.125 + 2 * 0.125, 9);
    // …and a GLOW, whose radius is its blur, lands in the same place — one
    // rule, and the node layer draws both rings from this one number.
    expect(outlineCastSourceCells(0.3125, glow()))
      .toBeCloseTo(outlineCastSourceCells(0.3125, shadow()), 9);
    expect(castSoftness(glow())).toBe(castSoftness(shadow()));
  });

  test('a stroke already wider than its blur casts at its own width', () => {
    // The floor is a floor: a fat line is its own silhouette, and inflating
    // it would draw an effect the shape never had.
    expect(outlineCastSourceCells(3, shadow({ blur: 1 }))).toBeCloseTo(3 + 2 * 0.125, 9);
  });

  test('a sharp effect is cast by the line itself', () => {
    // No blur to hide in, nothing to widen for.
    expect(outlineCastSourceCells(0.3125, shadow({ blur: 0, spread: 0 }))).toBeCloseTo(0.3125, 9);
  });

  test('a NEGATIVE spread never eats into the floor', () => {
    // Eroding a hairline erases it, and the rule is about being seen.
    expect(outlineCastSourceCells(0.3125, shadow({ spread: -0.5 }))).toBeCloseTo(1.125, 9);
  });

  test('…and the same rule, stated as the spread the export dilates by', () => {
    // The export has no second mechanism for the outward pair: it raises the
    // `feMorphology` radius the authored spread already goes through.
    const s = shadow();
    expect(outlineCastSpread(0.3125, s))
      .toBeCloseTo((outlineCastSourceCells(0.3125, s) - 0.3125) / 2, 9);
  });
});

describe('worldOffsetInNodeFrame', () => {
  test('an unrotated node leaves the offset alone', () => {
    expect(worldOffsetInNodeFrame(0.5, 1, {})).toEqual([0.5, 1]);
  });

  test('a quarter turn pushes the world offset back through the rotation', () => {
    // The DOM draws the shadow INSIDE the node's rotate(), so a shadow that
    // should fall straight down on the page is authored as +x in a node turned
    // 90° clockwise.
    const [x, y] = worldOffsetInNodeFrame(0, 1, { rotation: 90 });
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(0);
  });

  test('free rotation stacks on the discrete one', () => {
    const [x, y] = worldOffsetInNodeFrame(0, 1, { rotation: 90, angleDeg: 90 });
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(-1);
  });

  test('mirrors flip the axis they mirror', () => {
    expect(worldOffsetInNodeFrame(0.5, 1, { mirrorH: true })).toEqual([-0.5, 1]);
    expect(worldOffsetInNodeFrame(0.5, 1, { mirrorV: true })).toEqual([0.5, -1]);
  });
});

// A BENT line is not DOM text: it is drawn as SVG <textPath>s, and WebKit
// paints no `text-shadow` on SVG text — so a text with a drop shadow lost it
// outright the moment it was bent. Bent text casts from its glyphs' own
// alpha instead.
describe('textShadowFilter (bent text)', () => {
  test('no shadow — or a fully transparent one — draws nothing', () => {
    expect(textShadowFilter(undefined, {})).toBeUndefined();
    expect(textShadowFilter({ ...TEXT_SHADOW, alpha: 0 }, {})).toBeUndefined();
  });

  test('one drop-shadow, its alpha in the COLOUR — it is cast from the ink', () => {
    // There is no transparent pass to fade: the ink's own glyphs cast this,
    // so the alpha has nowhere else to ride (the flat path fades a whole
    // pass by it, which is why its colour is opaque).
    expect(textShadowFilter(TEXT_SHADOW, {})).toBe('drop-shadow(8px 16px 32px rgba(0, 0, 0, 0.4))');
  });

  test('the offset is expressed in the rotated node’s own frame, like the flat one', () => {
    expect(textShadowFilter({ ...TEXT_SHADOW, dx: 0, dy: 1 }, { rotation: 90 }))
      .toBe('drop-shadow(16px 0px 32px rgba(0, 0, 0, 0.4))');
  });

  test('the blur passes straight through: a 2σ radius in both worlds', () => {
    const css = textShadowFilter(TEXT_SHADOW, {})!;
    expect(css).toContain(`${TEXT_SHADOW.blur * 16}px rgba`);
  });

  test('spread has no counterpart — a bent shadow draws un-dilated', () => {
    // The flat path buys its dilate with a ring of nine copies; one
    // drop-shadow() has nowhere to put one, so the number is ignored rather
    // than approximated wrongly.
    expect(textShadowFilter({ ...TEXT_SHADOW, spread: 0.25 }, {}))
      .toBe(textShadowFilter(TEXT_SHADOW, {}));
  });
});

describe('textShadowCss', () => {
  test('no shadow — or a fully transparent one — draws nothing', () => {
    expect(textShadowCss(undefined, {})).toBeUndefined();
    expect(textShadowCss({ ...TEXT_SHADOW, alpha: 0 }, {})).toBeUndefined();
  });

  test('a plain shadow is one offset+blur in an OPAQUE color', () => {
    // Opaque on purpose: the alpha is applied once, by the layer wrapping the
    // shadow pass, so a spread ring's copies cannot compound it.
    expect(textShadowCss(TEXT_SHADOW, {})).toBe('8px 16px 32px rgb(0, 0, 0)');
  });

  test('the offset is expressed in the rotated node\'s own frame', () => {
    // Same shadow, node turned 90°: the export measures dx/dy against the page
    // (its filter wraps the transform), so the preview must counter-rotate.
    expect(textShadowCss({ ...TEXT_SHADOW, dx: 0, dy: 1 }, { rotation: 90 }))
      .toBe('16px 0px 32px rgb(0, 0, 0)');
  });

  test('a positive spread becomes a ring of copies around the offset', () => {
    const css = textShadowCss({ ...TEXT_SHADOW, spread: 0.25 }, {})!;
    // The centre copy plus eight around it — CSS text-shadow has no spread, so
    // the ring stands in for the export's feMorphology dilate.
    const copies = css.split(/,\s(?=-?[\d.]+px)/);
    expect(copies).toHaveLength(9);
    expect(copies[0]).toBe('8px 16px 32px rgb(0, 0, 0)');
    // The ring's radius is the spread: 0.25 cells = 4px, due east of centre.
    expect(copies[1]).toBe('12px 16px 32px rgb(0, 0, 0)');
    // Every copy shares the blur and the opaque color.
    for (const c of copies) expect(c).toMatch(/ 32px rgb\(0, 0, 0\)$/);
  });

  test('a sub-pixel spread skips the ring — nine blurred copies for nothing', () => {
    // 1/32 cell = half a pixel: invisible, and not worth 9× the paint on a
    // live slider drag.
    expect(textShadowCss({ ...TEXT_SHADOW, spread: 1 / 32 }, {}))
      .toBe(textShadowCss({ ...TEXT_SHADOW, spread: 0 }, {}));
  });

  test('a negative spread falls back to the plain shadow', () => {
    // Nothing in CSS erodes a glyph, so the preview shows the un-eroded
    // shadow rather than inventing a wrong one.
    expect(textShadowCss({ ...TEXT_SHADOW, spread: -0.5 }, {}))
      .toBe(textShadowCss({ ...TEXT_SHADOW, spread: 0 }, {}));
  });
});

// The reported bug: an exported shadow read paler than the one the editor had
// been showing. Both renderers take the SAME authored `blur`, but they were
// reading it in different units — CSS blur radius in the preview, Gaussian σ in
// the export — so the export blurred the shadow twice as wide and spread the
// same ink over four times the area.
describe('the export and the preview blur by the same amount', () => {
  const SHADOW: ShadowEffect = {
    dx: 0.5, dy: 1, blur: 2, color: { r: 0, g: 0, b: 0 }, alpha: 0.4,
  };

  test('σ in the export is half the radius the preview passes to CSS', () => {
    // CSS defines a blur radius R as a Gaussian of standard deviation R/2, so
    // matching the preview means halving the authored number — and only there.
    const css = textShadowCss(SHADOW, {})!;
    const cssBlurPx = Number(css.split(' ')[2].replace('px', ''));
    const { defs } = effectsToSvgFilter({ shadow: SHADOW }, 'fx');
    const sigma = Number(defs!.match(/stdDeviation="([\d.]+)"/)![1]);
    expect(cssBlurPx).toBe(SHADOW.blur * 16); // px = BASE_CELL_PX
    expect(sigma).toBe(SHADOW.blur / 2);
    expect(sigma * 2).toBe(cssBlurPx / 16);
  });

  test('the offset and the ink are passed through untouched', () => {
    // Only the blur was ever misread; nothing else about the shadow is scaled.
    const { defs } = effectsToSvgFilter({ shadow: SHADOW }, 'fx');
    expect(defs).toContain('dx="0.5" dy="1"');
    expect(defs).toContain('flood-opacity="0.4"');
  });

  test('a glow’s radius is read the same way', () => {
    const { defs } = effectsToSvgFilter(
      { glow: { radius: 3, color: { r: 0, g: 0, b: 0 }, alpha: 1 } }, 'fx');
    expect(defs).toContain('stdDeviation="1.5"');
  });
});
