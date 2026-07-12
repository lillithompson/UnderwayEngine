import { drawFloodFill } from '../draw-flood-fill';
import { CELL_COUNTS, editableCells, cellPx } from '../types';
import { makeLayer } from './test-utils';

describe('drawFloodFill', () => {
  const baseParams = (overrides?: Record<string, unknown>) => {
    const layer = makeLayer('a', 2); // L2 = 8x8
    const columns = CELL_COUNTS[layer.level]; // 8
    return {
      layer,
      allLayers: [layer],
      columns,
      maxCellX: columns,
      maxCellY: columns,
      canvasWidthL0: 32,
      canvasHeightL0: 32,
      canvasOriginL0X: 0,
      canvasOriginL0Y: 0,
      allowedSourceSet: null as Set<string> | null,
      mirrorH: false,
      mirrorV: false,
      mirrorRotate: false,
      mirrorQuad: false,
      mirrorRow: false,
      mirrorCol: false,
      mirrorDiag1: false,
      mirrorDiag2: false,
      mirrorDiagBoth: false,
      mirrorStar: false,
      regionBounds: null,
      ...overrides,
    };
  };

  test('single cell via region bounds produces 1 op with 0 connections', () => {
    const layer = makeLayer('a', 2); // L2 = 8x8, cellPx = 256
    const size = cellPx(2); // 256
    // Region that contains only cell (0,0)
    const regionBounds = {
      pxMinX: 0, pxMinY: 0,
      pxMaxX: size, pxMaxY: size,
    };
    const ops = drawFloodFill(baseParams({ layer, allLayers: [layer], regionBounds }));
    expect(ops.length).toBe(1);
    expect(ops[0].op).toBe('cell');
    if (ops[0].op === 'cell') {
      expect(ops[0].cellX).toBe(0);
      expect(ops[0].cellY).toBe(0);
      expect(ops[0].newState).not.toBeNull();
    }
  });

  test('1x2 region produces 2 ops', () => {
    const layer = makeLayer('a', 2);
    const size = cellPx(2); // 256
    // Region containing cells (0,0) and (1,0)
    const regionBounds = {
      pxMinX: 0, pxMinY: 0,
      pxMaxX: 2 * size, pxMaxY: size,
    };
    const ops = drawFloodFill(baseParams({ layer, allLayers: [layer], regionBounds }));
    expect(ops.length).toBe(2);
    // Both should be cell ops with different x coords
    const cellOps = ops.filter(o => o.op === 'cell');
    expect(cellOps.length).toBe(2);
  });

  test('full 8x8 grid produces 64 ops covering all cells', () => {
    const ops = drawFloodFill(baseParams());
    expect(ops.length).toBe(64);
    // No duplicate cells
    const keys = ops
      .filter((o): o is Extract<typeof o, { op: 'cell' }> => o.op === 'cell')
      .map(o => `${o.cellX},${o.cellY}`);
    expect(new Set(keys).size).toBe(64);
  });

  test('region bounds limits filled cells', () => {
    const layer = makeLayer('a', 2);
    const size = cellPx(2); // 256
    // Region containing a 3x3 area
    const regionBounds = {
      pxMinX: 0, pxMinY: 0,
      pxMaxX: 3 * size, pxMaxY: 3 * size,
    };
    const ops = drawFloodFill(baseParams({ layer, allLayers: [layer], regionBounds }));
    expect(ops.length).toBe(9);
    // All ops should be within the 3x3 region
    for (const op of ops) {
      if (op.op === 'cell') {
        expect(op.cellX).toBeLessThan(3);
        expect(op.cellY).toBeLessThan(3);
      }
    }
  });

  test('mirrorH produces additional mirrored ops', () => {
    const size = cellPx(2);
    // Small region: 2x1
    const regionBounds = {
      pxMinX: 0, pxMinY: 0,
      pxMaxX: 2 * size, pxMaxY: size,
    };
    const opsNoMirror = drawFloodFill(baseParams({ layer: makeLayer('b', 2), allLayers: [makeLayer('b', 2)], regionBounds }));
    const mirrorLayer = makeLayer('c', 2);
    const opsMirror = drawFloodFill(baseParams({
      layer: mirrorLayer,
      allLayers: [mirrorLayer],
      mirrorH: true,
      regionBounds: null, // full canvas for mirror to have effect
    }));
    // With mirrorH on full canvas, each primary cell gets a mirror partner
    // Total should be more than without mirror
    expect(opsMirror.length).toBeGreaterThan(opsNoMirror.length);
  });

  test('mirrorH + right-half regionBounds: mirror axis is canvas center, not selection center', () => {
    // Regression: previously mBounds fell back to regionBounds when no
    // explicit mirror bounds were passed, mirroring across the selection
    // center. With an 8x8 (L2) canvas and a right-half region (cols 4-7),
    // the canvas-center mirror should fill cols 0-3 too.
    const layer = makeLayer('mh-right-half', 2);
    const size = cellPx(2);
    const regionBounds = {
      pxMinX: 4 * size, pxMinY: 0,
      pxMaxX: 8 * size, pxMaxY: 8 * size,
    };
    const ops = drawFloodFill(baseParams({
      layer, allLayers: [layer], regionBounds, mirrorH: true,
    }));
    const cells = new Set<string>();
    for (const op of ops) {
      if (op.op === 'cell') cells.add(`${op.cellX},${op.cellY}`);
    }
    // Primary writes in cols 4-7
    expect(cells.has('4,0')).toBe(true);
    expect(cells.has('7,0')).toBe(true);
    // Canvas-center mirror writes in cols 0-3 (col 7 ↔ col 0, col 4 ↔ col 3)
    expect(cells.has('0,0')).toBe(true);
    expect(cells.has('3,0')).toBe(true);
  });

  test('returns empty ops for empty region', () => {
    const layer = makeLayer('a', 2);
    const regionBounds = {
      pxMinX: 0, pxMinY: 0,
      pxMaxX: 0, pxMaxY: 0,
    };
    const ops = drawFloodFill(baseParams({ layer, allLayers: [layer], regionBounds }));
    expect(ops.length).toBe(0);
  });

  test('all placed cells have sprite type', () => {
    const ops = drawFloodFill(baseParams());
    for (const op of ops) {
      if (op.op === 'cell') {
        expect(op.newState).not.toBeNull();
        expect(op.newState!.type).toBe('sprite');
      }
    }
  });

  test('clearFirst with regionBounds only clears cells inside the region', () => {
    const layer = makeLayer('a', 2); // L2 = 8x8, cellPx = 256
    const size = cellPx(2);
    const colorState = { type: 'color' as const, r: 255, g: 0, b: 0, transform: { rotation: 0 as const, mirrorH: false, mirrorV: false } };
    // Pre-fill all 8x8 cells
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        layer.cells[y][x] = { ...colorState };
      }
    }
    // Region covering only cells (0,0)..(2,2) — a 3x3 sub-region
    const regionBounds = {
      pxMinX: 0, pxMinY: 0,
      pxMaxX: 3 * size, pxMaxY: 3 * size,
    };
    const ops = drawFloodFill(baseParams({ layer, allLayers: [layer], regionBounds, clearFirst: true }));
    // All clear ops (newState === null) should be within the 3x3 region
    const clearOps = ops.filter(o => o.op === 'cell' && o.newState === null);
    for (const op of clearOps) {
      if (op.op === 'cell') {
        expect(op.cellX).toBeLessThan(3);
        expect(op.cellY).toBeLessThan(3);
      }
    }
    // Cells outside the region should still have their original state
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        if (x >= 3 || y >= 3) {
          expect(layer.cells[y][x]).not.toBeNull();
        }
      }
    }
  });

  test('onlyEmpty skips cells that already have content', () => {
    const layer = makeLayer('a', 2); // 8x8
    // Pre-fill some cells
    layer.cells[0][0] = { type: 'color', r: 255, g: 0, b: 0, transform: { rotation: 0, mirrorH: false, mirrorV: false } };
    layer.cells[0][1] = { type: 'color', r: 0, g: 255, b: 0, transform: { rotation: 0, mirrorH: false, mirrorV: false } };
    layer.cells[1][0] = { type: 'color', r: 0, g: 0, b: 255, transform: { rotation: 0, mirrorH: false, mirrorV: false } };

    const ops = drawFloodFill(baseParams({ layer, allLayers: [layer], onlyEmpty: true }));
    // Should skip the 3 pre-filled cells (some spiral neighbors may also be
    // skipped if no candidate matched, so use <= rather than exact)
    expect(ops.length).toBeLessThanOrEqual(61);
    expect(ops.length).toBeGreaterThan(0);
    // None of the pre-filled cells should appear in ops
    const filledKeys = new Set(['0,0', '1,0', '0,1']);
    for (const op of ops) {
      if (op.op === 'cell') {
        expect(filledKeys.has(`${op.cellX},${op.cellY}`)).toBe(false);
      }
    }
  });

  test('onlyEmpty false fills all cells including occupied ones', () => {
    const layer = makeLayer('a', 2);
    layer.cells[0][0] = { type: 'color', r: 255, g: 0, b: 0, transform: { rotation: 0, mirrorH: false, mirrorV: false } };

    const ops = drawFloodFill(baseParams({ layer, allLayers: [layer], onlyEmpty: false }));
    expect(ops.length).toBe(64);
  });

  // ── Non-zero canvas origin (resizeCanvas) ─────────────────────────
  // canvasWidthL0 = 16, originL0X = 8 → at L2 the canvas occupies layer
  // cells [2, 6) × [2, 6). Without origin awareness, drawFloodFill used to
  // place the spiral at layer cells [0, 4) × [0, 4) — visibly offset to the
  // upper-left from the canvas window.
  describe('non-zero canvas origin', () => {
    const centeredCanvas = {
      canvasWidthL0: 16,
      canvasHeightL0: 16,
      canvasOriginL0X: 8,
      canvasOriginL0Y: 8,
      maxCellX: editableCells(16, 2), // 4
      maxCellY: editableCells(16, 2),
    };

    test('full-canvas spiral writes only inside the canvas window', () => {
      const layer = makeLayer('a', 2);
      const ops = drawFloodFill(baseParams({
        layer,
        allLayers: [layer],
        ...centeredCanvas,
        regionBounds: null,
      }));
      // Canvas is 4x4 cells inside [2,6)x[2,6). Expect 16 placements,
      // each in-bounds.
      const cellOps = ops.filter(o => o.op === 'cell');
      expect(cellOps.length).toBe(16);
      for (const op of cellOps) {
        if (op.op !== 'cell') continue;
        expect(op.cellX).toBeGreaterThanOrEqual(2);
        expect(op.cellX).toBeLessThan(6);
        expect(op.cellY).toBeGreaterThanOrEqual(2);
        expect(op.cellY).toBeLessThan(6);
      }
    });

    test('mirrorH reflects across the canvas centre, not the layer corner', () => {
      const layer = makeLayer('a', 2);
      const ops = drawFloodFill(baseParams({
        layer,
        allLayers: [layer],
        ...centeredCanvas,
        regionBounds: null,
        mirrorH: true,
      }));
      const cellOps = ops.filter(o => o.op === 'cell');
      // Build a map of placed cells.
      const placed = new Set<string>();
      for (const op of cellOps) {
        if (op.op !== 'cell') continue;
        placed.add(`${op.cellX},${op.cellY}`);
      }
      // Canvas occupies cells [2, 6). For each placed cell, its horizontal
      // mirror about the canvas centre (cell 3.5) should also be placed:
      // mirror(x) = 2 + 5 - x = 7 - x.
      for (const op of cellOps) {
        if (op.op !== 'cell') continue;
        const mirroredX = 7 - op.cellX;
        expect(placed.has(`${mirroredX},${op.cellY}`)).toBe(true);
      }
    });

    test('regionBounds inside canvas window still works with non-zero origin', () => {
      const layer = makeLayer('a', 2);
      const size = cellPx(2);
      // Region exactly the canvas window: cells [2, 6)
      const regionBounds = {
        pxMinX: 2 * size, pxMinY: 2 * size,
        pxMaxX: 6 * size, pxMaxY: 6 * size,
      };
      const ops = drawFloodFill(baseParams({
        layer,
        allLayers: [layer],
        ...centeredCanvas,
        regionBounds,
      }));
      const cellOps = ops.filter(o => o.op === 'cell');
      expect(cellOps.length).toBe(16);
    });

  });

  // ── excludePartialTiles ─────────────────────────────────────────────
  describe('excludePartialTiles', () => {
    test('shifted L2 layer skips the rightmost partial column when flag is on', () => {
      // With shiftX=0.5 on L2 (cellsPerL0=4), cell 7 spans L0 [30..34]; the
      // canvas right edge is at L0 32, so the column is partial. Whatever
      // ops drawFloodFill produces on the rest of the grid, none should
      // land on column 7 when the flag is on.
      const layer = makeLayer('a', 2);
      layer.shiftX = 0.5;
      const ops = drawFloodFill(baseParams({ layer, allLayers: [layer], excludePartialTiles: true }));
      const cellOps = ops.filter((o): o is Extract<typeof o, { op: 'cell' }> => o.op === 'cell');
      const touchesPartialCol = cellOps.some(op => op.cellX === 7);
      expect(touchesPartialCol).toBe(false);
    });

    test('shifted L2 layer fills the partial column when flag is off (regression)', () => {
      const layer = makeLayer('a', 2);
      layer.shiftX = 0.5;
      const ops = drawFloodFill(baseParams({ layer, allLayers: [layer] }));
      const cellOps = ops.filter((o): o is Extract<typeof o, { op: 'cell' }> => o.op === 'cell');
      // Without the flag, column 7 is part of the canvas window and gets
      // included by the spiral.
      expect(cellOps.some(op => op.cellX === 7)).toBe(true);
    });

    test('regression: standard 32×32 L2 grid is unchanged with the flag on', () => {
      // Every L2 cell is fully inside the 32×32 canvas, so the flag is a
      // no-op for the common case.
      const ops = drawFloodFill(baseParams({ excludePartialTiles: true }));
      expect(ops.length).toBe(64);
    });
  });
});
