/**
 * The v67 binary format extension: a closed shape's PATTERN fill.
 *
 * The TILE block — its edge in cells, a flags byte, what one repeat spans
 * on the page (tileL0), the optional symmetry and stroke, then the filled
 * cells — rides the svg record LAST, behind the rotation byte's bit 0x10
 * (all four svg flag bytes were spent by v63; v64's box bit took 0x08
 * there for the same reason).
 *
 * The cells go through the very codec the pattern-object record has used
 * since v54, so what binaryFormatV54PatternObjects pins for a pattern
 * object's tiles is what a fill's tiles get; this pins the block's own
 * presence, its grid fields, and that an unpatterned shape still writes
 * nothing at all.
 *
 * Mirrors binaryFormatV64SVGBox.test.ts for the block that precedes it.
 */

import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { CellState, PatternSymmetry, ShapePatternFill, SVGObject } from '../types';

const INK = { r: 12, g: 34, b: 56 };
const TRANSFORM = { rotation: 0 as const, mirrorH: false, mirrorV: false };

const spriteCell = (spriteId: string, tint?: boolean): CellState => ({
  type: 'sprite', spriteId, transform: TRANSFORM,
  ...(tint ? { tintR: INK.r, tintG: INK.g, tintB: INK.b } : null),
});

function makeFill(extras: Partial<ShapePatternFill> = {}): ShapePatternFill {
  const cells: CellState[] = new Array(4).fill(null);
  cells[0] = spriteCell('angular/tile_10001000');
  cells[3] = spriteCell('curved/curve_00100001', true);
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

function makeBundle(svgObjects: SVGObject[]): CompositionBundle {
  return {
    name: 'Test', gridLevel: 1, strokeScale: 0.2, gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [],
    svgObjects,
    sceneOrder: svgObjects.map((s) => s.id),
  };
}

const roundTrip = (svgObjects: SVGObject[]): SVGObject[] =>
  deserializeComposition(serializeComposition(makeBundle(svgObjects), [])).meta.svgObjects ?? [];

const SYMMETRY: PatternSymmetry = {
  mirrorH: true, mirrorV: true, mirrorRotate: false, mirrorQuad: false,
  mirrorRow: false, mirrorCol: false, mirrorDiag1: false, mirrorDiag2: false,
  mirrorDiagBoth: false, mirrorStar: false,
};

describe('v67 shape pattern fill round-trip', () => {
  it('brings the tile back cell for cell, at the size it repeats at', () => {
    const [back] = roundTrip([makeShape(makeFill({ tileL0: 3.5 }))]);
    const fill = back.patternFill!;
    expect(fill.size).toBe(2);
    expect(fill.tileL0).toBeCloseTo(3.5, 5);
    expect(fill.cells).toHaveLength(4);
    expect(fill.cells[0]).toEqual(spriteCell('angular/tile_10001000'));
    expect(fill.cells[1]).toBeNull();
    expect(fill.cells[2]).toBeNull();
    // The tint rides the cell, the sprite id rides the string table.
    expect(fill.cells[3]).toEqual(spriteCell('curved/curve_00100001', true));
  });

  it('keeps the symmetry, the border rule and the stroke', () => {
    const [back] = roundTrip([makeShape(makeFill({
      symmetry: SYMMETRY,
      allowBorderConnections: false,
      stroke: { width: 0.4, dash: 2 },
    }))]);
    const fill = back.patternFill!;
    expect(fill.symmetry).toEqual(SYMMETRY);
    expect(fill.allowBorderConnections).toBe(false);
    expect(fill.stroke?.width).toBeCloseTo(0.4, 5);
    expect(fill.stroke?.dash).toBe(2);
  });

  it('leaves an unpatterned shape exactly as it was — no block, no bytes', () => {
    const plain = makeShape();
    const [back] = roundTrip([plain]);
    expect(back.patternFill).toBeUndefined();
    expect(serializeComposition(makeBundle([plain]), []).byteLength)
      .toBeLessThan(serializeComposition(makeBundle([makeShape(makeFill())]), []).byteLength);
  });

  it('survives beside a shape that carries none, each keeping its own answer', () => {
    const patterned = { ...makeShape(makeFill()), id: 'svg_a' };
    const plain = { ...makeShape(), id: 'svg_b' };
    const back = roundTrip([patterned, plain]);
    expect(back.find((s) => s.id === 'svg_a')?.patternFill?.cells[0]).not.toBeNull();
    expect(back.find((s) => s.id === 'svg_b')?.patternFill).toBeUndefined();
  });

  it('brings an EMPTY tile back as a tile, not as no pattern', () => {
    // A fill with nothing painted into it yet is a real record: the page
    // is in pattern mode on that shape, and reopening it must not drop
    // the fill the user just added.
    const empty: ShapePatternFill = { size: 3, cells: new Array(9).fill(null), tileL0: 3 };
    const [back] = roundTrip([makeShape(empty)]);
    expect(back.patternFill).toEqual(empty);
  });

  it('carries every size the slider offers', () => {
    for (const size of [1, 2, 5, 8]) {
      const fill: ShapePatternFill = {
        size, cells: new Array(size * size).fill(null), tileL0: size * 1.25,
      };
      fill.cells[size * size - 1] = spriteCell('angular/tile_10001000');
      const [back] = roundTrip([makeShape(fill)]);
      expect(back.patternFill!.size).toBe(size);
      expect(back.patternFill!.cells).toHaveLength(size * size);
      expect(back.patternFill!.tileL0).toBeCloseTo(size * 1.25, 5);
    }
  });
});
