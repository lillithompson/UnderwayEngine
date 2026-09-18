/**
 * The v62 binary format extension: the Fade row (engine/fade.ts) — an amount
 * quantized to a u8 and the target's three channels, four bytes, written only
 * when there IS a fade.
 *
 * Three records carry the pair, each behind its own presence bit: an SVG
 * (flags4 0x40, last in the record), an image (flags2 0x10, last in the image
 * section) and a text style (its own style flag). One writer and one reader
 * serve all three, so what this pins for one is what the others get.
 *
 * The block REPLACES the edge soften that stood in the same pages through
 * v61 — see binaryFormatV42Opacity for the byte an older file still carries
 * and this reader steps over.
 *
 * Mirrors binaryFormatV42Opacity.test.ts for the opacity byte.
 */

import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { ImageObject, PathSegment, SVGObject, TextObject } from '../types';

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

function makeText(id: string, extras: Partial<TextObject['style']> = {}): TextObject {
  return {
    id,
    content: 'hello',
    style: { fontId: 'inter', size: 2, color: { r: 0, g: 0, b: 0 }, ...extras },
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2,
  };
}

function makeBundle(
  svgObjects: SVGObject[], images: ImageObject[] = [], texts: TextObject[] = [],
): CompositionBundle {
  return {
    name: 'Test', gridLevel: 1, strokeScale: 0.2, gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [],
    svgObjects,
    images,
    texts,
    imageBlobs: Object.fromEntries(images.map((i) => [i.imageId, new Uint8Array([1, 2, 3])])),
    sceneOrder: [
      ...svgObjects.map((s) => s.id), ...images.map((i) => i.id), ...texts.map((t) => t.id),
    ],
  };
}

function roundTrip(svgObjects: SVGObject[], images: ImageObject[] = [], texts: TextObject[] = []) {
  const bytes = serializeComposition(makeBundle(svgObjects, images, texts), []);
  const meta = deserializeComposition(bytes).meta;
  return { svgs: meta.svgObjects ?? [], images: meta.images ?? [], texts: meta.texts ?? [] };
}

describe('v62 SVG fade round-trip', () => {
  it('preserves the amount and the target together', () => {
    const [out] = roundTrip([makeSVG('svg_1', {
      fade: 0.5, fadeColor: { r: 10, g: 20, b: 30 },
    })]).svgs;
    expect(out.fade).toBeCloseTo(0.5, 2);
    expect(out.fadeColor).toEqual({ r: 10, g: 20, b: 30 });
  });

  it('leaves a WHITE target absent, since white is what absent means', () => {
    // fade.FADE_DEFAULT_COLOR. Keeping it absent is what makes a round-trip
    // of the default toEqual-identical to what was written.
    const [out] = roundTrip([makeSVG('svg_1', {
      fade: 0.5, fadeColor: { r: 255, g: 255, b: 255 },
    })]).svgs;
    expect(out.fade).toBeCloseTo(0.5, 2);
    expect(out.fadeColor).toBeUndefined();
  });

  it('leaves an untouched object with neither field, and no extra bytes', () => {
    const [out] = roundTrip([makeSVG('svg_1')]).svgs;
    expect(out.fade).toBeUndefined();
    expect(out.fadeColor).toBeUndefined();
    const bare = serializeComposition(makeBundle([makeSVG('svg_1')]), []);
    const zeroed = serializeComposition(makeBundle([makeSVG('svg_1', {
      fade: 0, fadeColor: { r: 1, g: 2, b: 3 },
    })]), []);
    // A zero amount is no fade at all, target or no target.
    expect(zeroed.length).toBe(bare.length);
  });

  it('costs exactly four bytes on the wire', () => {
    const without = serializeComposition(makeBundle([makeSVG('svg_1')]), []);
    const with_ = serializeComposition(makeBundle([makeSVG('svg_1', { fade: 0.5 })]), []);
    expect(with_.length - without.length).toBe(4);
  });

  it('survives a full fade (1 is not "absent")', () => {
    const [out] = roundTrip([makeSVG('svg_1', { fade: 1 })]).svgs;
    expect(out.fade).toBe(1);
  });

  it('keeps values distinct across several objects', () => {
    const { svgs } = roundTrip([
      makeSVG('svg_1', { fade: 0.25 }),
      makeSVG('svg_2'),
      makeSVG('svg_3', { fade: 1, fadeColor: { r: 0, g: 0, b: 0 } }),
    ]);
    expect(svgs[0].fade).toBeCloseTo(0.25, 2);
    expect(svgs[1].fade).toBeUndefined();
    expect(svgs[2].fade).toBe(1);
    expect(svgs[2].fadeColor).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('coexists with the other optional SVG blocks it shares a record with', () => {
    // The fade is written LAST, after the v49 paint overlay — this is the
    // case that catches the stream falling out of sync.
    const [out] = roundTrip([makeSVG('svg_1', {
      fade: 0.75,
      fadeColor: { r: 9, g: 8, b: 7 },
      opacity: 0.5,
      endpoints: { startMarker: 'circle', endCap: 'square' },
      stroke: { width: 0.375, dash: 3 },
      angleDeg: 12,
      name: 'boxy',
      hidden: true,
    })]).svgs;
    expect(out.fade).toBeCloseTo(0.75, 2);
    expect(out.fadeColor).toEqual({ r: 9, g: 8, b: 7 });
    expect(out.opacity).toBeCloseTo(0.5, 2);
    expect(out.endpoints).toEqual({ startMarker: 'circle', endCap: 'square' });
    expect(out.stroke).toEqual({ width: 0.375, dash: 3 });
    expect(out.angleDeg).toBeCloseTo(12, 1);
    expect(out.name).toBe('boxy');
    expect(out.hidden).toBe(true);
    // Geometry survived the extra payload — i.e. the stream stayed in sync.
    expect(out.segments).toHaveLength(2);
    expect(out.cellWidth).toBeCloseTo(4);
  });
});

describe('v62 image fade round-trip', () => {
  it('preserves the amount and the target', () => {
    const [out] = roundTrip([], [makeImage('img_1', {
      fade: 0.25, fadeColor: { r: 4, g: 5, b: 6 },
    })]).images;
    expect(out.fade).toBeCloseTo(0.25, 2);
    expect(out.fadeColor).toEqual({ r: 4, g: 5, b: 6 });
  });

  it('leaves an untouched image with neither field and no extra bytes', () => {
    const [out] = roundTrip([], [makeImage('img_1')]).images;
    expect(out.fade).toBeUndefined();
    const bare = serializeComposition(makeBundle([], [makeImage('img_1')]), []);
    const zeroed = serializeComposition(makeBundle([], [makeImage('img_1', { fade: 0 })]), []);
    expect(zeroed.length).toBe(bare.length);
  });

  it('coexists with the other optional blocks in the image flags2 section', () => {
    // Written after the paint overlay, which is after the tintFill — the
    // out-of-sync case again, one section along.
    const [out] = roundTrip([], [makeImage('img_1', {
      fade: 0.5,
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
    expect(out.fade).toBeCloseTo(0.5, 2);
    expect(out.originalImageId).toBe('orig_1');
    expect(out.tintFill?.type).toBe('radial');
    expect(out.tintFill?.blend).toBe('soft-light');
    expect(out.cornerRadius).toBeCloseTo(0.25);
    expect(out.framing?.zoom).toBeCloseTo(1.5);
    expect(out.cellWidth).toBeCloseTo(4);
  });
});

describe('v62 text fade round-trip', () => {
  it('rides the STYLE, where the ink and its alpha already live', () => {
    const [out] = roundTrip([], [], [makeText('txt_1', {
      fade: 0.5, fadeColor: { r: 7, g: 7, b: 7 }, alpha: 0.4,
    })]).texts;
    expect(out.style.fade).toBeCloseTo(0.5, 2);
    expect(out.style.fadeColor).toEqual({ r: 7, g: 7, b: 7 });
    // The alpha beside it is untouched: two different rows of one page.
    expect(out.style.alpha).toBeCloseTo(0.4, 2);
  });

  it('leaves untouched text with neither field and no extra bytes', () => {
    const [out] = roundTrip([], [], [makeText('txt_1')]).texts;
    expect(out.style.fade).toBeUndefined();
    const bare = serializeComposition(makeBundle([], [], [makeText('txt_1')]), []);
    const zeroed = serializeComposition(makeBundle([], [], [makeText('txt_1', { fade: 0 })]), []);
    expect(zeroed.length).toBe(bare.length);
  });
});
