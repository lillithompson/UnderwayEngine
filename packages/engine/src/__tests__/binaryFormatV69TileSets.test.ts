/**
 * The v69 binary format extension: A PATTERN OWNS ITS TILE SETS.
 *
 * `PatternObject.tileSets` / `ShapePatternFill.tileSets` — the sprite
 * FAMILIES a grid draws from, which used to be one switch for the whole
 * install (Settings → Tile Sets) and is now the pattern's own Shapes
 * page. A u8 count then that many string-table indices, so a family named
 * by every pattern on a page is stored once.
 *
 * One codec, two records: on a pattern OBJECT it rides flags3's last free
 * bit (0x80) and sits LAST, after the fade; on a shape's pattern FILL it
 * rides that block's own bit 0x08 and sits after the cells. Both bits were
 * always written 0 before, so a v68 file reads back byte for byte — and an
 * ABSENT list means the editor's default families, which is exactly what
 * those files were drawn with.
 *
 * Mirrors binaryFormatV65PatternFade.test.ts (the block that precedes it on
 * a pattern object) and binaryFormatV67ShapePatternFill.test.ts (the block
 * this one rides at the end of).
 */

import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { CellState, PatternObject, ShapePatternFill, SVGObject } from '../types';

const TRANSFORM = { rotation: 0 as const, mirrorH: false, mirrorV: false };
const spriteCell = (spriteId: string): CellState => ({
  type: 'sprite', spriteId, transform: TRANSFORM,
});

function makePattern(id: string, extras: Partial<PatternObject> = {}): PatternObject {
  const cells: CellState[] = new Array(4).fill(null);
  cells[1] = spriteCell('angular/tile_10001000');
  return {
    id,
    cellX: 3, cellY: 1, cellWidth: 6, cellHeight: 4,
    cols: 2, rows: 2, cells,
    ...extras,
  };
}

function makeFill(extras: Partial<ShapePatternFill> = {}): ShapePatternFill {
  const cells: CellState[] = new Array(4).fill(null);
  cells[0] = spriteCell('curved/curve_00100001');
  return { size: 2, cells, tileL0: 2, ...extras };
}

function makeShape(patternFill?: ShapePatternFill): SVGObject {
  return {
    id: 'svg_1',
    segments: [
      { kind: 'line', start: [0, 0], end: [4, 0] },
      { kind: 'line', start: [4, 0], end: [4, 4] },
      { kind: 'line', start: [4, 4], end: [0, 4] },
      { kind: 'line', start: [0, 4], end: [0, 0] },
    ],
    color: { r: 0, g: 0, b: 0 },
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
    ...(patternFill ? { patternFill } : null),
  } as SVGObject;
}

function makeBundle(
  patternObjects: PatternObject[], svgObjects: SVGObject[] = [],
): CompositionBundle {
  return {
    name: 'Test', gridLevel: 1, strokeScale: 0.2, gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [],
    svgObjects,
    patternObjects,
    sceneOrder: [...patternObjects.map((p) => p.id), ...svgObjects.map((s) => s.id)],
  };
}

const roundTripPatterns = (patterns: PatternObject[]): PatternObject[] =>
  deserializeComposition(serializeComposition(makeBundle(patterns), [])).meta.patternObjects ?? [];

const roundTripShapes = (svgObjects: SVGObject[]): SVGObject[] =>
  deserializeComposition(serializeComposition(makeBundle([], svgObjects), [])).meta.svgObjects ?? [];

describe('v69 pattern tile sets — the pattern object record', () => {
  it('round-trips a family list, in the order it was written', () => {
    // Order is the field's: the Shapes page writes the registry's own
    // family order, and what comes back must be what went in — the session
    // compares the two by value to decide whether a toggle changed
    // anything at all.
    const [p] = roundTripPatterns([makePattern('pat_1', { tileSets: ['craftsman', 'petal'] })]);
    expect(p.tileSets).toEqual(['craftsman', 'petal']);
  });

  it('writes nothing at all for a pattern that has never said what it is made of', () => {
    // Absent means the editor's default families. The bit stays clear, so
    // the record is byte for byte the v68 one — which is what lets every
    // older file read back unchanged.
    const plain = makePattern('pat_1');
    const [p] = roundTripPatterns([plain]);
    expect(p.tileSets).toBeUndefined();
    expect(serializeComposition(makeBundle([plain]), []).byteLength)
      .toBeLessThan(serializeComposition(makeBundle([
        makePattern('pat_1', { tileSets: ['angular'] }),
      ]), []).byteLength);
  });

  it('treats an EMPTY list as absent — a pattern made of nothing cannot be painted', () => {
    const [p] = roundTripPatterns([makePattern('pat_1', { tileSets: [] })]);
    expect(p.tileSets).toBeUndefined();
  });

  it('stores a family named by several patterns once, on the string table', () => {
    // Two patterns naming the same two families cost one extra index pair
    // each over one pattern naming them, not two more strings.
    const one = serializeComposition(makeBundle([
      makePattern('pat_1', { tileSets: ['angular', 'curved'] }),
    ]), []).byteLength;
    const two = serializeComposition(makeBundle([
      makePattern('pat_1', { tileSets: ['angular', 'curved'] }),
      makePattern('pat_2', { tileSets: ['angular', 'curved'] }),
    ]), []).byteLength;
    const twoPlain = serializeComposition(makeBundle([
      makePattern('pat_1'), makePattern('pat_2'),
    ]), []).byteLength;
    const onePlain = serializeComposition(makeBundle([makePattern('pat_1')]), []).byteLength;
    // The family strings are paid for ONCE: the second pattern's list adds
    // only its own count byte and two indices (5 bytes), the same as the
    // first pattern's list adds over a plain one minus those strings.
    expect(two - twoPlain).toBe((one - onePlain) + 5);
  });

  it('keeps the list beside the fade and the shear, which come before it', () => {
    const [p] = roundTripPatterns([makePattern('pat_1', {
      shear: 0.25, tileSets: ['angular', 'craftsman'],
    })]);
    expect(p.shear).toBeCloseTo(0.25, 5);
    expect(p.tileSets).toEqual(['angular', 'craftsman']);
  });
});

describe('v69 pattern tile sets — a shape s pattern FILL', () => {
  it('round-trips the fill s own family list', () => {
    const [s] = roundTripShapes([makeShape(makeFill({ tileSets: ['petal'] }))]);
    expect(s.patternFill?.tileSets).toEqual(['petal']);
  });

  it('writes nothing for a fill that has never said, and reads back the cells regardless', () => {
    const [s] = roundTripShapes([makeShape(makeFill())]);
    expect(s.patternFill?.tileSets).toBeUndefined();
    expect(s.patternFill?.cells[0]).toMatchObject({ spriteId: 'curved/curve_00100001' });
  });

  it('sits AFTER the cells, so both come back whole', () => {
    // The block is appended at the very end of the fill record; a reader
    // that lost its place would garble the cells it just read.
    const [s] = roundTripShapes([makeShape(makeFill({
      allowBorderConnections: false, tileSets: ['angular', 'curved', 'petal'],
    }))]);
    expect(s.patternFill?.allowBorderConnections).toBe(false);
    expect(s.patternFill?.cells[0]).toMatchObject({ spriteId: 'curved/curve_00100001' });
    expect(s.patternFill?.tileSets).toEqual(['angular', 'curved', 'petal']);
  });
});
