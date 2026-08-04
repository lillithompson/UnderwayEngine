/**
 * Tests for the v35 binary format extension: the per-object SVG `stroke`
 * block (width / radius / position / dash). Verifies a full round-trip, that
 * the presence mask keeps an untouched object free of the payload, and that
 * the flags2 bit it rides can't corrupt a record that doesn't use it.
 */

import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { SVGObject, PathSegment, SVGStroke } from '../types';

function line(start: [number, number], end: [number, number]): PathSegment {
  return { kind: 'line', start, end };
}

function rectSegments(): PathSegment[] {
  return [
    line([0, 0], [4, 0]),
    line([4, 0], [4, 3]),
    line([4, 3], [0, 3]),
    line([0, 3], [0, 0]),
  ];
}

function makeSVG(id: string, extras: Partial<SVGObject> = {}): SVGObject {
  return {
    id,
    segments: rectSegments(),
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
    sceneOrder: svgObjects.map((s) => s.id),
  };
}

function roundTrip(svgObjects: SVGObject[]): SVGObject[] {
  const bytes = serializeComposition(makeBundle(svgObjects), []);
  return deserializeComposition(bytes).meta.svgObjects ?? [];
}

describe('v35 SVG stroke round-trip', () => {
  it('preserves every field', () => {
    const stroke: SVGStroke = { width: 0.375, radius: 0.25, position: 'outside', dash: 7 };
    const [out] = roundTrip([makeSVG('svg_1', { stroke })]);
    expect(out.stroke).toEqual(stroke);
  });

  it('preserves each alignment value', () => {
    for (const position of ['inside', 'center', 'outside'] as const) {
      const [out] = roundTrip([makeSVG('svg_1', { stroke: { position } })]);
      expect(out.stroke?.position).toBe(position);
    }
  });

  it('preserves a width-only stroke without inventing the other fields', () => {
    const [out] = roundTrip([makeSVG('svg_1', { stroke: { width: 0.5 } })]);
    expect(out.stroke).toEqual({ width: 0.5 });
    expect(out.stroke?.dash).toBeUndefined();
    expect(out.stroke?.position).toBeUndefined();
    expect(out.stroke?.radius).toBeUndefined();
  });

  it('preserves a width of exactly zero — distinct from "no width set"', () => {
    const [out] = roundTrip([makeSVG('svg_1', { stroke: { width: 0 } })]);
    expect(out.stroke?.width).toBe(0);
  });

  it('leaves an untouched object with no stroke at all', () => {
    const [out] = roundTrip([makeSVG('svg_1')]);
    expect(out.stroke).toBeUndefined();
  });

  it('treats an all-undefined stroke as absent', () => {
    const [out] = roundTrip([makeSVG('svg_1', { stroke: {} })]);
    expect(out.stroke).toBeUndefined();
  });

  it('costs nothing on the wire for an object without one', () => {
    const without = serializeComposition(makeBundle([makeSVG('svg_1')]), []);
    const with_ = serializeComposition(makeBundle([makeSVG('svg_1', { stroke: { dash: 4 } })]), []);
    // Presence mask (1) + dash (1).
    expect(with_.length - without.length).toBe(2);
  });

  it('keeps strokes distinct across several objects', () => {
    const out = roundTrip([
      makeSVG('svg_1', { stroke: { width: 0.125 } }),
      makeSVG('svg_2'),
      makeSVG('svg_3', { stroke: { position: 'inside', dash: 10 } }),
    ]);
    expect(out[0].stroke).toEqual({ width: 0.125 });
    expect(out[1].stroke).toBeUndefined();
    expect(out[2].stroke).toEqual({ position: 'inside', dash: 10 });
  });

  it('coexists with the other optional SVG blocks it shares a record with', () => {
    const [out] = roundTrip([makeSVG('svg_1', {
      stroke: { width: 0.375, dash: 3 },
      shapeKind: 'rectangle',
      angleDeg: 12,
      fillColor: { r: 1, g: 2, b: 3 },
      effects: { border: { width: 0.5, color: { r: 4, g: 5, b: 6 } } },
      name: 'boxy',
      hidden: true,
    })]);
    expect(out.stroke).toEqual({ width: 0.375, dash: 3 });
    expect(out.shapeKind).toBe('rectangle');
    expect(out.angleDeg).toBeCloseTo(12, 1);
    expect(out.fillColor).toEqual({ r: 1, g: 2, b: 3 });
    expect(out.effects?.border?.width).toBeCloseTo(0.5);
    expect(out.name).toBe('boxy');
    expect(out.hidden).toBe(true);
    // Geometry survived the extra payload — i.e. the stream stayed in sync.
    expect(out.segments).toHaveLength(4);
    expect(out.cellWidth).toBeCloseTo(4);
  });
});
