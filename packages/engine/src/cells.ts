import {
  Layer,
  Tool,
  CellState,
  CellEdit,
  CellTransform,
  DEFAULT_TRANSFORM,
  UndoOp,
  LayerSnapshot,
  GridLevel,
  LAYER_PX,
  CELL_COUNTS,
  LEVEL_LABELS,
  cellPx,
  getPaletteColor,
  EditorState,
  Selection,
  pushDirtyRect,
  markFullDirty,
  initDirtyRects,
  MOD_360,
  editableCells,
  effectiveCanvasDims,
  hideHeavyLayerFields,
  cloneLayer,
} from './types';
import { getScaledTile, SPRITE_ENTRIES } from './loadTile';
import { pickRandomCompatibleSprite, mirrorCellState, RegionBoundsL0 } from './connectivity';
import { L0PointIndex } from './spatialIndex';
import { isCellInPathSelection } from './path-selection';
import { isCellFullyInsideCanvas, type CanvasConfig } from './canvas-bounds';
import {
  forEachMirrorTarget,
  computePaintMirrorTargets,
  type MirrorFlags,
  type MirrorCellWindow,
} from './paintMirror';

export interface PathFilter {
  pathIndices: Set<number>;
  pathLevel: GridLevel;
}

// ── Shared Cell Buffer (avoids 256KB+ allocation per renderCellToBuffer call) ──
const MAX_CELL_PX = 1024; // L4
export const sharedCellBuf = new Uint8Array(MAX_CELL_PX * MAX_CELL_PX * 4);
// Uint32 view of sharedCellBuf — reused to avoid per-call typed array allocations
const sharedCellBufU32 = new Uint32Array(sharedCellBuf.buffer);

// ── Pre-allocated flood fill buffers (avoids per-call array allocations) ──
const _variantBuffers: (Uint8Array | null)[] = new Array(16).fill(null);
const _variantStates: (CellState | undefined)[] = new Array(16);

// Pre-allocated target array for flood fill mirror/rotation targets (max 16)
const _allTargets = [
  { tx: 0, ty: 0, mH: false, mV: false, rot: 0 as 0 | 90 | 180 | 270 },
  { tx: 0, ty: 0, mH: false, mV: false, rot: 0 as 0 | 90 | 180 | 270 },
  { tx: 0, ty: 0, mH: false, mV: false, rot: 0 as 0 | 90 | 180 | 270 },
  { tx: 0, ty: 0, mH: false, mV: false, rot: 0 as 0 | 90 | 180 | 270 },
  { tx: 0, ty: 0, mH: false, mV: false, rot: 0 as 0 | 90 | 180 | 270 },
  { tx: 0, ty: 0, mH: false, mV: false, rot: 0 as 0 | 90 | 180 | 270 },
  { tx: 0, ty: 0, mH: false, mV: false, rot: 0 as 0 | 90 | 180 | 270 },
  { tx: 0, ty: 0, mH: false, mV: false, rot: 0 as 0 | 90 | 180 | 270 },
  { tx: 0, ty: 0, mH: false, mV: false, rot: 0 as 0 | 90 | 180 | 270 },
  { tx: 0, ty: 0, mH: false, mV: false, rot: 0 as 0 | 90 | 180 | 270 },
  { tx: 0, ty: 0, mH: false, mV: false, rot: 0 as 0 | 90 | 180 | 270 },
  { tx: 0, ty: 0, mH: false, mV: false, rot: 0 as 0 | 90 | 180 | 270 },
  { tx: 0, ty: 0, mH: false, mV: false, rot: 0 as 0 | 90 | 180 | 270 },
  { tx: 0, ty: 0, mH: false, mV: false, rot: 0 as 0 | 90 | 180 | 270 },
  { tx: 0, ty: 0, mH: false, mV: false, rot: 0 as 0 | 90 | 180 | 270 },
  { tx: 0, ty: 0, mH: false, mV: false, rot: 0 as 0 | 90 | 180 | 270 },
];
let _allTargetCount = 0;

// ── Transform LUT Cache ─────────────────────────────────────────────
// Pre-computed source-index LUTs for renderCellToBuffer's pixel loop.
// Numeric key: size(11b) | spriteSize(10b) | rotation/90(2b) | mirrorH(1b) | mirrorV(1b)
// where lut[dy*size+dx] = source byte offset in sprite data.
// Very few unique combos (typ. <20), so a simple Map cache suffices.
const _transformLUTCache = new Map<number, Uint32Array>();

function getTransformLUT(
  size: number,
  spriteSize: number,
  rotation: 0 | 90 | 180 | 270,
  mirrorH: boolean,
  mirrorV: boolean,
): Uint32Array {
  const key = (size << 14) | (spriteSize << 4) | (((rotation / 90) | 0) << 2) | (mirrorH ? 2 : 0) | (mirrorV ? 1 : 0);
  let lut = _transformLUTCache.get(key);
  if (lut) return lut;

  const n = size * size;
  lut = new Uint32Array(n);
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      let sx: number, sy: number;
      switch (rotation) {
        case 90:  sx = dy; sy = size - 1 - dx; break;
        case 180: sx = size - 1 - dx; sy = size - 1 - dy; break;
        case 270: sx = size - 1 - dy; sy = dx; break;
        default:  sx = dx; sy = dy; break;
      }
      if (mirrorH) sx = size - 1 - sx;
      if (mirrorV) sy = size - 1 - sy;
      const spx = (sx * spriteSize / size) | 0;
      const spy = (sy * spriteSize / size) | 0;
      lut[dy * size + dx] = (spy * spriteSize + spx) * 4;
    }
  }
  _transformLUTCache.set(key, lut);
  return lut;
}

// ── Cell Grid ──────────────────────────────────────────────────────────

export function createCellGrid(level: GridLevel): (CellState | null)[][] {
  const count = CELL_COUNTS[level];
  const grid: (CellState | null)[][] = [];
  for (let y = 0; y < count; y++) {
    grid[y] = new Array(count).fill(null);
  }
  return grid;
}

// ── Edge Cell Helpers ─────────────────────────────────────────────────

// Edge-cell access moved to ./cellEdge so the pure SVG-export path can use
// it without dragging in the GL/atlas runtime imports above. Imported here
// for in-file use and re-exported for back-compat with existing callers.
import { getCell, setCell } from './cellEdge';
export { getCell, setCell };

export function createEdgeStorage(level: GridLevel, shiftX: 0 | 0.5, shiftY: 0 | 0.5): {
  edgeRowTop: (CellState | null)[] | null;
  edgeColLeft: (CellState | null)[] | null;
  edgeCorner: CellState | null;
} {
  const count = CELL_COUNTS[level];
  return {
    edgeRowTop: shiftY === 0.5 ? new Array(count).fill(null) : null,
    edgeColLeft: shiftX === 0.5 ? new Array(count).fill(null) : null,
    edgeCorner: null,
  };
}

// ── Shift-Aware Cell Index ────────────────────────────────────────────
// Shifted layers have valid cells at coordinate -1 (edgeRowTop / edgeColLeft).
// These helpers linearize cell coords into a non-negative flat index so that
// getDirectionFromTo, getLineCells, and stroke tracking all work correctly.

/** Shift-aware linearization: maps cell coords to a non-negative flat index. */
export function cellToIndex(cellX: number, cellY: number, layer: Layer): number {
  const count = CELL_COUNTS[layer.level];
  const offX = layer.shiftX === 0.5 ? 1 : 0;
  const offY = layer.shiftY === 0.5 ? 1 : 0;
  return (cellY + offY) * (count + offX) + (cellX + offX);
}

/** Scalar X from flat index (avoids object allocation on hot path). */
export function indexToCellX(index: number, layer: Layer): number {
  const offX = layer.shiftX === 0.5 ? 1 : 0;
  return (index % (CELL_COUNTS[layer.level] + offX)) - offX;
}

/** Scalar Y from flat index. */
export function indexToCellY(index: number, layer: Layer): number {
  const offX = layer.shiftX === 0.5 ? 1 : 0;
  const offY = layer.shiftY === 0.5 ? 1 : 0;
  return Math.floor(index / (CELL_COUNTS[layer.level] + offX)) - offY;
}

/** Column count for flat index space (pass to getDirectionFromTo / getLineCells). */
export function indexColumns(layer: Layer): number {
  return CELL_COUNTS[layer.level] + (layer.shiftX === 0.5 ? 1 : 0);
}

// ── Tint Merge ───────────────────────────────────────────────────────

/**
 * Merge a color selection with existing cell content.
 * If the existing cell is a sprite, applies the color as a tint (preserving sprite + transform).
 * If the existing cell is a color, replaces its RGB values.
 * Returns null/empty cells unchanged.
 */
export function mergeTintWithCell(r: number, g: number, b: number, existing: CellState): CellState {
  if (existing && existing.type === 'sprite') {
    return { ...existing, tintR: r, tintG: g, tintB: b };
  }
  if (existing && existing.type === 'color') {
    return { ...existing, r, g, b };
  }
  return existing;
}

/**
 * Merge a sprite placement with existing cell content.
 * If the existing cell is a solid color, the color becomes the sprite's tint.
 * Otherwise returns the sprite as-is.
 */
export function mergeSpriteWithCell(spriteState: CellState, existing: CellState): CellState {
  if (spriteState && spriteState.type === 'sprite' && existing) {
    if (existing.type === 'color') {
      return { ...spriteState, tintR: existing.r, tintG: existing.g, tintB: existing.b };
    }
    if (existing.type === 'sprite' && existing.tintR !== undefined) {
      return { ...spriteState, tintR: existing.tintR, tintG: existing.tintG, tintB: existing.tintB };
    }
  }
  return spriteState;
}

/**
 * In-place variant of mergeTintWithCell for the APPLY_TOOL hot path.
 * Mutates existing cell state directly — caller must snapshot oldState before calling.
 */
export function mergeTintInPlace(r: number, g: number, b: number, existing: CellState): CellState {
  if (existing && existing.type === 'sprite') {
    existing.tintR = r;
    existing.tintG = g;
    existing.tintB = b;
    return existing;
  }
  if (existing && existing.type === 'color') {
    existing.r = r;
    existing.g = g;
    existing.b = b;
    return existing;
  }
  return existing;
}

/**
 * In-place variant of mergeSpriteWithCell for the APPLY_TOOL hot path.
 * Mutates spriteState directly (safe because oldState is already captured for undo).
 */
export function mergeSpriteInPlace(spriteState: CellState, existing: CellState): CellState {
  if (spriteState && spriteState.type === 'sprite' && existing) {
    if (existing.type === 'color') {
      spriteState.tintR = existing.r;
      spriteState.tintG = existing.g;
      spriteState.tintB = existing.b;
      return spriteState;
    }
    if (existing.type === 'sprite' && existing.tintR !== undefined) {
      spriteState.tintR = existing.tintR;
      spriteState.tintG = existing.tintG;
      spriteState.tintB = existing.tintB;
      return spriteState;
    }
  }
  return spriteState;
}

export function applyActiveTint(cell: CellState, r: number, g: number, b: number): CellState {
  if (cell && cell.type === 'sprite'
      && (r !== 255 || g !== 255 || b !== 255)) {
    return { ...cell, tintR: r, tintG: g, tintB: b };
  }
  return cell;
}

// ── Tool → CellState ──────────────────────────────────────────────────

export function cellStateFromTool(
  tool: Tool,
  cellX?: number,
  cellY?: number,
  layer?: Layer,
  allLayers?: Layer[],
  allowBorderConnections?: boolean,
  excludedFamilies?: Set<string>,
  regionBoundsL0?: RegionBoundsL0,
  canvasWidthL0: number = CELL_COUNTS[0],
  canvasHeightL0: number = CELL_COUNTS[0],
  index?: L0PointIndex,
  symmetry?: { h: boolean; v: boolean; d1: boolean; d2: boolean },
  canvasOriginL0X: number = 0,
  canvasOriginL0Y: number = 0,
): CellState {
  switch (tool.type) {
    case 'random': {
      if (layer && allLayers && cellX !== undefined && cellY !== undefined) {
        return pickRandomCompatibleSprite(cellX, cellY, layer, allLayers, allowBorderConnections ?? true, excludedFamilies, regionBoundsL0, canvasWidthL0, canvasHeightL0, index, symmetry, canvasOriginL0X, canvasOriginL0Y);
      }
      const r = Math.floor(Math.random() * 256);
      const g = Math.floor(Math.random() * 256);
      const b = Math.floor(Math.random() * 256);
      return { type: 'color', r, g, b, transform: DEFAULT_TRANSFORM };
    }
    case 'color': {
      const palette = getPaletteColor(tool.colorIndex ?? 0);
      const r = tool.customColorR ?? palette[0];
      const g = tool.customColorG ?? palette[1];
      const b = tool.customColorB ?? palette[2];
      return { type: 'color', r, g, b, transform: DEFAULT_TRANSFORM };
    }
    case 'erase':
      return null;
    case 'sprite': {
      const rot = tool.rotation ?? 0;
      const mH = tool.mirrorH ?? false;
      const mV = tool.mirrorV ?? false;
      // Use DEFAULT_TRANSFORM directly when no transform is applied
      const transform = (rot === 0 && !mH && !mV)
        ? DEFAULT_TRANSFORM
        : { ...DEFAULT_TRANSFORM, rotation: rot, mirrorH: mH, mirrorV: mV };
      return {
        type: 'sprite',
        spriteId: tool.spriteId ?? SPRITE_ENTRIES[0]?.id ?? 'tile',
        transform,
      };
    }
    case 'select':
      return null;
    case 'pattern':
      return null;
    case 'draw':
      return null;
    case 'clone':
      return null;
  }
}

// ── Bulk Flood Fill ──────────────────────────────────────────────────

export interface FloodFillResult {
  ops: UndoOp[];
  scratchCells?: (CellState | null)[][];
}

/**
 * Pre-render a cell state into the shared cell buffer (sharedCellBuf).
 * Returns the byte count written (size*size*4), or 0 if nothing rendered.
 * Callers must read from sharedCellBuf before the next call.
 */
export function renderCellToBuffer(
  state: CellState,
  size: number,
  level: GridLevel,
  spriteLevel?: GridLevel,
): number {
  if (state == null) return 0;

  // Reuse module-level shared buffer — caller must consume before next call
  const buf = sharedCellBuf;

  if (state.type === 'color') {
    const { r, g, b } = state;
    // Fill first row directly in buf, then copyWithin for remaining rows.
    // copyWithin takes only number args, avoiding Hermes validateTypedArray overhead.
    const rowBytes = size * 4;
    // Single Uint32Array.fill() instead of 4N individual byte writes
    const pixel = r | (g << 8) | (b << 16) | 0xFF000000;
    sharedCellBufU32.fill(pixel, 0, size);
    for (let y = 1; y < size; y++) {
      buf.copyWithin(y * rowBytes, 0, rowBytes);
    }
    return size * size * 4;
  }

  if (state.type === 'sprite') {
    const effectiveLevel = spriteLevel ?? level;
    const spriteData = getScaledTile(state.spriteId, effectiveLevel);
    if (!spriteData) return 0;
    const spriteSize = cellPx(effectiveLevel);
    const { rotation, mirrorH, mirrorV } = state.transform;
    const hasTint = state.tintR !== undefined;

    if (spriteSize === size && rotation === 0 && !mirrorH && !mirrorV && !hasTint) {
      // Identity — straight copy (only valid when sizes match and no tint)
      buf.set(spriteData.subarray(0, size * size * 4));
      return size * size * 4;
    }

    if (spriteSize === size && rotation === 0 && !mirrorH && !mirrorV && hasTint) {
      // Tint-only fast path: no transform, just multiply RGB
      const tR = state.tintR!;
      const tG = state.tintG!;
      const tB = state.tintB!;
      const total = size * size * 4;
      for (let i = 0; i < total; i += 4) {
        buf[i]     = (spriteData[i]     * tR + 127) / 255 | 0;
        buf[i + 1] = (spriteData[i + 1] * tG + 127) / 255 | 0;
        buf[i + 2] = (spriteData[i + 2] * tB + 127) / 255 | 0;
        buf[i + 3] = spriteData[i + 3];
      }
      return total;
    }

    // Apply transform + nearest-neighbor rescale using pre-computed LUT.
    // The LUT maps each output pixel to its source byte offset, making the
    // inner loop a sequential read from LUT + sequential write (cache-friendly).
    const lut = getTransformLUT(size, spriteSize, rotation, mirrorH, mirrorV);
    const total = size * size;
    if (hasTint) {
      const tR = state.tintR!;
      const tG = state.tintG!;
      const tB = state.tintB!;
      for (let i = 0; i < total; i++) {
        const srcIdx = lut[i];
        const dstIdx = i * 4;
        buf[dstIdx]     = (spriteData[srcIdx]     * tR + 127) / 255 | 0;
        buf[dstIdx + 1] = (spriteData[srcIdx + 1] * tG + 127) / 255 | 0;
        buf[dstIdx + 2] = (spriteData[srcIdx + 2] * tB + 127) / 255 | 0;
        buf[dstIdx + 3] = spriteData[srcIdx + 3];
      }
    } else {
      // U32 bulk copy — 1 write per pixel instead of 4 byte writes
      const spriteDataU32 = new Uint32Array(spriteData.buffer, spriteData.byteOffset, spriteData.byteLength / 4);
      for (let i = 0; i < total; i++) {
        sharedCellBufU32[i] = spriteDataU32[lut[i] >> 2];
      }
    }
    return total * 4;
  }

  return 0;
}

/**
 * Stamp the shared cell buffer (sharedCellBuf) onto the layer pixel data at (cellX, cellY).
 * If cellBuf is provided, uses it; otherwise reads from sharedCellBuf.
 */
function stampCellBuffer(
  layer: Layer,
  cellX: number,
  cellY: number,
  cellBuf: Uint8Array | null,
  size: number,
): void {
  const src = cellBuf ?? sharedCellBuf;
  const shiftPxX = layer.shiftX * size;
  const shiftPxY = layer.shiftY * size;
  const startX = cellX * size + shiftPxX;
  const startY = cellY * size + shiftPxY;
  const clampedStartX = Math.max(0, startX);
  const clampedEndX = Math.min(LAYER_PX, startX + size);
  const rowWidth = clampedEndX - clampedStartX;
  if (rowWidth <= 0) return;
  const srcOffsetX = clampedStartX - startX;

  // Create single Uint32 views at function entry — avoids 2× per-row allocations
  const srcU32 = (src === sharedCellBuf) ? sharedCellBufU32 : new Uint32Array(src.buffer, src.byteOffset, src.byteLength / 4);
  const dstU32 = layer.dataU32;

  for (let py = 0; py < size; py++) {
    const absY = startY + py;
    if (absY < 0 || absY >= LAYER_PX) continue;
    const dstIdx = absY * LAYER_PX + clampedStartX;
    const srcIdx = py * size + srcOffsetX;
    // Bulk row copy via TypedArray.set — single memcpy per row
    dstU32.set(srcU32.subarray(srcIdx, srcIdx + rowWidth), dstIdx);
  }
}

/**
 * Tile a pre-rendered cell buffer across a rectangular region of the layer's
 * pixel data using binary-doubling copyWithin. Assumes the region is aligned
 * to cell boundaries (shiftPx is always a multiple of size).
 *
 * Algorithm:
 * 1. Copy one cell's worth of pixel rows into the layer, then binary-double
 *    horizontally within each row to fill the full width.
 * 2. Binary-double the filled rows vertically to fill the full height.
 *
 * For L0 (32×32, 64px cells, 2048×2048 texture) this replaces ~1024
 * stampCellBuffer calls with ~325 copyWithin calls (which map to memmove).
 */
export function tileFloodFill(
  layer: Layer,
  cellBuf: Uint8Array,
  size: number,
  startPxX: number,
  startPxY: number,
  endPxX: number,
  endPxY: number,
): void {
  const x0 = Math.max(0, startPxX);
  const y0 = Math.max(0, startPxY);
  const x1 = Math.min(LAYER_PX, endPxX);
  const y1 = Math.min(LAYER_PX, endPxY);
  const fillW = x1 - x0;
  const fillH = y1 - y0;
  if (fillW <= 0 || fillH <= 0) return;

  const layerData = layer.data;
  const dstU32 = layer.dataU32;
  const srcU32 = new Uint32Array(cellBuf.buffer, cellBuf.byteOffset, cellBuf.byteLength / 4);
  const firstCellW = Math.min(size, fillW);
  const rowsToFill = Math.min(size, fillH);

  // Step 1: Fill first `size` rows with one cell width, then binary-double horizontally
  for (let py = 0; py < rowsToFill; py++) {
    const dstRow = (y0 + py) * LAYER_PX + x0;
    // Copy first cell's row (U32 for initial copy)
    dstU32.set(srcU32.subarray(py * size, py * size + firstCellW), dstRow);
    // Binary-double horizontally via byte-level copyWithin (maps to memmove)
    const rowByte = dstRow * 4;
    let filled = firstCellW;
    while (filled < fillW) {
      const n = Math.min(filled, fillW - filled);
      layerData.copyWithin(rowByte + filled * 4, rowByte, rowByte + n * 4);
      filled += n;
    }
  }

  // Step 2: Binary-double vertically — copy blocks of filled rows
  const rowBytes = LAYER_PX * 4;
  const baseOffset = y0 * rowBytes;
  let filledRows = rowsToFill;
  while (filledRows < fillH) {
    const n = Math.min(filledRows, fillH - filledRows);
    layerData.copyWithin(
      baseOffset + filledRows * rowBytes,
      baseOffset,
      baseOffset + n * rowBytes,
    );
    filledRows += n;
  }
}

/**
 * Build a boolean occupancy grid at the active layer's cell resolution.
 * A cell is marked occupied if any visible layer has content at the
 * corresponding pixel region. Accounts for different grid levels and
 * half-cell shifts between layers.
 */
export function buildCrossLayerOccupancy(
  activeLayer: Layer,
  allLayers: Layer[],
  maxCellX: number,
  maxCellY: number,
  excludeLayerId?: string,
): boolean[][] {
  const grid: boolean[][] = [];
  for (let y = 0; y < maxCellY; y++) {
    grid[y] = new Array(maxCellX).fill(false);
  }

  const activeSize = cellPx(activeLayer.level);
  const activeShiftPxX = activeLayer.shiftX * activeSize;
  const activeShiftPxY = activeLayer.shiftY * activeSize;

  for (const layer of allLayers) {
    if (!layer.visible) continue;
    if (excludeLayerId && layer.id === excludeLayerId) continue;
    const srcSize = cellPx(layer.level);
    const srcShiftPxX = layer.shiftX * srcSize;
    const srcShiftPxY = layer.shiftY * srcSize;
    const srcCount = CELL_COUNTS[layer.level];

    for (let sy = 0; sy < srcCount; sy++) {
      const row = layer.cells[sy];
      if (!row) continue;
      for (let sx = 0; sx < srcCount; sx++) {
        if (row[sx] == null) continue;

        // Pixel bounds of this source cell
        const pxMinX = sx * srcSize + srcShiftPxX;
        const pxMinY = sy * srcSize + srcShiftPxY;
        const pxMaxX = pxMinX + srcSize;
        const pxMaxY = pxMinY + srcSize;

        // Map to active-layer cell range
        const acMinX = Math.max(0, Math.floor((pxMinX - activeShiftPxX) / activeSize));
        const acMinY = Math.max(0, Math.floor((pxMinY - activeShiftPxY) / activeSize));
        const acMaxX = Math.min(maxCellX - 1, Math.ceil((pxMaxX - activeShiftPxX) / activeSize) - 1);
        const acMaxY = Math.min(maxCellY - 1, Math.ceil((pxMaxY - activeShiftPxY) / activeSize) - 1);

        for (let ay = acMinY; ay <= acMaxY; ay++) {
          for (let ax = acMinX; ax <= acMaxX; ax++) {
            grid[ay][ax] = true;
          }
        }
      }
    }
  }

  return grid;
}

/**
 * Per-row runner produced by `createBulkFloodFillRunner`. The factory does
 * all once-per-fill setup and returns these closures; the sync and async
 * `bulkFloodFill` wrappers drive them with or without yielding between
 * rows. Splitting on the per-row boundary lets the same algorithm power
 * both call shapes without the two functions drifting apart again. */
interface BulkFloodFillRunner {
  meta: {
    needsPreSeed: boolean;
    mainStartY: number;
    boundY: number;
  };
  /** Process one row of the random-tool pre-seed pass. No-op when
   *  `meta.needsPreSeed` is false. */
  runPreSeedRow: (y: number) => void;
  runMainPassRow: (y: number) => void;
  runEdgePass: () => void;
  runBatchRender: () => void;
  getResult: () => FloodFillResult;
}

/**
 * Build the per-row runner for a bulk flood-fill. Does all setup, variant
 * pre-render, and constraint-layer construction up front; returns closures
 * that the caller drives row-by-row. The variant pre-render is hoisted
 * ahead of the pre-seed pass — it doesn't depend on pre-seed contents —
 * so the runner is fully primed by the time the caller starts iterating.
 */
function createBulkFloodFillRunner(
  layer: Layer,
  tool: Tool,
  mirrorH: boolean,
  mirrorV: boolean,
  mirrorRotate: boolean,
  mirrorQuad: boolean,
  mirrorRow: boolean,
  mirrorCol: boolean,
  mirrorDiag1: boolean,
  mirrorDiag2: boolean,
  mirrorDiagBoth: boolean,
  mirrorStar: boolean,
  maxCellX: number | undefined,
  maxCellY: number | undefined,
  allLayers: Layer[] | undefined,
  allowBorderConnections: boolean | undefined,
  excludedFamilies: Set<string> | undefined,
  regionBounds: RegionBoundsPx | undefined,
  mirrorBounds: RegionBoundsPx | undefined,
  onlyEmpty: boolean | undefined,
  clearFirst: boolean | undefined,
  activeColorR: number,
  activeColorG: number,
  activeColorB: number,
  originL0X: number,
  originL0Y: number,
  excludePartialTiles: boolean,
  clipL0Width: number | undefined,
  clipL0Height: number | undefined,
): BulkFloodFillRunner {
  const isRandom = tool.type === 'random';
  const isColor = tool.type === 'color';
  const isSprite = tool.type === 'sprite';
  const hasActiveColor = activeColorR !== 255 || activeColorG !== 255 || activeColorB !== 255;
  // Color tool only re-tints existing cells, so `clearFirst` must not apply:
  // clearing first would leave nothing to tint, and the cross-layer occupancy
  // guard would then mark every active-layer cell as "occupied" and skip it.
  // `onlyEmpty` is still honored for color (it makes color a no-op, which the
  // SIMPLE_FILL path relies on).
  const skipOccupied = !!onlyEmpty || (!isColor && !!clearFirst);
  const count = CELL_COUNTS[layer.level];
  const size = cellPx(layer.level);
  const cellsPerL0 = 32 / count;
  const shiftPxX = layer.shiftX * size;
  const shiftPxY = layer.shiftY * size;
  const sL0X = layer.shiftX * cellsPerL0;
  const sL0Y = layer.shiftY * cellsPerL0;
  const scaleL0 = CELL_COUNTS[0] / CELL_COUNTS[layer.level];
  const canvasWidthL0 = maxCellX !== undefined ? maxCellX * scaleL0 : CELL_COUNTS[0];
  const canvasHeightL0 = maxCellY !== undefined ? maxCellY * scaleL0 : CELL_COUNTS[0];

  // Canvas window in this layer's cell-index space. When originL0X == 0 this
  // reduces to the legacy "start at 0" behavior (or -1 for shifted layers).
  const startCellX = Math.floor((originL0X - sL0X) / cellsPerL0);
  const startCellY = Math.floor((originL0Y - sL0Y) / cellsPerL0);
  const endCellX = Math.min(count, Math.ceil((originL0X + canvasWidthL0 - sL0X) / cellsPerL0));
  const endCellY = Math.min(count, Math.ceil((originL0Y + canvasHeightL0 - sL0Y) / cellsPerL0));

  // Main-grid iteration starts at 0 (or startCellX if canvas begins inside
  // the layer); edge cells (index -1) are only included when the canvas
  // reaches into the pre-origin half-cell strip.
  const mainStartX = Math.max(0, startCellX);
  const mainStartY = Math.max(0, startCellY);
  const boundX = endCellX;
  const boundY = endCellY;
  // Edge-cell inclusion: index -1 is in-canvas only when startCellX <= -1.
  const edgeMinCellX = (layer.shiftX === 0.5 && startCellX <= -1) ? -1 : mainStartX;
  const edgeMinCellY = (layer.shiftY === 0.5 && startCellY <= -1) ? -1 : mainStartY;
  const minCellX = edgeMinCellX;
  const minCellY = edgeMinCellY;

  const ops: UndoOp[] = [];
  const isPerCell = isRandom || isColor || isSprite;
  const sharedState = isPerCell ? null : cellStateFromTool(tool);
  const hasMirror = mirrorQuad || mirrorRow || mirrorCol || mirrorRotate || mirrorH || mirrorV || mirrorDiag1 || mirrorDiag2 || mirrorDiagBoth || mirrorStar;

  // Create scratch layer: clone cells only; pixel data is rendered in-place
  // (re-entry guard + single-threaded JS ensure no concurrent access)
  const scratchCells = layer.cells.map(row => [...row]);
  const scratch: Layer = cloneLayer(layer, { cells: scratchCells });

  // Compute default full-canvas bounds if not provided. Bounds are in layer
  // pixel space, aligned to cell-index edges at this level so the existing
  // cell-center inclusion test (isCellInRegionPx) accepts exactly the cells
  // whose indices fall in [mainStartX, boundX).
  const bounds: RegionBoundsPx = regionBounds ?? {
    pxMinX: mainStartX * size + shiftPxX,
    pxMinY: mainStartY * size + shiftPxY,
    pxMaxX: boundX * size + shiftPxX,
    pxMaxY: boundY * size + shiftPxY,
  };

  // Pre-bake a canvas config for the partial-tile predicate. Use the actual
  // L0 extent (from clipL0Width/Height when provided) — the derived
  // canvasWidthL0/Height rounds up to a cell boundary and misses partial
  // tiles at a non-cell-aligned clip.
  const partialTileCfg = {
    widthL0: clipL0Width ?? canvasWidthL0,
    heightL0: clipL0Height ?? canvasHeightL0,
    originL0X, originL0Y,
  };

  // Clear active layer first when clearFirst is set. (Color tool is excluded
  // via skipOccupied above, so clearFirst is effectively a no-op for it.)
  if (clearFirst && !isColor) {
    for (let y = mainStartY; y < boundY; y++) {
      const row = scratchCells[y];
      if (!row) continue;
      for (let x = mainStartX; x < boundX; x++) {
        if (!isCellInRegionPx(x, y, layer, bounds)) continue;
        if (excludePartialTiles && !isCellFullyInsideCanvas(layer, x, y, partialTileCfg)) continue;
        if (row[x] != null) {
          const oldState = row[x];
          row[x] = null;
          ops.push({ op: 'cell', layerId: layer.id, cellX: x, cellY: y, oldState, newState: null });
        }
      }
    }
  }

  // Build cross-layer occupancy grid when filling only empty cells.
  // When clearFirst, exclude the active layer since it was just cleared.
  const occupiedGrid = skipOccupied && allLayers
    ? buildCrossLayerOccupancy(layer, allLayers, boundX, boundY, clearFirst ? layer.id : undefined)
    : null;

  // Mirror axis lives on the canvas by default. When `mirrorBounds` is
  // provided (selection-fill / mirror-erase paths supplying a layer-level
  // canvas rect), convert it to a synthetic canvas config so the unified
  // paintMirror compute sees the override-derived widthL0/originL0.
  const l0cpx = cellPx(0);
  const mirrorCanvasCfg: CanvasConfig = mirrorBounds
    ? {
        widthL0: (mirrorBounds.pxMaxX - mirrorBounds.pxMinX) / l0cpx,
        heightL0: (mirrorBounds.pxMaxY - mirrorBounds.pxMinY) / l0cpx,
        originL0X: mirrorBounds.pxMinX / l0cpx,
        originL0Y: mirrorBounds.pxMinY / l0cpx,
      }
    : { widthL0: canvasWidthL0, heightL0: canvasHeightL0, originL0X, originL0Y };
  // Mirror-helper inputs: built once per fill, reused across the per-cell
  // loops below. Keeping these stable lets `forEachMirrorTarget` stay
  // allocation-free during the hot path.
  const mFlags: MirrorFlags = { mirrorH, mirrorV, mirrorRotate, mirrorQuad, mirrorRow, mirrorCol, mirrorDiag1, mirrorDiag2, mirrorDiagBoth, mirrorStar };
  const mWindow: MirrorCellWindow = { minCellX, endCellX: boundX, minCellY, endCellY: boundY };
  const mPartialCfg = excludePartialTiles ? partialTileCfg : null;

  // Convert region bounds from px to L0 space for border-connection checks.
  // Only set when a specific region was provided (not the full-canvas fallback).
  const regionBoundsL0: RegionBoundsL0 | undefined = regionBounds
    ? {
        minX: regionBounds.pxMinX * CELL_COUNTS[0] / LAYER_PX,
        minY: regionBounds.pxMinY * CELL_COUNTS[0] / LAYER_PX,
        maxX: regionBounds.pxMaxX * CELL_COUNTS[0] / LAYER_PX,
        maxY: regionBounds.pxMaxY * CELL_COUNTS[0] / LAYER_PX,
      }
    : undefined;

  // For random flood fill, start with empty cells for constraint gathering
  // so old topology doesn't influence the fill, but new tiles constrain each other
  let constraintLayers = allLayers;
  let constraintLayer: Layer | undefined;
  let index: L0PointIndex | undefined;
  const needsPreSeed = isRandom && !!allLayers;
  if (needsPreSeed) {
    // Clone existing cells so neighbors outside the fill region are visible
    // to gatherConstraints, then clear only cells inside the region (they get
    // re-seeded by the pre-seed pass below).
    constraintLayer = cloneLayer(layer, { cells: layer.cells.map(row => [...row]) });
    for (let y = mainStartY; y < boundY; y++) {
      for (let x = mainStartX; x < boundX; x++) {
        if (isCellInRegionPx(x, y, layer, bounds)) {
          // When onlyEmpty/clearFirst, keep existing cells so they participate in constraints
          if (!skipOccupied || (occupiedGrid ? !occupiedGrid[y][x] : layer.cells[y][x] == null)) {
            constraintLayer.cells[y][x] = null;
          }
        }
      }
    }
    constraintLayers = allLayers!.map(l => l === layer ? constraintLayer! : l);

    // Build spatial index for O(1) constraint point queries during flood fill
    index = new L0PointIndex();
    index.buildFromLayers(constraintLayers);
  }

  // Pre-seed pass: fill constraint layer so the main pass has full 8-neighbor
  // context (without this, south/east neighbors are empty during scan-order
  // fill). When mirroring/rotation is active, seed primary cells and
  // mirror-copy via mirrorCellState so constraints are symmetric. The
  // per-row driver below is invoked by the sync/async wrappers — splitting
  // on the row boundary is how the async path yields without duplicating
  // this body.
  const preSeedDone = new Set<number>();
  let preSeedSrc: CellState = null;
  const applyPreSeedMirror = (tx: number, ty: number, mH: boolean, mV: boolean, rot: 0 | 90 | 180 | 270) => {
    if (skipOccupied && (tx >= 0 && ty >= 0 ? (occupiedGrid ? occupiedGrid[ty][tx] : layer.cells[ty][tx] != null) : getCell(layer, tx, ty) != null)) return;
    const tKey = (ty + 1) * (count + 2) + (tx + 1);
    if (preSeedDone.has(tKey)) return;
    preSeedDone.add(tKey);
    setCell(constraintLayer!, tx, ty, mirrorCellState(preSeedSrc!, mH, mV, rot));
    index!.insertCell(constraintLayer!, tx, ty);
  };
  const runPreSeedRow = (y: number): void => {
    if (!needsPreSeed) return;
    if (hasMirror) {
      for (let x = mainStartX; x < boundX; x++) {
        if (!isCellInRegionPx(x, y, layer, bounds)) continue;
        if (excludePartialTiles && !isCellFullyInsideCanvas(layer, x, y, partialTileCfg)) continue;
        if (skipOccupied && (occupiedGrid ? occupiedGrid[y][x] : layer.cells[y][x] != null)) continue;
        const key = (y + 1) * (count + 2) + (x + 1);
        if (preSeedDone.has(key)) continue;
        preSeedDone.add(key);

        const st = cellStateFromTool(tool, x, y, constraintLayer, constraintLayers, allowBorderConnections, excludedFamilies, regionBoundsL0, canvasWidthL0, canvasHeightL0, index, undefined, originL0X, originL0Y);
        constraintLayer!.cells[y][x] = st;
        index!.insertCell(constraintLayer!, x, y);
        if (st) {
          preSeedSrc = st;
          forEachMirrorTarget(x, y, layer, mirrorCanvasCfg, mFlags, mWindow, mPartialCfg, applyPreSeedMirror);
        }
      }
    } else {
      for (let x = mainStartX; x < boundX; x++) {
        if (!isCellInRegionPx(x, y, layer, bounds)) continue;
        if (excludePartialTiles && !isCellFullyInsideCanvas(layer, x, y, partialTileCfg)) continue;
        if (skipOccupied && (occupiedGrid ? occupiedGrid[y][x] : layer.cells[y][x] != null)) continue;
        constraintLayer!.cells[y][x] = cellStateFromTool(tool, x, y, constraintLayer, constraintLayers, allowBorderConnections, excludedFamilies, regionBoundsL0, canvasWidthL0, canvasHeightL0, index, undefined, originL0X, originL0Y);
        index!.insertCell(constraintLayer!, x, y);
      }
    }
  };

  // For non-random, non-color tools, pre-render each transform variant once.
  // Variant key bitmask: (mH ? 1 : 0) | (mV ? 2 : 0) | ((rot/90) << 2)  →  range 0-15
  // Reuse module-level buffers (reset to avoid stale data)
  _variantBuffers.fill(null);
  _variantStates.fill(undefined);
  const variantBuffers = _variantBuffers;
  const variantStates = _variantStates;

  if (!isPerCell && sharedState) {
    if (mirrorRotate) {
      for (const rot of [0, 90, 180, 270] as const) {
        const combinedRot = MOD_360[sharedState.transform.rotation + rot];
        const state: CellState = { ...sharedState, transform: { ...sharedState.transform, rotation: combinedRot } };
        const vk = (rot / 90) << 2; // mH=0, mV=0
        variantStates[vk] = state;
        const byteLen = renderCellToBuffer(state, size, layer.level);
        variantBuffers[vk] = byteLen > 0 ? new Uint8Array(sharedCellBuf.buffer, 0, byteLen) : null;
      }
    } else {
      const variants: [boolean, boolean][] = [[false, false]];
      if (mirrorH) variants.push([true, false]);
      if (mirrorV) variants.push([false, true]);
      if (mirrorH && mirrorV) variants.push([true, true]);
      const negRot = MOD_360[360 - sharedState.transform.rotation];
      for (const [mh, mv] of variants) {
        let state: CellState;
        if (mh || mv) {
          if (sharedState.type === 'sprite') {
            state = mirrorCellState(sharedState, mh, mv, 0);
          } else {
            state = { ...sharedState, transform: {
              ...sharedState.transform,
              mirrorH: sharedState.transform.mirrorH !== mh,
              mirrorV: sharedState.transform.mirrorV !== mv,
              rotation: (mh !== mv) ? negRot : sharedState.transform.rotation,
            } };
          }
        } else {
          state = sharedState;
        }
        const vk = (mh ? 1 : 0) | (mv ? 2 : 0); // rot=0
        variantStates[vk] = state;
        const byteLen = renderCellToBuffer(state, size, layer.level);
        variantBuffers[vk] = byteLen > 0 ? new Uint8Array(sharedCellBuf.buffer, 0, byteLen) : null;
      }
    }
  }

  // For sprite flood fill: pre-render base + variants once, track tinting during Phase 1
  let spriteBaseBuf: Uint8Array | null = null;
  let spriteBaseState: CellState | null = null;
  let hasTintedCells = false;

  if (isSprite) {
    spriteBaseState = cellStateFromTool(tool);
    const byteLen = renderCellToBuffer(spriteBaseState!, size, layer.level);
    if (byteLen > 0) {
      spriteBaseBuf = new Uint8Array(byteLen);
      spriteBaseBuf.set(sharedCellBuf.subarray(0, byteLen));
    }
    // Store base variant in variant buffers (keyed by resulting transform)
    const baseTf = spriteBaseState!.transform;
    const baseKey = (baseTf.mirrorH ? 1 : 0) | (baseTf.mirrorV ? 2 : 0) | ((baseTf.rotation / 90) << 2);
    variantStates[baseKey] = spriteBaseState;
    variantBuffers[baseKey] = spriteBaseBuf;

    // Pre-render mirror/rotation variants
    if (hasMirror) {
      const mirrorVariants: [boolean, boolean, (0 | 90 | 180 | 270)][] = [];
      if (mirrorRotate) {
        mirrorVariants.push([false, false, 90], [false, false, 180], [false, false, 270]);
      } else {
        if (mirrorH) mirrorVariants.push([true, false, 0]);
        if (mirrorV) mirrorVariants.push([false, true, 0]);
        if (mirrorH && mirrorV) mirrorVariants.push([true, true, 0]);
      }
      for (const [mh, mv, rot] of mirrorVariants) {
        const vs = mirrorCellState(spriteBaseState!, mh, mv, rot);
        const tf = vs!.transform;
        const vk = (tf.mirrorH ? 1 : 0) | (tf.mirrorV ? 2 : 0) | ((tf.rotation / 90) << 2);
        variantStates[vk] = vs;
        const vbl = renderCellToBuffer(vs, size, layer.level);
        if (vbl > 0) {
          const buf = new Uint8Array(vbl);
          buf.set(sharedCellBuf.subarray(0, vbl));
          variantBuffers[vk] = buf;
        }
      }
    }
  }

  // Main pass — driven per row by the wrappers below.
  const done = new Set<number>();
  const collectMirrorTarget = (tx: number, ty: number, mH: boolean, mV: boolean, rot: 0 | 90 | 180 | 270) => {
    const slot = _allTargets[_allTargetCount];
    slot.tx = tx; slot.ty = ty; slot.mH = mH; slot.mV = mV; slot.rot = rot;
    _allTargetCount++;
  };
  const runMainPassRow = (y: number): void => {
    for (let x = mainStartX; x < boundX; x++) {
      if (!isCellInRegionPx(x, y, layer, bounds)) continue;
      if (excludePartialTiles && !isCellFullyInsideCanvas(layer, x, y, partialTileCfg)) continue;
      if (skipOccupied && (occupiedGrid ? occupiedGrid[y][x] : scratch.cells[y][x] != null)) continue;
      const key = (y + 1) * (count + 2) + (x + 1);
      if (done.has(key)) continue;
      done.add(key);

      const baseState = isRandom
        ? cellStateFromTool(tool, x, y, constraintLayer ?? layer, constraintLayers, allowBorderConnections, excludedFamilies, regionBoundsL0, canvasWidthL0, canvasHeightL0, index, undefined, originL0X, originL0Y)
        : isSprite
        ? spriteBaseState  // reuse pre-computed state (avoids ~1024 object allocations)
        : isColor
        ? null  // color tool computes per-target via mergeTintWithCell
        : sharedState;

      // Build target list: primary cell + mirror/rotation targets (reuse module-level buffer)
      _allTargets[0].tx = x; _allTargets[0].ty = y; _allTargets[0].mH = false; _allTargets[0].mV = false; _allTargets[0].rot = 0;
      _allTargetCount = 1;

      if (hasMirror) {
        forEachMirrorTarget(x, y, layer, mirrorCanvasCfg, mFlags, mWindow, mPartialCfg, collectMirrorTarget);
      }

      for (let _ti = 0; _ti < _allTargetCount; _ti++) {
        const { tx, ty, mH, mV, rot } = _allTargets[_ti];
        const tKey = (ty + 1) * (count + 2) + (tx + 1);
        if (tKey !== key && done.has(tKey)) continue;
        if (skipOccupied && (tx >= 0 && ty >= 0 ? (occupiedGrid ? occupiedGrid[ty][tx] : scratch.cells[ty][tx] != null) : getCell(scratch, tx, ty) != null)) continue;
        done.add(tKey);

        const oldState = getCell(scratch, tx, ty);
        const cRow = (constraintLayer && ty >= 0) ? constraintLayer.cells[ty] : null;

        if (isColor) {
          if (oldState == null) continue;
          const cr = tool.customColorR ?? getPaletteColor(tool.colorIndex ?? 0)[0];
          const cg = tool.customColorG ?? getPaletteColor(tool.colorIndex ?? 0)[1];
          const cb = tool.customColorB ?? getPaletteColor(tool.colorIndex ?? 0)[2];
          const newState = mergeTintWithCell(cr, cg, cb, oldState);
          setCell(scratch, tx, ty, newState);
          ops.push({ op: 'cell', layerId: layer.id, cellX: tx, cellY: ty, oldState, newState });
        } else if (isSprite) {
          let newState: CellState = (mH || mV || rot !== 0)
            ? mirrorCellState(baseState!, mH, mV, rot)
            : baseState;
          newState = mergeSpriteWithCell(newState, oldState);
          if (hasActiveColor) newState = applyActiveTint(newState, activeColorR, activeColorG, activeColorB);
          if (oldState && oldState.type === 'color') hasTintedCells = true;
          setCell(scratch, tx, ty, newState);
          ops.push({ op: 'cell', layerId: layer.id, cellX: tx, cellY: ty, oldState, newState });
        } else if (isRandom) {
          let newState: CellState = (mH || mV || rot !== 0)
            ? mirrorCellState(baseState!, mH, mV, rot)
            : baseState;
          newState = mergeSpriteWithCell(newState, oldState);
          if (hasActiveColor) newState = applyActiveTint(newState, activeColorR, activeColorG, activeColorB);
          setCell(scratch, tx, ty, newState);
          if (cRow && tx >= 0) {
            if (index) index.removeCell(constraintLayer!, tx, ty);
            cRow[tx] = newState;
            if (index) index.insertCell(constraintLayer!, tx, ty);
          } else if (constraintLayer && (tx < 0 || ty < 0)) {
            setCell(constraintLayer, tx, ty, newState);
          }
          ops.push({ op: 'cell', layerId: layer.id, cellX: tx, cellY: ty, oldState, newState });
        } else if (sharedState === null) {
          if (oldState === null) continue;
          setCell(scratch, tx, ty, null);
          ops.push({ op: 'cell', layerId: layer.id, cellX: tx, cellY: ty, oldState, newState: null });
        } else {
          const variantKey = (mH ? 1 : 0) | (mV ? 2 : 0) | ((rot / 90) << 2);
          const newState = variantStates[variantKey]!;
          setCell(scratch, tx, ty, newState);
          ops.push({ op: 'cell', layerId: layer.id, cellX: tx, cellY: ty, oldState, newState });
        }
      }
    }
  };

  // Edge cell pass: fill half-cells at top/left for shifted layers.
  // Edge cells (index -1) are in-canvas only when the canvas window reaches
  // into the pre-origin half-cell strip — i.e., startCellX (or Y) ≤ -1.
  // Skip cells already filled by mirror targets in the main pass.
  const runEdgePass = (): void => {
    if (regionBounds) return;
    const edgeCells: [number, number][] = [];
    const edgeXInCanvas = layer.shiftX === 0.5 && startCellX <= -1;
    const edgeYInCanvas = layer.shiftY === 0.5 && startCellY <= -1;
    if (edgeXInCanvas && scratch.edgeColLeft) {
      for (let y = mainStartY; y < boundY; y++) edgeCells.push([-1, y]);
    }
    if (edgeYInCanvas && scratch.edgeRowTop) {
      for (let x = mainStartX; x < boundX; x++) edgeCells.push([x, -1]);
    }
    if (edgeXInCanvas && edgeYInCanvas) {
      edgeCells.push([-1, -1]);
    }
    for (const [ex, ey] of edgeCells) {
      if (excludePartialTiles && !isCellFullyInsideCanvas(layer, ex, ey, partialTileCfg)) continue;
      const eKey = (ey + 1) * (count + 2) + (ex + 1);
      if (done.has(eKey)) continue;
      done.add(eKey);
      const oldState = getCell(scratch, ex, ey);
      let newState: CellState;
      if (isColor) {
        if (oldState == null) continue;
        const cr = tool.customColorR ?? getPaletteColor(tool.colorIndex ?? 0)[0];
        const cg = tool.customColorG ?? getPaletteColor(tool.colorIndex ?? 0)[1];
        const cb = tool.customColorB ?? getPaletteColor(tool.colorIndex ?? 0)[2];
        newState = mergeTintWithCell(cr, cg, cb, oldState);
      } else if (isRandom || isSprite) {
        newState = cellStateFromTool(tool, ex < 0 ? 0 : ex, ey < 0 ? 0 : ey, layer, allLayers, allowBorderConnections, excludedFamilies, regionBoundsL0, canvasWidthL0, canvasHeightL0, index, undefined, originL0X, originL0Y);
        if (isSprite) newState = mergeSpriteWithCell(newState, oldState);
        if (hasActiveColor) newState = applyActiveTint(newState, activeColorR, activeColorG, activeColorB);
      } else {
        newState = sharedState;
      }
      if (oldState === newState && oldState == null) continue;
      setCell(scratch, ex, ey, newState);
      ops.push({ op: 'cell', layerId: layer.id, cellX: ex, cellY: ey, oldState, newState });
    }
  };

  // Phase 2: Batch render all modified cells into pixel data in one pass.
  // This avoids interleaved pixel work during constraint computation and
  // ensures only a single GPU upload is needed (via markFullDirty in caller).
  const runBatchRender = (): void => {
    const shiftPxXR = layer.shiftX * size;
    const shiftPxYR = layer.shiftY * size;
    const tileStartX = minCellX * size + shiftPxXR;
    const tileStartY = minCellY * size + shiftPxYR;

    if (isSprite && spriteBaseBuf && !hasTintedCells && !hasMirror && !skipOccupied && !regionBounds) {
      // Tiling fast path: all cells get identical sprite — tile the entire canvas
      tileFloodFill(scratch, spriteBaseBuf, size,
        tileStartX, tileStartY,
        boundX * size + shiftPxXR, boundY * size + shiftPxYR);
      return;
    }
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (op.op !== 'cell') continue;
      // Sprite with pre-rendered variant buffer (non-tinted cells)
      if (isSprite && op.newState && op.newState.type === 'sprite' && op.newState.tintR === undefined) {
        const tf = op.newState.transform;
        const vk = (tf.mirrorH ? 1 : 0) | (tf.mirrorV ? 2 : 0) | ((tf.rotation / 90) << 2);
        const cellBuf = variantBuffers[vk];
        if (cellBuf) {
          stampCellBuffer(scratch, op.cellX, op.cellY, cellBuf, size);
          continue;
        }
      }
      // For non-per-cell tools with pre-rendered variant buffers, stamp directly
      if (!isPerCell && sharedState !== null) {
        const cellState = getCell(scratch, op.cellX, op.cellY);
        if (cellState) {
          const cmH = cellState.transform?.mirrorH ?? false;
          const cmV = cellState.transform?.mirrorV ?? false;
          const crot = cellState.transform?.rotation ?? 0;
          const variantKey = (cmH ? 1 : 0) | (cmV ? 2 : 0) | ((crot / 90) << 2);
          const cellBuf = variantBuffers[variantKey];
          if (cellBuf) {
            stampCellBuffer(scratch, op.cellX, op.cellY, cellBuf, size);
            continue;
          }
        }
      }
      renderCellToPixels(scratch, op.cellX, op.cellY, op.newState);
    }
  };

  return {
    meta: { needsPreSeed, mainStartY, boundY },
    runPreSeedRow,
    runMainPassRow,
    runEdgePass,
    runBatchRender,
    getResult: () => ({ ops, scratchCells: scratch.cells }),
  };
}

/**
 * Fill cells within region bounds, with optional mirroring/rotation.
 * For non-random tools, pre-renders each transform variant once into a buffer
 * and stamps it to all cell positions — avoiding redundant per-pixel work.
 *
 * Both full-canvas and region-constrained fills use this single code path.
 * Full-canvas callers pass bounds covering the entire canvas.
 */
export function bulkFloodFill(
  layer: Layer,
  tool: Tool,
  mirrorH: boolean,
  mirrorV: boolean,
  mirrorRotate: boolean = false,
  mirrorQuad: boolean = false,
  mirrorRow: boolean = false,
  mirrorCol: boolean = false,
  mirrorDiag1: boolean = false,
  mirrorDiag2: boolean = false,
  mirrorDiagBoth: boolean = false,
  mirrorStar: boolean = false,
  maxCellX?: number,
  maxCellY?: number,
  allLayers?: Layer[],
  allowBorderConnections?: boolean,
  excludedFamilies?: Set<string>,
  regionBounds?: RegionBoundsPx,
  mirrorBounds?: RegionBoundsPx,
  onlyEmpty?: boolean,
  clearFirst?: boolean,
  activeColorR: number = 255,
  activeColorG: number = 255,
  activeColorB: number = 255,
  originL0X: number = 0,
  originL0Y: number = 0,
  excludePartialTiles: boolean = false,
  /** Actual L0 width of the visible canvas. The partial-tile predicate uses
   *  this — derived `canvasWidthL0 = maxCellX * scaleL0` rounds up to the
   *  next cell boundary and misses tiles cut off by a non-cell-aligned
   *  clip. Defaults to the derived value. */
  clipL0Width?: number,
  clipL0Height?: number,
): FloodFillResult {
  const runner = createBulkFloodFillRunner(
    layer, tool,
    mirrorH, mirrorV, mirrorRotate, mirrorQuad, mirrorRow, mirrorCol,
    mirrorDiag1, mirrorDiag2, mirrorDiagBoth, mirrorStar,
    maxCellX, maxCellY, allLayers, allowBorderConnections, excludedFamilies,
    regionBounds, mirrorBounds, onlyEmpty, clearFirst,
    activeColorR, activeColorG, activeColorB,
    originL0X, originL0Y, excludePartialTiles, clipL0Width, clipL0Height,
  );
  if (runner.meta.needsPreSeed) {
    for (let y = runner.meta.mainStartY; y < runner.meta.boundY; y++) {
      runner.runPreSeedRow(y);
    }
  }
  for (let y = runner.meta.mainStartY; y < runner.meta.boundY; y++) {
    runner.runMainPassRow(y);
  }
  runner.runEdgePass();
  runner.runBatchRender();
  return runner.getResult();
}

/**
 * Async version of `bulkFloodFill` that yields to the event loop between
 * rows to avoid blocking the UI thread. Shares the entire algorithm with
 * the sync version via `createBulkFloodFillRunner`; the only thing this
 * adds is a 5ms timeslice check between row iterations plus a single
 * `onChunkComplete` callback at the end (one GPU upload).
 */
export async function bulkFloodFillAsync(
  layer: Layer,
  tool: Tool,
  mirrorH: boolean,
  mirrorV: boolean,
  mirrorRotate: boolean = false,
  mirrorQuad: boolean = false,
  mirrorRow: boolean = false,
  mirrorCol: boolean = false,
  mirrorDiag1: boolean = false,
  mirrorDiag2: boolean = false,
  mirrorDiagBoth: boolean = false,
  mirrorStar: boolean = false,
  maxCellX?: number,
  maxCellY?: number,
  allLayers?: Layer[],
  allowBorderConnections?: boolean,
  excludedFamilies?: Set<string>,
  regionBounds?: RegionBoundsPx,
  mirrorBounds?: RegionBoundsPx,
  onlyEmpty?: boolean,
  clearFirst?: boolean,
  onChunkComplete?: () => void,
  activeColorR: number = 255,
  activeColorG: number = 255,
  activeColorB: number = 255,
  originL0X: number = 0,
  originL0Y: number = 0,
  excludePartialTiles: boolean = false,
  clipL0Width?: number,
  clipL0Height?: number,
): Promise<FloodFillResult> {
  const runner = createBulkFloodFillRunner(
    layer, tool,
    mirrorH, mirrorV, mirrorRotate, mirrorQuad, mirrorRow, mirrorCol,
    mirrorDiag1, mirrorDiag2, mirrorDiagBoth, mirrorStar,
    maxCellX, maxCellY, allLayers, allowBorderConnections, excludedFamilies,
    regionBounds, mirrorBounds, onlyEmpty, clearFirst,
    activeColorR, activeColorG, activeColorB,
    originL0X, originL0Y, excludePartialTiles, clipL0Width, clipL0Height,
  );
  // Yield once per row whenever 5ms+ has elapsed since the last yield. No
  // GPU uploads happen during this loop — Phase 2 batch-render and a single
  // onChunkComplete at the end produce one upload.
  let lastYield = performance.now();
  const maybeYield = async (): Promise<void> => {
    if (performance.now() - lastYield >= 5) {
      await new Promise<void>(r => setTimeout(r, 0));
      lastYield = performance.now();
    }
  };
  if (runner.meta.needsPreSeed) {
    for (let y = runner.meta.mainStartY; y < runner.meta.boundY; y++) {
      runner.runPreSeedRow(y);
      await maybeYield();
    }
  }
  for (let y = runner.meta.mainStartY; y < runner.meta.boundY; y++) {
    runner.runMainPassRow(y);
    await maybeYield();
  }
  runner.runEdgePass();
  runner.runBatchRender();
  if (onChunkComplete) onChunkComplete();
  return runner.getResult();
}

// ── Single Cell Edit ──────────────────────────────────────────────────

export function applyCellEdit(
  layer: Layer,
  cellX: number,
  cellY: number,
  newState: CellState,
): CellEdit {
  const count = CELL_COUNTS[layer.level];
  const minX = layer.shiftX === 0.5 ? -1 : 0;
  const minY = layer.shiftY === 0.5 ? -1 : 0;
  if (cellX < minX || cellX >= count || cellY < minY || cellY >= count) {
    return { layerId: layer.id, cellX, cellY, oldState: null, newState };
  }

  const oldState = getCell(layer, cellX, cellY);

  // Same-state early-out: skip pixel rendering when cell content hasn't changed.
  // Common during rapid dragging over already-painted cells.
  if (oldState !== newState && oldState != null && newState != null) {
    if (oldState.type === 'color' && newState.type === 'color'
      && oldState.r === newState.r && oldState.g === newState.g && oldState.b === newState.b) {
      return { layerId: layer.id, cellX, cellY, oldState, newState };
    }
    if (oldState.type === 'sprite' && newState.type === 'sprite'
      && oldState.spriteId === newState.spriteId
      && oldState.tintR === newState.tintR && oldState.tintG === newState.tintG && oldState.tintB === newState.tintB
      && oldState.transform.rotation === newState.transform.rotation
      && oldState.transform.mirrorH === newState.transform.mirrorH
      && oldState.transform.mirrorV === newState.transform.mirrorV) {
      return { layerId: layer.id, cellX, cellY, oldState, newState };
    }
  }
  if (oldState == null && newState == null) {
    return { layerId: layer.id, cellX, cellY, oldState, newState };
  }

  setCell(layer, cellX, cellY, newState);
  layer.cellsGeneration++;
  renderCellToPixels(layer, cellX, cellY, newState);

  return { layerId: layer.id, cellX, cellY, oldState, newState };
}

// ── Render Cell to Pixels ────────────────────────────────────────────

/**
 * Render a cell into the layer's pixel data at (cellX, cellY).
 * For null state, clears the cell region. Otherwise renders via
 * renderCellToBuffer + stampCellBuffer.
 */
export function renderCellToPixels(
  layer: Layer,
  cellX: number,
  cellY: number,
  state: CellState,
): void {
  const size = cellPx(layer.level);
  const shiftPxX = layer.shiftX * size;
  const shiftPxY = layer.shiftY * size;
  const startX = cellX * size + shiftPxX;
  const startY = cellY * size + shiftPxY;

  if (state == null) {
    // Clear cell (with clipping for shifted layers)
    for (let py = 0; py < size; py++) {
      const absY = startY + py;
      if (absY < 0 || absY >= LAYER_PX) continue;
      const absX0 = Math.max(0, startX);
      const absX1 = Math.min(LAYER_PX, startX + size);
      if (absX0 >= absX1) continue;
      const rowStart = (absY * LAYER_PX + absX0) * 4;
      layer.data.fill(0, rowStart, rowStart + (absX1 - absX0) * 4);
    }
    return;
  }

  // Fast path: solid color cells — fill layer.data rows directly, bypassing
  // renderCellToBuffer + stampCellBuffer entirely. For L2 (256×256) this
  // eliminates ~512KB of intermediate buffer work.
  if (state.type === 'color') {
    const { r, g, b } = state;
    const clampedStartX = Math.max(0, startX);
    const clampedEndX = Math.min(LAYER_PX, startX + size);
    const rowWidth = clampedEndX - clampedStartX;
    if (rowWidth <= 0) return;
    // Fill the first visible row directly in layer.data, then copyWithin
    // for remaining rows. copyWithin takes only number args, avoiding
    // Hermes validateTypedArray overhead from .set(subarray, offset).
    const rowBytes = rowWidth * 4;
    // Find first visible row
    let firstAbsY = -1;
    let firstDst = 0;
    for (let py = 0; py < size; py++) {
      const absY = startY + py;
      if (absY >= 0 && absY < LAYER_PX) {
        firstAbsY = absY;
        firstDst = (absY * LAYER_PX + clampedStartX) * 4;
        break;
      }
    }
    if (firstAbsY < 0) return;
    // Fill first row via a single Uint32Array.fill() — avoids 4N individual
    // byte writes that each trigger Hermes's slow _setOwnIndexedImpl path.
    const pixel = r | (g << 8) | (b << 16) | 0xFF000000;
    const layerU32 = layer.dataU32;
    layerU32.fill(pixel, firstDst / 4, firstDst / 4 + rowWidth);
    // Replicate to remaining rows via copyWithin
    for (let py = 0; py < size; py++) {
      const absY = startY + py;
      if (absY < 0 || absY >= LAYER_PX || absY === firstAbsY) continue;
      const dstStart = (absY * LAYER_PX + clampedStartX) * 4;
      layer.data.copyWithin(dstStart, firstDst, firstDst + rowBytes);
    }
    return;
  }

  const byteLen = renderCellToBuffer(state, size, layer.level);
  if (byteLen > 0) {
    stampCellBuffer(layer, cellX, cellY, null, size);
  }
}

// ── Rebuild Full Pixel Data ──────────────────────────────────────────

export function rebuildPixelData(layer: Layer): void {
  layer.data.fill(0);
  const count = CELL_COUNTS[layer.level];
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      const state = layer.cells[y][x];
      if (state != null) {
        renderCellToPixels(layer, x, y, state);
      }
    }
  }
  // Render edge cells for shifted layers
  if (layer.edgeRowTop) {
    for (let x = 0; x < count; x++) {
      const state = layer.edgeRowTop[x];
      if (state != null) renderCellToPixels(layer, x, -1, state);
    }
  }
  if (layer.edgeColLeft) {
    for (let y = 0; y < count; y++) {
      const state = layer.edgeColLeft[y];
      if (state != null) renderCellToPixels(layer, -1, y, state);
    }
  }
  if (layer.edgeCorner != null) {
    renderCellToPixels(layer, -1, -1, layer.edgeCorner);
  }
}

// ── Layer Snapshot ───────────────────────────────────────────────────

export function snapshotLayer(layer: Layer): LayerSnapshot {
  const count = CELL_COUNTS[layer.level];
  const cells: (CellState | null)[][] = [];
  for (let y = 0; y < count; y++) {
    cells[y] = [];
    for (let x = 0; x < count; x++) {
      const cell = layer.cells[y][x];
      cells[y][x] = cell == null ? null : { ...cell } as CellState;
    }
  }
  return {
    id: layer.id,
    name: layer.name,
    level: layer.level,
    visible: layer.visible,
    opacity: layer.opacity,
    order: layer.order,
    shiftX: layer.shiftX,
    shiftY: layer.shiftY,
    locked: layer.locked,
    cells,
    edgeRowTop: layer.edgeRowTop ? [...layer.edgeRowTop] : null,
    edgeColLeft: layer.edgeColLeft ? [...layer.edgeColLeft] : null,
    edgeCorner: layer.edgeCorner,
  };
}

// ── Dirty Rect Helpers ──────────────────────────────────────────────

// mergeDirtyRect removed — replaced by pushDirtyRect from types.ts

// ── Apply / Revert Ops ──────────────────────────────────────────────

export function applyOps(state: EditorState, ops: UndoOp[]): EditorState {
  let newState = { ...state, layers: state.layers.map((l) => cloneLayer(l)) };

  for (const op of ops) {
    switch (op.op) {
      case 'cell': {
        const layer = newState.layers.find((l) => l.id === op.layerId);
        if (layer) {
          setCell(layer, op.cellX, op.cellY, op.newState);
          layer.cellsGeneration++;
          renderCellToPixels(layer, op.cellX, op.cellY, op.newState);
          const size = cellPx(layer.level);
          const rawX = op.cellX * size + layer.shiftX * size;
          const rawY = op.cellY * size + layer.shiftY * size;
          pushDirtyRect(layer, {
            x: Math.max(0, rawX),
            y: Math.max(0, rawY),
            width: Math.min(LAYER_PX, rawX + size) - Math.max(0, rawX),
            height: Math.min(LAYER_PX, rawY + size) - Math.max(0, rawY),
          });
        }
        break;
      }
      case 'addLayer': {
        const restored = layerFromSnapshot(op.layer);
        newState.layers.push(restored);
        break;
      }
      case 'removeLayer': {
        newState.layers = newState.layers.filter((l) => l.id !== op.layer.id);
        if (newState.activeLayerId === op.layer.id && newState.layers.length > 0) {
          newState.activeLayerId = newState.layers[0].id;
        }
        break;
      }
      case 'renameLayer': {
        const layer = newState.layers.find((l) => l.id === op.layerId);
        if (layer) layer.name = op.newName;
        break;
      }
      case 'reorderLayer': {
        const layer = newState.layers.find((l) => l.id === op.layerId);
        if (layer) layer.order = op.newOrder;
        break;
      }
      case 'toggleVisibility': {
        const layer = newState.layers.find((l) => l.id === op.layerId);
        if (layer) layer.visible = !op.oldVisible;
        break;
      }
      case 'setActiveLayer': {
        newState.activeLayerId = op.newActiveId;
        break;
      }
      case 'renameFile': {
        newState = {
          ...newState,
          fileConfig: { ...newState.fileConfig, name: op.newName },
        };
        break;
      }
      case 'clearAll': {
        for (const layer of newState.layers) {
          if (layer.locked || !layer.visible) continue;
          const count = CELL_COUNTS[layer.level];
          for (let y = 0; y < count; y++) {
            layer.cells[y].fill(null);
          }
          if (layer.edgeRowTop) layer.edgeRowTop.fill(null);
          if (layer.edgeColLeft) layer.edgeColLeft.fill(null);
          layer.edgeCorner = null;
          layer.cellsGeneration++;
          layer.data.fill(0);
          markFullDirty(layer);
        }
        break;
      }
      case 'setShift': {
        const layer = newState.layers.find((l) => l.id === op.layerId);
        if (layer) {
          layer.shiftX = op.newShiftX;
          layer.shiftY = op.newShiftY;
          const count = CELL_COUNTS[layer.level];
          layer.edgeColLeft = op.newShiftX === 0.5 ? new Array(count).fill(null) : null;
          layer.edgeRowTop = op.newShiftY === 0.5 ? new Array(count).fill(null) : null;
          if (op.newShiftX === 0 && op.newShiftY === 0) layer.edgeCorner = null;
          rebuildPixelData(layer);
          markFullDirty(layer);
        }
        break;
      }
      case 'toggleLock': {
        const layer = newState.layers.find((l) => l.id === op.layerId);
        if (layer) layer.locked = !op.oldLocked;
        break;
      }
      case 'clearLayer': {
        const layer = newState.layers.find((l) => l.id === op.layerId);
        if (layer) {
          const count = CELL_COUNTS[layer.level];
          for (let y = 0; y < count; y++) layer.cells[y].fill(null);
          if (layer.edgeRowTop) layer.edgeRowTop.fill(null);
          if (layer.edgeColLeft) layer.edgeColLeft.fill(null);
          layer.edgeCorner = null;
          layer.cellsGeneration++;
          layer.data.fill(0);
          markFullDirty(layer);
        }
        break;
      }
      case 'shrinkwrap': {
        shrinkwrapLayers(newState.layers, op.oldWidthL0, op.oldHeightL0, op.oldOriginL0X ?? 0, op.oldOriginL0Y ?? 0);
        newState = {
          ...newState,
          fileConfig: {
            ...newState.fileConfig,
            widthL0: op.newWidthL0,
            heightL0: op.newHeightL0,
            originL0X: op.newOriginL0X,
            originL0Y: op.newOriginL0Y,
          },
        };
        for (const layer of newState.layers) {
          rebuildPixelData(layer);
          markFullDirty(layer);
        }
        break;
      }
      case 'resizeCanvas': {
        // Most resizes only move the canvas window onto unchanged layer data.
        // The "auto-recenter on Resize entry" path also shifts layer data so
        // content stays visually put under a moved origin — redo needs to
        // replay that shift before clipping, or the apply would clear every
        // cell that used to be at the old origin.
        if (op.shiftL0X || op.shiftL0Y) {
          shiftLayerCells(newState.layers, op.shiftL0X ?? 0, op.shiftL0Y ?? 0);
        }
        newState = {
          ...newState,
          fileConfig: {
            ...newState.fileConfig,
            widthL0: op.newWidthL0,
            heightL0: op.newHeightL0,
            originL0X: op.newOriginL0X,
            originL0Y: op.newOriginL0Y,
          },
        };
        clearOutOfBoundsCells(newState.layers, op.newOriginL0X, op.newOriginL0Y, op.newWidthL0, op.newHeightL0);
        break;
      }
      case 'upscale': {
        if (op.shiftL0X !== 0 || op.shiftL0Y !== 0) {
          shiftLayerCells(newState.layers, -op.shiftL0X, -op.shiftL0Y);
        }
        upscaleLayers(newState.layers, op.oldWidthL0, op.oldHeightL0);
        const activeStillExists = newState.layers.some((l) => l.id === newState.activeLayerId);
        newState = {
          ...newState,
          fileConfig: {
            ...newState.fileConfig,
            widthL0: op.newWidthL0,
            heightL0: op.newHeightL0,
            originL0X: op.newOriginL0X,
            originL0Y: op.newOriginL0Y,
            clipBox: op.newClipBox ?? undefined,
          },
          activeLayerId: activeStillExists ? newState.activeLayerId : (newState.layers[0]?.id ?? newState.activeLayerId),
        };
        break;
      }
      case 'setClipBox': {
        newState = {
          ...newState,
          fileConfig: { ...newState.fileConfig, clipBox: op.newClipBox ?? undefined },
        };
        break;
      }
    }
  }

  newState.renderGeneration = state.renderGeneration + 1;
  return newState;
}

export function revertOps(state: EditorState, ops: UndoOp[]): EditorState {
  let newState = { ...state, layers: state.layers.map((l) => cloneLayer(l)) };

  // Revert in reverse order
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i];
    switch (op.op) {
      case 'cell': {
        const layer = newState.layers.find((l) => l.id === op.layerId);
        if (layer) {
          setCell(layer, op.cellX, op.cellY, op.oldState);
          layer.cellsGeneration++;
          renderCellToPixels(layer, op.cellX, op.cellY, op.oldState);
          const size = cellPx(layer.level);
          const rawX = op.cellX * size + layer.shiftX * size;
          const rawY = op.cellY * size + layer.shiftY * size;
          pushDirtyRect(layer, {
            x: Math.max(0, rawX),
            y: Math.max(0, rawY),
            width: Math.min(LAYER_PX, rawX + size) - Math.max(0, rawX),
            height: Math.min(LAYER_PX, rawY + size) - Math.max(0, rawY),
          });
        }
        break;
      }
      case 'addLayer': {
        // Undo addLayer = remove it
        newState.layers = newState.layers.filter((l) => l.id !== op.layer.id);
        if (newState.activeLayerId === op.layer.id && newState.layers.length > 0) {
          newState.activeLayerId = newState.layers[0].id;
        }
        break;
      }
      case 'removeLayer': {
        // Undo removeLayer = restore it at original index
        const restored = layerFromSnapshot(op.layer);
        newState.layers.splice(op.index, 0, restored);
        break;
      }
      case 'renameLayer': {
        const layer = newState.layers.find((l) => l.id === op.layerId);
        if (layer) layer.name = op.oldName;
        break;
      }
      case 'reorderLayer': {
        const layer = newState.layers.find((l) => l.id === op.layerId);
        if (layer) layer.order = op.oldOrder;
        break;
      }
      case 'toggleVisibility': {
        const layer = newState.layers.find((l) => l.id === op.layerId);
        if (layer) layer.visible = op.oldVisible;
        break;
      }
      case 'setActiveLayer': {
        newState.activeLayerId = op.oldActiveId;
        break;
      }
      case 'renameFile': {
        newState = {
          ...newState,
          fileConfig: { ...newState.fileConfig, name: op.oldName },
        };
        break;
      }
      case 'clearAll': {
        // Restore all layers from snapshots
        for (const snapshot of op.layerSnapshots) {
          const layer = newState.layers.find((l) => l.id === snapshot.id);
          if (layer) {
            const count = CELL_COUNTS[layer.level];
            for (let y = 0; y < count; y++) {
              for (let x = 0; x < count; x++) {
                layer.cells[y][x] = snapshot.cells[y][x];
              }
            }
            if (snapshot.edgeRowTop) layer.edgeRowTop = [...snapshot.edgeRowTop];
            if (snapshot.edgeColLeft) layer.edgeColLeft = [...snapshot.edgeColLeft];
            layer.edgeCorner = snapshot.edgeCorner ?? null;
            layer.cellsGeneration++;
            rebuildPixelData(layer);
            markFullDirty(layer);
          }
        }
        break;
      }
      case 'setShift': {
        const layer = newState.layers.find((l) => l.id === op.layerId);
        if (layer) {
          layer.shiftX = op.oldShiftX;
          layer.shiftY = op.oldShiftY;
          const count = CELL_COUNTS[layer.level];
          layer.edgeColLeft = op.oldShiftX === 0.5 ? new Array(count).fill(null) : null;
          layer.edgeRowTop = op.oldShiftY === 0.5 ? new Array(count).fill(null) : null;
          if (op.oldShiftX === 0 && op.oldShiftY === 0) layer.edgeCorner = null;
          rebuildPixelData(layer);
          markFullDirty(layer);
        }
        break;
      }
      case 'toggleLock': {
        const layer = newState.layers.find((l) => l.id === op.layerId);
        if (layer) layer.locked = op.oldLocked;
        break;
      }
      case 'clearLayer': {
        const layer = newState.layers.find((l) => l.id === op.layerId);
        if (layer) {
          const snapshot = op.layerSnapshot;
          const count = CELL_COUNTS[layer.level];
          for (let y = 0; y < count; y++) {
            for (let x = 0; x < count; x++) {
              layer.cells[y][x] = snapshot.cells[y][x];
            }
          }
          if (snapshot.edgeRowTop) layer.edgeRowTop = [...snapshot.edgeRowTop];
          if (snapshot.edgeColLeft) layer.edgeColLeft = [...snapshot.edgeColLeft];
          layer.edgeCorner = snapshot.edgeCorner ?? null;
          layer.cellsGeneration++;
          rebuildPixelData(layer);
          markFullDirty(layer);
        }
        break;
      }
      case 'shrinkwrap': {
        // Restore each layer's cells from the pre-shrinkwrap snapshot
        for (const snap of op.layerCellsBefore) {
          const layer = newState.layers.find((l) => l.id === snap.layerId);
          if (layer) {
            const count = CELL_COUNTS[layer.level];
            for (let y = 0; y < count; y++) {
              for (let x = 0; x < count; x++) {
                layer.cells[y][x] = snap.cells[y]?.[x] ?? null;
              }
            }
            layer.cellsGeneration++;
            rebuildPixelData(layer);
            markFullDirty(layer);
          }
        }
        // Restore per-layer shifts that shrinkwrap may have changed
        if (op.layerShiftsBefore) {
          for (const snap of op.layerShiftsBefore) {
            const layer = newState.layers.find((l) => l.id === snap.layerId);
            if (layer) {
              const count = CELL_COUNTS[layer.level];
              layer.shiftX = snap.shiftX;
              layer.shiftY = snap.shiftY;
              layer.edgeColLeft = snap.shiftX === 0.5 ? (layer.edgeColLeft ?? new Array(count).fill(null)) : null;
              layer.edgeRowTop = snap.shiftY === 0.5 ? (layer.edgeRowTop ?? new Array(count).fill(null)) : null;
              if (snap.shiftX === 0 && snap.shiftY === 0) layer.edgeCorner = null;
              rebuildPixelData(layer);
              markFullDirty(layer);
            }
          }
        }
        newState = {
          ...newState,
          fileConfig: {
            ...newState.fileConfig,
            widthL0: op.oldWidthL0,
            heightL0: op.oldHeightL0,
            originL0X: op.oldOriginL0X,
            originL0Y: op.oldOriginL0Y,
          },
        };
        break;
      }
      case 'resizeCanvas': {
        if (op.layerCellsBefore) {
          for (const snap of op.layerCellsBefore) {
            const layer = newState.layers.find((l) => l.id === snap.layerId);
            if (layer) {
              const count = CELL_COUNTS[layer.level];
              for (let y = 0; y < count; y++) {
                for (let x = 0; x < count; x++) {
                  layer.cells[y][x] = snap.cells[y]?.[x] ?? null;
                }
              }
              layer.cellsGeneration++;
              rebuildPixelData(layer);
              markFullDirty(layer);
            }
          }
        }
        newState = {
          ...newState,
          fileConfig: {
            ...newState.fileConfig,
            widthL0: op.oldWidthL0,
            heightL0: op.oldHeightL0,
            originL0X: op.oldOriginL0X,
            originL0Y: op.oldOriginL0Y,
          },
        };
        break;
      }
      case 'upscale': {
        // Rebuild the full layer list from pre-upscale snapshots (so L4 layers
        // that were removed come back with fresh pixel buffers).
        const rebuilt = op.layerSnapshotsBefore.map((snap) => layerFromSnapshot(snap));
        newState = {
          ...newState,
          layers: rebuilt,
          fileConfig: {
            ...newState.fileConfig,
            widthL0: op.oldWidthL0,
            heightL0: op.oldHeightL0,
            originL0X: op.oldOriginL0X,
            originL0Y: op.oldOriginL0Y,
            clipBox: op.oldClipBox ?? undefined,
          },
          activeLayerId: op.activeLayerIdBefore,
        };
        break;
      }
      case 'setClipBox': {
        newState = {
          ...newState,
          fileConfig: { ...newState.fileConfig, clipBox: op.oldClipBox ?? undefined },
        };
        break;
      }
    }
  }

  newState.renderGeneration = state.renderGeneration + 1;
  return newState;
}

// ── Helpers ──────────────────────────────────────────────────────────

export function layerFromSnapshot(snapshot: LayerSnapshot): Layer {
  const data = new Uint8Array(LAYER_PX * LAYER_PX * 4);
  const layer: Layer = hideHeavyLayerFields({
    id: snapshot.id,
    name: snapshot.name,
    level: snapshot.level,
    visible: snapshot.visible,
    opacity: snapshot.opacity,
    order: snapshot.order,
    shiftX: snapshot.shiftX,
    shiftY: snapshot.shiftY,
    locked: snapshot.locked,
    data,
    dataU32: new Uint32Array(data.buffer),
    dirtyRects: initDirtyRects(),
    dirtyRectCount: 0,
    cells: snapshot.cells,
    cellsGeneration: 0,
    edgeRowTop: snapshot.edgeRowTop ? [...snapshot.edgeRowTop] : null,
    edgeColLeft: snapshot.edgeColLeft ? [...snapshot.edgeColLeft] : null,
    edgeCorner: snapshot.edgeCorner ?? null,
  });
  rebuildPixelData(layer);
  markFullDirty(layer);
  return layer;
}

// ── Deep Edit Layer Iteration ────────────────────────────────────────

export interface ContainedLayerCells {
  layer: Layer;
  cellMinX: number;
  cellMinY: number;
  cellMaxX: number;
  cellMaxY: number;
}

/**
 * Find all layers (and their contained cell ranges) that fall within a pixel
 * bounding box. When `deepEdit` is true, returns the active layer plus all
 * finer layers with cells fully contained. When false, only the active layer.
 */
export function getContainedLayerCells(
  layers: Layer[],
  activeLayerId: string,
  activeLevel: GridLevel,
  pxMinX: number,
  pxMinY: number,
  pxMaxX: number,
  pxMaxY: number,
  deepEdit: boolean,
  includeCoarser: boolean = false,
): ContainedLayerCells[] {
  const result: ContainedLayerCells[] = [];
  for (const layer of layers) {
    if (!includeCoarser && layer.level > activeLevel) continue;
    if (!deepEdit && layer.id !== activeLayerId) continue;
    if ((layer.locked || !layer.visible) && layer.id !== activeLayerId) continue;
    const lcp = cellPx(layer.level);
    const lc = CELL_COUNTS[layer.level];
    const shiftPxX = layer.shiftX * lcp;
    const shiftPxY = layer.shiftY * lcp;
    const cellMinX = Math.ceil((pxMinX - shiftPxX) / lcp);
    const cellMinY = Math.ceil((pxMinY - shiftPxY) / lcp);
    const cellMaxX = Math.floor((pxMaxX - shiftPxX) / lcp) - 1;
    const cellMaxY = Math.floor((pxMaxY - shiftPxY) / lcp) - 1;
    if (cellMinX > cellMaxX || cellMinY > cellMaxY) continue;
    result.push({
      layer,
      cellMinX: Math.max(0, cellMinX),
      cellMinY: Math.max(0, cellMinY),
      cellMaxX: Math.min(lc - 1, cellMaxX),
      cellMaxY: Math.min(lc - 1, cellMaxY),
    });
  }
  return result;
}

// ── Move Operations ─────────────────────────────────────────────────

export function computeMoveOps(
  state: EditorState,
  selection: Selection,
  deltaCellX: number,
  deltaCellY: number,
  deepEdit: boolean = true,
  pathFilter?: PathFilter,
  copy: boolean = false,
): UndoOp[] {
  const activeLevel = selection.level;
  const activeCellPxVal = cellPx(activeLevel);
  const activeLayer = state.layers.find((l) => l.id === state.activeLayerId);
  const activeShiftPxX = (activeLayer?.shiftX ?? 0) * activeCellPxVal;
  const activeShiftPxY = (activeLayer?.shiftY ?? 0) * activeCellPxVal;

  // Pixel bounds of the selection (shift-aware)
  const pxMinX = selection.startCellX * activeCellPxVal + activeShiftPxX;
  const pxMinY = selection.startCellY * activeCellPxVal + activeShiftPxY;
  const pxMaxX = (selection.endCellX + 1) * activeCellPxVal + activeShiftPxX;
  const pxMaxY = (selection.endCellY + 1) * activeCellPxVal + activeShiftPxY;

  const ops: UndoOp[] = [];
  const contained = getContainedLayerCells(state.layers, state.activeLayerId, activeLevel, pxMinX, pxMinY, pxMaxX, pxMaxY, deepEdit, deepEdit);

  for (const { layer, cellMinX, cellMinY, cellMaxX, cellMaxY } of contained) {
    const layerCount = CELL_COUNTS[layer.level];

    // Scale delta for this layer level
    const scale = CELL_COUNTS[layer.level] / CELL_COUNTS[activeLevel];
    const deltaLX = deltaCellX * scale;
    const deltaLY = deltaCellY * scale;
    if (deltaLX !== Math.round(deltaLX) || deltaLY !== Math.round(deltaLY)) continue;

    // Snapshot source cells first (filtered by path selection if provided)
    const snapshot: { cx: number; cy: number; state: CellState }[] = [];
    for (let cy = cellMinY; cy <= cellMaxY; cy++) {
      for (let cx = cellMinX; cx <= cellMaxX; cx++) {
        if (pathFilter && !isCellInPathSelection(pathFilter.pathIndices, pathFilter.pathLevel, layer.level, cx, cy)) continue;
        snapshot.push({ cx, cy, state: layer.cells[cy][cx] });
      }
    }

    // Clear source cells (skipped in copy mode)
    if (!copy) {
      for (const s of snapshot) {
        ops.push({
          op: 'cell',
          layerId: layer.id,
          cellX: s.cx,
          cellY: s.cy,
          oldState: s.state,
          newState: null,
        });
      }
    }

    // Write to destination cells
    for (const s of snapshot) {
      if (s.state === null) continue;
      const destX = s.cx + deltaLX;
      const destY = s.cy + deltaLY;
      if (destX < 0 || destX >= layerCount || destY < 0 || destY >= layerCount) continue;
      const destOld = layer.cells[destY][destX];
      ops.push({
        op: 'cell',
        layerId: layer.id,
        cellX: destX,
        cellY: destY,
        oldState: destOld,
        newState: s.state,
      });
    }
  }

  return ops;
}

// ── Rotate Operations ────────────────────────────────────────────────

/** Shared output for rotateOffset — avoids allocating a new array per call.
 *  Callers must consume values before the next call to rotateOffset. */
const _rotateOut: [number, number] = [0, 0];

export function rotateOffset(
  dx: number,
  dy: number,
  rotation: 0 | 90 | 180 | 270,
): [number, number] {
  switch (rotation) {
    case 90:  _rotateOut[0] = -dy; _rotateOut[1] = dx;  break;
    case 180: _rotateOut[0] = -dx; _rotateOut[1] = -dy; break;
    case 270: _rotateOut[0] = dy;  _rotateOut[1] = -dx; break;
    default:  _rotateOut[0] = dx;  _rotateOut[1] = dy;  break;
  }
  return _rotateOut;
}

export function composeRotation(transform: CellTransform, rotation: 0 | 90 | 180 | 270): CellTransform {
  // The render pipeline applies rotation first, then mirrors:
  //   source = M_v ∘ M_h ∘ R_CW(θ) ∘ dest
  // Adding a CW visual rotation φ appends R_CW(φ) to dest:
  //   T' = M_v ∘ M_h ∘ R_CW(θ) ∘ R_CW(φ) = M_v ∘ M_h ∘ R_CW(θ+φ)
  // Mirrors are unaffected; rotation always adds.
  const newRot = MOD_360[transform.rotation + rotation];
  return { ...transform, rotation: newRot };
}

export function computeRotateOps(
  state: EditorState,
  selection: Selection,
  rotation: 0 | 90 | 180 | 270,
  deepEdit: boolean = true,
  pathFilter?: PathFilter,
  copy: boolean = false,
): UndoOp[] {
  if (rotation === 0) return [];

  const activeLevel = selection.level;
  const activeCellPxVal = cellPx(activeLevel);
  const activeLayer = state.layers.find((l) => l.id === state.activeLayerId);
  const activeShiftPxX = (activeLayer?.shiftX ?? 0) * activeCellPxVal;
  const activeShiftPxY = (activeLayer?.shiftY ?? 0) * activeCellPxVal;

  // Pixel bounds of the selection (shift-aware)
  const pxMinX = selection.startCellX * activeCellPxVal + activeShiftPxX;
  const pxMinY = selection.startCellY * activeCellPxVal + activeShiftPxY;
  const pxMaxX = (selection.endCellX + 1) * activeCellPxVal + activeShiftPxX;
  const pxMaxY = (selection.endCellY + 1) * activeCellPxVal + activeShiftPxY;

  // Pixel center of the selection
  const centerPxX = (pxMinX + pxMaxX) / 2;
  const centerPxY = (pxMinY + pxMaxY) / 2;

  // Build active-layer cell destination map (source → dest)
  const activeDestMap = new Map<number, { destCX: number; destCY: number }>();
  for (let ay = selection.startCellY; ay <= selection.endCellY; ay++) {
    for (let ax = selection.startCellX; ax <= selection.endCellX; ax++) {
      const srcCX = (ax + 0.5) * activeCellPxVal + activeShiftPxX;
      const srcCY = (ay + 0.5) * activeCellPxVal + activeShiftPxY;
      const [rdx, rdy] = rotateOffset(srcCX - centerPxX, srcCY - centerPxY, rotation);
      const destCX = Math.floor((centerPxX + rdx - activeShiftPxX) / activeCellPxVal);
      const destCY = Math.floor((centerPxY + rdy - activeShiftPxY) / activeCellPxVal);
      activeDestMap.set(ax * 100000 + ay, { destCX, destCY });
    }
  }

  const ops: UndoOp[] = [];
  const contained = getContainedLayerCells(state.layers, state.activeLayerId, activeLevel, pxMinX, pxMinY, pxMaxX, pxMaxY, deepEdit, deepEdit);

  for (const { layer, cellMinX, cellMinY, cellMaxX, cellMaxY } of contained) {
    const layerCellPxVal = cellPx(layer.level);
    const layerCount = CELL_COUNTS[layer.level];

    // Snapshot source cells (filtered by path selection if provided)
    const snapshot: { cx: number; cy: number; state: CellState }[] = [];
    for (let cy = cellMinY; cy <= cellMaxY; cy++) {
      for (let cx = cellMinX; cx <= cellMaxX; cx++) {
        if (pathFilter && !isCellInPathSelection(pathFilter.pathIndices, pathFilter.pathLevel, layer.level, cx, cy)) continue;
        snapshot.push({ cx, cy, state: layer.cells[cy][cx] });
      }
    }

    // Clear source cells (skipped in copy mode)
    if (!copy) {
      for (const s of snapshot) {
        ops.push({
          op: 'cell',
          layerId: layer.id,
          cellX: s.cx,
          cellY: s.cy,
          oldState: s.state,
          newState: null,
        });
      }
    }

    const isActiveLayer = layer.id === state.activeLayerId;
    const layerShiftPxX = layer.shiftX * layerCellPxVal;
    const layerShiftPxY = layer.shiftY * layerCellPxVal;

    // Write to rotated destinations
    for (const s of snapshot) {
      if (s.state === null) continue;

      let destCX: number, destCY: number;

      const srcCenterPxX = (s.cx + 0.5) * layerCellPxVal + layerShiftPxX;
      const srcCenterPxY = (s.cy + 0.5) * layerCellPxVal + layerShiftPxY;

      if (isActiveLayer || layer.level > activeLevel) {
        // Active or coarser layer: pixel-center rotation around selection center
        const [rdx, rdy] = rotateOffset(srcCenterPxX - centerPxX, srcCenterPxY - centerPxY, rotation);
        destCX = Math.floor((centerPxX + rdx - layerShiftPxX) / layerCellPxVal);
        destCY = Math.floor((centerPxY + rdy - layerShiftPxY) / layerCellPxVal);
      } else {
        // Finer layer: rotate sub-cell offset within its parent active-layer
        // cell, then place at that offset within the parent's destination.
        // This keeps finer layers aligned with the active layer.
        const parentAX = Math.floor((srcCenterPxX - activeShiftPxX) / activeCellPxVal);
        const parentAY = Math.floor((srcCenterPxY - activeShiftPxY) / activeCellPxVal);
        const parentCenterX = (parentAX + 0.5) * activeCellPxVal + activeShiftPxX;
        const parentCenterY = (parentAY + 0.5) * activeCellPxVal + activeShiftPxY;

        const dest = activeDestMap.get(parentAX * 100000 + parentAY);
        if (!dest) continue;

        const offsetX = srcCenterPxX - parentCenterX;
        const offsetY = srcCenterPxY - parentCenterY;
        const [rOffX, rOffY] = rotateOffset(offsetX, offsetY, rotation);

        const destParentCenterX = (dest.destCX + 0.5) * activeCellPxVal + activeShiftPxX;
        const destParentCenterY = (dest.destCY + 0.5) * activeCellPxVal + activeShiftPxY;

        destCX = Math.floor((destParentCenterX + rOffX - layerShiftPxX) / layerCellPxVal);
        destCY = Math.floor((destParentCenterY + rOffY - layerShiftPxY) / layerCellPxVal);
      }

      // Skip out-of-bounds
      if (destCX < 0 || destCX >= layerCount || destCY < 0 || destCY >= layerCount) continue;

      const newState: CellState = {
        ...s.state,
        transform: composeRotation(s.state.transform, rotation),
      };

      const destOld = layer.cells[destCY]?.[destCX] ?? null;
      ops.push({
        op: 'cell',
        layerId: layer.id,
        cellX: destCX,
        cellY: destCY,
        oldState: destOld,
        newState,
      });
    }
  }

  return ops;
}

// ── Mirror Operations ────────────────────────────────────────────────

export function computeMirrorOps(
  state: EditorState,
  selection: Selection,
  axis: 'h' | 'v',
  deepEdit: boolean = true,
): UndoOp[] {
  const activeLevel = selection.level;
  const activeCellPxVal = cellPx(activeLevel);
  const activeLayer = state.layers.find((l) => l.id === state.activeLayerId);
  const activeShiftPxX = (activeLayer?.shiftX ?? 0) * activeCellPxVal;
  const activeShiftPxY = (activeLayer?.shiftY ?? 0) * activeCellPxVal;

  const pxMinX = selection.startCellX * activeCellPxVal + activeShiftPxX;
  const pxMinY = selection.startCellY * activeCellPxVal + activeShiftPxY;
  const pxMaxX = (selection.endCellX + 1) * activeCellPxVal + activeShiftPxX;
  const pxMaxY = (selection.endCellY + 1) * activeCellPxVal + activeShiftPxY;

  const centerPxX = (pxMinX + pxMaxX) / 2;
  const centerPxY = (pxMinY + pxMaxY) / 2;

  const ops: UndoOp[] = [];
  const contained = getContainedLayerCells(state.layers, state.activeLayerId, activeLevel, pxMinX, pxMinY, pxMaxX, pxMaxY, deepEdit, deepEdit);

  for (const { layer, cellMinX, cellMinY, cellMaxX, cellMaxY } of contained) {
    const layerCellPxVal = cellPx(layer.level);
    const layerCount = CELL_COUNTS[layer.level];

    const snapshot: { cx: number; cy: number; state: CellState }[] = [];
    for (let cy = cellMinY; cy <= cellMaxY; cy++) {
      for (let cx = cellMinX; cx <= cellMaxX; cx++) {
        snapshot.push({ cx, cy, state: layer.cells[cy][cx] });
      }
    }

    // Clear source cells
    for (const s of snapshot) {
      ops.push({
        op: 'cell',
        layerId: layer.id,
        cellX: s.cx,
        cellY: s.cy,
        oldState: s.state,
        newState: null,
      });
    }

    const layerShiftPxX = layer.shiftX * layerCellPxVal;
    const layerShiftPxY = layer.shiftY * layerCellPxVal;

    // Write to mirrored destinations
    for (const s of snapshot) {
      if (s.state === null) continue;

      const srcCenterPxX = (s.cx + 0.5) * layerCellPxVal + layerShiftPxX;
      const srcCenterPxY = (s.cy + 0.5) * layerCellPxVal + layerShiftPxY;

      let newCenterPxX: number, newCenterPxY: number;
      if (axis === 'h') {
        // Mirror across vertical axis (flip X)
        newCenterPxX = 2 * centerPxX - srcCenterPxX;
        newCenterPxY = srcCenterPxY;
      } else {
        // Mirror across horizontal axis (flip Y)
        newCenterPxX = srcCenterPxX;
        newCenterPxY = 2 * centerPxY - srcCenterPxY;
      }

      const destCX = Math.floor((newCenterPxX - layerShiftPxX) / layerCellPxVal);
      const destCY = Math.floor((newCenterPxY - layerShiftPxY) / layerCellPxVal);

      if (destCX < 0 || destCX >= layerCount || destCY < 0 || destCY >= layerCount) continue;

      // Toggle the corresponding mirror flag and negate rotation.
      // Mirroring reverses the rotation direction in the render pipeline:
      // R(θ) ∘ M = M ∘ R(-θ), so the stored rotation must be negated.
      const newMirrorH = axis === 'h' ? !s.state.transform.mirrorH : s.state.transform.mirrorH;
      const newMirrorV = axis === 'v' ? !s.state.transform.mirrorV : s.state.transform.mirrorV;
      const newRotation = MOD_360[360 - s.state.transform.rotation];
      const newState: CellState = {
        ...s.state,
        transform: { mirrorH: newMirrorH, mirrorV: newMirrorV, rotation: newRotation },
      };

      const destOld = layer.cells[destCY][destCX];
      ops.push({
        op: 'cell',
        layerId: layer.id,
        cellX: destCX,
        cellY: destCY,
        oldState: destOld,
        newState,
      });
    }
  }

  return ops;
}

// ── Global Mirror Expansion for Selection Ops ────────────────────────

/** Returns true when any global mirror flag is active. */
export function hasAnyGlobalMirror(s: EditorState): boolean {
  return s.mirrorH || s.mirrorV || s.mirrorRotate || s.mirrorQuad
    || s.mirrorRow || s.mirrorCol || s.mirrorDiag1 || s.mirrorDiag2
    || s.mirrorDiagBoth || s.mirrorStar;
}

/**
 * Expand selection-transform ops (move/rotate/mirror) to respect the global
 * mirror settings: each cell op is replicated at every mirror-equivalent
 * position, with sprite `newState` transforms composed via `mirrorCellState`.
 * Source-clear ops (newState === null) are also mirror-expanded so the
 * mirrored sources are cleared too.
 *
 * Dedups by `layerId:cellX:cellY`, keeping the first op seen (primary ops
 * take precedence over mirror-expanded ops at the same cell).
 *
 * Returns `ops` unchanged when no mirror flag is active.
 */
export function expandOpsWithMirror(
  state: EditorState,
  ops: UndoOp[],
): UndoOp[] {
  if (!hasAnyGlobalMirror(state)) return ops;

  const canvasCfg = effectiveCanvasDims(state.fileConfig);

  const mFlags: MirrorFlags = {
    mirrorH: state.mirrorH, mirrorV: state.mirrorV,
    mirrorRotate: state.mirrorRotate, mirrorQuad: state.mirrorQuad,
    mirrorRow: state.mirrorRow, mirrorCol: state.mirrorCol,
    mirrorDiag1: state.mirrorDiag1, mirrorDiag2: state.mirrorDiag2,
    mirrorDiagBoth: state.mirrorDiagBoth, mirrorStar: state.mirrorStar,
  };

  const layerById = new Map<string, Layer>();
  for (const l of state.layers) layerById.set(l.id, l);

  const seen = new Set<string>();
  for (const op of ops) {
    if (op.op !== 'cell') continue;
    seen.add(`${op.layerId}:${op.cellX}:${op.cellY}`);
  }

  const expanded: UndoOp[] = [...ops];

  for (const op of ops) {
    if (op.op !== 'cell') continue;
    const layer = layerById.get(op.layerId);
    if (!layer) continue;
    const layerCount = CELL_COUNTS[layer.level];

    const targets = computePaintMirrorTargets(op.cellX, op.cellY, layer, canvasCfg, mFlags);
    for (let i = 0; i < targets.length; i++) {
      const m = targets[i];
      if (m.x < 0 || m.y < 0 || m.x >= layerCount || m.y >= layerCount) continue;
      const key = `${op.layerId}:${m.x}:${m.y}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const oldState = layer.cells[m.y][m.x];
      const newState = op.newState === null
        ? null
        : mirrorCellState(op.newState, m.mH, m.mV, m.rot);

      expanded.push({
        op: 'cell',
        layerId: op.layerId,
        cellX: m.x,
        cellY: m.y,
        oldState,
        newState,
      });
    }
  }

  return expanded;
}

// ── Region Zoom Helpers ─────────────────────────────────────────────

/** Region zoom pixel bounds */
export interface RegionBoundsPx {
  pxMinX: number;
  pxMinY: number;
  pxMaxX: number;
  pxMaxY: number;
}

/**
 * Returns true if a cell on the given layer falls within the zoom region's
 * pixel bounds. Works across any layer level/shift combination.
 */
export function isCellInRegionPx(
  cellX: number, cellY: number,
  layer: Layer,
  bounds: RegionBoundsPx,
): boolean {
  const cellSize = cellPx(layer.level);
  const shiftPxX = layer.shiftX * cellSize;
  const shiftPxY = layer.shiftY * cellSize;
  // Use cell center for the containment test
  const centerPxX = (cellX + 0.5) * cellSize + shiftPxX;
  const centerPxY = (cellY + 0.5) * cellSize + shiftPxY;
  return centerPxX >= bounds.pxMinX && centerPxX <= bounds.pxMaxX &&
         centerPxY >= bounds.pxMinY && centerPxY <= bounds.pxMaxY;
}

// ── Shift Layer Cells ───────────────────────────────────────────────

/**
 * Shift all layer cells by the given L0 offset. Layers are mutated in-place.
 * Used by canvas resize when TL/TR/BL corners move the origin.
 */
export function shiftLayerCells(layers: Layer[], shiftL0X: number, shiftL0Y: number): void {
  if (shiftL0X === 0 && shiftL0Y === 0) return;

  for (const layer of layers) {
    const count = CELL_COUNTS[layer.level];
    const cellsPerL0 = 32 / count;

    const vX = layer.shiftX + shiftL0X / cellsPerL0;
    const cellShiftX = Math.floor(vX);
    const newShiftX: 0 | 0.5 = vX - cellShiftX === 0.5 ? 0.5 : 0;

    const vY = layer.shiftY + shiftL0Y / cellsPerL0;
    const cellShiftY = Math.floor(vY);
    const newShiftY: 0 | 0.5 = vY - cellShiftY === 0.5 ? 0.5 : 0;

    const changed =
      cellShiftX !== 0 || cellShiftY !== 0 ||
      newShiftX !== layer.shiftX || newShiftY !== layer.shiftY;
    if (!changed) continue;

    const entries: { x: number; y: number; state: CellState }[] = [];
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        if (layer.cells[y]?.[x] != null) {
          entries.push({ x, y, state: layer.cells[y][x]! });
        }
      }
    }
    if (layer.edgeColLeft) {
      for (let y = 0; y < count; y++) {
        if (layer.edgeColLeft[y] != null) {
          entries.push({ x: -1, y, state: layer.edgeColLeft[y]! });
        }
      }
    }
    if (layer.edgeRowTop) {
      for (let x = 0; x < count; x++) {
        if (layer.edgeRowTop[x] != null) {
          entries.push({ x, y: -1, state: layer.edgeRowTop[x]! });
        }
      }
    }
    if (layer.edgeCorner != null) {
      entries.push({ x: -1, y: -1, state: layer.edgeCorner });
    }

    const newCells: (CellState | null)[][] = [];
    for (let y = 0; y < count; y++) {
      newCells[y] = new Array(count).fill(null);
    }
    const newEdgeColLeft: (CellState | null)[] | null =
      newShiftX === 0.5 ? new Array(count).fill(null) : null;
    const newEdgeRowTop: (CellState | null)[] | null =
      newShiftY === 0.5 ? new Array(count).fill(null) : null;
    let newEdgeCorner: CellState | null = null;

    for (const { x, y, state } of entries) {
      const nx = x + cellShiftX;
      const ny = y + cellShiftY;
      if (nx >= 0 && nx < count && ny >= 0 && ny < count) {
        newCells[ny][nx] = state;
      } else if (nx === -1 && ny >= 0 && ny < count && newEdgeColLeft) {
        newEdgeColLeft[ny] = state;
      } else if (ny === -1 && nx >= 0 && nx < count && newEdgeRowTop) {
        newEdgeRowTop[nx] = state;
      } else if (nx === -1 && ny === -1 && newShiftX === 0.5 && newShiftY === 0.5) {
        newEdgeCorner = state;
      }
    }

    layer.cells = newCells;
    layer.edgeColLeft = newEdgeColLeft;
    layer.edgeRowTop = newEdgeRowTop;
    layer.edgeCorner = newEdgeCorner;
    layer.shiftX = newShiftX;
    layer.shiftY = newShiftY;
    layer.cellsGeneration++;
    rebuildPixelData(layer);
    markFullDirty(layer);
  }
}

// ── Clear Out-of-Bounds Cells ───────────────────────────────────────

/**
 * Clear cells that fall outside the active canvas region for each layer.
 * The canvas window lies at L0 range [originL0X, originL0X + widthL0) ×
 * [originL0Y, originL0Y + heightL0) within the shared 32×32 L0 layer space.
 * A cell at index (x, y) with level cellsPerL0 c and layer shift s is kept
 * iff its L0 span [x·c + s, (x+1)·c + s) overlaps the canvas — equivalently,
 * if its index is in [floor((originL0 - s)/c), ceil((originL0 + dim - s)/c)).
 * Edge cells at x=-1 (edgeColLeft) or y=-1 (edgeRowTop) count as cell
 * indices −1 and get the same test; they're kept when the canvas window
 * extends into the half-cell strip in front of the layer origin.
 */
export function clearOutOfBoundsCells(
  layers: Layer[],
  originL0X: number,
  originL0Y: number,
  widthL0: number,
  heightL0: number,
): void {
  for (const layer of layers) {
    const count = CELL_COUNTS[layer.level];
    const size = cellPx(layer.level);
    const cellsPerL0 = 32 / count;
    const sL0X = layer.shiftX * cellsPerL0;
    const sL0Y = layer.shiftY * cellsPerL0;

    const minX = Math.floor((originL0X - sL0X) / cellsPerL0);
    const maxX = Math.ceil((originL0X + widthL0 - sL0X) / cellsPerL0);
    const minY = Math.floor((originL0Y - sL0Y) / cellsPerL0);
    const maxY = Math.ceil((originL0Y + heightL0 - sL0Y) / cellsPerL0);

    // Edge cells exist at index -1 (when the layer is shifted on that axis).
    const minXWithEdge = layer.shiftX === 0.5 ? -1 : 0;
    const minYWithEdge = layer.shiftY === 0.5 ? -1 : 0;

    // Fast-out: if every cell (including edge) is in-bounds, nothing to do.
    if (minX <= minXWithEdge && maxX >= count && minY <= minYWithEdge && maxY >= count) continue;

    let changed = false;
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        if ((x < minX || x >= maxX || y < minY || y >= maxY) && layer.cells[y][x] != null) {
          layer.cells[y][x] = null;
          changed = true;
        }
      }
    }
    // Edge cells: edgeColLeft is at x=-1; edgeRowTop is at y=-1; edgeCorner at (-1,-1).
    if (layer.edgeColLeft) {
      for (let y = 0; y < count; y++) {
        if (layer.edgeColLeft[y] != null && (minX > -1 || y < minY || y >= maxY)) {
          layer.edgeColLeft[y] = null;
          changed = true;
        }
      }
    }
    if (layer.edgeRowTop) {
      for (let x = 0; x < count; x++) {
        if (layer.edgeRowTop[x] != null && (minY > -1 || x < minX || x >= maxX)) {
          layer.edgeRowTop[x] = null;
          changed = true;
        }
      }
    }
    if (layer.edgeCorner != null && (minX > -1 || minY > -1)) {
      layer.edgeCorner = null;
      changed = true;
    }

    if (changed) {
      layer.cellsGeneration++;
      rebuildPixelData(layer);
      // Emit up to 4 dirty strips (one per side that was clipped). Stacking
      // narrow rects lets the renderer's texSubImage2D call touch a
      // fraction of the layer texture instead of the full 16 MB, which
      // would cause the iOS GL driver to orphan the existing IOSurface.
      const shiftPxX = layer.shiftX * size;
      const shiftPxY = layer.shiftY * size;
      layer.dirtyRectCount = 0;
      // Left strip: cells [minXWithEdge, minX) → pixel [0, minX*size + shiftPxX)
      if (minX > minXWithEdge) {
        const endX = Math.max(0, Math.min(LAYER_PX, minX * size + shiftPxX));
        if (endX > 0) pushDirtyRect(layer, 0, 0, endX, LAYER_PX);
      }
      // Right strip: cells [maxX, count) → pixel [maxX*size + shiftPxX, LAYER_PX)
      if (maxX < count) {
        const startX = Math.max(0, Math.min(LAYER_PX, maxX * size + shiftPxX));
        if (startX < LAYER_PX) pushDirtyRect(layer, startX, 0, LAYER_PX - startX, LAYER_PX);
      }
      // Top strip: rows [minYWithEdge, minY)
      if (minY > minYWithEdge) {
        const endY = Math.max(0, Math.min(LAYER_PX, minY * size + shiftPxY));
        if (endY > 0) pushDirtyRect(layer, 0, 0, LAYER_PX, endY);
      }
      // Bottom strip
      if (maxY < count) {
        const startY = Math.max(0, Math.min(LAYER_PX, maxY * size + shiftPxY));
        if (startY < LAYER_PX) pushDirtyRect(layer, 0, startY, LAYER_PX, LAYER_PX - startY);
      }
    }
  }
}

// ── Shrinkwrap ──────────────────────────────────────────────────────

/**
 * Mark the smallest rect covering the union of old and new content pixel
 * positions. Used from shrinkwrap so we don't re-upload the full
 * 2048×2048 texture for every shifted layer. Bboxes are in cell coords
 * (inclusive); pass maxX/maxY = -1 to indicate "no content on that side".
 */
function markShrinkwrapDirty(
  layer: Layer,
  oldShiftX: 0 | 0.5, oldShiftY: 0 | 0.5,
  oldMinX: number, oldMinY: number, oldMaxX: number, oldMaxY: number,
  newShiftX: 0 | 0.5, newShiftY: 0 | 0.5,
  newMinX: number, newMinY: number, newMaxX: number, newMaxY: number,
): void {
  const size = cellPx(layer.level);
  const hadOld = oldMaxX >= 0;
  const hasNew = newMaxX >= 0;

  if (!hadOld && !hasNew) {
    layer.dirtyRectCount = 0;
    return;
  }

  let pxMinX = LAYER_PX, pxMinY = LAYER_PX, pxMaxX = 0, pxMaxY = 0;
  if (hadOld) {
    const sx = oldShiftX * size, sy = oldShiftY * size;
    if (oldMinX * size + sx < pxMinX) pxMinX = oldMinX * size + sx;
    if (oldMinY * size + sy < pxMinY) pxMinY = oldMinY * size + sy;
    if ((oldMaxX + 1) * size + sx > pxMaxX) pxMaxX = (oldMaxX + 1) * size + sx;
    if ((oldMaxY + 1) * size + sy > pxMaxY) pxMaxY = (oldMaxY + 1) * size + sy;
  }
  if (hasNew) {
    const sx = newShiftX * size, sy = newShiftY * size;
    if (newMinX * size + sx < pxMinX) pxMinX = newMinX * size + sx;
    if (newMinY * size + sy < pxMinY) pxMinY = newMinY * size + sy;
    if ((newMaxX + 1) * size + sx > pxMaxX) pxMaxX = (newMaxX + 1) * size + sx;
    if ((newMaxY + 1) * size + sy > pxMaxY) pxMaxY = (newMaxY + 1) * size + sy;
  }

  // Edge cells (cellX=-1 or cellY=-1) render into [0, size/2] when shift is 0.5.
  // If either old or new shift is half, include that strip so stale edge
  // pixels from the other state get cleared.
  if (oldShiftX === 0.5 || newShiftX === 0.5) pxMinX = 0;
  if (oldShiftY === 0.5 || newShiftY === 0.5) pxMinY = 0;

  if (pxMinX < 0) pxMinX = 0;
  if (pxMinY < 0) pxMinY = 0;
  if (pxMaxX > LAYER_PX) pxMaxX = LAYER_PX;
  if (pxMaxY > LAYER_PX) pxMaxY = LAYER_PX;

  if (pxMinX >= pxMaxX || pxMinY >= pxMaxY) {
    layer.dirtyRectCount = 0;
    return;
  }

  const slot = layer.dirtyRects[0];
  slot.x = pxMinX;
  slot.y = pxMinY;
  slot.width = pxMaxX - pxMinX;
  slot.height = pxMaxY - pxMinY;
  layer.dirtyRectCount = 1;
}

/**
 * Compute the tight L0 bounding box of all non-null cells across all layers,
 * clamped to [0, 32]. Deliberately NOT snapped outward (see return-site
 * comment). Returns null if no layers have content.
 */
export function computeContentBounds(
  layers: Layer[],
): { minL0X: number; minL0Y: number; maxL0X: number; maxL0Y: number } | null {
  let minL0X = Infinity, minL0Y = Infinity;
  let maxL0X = -Infinity, maxL0Y = -Infinity;

  for (const layer of layers) {
    const count = CELL_COUNTS[layer.level];
    const cellsPerL0 = 32 / count;
    const shiftL0X = layer.shiftX * cellsPerL0;
    const shiftL0Y = layer.shiftY * cellsPerL0;

    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        if (layer.cells[y]?.[x] != null) {
          const l0X = x * cellsPerL0 + shiftL0X;
          const l0Y = y * cellsPerL0 + shiftL0Y;
          if (l0X < minL0X) minL0X = l0X;
          if (l0Y < minL0Y) minL0Y = l0Y;
          if (l0X + cellsPerL0 > maxL0X) maxL0X = l0X + cellsPerL0;
          if (l0Y + cellsPerL0 > maxL0Y) maxL0Y = l0Y + cellsPerL0;
        }
      }
    }
    // Also check edge cells for shifted layers
    if (layer.edgeRowTop) {
      for (let x = 0; x < layer.edgeRowTop.length; x++) {
        if (layer.edgeRowTop[x] != null) {
          const l0X = x * cellsPerL0 + shiftL0X;
          const l0Y = -1 * cellsPerL0 + shiftL0Y;
          if (l0X < minL0X) minL0X = l0X;
          if (l0Y < minL0Y) minL0Y = l0Y;
          if (l0X + cellsPerL0 > maxL0X) maxL0X = l0X + cellsPerL0;
          if (l0Y + cellsPerL0 > maxL0Y) maxL0Y = l0Y + cellsPerL0;
        }
      }
    }
    if (layer.edgeColLeft) {
      for (let y = 0; y < layer.edgeColLeft.length; y++) {
        if (layer.edgeColLeft[y] != null) {
          const l0X = -1 * cellsPerL0 + shiftL0X;
          const l0Y = y * cellsPerL0 + shiftL0Y;
          if (l0X < minL0X) minL0X = l0X;
          if (l0Y < minL0Y) minL0Y = l0Y;
          if (l0X + cellsPerL0 > maxL0X) maxL0X = l0X + cellsPerL0;
          if (l0Y + cellsPerL0 > maxL0Y) maxL0Y = l0Y + cellsPerL0;
        }
      }
    }
    if (layer.edgeCorner != null) {
      const l0X = -1 * cellsPerL0 + shiftL0X;
      const l0Y = -1 * cellsPerL0 + shiftL0Y;
      if (l0X < minL0X) minL0X = l0X;
      if (l0Y < minL0Y) minL0Y = l0Y;
      if (l0X + cellsPerL0 > maxL0X) maxL0X = l0X + cellsPerL0;
      if (l0Y + cellsPerL0 > maxL0Y) maxL0Y = l0Y + cellsPerL0;
    }
  }

  if (minL0X === Infinity) return null;

  // Clamp to [0, 32]. Don't snap outward to L1: the cell positions are
  // already on L0 boundaries (or half-L0 for shifted layers, which span
  // to the next L0 boundary anyway), and snapping past them would
  // expand the clip box past actual content — e.g. an 11-wide canvas
  // with content at L0 [0,11) would round up to width 12.
  return {
    minL0X: Math.max(0, minL0X),
    minL0Y: Math.max(0, minL0Y),
    maxL0X: Math.min(32, maxL0X),
    maxL0Y: Math.min(32, maxL0Y),
  };
}

/**
 * Compute the tight L0 bounding box of occupied cells across all layers
 * (respecting each layer's half-cell shift), snap the bounds to the finest
 * alignment the occupied layer mix can support, clamp to the existing
 * canvas, and shift every layer in-place so content lands inside the new
 * bounds. Returns the new canvas dimensions.
 *
 * "Finest achievable alignment" = half the coarsest occupied cell size
 * (≥ 1 L0). Half-cell granularity is reachable because each layer can
 * absorb a half-cell residue by toggling its own `shiftX`/`shiftY`, and
 * after the toggle the remaining shift is an integer number of cells at
 * that level. That lets the new canvas start mid-L2 (or mid-L3, etc.) with
 * zero data loss, at the cost of different layers ending up with different
 * shift values than they started with.
 *
 * No explicit padding is added — shrinkwrap produces the tightest canvas
 * that still contains every occupied cell.
 *
 * Layers are mutated in-place (cells, shiftX/Y, edge storage, and pixel
 * data all rebuilt).
 */
export function shrinkwrapLayers(
  layers: Layer[],
  widthL0: number,
  heightL0: number,
  originL0X: number = 0,
  originL0Y: number = 0,
): { widthL0: number; heightL0: number } {
  // 1. Find L0 bounding box of non-null cells across all layers, respecting
  // each layer's half-cell shift, and track the coarsest occupied level.
  let minL0X = Infinity, minL0Y = Infinity;
  let maxL0X = -Infinity, maxL0Y = -Infinity;
  let coarsestCellL0 = 1; // L0 cells per coarsest occupied cell

  for (const layer of layers) {
    const count = CELL_COUNTS[layer.level];
    const cellsPerL0 = 32 / count; // L0 cells covered by one cell at this level
    const shiftL0X = layer.shiftX * cellsPerL0;
    const shiftL0Y = layer.shiftY * cellsPerL0;

    let layerHasContent = false;
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        if (layer.cells[y]?.[x] != null) {
          layerHasContent = true;
          const l0X = x * cellsPerL0 + shiftL0X;
          const l0Y = y * cellsPerL0 + shiftL0Y;
          if (l0X < minL0X) minL0X = l0X;
          if (l0Y < minL0Y) minL0Y = l0Y;
          if (l0X + cellsPerL0 > maxL0X) maxL0X = l0X + cellsPerL0;
          if (l0Y + cellsPerL0 > maxL0Y) maxL0Y = l0Y + cellsPerL0;
        }
      }
    }
    if (layerHasContent) {
      coarsestCellL0 = Math.max(coarsestCellL0, cellsPerL0);
    }
  }

  // No occupied cells — return minimum 1×1
  if (minL0X === Infinity) {
    return { widthL0: 1, heightL0: 1 };
  }

  // 2. Snap tight bbox outward to the finest alignment supported across
  // all occupied layers. With per-layer shift flipping, that's half the
  // coarsest cell size (floored at 1 L0 so the canvas stays integer).
  const snapUnit = Math.max(1, coarsestCellL0 / 2);

  let snapMinX = Math.floor(minL0X / snapUnit) * snapUnit;
  let snapMinY = Math.floor(minL0Y / snapUnit) * snapUnit;
  let snapMaxX = Math.ceil(maxL0X / snapUnit) * snapUnit;
  let snapMaxY = Math.ceil(maxL0Y / snapUnit) * snapUnit;

  // Clamp to the existing canvas so shrinkwrap only ever shrinks.
  if (snapMinX < originL0X) snapMinX = originL0X;
  if (snapMinY < originL0Y) snapMinY = originL0Y;
  if (snapMaxX > originL0X + widthL0) snapMaxX = originL0X + widthL0;
  if (snapMaxY > originL0Y + heightL0) snapMaxY = originL0Y + heightL0;

  const newWidthL0 = Math.max(snapUnit, snapMaxX - snapMinX);
  const newHeightL0 = Math.max(snapUnit, snapMaxY - snapMinY);

  // Already same size and no shift needed — no-op
  if (newWidthL0 === widthL0 && newHeightL0 === heightL0 && snapMinX === 0 && snapMinY === 0) {
    return { widthL0, heightL0 };
  }

  // 3. Shift each layer by (-snapMinX, -snapMinY) in L0, absorbing any
  // half-cell residue into the layer's own shiftX / shiftY. Each axis is
  // resolved independently.
  //
  // Layer cell i at L0 = i·c + s·c (where c = cellsPerL0, s = shift).
  // Target L0 after a Δ shift: i·c + s·c + Δ. That must equal
  // j·c + s'·c for integer j and s' ∈ {0, 0.5}, so:
  //    j − i = s − s' + Δ/c
  //    v := s + Δ/c = j − i + s'
  // With Δ chosen as a multiple of c/2, v's fractional part is 0 or 0.5,
  // and we split it into:
  //    cellShift = floor(v)
  //    newShift  = v − cellShift  ∈ {0, 0.5}
  const deltaL0X = -snapMinX;
  const deltaL0Y = -snapMinY;

  for (const layer of layers) {
    const count = CELL_COUNTS[layer.level];
    const cellsPerL0 = 32 / count;

    const vX = layer.shiftX + deltaL0X / cellsPerL0;
    const cellShiftX = Math.floor(vX);
    const newShiftX: 0 | 0.5 = vX - cellShiftX === 0.5 ? 0.5 : 0;

    const vY = layer.shiftY + deltaL0Y / cellsPerL0;
    const cellShiftY = Math.floor(vY);
    const newShiftY: 0 | 0.5 = vY - cellShiftY === 0.5 ? 0.5 : 0;

    const changed =
      cellShiftX !== 0 || cellShiftY !== 0 ||
      newShiftX !== layer.shiftX || newShiftY !== layer.shiftY;
    if (!changed) continue;

    // Track pre- and post-shift content bboxes in cell coords so we can
    // mark a tight dirty rect instead of rewriting the whole 2048×2048
    // texture. A full-layer texSubImage2D makes the iOS GL driver orphan
    // the existing IOSurface and allocate a new one; with 3–5 layers that
    // costs ~50–80 MB of GPU memory that lingers until the driver releases
    // the old surfaces.
    let oldMinX = count, oldMinY = count, oldMaxX = -1, oldMaxY = -1;
    let newMinX = count, newMinY = count, newMaxX = -1, newMaxY = -1;

    const newCells: (CellState | null)[][] = [];
    for (let y = 0; y < count; y++) {
      newCells[y] = new Array(count).fill(null);
    }
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        if (layer.cells[y]?.[x] != null) {
          if (x < oldMinX) oldMinX = x;
          if (y < oldMinY) oldMinY = y;
          if (x > oldMaxX) oldMaxX = x;
          if (y > oldMaxY) oldMaxY = y;

          const nx = x + cellShiftX;
          const ny = y + cellShiftY;
          if (nx >= 0 && nx < count && ny >= 0 && ny < count) {
            newCells[ny][nx] = layer.cells[y][x];
            if (nx < newMinX) newMinX = nx;
            if (ny < newMinY) newMinY = ny;
            if (nx > newMaxX) newMaxX = nx;
            if (ny > newMaxY) newMaxY = ny;
          }
        }
      }
    }
    layer.cells = newCells;

    const oldShiftX = layer.shiftX;
    const oldShiftY = layer.shiftY;

    // Sync shift + edge storage to the new shift values. Edge rows/cols
    // exist only when the corresponding axis is half-shifted; resetting
    // them to empty on any change matches the bbox scan above (which
    // ignored edge content entirely, so there was nothing to preserve).
    layer.shiftX = newShiftX;
    layer.shiftY = newShiftY;
    layer.edgeColLeft = newShiftX === 0.5 ? new Array(count).fill(null) : null;
    layer.edgeRowTop = newShiftY === 0.5 ? new Array(count).fill(null) : null;
    layer.edgeCorner = null;

    layer.cellsGeneration++;
    rebuildPixelData(layer);
    markShrinkwrapDirty(
      layer,
      oldShiftX, oldShiftY, oldMinX, oldMinY, oldMaxX, oldMaxY,
      newShiftX, newShiftY, newMinX, newMinY, newMaxX, newMaxY,
    );
  }

  // Clear any cells that now fall outside the new canvas bounds.
  // Shrinkwrap currently always repositions content to origin (0, 0) —
  // the per-layer shift flip absorbs any sub-cell residue. B10 will
  // replace that with an origin-based approach.
  clearOutOfBoundsCells(layers, 0, 0, newWidthL0, newHeightL0);

  return { widthL0: newWidthL0, heightL0: newHeightL0 };
}

// ── Upscale ─────────────────────────────────────────────────────────
//
// Doubles the file's L0 dimensions and promotes every layer up one grid level
// (L0→L1, L1→L2, L2→L3, L3→L4). Layers already at L4 are removed since L5
// does not exist. Because doubling widthL0 exactly halves CELL_COUNTS at the
// promoted level, cell data at index (x,y) maps 1:1 onto the new layer — the
// rendered design is preserved.
//
// Caller is responsible for enforcing widthL0 ≤ 16 && heightL0 ≤ 16 (the L0
// cap) and that at least one non-L4 layer exists. Mutates `layers` in place
// (splicing out removed L4 entries). Returns the new dimensions plus the list
// of removed layer ids.
export function upscaleLayers(
  layers: Layer[],
  widthL0: number,
  heightL0: number,
): { widthL0: number; heightL0: number; removedLayerIds: string[] } {
  const newWidthL0 = widthL0 * 2;
  const newHeightL0 = heightL0 * 2;
  const removedLayerIds: string[] = [];

  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];

    if (layer.level === 4) {
      removedLayerIds.push(layer.id);
      layers.splice(i, 1);
      continue;
    }

    const oldLevel = layer.level;
    const newLevel = (oldLevel + 1) as GridLevel;
    const newCount = CELL_COUNTS[newLevel];
    const oldEditX = editableCells(widthL0, oldLevel);
    const oldEditY = editableCells(heightL0, oldLevel);

    const newCells: (CellState | null)[][] = new Array(newCount);
    for (let y = 0; y < newCount; y++) {
      const row = new Array(newCount);
      for (let x = 0; x < newCount; x++) {
        row[x] = (x < oldEditX && y < oldEditY) ? (layer.cells[y]?.[x] ?? null) : null;
      }
      newCells[y] = row;
    }

    let newEdgeRowTop: (CellState | null)[] | null = null;
    if (layer.shiftY === 0.5) {
      newEdgeRowTop = new Array(newCount);
      for (let x = 0; x < newCount; x++) {
        newEdgeRowTop[x] = (x < oldEditX && layer.edgeRowTop) ? (layer.edgeRowTop[x] ?? null) : null;
      }
    }

    let newEdgeColLeft: (CellState | null)[] | null = null;
    if (layer.shiftX === 0.5) {
      newEdgeColLeft = new Array(newCount);
      for (let y = 0; y < newCount; y++) {
        newEdgeColLeft[y] = (y < oldEditY && layer.edgeColLeft) ? (layer.edgeColLeft[y] ?? null) : null;
      }
    }

    const newEdgeCorner = (layer.shiftX === 0.5 && layer.shiftY === 0.5) ? layer.edgeCorner : null;

    layer.level = newLevel;
    layer.name = `${LEVEL_LABELS[newLevel]} (Upscaled)`;
    layer.cells = newCells;
    layer.edgeRowTop = newEdgeRowTop;
    layer.edgeColLeft = newEdgeColLeft;
    layer.edgeCorner = newEdgeCorner;
    layer.cellsGeneration++;
    layer.data.fill(0);
    rebuildPixelData(layer);
    markFullDirty(layer);
  }

  removedLayerIds.reverse();
  return { widthL0: newWidthL0, heightL0: newHeightL0, removedLayerIds };
}
