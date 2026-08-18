/**
 * Cell grid + pixel rasterization for figure-file layers.
 *
 * This module used to hold the full tile-editor cell-editing surface
 * (tool application, flood fills, selection move/rotate/mirror ops, undo
 * op appliers). That editor was removed; what remains is the minimal
 * raster path still needed by live code:
 *
 * - `createCellGrid` — allocate an empty cell grid for a GridLevel
 *   (used by persistence when loading figure files).
 * - `rebuildPixelData` — rasterize a layer's cells (including shifted-layer
 *   edge cells) into its RGBA pixel buffer, for baking/persistence.
 * - `renderCellToBuffer` / `sharedCellBuf` — render a single cell state
 *   (solid color or atlas sprite, with transform/tint) into a shared
 *   scratch buffer (used by thumbnail rendering).
 * - `RegionBoundsPx` — pixel-space bounds rectangle type (used by
 *   canvas-bounds).
 */
import {
  Layer,
  CellState,
  GridLevel,
  LAYER_PX,
  CELL_COUNTS,
  cellPx,
} from './types';
import { getScaledTile } from './loadTile';

// ── Shared Cell Buffer (avoids 256KB+ allocation per renderCellToBuffer call) ──
const MAX_CELL_PX = 1024; // L4
export const sharedCellBuf = new Uint8Array(MAX_CELL_PX * MAX_CELL_PX * 4);
// Uint32 view of sharedCellBuf — reused to avoid per-call typed array allocations
const sharedCellBufU32 = new Uint32Array(sharedCellBuf.buffer);

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

// ── Render Cell to Shared Buffer ─────────────────────────────────────

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

// ── Render Cell to Pixels ────────────────────────────────────────────

/**
 * Render a cell into the layer's pixel data at (cellX, cellY).
 * For null state, clears the cell region. Otherwise renders via
 * renderCellToBuffer + stampCellBuffer.
 */
function renderCellToPixels(
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

// ── Region Bounds ───────────────────────────────────────────────────

/** Axis-aligned bounds rectangle in layer pixel space. */
export interface RegionBoundsPx {
  pxMinX: number;
  pxMinY: number;
  pxMaxX: number;
  pxMaxY: number;
}
