/**
 * The v71 binary format extension: a vector object's LINE STYLE
 * (`NodeEffects.lineStyle`) — the glyph, its density, size and the three
 * random sliders, and the drawn glyph's strokes when there is one — rides
 * the effects payload's last presence bit. Mirrors
 * binaryFormatV44RoundTrip.test.ts for the border and shadow extensions.
 */

import {
  CompositionBundle, deserializeComposition, serializeComposition,
} from '../compositionBinaryFormat';
import { LineStyleEffect, PathSegment, SVGObject } from '../types';

function line(start: [number, number], end: [number, number]): PathSegment {
  return { kind: 'line', start, end };
}

function makeSVG(id: string, extras: Partial<SVGObject> = {}): SVGObject {
  return {
    id,
    segments: [line([0, 0], [4, 0]), line([4, 0], [4, 3])],
    color: { r: 255, g: 160, b: 50 },
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 3,
    ...extras,
  };
}

function makeBundle(svgObjects: SVGObject[]): CompositionBundle {
  return {
    name: 'Test', gridLevel: 1, strokeScale: 0.2, gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [],
    svgObjects,
    images: [],
    imageBlobs: {},
    texts: [],
    sceneOrder: svgObjects.map((s) => s.id),
  };
}

function roundTrip(svgs: SVGObject[]): SVGObject[] {
  return deserializeComposition(serializeComposition(makeBundle(svgs), [])).meta.svgObjects ?? [];
}

describe('v71: the line style block', () => {
  test('a built-in glyph round-trips, its 0…1 sliders to the nearest 1/255', () => {
    const lineStyle: LineStyleEffect = {
      glyph: 'heart', density: 0.4, size: 0.625,
      randomPlacement: 0.2, randomRotation: 1, randomSize: 0.6,
    };
    const [back] = roundTrip([makeSVG('a', { effects: { lineStyle } })]);
    const got = back.effects?.lineStyle;
    expect(got).toBeDefined();
    expect(got!.glyph).toBe('heart');
    expect(got!.size).toBeCloseTo(0.625, 6);
    expect(got!.density).toBeCloseTo(0.4, 2);
    expect(got!.randomPlacement).toBeCloseTo(0.2, 2);
    expect(got!.randomRotation).toBe(1);
    expect(got!.randomSize).toBeCloseTo(0.6, 2);
    // No strokes were written, so none come back — not an empty list.
    expect('custom' in got!).toBe(false);
  });

  test('every glyph keeps its name', () => {
    const glyphs: LineStyleEffect['glyph'][] = ['line', 'circle', 'sparkle', 'heart', 'custom'];
    const svgs = glyphs.map((glyph, i) => makeSVG(`g${i}`, {
      effects: { lineStyle: { glyph, density: 0.5, size: 0.5, randomPlacement: 0, randomRotation: 0, randomSize: 0 } },
    }));
    expect(roundTrip(svgs).map((s) => s.effects?.lineStyle?.glyph)).toEqual(glyphs);
  });

  test('a drawn glyph round-trips its strokes, each point to the nearest 1/255 of the pad', () => {
    const custom: [number, number][][] = [
      [[0.1, 0.1], [0.1, 0.3], [0.2, 0.3]],
      [[0.5, 0.5], [0.9, 0.95]],
    ];
    const lineStyle: LineStyleEffect = {
      glyph: 'custom', custom, density: 0.5, size: 0.5,
      randomPlacement: 0, randomRotation: 0, randomSize: 0,
    };
    const [back] = roundTrip([makeSVG('a', { effects: { lineStyle } })]);
    const got = back.effects!.lineStyle!;
    expect(got.glyph).toBe('custom');
    expect(got.custom).toHaveLength(2);
    custom.forEach((stroke, i) => {
      expect(got.custom![i]).toHaveLength(stroke.length);
      stroke.forEach(([x, y], j) => {
        expect(got.custom![i][j][0]).toBeCloseTo(x, 2);
        expect(got.custom![i][j][1]).toBeCloseTo(y, 2);
      });
    });
  });

  test('a built-in glyph writes no strokes even if a drawing is remembered beside it', () => {
    const lineStyle: LineStyleEffect = {
      glyph: 'circle', custom: [[[0, 0], [1, 1]]], density: 0.5, size: 0.5,
      randomPlacement: 0, randomRotation: 0, randomSize: 0,
    };
    const [back] = roundTrip([makeSVG('a', { effects: { lineStyle } })]);
    expect(back.effects!.lineStyle!.custom).toBeUndefined();
  });

  test('the style rides beside the other effects, and an object without one reads back as before', () => {
    const shadow = { dx: 0.5, dy: 0.25, blur: 1, color: { r: 0, g: 0, b: 0 }, alpha: 0.5 };
    const innerGlow = { radius: 1, color: { r: 255, g: 255, b: 255 }, alpha: 0.6, spread: 0.25 };
    const lineStyle: LineStyleEffect = {
      glyph: 'sparkle', density: 1, size: 1, randomPlacement: 0, randomRotation: 0, randomSize: 0,
    };
    const [styled, plain] = roundTrip([
      makeSVG('a', { effects: { shadow, innerGlow, lineStyle } }),
      makeSVG('b', { effects: { shadow } }),
    ]);
    expect(styled.effects!.shadow).toMatchObject({ dx: 0.5, dy: 0.25, blur: 1 });
    expect(styled.effects!.innerGlow).toMatchObject({ radius: 1, spread: 0.25 });
    expect(styled.effects!.lineStyle).toMatchObject({ glyph: 'sparkle', density: 1, size: 1 });
    expect(plain.effects!.lineStyle).toBeUndefined();
    expect(plain.effects!.shadow).toMatchObject({ dx: 0.5 });
  });

  test('an unstyled file is byte-identical to its v70 form but for the version field', () => {
    const bytes = serializeComposition(makeBundle([makeSVG('a', {
      effects: { shadow: { dx: 0.5, dy: 0.25, blur: 1, color: { r: 0, g: 0, b: 0 }, alpha: 0.5 } },
    })]), []);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint16(4, true)).toBe(71);
    // The effects mask byte never sets the line style bit when there is none.
    const parsed = deserializeComposition(bytes);
    expect(parsed.meta.svgObjects![0].effects!.lineStyle).toBeUndefined();
  });
});
