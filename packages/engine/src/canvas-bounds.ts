/**
 * Canvas-window geometry helpers.
 *
 * The canvas occupies L0 coords [originL0X, originL0X + widthL0) x
 * [originL0Y, originL0Y + heightL0) within the 32x32 layer space. Code that
 * mixes layer-cell, layer-pixel, and L0 spaces was duplicated across
 * cells.ts, multires-fill.ts, draw-flood-fill.ts, connectivity.ts, and
 * bake.ts. Centralising here keeps the math in one place so non-zero-origin
 * canvases stay correct as new code is added.
 *
 * When `originL0X` and `originL0Y` default to 0 (the legacy / 32x32 case),
 * every helper here reduces to the pre-resizeCanvas expressions.
 */

import { Layer, CELL_COUNTS, cellPx } from './types';
import type { RegionBoundsPx } from './cells';

export interface CanvasConfig {
  widthL0: number;
  heightL0: number;
  originL0X?: number;
  originL0Y?: number;
}

export interface CanvasCellWindow {
  /** Layer-cell index where the canvas begins. May be < 0 for shifted layers
   *  whose pre-origin half-cell strip is exposed. */
  startCellX: number;
  startCellY: number;
  /** One past the last layer-cell index in the canvas. Clamped to
   *  CELL_COUNTS[level]. */
  endCellX: number;
  endCellY: number;
  /** `max(0, start*)` — the natural lower bound for the main grid loop. */
  mainStartX: number;
  mainStartY: number;
  /** Lower bound including the -1 edge index for shift-0.5 layers whose
   *  half-cell strip falls inside the canvas. */
  edgeMinCellX: number;
  edgeMinCellY: number;
}

export function canvasCellWindow(layer: Layer, c: CanvasConfig): CanvasCellWindow {
  const count = CELL_COUNTS[layer.level];
  const cellsPerL0 = 32 / count;
  const sL0X = layer.shiftX * cellsPerL0;
  const sL0Y = layer.shiftY * cellsPerL0;
  const oX = c.originL0X ?? 0;
  const oY = c.originL0Y ?? 0;
  const startCellX = Math.floor((oX - sL0X) / cellsPerL0);
  const startCellY = Math.floor((oY - sL0Y) / cellsPerL0);
  const endCellX = Math.min(count, Math.ceil((oX + c.widthL0 - sL0X) / cellsPerL0));
  const endCellY = Math.min(count, Math.ceil((oY + c.heightL0 - sL0Y) / cellsPerL0));
  const mainStartX = Math.max(0, startCellX);
  const mainStartY = Math.max(0, startCellY);
  const edgeMinCellX = (layer.shiftX === 0.5 && startCellX <= -1) ? -1 : mainStartX;
  const edgeMinCellY = (layer.shiftY === 0.5 && startCellY <= -1) ? -1 : mainStartY;
  return { startCellX, startCellY, endCellX, endCellY, mainStartX, mainStartY, edgeMinCellX, edgeMinCellY };
}

/** Canvas window in this layer's pixel space (i.e. shifted by the layer's
 *  half-cell offset). Aligned to cell-index edges so callers can pass it to
 *  `isCellInRegionPx` and have it accept exactly the cells in the window. */
export function canvasPixelBounds(layer: Layer, c: CanvasConfig): RegionBoundsPx {
  const w = canvasCellWindow(layer, c);
  const size = cellPx(layer.level);
  const shiftPxX = layer.shiftX * size;
  const shiftPxY = layer.shiftY * size;
  return {
    pxMinX: w.mainStartX * size + shiftPxX,
    pxMinY: w.mainStartY * size + shiftPxY,
    pxMaxX: w.endCellX * size + shiftPxX,
    pxMaxY: w.endCellY * size + shiftPxY,
  };
}

/** Canvas window in absolute layer pixel space (no shift). Convenience
 *  helper for callers that need pixel bounds derived from canvas L0 dims
 *  (e.g. `engine/bake.ts`). The mirror engine itself reads `CanvasConfig`
 *  directly — see `engine/paintMirror.ts`. */
export function canvasMirrorBounds(c: CanvasConfig): RegionBoundsPx {
  const l0cpx = cellPx(0);
  const oX = c.originL0X ?? 0;
  const oY = c.originL0Y ?? 0;
  return {
    pxMinX: oX * l0cpx,
    pxMinY: oY * l0cpx,
    pxMaxX: (oX + c.widthL0) * l0cpx,
    pxMaxY: (oY + c.heightL0) * l0cpx,
  };
}

/** Mirror overlay geometry computed at the active layer's resolution.
 *  Mirrors the cellCx2/cellCy2 + within-half axis math used by
 *  `computePaintMirrorTargets` so the rendered overlay tracks where the
 *  engine actually mirrors across (rather than the canvas pixel midpoint,
 *  which drifts off the engine axis at coarser layers on canvases whose
 *  dims don't divide cleanly into the layer's cell size).
 *
 *  Coordinates are in the renderer's UV space — 1.0 = the full LAYER_PX
 *  width, i.e. 32 L0 cells.
 *
 *  Dashed flag: the engine's axis at cell-coord `(cellC*2 + 1) / 2` is on
 *  a cell border when `cellC*2` is odd (mirror swaps cells across the
 *  border) and through a cell's center when even (the cell self-mirrors).
 *  Solid = border, dashed = through-cell-center. Diagonals always bisect
 *  cells diagonally, so the renderer marks them dashed independently.
 *
 *  `dashPeriod` is a fixed UV value (half an L0 cell wide) so the on-screen
 *  dash rhythm stays the same as the user switches between L0 / L1 / L2
 *  layers — only the line position and dashed-ness change. */
export interface MirrorOverlayAxes {
  /** Main canvas H axis (vertical line on screen) UV position. */
  centerU: number;
  /** Main canvas V axis (horizontal line on screen) UV position. */
  centerV: number;
  dashH: boolean;
  dashV: boolean;
  /** Within-half H axes for mirrorQuad / mirrorCol — replaces the prior
   *  25% / 75% canvas-span approximation. By construction both halves
   *  share the same dashedness (the canvas is symmetric about its
   *  centerline), so a single `dashQuadH` covers both. */
  firstHalfU: number;
  secondHalfU: number;
  firstHalfV: number;
  secondHalfV: number;
  dashQuadH: boolean;
  dashQuadV: boolean;
  /** UV size of half an L0 cell. Kept constant across layer levels so the
   *  on-screen dash rhythm stays consistent when the active layer
   *  changes. */
  dashPeriod: number;
  /** Diagonal-axis center — coincides with the H/V crossing point at
   *  `(centerU, centerV)`. Derived from `cellCx2 / cellCy2`, the same
   *  cell-window midpoints the H and V axes use, so the diag always
   *  meets H+V at one point on every canvas (including those whose L0
   *  dims don't divide cleanly into the active layer's cell size — the
   *  cell-window midpoint drifts from canvas geometric center there, but
   *  the diag drifts with it). For divisible canvases this reduces to
   *  canvas geometric center, preserving the 12x14 shifted-layer fix. */
  diagCenterU: number;
  diagCenterV: number;
}

/** Compute the within-half axis (a `cellC*2`-style cell-index sum) for
 *  each side of a symmetric canvas axis, matching the formula used by
 *  the engine's mirrorRow / mirrorCol code path. When the canvas axis
 *  sits on a cell (canvas `cellC*2` even), that cell is excluded from
 *  both halves. */
function halfAxisSums(canvasCx2: number, leftmost: number, end: number): { first: number; second: number } {
  if (canvasCx2 % 2 === 0) {
    const midCell = canvasCx2 / 2;
    return {
      first: leftmost + (midCell - 1),
      second: (midCell + 1) + (end - 1),
    };
  }
  return {
    first: leftmost + (canvasCx2 - 1) / 2,
    second: (canvasCx2 + 1) / 2 + (end - 1),
  };
}

export function mirrorOverlayAxes(layer: Layer, c: CanvasConfig): MirrorOverlayAxes {
  const count = CELL_COUNTS[layer.level];
  const cellsPerL0 = 32 / count;
  const w = canvasCellWindow(layer, c);
  // edgeMinCellX/Y is the cell index where the canvas starts in this
  // layer (matches the leftmost/rightmost convention used by
  // computePaintMirrorTargets).
  const cellCx2 = w.edgeMinCellX + (w.endCellX - 1);
  const cellCy2 = w.edgeMinCellY + (w.endCellY - 1);
  // Convert a cell-window axis (`cellC*2` cell-index sum) to UV.
  // Axis cell-coord = (cellC*2 + 1) / 2; cell k starts at L0
  // (k * cellsPerL0 + shift * cellsPerL0).
  const cellSumToUvX = (cellC2: number): number =>
    ((cellC2 + 1) / 2 * cellsPerL0 + layer.shiftX * cellsPerL0) / 32;
  const cellSumToUvY = (cellC2: number): number =>
    ((cellC2 + 1) / 2 * cellsPerL0 + layer.shiftY * cellsPerL0) / 32;
  const halvesX = halfAxisSums(cellCx2, w.edgeMinCellX, w.endCellX);
  const halvesY = halfAxisSums(cellCy2, w.edgeMinCellY, w.endCellY);
  const centerU = cellSumToUvX(cellCx2);
  const centerV = cellSumToUvY(cellCy2);
  const dashH = cellCx2 % 2 === 0;
  const dashV = cellCy2 % 2 === 0;
  // Diagonal axis center coincides with the H/V crossing point — the
  // engine's MirrorStar diag pivot is derived from the same
  // `cellCx2 / cellCy2` midpoints, so the three axes always meet at one
  // point regardless of canvas dims or layer level.
  const diagCenterU = centerU;
  const diagCenterV = centerV;
  return {
    centerU,
    centerV,
    dashH,
    dashV,
    firstHalfU: cellSumToUvX(halvesX.first),
    secondHalfU: cellSumToUvX(halvesX.second),
    firstHalfV: cellSumToUvY(halvesY.first),
    secondHalfV: cellSumToUvY(halvesY.second),
    // Parities of first/second match by construction (the canvas is
    // symmetric); use either.
    dashQuadH: halvesX.first % 2 === 0,
    dashQuadV: halvesY.first % 2 === 0,
    // Fixed in UV (half an L0 cell wide) — independent of active layer
    // level. The on-screen dash rhythm therefore stays constant when the
    // user switches between L0 / L1 / L2 layers.
    dashPeriod: 1 / 64,
    diagCenterU,
    diagCenterV,
  };
}

/** True when a cell's rectangle is fully inside the canvas/clip extent
 *  (in L0 coordinates). Used by fill operations to skip partial edge tiles —
 *  same rule as the reconcile-time `erasePartialAt` in connectivity.ts. */
export function isCellFullyInsideCanvas(
  layer: Layer, cx: number, cy: number, c: CanvasConfig,
): boolean {
  const S = CELL_COUNTS[0] / CELL_COUNTS[layer.level];
  const xL = (cx + layer.shiftX) * S;
  const xR = xL + S;
  const yT = (cy + layer.shiftY) * S;
  const yB = yT + S;
  const oX = c.originL0X ?? 0;
  const oY = c.originL0Y ?? 0;
  return xL >= oX && xR <= oX + c.widthL0 && yT >= oY && yB <= oY + c.heightL0;
}

/** True when an L0 coordinate is on the canvas border, using the inclusive
 *  `<=` / `>=` semantics that `gatherConstraints` uses to decide whether a
 *  connection point sits on the border edge. */
export function isOnCanvasBorderL0(l0x: number, l0y: number, c: CanvasConfig): boolean {
  const oX = c.originL0X ?? 0;
  const oY = c.originL0Y ?? 0;
  return l0x <= oX || l0x >= oX + c.widthL0 || l0y <= oY || l0y >= oY + c.heightL0;
}
