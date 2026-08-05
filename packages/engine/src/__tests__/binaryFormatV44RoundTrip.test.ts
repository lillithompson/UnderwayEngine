/**
 * Tests for the v44 binary format extension — the two fidelity leaks that
 * made a .tile export → reimport come back visibly different:
 *
 *  (a) `border.position` / `border.dash` and `shadow.spread` were authored by
 *      the Border / Shadow bars but never serialized. A border exported as
 *      'outside' came back 'center', so the stroked rect shrank by a full
 *      stroke width in each dimension; dashes came back solid.
 *  (b) A text bbox was stored as quarter-cell fixed-point. Because a text
 *      box's width IS its wrap width, rounding it re-flowed the paragraph —
 *      lines broke in different places on reimport.
 *
 * Mirrors binaryFormatV42Opacity.test.ts for the opacity payload.
 */

import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { borderRectGeometry } from '../paintSvg';
import { ImageObject, NodeEffects, PathSegment, SVGObject, TextObject } from '../types';

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

function makeText(id: string, extras: Partial<TextObject> = {}): TextObject {
  return {
    id,
    content: 'the quick brown fox jumps over the lazy dog',
    style: { fontId: 'serif', size: 1.5, color: { r: 20, g: 30, b: 40 } },
    cellX: 2, cellY: 3, cellWidth: 12, cellHeight: 4,
    ...extras,
  };
}

function makeBundle(
  svgObjects: SVGObject[],
  images: ImageObject[] = [],
  texts: TextObject[] = [],
): CompositionBundle {
  return {
    name: 'Test', gridLevel: 1, strokeScale: 0.2, gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [],
    svgObjects,
    images,
    imageBlobs: Object.fromEntries(images.map((i) => [i.imageId, new Uint8Array([1, 2, 3])])),
    texts,
    sceneOrder: [
      ...svgObjects.map((s) => s.id),
      ...images.map((i) => i.id),
      ...texts.map((t) => t.id),
    ],
  };
}

function roundTrip(
  svgObjects: SVGObject[],
  images: ImageObject[] = [],
  texts: TextObject[] = [],
) {
  const bytes = serializeComposition(makeBundle(svgObjects, images, texts), []);
  const meta = deserializeComposition(bytes).meta;
  return { svgs: meta.svgObjects ?? [], images: meta.images ?? [], texts: meta.texts ?? [] };
}

function byteLength(
  svgObjects: SVGObject[],
  images: ImageObject[] = [],
  texts: TextObject[] = [],
): number {
  return serializeComposition(makeBundle(svgObjects, images, texts), []).byteLength;
}

// ── (a) Effects payload: border position / dash, shadow spread ───────────

describe('v44 effects extensions', () => {
  const fullBorder: NodeEffects = {
    border: {
      width: 0.375,
      color: { r: 214, g: 40, b: 40 },
      radius: 0.5,
      position: 'outside',
      dash: 6,
    },
  };

  it('round-trips border position and dash on an SVG record', () => {
    const { svgs } = roundTrip([makeSVG('s1', { effects: fullBorder })]);
    expect(svgs[0].effects?.border).toEqual(fullBorder.border);
  });

  it('round-trips border position and dash on an image record', () => {
    const { images } = roundTrip([], [makeImage('i1', { effects: fullBorder })]);
    expect(images[0].effects?.border).toEqual(fullBorder.border);
  });

  it('round-trips border position and dash on a text record', () => {
    const { texts } = roundTrip([], [], [makeText('t1', { effects: fullBorder })]);
    expect(texts[0].effects?.border).toEqual(fullBorder.border);
  });

  it.each(['inside', 'center', 'outside'] as const)('round-trips position %s', (position) => {
    const { svgs } = roundTrip([
      makeSVG('s1', { effects: { border: { width: 1, color: { r: 0, g: 0, b: 0 }, position } } }),
    ]);
    expect(svgs[0].effects?.border?.position).toBe(position);
  });

  it('preserves the drawn border rect — the reported "border is slightly smaller"', () => {
    const bbox = { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 6 };
    const border = { width: 1, color: { r: 0, g: 0, b: 0 }, position: 'outside' as const };
    const { svgs } = roundTrip([makeSVG('s1', { effects: { border } })]);

    expect(borderRectGeometry(
      svgs[0].effects!.border!.width,
      svgs[0].effects!.border!.position,
      0,
      bbox,
    )).toEqual(borderRectGeometry(border.width, border.position, 0, bbox));
  });

  it('round-trips shadow spread', () => {
    const shadow = {
      dx: 0.75, dy: 0.875, blur: 1.125, spread: 0.125,
      color: { r: 0, g: 0, b: 0 }, alpha: 0.4,
    };
    const { svgs } = roundTrip([makeSVG('s1', { effects: { shadow } })]);
    expect(svgs[0].effects?.shadow?.spread).toBeCloseTo(0.125, 6);
  });

  it('keeps a negative (eroding) spread', () => {
    const shadow = {
      dx: 0, dy: 0, blur: 1, spread: -0.25,
      color: { r: 0, g: 0, b: 0 }, alpha: 0.4,
    };
    const { svgs } = roundTrip([makeSVG('s1', { effects: { shadow } })]);
    expect(svgs[0].effects?.shadow?.spread).toBeCloseTo(-0.25, 6);
  });

  it('writes no extension bytes for a plain border or a spreadless shadow', () => {
    const plain: NodeEffects = {
      border: { width: 0.5, color: { r: 1, g: 2, b: 3 } },
      shadow: { dx: 1, dy: 1, blur: 2, color: { r: 0, g: 0, b: 0 }, alpha: 0.5 },
    };
    const withZeroSpread: NodeEffects = {
      border: { width: 0.5, color: { r: 1, g: 2, b: 3 } },
      shadow: { dx: 1, dy: 1, blur: 2, spread: 0, color: { r: 0, g: 0, b: 0 }, alpha: 0.5 },
    };
    // A zero spread renders as the plain drop shadow, so it must cost nothing.
    expect(byteLength([makeSVG('s1', { effects: withZeroSpread })]))
      .toBe(byteLength([makeSVG('s1', { effects: plain })]));

    const { svgs } = roundTrip([makeSVG('s1', { effects: plain })]);
    expect(svgs[0].effects?.border?.position).toBeUndefined();
    expect(svgs[0].effects?.border?.dash).toBeUndefined();
    expect(svgs[0].effects?.shadow?.spread).toBeUndefined();
  });

  it('carries position without dash and dash without position', () => {
    const { svgs } = roundTrip([
      makeSVG('a', { effects: { border: { width: 1, color: { r: 0, g: 0, b: 0 }, position: 'inside' } } }),
      makeSVG('b', { effects: { border: { width: 1, color: { r: 0, g: 0, b: 0 }, dash: 3 } } }),
    ]);
    expect(svgs[0].effects?.border?.position).toBe('inside');
    expect(svgs[0].effects?.border?.dash).toBeUndefined();
    expect(svgs[1].effects?.border?.position).toBeUndefined();
    expect(svgs[1].effects?.border?.dash).toBe(3);
  });

  it('coexists with the other optional blocks on one record', () => {
    const svg = makeSVG('s1', {
      angleDeg: 12.5,
      opacity: 0.5,
      stroke: { width: 0.5, position: 'inside', dash: 2 },
      effects: {
        glow: { radius: 1.5, color: { r: 9, g: 9, b: 9 }, alpha: 0.6 },
        shadow: { dx: 1, dy: 2, blur: 3, spread: 0.5, color: { r: 4, g: 5, b: 6 }, alpha: 0.5 },
        border: { width: 0.25, color: { r: 7, g: 8, b: 9 }, radius: 1, position: 'inside', dash: 10 },
      },
    });
    const { svgs } = roundTrip([svg]);
    expect(svgs[0].effects?.border).toEqual(svg.effects!.border);
    expect(svgs[0].effects?.shadow?.spread).toBeCloseTo(0.5, 6);
    expect(svgs[0].effects?.glow?.radius).toBeCloseTo(1.5, 6);
    expect(svgs[0].stroke).toEqual(svg.stroke);
    expect(svgs[0].angleDeg).toBeCloseTo(12.5, 2);
  });
});

// ── (b) Text bbox precision ─────────────────────────────────────────────

describe('v44 text bbox precision', () => {
  it('round-trips a fractional bbox exactly enough to preserve wrapping', () => {
    const text = makeText('t1', {
      cellX: 3.1234, cellY: 4.5678, cellWidth: 12.3456, cellHeight: 6.789,
      fixedSize: true,
    });
    const { texts } = roundTrip([], [], [text]);
    // Quarter-cell fixed point rounded 12.3456 to 12.25 — enough to re-flow
    // the paragraph. f32 keeps ~7 significant digits.
    expect(texts[0].cellX).toBeCloseTo(3.1234, 4);
    expect(texts[0].cellY).toBeCloseTo(4.5678, 4);
    expect(texts[0].cellWidth).toBeCloseTo(12.3456, 4);
    expect(texts[0].cellHeight).toBeCloseTo(6.789, 4);
  });

  it('round-trips the local and identity bboxes at the same precision', () => {
    const text = makeText('t1', {
      groupId: 'g1',
      localCellX: -1.3125, localCellY: 0.1875,
      localCellWidth: 7.6543, localCellHeight: 2.8125,
      identityCellX: 0.6789, identityCellY: 1.2345,
      identityCellWidth: 9.8765, identityCellHeight: 3.4321,
    });
    const { texts } = roundTrip([], [], [text]);
    expect(texts[0].localCellX).toBeCloseTo(-1.3125, 4);
    expect(texts[0].localCellY).toBeCloseTo(0.1875, 4);
    expect(texts[0].localCellWidth).toBeCloseTo(7.6543, 4);
    expect(texts[0].localCellHeight).toBeCloseTo(2.8125, 4);
    expect(texts[0].identityCellX).toBeCloseTo(0.6789, 4);
    expect(texts[0].identityCellY).toBeCloseTo(1.2345, 4);
    expect(texts[0].identityCellWidth).toBeCloseTo(9.8765, 4);
    expect(texts[0].identityCellHeight).toBeCloseTo(3.4321, 4);
  });

  it('keeps a negative origin (a box left of / above the canvas origin)', () => {
    const { texts } = roundTrip([], [], [makeText('t1', { cellX: -8.375, cellY: -2.625 })]);
    expect(texts[0].cellX).toBeCloseTo(-8.375, 6);
    expect(texts[0].cellY).toBeCloseTo(-2.625, 6);
  });

  it('keeps a box wider than the old u16 fixed-point range', () => {
    // encodeFixed(20000) overflowed u16 and wrapped; f32 has no such ceiling.
    const { texts } = roundTrip([], [], [makeText('t1', { cellWidth: 20000.5, cellHeight: 3 })]);
    expect(texts[0].cellWidth).toBeCloseTo(20000.5, 2);
  });

  it('survives repeated round-trips without drift', () => {
    let text = makeText('t1', { cellX: 1.7, cellY: 2.3, cellWidth: 11.9, cellHeight: 4.1 });
    for (let i = 0; i < 5; i++) {
      text = roundTrip([], [], [text]).texts[0];
    }
    expect(text.cellX).toBeCloseTo(1.7, 4);
    expect(text.cellWidth).toBeCloseTo(11.9, 4);
  });

  /**
   * A real v43 file, produced by the serializer as it stood before this
   * change, holding one text object (bbox 2.5 / 3.25 / 12.75 / 4.5 — all
   * exact quarter cells, so fixed-point stored them losslessly) with a name,
   * a rotation, a border and a shadow. Every `.tile` a user already has on
   * disk is one of these, so it must keep loading byte-for-byte as it did.
   */
  const V43_TEXT_FILE =
    'RkNNUCsAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8D+amZmZmZnJPzMzMzMzM9M/BQAGAExl' +
    'Z2FjeQIAdDEHAENhcHRpb24TAHRoZSBxdWljayBicm93biBmb3gFAHNlcmlmAAAAAAAAAAAAAAEA' +
    'AQAIFAECAAMACgANADMAEgAEAAAAwD8AFB4oBQAAgD8AAABAAABAQAQFBoAAAMA+1igoAQAAAD8B' +
    'AAEAAAAAAAAAAA==';

  it('still reads a v43 text record (quarter-cell fixed-point bbox)', () => {
    const bytes = Uint8Array.from(Buffer.from(V43_TEXT_FILE, 'base64'));
    // Guard the fixture itself: if this stops saying 43, it is no longer
    // testing the legacy path.
    expect(new DataView(bytes.buffer, bytes.byteOffset).getUint16(4, true)).toBe(43);

    const text = deserializeComposition(bytes).meta.texts![0];
    expect(text.cellX).toBe(2.5);
    expect(text.cellY).toBe(3.25);
    expect(text.cellWidth).toBe(12.75);
    expect(text.cellHeight).toBe(4.5);
    expect(text.name).toBe('Caption');
    expect(text.rotation).toBe(90);
    expect(text.fixedSize).toBe(true);
    expect(text.content).toBe('the quick brown fox');
    // The v29 border/shadow fields still decode; the v44 extensions are
    // absent, as they were never written.
    expect(text.effects?.border?.width).toBeCloseTo(0.375, 6);
    expect(text.effects?.border?.radius).toBeCloseTo(0.5, 6);
    expect(text.effects?.border?.position).toBeUndefined();
    expect(text.effects?.border?.dash).toBeUndefined();
    expect(text.effects?.shadow?.blur).toBeCloseTo(3, 6);
    expect(text.effects?.shadow?.spread).toBeUndefined();
  });

  it('preserves the rest of the text record alongside the wider bbox', () => {
    const text = makeText('t1', {
      cellWidth: 12.3456,
      name: 'Caption',
      rotation: 90,
      angleDeg: -7.25,
      fixedSize: true,
      sticker: true,
      style: {
        fontId: 'display', size: 2.25, color: { r: 1, g: 2, b: 3 },
        bold: true, align: 'center', letterSpacing: 0.05, lineHeight: 1.4,
        weight: 'semibold', stroke: { width: 0.2, color: { r: 9, g: 8, b: 7 } },
      },
    });
    const { texts } = roundTrip([], [], [text]);
    expect(texts[0].cellWidth).toBeCloseTo(12.3456, 4);
    expect(texts[0].name).toBe('Caption');
    expect(texts[0].rotation).toBe(90);
    expect(texts[0].angleDeg).toBeCloseTo(-7.25, 2);
    expect(texts[0].fixedSize).toBe(true);
    expect(texts[0].sticker).toBe(true);
    expect(texts[0].style.align).toBe('center');
    expect(texts[0].style.weight).toBe('semibold');
    expect(texts[0].style.letterSpacing).toBeCloseTo(0.05, 6);
    expect(texts[0].style.stroke?.width).toBeCloseTo(0.2, 6);
  });
});
