/**
 * The v73 binary format extension: a line style's TINT
 * (`LineStyleEffect.tint`) — how far the path's ink shifts the art's own
 * colours — one byte at the end of the line-style block, after the art,
 * read by version. Mirrors binaryFormatV72LineStyleArt.test.ts for the
 * block it extends.
 */

import {
  CompositionBundle, deserializeComposition, serializeComposition,
} from '../compositionBinaryFormat';
import { LineStyleArtPath, LineStyleEffect, SVGObject } from '../types';

function makeBundle(svgObjects: SVGObject[]): CompositionBundle {
  return {
    name: 'Test', gridLevel: 1, strokeScale: 0.2, gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [], svgObjects, images: [], imageBlobs: {}, texts: [],
    sceneOrder: svgObjects.map((s) => s.id),
  };
}

const art: LineStyleArtPath[] = [{ points: [[0, 0], [1, 1]], color: { r: 200, g: 10, b: 20 }, width: 0.1 }];

const drawn = (extras: Partial<LineStyleEffect> = {}): LineStyleEffect => ({
  glyph: 'custom', density: 0.5, size: 0.5, rotation: 0,
  randomPlacement: 0, randomRotation: 0, randomSize: 0, art,
  ...extras,
});

const write = (lineStyle: LineStyleEffect): Uint8Array => serializeComposition(makeBundle([{
  id: 'a', segments: [{ kind: 'line', start: [0, 0], end: [4, 0] }], color: { r: 255, g: 160, b: 50 },
  cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 1, effects: { lineStyle },
}]), []);

const roundTrip = (lineStyle: LineStyleEffect): LineStyleEffect =>
  deserializeComposition(write(lineStyle)).meta.svgObjects![0].effects!.lineStyle!;

describe('v73: a line style’s tint', () => {
  test('round-trips to the nearest 1/255, none at all included', () => {
    expect(roundTrip(drawn({ tint: 0 })).tint).toBe(0);
    expect(roundTrip(drawn({ tint: 0.5 })).tint).toBeCloseTo(0.5, 2);
    expect(roundTrip(drawn({ tint: 0.25 })).tint).toBeCloseTo(0.25, 2);
  });

  test('the whole shift is the absent field: unsaid, 1, or past it reads back with no tint', () => {
    for (const style of [drawn(), drawn({ tint: 1 }), drawn({ tint: 3 }), drawn({ tint: Number.NaN })]) {
      expect('tint' in roundTrip(style)).toBe(false);
    }
  });

  test('costs one byte whatever it says, and leaves the art as it was', () => {
    expect(write(drawn({ tint: 0.5 })).length).toBe(write(drawn()).length);
    const got = roundTrip(drawn({ tint: 0.5 }));
    expect(got.art).toHaveLength(1);
    expect(got.art![0].color).toEqual(art[0].color);
  });

  test('a v72 file — the block with no tint byte — reads as the whole shift, and everything after it stands where it did', () => {
    const custom: [number, number][][] = [[[0.1, 0.1], [0.9, 0.9]]];
    const { art: _none, ...padded } = drawn({ custom, tint: 0.5 });
    const now = write(padded);
    expect(new DataView(now.buffer, now.byteOffset, now.byteLength).getUint16(4, true)).toBe(73);
    // strokeCount 1, pointCount 2 (u16), the two points, the art count, then the tint.
    const run = [1, 2, 0, 26, 26, 230, 230, 0, 128];
    let at = -1;
    for (let i = 0; i <= now.length - run.length && at < 0; i++) if (run.every((b, j) => now[i + j] === b)) at = i;
    expect(at).toBeGreaterThan(0);
    const v72 = new Uint8Array(now.length - 1);
    v72.set(now.subarray(0, at + 8));
    v72.set(now.subarray(at + 9), at + 8);
    new DataView(v72.buffer).setUint16(4, 72, true);
    const parsed = deserializeComposition(v72);
    const got = parsed.meta.svgObjects![0].effects!.lineStyle!;
    expect(got.custom).toHaveLength(1);
    expect('tint' in got).toBe(false);
    expect(parsed.meta.name).toBe('Test');
    // …where today's file keeps it.
    expect(deserializeComposition(now).meta.svgObjects![0].effects!.lineStyle!.tint).toBeCloseTo(0.5, 2);
  });
});
