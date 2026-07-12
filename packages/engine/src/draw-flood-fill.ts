/**
 * Draw flood fill: fills a grid region with a spiral-order connected stroke.
 * Each tile gets exact connections toward its spiral neighbors.
 * Pure logic — no JSX.
 */

import {
  Layer,
  UndoOp,
  CellState,
  cellPx,
} from './types';
import { getSpiralCellOrderInRect } from './tile-grid';
import {
  getCandidatesWithExactConnections,
  getCandidatesWithConnectionCount,
  filterByCrossLayer,
  TileCandidate,
} from './tile-connectivity';
import { getDirectionFromTo } from './draw-stroke';
import {
  applyCellEdit,
  getCell,
  isCellInRegionPx,
  RegionBoundsPx,
  buildCrossLayerOccupancy,
} from './cells';
import { mirrorCellState, ensureMirrorSigLookups, renderedSigPacked } from './connectivity';
import {
  computeMirrorSymmetry,
  forEachMirrorTarget,
  type MirrorFlags,
  type MirrorCellWindow,
} from './paintMirror';
import { canvasCellWindow, isCellFullyInsideCanvas } from './canvas-bounds';

// ── Parameters ──────────────────────────────────────────────────────

export interface DrawFloodFillParams {
  layer: Layer;
  allLayers: Layer[];
  columns: number;
  maxCellX: number;
  maxCellY: number;
  canvasWidthL0: number;
  canvasHeightL0: number;
  canvasOriginL0X: number;
  canvasOriginL0Y: number;
  allowedSourceSet: Set<string> | null;
  mirrorH: boolean;
  mirrorV: boolean;
  mirrorRotate: boolean;
  mirrorQuad: boolean;
  mirrorRow: boolean;
  mirrorCol: boolean;
  mirrorDiag1: boolean;
  mirrorDiag2: boolean;
  mirrorDiagBoth: boolean;
  mirrorStar: boolean;
  regionBounds: RegionBoundsPx | null;
  onlyEmpty?: boolean;
  clearFirst?: boolean;
  /** When true, cells whose rectangle isn't fully inside the canvas extent
   *  are skipped (covers tiles cut off by clip boundaries and tiles pushed
   *  partly off-canvas by half-cell layer shifts). */
  excludePartialTiles?: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────

function pickRandom(candidates: TileCandidate[]): TileCandidate | null {
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function placeCell(
  layer: Layer,
  cx: number,
  cy: number,
  state: CellState,
  ops: UndoOp[],
): void {
  const edit = applyCellEdit(layer, cx, cy, state);
  ops.push({
    op: 'cell',
    layerId: layer.id,
    cellX: cx,
    cellY: cy,
    oldState: edit.oldState,
    newState: state,
  });
}

// ── Main Function ───────────────────────────────────────────────────

export function drawFloodFill(params: DrawFloodFillParams): UndoOp[] {
  const {
    layer, allLayers, columns,
    maxCellX, maxCellY,
    canvasWidthL0, canvasHeightL0,
    canvasOriginL0X, canvasOriginL0Y,
    allowedSourceSet,
    mirrorH, mirrorV, mirrorRotate, mirrorQuad, mirrorRow, mirrorCol,
    mirrorDiag1, mirrorDiag2, mirrorDiagBoth, mirrorStar,
    regionBounds, onlyEmpty, clearFirst, excludePartialTiles,
  } = params;

  const ops: UndoOp[] = [];
  const size = cellPx(layer.level);
  const shiftPxX = layer.shiftX * size;
  const shiftPxY = layer.shiftY * size;

  // Canvas window in this layer's cell-index space. When canvas origin is
  // (0,0) this reduces to mainStartX = 0, endCellX = editableCells(...).
  const canvasCfg = {
    widthL0: canvasWidthL0, heightL0: canvasHeightL0,
    originL0X: canvasOriginL0X, originL0Y: canvasOriginL0Y,
  };
  const cw = canvasCellWindow(layer, canvasCfg);

  // Compute cell-space bounds
  let minRow: number, minCol: number, maxRow: number, maxCol: number;
  if (regionBounds) {
    minCol = Math.max(cw.mainStartX, Math.floor((regionBounds.pxMinX - shiftPxX) / size));
    minRow = Math.max(cw.mainStartY, Math.floor((regionBounds.pxMinY - shiftPxY) / size));
    maxCol = Math.min(cw.endCellX - 1, Math.ceil((regionBounds.pxMaxX - shiftPxX) / size) - 1);
    maxRow = Math.min(cw.endCellY - 1, Math.ceil((regionBounds.pxMaxY - shiftPxY) / size) - 1);
  } else {
    minRow = cw.mainStartY;
    minCol = cw.mainStartX;
    maxRow = cw.endCellY - 1;
    maxCol = cw.endCellX - 1;
  }

  if (maxRow < minRow || maxCol < minCol) return ops;

  // Clear active layer first when clearFirst is set
  if (clearFirst) {
    for (let cy = minRow; cy <= maxRow; cy++) {
      const row = layer.cells[cy];
      if (!row) continue;
      for (let cx = minCol; cx <= maxCol; cx++) {
        if (row[cx] != null) {
          if (excludePartialTiles && !isCellFullyInsideCanvas(layer, cx, cy, canvasCfg)) continue;
          const edit = applyCellEdit(layer, cx, cy, null);
          ops.push({ op: 'cell', layerId: layer.id, cellX: cx, cellY: cy, oldState: edit.oldState, newState: null });
        }
      }
    }
  }

  // Build cross-layer occupancy grid when filling only empty cells
  // When clearFirst, exclude the active layer since it was just cleared
  const occupiedGrid = (onlyEmpty || clearFirst)
    ? buildCrossLayerOccupancy(layer, allLayers, maxCellX, maxCellY, clearFirst ? layer.id : undefined)
    : null;

  // Get spiral ordering
  const spiralCells = getSpiralCellOrderInRect(minRow, minCol, maxRow, maxCol, columns);

  // Filter cells outside region bounds and editable area
  const filtered: number[] = [];
  for (const cellIdx of spiralCells) {
    const cy = Math.floor(cellIdx / columns);
    const cx = cellIdx - cy * columns;
    if (cx < cw.mainStartX || cx >= cw.endCellX || cy < cw.mainStartY || cy >= cw.endCellY) continue;
    if (regionBounds && !isCellInRegionPx(cx, cy, layer, regionBounds)) continue;
    if (excludePartialTiles && !isCellFullyInsideCanvas(layer, cx, cy, canvasCfg)) continue;
    if ((onlyEmpty || clearFirst) && occupiedGrid?.[cy]?.[cx]) continue;
    filtered.push(cellIdx);
  }

  if (filtered.length === 0) return ops;

  // Mirror geometry — flags + window + partial-tile config built once per
  // fill, reused across the per-cell loop. The mirror axis is derived
  // from `canvasCfg` directly inside paintMirror.ts.
  const hasMirror = mirrorH || mirrorV || mirrorRotate || mirrorQuad || mirrorRow || mirrorCol || mirrorDiag1 || mirrorDiag2 || mirrorDiagBoth || mirrorStar;
  const mFlags: MirrorFlags = { mirrorH, mirrorV, mirrorRotate, mirrorQuad, mirrorRow, mirrorCol, mirrorDiag1, mirrorDiag2, mirrorDiagBoth, mirrorStar };
  const mWindow: MirrorCellWindow = { minCellX: cw.edgeMinCellX, endCellX: cw.endCellX, minCellY: cw.edgeMinCellY, endCellY: cw.endCellY };
  const mPartialCfg = excludePartialTiles ? canvasCfg : null;

  const placed = new Set<number>();

  // Per-cell mirror context — mutated before each forEachMirrorTarget call so
  // the callback stays hoisted out of the spiral loop.
  let mPrimaryState: CellState | null = null;
  const applyMirror = (tx: number, ty: number, mH: boolean, mV: boolean, rot: 0 | 90 | 180 | 270) => {
    if ((onlyEmpty || clearFirst) && (tx >= 0 && ty >= 0 ? occupiedGrid?.[ty]?.[tx] : getCell(layer, tx, ty) != null)) return;
    const mKey = ty * columns + tx;
    if (placed.has(mKey)) return;
    placed.add(mKey);
    const mirroredState = mirrorCellState(mPrimaryState!, mH, mV, rot);
    placeCell(layer, tx, ty, mirroredState, ops);
  };

  // Place each cell in spiral order
  for (let i = 0; i < filtered.length; i++) {
    const cellIdx = filtered[i];
    const cy = Math.floor(cellIdx / columns);
    const cx = cellIdx - cy * columns;
    const key = cy * columns + cx;
    if (placed.has(key)) continue;

    // Compute required directions based on spiral neighbors
    const requiredDirs: number[] = [];
    if (filtered.length > 1) {
      if (i > 0) {
        const dir = getDirectionFromTo(cellIdx, filtered[i - 1], columns);
        if (dir >= 0) requiredDirs.push(dir);
      }
      if (i < filtered.length - 1) {
        const dir = getDirectionFromTo(cellIdx, filtered[i + 1], columns);
        if (dir >= 0) requiredDirs.push(dir);
      }
    }

    // Cross-layer constraints still apply so the spiral connects with
    // sprites on other layers, but the canvas-border-connection toggle is
    // intentionally ignored: the draw tool's behaviour must not change
    // when the user flips that switch.
    let candidates = getCandidatesWithExactConnections(requiredDirs, allowedSourceSet);
    candidates = filterByCrossLayer(
      candidates, cx, cy, layer, allLayers,
      true, canvasWidthL0, canvasHeightL0,
      canvasOriginL0X, canvasOriginL0Y,
    );

    // Fallback to connection count match
    if (candidates.length === 0) {
      candidates = getCandidatesWithConnectionCount(requiredDirs.length, allowedSourceSet);
      candidates = filterByCrossLayer(
        candidates, cx, cy, layer, allLayers,
        true, canvasWidthL0, canvasHeightL0,
        canvasOriginL0X, canvasOriginL0Y,
      );
    }

    // Filter by symmetry if this cell sits on a mirror line
    if (hasMirror && candidates.length > 0) {
      const symmetry = computeMirrorSymmetry(cx, cy, layer, canvasCfg, mFlags);
      if (symmetry) {
        const lookups = ensureMirrorSigLookups();
        const filtered: TileCandidate[] = [];
        for (let ci = 0; ci < candidates.length; ci++) {
          const c = candidates[ci];
          const sig = renderedSigPacked(c.entry.id, c.transform);
          if (sig === 0xFFFF) { filtered.push(c); continue; } // unconstrained
          if (symmetry.h && sig !== lookups.h[sig]) continue;
          if (symmetry.v && sig !== lookups.v[sig]) continue;
          if (symmetry.d1 && sig !== lookups.d1[sig]) continue;
          if (symmetry.d2 && sig !== lookups.d2[sig]) continue;
          filtered.push(c);
        }
        if (filtered.length > 0) candidates = filtered;
      }
    }

    const chosen = pickRandom(candidates);
    if (!chosen) continue;

    const cellState: CellState = {
      type: 'sprite',
      spriteId: chosen.entry.id,
      transform: { ...chosen.transform },
    };

    placeCell(layer, cx, cy, cellState, ops);
    placed.add(key);

    // Apply mirrors
    if (hasMirror) {
      mPrimaryState = cellState;
      forEachMirrorTarget(cx, cy, layer, canvasCfg, mFlags, mWindow, mPartialCfg, applyMirror);
    }
  }

  return ops;
}
