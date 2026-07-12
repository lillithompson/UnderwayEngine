import { applyCellEdit, isCellInRegionPx, RegionBoundsPx, shrinkwrapLayers, applyOps, revertOps, computeContentBounds } from '../cells';
import { reconcileCanvas } from '../connectivity';
import { isCellInPathSelection } from '../path-selection';
import { CELL_COUNTS, cellPx, UndoOp, CellState, ClipBox, Layer, DEFAULT_TRANSFORM } from '../types';
import { makeLayer, makeState } from './test-utils';

/** Fill every cell on a layer with a simple color state */
function fillLayer(layer: Layer): void {
  const count = CELL_COUNTS[layer.level];
  for (let cy = 0; cy < count; cy++) {
    for (let cx = 0; cx < count; cx++) {
      const cs: CellState = { type: 'color', r: 100, g: 100, b: 100, transform: DEFAULT_TRANSFORM };
      applyCellEdit(layer, cx, cy, cs);
    }
  }
}

/** Count non-null cells on a layer */
function countCells(layer: Layer): number {
  const count = CELL_COUNTS[layer.level];
  let n = 0;
  for (let cy = 0; cy < count; cy++) {
    for (let cx = 0; cx < count; cx++) {
      if (layer.cells[cy]?.[cx] !== null) n++;
    }
  }
  return n;
}

describe('Cutout — path selection', () => {
  test('erases cells outside path selection, preserves cells inside', () => {
    const layer = makeLayer('a', 0, 0);
    fillLayer(layer);
    expect(countCells(layer)).toBe(32 * 32);

    // Select a 2x2 region at (0,0)-(1,1) on L0
    const pathIndices = new Set([0, 1, 32, 33]); // (0,0), (1,0), (0,1), (1,1)
    const pathLevel = 0;
    const ops: UndoOp[] = [];

    const lCount = CELL_COUNTS[layer.level];
    for (let cy = 0; cy < lCount; cy++) {
      for (let cx = 0; cx < lCount; cx++) {
        if (isCellInPathSelection(pathIndices, pathLevel, layer.level, cx, cy)) continue;
        const old = layer.cells[cy]?.[cx] ?? null;
        if (old !== null) {
          applyCellEdit(layer, cx, cy, null);
          ops.push({ op: 'cell', layerId: layer.id, cellX: cx, cellY: cy, oldState: old, newState: null });
        }
      }
    }

    // 4 cells inside selection should remain
    expect(countCells(layer)).toBe(4);
    // The rest should have been erased
    expect(ops.length).toBe(32 * 32 - 4);
    // Verify the 4 preserved cells
    expect(layer.cells[0]![0]).not.toBeNull();
    expect(layer.cells[0]![1]).not.toBeNull();
    expect(layer.cells[1]![0]).not.toBeNull();
    expect(layer.cells[1]![1]).not.toBeNull();
    // Spot-check an erased cell
    expect(layer.cells[2]![2]).toBeNull();
  });

});

describe('Cutout — rect selection', () => {
  test('erases cells outside rect selection, preserves cells inside', () => {
    const layer = makeLayer('a', 0, 0);
    fillLayer(layer);

    // Select cells (2,2)-(4,4) on L0
    const activeCellPxVal = cellPx(0);
    const regionBounds: RegionBoundsPx = {
      pxMinX: 2 * activeCellPxVal,
      pxMinY: 2 * activeCellPxVal,
      pxMaxX: 5 * activeCellPxVal, // endCellX=4, +1 = 5
      pxMaxY: 5 * activeCellPxVal,
    };

    const ops: UndoOp[] = [];
    const lCount = CELL_COUNTS[layer.level];
    for (let cy = 0; cy < lCount; cy++) {
      for (let cx = 0; cx < lCount; cx++) {
        if (isCellInRegionPx(cx, cy, layer, regionBounds)) continue;
        const old = layer.cells[cy]?.[cx] ?? null;
        if (old !== null) {
          applyCellEdit(layer, cx, cy, null);
          ops.push({ op: 'cell', layerId: layer.id, cellX: cx, cellY: cy, oldState: old, newState: null });
        }
      }
    }

    // 3x3 = 9 cells inside selection should remain
    expect(countCells(layer)).toBe(9);
    expect(ops.length).toBe(32 * 32 - 9);
  });

  test('works across multiple unlocked layers', () => {
    const l0 = makeLayer('l0', 0, 0);
    const l1 = makeLayer('l1', 1, 1);
    fillLayer(l0);
    fillLayer(l1);

    // Rect selection on L0: cells (0,0)-(0,0) — single cell
    const activeCellPxVal = cellPx(0);
    const regionBounds: RegionBoundsPx = {
      pxMinX: 0,
      pxMinY: 0,
      pxMaxX: 1 * activeCellPxVal,
      pxMaxY: 1 * activeCellPxVal,
    };

    const layers = [l0, l1];
    const ops: UndoOp[] = [];
    for (const layer of layers) {
      if (layer.locked) continue;
      const lCount = CELL_COUNTS[layer.level];
      for (let cy = 0; cy < lCount; cy++) {
        for (let cx = 0; cx < lCount; cx++) {
          if (isCellInRegionPx(cx, cy, layer, regionBounds)) continue;
          const old = layer.cells[cy]?.[cx] ?? null;
          if (old !== null) {
            applyCellEdit(layer, cx, cy, null);
            ops.push({ op: 'cell', layerId: layer.id, cellX: cx, cellY: cy, oldState: old, newState: null });
          }
        }
      }
    }

    // L0: 1 cell preserved out of 32*32
    expect(countCells(l0)).toBe(1);
    // L1: cell (0,0) center is at 0.5*cellPx(1) which may or may not be in bounds
    // The important thing is that both layers were processed
    expect(ops.length).toBeGreaterThan(0);
    const l0Ops = ops.filter(op => op.op === 'cell' && op.layerId === 'l0');
    const l1Ops = ops.filter(op => op.op === 'cell' && op.layerId === 'l1');
    expect(l0Ops.length).toBe(32 * 32 - 1);
    expect(l1Ops.length).toBeGreaterThan(0);
  });

});

describe('Cutout + shrinkwrap — single undo entry', () => {
  test('cutout + shrinkwrap produces single undo entry and undo restores cells and dimensions', () => {
    const layer = makeLayer('a', 0, 0);
    fillLayer(layer);

    const origW = 32;
    const origH = 32;

    // Select a 2x2 region at (0,0)-(1,1) on L0 — cutout erases everything outside
    const pathIndices = new Set([0, 1, 32, 33]);
    const pathLevel = 0;
    const eraseOps: UndoOp[] = [];

    const lCount = CELL_COUNTS[layer.level];
    for (let cy = 0; cy < lCount; cy++) {
      for (let cx = 0; cx < lCount; cx++) {
        if (isCellInPathSelection(pathIndices, pathLevel, layer.level, cx, cy)) continue;
        const old = layer.cells[cy]?.[cx] ?? null;
        if (old !== null) {
          applyCellEdit(layer, cx, cy, null);
          eraseOps.push({ op: 'cell', layerId: layer.id, cellX: cx, cellY: cy, oldState: old, newState: null as any });
        }
      }
    }

    const allOps: UndoOp[] = [...eraseOps];

    // Snapshot cells before shrinkwrap
    const count = CELL_COUNTS[layer.level];
    const cellsBefore: (CellState | null)[][] = [];
    for (let y = 0; y < count; y++) {
      cellsBefore[y] = layer.cells[y].slice();
    }

    // Run shrinkwrap
    const result = shrinkwrapLayers([layer], origW, origH);

    // Content is only at (0,0)-(1,1). Shrinkwrap trims to the tight L0
    // bbox → 2×2.
    expect(result.widthL0).toBe(2);
    expect(result.heightL0).toBe(2);

    // Append shrinkwrap op
    allOps.push({
      op: 'shrinkwrap',
      oldWidthL0: origW,
      oldHeightL0: origH,
      newWidthL0: result.widthL0,
      newHeightL0: result.heightL0,
      oldOriginL0X: 0, oldOriginL0Y: 0,
      newOriginL0X: 0, newOriginL0Y: 0,
      layerCellsBefore: [{ layerId: layer.id, cells: cellsBefore }],
    });

    // Single undo entry
    expect(allOps.some(op => op.op === 'shrinkwrap')).toBe(true);
    expect(allOps.filter(op => op.op === 'cell').length).toBeGreaterThan(0);

    // Now test revert: undo should restore both cells and dimensions
    const state = makeState([layer], {
      fileConfig: { id: 'test-file', name: 'Test', widthL0: result.widthL0, heightL0: result.heightL0 },
    });
    const reverted = revertOps(state, allOps);

    // Dimensions restored
    expect(reverted.fileConfig.widthL0).toBe(origW);
    expect(reverted.fileConfig.heightL0).toBe(origH);

    // All cells should be restored (layer was fully filled before cutout)
    const revertedLayer = reverted.layers.find(l => l.id === 'a')!;
    expect(countCells(revertedLayer)).toBe(32 * 32);
  });

  test('redo re-applies shrinkwrap after revert', () => {
    const layer = makeLayer('a', 0, 0);
    fillLayer(layer);

    const origW = 32;
    const origH = 32;

    // Erase everything except (0,0)
    const eraseOps: UndoOp[] = [];
    const lCount = CELL_COUNTS[layer.level];
    for (let cy = 0; cy < lCount; cy++) {
      for (let cx = 0; cx < lCount; cx++) {
        if (cx === 0 && cy === 0) continue;
        const old = layer.cells[cy]?.[cx] ?? null;
        if (old !== null) {
          applyCellEdit(layer, cx, cy, null);
          eraseOps.push({ op: 'cell', layerId: layer.id, cellX: cx, cellY: cy, oldState: old, newState: null as any });
        }
      }
    }

    const allOps: UndoOp[] = [...eraseOps];

    // Snapshot + shrinkwrap
    const count = CELL_COUNTS[layer.level];
    const cellsBefore: (CellState | null)[][] = [];
    for (let y = 0; y < count; y++) {
      cellsBefore[y] = layer.cells[y].slice();
    }
    const result = shrinkwrapLayers([layer], origW, origH);

    allOps.push({
      op: 'shrinkwrap',
      oldWidthL0: origW,
      oldHeightL0: origH,
      newWidthL0: result.widthL0,
      newHeightL0: result.heightL0,
      oldOriginL0X: 0, oldOriginL0Y: 0,
      newOriginL0X: 0, newOriginL0Y: 0,
      layerCellsBefore: [{ layerId: layer.id, cells: cellsBefore }],
    });

    // Build state after cutout+shrinkwrap
    const stateAfter = makeState([layer], {
      fileConfig: { id: 'test-file', name: 'Test', widthL0: result.widthL0, heightL0: result.heightL0 },
    });

    // Revert (undo)
    const reverted = revertOps(stateAfter, allOps);
    expect(reverted.fileConfig.widthL0).toBe(origW);
    expect(reverted.fileConfig.heightL0).toBe(origH);

    // Re-apply (redo)
    const redone = applyOps(reverted, allOps);
    expect(redone.fileConfig.widthL0).toBe(result.widthL0);
    expect(redone.fileConfig.heightL0).toBe(result.heightL0);
  });
});

describe('setClipBox undo op', () => {
  test('apply then revert restores prior clipBox (undefined ↔ ClipBox)', () => {
    const layer = makeLayer('a', 0, 0);
    const state = makeState([layer]);
    expect(state.fileConfig.clipBox).toBeUndefined();

    const newClip: ClipBox = { clipL0X: 4, clipL0Y: 4, clipL0W: 8, clipL0H: 8 };
    const ops: UndoOp[] = [{ op: 'setClipBox', oldClipBox: null, newClipBox: newClip }];

    const applied = applyOps(state, ops);
    expect(applied.fileConfig.clipBox).toEqual(newClip);

    const reverted = revertOps(applied, ops);
    expect(reverted.fileConfig.clipBox).toBeUndefined();
  });

  test('apply then revert preserves transitions between two clip boxes', () => {
    const layer = makeLayer('a', 0, 0);
    const oldClip: ClipBox = { clipL0X: 0, clipL0Y: 0, clipL0W: 32, clipL0H: 32 };
    const newClip: ClipBox = { clipL0X: 8, clipL0Y: 8, clipL0W: 16, clipL0H: 16 };
    const state = makeState([layer], { fileConfig: { id: 'test-file', name: 'Test', clipBox: oldClip } });

    const ops: UndoOp[] = [{ op: 'setClipBox', oldClipBox: oldClip, newClipBox: newClip }];

    const applied = applyOps(state, ops);
    expect(applied.fileConfig.clipBox).toEqual(newClip);

    const reverted = revertOps(applied, ops);
    expect(reverted.fileConfig.clipBox).toEqual(oldClip);
  });

});

describe('computeContentBounds — odd L0 dimensions (regression)', () => {
  test('L0 content at [0,11) returns width=11, not snapped up to 12', () => {
    const layer = makeLayer('a', 0, 0);
    for (let cy = 0; cy < 11; cy++) {
      for (let cx = 0; cx < 11; cx++) {
        applyCellEdit(layer, cx, cy, {
          type: 'color', r: 100, g: 100, b: 100, transform: DEFAULT_TRANSFORM,
        });
      }
    }
    const bounds = computeContentBounds([layer]);
    expect(bounds).not.toBeNull();
    expect(bounds!.minL0X).toBe(0);
    expect(bounds!.minL0Y).toBe(0);
    expect(bounds!.maxL0X).toBe(11);
    expect(bounds!.maxL0Y).toBe(11);
  });

  test('11x12 canvas, L1 shifted down, content trimmed to 11x11 → bounds = 11x11', () => {
    // Simulates the user's bug: 11x12 canvas, L1 layer shifted down,
    // user selected the centered 11x11 square via path mode and cut out.
    // After cutout we have an L0 layer with content in [0,11)×[0,11) and
    // an L1 layer (shiftY=0.5) with regular cells [0..4] preserved
    // covering L0 [1,11) in Y. Edge cells erased by path-mode cutout.
    const l0 = makeLayer('l0', 0, 0);
    for (let cy = 0; cy < 11; cy++) {
      for (let cx = 0; cx < 11; cx++) {
        applyCellEdit(l0, cx, cy, {
          type: 'color', r: 100, g: 100, b: 100, transform: DEFAULT_TRANSFORM,
        });
      }
    }
    const l1 = makeLayer('l1', 1, 1);
    l1.shiftX = 0;
    l1.shiftY = 0.5;
    // L1 cells [0..4] in Y cover L0 [1,11); X cells [0..4] cover L0 [0,10)
    for (let cy = 0; cy <= 4; cy++) {
      for (let cx = 0; cx <= 4; cx++) {
        applyCellEdit(l1, cx, cy, {
          type: 'color', r: 50, g: 50, b: 50, transform: DEFAULT_TRANSFORM,
        });
      }
    }

    const bounds = computeContentBounds([l0, l1]);
    expect(bounds).not.toBeNull();
    expect(bounds!.minL0X).toBe(0);
    expect(bounds!.minL0Y).toBe(0);
    expect(bounds!.maxL0X).toBe(11); // L0 layer determines X extent
    expect(bounds!.maxL0Y).toBe(11); // L0 layer determines Y extent
  });
});

describe('Cutout — shrinkwrap trims empty partial-cell edges (regression)', () => {
  test('content fills [0,8] L0; clip box is 10×10 with empty partials at 8-9 → shrinkwrap trims to 8×8', () => {
    // Simulate the post-cutout scenario described in the bug:
    // the user has content only in complete cells, partial-cell columns
    // at the right edge are empty, and the current clip box still
    // covers the partials. computeContentBounds should report tight
    // bounds, and the cutout setClipBox flow should shrink to them.
    const layer = makeLayer('a', 0, 0);
    for (let cy = 0; cy < 8; cy++) {
      for (let cx = 0; cx < 8; cx++) {
        applyCellEdit(layer, cx, cy, {
          type: 'color', r: 100, g: 100, b: 100, transform: DEFAULT_TRANSFORM,
        });
      }
    }
    // Cells at L0 [8,10) on both axes are null (empty partials).
    const currentClip: ClipBox = { clipL0X: 0, clipL0Y: 0, clipL0W: 10, clipL0H: 10 };
    const stateAfter = makeState([layer], {
      fileConfig: { id: 'test-file', name: 'Test', clipBox: currentClip },
    });

    const bounds = computeContentBounds(stateAfter.layers);
    expect(bounds).not.toBeNull();
    // Tight L0 bounds: content lives in [0,8) on both axes.
    expect(bounds!.minL0X).toBe(0);
    expect(bounds!.minL0Y).toBe(0);
    expect(bounds!.maxL0X).toBe(8);
    expect(bounds!.maxL0Y).toBe(8);

    // Drive the setClipBox op the cutout would push and verify the
    // resulting clip box reflects the tight bounds.
    const newClip: ClipBox = {
      clipL0X: bounds!.minL0X, clipL0Y: bounds!.minL0Y,
      clipL0W: bounds!.maxL0X - bounds!.minL0X,
      clipL0H: bounds!.maxL0Y - bounds!.minL0Y,
    };
    const ops: UndoOp[] = [{ op: 'setClipBox', oldClipBox: currentClip, newClipBox: newClip }];
    const after = applyOps(stateAfter, ops);
    expect(after.fileConfig.clipBox).toEqual({ clipL0X: 0, clipL0Y: 0, clipL0W: 8, clipL0H: 8 });

    // Undo restores the 10×10 box.
    const reverted = revertOps(after, ops);
    expect(reverted.fileConfig.clipBox).toEqual(currentClip);
  });

  test('content already tight against clip box → bounds equal current clip, no shrink needed', () => {
    const layer = makeLayer('a', 0, 0);
    for (let cy = 0; cy < 8; cy++) {
      for (let cx = 0; cx < 8; cx++) {
        applyCellEdit(layer, cx, cy, {
          type: 'color', r: 100, g: 100, b: 100, transform: DEFAULT_TRANSFORM,
        });
      }
    }
    const tightClip: ClipBox = { clipL0X: 0, clipL0Y: 0, clipL0W: 8, clipL0H: 8 };
    const state = makeState([layer], {
      fileConfig: { id: 'test-file', name: 'Test', clipBox: tightClip },
    });

    const bounds = computeContentBounds(state.layers);
    expect(bounds).not.toBeNull();
    // Match — caller's clipChanged check should be false, no undo entry pushed.
    expect(bounds!.maxL0X - bounds!.minL0X).toBe(tightClip.clipL0W);
    expect(bounds!.maxL0Y - bounds!.minL0Y).toBe(tightClip.clipL0H);
    expect(bounds!.minL0X).toBe(tightClip.clipL0X);
    expect(bounds!.minL0Y).toBe(tightClip.clipL0Y);
  });
});

describe('Cutout — clip box undo (regression)', () => {
  test('cutout undo restores both cells and clipBox', () => {
    const layer = makeLayer('a', 0, 0);
    fillLayer(layer);
    const origCellCount = countCells(layer);
    const oldClipBox = null; // file starts with no clip box

    // Erase everything except (0,0)-(1,1)
    const eraseOps: UndoOp[] = [];
    const lCount = CELL_COUNTS[layer.level];
    for (let cy = 0; cy < lCount; cy++) {
      for (let cx = 0; cx < lCount; cx++) {
        if (cx < 2 && cy < 2) continue;
        const old = layer.cells[cy]?.[cx] ?? null;
        if (old !== null) {
          applyCellEdit(layer, cx, cy, null);
          eraseOps.push({ op: 'cell', layerId: layer.id, cellX: cx, cellY: cy, oldState: old, newState: null });
        }
      }
    }

    // Cutout shrinkwraps the clip box to the tight content bounds
    const newClip: ClipBox = { clipL0X: 0, clipL0Y: 0, clipL0W: 2, clipL0H: 2 };
    const allOps: UndoOp[] = [
      ...eraseOps,
      { op: 'setClipBox', oldClipBox, newClipBox: newClip },
    ];

    const stateAfter = makeState([layer], {
      fileConfig: { id: 'test-file', name: 'Test', clipBox: newClip },
    });

    // Undo: cells restored AND clip box cleared back to undefined
    const reverted = revertOps(stateAfter, allOps);
    expect(reverted.fileConfig.clipBox).toBeUndefined();
    const revertedLayer = reverted.layers.find(l => l.id === 'a')!;
    expect(countCells(revertedLayer)).toBe(origCellCount);

    // Redo: clip box re-shrunk AND cells re-erased
    const redone = applyOps(reverted, allOps);
    expect(redone.fileConfig.clipBox).toEqual(newClip);
    const redoneLayer = redone.layers.find(l => l.id === 'a')!;
    expect(countCells(redoneLayer)).toBe(4); // only the 2×2 region remains
  });

});

describe('Cutout — mirror reconcile', () => {
  test('reconcile with mirrorH symmetrically back-fills asymmetric erasures', () => {
    // 2026-05 strict-symmetric reconcile: an asymmetric erasure with a
    // mirror flag on is no longer a fixed point — reconcile clones the
    // surviving half across the mirror axis. (The cutout tool path
    // itself passes mirror flags off, so this behaviour does not
    // affect the cutout-erase flow — see EditorScreen.tsx:1757.) This
    // test pins the general reconcile-with-mirror contract instead.
    const layer = makeLayer('a', 0, 0);
    fillLayer(layer);
    const count = CELL_COUNTS[layer.level];

    // Erase a symmetric pair of columns: cx=0 and cx=count-1. Their
    // orbits stay empty after reconcile.
    for (let cy = 0; cy < count; cy++) {
      applyCellEdit(layer, 0, cy, null);
      applyCellEdit(layer, count - 1, cy, null);
    }

    // Erase an asymmetric block at cx=2, rows 0-3. The mirror partners
    // at cx=count-3 still hold content, so reconcile will clone them
    // back into the erased region.
    for (let cy = 0; cy < 4; cy++) {
      applyCellEdit(layer, 2, cy, null);
    }

    const placementOrder = new Map<number, number>([[0, 0]]);
    reconcileCanvas([layer], [layer], true, placementOrder, undefined, true, false, false);

    // Symmetrically-erased pair stays empty.
    for (let cy = 0; cy < count; cy++) {
      expect(layer.cells[cy]![0]).toBeNull();
      expect(layer.cells[cy]![count - 1]).toBeNull();
    }

    // Asymmetric erasure at cx=2 was back-filled by the mirror clone
    // from cx=count-3.
    for (let cy = 0; cy < 4; cy++) {
      expect(layer.cells[cy]![2]).not.toBeNull();
    }
  });
});
