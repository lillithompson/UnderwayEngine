/**
 * Tests for the v41 binary format extension: the SVG `endpoints` block (the
 * Endpoints bar's per-end marker + cap). Verifies the round-trip, that all four
 * settings survive independently in their one packed byte, and that the flags4
 * bit it rides can't corrupt a record that doesn't use it.
 *
 * Mirrors binaryFormatV40ShapeFill.test.ts for the fill.
 */

import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { SVGObject, PathSegment, SVGEndpoints } from '../types';

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
    sceneOrder: svgObjects.map((s) => s.id),
  };
}

function roundTrip(svgObjects: SVGObject[]): SVGObject[] {
  const bytes = serializeComposition(makeBundle(svgObjects), []);
  return deserializeComposition(bytes).meta.svgObjects ?? [];
}

describe('v41 SVG endpoints round-trip', () => {
  it('preserves every field at once', () => {
    const ep: SVGEndpoints = {
      startMarker: 'circle', endMarker: 'arrow', startCap: 'square', endCap: 'square',
    };
    const [out] = roundTrip([makeSVG('svg_1', { endpoints: ep })]);
    expect(out.endpoints).toEqual(ep);
  });

  it('preserves each marker on each end, independently', () => {
    for (const marker of ['circle', 'arrow'] as const) {
      const [a] = roundTrip([makeSVG('svg_1', { endpoints: { startMarker: marker } })]);
      expect(a.endpoints).toEqual({ startMarker: marker });
      const [b] = roundTrip([makeSVG('svg_1', { endpoints: { endMarker: marker } })]);
      expect(b.endpoints).toEqual({ endMarker: marker });
    }
  });

  it('keeps the two ends from bleeding into each other', () => {
    const [out] = roundTrip([makeSVG('svg_1', {
      endpoints: { startMarker: 'circle', endMarker: 'arrow', endCap: 'square' },
    })]);
    expect(out.endpoints?.startMarker).toBe('circle');
    expect(out.endpoints?.endMarker).toBe('arrow');
    expect(out.endpoints?.startCap).toBeUndefined(); // still round
    expect(out.endpoints?.endCap).toBe('square');
  });

  it('preserves a square cap on its own, with no marker', () => {
    const [out] = roundTrip([makeSVG('svg_1', { endpoints: { startCap: 'square' } })]);
    expect(out.endpoints).toEqual({ startCap: 'square' });
  });

  it('leaves an undecorated path with no block at all', () => {
    expect(roundTrip([makeSVG('svg_1')])[0].endpoints).toBeUndefined();
  });

  it('treats an all-default block as absent, so it costs nothing', () => {
    const [out] = roundTrip([makeSVG('svg_1', {
      endpoints: { startMarker: 'none', endMarker: 'none', startCap: 'round', endCap: 'round' },
    })]);
    expect(out.endpoints).toBeUndefined();
    const bare = serializeComposition(makeBundle([makeSVG('svg_1')]), []);
    const defaulted = serializeComposition(makeBundle([makeSVG('svg_1', {
      endpoints: { startMarker: 'none', endCap: 'round' },
    })]), []);
    expect(defaulted.length).toBe(bare.length);
  });

  it('costs exactly one byte on the wire', () => {
    const without = serializeComposition(makeBundle([makeSVG('svg_1')]), []);
    const with_ = serializeComposition(makeBundle([makeSVG('svg_1', {
      endpoints: { startMarker: 'arrow', endMarker: 'circle', startCap: 'square', endCap: 'square' },
    })]), []);
    expect(with_.length - without.length).toBe(1);
  });

  it('keeps endpoints distinct across several paths', () => {
    const out = roundTrip([
      makeSVG('svg_1', { endpoints: { startMarker: 'arrow' } }),
      makeSVG('svg_2'),
      makeSVG('svg_3', { endpoints: { endMarker: 'circle', startCap: 'square' } }),
    ]);
    expect(out[0].endpoints).toEqual({ startMarker: 'arrow' });
    expect(out[1].endpoints).toBeUndefined();
    expect(out[2].endpoints).toEqual({ endMarker: 'circle', startCap: 'square' });
  });

  it('coexists with the other optional SVG blocks it shares a record with', () => {
    // Endpoints are written last, after the v40 fill — this is the case that
    // catches the stream falling out of sync.
    const [out] = roundTrip([makeSVG('svg_1', {
      endpoints: { startMarker: 'circle', endMarker: 'arrow', endCap: 'square' },
      fill: {
        type: 'linear',
        solid: { r: 1, g: 2, b: 3 },
        stops: [
          { offset: 0, color: { r: 4, g: 5, b: 6 } },
          { offset: 1, color: { r: 7, g: 8, b: 9 } },
        ],
        angle: 90, opacity: 1, blend: 'multiply',
      },
      stroke: { width: 0.375, dash: 3 },
      angleDeg: 12,
      patternFileId: 'file_9',
      effects: { border: { width: 0.5, color: { r: 4, g: 5, b: 6 } } },
      name: 'liney',
      hidden: true,
    })]);
    expect(out.endpoints).toEqual({ startMarker: 'circle', endMarker: 'arrow', endCap: 'square' });
    expect(out.fill?.type).toBe('linear');
    expect(out.fill?.blend).toBe('multiply');
    expect(out.stroke).toEqual({ width: 0.375, dash: 3 });
    expect(out.angleDeg).toBeCloseTo(12, 1);
    expect(out.patternFileId).toBe('file_9');
    expect(out.effects?.border?.width).toBeCloseTo(0.5);
    expect(out.name).toBe('liney');
    expect(out.hidden).toBe(true);
    // Geometry survived the extra payload — i.e. the stream stayed in sync.
    expect(out.segments).toHaveLength(2);
    expect(out.cellWidth).toBeCloseTo(4);
  });
});
