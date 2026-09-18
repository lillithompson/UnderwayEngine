/**
 * Tests for the v42 binary format extension: whole-object opacity (the
 * Opacity bar's first row), an SVG record's one byte behind flags4 bit 0x08.
 * Verifies the round-trip, that the default stays absent (an untouched record
 * doesn't grow), and that the payload coexists with the other optional blocks.
 *
 * It carried a SECOND byte through v61 — the edge soften the Fade row
 * replaced. The reader still steps over that byte in an OLDER file and throws
 * it away, which is the compatibility case pinned at the bottom of this file;
 * the fade that stands in its place has its own (binaryFormatV62Fade).
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
  it('preserves the opacity', () => {
    const [out] = roundTrip([makeSVG('svg_1', { opacity: 0.5 })]).svgs;
    expect(out.opacity).toBeCloseTo(0.5, 2);
  });

  it('leaves an untouched object without it', () => {
    const [out] = roundTrip([makeSVG('svg_1')]).svgs;
    expect(out.opacity).toBeUndefined();
  });

  it('treats the default as absent, so an opaque record costs nothing', () => {
    const bare = serializeComposition(makeBundle([makeSVG('svg_1')]), []);
    const defaulted = serializeComposition(makeBundle([makeSVG('svg_1', { opacity: 1 })]), []);
    expect(defaulted.length).toBe(bare.length);
    const [out] = roundTrip([makeSVG('svg_1', { opacity: 1 })]).svgs;
    expect(out.opacity).toBeUndefined();
  });

  it('costs exactly ONE byte on the wire — the soften byte is gone', () => {
    const without = serializeComposition(makeBundle([makeSVG('svg_1')]), []);
    const with_ = serializeComposition(makeBundle([makeSVG('svg_1', { opacity: 0.5 })]), []);
    expect(with_.length - without.length).toBe(1);
  });

  it('survives an opacity of 0 (fully transparent is not "absent")', () => {
    const [out] = roundTrip([makeSVG('svg_1', { opacity: 0 })]).svgs;
    expect(out.opacity).toBe(0);
  });

  it('keeps values distinct across several objects', () => {
    const { svgs } = roundTrip([
      makeSVG('svg_1', { opacity: 0.25 }),
      makeSVG('svg_2'),
      makeSVG('svg_3', { opacity: 1 }),
    ]);
    expect(svgs[0].opacity).toBeCloseTo(0.25, 2);
    expect(svgs[1].opacity).toBeUndefined();
    expect(svgs[2].opacity).toBeUndefined();
  });

  it('coexists with the other optional SVG blocks it shares a record with', () => {
    // The opacity payload is written last, after the v41 endpoints byte — this
    // is the case that catches the stream falling out of sync.
    const [out] = roundTrip([makeSVG('svg_1', {
      opacity: 0.5,
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

describe('the soften byte an older file still carries', () => {
  // v42â€“v61 wrote the edge soften after the opacity byte. The Fade row
  // replaced that control, so the byte is STEPPED OVER rather than parsed:
  // skipping it is what keeps the blocks after it in the record landing
  // where they should. A shape saved softened opens with hard edges â€” the
  // one visible cost of the removal â€” and its Fade row is free.
  it('is not written any more, and nothing carries it into the scene', () => {
    const [out] = roundTrip([makeSVG('svg_1', { opacity: 0.5 })]).svgs;
    expect(out).not.toHaveProperty('edgeSoften');
    // An image record's soften bit goes the same way: never set, and its one
    // byte stepped over in an older file.
    const [img] = roundTrip([], [makeImage('img_1', { opacity: 0.5 })]).images;
    expect(img).not.toHaveProperty('edgeSoften');
  });
});
