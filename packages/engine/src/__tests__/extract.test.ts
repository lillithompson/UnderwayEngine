import { editorReducer } from '../state';
import { applyCellEdit, isCellInRegionPx, createCellGrid, createEdgeStorage, RegionBoundsPx } from '../cells';
import { CellState, CELL_COUNTS, cellPx, LAYER_PX, initDirtyRects, Layer } from '../types';
import { makeLayer, makeState } from './test-utils';

const color = (r: number, g = 0, b = 0): CellState => ({
  type: 'color',
  r, g, b,
  transform: { mirrorH: false, mirrorV: false, rotation: 0 },
});

function countOccupied(layer: Layer): number {
  const count = CELL_COUNTS[layer.level];
  let n = 0;
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      if (layer.cells[y][x] != null) n++;
    }
  }
  return n;
}

function makeNewLayer(source: Layer): Layer {
  const data = new Uint8Array(LAYER_PX * LAYER_PX * 4);
  const edges = createEdgeStorage(source.level, source.shiftX, source.shiftY);
  return {
    id: `layer_extracted`,
    name: `${source.name} (Extracted)`,
    level: source.level,
    visible: true,
    opacity: 1,
    order: 1,
    shiftX: source.shiftX,
    shiftY: source.shiftY,
    locked: false,
    data,
    dataU32: new Uint32Array(data.buffer),
    dirtyRects: initDirtyRects(),
    dirtyRectCount: 0,
    cells: createCellGrid(source.level),
    cellsGeneration: 0,
    edgeRowTop: edges.edgeRowTop,
    edgeColLeft: edges.edgeColLeft,
    edgeCorner: edges.edgeCorner,
  };
}

describe('extract region', () => {
  test('extracts M cells from N-cell layer: source has N-M, new layer has M', () => {
    // Level 2 = 8x8 grid
    const source = makeLayer('src', 2, 0);

    // Fill the entire grid (N = 64)
    const count = CELL_COUNTS[source.level];
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        applyCellEdit(source, x, y, color(100 + x, 100 + y));
      }
    }
    const N = countOccupied(source);
    expect(N).toBe(64);

    // Select a 3x3 region starting at (2,2) — M = 9
    const size = cellPx(source.level); // 256 for L2
    const regionBounds: RegionBoundsPx = {
      pxMinX: 2 * size,
      pxMinY: 2 * size,
      pxMaxX: 5 * size,
      pxMaxY: 5 * size,
    };

    // Create new layer with same level and shift
    const newLayer = makeNewLayer(source);

    // Extract: copy selected cells to new layer, erase from source
    let M = 0;
    for (let cy = 0; cy < count; cy++) {
      for (let cx = 0; cx < count; cx++) {
        if (!isCellInRegionPx(cx, cy, source, regionBounds)) continue;
        const cellState = source.cells[cy]?.[cx] ?? null;
        if (cellState === null) continue;
        const copied = { ...cellState, transform: { ...cellState.transform } } as CellState;
        applyCellEdit(source, cx, cy, null);
        applyCellEdit(newLayer, cx, cy, copied);
        M++;
      }
    }

    expect(M).toBe(9);
    expect(countOccupied(source)).toBe(N - M);
    expect(countOccupied(newLayer)).toBe(M);
  });

  test('extract with partial occupancy only moves occupied cells', () => {
    const source = makeLayer('src', 2, 0);
    const count = CELL_COUNTS[source.level];

    // Fill only odd columns (32 cells out of 64)
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        if (x % 2 === 1) applyCellEdit(source, x, y, color(x, y));
      }
    }
    const N = countOccupied(source);
    expect(N).toBe(32);

    // Select 4x4 region at (0,0) — 16 cells, but only 8 are occupied (odd columns: 1,3)
    const size = cellPx(source.level);
    const regionBounds: RegionBoundsPx = {
      pxMinX: 0,
      pxMinY: 0,
      pxMaxX: 4 * size,
      pxMaxY: 4 * size,
    };

    const newLayer = makeNewLayer(source);

    let moved = 0;
    for (let cy = 0; cy < count; cy++) {
      for (let cx = 0; cx < count; cx++) {
        if (!isCellInRegionPx(cx, cy, source, regionBounds)) continue;
        const cellState = source.cells[cy]?.[cx] ?? null;
        if (cellState === null) continue;
        const copied = { ...cellState, transform: { ...cellState.transform } } as CellState;
        applyCellEdit(source, cx, cy, null);
        applyCellEdit(newLayer, cx, cy, copied);
        moved++;
      }
    }

    expect(moved).toBe(8);
    expect(countOccupied(source)).toBe(N - moved);
    expect(countOccupied(newLayer)).toBe(moved);
  });

  test('extracted cells preserve their content', () => {
    const source = makeLayer('src', 2, 0);

    // Place specific colors
    applyCellEdit(source, 0, 0, color(255, 0, 0));
    applyCellEdit(source, 1, 0, color(0, 255, 0));
    applyCellEdit(source, 0, 1, color(0, 0, 255));

    const size = cellPx(source.level);
    const regionBounds: RegionBoundsPx = {
      pxMinX: 0,
      pxMinY: 0,
      pxMaxX: 2 * size,
      pxMaxY: 2 * size,
    };

    const newLayer = makeNewLayer(source);
    const count = CELL_COUNTS[source.level];
    for (let cy = 0; cy < count; cy++) {
      for (let cx = 0; cx < count; cx++) {
        if (!isCellInRegionPx(cx, cy, source, regionBounds)) continue;
        const cellState = source.cells[cy]?.[cx] ?? null;
        if (cellState === null) continue;
        const copied = { ...cellState, transform: { ...cellState.transform } } as CellState;
        applyCellEdit(source, cx, cy, null);
        applyCellEdit(newLayer, cx, cy, copied);
      }
    }

    // Source cells should be cleared
    expect(source.cells[0][0]).toBeNull();
    expect(source.cells[0][1]).toBeNull();
    expect(source.cells[1][0]).toBeNull();

    // New layer cells should have the original colors
    const c00 = newLayer.cells[0][0];
    expect(c00).not.toBeNull();
    expect(c00!.type).toBe('color');
    if (c00!.type === 'color') {
      expect(c00!.r).toBe(255);
      expect(c00!.g).toBe(0);
    }

    const c10 = newLayer.cells[0][1];
    expect(c10).not.toBeNull();
    if (c10!.type === 'color') {
      expect(c10!.r).toBe(0);
      expect(c10!.g).toBe(255);
    }

    const c01 = newLayer.cells[1][0];
    expect(c01).not.toBeNull();
    if (c01!.type === 'color') {
      expect(c01!.b).toBe(255);
    }
  });

  test('ADD_LAYER with shift initializes edge storage', () => {
    const layer = makeLayer('l', 2, 0);
    const state = makeState([layer]);

    const next = editorReducer(state, {
      type: 'ADD_LAYER',
      level: 2,
      name: 'Shifted',
      shiftX: 0.5,
      shiftY: 0.5,
    });

    const added = next.layers[next.layers.length - 1];
    expect(added.shiftX).toBe(0.5);
    expect(added.shiftY).toBe(0.5);
    expect(added.edgeRowTop).not.toBeNull();
    expect(added.edgeColLeft).not.toBeNull();
    expect(added.edgeRowTop!.length).toBe(CELL_COUNTS[2]);
    expect(added.edgeColLeft!.length).toBe(CELL_COUNTS[2]);
  });
});
