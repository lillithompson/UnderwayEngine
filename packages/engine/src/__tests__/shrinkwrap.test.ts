import { shrinkwrapLayers, revertOps } from '../cells';
import { serializeFile, deserializeFile } from '../binaryFormat';
import { CELL_COUNTS, CellState, DEFAULT_TRANSFORM, UndoOp } from '../types';
import { makeLayer, makeState } from './test-utils';

const COLOR: CellState = { type: 'color', r: 255, g: 0, b: 0, transform: DEFAULT_TRANSFORM };

describe('shrinkwrapLayers', () => {
  test('returns minimum 1x1 when no cells occupied', () => {
    const layer = makeLayer('l0', 0, 0);
    const result = shrinkwrapLayers([layer], 32, 32);
    expect(result).toEqual({ widthL0: 1, heightL0: 1 });
  });

  test('shrinks tight around a single occupied L0 cell', () => {
    const layer = makeLayer('l0', 0, 0);
    // Place a cell at L0 (5,5). Tight bbox [5,6)×[5,6) → 1×1 canvas, content
    // at (0,0). Coarsest is L0 so snap unit = max(1, 1/2) = 1.
    layer.cells[5][5] = COLOR;
    const result = shrinkwrapLayers([layer], 32, 32);
    expect(result.widthL0).toBe(1);
    expect(result.heightL0).toBe(1);
    expect(layer.cells[0][0]).toEqual(COLOR);
    expect(layer.cells[5][5]).toBeNull();
  });

  test('handles cells in multiple layers at different levels, flipping shift as needed', () => {
    const l0 = makeLayer('l0', 0, 0);
    const l2 = makeLayer('l2', 2, 1);
    // L0 cell at (2,2) → L0 bbox [2,3).
    l0.cells[2][2] = COLOR;
    // L2 cell at (1,1) → L0 [4,8).
    l2.cells[1][1] = COLOR;
    const result = shrinkwrapLayers([l0, l2], 32, 32);
    // Combined bbox [2,8)×[2,8). Coarsest = L2 → snap unit = 2 L0.
    // snapMin = 2, snapMax = 8 → 6×6. Δ = −2 L0 on both axes.
    expect(result.widthL0).toBe(6);
    expect(result.heightL0).toBe(6);
    // L0: v = 0 + (−2/1) = −2 → cellShift −2, shift stays 0.
    // (2,2) → (0,0).
    expect(l0.shiftX).toBe(0);
    expect(l0.shiftY).toBe(0);
    expect(l0.cells[0][0]).toEqual(COLOR);
    expect(l0.cells[2][2]).toBeNull();
    // L2: v = 0 + (−2/4) = −0.5 → cellShift −1, new shift 0.5 on both axes.
    // (1,1) → (0,0) with half-cell shift — still at L0 (2,2) visually.
    expect(l2.shiftX).toBe(0.5);
    expect(l2.shiftY).toBe(0.5);
    expect(l2.cells[0][0]).toEqual(COLOR);
    expect(l2.cells[1][1]).toBeNull();
  });

  test('no-op when the tight bbox already equals the canvas', () => {
    const layer = makeLayer('l0', 0, 0);
    layer.cells[0][0] = COLOR;
    layer.cells[3][3] = COLOR;
    const result = shrinkwrapLayers([layer], 4, 4);
    expect(result).toEqual({ widthL0: 4, heightL0: 4 });
    expect(layer.cells[0][0]).toEqual(COLOR);
    expect(layer.cells[3][3]).toEqual(COLOR);
  });

  test('shifts a single L1 cell to the origin with a 2×2 canvas', () => {
    const layer = makeLayer('l1', 1, 0);
    // L1 cell at (6,6) → L0 [12,14).
    // Coarsest = L1 → snap unit = 1 L0. snapMin=12, snapMax=14 → 2×2.
    // Δ = −12 L0, L1 shift = −6 cells, shift stays 0.
    layer.cells[6][6] = COLOR;
    const result = shrinkwrapLayers([layer], 32, 32);
    expect(result.widthL0).toBe(2);
    expect(result.heightL0).toBe(2);
    expect(layer.shiftX).toBe(0);
    expect(layer.shiftY).toBe(0);
    expect(layer.cells[0][0]).toEqual(COLOR);
    expect(layer.cells[6][6]).toBeNull();
  });

  test('empty layers do not affect the coarsest-level computation', () => {
    const l0 = makeLayer('l0', 0, 0);
    const l2 = makeLayer('l2', 2, 1); // empty — must not force L2 snap
    l0.cells[5][5] = COLOR;
    const result = shrinkwrapLayers([l0, l2], 32, 32);
    // Only L0 is occupied → snap unit 1. Single cell → 1×1.
    expect(result.widthL0).toBe(1);
    expect(result.heightL0).toBe(1);
    expect(l0.cells[0][0]).toEqual(COLOR);
    expect(l0.cells[5][5]).toBeNull();
  });

  test('trims to exact L0 bbox on each axis independently', () => {
    const layer = makeLayer('l0', 0, 0);
    // L0 cells spanning [0,5)×[0,1).
    layer.cells[0][0] = COLOR;
    layer.cells[0][4] = COLOR;
    const result = shrinkwrapLayers([layer], 32, 32);
    expect(result.widthL0).toBe(5);
    expect(result.heightL0).toBe(1);
    // Both cells sit at y=0, already at min → no shift needed.
    expect(layer.cells[0][0]).toEqual(COLOR);
    expect(layer.cells[0][4]).toEqual(COLOR);
  });

  test('tight-wraps an L0 cell already at the origin', () => {
    const layer = makeLayer('l0', 0, 0);
    layer.cells[0][0] = COLOR;
    const result = shrinkwrapLayers([layer], 32, 32);
    expect(result.widthL0).toBe(1);
    expect(result.heightL0).toBe(1);
    expect(layer.cells[0][0]).toEqual(COLOR);
  });

  test('undo restores per-layer shifts changed by shrinkwrap', () => {
    const l0 = makeLayer('l0', 0, 0);
    const l2 = makeLayer('l2', 2, 1);
    l0.cells[2][2] = COLOR;
    l2.cells[1][1] = COLOR;

    const origW = 32, origH = 32;
    expect(l0.shiftX).toBe(0);
    expect(l2.shiftX).toBe(0);

    const cellsBefore = [l0, l2].map(l => {
      const count = CELL_COUNTS[l.level];
      const cells: (CellState | null)[][] = [];
      for (let y = 0; y < count; y++) cells[y] = l.cells[y].slice();
      return { layerId: l.id, cells };
    });
    const shiftsBefore = [l0, l2].map(l => ({
      layerId: l.id, shiftX: l.shiftX, shiftY: l.shiftY,
    }));

    const result = shrinkwrapLayers([l0, l2], origW, origH);
    expect(l2.shiftX).toBe(0.5);
    expect(l2.shiftY).toBe(0.5);

    const undoOp: UndoOp = {
      op: 'shrinkwrap',
      oldWidthL0: origW, oldHeightL0: origH,
      newWidthL0: result.widthL0, newHeightL0: result.heightL0,
      oldOriginL0X: 0, oldOriginL0Y: 0,
      newOriginL0X: 0, newOriginL0Y: 0,
      layerCellsBefore: cellsBefore,
      layerShiftsBefore: shiftsBefore,
    };

    const state = makeState([l0, l2], {
      fileConfig: { id: 'test', name: 'Test', widthL0: result.widthL0, heightL0: result.heightL0 },
    });
    const reverted = revertOps(state, [undoOp]);
    const rl2 = reverted.layers.find(l => l.id === 'l2')!;
    expect(rl2.shiftX).toBe(0);
    expect(rl2.shiftY).toBe(0);
    expect(reverted.fileConfig.widthL0).toBe(origW);
  });

  test('shrinkwrap persists correctly through serialize/deserialize round-trip', () => {
    const layer = makeLayer('l0', 0, 0);
    layer.cells[5][5] = COLOR;

    const { widthL0, heightL0 } = shrinkwrapLayers([layer], 32, 32);
    expect(widthL0).toBe(1);
    expect(heightL0).toBe(1);
    expect(layer.cells[0][0]).toEqual(COLOR);

    const bytes = serializeFile([layer], layer.id, widthL0, heightL0);
    const restored = deserializeFile(bytes);

    expect(restored.widthL0).toBe(1);
    expect(restored.heightL0).toBe(1);
    expect(restored.layers).toHaveLength(1);

    const restoredLayer = restored.layers[0];
    expect(restoredLayer.cells[0][0]).toEqual(COLOR);
    expect(restoredLayer.cells[5]?.[5] ?? null).toBeNull();
  });
});
