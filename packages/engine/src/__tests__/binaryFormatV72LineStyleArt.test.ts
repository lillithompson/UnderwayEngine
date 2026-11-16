/**
 * The v72 binary format extension: a line style's ART
 * (`LineStyleEffect.art`) — the drawn glyph as paths that each keep their
 * own outline colour and width, fill and opacity — written inside the v71
 * line-style block, right after the pad's strokes, and read by version.
 * Mirrors binaryFormatV71LineStyle.test.ts for the block it extends.
 */

import {
  CompositionBundle, deserializeComposition, serializeComposition,
} from '../compositionBinaryFormat';
import { LineStyleArtPath, LineStyleEffect, PathSegment, SVGObject } from '../types';

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

const drawn = (extras: Partial<LineStyleEffect> = {}): LineStyleEffect => ({
  glyph: 'custom', density: 0.5, size: 0.5, rotation: 0,
  randomPlacement: 0, randomRotation: 0, randomSize: 0,
  ...extras,
});

const write = (lineStyle: LineStyleEffect, more: SVGObject[] = []): Uint8Array =>
  serializeComposition(makeBundle([makeSVG('a', { effects: { lineStyle } }), ...more]), []);

const readStyle = (bytes: Uint8Array): LineStyleEffect =>
  deserializeComposition(bytes).meta.svgObjects![0].effects!.lineStyle!;

const roundTrip = (lineStyle: LineStyleEffect): LineStyleEffect => readStyle(write(lineStyle));

const RED = { r: 200, g: 10, b: 20 };
const BLUE = { r: 5, g: 60, b: 220 };

/** Where a run of bytes stands in a file, or -1. */
function indexOfBytes(bytes: Uint8Array, run: number[]): number {
  for (let i = 0; i <= bytes.length - run.length; i++) {
    if (run.every((b, j) => bytes[i + j] === b)) return i;
  }
  return -1;
}

describe('v72: a line style’s art', () => {
  test('a path round-trips every field it carries, its points to the nearest 1/65535 of the unit square', () => {
    const art: LineStyleArtPath[] = [
      { points: [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3333]], color: RED, width: 0.0125, fill: BLUE, opacity: 0.4, fillOpacity: 0.8 },
    ];
    const got = roundTrip(drawn({ art }));
    expect(got.glyph).toBe('custom');
    expect(got.art).toHaveLength(1);
    const [path] = got.art!;
    expect(path.color).toEqual(RED);
    expect(path.width).toBeCloseTo(0.0125, 6);
    expect(path.fill).toEqual(BLUE);
    expect(path.opacity).toBeCloseTo(0.4, 2);
    expect(path.fillOpacity).toBeCloseTo(0.8, 2);
    expect(path.points).toHaveLength(3);
    art[0].points.forEach(([x, y], j) => {
      expect(path.points[j][0]).toBeCloseTo(x, 4);
      expect(path.points[j][1]).toBeCloseTo(y, 4);
    });
    // Finer than the pad strokes' u8s: a third survives past 1/255.
    expect(Math.abs(path.points[2][1] - 0.3333)).toBeLessThan(1 / 65535);
  });

  test('each optional field is there only when it was: an absent one costs no bytes and reads back absent', () => {
    const points: [number, number][] = [[0, 0], [1, 1]];
    const cases: { path: LineStyleArtPath; keys: string[]; bytes: number }[] = [
      { path: { points, color: RED, width: 0.1 }, keys: ['color', 'points', 'width'], bytes: 7 },
      { path: { points, fill: BLUE }, keys: ['fill', 'points'], bytes: 3 },
      { path: { points, fill: BLUE, fillOpacity: 0.5 }, keys: ['fill', 'fillOpacity', 'points'], bytes: 4 },
      { path: { points, fill: BLUE, opacity: 0.5 }, keys: ['fill', 'opacity', 'points'], bytes: 4 },
      { path: { points, color: RED, width: 0.1, fill: BLUE, opacity: 0.5, fillOpacity: 0.5 }, keys: ['color', 'fill', 'fillOpacity', 'opacity', 'points', 'width'], bytes: 12 },
    ];
    const bare = write(drawn()).length;
    for (const { path, keys, bytes } of cases) {
      const file = write(drawn({ art: [path] }));
      expect(Object.keys(readStyle(file).art![0]).sort()).toEqual(keys);
      // flags u8 + the paint the flags name + pointCount u16 + two points of two u16s.
      expect(file.length - bare).toBe(1 + bytes + 2 + 8);
    }
  });

  test('paths keep their order, and ride beside the pad’s strokes they outrank', () => {
    const custom: [number, number][][] = [[[0.1, 0.1], [0.9, 0.9]]];
    const art: LineStyleArtPath[] = [
      { points: [[0, 0], [1, 0], [1, 1]], fill: RED },
      { points: [[0, 1], [1, 1]], color: BLUE, width: 0.05 },
      { points: [[0.5, 0], [0.5, 1]], fill: BLUE },
    ];
    const got = roundTrip(drawn({ custom, art }));
    expect(got.custom).toHaveLength(1);
    expect(got.art!.map((p) => p.fill ?? p.color)).toEqual([RED, BLUE, BLUE]);
    expect(got.art!.map((p) => p.points.length)).toEqual([3, 2, 2]);
  });

  test('a style without art is the record it always was: no `art` key, and one zero byte on the wire', () => {
    const custom: [number, number][][] = [[[0.1, 0.1], [0.9, 0.9]]];
    expect('art' in roundTrip(drawn({ custom }))).toBe(false);
    expect('art' in roundTrip(drawn({ custom, art: [] }))).toBe(false);
    expect(write(drawn({ custom, art: [] })).length).toBe(write(drawn({ custom })).length);
    // A built-in glyph writes no art even with a drawing remembered beside it.
    const heart = roundTrip(drawn({ glyph: 'heart', art: [{ points: [[0, 0], [1, 1]], fill: RED }] }));
    expect('art' in heart).toBe(false);
  });

  test('what can never draw is not written: a path with no paint, an opaque opacity, a point that is not one', () => {
    const got = roundTrip(drawn({ art: [
      { points: [[0, 0], [1, 1]] },
      { points: [[0, 0], [1, 1]], color: RED },
      { points: [[0, 0], [NaN, 0.5], [1, 1]], color: RED, width: 0.1, opacity: 1, fillOpacity: 0.5 },
    ] }));
    expect(got.art).toHaveLength(1);
    expect(got.art![0].points).toEqual([[0, 0], [1, 1]]);
    expect(Object.keys(got.art![0]).sort()).toEqual(['color', 'points', 'width']);
    // A point outside the unit square is held to it.
    expect(roundTrip(drawn({ art: [{ points: [[-2, 0.5], [7, 0.5]], fill: RED }] })).art![0].points)
      .toEqual([[0, expect.closeTo(0.5, 4)], [1, expect.closeTo(0.5, 4)]]);
  });

  test('the objects after a style with art read back untouched', () => {
    const file = write(
      drawn({ art: [{ points: [[0, 0], [1, 0], [1, 1]], color: RED, width: 0.1, fill: BLUE }] }),
      [makeSVG('b', { effects: { lineStyle: drawn({ glyph: 'sparkle', size: 1 }) } }), makeSVG('c')],
    );
    const svgs = deserializeComposition(file).meta.svgObjects!;
    expect(svgs.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(svgs[1].effects!.lineStyle).toMatchObject({ glyph: 'sparkle', size: 1 });
    expect(svgs[2].segments).toHaveLength(2);
  });
});

describe('v72: a v71 file reads exactly as before', () => {
  // A v71 line-style block ends at its strokes. Today's writer's block for
  // a style with no art is that block, one zero byte (the art count, v72)
  // and the tint's byte (255, v73), so taking the two out and turning the
  // version back is the v71 file.
  const custom: [number, number][][] = [[[0.1, 0.1], [0.9, 0.9]]];
  const asV71 = (): Uint8Array => {
    const v72 = write(drawn({ custom }), [makeSVG('b')]);
    // strokeCount 1, pointCount 2 (u16), the two points, then the art count and the tint.
    const at = indexOfBytes(v72, [1, 2, 0, 26, 26, 230, 230, 0, 255]);
    expect(at).toBeGreaterThan(0);
    const v71 = new Uint8Array(v72.length - 2);
    v71.set(v72.subarray(0, at + 7));
    v71.set(v72.subarray(at + 9), at + 7);
    new DataView(v71.buffer).setUint16(4, 71, true);
    return v71;
  };

  test('its line style comes back with its strokes and no art, and everything after it stands where it did', () => {
    const parsed = deserializeComposition(asV71());
    const svgs = parsed.meta.svgObjects!;
    expect(svgs.map((s) => s.id)).toEqual(['a', 'b']);
    const got = svgs[0].effects!.lineStyle!;
    expect(got.glyph).toBe('custom');
    expect(got.custom).toHaveLength(1);
    expect(got.custom![0][1][0]).toBeCloseTo(0.9, 2);
    expect('art' in got).toBe(false);
    expect(svgs[1].segments).toHaveLength(2);
    expect(parsed.meta.name).toBe('Test');
  });

  test('…and no art count is read from it: the same bytes called v72 are a different file', () => {
    // Read as v72 the byte after the strokes would be taken for a count,
    // so the two versions cannot lay the block out alike.
    const mislabelled = asV71();
    new DataView(mislabelled.buffer).setUint16(4, 72, true);
    let same = true;
    try {
      same = deserializeComposition(mislabelled).meta.svgObjects?.map((s) => s.id).join() === 'a,b';
    } catch {
      same = false;
    }
    expect(same).toBe(false);
  });
});

describe('v72: a corrupt file is refused, not misread', () => {
  const art: LineStyleArtPath[] = [{ points: [[0, 0], [1, 1]], color: RED, width: 0.5 }];
  // The one path's block: flags (hasColor), rgb, width f32 0.5, pointCount 2.
  const BLOCK = [0x01, 200, 10, 20, 0, 0, 0, 0x3f, 2, 0];
  const blockAt = (bytes: Uint8Array): number => {
    const at = indexOfBytes(bytes, BLOCK);
    expect(at).toBeGreaterThan(0);
    return at;
  };

  test('a path whose point count claims more bytes than remain throws a clear error', () => {
    const corrupt = new Uint8Array(write(drawn({ art })));
    new DataView(corrupt.buffer).setUint16(blockAt(corrupt) + 8, 0xffff, true);
    expect(() => deserializeComposition(corrupt)).toThrow(/Corrupt \.tile: line style art path 0\/1 claims 65535 points/);
  });

  test('a path count that runs past the file’s end throws rather than reading nothing', () => {
    const bytes = write(drawn({ art }));
    const at = blockAt(bytes);
    // The file cut off inside the second path the count now claims.
    const cut = new Uint8Array(bytes.subarray(0, at + BLOCK.length + 8));
    cut[at - 1] = 2;
    expect(() => deserializeComposition(cut)).toThrow(/Corrupt \.tile: line style art path 1\/2 header runs past file end/);
    // …and cut off before the count itself.
    expect(() => deserializeComposition(new Uint8Array(bytes.subarray(0, at - 1))))
      .toThrow(/Corrupt \.tile: line style art count runs past file end/);
  });

  test('a path whose flags claim more paint than remains throws', () => {
    const bytes = write(drawn({ art }));
    const at = blockAt(bytes);
    const cut = new Uint8Array(bytes.subarray(0, at + 4));
    expect(() => deserializeComposition(cut)).toThrow(/Corrupt \.tile: line style art path 0\/1 header runs past file end/);
  });

  test('a width from outside that is not a positive number drops the outline, and a path left with no paint', () => {
    for (const raw of [NaN, Infinity, 0, -1]) {
      const both = new Uint8Array(write(drawn({ art: [{ ...art[0], fill: BLUE }] })));
      const at = indexOfBytes(both, [0x03, 200, 10, 20, 0, 0, 0, 0x3f]);
      expect(at).toBeGreaterThan(0);
      new DataView(both.buffer).setFloat32(at + 4, raw, true);
      const path = readStyle(both).art![0];
      expect(path.fill).toEqual(BLUE);
      expect('color' in path).toBe(false);
      expect('width' in path).toBe(false);

      const only = new Uint8Array(write(drawn({ art }), [makeSVG('b')]));
      new DataView(only.buffer).setFloat32(blockAt(only) + 4, raw, true);
      const parsed = deserializeComposition(only).meta.svgObjects!;
      expect('art' in parsed[0].effects!.lineStyle!).toBe(false);
      // Its bytes were still read: the next object stands where it did.
      expect(parsed.map((s) => s.id)).toEqual(['a', 'b']);
    }
  });
});
