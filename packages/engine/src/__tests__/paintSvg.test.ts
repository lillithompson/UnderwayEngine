/**
 * SVG serialization for the v29 visual types (paintSvg.ts): gradient
 * defs, effect filters, border rects, and the tint color matrix. The
 * matrix test cross-checks against the reference math in imageTint.ts —
 * the two must agree up to 8-bit rounding.
 */

import {
  paintToSvg,
  effectsFilterOutset,
  effectsToSvgFilter,
  tintToFeColorMatrix,
  borderToSvgRect,
} from '../paintSvg';
import { applyImageTint } from '../imageTint';
import { ImageTint, Paint, RGBColor } from '../types';

describe('paintToSvg solid', () => {
  test('opaque solid paints as a hex fill with no defs and no fillOpacity', () => {
    const paint: Paint = { kind: 'solid', color: { r: 255, g: 0, b: 0 } };
    expect(paintToSvg(paint, 'p1')).toEqual({ defs: null, fill: '#FF0000' });
  });

  test('alpha 1 is treated as opaque', () => {
    const paint: Paint = { kind: 'solid', color: { r: 18, g: 52, b: 86 }, alpha: 1 };
    expect(paintToSvg(paint, 'p1')).toEqual({ defs: null, fill: '#123456' });
  });

  test('alpha < 1 adds fillOpacity', () => {
    const paint: Paint = { kind: 'solid', color: { r: 0, g: 0, b: 0 }, alpha: 0.5 };
    expect(paintToSvg(paint, 'p1')).toEqual({ defs: null, fill: '#000000', fillOpacity: 0.5 });
  });
});

describe('paintToSvg gradients', () => {
  const stops = [
    { offset: 0, color: { r: 255, g: 0, b: 0 } },
    { offset: 0.25, color: { r: 0, g: 255, b: 0 }, alpha: 0.5 },
    { offset: 1, color: { r: 0, g: 0, b: 255 }, alpha: 1 },
  ];

  test('linear gradient emits a def with geometry and unit-bbox units', () => {
    const paint: Paint = { kind: 'linear', stops, x1: 0, y1: 0.5, x2: 1, y2: 0.5 };
    const { defs, fill, fillOpacity } = paintToSvg(paint, 'grad1');
    expect(fill).toBe('url(#grad1)');
    expect(fillOpacity).toBeUndefined();
    expect(defs).toContain('<linearGradient id="grad1" gradientUnits="objectBoundingBox"');
    expect(defs).toContain('x1="0" y1="0.5" x2="1" y2="0.5"');
  });

  test('stops carry offset, hex color, and stop-opacity only when alpha < 1', () => {
    const paint: Paint = { kind: 'linear', stops, x1: 0, y1: 0, x2: 1, y2: 0 };
    const { defs } = paintToSvg(paint, 'grad1');
    expect(defs).toContain('<stop offset="0" stop-color="#FF0000"/>');
    expect(defs).toContain('<stop offset="0.25" stop-color="#00FF00" stop-opacity="0.5"/>');
    // Alpha 1 is opaque: no stop-opacity attribute.
    expect(defs).toContain('<stop offset="1" stop-color="#0000FF"/>');
  });

  test('stops appear in order inside the def', () => {
    const paint: Paint = { kind: 'linear', stops, x1: 0, y1: 0, x2: 1, y2: 0 };
    const { defs } = paintToSvg(paint, 'grad1');
    const first = defs!.indexOf('offset="0"');
    const mid = defs!.indexOf('offset="0.25"');
    const last = defs!.indexOf('offset="1"');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(mid).toBeGreaterThan(first);
    expect(last).toBeGreaterThan(mid);
  });

  test('radial gradient emits cx/cy/r geometry', () => {
    const paint: Paint = { kind: 'radial', stops, cx: 0.5, cy: 0.5, r: 0.75 };
    const { defs, fill } = paintToSvg(paint, 'grad2');
    expect(fill).toBe('url(#grad2)');
    expect(defs).toContain('<radialGradient id="grad2" gradientUnits="objectBoundingBox"');
    expect(defs).toContain('cx="0.5" cy="0.5" r="0.75"');
  });
});

describe('effectsToSvgFilter', () => {
  const shadow = { dx: 2, dy: 3, blur: 4, color: { r: 1, g: 2, b: 3 }, alpha: 0.5 };
  const glow = { radius: 6, color: { r: 255, g: 200, b: 0 }, alpha: 0.8 };

  test('no shadow / no glow (incl. border-only) returns nulls', () => {
    expect(effectsToSvgFilter({}, 'fx1')).toEqual({ defs: null, filterRef: null });
    expect(effectsToSvgFilter(
      { border: { width: 1, color: { r: 0, g: 0, b: 0 } } }, 'fx1',
    )).toEqual({ defs: null, filterRef: null });
  });

  test('shadow-only emits a feDropShadow primitive', () => {
    const { defs, filterRef } = effectsToSvgFilter({ shadow }, 'fx1');
    expect(filterRef).toBe('url(#fx1)');
    expect(defs).toContain('<filter id="fx1" x="-50%" y="-50%" width="200%" height="200%"');
    expect(defs).toContain('color-interpolation-filters="sRGB"');
    // stdDeviation is HALF the authored blur: `blur` is a CSS radius, and CSS
    // defines a radius R as a Gaussian of σ = R/2 (see blurSigma). Feeding the
    // radius straight through blurred the export twice as wide as the editor
    // previewed it, which is why an exported shadow read pale.
    expect(defs).toContain(
      '<feDropShadow dx="2" dy="3" stdDeviation="2" flood-color="#010203" flood-opacity="0.5"/>',
    );
    expect(defs).not.toContain('feGaussianBlur');
    expect(defs).not.toContain('result="withShadow"');
  });

  test('glow-only blurs SourceAlpha and merges under SourceGraphic', () => {
    const { defs, filterRef } = effectsToSvgFilter({ glow }, 'fx2');
    expect(filterRef).toBe('url(#fx2)');
    // Half the authored radius, for the same reason the shadow's is.
    expect(defs).toContain('<feGaussianBlur in="SourceAlpha" stdDeviation="3" result="glowBlur"/>');
    expect(defs).toContain('<feFlood flood-color="#FFC800" flood-opacity="0.8" result="glowColor"/>');
    expect(defs).toContain('<feComposite in="glowColor" in2="glowBlur" operator="in" result="glow"/>');
    expect(defs).toContain('<feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>');
    expect(defs).not.toContain('feDropShadow');
  });

  test('shadow + glow merges the drop-shadowed source over the glow halo', () => {
    const { defs } = effectsToSvgFilter({ shadow, glow }, 'fx3');
    expect(defs).toContain('result="withShadow"');
    expect(defs).toContain('<feMerge><feMergeNode in="glow"/><feMergeNode in="withShadow"/></feMerge>');
  });
});

// A filter CLIPS to its region, so a region that doesn't cover the shadow cuts
// it off with a hard straight edge. The relative ±50% default is half the
// caster's own box, which is nowhere near enough for a short node — the
// reported bug: a line of text is ~2 cells tall and its shadow is measured in
// the same cells, so the blur ran straight off the region and was guillotined.
describe('effectsFilterOutset', () => {
  const shadow = { dx: 2, dy: 3, blur: 4, color: { r: 1, g: 2, b: 3 }, alpha: 0.5 };
  const glow = { radius: 6, color: { r: 255, g: 200, b: 0 }, alpha: 0.8 };

  test('nothing that paints outside the shape needs no outset', () => {
    expect(effectsFilterOutset({})).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
    // A border is a stroked rect, not a filter primitive.
    expect(effectsFilterOutset({ border: { width: 4, color: { r: 0, g: 0, b: 0 } } }))
      .toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  test('the blur reaches three sigma on every side', () => {
    // blur 4 is a CSS radius → σ 2 → 3σ = 6.
    const o = effectsFilterOutset({ shadow: { ...shadow, dx: 0, dy: 0, blur: 4 } });
    expect(o).toEqual({ left: 6, right: 6, top: 6, bottom: 6 });
  });

  test('the offset is paid only on the side it moves toward', () => {
    // The blur disc slides bodily with the offset: it gains 2 to the right and
    // LOSES 2 on the left, so padding both sides would be wasted region.
    const o = effectsFilterOutset({ shadow: { ...shadow, dx: 2, dy: -3, blur: 4 } });
    expect(o).toEqual({ left: 6, right: 8, top: 9, bottom: 6 });
  });

  test('a positive spread dilates before the blur; a negative one only shrinks', () => {
    const grown = effectsFilterOutset({ shadow: { ...shadow, dx: 0, dy: 0, blur: 4, spread: 5 } });
    expect(grown.left).toBe(11);
    const eroded = effectsFilterOutset({ shadow: { ...shadow, dx: 0, dy: 0, blur: 4, spread: -5 } });
    expect(eroded.left).toBe(6); // never less than the blur's own reach
  });

  test('a glow radiates evenly, and the two effects take the max per side', () => {
    expect(effectsFilterOutset({ glow: { ...glow, radius: 6 } }))
      .toEqual({ left: 9, right: 9, top: 9, bottom: 9 });
    // Shadow reaches 6+2=8 right, glow 9 — the wider wins.
    const both = effectsFilterOutset({
      shadow: { ...shadow, dx: 2, dy: 0, blur: 4 }, glow: { ...glow, radius: 6 },
    });
    expect(both).toEqual({ left: 9, right: 9, top: 9, bottom: 9 });
  });
});

describe('effectsToSvgFilter — filter region', () => {
  const shadow = { dx: 2, dy: 3, blur: 4, color: { r: 1, g: 2, b: 3 }, alpha: 0.5 };
  const box = { x: 0, y: 0, width: 100, height: 20 };

  test('without a box it keeps the relative region', () => {
    // Callers that pass no box (and the old behaviour) are unchanged.
    expect(effectsToSvgFilter({ shadow }, 'fx').defs)
      .toContain('x="-50%" y="-50%" width="200%" height="200%"');
  });

  test('with a box the region is user-space and covers the shadow', () => {
    const { defs } = effectsToSvgFilter(
      { shadow: { ...shadow, dx: 0, dy: 10, blur: 4 } }, 'fx', box,
    );
    expect(defs).toContain('filterUnits="userSpaceOnUse"');
    // 6 up (3σ of the σ=2 this radius means), 16 down (3σ + the offset) — and
    // the box is only 20 tall, so the old ±50% would have allowed just 10 and
    // sliced the shadow off. Sideways the 10%-of-box floor wins over the 6.
    expect(defs).toContain('x="-10" y="-6" width="120" height="42"');
  });

  test('a short node gets the room its shadow needs, not half its own height', () => {
    // The reported bug, stated as an invariant: whatever the box, the region
    // must contain every pixel the shadow can reach.
    const tall = { ...box, height: 2 };
    const { defs } = effectsToSvgFilter({ shadow: { ...shadow, dx: 0, dy: 30, blur: 4 } }, 'fx', tall);
    const y = Number(defs!.match(/ y="(-?[\d.]+)"/)![1]);
    const h = Number(defs!.match(/ height="([\d.]+)"/)![1]);
    expect(y).toBeLessThanOrEqual(-6); // 3σ above
    expect(y + h).toBeGreaterThanOrEqual(2 + 30 + 6); // box + offset + 3σ below
  });

  test('the region never shrinks below a tenth of the box', () => {
    // It has to contain the SOURCE too, which can spill a little past the bbox
    // it was measured from (a centered stroke, an italic overhang).
    const { defs } = effectsToSvgFilter(
      { shadow: { ...shadow, dx: 0, dy: 0, blur: 0, spread: 0 } }, 'fx', box,
    );
    expect(defs).toContain('x="-10" y="-2" width="120" height="24"');
  });
});

describe('borderToSvgRect', () => {
  const bbox = { cellX: 1, cellY: 2, cellWidth: 10, cellHeight: 5 };

  test('emits a stroked, unfilled rect over the bbox', () => {
    const markup = borderToSvgRect(
      { width: 2, color: { r: 18, g: 52, b: 86 } }, bbox,
    );
    expect(markup).toBe(
      '<rect x="1" y="2" width="10" height="5" fill="none" stroke="#123456" stroke-width="2"/>',
    );
  });

  test('includes rx only when radius > 0', () => {
    const rounded = borderToSvgRect(
      { width: 1, color: { r: 0, g: 0, b: 0 }, radius: 3 }, bbox,
    );
    expect(rounded).toContain(' rx="3" ');
    const sharp = borderToSvgRect(
      { width: 1, color: { r: 0, g: 0, b: 0 }, radius: 0 }, bbox,
    );
    expect(sharp).not.toContain('rx=');
  });
});

describe('tintToFeColorMatrix', () => {
  /** Apply a 5x4 feColorMatrix values string to a color (alpha 1). */
  function applyMatrix(values: string, base: RGBColor): { r: number; g: number; b: number; a: number } {
    const v = values.trim().split(/\s+/).map(Number);
    expect(v).toHaveLength(20);
    const input = [base.r / 255, base.g / 255, base.b / 255, 1, 1];
    const channel = (row: number) =>
      v.slice(row * 5, row * 5 + 5).reduce((acc, m, i) => acc + m * input[i], 0);
    return { r: channel(0) * 255, g: channel(1) * 255, b: channel(2) * 255, a: channel(3) };
  }

  const TINT_COLOR: RGBColor = { r: 200, g: 100, b: 50 };

  test('alpha row is identity', () => {
    const tint: ImageTint = { color: TINT_COLOR, amount: 0.7, mode: 'tint' };
    const out = applyMatrix(tintToFeColorMatrix(tint), { r: 130, g: 40, b: 220 });
    expect(out.a).toBeCloseTo(1, 10);
  });

  test('amount 0 yields the identity matrix behavior', () => {
    for (const mode of ['tint', 'duotone', 'wash'] as const) {
      const tint: ImageTint = { color: TINT_COLOR, amount: 0, mode };
      const base: RGBColor = { r: 130, g: 40, b: 220 };
      const out = applyMatrix(tintToFeColorMatrix(tint), base);
      expect(out.r).toBeCloseTo(base.r, 6);
      expect(out.g).toBeCloseTo(base.g, 6);
      expect(out.b).toBeCloseTo(base.b, 6);
    }
  });

  test('amount clamps to [0, 1]', () => {
    const over: ImageTint = { color: TINT_COLOR, amount: 3, mode: 'tint' };
    const one: ImageTint = { color: TINT_COLOR, amount: 1, mode: 'tint' };
    expect(tintToFeColorMatrix(over)).toBe(tintToFeColorMatrix(one));
  });

  test.each([
    ['tint', 1], ['tint', 0.6], ['duotone', 0.8], ['wash', 1], ['wash', 0.4],
  ] as const)('matrix math matches applyImageTint for pure gray (%s, amount %d)', (mode, amount) => {
    const tint: ImageTint = { color: TINT_COLOR, amount, mode };
    const matrix = tintToFeColorMatrix(tint);
    for (const gray of [0, 64, 128, 200, 255]) {
      const base: RGBColor = { r: gray, g: gray, b: gray };
      const viaMatrix = applyMatrix(matrix, base);
      const viaReference = applyImageTint(base, tint);
      // applyImageTint rounds once to 8-bit; the matrix is exact.
      expect(Math.abs(viaMatrix.r - viaReference.r)).toBeLessThanOrEqual(0.5000001);
      expect(Math.abs(viaMatrix.g - viaReference.g)).toBeLessThanOrEqual(0.5000001);
      expect(Math.abs(viaMatrix.b - viaReference.b)).toBeLessThanOrEqual(0.5000001);
    }
  });

  test('matrix math matches applyImageTint for arbitrary colors too', () => {
    const tint: ImageTint = { color: TINT_COLOR, amount: 0.7, mode: 'tint' };
    const matrix = tintToFeColorMatrix(tint);
    for (const base of [
      { r: 130, g: 40, b: 220 },
      { r: 255, g: 128, b: 0 },
      { r: 7, g: 250, b: 99 },
    ]) {
      const viaMatrix = applyMatrix(matrix, base);
      const viaReference = applyImageTint(base, tint);
      expect(Math.abs(viaMatrix.r - viaReference.r)).toBeLessThanOrEqual(0.5000001);
      expect(Math.abs(viaMatrix.g - viaReference.g)).toBeLessThanOrEqual(0.5000001);
      expect(Math.abs(viaMatrix.b - viaReference.b)).toBeLessThanOrEqual(0.5000001);
    }
  });

  test('wash mode moves every base toward the same constant overlay', () => {
    const tint: ImageTint = { color: TINT_COLOR, amount: 1, mode: 'wash' };
    const matrix = tintToFeColorMatrix(tint);
    const fromBlack = applyMatrix(matrix, { r: 0, g: 0, b: 0 });
    const fromWhite = applyMatrix(matrix, { r: 255, g: 255, b: 255 });
    expect(fromBlack.r).toBeCloseTo(fromWhite.r, 6);
    expect(fromBlack.g).toBeCloseTo(fromWhite.g, 6);
    expect(fromBlack.b).toBeCloseTo(fromWhite.b, 6);
  });
});
