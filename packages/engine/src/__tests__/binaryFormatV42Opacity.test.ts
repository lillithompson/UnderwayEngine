/**
 * Tests for the v42 binary format extension: whole-object opacity + edge
 * soften (the Opacity bar). SVG records carry both as a two-byte payload
 * behind flags4 bit 0x08; image records already persist `opacity`, so only
 * `edgeSoften` is new there (one byte behind image flags2 bit 0x04). Verifies
 * the round-trips, that defaults stay absent (untouched records don't grow),
 * and that the payloads coexist with the other optional blocks.
 *
 * Mirrors binaryFormatV41Endpoints.test.ts for the endpoints byte.
 */

import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { ImageObject, PathSegment, SVGObject } from '../types';

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

function makeImage(id: string, extras: Partial<ImageObject> = {}): ImageObject {
  return {
    id,
    imageId: `blob_${id}`,
    mimeType: 'image/png',
    pixelWidth: 100,
    pixelHeight: 80,
    cellX: 1, cellY: 2, cellWidth: 4, cellHeight: 3,
    ...extras,
  };
}

function makeBundle(svgObjects: SVGObject[], images: ImageObject[] = []): CompositionBundle {
  return {
    name: 'Test', gridLevel: 1, strokeScale: 0.2, gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [],
    svgObjects,
    images,
    imageBlobs: Object.fromEntries(images.map((i) => [i.imageId, new Uint8Array([1, 2, 3])])),
    sceneOrder: [...svgObjects.map((s) => s.id), ...images.map((i) => i.id)],
  };
}

function roundTrip(svgObjects: SVGObject[], images: ImageObject[] = []) {
  const bytes = serializeComposition(makeBundle(svgObjects, images), []);
  const meta = deserializeComposition(bytes).meta;
  return { svgs: meta.svgObjects ?? [], images: meta.images ?? [] };
}

describe('v42 SVG whole-object opacity round-trip', () => {
  it('preserves opacity and edgeSoften together', () => {
    const [out] = roundTrip([makeSVG('svg_1', { opacity: 0.5, edgeSoften: 0.25 })]).svgs;
    expect(out.opacity).toBeCloseTo(0.5, 2);
    expect(out.edgeSoften).toBeCloseTo(0.25, 2);
  });

  it('preserves each field on its own, the other staying absent', () => {
    const [a] = roundTrip([makeSVG('svg_1', { opacity: 0.3 })]).svgs;
    expect(a.opacity).toBeCloseTo(0.3, 2);
    expect(a.edgeSoften).toBeUndefined();
    const [b] = roundTrip([makeSVG('svg_1', { edgeSoften: 0.8 })]).svgs;
    expect(b.opacity).toBeUndefined();
    expect(b.edgeSoften).toBeCloseTo(0.8, 2);
  });

  it('leaves an untouched object with neither field', () => {
    const [out] = roundTrip([makeSVG('svg_1')]).svgs;
    expect(out.opacity).toBeUndefined();
    expect(out.edgeSoften).toBeUndefined();
  });

  it('treats the defaults as absent, so an opaque hard-edged record costs nothing', () => {
    const bare = serializeComposition(makeBundle([makeSVG('svg_1')]), []);
    const defaulted = serializeComposition(makeBundle([makeSVG('svg_1', {
      opacity: 1, edgeSoften: 0,
    })]), []);
    expect(defaulted.length).toBe(bare.length);
    const [out] = roundTrip([makeSVG('svg_1', { opacity: 1, edgeSoften: 0 })]).svgs;
    expect(out.opacity).toBeUndefined();
    expect(out.edgeSoften).toBeUndefined();
  });

  it('costs exactly two bytes on the wire', () => {
    const without = serializeComposition(makeBundle([makeSVG('svg_1')]), []);
    const with_ = serializeComposition(makeBundle([makeSVG('svg_1', {
      opacity: 0.5, edgeSoften: 0.5,
    })]), []);
    expect(with_.length - without.length).toBe(2);
  });

  it('survives an opacity of 0 (fully transparent is not "absent")', () => {
    const [out] = roundTrip([makeSVG('svg_1', { opacity: 0 })]).svgs;
    expect(out.opacity).toBe(0);
  });

  it('keeps values distinct across several objects', () => {
    const { svgs } = roundTrip([
      makeSVG('svg_1', { opacity: 0.25 }),
      makeSVG('svg_2'),
      makeSVG('svg_3', { edgeSoften: 1 }),
    ]);
    expect(svgs[0].opacity).toBeCloseTo(0.25, 2);
    expect(svgs[1].opacity).toBeUndefined();
    expect(svgs[1].edgeSoften).toBeUndefined();
    expect(svgs[2].edgeSoften).toBe(1);
  });

  it('coexists with the other optional SVG blocks it shares a record with', () => {
    // The opacity payload is written last, after the v41 endpoints byte — this
    // is the case that catches the stream falling out of sync.
    const [out] = roundTrip([makeSVG('svg_1', {
      opacity: 0.5,
      edgeSoften: 0.75,
      endpoints: { startMarker: 'circle', endCap: 'square' },
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
      name: 'boxy',
      hidden: true,
    })]).svgs;
    expect(out.opacity).toBeCloseTo(0.5, 2);
    expect(out.edgeSoften).toBeCloseTo(0.75, 2);
    expect(out.endpoints).toEqual({ startMarker: 'circle', endCap: 'square' });
    expect(out.fill?.blend).toBe('multiply');
    expect(out.stroke).toEqual({ width: 0.375, dash: 3 });
    expect(out.angleDeg).toBeCloseTo(12, 1);
    expect(out.name).toBe('boxy');
    expect(out.hidden).toBe(true);
    // Geometry survived the extra payload — i.e. the stream stayed in sync.
    expect(out.segments).toHaveLength(2);
    expect(out.cellWidth).toBeCloseTo(4);
  });
});

describe('v42 image edgeSoften round-trip', () => {
  it('preserves edgeSoften alongside the existing opacity byte', () => {
    const [out] = roundTrip([], [makeImage('img_1', { opacity: 0.5, edgeSoften: 0.25 })]).images;
    expect(out.opacity).toBeCloseTo(0.5, 2);
    expect(out.edgeSoften).toBeCloseTo(0.25, 2);
  });

  it('preserves edgeSoften on its own', () => {
    const [out] = roundTrip([], [makeImage('img_1', { edgeSoften: 1 })]).images;
    expect(out.opacity).toBeUndefined();
    expect(out.edgeSoften).toBe(1);
  });

  it('leaves an untouched image with no field and no extra bytes', () => {
    const [out] = roundTrip([], [makeImage('img_1')]).images;
    expect(out.edgeSoften).toBeUndefined();
    const bare = serializeComposition(makeBundle([], [makeImage('img_1')]), []);
    const defaulted = serializeComposition(makeBundle([], [makeImage('img_1', { edgeSoften: 0 })]), []);
    expect(defaulted.length).toBe(bare.length);
  });

  it('costs exactly one byte on the wire', () => {
    const without = serializeComposition(makeBundle([], [makeImage('img_1')]), []);
    const with_ = serializeComposition(makeBundle([], [makeImage('img_1', { edgeSoften: 0.5 })]), []);
    expect(with_.length - without.length).toBe(1);
  });

  it('coexists with the other optional image blocks in the flags2 section', () => {
    // edgeSoften is written after the tintFill block — the case that catches
    // the stream falling out of sync.
    const [out] = roundTrip([], [makeImage('img_1', {
      edgeSoften: 0.5,
      originalImageId: 'orig_1',
      tintFill: {
        type: 'radial',
        solid: { r: 10, g: 20, b: 30 },
        stops: [
          { offset: 0, color: { r: 0, g: 0, b: 0 } },
          { offset: 1, color: { r: 255, g: 255, b: 255 } },
        ],
        angle: 45, opacity: 0.6, blend: 'soft-light',
      },
      cornerRadius: 0.25,
      framing: { mode: 'fill', zoom: 1.5 },
    })]).images;
    expect(out.edgeSoften).toBeCloseTo(0.5, 2);
    expect(out.originalImageId).toBe('orig_1');
    expect(out.tintFill?.type).toBe('radial');
    expect(out.tintFill?.blend).toBe('soft-light');
    expect(out.cornerRadius).toBeCloseTo(0.25);
    expect(out.framing?.zoom).toBeCloseTo(1.5);
    expect(out.cellWidth).toBeCloseTo(4);
  });
});
