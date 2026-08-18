import {
  Layer,
  GridLevel,
  LAYER_PX,
  CellState,
  initDirtyRects,
} from '../types';
import { createCellGrid, rebuildPixelData } from '../cells';

/**
 * Test helper: set a cell on a layer and re-render its pixel data.
 * Replaces the removed editor-side applyCellEdit for test setup.
 */
export function setCellForTest(layer: Layer, cellX: number, cellY: number, state: CellState): void {
  layer.cells[cellY][cellX] = state;
  layer.cellsGeneration++;
  rebuildPixelData(layer);
}

export function makeLayer(id: string, level: GridLevel = 0, order: number = 0): Layer {
  const data = new Uint8Array(LAYER_PX * LAYER_PX * 4);
  return {
    id,
    name: `Layer ${id}`,
    level,
    visible: true,
    opacity: 1,
    order,
    shiftX: 0,
    shiftY: 0,
    locked: false,
    data,
    dataU32: new Uint32Array(data.buffer),
    dirtyRects: initDirtyRects(),
    dirtyRectCount: 0,
    cells: createCellGrid(level),
    cellsGeneration: 0,
    edgeRowTop: null,
    edgeColLeft: null,
    edgeCorner: null,
  };
}

