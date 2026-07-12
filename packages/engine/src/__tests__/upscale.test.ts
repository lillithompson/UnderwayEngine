import { upscaleLayers, applyOps, revertOps, snapshotLayer } from '../cells';
import { CELL_COUNTS, CellState, DEFAULT_TRANSFORM, UndoOp } from '../types';
import { makeLayer, makeState } from './test-utils';

const RED: CellState = { type: 'color', r: 255, g: 0, b: 0, transform: DEFAULT_TRANSFORM };
const GREEN: CellState = { type: 'color', r: 0, g: 255, b: 0, transform: DEFAULT_TRANSFORM };
const BLUE: CellState = { type: 'color', r: 0, g: 0, b: 255, transform: DEFAULT_TRANSFORM };

describe('upscaleLayers', () => {
  test('promotes a single L1 layer to L2 preserving cell indices and doubles dims', () => {
    // 8x8 L0 file. L1 editable cells = 4x4.
    const layer = makeLayer('a', 1, 0);
    layer.cells[0][0] = RED;
    layer.cells[2][3] = GREEN;

    const result = upscaleLayers([layer], 8, 8);
    expect(result).toEqual({ widthL0: 16, heightL0: 16, removedLayerIds: [] });
    expect(layer.level).toBe(2);
    expect(layer.cells[0][0]).toEqual(RED);
    expect(layer.cells[2][3]).toEqual(GREEN);
    // New L2 cells array is 8x8
    expect(layer.cells.length).toBe(CELL_COUNTS[2]);
    expect(layer.cells[0].length).toBe(CELL_COUNTS[2]);
  });

  test('promotes multiple layers in one pass preserving order', () => {
    // 16x16 L0 file. L0=16, L1=8, L2=4, L3=2 editable.
    const l0 = makeLayer('fine', 0, 0);
    const l1 = makeLayer('med', 1, 1);
    const l2 = makeLayer('coarse', 2, 2);
    const l3 = makeLayer('coarser', 3, 3);

    l0.cells[7][7] = RED;
    l1.cells[3][3] = GREEN;
    l2.cells[1][1] = BLUE;
    l3.cells[0][0] = RED;

    const result = upscaleLayers([l0, l1, l2, l3], 16, 16);
    expect(result.widthL0).toBe(32);
    expect(result.heightL0).toBe(32);
    expect(result.removedLayerIds).toEqual([]);

    expect(l0.level).toBe(1);
    expect(l1.level).toBe(2);
    expect(l2.level).toBe(3);
    expect(l3.level).toBe(4);

    expect(l0.cells[7][7]).toEqual(RED);
    expect(l1.cells[3][3]).toEqual(GREEN);
    expect(l2.cells[1][1]).toEqual(BLUE);
    expect(l3.cells[0][0]).toEqual(RED);
  });

  test('renames each surviving layer to the new level label with (Upscaled)', () => {
    // 16x16 L0 file so L0..L3 all upscale without removal.
    const l0 = makeLayer('l0', 0, 0);
    const l1 = makeLayer('l1', 1, 1);
    const l2 = makeLayer('l2', 2, 2);
    const l3 = makeLayer('l3', 3, 3);
    // Custom names should be overwritten by the upscale rename.
    l0.name = 'Background';
    l1.name = 'Level 1: Fine';
    l2.name = 'Level 2: Medium';
    l3.name = 'Level 3: Coarse';

    upscaleLayers([l0, l1, l2, l3], 16, 16);

    expect(l0.name).toBe('Fine (Upscaled)');
    expect(l1.name).toBe('Medium (Upscaled)');
    expect(l2.name).toBe('Coarse (Upscaled)');
    expect(l3.name).toBe('Huge (Upscaled)');
  });

  test('removes L4 layers and keeps ids in removedLayerIds', () => {
    const alive = makeLayer('alive', 2, 0);
    const doomed = makeLayer('doomed', 4, 1);
    alive.cells[0][0] = RED;
    doomed.cells[0][0] = GREEN;

    const layers = [alive, doomed];
    const result = upscaleLayers(layers, 8, 8);
    expect(layers).toHaveLength(1);
    expect(layers[0].id).toBe('alive');
    expect(layers[0].level).toBe(3);
    expect(result.removedLayerIds).toEqual(['doomed']);
  });

  test('preserves shiftX / shiftY and edge cell data', () => {
    const layer = makeLayer('s', 1, 0);
    layer.shiftX = 0.5;
    layer.shiftY = 0.5;
    const count = CELL_COUNTS[1];
    layer.edgeRowTop = new Array(count).fill(null);
    layer.edgeColLeft = new Array(count).fill(null);
    layer.edgeCorner = RED;
    layer.edgeRowTop[2] = GREEN;
    layer.edgeColLeft[3] = BLUE;

    upscaleLayers([layer], 8, 8);

    expect(layer.level).toBe(2);
    expect(layer.shiftX).toBe(0.5);
    expect(layer.shiftY).toBe(0.5);
    expect(layer.edgeRowTop).not.toBeNull();
    expect(layer.edgeColLeft).not.toBeNull();
    expect(layer.edgeRowTop!.length).toBe(CELL_COUNTS[2]);
    expect(layer.edgeColLeft!.length).toBe(CELL_COUNTS[2]);
    expect(layer.edgeRowTop![2]).toEqual(GREEN);
    expect(layer.edgeColLeft![3]).toEqual(BLUE);
    expect(layer.edgeCorner).toEqual(RED);
  });

  test('drops cells that were out of bounds before upscale', () => {
    // 8x8 L0 file → L1 editable region is 4x4 (cells[0..3][0..3]).
    // Plant data at cells[5][5] (out of bounds pre-upscale). It must NOT appear
    // in the upscaled layer, since only in-bounds data should migrate.
    const layer = makeLayer('x', 1, 0);
    layer.cells[1][1] = RED;          // in-bounds
    layer.cells[5][5] = GREEN;        // out of bounds — should be dropped

    upscaleLayers([layer], 8, 8);

    expect(layer.level).toBe(2);
    expect(layer.cells[1][1]).toEqual(RED);
    // At L2 cells[5][5] is still a valid index (L2 count = 8), but nothing
    // should have been copied there since the source cell was out of bounds.
    expect(layer.cells[5][5]).toBeNull();
  });

  test('handles non-square files', () => {
    // 16x8 L0 file → L1 editable = 8 wide × 4 tall.
    const layer = makeLayer('rect', 1, 0);
    layer.cells[0][7] = RED;   // right edge in-bounds
    layer.cells[3][0] = GREEN; // bottom edge in-bounds
    layer.cells[3][7] = BLUE;  // corner in-bounds

    const result = upscaleLayers([layer], 16, 8);
    expect(result).toEqual({ widthL0: 32, heightL0: 16, removedLayerIds: [] });
    expect(layer.level).toBe(2);
    expect(layer.cells[0][7]).toEqual(RED);
    expect(layer.cells[3][0]).toEqual(GREEN);
    expect(layer.cells[3][7]).toEqual(BLUE);
  });

  test('undo restores pre-upscale state, including a removed L4 layer', () => {
    const alive = makeLayer('alive', 2, 0);
    const doomed = makeLayer('doomed', 4, 1);
    alive.cells[1][1] = RED;
    doomed.cells[0][0] = GREEN;

    const layersBefore = [alive, doomed];
    const oldW = 8, oldH = 8;
    const layerSnapshotsBefore = layersBefore.map(snapshotLayer);
    const activeLayerIdBefore = 'alive';

    // Apply in-place and dispatch-equivalent state change
    const result = upscaleLayers(layersBefore, oldW, oldH);
    expect(result.removedLayerIds).toEqual(['doomed']);
    expect(layersBefore).toHaveLength(1);

    const undoOp: UndoOp = {
      op: 'upscale',
      oldWidthL0: oldW,
      oldHeightL0: oldH,
      newWidthL0: result.widthL0,
      newHeightL0: result.heightL0,
      oldOriginL0X: 0, oldOriginL0Y: 0,
      newOriginL0X: 0, newOriginL0Y: 0,
      oldClipBox: null, newClipBox: null,
      shiftL0X: 0, shiftL0Y: 0,
      layerSnapshotsBefore,
      activeLayerIdBefore,
    };

    const upscaledState = makeState(layersBefore, {
      activeLayerId: 'alive',
      fileConfig: { id: 't', name: 'T', widthL0: result.widthL0, heightL0: result.heightL0 },
    });
    const reverted = revertOps(upscaledState, [undoOp]);
    expect(reverted.fileConfig.widthL0).toBe(oldW);
    expect(reverted.fileConfig.heightL0).toBe(oldH);
    expect(reverted.layers).toHaveLength(2);
    const rAlive = reverted.layers.find(l => l.id === 'alive')!;
    const rDoomed = reverted.layers.find(l => l.id === 'doomed')!;
    expect(rAlive.level).toBe(2);
    expect(rAlive.cells[1][1]).toEqual(RED);
    expect(rDoomed.level).toBe(4);
    expect(rDoomed.cells[0][0]).toEqual(GREEN);
    expect(reverted.activeLayerId).toBe('alive');
  });

  test('apply (redo) reproduces the upscale given pre-upscale state', () => {
    const layer = makeLayer('a', 1, 0);
    layer.cells[2][3] = GREEN;
    const oldW = 8, oldH = 8;
    const layerSnapshotsBefore = [snapshotLayer(layer)];

    const result = upscaleLayers([layer], oldW, oldH);
    const undoOp: UndoOp = {
      op: 'upscale',
      oldWidthL0: oldW,
      oldHeightL0: oldH,
      newWidthL0: result.widthL0,
      newHeightL0: result.heightL0,
      oldOriginL0X: 0, oldOriginL0Y: 0,
      newOriginL0X: 0, newOriginL0Y: 0,
      oldClipBox: null, newClipBox: null,
      shiftL0X: 0, shiftL0Y: 0,
      layerSnapshotsBefore,
      activeLayerIdBefore: 'a',
    };

    // Revert to go back, then re-apply
    const upscaledState = makeState([layer], {
      activeLayerId: 'a',
      fileConfig: { id: 't', name: 'T', widthL0: result.widthL0, heightL0: result.heightL0 },
    });
    const reverted = revertOps(upscaledState, [undoOp]);
    const redone = applyOps(reverted, [undoOp]);

    expect(redone.fileConfig.widthL0).toBe(result.widthL0);
    expect(redone.fileConfig.heightL0).toBe(result.heightL0);
    const rLayer = redone.layers.find(l => l.id === 'a')!;
    expect(rLayer.level).toBe(2);
    expect(rLayer.cells[2][3]).toEqual(GREEN);
  });

  test('active layer falls back to first remaining layer when it was an L4', () => {
    const keep = makeLayer('keep', 2, 0);
    const removed = makeLayer('removed', 4, 1);
    removed.cells[0][0] = RED;

    const layers = [keep, removed];
    const snapshots = layers.map(snapshotLayer);
    const result = upscaleLayers(layers, 8, 8);

    const undoOp: UndoOp = {
      op: 'upscale',
      oldWidthL0: 8,
      oldHeightL0: 8,
      newWidthL0: result.widthL0,
      newHeightL0: result.heightL0,
      oldOriginL0X: 0, oldOriginL0Y: 0,
      newOriginL0X: 0, newOriginL0Y: 0,
      oldClipBox: null, newClipBox: null,
      shiftL0X: 0, shiftL0Y: 0,
      layerSnapshotsBefore: snapshots,
      activeLayerIdBefore: 'removed',
    };

    const before = makeState([makeLayer('keep', 2, 0), makeLayer('removed', 4, 1)], {
      activeLayerId: 'removed',
      fileConfig: { id: 't', name: 'T', widthL0: 8, heightL0: 8 },
    });
    const applied = applyOps(before, [undoOp]);
    expect(applied.layers.map(l => l.id)).toEqual(['keep']);
    expect(applied.activeLayerId).toBe('keep');
  });

  // Apply (redo) replays the explicit shift recorded in the op before
  // upscaling — used when the doubled clip box would overflow the file
  // boundary and content has to slide toward the origin.
  test('apply replays the recorded shift before upscaling', () => {
    const layer = makeLayer('a', 1, 0); // L1 count = 16
    layer.cells[7][7] = RED;
    layer.cells[8][8] = GREEN;

    const layerSnapshotsBefore = [snapshotLayer(layer)];

    const undoOp: UndoOp = {
      op: 'upscale',
      oldWidthL0: 32, oldHeightL0: 32,
      newWidthL0: 32, newHeightL0: 32,
      oldOriginL0X: 0, oldOriginL0Y: 0,
      newOriginL0X: 0, newOriginL0Y: 0,
      oldClipBox: null, newClipBox: null,
      shiftL0X: 14, shiftL0Y: 14,
      layerSnapshotsBefore,
      activeLayerIdBefore: 'a',
    };

    const state = makeState([layer], {
      activeLayerId: 'a',
      fileConfig: { id: 't', name: 'T', widthL0: 32, heightL0: 32 },
    });
    const applied = applyOps(state, [undoOp]);
    // After pre-shift by (-14, -14): RED moved from cell (7,7) to (0,0) at L1;
    // then upscaled to L2 at the same cell indices. GREEN similarly from (8,8)
    // to (1,1).
    const up = applied.layers[0];
    expect(up.level).toBe(2);
    expect(up.cells[0][0]).toEqual(RED);
    expect(up.cells[1][1]).toEqual(GREEN);
  });

  test('apply round-trips the new clip box when set', () => {
    const layer = makeLayer('a', 1, 0);
    layer.cells[2][3] = GREEN;
    const layerSnapshotsBefore = [snapshotLayer(layer)];

    const oldClip = { clipL0X: 4, clipL0Y: 4, clipL0W: 8, clipL0H: 8 };
    const newClip = { clipL0X: 8, clipL0Y: 8, clipL0W: 16, clipL0H: 16 };

    const undoOp: UndoOp = {
      op: 'upscale',
      oldWidthL0: 32, oldHeightL0: 32,
      newWidthL0: 32, newHeightL0: 32,
      oldOriginL0X: 0, oldOriginL0Y: 0,
      newOriginL0X: 0, newOriginL0Y: 0,
      oldClipBox: oldClip, newClipBox: newClip,
      shiftL0X: 0, shiftL0Y: 0,
      layerSnapshotsBefore,
      activeLayerIdBefore: 'a',
    };

    const state = makeState([layer], {
      activeLayerId: 'a',
      fileConfig: { id: 't', name: 'T', widthL0: 32, heightL0: 32, clipBox: oldClip },
    });
    // Apply sets the new clip; revert restores the old.
    const applied = applyOps(state, [undoOp]);
    expect(applied.fileConfig.clipBox).toEqual(newClip);
    const reverted = revertOps(applied, [undoOp]);
    expect(reverted.fileConfig.clipBox).toEqual(oldClip);
  });

  // Regression: a 2×2 L2 file lives off-origin (clip at L0 (12,12) size 8×8).
  // The doubled clip wants to go to L0 (24,24) size 16×16 — overflows. The new
  // clip clamps back to (16,16,16,16); content must shift in old-L0 so it lands
  // inside that clip after promotion to L3 (cell size 8 L0 each).
  test('shifts a 2×2 L2 design so it lands inside the clamped doubled clip', () => {
    // Content at L2 cells (3,3)..(4,4) = L0 (12..20) — matches a clip at (12,12,8,8).
    const layer = makeLayer('a', 2, 0); // L2 count = 8
    layer.cells[3][3] = RED;
    layer.cells[3][4] = GREEN;
    layer.cells[4][3] = BLUE;
    layer.cells[4][4] = RED;
    const layerSnapshotsBefore = [snapshotLayer(layer)];

    const oldClip = { clipL0X: 12, clipL0Y: 12, clipL0W: 8, clipL0H: 8 };
    // Doubled would be (24,24,16,16); clamp to fit → (16,16,16,16). New-L0
    // shift = 24 − 16 = 8; old-L0 shift = 4 (one L2 cell). After upscale to L3,
    // the four cells should land at L3 (2,2)..(3,3).
    const newClip = { clipL0X: 16, clipL0Y: 16, clipL0W: 16, clipL0H: 16 };

    const undoOp: UndoOp = {
      op: 'upscale',
      oldWidthL0: 32, oldHeightL0: 32,
      newWidthL0: 32, newHeightL0: 32,
      oldOriginL0X: 0, oldOriginL0Y: 0,
      newOriginL0X: 0, newOriginL0Y: 0,
      oldClipBox: oldClip, newClipBox: newClip,
      shiftL0X: 4, shiftL0Y: 4,
      layerSnapshotsBefore,
      activeLayerIdBefore: 'a',
    };

    const state = makeState([layer], {
      activeLayerId: 'a',
      fileConfig: { id: 't', name: 'T', widthL0: 32, heightL0: 32, clipBox: oldClip },
    });
    const applied = applyOps(state, [undoOp]);
    const up = applied.layers[0];
    expect(up.level).toBe(3);
    // L3 cell (i,j) covers L0 (i*8, j*8) — cells (2,2)..(3,3) cover L0 (16..32),
    // exactly matching the new clip.
    expect(up.cells[2][2]).toEqual(RED);
    expect(up.cells[2][3]).toEqual(GREEN);
    expect(up.cells[3][2]).toEqual(BLUE);
    expect(up.cells[3][3]).toEqual(RED);
    expect(applied.fileConfig.clipBox).toEqual(newClip);
  });

  test('revert clears clipBox when oldClipBox was null', () => {
    const layer = makeLayer('a', 1, 0);
    const layerSnapshotsBefore = [snapshotLayer(layer)];
    const newClip = { clipL0X: 0, clipL0Y: 0, clipL0W: 32, clipL0H: 32 };

    const undoOp: UndoOp = {
      op: 'upscale',
      oldWidthL0: 32, oldHeightL0: 32,
      newWidthL0: 32, newHeightL0: 32,
      oldOriginL0X: 0, oldOriginL0Y: 0,
      newOriginL0X: 0, newOriginL0Y: 0,
      oldClipBox: null, newClipBox: newClip,
      shiftL0X: 0, shiftL0Y: 0,
      layerSnapshotsBefore,
      activeLayerIdBefore: 'a',
    };

    const upscaled = makeState([layer], {
      activeLayerId: 'a',
      fileConfig: { id: 't', name: 'T', widthL0: 32, heightL0: 32, clipBox: newClip },
    });
    const reverted = revertOps(upscaled, [undoOp]);
    expect(reverted.fileConfig.clipBox).toBeUndefined();
  });
});
