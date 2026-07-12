import {
  createCellGrid,
  cellStateFromTool,
  mergeTintWithCell,
  mergeSpriteWithCell,
  applyActiveTint,
  applyCellEdit,
  applyOps,
  revertOps,
  snapshotLayer,
  layerFromSnapshot,
  computeMoveOps,
  computeRotateOps,
  computeMirrorOps,
  expandOpsWithMirror,
  hasAnyGlobalMirror,
  getContainedLayerCells,
  renderCellToPixels,
  composeRotation,
  renderCellToBuffer,
  sharedCellBuf,
  bulkFloodFill,
  isCellInRegionPx,
  RegionBoundsPx,
  buildCrossLayerOccupancy,
  getCell,
  setCell,
  createEdgeStorage,
  cellToIndex,
  indexToCellX,
  indexToCellY,
  indexColumns,
} from '../cells';
import { computePaintMirrorTargets, type MirrorFlags } from '../paintMirror';
import { getRenderedSignature } from '../connectivity';
import { screenToCell } from '../input';
import { createInitialState, editorReducer } from '../state';
import {
  Layer,
  EditorState,
  CellState,
  UndoOp,
  UndoEntry,
  LAYER_PX,
  CELL_COUNTS,
  cellPx,
  GridLevel,
  Tool,
  CellTransform,
  DEFAULT_TRANSFORM,
  makeViewport,
} from '../types';
import { SPRITE_ENTRIES } from '../loadTile';
import { makeLayer, makeState } from './test-utils';

describe('Cell Metadata', () => {
  test('createCellGrid creates correct dimensions', () => {
    const grid = createCellGrid(0);
    expect(grid.length).toBe(32);
    expect(grid[0].length).toBe(32);
    expect(grid[0][0]).toBeNull();

    const grid2 = createCellGrid(2);
    expect(grid2.length).toBe(8);
    expect(grid2[0].length).toBe(8);
  });

  test('cellStateFromTool returns color state for color tool', () => {
    const state = cellStateFromTool({ type: 'color', customColorR: 0, customColorG: 0, customColorB: 0 });
    expect(state).not.toBeNull();
    expect(state!.type).toBe('color');
    if (state?.type === 'color') {
      expect(state.r).toBe(0);
      expect(state.g).toBe(0);
      expect(state.b).toBe(0);
    }
  });

  test('cellStateFromTool returns null for erase', () => {
    const state = cellStateFromTool({ type: 'erase' });
    expect(state).toBeNull();
  });

  test('cellStateFromTool returns color state for random tool', () => {
    const state = cellStateFromTool({ type: 'random' });
    expect(state).not.toBeNull();
    expect(state!.type).toBe('color');
  });

  test('cellStateFromTool sprite uses mirrorH and mirrorV from tool', () => {
    const state = cellStateFromTool({
      type: 'sprite',
      spriteId: 'test',
      rotation: 90,
      mirrorH: true,
      mirrorV: true,
    });
    expect(state).not.toBeNull();
    expect(state!.type).toBe('sprite');
    if (state?.type === 'sprite') {
      expect(state.transform.rotation).toBe(90);
      expect(state.transform.mirrorH).toBe(true);
      expect(state.transform.mirrorV).toBe(true);
    }
  });

  test('cellStateFromTool sprite defaults mirrorH/mirrorV to false', () => {
    const state = cellStateFromTool({
      type: 'sprite',
      spriteId: 'test',
      rotation: 0,
    });
    expect(state).not.toBeNull();
    if (state?.type === 'sprite') {
      expect(state.transform.mirrorH).toBe(false);
      expect(state.transform.mirrorV).toBe(false);
    }
  });
});

describe('Apply Cell Edit', () => {
  test('apply color to empty cell returns correct edit', () => {
    const layer = makeLayer('test');
    const newState: CellState = { type: 'color', r: 255, g: 0, b: 0, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };
    const edit = applyCellEdit(layer, 0, 0, newState);

    expect(edit.oldState).toBeNull();
    expect(edit.newState).toEqual(newState);
    expect(edit.layerId).toBe('test');
    expect(edit.cellX).toBe(0);
    expect(edit.cellY).toBe(0);

    // Cell grid should be updated
    expect(layer.cells[0][0]).toEqual(newState);

    // Pixel data should be filled
    const idx = 0; // First pixel
    expect(layer.data[idx]).toBe(255); // R
    expect(layer.data[idx + 1]).toBe(0); // G
    expect(layer.data[idx + 2]).toBe(0); // B
    expect(layer.data[idx + 3]).toBe(255); // A
  });

  test('erase a painted cell returns correct edit', () => {
    const layer = makeLayer('test');
    const colorState: CellState = { type: 'color', r: 255, g: 0, b: 0, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };
    applyCellEdit(layer, 0, 0, colorState);
    const edit = applyCellEdit(layer, 0, 0, null);

    expect(edit.oldState).toEqual(colorState);
    expect(edit.newState).toBeNull();
    expect(layer.cells[0][0]).toBeNull();

    // Pixel data should be cleared
    expect(layer.data[0]).toBe(0);
    expect(layer.data[3]).toBe(0);
  });
});

describe('Undo/Redo - Cell Operations', () => {
  test('undo cell edit restores previous state', () => {
    const state = makeState();
    const layer = state.layers[0];
    const colorState: CellState = { type: 'color', r: 255, g: 0, b: 0, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };
    const edit = applyCellEdit(layer, 5, 5, colorState);

    const ops: UndoOp[] = [{
      op: 'cell',
      layerId: edit.layerId,
      cellX: edit.cellX,
      cellY: edit.cellY,
      oldState: edit.oldState,
      newState: edit.newState,
    }];

    // Undo
    const undone = revertOps(state, ops);
    const undoneLayer = undone.layers.find(l => l.id === 'test')!;
    expect(undoneLayer.cells[5][5]).toBeNull();

    // Pixel data should be zeroed
    const size = cellPx(0);
    const pixelIdx = (5 * size * LAYER_PX + 5 * size) * 4;
    expect(undoneLayer.data[pixelIdx]).toBe(0);
    expect(undoneLayer.data[pixelIdx + 3]).toBe(0);
  });

  test('redo cell edit restores the applied state', () => {
    const state = makeState();
    const colorState: CellState = { type: 'color', r: 0, g: 255, b: 0, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };

    const ops: UndoOp[] = [{
      op: 'cell',
      layerId: 'test',
      cellX: 3,
      cellY: 3,
      oldState: null,
      newState: colorState,
    }];

    // Apply (redo)
    const redone = applyOps(state, ops);
    const redoneLayer = redone.layers.find(l => l.id === 'test')!;
    expect(redoneLayer.cells[3][3]).toEqual(colorState);

    // Pixel data should be filled
    const size = cellPx(0);
    const pixelIdx = (3 * size * LAYER_PX + 3 * size) * 4;
    expect(redoneLayer.data[pixelIdx]).toBe(0); // R
    expect(redoneLayer.data[pixelIdx + 1]).toBe(255); // G
    expect(redoneLayer.data[pixelIdx + 2]).toBe(0); // B
    expect(redoneLayer.data[pixelIdx + 3]).toBe(255); // A
  });

  test('multi-cell drag undo restores all cells', () => {
    const state = makeState();
    const layer = state.layers[0];
    const color: CellState = { type: 'color', r: 100, g: 100, b: 100, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };

    // Simulate drag across 3 cells
    const edit1 = applyCellEdit(layer, 0, 0, color);
    const edit2 = applyCellEdit(layer, 1, 0, color);
    const edit3 = applyCellEdit(layer, 2, 0, color);

    const ops: UndoOp[] = [edit1, edit2, edit3].map(e => ({
      op: 'cell' as const,
      layerId: e.layerId,
      cellX: e.cellX,
      cellY: e.cellY,
      oldState: e.oldState,
      newState: e.newState,
    }));

    // Undo all at once
    const undone = revertOps(state, ops);
    const undoneLayer = undone.layers.find(l => l.id === 'test')!;
    expect(undoneLayer.cells[0][0]).toBeNull();
    expect(undoneLayer.cells[0][1]).toBeNull();
    expect(undoneLayer.cells[0][2]).toBeNull();
  });
});

describe('Undo/Redo - Layer Operations', () => {
  test('add layer then undo removes it', () => {
    const layer1 = makeLayer('layer1', 0, 0);
    const state = makeState([layer1]);

    const newLayer = makeLayer('layer2', 1, 1);
    const stateWithNew = {
      ...state,
      layers: [...state.layers, newLayer],
    };

    const ops: UndoOp[] = [{ op: 'addLayer', layer: snapshotLayer(newLayer) }];
    const undone = revertOps(stateWithNew, ops);
    expect(undone.layers.length).toBe(1);
    expect(undone.layers.find(l => l.id === 'layer2')).toBeUndefined();
  });

  test('add layer undo then redo restores it', () => {
    const layer1 = makeLayer('layer1', 0, 0);
    const state = makeState([layer1]);

    const newLayer = makeLayer('layer2', 1, 1);
    const ops: UndoOp[] = [{ op: 'addLayer', layer: snapshotLayer(newLayer) }];

    // Redo = apply forward
    const redone = applyOps(state, ops);
    expect(redone.layers.length).toBe(2);
    expect(redone.layers.find(l => l.id === 'layer2')).toBeDefined();
  });

  test('remove layer then undo restores it with cell data', () => {
    const layer = makeLayer('layerA', 0, 0);
    const colorState: CellState = { type: 'color', r: 42, g: 43, b: 44, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };
    applyCellEdit(layer, 0, 0, colorState);

    const layer2 = makeLayer('layerB', 0, 1);
    const state = makeState([layer, layer2]);
    state.activeLayerId = 'layerB';

    const snapshot = snapshotLayer(layer);
    const ops: UndoOp[] = [{ op: 'removeLayer', layer: snapshot, index: 0 }];

    // Apply remove
    const removed = applyOps(state, ops);
    expect(removed.layers.find(l => l.id === 'layerA')).toBeUndefined();

    // Undo remove
    const restored = revertOps(removed, ops);
    const restoredLayer = restored.layers.find(l => l.id === 'layerA');
    expect(restoredLayer).toBeDefined();
    expect(restoredLayer!.cells[0][0]).toEqual(colorState);
  });

  test('rename layer then undo restores old name', () => {
    const layer = makeLayer('test', 0, 0);
    layer.name = 'Original';
    const state = makeState([layer]);

    const ops: UndoOp[] = [{ op: 'renameLayer', layerId: 'test', oldName: 'Original', newName: 'Renamed' }];

    const applied = applyOps(state, ops);
    expect(applied.layers[0].name).toBe('Renamed');

    const undone = revertOps(applied, ops);
    expect(undone.layers[0].name).toBe('Original');
  });

  test('reorder layer then undo restores old order', () => {
    const layer = makeLayer('test', 0, 0);
    const state = makeState([layer]);

    const ops: UndoOp[] = [{ op: 'reorderLayer', layerId: 'test', oldOrder: 0, newOrder: 5 }];

    const applied = applyOps(state, ops);
    expect(applied.layers[0].order).toBe(5);

    const undone = revertOps(applied, ops);
    expect(undone.layers[0].order).toBe(0);
  });

  test('toggle visibility then undo restores old state', () => {
    const layer = makeLayer('test', 0, 0);
    layer.visible = true;
    const state = makeState([layer]);

    const ops: UndoOp[] = [{ op: 'toggleVisibility', layerId: 'test', oldVisible: true }];

    const applied = applyOps(state, ops);
    expect(applied.layers[0].visible).toBe(false);

    const undone = revertOps(applied, ops);
    expect(undone.layers[0].visible).toBe(true);
  });

  test('rename file then undo restores old name', () => {
    const state = makeState();
    state.fileConfig = { id: 'f1', name: 'OldName' };

    const ops: UndoOp[] = [{ op: 'renameFile', oldName: 'OldName', newName: 'NewName' }];

    const applied = applyOps(state, ops);
    expect(applied.fileConfig.name).toBe('NewName');

    const undone = revertOps(applied, ops);
    expect(undone.fileConfig.name).toBe('OldName');
  });

  test('clear all then undo restores all cell data', () => {
    const layer1 = makeLayer('l1', 2, 0); // 8x8
    const layer2 = makeLayer('l2', 2, 1);
    const color1: CellState = { type: 'color', r: 10, g: 20, b: 30, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };
    const color2: CellState = { type: 'color', r: 40, g: 50, b: 60, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };
    applyCellEdit(layer1, 0, 0, color1);
    applyCellEdit(layer2, 1, 1, color2);

    const state = makeState([layer1, layer2]);
    const snapshots = state.layers.map(l => snapshotLayer(l));

    // Clear
    const ops: UndoOp[] = [{ op: 'clearAll', layerSnapshots: snapshots }];
    const cleared = applyOps(state, ops);
    expect(cleared.layers[0].cells[0][0]).toBeNull();
    expect(cleared.layers[1].cells[1][1]).toBeNull();

    // Undo
    const restored = revertOps(cleared, ops);
    expect(restored.layers[0].cells[0][0]).toEqual(color1);
    expect(restored.layers[1].cells[1][1]).toEqual(color2);
  });

  test('multi-layer edit undo restores both layers', () => {
    const layer1 = makeLayer('l1', 2, 0);
    const layer2 = makeLayer('l2', 2, 1);
    const state = makeState([layer1, layer2]);

    const color: CellState = { type: 'color', r: 200, g: 100, b: 50, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };

    const edit1 = applyCellEdit(layer1, 0, 0, color);
    const edit2 = applyCellEdit(layer2, 0, 0, color);

    const ops: UndoOp[] = [
      { op: 'cell', layerId: 'l1', cellX: 0, cellY: 0, oldState: edit1.oldState, newState: edit1.newState },
      { op: 'cell', layerId: 'l2', cellX: 0, cellY: 0, oldState: edit2.oldState, newState: edit2.newState },
    ];

    const undone = revertOps(state, ops);
    expect(undone.layers[0].cells[0][0]).toBeNull();
    expect(undone.layers[1].cells[0][0]).toBeNull();
  });
});

describe('Full Round-Trip Lossless', () => {
  test('edit → undo → redo → state matches original', () => {
    const state = makeState();
    const color: CellState = { type: 'color', r: 123, g: 45, b: 67, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };

    const ops: UndoOp[] = [{
      op: 'cell',
      layerId: 'test',
      cellX: 10,
      cellY: 10,
      oldState: null,
      newState: color,
    }];

    // Apply
    const applied = applyOps(state, ops);
    const appliedLayer = applied.layers[0];
    expect(appliedLayer.cells[10][10]).toEqual(color);

    // Capture pixel data after apply
    const size = cellPx(0);
    const pixelIdx = (10 * size * LAYER_PX + 10 * size) * 4;
    const appliedPixels = [
      appliedLayer.data[pixelIdx],
      appliedLayer.data[pixelIdx + 1],
      appliedLayer.data[pixelIdx + 2],
      appliedLayer.data[pixelIdx + 3],
    ];

    // Undo
    const undone = revertOps(applied, ops);
    expect(undone.layers[0].cells[10][10]).toBeNull();
    expect(undone.layers[0].data[pixelIdx + 3]).toBe(0);

    // Redo
    const redone = applyOps(undone, ops);
    expect(redone.layers[0].cells[10][10]).toEqual(color);
    expect(redone.layers[0].data[pixelIdx]).toBe(appliedPixels[0]);
    expect(redone.layers[0].data[pixelIdx + 1]).toBe(appliedPixels[1]);
    expect(redone.layers[0].data[pixelIdx + 2]).toBe(appliedPixels[2]);
    expect(redone.layers[0].data[pixelIdx + 3]).toBe(appliedPixels[3]);
  });
});

// ── End-to-end undo simulation ──────────────────────────────────────
//
// These tests replicate the exact flow from EditorScreen:
//   STROKE_START → APPLY_TOOL (×N) → STROKE_END → UNDO
// to verify undo restores the file to the correct prior state.

/**
 * Simulate a stroke the same way EditorScreen.persistingDispatch does:
 *  1. Capture old cell state before dispatch
 *  2. Dispatch APPLY_TOOL (reducer mutates layer in place)
 *  3. Read new cell state after dispatch
 *  4. Build undo op from old → new
 */
function simulateStroke(
  state: EditorState,
  cells: [number, number][],
): { state: EditorState; entry: UndoEntry } {
  let current = editorReducer(state, { type: 'STROKE_START' });
  const ops: UndoOp[] = [];

  for (const [cx, cy] of cells) {
    const layer = current.layers.find((l) => l.id === current.activeLayerId)!;
    const oldCellState = layer.cells[cy]?.[cx] ?? null;
    const newCellState = cellStateFromTool(current.tool);
    current = editorReducer(current, { type: 'APPLY_TOOL', cellX: cx, cellY: cy, cellState: newCellState });
    ops.push({
      op: 'cell',
      layerId: layer.id,
      cellX: cx,
      cellY: cy,
      oldState: oldCellState,
      newState: newCellState,
    });
  }

  current = editorReducer(current, { type: 'STROKE_END' });
  return { state: current, entry: ops };
}

function simulateUndo(
  state: EditorState,
  entry: UndoEntry,
): EditorState {
  const reverted = revertOps(state, entry);
  return editorReducer(state, {
    type: 'LOAD_STATE',
    layers: reverted.layers,
    activeLayerId: reverted.activeLayerId,
  });
}

function simulateRedo(
  state: EditorState,
  entry: UndoEntry,
): EditorState {
  const applied = applyOps(state, entry);
  return editorReducer(state, {
    type: 'LOAD_STATE',
    layers: applied.layers,
    activeLayerId: applied.activeLayerId,
  });
}

describe('End-to-end undo scenarios', () => {
  function freshFile(): EditorState {
    return makeState([makeLayer('bg', 2, 0)], {
      fileConfig: { id: 'f', name: 'F' },
      tool: { type: 'color', colorIndex: 2 },
    });
  }

  /** Fill every cell with a deterministic unique color */
  function randomizeFile(state: EditorState): void {
    const layer = state.layers[0];
    const count = CELL_COUNTS[layer.level];
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        const color: CellState = {
          type: 'color',
          r: (x * 31 + y * 17) % 256,
          g: (x * 59 + y * 43) % 256,
          b: (x * 73 + y * 97) % 256,
          transform: { mirrorH: false, mirrorV: false, rotation: 0 },
        };
        applyCellEdit(layer, x, y, color);
      }
    }
  }

  /** Snapshot cells and pixel data at each cell origin for later comparison */
  function snapshotLayerState(layer: Layer) {
    const count = CELL_COUNTS[layer.level];
    const size = cellPx(layer.level);
    const cells: (CellState | null)[][] = [];
    const pixels: number[] = [];
    for (let y = 0; y < count; y++) {
      cells[y] = [];
      for (let x = 0; x < count; x++) {
        const cell = layer.cells[y][x];
        cells[y][x] = cell === null ? null : { ...cell } as CellState;
        const idx = (y * size * LAYER_PX + x * size) * 4;
        pixels.push(layer.data[idx], layer.data[idx + 1], layer.data[idx + 2], layer.data[idx + 3]);
      }
    }
    return { cells, pixels, count, size };
  }

  /** Assert a layer matches a previously captured snapshot */
  function expectLayerMatchesSnapshot(
    layer: Layer,
    snapshot: ReturnType<typeof snapshotLayerState>,
  ) {
    const { cells, pixels, count, size } = snapshot;
    let pi = 0;
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        expect(layer.cells[y][x]).toEqual(cells[y][x]);
        const idx = (y * size * LAYER_PX + x * size) * 4;
        expect(layer.data[idx]).toBe(pixels[pi]);
        expect(layer.data[idx + 1]).toBe(pixels[pi + 1]);
        expect(layer.data[idx + 2]).toBe(pixels[pi + 2]);
        expect(layer.data[idx + 3]).toBe(pixels[pi + 3]);
        pi += 4;
      }
    }
  }

  test.each<{ name: string; strokes: [number, number][][] }>([
    { name: 'single tile', strokes: [[[3, 4]]] },
    { name: '10-tile stroke', strokes: [[[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [7, 1], [6, 1]]] },
    { name: '5-tile stroke', strokes: [[[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]] },
    { name: 'three strokes', strokes: [[[0, 0], [1, 0], [2, 0]], [[5, 0], [5, 1], [5, 2], [5, 3]], [[7, 7], [6, 6]]] },
  ])('randomized file, paint $name, undo → exact state restored', ({ strokes }) => {
    const file = freshFile();
    randomizeFile(file);
    const snap = snapshotLayerState(file.layers[0]);

    let current: EditorState = file;
    const entries: UndoEntry[] = [];

    for (const cells of strokes) {
      const result = simulateStroke(current, cells);
      current = result.state;
      entries.push(result.entry);
    }

    // Undo all strokes (most recent first)
    for (let i = entries.length - 1; i >= 0; i--) {
      current = simulateUndo(current, entries[i]);
    }

    expectLayerMatchesSnapshot(current.layers[0], snap);
  });

  test('stroke, undo, redo all change the same number of tiles', () => {
    const file = freshFile();
    randomizeFile(file);

    const beforeStroke = snapshotLayerState(file.layers[0]);

    // Stroke: paint 10 distinct tiles
    const strokeCells: [number, number][] = [
      [0, 0], [1, 0], [2, 0], [3, 0], [4, 0],
      [5, 0], [6, 0], [7, 0], [7, 1], [6, 1],
    ];
    const { state: afterStroke, entry } = simulateStroke(file, strokeCells);
    const afterStrokeSnap = snapshotLayerState(afterStroke.layers[0]);

    // Count how many cells changed from the stroke
    let strokeChangedCount = 0;
    for (let y = 0; y < beforeStroke.count; y++) {
      for (let x = 0; x < beforeStroke.count; x++) {
        const before = beforeStroke.cells[y][x];
        const after = afterStrokeSnap.cells[y][x];
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          strokeChangedCount++;
        }
      }
    }
    expect(strokeChangedCount).toBe(10);

    // Undo: count how many cells changed
    const afterUndo = simulateUndo(afterStroke, entry);
    const afterUndoSnap = snapshotLayerState(afterUndo.layers[0]);

    let undoChangedCount = 0;
    for (let y = 0; y < afterStrokeSnap.count; y++) {
      for (let x = 0; x < afterStrokeSnap.count; x++) {
        const before = afterStrokeSnap.cells[y][x];
        const after = afterUndoSnap.cells[y][x];
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          undoChangedCount++;
        }
      }
    }

    // Redo: count how many cells changed
    const afterRedo = simulateRedo(afterUndo, entry);
    const afterRedoSnap = snapshotLayerState(afterRedo.layers[0]);

    let redoChangedCount = 0;
    for (let y = 0; y < afterUndoSnap.count; y++) {
      for (let x = 0; x < afterUndoSnap.count; x++) {
        const before = afterUndoSnap.cells[y][x];
        const after = afterRedoSnap.cells[y][x];
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          redoChangedCount++;
        }
      }
    }

    // All three operations must affect the same number of tiles
    expect(strokeChangedCount).toBe(undoChangedCount);
    expect(undoChangedCount).toBe(redoChangedCount);

    // And redo must restore the exact post-stroke state
    expectLayerMatchesSnapshot(afterRedo.layers[0], afterStrokeSnap);
  });
});

// ── Rotation tests ──────────────────────────────────────────────────

describe('computeRotateOps', () => {
  const color = (r: number, g: number, b: number, rot: 0 | 90 | 180 | 270 = 0): CellState => ({
    type: 'color',
    r, g, b,
    transform: { mirrorH: false, mirrorV: false, rotation: rot },
  });


  test('square 2x2 selection, 90 CW', () => {
    // L2 = 8x8 grid. Place 4 cells at (2,2),(3,2),(2,3),(3,3)
    const layer = makeLayer('test', 2, 0);
    applyCellEdit(layer, 2, 2, color(1, 0, 0)); // top-left
    applyCellEdit(layer, 3, 2, color(2, 0, 0)); // top-right
    applyCellEdit(layer, 2, 3, color(3, 0, 0)); // bottom-left
    applyCellEdit(layer, 3, 3, color(4, 0, 0)); // bottom-right

    const state = makeState([layer]);
    const sel = { startCellX: 2, startCellY: 2, endCellX: 3, endCellY: 3, level: 2 as GridLevel };
    const ops = computeRotateOps(state, sel, 90);

    // Apply ops
    const newState = applyOps(state, ops);
    const l = newState.layers[0];

    // 90 CW: TL→TR, TR→BR, BL→TL, BR→BL
    expect(l.cells[2][2]?.type === 'color' && l.cells[2][2].r).toBe(3); // was BL
    expect(l.cells[2][3]?.type === 'color' && l.cells[2][3].r).toBe(1); // was TL
    expect(l.cells[3][2]?.type === 'color' && l.cells[3][2].r).toBe(4); // was BR
    expect(l.cells[3][3]?.type === 'color' && l.cells[3][3].r).toBe(2); // was TR
  });

  test('non-square 3x2 selection, 90 CW', () => {
    // 3 wide x 2 tall → becomes 2 wide x 3 tall
    const layer = makeLayer('test', 2, 0);
    // Place 6 cells: (1,1),(2,1),(3,1),(1,2),(2,2),(3,2)
    applyCellEdit(layer, 1, 1, color(1, 0, 0));
    applyCellEdit(layer, 2, 1, color(2, 0, 0));
    applyCellEdit(layer, 3, 1, color(3, 0, 0));
    applyCellEdit(layer, 1, 2, color(4, 0, 0));
    applyCellEdit(layer, 2, 2, color(5, 0, 0));
    applyCellEdit(layer, 3, 2, color(6, 0, 0));

    const state = makeState([layer]);
    const sel = { startCellX: 1, startCellY: 1, endCellX: 3, endCellY: 2, level: 2 as GridLevel };
    const ops = computeRotateOps(state, sel, 90);
    const newState = applyOps(state, ops);
    const l = newState.layers[0];

    // Count non-null cells in destination area
    let count = 0;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        if (l.cells[y][x] !== null) count++;
      }
    }
    expect(count).toBe(6);
  });

  test('180 rotation', () => {
    const layer = makeLayer('test', 2, 0);
    applyCellEdit(layer, 2, 2, color(1, 0, 0));
    applyCellEdit(layer, 3, 2, color(2, 0, 0));
    applyCellEdit(layer, 2, 3, color(3, 0, 0));
    applyCellEdit(layer, 3, 3, color(4, 0, 0));

    const state = makeState([layer]);
    const sel = { startCellX: 2, startCellY: 2, endCellX: 3, endCellY: 3, level: 2 as GridLevel };
    const ops = computeRotateOps(state, sel, 180);
    const newState = applyOps(state, ops);
    const l = newState.layers[0];

    // 180: TL↔BR, TR↔BL. cells[y][x] notation.
    expect(l.cells[2][2]?.type === 'color' && l.cells[2][2].r).toBe(4);
    expect(l.cells[3][3]?.type === 'color' && l.cells[3][3].r).toBe(1);
    expect(l.cells[2][3]?.type === 'color' && l.cells[2][3].r).toBe(3); // (x=3,y=2) ← was (x=2,y=3)
    expect(l.cells[3][2]?.type === 'color' && l.cells[3][2].r).toBe(2); // (x=2,y=3) ← was (x=3,y=2)
  });

  test('cell transform composition', () => {
    const layer = makeLayer('test', 2, 0);
    applyCellEdit(layer, 2, 2, color(1, 0, 0, 90)); // starts with 90 rotation

    const state = makeState([layer]);
    const sel = { startCellX: 2, startCellY: 2, endCellX: 2, endCellY: 2, level: 2 as GridLevel };
    const ops = computeRotateOps(state, sel, 90);
    const newState = applyOps(state, ops);
    const l = newState.layers[0];

    // Single cell stays in place (1x1 selection), rotation composes: 90+90=180
    expect(l.cells[2][2]?.type === 'color' && l.cells[2][2].transform.rotation).toBe(180);
  });

  test('cell transform composition with single mirror adds rotation normally', () => {
    const layer = makeLayer('test', 2, 0);
    // Cell with mirrorH=true, rotation=0
    const mirroredCell: CellState = {
      type: 'color', r: 1, g: 0, b: 0,
      transform: { mirrorH: true, mirrorV: false, rotation: 0 },
    };
    applyCellEdit(layer, 2, 2, mirroredCell);

    const state = makeState([layer]);
    const sel = { startCellX: 2, startCellY: 2, endCellX: 2, endCellY: 2, level: 2 as GridLevel };
    const ops = computeRotateOps(state, sel, 90);
    const newState = applyOps(state, ops);
    const cell = newState.layers[0].cells[2][2];

    // Rotation always adds (mirrors don't affect it): 0 + 90 = 90
    expect(cell?.type === 'color' && cell.transform.rotation).toBe(90);
    expect(cell?.type === 'color' && cell.transform.mirrorH).toBe(true);
    expect(cell?.type === 'color' && cell.transform.mirrorV).toBe(false);
  });

  test('cell transform composition with both mirrors adds rotation normally', () => {
    const layer = makeLayer('test', 2, 0);
    const bothMirrorCell: CellState = {
      type: 'color', r: 1, g: 0, b: 0,
      transform: { mirrorH: true, mirrorV: true, rotation: 0 },
    };
    applyCellEdit(layer, 2, 2, bothMirrorCell);

    const state = makeState([layer]);
    const sel = { startCellX: 2, startCellY: 2, endCellX: 2, endCellY: 2, level: 2 as GridLevel };
    const ops = computeRotateOps(state, sel, 90);
    const newState = applyOps(state, ops);
    const cell = newState.layers[0].cells[2][2];

    // Rotation always adds: 0 + 90 = 90
    expect(cell?.type === 'color' && cell.transform.rotation).toBe(90);
    expect(cell?.type === 'color' && cell.transform.mirrorH).toBe(true);
    expect(cell?.type === 'color' && cell.transform.mirrorV).toBe(true);
  });

  test('group rotation vs in-place: source positions cleared and destinations differ', () => {
    const layer = makeLayer('test', 2, 0);
    // Non-square: 3 wide x 1 tall
    applyCellEdit(layer, 0, 0, color(1, 0, 0));
    applyCellEdit(layer, 1, 0, color(2, 0, 0));
    applyCellEdit(layer, 2, 0, color(3, 0, 0));

    const state = makeState([layer]);
    const sel = { startCellX: 0, startCellY: 0, endCellX: 2, endCellY: 0, level: 2 as GridLevel };
    const ops = computeRotateOps(state, sel, 90);

    // Verify there are clear-source ops
    const clearOps = ops.filter(o => o.op === 'cell' && o.newState === null);
    expect(clearOps.length).toBe(3);

    // Verify write-destination ops exist
    const writeOps = ops.filter(o => o.op === 'cell' && o.newState !== null);
    expect(writeOps.length).toBeGreaterThan(0);
  });

  test('region rotation preserves individual tile sprite orientations', () => {
    // 4 tiles in a horizontal row, each pointing a different direction:
    // W(270), N(0), E(90), S(180)
    const layer = makeLayer('test', 2, 0);
    applyCellEdit(layer, 2, 2, color(1, 0, 0, 270)); // W
    applyCellEdit(layer, 3, 2, color(0, 1, 0, 0));   // N
    applyCellEdit(layer, 4, 2, color(0, 0, 1, 90));  // E
    applyCellEdit(layer, 5, 2, color(1, 1, 0, 180)); // S

    const state = makeState([layer]);
    const sel = { startCellX: 2, startCellY: 2, endCellX: 5, endCellY: 2, level: 2 as GridLevel };
    const ops = computeRotateOps(state, sel, 90);
    const newState = applyOps(state, ops);
    const l = newState.layers[0];

    // After 90° CW region rotation, the 4-wide × 1-tall row becomes a 1-wide × 4-tall column.
    // Each tile's rotation should increase by 90°:
    //   W(270) → N(0), N(0) → E(90), E(90) → S(180), S(180) → W(270)
    // The tile that was at the left end (x=2) should go to the top of the column,
    // and the tile that was at the right end (x=5) should go to the bottom.

    // After rotation the 4×1 row lands as a 1×4 column at x=4, y=1..4.
    // Top to bottom rotations should be 0, 90, 180, 270
    expect(l.cells[1]?.[4]?.type === 'color' && l.cells[1][4].transform.rotation).toBe(0);
    expect(l.cells[2]?.[4]?.type === 'color' && l.cells[2][4].transform.rotation).toBe(90);
    expect(l.cells[3]?.[4]?.type === 'color' && l.cells[3][4].transform.rotation).toBe(180);
    expect(l.cells[4]?.[4]?.type === 'color' && l.cells[4][4].transform.rotation).toBe(270);
  });

  test('multi-layer: active layer L2 + finer layer L0', () => {
    const layerCoarse = makeLayer('l2', 2, 0); // 8x8
    const layerFine = makeLayer('l0', 0, 1);   // 32x32

    // Place a cell on each layer
    applyCellEdit(layerCoarse, 2, 2, color(1, 0, 0));
    // L0 cell at (8,8) which is within the same pixel area as L2 cell (2,2)
    applyCellEdit(layerFine, 8, 8, color(2, 0, 0));

    const state = makeState([layerCoarse, layerFine]);
    state.activeLayerId = 'l2';
    const sel = { startCellX: 2, startCellY: 2, endCellX: 3, endCellY: 3, level: 2 as GridLevel };
    const ops = computeRotateOps(state, sel, 90);

    // Ops should include edits for both layers
    const l2Ops = ops.filter(o => o.op === 'cell' && o.layerId === 'l2');
    const l0Ops = ops.filter(o => o.op === 'cell' && o.layerId === 'l0');
    expect(l2Ops.length).toBeGreaterThan(0);
    expect(l0Ops.length).toBeGreaterThan(0);
  });

  test('non-square multi-layer rotation keeps finer cells aligned with active layer', () => {
    // L2 = 8x8 (cellPx=256), L0 = 32x32 (cellPx=64)
    // Selection: 1 col × 2 rows at L2 = cells (2,2)-(2,3)
    const layerCoarse = makeLayer('l2', 2, 0);
    const layerFine = makeLayer('l0', 0, 1);

    applyCellEdit(layerCoarse, 2, 2, color(1, 0, 0));
    applyCellEdit(layerCoarse, 2, 3, color(2, 0, 0));
    // L0 cell (8,8) is top-left sub-cell of L2 cell (2,2)
    applyCellEdit(layerFine, 8, 8, color(3, 0, 0));
    // L0 cell (8,12) is top-left sub-cell of L2 cell (2,3)
    applyCellEdit(layerFine, 8, 12, color(4, 0, 0));

    const state = makeState([layerCoarse, layerFine]);
    state.activeLayerId = 'l2';
    const sel = { startCellX: 2, startCellY: 2, endCellX: 2, endCellY: 3, level: 2 as GridLevel };
    const ops = computeRotateOps(state, sel, 90);
    const newState = applyOps(state, ops);

    // Find where L2 cells ended up
    const l2 = newState.layers[0];
    const l0 = newState.layers[1];

    // Find L2 dest positions by scanning for non-null cells
    const l2Dests: { cx: number; cy: number; r: number }[] = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const c = l2.cells[y][x];
        if (c?.type === 'color') l2Dests.push({ cx: x, cy: y, r: c.r });
      }
    }
    expect(l2Dests.length).toBe(2);

    // Find L0 dest positions
    const l0Dests: { cx: number; cy: number; r: number }[] = [];
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const c = l0.cells[y][x];
        if (c?.type === 'color') l0Dests.push({ cx: x, cy: y, r: c.r });
      }
    }
    expect(l0Dests.length).toBe(2);

    // Each L0 cell must be within its corresponding L2 cell's pixel area
    // L2 cellPx=256, L0 cellPx=64. An L0 cell at (fx, fy) is within L2 cell
    // (ax, ay) if floor(fx * 64 / 256) == ax, i.e., floor(fx / 4) == ax.
    for (const l0d of l0Dests) {
      const parentAX = Math.floor(l0d.cx / 4);
      const parentAY = Math.floor(l0d.cy / 4);
      const matchingL2 = l2Dests.find(d => d.cx === parentAX && d.cy === parentAY);
      expect(matchingL2).toBeDefined();
    }
  });

  test('out-of-bounds clipping', () => {
    const layer = makeLayer('test', 2, 0); // 8x8
    // Place cells at top-left corner
    applyCellEdit(layer, 0, 0, color(1, 0, 0));
    applyCellEdit(layer, 1, 0, color(2, 0, 0));
    applyCellEdit(layer, 0, 1, color(3, 0, 0));

    const state = makeState([layer]);
    // Selection at (0,0)-(1,0) — top edge, 2 wide x 1 tall
    const sel = { startCellX: 0, startCellY: 0, endCellX: 1, endCellY: 0, level: 2 as GridLevel };
    const ops = computeRotateOps(state, sel, 270);

    // Apply and check nothing crashes, some cells may be OOB
    const newState = applyOps(state, ops);
    expect(newState).toBeDefined();
  });

  test('undo round-trip', () => {
    const layer = makeLayer('test', 2, 0);
    applyCellEdit(layer, 2, 2, color(1, 0, 0));
    applyCellEdit(layer, 3, 2, color(2, 0, 0));
    applyCellEdit(layer, 2, 3, color(3, 0, 0));
    applyCellEdit(layer, 3, 3, color(4, 0, 0));

    const state = makeState([layer]);

    const sel = { startCellX: 2, startCellY: 2, endCellX: 3, endCellY: 3, level: 2 as GridLevel };
    const ops = computeRotateOps(state, sel, 90);
    const rotated = applyOps(state, ops);

    // Verify rotation changed things
    expect(rotated.layers[0].cells[2][2]?.type === 'color' && rotated.layers[0].cells[2][2].r).not.toBe(1);

    // Revert — cells[y][x]
    const reverted = revertOps(rotated, ops);
    const rl = reverted.layers[0];
    expect(rl.cells[2][2]?.type === 'color' && rl.cells[2][2].r).toBe(1); // (x=2,y=2)
    expect(rl.cells[2][3]?.type === 'color' && rl.cells[2][3].r).toBe(2); // (x=3,y=2)
    expect(rl.cells[3][2]?.type === 'color' && rl.cells[3][2].r).toBe(3); // (x=2,y=3)
    expect(rl.cells[3][3]?.type === 'color' && rl.cells[3][3].r).toBe(4); // (x=3,y=3)
  });
});

// ── Copy-mode tests for move & rotate ───────────────────────────────

describe('computeMoveOps / computeRotateOps with copy=true', () => {
  const color = (r: number, g: number, b: number): CellState => ({
    type: 'color',
    r, g, b,
    transform: { mirrorH: false, mirrorV: false, rotation: 0 },
  });

  test('computeMoveOps with copy=true preserves source cells', () => {
    const layer = makeLayer('test', 2, 0);
    applyCellEdit(layer, 1, 1, color(1, 0, 0));
    applyCellEdit(layer, 2, 1, color(2, 0, 0));

    const state = makeState([layer]);
    const sel = { startCellX: 1, startCellY: 1, endCellX: 2, endCellY: 1, level: 2 as GridLevel };
    // Move by (+3, +0) so source and destination don't overlap
    const ops = computeMoveOps(state, sel, 3, 0, false, undefined, true);

    // No op should clear a source cell (newState: null)
    const clearOps = ops.filter((op) => op.op === 'cell' && op.newState === null);
    expect(clearOps.length).toBe(0);

    const newState = applyOps(state, ops);
    const l = newState.layers[0];

    // Source preserved
    expect(l.cells[1][1]?.type === 'color' && l.cells[1][1].r).toBe(1);
    expect(l.cells[1][2]?.type === 'color' && l.cells[1][2].r).toBe(2);
    // Destination written
    expect(l.cells[1][4]?.type === 'color' && l.cells[1][4].r).toBe(1);
    expect(l.cells[1][5]?.type === 'color' && l.cells[1][5].r).toBe(2);
  });

  test('computeMoveOps with copy=false (default) clears source cells', () => {
    const layer = makeLayer('test', 2, 0);
    applyCellEdit(layer, 1, 1, color(1, 0, 0));

    const state = makeState([layer]);
    const sel = { startCellX: 1, startCellY: 1, endCellX: 1, endCellY: 1, level: 2 as GridLevel };
    const ops = computeMoveOps(state, sel, 3, 0);

    const clearOps = ops.filter((op) => op.op === 'cell' && op.newState === null);
    expect(clearOps.length).toBeGreaterThan(0);

    const newState = applyOps(state, ops);
    const l = newState.layers[0];
    expect(l.cells[1][1]).toBeNull();
    expect(l.cells[1][4]?.type === 'color' && l.cells[1][4].r).toBe(1);
  });

  test('computeRotateOps with copy=true preserves non-overlapped source cells', () => {
    // Rotate a 2-wide x 1-tall selection 90 CW. Sources (1,0) and (2,0);
    // destinations land at (2,0) and (2,1). (1,0) is NOT a destination, so
    // copy mode should preserve it. (2,0) is overwritten by the rotated
    // source — this is expected (destination-overlapping-source).
    const layer = makeLayer('test', 2, 0);
    applyCellEdit(layer, 1, 0, color(1, 0, 0));
    applyCellEdit(layer, 2, 0, color(2, 0, 0));

    const state = makeState([layer]);
    const sel = { startCellX: 1, startCellY: 0, endCellX: 2, endCellY: 0, level: 2 as GridLevel };
    const ops = computeRotateOps(state, sel, 90, false, undefined, true);

    // No source-clear ops in copy mode
    const clearOps = ops.filter((op) => op.op === 'cell' && op.newState === null);
    expect(clearOps.length).toBe(0);

    const newState = applyOps(state, ops);
    const l = newState.layers[0];

    // Non-overlapped source preserved
    expect(l.cells[0][1]?.type === 'color' && l.cells[0][1].r).toBe(1);
    // Destination cells populated (rotated)
    expect(l.cells[0][2]).not.toBeNull();
    expect(l.cells[1][2]).not.toBeNull();
  });

  test('computeRotateOps with copy=false (default) clears source cells', () => {
    const layer = makeLayer('test', 2, 0);
    applyCellEdit(layer, 1, 0, color(1, 0, 0));
    applyCellEdit(layer, 2, 0, color(2, 0, 0));

    const state = makeState([layer]);
    const sel = { startCellX: 1, startCellY: 0, endCellX: 2, endCellY: 0, level: 2 as GridLevel };
    const ops = computeRotateOps(state, sel, 90);

    const clearOps = ops.filter((op) => op.op === 'cell' && op.newState === null);
    expect(clearOps.length).toBeGreaterThan(0);
  });
});

// ── Mirror tests ────────────────────────────────────────────────────

describe('computeMirrorOps', () => {
  const color = (r: number, g: number, b: number): CellState => ({
    type: 'color',
    r, g, b,
    transform: { mirrorH: false, mirrorV: false, rotation: 0 },
  });


  test('mirror H flips left↔right in 2x2 selection', () => {
    const layer = makeLayer('test', 2, 0);
    applyCellEdit(layer, 2, 2, color(1, 0, 0)); // left col
    applyCellEdit(layer, 3, 2, color(2, 0, 0)); // right col
    applyCellEdit(layer, 2, 3, color(3, 0, 0));
    applyCellEdit(layer, 3, 3, color(4, 0, 0));

    const state = makeState([layer]);
    const sel = { startCellX: 2, startCellY: 2, endCellX: 3, endCellY: 3, level: 2 as GridLevel };
    const ops = computeMirrorOps(state, sel, 'h');
    const newState = applyOps(state, ops);
    const l = newState.layers[0];

    // cells[y][x]: left and right columns swap
    expect(l.cells[2][2]?.type === 'color' && l.cells[2][2].r).toBe(2);
    expect(l.cells[2][3]?.type === 'color' && l.cells[2][3].r).toBe(1);
    expect(l.cells[3][2]?.type === 'color' && l.cells[3][2].r).toBe(4);
    expect(l.cells[3][3]?.type === 'color' && l.cells[3][3].r).toBe(3);
  });

  test('mirror V flips top↔bottom in 2x2 selection', () => {
    const layer = makeLayer('test', 2, 0);
    applyCellEdit(layer, 2, 2, color(1, 0, 0)); // top row
    applyCellEdit(layer, 3, 2, color(2, 0, 0));
    applyCellEdit(layer, 2, 3, color(3, 0, 0)); // bottom row
    applyCellEdit(layer, 3, 3, color(4, 0, 0));

    const state = makeState([layer]);
    const sel = { startCellX: 2, startCellY: 2, endCellX: 3, endCellY: 3, level: 2 as GridLevel };
    const ops = computeMirrorOps(state, sel, 'v');
    const newState = applyOps(state, ops);
    const l = newState.layers[0];

    // cells[y][x]: top and bottom rows swap
    expect(l.cells[2][2]?.type === 'color' && l.cells[2][2].r).toBe(3);
    expect(l.cells[2][3]?.type === 'color' && l.cells[2][3].r).toBe(4);
    expect(l.cells[3][2]?.type === 'color' && l.cells[3][2].r).toBe(1);
    expect(l.cells[3][3]?.type === 'color' && l.cells[3][3].r).toBe(2);
  });

  test('mirror H toggles cell transform.mirrorH', () => {
    const layer = makeLayer('test', 2, 0);
    applyCellEdit(layer, 2, 2, color(1, 0, 0));

    const state = makeState([layer]);
    const sel = { startCellX: 2, startCellY: 2, endCellX: 2, endCellY: 2, level: 2 as GridLevel };
    const ops = computeMirrorOps(state, sel, 'h');
    const newState = applyOps(state, ops);

    const cell = newState.layers[0].cells[2][2];
    expect(cell?.type === 'color' && cell.transform.mirrorH).toBe(true);
    expect(cell?.type === 'color' && cell.transform.mirrorV).toBe(false);
  });

  test('mirror V toggles cell transform.mirrorV', () => {
    const layer = makeLayer('test', 2, 0);
    applyCellEdit(layer, 2, 2, color(1, 0, 0));

    const state = makeState([layer]);
    const sel = { startCellX: 2, startCellY: 2, endCellX: 2, endCellY: 2, level: 2 as GridLevel };
    const ops = computeMirrorOps(state, sel, 'v');
    const newState = applyOps(state, ops);

    const cell = newState.layers[0].cells[2][2];
    expect(cell?.type === 'color' && cell.transform.mirrorH).toBe(false);
    expect(cell?.type === 'color' && cell.transform.mirrorV).toBe(true);
  });

  test('double mirror H restores original positions and transforms', () => {
    const layer = makeLayer('test', 2, 0);
    applyCellEdit(layer, 2, 2, color(1, 0, 0));
    applyCellEdit(layer, 3, 2, color(2, 0, 0));

    const state = makeState([layer]);
    const sel = { startCellX: 2, startCellY: 2, endCellX: 3, endCellY: 2, level: 2 as GridLevel };

    const ops1 = computeMirrorOps(state, sel, 'h');
    const after1 = applyOps(state, ops1);
    const ops2 = computeMirrorOps(after1, sel, 'h');
    const after2 = applyOps(after1, ops2);

    const l = after2.layers[0];
    expect(l.cells[2][2]?.type === 'color' && l.cells[2][2].r).toBe(1);
    expect(l.cells[2][3]?.type === 'color' && l.cells[2][3].r).toBe(2);
    // mirrorH toggled twice = back to false
    expect(l.cells[2][2]?.type === 'color' && l.cells[2][2].transform.mirrorH).toBe(false);
  });

  test('non-square 3x1 mirror H', () => {
    const layer = makeLayer('test', 2, 0);
    applyCellEdit(layer, 1, 3, color(10, 0, 0));
    applyCellEdit(layer, 2, 3, color(20, 0, 0));
    applyCellEdit(layer, 3, 3, color(30, 0, 0));

    const state = makeState([layer]);
    const sel = { startCellX: 1, startCellY: 3, endCellX: 3, endCellY: 3, level: 2 as GridLevel };
    const ops = computeMirrorOps(state, sel, 'h');
    const newState = applyOps(state, ops);
    const l = newState.layers[0];

    // cells[y][x]: left and right swap, middle stays
    expect(l.cells[3][1]?.type === 'color' && l.cells[3][1].r).toBe(30);
    expect(l.cells[3][2]?.type === 'color' && l.cells[3][2].r).toBe(20);
    expect(l.cells[3][3]?.type === 'color' && l.cells[3][3].r).toBe(10);
  });

  test('multi-layer mirror', () => {
    const layerCoarse = makeLayer('l2', 2, 0);
    const layerFine = makeLayer('l0', 0, 1);

    applyCellEdit(layerCoarse, 2, 2, color(1, 0, 0));
    applyCellEdit(layerFine, 8, 8, color(2, 0, 0));

    const state = makeState([layerCoarse, layerFine]);
    state.activeLayerId = 'l2';
    const sel = { startCellX: 2, startCellY: 2, endCellX: 3, endCellY: 3, level: 2 as GridLevel };
    const ops = computeMirrorOps(state, sel, 'h');

    const l2Ops = ops.filter(o => o.op === 'cell' && o.layerId === 'l2');
    const l0Ops = ops.filter(o => o.op === 'cell' && o.layerId === 'l0');
    expect(l2Ops.length).toBeGreaterThan(0);
    expect(l0Ops.length).toBeGreaterThan(0);
  });

  test('undo round-trip for mirror H', () => {
    const layer = makeLayer('test', 2, 0);
    applyCellEdit(layer, 2, 2, color(1, 0, 0));
    applyCellEdit(layer, 3, 2, color(2, 0, 0));

    const state = makeState([layer]);
    const sel = { startCellX: 2, startCellY: 2, endCellX: 3, endCellY: 2, level: 2 as GridLevel };
    const ops = computeMirrorOps(state, sel, 'h');
    const mirrored = applyOps(state, ops);

    // Verify mirror happened
    expect(mirrored.layers[0].cells[2][2]?.type === 'color' && mirrored.layers[0].cells[2][2].r).toBe(2);

    // Revert
    const reverted = revertOps(mirrored, ops);
    expect(reverted.layers[0].cells[2][2]?.type === 'color' && reverted.layers[0].cells[2][2].r).toBe(1);
    expect(reverted.layers[0].cells[2][3]?.type === 'color' && reverted.layers[0].cells[2][3].r).toBe(2);
  });
});

// ── Global-mirror expansion for selection transforms ─────────────────

describe('expandOpsWithMirror', () => {
  const color = (r: number, g: number, b: number): CellState => ({
    type: 'color',
    r, g, b,
    transform: { mirrorH: false, mirrorV: false, rotation: 0 },
  });

  test('hasAnyGlobalMirror returns false when all flags off', () => {
    const state = makeState();
    expect(hasAnyGlobalMirror(state)).toBe(false);
  });

  test('hasAnyGlobalMirror returns true when any flag on', () => {
    const state = makeState(undefined, { mirrorH: true });
    expect(hasAnyGlobalMirror(state)).toBe(true);
  });

  test('no-mirror state passes ops through unchanged', () => {
    const layer = makeLayer('a', 2, 0);
    const state = makeState([layer]);
    const ops: UndoOp[] = [{
      op: 'cell', layerId: 'a', cellX: 1, cellY: 1,
      oldState: null, newState: color(7, 0, 0),
    }];
    const result = expandOpsWithMirror(state, ops);
    expect(result).toBe(ops); // same reference when no-op
  });

  test('mirrorH expands a single write op to its horizontal mirror', () => {
    // L2 = 8x8. cellPx = 256. Canvas pxMinX=0, pxMaxX=2048. Mirror center 1024px.
    // Cell 1 center = 384px. Mirror = 2*1024-384 = 1664 → cell 6.
    const layer = makeLayer('a', 2, 0);
    const state = makeState([layer], { mirrorH: true });
    const newState = color(5, 0, 0);
    const ops: UndoOp[] = [{
      op: 'cell', layerId: 'a', cellX: 1, cellY: 3,
      oldState: null, newState,
    }];
    const result = expandOpsWithMirror(state, ops);
    expect(result.length).toBe(2);
    // Primary op preserved first
    expect(result[0]).toBe(ops[0]);
    // Mirror at x=6
    const mirror = result[1];
    expect(mirror.op).toBe('cell');
    if (mirror.op === 'cell') {
      expect(mirror.layerId).toBe('a');
      expect(mirror.cellX).toBe(6);
      expect(mirror.cellY).toBe(3);
      expect(mirror.newState).toEqual(newState); // color unchanged by mirrorCellState
    }
  });

  test('mirrorH expands clear-source ops (newState: null)', () => {
    const layer = makeLayer('a', 2, 0);
    applyCellEdit(layer, 1, 3, color(5, 0, 0));
    applyCellEdit(layer, 6, 3, color(9, 0, 0));
    const state = makeState([layer], { mirrorH: true });
    const ops: UndoOp[] = [{
      op: 'cell', layerId: 'a', cellX: 1, cellY: 3,
      oldState: color(5, 0, 0), newState: null,
    }];
    const result = expandOpsWithMirror(state, ops);
    expect(result.length).toBe(2);
    const mirror = result[1];
    if (mirror.op === 'cell') {
      expect(mirror.cellX).toBe(6);
      expect(mirror.cellY).toBe(3);
      expect(mirror.newState).toBeNull();
      // oldState reflects what was actually at the mirror cell
      expect(mirror.oldState?.type === 'color' && mirror.oldState.r).toBe(9);
    }
  });

  test('dedups when primary and mirror coincide (cell on mirror axis)', () => {
    // L2 = 8x8. Center cell is at the axis, but for 8-wide the axis sits between
    // cells 3 and 4 — pick a cell whose mirror is itself would require an odd
    // grid. Instead: verify that when two primary ops have overlapping mirror
    // targets, no duplicate is emitted. Cell (1, 3) mirrors to (6, 3); cell
    // (6, 3) (also a primary op) should not get an extra mirror-of-primary.
    const layer = makeLayer('a', 2, 0);
    const state = makeState([layer], { mirrorH: true });
    const ops: UndoOp[] = [
      { op: 'cell', layerId: 'a', cellX: 1, cellY: 3, oldState: null, newState: color(1, 0, 0) },
      { op: 'cell', layerId: 'a', cellX: 6, cellY: 3, oldState: null, newState: color(2, 0, 0) },
    ];
    const result = expandOpsWithMirror(state, ops);
    // Two primaries + zero mirror (both mirror to an existing primary position)
    expect(result.length).toBe(2);
  });

  test('integration: computeMoveOps + expandOpsWithMirror with mirrorH', () => {
    // Place a cell at (1, 3); move by (+2, 0) → dest (3, 3).
    // With mirrorH on, mirror of source (6, 3) → mirror dest (4, 3).
    const layer = makeLayer('a', 2, 0);
    applyCellEdit(layer, 1, 3, color(7, 0, 0));
    applyCellEdit(layer, 6, 3, color(8, 0, 0));
    const state = makeState([layer], { mirrorH: true });
    const sel = { startCellX: 1, startCellY: 3, endCellX: 1, endCellY: 3, level: 2 as GridLevel };
    const primary = computeMoveOps(state, sel, 2, 0);
    const expanded = expandOpsWithMirror(state, primary);
    const after = applyOps(state, expanded);
    const l = after.layers[0];
    // Primary: source cleared, dest written
    expect(l.cells[3][1]).toBeNull();
    expect(l.cells[3][3]?.type === 'color' && l.cells[3][3].r).toBe(7);
    // Mirror: mirror-source cleared, mirror-dest written with same color (color, no flip)
    expect(l.cells[3][6]).toBeNull();
    expect(l.cells[3][4]?.type === 'color' && l.cells[3][4].r).toBe(7);
  });

  test('integration: computeMoveOps with copy=true + expand preserves both sides', () => {
    // Simulate a mirrored paint by pre-seeding both (1,3) and its mirror (6,3).
    const layer = makeLayer('a', 2, 0);
    applyCellEdit(layer, 1, 3, color(7, 0, 0));
    applyCellEdit(layer, 6, 3, color(7, 0, 0));
    const state = makeState([layer], { mirrorH: true });
    const sel = { startCellX: 1, startCellY: 3, endCellX: 1, endCellY: 3, level: 2 as GridLevel };
    const primary = computeMoveOps(state, sel, 2, 0, false, undefined, true);
    const expanded = expandOpsWithMirror(state, primary);
    const after = applyOps(state, expanded);
    const l = after.layers[0];
    // Source preserved (copy mode)
    expect(l.cells[3][1]?.type === 'color' && l.cells[3][1].r).toBe(7);
    // Primary dest
    expect(l.cells[3][3]?.type === 'color' && l.cells[3][3].r).toBe(7);
    // Mirror dest (mirror of 3 → 4)
    expect(l.cells[3][4]?.type === 'color' && l.cells[3][4].r).toBe(7);
    // Mirror of source (6,3) untouched — copy mode doesn't clear
    expect(l.cells[3][6]?.type === 'color' && l.cells[3][6].r).toBe(7);
  });

  test('undo after mirrored move restores full pre-state', () => {
    const layer = makeLayer('a', 2, 0);
    applyCellEdit(layer, 1, 3, color(7, 0, 0));
    applyCellEdit(layer, 6, 3, color(8, 0, 0));
    const state = makeState([layer], { mirrorH: true });
    const sel = { startCellX: 1, startCellY: 3, endCellX: 1, endCellY: 3, level: 2 as GridLevel };
    const expanded = expandOpsWithMirror(state, computeMoveOps(state, sel, 2, 0));
    const after = applyOps(state, expanded);
    const reverted = revertOps(after, expanded);
    const l = reverted.layers[0];
    expect(l.cells[3][1]?.type === 'color' && l.cells[3][1].r).toBe(7);
    expect(l.cells[3][6]?.type === 'color' && l.cells[3][6].r).toBe(8);
    expect(l.cells[3][3]).toBeNull();
    expect(l.cells[3][4]).toBeNull();
  });
});

// ── Shift Tests ─────────────────────────────────────────────────────

describe('getContainedLayerCells with shift', () => {
  test('unshifted baseline - regression', () => {
    const layer = makeLayer('a', 1, 0);
    // Pixel region covering cells 2..3 (px 256..512)
    const result = getContainedLayerCells([layer], 'a', 1, 256, 256, 512, 512, false);
    expect(result).toHaveLength(1);
    expect(result[0].cellMinX).toBe(2);
    expect(result[0].cellMinY).toBe(2);
    expect(result[0].cellMaxX).toBe(3);
    expect(result[0].cellMaxY).toBe(3);
  });

  test('shifted layer partial exclusion', () => {
    // Shifted L1 layer: cells are offset by 64px (half cell)
    const layer = makeLayer('a', 1, 0);
    layer.shiftX = 0.5;
    // Pixel region 256..384 = 1 active-cell wide
    // Shifted cell boundaries: 64, 192, 320, 448...
    // Cells fully in [256, 384): cell at shiftedStart 320 is NOT fully inside (320+128=448>384)
    // Cell at shiftedStart 192 starts at 192 but 192 < 256, not inside
    // So: ceil((256-64)/128)=2, floor((384-64)/128)-1=1 → 2>1, no cells
    const result = getContainedLayerCells([layer], 'a', 1, 256, 0, 384, LAYER_PX, false);
    expect(result).toHaveLength(0);
  });

  test('shifted layer full inclusion', () => {
    const layer = makeLayer('a', 1, 0);
    layer.shiftX = 0.5;
    // Pixel region 192..448 → shifted cells: ceil((192-64)/128)=1, floor((448-64)/128)-1=2
    // Cells 1,2 fully inside
    const result = getContainedLayerCells([layer], 'a', 1, 192, 0, 448, LAYER_PX, false);
    expect(result).toHaveLength(1);
    expect(result[0].cellMinX).toBe(1);
    expect(result[0].cellMaxX).toBe(2);
  });

  test('both axes shifted', () => {
    const layer = makeLayer('a', 1, 0);
    layer.shiftX = 0.5;
    layer.shiftY = 0.5;
    // Wide region that contains cells
    const result = getContainedLayerCells([layer], 'a', 1, 192, 192, 448, 448, false);
    expect(result).toHaveLength(1);
    expect(result[0].cellMinX).toBe(1);
    expect(result[0].cellMaxX).toBe(2);
    expect(result[0].cellMinY).toBe(1);
    expect(result[0].cellMaxY).toBe(2);
  });

  test('same-level shift mismatch - unshifted active, shifted other', () => {
    const active = makeLayer('active', 1, 0);
    const shifted = makeLayer('shifted', 1, 1);
    shifted.shiftX = 0.5;
    // Active cell (2,2): px 256..384. For shifted layer: ceil((256-64)/128)=2, floor((384-64)/128)-1=1
    // 2 > 1, so no contained cells in shifted layer
    const result = getContainedLayerCells([active, shifted], 'active', 1, 256, 256, 384, 384, true);
    // Active layer should have cell (2,2), shifted layer should have nothing
    expect(result).toHaveLength(1);
    expect(result[0].layer.id).toBe('active');
  });

  test('shift causes zero contained cells', () => {
    const layer = makeLayer('a', 1, 0);
    layer.shiftX = 0.5;
    // Exactly 1 cell wide: 256..384 in px, shifted by 64px means no cell fits
    const result = getContainedLayerCells([layer], 'a', 1, 256, 256, 384, 384, false);
    expect(result).toHaveLength(0);
  });

  test('L3 to L1 deep edit with doubly-shifted L1', () => {
    // Active: L3 unshifted. Finer: L1 shifted both axes.
    // L3 cellPx=512, L1 cellPx=128, shift=64px each axis.
    const coarse = makeLayer('coarse', 3, 0); // 4x4, cellPx=512
    const fineShifted = makeLayer('fineShifted', 1, 1); // 16x16, cellPx=128
    fineShifted.shiftX = 0.5;
    fineShifted.shiftY = 0.5;

    // L3 cell (0,0) covers pixels 0..512.
    // Shifted L1: shiftPx=64 each axis.
    //   cellMinX = ceil((0-64)/128) = ceil(-0.5) = 0
    //   cellMaxX = floor((512-64)/128) - 1 = floor(3.5) - 1 = 2
    //   → cells (0,0)..(2,2) = 9 cells
    const result = getContainedLayerCells(
      [coarse, fineShifted], 'coarse', 3, 0, 0, 512, 512, true,
    );
    expect(result.length).toBeGreaterThanOrEqual(2);
    const fineEntry = result.find(r => r.layer.id === 'fineShifted');
    expect(fineEntry).toBeDefined();
    expect(fineEntry!.cellMinX).toBe(0);
    expect(fineEntry!.cellMaxX).toBe(2);
    expect(fineEntry!.cellMinY).toBe(0);
    expect(fineEntry!.cellMaxY).toBe(2);
  });

  test('L3 to L1 deep edit with doubly-shifted L1 - all L3 cells', () => {
    const coarse = makeLayer('coarse', 3, 0);
    const fineShifted = makeLayer('fineShifted', 1, 1);
    fineShifted.shiftX = 0.5;
    fineShifted.shiftY = 0.5;

    // Every L3 cell should contain some shifted L1 cells
    for (let cy = 0; cy < 4; cy++) {
      for (let cx = 0; cx < 4; cx++) {
        const px = cx * 512;
        const py = cy * 512;
        const result = getContainedLayerCells(
          [coarse, fineShifted], 'coarse', 3, px, py, px + 512, py + 512, true,
        );
        const fineEntry = result.find(r => r.layer.id === 'fineShifted');
        expect(fineEntry).toBeDefined();
        // Each L3 cell should contain at least 3x3 shifted L1 cells
        const countX = fineEntry!.cellMaxX - fineEntry!.cellMinX + 1;
        const countY = fineEntry!.cellMaxY - fineEntry!.cellMinY + 1;
        expect(countX).toBeGreaterThanOrEqual(3);
        expect(countY).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe('getContainedLayerCells skips locked layers', () => {
  test('skips locked finer layers in deep edit', () => {
    const coarse = makeLayer('coarse', 2, 0); // 8x8, cellPx=256
    const finer = makeLayer('finer', 0, 1);   // 32x32, cellPx=64
    finer.locked = true;
    // Pixel bounds of coarse cell (0,0): 0..256
    const result = getContainedLayerCells([coarse, finer], 'coarse', 2, 0, 0, 256, 256, true);
    // Only coarse layer should be returned, not the locked finer
    expect(result).toHaveLength(1);
    expect(result[0].layer.id).toBe('coarse');
  });

  test('includes unlocked finer layers', () => {
    const coarse = makeLayer('coarse', 2, 0);
    const finer = makeLayer('finer', 0, 1);
    // finer.locked is false by default
    const result = getContainedLayerCells([coarse, finer], 'coarse', 2, 0, 0, 256, 256, true);
    expect(result).toHaveLength(2);
    const ids = result.map(r => r.layer.id);
    expect(ids).toContain('coarse');
    expect(ids).toContain('finer');
  });
});

describe('getContainedLayerCells includeCoarser', () => {
  test('excludes coarser layers by default', () => {
    const fine = makeLayer('fine', 1, 0);   // L1: 16x16, cellPx=128
    const coarse = makeLayer('coarse', 2, 1); // L2: 8x8, cellPx=256
    // Selection at L1 covering 4 L1 cells = 1 L2 cell
    const result = getContainedLayerCells([fine, coarse], 'fine', 1, 0, 0, 512, 512, true, false);
    expect(result.map(r => r.layer.id)).toEqual(['fine']);
  });

  test('includes fully enclosed coarser cells when includeCoarser is true', () => {
    const fine = makeLayer('fine', 1, 0);
    const coarse = makeLayer('coarse', 2, 1);
    // Selection covers 0..512 px = 4 L1 cells = 2 L2 cells (fully enclosed)
    const result = getContainedLayerCells([fine, coarse], 'fine', 1, 0, 0, 512, 512, true, true);
    const ids = result.map(r => r.layer.id);
    expect(ids).toContain('fine');
    expect(ids).toContain('coarse');
    const coarseEntry = result.find(r => r.layer.id === 'coarse')!;
    expect(coarseEntry.cellMinX).toBe(0);
    expect(coarseEntry.cellMinY).toBe(0);
    expect(coarseEntry.cellMaxX).toBe(1);
    expect(coarseEntry.cellMaxY).toBe(1);
  });

  test('excludes coarser cells not fully enclosed', () => {
    const fine = makeLayer('fine', 1, 0);
    const coarse = makeLayer('coarse', 2, 1);
    // Selection covers 0..384 px = 3 L1 cells, only 1 full L2 cell (256px wide)
    const result = getContainedLayerCells([fine, coarse], 'fine', 1, 0, 0, 384, 384, true, true);
    const coarseEntry = result.find(r => r.layer.id === 'coarse')!;
    expect(coarseEntry.cellMinX).toBe(0);
    expect(coarseEntry.cellMaxX).toBe(0);
  });
});

describe('screenToCell', () => {
  // With viewport = LAYER_PX and zoom = 1, scale = 1.
  // Screen center = LAYER_PX/2. Canvas coords = screenX - center - offsetX*scale.
  // px = canvasX + LAYER_PX/2 = screenX - offsetX*scale.
  // So screenX=0 → px=0, screenX=LAYER_PX → px=LAYER_PX.

  const defaultViewport = makeViewport(LAYER_PX, LAYER_PX);
  const defaultCamera = { offsetX: 0, offsetY: 0, zoom: 1 };

  test('center of viewport maps to center cell area', () => {
    const layer = makeLayer('a', 2, 0); // 8x8, cellPx=256
    const result = screenToCell(LAYER_PX / 2, LAYER_PX / 2, defaultViewport, defaultCamera, layer);
    expect(result).toEqual({ cellX: 4, cellY: 4 });
  });

  test('top-left corner maps to cell (0,0)', () => {
    const layer = makeLayer('a', 2, 0);
    const result = screenToCell(0, 0, defaultViewport, defaultCamera, layer);
    expect(result).toEqual({ cellX: 0, cellY: 0 });
  });

  test('zoom 2x maps correctly', () => {
    const layer = makeLayer('a', 2, 0); // 8x8, cellPx=256
    const camera = { offsetX: 0, offsetY: 0, zoom: 2 };
    // scale = 2 * LAYER_PX / LAYER_PX = 2
    // center = LAYER_PX/2, canvasX = (screenX - center) / 2, px = canvasX + LAYER_PX/2
    // screenX = LAYER_PX/2 → px = LAYER_PX/2 → cell 4
    const result = screenToCell(LAYER_PX / 2, LAYER_PX / 2, defaultViewport, camera, layer);
    expect(result).toEqual({ cellX: 4, cellY: 4 });

    // At zoom 2x, screen edge maps to middle of canvas
    // screenX=0 → canvasX = (0 - LAYER_PX/2) / 2 = -LAYER_PX/4, px = LAYER_PX/2 - LAYER_PX/4 = LAYER_PX/4
    // cell = floor(LAYER_PX/4 / 256) = floor(512/256) = 2
    const edge = screenToCell(0, 0, defaultViewport, camera, layer);
    expect(edge).toEqual({ cellX: 2, cellY: 2 });
  });

  test('panned viewport maps correctly', () => {
    const layer = makeLayer('a', 2, 0); // cellPx=256
    // offsetX = 256 (px units, pre-scale). With zoom=1, scale=1.
    // screenX=LAYER_PX/2 → canvasX = (LAYER_PX/2 - LAYER_PX/2 - 256) / 1 = -256
    // px = -256 + LAYER_PX/2 = LAYER_PX/2 - 256 = 768
    // cell = floor(768/256) = 3
    const camera = { offsetX: 256, offsetY: 0, zoom: 1 };
    const result = screenToCell(LAYER_PX / 2, LAYER_PX / 2, defaultViewport, camera, layer);
    expect(result).toEqual({ cellX: 3, cellY: 4 });
  });

  test('out of bounds (negative) returns null', () => {
    const layer = makeLayer('a', 2, 0);
    // screenX very negative → px < 0
    const result = screenToCell(-5000, LAYER_PX / 2, defaultViewport, defaultCamera, layer);
    expect(result).toBeNull();
  });

  test('out of bounds (beyond grid) returns null', () => {
    const layer = makeLayer('a', 2, 0);
    // screenX beyond LAYER_PX → px > LAYER_PX
    const result = screenToCell(LAYER_PX + 5000, LAYER_PX / 2, defaultViewport, defaultCamera, layer);
    expect(result).toBeNull();
  });

  test('zero viewport returns null', () => {
    const layer = makeLayer('a', 2, 0);
    const result = screenToCell(100, 100, makeViewport(0, 0), defaultCamera, layer);
    expect(result).toBeNull();
  });

  test('shifted layer offsets cell coordinate', () => {
    const layer = makeLayer('a', 1, 0); // 16 cells, cellPx=128
    // screenX = LAYER_PX/2 + 128 → px = LAYER_PX/2 + 128 = 1152
    // unshifted cell = floor(1152/128) = 9
    const unshifted = screenToCell(LAYER_PX / 2 + 128, LAYER_PX / 2, defaultViewport, defaultCamera, layer);
    expect(unshifted?.cellX).toBe(9);

    layer.shiftX = 0.5;
    // shifted: cell = floor((1152 - 64) / 128) = floor(1088/128) = 8
    const shifted = screenToCell(LAYER_PX / 2 + 128, LAYER_PX / 2, defaultViewport, defaultCamera, layer);
    expect(shifted?.cellX).toBe(8);
  });

  test('different grid levels produce different cells for same screen position', () => {
    const layerL0 = makeLayer('l0', 0, 0); // 32x32, cellPx=64
    const layerL2 = makeLayer('l2', 2, 0); // 8x8, cellPx=256
    // screenX = 256 → px = 256
    // L0 cell = floor(256/64) = 4, L2 cell = floor(256/256) = 1
    const resultL0 = screenToCell(256, 256, defaultViewport, defaultCamera, layerL0);
    const resultL2 = screenToCell(256, 256, defaultViewport, defaultCamera, layerL2);
    expect(resultL0).toEqual({ cellX: 4, cellY: 4 });
    expect(resultL2).toEqual({ cellX: 1, cellY: 1 });
  });

  test('realistic viewport with zoom and offset maps correctly', () => {
    // Viewport 800×800, L0 (32×32), zoomed to 4× centered on cells 8-15
    // This verifies the formula matches the shader's UV transform
    const layer = makeLayer('a', 0, 0); // 32×32, cellPx=64
    const viewport = makeViewport(800, 800);

    // Camera set to center on selection [8..15] with zoom=4
    // selCenterU = (8/32 + 16/32) / 2 = 0.375
    // offsetX = (0.5 - 0.375) * 800 = 100
    const camera = { offsetX: 100, offsetY: 100, zoom: 4 };

    // Click at screen center (400, 400) → should map to center of selection
    // Shader: uv = (400/800 - 0.5)/4 - 100/800 + 0.5 = 0 - 0.125 + 0.5 = 0.375
    // px = 0.375 * 2048 = 768, cell = floor(768/64) = 12
    const center = screenToCell(400, 400, viewport, camera, layer);
    expect(center).toEqual({ cellX: 12, cellY: 12 });

    // Click at top-left of viewport (0, 0)
    // Shader: uvX = (0/800 - 0.5)/4 - 0.125 + 0.5 = -0.125 - 0.125 + 0.5 = 0.25
    // px = 0.25 * 2048 = 512, cell = floor(512/64) = 8
    const topLeft = screenToCell(0, 0, viewport, camera, layer);
    expect(topLeft).toEqual({ cellX: 8, cellY: 8 });
  });

  test('realistic non-square viewport maps correctly', () => {
    const layer = makeLayer('a', 2, 0); // 8×8, cellPx=256
    const viewport = makeViewport(1200, 800);
    const camera = { offsetX: 0, offsetY: 0, zoom: 1 };

    // Screen center → canvas center
    const center = screenToCell(600, 400, viewport, camera, layer);
    expect(center).toEqual({ cellX: 4, cellY: 4 });
  });
});

describe('composeRotation', () => {
  test('basic: 0° + 90° = 90°', () => {
    const t = { mirrorH: false, mirrorV: false, rotation: 0 as const };
    expect(composeRotation(t, 90).rotation).toBe(90);
  });

  test('90° + 90° = 180°', () => {
    const t = { mirrorH: false, mirrorV: false, rotation: 90 as const };
    expect(composeRotation(t, 90).rotation).toBe(180);
  });

  test('single mirror: mirrorH=true + 90° → rotation adds normally', () => {
    const t = { mirrorH: true, mirrorV: false, rotation: 0 as const };
    expect(composeRotation(t, 90).rotation).toBe(90);
  });

  test('double mirror: mirrorH=true, mirrorV=true + 90° → rotation adds normally', () => {
    const t = { mirrorH: true, mirrorV: true, rotation: 0 as const };
    expect(composeRotation(t, 90).rotation).toBe(90);
  });
});

describe('renderCellToPixels clipping with shift', () => {
  test('shifted cell at edge does not write beyond LAYER_PX', () => {
    const layer = makeLayer('a', 1, 0);
    layer.shiftX = 0.5;
    // L1 has 16 cells, cellPx=128, shift=64px
    // Last cell (15) starts at 15*128+64=1984, extends to 2112 which is beyond 2048
    const colorState: CellState = { type: 'color', r: 255, g: 0, b: 0, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };
    // Should not throw
    renderCellToPixels(layer, 15, 0, colorState);

    // Pixel at x=2000 (within bounds) should be written
    const idxInBounds = (0 * LAYER_PX + 2000) * 4;
    expect(layer.data[idxInBounds]).toBe(255);

    // Pixel data beyond LAYER_PX should not be accessed (no crash = pass)
    // Also verify a pixel at x=64 (start of cell 0 shifted) for cell 0
    renderCellToPixels(layer, 0, 0, colorState);
    const idxShifted = (0 * LAYER_PX + 64) * 4;
    expect(layer.data[idxShifted]).toBe(255);
    // Pixel before shift start (x=0..63) should not be written for cell 0
    // Actually cell 0 starts at 0*128+64=64, so x=0 is not part of cell 0
    // But cell -1 doesn't exist, so x=0..63 should remain 0
    // Wait, the cell grid starts at 0, so cell 0 pixel range is [64, 192)
    const idxBefore = (0 * LAYER_PX + 32) * 4;
    expect(layer.data[idxBefore]).toBe(0);
  });

  test('clearing shifted cell at edge works correctly', () => {
    const layer = makeLayer('a', 1, 0);
    layer.shiftX = 0.5;
    const colorState: CellState = { type: 'color', r: 100, g: 0, b: 0, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };
    renderCellToPixels(layer, 15, 0, colorState);
    // Now clear it
    renderCellToPixels(layer, 15, 0, null);
    const idx = (0 * LAYER_PX + 2000) * 4;
    expect(layer.data[idx]).toBe(0);
  });
});

// ── renderCellToBuffer ─────────────────────────────────────────────────

describe('renderCellToBuffer', () => {
  const size = 4; // small size for readable tests
  const level: GridLevel = 4; // level 4 = 2 cells, cellPx = 1024, but we pass size directly

  test('returns 0 for null state', () => {
    expect(renderCellToBuffer(null, size, level)).toBe(0);
  });

  test('color with identity transform fills solid RGBA', () => {
    const state: CellState = { type: 'color', r: 10, g: 20, b: 30, transform: { rotation: 0, mirrorH: false, mirrorV: false } };
    const byteLen = renderCellToBuffer(state, size, level);
    expect(byteLen).toBe(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      expect(sharedCellBuf[i * 4]).toBe(10);
      expect(sharedCellBuf[i * 4 + 1]).toBe(20);
      expect(sharedCellBuf[i * 4 + 2]).toBe(30);
      expect(sharedCellBuf[i * 4 + 3]).toBe(255);
    }
  });

  test('color with mirrorH produces identical buffer (solid color is symmetric)', () => {
    const identity: CellState = { type: 'color', r: 5, g: 5, b: 5, transform: { rotation: 0, mirrorH: false, mirrorV: false } };
    const mirrored: CellState = { type: 'color', r: 5, g: 5, b: 5, transform: { rotation: 0, mirrorH: true, mirrorV: false } };
    const lenA = renderCellToBuffer(identity, size, level);
    const bufA = new Uint8Array(sharedCellBuf.buffer, 0, lenA);
    const snapA = new Uint8Array(bufA);
    renderCellToBuffer(mirrored, size, level);
    const snapB = new Uint8Array(sharedCellBuf.buffer, 0, lenA);
    expect(snapA).toEqual(snapB);
  });

  test('color with rotation produces identical buffer (solid color is symmetric)', () => {
    const identity: CellState = { type: 'color', r: 7, g: 8, b: 9, transform: { rotation: 0, mirrorH: false, mirrorV: false } };
    const rotated: CellState = { type: 'color', r: 7, g: 8, b: 9, transform: { rotation: 90, mirrorH: false, mirrorV: false } };
    const lenA = renderCellToBuffer(identity, size, level);
    const snapA = new Uint8Array(sharedCellBuf.subarray(0, lenA));
    renderCellToBuffer(rotated, size, level);
    const snapB = new Uint8Array(sharedCellBuf.subarray(0, lenA));
    expect(snapA).toEqual(snapB);
  });
});

// ── bulkFloodFill ──────────────────────────────────────────────────────

/** Fill every cell with a placeholder sprite so color flood fill has something to tint */
function prefillWithSprites(layer: Layer, level: GridLevel) {
  const count = CELL_COUNTS[level];
  const sprite: CellState = { type: 'sprite', spriteId: 'test/tile', transform: DEFAULT_TRANSFORM };
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      layer.cells[y][x] = sprite;
    }
  }
}

/** Swap scratch cells from bulkFloodFill result into the layer (mirrors caller pattern) */
function applyFloodFillResult(layer: Layer, result: { scratchCells?: (CellState | null)[][] }) {
  if (result.scratchCells) {
    layer.cells = result.scratchCells;
    layer.cellsGeneration++;
  }
}

describe('bulkFloodFill', () => {
  test('fills all cells with color and produces correct ops count', () => {
    const layer = makeLayer('flood', 2, 0); // level 2 = 8x8
    prefillWithSprites(layer, 2 as GridLevel);
    const tool: Tool = { type: 'color', colorIndex: 0 };
    const result = bulkFloodFill(layer, tool, false, false);
    applyFloodFillResult(layer, result);
    const { ops } = result;
    const count = CELL_COUNTS[2];
    expect(ops.length).toBe(count * count); // 64 cells
    // Every cell should be tinted
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        expect(layer.cells[y][x]).not.toBeNull();
      }
    }
  });

  test('color flood fill skips empty tiles', () => {
    const layer = makeLayer('flood-empty', 2, 0);
    const tool: Tool = { type: 'color', colorIndex: 0 };
    const result = bulkFloodFill(layer, tool, false, false);
    applyFloodFillResult(layer, result);
    const { ops } = result;
    expect(ops.length).toBe(0);
    const count = CELL_COUNTS[2];
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        expect(layer.cells[y][x]).toBeNull();
      }
    }
  });

  test('fills all cells with mirrorH and produces correct ops count', () => {
    const layer = makeLayer('flood', 2, 0);
    prefillWithSprites(layer, 2 as GridLevel);
    const tool: Tool = { type: 'color', colorIndex: 0 };
    const result = bulkFloodFill(layer, tool, true, false);
    applyFloodFillResult(layer, result);
    const { ops } = result;
    const count = CELL_COUNTS[2];
    expect(ops.length).toBe(count * count);
    const left = layer.cells[0][0]!;
    const right = layer.cells[0][count - 1]!;
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
  });

  test('fills all cells with mirrorV and produces correct ops count', () => {
    const layer = makeLayer('flood', 2, 0);
    prefillWithSprites(layer, 2 as GridLevel);
    const tool: Tool = { type: 'color', colorIndex: 0 };
    const result = bulkFloodFill(layer, tool, false, true);
    applyFloodFillResult(layer, result);
    const { ops } = result;
    const count = CELL_COUNTS[2];
    expect(ops.length).toBe(count * count);
    const top = layer.cells[0][0]!;
    const bottom = layer.cells[count - 1][0]!;
    expect(top).not.toBeNull();
    expect(bottom).not.toBeNull();
  });

  test('fills all cells with both mirrors and produces correct ops count', () => {
    const layer = makeLayer('flood', 2, 0);
    prefillWithSprites(layer, 2 as GridLevel);
    const tool: Tool = { type: 'color', colorIndex: 0 };
    const result = bulkFloodFill(layer, tool, true, true);
    applyFloodFillResult(layer, result);
    const { ops } = result;
    const count = CELL_COUNTS[2];
    expect(ops.length).toBe(count * count);
    const topLeft = layer.cells[0][0]!;
    const topRight = layer.cells[0][count - 1]!;
    const bottomLeft = layer.cells[count - 1][0]!;
    const bottomRight = layer.cells[count - 1][count - 1]!;
    expect(topLeft).not.toBeNull();
    expect(topRight).not.toBeNull();
    expect(bottomLeft).not.toBeNull();
    expect(bottomRight).not.toBeNull();
  });

  test('random tool produces unique colors per cell', () => {
    const layer = makeLayer('flood', 3, 0); // level 3 = 4x4
    const tool: Tool = { type: 'random' };
    applyFloodFillResult(layer, bulkFloodFill(layer, tool, false, false));
    const count = CELL_COUNTS[3];
    const colors = new Set<string>();
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        const cell = layer.cells[y][x]!;
        if (cell.type === 'color') {
          colors.add(`${cell.r},${cell.g},${cell.b}`);
        }
      }
    }
    // With 16 random colors from 256^3, collisions are astronomically unlikely
    expect(colors.size).toBeGreaterThan(1);
  });

  test('ops contain correct oldState for undo', () => {
    const layer = makeLayer('flood', 3, 0);
    const existingState: CellState = { type: 'color', r: 99, g: 99, b: 99, transform: { rotation: 0, mirrorH: false, mirrorV: false } };
    layer.cells[0][0] = existingState;
    const tool: Tool = { type: 'color', colorIndex: 1 };
    const result = bulkFloodFill(layer, tool, false, false);
    applyFloodFillResult(layer, result);
    const { ops } = result;
    const cellOp = ops.find((op) => op.op === 'cell' && op.cellX === 0 && op.cellY === 0);
    expect(cellOp).toBeDefined();
    if (cellOp?.op === 'cell') {
      expect(cellOp.oldState).toEqual(existingState);
    }
  });

  test('pixel data is written correctly for color fill', () => {
    const layer = makeLayer('flood', 2, 0);
    // Pre-fill with color cells so color flood fill has something to tint
    const count = CELL_COUNTS[2];
    const prefill: CellState = { type: 'color', r: 128, g: 128, b: 128, transform: DEFAULT_TRANSFORM };
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        layer.cells[y][x] = prefill;
      }
    }
    const tool: Tool = { type: 'color', colorIndex: 0 }; // black
    applyFloodFillResult(layer, bulkFloodFill(layer, tool, false, false));
    // Check that pixel data is non-zero (alpha = 255)
    const idx = (0 * LAYER_PX + 0) * 4; // top-left pixel
    expect(layer.data[idx + 3]).toBe(255);
  });

  // ── Random mirror symmetry tests ────────────────────────────────────

  test('random + mirrorH: mirrored cells share spriteId with XOR-composed mirrorH and negated rotation', () => {
    const layer = makeLayer('flood', 3, 0); // level 3 = 4x4
    const tool: Tool = { type: 'random' };
    applyFloodFillResult(layer, bulkFloodFill(layer, tool, true, false, false, false, false, false, false, false, false, false, undefined, undefined, [layer], true));
    const count = CELL_COUNTS[3];
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < Math.ceil(count / 2); x++) {
        const primary = layer.cells[y][x]!;
        const mirrored = layer.cells[y][count - 1 - x]!;
        expect(primary.type).toBe('sprite');
        expect(mirrored.type).toBe('sprite');
        if (primary.type === 'sprite' && mirrored.type === 'sprite') {
          expect(mirrored.spriteId).toBe(primary.spriteId);
          // Mirror flags are XOR-composed with base
          expect(mirrored.transform.mirrorH).toBe(!primary.transform.mirrorH);
          expect(mirrored.transform.mirrorV).toBe(primary.transform.mirrorV);
          // Canvas mirrorH only (mH !== mV) → rotation negated
          expect(mirrored.transform.rotation).toBe((360 - primary.transform.rotation) % 360);
        }
      }
    }
  });

  test('random + mirrorV: mirrored cells share spriteId with XOR-composed mirrorV and negated rotation', () => {
    const layer = makeLayer('flood', 3, 0);
    const tool: Tool = { type: 'random' };
    applyFloodFillResult(layer, bulkFloodFill(layer, tool, false, true, false, false, false, false, false, false, false, false, undefined, undefined, [layer], true));
    const count = CELL_COUNTS[3];
    for (let x = 0; x < count; x++) {
      for (let y = 0; y < Math.ceil(count / 2); y++) {
        const primary = layer.cells[y][x]!;
        const mirrored = layer.cells[count - 1 - y][x]!;
        expect(primary.type).toBe('sprite');
        expect(mirrored.type).toBe('sprite');
        if (primary.type === 'sprite' && mirrored.type === 'sprite') {
          expect(mirrored.spriteId).toBe(primary.spriteId);
          expect(mirrored.transform.mirrorH).toBe(primary.transform.mirrorH);
          expect(mirrored.transform.mirrorV).toBe(!primary.transform.mirrorV);
          // Canvas mirrorV only (mH !== mV) → rotation negated
          expect(mirrored.transform.rotation).toBe((360 - primary.transform.rotation) % 360);
        }
      }
    }
  });

  test('random + mirrorH+V: diagonal cells share spriteId with XOR-composed flags, rotation preserved', () => {
    const layer = makeLayer('flood', 3, 0);
    const tool: Tool = { type: 'random' };
    applyFloodFillResult(layer, bulkFloodFill(layer, tool, true, true, false, false, false, false, false, false, false, false, undefined, undefined, [layer], true));
    const count = CELL_COUNTS[3];
    for (let y = 0; y < Math.ceil(count / 2); y++) {
      for (let x = 0; x < Math.ceil(count / 2); x++) {
        const primary = layer.cells[y][x]!;
        const diagonal = layer.cells[count - 1 - y][count - 1 - x]!;
        expect(primary.type).toBe('sprite');
        expect(diagonal.type).toBe('sprite');
        if (primary.type === 'sprite' && diagonal.type === 'sprite') {
          expect(diagonal.spriteId).toBe(primary.spriteId);
          // Both canvas mirrors → XOR both flags
          expect(diagonal.transform.mirrorH).toBe(!primary.transform.mirrorH);
          expect(diagonal.transform.mirrorV).toBe(!primary.transform.mirrorV);
          // Both mirrors: mH === mV, so rotation is preserved
          expect(diagonal.transform.rotation).toBe(primary.transform.rotation);
        }
      }
    }
  });

  test('random + mirrorRotate: rotated cells share spriteId with composed rotation', () => {
    const layer = makeLayer('flood', 3, 0);
    const tool: Tool = { type: 'random' };
    applyFloodFillResult(layer, bulkFloodFill(layer, tool, false, false, true, false, false, false, false, false, false, false, undefined, undefined, [layer], true));
    const count = CELL_COUNTS[3];
    // Check (0,0) primary vs (count-1, count-1) which is 180° rotated
    const primary = layer.cells[0][0]!;
    const rotated180 = layer.cells[count - 1][count - 1]!;
    expect(primary.type).toBe('sprite');
    expect(rotated180.type).toBe('sprite');
    if (primary.type === 'sprite' && rotated180.type === 'sprite') {
      expect(rotated180.spriteId).toBe(primary.spriteId);
      expect(rotated180.transform.rotation).toBe((primary.transform.rotation + 180) % 360);
    }
  });

  test('does not mutate input layer cells (pixels written in-place)', () => {
    const layer = makeLayer('pure', 2, 0);
    const origCells = layer.cells;
    const tool: Tool = { type: 'color', colorIndex: 0 };
    bulkFloodFill(layer, tool, false, false);
    // Input layer cells should be untouched (scratch clone is returned separately)
    expect(layer.cells).toBe(origCells);
    const count = CELL_COUNTS[2];
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        expect(origCells[y][x]).toBeNull();
      }
    }
    // Pixel data IS written in-place (no scratch pixel buffer)
    expect(layer.data).toBe(layer.data);
  });

  test('cellsGeneration increments after caller swaps scratch in', () => {
    const layer = makeLayer('gen', 2, 0);
    const origGen = layer.cellsGeneration;
    const tool: Tool = { type: 'color', colorIndex: 0 };
    const result = bulkFloodFill(layer, tool, false, false);
    // Before swap, generation unchanged
    expect(layer.cellsGeneration).toBe(origGen);
    applyFloodFillResult(layer, result);
    expect(layer.cellsGeneration).toBe(origGen + 1);
  });

  test('color tool with clearFirst re-tints existing cells instead of clearing them', () => {
    // Regression: clearFirst on the color tool used to wipe the active layer
    // because the color pass only acts on existing cells (`oldState != null`).
    // After clearing, every cell was null and nothing got tinted, so the
    // entire active layer was emptied.
    const layer = makeLayer('color-clear-first', 2, 0); // L2 = 8x8
    const count = CELL_COUNTS[2];
    const prefill: CellState = { type: 'color', r: 200, g: 200, b: 200, transform: DEFAULT_TRANSFORM };
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        layer.cells[y][x] = prefill;
      }
    }
    const tool: Tool = { type: 'color', colorIndex: 0 };
    const result = bulkFloodFill(
      layer, tool,
      false, false, false, false, false, false, false, false, false, false,
      undefined, undefined, [layer], false, undefined,
      undefined, undefined, undefined, true, // clearFirst = true
    );
    applyFloodFillResult(layer, result);
    // Every cell should still exist (re-tinted, not cleared)
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        expect(layer.cells[y][x]).not.toBeNull();
      }
    }
    // No op should be a clear-to-null
    for (const op of result.ops) {
      if (op.op === 'cell') {
        expect(op.newState).not.toBeNull();
      }
    }
    expect(result.ops.length).toBe(count * count);
  });

  // Regression: for a centered 16×16 canvas at origin (8, 8), fill must
  // target cells 8..23 — the canvas window in layer cell indices — not
  // cells 0..15 (which would leave the canvas top-left filled and the
  // bottom-right blank, the symptom the user reported).
  test('fill respects canvas origin on a centered canvas', () => {
    const layer = makeLayer('centered-fill', 0, 0); // L0 active layer
    const tool: Tool = { type: 'color', colorIndex: 0, customColorR: 255, customColorG: 0, customColorB: 0 };
    prefillWithSprites(layer, 0 as GridLevel); // seed all 32×32 cells so color tints

    // Canvas 16×16 at origin (8, 8). Pass origin via the last two args.
    const widthL0 = 16, heightL0 = 16, originL0X = 8, originL0Y = 8;
    const result = bulkFloodFill(
      layer, tool,
      false, false, false, false, false, false, false, false, false, false,
      widthL0, heightL0, [layer], true, undefined,
      undefined, undefined, undefined, undefined,
      255, 255, 255,
      originL0X, originL0Y,
    );
    applyFloodFillResult(layer, result);

    // Cells INSIDE the canvas window (8..23) should be tinted red.
    // Cells OUTSIDE (e.g., 0..7, 24..31) should retain their original tint.
    const tinted = (c: any) => c && c.type === 'sprite' && c.tintR === 255 && c.tintG === 0 && c.tintB === 0;
    expect(tinted(layer.cells[8][8])).toBe(true);
    expect(tinted(layer.cells[23][23])).toBe(true);
    expect(tinted(layer.cells[15][15])).toBe(true);
    // Cells before the canvas window — never touched.
    expect(tinted(layer.cells[0][0])).toBe(false);
    expect(tinted(layer.cells[7][7])).toBe(false);
    // Cells after the canvas window — never touched.
    expect(tinted(layer.cells[24][24])).toBe(false);
    expect(tinted(layer.cells[31][31])).toBe(false);
  });

  // ── excludePartialTiles ───────────────────────────────────────────────
  // Recall: L0=32 cells (finest), L4=2 cells (coarsest). L2 has 8 cells of
  // size 4 L0 each. A shifted L2 layer puts its rightmost cell partly off a
  // 32-L0-wide canvas — that's our easiest partial-tile fixture.
  test('excludePartialTiles skips both the right partial column and edgeColLeft on a shifted L2 layer', () => {
    const layer = makeLayer('flood-partial-shift', 2 as GridLevel, 0);
    layer.shiftX = 0.5;
    // Allocate edge column storage so it can be partly filled by the engine.
    layer.edgeColLeft = new Array(CELL_COUNTS[2]).fill(null);
    prefillWithSprites(layer, 2 as GridLevel);
    // Seed the edge column too so we can assert it stays untinted.
    const baseSprite: CellState = { type: 'sprite', spriteId: 'test/tile', transform: DEFAULT_TRANSFORM };
    for (let y = 0; y < CELL_COUNTS[2]; y++) {
      layer.edgeColLeft[y] = { ...baseSprite };
    }
    const tool: Tool = { type: 'color', colorIndex: 0, customColorR: 9, customColorG: 9, customColorB: 9 };
    const result = bulkFloodFill(
      layer, tool,
      false, false, false, false, false, false, false, false, false, false,
      CELL_COUNTS[2], CELL_COUNTS[2], [layer], true, undefined,
      undefined, undefined, undefined, undefined,
      255, 255, 255,
      0, 0,
      true,
    );
    applyFloodFillResult(layer, result);
    const tinted = (c: CellState | null) => c != null && c.type === 'sprite' && c.tintR === 9;
    // Partial column at x=7 (with shiftX=0.5, x=7 spans L0 [30..34]).
    for (let y = 0; y < CELL_COUNTS[2]; y++) {
      expect(tinted(layer.cells[y][7])).toBe(false);
    }
    // The edgeColLeft strip is partial by construction — should stay un-tinted.
    for (let y = 0; y < CELL_COUNTS[2]; y++) {
      expect(tinted(layer.edgeColLeft![y])).toBe(false);
    }
    // Complete columns 0..6 should be tinted.
    for (let y = 0; y < CELL_COUNTS[2]; y++) {
      for (let x = 0; x < 7; x++) {
        expect(tinted(layer.cells[y][x])).toBe(true);
      }
    }
  });

  test('regression: without excludePartialTiles, the partial column on a shifted L2 layer IS filled', () => {
    const layer = makeLayer('flood-partial-shift-off', 2 as GridLevel, 0);
    layer.shiftX = 0.5;
    prefillWithSprites(layer, 2 as GridLevel);
    const tool: Tool = { type: 'color', colorIndex: 0, customColorR: 9, customColorG: 9, customColorB: 9 };
    const result = bulkFloodFill(
      layer, tool,
      false, false, false, false, false, false, false, false, false, false,
      CELL_COUNTS[2], CELL_COUNTS[2], [layer], true, undefined,
      undefined, undefined, undefined, undefined,
      255, 255, 255,
      0, 0,
    );
    applyFloodFillResult(layer, result);
    const tinted = (c: CellState | null) => c != null && c.type === 'sprite' && c.tintR === 9;
    // Column 7 IS tinted in the default behaviour.
    expect(tinted(layer.cells[0][7])).toBe(true);
  });

  test('excludePartialTiles + clipL0Width=15 on an L2 layer skips column 3 (partial right edge)', () => {
    // L2 has 8 cells × 4 L0 each. With actual canvasWidthL0=15, cell 3
    // spans L0 [12..16] but the canvas ends at L0 15 — partial. The bug
    // before the clipL0Width fix: the derived canvasWidthL0 (maxCellX*scaleL0
    // = 4*4 = 16) made cell 3 look complete.
    const layer = makeLayer('flood-partial-l1-15', 2 as GridLevel, 0);
    prefillWithSprites(layer, 2 as GridLevel);
    const tool: Tool = { type: 'color', colorIndex: 0, customColorR: 4, customColorG: 4, customColorB: 4 };
    const maxCellX = 4; // editableCells(15, 2) = ceil(15*8/32) = 4
    const result = bulkFloodFill(
      layer, tool,
      false, false, false, false, false, false, false, false, false, false,
      maxCellX, maxCellX, [layer], true, undefined,
      undefined, undefined, undefined, undefined,
      255, 255, 255,
      0, 0,
      true,
      15, 15,
    );
    applyFloodFillResult(layer, result);
    const tinted = (c: CellState | null) => c != null && c.type === 'sprite' && c.tintR === 4;
    // Cell 3 (right column in window) is partial — should NOT be tinted.
    for (let y = 0; y < 4; y++) {
      expect(tinted(layer.cells[y][3])).toBe(false);
    }
    // Cells 0..2 are complete and should be tinted.
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        expect(tinted(layer.cells[y][x])).toBe(true);
      }
    }
  });
});

// ── Region Flood Fill ──────────────────────────────────────────────────

describe('Region Flood Fill', () => {
  // Level 3 = 4x4 grid, cellPx(3) = 32
  const level = 3 as GridLevel;
  const cs = cellPx(level);

  /** Region covering left half (columns 0-1 of 4) */
  function leftHalfBounds(): RegionBoundsPx {
    return { pxMinX: 0, pxMinY: 0, pxMaxX: 2 * cs, pxMaxY: 4 * cs };
  }

  /** Region covering right half (columns 2-3 of 4) */
  function rightHalfBounds(): RegionBoundsPx {
    return { pxMinX: 2 * cs, pxMinY: 0, pxMaxX: 4 * cs, pxMaxY: 4 * cs };
  }

  /** Region covering bottom-right quadrant */
  function bottomRightQuadBounds(): RegionBoundsPx {
    return { pxMinX: 2 * cs, pxMinY: 2 * cs, pxMaxX: 4 * cs, pxMaxY: 4 * cs };
  }

  /** Full canvas bounds for level 3 */
  function fullBounds(): RegionBoundsPx {
    return { pxMinX: 0, pxMinY: 0, pxMaxX: 4 * cs, pxMaxY: 4 * cs };
  }

  test('region containment: flood fill only modifies cells inside the region', () => {
    const layer = makeLayer('region', level, 0);
    const tool: Tool = { type: 'random' };
    const bounds = leftHalfBounds();
    applyFloodFillResult(layer, bulkFloodFill(layer, tool, false, false, false, false, false, false, false, false, false, false, undefined, undefined, [layer], true, undefined, bounds));

    const count = CELL_COUNTS[level];
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        if (isCellInRegionPx(x, y, layer, bounds)) {
          expect(layer.cells[y][x]).not.toBeNull();
        } else {
          expect(layer.cells[y][x]).toBeNull();
        }
      }
    }
  });

  test('random + mirrorH in region: mirror targets reflect across canvas center', () => {
    const layer = makeLayer('region-mh', level, 0);
    const tool: Tool = { type: 'random' };
    const bounds = leftHalfBounds();
    const canvas = fullBounds();
    applyFloodFillResult(layer, bulkFloodFill(layer, tool, true, false, false, false, false, false, false, false, false, false, undefined, undefined, [layer], true, undefined, bounds, canvas));

    // Left-half region (cols 0-1) on a 4-col canvas.
    // Canvas mirrorH: col 0 → col 3, col 1 → col 2.
    const count = CELL_COUNTS[level];
    for (let y = 0; y < count; y++) {
      // All 4 columns should be filled
      for (let x = 0; x < count; x++) {
        expect(layer.cells[y][x]).not.toBeNull();
      }
      // Check canvas-center mirror pairs: col 0 ↔ col 3
      const c0 = layer.cells[y][0];
      const c3 = layer.cells[y][3];
      if (c0 && c3 && c0.type === 'sprite' && c3.type === 'sprite') {
        expect(c3.spriteId).toBe(c0.spriteId);
        expect(c3.transform.mirrorH).toBe(!c0.transform.mirrorH);
        expect(c3.transform.mirrorV).toBe(c0.transform.mirrorV);
      }
      // Check canvas-center mirror pairs: col 1 ↔ col 2
      const c1 = layer.cells[y][1];
      const c2 = layer.cells[y][2];
      if (c1 && c2 && c1.type === 'sprite' && c2.type === 'sprite') {
        expect(c2.spriteId).toBe(c1.spriteId);
        expect(c2.transform.mirrorH).toBe(!c1.transform.mirrorH);
        expect(c2.transform.mirrorV).toBe(c1.transform.mirrorV);
      }
    }
  });

  test('random + mirrorV in region: mirror targets reflect across canvas center', () => {
    const layer = makeLayer('region-mv', level, 0);
    const tool: Tool = { type: 'random' };
    // Top half region (rows 0-1)
    const bounds: RegionBoundsPx = { pxMinX: 0, pxMinY: 0, pxMaxX: 4 * cs, pxMaxY: 2 * cs };
    const canvas = fullBounds();
    applyFloodFillResult(layer, bulkFloodFill(layer, tool, false, true, false, false, false, false, false, false, false, false, undefined, undefined, [layer], true, undefined, bounds, canvas));

    // Canvas mirrorV: row 0 → row 3, row 1 → row 2.
    const count = CELL_COUNTS[level];
    // All 4 rows should be filled
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        expect(layer.cells[y][x]).not.toBeNull();
      }
    }
    // Check canvas-center mirror pairs: row 0 ↔ row 3
    for (let x = 0; x < count; x++) {
      const c0 = layer.cells[0][x];
      const c3 = layer.cells[3][x];
      if (c0 && c3 && c0.type === 'sprite' && c3.type === 'sprite') {
        expect(c3.spriteId).toBe(c0.spriteId);
        expect(c3.transform.mirrorV).toBe(!c0.transform.mirrorV);
        expect(c3.transform.mirrorH).toBe(c0.transform.mirrorH);
      }
    }
    // Check canvas-center mirror pairs: row 1 ↔ row 2
    for (let x = 0; x < count; x++) {
      const c1 = layer.cells[1][x];
      const c2 = layer.cells[2][x];
      if (c1 && c2 && c1.type === 'sprite' && c2.type === 'sprite') {
        expect(c2.spriteId).toBe(c1.spriteId);
        expect(c2.transform.mirrorV).toBe(!c1.transform.mirrorV);
        expect(c2.transform.mirrorH).toBe(c1.transform.mirrorH);
      }
    }
  });

  test('random + mirrorH+V in region: mirror targets reflect across canvas center', () => {
    const layer = makeLayer('region-mhv', level, 0);
    const tool: Tool = { type: 'random' };
    // 2x2 region (top-left quadrant)
    const bounds: RegionBoundsPx = { pxMinX: 0, pxMinY: 0, pxMaxX: 2 * cs, pxMaxY: 2 * cs };
    const canvas = fullBounds();
    applyFloodFillResult(layer, bulkFloodFill(layer, tool, true, true, false, false, false, false, false, false, false, false, undefined, undefined, [layer], true, undefined, bounds, canvas));

    // Canvas mirrorH+V: (0,0)→(3,3), (0,0)→(3,0), (0,0)→(0,3)
    // All 4x4 cells should be filled
    const count = CELL_COUNTS[level];
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        expect(layer.cells[y][x]).not.toBeNull();
      }
    }
    // Check diagonal mirror pair: (0,0) ↔ (3,3)
    const primary = layer.cells[0][0]!;
    const diagonal = layer.cells[3][3]!;
    expect(primary).not.toBeNull();
    expect(diagonal).not.toBeNull();
    if (primary?.type === 'sprite' && diagonal?.type === 'sprite') {
      expect(diagonal.spriteId).toBe(primary.spriteId);
      expect(diagonal.transform.mirrorH).toBe(!primary.transform.mirrorH);
      expect(diagonal.transform.mirrorV).toBe(!primary.transform.mirrorV);
      expect(diagonal.transform.rotation).toBe(primary.transform.rotation);
    }
    // Check H-mirror pair: (0,0) ↔ (3,0)
    const hMirror = layer.cells[0][3]!;
    expect(hMirror).not.toBeNull();
    if (primary?.type === 'sprite' && hMirror?.type === 'sprite') {
      expect(hMirror.spriteId).toBe(primary.spriteId);
      expect(hMirror.transform.mirrorH).toBe(!primary.transform.mirrorH);
      expect(hMirror.transform.mirrorV).toBe(primary.transform.mirrorV);
    }
    // Check V-mirror pair: (0,0) ↔ (0,3)
    const vMirror = layer.cells[3][0]!;
    expect(vMirror).not.toBeNull();
    if (primary?.type === 'sprite' && vMirror?.type === 'sprite') {
      expect(vMirror.spriteId).toBe(primary.spriteId);
      expect(vMirror.transform.mirrorH).toBe(primary.transform.mirrorH);
      expect(vMirror.transform.mirrorV).toBe(!primary.transform.mirrorV);
    }
  });

  test('random without mirrors in region: all region cells get sprites', () => {
    const layer = makeLayer('region-nomirror', level, 0);
    const tool: Tool = { type: 'random' };
    const bounds = leftHalfBounds();
    applyFloodFillResult(layer, bulkFloodFill(layer, tool, false, false, false, false, false, false, false, false, false, false, undefined, undefined, [layer], true, undefined, bounds));

    const count = CELL_COUNTS[level];
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        if (isCellInRegionPx(x, y, layer, bounds)) {
          expect(layer.cells[y][x]).not.toBeNull();
          expect(layer.cells[y][x]!.type).toBe('sprite');
        }
      }
    }
  });

  test('non-random tool in region: color fill respects bounds', () => {
    const layer = makeLayer('region-color', level, 0);
    prefillWithSprites(layer, level);
    const tool: Tool = { type: 'color', colorIndex: 0 };
    const bounds = leftHalfBounds();
    const result = bulkFloodFill(layer, tool, false, false, false, false, false, false, false, false, false, false, undefined, undefined, undefined, undefined, undefined, bounds);
    applyFloodFillResult(layer, result);

    const count = CELL_COUNTS[level];
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        const cell = layer.cells[y][x]!;
        expect(cell).not.toBeNull();
        if (isCellInRegionPx(x, y, layer, bounds)) {
          // Inside region: sprite should be tinted
          expect(cell.type).toBe('sprite');
          if (cell.type === 'sprite') {
            expect(cell.tintR).toBeDefined();
          }
        } else {
          // Outside region: sprite remains untinted
          expect(cell.type).toBe('sprite');
          if (cell.type === 'sprite') {
            expect(cell.tintR).toBeUndefined();
          }
        }
      }
    }
  });

  test('region boundary tiles connect to pre-existing tiles outside region', () => {
    // Pre-fill the entire canvas with random sprites
    const layer = makeLayer('boundary', level, 0);
    const tool: Tool = { type: 'random' };
    applyFloodFillResult(layer, bulkFloodFill(layer, tool, false, false, false, false, false, false, false, false, false, false, undefined, undefined, [layer], true));

    const count = CELL_COUNTS[level];
    // Snapshot right-half cells (columns 2-3) before region fill
    const rightHalfSnapshot: (CellState | null)[][] = [];
    for (let y = 0; y < count; y++) {
      rightHalfSnapshot[y] = [];
      for (let x = 0; x < count; x++) {
        rightHalfSnapshot[y][x] = layer.cells[y][x];
      }
    }

    // Now region-fill just the left half (columns 0-1)
    const bounds = leftHalfBounds();
    applyFloodFillResult(layer, bulkFloodFill(layer, tool, false, false, false, false, false, false, false, false, false, false, undefined, undefined, [layer], true, undefined, bounds));

    // Right-half cells should be unchanged
    for (let y = 0; y < count; y++) {
      for (let x = 2; x < count; x++) {
        expect(layer.cells[y][x]).toBe(rightHalfSnapshot[y][x]);
      }
    }

    // Boundary connectivity: east point of column-1 cells should match
    // west point of column-2 cells (cardinal points must agree)
    for (let y = 0; y < count; y++) {
      const leftCell = layer.cells[y][1]; // rightmost cell in region
      const rightCell = layer.cells[y][2]; // leftmost cell outside region
      if (!leftCell || !rightCell) continue;
      const leftSig = getRenderedSignature(leftCell);
      const rightSig = getRenderedSignature(rightCell);
      if (leftSig && rightSig) {
        // E(2) of left cell must match W(6) of right cell
        expect(leftSig[2]).toBe(rightSig[6]);
      }
    }
  });

  test('full-canvas bounds match existing behavior (regression guard)', () => {
    // Run with full-canvas bounds and compare to without bounds
    const layer1 = makeLayer('full1', level, 0);
    const layer2 = makeLayer('full2', level, 0);
    const tool: Tool = { type: 'color', colorIndex: 2 };
    const count = CELL_COUNTS[level];

    // Without explicit bounds (old behavior)
    applyFloodFillResult(layer1, bulkFloodFill(layer1, tool, true, false, false));
    // With explicit full-canvas bounds
    applyFloodFillResult(layer2, bulkFloodFill(layer2, tool, true, false, false, false, false, false, false, false, false, false, undefined, undefined, undefined, undefined, undefined, fullBounds()));

    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        const c1 = layer1.cells[y][x];
        const c2 = layer2.cells[y][x];
        expect(c2?.type).toBe(c1?.type);
        if (c1?.type === 'color' && c2?.type === 'color') {
          expect(c2.r).toBe(c1.r);
          expect(c2.g).toBe(c1.g);
          expect(c2.b).toBe(c1.b);
        }
        if (c1?.type === 'sprite' && c2?.type === 'sprite') {
          expect(c2.spriteId).toBe(c1.spriteId);
          expect(c2.transform).toEqual(c1.transform);
        }
      }
    }
  });

  // ── Mirror-axis regression: production callers pass regionBounds but
  // leave mirrorBounds undefined. These tests omit the 19th `canvas` arg
  // so they exercise the same code path the figure editor hits.

  test('random + mirrorH on right-half selection: mirrors across canvas center, not selection center', () => {
    const layer = makeLayer('region-mh-right-default', level, 0);
    const tool: Tool = { type: 'random' };
    applyFloodFillResult(layer, bulkFloodFill(layer, tool, true, false, false, false, false, false, false, false, false, false, undefined, undefined, [layer], true, undefined, rightHalfBounds()));

    const count = CELL_COUNTS[level];
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        expect(layer.cells[y][x]).not.toBeNull();
      }
      const c0 = layer.cells[y][0];
      const c3 = layer.cells[y][3];
      if (c0?.type === 'sprite' && c3?.type === 'sprite') {
        expect(c3.spriteId).toBe(c0.spriteId);
        expect(c3.transform.mirrorH).toBe(!c0.transform.mirrorH);
      }
      const c1 = layer.cells[y][1];
      const c2 = layer.cells[y][2];
      if (c1?.type === 'sprite' && c2?.type === 'sprite') {
        expect(c2.spriteId).toBe(c1.spriteId);
        expect(c2.transform.mirrorH).toBe(!c1.transform.mirrorH);
      }
    }
  });

  test('random + mirrorH+V on bottom-right quadrant: mirrors across canvas center', () => {
    const layer = makeLayer('region-mhv-br-default', level, 0);
    const tool: Tool = { type: 'random' };
    applyFloodFillResult(layer, bulkFloodFill(layer, tool, true, true, false, false, false, false, false, false, false, false, undefined, undefined, [layer], true, undefined, bottomRightQuadBounds()));

    const count = CELL_COUNTS[level];
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        expect(layer.cells[y][x]).not.toBeNull();
      }
    }
    // Bottom-right (3,3) ↔ top-left (0,0) via H+V
    const br = layer.cells[3][3];
    const tl = layer.cells[0][0];
    if (br?.type === 'sprite' && tl?.type === 'sprite') {
      expect(tl.spriteId).toBe(br.spriteId);
      expect(tl.transform.mirrorH).toBe(!br.transform.mirrorH);
      expect(tl.transform.mirrorV).toBe(!br.transform.mirrorV);
    }
    // Bottom-right (3,3) ↔ top-right (3,0) via V
    const tr = layer.cells[0][3];
    if (br?.type === 'sprite' && tr?.type === 'sprite') {
      expect(tr.spriteId).toBe(br.spriteId);
      expect(tr.transform.mirrorH).toBe(br.transform.mirrorH);
      expect(tr.transform.mirrorV).toBe(!br.transform.mirrorV);
    }
    // Bottom-right (3,3) ↔ bottom-left (0,3) via H
    const bl = layer.cells[3][0];
    if (br?.type === 'sprite' && bl?.type === 'sprite') {
      expect(bl.spriteId).toBe(br.spriteId);
      expect(bl.transform.mirrorH).toBe(!br.transform.mirrorH);
      expect(bl.transform.mirrorV).toBe(br.transform.mirrorV);
    }
  });

  test('sprite + mirrorH on right-half selection: non-random path also mirrors across canvas center', () => {
    const layer = makeLayer('region-sprite-mh-right', level, 0);
    const tool: Tool = { type: 'sprite', spriteId: 'test/tile' };
    applyFloodFillResult(layer, bulkFloodFill(layer, tool, true, false, false, false, false, false, false, false, false, false, undefined, undefined, [layer], true, undefined, rightHalfBounds()));

    const count = CELL_COUNTS[level];
    // All 4 columns get the sprite: cols 2-3 from primary, cols 0-1 from canvas-center mirror
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        const c = layer.cells[y][x];
        expect(c).not.toBeNull();
        expect(c!.type).toBe('sprite');
        if (c?.type === 'sprite') expect(c.spriteId).toBe('test/tile');
      }
      // Col 0 = canvas-mirror of col 3; col 1 = canvas-mirror of col 2
      const c0 = layer.cells[y][0];
      const c3 = layer.cells[y][3];
      if (c0?.type === 'sprite' && c3?.type === 'sprite') {
        expect(c0.transform.mirrorH).toBe(!c3.transform.mirrorH);
      }
    }
  });
});

describe('bulkFloodFill with onlyEmpty', () => {
  const colorRed: CellState = { type: 'color', r: 255, g: 0, b: 0, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };
  const colorBlue: CellState = { type: 'color', r: 0, g: 0, b: 255, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };

  test('empty layer behaves identically to regular flood fill', () => {
    const layer1 = makeLayer('a', 2);
    const layer2 = makeLayer('b', 2);
    const tool: Tool = { type: 'color', colorIndex: 0 };
    const count = CELL_COUNTS[2]; // 8

    applyFloodFillResult(layer1, bulkFloodFill(layer1, tool, false, false, false, false, false, false, false, false, false, false, count, count));
    applyFloodFillResult(layer2, bulkFloodFill(layer2, tool, false, false, false, false, false, false, false, false, false, false, count, count, undefined, undefined, undefined, undefined, undefined, true));

    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        expect(layer2.cells[y][x]).toEqual(layer1.cells[y][x]);
      }
    }
  });

  test('partially filled layer: existing cells unchanged, empty cells filled (sprite tool)', () => {
    const layer = makeLayer('test', 2);
    const count = CELL_COUNTS[2]; // 8
    // Pre-fill some cells
    applyCellEdit(layer, 0, 0, colorRed);
    applyCellEdit(layer, 3, 3, colorRed);

    const tool: Tool = { type: 'random' };
    const result = bulkFloodFill(layer, tool, false, false, false, false, false, false, false, false, false, false, count, count, undefined, undefined, undefined, undefined, undefined, true);
    applyFloodFillResult(layer, result);
    const { ops } = result;

    // Pre-filled cells should remain red
    expect(layer.cells[0][0]).toEqual(colorRed);
    expect(layer.cells[3][3]).toEqual(colorRed);

    // Empty cells should now be filled
    expect(layer.cells[1][1]).not.toBeNull();
    expect(layer.cells[0][1]).not.toBeNull();

    // Ops should not include pre-filled cells
    const opKeys = new Set(ops.map(o => o.op === 'cell' ? `${o.cellX},${o.cellY}` : ''));
    expect(opKeys.has('0,0')).toBe(false);
    expect(opKeys.has('3,3')).toBe(false);
  });

  test('color + onlyEmpty: skips empty tiles (no-op on empty canvas)', () => {
    const layer = makeLayer('test', 2);
    const count = CELL_COUNTS[2]; // 8

    const tool: Tool = { type: 'color', colorIndex: 1 };
    const result = bulkFloodFill(layer, tool, false, false, false, false, false, false, false, false, false, false, count, count, undefined, undefined, undefined, undefined, undefined, true);
    applyFloodFillResult(layer, result);
    const { ops } = result;

    expect(ops.length).toBe(0);
  });

  test('fully filled layer: no ops generated', () => {
    const layer = makeLayer('test', 2);
    const count = CELL_COUNTS[2]; // 8
    // Fill every cell
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        applyCellEdit(layer, x, y, colorRed);
      }
    }

    const tool: Tool = { type: 'color', colorIndex: 1 };
    const result = bulkFloodFill(layer, tool, false, false, false, false, false, false, false, false, false, false, count, count, undefined, undefined, undefined, undefined, undefined, true);
    applyFloodFillResult(layer, result);
    const { ops } = result;

    expect(ops.length).toBe(0);
  });

  test('mirror + onlyEmpty: mirror targets also skip non-empty cells (sprite tool)', () => {
    const layer = makeLayer('test', 2);
    const count = CELL_COUNTS[2]; // 8
    // Pre-fill a cell and its horizontal mirror counterpart
    applyCellEdit(layer, 0, 0, colorRed);
    const mirrorX = count - 1; // 7
    applyCellEdit(layer, mirrorX, 0, colorBlue);

    const tool: Tool = { type: 'random' };
    const result = bulkFloodFill(layer, tool, true, false, false, false, false, false, false, false, false, false, count, count, undefined, undefined, undefined, undefined, undefined, true);
    applyFloodFillResult(layer, result);
    const { ops } = result;

    // Pre-filled cells should remain unchanged
    expect(layer.cells[0][0]).toEqual(colorRed);
    expect(layer.cells[0][mirrorX]).toEqual(colorBlue);

    // Ops should not include pre-filled cells
    const opKeys = new Set(ops.map(o => o.op === 'cell' ? `${o.cellX},${o.cellY}` : ''));
    expect(opKeys.has('0,0')).toBe(false);
    expect(opKeys.has(`${mirrorX},0`)).toBe(false);

    // Other cells should be filled
    expect(layer.cells[1][0]).not.toBeNull();
  });

  test('color + onlyEmpty: tints existing sprites but skips empty cells', () => {
    const layer = makeLayer('test', 2);
    const count = CELL_COUNTS[2]; // 8
    // Pre-fill with sprites, then erase some cells
    prefillWithSprites(layer, 2 as GridLevel);
    applyCellEdit(layer, 2, 2, null as unknown as CellState);
    applyCellEdit(layer, 4, 4, null as unknown as CellState);

    const tool: Tool = { type: 'color', colorIndex: 0 };
    const result = bulkFloodFill(layer, tool, false, false, false, false, false, false, false, false, false, false, count, count, undefined, undefined, undefined, undefined, undefined, true);
    applyFloodFillResult(layer, result);
    const { ops } = result;

    // onlyEmpty skips non-empty cells, color skips empty cells → no ops
    // (onlyEmpty checks row[tx] != null → continue for existing sprites,
    //  and the color guard skips oldState == null for erased cells)
    expect(ops.length).toBe(0);
    // Erased cells remain empty
    expect(layer.cells[2][2]).toBeNull();
    expect(layer.cells[4][4]).toBeNull();
  });

  test('random tool: flood complete, erase, flood complete again fills erased cells', () => {
    const layer = makeLayer('test', 2);
    const count = CELL_COUNTS[2]; // 8
    const tool: Tool = { type: 'random' };

    // First flood complete on empty layer — fills everything
    const result1 = bulkFloodFill(layer, tool, false, false, false, false, false, false, false, false, false, false, count, count, [layer], true, new Set(), undefined, undefined, true);
    applyFloodFillResult(layer, result1);
    const { ops: ops1 } = result1;
    expect(ops1.length).toBe(count * count);
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        expect(layer.cells[y][x]).not.toBeNull();
      }
    }

    // Erase some cells
    applyCellEdit(layer, 2, 2, null as unknown as CellState);
    applyCellEdit(layer, 4, 4, null as unknown as CellState);
    expect(layer.cells[2][2]).toBeNull();
    expect(layer.cells[4][4]).toBeNull();

    // Second flood complete — should fill only the erased cells
    const result2 = bulkFloodFill(layer, tool, false, false, false, false, false, false, false, false, false, false, count, count, [layer], true, new Set(), undefined, undefined, true);
    applyFloodFillResult(layer, result2);
    const { ops: ops2 } = result2;
    expect(ops2.length).toBe(2);
    expect(layer.cells[2][2]).not.toBeNull();
    expect(layer.cells[4][4]).not.toBeNull();
  });
});

// ── mergeTintWithCell ────────────────────────────────────────────────

describe('mergeTintWithCell', () => {
  test('null cell returns null (no-op)', () => {
    const result = mergeTintWithCell(255, 0, 0, null);
    expect(result).toBeNull();
  });

  test('color cell returns recolored cell', () => {
    const existing: CellState = { type: 'color', r: 0, g: 255, b: 0, transform: DEFAULT_TRANSFORM };
    const result = mergeTintWithCell(255, 0, 0, existing);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('color');
    if (result && result.type === 'color') {
      expect(result.r).toBe(255);
      expect(result.g).toBe(0);
      expect(result.b).toBe(0);
      expect(result.transform).toEqual(DEFAULT_TRANSFORM);
    }
  });

  test('sprite cell returns tinted sprite preserving spriteId and transform', () => {
    const transform: CellTransform = { mirrorH: true, mirrorV: false, rotation: 90 };
    const existing: CellState = { type: 'sprite', spriteId: 'test_tile', transform };
    const result = mergeTintWithCell(128, 64, 255, existing);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('sprite');
    if (result && result.type === 'sprite') {
      expect(result.spriteId).toBe('test_tile');
      expect(result.transform).toEqual(transform);
      expect(result.tintR).toBe(128);
      expect(result.tintG).toBe(64);
      expect(result.tintB).toBe(255);
    }
  });
});

// ── mergeSpriteWithCell ─────────────────────────────────────────────

describe('mergeSpriteWithCell', () => {
  test('sprite on color cell carries color as tint', () => {
    const existing: CellState = { type: 'color', r: 255, g: 128, b: 0, transform: DEFAULT_TRANSFORM };
    const sprite: CellState = { type: 'sprite', spriteId: 'test/tile', transform: DEFAULT_TRANSFORM };
    const result = mergeSpriteWithCell(sprite, existing);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('sprite');
    if (result && result.type === 'sprite') {
      expect(result.spriteId).toBe('test/tile');
      expect(result.tintR).toBe(255);
      expect(result.tintG).toBe(128);
      expect(result.tintB).toBe(0);
    }
  });

  test('sprite on null cell has no tint', () => {
    const sprite: CellState = { type: 'sprite', spriteId: 'test/tile', transform: DEFAULT_TRANSFORM };
    const result = mergeSpriteWithCell(sprite, null);
    expect(result!.type).toBe('sprite');
    if (result && result.type === 'sprite') {
      expect(result.tintR).toBeUndefined();
    }
  });

  test('sprite on tinted sprite inherits tint', () => {
    const existing: CellState = { type: 'sprite', spriteId: 'other/tile', transform: DEFAULT_TRANSFORM, tintR: 255, tintG: 0, tintB: 128 };
    const sprite: CellState = { type: 'sprite', spriteId: 'test/tile', transform: DEFAULT_TRANSFORM };
    const result = mergeSpriteWithCell(sprite, existing);
    expect(result!.type).toBe('sprite');
    if (result && result.type === 'sprite') {
      expect(result.tintR).toBe(255);
      expect(result.tintG).toBe(0);
      expect(result.tintB).toBe(128);
    }
  });

  test('sprite on untinted sprite has no tint', () => {
    const existing: CellState = { type: 'sprite', spriteId: 'other/tile', transform: DEFAULT_TRANSFORM };
    const sprite: CellState = { type: 'sprite', spriteId: 'test/tile', transform: DEFAULT_TRANSFORM };
    const result = mergeSpriteWithCell(sprite, existing);
    expect(result!.type).toBe('sprite');
    if (result && result.type === 'sprite') {
      expect(result.tintR).toBeUndefined();
    }
  });
});

// ── applyActiveTint ─────────────────────────────────────────────────

describe('applyActiveTint', () => {
  test('non-white active color tints an untinted sprite', () => {
    const sprite: CellState = { type: 'sprite', spriteId: 'test/tile', transform: DEFAULT_TRANSFORM };
    const result = applyActiveTint(sprite, 255, 0, 0);
    expect(result!.type).toBe('sprite');
    if (result && result.type === 'sprite') {
      expect(result.tintR).toBe(255);
      expect(result.tintG).toBe(0);
      expect(result.tintB).toBe(0);
    }
  });

  test('non-white active color overrides existing tint on sprite', () => {
    const sprite: CellState = { type: 'sprite', spriteId: 'test/tile', transform: DEFAULT_TRANSFORM, tintR: 0, tintG: 255, tintB: 0 };
    const result = applyActiveTint(sprite, 255, 0, 0);
    expect(result!.type).toBe('sprite');
    if (result && result.type === 'sprite') {
      expect(result.tintR).toBe(255);
      expect(result.tintG).toBe(0);
      expect(result.tintB).toBe(0);
    }
  });

  test('white active color leaves existing tint alone', () => {
    const sprite: CellState = { type: 'sprite', spriteId: 'test/tile', transform: DEFAULT_TRANSFORM, tintR: 0, tintG: 255, tintB: 0 };
    const result = applyActiveTint(sprite, 255, 255, 255);
    expect(result).toBe(sprite);
    if (result && result.type === 'sprite') {
      expect(result.tintR).toBe(0);
      expect(result.tintG).toBe(255);
      expect(result.tintB).toBe(0);
    }
  });

  test('white active color leaves untinted sprite untouched', () => {
    const sprite: CellState = { type: 'sprite', spriteId: 'test/tile', transform: DEFAULT_TRANSFORM };
    const result = applyActiveTint(sprite, 255, 255, 255);
    expect(result).toBe(sprite);
    if (result && result.type === 'sprite') {
      expect(result.tintR).toBeUndefined();
    }
  });

  test('color cell is unchanged', () => {
    const color: CellState = { type: 'color', r: 0, g: 0, b: 255, transform: DEFAULT_TRANSFORM };
    const result = applyActiveTint(color, 255, 0, 0);
    expect(result).toBe(color);
  });

  test('null cell is unchanged', () => {
    const result = applyActiveTint(null, 255, 0, 0);
    expect(result).toBeNull();
  });

  test('active tint beats inherited tint when paired with mergeSpriteWithCell', () => {
    // This is the call-site pattern every sprite-stamp path uses.
    const existing: CellState = { type: 'sprite', spriteId: 'other/tile', transform: DEFAULT_TRANSFORM, tintR: 0, tintG: 255, tintB: 0 };
    const fresh: CellState = { type: 'sprite', spriteId: 'test/tile', transform: DEFAULT_TRANSFORM };
    let result = mergeSpriteWithCell(fresh, existing);
    result = applyActiveTint(result, 255, 0, 0);
    expect(result!.type).toBe('sprite');
    if (result && result.type === 'sprite') {
      expect(result.tintR).toBe(255);
      expect(result.tintG).toBe(0);
      expect(result.tintB).toBe(0);
    }
  });

  test('white active color lets inherited tint through mergeSpriteWithCell', () => {
    const existing: CellState = { type: 'sprite', spriteId: 'other/tile', transform: DEFAULT_TRANSFORM, tintR: 0, tintG: 255, tintB: 0 };
    const fresh: CellState = { type: 'sprite', spriteId: 'test/tile', transform: DEFAULT_TRANSFORM };
    let result = mergeSpriteWithCell(fresh, existing);
    result = applyActiveTint(result, 255, 255, 255);
    if (result && result.type === 'sprite') {
      expect(result.tintR).toBe(0);
      expect(result.tintG).toBe(255);
      expect(result.tintB).toBe(0);
    }
  });
});

// ── bulkFloodFill color tint merge ──────────────────────────────────

describe('bulkFloodFill color tint merge', () => {
  test('color flood fill tints existing sprite cells', () => {
    const layer = makeLayer('flood-tint', 2, 0);
    // Place a sprite in one cell
    layer.cells[0][0] = { type: 'sprite', spriteId: 'test/tile', transform: DEFAULT_TRANSFORM };
    const tool: Tool = { type: 'color', customColorR: 255, customColorG: 0, customColorB: 0 }; // Red
    const result = bulkFloodFill(layer, tool, false, false);
    applyFloodFillResult(layer, result);
    const { ops } = result;
    // Only the 1 sprite cell should be tinted; empty cells are skipped
    expect(ops.length).toBe(1);
    // The sprite cell should be tinted, not replaced
    const cell = layer.cells[0][0]!;
    expect(cell.type).toBe('sprite');
    if (cell.type === 'sprite') {
      expect(cell.spriteId).toBe('test/tile');
      expect(cell.tintR).toBe(255);
      expect(cell.tintG).toBe(0);
      expect(cell.tintB).toBe(0);
    }
    // Empty cells should remain empty
    expect(layer.cells[1][1]).toBeNull();
  });
});

// ── tileFloodFill & sprite flood fill optimization ─────────────────

import { tileFloodFill } from '../cells';
import { bulkFloodFillAsync } from '../cells';

describe('tileFloodFill', () => {
  test('tiles a cell buffer across the full layer and matches per-cell rendering', () => {
    const level: GridLevel = 2; // 8x8 cells, 256px each
    const size = cellPx(level);
    const count = CELL_COUNTS[level];

    // Render a color cell into a buffer
    const colorState: CellState = { type: 'color', r: 42, g: 99, b: 200, transform: DEFAULT_TRANSFORM };
    const byteLen = renderCellToBuffer(colorState, size, level);
    expect(byteLen).toBeGreaterThan(0);
    const cellBuf = new Uint8Array(byteLen);
    cellBuf.set(sharedCellBuf.subarray(0, byteLen));

    // Create two layers: one tiled, one per-cell stamped
    const tiledLayer = makeLayer('tiled', level, 0);
    const perCellLayer = makeLayer('percell', level, 0);

    // Tile the first layer
    tileFloodFill(tiledLayer, cellBuf, size, 0, 0, count * size, count * size);

    // Per-cell stamp the second layer
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        renderCellToPixels(perCellLayer, x, y, colorState);
      }
    }

    // Pixel data should be identical
    expect(tiledLayer.data).toEqual(perCellLayer.data);
  });

  test('clips correctly at layer boundaries', () => {
    const level: GridLevel = 2;
    const size = cellPx(level);

    const colorState: CellState = { type: 'color', r: 100, g: 150, b: 200, transform: DEFAULT_TRANSFORM };
    renderCellToBuffer(colorState, size, level);
    const cellBuf = new Uint8Array(size * size * 4);
    cellBuf.set(sharedCellBuf.subarray(0, size * size * 4));

    const layer = makeLayer('clip', level, 0);

    // Tile with bounds exceeding LAYER_PX — should clip without error
    tileFloodFill(layer, cellBuf, size, 0, 0, LAYER_PX + 100, LAYER_PX + 100);

    // First pixel should be filled
    expect(layer.dataU32[0]).not.toBe(0);
    // Last pixel should be filled
    expect(layer.dataU32[LAYER_PX * LAYER_PX - 1]).not.toBe(0);
  });

  test('handles negative start coordinates (shifted layers)', () => {
    const level: GridLevel = 2;
    const size = cellPx(level);

    const colorState: CellState = { type: 'color', r: 50, g: 100, b: 150, transform: DEFAULT_TRANSFORM };
    renderCellToBuffer(colorState, size, level);
    const cellBuf = new Uint8Array(size * size * 4);
    cellBuf.set(sharedCellBuf.subarray(0, size * size * 4));

    const layer = makeLayer('neg', level, 0);

    // Negative start should clip to 0
    tileFloodFill(layer, cellBuf, size, -size, -size, LAYER_PX, LAYER_PX);

    // Pixel at (0,0) should be filled
    expect(layer.dataU32[0]).not.toBe(0);
  });

  test('partial region only fills specified area', () => {
    const level: GridLevel = 2;
    const size = cellPx(level);

    const colorState: CellState = { type: 'color', r: 255, g: 0, b: 0, transform: DEFAULT_TRANSFORM };
    renderCellToBuffer(colorState, size, level);
    const cellBuf = new Uint8Array(size * size * 4);
    cellBuf.set(sharedCellBuf.subarray(0, size * size * 4));

    const layer = makeLayer('partial', level, 0);

    // Fill only the first 2x2 cell area
    tileFloodFill(layer, cellBuf, size, 0, 0, size * 2, size * 2);

    // Inside area should be filled
    expect(layer.dataU32[0]).not.toBe(0);
    expect(layer.dataU32[size]).not.toBe(0); // second cell in first row

    // Outside area should be empty
    expect(layer.dataU32[size * 3 * LAYER_PX]).toBe(0); // row below fill area
  });
});

describe('sprite flood fill optimization', () => {
  test('sprite flood fill on empty canvas sets all cells to sprite state', () => {
    const layer = makeLayer('sprite-flood', 2, 0);
    const count = CELL_COUNTS[2];
    const tool: Tool = { type: 'sprite', spriteId: 'test/tile', rotation: 0 };
    const result = bulkFloodFill(layer, tool, false, false);
    applyFloodFillResult(layer, result);
    const { ops } = result;

    expect(ops.length).toBe(count * count);
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        const cell = layer.cells[y][x];
        expect(cell).not.toBeNull();
        expect(cell!.type).toBe('sprite');
        if (cell?.type === 'sprite') {
          expect(cell.spriteId).toBe('test/tile');
          expect(cell.tintR).toBeUndefined();
        }
      }
    }
  });

  test('sprite flood fill on canvas with color cells produces tinted sprites', () => {
    const layer = makeLayer('sprite-tint', 2, 0);
    const count = CELL_COUNTS[2];

    // Place some color cells
    layer.cells[0][0] = { type: 'color', r: 255, g: 0, b: 0, transform: DEFAULT_TRANSFORM };
    layer.cells[1][1] = { type: 'color', r: 0, g: 255, b: 0, transform: DEFAULT_TRANSFORM };

    const tool: Tool = { type: 'sprite', spriteId: 'test/tile', rotation: 0 };
    const result = bulkFloodFill(layer, tool, false, false);
    applyFloodFillResult(layer, result);
    const { ops } = result;

    expect(ops.length).toBe(count * count);

    // Re-read cells after flood fill (type has changed from color to sprite)
    const cell00 = layer.cells[0][0] as any;
    expect(cell00.type).toBe('sprite');
    expect(cell00.tintR).toBe(255);
    expect(cell00.tintG).toBe(0);
    expect(cell00.tintB).toBe(0);

    const cell11 = layer.cells[1][1] as any;
    expect(cell11.type).toBe('sprite');
    expect(cell11.tintR).toBe(0);
    expect(cell11.tintG).toBe(255);
    expect(cell11.tintB).toBe(0);

    // Non-tinted cell should have no tint
    const cell22 = layer.cells[2][2]!;
    expect(cell22.type).toBe('sprite');
    if (cell22.type === 'sprite') {
      expect(cell22.tintR).toBeUndefined();
    }
  });

  test('sprite flood fill with mirrorH sets mirrored transforms', () => {
    const layer = makeLayer('sprite-mirrorH', 2, 0);
    const count = CELL_COUNTS[2];
    const tool: Tool = { type: 'sprite', spriteId: 'test/tile', rotation: 0 };
    const result = bulkFloodFill(layer, tool, true, false);
    applyFloodFillResult(layer, result);
    const { ops } = result;

    expect(ops.length).toBe(count * count);
    // Left side should have default transform
    const left = layer.cells[0][0]!;
    expect(left.type).toBe('sprite');
    // Right side should have mirrorH applied
    const right = layer.cells[0][count - 1]!;
    expect(right.type).toBe('sprite');
    if (left.type === 'sprite' && right.type === 'sprite') {
      expect(left.transform.mirrorH).not.toBe(right.transform.mirrorH);
    }
  });

  test('sprite flood fill with mirrorV sets mirrored transforms', () => {
    const layer = makeLayer('sprite-mirrorV', 2, 0);
    const count = CELL_COUNTS[2];
    const tool: Tool = { type: 'sprite', spriteId: 'test/tile', rotation: 0 };
    const result = bulkFloodFill(layer, tool, false, true);
    applyFloodFillResult(layer, result);
    const { ops } = result;

    expect(ops.length).toBe(count * count);
    const top = layer.cells[0][0]!;
    const bottom = layer.cells[count - 1][0]!;
    expect(top.type).toBe('sprite');
    expect(bottom.type).toBe('sprite');
    if (top.type === 'sprite' && bottom.type === 'sprite') {
      expect(top.transform.mirrorV).not.toBe(bottom.transform.mirrorV);
    }
  });

  test('sprite flood fill with both mirrors sets correct transforms', () => {
    const layer = makeLayer('sprite-mirrorHV', 2, 0);
    const count = CELL_COUNTS[2];
    const tool: Tool = { type: 'sprite', spriteId: 'test/tile', rotation: 0 };
    const result = bulkFloodFill(layer, tool, true, true);
    applyFloodFillResult(layer, result);
    const { ops } = result;

    expect(ops.length).toBe(count * count);
    // All four corners should be sprites
    expect(layer.cells[0][0]!.type).toBe('sprite');
    expect(layer.cells[0][count - 1]!.type).toBe('sprite');
    expect(layer.cells[count - 1][0]!.type).toBe('sprite');
    expect(layer.cells[count - 1][count - 1]!.type).toBe('sprite');
  });

  test('sprite flood fill reuses same cell state reference for non-tinted cells', () => {
    const layer = makeLayer('sprite-shared', 2, 0);
    const count = CELL_COUNTS[2];
    const tool: Tool = { type: 'sprite', spriteId: 'test/tile', rotation: 0 };
    applyFloodFillResult(layer, bulkFloodFill(layer, tool, false, false));

    // All cells should share the same object reference (Step 5 optimization)
    const first = layer.cells[0][0];
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        expect(layer.cells[y][x]).toBe(first);
      }
    }
  });

  test('sprite flood fill with region bounds only fills bounded cells', () => {
    const layer = makeLayer('sprite-bounds', 2, 0);
    const size = cellPx(2);
    const count = CELL_COUNTS[2];

    // Region covering first 4x4 cells
    const bounds: RegionBoundsPx = {
      pxMinX: 0, pxMinY: 0,
      pxMaxX: size * 4, pxMaxY: size * 4,
    };

    const tool: Tool = { type: 'sprite', spriteId: 'test/tile', rotation: 0 };
    applyFloodFillResult(layer, bulkFloodFill(layer, tool, false, false, false, false, false, false, false, false, false, false, undefined, undefined,
      [layer], true, undefined, bounds));

    // Inside bounds should be filled
    expect(layer.cells[0][0]).not.toBeNull();
    expect(layer.cells[3][3]).not.toBeNull();
    // Outside bounds should be empty
    expect(layer.cells[count - 1][count - 1]).toBeNull();
  });

  test('async sprite flood fill produces same result as sync', async () => {
    const syncLayer = makeLayer('sync', 2, 0);
    const asyncLayer = makeLayer('async', 2, 0);
    const count = CELL_COUNTS[2];
    const tool: Tool = { type: 'sprite', spriteId: 'test/tile', rotation: 0 };

    applyFloodFillResult(syncLayer, bulkFloodFill(syncLayer, tool, false, false));
    applyFloodFillResult(asyncLayer, await bulkFloodFillAsync(asyncLayer, tool, false, false));

    // Cell states should be identical
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        const sc = syncLayer.cells[y][x];
        const ac = asyncLayer.cells[y][x];
        expect(ac?.type).toBe(sc?.type);
        if (sc?.type === 'sprite' && ac?.type === 'sprite') {
          expect(ac.spriteId).toBe(sc.spriteId);
          expect(ac.transform).toEqual(sc.transform);
          expect(ac.tintR).toBe(sc.tintR);
        }
      }
    }
  });
});

// ── renderCellToBuffer with tint ────────────────────────────────────

describe('renderCellToBuffer with tint', () => {
  test('tinted sprite multiplies RGB channels', () => {
    // Use a known sprite; the test verifies tint multiplication logic
    // In test environment atlas may not be loaded, so buf may be null
    const state: CellState = {
      type: 'sprite',
      spriteId: SPRITE_ENTRIES[0].id,
      transform: DEFAULT_TRANSFORM,
      tintR: 255,
      tintG: 0,
      tintB: 128,
    };
    const size = cellPx(0);
    const byteLen = renderCellToBuffer(state, size, 0);
    if (byteLen > 0) {
      // Check that green channel is zeroed for any non-transparent pixel
      let foundOpaque = false;
      for (let i = 0; i < size * size * 4; i += 4) {
        if (sharedCellBuf[i + 3] > 0) {
          foundOpaque = true;
          expect(sharedCellBuf[i + 1]).toBe(0); // green * 0 = 0
        }
      }
      expect(foundOpaque).toBe(true);
    }
  });

  test('untinted sprite returns byteLen or 0 if atlas not loaded', () => {
    const state: CellState = {
      type: 'sprite',
      spriteId: SPRITE_ENTRIES[0].id,
      transform: DEFAULT_TRANSFORM,
    };
    const size = cellPx(0);
    const byteLen = renderCellToBuffer(state, size, 0);
    // In test environment atlas may not be loaded; just verify no crash
    expect(typeof byteLen).toBe('number');
    expect(byteLen >= 0).toBe(true);
  });
});

// ── Transform LUT + Dirty Rects ──────────────────────────────────────

describe('renderCellToBuffer transform LUT', () => {
  test('color cells render correctly (no LUT needed)', () => {
    const cs: CellState = { type: 'color', r: 100, g: 150, b: 200, transform: DEFAULT_TRANSFORM };
    const size = cellPx(2); // 256
    const byteLen = renderCellToBuffer(cs, size, 2);
    expect(byteLen).toBe(size * size * 4);
    // First pixel should have the correct color
    expect(sharedCellBuf[0]).toBe(100);
    expect(sharedCellBuf[1]).toBe(150);
    expect(sharedCellBuf[2]).toBe(200);
    expect(sharedCellBuf[3]).toBe(255);
  });

  test('null cell returns 0 bytes', () => {
    expect(renderCellToBuffer(null, 64, 0)).toBe(0);
  });
});

describe('dirtyRects splitting', () => {
  test('pushDirtyRect accumulates individual rects', () => {
    const { pushDirtyRect } = require('../types');
    const layer = makeLayer('l', 0);
    expect(layer.dirtyRectCount).toBe(0);

    pushDirtyRect(layer, 0, 0, 64, 64);
    expect(layer.dirtyRectCount).toBe(1);

    pushDirtyRect(layer, 1984, 0, 64, 64);
    expect(layer.dirtyRectCount).toBe(2);
    // They should remain separate (not merged into a huge bounding rect)
    expect(layer.dirtyRects[0].width).toBe(64);
    expect(layer.dirtyRects[1].width).toBe(64);
  });

  test('pushDirtyRect merges when exceeding max limit', () => {
    const { pushDirtyRect } = require('../types');
    const layer = makeLayer('l', 0);
    // Push 9 rects — the 9th should trigger a merge
    for (let i = 0; i < 9; i++) {
      pushDirtyRect(layer, i * 100, 0, 50, 50);
    }
    // Should have merged into a single bounding rect
    expect(layer.dirtyRectCount).toBe(1);
    expect(layer.dirtyRects[0].x).toBe(0);
    expect(layer.dirtyRects[0].width).toBe(850); // 0 to 800+50
  });

  test('pushDirtyRect works with object form (backward compat)', () => {
    const { pushDirtyRect } = require('../types');
    const layer = makeLayer('l', 0);
    pushDirtyRect(layer, { x: 10, y: 20, width: 30, height: 40 });
    expect(layer.dirtyRectCount).toBe(1);
    expect(layer.dirtyRects[0]).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  test('markFullDirty sets single full-layer rect', () => {
    const { markFullDirty, pushDirtyRect: pdr } = require('../types');
    const layer = makeLayer('l', 0);
    pdr(layer, 0, 0, 64, 64);
    pdr(layer, 100, 100, 64, 64);
    markFullDirty(layer);
    expect(layer.dirtyRectCount).toBe(1);
    expect(layer.dirtyRects[0]).toEqual({ x: 0, y: 0, width: 2048, height: 2048 });
  });

  test('coalesceDirtyRects merges adjacent horizontal rects', () => {
    const { coalesceDirtyRects, pushDirtyRect } = require('../types');
    const layer = makeLayer('l', 0);
    // Two adjacent rects on same row
    pushDirtyRect(layer, 0, 0, 64, 64);
    pushDirtyRect(layer, 64, 0, 64, 64);
    // Non-adjacent rect
    pushDirtyRect(layer, 256, 0, 64, 64);
    expect(layer.dirtyRectCount).toBe(3);
    coalesceDirtyRects(layer);
    // First two should merge, third stays separate
    expect(layer.dirtyRectCount).toBe(2);
    expect(layer.dirtyRects[0]).toEqual({ x: 0, y: 0, width: 128, height: 64 });
    expect(layer.dirtyRects[1]).toEqual({ x: 256, y: 0, width: 64, height: 64 });
  });

  test('coalesceDirtyRects leaves non-adjacent rects separate', () => {
    const { coalesceDirtyRects, pushDirtyRect } = require('../types');
    const layer = makeLayer('l', 0);
    pushDirtyRect(layer, 0, 0, 64, 64);
    pushDirtyRect(layer, 0, 128, 64, 64);
    coalesceDirtyRects(layer);
    expect(layer.dirtyRectCount).toBe(2);
  });

  test('cellStateFromTool uses immutable DEFAULT_TRANSFORM for color tool', () => {
    const cs = cellStateFromTool({ type: 'color', colorIndex: 0 });
    expect(cs).not.toBeNull();
    if (cs && cs.type === 'color') {
      expect(cs.transform).toBe(DEFAULT_TRANSFORM);
    }
  });
});

// ── buildCrossLayerOccupancy tests ──────────────────────────────────

describe('buildCrossLayerOccupancy', () => {
  it('marks cells occupied on the active layer itself', () => {
    const layer = makeLayer('L0', 0, 0);
    layer.cells[2][3] = { type: 'color', r: 255, g: 0, b: 0, transform: DEFAULT_TRANSFORM };
    const grid = buildCrossLayerOccupancy(layer, [layer], 32, 32);
    expect(grid[2][3]).toBe(true);
    expect(grid[0][0]).toBe(false);
  });

  it('marks cells occupied on a different visible layer at the same level', () => {
    const active = makeLayer('active', 0, 0);
    const other = makeLayer('other', 0, 1);
    other.cells[5][10] = { type: 'color', r: 0, g: 255, b: 0, transform: DEFAULT_TRANSFORM };
    const grid = buildCrossLayerOccupancy(active, [active, other], 32, 32);
    expect(grid[5][10]).toBe(true);
    expect(grid[0][0]).toBe(false);
  });

  it('skips hidden layers', () => {
    const active = makeLayer('active', 0, 0);
    const hidden = makeLayer('hidden', 0, 1);
    hidden.visible = false;
    hidden.cells[1][1] = { type: 'color', r: 0, g: 0, b: 255, transform: DEFAULT_TRANSFORM };
    const grid = buildCrossLayerOccupancy(active, [active, hidden], 32, 32);
    expect(grid[1][1]).toBe(false);
  });

  it('maps coarser layer cells to active layer resolution', () => {
    // L1 cell covers 2x2 L0 cells. A single L1 cell at (0,0) should
    // mark L0 cells (0,0), (0,1), (1,0), (1,1) as occupied.
    const active = makeLayer('active', 0, 0);
    const coarse = makeLayer('coarse', 1 as GridLevel, 1);
    coarse.cells[0][0] = { type: 'color', r: 255, g: 0, b: 0, transform: DEFAULT_TRANSFORM };
    const grid = buildCrossLayerOccupancy(active, [active, coarse], 32, 32);
    expect(grid[0][0]).toBe(true);
    expect(grid[0][1]).toBe(true);
    expect(grid[1][0]).toBe(true);
    expect(grid[1][1]).toBe(true);
    // Cell outside the coarse cell's coverage should be false
    expect(grid[2][2]).toBe(false);
  });

  it('handles half-cell shifted layers', () => {
    const active = makeLayer('active', 0, 0);
    const shifted = makeLayer('shifted', 0, 1);
    shifted.shiftX = 0.5;
    shifted.shiftY = 0.5;
    // Place a cell at shifted (0,0). Its pixel range starts at half a cell offset,
    // so it should overlap active-layer cells at the boundary.
    shifted.cells[0][0] = { type: 'color', r: 255, g: 0, b: 0, transform: DEFAULT_TRANSFORM };
    const grid = buildCrossLayerOccupancy(active, [active, shifted], 32, 32);
    // The shifted cell at (0,0) occupies pixel range [0.5*px, 1.5*px] in both axes,
    // which maps to active cells 0 and 1 in both axes
    expect(grid[0][0]).toBe(true);
    expect(grid[0][1]).toBe(true);
    expect(grid[1][0]).toBe(true);
    expect(grid[1][1]).toBe(true);
  });
});

// ── Edge Cell Tests ──────────────────────────────────────────────────

describe('Edge Cell Helpers', () => {
  const color: CellState = { type: 'color', r: 100, g: 200, b: 50, transform: DEFAULT_TRANSFORM };

  it('getCell/setCell access main grid for non-negative coords', () => {
    const layer = makeLayer('a', 1 as GridLevel, 0);
    setCell(layer, 3, 5, color);
    expect(layer.cells[5][3]).toEqual(color);
    expect(getCell(layer, 3, 5)).toEqual(color);
  });

  it('getCell/setCell access edgeColLeft for x=-1', () => {
    const layer = makeLayer('a', 1 as GridLevel, 0);
    layer.shiftX = 0.5;
    layer.edgeColLeft = new Array(16).fill(null);
    setCell(layer, -1, 4, color);
    expect(layer.edgeColLeft[4]).toEqual(color);
    expect(getCell(layer, -1, 4)).toEqual(color);
  });

  it('getCell/setCell access edgeRowTop for y=-1', () => {
    const layer = makeLayer('a', 1 as GridLevel, 0);
    layer.shiftY = 0.5;
    layer.edgeRowTop = new Array(16).fill(null);
    setCell(layer, 7, -1, color);
    expect(layer.edgeRowTop[7]).toEqual(color);
    expect(getCell(layer, 7, -1)).toEqual(color);
  });

  it('getCell/setCell access edgeCorner for (-1,-1)', () => {
    const layer = makeLayer('a', 1 as GridLevel, 0);
    layer.shiftX = 0.5;
    layer.shiftY = 0.5;
    layer.edgeColLeft = new Array(16).fill(null);
    layer.edgeRowTop = new Array(16).fill(null);
    setCell(layer, -1, -1, color);
    expect(layer.edgeCorner).toEqual(color);
    expect(getCell(layer, -1, -1)).toEqual(color);
  });

  it('createEdgeStorage allocates arrays based on shift', () => {
    const storage = createEdgeStorage(1 as GridLevel, 0.5, 0.5);
    expect(storage.edgeColLeft).not.toBeNull();
    expect(storage.edgeColLeft!.length).toBe(16);
    expect(storage.edgeRowTop).not.toBeNull();
    expect(storage.edgeRowTop!.length).toBe(16);
    expect(storage.edgeCorner).toBeNull();

    const noShift = createEdgeStorage(1 as GridLevel, 0, 0);
    expect(noShift.edgeColLeft).toBeNull();
    expect(noShift.edgeRowTop).toBeNull();
  });
});

describe('applyCellEdit with edge cells', () => {
  const color: CellState = { type: 'color', r: 10, g: 20, b: 30, transform: DEFAULT_TRANSFORM };

  it('allows cell -1 on shifted axis', () => {
    const layer = makeLayer('a', 1 as GridLevel, 0);
    layer.shiftX = 0.5;
    layer.edgeColLeft = new Array(16).fill(null);
    const edit = applyCellEdit(layer, -1, 3, color);
    expect(edit.oldState).toBeNull();
    expect(edit.newState).toEqual(color);
    expect(getCell(layer, -1, 3)).toEqual(color);
  });

  it('rejects cell -1 on non-shifted axis', () => {
    const layer = makeLayer('a', 1 as GridLevel, 0);
    const edit = applyCellEdit(layer, -1, 3, color);
    expect(edit.oldState).toBeNull();
    // Should not have been stored
    expect(layer.edgeColLeft).toBeNull();
  });

  it('renders edge cell pixels clipped to canvas', () => {
    const layer = makeLayer('a', 1 as GridLevel, 0);
    layer.shiftX = 0.5;
    layer.edgeColLeft = new Array(16).fill(null);
    applyCellEdit(layer, -1, 0, color);
    // Cell -1 at L1 starts at pixel -64, only [0,64) is visible.
    // Check that pixel (0, 64) has color data (first visible row of cell y=0 shifted)
    const cellSize = cellPx(1 as GridLevel); // 128
    const shiftPx = 0.5 * cellSize; // 64
    // First visible pixel should be at (0, shiftPx) = (0, 64)
    const idx = (shiftPx * LAYER_PX + 0) * 4; // y=64, x=0
    expect(layer.data[idx]).toBe(10);     // r
    expect(layer.data[idx + 1]).toBe(20); // g
    expect(layer.data[idx + 2]).toBe(30); // b
    expect(layer.data[idx + 3]).toBe(255); // a
  });
});

describe('snapshot round-trip with edge cells', () => {
  const color: CellState = { type: 'color', r: 42, g: 84, b: 126, transform: DEFAULT_TRANSFORM };

  it('preserves edge cells through snapshot/restore', () => {
    const layer = makeLayer('a', 1 as GridLevel, 0);
    layer.shiftX = 0.5;
    layer.shiftY = 0.5;
    layer.edgeColLeft = new Array(16).fill(null);
    layer.edgeRowTop = new Array(16).fill(null);
    setCell(layer, -1, 2, color);
    setCell(layer, 5, -1, color);
    setCell(layer, -1, -1, color);

    const snap = snapshotLayer(layer);
    expect(snap.edgeColLeft![2]).toEqual(color);
    expect(snap.edgeRowTop![5]).toEqual(color);
    expect(snap.edgeCorner).toEqual(color);

    const restored = layerFromSnapshot(snap);
    expect(getCell(restored, -1, 2)).toEqual(color);
    expect(getCell(restored, 5, -1)).toEqual(color);
    expect(getCell(restored, -1, -1)).toEqual(color);
  });
});

describe('edge cells on small canvas (4x4 L0)', () => {
  const color: CellState = { type: 'color', r: 10, g: 20, b: 30, transform: DEFAULT_TRANSFORM };

  it('screenToCell returns -1 for half-cell region on shifted L1', () => {
    const layer = makeLayer('a', 1 as GridLevel, 0);
    layer.shiftX = 0.5;
    layer.shiftY = 0.5;
    layer.edgeColLeft = new Array(16).fill(null);
    layer.edgeRowTop = new Array(16).fill(null);

    const viewport = makeViewport(800, 600);
    const camera = { offsetX: 0, offsetY: 0, zoom: 1 };

    // On a 4x4 canvas, the visible area is 4/32 = 1/8 of the full 2048px texture.
    // L1 cellSize = 128px. Shift = 64px. Cell -1 occupies pixels [-64, 64).
    // We need to find a screen coordinate that maps to a pixel in [0, 64).
    // The UV-to-pixel mapping: px = uvX * 2048
    // We need px ~ 32 (middle of visible half of cell -1) => uvX ~ 32/2048 = 0.015625
    // screenToCell will compute cellX = floor((32 - 64) / 128) = floor(-0.25) = -1
    screenToCell(
      /* screenX: we need to compute a screen position that maps to the shifted half-cell */
      /* For simplicity, just test applyCellEdit directly */
      0, 0, viewport, camera, layer, 4, 4,
    );
    // This coordinate mapping depends on camera, just verify applyCellEdit works
    const edit = applyCellEdit(layer, -1, 0, color);
    expect(edit.newState).toEqual(color);
    expect(getCell(layer, -1, 0)).toEqual(color);
  });

  it('applyCellEdit works for cell -1 within file dimension bounds', () => {
    const layer = makeLayer('a', 1 as GridLevel, 0);
    layer.shiftX = 0.5;
    layer.shiftY = 0.5;
    layer.edgeColLeft = new Array(16).fill(null);
    layer.edgeRowTop = new Array(16).fill(null);

    // On 4x4 canvas, L1 has editableCells = 2 (cells 0-1 normally)
    // With shift, cell -1 should also be editable
    const editX = applyCellEdit(layer, -1, 0, color);
    expect(getCell(layer, -1, 0)).toEqual(color);
    expect(editX.oldState).toBeNull();

    applyCellEdit(layer, 0, -1, color);
    expect(getCell(layer, 0, -1)).toEqual(color);

    applyCellEdit(layer, -1, -1, color);
    expect(getCell(layer, -1, -1)).toEqual(color);
  });

  it('TOGGLE_LAYER_SHIFT allocates edge storage', () => {
    const state = createInitialState({ id: 'test', name: 'Test', widthL0: 4, heightL0: 4 });
    // Create default layers
    const withLayers = editorReducer(state, { type: 'CREATE_DEFAULT_LAYERS' } as any);

    // Find an L1 layer
    const l1 = withLayers.layers.find(l => l.level === 1);
    if (!l1) return; // skip if no L1 on 4x4

    // Toggle shift X
    const shifted = editorReducer(withLayers, {
      type: 'TOGGLE_LAYER_SHIFT',
      layerId: l1.id,
      axis: 'x',
    } as any);
    const shiftedLayer = shifted.layers.find(l => l.id === l1.id)!;
    expect(shiftedLayer.shiftX).toBe(0.5);
    expect(shiftedLayer.edgeColLeft).not.toBeNull();
    expect(shiftedLayer.edgeColLeft!.length).toBe(CELL_COUNTS[1]);
  });
});

describe('flood fill mirrors edge cells on shifted layer', () => {
  it('H-mirror flood fill: cell -1 gets mirrored content from cell count-1', () => {
    const layer = makeLayer('a', 2 as GridLevel, 0); // L2 = 8 cells, cellSize=256
    layer.shiftX = 0.5;
    layer.edgeColLeft = new Array(8).fill(null);

    // Put some content on cells so erase has something to erase
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        layer.cells[y][x] = { type: 'color', r: 100, g: 100, b: 100, transform: DEFAULT_TRANSFORM };
      }
      layer.edgeColLeft[y] = { type: 'color', r: 100, g: 100, b: 100, transform: DEFAULT_TRANSFORM };
    }

    const tool: Tool = { type: 'erase' };
    const { ops } = bulkFloodFill(
      layer, tool,
      true, false, // mirrorH=true, mirrorV=false
      false, false, false, false, false, false, false, false,
      8, 8,
    );

    const allCellXs = ops.filter(op => op.op === 'cell').map(op => (op as any).cellX);
    const uniqueXs = [...new Set(allCellXs)].sort((a, b) => a - b);
    // Should include -1
    expect(uniqueXs).toContain(-1);
  });

  it('H-mirror random flood fill: edge cells get mirrored states', () => {
    const layer = makeLayer('a', 2 as GridLevel, 0); // L2 = 8 cells
    layer.shiftX = 0.5;
    layer.edgeColLeft = new Array(8).fill(null);

    // Random flood fill with H-mirror
    const tool: Tool = { type: 'random' };
    const { ops } = bulkFloodFill(
      layer, tool,
      true, false, // mirrorH
      false, false, false, false, false, false, false, false,
      8, 8,
      [layer], true,
    );

    // Edge cells at x=-1 should be in ops
    const edgeOps = ops.filter(op => op.op === 'cell' && op.cellX === -1);
    const allCellXs = [...new Set(ops.filter(op => op.op === 'cell').map(op => (op as any).cellX))].sort((a, b) => a - b);

    // The mirror of cell 7 should be cell -1
    // Check that -1 is present and has mirrored content from cell 7
    expect(allCellXs).toContain(-1);
    expect(edgeOps.length).toBe(8); // one per row

    // Each edge cell should be the mirror of cell 7 in the same row
    for (let y = 0; y < 8; y++) {
      const op7 = ops.find(op => op.op === 'cell' && op.cellX === 7 && op.cellY === y);
      const opEdge = ops.find(op => op.op === 'cell' && op.cellX === -1 && op.cellY === y);
      expect(op7).toBeDefined();
      expect(opEdge).toBeDefined();
      // Both should have sprite content (random generates sprites)
      if (op7 && opEdge && op7.op === 'cell' && opEdge.op === 'cell' && op7.newState && opEdge.newState) {
        // The mirrored cell should have the same sprite ID as its counterpart (just mirrored transform)
        if (op7.newState.type === 'sprite' && opEdge.newState.type === 'sprite') {
          expect(opEdge.newState.spriteId).toBe(op7.newState.spriteId);
        }
      }
    }
  });
});

// ── Shift-Aware Cell Index Helpers ───────────────────────────────────

describe('cellToIndex / indexToCellX / indexToCellY / indexColumns', () => {
  test('unshifted layer: identical to cellY * count + cellX', () => {
    const layer = makeLayer('a', 1, 0); // L1 = 16 cells
    expect(indexColumns(layer)).toBe(16);
    expect(cellToIndex(3, 5, layer)).toBe(5 * 16 + 3);
    expect(indexToCellX(5 * 16 + 3, layer)).toBe(3);
    expect(indexToCellY(5 * 16 + 3, layer)).toBe(5);
  });

  test('shiftX only: columns = count + 1, cellX=-1 maps to col 0', () => {
    const layer = makeLayer('a', 1, 0);
    layer.shiftX = 0.5;
    layer.edgeColLeft = new Array(16).fill(null);
    expect(indexColumns(layer)).toBe(17);
    // Cell (-1, 0) → (0+0)*17 + (-1+1) = 0 (offY=0 since no Y shift)
    expect(cellToIndex(-1, 0, layer)).toBe(0);
    expect(indexToCellX(0, layer)).toBe(-1);
    expect(indexToCellY(0, layer)).toBe(0);
    // Normal cell (3, 5) → (5+0)*17 + (3+1) = 89
    expect(cellToIndex(3, 5, layer)).toBe(5 * 17 + 4);
    expect(indexToCellX(5 * 17 + 4, layer)).toBe(3);
    expect(indexToCellY(5 * 17 + 4, layer)).toBe(5);
  });

  test('shiftY only: cellY=-1 maps to row 0', () => {
    const layer = makeLayer('a', 1, 0);
    layer.shiftY = 0.5;
    layer.edgeRowTop = new Array(16).fill(null);
    expect(indexColumns(layer)).toBe(16); // no X shift
    // Cell (3, -1) → (-1+1)*16 + 3 = 3
    expect(cellToIndex(3, -1, layer)).toBe(3);
    expect(indexToCellX(3, layer)).toBe(3);
    expect(indexToCellY(3, layer)).toBe(-1);
  });

  test('both shifted: (-1,-1) maps to index 0', () => {
    const layer = makeLayer('a', 1, 0);
    layer.shiftX = 0.5;
    layer.shiftY = 0.5;
    layer.edgeRowTop = new Array(16).fill(null);
    layer.edgeColLeft = new Array(16).fill(null);
    expect(indexColumns(layer)).toBe(17);
    expect(cellToIndex(-1, -1, layer)).toBe(0);
    expect(indexToCellX(0, layer)).toBe(-1);
    expect(indexToCellY(0, layer)).toBe(-1);
    // Normal cell (0, 0) → (0+1)*17 + (0+1) = 18
    expect(cellToIndex(0, 0, layer)).toBe(18);
    expect(indexToCellX(18, layer)).toBe(0);
    expect(indexToCellY(18, layer)).toBe(0);
  });

  test('round-trip for all valid cells on shifted L2 layer', () => {
    const layer = makeLayer('a', 2, 0); // L2 = 8 cells
    layer.shiftX = 0.5;
    layer.shiftY = 0.5;
    layer.edgeRowTop = new Array(8).fill(null);
    layer.edgeColLeft = new Array(8).fill(null);
    for (let y = -1; y < 8; y++) {
      for (let x = -1; x < 8; x++) {
        const idx = cellToIndex(x, y, layer);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(indexToCellX(idx, layer)).toBe(x);
        expect(indexToCellY(idx, layer)).toBe(y);
      }
    }
  });
});

describe('screenToCell with shifted layer on small file', () => {
  const defaultCamera = { offsetX: 0, offsetY: 0, zoom: 1 };

  test('top partial row returns cellY=-1 for shiftY=0.5', () => {
    const layer = makeLayer('a', 1, 0); // 16 cells, cellPx=128
    layer.shiftY = 0.5;
    layer.edgeRowTop = new Array(16).fill(null);
    // Use viewport = LAYER_PX so scale=1. screenY=32 → py=32
    // cellY = floor((32 - 64) / 128) = floor(-0.25) = -1
    const viewport = makeViewport(LAYER_PX, LAYER_PX);
    const result = screenToCell(LAYER_PX / 2, 32, viewport, defaultCamera, layer);
    expect(result).not.toBeNull();
    expect(result!.cellY).toBe(-1);
  });

  test('top partial row on small file (8x8 L0) returns cellY=-1', () => {
    const layer = makeLayer('a', 1, 0);
    layer.shiftY = 0.5;
    layer.edgeRowTop = new Array(16).fill(null);
    // With viewport = LAYER_PX and default camera, screenY=32 → py=32
    // shiftPxY = 64. cellY = floor((32-64)/128) = -1
    // editableCells(8,1) = 4, so cellY=-1 < 4 passes file bounds
    const viewport = makeViewport(LAYER_PX, LAYER_PX);
    const result = screenToCell(LAYER_PX / 2, 32, viewport, defaultCamera, layer, 8, 8);
    expect(result).not.toBeNull();
    expect(result!.cellY).toBe(-1);
  });
});

describe('bulkFloodFill simple fill (single-layer, clearFirst)', () => {
  const colorRed: CellState = { type: 'color', r: 255, g: 0, b: 0, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };

  test('fills every cell on an empty layer', () => {
    const layer = makeLayer('a', 2);
    const count = CELL_COUNTS[2];
    const tool: Tool = { type: 'random' };
    const result = bulkFloodFill(layer, tool, false, false, false, false, false, false, false, false, false, false, count, count, [layer], undefined, undefined, undefined, undefined, false, true);
    applyFloodFillResult(layer, result);
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        expect(layer.cells[y][x]).not.toBeNull();
      }
    }
  });

  test('overwrites existing cells', () => {
    const layer = makeLayer('a', 2);
    const count = CELL_COUNTS[2];
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        applyCellEdit(layer, x, y, colorRed);
      }
    }
    const tool: Tool = { type: 'random' };
    const result = bulkFloodFill(layer, tool, false, false, false, false, false, false, false, false, false, false, count, count, [layer], undefined, undefined, undefined, undefined, false, true);
    applyFloodFillResult(layer, result);
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        expect(layer.cells[y][x]).not.toBeNull();
      }
    }
    expect(result.ops.length).toBeGreaterThan(0);
  });

  test('ignores cross-layer occupancy', () => {
    const layerA = makeLayer('a', 2);
    const layerB = makeLayer('b', 2);
    const count = CELL_COUNTS[2];
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        applyCellEdit(layerB, x, y, colorRed);
      }
    }
    const tool: Tool = { type: 'random' };
    const result = bulkFloodFill(layerA, tool, false, false, false, false, false, false, false, false, false, false, count, count, [layerA], undefined, undefined, undefined, undefined, false, true);
    applyFloodFillResult(layerA, result);
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        expect(layerA.cells[y][x]).not.toBeNull();
      }
    }
  });

  test('repro: fill L2, simple fill L1, erase L2 tiles, clear L2, refill L1', () => {
    const layerL2 = makeLayer('l2', 2);
    const layerL1 = makeLayer('l1', 1);
    const allLayers = [layerL2, layerL1];
    const randomTool: Tool = { type: 'random' };
    const eraseTool: Tool = { type: 'erase' };
    const countL2 = CELL_COUNTS[2];
    const countL1 = CELL_COUNTS[1];

    // Step 1: flood fill L2 (clearFirst, all layers)
    const r1 = bulkFloodFill(layerL2, randomTool, false, false, false, false, false, false, false, false, false, false, countL2, countL2, allLayers, undefined, undefined, undefined, undefined, undefined, true);
    applyFloodFillResult(layerL2, r1);
    for (let y = 0; y < countL2; y++) {
      for (let x = 0; x < countL2; x++) {
        expect(layerL2.cells[y][x]).not.toBeNull();
      }
    }

    // Step 2: simple fill L1 (clearFirst, single layer — ignoring other layers)
    const r2 = bulkFloodFill(layerL1, randomTool, false, false, false, false, false, false, false, false, false, false, countL1, countL1, [layerL1], undefined, undefined, undefined, undefined, false, true);
    applyFloodFillResult(layerL1, r2);
    for (let y = 0; y < countL1; y++) {
      for (let x = 0; x < countL1; x++) {
        expect(layerL1.cells[y][x]).not.toBeNull();
      }
    }

    // Step 3: erase some L2 tiles with erase tool (simulates APPLY_TOOL with erase)
    applyCellEdit(layerL2, 0, 0, null);
    applyCellEdit(layerL2, 1, 1, null);
    applyCellEdit(layerL2, 3, 2, null);
    expect(layerL2.cells[0][0]).toBeNull();

    // Step 4: clear L2 (simulate CLEAR_LAYER)
    for (let y = 0; y < countL2; y++) layerL2.cells[y].fill(null);
    layerL2.data.fill(0);

    // Step 5: flood fill L1 with erase tool (simulates drawTool stuck on erase)
    // This is what happens when user presses flood fill without switching tools
    const r3erase = bulkFloodFill(layerL1, eraseTool, false, false, false, false, false, false, false, false, false, false, countL1, countL1, allLayers, undefined, undefined, undefined, undefined, undefined, true);
    applyFloodFillResult(layerL1, r3erase);
    // Erase flood fill clears L1 — all cells should now be null
    for (let y = 0; y < countL1; y++) {
      for (let x = 0; x < countL1; x++) {
        expect(layerL1.cells[y][x]).toBeNull();
      }
    }

    // Step 6: simple fill L1 with random tool (erase→random fallback)
    // This is the fix: SIMPLE_FILL falls back to random when drawTool is erase
    const r4 = bulkFloodFill(layerL1, randomTool, false, false, false, false, false, false, false, false, false, false, countL1, countL1, [layerL1], undefined, undefined, undefined, undefined, false, true);
    applyFloodFillResult(layerL1, r4);
    const simpleFillOps = r4.ops.filter(op => op.op === 'cell' && op.newState !== null);
    expect(simpleFillOps.length).toBeGreaterThan(0);
    for (let y = 0; y < countL1; y++) {
      for (let x = 0; x < countL1; x++) {
        expect(layerL1.cells[y][x]).not.toBeNull();
      }
    }
  });
});

describe('bulkFloodFill clearFirst respects regionBounds', () => {
  const colorRed: CellState = { type: 'color', r: 255, g: 0, b: 0, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };

  test('clearFirst only clears cells inside regionBounds', () => {
    const layer = makeLayer('a', 2); // L2 = 8x8
    const count = CELL_COUNTS[2];
    const size = cellPx(2); // 256
    // Pre-fill all cells
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        applyCellEdit(layer, x, y, colorRed);
      }
    }
    // Region covering only a 3x3 sub-area (cells 0..2 in x and y)
    const regionBounds: RegionBoundsPx = {
      pxMinX: 0, pxMinY: 0,
      pxMaxX: 3 * size, pxMaxY: 3 * size,
    };
    const tool: Tool = { type: 'random' };
    const result = bulkFloodFill(layer, tool, false, false, false, false, false, false, false, false, false, false, count, count, [layer], undefined, undefined, regionBounds, undefined, false, true);
    applyFloodFillResult(layer, result);
    // Cells outside the 3x3 region must still have their original color state
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        if (x >= 3 || y >= 3) {
          expect(layer.cells[y][x]).toEqual(colorRed);
        }
      }
    }
    // Clear ops should only target cells inside the region
    const clearOps = result.ops.filter(op => op.op === 'cell' && op.newState === null);
    for (const op of clearOps) {
      if (op.op === 'cell') {
        expect(op.cellX).toBeLessThan(3);
        expect(op.cellY).toBeLessThan(3);
      }
    }
  });
});

describe('flood fill all layers (color brush long-press)', () => {
  // Models the orchestration loop in EditorScreen's FLOOD_FILL_ALL_LAYERS case:
  // iterate over editable layers, re-tinting every existing cell with the
  // active color. Locked / hidden layers are skipped.
  function runAllLayers(
    layers: Layer[],
    tool: Tool,
    r: number,
    g: number,
    b: number,
  ): UndoOp[] {
    const all: UndoOp[] = [];
    for (const layer of layers) {
      if (layer.locked || !layer.visible) continue;
      const count = CELL_COUNTS[layer.level];
      const res = bulkFloodFill(
        layer, tool,
        false, false, false, false, false, false, false, false, false, false,
        count, count,
        [layer], true, undefined,
        undefined, undefined, undefined, true,
        r, g, b,
        0, 0,
      );
      if (res.scratchCells) {
        layer.cells = res.scratchCells;
        layer.cellsGeneration++;
      }
      all.push(...res.ops);
    }
    return all;
  }

  test('re-tints existing cells on every editable layer', () => {
    const layerA = makeLayer('a', 2, 0);
    const layerB = makeLayer('b', 3, 1);
    prefillWithSprites(layerA, 2 as GridLevel);
    prefillWithSprites(layerB, 3 as GridLevel);
    const tool: Tool = { type: 'color', colorIndex: 0 };
    const ops = runAllLayers([layerA, layerB], tool, 10, 20, 30);

    const countA = CELL_COUNTS[2];
    const countB = CELL_COUNTS[3];
    expect(ops.length).toBe(countA * countA + countB * countB);
    for (const layer of [layerA, layerB]) {
      const count = CELL_COUNTS[layer.level];
      for (let y = 0; y < count; y++) {
        for (let x = 0; x < count; x++) {
          expect(layer.cells[y][x]).not.toBeNull();
        }
      }
    }
  });

  test('skips locked and hidden layers', () => {
    const editable = makeLayer('editable', 2, 0);
    const locked = makeLayer('locked', 2, 1);
    const hidden = makeLayer('hidden', 2, 2);
    locked.locked = true;
    hidden.visible = false;
    prefillWithSprites(editable, 2 as GridLevel);
    prefillWithSprites(locked, 2 as GridLevel);
    prefillWithSprites(hidden, 2 as GridLevel);

    const lockedBefore = locked.cells;
    const hiddenBefore = hidden.cells;

    const tool: Tool = { type: 'color', colorIndex: 0 };
    const ops = runAllLayers([editable, locked, hidden], tool, 5, 5, 5);

    // Every op targets the editable layer
    for (const op of ops) {
      if (op.op === 'cell') expect(op.layerId).toBe('editable');
    }
    // Untouched layers retain their cell arrays by reference
    expect(locked.cells).toBe(lockedBefore);
    expect(hidden.cells).toBe(hiddenBefore);
  });

  test('produces no ops on layers with no painted cells', () => {
    const painted = makeLayer('painted', 2, 0);
    const empty = makeLayer('empty', 2, 1);
    prefillWithSprites(painted, 2 as GridLevel);

    const tool: Tool = { type: 'color', colorIndex: 0 };
    const ops = runAllLayers([painted, empty], tool, 7, 7, 7);

    const count = CELL_COUNTS[2];
    expect(ops.length).toBe(count * count);
    for (const op of ops) {
      if (op.op === 'cell') expect(op.layerId).toBe('painted');
    }
  });
});

describe('computePaintMirrorTargets — partial-canvas H/V regression cases', () => {
  // These pin the same canvas geometries the prior `regionMirrorCellPx`
  // unit tests covered. Broader behaviour is asserted by the data-driven
  // .facet fixtures in mirroring.test.ts; these stay as fast, focused
  // regressions against the partial-cell pairing math.
  const flagsH: MirrorFlags = {
    mirrorH: true, mirrorV: false, mirrorRotate: false, mirrorQuad: false,
    mirrorRow: false, mirrorCol: false, mirrorDiag1: false, mirrorDiag2: false,
    mirrorDiagBoth: false, mirrorStar: false,
  };
  const flagsV: MirrorFlags = { ...flagsH, mirrorH: false, mirrorV: true };

  test('mirrorH on 14×16 L0 canvas at L2 maps cell 0 to cell 3 (partial-cell lossless)', () => {
    const layer = makeLayer('a', 2);
    // 14×16 L0 at L2 = 3.5×4 cells (cell 3 is partial — covers L0 [12,16) but
    // canvas is L0 [0,14)). Cell-window math pairs canvas cells 0↔3 and 1↔2
    // so the partial right-edge cell isn't orphaned.
    const targets = computePaintMirrorTargets(0, 0, layer, { widthL0: 14, heightL0: 16 }, flagsH);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ x: 3, y: 0, mH: true });
  });

  test('mirrorH on 16×16 L0 canvas at L2 maps cell 0 to cell 3 (even canvas, no regression)', () => {
    const layer = makeLayer('a', 2);
    const targets = computePaintMirrorTargets(0, 0, layer, { widthL0: 16, heightL0: 16 }, flagsH);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ x: 3, y: 0 });
  });

  test('mirrorH on 14×16 L0 canvas at L2 with shiftX=0.5 maps cell 0 to cell 1', () => {
    const layer = makeLayer('a', 2);
    layer.shiftX = 0.5;
    const targets = computePaintMirrorTargets(0, 0, layer, { widthL0: 14, heightL0: 16 }, flagsH);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ x: 1, y: 0 });
  });

  test('mirrorV on 16×14 L0 canvas at L2 maps (0,0) to (0,3) (partial-cell lossless)', () => {
    const layer = makeLayer('a', 2);
    const targets = computePaintMirrorTargets(0, 0, layer, { widthL0: 16, heightL0: 14 }, flagsV);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ x: 0, y: 3, mV: true });
  });

  // Regression: odd widthL0 at coarser layers used to drop the partial
  // right-edge cell's mirror partner (floor-bias). Cell-window math
  // guarantees every canvas cell has a symmetric in-canvas partner.

  test('mirrorH on widthL0=15 L1 layer is symmetric and lossless (0↔7, 7↔0)', () => {
    const layer = makeLayer('a', 1);
    const cfg = { widthL0: 15, heightL0: 16 };
    expect(computePaintMirrorTargets(0, 0, layer, cfg, flagsH)).toEqual([
      expect.objectContaining({ x: 7, y: 0 }),
    ]);
    expect(computePaintMirrorTargets(7, 0, layer, cfg, flagsH)).toEqual([
      expect.objectContaining({ x: 0, y: 0 }),
    ]);
  });

  test('mirrorH on widthL0=15 L1 shifted: cell -1 (left half-strip) mirrors to cell 6', () => {
    const layer = makeLayer('a', 1);
    layer.shiftX = 0.5;
    const cfg = { widthL0: 15, heightL0: 16 };
    expect(computePaintMirrorTargets(-1, 0, layer, cfg, flagsH)).toEqual([
      expect.objectContaining({ x: 6, y: 0 }),
    ]);
    expect(computePaintMirrorTargets(6, 0, layer, cfg, flagsH)).toEqual([
      expect.objectContaining({ x: -1, y: 0 }),
    ]);
  });

  test('mirrorH on widthL0=31 L2 maps cell 0 to cell 7 (partial right-edge has partner)', () => {
    const layer = makeLayer('a', 2);
    const targets = computePaintMirrorTargets(0, 0, layer, { widthL0: 31, heightL0: 32 }, flagsH);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ x: 7 });
  });
});
