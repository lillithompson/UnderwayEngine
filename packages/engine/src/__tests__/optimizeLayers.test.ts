import { computeOptimizePlan } from '../optimizeLayers';
import { makeLayer } from './test-utils';
import { CellState, CELL_COUNTS } from '../types';
import { setCell as setCellReal, renderCellToPixels, rebuildPixelData } from '../cells';

const COLOR_CELL: CellState = {
  type: 'color',
  r: 255,
  g: 0,
  b: 0,
  transform: { mirrorH: false, mirrorV: false, rotation: 0 },
};

function setCell(layer: ReturnType<typeof makeLayer>, x: number, y: number, state: CellState) {
  layer.cells[y][x] = state;
}

describe('computeOptimizePlan', () => {
  describe('Phase 1: empty layer removal', () => {
    it('removes unlocked empty layers', () => {
      const a = makeLayer('layer_1000', 2, 0);
      const b = makeLayer('layer_2000', 2, 1); // empty
      setCell(a, 0, 0, COLOR_CELL);
      const result = computeOptimizePlan([a, b], a.id);
      expect(result.changed).toBe(true);
      expect(result.removals).toContain(b.id);
      expect(result.removals).not.toContain(a.id);
    });

    it('does not remove locked empty layers', () => {
      const a = makeLayer('layer_1000', 2, 0);
      const b = makeLayer('layer_2000', 2, 1);
      b.locked = true;
      setCell(a, 0, 0, COLOR_CELL);
      const result = computeOptimizePlan([a, b], a.id);
      expect(result.removals).not.toContain(b.id);
    });

    it('conservation: keeps highest-level empty layer when all are empty', () => {
      const a = makeLayer('layer_1000', 1, 0); // level 1
      const b = makeLayer('layer_2000', 3, 1); // level 3 (coarsest)
      const c = makeLayer('layer_3000', 2, 2); // level 2
      const result = computeOptimizePlan([a, b, c], a.id);
      expect(result.removals).not.toContain(b.id); // level 3 kept
      expect(result.removals).toContain(a.id);
      expect(result.removals).toContain(c.id);
    });

    it('conservation tiebreak: keeps oldest layer when levels tie', () => {
      const a = makeLayer('layer_2000', 3, 0);
      const b = makeLayer('layer_1000', 3, 1); // older
      const result = computeOptimizePlan([a, b], a.id);
      expect(result.removals).not.toContain(b.id); // older kept
      expect(result.removals).toContain(a.id);
    });
  });

  describe('Phase 2: merge compatible layers', () => {
    it('merges two non-overlapping layers with same level and shift', () => {
      const a = makeLayer('layer_1000', 2, 0);
      const b = makeLayer('layer_2000', 2, 1);
      setCell(a, 0, 0, COLOR_CELL);
      setCell(b, 1, 1, COLOR_CELL);
      const result = computeOptimizePlan([a, b], a.id);
      expect(result.changed).toBe(true);
      expect(result.merges).toHaveLength(1);
      expect(result.merges[0].survivorId).toBe(a.id); // older
      expect(result.merges[0].donorId).toBe(b.id);
      expect(result.merges[0].cells).toEqual([
        { cellX: 1, cellY: 1, state: COLOR_CELL },
      ]);
      expect(result.removals).toContain(b.id);
    });

    it('rejects merge when cells overlap', () => {
      const a = makeLayer('layer_1000', 2, 0);
      const b = makeLayer('layer_2000', 2, 1);
      setCell(a, 0, 0, COLOR_CELL);
      setCell(b, 0, 0, COLOR_CELL); // overlap
      setCell(b, 1, 1, COLOR_CELL);
      const result = computeOptimizePlan([a, b], a.id);
      expect(result.merges).toHaveLength(0);
      expect(result.removals).not.toContain(b.id);
    });

    it('does not merge layers with different levels', () => {
      const a = makeLayer('layer_1000', 1, 0);
      const b = makeLayer('layer_2000', 2, 1);
      setCell(a, 0, 0, COLOR_CELL);
      setCell(b, 0, 0, COLOR_CELL);
      const result = computeOptimizePlan([a, b], a.id);
      expect(result.merges).toHaveLength(0);
    });

    it('does not merge layers with different shifts', () => {
      const a = makeLayer('layer_1000', 2, 0);
      const b = makeLayer('layer_2000', 2, 1);
      a.shiftX = 0.5;
      b.shiftX = 0;
      setCell(a, 0, 0, COLOR_CELL);
      setCell(b, 1, 1, COLOR_CELL);
      const result = computeOptimizePlan([a, b], a.id);
      expect(result.merges).toHaveLength(0);
    });

    it('skips locked layers during merge', () => {
      const a = makeLayer('layer_1000', 2, 0);
      const b = makeLayer('layer_2000', 2, 1);
      a.locked = true;
      setCell(a, 0, 0, COLOR_CELL);
      setCell(b, 1, 1, COLOR_CELL);
      const result = computeOptimizePlan([a, b], a.id);
      expect(result.merges).toHaveLength(0);
    });

    it('merges 3 layers sequentially, skipping overlapping donor', () => {
      const a = makeLayer('layer_1000', 2, 0); // survivor
      const b = makeLayer('layer_2000', 2, 1); // donor - overlaps
      const c = makeLayer('layer_3000', 2, 2); // donor - no overlap
      setCell(a, 0, 0, COLOR_CELL);
      setCell(b, 0, 0, COLOR_CELL); // overlaps with a
      setCell(c, 2, 2, COLOR_CELL); // no overlap
      const result = computeOptimizePlan([a, b, c], a.id);
      expect(result.merges).toHaveLength(1);
      expect(result.merges[0].donorId).toBe(c.id);
      expect(result.removals).toContain(c.id);
      expect(result.removals).not.toContain(b.id);
    });

    it('merges edge cells for shifted layers', () => {
      const count = CELL_COUNTS[2];
      const a = makeLayer('layer_1000', 2, 0);
      a.shiftY = 0.5;
      a.edgeRowTop = new Array(count).fill(null);

      const b = makeLayer('layer_2000', 2, 1);
      b.shiftY = 0.5;
      b.edgeRowTop = new Array(count).fill(null);
      b.edgeRowTop[0] = COLOR_CELL;

      setCell(a, 0, 0, COLOR_CELL);

      const result = computeOptimizePlan([a, b], a.id);
      expect(result.merges).toHaveLength(1);
      expect(result.merges[0].cells).toEqual(
        expect.arrayContaining([{ cellX: 0, cellY: -1, state: COLOR_CELL }]),
      );
    });

    it('rejects merge when edge cells overlap', () => {
      const count = CELL_COUNTS[2];
      const a = makeLayer('layer_1000', 2, 0);
      a.shiftY = 0.5;
      a.edgeRowTop = new Array(count).fill(null);
      a.edgeRowTop[0] = COLOR_CELL;

      const b = makeLayer('layer_2000', 2, 1);
      b.shiftY = 0.5;
      b.edgeRowTop = new Array(count).fill(null);
      b.edgeRowTop[0] = COLOR_CELL; // overlap

      const result = computeOptimizePlan([a, b], a.id);
      expect(result.merges).toHaveLength(0);
    });
  });

  describe('active layer handling', () => {
    it('redirects to survivor when active layer is merged donor', () => {
      const a = makeLayer('layer_1000', 2, 0);
      const b = makeLayer('layer_2000', 2, 1);
      setCell(a, 0, 0, COLOR_CELL);
      setCell(b, 1, 1, COLOR_CELL);
      const result = computeOptimizePlan([a, b], b.id); // b is active, will be merged into a
      expect(result.newActiveLayerId).toBe(a.id);
    });

    it('redirects to first remaining when active layer removed as empty', () => {
      const a = makeLayer('layer_1000', 2, 0);
      const b = makeLayer('layer_2000', 2, 1);
      setCell(b, 0, 0, COLOR_CELL);
      // a is active and empty
      const result = computeOptimizePlan([a, b], a.id);
      expect(result.newActiveLayerId).toBe(b.id);
    });

    it('returns null newActiveLayerId when active layer is not removed', () => {
      const a = makeLayer('layer_1000', 2, 0);
      const b = makeLayer('layer_2000', 2, 1);
      setCell(a, 0, 0, COLOR_CELL);
      const result = computeOptimizePlan([a, b], a.id);
      expect(result.newActiveLayerId).toBeNull();
    });
  });

  describe('no-op cases', () => {
    it('single layer is a no-op', () => {
      const a = makeLayer('layer_1000', 2, 0);
      setCell(a, 0, 0, COLOR_CELL);
      const result = computeOptimizePlan([a], a.id);
      expect(result.changed).toBe(false);
    });

    it('single empty layer is a no-op (conservation)', () => {
      const a = makeLayer('layer_1000', 2, 0);
      const result = computeOptimizePlan([a], a.id);
      expect(result.changed).toBe(false);
    });

    it('all locked layers is a no-op', () => {
      const a = makeLayer('layer_1000', 2, 0);
      const b = makeLayer('layer_2000', 2, 1);
      a.locked = true;
      b.locked = true;
      const result = computeOptimizePlan([a, b], a.id);
      expect(result.changed).toBe(false);
    });
  });
});

describe('incremental merge pixel rendering', () => {
  it('incremental renderCellToPixels matches full rebuildPixelData', () => {
    const layerInc = makeLayer('inc_1000', 2, 0);
    const layerFull = makeLayer('full_1000', 2, 0);

    // Set pre-existing cells on both layers (simulating the survivor)
    const existing: CellState = {
      type: 'color', r: 0, g: 255, b: 0,
      transform: { mirrorH: false, mirrorV: false, rotation: 0 },
    };
    setCellReal(layerInc, 0, 0, existing);
    setCellReal(layerFull, 0, 0, existing);
    rebuildPixelData(layerInc);
    rebuildPixelData(layerFull);

    // Simulate merging donor cells into empty positions
    const donorCells = [
      { cellX: 1, cellY: 1, state: COLOR_CELL },
      { cellX: 3, cellY: 2, state: COLOR_CELL },
      { cellX: 5, cellY: 0, state: COLOR_CELL },
    ];

    // Incremental approach (the fix): setCell + renderCellToPixels per cell
    for (const { cellX, cellY, state } of donorCells) {
      setCellReal(layerInc, cellX, cellY, state);
      renderCellToPixels(layerInc, cellX, cellY, state);
    }

    // Full rebuild approach (the old code): setCell all, then rebuildPixelData
    for (const { cellX, cellY, state } of donorCells) {
      setCellReal(layerFull, cellX, cellY, state);
    }
    rebuildPixelData(layerFull);

    // Pixel buffers must be identical
    expect(Buffer.from(layerInc.data).equals(Buffer.from(layerFull.data))).toBe(true);
  });
});
