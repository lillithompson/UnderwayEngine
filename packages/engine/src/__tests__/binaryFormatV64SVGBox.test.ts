/**
 * The v64 binary format extension: an svg's own BOX, when the reader could
 * not have worked it out.
 *
 * Every svg record until now stored no box at all -- the reader derived one
 * with `arcBoundingBox(segments)`. That is right for every shape whose box
 * IS its path's bounds, which is all of them, until a group is pulled off
 * square. Then the stored box is the LOOSE one around the member's mapped
 * rectangle, the path's own bounds are tighter and differently centred, and
 * `leafNodeFromLegacy` makes the stored box's CENTRE the pivot for the free
 * angle and for the shear. Derive the box and the pivot moves; the whole
 * path swings with it.
 *
 * Found by round R12 (`docs/device-rounds-ab.md`), which duplicates a page
 * the way the Notebook does -- `exportCompositionBundle` then
 * `importCompositionBundle`, i.e. out to `.tile` bytes and back -- and
 * measured a sheared member landing up to 0.67 cells from where the page
 * drew it, about 7% of the shape and proportional to it. It went unseen
 * because a shape that FILLS its own box has one box under both spellings,
 * and the `.tile` test that named this case built its page out of rects.
 *
 * The presence bit rides the svg ROTATION byte (0x08), not a flag byte: all
 * four of those are spent, and the rotation byte uses only 0x03 and 0x04.
 * Payload is four f32, LAST in the record, after v63's shear.
 *
 * What this pins is the FORMAT. That a sheared page comes back drawn the way
 * it left is pinned end to end in the host's `shearedGroupMembers.test.ts`.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

import {
  serializeComposition, deserializeComposition, CompositionBundle,
} from '../compositionBinaryFormat';
import { PathSegment, SVGObject } from '../types';
import { patchFormatVersion } from './test-utils';
import { expectNoStoredFade } from './fadeSpent.test-utils';

function line(start: [number, number], end: [number, number]): PathSegment {
  return { kind: 'line', start, end };
}

/** A triangle: three points that do NOT fill their own box corner to
 *  corner, so a box around the path and a box around anything else are
 *  visibly different numbers. */
const TRI: PathSegment[] = [
  line([2, 1], [6, 1]),
  line([6, 1], [4, 5]),
  line([4, 5], [2, 1]),
];
/** …and the box the path's own bounds give: x 2..6, y 1..5. */
const TIGHT = { cellX: 2, cellY: 1, cellWidth: 4, cellHeight: 4 };
/** A LOOSE box around the same path — what a member of a group scaled off
 *  square carries. Differently centred, which is the whole point. */
const LOOSE = { cellX: 0.5, cellY: -1.25, cellWidth: 9.5, cellHeight: 7.75 };

function makeSVG(extras: Partial<SVGObject> = {}): SVGObject {
  return {
    id: 'svg1', segments: TRI, color: { r: 255, g: 160, b: 50 },
    ...TIGHT, ...extras,
  };
}

function makeBundle(svgObjects: SVGObject[]): CompositionBundle {
  return {
    name: 'Boxes', gridLevel: 1, strokeScale: 0.2, gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [], svgObjects, images: [], texts: [],
    paintObjects: [], patternObjects: [], imageBlobs: {},
    sceneOrder: svgObjects.map((o) => o.id),
  } as CompositionBundle;
}

const roundTrip = (svg: SVGObject) =>
  deserializeComposition(serializeComposition(makeBundle([svg]), [])).meta.svgObjects![0];

const boxOf = (o: SVGObject) => ({
  cellX: o.cellX, cellY: o.cellY, cellWidth: o.cellWidth, cellHeight: o.cellHeight,
});

describe('an svg whose box is its path', () => {
  test('comes back with the box derived, and pays nothing for it', () => {
    const back = roundTrip(makeSVG());
    expect(boxOf(back)).toEqual(TIGHT);
    // Not one byte, and not the bit either: the record is what v63 wrote.
    const withBox = serializeComposition(makeBundle([makeSVG()]), []).length;
    const bare = serializeComposition(makeBundle([makeSVG({ id: 'svg1' })]), []).length;
    expect(withBox).toBe(bare);
  });

  test('a v63 reader can still read the record, relabelled', () => {
    // The bit is clear and no payload is appended, so the bytes are a v63
    // record and older readers are untouched by the bump.
    const bytes = serializeComposition(makeBundle([makeSVG()]), []);
    const { meta } = deserializeComposition(patchFormatVersion(bytes, 63));
    expect(boxOf(meta.svgObjects![0])).toEqual(TIGHT);
  });
});

describe('an svg whose box is NOT its path', () => {
  test('keeps the box it was given', () => {
    const back = roundTrip(makeSVG(LOOSE));
    expect(back.cellX).toBeCloseTo(LOOSE.cellX, 5);
    expect(back.cellY).toBeCloseTo(LOOSE.cellY, 5);
    expect(back.cellWidth).toBeCloseTo(LOOSE.cellWidth, 5);
    expect(back.cellHeight).toBeCloseTo(LOOSE.cellHeight, 5);
  });

  test('…which is a DIFFERENT box from the one the reader would derive', () => {
    // Without this the test above would pass on a reader that ignored the
    // block entirely.
    const back = roundTrip(makeSVG(LOOSE));
    expect(back.cellWidth).not.toBeCloseTo(TIGHT.cellWidth, 2);
    expect(back.cellX + back.cellWidth / 2).not.toBeCloseTo(TIGHT.cellX + TIGHT.cellWidth / 2, 2);
  });

  test('costs exactly sixteen bytes', () => {
    const plain = serializeComposition(makeBundle([makeSVG()]), []).length;
    const boxed = serializeComposition(makeBundle([makeSVG(LOOSE)]), []).length;
    expect(boxed - plain).toBe(16);
  });

  test('and the writer is a fixed point — it does not grow on every save', () => {
    const once = serializeComposition(makeBundle([makeSVG(LOOSE)]), []);
    const back = deserializeComposition(once).meta;
    const twice = serializeComposition(back, []);
    expect(Array.from(twice)).toEqual(Array.from(once));
  });
});

describe('the block coexists with everything else last in the record', () => {
  test('with the v63 shear', () => {
    const back = roundTrip(makeSVG({ ...LOOSE, shear: 0.375 }));
    expect(back.shear).toBe(0.375);
    expect(back.cellWidth).toBeCloseTo(LOOSE.cellWidth, 5);
  });

  test('with the v62 fade, the shear, an angle and a name', () => {
    const back = roundTrip(makeSVG({
      ...LOOSE, shear: -0.25, angleDeg: 41.5, name: 'leaning',
      fade: 0.5, fadeColor: { r: 10, g: 20, b: 30 },
    }));
    expect(back.name).toBe('leaning');
    expect(back.angleDeg).toBeCloseTo(41.5, 2);
    expect(back.shear).toBe(-0.25);
    // The fade block is read and then SPENT (engine/fadeBake.ts); what
    // this case is really for is the bytes AFTER it still lining up.
    expectNoStoredFade(back);
    expect(back.cellHeight).toBeCloseTo(LOOSE.cellHeight, 5);
  });

  test('a quarter turn still reads off the same byte the bit rides on', () => {
    // The presence bit sits on the ROTATION byte, so the two must not
    // tread on each other.
    for (const rotation of [0, 90, 180, 270] as const) {
      const back = roundTrip(makeSVG({ ...LOOSE, rotation }));
      expect(back.rotation ?? 0).toBe(rotation);
      expect(back.cellWidth).toBeCloseTo(LOOSE.cellWidth, 5);
    }
  });

  test('a repeat-mode path is left alone — its box is a region it already writes', () => {
    const back = roundTrip(makeSVG({
      ...TIGHT, tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2,
    }));
    expect(back.tileMode).toBe('repeat');
    expect(boxOf(back)).toEqual(TIGHT);
  });
});

describe('every .tile fixture still resaves without paying for the block', () => {
  const TEST_DATA = path.join(__dirname, '../../test_data');
  const TILES = fs.readdirSync(TEST_DATA).filter((f) => f.endsWith('.tile')).sort();

  it.each(TILES)('%s', (rel) => {
    const raw = new Uint8Array(zlib.inflateSync(fs.readFileSync(path.join(TEST_DATA, rel))));
    const { meta, embeddedFiles } = deserializeComposition(raw);
    const resaved = serializeComposition(meta, embeddedFiles);
    const again = deserializeComposition(resaved);
    // A file read back from disk has its box derived from its path, so it
    // matches by construction and not one of these pays a byte.
    expect(serializeComposition(again.meta, again.embeddedFiles).length).toBe(resaved.length);
    for (const o of again.meta.svgObjects ?? []) {
      const src = meta.svgObjects!.find((x) => x.id === o.id)!;
      expect(boxOf(o)).toEqual(boxOf(src));
    }
  });
});
