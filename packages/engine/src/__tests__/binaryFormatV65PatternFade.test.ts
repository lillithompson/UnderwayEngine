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
 */

import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { PatternObject } from '../types';

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
  it('preserves the amount and the target together', () => {
    const [out] = roundTrip([makePattern('pat_1', {
      fade: 0.5, fadeColor: { r: 10, g: 20, b: 30 },
    })]);
    expect(out.fade).toBeCloseTo(0.5, 2);
    expect(out.fadeColor).toEqual({ r: 10, g: 20, b: 30 });
  });

  it('leaves a WHITE target absent, since white is what absent means', () => {
    const [out] = roundTrip([makePattern('pat_1', {
      fade: 0.5, fadeColor: { r: 255, g: 255, b: 255 },
    })]);
    expect(out.fade).toBeCloseTo(0.5, 2);
    expect(out.fadeColor).toBeUndefined();
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
    expect(out.fade).toBeCloseTo(0.75, 2);
    expect(out.fadeColor).toEqual({ r: 1, g: 2, b: 3 });
    // …and the cells are still where they were, after the extra bytes.
    expect(out.cells[1]).toEqual({
      type: 'color', r: 200, g: 100, b: 50,
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
    expect(out.fade).toBeUndefined();
    expect(out.fadeColor).toBeUndefined();
  });

  it('survives a full fade (1 is not "absent")', () => {
    const [out] = roundTrip([makePattern('pat_1', { fade: 1 })]);
    expect(out.fade).toBeCloseTo(1, 2);
  });
});
