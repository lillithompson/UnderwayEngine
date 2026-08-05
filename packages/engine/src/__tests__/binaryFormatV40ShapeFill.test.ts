/**
 * Tests for the v40 binary format extension: the editable SVG `fill` block
 * (the Fill bar's solid / linear / radial fill). Verifies a full round-trip,
 * that the presence bit keeps an unfilled shape free of the payload, and that
 * the flags4 bit it rides can't corrupt a record that doesn't use it.
 *
 * Mirrors binaryFormatV35Stroke.test.ts for the stroke block.
 */

import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { SVGObject, PathSegment, ShapeFill } from '../types';

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

const fill = (extras: Partial<ShapeFill> = {}): ShapeFill => ({
  type: 'linear',
  solid: { r: 0x12, g: 0x30, b: 0x47 },
  stops: [
    { offset: 0, color: { r: 0x2e, g: 0x1a, b: 0x3d } },
    { offset: 1, color: { r: 0xff, g: 0x9f, b: 0x0a } },
  ],
  angle: 90,
  opacity: 1,
  blend: 'normal',
  ...extras,
});

describe('v40 SVG fill round-trip', () => {
  it('preserves every field', () => {
    const [out] = roundTrip([makeSVG('svg_1', { fill: fill() })]);
    expect(out.fill).toEqual(fill());
  });

  it('preserves each fill type', () => {
    for (const type of ['solid', 'linear', 'radial'] as const) {
      const [out] = roundTrip([makeSVG('svg_1', { fill: fill({ type }) })]);
      expect(out.fill?.type).toBe(type);
    }
  });

  it('preserves each blend mode', () => {
    const blends = ['normal', 'multiply', 'darken', 'lighten',
      'soft-light', 'color', 'hue', 'saturation'] as const;
    for (const blend of blends) {
      const [out] = roundTrip([makeSVG('svg_1', { fill: fill({ blend }) })]);
      expect(out.fill?.blend).toBe(blend);
    }
  });

  it('keeps the fields the active type is not using, so switching Type back restores them', () => {
    // A Solid fill still remembers its gradient; a Radial one its angle.
    const [out] = roundTrip([makeSVG('svg_1', { fill: fill({ type: 'solid', angle: 215 }) })]);
    expect(out.fill?.stops).toHaveLength(2);
    expect(out.fill?.stops[1].color).toEqual({ r: 0xff, g: 0x9f, b: 0x0a });
    expect(out.fill?.angle).toBe(215);
  });

  it('preserves an opacity between the ends of the slider', () => {
    const [out] = roundTrip([makeSVG('svg_1', { fill: fill({ opacity: 0.5 }) })]);
    expect(out.fill!.opacity).toBeCloseTo(0.5, 2);
  });

  it('preserves more stops than the two-stop minimum', () => {
    const stops = [
      { offset: 0, color: { r: 1, g: 1, b: 1 } },
      { offset: 0.35, color: { r: 2, g: 2, b: 2 } },
      { offset: 1, color: { r: 3, g: 3, b: 3 } },
    ];
    const [out] = roundTrip([makeSVG('svg_1', { fill: fill({ stops }) })]);
    expect(out.fill?.stops).toHaveLength(3);
    expect(out.fill!.stops[1].offset).toBeCloseTo(0.35, 2);
    expect(out.fill!.stops[2].color).toEqual({ r: 3, g: 3, b: 3 });
  });

  it('leaves an unfilled shape with no fill at all', () => {
    const [out] = roundTrip([makeSVG('svg_1')]);
    expect(out.fill).toBeUndefined();
  });

  it('costs nothing on the wire for a shape without one', () => {
    const without = serializeComposition(makeBundle([makeSVG('svg_1')]), []);
    const with_ = serializeComposition(makeBundle([makeSVG('svg_1', { fill: fill() })]), []);
    // type(1) + solid(3) + stopCount(1) + 2 stops × 5 + angle(2) + opacity(1)
    // + blend(1) = 19.
    expect(with_.length - without.length).toBe(19);
  });

  it('keeps fills distinct across several shapes', () => {
    const out = roundTrip([
      makeSVG('svg_1', { fill: fill({ type: 'solid' }) }),
      makeSVG('svg_2'),
      makeSVG('svg_3', { fill: fill({ type: 'radial', blend: 'multiply' }) }),
    ]);
    expect(out[0].fill?.type).toBe('solid');
    expect(out[1].fill).toBeUndefined();
    expect(out[2].fill?.type).toBe('radial');
    expect(out[2].fill?.blend).toBe('multiply');
  });

  it('coexists with the other optional SVG blocks it shares a record with', () => {
    // The fill is written last, after the v35 stroke — this is the case that
    // catches the stream falling out of sync.
    const [out] = roundTrip([makeSVG('svg_1', {
      fill: fill({ type: 'radial', opacity: 0.75 }),
      stroke: { width: 0.375, dash: 3 },
      shapeKind: 'rectangle',
      angleDeg: 12,
      patternFileId: 'file_9',
      effects: { border: { width: 0.5, color: { r: 4, g: 5, b: 6 } } },
      name: 'boxy',
      hidden: true,
    })]);
    expect(out.fill?.type).toBe('radial');
    expect(out.fill!.opacity).toBeCloseTo(0.75, 2);
    expect(out.stroke).toEqual({ width: 0.375, dash: 3 });
    expect(out.shapeKind).toBe('rectangle');
    expect(out.angleDeg).toBeCloseTo(12, 1);
    expect(out.patternFileId).toBe('file_9');
    expect(out.effects?.border?.width).toBeCloseTo(0.5);
    expect(out.name).toBe('boxy');
    expect(out.hidden).toBe(true);
    // Geometry survived the extra payload — i.e. the stream stayed in sync.
    expect(out.segments).toHaveLength(4);
    expect(out.cellWidth).toBeCloseTo(4);
  });

  it('still round-trips the legacy fill fields alongside it', () => {
    const [out] = roundTrip([makeSVG('svg_1', {
      fillColor: { r: 1, g: 2, b: 3 },
      fillOpacity: 0.5,
      fillPaint: { kind: 'solid', color: { r: 9, g: 9, b: 9 } },
    })]);
    expect(out.fill).toBeUndefined();
    expect(out.fillColor).toEqual({ r: 1, g: 2, b: 3 });
    expect(out.fillPaint).toEqual({ kind: 'solid', color: { r: 9, g: 9, b: 9 } });
  });
});
