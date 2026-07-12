import {
  canvasCellWindow,
  canvasPixelBounds,
  canvasMirrorBounds,
  isOnCanvasBorderL0,
  mirrorOverlayAxes,
} from '../canvas-bounds';
import { cellPx, editableCells } from '../types';
import { computePaintMirrorTargets, computeMirrorSymmetry, type MirrorFlags } from '../paintMirror';
import { makeLayer } from './test-utils';

describe('canvasCellWindow', () => {
  test('reduces to legacy [0, editableCells) when origin is (0,0)', () => {
    const layer = makeLayer('a', 2); // L2: 8x8 cells
    const w = canvasCellWindow(layer, { widthL0: 32, heightL0: 32 });
    expect(w.startCellX).toBe(0);
    expect(w.startCellY).toBe(0);
    expect(w.mainStartX).toBe(0);
    expect(w.mainStartY).toBe(0);
    expect(w.endCellX).toBe(editableCells(32, 2));
    expect(w.endCellY).toBe(editableCells(32, 2));
    expect(w.edgeMinCellX).toBe(0);
    expect(w.edgeMinCellY).toBe(0);
  });

  test('partial canvas at origin (0,0) clamps endCell to canvas size', () => {
    const layer = makeLayer('a', 2); // L2: 8x8 cells, cellsPerL0 = 4
    const w = canvasCellWindow(layer, { widthL0: 16, heightL0: 16 });
    expect(w.mainStartX).toBe(0);
    expect(w.endCellX).toBe(4); // 16 / 4
    expect(w.endCellY).toBe(4);
  });

  test('non-zero origin shifts window into the layer', () => {
    const layer = makeLayer('a', 2); // L2: 8x8 cells, cellsPerL0 = 4
    const w = canvasCellWindow(layer, {
      widthL0: 16, heightL0: 16,
      originL0X: 8, originL0Y: 8,
    });
    expect(w.startCellX).toBe(2); // 8 / 4
    expect(w.startCellY).toBe(2);
    expect(w.mainStartX).toBe(2);
    expect(w.mainStartY).toBe(2);
    expect(w.endCellX).toBe(6); // (8 + 16) / 4
    expect(w.endCellY).toBe(6);
  });

  test('clamps endCell to layer cell count', () => {
    const layer = makeLayer('a', 2); // L2: 8x8 cells
    const w = canvasCellWindow(layer, {
      widthL0: 32, heightL0: 32,
      originL0X: 4, originL0Y: 4,
    });
    expect(w.endCellX).toBe(8); // min(8, 9)
    expect(w.endCellY).toBe(8);
  });

  test('shift-0.5 layer with origin (0,0) exposes -1 edge index', () => {
    const layer = makeLayer('a', 2);
    layer.shiftX = 0.5;
    layer.shiftY = 0.5;
    const w = canvasCellWindow(layer, { widthL0: 32, heightL0: 32 });
    // sL0X = 2; startCellX = floor((0 - 2) / 4) = -1
    expect(w.startCellX).toBe(-1);
    expect(w.mainStartX).toBe(0);
    expect(w.edgeMinCellX).toBe(-1);
  });

  test('shift-0.5 layer with non-zero origin moves canvas inside the layer', () => {
    const layer = makeLayer('a', 2);
    layer.shiftX = 0.5;
    layer.shiftY = 0.5;
    // origin = 8, sL0 = 2, cellsPerL0 = 4
    // startCellX = floor((8 - 2) / 4) = 1
    const w = canvasCellWindow(layer, {
      widthL0: 16, heightL0: 16,
      originL0X: 8, originL0Y: 8,
    });
    expect(w.startCellX).toBe(1);
    expect(w.mainStartX).toBe(1);
    expect(w.edgeMinCellX).toBe(1); // not -1: canvas does not reach the half-cell strip
    expect(w.endCellX).toBe(6); // ceil((8 + 16 - 2) / 4) = 6
  });
});

describe('canvasPixelBounds', () => {
  test('matches the inline bulkFloodFill expression for origin (0,0)', () => {
    const layer = makeLayer('a', 2);
    const size = cellPx(2);
    const b = canvasPixelBounds(layer, { widthL0: 16, heightL0: 16 });
    expect(b).toEqual({
      pxMinX: 0,
      pxMinY: 0,
      pxMaxX: 4 * size,
      pxMaxY: 4 * size,
    });
  });

  test('shifts by canvas origin and includes layer shift', () => {
    const layer = makeLayer('a', 2);
    layer.shiftX = 0.5;
    const size = cellPx(2);
    const shiftPx = 0.5 * size;
    const b = canvasPixelBounds(layer, {
      widthL0: 16, heightL0: 16,
      originL0X: 8, originL0Y: 8,
    });
    // mainStartX = 1 (shifted layer at origin 8), endCellX = 6
    expect(b.pxMinX).toBe(1 * size + shiftPx);
    expect(b.pxMaxX).toBe(6 * size + shiftPx);
  });
});

describe('canvasMirrorBounds', () => {
  test('matches multires-fill inline expression', () => {
    const l0cpx = cellPx(0);
    const b = canvasMirrorBounds({
      widthL0: 16, heightL0: 16,
      originL0X: 8, originL0Y: 8,
    });
    expect(b).toEqual({
      pxMinX: 8 * l0cpx,
      pxMinY: 8 * l0cpx,
      pxMaxX: 24 * l0cpx,
      pxMaxY: 24 * l0cpx,
    });
  });

  test('reduces to (0, dim*l0cpx) at origin (0,0)', () => {
    const l0cpx = cellPx(0);
    const b = canvasMirrorBounds({ widthL0: 32, heightL0: 32 });
    expect(b).toEqual({
      pxMinX: 0,
      pxMinY: 0,
      pxMaxX: 32 * l0cpx,
      pxMaxY: 32 * l0cpx,
    });
  });
});

describe('isOnCanvasBorderL0', () => {
  test('matches the legacy <=0 / >=canvasDim check at origin (0,0)', () => {
    const c = { widthL0: 32, heightL0: 32 };
    expect(isOnCanvasBorderL0(0, 16, c)).toBe(true);    // left
    expect(isOnCanvasBorderL0(32, 16, c)).toBe(true);   // right
    expect(isOnCanvasBorderL0(16, 0, c)).toBe(true);    // top
    expect(isOnCanvasBorderL0(16, 32, c)).toBe(true);   // bottom
    expect(isOnCanvasBorderL0(16, 16, c)).toBe(false);  // interior
  });

  test('shifts the border with non-zero origin', () => {
    const c = { widthL0: 16, heightL0: 16, originL0X: 8, originL0Y: 8 };
    expect(isOnCanvasBorderL0(8, 16, c)).toBe(true);    // left edge of canvas
    expect(isOnCanvasBorderL0(24, 16, c)).toBe(true);   // right edge
    expect(isOnCanvasBorderL0(16, 8, c)).toBe(true);    // top
    expect(isOnCanvasBorderL0(16, 24, c)).toBe(true);   // bottom
    expect(isOnCanvasBorderL0(16, 16, c)).toBe(false);  // interior
    // points outside the canvas window also count as "border" — matches the
    // gatherConstraints semantics.
    expect(isOnCanvasBorderL0(4, 16, c)).toBe(true);
    expect(isOnCanvasBorderL0(28, 16, c)).toBe(true);
  });
});

describe('mirrorOverlayAxes', () => {
  // The renderer feeds the result of this helper into the mirror-overlay
  // shader so the on-screen H/V/diagonal/quadrant lines track the
  // engine's actual mirror axis at the active layer's resolution.

  test('dashPeriod is a fixed 1/64 (half an L0 cell) regardless of layer level', () => {
    for (const level of [0, 1, 2, 3] as const) {
      const layer = makeLayer('a', level);
      const axes = mirrorOverlayAxes(layer, { widthL0: 32, heightL0: 32 });
      expect(axes.dashPeriod).toBeCloseTo(1 / 64, 10);
    }
  });

  test('widthL0=32 L0: axis on canvas-center cell border (solid)', () => {
    const layer = makeLayer('a', 0); // L0: 32 cells
    const axes = mirrorOverlayAxes(layer, { widthL0: 32, heightL0: 32 });
    expect(axes.centerU).toBeCloseTo(0.5, 10);
    expect(axes.centerV).toBeCloseTo(0.5, 10);
    expect(axes.dashH).toBe(false);
    expect(axes.dashV).toBe(false);
  });

  test('widthL0=32 L1: same axis at L1 resolution (still solid)', () => {
    const layer = makeLayer('a', 1); // L1: 16 cells
    const axes = mirrorOverlayAxes(layer, { widthL0: 32, heightL0: 32 });
    expect(axes.centerU).toBeCloseTo(0.5, 10);
    expect(axes.dashH).toBe(false);
  });

  test('widthL0=31 L0: axis through cell 15 center (dashed)', () => {
    const layer = makeLayer('a', 0);
    const axes = mirrorOverlayAxes(layer, { widthL0: 31, heightL0: 31 });
    // canvas window cells 0..30 → cellCx2 = 30 (even) → axis at 15.5 cell-coord,
    // i.e. the middle of cell 15 → UV 15.5/32.
    expect(axes.centerU).toBeCloseTo(15.5 / 32, 10);
    expect(axes.dashH).toBe(true);
  });

  test('widthL0=31 L1: axis falls between L1 cells 7 and 8 (solid)', () => {
    const layer = makeLayer('a', 1);
    const axes = mirrorOverlayAxes(layer, { widthL0: 31, heightL0: 31 });
    // L1 window 0..15 → cellCx2 = 15 (odd) → axis at cell-coord 8 → UV 16/32.
    expect(axes.centerU).toBeCloseTo(16 / 32, 10);
    expect(axes.dashH).toBe(false);
  });

  test('widthL0=15 L1: axis on cell-4 border (solid)', () => {
    const layer = makeLayer('a', 1);
    const axes = mirrorOverlayAxes(layer, { widthL0: 15, heightL0: 32 });
    // L1 window 0..7 (8 cells) → cellCx2 = 7 (odd) → axis at cell-coord 4 → UV 8/32.
    expect(axes.centerU).toBeCloseTo(8 / 32, 10);
    expect(axes.dashH).toBe(false);
  });

  test('widthL0=14 L1: 7-cell window, axis through cell-3 center (dashed)', () => {
    const layer = makeLayer('a', 1);
    const axes = mirrorOverlayAxes(layer, { widthL0: 14, heightL0: 32 });
    // L1 window 0..6 (7 cells) → cellCx2 = 6 (even) → axis at 3.5 →
    // UV 7/32.
    expect(axes.centerU).toBeCloseTo(7 / 32, 10);
    expect(axes.dashH).toBe(true);
  });

  test('shifted-Y L1 widthL0=32: vertical axis through cell center (dashed)', () => {
    const layer = makeLayer('a', 1);
    layer.shiftY = 0.5;
    const axes = mirrorOverlayAxes(layer, { widthL0: 32, heightL0: 32 });
    // shifted L1: canvas window cells -1..15 (17 cells), cellCy2 = 14
    // (even) → axis at 7.5 → through cell 7 (in shifted L1).
    // Cell 7 shifted: L0 [15, 17). Cell-coord 7.5 → L0 (7.5+0.5)*2 = 16.
    // UV = 16/32 = 0.5.
    expect(axes.centerV).toBeCloseTo(0.5, 10);
    expect(axes.dashV).toBe(true);
  });

  test('clipBox partial canvas: axis follows effective dims', () => {
    const layer = makeLayer('a', 1);
    // 28-wide canvas inset at L0 (2,2) — pass the effective dims that
    // `effectiveCanvasDims` would yield for a clipBox of width 28.
    // L1 cellsPerL0=2, sL0X=0. startCellX=floor(2/2)=1.
    // endCellX=ceil((2+28)/2)=15. Window cells 1..14 (14 cells),
    // cellCx2 = 1+14 = 15 (odd) → axis at cell-coord 8 → L0 16 → UV 0.5.
    const axes = mirrorOverlayAxes(layer, {
      widthL0: 28, heightL0: 28,
      originL0X: 2, originL0Y: 2,
    });
    expect(axes.centerU).toBeCloseTo(16 / 32, 10);
    expect(axes.centerV).toBeCloseTo(16 / 32, 10);
    expect(axes.dashH).toBe(false);
    expect(axes.dashV).toBe(false);
  });

  test('widthL0=32 L1: within-half axes at cell-coord 4 and 12 (solid)', () => {
    const layer = makeLayer('a', 1);
    const axes = mirrorOverlayAxes(layer, { widthL0: 32, heightL0: 32 });
    // Window 0..15 (cellCx2=15 odd). Halves [0,7] and [8,15].
    // halvesX.first  = 0+7 = 7 (odd → solid). Axis cell-coord = 4 → UV 8/32.
    // halvesX.second = 8+15 = 23 (odd → solid). Axis cell-coord = 12 → UV 24/32.
    expect(axes.firstHalfU).toBeCloseTo(8 / 32, 10);
    expect(axes.secondHalfU).toBeCloseTo(24 / 32, 10);
    expect(axes.dashQuadH).toBe(false);
  });

  test('widthL0=14 L1: 7-cell window, within-half axes through cell centers (dashed)', () => {
    const layer = makeLayer('a', 1);
    const axes = mirrorOverlayAxes(layer, { widthL0: 14, heightL0: 14 });
    // Window 0..6 (7 cells, cellCx2=6 even, midCell=3). Halves [0,2] and [4,6].
    // halvesX.first  = 0+2 = 2 (even → dashed). Axis cell-coord = 1.5 → UV 3/32.
    // halvesX.second = 4+6 = 10 (even → dashed). Axis cell-coord = 5.5 → UV 11/32.
    expect(axes.firstHalfU).toBeCloseTo(3 / 32, 10);
    expect(axes.secondHalfU).toBeCloseTo(11 / 32, 10);
    expect(axes.dashQuadH).toBe(true);
  });

  test('widthL0=20 L1: 10-cell window, within-half axes through cell centers (dashed)', () => {
    const layer = makeLayer('a', 1);
    const axes = mirrorOverlayAxes(layer, { widthL0: 20, heightL0: 20 });
    // Window 0..9 (cellCx2=9 odd). Halves [0,4] and [5,9].
    // halvesX.first  = 0+4 = 4 (even → dashed). Axis cell-coord = 2.5 → UV 5/32.
    // halvesX.second = 5+9 = 14 (even → dashed). Axis cell-coord = 7.5 → UV 15/32.
    expect(axes.firstHalfU).toBeCloseTo(5 / 32, 10);
    expect(axes.secondHalfU).toBeCloseTo(15 / 32, 10);
    expect(axes.dashQuadH).toBe(true);
  });

  test('diagCenter is the canvas-L0 largest-square center, layer-independent', () => {
    // Square 32×32 L0: centered square = whole canvas, center at L0 (16,16) = UV 0.5.
    const l0 = makeLayer('a', 0);
    const a32L0 = mirrorOverlayAxes(l0, { widthL0: 32, heightL0: 32 });
    expect(a32L0.diagCenterU).toBeCloseTo(0.5, 10);
    expect(a32L0.diagCenterV).toBeCloseTo(0.5, 10);

    // Square 32×32 L1: same canvas, same pivot.
    const l1 = makeLayer('a', 1);
    const a32L1 = mirrorOverlayAxes(l1, { widthL0: 32, heightL0: 32 });
    expect(a32L1.diagCenterU).toBeCloseTo(0.5, 10);
    expect(a32L1.diagCenterV).toBeCloseTo(0.5, 10);

    // 31×31 L0: square pivot = L0 (15.5, 15.5).
    const a31L0 = mirrorOverlayAxes(l0, { widthL0: 31, heightL0: 31 });
    expect(a31L0.diagCenterU).toBeCloseTo(15.5 / 32, 10);
    expect(a31L0.diagCenterV).toBeCloseTo(15.5 / 32, 10);

    // Non-square 32×22 at L1 (origin Y=4). L0-based square pivot:
    //   X = 0 + (32-22)/2 + 11 = 16; Y = 4 + (22-22)/2 + 11 = 15 → L0 (16, 15).
    // This matches canvas geometric center (16, 4+11) — fixed in the
    // 2026-05 axis-alignment refactor (previously L0 (15, 15) from
    // cell-window-floored math).
    const aMS = mirrorOverlayAxes(l1, { widthL0: 32, heightL0: 22, originL0X: 0, originL0Y: 4 });
    expect(aMS.diagCenterU).toBeCloseTo(16 / 32, 10);
    expect(aMS.diagCenterV).toBeCloseTo(15 / 32, 10);
  });

  test('diagCenter == H/V crossing for 12×14 L1 across all shift combinations', () => {
    // The bug: shifting layer L1 by 0.5 on only X or only Y exposed the -1
    // edge cell, flipped windowCell* parity, and floored the centered-square
    // offset asymmetrically — drifting the diag axis off the H/V crossing
    // point. Shifting both axes (or neither) accidentally re-aligned them.
    // The L0-based pivot is shift-independent, so all four combinations
    // now cross at canvas center L0 (12, 14).
    for (const shiftX of [0, 0.5] as const) {
      for (const shiftY of [0, 0.5] as const) {
        const layer = makeLayer('a', 1);
        layer.shiftX = shiftX;
        layer.shiftY = shiftY;
        const axes = mirrorOverlayAxes(layer, { widthL0: 24, heightL0: 28 });
        expect(axes.diagCenterU).toBeCloseTo(axes.centerU, 10);
        expect(axes.diagCenterV).toBeCloseTo(axes.centerV, 10);
        expect(axes.diagCenterU).toBeCloseTo(12 / 32, 10);
        expect(axes.diagCenterV).toBeCloseTo(14 / 32, 10);
      }
    }
  });

  test('diagCenter == H/V crossing on 11×13 at L0..L3 (non-divisible widths)', () => {
    // User report: on an 11×13 file the diag axis drifted off the H/V
    // crossing for L2 and L3 because L0 width doesn't divide cleanly
    // into the cell size at those levels. The cell-window-derived
    // H/V midpoints land at quantised positions; the diag pivot has
    // to follow so all three axes still cross at one point.
    for (const level of [0, 1, 2, 3] as const) {
      const layer = makeLayer('a', level);
      const axes = mirrorOverlayAxes(layer, { widthL0: 11, heightL0: 13 });
      expect(axes.diagCenterU).toBeCloseTo(axes.centerU, 10);
      expect(axes.diagCenterV).toBeCloseTo(axes.centerV, 10);
    }
  });

  test('diagCenter == H/V crossing on 10×13 at L0..L3 (non-divisible widths)', () => {
    for (const level of [0, 1, 2, 3] as const) {
      const layer = makeLayer('a', level);
      const axes = mirrorOverlayAxes(layer, { widthL0: 10, heightL0: 13 });
      expect(axes.diagCenterU).toBeCloseTo(axes.centerU, 10);
      expect(axes.diagCenterV).toBeCloseTo(axes.centerV, 10);
    }
  });

  test('widthL0=18 L2: axis at cell-window center, not canvas geometric center', () => {
    // 9×5 L1 canvas = 18×10 L0. At L2 (cellsPerL0=4) there are 4.5
    // columns: cells 0–4 where cell 4 is partial. The cell-window axis
    // is at cellCx2 = 0+4 = 4 → cell-coord 2.5 → L0 10.0, NOT the
    // canvas geometric center at L0 9.0.
    const layer = makeLayer('a', 2);
    const axes = mirrorOverlayAxes(layer, { widthL0: 18, heightL0: 10 });
    expect(axes.centerU).toBeCloseTo(10 / 32, 10);
    expect(axes.centerV).toBeCloseTo(6 / 32, 10);
    // cellCx2=4 (even) → dashed; cellCy2=2 (even) → dashed
    expect(axes.dashH).toBe(true);
    expect(axes.dashV).toBe(true);
  });
});

describe('mirror axis consistency (overlay vs paintMirror)', () => {
  // On canvases whose L0 dims don't divide evenly into the active
  // layer's cell size, the cell-window axis diverges from the canvas
  // geometric center. Both the overlay and the paint engine must use
  // the cell-window axis so the drawn mirror line matches the actual
  // mirroring. This test pins that contract.

  const NO_FLAGS: MirrorFlags = {
    mirrorH: false, mirrorV: false, mirrorRotate: false,
    mirrorQuad: false, mirrorRow: false, mirrorCol: false,
    mirrorDiag1: false, mirrorDiag2: false, mirrorDiagBoth: false,
    mirrorStar: false,
  };

  test('widthL0=18 L2 mirrorH: cell 2 is on the axis', () => {
    const layer = makeLayer('a', 2);
    const cfg = { widthL0: 18, heightL0: 10 };
    const flags = { ...NO_FLAGS, mirrorH: true };
    // Cell-window: cells 0..4, cellCx2=4, axis at cell 2.
    const sym = computeMirrorSymmetry(2, 1, layer, cfg, flags);
    expect(sym).toBeDefined();
    expect(sym!.h).toBe(true);
  });

  test('widthL0=18 L2 mirrorH: cell 1 is NOT on the axis', () => {
    const layer = makeLayer('a', 2);
    const cfg = { widthL0: 18, heightL0: 10 };
    const flags = { ...NO_FLAGS, mirrorH: true };
    const sym = computeMirrorSymmetry(1, 1, layer, cfg, flags);
    expect(sym).toBeUndefined();
  });

  test('widthL0=18 L2 mirrorH: targets use cell-window axis (cell 1 ↔ cell 3)', () => {
    const layer = makeLayer('a', 2);
    const cfg = { widthL0: 18, heightL0: 10 };
    const flags = { ...NO_FLAGS, mirrorH: true };
    const targets = computePaintMirrorTargets(1, 1, layer, cfg, flags);
    expect(targets.length).toBe(1);
    expect(targets[0].x).toBe(3);
  });

  test('widthL0=18 L2 mirrorH: cell 0 mirrors to partial cell 4', () => {
    const layer = makeLayer('a', 2);
    const cfg = { widthL0: 18, heightL0: 10 };
    const flags = { ...NO_FLAGS, mirrorH: true };
    const targets = computePaintMirrorTargets(0, 1, layer, cfg, flags);
    expect(targets.length).toBe(1);
    expect(targets[0].x).toBe(4);
  });

  test('widthL0=18 L2 mirrorH: axis cell 2 has no external targets (self-mirror)', () => {
    const layer = makeLayer('a', 2);
    const cfg = { widthL0: 18, heightL0: 10 };
    const flags = { ...NO_FLAGS, mirrorH: true };
    const targets = computePaintMirrorTargets(2, 1, layer, cfg, flags);
    expect(targets.length).toBe(0);
  });
});
