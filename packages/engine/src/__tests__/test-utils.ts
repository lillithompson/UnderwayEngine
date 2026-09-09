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


/** Offset of the v58+ coordinate-scale byte: header (8) + the 43 metadata
 *  bytes before it (nameIdx, gridLevel, camera ×3, strokeScale,
 *  gridIntensity). */
const COORD_SCALE_BYTE_AT = 8 + 43;

/**
 * Re-label a freshly serialized composition as an older format version —
 * the legacy-reader tests' trick for "a file an old build wrote" without
 * keeping fixtures. Pre-58 readers do not consume the coordinate-scale
 * byte v58 writes after gridIntensity, so for those targets it is spliced
 * out. The bytes are otherwise unchanged, so this is only faithful for
 * content the old reader decodes at the scale the writer chose: grid-snapped
 * geometry (whole and quarter cells), which stays at the gridLevel-derived
 * scale — every fixture these tests build.
 */
export function patchFormatVersion(bytes: Uint8Array, version: number): Uint8Array {
  let out = bytes.slice();
  if (version < 58) {
    out = new Uint8Array(bytes.length - 1);
    out.set(bytes.subarray(0, COORD_SCALE_BYTE_AT));
    out.set(bytes.subarray(COORD_SCALE_BYTE_AT + 1), COORD_SCALE_BYTE_AT);
  }
  new DataView(out.buffer, out.byteOffset, out.byteLength).setUint16(4, version, true);
  return out;
}
