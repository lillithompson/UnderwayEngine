/**
 * The v63 binary format extension: the `shear` a leaf record carries — the
 * lean a group scaled off its axes puts on a turned member.
 *
 * A box plus an angle describes a turned RECTANGLE; a member of a group
 * pulled off square is a PARALLELOGRAM. `LocalTransform.shear` and the leaf
 * record's own term closed that for a page SAVE (the JSON comp_meta carries
 * a new field for free), but `.tile` serialization writes each kind's fields
 * explicitly, so an EXPORT and re-import still flattened every sheared leaf
 * back to the nearest turned rectangle. v63 is one f32 per kind.
 *
 * Five kinds carry it, each behind a free bit on a flag byte it already had,
 * payload LAST in the record: svg (flags4 0x80), image (flags2 0x20), text
 * (the v57 extension byte, 0x04), pattern (v54 flags3 0x20) and paint
 * (flags2 0x40). One writer and one reader serve all five.
 *
 * What is pinned here is the FORMAT. That the lean drawn on the page is the
 * lean that comes back out is pinned end to end in the host's
 * `shearedGroupMembers.test.ts`, which builds a sheared page through the real
 * builders and asserts the DRAWN quad across a `.tile` round trip.
 *
 * Mirrors binaryFormatV62Fade.test.ts in structure.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { createPaintObjectFromTiles } from '../paintObject';
import { commitCanvasPaint, createCanvasPaintWorking, stampCanvasPaint } from '../canvasPaint';
import {
  CanvasPaintIsland, ImageObject, PaintObject, PathSegment, PatternObject, SVGObject, TextObject,
} from '../types';
import { normalizeDeg } from '../sceneTransform';
import { patchFormatVersion } from './test-utils';

/** A lean that is exact in an f32, so a round trip is toBe-identical and a
 *  failure is a dropped field rather than a rounding argument. */
const LEAN = 0.375;
/** …and one that is not on any obvious grid, for the precision claim. */
const ODD_LEAN = 0.31830988618379;

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
    content: 'hello',
    style: { fontId: 'inter', size: 2, color: { r: 0, g: 0, b: 0 } },
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2,
    ...extras,
  };
}

function makePattern(id: string, extras: Partial<PatternObject> = {}): PatternObject {
  const cells = new Array(4).fill(null);
  cells[1] = {
    type: 'color' as const, r: 200, g: 100, b: 50,
    transform: { rotation: 0 as const, mirrorH: false, mirrorV: false },
  };
  return {
    id,
    cellX: 3, cellY: 1, cellWidth: 6, cellHeight: 4,
    cols: 2, rows: 2, cells,
    ...extras,
  };
}

/** One full-alpha dab, through the real stamp/commit pipeline, so the bytes
 *  are the bytes a paint session produces and the reader's normalization pass
 *  is a pass-through. Lifted from binaryFormatV52PaintObjects.test.ts. */
function dabTiles(): CanvasPaintIsland[] {
  const working = createCanvasPaintWorking(undefined);
  stampCanvasPaint(working, 8.0625, 8.0625, 1, { r: 255, g: 0, b: 0 }, 1);
  const tiles = commitCanvasPaint(working);
  if (!tiles) throw new Error('fixture dab painted nothing');
  return tiles;
}

function makePaint(id: string, extras: Partial<PaintObject> = {}): PaintObject {
  const p = createPaintObjectFromTiles(id, dabTiles());
  if (!p) throw new Error('fixture island had no ink');
  return { ...p, ...extras };
}

function makeBundle(parts: Partial<CompositionBundle> = {}): CompositionBundle {
  const svgObjects = parts.svgObjects ?? [];
  const images = parts.images ?? [];
  const texts = parts.texts ?? [];
  const paintObjects = parts.paintObjects ?? [];
  const patternObjects = parts.patternObjects ?? [];
  return {
    name: 'Test', gridLevel: 1, strokeScale: 0.2, gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [],
    svgObjects, images, texts, paintObjects, patternObjects,
    imageBlobs: Object.fromEntries(images.map((i) => [i.imageId, new Uint8Array([1, 2, 3])])),
    sceneOrder: [
      ...svgObjects.map((o) => o.id), ...images.map((o) => o.id), ...texts.map((o) => o.id),
      ...paintObjects.map((o) => o.id), ...patternObjects.map((o) => o.id),
    ],
    ...parts,
  };
}

function roundTrip(parts: Partial<CompositionBundle>): CompositionBundle {
  return deserializeComposition(serializeComposition(makeBundle(parts), [])).meta;
}

/** The record of each kind, built with `extras` and read back. One shape for
 *  five kinds, so what this pins for one is what the others get. */
const KINDS = [
  {
    name: 'svg',
    build: (extras: Record<string, unknown>) => ({ svgObjects: [makeSVG('svg_1', extras)] }),
    read: (m: CompositionBundle) => m.svgObjects![0] as { shear?: number },
  },
  {
    name: 'image',
    build: (extras: Record<string, unknown>) => ({ images: [makeImage('img_1', extras)] }),
    read: (m: CompositionBundle) => m.images![0] as { shear?: number },
  },
  {
    name: 'text',
    build: (extras: Record<string, unknown>) => ({ texts: [makeText('txt_1', extras)] }),
    read: (m: CompositionBundle) => m.texts![0] as { shear?: number },
  },
  {
    name: 'pattern',
    build: (extras: Record<string, unknown>) => ({ patternObjects: [makePattern('pat_1', extras)] }),
    read: (m: CompositionBundle) => m.patternObjects![0] as { shear?: number },
  },
  {
    name: 'paint',
    build: (extras: Record<string, unknown>) => ({ paintObjects: [makePaint('pnt_1', extras)] }),
    read: (m: CompositionBundle) => m.paintObjects![0] as { shear?: number },
  },
] as const;

describe.each(KINDS)('v63 $name shear round-trip', ({ build, read }) => {
  it('comes back as it went in', () => {
    expect(read(roundTrip(build({ shear: LEAN }))).shear).toBe(LEAN);
  });

  it('keeps a lean that is on no obvious grid, to f32', () => {
    // The lean a real group produces is a ratio of two arbitrary scales.
    expect(read(roundTrip(build({ shear: ODD_LEAN }))).shear).toBeCloseTo(ODD_LEAN, 6);
  });

  it('keeps the SIGN — a lean the other way is a different picture', () => {
    expect(read(roundTrip(build({ shear: -LEAN }))).shear).toBe(-LEAN);
  });

  it('leaves an upright record with no field, and costs it no bytes', () => {
    expect(read(roundTrip(build({}))).shear).toBeUndefined();
    const bare = serializeComposition(makeBundle(build({})), []);
    const zeroed = serializeComposition(makeBundle(build({ shear: 0 })), []);
    // A zero lean is no lean at all: omitted, not written as 0.
    expect(zeroed.length).toBe(bare.length);
    expect(read(deserializeComposition(zeroed).meta).shear).toBeUndefined();
  });

  it('costs exactly four bytes on the wire when there IS a lean', () => {
    const without = serializeComposition(makeBundle(build({})), []);
    const with_ = serializeComposition(makeBundle(build({ shear: LEAN })), []);
    expect(with_.length - without.length).toBe(4);
  });

  it('is the v62 record byte for byte when there is no lean', () => {
    // Which is every record in every file anyone has made. The presence bit
    // is clear and no payload follows it, so relabelling the file v62 leaves
    // a reader nothing to go looking for: same bytes, and the record still
    // reads with no lean.
    //
    // Note what is NOT claimed: a v62 reader cannot be handed a file that
    // DOES carry a lean. patchFormatVersion only relabels, and the bytes it
    // would be relabelling are ones no v62 writer could have produced — the
    // reader would skip a payload that is there and take the next record
    // with it. That is the version gate working, not a compatibility hole.
    const bytes = serializeComposition(makeBundle(build({})), []);
    const asV62 = patchFormatVersion(bytes, 62);
    expect([...asV62]).toEqual([...bytes].map((b, i) => (i === 4 ? 62 : b)));
    expect(read(deserializeComposition(asV62).meta).shear).toBeUndefined();
  });
});

describe('v63 shear alongside the rest of the record', () => {
  it('coexists with every other optional SVG block it shares a record with', () => {
    // Written LAST, after the v62 fade — this is the case that catches the
    // stream falling out of sync.
    const [out] = roundTrip({
      svgObjects: [makeSVG('svg_1', {
        shear: LEAN,
        fade: 0.75,
        fadeColor: { r: 9, g: 8, b: 7 },
        opacity: 0.5,
        endpoints: { startMarker: 'circle', endCap: 'square' },
        stroke: { width: 0.375, dash: 3 },
        angleDeg: 12,
        name: 'leany',
        hidden: true,
      })],
    }).svgObjects!;
    expect(out.shear).toBe(LEAN);
    expect(out.fade).toBeCloseTo(0.75, 2);
    expect(out.fadeColor).toEqual({ r: 9, g: 8, b: 7 });
    expect(out.opacity).toBeCloseTo(0.5, 2);
    expect(out.endpoints).toEqual({ startMarker: 'circle', endCap: 'square' });
    expect(out.stroke).toEqual({ width: 0.375, dash: 3 });
    expect(out.angleDeg).toBeCloseTo(12, 1);
    expect(out.name).toBe('leany');
    expect(out.hidden).toBe(true);
    // Geometry survived the extra payload — i.e. the stream stayed in sync.
    expect(out.segments).toHaveLength(2);
    expect(out.cellWidth).toBeCloseTo(4);
  });

  it('coexists with the image blocks that follow the flags2 byte', () => {
    const [out] = roundTrip({
      images: [makeImage('img_1', {
        shear: -0.25,
        fade: 0.5,
        originalImageId: 'orig_1',
        cornerRadius: 0.25,
        framing: { mode: 'fill', zoom: 1.5 },
        angleDeg: 41,
      })],
    }).images!;
    expect(out.shear).toBe(-0.25);
    expect(out.fade).toBeCloseTo(0.5, 2);
    expect(out.originalImageId).toBe('orig_1');
    expect(out.cornerRadius).toBeCloseTo(0.25);
    expect(out.framing?.zoom).toBeCloseTo(1.5);
    expect(out.angleDeg).toBeCloseTo(41, 1);
    expect(out.cellWidth).toBeCloseTo(4);
  });

  it('rides the TEXT, not the style — and leaves the bend beside it alone', () => {
    const [out] = roundTrip({
      texts: [makeText('txt_1', {
        shear: LEAN,
        angleDeg: 29,
        style: {
          fontId: 'lora', size: 2, color: { r: 1, g: 2, b: 3 },
          bend: 0.4, fade: 0.5, alpha: 0.6, vAlign: 'middle',
        },
      })],
    }).texts!;
    expect(out.shear).toBe(LEAN);
    expect((out.style as { shear?: number }).shear).toBeUndefined();
    expect(out.style.bend).toBeCloseTo(0.4, 6);
    expect(out.style.fade).toBeCloseTo(0.5, 2);
    expect(out.style.alpha).toBeCloseTo(0.6, 2);
    expect(out.style.vAlign).toBe('middle');
    expect(out.angleDeg).toBeCloseTo(29, 1);
    expect(out.content).toBe('hello');
  });

  it('coexists with a pattern’s cells, symmetry and tile fields', () => {
    // The pattern payload is written after the filled cells, which are the
    // variable-length block most likely to desync the stream.
    const [out] = roundTrip({
      patternObjects: [makePattern('pat_1', {
        shear: ODD_LEAN,
        angleDeg: 33.5,
        rotation: 180,
        opacity: 0.5,
        tileMode: 'repeat', tileWidthL0: 3, tileHeightL0: 2,
        tileOffsetXL0: 1.5, tileOffsetYL0: -0.5,
        stroke: { width: 0.25 },
      })],
    }).patternObjects!;
    expect(out.shear).toBeCloseTo(ODD_LEAN, 6);
    expect(out.angleDeg).toBeCloseTo(33.5, 6);
    expect(out.rotation).toBe(180);
    expect(out.opacity).toBeCloseTo(0.5, 6);
    expect(out.tileWidthL0).toBe(3);
    expect(out.tileOffsetYL0).toBe(-0.5);
    expect(out.stroke).toEqual({ width: 0.25 });
    expect(out.cells[1]).toMatchObject({ type: 'color', r: 200, g: 100, b: 50 });
    expect(out.cells[0]).toBeNull();
  });

  it('coexists with a paint object’s tiles', () => {
    const [out] = roundTrip({
      paintObjects: [makePaint('pnt_1', { shear: LEAN, angleDeg: 17, opacity: 0.5 })],
    }).paintObjects!;
    expect(out.shear).toBe(LEAN);
    expect(out.angleDeg).toBeCloseTo(17, 6);
    expect(out.opacity).toBeCloseTo(0.5, 6);
    expect(out.tiles.length).toBeGreaterThan(0);
  });

  it('keeps five leans apart across five records in one file', () => {
    // One stream, every kind, each with its own lean — the case where a
    // section that reads one byte too many or too few takes the next one
    // with it.
    const meta = roundTrip({
      svgObjects: [makeSVG('svg_1', { shear: 0.125 })],
      images: [makeImage('img_1', { shear: 0.25 })],
      texts: [makeText('txt_1', { shear: 0.5 })],
      patternObjects: [makePattern('pat_1', { shear: -0.75 })],
      paintObjects: [makePaint('pnt_1', { shear: -0.125 })],
    });
    expect(meta.svgObjects![0].shear).toBe(0.125);
    expect(meta.images![0].shear).toBe(0.25);
    expect(meta.texts![0].shear).toBe(0.5);
    expect(meta.patternObjects![0].shear).toBe(-0.75);
    expect(meta.paintObjects![0].shear).toBe(-0.125);
  });

  it('keeps a sheared record and an upright one apart, side by side', () => {
    const meta = roundTrip({
      images: [
        makeImage('img_leaning', { shear: LEAN }),
        makeImage('img_upright'),
        makeImage('img_other_way', { shear: -ODD_LEAN }),
      ],
    });
    expect(meta.images![0].shear).toBe(LEAN);
    expect(meta.images![1].shear).toBeUndefined();
    expect(meta.images![2].shear).toBeCloseTo(-ODD_LEAN, 6);
    // …and the boxes beside them are untouched by any of it.
    for (const img of meta.images!) expect(img.cellWidth).toBeCloseTo(4);
  });
});

describe('a file written before v63', () => {
  it('is unchanged byte for byte by the version bump', () => {
    // Every page anyone has ever made is upright, so the whole of v63 must
    // be invisible to it: same length, same bytes, one version number apart.
    const parts = {
      svgObjects: [makeSVG('svg_1', { angleDeg: 20, opacity: 0.5 })],
      images: [makeImage('img_1', { angleDeg: -13 })],
      texts: [makeText('txt_1')],
      patternObjects: [makePattern('pat_1')],
      paintObjects: [makePaint('pnt_1')],
    };
    const bytes = serializeComposition(makeBundle(parts), []);
    const asV62 = patchFormatVersion(bytes, 62);
    expect(asV62.length).toBe(bytes.length);
    // Only the two version bytes in the header differ.
    const differing = [...bytes].flatMap((b, i) => (b === asV62[i] ? [] : [i]));
    expect(differing).toEqual([4]);
  });

  it('still opens, with every field it did carry intact', () => {
    const parts = {
      svgObjects: [makeSVG('svg_1', { angleDeg: 20, name: 'plain' })],
      images: [makeImage('img_1', { angleDeg: -13 })],
      texts: [makeText('txt_1')],
      patternObjects: [makePattern('pat_1')],
      paintObjects: [makePaint('pnt_1')],
    };
    const asV62 = patchFormatVersion(serializeComposition(makeBundle(parts), []), 62);
    const meta = deserializeComposition(asV62).meta;
    expect(meta.svgObjects![0].name).toBe('plain');
    expect(meta.svgObjects![0].angleDeg).toBeCloseTo(20, 1);
    expect(meta.images![0].angleDeg).toBeCloseTo(-13, 1);
    expect(meta.texts![0].content).toBe('hello');
    expect(meta.patternObjects![0].cols).toBe(2);
    expect(meta.paintObjects![0].tiles.length).toBeGreaterThan(0);
    for (const o of [
      meta.svgObjects![0] as { shear?: number }, meta.images![0] as { shear?: number },
      meta.texts![0] as { shear?: number }, meta.patternObjects![0] as { shear?: number },
      meta.paintObjects![0] as { shear?: number },
    ]) expect(o.shear).toBeUndefined();
  });
});

// ── The fixtures on disk, resaved by a v63 writer ──────────────────────

/**
 * Every `.tile` in `test_data` was written by a v62-or-earlier build. The
 * version bump must be invisible to all of them, in BOTH directions: they
 * still open unchanged (`worldSnapshotFixtures.test.ts` is the standing
 * guardrail for that), and a v63 writer handed one back must not perturb
 * it on the way out.
 *
 * The resave is the half that is new here. It is what a page does every
 * time it is touched, so a writer that dropped a field or shifted an
 * offset would corrupt a real file on the first save after the upgrade —
 * and would do it silently, since nothing in the read path would notice.
 */
/** The same document with every free angle taken OFF, so the rest can be
 *  compared literally. The angles are compared as TURNS by
 *  {@link expectSameTurns}: one turn has two spellings in this field and
 *  the writer is free to pick either. */
function withoutAngles<T extends CompositionBundle>(meta: T): T {
  const strip = <O extends { angleDeg?: number }>(o: O): O => {
    if (o.angleDeg === undefined) return o;
    const { angleDeg, ...rest } = o;
    return rest as O;
  };
  return {
    ...meta,
    svgObjects: (meta.svgObjects ?? []).map(strip),
    images: (meta.images ?? []).map(strip),
    texts: (meta.texts ?? []).map(strip),
  };
}

/** Every leaf turned the same way in both documents, to the 0.01° the
 *  field resolves. `-49.89` and `310.11` are one turn. */
function expectSameTurns(a: CompositionBundle, b: CompositionBundle) {
  const turns = (m: CompositionBundle) => [
    ...(m.svgObjects ?? []), ...(m.images ?? []), ...(m.texts ?? []),
  ].map((o) => normalizeDeg((o as { angleDeg?: number }).angleDeg ?? 0));
  const ta = turns(a), tb = turns(b);
  expect(ta).toHaveLength(tb.length);
  ta.forEach((t, i) => expect(t).toBeCloseTo(tb[i], 1));
}

describe('the .tile fixtures survive a v63 resave', () => {
  const TEST_DATA = path.join(__dirname, '../../test_data');
  const TILES = fs.readdirSync(TEST_DATA).filter((f) => f.endsWith('.tile')).sort();

  it('there are fixtures to resave', () => {
    expect(TILES.length).toBeGreaterThan(0);
  });

  it.each(TILES)('%s reads, resaves and reads back identically', (rel) => {
    const raw = new Uint8Array(zlib.inflateSync(fs.readFileSync(path.join(TEST_DATA, rel))));
    const first = deserializeComposition(raw);
    const resaved = serializeComposition(first.meta, first.embeddedFiles);
    const second = deserializeComposition(resaved);
    // The document, field for field — including the leaves' pose fields,
    // which is where a shifted offset would show. Everything but the free
    // ANGLE, which has two spellings: the field is an i16 of hundredths and
    // reaches only 327.67, so `encodeAngleDeg` wraps a turn into
    // (-180, 180] rather than clamping it to a number the field cannot hold
    // (docs/transform-refactor.md §4). A fixture written by an older build
    // carries 208.85 where the writer now says -151.15 — the same turn, said
    // the short way round. So: the rest literally, the angles as turns.
    expect(withoutAngles(second.meta)).toEqual(withoutAngles(first.meta));
    expectSameTurns(second.meta, first.meta);
    // And nothing on disk grew: not one of these files has a lean in it,
    // so not one of them should have paid a byte for the bit.
    const again = serializeComposition(second.meta, second.embeddedFiles);
    expect(again.length).toBe(resaved.length);
    // …and the writer really is a fixed point, bytes and all, from the
    // second pass on — which is the property the angle wrap must not cost.
    expect(Array.from(again)).toEqual(Array.from(resaved));
  });

  it('not one of them carries a lean, so none is paying for the block', () => {
    // If a fixture DID have one, the assertions above would be testing the
    // block rather than its absence — worth knowing which.
    for (const rel of TILES) {
      const raw = new Uint8Array(zlib.inflateSync(fs.readFileSync(path.join(TEST_DATA, rel))));
      const { meta } = deserializeComposition(raw);
      const leaves = [
        ...(meta.svgObjects ?? []), ...(meta.images ?? []), ...(meta.texts ?? []),
        ...(meta.patternObjects ?? []), ...(meta.paintObjects ?? []),
      ] as { shear?: number }[];
      expect(leaves.every((o) => o.shear === undefined)).toBe(true);
    }
  });
});
