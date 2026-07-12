import {
  Layer,
  GridLevel,
  CellState,
  CELL_COUNTS,
  editableCells,
  UndoOp,
  Tool,
  markFullDirty,
} from './types';
import {
  isCellInRegionPx,
  RegionBoundsPx,
  applyCellEdit,
  rebuildPixelData,
  applyActiveTint,
} from './cells';
import { pickRandomCompatibleSprite, mirrorCellState } from './connectivity';
import {
  computeMirrorSymmetry,
  forEachMirrorTarget,
  type MirrorFlags,
  type MirrorCellWindow,
} from './paintMirror';
import { L0PointIndex } from './spatialIndex';
import { canvasCellWindow, isCellFullyInsideCanvas, CanvasConfig } from './canvas-bounds';

export interface MultiresFillParams {
  layers: Layer[];
  activeLayerId: string;
  tool: Tool;
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
  allowBorderConnections: boolean;
  excludedFamilies?: Set<string>;
  fillRegion?: RegionBoundsPx;
  canvasWidthL0: number;
  canvasHeightL0: number;
  activeColorR?: number;
  activeColorG?: number;
  activeColorB?: number;
  originL0X?: number;
  originL0Y?: number;
  /** When true, cells whose rectangle isn't fully inside the canvas extent
   *  are skipped (clip-cut tiles, half-cell strips on shifted layers). */
  excludePartialTiles?: boolean;
}

export interface MultiresFillResult {
  ops: UndoOp[];
  affectedLayers: Layer[];
}

interface TierTarget {
  layer: Layer;
  level: GridLevel;
  maxCellX: number;
  maxCellY: number;
}

/**
 * Converts a cell at a given level to the set of L0 indices it covers,
 * expressed as canvas-relative flat indices `ly * canvasWidthL0 + lx`.
 * Cells whose L0 footprint falls outside the canvas window are excluded.
 */
function cellToL0Set(
  cx: number, cy: number,
  level: GridLevel,
  shiftX: 0 | 0.5, shiftY: 0 | 0.5,
  canvasWidthL0: number, canvasHeightL0: number,
  originL0X: number, originL0Y: number,
): number[] {
  const scale = CELL_COUNTS[0] / CELL_COUNTS[level];
  // Shift expressed in L0 cells
  const shiftL0X = Math.round(shiftX * scale);
  const shiftL0Y = Math.round(shiftY * scale);
  // Canvas-relative L0 coords so the flat index space is [0, canvasWidthL0).
  const startX = cx * scale + shiftL0X - originL0X;
  const startY = cy * scale + shiftL0Y - originL0Y;
  const result: number[] = [];
  for (let dy = 0; dy < scale; dy++) {
    const ly = startY + dy;
    if (ly < 0 || ly >= canvasHeightL0) continue;
    for (let dx = 0; dx < scale; dx++) {
      const lx = startX + dx;
      if (lx < 0 || lx >= canvasWidthL0) continue;
      result.push(ly * canvasWidthL0 + lx);
    }
  }
  return result;
}

/**
 * Check if all L0 cells covered by a given cell are unoccupied. Cells whose
 * L0 footprint falls outside the canvas window are reported as "occupied"
 * so the caller skips them.
 */
function isCellUnoccupied(
  cx: number, cy: number,
  level: GridLevel,
  shiftX: 0 | 0.5, shiftY: 0 | 0.5,
  occupiedL0: Set<number>,
  canvasWidthL0: number, canvasHeightL0: number,
  originL0X: number, originL0Y: number,
): boolean {
  const scale = CELL_COUNTS[0] / CELL_COUNTS[level];
  const shiftL0X = Math.round(shiftX * scale);
  const shiftL0Y = Math.round(shiftY * scale);
  const startX = cx * scale + shiftL0X - originL0X;
  const startY = cy * scale + shiftL0Y - originL0Y;
  for (let dy = 0; dy < scale; dy++) {
    const ly = startY + dy;
    if (ly < 0 || ly >= canvasHeightL0) return false;
    for (let dx = 0; dx < scale; dx++) {
      const lx = startX + dx;
      if (lx < 0 || lx >= canvasWidthL0) return false;
      if (occupiedL0.has(ly * canvasWidthL0 + lx)) return false;
    }
  }
  return true;
}

/**
 * Mark L0 cells covered by a cell as occupied.
 */
function markL0Occupied(
  cx: number, cy: number,
  level: GridLevel,
  shiftX: 0 | 0.5, shiftY: 0 | 0.5,
  occupiedL0: Set<number>,
  canvasWidthL0: number, canvasHeightL0: number,
  originL0X: number, originL0Y: number,
): void {
  const indices = cellToL0Set(cx, cy, level, shiftX, shiftY, canvasWidthL0, canvasHeightL0, originL0X, originL0Y);
  for (let i = 0; i < indices.length; i++) {
    occupiedL0.add(indices[i]);
  }
}

/**
 * Collect candidate cells on a layer whose entire L0 footprint is unoccupied.
 * Iterates the layer cells covered by the canvas window, not the layer's
 * upper-left.
 */
function collectCandidates(
  layer: Layer,
  occupiedL0: Set<number>,
  canvasCfg: CanvasConfig,
  fillRegion?: RegionBoundsPx,
  excludePartialTiles?: boolean,
): { cx: number; cy: number }[] {
  const w = canvasCellWindow(layer, canvasCfg);
  const oX = canvasCfg.originL0X ?? 0;
  const oY = canvasCfg.originL0Y ?? 0;
  const candidates: { cx: number; cy: number }[] = [];
  for (let y = w.mainStartY; y < w.endCellY; y++) {
    for (let x = w.mainStartX; x < w.endCellX; x++) {
      // Skip already-filled cells
      if (layer.cells[y]?.[x] != null) continue;
      // Region bounds check
      if (fillRegion && !isCellInRegionPx(x, y, layer, fillRegion)) continue;
      // Partial-tile skip — cells whose rectangle extends past the canvas
      if (excludePartialTiles && !isCellFullyInsideCanvas(layer, x, y, canvasCfg)) continue;
      // Check L0 occupancy
      if (!isCellUnoccupied(x, y, layer.level, layer.shiftX, layer.shiftY, occupiedL0, canvasCfg.widthL0, canvasCfg.heightL0, oX, oY)) continue;
      candidates.push({ cx: x, cy: y });
    }
  }
  return candidates;
}

/**
 * Select target layers: from visible, unlocked layers, group by grid level.
 * For each level, pick the first layer by order. Sort by level descending (coarsest first).
 * Returns at least 2 distinct levels, or null to fall back.
 */
export function selectTargetLayers(layers: Layer[]): TierTarget[] | null {
  const eligible = layers.filter(l => l.visible && !l.locked);
  // Group by level, pick lowest order in each group
  const byLevel = new Map<GridLevel, Layer>();
  for (const l of eligible) {
    const existing = byLevel.get(l.level);
    if (!existing || l.order < existing.order) {
      byLevel.set(l.level, l);
    }
  }
  if (byLevel.size < 2) return null;

  const tiers: TierTarget[] = [];
  for (const [level, layer] of byLevel) {
    tiers.push({
      layer,
      level,
      maxCellX: editableCells(32, level), // will be overridden with actual canvas dims
      maxCellY: editableCells(32, level),
    });
  }
  // Sort by level descending, coarsest first (higher level = coarser = fewer cells)
  // Level 4 = 2 cells (coarsest), Level 0 = 32 cells (finest)
  tiers.sort((a, b) => b.level - a.level);
  return tiers;
}

/**
 * Build initial L0 occupancy set from all visible layers. Each layer is
 * scanned over its canvas-window cell range so non-zero-origin canvases
 * don't pick up phantom occupancy in the layer's pre-origin strip.
 */
function buildL0Occupancy(
  layers: Layer[],
  canvasCfg: CanvasConfig,
): Set<number> {
  const occupied = new Set<number>();
  const oX = canvasCfg.originL0X ?? 0;
  const oY = canvasCfg.originL0Y ?? 0;
  for (const layer of layers) {
    if (!layer.visible) continue;
    const w = canvasCellWindow(layer, canvasCfg);
    for (let y = w.mainStartY; y < w.endCellY; y++) {
      const row = layer.cells[y];
      if (!row) continue;
      for (let x = w.mainStartX; x < w.endCellX; x++) {
        if (row[x] != null) {
          markL0Occupied(x, y, layer.level, layer.shiftX, layer.shiftY, occupied, canvasCfg.widthL0, canvasCfg.heightL0, oX, oY);
        }
      }
    }
  }
  return occupied;
}

/**
 * Shuffle array in-place using Fisher-Yates.
 */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Async multires fill: distributes random sprites across multiple layers at different
 * grid levels simultaneously. 25% at the coarsest tier, 40% at each middle tier,
 * rest at the finest.
 */
export async function multiresFillAsync(params: MultiresFillParams): Promise<MultiresFillResult> {
  const {
    layers, mirrorH, mirrorV, mirrorRotate, mirrorQuad, mirrorRow, mirrorCol,
    mirrorDiag1, mirrorDiag2, mirrorDiagBoth, mirrorStar,
    allowBorderConnections, excludedFamilies, fillRegion,
    canvasWidthL0, canvasHeightL0,
    activeColorR: acR = 255, activeColorG: acG = 255, activeColorB: acB = 255,
    originL0X: _originL0X = 0, originL0Y: _originL0Y = 0,
    excludePartialTiles = false,
  } = params;
  const hasActiveColor = acR !== 255 || acG !== 255 || acB !== 255;

  const tiers = selectTargetLayers(layers);
  if (!tiers || tiers.length < 2) {
    // Fallback: should not be called, but return empty
    return { ops: [], affectedLayers: [] };
  }

  // Update maxCell values with actual canvas dimensions
  for (const tier of tiers) {
    tier.maxCellX = editableCells(canvasWidthL0, tier.level);
    tier.maxCellY = editableCells(canvasHeightL0, tier.level);
  }

  const ops: UndoOp[] = [];
  const affectedLayers: Layer[] = [];
  const hasMirror = mirrorH || mirrorV || mirrorRotate || mirrorQuad || mirrorRow || mirrorCol || mirrorDiag1 || mirrorDiag2 || mirrorDiagBoth || mirrorStar;

  const canvasCfg: CanvasConfig = {
    widthL0: canvasWidthL0, heightL0: canvasHeightL0,
    originL0X: _originL0X, originL0Y: _originL0Y,
  };

  // Clear target layers before filling (same strategy as random flood fill).
  // Save pre-clear states so undo ops restore to original content.
  // Key: "layerId:cx,cy" → old CellState
  const preClearStates = new Map<string, CellState>();
  for (const tier of tiers) {
    const layer = tier.layer;
    if (!affectedLayers.includes(layer)) affectedLayers.push(layer);
    const w = canvasCellWindow(layer, canvasCfg);
    for (let y = w.mainStartY; y < w.endCellY; y++) {
      const row = layer.cells[y];
      if (!row) continue;
      for (let x = w.mainStartX; x < w.endCellX; x++) {
        if (fillRegion && !isCellInRegionPx(x, y, layer, fillRegion)) continue;
        if (excludePartialTiles && !isCellFullyInsideCanvas(layer, x, y, canvasCfg)) continue;
        const old = row[x];
        if (old != null) {
          preClearStates.set(`${layer.id}\0${x}\0${y}`, old);
          applyCellEdit(layer, x, y, null);
        }
      }
    }
  }

  // Build L0 occupancy after clearing target layers
  const occupiedL0 = buildL0Occupancy(layers, canvasCfg);

  // Build a spatial index for constraint queries (after clearing)
  const index = new L0PointIndex();
  index.buildFromLayers(layers);

  // Yield helper
  let lastYield = performance.now();
  const maybeYield = async () => {
    if (performance.now() - lastYield >= 5) {
      await new Promise<void>(r => setTimeout(r, 0));
      lastYield = performance.now();
    }
  };

  const mFlags: MirrorFlags = { mirrorH, mirrorV, mirrorRotate, mirrorQuad, mirrorRow, mirrorCol, mirrorDiag1, mirrorDiag2, mirrorDiagBoth, mirrorStar };
  const mPartialCfg = excludePartialTiles ? canvasCfg : null;
  // Per-cell mirror context, mutated before each forEachMirrorTarget call so
  // the callback stays hoisted out of the per-cell loop (no per-cell closure
  // alloc).
  let mCurrentLayer: Layer | null = null;
  let mCurrentNewState: CellState = null;
  const applyMirror = (tx: number, ty: number, mH: boolean, mV: boolean, rot: 0 | 90 | 180 | 270) => {
    const l = mCurrentLayer!;
    if (!isCellUnoccupied(tx, ty, l.level, l.shiftX, l.shiftY, occupiedL0, canvasWidthL0, canvasHeightL0, _originL0X, _originL0Y)) return;
    const mOld = getOldState(l.id, tx, ty, l);
    const mState = mirrorCellState(mCurrentNewState, mH, mV, rot);
    applyCellEdit(l, tx, ty, mState);
    index.insertCell(l, tx, ty);
    markL0Occupied(tx, ty, l.level, l.shiftX, l.shiftY, occupiedL0, canvasWidthL0, canvasHeightL0, _originL0X, _originL0Y);
    ops.push({ op: 'cell', layerId: l.id, cellX: tx, cellY: ty, oldState: mOld, newState: mState });
  };

  // Look up the pre-clear state for a cell (falls back to current state)
  const getOldState = (layerId: string, cx: number, cy: number, layer: Layer): CellState => {
    return preClearStates.get(`${layerId}\0${cx}\0${cy}`) ?? layer.cells[cy]?.[cx] ?? null;
  };

  // Fill a single cell + its mirrors, updating occupancy and ops
  const fillCell = (
    cx: number, cy: number,
    layer: Layer,
  ): void => {
    // Detect if this cell sits on a mirror line
    const symmetry = hasMirror
      ? computeMirrorSymmetry(cx, cy, layer, canvasCfg, mFlags)
      : undefined;

    const oldState = getOldState(layer.id, cx, cy, layer);
    let newState = pickRandomCompatibleSprite(
      cx, cy, layer, layers, allowBorderConnections, excludedFamilies,
      undefined, canvasWidthL0, canvasHeightL0, index, symmetry,
      _originL0X, _originL0Y,
    );
    if (hasActiveColor) newState = applyActiveTint(newState, acR, acG, acB);
    applyCellEdit(layer, cx, cy, newState);
    index.insertCell(layer, cx, cy);
    markL0Occupied(cx, cy, layer.level, layer.shiftX, layer.shiftY, occupiedL0, canvasWidthL0, canvasHeightL0, _originL0X, _originL0Y);
    ops.push({ op: 'cell', layerId: layer.id, cellX: cx, cellY: cy, oldState, newState });

    // Apply mirrors
    if (hasMirror) {
      const w = canvasCellWindow(layer, canvasCfg);
      const mWindow: MirrorCellWindow = { minCellX: w.edgeMinCellX, endCellX: w.endCellX, minCellY: w.edgeMinCellY, endCellY: w.endCellY };
      mCurrentLayer = layer;
      mCurrentNewState = newState;
      forEachMirrorTarget(cx, cy, layer, canvasCfg, mFlags, mWindow, mPartialCfg, applyMirror);
    }
  };

  // Mirror multiplier: each placed cell produces this many visual cells
  const mirrorMultiplier = mirrorStar ? 8
    : mirrorQuad ? 16
    : (mirrorRow || mirrorCol) ? 4
    : mirrorDiagBoth ? 4
    : (mirrorDiag1 || mirrorDiag2) ? 2
    : mirrorRotate ? 4
    : (mirrorH && mirrorV) ? 4
    : (mirrorH || mirrorV) ? 2
    : 1;

  // Process tiers: coarsest first, then second, then finest (all remaining)
  for (let tierIdx = 0; tierIdx < tiers.length; tierIdx++) {
    const tier = tiers[tierIdx];
    const layer = tier.layer;
    if (!affectedLayers.includes(layer)) affectedLayers.push(layer);

    const candidates = collectCandidates(layer, occupiedL0, canvasCfg, fillRegion, excludePartialTiles);
    if (candidates.length === 0) continue;

    let fillCount: number;
    if (tierIdx === 0) {
      // Coarsest tier: 25%
      fillCount = Math.max(1, Math.floor(candidates.length * 0.25 / mirrorMultiplier));
    } else if (tierIdx < tiers.length - 1) {
      // Middle tiers: 40%
      fillCount = Math.max(1, Math.floor(candidates.length * 0.40 / mirrorMultiplier));
    } else {
      // Finest tier: fill all remaining
      fillCount = candidates.length;
    }

    // Shuffle and pick
    shuffle(candidates);

    let filled = 0;
    for (let i = 0; i < candidates.length && filled < fillCount; i++) {
      const { cx, cy } = candidates[i];
      // Re-check occupancy (may have been claimed by mirrors of earlier cells)
      if (!isCellUnoccupied(cx, cy, layer.level, layer.shiftX, layer.shiftY, occupiedL0, canvasWidthL0, canvasHeightL0, _originL0X, _originL0Y)) continue;
      if (layer.cells[cy]?.[cx] != null) continue;

      fillCell(cx, cy, layer);
      filled++;
      await maybeYield();
    }
  }

  // Emit ops for cells that were cleared but not refilled
  const filledKeys = new Set(ops.map(op => op.op === 'cell' ? `${op.layerId}\0${op.cellX}\0${op.cellY}` : ''));
  for (const [key, oldState] of preClearStates) {
    if (filledKeys.has(key)) continue;
    const parts = key.split('\0');
    ops.push({ op: 'cell', layerId: parts[0], cellX: parseInt(parts[1]), cellY: parseInt(parts[2]), oldState, newState: null });
  }

  // Batch render: rebuild pixel data for each affected layer
  for (const layer of affectedLayers) {
    rebuildPixelData(layer);
    markFullDirty(layer);
  }

  return { ops, affectedLayers };
}

