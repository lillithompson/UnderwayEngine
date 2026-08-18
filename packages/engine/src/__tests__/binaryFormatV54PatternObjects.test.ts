/**
 * Tests for the v54 binary format extension: the PATTERN OBJECTS section
 * (inline tile-pattern scene nodes — cells, symmetry, border rule, repeat
 * tile fields — after the paint-objects section).
 */

import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { PatternObject, PATTERN_SYMMETRY_OFF } from '../types';

function makeBundle(patternObjects: PatternObject[]): CompositionBundle {
  return {
    name: 'Test', gridLevel: 1, strokeScale: 8, gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [],
    patternObjects,
    sceneOrder: patternObjects.map(p => p.id),
  };
}

function roundTrip(p: PatternObject): PatternObject {
  const result = deserializeComposition(serializeComposition(makeBundle([p]), []));
  expect(result.meta.patternObjects).toHaveLength(1);
  return result.meta.patternObjects![0];
}

describe('v54 pattern object persistence', () => {
  it('round-trips an empty pattern (bbox + resolution only)', () => {
    const out = roundTrip({
      id: 'pat_1',
      cellX: 4, cellY: 6, cellWidth: 5, cellHeight: 3,
      cols: 5, rows: 3,
      cells: new Array(15).fill(null),
    });
    expect(out).toMatchObject({ id: 'pat_1', cellX: 4, cellY: 6, cellWidth: 5, cellHeight: 3, cols: 5, rows: 3 });
    expect(out.cells).toHaveLength(15);
    expect(out.cells.every(c => c === null)).toBe(true);
    expect(out.symmetry).toBeUndefined();
    expect(out.allowBorderConnections).toBeUndefined();
    expect(out.tileMode).toBeUndefined();
  });

  it('round-trips cells: sprites with transforms/tints and color cells', () => {
    const cells = new Array(4).fill(null);
    cells[0] = { type: 'sprite', spriteId: 'angular/tile_00101010', transform: { rotation: 90, mirrorH: true, mirrorV: false } };
    cells[2] = { type: 'sprite', spriteId: 'curved/curve_10101010', transform: { rotation: 0, mirrorH: false, mirrorV: true }, tintR: 10, tintG: 20, tintB: 30 };
    cells[3] = { type: 'color', r: 200, g: 100, b: 50, transform: { rotation: 0, mirrorH: false, mirrorV: false } };
    const out = roundTrip({
      id: 'pat_cells',
      cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2,
      cols: 2, rows: 2, cells,
    });
    expect(out.cells[0]).toEqual(cells[0]);
    expect(out.cells[1]).toBeNull();
    expect(out.cells[2]).toEqual(cells[2]);
    expect(out.cells[3]).toEqual(cells[3]);
  });

  it('round-trips symmetry, border rule, repeat tile fields and scalars', () => {
    const out = roundTrip({
      id: 'pat_full',
      name: 'My Pattern',
      groupId: 'grp_1',
      preGroupName: 'Old name',
      cellX: 1, cellY: 2, cellWidth: 12, cellHeight: 8,
      cols: 3, rows: 2,
      cells: new Array(6).fill(null),
      symmetry: { ...PATTERN_SYMMETRY_OFF, mirrorDiag1: true },
      allowBorderConnections: false,
      tileMode: 'repeat',
      tileWidthL0: 3, tileHeightL0: 2,
      tileOffsetXL0: 1.5, tileOffsetYL0: -0.5,
      rotation: 180,
      angleDeg: 33.5,
      opacity: 0.5,
      mirrorH: true,
      locked: true,
      hidden: true,
      localCellX: 1, localCellY: 2, localCellWidth: 12, localCellHeight: 8,
      identityCellX: 0, identityCellY: 0, identityCellWidth: 12, identityCellHeight: 8,
    });
    expect(out.symmetry).toEqual({ ...PATTERN_SYMMETRY_OFF, mirrorDiag1: true });
    expect(out.allowBorderConnections).toBe(false);
    expect(out.tileMode).toBe('repeat');
    expect(out.tileWidthL0).toBe(3);
    expect(out.tileHeightL0).toBe(2);
    expect(out.tileOffsetXL0).toBe(1.5);
    expect(out.tileOffsetYL0).toBe(-0.5);
    expect(out.rotation).toBe(180);
    expect(out.angleDeg).toBeCloseTo(33.5);
    expect(out.opacity).toBeCloseTo(0.5);
    expect(out.mirrorH).toBe(true);
    expect(out.mirrorV).toBeUndefined();
    expect(out.locked).toBe(true);
    expect(out.hidden).toBe(true);
    expect(out.name).toBe('My Pattern');
    expect(out.groupId).toBe('grp_1');
    expect(out.preGroupName).toBe('Old name');
    expect(out.localCellX).toBe(1);
    expect(out.identityCellWidth).toBe(12);
  });

  it('round-trips the authored stroke block (width + dash)', () => {
    const out = roundTrip({
      id: 'pat_stroke',
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
      cols: 4, rows: 4, cells: new Array(16).fill(null),
      stroke: { width: 0.25, dash: 3 },
    });
    expect(out.stroke).toEqual({ width: 0.25, dash: 3 });
    // Absent stays absent (legacy strokeScale rendering).
    const bare = roundTrip({
      id: 'pat_bare',
      cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2,
      cols: 2, rows: 2, cells: new Array(4).fill(null),
    });
    expect(bare.stroke).toBeUndefined();
  });

  it('keeps sceneOrder and coexists with svg objects', () => {
    const p: PatternObject = {
      id: 'pat_z',
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
      cols: 4, rows: 4, cells: new Array(16).fill(null),
    };
    const bundle: CompositionBundle = {
      ...makeBundle([p]),
      svgObjects: [{
        id: 'svg_a',
        segments: [{ kind: 'line', start: [0, 0], end: [1, 1] }],
        color: { r: 255, g: 255, b: 255 },
        cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1,
      }],
      sceneOrder: ['svg_a', 'pat_z'],
    };
    const result = deserializeComposition(serializeComposition(bundle, []));
    expect(result.meta.sceneOrder).toEqual(['svg_a', 'pat_z']);
    expect(result.meta.patternObjects![0].id).toBe('pat_z');
    expect(result.meta.svgObjects![0].id).toBe('svg_a');
  });
});
