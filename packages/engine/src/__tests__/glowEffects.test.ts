/**
 * The two GLOWS — the halo outside a node's edge and the band of light
 * inside it — as the export draws them, caches them, and stores them.
 *
 * A glow is a drop shadow with nowhere to fall: the same blur, the same
 * dilation, the same ink, cast in every direction at once. That is the whole
 * of the design (the panel's Effects page renders one from the other's rows),
 * and it is what these pin: an outer glow buys its `spread` with the same
 * `feMorphology` the shadow does, and an inner glow is that band laid the
 * other way about — the silhouette's COMPLEMENT blurred, clipped back inside
 * the silhouette, merged OVER the paint rather than under it.
 *
 * Companion to shadowFilter.test.ts in the app repo, which covers the shadow
 * half of the same builder.
 */

import { effectsToSvgFilter, effectsFilterOutset, scaleEffects } from '../paintSvg';
import { effectsRasterKey } from '../effectsCache';
import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { GlowEffect, NodeEffects, PathSegment, SVGObject } from '../types';

const GLOW: GlowEffect = { radius: 0.8, color: { r: 255, g: 200, b: 0 }, alpha: 0.6 };
const SHADOW = { dx: 0.2, dy: 0.2, blur: 0.3, color: { r: 0, g: 0, b: 0 }, alpha: 0.4 };

describe('effectsToSvgFilter — the outer glow', () => {
  it('blurs the silhouette, floods it and merges UNDER the paint', () => {
    const { defs, filterRef } = effectsToSvgFilter({ glow: GLOW }, 'fx');
    expect(filterRef).toBe('url(#fx)');
    expect(defs).toContain('<feGaussianBlur in="SourceAlpha"');
    expect(defs).toContain('flood-color="#FFC800"');
    // Under: the halo is the first merge node, the paint the second.
    expect(defs).toContain('<feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>');
    // Nothing to dilate without a spread.
    expect(defs).not.toContain('feMorphology');
  });

  it('buys its spread with the same dilate the shadow does', () => {
    const { defs } = effectsToSvgFilter({ glow: { ...GLOW, spread: 0.5 } }, 'fx');
    expect(defs).toContain('<feMorphology in="SourceAlpha" operator="dilate" radius="0.5" result="glowSpread"/>');
    // …and the blur reads the dilated silhouette, not the raw one.
    expect(defs).toContain('<feGaussianBlur in="glowSpread"');
  });

  it('erodes on a negative spread, at the magnitude', () => {
    const { defs } = effectsToSvgFilter({ glow: { ...GLOW, spread: -0.5 } }, 'fx');
    expect(defs).toContain('operator="erode"');
    expect(defs).toContain('radius="0.5"');
  });

  it('reaches further out for a positive spread, and no further for a negative one', () => {
    const plain = effectsFilterOutset({ glow: GLOW });
    const wide = effectsFilterOutset({ glow: { ...GLOW, spread: 0.5 } });
    const eroded = effectsFilterOutset({ glow: { ...GLOW, spread: -0.5 } });
    expect(wide.left).toBeCloseTo(plain.left + 0.5);
    // An erode can only shrink the reach, so the region stays as it was.
    expect(eroded.left).toBeCloseTo(plain.left);
  });
});

describe('effectsToSvgFilter — the inner glow', () => {
  it('blurs the silhouette’s complement, clips it back inside, and merges OVER', () => {
    const { defs, filterRef } = effectsToSvgFilter({ innerGlow: GLOW }, 'fx');
    expect(filterRef).toBe('url(#fx)');
    // The complement: alpha inverted by a two-value transfer table.
    expect(defs).toContain('<feComponentTransfer in="SourceAlpha" result="innerInv">');
    expect(defs).toContain('<feFuncA type="table" tableValues="1 0"/>');
    // …blurred, then clipped back to the shape that casts it.
    expect(defs).toContain('<feGaussianBlur in="innerInv"');
    expect(defs).toContain('<feComposite in="innerBlur" in2="SourceAlpha" operator="in" result="innerMask"/>');
    // Over: the paint is the first merge node, the light the second.
    expect(defs).toContain('<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="innerGlow"/></feMerge>');
  });

  it('ERODES on a positive spread — that is what thickens a band growing inward', () => {
    const { defs } = effectsToSvgFilter({ innerGlow: { ...GLOW, spread: 0.5 } }, 'fx');
    expect(defs).toContain('<feMorphology in="SourceAlpha" operator="erode" radius="0.5" result="innerSpread"/>');
    expect(defs).toContain('<feComponentTransfer in="innerSpread"');
    // …and dilates the other way, the mirror of the outer glow's rule.
    const back = effectsToSvgFilter({ innerGlow: { ...GLOW, spread: -0.5 } }, 'fx');
    expect(back.defs).toContain('operator="dilate"');
  });

  it('adds nothing to the filter region: it is clipped to what casts it', () => {
    expect(effectsFilterOutset({ innerGlow: { ...GLOW, spread: 2 } }))
      .toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });
});

describe('effectsToSvgFilter — the three together', () => {
  it('stacks shadow, outer glow, paint, inner glow — each stage reading the last', () => {
    const { defs } = effectsToSvgFilter(
      { shadow: SHADOW, glow: GLOW, innerGlow: GLOW }, 'fx',
    );
    // The shadow names its result for the glow to merge onto…
    expect(defs).toContain('result="withShadow"');
    // …the glow names its own for the inner glow…
    expect(defs).toContain('<feMerge result="withGlow"><feMergeNode in="glow"/><feMergeNode in="withShadow"/></feMerge>');
    // …and the inner glow, going last, names nothing: the last primitive's
    // output IS the filter's.
    expect(defs).toContain('<feMerge><feMergeNode in="withGlow"/><feMergeNode in="innerGlow"/></feMerge>');
    expect(defs).not.toContain('result="withInnerGlow"');
  });

  it('a lone shadow still emits exactly what it always did', () => {
    // The chain must not have grown a merge for a node that wears one effect.
    const { defs } = effectsToSvgFilter({ shadow: SHADOW }, 'fx');
    expect(defs).toContain('<feDropShadow');
    expect(defs).not.toContain('result="withShadow"');
    expect(defs).not.toContain('feMerge');
  });

  it('an inner glow alone is enough to build a filter', () => {
    expect(effectsToSvgFilter({ innerGlow: GLOW }, 'fx').defs).not.toBeNull();
    expect(effectsToSvgFilter({}, 'fx').defs).toBeNull();
    // A border still needs none.
    expect(effectsToSvgFilter({ border: { width: 1, color: { r: 0, g: 0, b: 0 } } }, 'fx').defs)
      .toBeNull();
  });
});

describe('scaleEffects', () => {
  it('scales both glows’ radius and spread, leaving their ink alone', () => {
    const out = scaleEffects({ glow: { ...GLOW, spread: 0.5 }, innerGlow: GLOW }, 4);
    expect(out.glow).toEqual({ ...GLOW, radius: 3.2, spread: 2 });
    // An absent spread stays absent rather than becoming 0.
    expect(out.innerGlow?.spread).toBeUndefined();
    expect(out.innerGlow?.radius).toBeCloseTo(3.2);
    expect(out.innerGlow?.color).toEqual(GLOW.color);
  });
});

describe('effectsRasterKey', () => {
  it('tells the two glows apart, and follows a spread', () => {
    const outer = effectsRasterKey('n', 1, { glow: GLOW });
    const inner = effectsRasterKey('n', 1, { innerGlow: GLOW });
    expect(outer).not.toBeNull();
    expect(outer).not.toBe(inner);
    expect(effectsRasterKey('n', 1, { glow: { ...GLOW, spread: 0.5 } })).not.toBe(outer);
    // Still nothing to rasterize when the node wears neither.
    expect(effectsRasterKey('n', 1, {})).toBeNull();
    expect(effectsRasterKey('n', 1, { border: { width: 1, color: { r: 0, g: 0, b: 0 } } })).toBeNull();
  });
});

// ── v68: the record keeps them ───────────────────────────────────────

function line(start: [number, number], end: [number, number]): PathSegment {
  return { kind: 'line', start, end };
}

function makeSVG(id: string, effects?: NodeEffects): SVGObject {
  return {
    id,
    segments: [line([0, 0], [4, 0]), line([4, 0], [4, 3])],
    color: { r: 255, g: 160, b: 50 },
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 3,
    ...(effects ? { effects } : {}),
  };
}

function roundTrip(svgObjects: SVGObject[]): SVGObject[] {
  const bundle: CompositionBundle = {
    name: 'Test', gridLevel: 1, strokeScale: 0.2, gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [],
    svgObjects,
    images: [],
    imageBlobs: {},
    texts: [],
    sceneOrder: svgObjects.map((s) => s.id),
  };
  return deserializeComposition(serializeComposition(bundle, [])).meta.svgObjects ?? [];
}

const size = (svg: SVGObject) => serializeComposition({
  name: 'Test', gridLevel: 1, strokeScale: 0.2, gridIntensity: 0.3,
  camera: { offsetX: 0, offsetY: 0, zoom: 1 },
  figures: [], svgObjects: [svg], images: [], imageBlobs: {}, texts: [],
  sceneOrder: [svg.id],
}, []).byteLength;

describe('v68 effects extensions', () => {
  it('round-trips an inner glow, spread and all', () => {
    const innerGlow: GlowEffect = {
      radius: 1.25, spread: 0.375, color: { r: 10, g: 200, b: 255 }, alpha: 0.5,
    };
    const [svg] = roundTrip([makeSVG('s1', { innerGlow })]);
    expect(svg.effects?.innerGlow?.radius).toBeCloseTo(innerGlow.radius, 5);
    expect(svg.effects?.innerGlow?.spread).toBeCloseTo(innerGlow.spread!, 5);
    expect(svg.effects?.innerGlow?.color).toEqual(innerGlow.color);
    expect(svg.effects?.innerGlow?.alpha).toBeCloseTo(innerGlow.alpha, 2);
  });

  it('round-trips the outer glow’s spread', () => {
    const [svg] = roundTrip([makeSVG('s1', { glow: { ...GLOW, spread: -0.25 } })]);
    expect(svg.effects?.glow?.spread).toBeCloseTo(-0.25, 5);
    expect(svg.effects?.glow?.radius).toBeCloseTo(GLOW.radius, 5);
  });

  it('keeps all three on one node, apart', () => {
    const effects: NodeEffects = {
      shadow: { ...SHADOW, spread: 0.125 },
      glow: { ...GLOW, spread: 0.25 },
      innerGlow: { radius: 2, spread: 0.5, color: { r: 1, g: 2, b: 3 }, alpha: 1 },
    };
    const [svg] = roundTrip([makeSVG('s1', effects)]);
    expect(svg.effects?.shadow?.spread).toBeCloseTo(0.125, 5);
    expect(svg.effects?.glow?.spread).toBeCloseTo(0.25, 5);
    expect(svg.effects?.innerGlow?.radius).toBeCloseTo(2, 5);
    expect(svg.effects?.innerGlow?.color).toEqual({ r: 1, g: 2, b: 3 });
  });

  it('costs a v67 record nothing: neither block is written when it is absent', () => {
    // Both bits were always written 0 before, and a plain glow still writes
    // no spread — which is what lets every older file read back byte for
    // byte.
    const plain = size(makeSVG('s1', { glow: GLOW }));
    const zeroSpread = size(makeSVG('s1', { glow: { ...GLOW, spread: 0 } }));
    expect(zeroSpread).toBe(plain);
    expect(size(makeSVG('s1', { glow: { ...GLOW, spread: 0.5 } }))).toBe(plain + 4);
    // The inner glow's block: radius f32 + rgba u8 + spread f32.
    expect(size(makeSVG('s1', { glow: GLOW, innerGlow: GLOW }))).toBe(plain + 12);
  });

  it('a glow with no spread reads back with none, not with a zero', () => {
    const [svg] = roundTrip([makeSVG('s1', { glow: GLOW })]);
    expect(svg.effects?.glow?.spread).toBeUndefined();
  });
});
