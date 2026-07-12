import { snapDimension, computeResizeFromDrag, fileUVToScreen, screenToFileUV } from '../canvasResize';
import { shiftLayerCells, clearOutOfBoundsCells, applyOps, revertOps, setCell, createEdgeStorage } from '../cells';
import { editorReducer } from '../state';
import { CELL_COUNTS, CellState, DEFAULT_TRANSFORM, GridLevel, Layer, UndoOp, makeViewport } from '../types';
import { makeLayer, makeState } from './test-utils';

const COLOR: CellState = { type: 'color', r: 255, g: 0, b: 0, transform: DEFAULT_TRANSFORM };
const RED: CellState = { type: 'color', r: 255, g: 0, b: 0, transform: DEFAULT_TRANSFORM };
const GREEN: CellState = { type: 'color', r: 0, g: 255, b: 0, transform: DEFAULT_TRANSFORM };
const BLUE: CellState = { type: 'color', r: 0, g: 0, b: 255, transform: DEFAULT_TRANSFORM };
const YELLOW: CellState = { type: 'color', r: 255, g: 255, b: 0, transform: DEFAULT_TRANSFORM };

function cellToL0(layer: Layer, cellX: number, cellY: number): { l0x: number; l0y: number } {
  const cellSizeL0 = 32 / CELL_COUNTS[layer.level];
  return {
    l0x: (cellX + layer.shiftX) * cellSizeL0,
    l0y: (cellY + layer.shiftY) * cellSizeL0,
  };
}

function collectAllOccupiedCells(layer: Layer): Array<{
  cellX: number; cellY: number; l0x: number; l0y: number; state: CellState;
}> {
  const results: Array<{ cellX: number; cellY: number; l0x: number; l0y: number; state: CellState }> = [];
  const count = CELL_COUNTS[layer.level];

  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      const state = layer.cells[y]?.[x];
      if (state != null) {
        const { l0x, l0y } = cellToL0(layer, x, y);
        results.push({ cellX: x, cellY: y, l0x, l0y, state });
      }
    }
  }

  if (layer.edgeColLeft) {
    for (let y = 0; y < count; y++) {
      const state = layer.edgeColLeft[y];
      if (state != null) {
        const { l0x, l0y } = cellToL0(layer, -1, y);
        results.push({ cellX: -1, cellY: y, l0x, l0y, state });
      }
    }
  }

  if (layer.edgeRowTop) {
    for (let x = 0; x < count; x++) {
      const state = layer.edgeRowTop[x];
      if (state != null) {
        const { l0x, l0y } = cellToL0(layer, x, -1);
        results.push({ cellX: x, cellY: -1, l0x, l0y, state });
      }
    }
  }

  if (layer.edgeCorner != null) {
    const { l0x, l0y } = cellToL0(layer, -1, -1);
    results.push({ cellX: -1, cellY: -1, l0x, l0y, state: layer.edgeCorner });
  }

  return results;
}

function makeShiftedLayer(
  id: string, level: GridLevel, order: number, shiftX: 0 | 0.5, shiftY: 0 | 0.5,
): Layer {
  const layer = makeLayer(id, level, order);
  layer.shiftX = shiftX;
  layer.shiftY = shiftY;
  const edges = createEdgeStorage(level, shiftX, shiftY);
  layer.edgeRowTop = edges.edgeRowTop;
  layer.edgeColLeft = edges.edgeColLeft;
  layer.edgeCorner = edges.edgeCorner;
  return layer;
}

// ── snapDimension ──────────────────────────────────────────────────

describe('snapDimension', () => {
  test('snaps to grid size 1 (L0)', () => {
    expect(snapDimension(15.3, 1)).toBe(15);
    expect(snapDimension(15.6, 1)).toBe(16);
  });

  test('snaps to grid size 2 (L1)', () => {
    expect(snapDimension(9, 2)).toBe(10);
    expect(snapDimension(11, 2)).toBe(12);
  });

  test('snaps to grid size 4 (L2)', () => {
    expect(snapDimension(14, 4)).toBe(16);
    expect(snapDimension(5, 4)).toBe(4);
  });

  test('clamps to minimum 4', () => {
    expect(snapDimension(1, 1)).toBe(4);
    expect(snapDimension(2, 2)).toBe(4);
    expect(snapDimension(0, 4)).toBe(4);
  });

  test('clamps to maximum 32', () => {
    expect(snapDimension(40, 1)).toBe(32);
    expect(snapDimension(36, 2)).toBe(32);
    expect(snapDimension(100, 4)).toBe(32);
  });
});

// ── computeResizeFromDrag ──────────────────────────────────────────

describe('computeResizeFromDrag', () => {
  // Delta is in LAYER UV where 1.0 spans the full 32-L0 layer axis
  // (same space as screenToFileUV output).

  test('BR corner: grow right and down (origin unchanged)', () => {
    // delta 0.25 UV = 8 L0 → width 16+8=24
    const result = computeResizeFromDrag('br', 16, 16, 0, 0, 0.25, 0.25, 1);
    expect(result.newWidthL0).toBe(24);
    expect(result.newHeightL0).toBe(24);
    expect(result.newOriginL0X).toBe(0);
    expect(result.newOriginL0Y).toBe(0);
  });

  test('BR corner: shrink', () => {
    // delta -0.125 UV = -4 L0 → 16-4=12
    const result = computeResizeFromDrag('br', 16, 16, 0, 0, -0.125, -0.125, 1);
    expect(result.newWidthL0).toBe(12);
    expect(result.newHeightL0).toBe(12);
    expect(result.newOriginL0X).toBe(0);
    expect(result.newOriginL0Y).toBe(0);
  });

  test('TL corner: drag from origin>0 expands window (origin recedes)', () => {
    // Canvas 16×16 at origin (8, 8) — centered in 32-L0 layer space.
    // Drag TL up-and-left by 4 L0 (delta = 4/32 = 0.125 in layer UV).
    const result = computeResizeFromDrag('tl', 16, 16, 8, 8, -0.125, -0.125, 1);
    expect(result.newOriginL0X).toBe(4);
    expect(result.newOriginL0Y).toBe(4);
    expect(result.newWidthL0).toBe(20);
    expect(result.newHeightL0).toBe(20);
  });

  test('TL corner: shrink (origin advances)', () => {
    // delta +0.125 = +4 L0 → origin 0→4, width 16→12.
    const result = computeResizeFromDrag('tl', 16, 16, 0, 0, 0.125, 0.125, 1);
    expect(result.newOriginL0X).toBe(4);
    expect(result.newOriginL0Y).toBe(4);
    expect(result.newWidthL0).toBe(12);
    expect(result.newHeightL0).toBe(12);
  });

  test('TR corner: grow right, shrink top edge', () => {
    const result = computeResizeFromDrag('tr', 16, 16, 0, 8, 0.125, -0.125, 1);
    expect(result.newWidthL0).toBe(20);
    expect(result.newOriginL0X).toBe(0);
    expect(result.newHeightL0).toBe(20);
    expect(result.newOriginL0Y).toBe(4);
  });

  test('BL corner: grow left and down', () => {
    const result = computeResizeFromDrag('bl', 16, 16, 8, 0, -0.125, 0.125, 1);
    expect(result.newOriginL0X).toBe(4);
    expect(result.newWidthL0).toBe(20);
    expect(result.newOriginL0Y).toBe(0);
    expect(result.newHeightL0).toBe(20);
  });

  test('respects snap size', () => {
    // snap=4 (L2 grid). delta 0.25 UV = 8 L0 → snaps to 8 (multiple of 4)
    const result = computeResizeFromDrag('br', 16, 16, 0, 0, 0.25, 0.25, 4);
    expect(result.newWidthL0).toBe(24);
    expect(result.newHeightL0).toBe(24);
  });

  test('clamps TL expansion to origin=0 (hard stop at layer boundary)', () => {
    // Canvas 16×16 at origin (0, 0). Dragging TL up-and-left wants to expand
    // but origin is already at 0 — canvas can't cross the layer boundary.
    const result = computeResizeFromDrag('tl', 16, 16, 0, 0, -0.25, -0.25, 1);
    expect(result.newOriginL0X).toBe(0);
    expect(result.newOriginL0Y).toBe(0);
    expect(result.newWidthL0).toBe(16);
    expect(result.newHeightL0).toBe(16);
  });

  test('clamps BR expansion to layer-space boundary (origin + dim ≤ 32)', () => {
    // Canvas 16×16 at origin 0. Dragging BR all the way right stops at 32.
    const result = computeResizeFromDrag('br', 16, 16, 0, 0, 1, 1, 1);
    expect(result.newWidthL0).toBe(32);
    expect(result.newHeightL0).toBe(32);
    expect(result.newOriginL0X).toBe(0);
  });

  test('clamps to MIN_L0 on shrink', () => {
    const result = computeResizeFromDrag('br', 8, 8, 0, 0, -1, -1, 1);
    expect(result.newWidthL0).toBe(4);
    expect(result.newHeightL0).toBe(4);
  });
});

// ── fileUVToScreen / screenToFileUV round-trip ─────────────────────

describe('fileUVToScreen / screenToFileUV', () => {
  const viewport = makeViewport(800, 600);
  const camera = { offsetX: 0, offsetY: 0, zoom: 1 };

  test('round-trips through screen coords', () => {
    const u = 0.3, v = 0.4;
    const screen = fileUVToScreen(u, v, viewport, camera, 32, 32);
    const uv = screenToFileUV(screen.x, screen.y, viewport, camera, 32, 32);
    expect(uv.u).toBeCloseTo(u, 5);
    expect(uv.v).toBeCloseTo(v, 5);
  });

  test('canvas corners map correctly for square viewport', () => {
    const sqViewport = makeViewport(600, 600);
    const tl = fileUVToScreen(0, 0, sqViewport, camera, 32, 32);
    const br = fileUVToScreen(1, 1, sqViewport, camera, 32, 32);
    // Square viewport with square 32x32 canvas: fills exactly
    expect(tl.x).toBeCloseTo(0, 1);
    expect(tl.y).toBeCloseTo(0, 1);
    expect(br.x).toBeCloseTo(600, 1);
    expect(br.y).toBeCloseTo(600, 1);
  });

  test('matches screenToCell UV transform from input.ts', () => {
    // Verify our screen→UV matches the known-correct formula from input.ts
    const vw = viewport.width;
    const vh = viewport.height;
    const { baseZoom, baseOffsetU, baseOffsetV } = require('../state').computeBaseCamera(32, 32, vw, vh);
    const effectiveZoom = baseZoom * camera.zoom;
    const effectiveOffsetU = camera.offsetX / vw + baseOffsetU;
    const effectiveOffsetV = camera.offsetY / vw + baseOffsetV;

    const sx = 400, sy = 300;
    // Formula from input.ts:
    const expectedU = (sx / vw - 0.5) / effectiveZoom - effectiveOffsetU + 0.5;
    const expectedV = ((sy / vh - 0.5) * vh / vw) / effectiveZoom - effectiveOffsetV + 0.5;

    const result = screenToFileUV(sx, sy, viewport, camera, 32, 32);
    expect(result.u).toBeCloseTo(expectedU, 10);
    expect(result.v).toBeCloseTo(expectedV, 10);
  });

  test('works with non-square canvas', () => {
    const u = 0.5, v = 0.25;
    const screen = fileUVToScreen(u, v, viewport, camera, 16, 16);
    const uv = screenToFileUV(screen.x, screen.y, viewport, camera, 16, 16);
    expect(uv.u).toBeCloseTo(u, 5);
    expect(uv.v).toBeCloseTo(v, 5);
  });

  // Identity camera must map file UV (0.5, 0.5) to the visual viewport center for
  // default-size (32x32) files with no overlay insets.
  test('identity camera centers file in viewport across aspects', () => {
    const identity = { offsetX: 0, offsetY: 0, zoom: 1 };
    // Files at full 32x32 (the default figure size) must center in every aspect. Files
    // smaller than 32 anchor to the top-left of the normalized 32x32 region by design,
    // so their UV(0.5,0.5) is not the visual center — that case is covered elsewhere.
    const cases: Array<{ w: number; h: number }> = [
      { w: 800, h: 600 }, // landscape
      { w: 600, h: 800 }, // portrait
      { w: 1000, h: 1000 }, // square
      { w: 400, h: 300 }, // smaller landscape
    ];
    const fw = 32, fh = 32;
    for (const { w, h } of cases) {
      const vp = makeViewport(w, h);
      const screen = fileUVToScreen(0.5, 0.5, vp, identity, fw, fh);
      expect(screen.x).toBeCloseTo(w / 2, 1);
      expect(screen.y).toBeCloseTo(h / 2, 1);
    }
  });

  // Regression: for a small file (e.g. 4x4) in a portrait viewport, baseZoom is
  // large (~8x) and the old formula multiplied the inset-driven UV offset by
  // baseZoom when the shader converted it to pixels — amplifying a 52px top
  // inset into a ~200px shift and pushing the canvas off the bottom of the
  // screen on iOS native. The pixel shift must be independent of file size.
  test('inset shift is file-size independent', () => {
    const identity = { offsetX: 0, offsetY: 0, zoom: 1 };
    const w = 820, h = 903;
    const inset = 52;

    const vpNoInset = makeViewport(w, h);
    const vpInset = { ...makeViewport(w, h), topInset: inset };

    for (const size of [4, 8, 16, 32]) {
      const centerNoInset = fileUVToScreen(size / 64, size / 64, vpNoInset, identity, size, size);
      const centerInset = fileUVToScreen(size / 64, size / 64, vpInset, identity, size, size);
      // Expected pixel shift: (top - bottom) / 2 = 26px, regardless of file size.
      const shiftY = centerInset.y - centerNoInset.y;
      expect(shiftY).toBeCloseTo(inset / 2, 1);
    }
  });
});

// ── shiftLayerCells ────────────────────────────────────────────────

describe('shiftLayerCells', () => {
  test('shifts L0 cells by positive offset', () => {
    const layer = makeLayer('l0', 0, 0);
    layer.cells[0][0] = COLOR;
    shiftLayerCells([layer], 4, 4);
    // L0: cellShift = 4 * 32/32 = 4
    expect(layer.cells[0][0]).toBeNull();
    expect(layer.cells[4][4]).toEqual(COLOR);
  });

  test('shifts L1 cells proportionally', () => {
    const layer = makeLayer('l1', 1, 0);
    layer.cells[0][0] = COLOR;
    shiftLayerCells([layer], 4, 4);
    // L1: cellShift = 4 * 16/32 = 2
    expect(layer.cells[0][0]).toBeNull();
    expect(layer.cells[2][2]).toEqual(COLOR);
  });

  test('no-op for zero shift', () => {
    const layer = makeLayer('l0', 0, 0);
    layer.cells[5][5] = COLOR;
    shiftLayerCells([layer], 0, 0);
    expect(layer.cells[5][5]).toEqual(COLOR);
  });
});

// ── resizeCanvas undo op ───────────────────────────────────────────

describe('resizeCanvas undo op', () => {
  test('apply: dimension-only resize (BR corner) leaves cells untouched', () => {
    const layer = makeLayer('l0', 0, 0);
    layer.cells[5][5] = COLOR;
    const state = makeState([layer], { fileConfig: { id: 'f', name: 'F', widthL0: 16, heightL0: 16 } });

    const ops: UndoOp[] = [{
      op: 'resizeCanvas',
      oldWidthL0: 16, oldHeightL0: 16,
      newWidthL0: 24, newHeightL0: 24,
      oldOriginL0X: 0, oldOriginL0Y: 0,
      newOriginL0X: 0, newOriginL0Y: 0,
    }];

    const result = applyOps(state, ops);
    expect(result.fileConfig.widthL0).toBe(24);
    expect(result.fileConfig.heightL0).toBe(24);
    expect(result.fileConfig.originL0X).toBe(0);
    expect(result.layers[0].cells[5][5]).toEqual(COLOR);
  });

  test('apply: TL-corner resize moves origin — layer data stays in layer space', () => {
    // Starting canvas is 16×16 at origin (0, 0). Dragging the TL corner up
    // and left expands to 24×24 with origin at (-8, -8) — but origin is
    // clamped to (0, 0), so the UI actually produces an effective resize
    // where TL corner moves but origin stays put. For the test purposes,
    // model a TL-corner shrink (origin advances, dim shrinks) which is
    // the common legal case.
    const layer = makeLayer('l0', 0, 0);
    layer.cells[2][2] = COLOR;
    layer.cells[10][10] = COLOR;
    const state = makeState([layer], { fileConfig: { id: 'f', name: 'F', widthL0: 16, heightL0: 16 } });

    // TL shrink: origin advances from (0,0) to (5,5), width/height go 16 → 11.
    const ops: UndoOp[] = [{
      op: 'resizeCanvas',
      oldWidthL0: 16, oldHeightL0: 16,
      newWidthL0: 11, newHeightL0: 11,
      oldOriginL0X: 0, oldOriginL0Y: 0,
      newOriginL0X: 5, newOriginL0Y: 5,
    }];

    const result = applyOps(state, ops);
    expect(result.fileConfig.originL0X).toBe(5);
    expect(result.fileConfig.widthL0).toBe(11);
    // Cell (2,2) was at L0 (2,2) — now outside canvas [5,16) × [5,16) → cleared
    expect(result.layers[0].cells[2][2]).toBeNull();
    // Cell (10,10) was at L0 (10,10) — inside canvas → preserved at same index
    expect(result.layers[0].cells[10][10]).toEqual(COLOR);
  });

  test('revert: restores old dimensions and origin', () => {
    const layer = makeLayer('l0', 0, 0);
    const state = makeState([layer], { fileConfig: { id: 'f', name: 'F', widthL0: 24, heightL0: 24, originL0X: 4, originL0Y: 4 } });

    const ops: UndoOp[] = [{
      op: 'resizeCanvas',
      oldWidthL0: 16, oldHeightL0: 16,
      newWidthL0: 24, newHeightL0: 24,
      oldOriginL0X: 8, oldOriginL0Y: 8,
      newOriginL0X: 4, newOriginL0Y: 4,
    }];

    const result = revertOps(state, ops);
    expect(result.fileConfig.widthL0).toBe(16);
    expect(result.fileConfig.heightL0).toBe(16);
    expect(result.fileConfig.originL0X).toBe(8);
    expect(result.fileConfig.originL0Y).toBe(8);
  });

  test('revert: restores cells cleared by the TL shrink', () => {
    // Simulate the post-apply state: canvas shrunk to origin (5,5), size 11,
    // and cell (2,2) was cleared because it fell outside the new window.
    const layer = makeLayer('l0', 0, 0);
    layer.cells[10][10] = COLOR;
    const state = makeState([layer], { fileConfig: { id: 'f', name: 'F', widthL0: 11, heightL0: 11, originL0X: 5, originL0Y: 5 } });

    const count = CELL_COUNTS[0];
    const snapshotCells: (CellState | null)[][] = [];
    for (let y = 0; y < count; y++) snapshotCells[y] = new Array(count).fill(null);
    snapshotCells[2][2] = COLOR;
    snapshotCells[10][10] = COLOR;

    const ops: UndoOp[] = [{
      op: 'resizeCanvas',
      oldWidthL0: 16, oldHeightL0: 16,
      newWidthL0: 11, newHeightL0: 11,
      oldOriginL0X: 0, oldOriginL0Y: 0,
      newOriginL0X: 5, newOriginL0Y: 5,
      layerCellsBefore: [{ layerId: layer.id, cells: snapshotCells }],
    }];

    const result = revertOps(state, ops);
    expect(result.fileConfig.widthL0).toBe(16);
    expect(result.fileConfig.originL0X).toBe(0);
    expect(result.layers[0].cells[2][2]).toEqual(COLOR);
    expect(result.layers[0].cells[10][10]).toEqual(COLOR);
  });

  // Regression: undo dispatches LOAD_STATE with the reverted state's
  // widthL0/heightL0/originL0X/originL0Y. The reducer must honor all four;
  // dropping originL0X/Y caused the canvas to render old dimensions at the
  // post-resize origin, misaligning all content.
  test('undo dispatch path (revertOps → LOAD_STATE) restores origin, not just dimensions', () => {
    const layer = makeLayer('l0', 0, 0);
    layer.cells[3][3] = COLOR;
    const state = makeState([layer], { fileConfig: { id: 'f', name: 'F', widthL0: 16, heightL0: 16, originL0X: 0, originL0Y: 0 } });

    const count = CELL_COUNTS[0];
    const snapshotCells: (CellState | null)[][] = [];
    for (let y = 0; y < count; y++) snapshotCells[y] = new Array(count).fill(null);
    snapshotCells[3][3] = COLOR;

    // TL shrink: origin 0→4, width 16→12.
    const op: UndoOp = {
      op: 'resizeCanvas',
      oldWidthL0: 16, oldHeightL0: 16,
      newWidthL0: 12, newHeightL0: 12,
      oldOriginL0X: 0, oldOriginL0Y: 0,
      newOriginL0X: 4, newOriginL0Y: 4,
      layerCellsBefore: [{ layerId: layer.id, cells: snapshotCells }],
    };

    const applied = applyOps(state, [op]);
    expect(applied.fileConfig.originL0X).toBe(4);
    expect(applied.fileConfig.widthL0).toBe(12);

    // Mirror the UNDO handler: revert, then dispatch LOAD_STATE with the four
    // fileConfig fields that can change (width/height/originX/originY).
    const reverted = revertOps(applied, [op]);
    const loaded = editorReducer(applied, {
      type: 'LOAD_STATE',
      layers: reverted.layers,
      activeLayerId: reverted.activeLayerId,
      widthL0: reverted.fileConfig.widthL0,
      heightL0: reverted.fileConfig.heightL0,
      originL0X: reverted.fileConfig.originL0X,
      originL0Y: reverted.fileConfig.originL0Y,
    });

    expect(loaded.fileConfig.widthL0).toBe(16);
    expect(loaded.fileConfig.heightL0).toBe(16);
    expect(loaded.fileConfig.originL0X).toBe(0);
    expect(loaded.fileConfig.originL0Y).toBe(0);
  });

  test('round-trip: TL shrink then revert restores original state', () => {
    const layer = makeLayer('l0', 0, 0);
    layer.cells[3][3] = COLOR;
    layer.cells[10][10] = COLOR;

    const count = CELL_COUNTS[0];
    const snapshotCells: (CellState | null)[][] = [];
    for (let y = 0; y < count; y++) snapshotCells[y] = new Array(count).fill(null);
    snapshotCells[3][3] = COLOR;
    snapshotCells[10][10] = COLOR;

    const state = makeState([layer], { fileConfig: { id: 'f', name: 'F', widthL0: 16, heightL0: 16 } });

    const ops: UndoOp[] = [{
      op: 'resizeCanvas',
      oldWidthL0: 16, oldHeightL0: 16,
      newWidthL0: 10, newHeightL0: 10,
      oldOriginL0X: 0, oldOriginL0Y: 0,
      newOriginL0X: 6, newOriginL0Y: 6,
      layerCellsBefore: [{ layerId: layer.id, cells: snapshotCells }],
    }];

    const applied = applyOps(state, ops);
    expect(applied.fileConfig.widthL0).toBe(10);
    expect(applied.fileConfig.originL0X).toBe(6);
    expect(applied.layers[0].cells[3][3]).toBeNull();
    expect(applied.layers[0].cells[10][10]).toEqual(COLOR);

    const reverted = revertOps(applied, ops);
    expect(reverted.fileConfig.widthL0).toBe(16);
    expect(reverted.fileConfig.originL0X).toBe(0);
    expect(reverted.layers[0].cells[3][3]).toEqual(COLOR);
    expect(reverted.layers[0].cells[10][10]).toEqual(COLOR);
  });

});

// ── clearOutOfBoundsCells ──────────────────────────────────────────

describe('clearOutOfBoundsCells', () => {
  test('clears L0 cells beyond new canvas width/height', () => {
    const layer = makeLayer('l0', 0, 0);
    // Place cells inside and outside an 8x8 canvas
    layer.cells[2][2] = COLOR;   // inside
    layer.cells[10][10] = COLOR; // outside (x>=8 and y>=8)
    layer.cells[0][15] = COLOR;  // outside (x>=8)
    layer.cells[15][0] = COLOR;  // outside (y>=8)
    clearOutOfBoundsCells([layer], 0, 0, 8, 8);
    expect(layer.cells[2][2]).toEqual(COLOR);
    expect(layer.cells[10][10]).toBeNull();
    expect(layer.cells[0][15]).toBeNull();
    expect(layer.cells[15][0]).toBeNull();
  });

  test('clears L1 cells beyond new bounds', () => {
    const layer = makeLayer('l1', 1, 0);
    // 8 L0 → editableCells(8, 1) = ceil(8*16/32) = 4
    layer.cells[0][0] = COLOR;  // inside
    layer.cells[0][5] = COLOR;  // outside (x>=4)
    clearOutOfBoundsCells([layer], 0, 0, 8, 8);
    expect(layer.cells[0][0]).toEqual(COLOR);
    expect(layer.cells[0][5]).toBeNull();
  });

  test('no-op when all cells are within bounds', () => {
    const layer = makeLayer('l0', 0, 0);
    layer.cells[5][5] = COLOR;
    const gen = layer.cellsGeneration;
    clearOutOfBoundsCells([layer], 0, 0, 32, 32);
    expect(layer.cells[5][5]).toEqual(COLOR);
    expect(layer.cellsGeneration).toBe(gen); // no mutation
  });

  test('resizeCanvas apply op clears out-of-bounds cells', () => {
    const layer = makeLayer('l0', 0, 0);
    layer.cells[2][2] = COLOR;
    layer.cells[20][20] = COLOR; // will be out of bounds after shrink to 16x16
    const state = makeState([layer], { fileConfig: { id: 'f', name: 'F', widthL0: 32, heightL0: 32 } });

    const ops: UndoOp[] = [{
      op: 'resizeCanvas',
      oldWidthL0: 32, oldHeightL0: 32,
      newWidthL0: 16, newHeightL0: 16,
      oldOriginL0X: 0, oldOriginL0Y: 0,
      newOriginL0X: 0, newOriginL0Y: 0,
    }];

    const result = applyOps(state, ops);
    expect(result.fileConfig.widthL0).toBe(16);
    expect(result.layers[0].cells[2][2]).toEqual(COLOR);
    expect(result.layers[0].cells[20][20]).toBeNull();
  });
});

// ── Helper validation ─────────────────────────────────────────────

describe('cellToL0', () => {
  test('L0 unshifted: cell (5,3) maps to L0 (5,3)', () => {
    const layer = makeLayer('l0', 0, 0);
    expect(cellToL0(layer, 5, 3)).toEqual({ l0x: 5, l0y: 3 });
  });

  test('L2 unshifted: cell (1,1) maps to L0 (4,4)', () => {
    const layer = makeLayer('l2', 2, 0);
    expect(cellToL0(layer, 1, 1)).toEqual({ l0x: 4, l0y: 4 });
  });

  test('L1 shiftX=0.5: cell (2,3) maps to L0 (5,6)', () => {
    const layer = makeShiftedLayer('l1', 1, 0, 0.5, 0);
    expect(cellToL0(layer, 2, 3)).toEqual({ l0x: 5, l0y: 6 });
  });

  test('L1 shiftX=0.5: edge cell (-1,0) maps to L0 (-1,0)', () => {
    const layer = makeShiftedLayer('l1', 1, 0, 0.5, 0);
    expect(cellToL0(layer, -1, 0)).toEqual({ l0x: -1, l0y: 0 });
  });

  test('L2 shifted both: cell (0,0) maps to L0 (2,2)', () => {
    const layer = makeShiftedLayer('l2', 2, 0, 0.5, 0.5);
    expect(cellToL0(layer, 0, 0)).toEqual({ l0x: 2, l0y: 2 });
  });

  test('L2 shifted both: edge corner (-1,-1) maps to L0 (-2,-2)', () => {
    const layer = makeShiftedLayer('l2', 2, 0, 0.5, 0.5);
    expect(cellToL0(layer, -1, -1)).toEqual({ l0x: -2, l0y: -2 });
  });
});

describe('collectAllOccupiedCells', () => {
  test('collects main grid cells', () => {
    const layer = makeLayer('l0', 0, 0);
    layer.cells[2][3] = RED;
    const cells = collectAllOccupiedCells(layer);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toEqual({ cellX: 3, cellY: 2, l0x: 3, l0y: 2, state: RED });
  });

  test('collects edge cells from shifted layer', () => {
    const layer = makeShiftedLayer('l1', 1, 0, 0.5, 0.5);
    setCell(layer, -1, 0, RED);
    setCell(layer, 2, -1, GREEN);
    setCell(layer, -1, -1, BLUE);
    layer.cells[0][0] = YELLOW;
    const cells = collectAllOccupiedCells(layer);
    expect(cells).toHaveLength(4);
    expect(cells.find(c => c.cellX === -1 && c.cellY === 0)).toBeDefined();
    expect(cells.find(c => c.cellX === 2 && c.cellY === -1)).toBeDefined();
    expect(cells.find(c => c.cellX === -1 && c.cellY === -1)).toBeDefined();
    expect(cells.find(c => c.cellX === 0 && c.cellY === 0)).toBeDefined();
  });
});

// ── Shifted layer resize: relative position preservation ──────────

describe('shiftLayerCells preserves L0 positions — unshifted layers', () => {
  test.each([
    { corner: 'tl' as const, shiftL0X: 8, shiftL0Y: 8 },
    { corner: 'tr' as const, shiftL0X: 0, shiftL0Y: 8 },
    { corner: 'bl' as const, shiftL0X: 8, shiftL0Y: 0 },
    { corner: 'br' as const, shiftL0X: 0, shiftL0Y: 0 },
  ])('$corner corner: L0 positions shift by ($shiftL0X, $shiftL0Y)', ({ shiftL0X, shiftL0Y }) => {
    const layer = makeLayer('l0', 0, 0);
    layer.cells[3][5] = RED;
    layer.cells[10][10] = GREEN;

    const before = collectAllOccupiedCells(layer);
    shiftLayerCells([layer], shiftL0X, shiftL0Y);
    const after = collectAllOccupiedCells(layer);

    for (const b of before) {
      const expectedL0x = b.l0x + shiftL0X;
      const expectedL0y = b.l0y + shiftL0Y;
      if (expectedL0x >= 0 && expectedL0x < 32 && expectedL0y >= 0 && expectedL0y < 32) {
        const match = after.find(a => a.state === b.state && a.l0x === expectedL0x && a.l0y === expectedL0y);
        expect(match).toBeDefined();
      }
    }
  });

  test('L2 layer: positions shift proportionally', () => {
    const layer = makeLayer('l2', 2, 0);
    layer.cells[1][1] = RED;

    const beforeCells = collectAllOccupiedCells(layer);
    expect(beforeCells[0].l0x).toBe(4);
    expect(beforeCells[0].l0y).toBe(4);

    shiftLayerCells([layer], 8, 8);

    const afterCells = collectAllOccupiedCells(layer);
    expect(afterCells).toHaveLength(1);
    expect(afterCells[0].l0x).toBe(12);
    expect(afterCells[0].l0y).toBe(12);
    expect(afterCells[0].l0x - beforeCells[0].l0x).toBe(8);
    expect(afterCells[0].l0y - beforeCells[0].l0y).toBe(8);
  });
});

describe('shiftLayerCells preserves L0 positions — shifted layers', () => {
  test('shiftX=0.5: edgeColLeft data shifts with main cells (TL resize)', () => {
    const layer = makeShiftedLayer('l1-sx', 1, 0, 0.5, 0);
    // L1: count=16, cellSizeL0=2.
    // edgeColLeft at y=2: cell(-1,2), L0x = (-1+0.5)*2 = -1
    setCell(layer, -1, 2, RED);
    // main cells at (3,2): L0x = (3+0.5)*2 = 7
    layer.cells[2][3] = GREEN;

    const before = collectAllOccupiedCells(layer);
    expect(before).toHaveLength(2);
    const edgeBefore = before.find(c => c.cellX === -1)!;
    const mainBefore = before.find(c => c.cellX === 3)!;
    expect(edgeBefore.l0x).toBe(-1);
    expect(mainBefore.l0x).toBe(7);
    const relativeDistX = mainBefore.l0x - edgeBefore.l0x;
    expect(relativeDistX).toBe(8);

    // Grow from TL by 4 L0 on X. cellShift = 4*16/32 = 2.
    shiftLayerCells([layer], 4, 0);

    const after = collectAllOccupiedCells(layer);

    const mainAfter = after.find(c => c.state === GREEN);
    expect(mainAfter).toBeDefined();
    expect(mainAfter!.l0x).toBe(11);

    const edgeAfter = after.find(c => c.state === RED);
    expect(edgeAfter).toBeDefined();
    expect(edgeAfter!.l0x).toBe(3);

    expect(mainAfter!.l0x - edgeAfter!.l0x).toBe(relativeDistX);
  });

  test('shiftY=0.5: edgeRowTop data shifts with main cells (TR resize)', () => {
    const layer = makeShiftedLayer('l1-sy', 1, 0, 0, 0.5);
    // edgeRowTop at x=4: cell(4,-1), L0y = (-1+0.5)*2 = -1
    setCell(layer, 4, -1, RED);
    // main cells at (4,5): L0y = (5+0.5)*2 = 11
    layer.cells[5][4] = GREEN;

    const before = collectAllOccupiedCells(layer);
    expect(before).toHaveLength(2);
    const edgeBefore = before.find(c => c.cellY === -1)!;
    const mainBefore = before.find(c => c.cellY === 5)!;
    const relativeDistY = mainBefore.l0y - edgeBefore.l0y;

    // Grow up by 4 L0 on Y. cellShift = 4*16/32 = 2.
    shiftLayerCells([layer], 0, 4);

    const after = collectAllOccupiedCells(layer);

    const mainAfter = after.find(c => c.state === GREEN);
    expect(mainAfter).toBeDefined();
    expect(mainAfter!.l0y).toBe(15);

    const edgeAfter = after.find(c => c.state === RED);
    expect(edgeAfter).toBeDefined();
    expect(edgeAfter!.l0y).toBe(3);

    expect(mainAfter!.l0y - edgeAfter!.l0y).toBe(relativeDistY);
  });

  test('shiftX=0.5 + shiftY=0.5: all edge storage shifts (TL resize)', () => {
    const layer = makeShiftedLayer('l2-both', 2, 0, 0.5, 0.5);
    // L2: count=8, cellSizeL0=4.
    setCell(layer, -1, -1, RED);     // L0 = (-2, -2)
    setCell(layer, -1, 1, GREEN);    // L0 = (-2, 6)
    setCell(layer, 2, -1, BLUE);     // L0 = (10, -2)
    layer.cells[1][1] = YELLOW;      // L0 = (6, 6)

    const before = collectAllOccupiedCells(layer);
    expect(before).toHaveLength(4);
    const positionsBefore = new Map(before.map(c => [c.state, { l0x: c.l0x, l0y: c.l0y }]));

    // TL resize: grow by 8 L0 on both axes. cellShift = 8*8/32 = 2.
    shiftLayerCells([layer], 8, 8);

    const after = collectAllOccupiedCells(layer);
    expect(after).toHaveLength(4);

    for (const cell of after) {
      const beforePos = positionsBefore.get(cell.state);
      expect(beforePos).toBeDefined();
      expect(cell.l0x).toBe(beforePos!.l0x + 8);
      expect(cell.l0y).toBe(beforePos!.l0y + 8);
    }
  });
});

describe('shiftLayerCells shrink — shifted layers', () => {
  test('shrinking from TL: edge cells shifted out of bounds are removed', () => {
    const layer = makeShiftedLayer('l1-sx', 1, 0, 0.5, 0);
    // edgeColLeft at y=0: cell(-1,0), L0x = -1
    setCell(layer, -1, 0, RED);
    // main cell at (5,0): L0x = (5+0.5)*2 = 11
    layer.cells[0][5] = GREEN;

    // Shrink from TL: old 16 -> new 12 => shiftL0X = -4, cellShift = -2
    // Edge cell L0: -1 + (-4) = -5, out of bounds => should be removed.
    // Main cell L0: 11 + (-4) = 7, grid pos: (5-2)=3, in bounds.
    shiftLayerCells([layer], -4, 0);

    const after = collectAllOccupiedCells(layer);
    const mainAfter = after.find(c => c.state === GREEN);
    expect(mainAfter).toBeDefined();
    expect(mainAfter!.l0x).toBe(7);

    const edgeAfter = after.find(c => c.state === RED);
    expect(edgeAfter).toBeUndefined();
  });
});

describe('resize direction × shifted layer combinations', () => {
  const corners = [
    { corner: 'tl', shiftL0X: 8, shiftL0Y: 8, desc: 'TL: grow left+up' },
    { corner: 'tr', shiftL0X: 0, shiftL0Y: 8, desc: 'TR: grow up' },
    { corner: 'bl', shiftL0X: 8, shiftL0Y: 0, desc: 'BL: grow left' },
    { corner: 'br', shiftL0X: 0, shiftL0Y: 0, desc: 'BR: no shift' },
  ] as const;

  test.each(corners)('$desc with shiftX=0.5 layer', ({ shiftL0X, shiftL0Y }) => {
    const layer = makeShiftedLayer('l1', 1, 0, 0.5, 0);
    setCell(layer, -1, 4, RED);
    layer.cells[4][5] = GREEN;

    const before = collectAllOccupiedCells(layer);
    shiftLayerCells([layer], shiftL0X, shiftL0Y);
    const after = collectAllOccupiedCells(layer);

    for (const b of before) {
      const expectedL0x = b.l0x + shiftL0X;
      const expectedL0y = b.l0y + shiftL0Y;
      const count = CELL_COUNTS[layer.level];
      const cellSizeL0 = 32 / count;
      const expectedCellX = expectedL0x / cellSizeL0 - layer.shiftX;
      const expectedCellY = expectedL0y / cellSizeL0 - layer.shiftY;
      if (expectedCellX >= -1 && expectedCellX < count && expectedCellY >= -1 && expectedCellY < count) {
        const match = after.find(a =>
          a.state === b.state &&
          Math.abs(a.l0x - expectedL0x) < 0.001 &&
          Math.abs(a.l0y - expectedL0y) < 0.001
        );
        expect(match).toBeDefined();
      }
    }
  });

  test.each(corners)('$desc with shiftY=0.5 layer', ({ shiftL0X, shiftL0Y }) => {
    const layer = makeShiftedLayer('l1', 1, 0, 0, 0.5);
    setCell(layer, 4, -1, RED);
    layer.cells[5][4] = GREEN;

    const before = collectAllOccupiedCells(layer);
    shiftLayerCells([layer], shiftL0X, shiftL0Y);
    const after = collectAllOccupiedCells(layer);

    for (const b of before) {
      const expectedL0x = b.l0x + shiftL0X;
      const expectedL0y = b.l0y + shiftL0Y;
      const count = CELL_COUNTS[layer.level];
      const cellSizeL0 = 32 / count;
      const expectedCellX = expectedL0x / cellSizeL0 - layer.shiftX;
      const expectedCellY = expectedL0y / cellSizeL0 - layer.shiftY;
      if (expectedCellX >= -1 && expectedCellX < count && expectedCellY >= -1 && expectedCellY < count) {
        const match = after.find(a =>
          a.state === b.state &&
          Math.abs(a.l0x - expectedL0x) < 0.001 &&
          Math.abs(a.l0y - expectedL0y) < 0.001
        );
        expect(match).toBeDefined();
      }
    }
  });
});

describe('cross-layer relative positions after resize', () => {
  test('3 layers with different levels and shifts maintain relative L0 distances', () => {
    const l0 = makeLayer('l0', 0, 0);
    l0.cells[5][5] = RED;

    const l2 = makeShiftedLayer('l2', 2, 1, 0.5, 0);
    l2.cells[1][1] = GREEN;

    const l1 = makeShiftedLayer('l1', 1, 2, 0, 0.5);
    l1.cells[3][3] = BLUE;

    const layers = [l0, l2, l1];

    const allBefore = layers.flatMap(l => collectAllOccupiedCells(l).map(c => ({
      layerId: l.id, ...c,
    })));

    const pairDistances: { i: number; j: number; dl0x: number; dl0y: number }[] = [];
    for (let i = 0; i < allBefore.length; i++) {
      for (let j = i + 1; j < allBefore.length; j++) {
        pairDistances.push({
          i, j,
          dl0x: allBefore[j].l0x - allBefore[i].l0x,
          dl0y: allBefore[j].l0y - allBefore[i].l0y,
        });
      }
    }

    shiftLayerCells(layers, 8, 8);

    const allAfter = layers.flatMap(l => collectAllOccupiedCells(l).map(c => ({
      layerId: l.id, ...c,
    })));

    for (const b of allBefore) {
      const a = allAfter.find(c => c.layerId === b.layerId && c.state === b.state);
      expect(a).toBeDefined();
      expect(a!.l0x).toBe(b.l0x + 8);
      expect(a!.l0y).toBe(b.l0y + 8);
    }

    for (const pd of pairDistances) {
      const dl0x = allAfter[pd.j].l0x - allAfter[pd.i].l0x;
      const dl0y = allAfter[pd.j].l0y - allAfter[pd.i].l0y;
      expect(dl0x).toBe(pd.dl0x);
      expect(dl0y).toBe(pd.dl0y);
    }
  });
});

describe('full resize pipeline with shifted layers', () => {
  test('computeResizeFromDrag → clearOutOfBoundsCells: TL expand keeps in-bounds content at identical L0 positions', () => {
    // A 16×16 canvas at origin (8,8) inside a shifted L2 layer. Canvas covers
    // L0 [8, 24) × [8, 24). Place content inside the canvas so the resize
    // path never needs to clear it.
    const layer = makeShiftedLayer('l2-sx', 2, 0, 0.5, 0.5);
    layer.cells[3][3] = RED;   // L0 ((3+0.5)*4, (3+0.5)*4) = (14, 14) — inside
    layer.cells[4][4] = GREEN; // L0 (18, 18) — inside

    const before = collectAllOccupiedCells(layer);
    expect(before).toHaveLength(2);

    // Drag TL up-and-left by 4 L0 each (delta = 4/32 = 0.125 in layer UV):
    // origin 8→4, width 16→20.
    const result = computeResizeFromDrag('tl', 16, 16, 8, 8, -0.125, -0.125, 4);
    expect(result.newWidthL0).toBe(20);
    expect(result.newHeightL0).toBe(20);
    expect(result.newOriginL0X).toBe(4);
    expect(result.newOriginL0Y).toBe(4);

    clearOutOfBoundsCells([layer], result.newOriginL0X, result.newOriginL0Y, result.newWidthL0, result.newHeightL0);

    // Origin-based resize never moves cell data — every in-bounds cell stays
    // at its exact L0 position; crucially, the layer's shiftX/shiftY are
    // untouched, so no half-cell alignment error can accumulate.
    expect(layer.shiftX).toBe(0.5);
    expect(layer.shiftY).toBe(0.5);
    const after = collectAllOccupiedCells(layer);
    for (const b of before) {
      const a = after.find(c => c.state === b.state);
      expect(a).toBeDefined();
      expect(a!.l0x).toBe(b.l0x);
      expect(a!.l0y).toBe(b.l0y);
    }
  });

  // Regression: the user report that prompted the origin-based resize was
  // "dragging top/left by L1 with an L3 layer is blocked because the coarsest
  // snap forces L3 increments." Under the new model, origin-based resize has
  // no coarsest constraint — L1 drags always succeed and never mutate layer
  // data, so no sub-cell alignment bug can surface.
  test('TL drag by L1 (2 L0) with L3 coarsest layer succeeds and leaves cell data bit-identical', () => {
    const l0Layer = makeShiftedLayer('l0', 0, 0, 0, 0);
    const l3Layer = makeShiftedLayer('l3', 3, 1, 0, 0);
    // Canvas 16×16 at origin (8,8) covers L0 [8, 24). Place both cells inside.
    l0Layer.cells[15][15] = RED;  // L0 (15, 15)
    l3Layer.cells[2][2] = BLUE;    // L0 (16, 16)

    // Snapshot layer state (cells, shift, edge, and first 32 bytes of pixel data)
    const l0CellsBefore = JSON.stringify(l0Layer.cells);
    const l3CellsBefore = JSON.stringify(l3Layer.cells);
    const l0ShiftBefore = { x: l0Layer.shiftX, y: l0Layer.shiftY };
    const l3ShiftBefore = { x: l3Layer.shiftX, y: l3Layer.shiftY };
    const l0PixBefore = Array.from(l0Layer.data.subarray(0, 32));
    const l3PixBefore = Array.from(l3Layer.data.subarray(0, 32));

    // Canvas 16×16 at origin (8, 8). Drag TL by exactly L1 (2 L0) — previously
    // blocked because shiftSnapSize pinned to coarsest (L3 = 8 L0).
    const snapSize = 32 / CELL_COUNTS[0]; // active layer is L0 → snap = 1
    const deltaL0 = 2;
    const result = computeResizeFromDrag(
      'tl', 16, 16, 8, 8, -deltaL0 / 32, -deltaL0 / 32, snapSize,
    );
    expect(result.newOriginL0X).toBe(6);
    expect(result.newOriginL0Y).toBe(6);
    expect(result.newWidthL0).toBe(18);
    expect(result.newHeightL0).toBe(18);

    clearOutOfBoundsCells(
      [l0Layer, l3Layer],
      result.newOriginL0X, result.newOriginL0Y,
      result.newWidthL0, result.newHeightL0,
    );

    // Layer data untouched — both cells inside canvas window, shifts unchanged.
    expect(JSON.stringify(l0Layer.cells)).toBe(l0CellsBefore);
    expect(JSON.stringify(l3Layer.cells)).toBe(l3CellsBefore);
    expect(l0Layer.shiftX).toBe(l0ShiftBefore.x);
    expect(l0Layer.shiftY).toBe(l0ShiftBefore.y);
    expect(l3Layer.shiftX).toBe(l3ShiftBefore.x);
    expect(l3Layer.shiftY).toBe(l3ShiftBefore.y);
    expect(Array.from(l0Layer.data.subarray(0, 32))).toEqual(l0PixBefore);
    expect(Array.from(l3Layer.data.subarray(0, 32))).toEqual(l3PixBefore);
  });

  // Hard stop: dragging TL past origin=0 doesn't expand beyond the layer buffer.
  test('TL expand past origin=0 is clamped (hard stop at layer-space boundary)', () => {
    const result = computeResizeFromDrag('tl', 16, 16, 0, 0, -0.25, -0.25, 1);
    expect(result.newOriginL0X).toBe(0);
    expect(result.newOriginL0Y).toBe(0);
    expect(result.newWidthL0).toBe(16);
    expect(result.newHeightL0).toBe(16);
  });

  // Round-trip: shrink from left then re-expand restores the window exactly.
  test('TL shrink then re-expand restores window without clearing (cells already outside stay cleared)', () => {
    const layer = makeLayer('l0', 0, 0);
    layer.cells[10][10] = RED;
    layer.cells[2][2] = BLUE;

    // First drag: TL shrink by 4 L0 → origin 0→4, width 16→12. Blue at (2,2) cleared.
    const r1 = computeResizeFromDrag('tl', 16, 16, 0, 0, 4 / 32, 4 / 32, 1);
    clearOutOfBoundsCells([layer], r1.newOriginL0X, r1.newOriginL0Y, r1.newWidthL0, r1.newHeightL0);
    expect(r1.newOriginL0X).toBe(4);
    expect(r1.newWidthL0).toBe(12);
    expect(layer.cells[2][2]).toBeNull();
    expect(layer.cells[10][10]).toEqual(RED);

    // Re-expand: TL drag back by 4 L0 → origin 4→0, width 12→16. No clear needed; Red still there.
    const r2 = computeResizeFromDrag('tl', 12, 12, 4, 4, -4 / 32, -4 / 32, 1);
    clearOutOfBoundsCells([layer], r2.newOriginL0X, r2.newOriginL0Y, r2.newWidthL0, r2.newHeightL0);
    expect(r2.newOriginL0X).toBe(0);
    expect(r2.newWidthL0).toBe(16);
    expect(layer.cells[10][10]).toEqual(RED);
    // Cleared content doesn't come back (per the "remove on shrink" policy).
    expect(layer.cells[2][2]).toBeNull();
  });
});

// ── Sub-cell alignment: L2 shift toggle on L1-sized resize ────────
//
// When resizing by an amount that isn't a multiple of the coarser layer's
// cell size, the half-cell residual must be absorbed by toggling the
// layer's shiftX/shiftY (0↔0.5). shiftLayerCells currently uses
// Math.round which forces an integer cell shift, losing the residual.
//
// shrinkwrapLayers already handles this correctly (cells.ts:2896):
//   vX = layer.shiftX + deltaL0X / cellsPerL0
//   cellShiftX = floor(vX)
//   newShiftX  = vX - cellShiftX  (0 or 0.5)
//
// shiftLayerCells needs the same logic.

describe('shiftLayerCells sub-cell alignment — L2 layers with L1-sized resize', () => {
  test('L2 shiftX=0.5, resize left by 2 L0: shift toggles to 0, data shifts by exactly 2 L0', () => {
    // L2: count=8, cellSizeL0=4. Half-cell = 2 L0.
    // Cell (1,1) with shiftX=0.5: L0x = (1+0.5)*4 = 6
    const layer = makeShiftedLayer('l2', 2, 0, 0.5, 0);
    layer.cells[1][1] = RED;

    const before = collectAllOccupiedCells(layer);
    expect(before[0].l0x).toBe(6);

    // Resize adds 2 L0 to the left → shiftL0X = 2
    // Correct: vX = 0.5 + 2/4 = 1.0 → cellShift=1, newShiftX=0
    // Cell moves to (2,1) with shiftX=0: L0x = 2*4 = 8 = 6+2 ✓
    // Bug: Math.round(2*8/32) = Math.round(0.5) = 1 → cell at (2,1) with shiftX=0.5: L0x = 10 ✗
    shiftLayerCells([layer], 2, 0);

    const after = collectAllOccupiedCells(layer);
    expect(after).toHaveLength(1);
    expect(after[0].l0x).toBe(8);
  });

  test('L2 shiftX=0, resize left by 2 L0: shift toggles to 0.5, data shifts by exactly 2 L0', () => {
    // Cell (1,1) with shiftX=0: L0x = 1*4 = 4
    const layer = makeLayer('l2', 2, 0);
    layer.cells[1][1] = RED;

    const before = collectAllOccupiedCells(layer);
    expect(before[0].l0x).toBe(4);

    // Correct: vX = 0 + 2/4 = 0.5 → cellShift=0, newShiftX=0.5
    // Cell stays at (1,1) with shiftX=0.5: L0x = (1+0.5)*4 = 6 = 4+2 ✓
    // Bug: Math.round(0.5) = 1 → cell at (2,1) with shiftX=0: L0x = 8, expected 6 ✗
    shiftLayerCells([layer], 2, 0);

    const after = collectAllOccupiedCells(layer);
    expect(after).toHaveLength(1);
    expect(after[0].l0x).toBe(6);
  });

  test('L2 shiftY=0.5, resize up by 2 L0: shift toggles to 0, data shifts by exactly 2 L0', () => {
    const layer = makeShiftedLayer('l2', 2, 0, 0, 0.5);
    layer.cells[1][1] = RED;

    const before = collectAllOccupiedCells(layer);
    expect(before[0].l0y).toBe(6);

    shiftLayerCells([layer], 0, 2);

    const after = collectAllOccupiedCells(layer);
    expect(after).toHaveLength(1);
    expect(after[0].l0y).toBe(8);
  });

  test('L2 shiftX=0.5 + shiftY=0.5, resize by (2,2) L0: both shifts toggle', () => {
    const layer = makeShiftedLayer('l2', 2, 0, 0.5, 0.5);
    // Cell (1,1): L0 = (1.5*4, 1.5*4) = (6, 6)
    layer.cells[1][1] = RED;

    shiftLayerCells([layer], 2, 2);

    const after = collectAllOccupiedCells(layer);
    expect(after).toHaveLength(1);
    expect(after[0].l0x).toBe(8);
    expect(after[0].l0y).toBe(8);
    // Verify the shifts were toggled
    expect(layer.shiftX).toBe(0);
    expect(layer.shiftY).toBe(0);
  });

  test('L2 shiftX=0.5, resize by 4 L0 (full cell): no toggle needed, shift stays 0.5', () => {
    const layer = makeShiftedLayer('l2', 2, 0, 0.5, 0);
    layer.cells[1][1] = RED;

    const before = collectAllOccupiedCells(layer);
    expect(before[0].l0x).toBe(6);

    // 4 L0 = exactly 1 L2 cell, no residual → shiftX stays 0.5
    shiftLayerCells([layer], 4, 0);

    const after = collectAllOccupiedCells(layer);
    expect(after).toHaveLength(1);
    expect(after[0].l0x).toBe(10);
    expect(layer.shiftX).toBe(0.5);
  });

  test('L2 shiftX=0, resize by 6 L0 (1.5 cells): toggle plus cell shift', () => {
    const layer = makeLayer('l2', 2, 0);
    layer.cells[1][1] = RED;

    const before = collectAllOccupiedCells(layer);
    expect(before[0].l0x).toBe(4);

    // vX = 0 + 6/4 = 1.5 → cellShift=1, newShiftX=0.5
    // Cell moves to (2,1) with shiftX=0.5: L0x = (2+0.5)*4 = 10 = 4+6 ✓
    shiftLayerCells([layer], 6, 0);

    const after = collectAllOccupiedCells(layer);
    expect(after).toHaveLength(1);
    expect(after[0].l0x).toBe(10);
    expect(layer.shiftX).toBe(0.5);
  });
});

describe('sub-cell alignment: cross-level consistency', () => {
  test('L0 and L2 layers stay aligned after 2 L0 resize to the left', () => {
    // L0 layer: cell at (4,4), L0x = 4
    const l0 = makeLayer('l0', 0, 0);
    l0.cells[4][4] = RED;

    // L2 shifted layer: cell at (1,1) with shiftX=0.5, L0x = 6
    const l2 = makeShiftedLayer('l2', 2, 1, 0.5, 0);
    l2.cells[1][1] = GREEN;

    // Distance in L0: 6 - 4 = 2
    const distBefore = 6 - 4;

    shiftLayerCells([l0, l2], 2, 0);

    const l0After = collectAllOccupiedCells(l0);
    const l2After = collectAllOccupiedCells(l2);

    expect(l0After[0].l0x).toBe(6);
    expect(l2After[0].l0x).toBe(8);
    expect(l2After[0].l0x - l0After[0].l0x).toBe(distBefore);
  });

  test('L0, L1, and L2 layers all shift by exactly 2 L0', () => {
    const l0 = makeLayer('l0', 0, 0);
    l0.cells[4][4] = RED;

    const l1 = makeLayer('l1', 1, 1);
    l1.cells[2][2] = GREEN; // L0x = 2*2 = 4

    const l2 = makeShiftedLayer('l2', 2, 2, 0.5, 0);
    l2.cells[1][1] = BLUE; // L0x = (1+0.5)*4 = 6

    const layers = [l0, l1, l2];
    const beforePositions = layers.map(l => collectAllOccupiedCells(l)[0].l0x);

    shiftLayerCells(layers, 2, 0);

    const afterPositions = layers.map(l => collectAllOccupiedCells(l)[0].l0x);
    for (let i = 0; i < layers.length; i++) {
      expect(afterPositions[i]).toBe(beforePositions[i] + 2);
    }
  });

  test('negative sub-cell shift: resize shrinks from left by 2 L0', () => {
    // L2 shiftX=0, cell at (2,1): L0x = 8
    const layer = makeLayer('l2', 2, 0);
    layer.cells[1][2] = RED;

    // shiftL0X = -2: vX = 0 + (-2)/4 = -0.5 → cellShift = floor(-0.5) = -1, newShiftX = 0.5
    // Cell moves to (1,1) with shiftX=0.5: L0x = (1+0.5)*4 = 6 = 8-2 ✓
    shiftLayerCells([layer], -2, 0);

    const after = collectAllOccupiedCells(layer);
    expect(after).toHaveLength(1);
    expect(after[0].l0x).toBe(6);
    expect(layer.shiftX).toBe(0.5);
  });

  test('negative sub-cell shift: L2 shiftX=0.5, shrink left by 2 L0', () => {
    // Cell at (2,1) with shiftX=0.5: L0x = (2+0.5)*4 = 10
    const layer = makeShiftedLayer('l2', 2, 0, 0.5, 0);
    layer.cells[1][2] = RED;

    // shiftL0X = -2: vX = 0.5 + (-2)/4 = 0 → cellShift=0, newShiftX=0
    // Cell stays at (2,1) with shiftX=0: L0x = 2*4 = 8 = 10-2 ✓
    shiftLayerCells([layer], -2, 0);

    const after = collectAllOccupiedCells(layer);
    expect(after).toHaveLength(1);
    expect(after[0].l0x).toBe(8);
    expect(layer.shiftX).toBe(0);
  });
});
