/**
 * The v65 binary format extension: the Fade row on a PATTERN record.
 *
 * The v62 block, unchanged — an amount quantized to a u8 and the target's
 * three channels, four bytes, written only when there IS a fade — behind the
 * pattern record's own presence bit (v54 flags3 0x40), LAST in the record,
 * after the v63 shear. One writer and one reader serve every kind that
 * carries the pair, so what binaryFormatV62Fade pins for an svg is what a
 * pattern gets; this pins the record's own byte layout.
 *
 * Mirrors binaryFormatV63Shear.test.ts for the block that precedes it.
 *
 * As with every kind, the pair is written and read but never handed on:
 * `deserializeComposition` SPENDS it (engine/fadeBake.ts), and a pattern
 * spends it into its CELLS, since that is where a pattern's colour lives.
 * So these read the mixed cells back rather than the two fields.
 */

import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { PatternObject } from '../types';
import { expectFadedTo, expectNoStoredFade } from './fadeSpent.test-utils';

/** The colour cell every fixture below carries. */
const CELL_INK = { r: 200, g: 100, b: 50 };
const cellColor = (p: PatternObject) => p.cells[1] as unknown as { r: number; g: number; b: number };

function makePattern(id: string, extras: Partial<PatternObject> = {}): PatternObject {
  const cells = new Array(4).fill(null);
  cells[1] = {
    type: 'color' as const, ...CELL_INK,
    transform: { rotation: 0 as const, mirrorH: false, mirrorV: false },
  };
  return {
    id,
    cellX: 3, cellY: 1, cellWidth: 6, cellHeight: 4,
    cols: 2, rows: 2, cells,
    ...extras,
  };
}

function makeBundle(patternObjects: PatternObject[]): CompositionBundle {
  return {
    name: 'Test', gridLevel: 1, strokeScale: 0.2, gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [],
    svgObjects: [],
    patternObjects,
    sceneOrder: patternObjects.map((p) => p.id),
  };
}

const roundTrip = (patterns: PatternObject[]): PatternObject[] =>
  deserializeComposition(serializeComposition(makeBundle(patterns), [])).meta.patternObjects ?? [];

describe('v65 pattern fade round-trip', () => {
  it('preserves the amount and the target together — as the cells they make', () => {
    const [out] = roundTrip([makePattern('pat_1', {
      fade: 0.5, fadeColor: { r: 10, g: 20, b: 30 },
    })]);
    expectFadedTo(cellColor(out), CELL_INK, 0.5, { r: 10, g: 20, b: 30 });
    expectNoStoredFade(out);
  });

  it('a WHITE target is written absent, and still walks the cells to white', () => {
    const [out] = roundTrip([makePattern('pat_1', {
      fade: 0.5, fadeColor: { r: 255, g: 255, b: 255 },
    })]);
    expectFadedTo(cellColor(out), CELL_INK, 0.5, { r: 255, g: 255, b: 255 });
    expectNoStoredFade(out);
  });

  it('rides beside the shear and the opacity, not instead of them', () => {
    // All three are optional blocks at the tail of the same record, and the
    // fade is last: a pattern carrying every one of them must come back
    // carrying every one of them.
    const [out] = roundTrip([makePattern('pat_1', {
      opacity: 0.4, shear: 0.25, fade: 0.75, fadeColor: { r: 1, g: 2, b: 3 },
    })]);
    expect(out.opacity).toBeCloseTo(0.4, 5);
    expect(out.shear).toBeCloseTo(0.25, 5);
    expectFadedTo(cellColor(out), CELL_INK, 0.75, { r: 1, g: 2, b: 3 });
    expectNoStoredFade(out);
    // …and the cell is still the cell it was, after the extra bytes: the
    // fade moved its colour and touched nothing else about it.
    expect(out.cells[1]).toMatchObject({
      type: 'color',
      transform: { rotation: 0, mirrorH: false, mirrorV: false },
    });
  });

  it('costs exactly four bytes on the wire, and nothing at all unfaded', () => {
    const bare = serializeComposition(makeBundle([makePattern('pat_1')]), []);
    const faded = serializeComposition(makeBundle([makePattern('pat_1', { fade: 0.5 })]), []);
    expect(faded.length - bare.length).toBe(4);
    // A zero amount is no fade at all, target or no target — so a v64 file,
    // which is every page anyone has made, is byte-identical here.
    const zeroed = serializeComposition(makeBundle([makePattern('pat_1', {
      fade: 0, fadeColor: { r: 1, g: 2, b: 3 },
    })]), []);
    expect(zeroed.length).toBe(bare.length);
    const [out] = roundTrip([makePattern('pat_1')]);
    expectNoStoredFade(out);
    // …and an unfaded pattern's cells come back exactly as written.
    expect(cellColor(out)).toMatchObject(CELL_INK);
  });

  it('survives a full fade (1 is not "absent")', () => {
    const [out] = roundTrip([makePattern('pat_1', { fade: 1 })]);
    expect(cellColor(out)).toMatchObject({ r: 255, g: 255, b: 255 });
    expectNoStoredFade(out);
  });
});
