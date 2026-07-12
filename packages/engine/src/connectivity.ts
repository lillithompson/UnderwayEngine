import {
  Layer,
  GridLevel,
  CELL_COUNTS,
  CellState,
  CellTransform,
  UndoOp,
  editableCells,
  MOD_360,
} from './types';
import { canvasCellWindow, type CanvasConfig } from './canvas-bounds';
import {
  computePaintMirrorTargets,
  computeMirrorSymmetry,
  type MirrorFlags as PaintMirrorFlags,
} from './paintMirror';
import { isCanonical, forEachCanonicalCell } from './mirrorSchedule';

/** Region bounds in L0 coordinate space, used for border-connection checks. */
export interface RegionBoundsL0 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
import { SPRITE_ENTRIES, SpriteEntry } from './loadTile';

// Inlined edge cell helpers to avoid circular dependency with cells.ts
function _getCell(layer: Layer, cellX: number, cellY: number): CellState | null {
  if (cellX === -1 && cellY === -1) return layer.edgeCorner;
  if (cellY === -1) return layer.edgeRowTop ? layer.edgeRowTop[cellX] : null;
  if (cellX === -1) return layer.edgeColLeft ? layer.edgeColLeft[cellY] : null;
  return layer.cells[cellY][cellX];
}
function _setCell(layer: Layer, cellX: number, cellY: number, state: CellState | null): void {
  if (cellX === -1 && cellY === -1) { layer.edgeCorner = state; return; }
  if (cellY === -1) { if (layer.edgeRowTop) layer.edgeRowTop[cellX] = state; return; }
  if (cellX === -1) { if (layer.edgeColLeft) layer.edgeColLeft[cellY] = state; return; }
  layer.cells[cellY][cellX] = state;
}
function cellStatesEqual(a: CellState | null, b: CellState | null): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (a.type !== b.type) return false;
  if (a.transform.rotation !== b.transform.rotation) return false;
  if (a.transform.mirrorH !== b.transform.mirrorH) return false;
  if (a.transform.mirrorV !== b.transform.mirrorV) return false;
  if (a.type === 'sprite' && b.type === 'sprite') {
    return a.spriteId === b.spriteId &&
      a.tintR === b.tintR && a.tintG === b.tintG && a.tintB === b.tintB;
  }
  if (a.type === 'color' && b.type === 'color') {
    return a.r === b.r && a.g === b.g && a.b === b.b;
  }
  return false;
}
import type { L0PointIndex } from './spatialIndex';
import { isOnCanvasBorderL0, isCellFullyInsideCanvas } from './canvas-bounds';

// ── Signature Parsing ────────────────────────────────────────────────

/**
 * Extract 8-bit connection array from sprite ID.
 * e.g. "angular/tile_00101010" → [false,false,true,false,true,false,true,false]
 *      "curved/curve_10101010" → [true,false,true,false,true,false,true,false]
 * Matches any sprite ID ending with `_XXXXXXXX` (8 binary digits).
 * Returns null for sprites without a conforming suffix.
 */

// Flat array indexed by sprite entry index — eliminates string-keyed Map lookups.
// Populated lazily on first access via ensureSigCacheBuilt().
let _sigCacheFlat: (boolean[] | null)[] | null = null;
// Map-based fallback for sprite IDs not in SPRITE_ENTRIES (e.g. ad-hoc test IDs)
const _sigCacheFallback = new Map<string, boolean[] | null>();

function _parseSig(spriteId: string): boolean[] | null {
  const match = spriteId.match(/_([01]{8})$/);
  return match ? Array.from(match[1], (ch) => ch === '1') : null;
}

function ensureSigCacheBuilt(): void {
  if (_sigCacheFlat) return;
  _sigCacheFlat = new Array(SPRITE_ENTRIES.length);
  for (let i = 0; i < SPRITE_ENTRIES.length; i++) {
    _sigCacheFlat[i] = _parseSig(SPRITE_ENTRIES[i].id);
  }
}

export function parseConnectionSignature(spriteId: string): boolean[] | null {
  ensureSigCacheBuilt();
  // Fast path: look up by index if the sprite has one
  const idx = _spriteIdToIndex.get(spriteId);
  if (idx !== undefined) return _sigCacheFlat![idx];
  // Slow fallback for unknown sprite IDs
  const cached = _sigCacheFallback.get(spriteId);
  if (cached !== undefined) return cached;
  const result = _parseSig(spriteId);
  _sigCacheFallback.set(spriteId, result);
  return result;
}

// ── Sprite ID → Index Map ────────────────────────────────────────────

// Built once; maps sprite ID string → index in SPRITE_ENTRIES for O(1) lookup.
const _spriteIdToIndex = new Map<string, number>();
for (let i = 0; i < SPRITE_ENTRIES.length; i++) {
  _spriteIdToIndex.set(SPRITE_ENTRIES[i].id, i);
}

// ── Pre-computed Bitmask Signature Table ─────────────────────────────
//
// For each (spriteEntry, transform) pair, pre-compute the rendered 8-bit
// connection signature packed into a single byte. This eliminates all
// parseConnectionSignature Map lookups and transformPointToRaw calls from
// the per-touch hot path in pickRandomCompatibleOption.
//
// Layout: _precomputedSigs[entryIndex * 16 + transformIndex] = packed byte
// where bit i = rendered connection value at point i.
// Value 0xFFFF means "unconstrained sprite" (no conforming signature).

const UNCONSTRAINED_SIG = 0xFFFF;
let _precomputedSigs: Uint16Array | null = null;

function ensurePrecomputedSigs(): Uint16Array {
  if (_precomputedSigs) return _precomputedSigs;
  ensureSigCacheBuilt();
  const n = SPRITE_ENTRIES.length;
  _precomputedSigs = new Uint16Array(n * 16);
  for (let ei = 0; ei < n; ei++) {
    const rawSig = _sigCacheFlat![ei];
    for (let ti = 0; ti < 16; ti++) {
      if (!rawSig) {
        _precomputedSigs[ei * 16 + ti] = UNCONSTRAINED_SIG;
      } else {
        const t = CANONICAL_TRANSFORMS[ti];
        let packed = 0;
        for (let p = 0; p < 8; p++) {
          if (rawSig[transformPointToRaw(p, t)]) {
            packed |= (1 << p);
          }
        }
        _precomputedSigs[ei * 16 + ti] = packed;
      }
    }
  }
  return _precomputedSigs;
}

// ── Mirror Signature Lookup Tables ──────────────────────────────────
//
// For each packed 8-bit signature, rearrange bits per MIRROR_H/V and
// DIAG1/DIAG2 maps. Used to check if a rendered signature is symmetric
// about the H, V, or diagonal axes. Four Uint8Array(256) tables —
// 1024 bytes total, built once on first access.

let _hMirrorSigLookup: Uint8Array | null = null;
let _vMirrorSigLookup: Uint8Array | null = null;
let _d1MirrorSigLookup: Uint8Array | null = null;
let _d2MirrorSigLookup: Uint8Array | null = null;

export function ensureMirrorSigLookups(): { h: Uint8Array; v: Uint8Array; d1: Uint8Array; d2: Uint8Array } {
  if (_hMirrorSigLookup && _vMirrorSigLookup && _d1MirrorSigLookup && _d2MirrorSigLookup) {
    return { h: _hMirrorSigLookup, v: _vMirrorSigLookup, d1: _d1MirrorSigLookup, d2: _d2MirrorSigLookup };
  }
  _hMirrorSigLookup = new Uint8Array(256);
  _vMirrorSigLookup = new Uint8Array(256);
  _d1MirrorSigLookup = new Uint8Array(256);
  _d2MirrorSigLookup = new Uint8Array(256);
  for (let sig = 0; sig < 256; sig++) {
    let hMirrored = 0, vMirrored = 0, d1Mirrored = 0, d2Mirrored = 0;
    for (let bit = 0; bit < 8; bit++) {
      if (sig & (1 << bit)) {
        hMirrored |= (1 << MIRROR_H_MAP[bit]);
        vMirrored |= (1 << MIRROR_V_MAP[bit]);
        d1Mirrored |= (1 << DIAG1_MAP[bit]);
        d2Mirrored |= (1 << DIAG2_MAP[bit]);
      }
    }
    _hMirrorSigLookup[sig] = hMirrored;
    _vMirrorSigLookup[sig] = vMirrored;
    _d1MirrorSigLookup[sig] = d1Mirrored;
    _d2MirrorSigLookup[sig] = d2Mirrored;
  }
  return { h: _hMirrorSigLookup, v: _vMirrorSigLookup, d1: _d1MirrorSigLookup, d2: _d2MirrorSigLookup };
}

/** Symmetry constraint for mirror-bisected cells. */
export interface MirrorSymmetry {
  h: boolean;
  v: boolean;
  d1: boolean;
  d2: boolean;
}

/**
 * Get the packed rendered signature for a sprite entry + transform.
 * Returns UNCONSTRAINED_SIG for sprites without connection signatures.
 */
export function renderedSigPacked(spriteId: string, transform: CellTransform): number {
  const sigs = ensurePrecomputedSigs();
  const idx = _spriteIdToIndex.get(spriteId);
  if (idx === undefined) return UNCONSTRAINED_SIG;
  const ti = CANONICAL_TRANSFORMS.indexOf(transform);
  if (ti < 0) {
    // Non-canonical transform — compute manually
    ensureSigCacheBuilt();
    const rawSig = _sigCacheFlat![idx];
    if (!rawSig) return UNCONSTRAINED_SIG;
    let packed = 0;
    for (let p = 0; p < 8; p++) {
      if (rawSig[transformPointToRaw(p, transform)]) packed |= (1 << p);
    }
    return packed;
  }
  return sigs[idx * 16 + ti];
}

/**
 * Convert a constraints array to {mask, value} bitmask pair for fast matching.
 * mask has bit i set if constraints[i] !== null.
 * value has bit i set if constraints[i] === true.
 */
function constraintsToBitmask(constraints: (boolean | null)[]): { mask: number; value: number } {
  let mask = 0, value = 0;
  for (let i = 0; i < 8; i++) {
    if (constraints[i] !== null) {
      mask |= (1 << i);
      if (constraints[i]) value |= (1 << i);
    }
  }
  return { mask, value };
}

// ── L0 Coordinate Mapping ────────────────────────────────────────────

// Shared output object for connectionPointL0 — avoids per-call allocation.
// Callers must consume x/y before the next call.
const _cpOut = { x: 0, y: 0 };

/**
 * Map a cell's connection point to L0-space coordinates.
 * Points 0-7: N, NE, E, SE, S, SW, W, NW
 * WARNING: returns a shared object — caller must consume x/y before next call.
 */
export function connectionPointL0(
  cellX: number,
  cellY: number,
  point: number,
  level: GridLevel,
  shiftX: 0 | 0.5,
  shiftY: 0 | 0.5,
): { x: number; y: number } {
  const S = CELL_COUNTS[0] / CELL_COUNTS[level];
  const baseX = (cellX + shiftX) * S;
  const baseY = (cellY + shiftY) * S;
  switch (point) {
    case 0: _cpOut.x = baseX + S / 2; _cpOut.y = baseY;         break; // N
    case 1: _cpOut.x = baseX + S;     _cpOut.y = baseY;         break; // NE
    case 2: _cpOut.x = baseX + S;     _cpOut.y = baseY + S / 2; break; // E
    case 3: _cpOut.x = baseX + S;     _cpOut.y = baseY + S;     break; // SE
    case 4: _cpOut.x = baseX + S / 2; _cpOut.y = baseY + S;     break; // S
    case 5: _cpOut.x = baseX;         _cpOut.y = baseY + S;     break; // SW
    case 6: _cpOut.x = baseX;         _cpOut.y = baseY + S / 2; break; // W
    case 7: _cpOut.x = baseX;         _cpOut.y = baseY;         break; // NW
    default: _cpOut.x = baseX;        _cpOut.y = baseY;         break;
  }
  return _cpOut;
}

// ── Transform-aware signature lookup ─────────────────────────────────

// Mirror maps for 8-point connection indices (N=0, NE=1, E=2, SE=3, S=4, SW=5, W=6, NW=7)
const MIRROR_H_MAP = [0, 7, 6, 5, 4, 3, 2, 1];
const MIRROR_V_MAP = [4, 3, 2, 1, 0, 7, 6, 5];
const DIAG1_MAP = [6, 5, 4, 3, 2, 1, 0, 7]; // \ diagonal reflection
const DIAG2_MAP = [2, 1, 0, 7, 6, 5, 4, 3]; // / diagonal reflection
const UNROTATE_OFFSET: Record<number, number> = { 0: 0, 90: 6, 180: 4, 270: 2 };

/**
 * Given a rendered connection point and a cell transform, return the raw
 * signature index. Inverts the render pipeline (mirrorV → mirrorH → rotate).
 */
function transformPointToRaw(point: number, t: CellTransform): number {
  let p = point;
  p = (p + UNROTATE_OFFSET[t.rotation]) & 7;
  if (t.mirrorH) p = MIRROR_H_MAP[p];
  if (t.mirrorV) p = MIRROR_V_MAP[p];
  return p;
}

// ── Opposite point index ─────────────────────────────────────────────

/** The opposite connection point: N↔S, NE↔SW, E↔W, SE↔NW */
const OPPOSITE_POINT: number[] = [4, 5, 6, 7, 0, 1, 2, 3];

// ── Find cells sharing an L0 point ───────────────────────────────────

export interface CellAtPoint {
  layer: Layer;
  cellX: number;
  cellY: number;
  pointIndex: number;
  value: boolean;
}

// Reusable results array for findCellsAtL0Point — caller must consume before next call.
// Follows the same shared-array pattern as _constraints.
const _findResults: CellAtPoint[] = [];
let _findResultsCount = 0;

/**
 * For a given L0 coordinate, find all cells across visible layers that have
 * a connection point at that position, and return their connection value.
 * Excludes the cell at (excludeCellX, excludeCellY) on excludeLayer.
 * WARNING: returns a shared array — caller must consume before next call.
 * Use _findResultsCount for the number of valid entries.
 */
function findCellsAtL0Point(
  l0x: number,
  l0y: number,
  layers: Layer[],
  excludeLayer: Layer,
  excludeCellX: number,
  excludeCellY: number,
): void {
  _findResultsCount = 0;
  for (const layer of layers) {
    if (!layer.visible) continue;
    const S = CELL_COUNTS[0] / CELL_COUNTS[layer.level];
    const count = CELL_COUNTS[layer.level];
    for (let point = 0; point < 8; point++) {
      // Reverse-map: find cellX, cellY such that connectionPointL0(cellX, cellY, point, ...) = (l0x, l0y)
      const shiftX = layer.shiftX;
      const shiftY = layer.shiftY;
      let cx: number, cy: number;
      switch (point) {
        case 0: cx = l0x / S - shiftX - 0.5; cy = l0y / S - shiftY;       break; // N
        case 1: cx = l0x / S - shiftX - 1;   cy = l0y / S - shiftY;       break; // NE
        case 2: cx = l0x / S - shiftX - 1;   cy = l0y / S - shiftY - 0.5; break; // E
        case 3: cx = l0x / S - shiftX - 1;   cy = l0y / S - shiftY - 1;   break; // SE
        case 4: cx = l0x / S - shiftX - 0.5; cy = l0y / S - shiftY - 1;   break; // S
        case 5: cx = l0x / S - shiftX;       cy = l0y / S - shiftY - 1;   break; // SW
        case 6: cx = l0x / S - shiftX;       cy = l0y / S - shiftY - 0.5; break; // W
        case 7: cx = l0x / S - shiftX;       cy = l0y / S - shiftY;       break; // NW
        default: continue;
      }

      // Must be integer cell coords
      if (cx !== Math.round(cx) || cy !== Math.round(cy)) continue;
      const icx = Math.round(cx);
      const icy = Math.round(cy);
      // Allow -1 for shifted layers (edge cells); reject anything else out of range
      const minIdx = -1;
      if (icx < minIdx || icx >= count || icy < minIdx || icy >= count) continue;
      if (icx === -1 && layer.shiftX !== 0.5) continue;
      if (icy === -1 && layer.shiftY !== 0.5) continue;

      // Exclude the source cell
      if (layer === excludeLayer && icx === excludeCellX && icy === excludeCellY) continue;

      // Read cell, including edge storage for -1 indices
      let cell: CellState | null | undefined;
      if (icx === -1 && icy === -1) {
        cell = layer.edgeCorner;
      } else if (icy === -1) {
        cell = layer.edgeRowTop ? layer.edgeRowTop[icx] : null;
      } else if (icx === -1) {
        cell = layer.edgeColLeft ? layer.edgeColLeft[icy] : null;
      } else {
        cell = layer.cells[icy]?.[icx];
      }
      if (cell === null || cell === undefined) continue;
      if (cell.type !== 'sprite') continue;

      const sig = parseConnectionSignature(cell.spriteId);
      if (!sig) continue; // unconstrained sprite — skip

      const rawIdx = transformPointToRaw(point, cell.transform);
      // Reuse or grow the shared results array
      if (_findResultsCount >= _findResults.length) {
        _findResults.push({ layer, cellX: icx, cellY: icy, pointIndex: point, value: sig[rawIdx] });
      } else {
        const entry = _findResults[_findResultsCount];
        entry.layer = layer;
        entry.cellX = icx;
        entry.cellY = icy;
        entry.pointIndex = point;
        entry.value = sig[rawIdx];
      }
      _findResultsCount++;
    }
  }
}

// ── Cross-layer edge blocking ────────────────────────────────────────

/**
 * Check if an L0 point falls on a coarser cell's edge at a position that has
 * no connection point. This means the coarser cell's edge is a "solid wall"
 * at that location, and the constraint must be forced to false.
 */
function isBlockedByCoarserCell(
  l0x: number,
  l0y: number,
  layers: Layer[],
  targetLayer: Layer,
  targetCellX: number,
  targetCellY: number,
): boolean {
  const targetS = CELL_COUNTS[0] / CELL_COUNTS[targetLayer.level];

  for (const layer of layers) {
    if (!layer.visible) continue;
    const S = CELL_COUNTS[0] / CELL_COUNTS[layer.level];
    if (S <= targetS) continue; // only check coarser layers (larger cells)

    const count = CELL_COUNTS[layer.level];
    const shX = layer.shiftX;
    const shY = layer.shiftY;

    // Convert to cell-space coordinates for this layer
    const nx = l0x / S - shX;
    const ny = l0y / S - shY;

    // Point must be on a cell boundary (integer nx and/or ny)
    const onVertEdge = Math.abs(nx - Math.round(nx)) < 1e-9;
    const onHorizEdge = Math.abs(ny - Math.round(ny)) < 1e-9;
    if (!onVertEdge && !onHorizEdge) continue;

    // Find candidate cells that have this point on their boundary
    // Use inline variables instead of allocating arrays per call
    let cx0: number, cx1: number, cxLen: number;
    if (onVertEdge) {
      cx0 = Math.round(nx) - 1; cx1 = Math.round(nx); cxLen = 2;
    } else {
      cx0 = Math.floor(nx); cx1 = 0; cxLen = 1;
    }
    let cy0: number, cy1: number, cyLen: number;
    if (onHorizEdge) {
      cy0 = Math.round(ny) - 1; cy1 = Math.round(ny); cyLen = 2;
    } else {
      cy0 = Math.floor(ny); cy1 = 0; cyLen = 1;
    }

    for (let ci = 0; ci < cxLen; ci++) {
      const cx = ci === 0 ? cx0 : cx1;
      for (let cj = 0; cj < cyLen; cj++) {
        const cy = cj === 0 ? cy0 : cy1;
        if (cx < 0 || cx >= count || cy < 0 || cy >= count) continue;

        // Verify point is actually on this cell's boundary (not interior)
        const onBoundary =
          Math.abs(nx - cx) < 1e-9 || Math.abs(nx - (cx + 1)) < 1e-9 ||
          Math.abs(ny - cy) < 1e-9 || Math.abs(ny - (cy + 1)) < 1e-9;
        if (!onBoundary) continue;

        if (layer === targetLayer && cx === targetCellX && cy === targetCellY) continue;

        const cell = layer.cells[cy]?.[cx];
        if (!cell || cell.type !== 'sprite') continue;
        if (!parseConnectionSignature(cell.spriteId)) continue;

        // Check if any of the cell's 8 connection points coincides with (l0x, l0y)
        let atConnectionPoint = false;
        for (let p = 0; p < 8; p++) {
          const cp = connectionPointL0(cx, cy, p, layer.level, shX, shY);
          if (Math.abs(cp.x - l0x) < 1e-9 && Math.abs(cp.y - l0y) < 1e-9) {
            atConnectionPoint = true;
            break;
          }
        }

        if (!atConnectionPoint) return true;
      }
    }
  }
  return false;
}

// ── Gather Constraints ───────────────────────────────────────────────

// Reusable 8-element constraints array — caller must consume before next call
const _constraints: (boolean | null)[] = [null, null, null, null, null, null, null, null];
// Reusable 8-element array for cardinal-only fallback in pickRandomCompatibleSprite
const _cardinalOnly: (boolean | null)[] = [null, null, null, null, null, null, null, null];
const _noConstraints: (boolean | null)[] = [null, null, null, null, null, null, null, null];

/**
 * Returns 8-element array for a cell's connection points:
 * true = must connect, false = must not connect, null = unconstrained
 * WARNING: returns a shared array — caller must consume before next call.
 */
export function gatherConstraints(
  cellX: number,
  cellY: number,
  layer: Layer,
  allLayers: Layer[],
  allowBorderConnections: boolean,
  regionBoundsL0?: RegionBoundsL0,
  canvasWidthL0: number = CELL_COUNTS[0],
  canvasHeightL0: number = CELL_COUNTS[0],
  treatEmptyAsFalse: boolean = false,
  index?: L0PointIndex,
  canvasOriginL0X: number = 0,
  canvasOriginL0Y: number = 0,
): (boolean | null)[] {
  // Reset shared array
  _constraints[0] = _constraints[1] = _constraints[2] = _constraints[3] =
  _constraints[4] = _constraints[5] = _constraints[6] = _constraints[7] = null;

  const level = layer.level;

  for (let point = 0; point < 8; point++) {
    connectionPointL0(cellX, cellY, point, level, layer.shiftX, layer.shiftY);
    // Copy from shared output before it's overwritten by nested calls
    const l0x = _cpOut.x;
    const l0y = _cpOut.y;

    // Check if this point is at the canvas-window border in layer L0 space.
    const atBorder = isOnCanvasBorderL0(l0x, l0y, {
      widthL0: canvasWidthL0, heightL0: canvasHeightL0,
      originL0X: canvasOriginL0X, originL0Y: canvasOriginL0Y,
    });

    // Check if this point is at the region border
    const atRegionBorder = regionBoundsL0 &&
      (l0x <= regionBoundsL0.minX || l0x >= regionBoundsL0.maxX ||
       l0y <= regionBoundsL0.minY || l0y >= regionBoundsL0.maxY);

    // When border connections are disallowed, force all border points to false
    // before any neighbor logic — this overrides the corner vertex model.
    if (!allowBorderConnections && (atBorder || atRegionBorder)) {
      _constraints[point] = false;
      continue;
    }

    const isCardinal = (point & 1) === 0; // 0,2,4,6 are cardinal

    // Find all other cells that share this L0 point
    let results: CellAtPoint[];
    let resultsCount: number;
    if (index) {
      index.queryPoint(l0x, l0y, layer, cellX, cellY);
      results = index.queryResults;
      resultsCount = index.queryResultsCount;
    } else {
      findCellsAtL0Point(l0x, l0y, allLayers, layer, cellX, cellY);
      results = _findResults;
      resultsCount = _findResultsCount;
    }

    if (isCardinal) {
      // Cardinal points: check the single neighbor's matching (opposite) point
      const opp = OPPOSITE_POINT[point];
      let hasTrue = false, hasFalse = false, hasMatch = false;
      for (let ni = 0; ni < resultsCount; ni++) {
        const n = results[ni];
        if (n.pointIndex !== opp) continue;
        hasMatch = true;
        if (n.value) hasTrue = true; else hasFalse = true;
      }
      if (hasMatch) {
        // Mixed or all true → true; all false → false
        _constraints[point] = hasFalse && !hasTrue ? false : true;
      } else {
        _constraints[point] = treatEmptyAsFalse ? false : null;
      }
    } else {
      // Corner points: apply corner vertex model
      let trueCount = 0;
      const occupiedCount = resultsCount;
      for (let ni = 0; ni < resultsCount; ni++) { if (results[ni].value) trueCount++; }

      if (occupiedCount === 0) {
        _constraints[point] = treatEmptyAsFalse ? false : null;
      } else if (trueCount >= 2) {
        _constraints[point] = null;
      } else if (trueCount === 1) {
        _constraints[point] = true;
      } else {
        _constraints[point] = false;
      }
    }

    // Cross-layer blocking: if this point falls on a coarser cell's edge
    // between its connection points, the coarser cell's edge is a solid wall.
    if (_constraints[point] === null &&
        isBlockedByCoarserCell(l0x, l0y, allLayers, layer, cellX, cellY)) {
      _constraints[point] = false;
    }
  }

  return _constraints;
}

// ── Cached Excluded-Family Filtering ─────────────────────────────────

let cachedFilteredEntries: SpriteEntry[] | null = null;
let cachedExcludedFamilies: Set<string> | null = null;

function getFilteredEntries(excludedFamilies?: Set<string>): SpriteEntry[] {
  if (!excludedFamilies || excludedFamilies.size === 0) return SPRITE_ENTRIES;
  // Reference equality — the Set object is stable across a stroke
  if (cachedExcludedFamilies === excludedFamilies && cachedFilteredEntries) {
    return cachedFilteredEntries;
  }
  cachedFilteredEntries = SPRITE_ENTRIES.filter(e => !excludedFamilies.has(e.family));
  cachedExcludedFamilies = excludedFamilies;
  return cachedFilteredEntries;
}

// ── Filter Compatible Sprites ────────────────────────────────────────

/**
 * Filter entries whose connection signature satisfies all non-null constraints.
 * Sprites without conforming names (parseConnectionSignature returns null) are always included.
 */
// Reusable results array for filterCompatibleSprites — avoids per-call array allocation.
const _filteredSprites: SpriteEntry[] = [];

export function filterCompatibleSprites(
  entries: SpriteEntry[],
  constraints: (boolean | null)[],
): SpriteEntry[] {
  _filteredSprites.length = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const sig = parseConnectionSignature(entry.id);
    if (!sig) { _filteredSprites.push(entry); continue; }
    let ok = true;
    for (let j = 0; j < 8; j++) {
      if (constraints[j] !== null && sig[j] !== constraints[j]) { ok = false; break; }
    }
    if (ok) _filteredSprites.push(entry);
  }
  return _filteredSprites;
}

// ── Transform-Aware Compatible Sprite Filtering ─────────────────────

interface CompatibleOption {
  entry: SpriteEntry;
  transform: CellTransform;
}

const ALL_ROTATIONS: readonly (0 | 90 | 180 | 270)[] = [0, 90, 180, 270];

// Pre-allocated canonical transform objects (4 rotations × 2 mirrorH × 2 mirrorV = 16).
// Avoids per-iteration object allocation and Hermes string-key enumeration from spreads.
const CANONICAL_TRANSFORMS: readonly CellTransform[] = (() => {
  const transforms: CellTransform[] = [];
  for (const rotation of ALL_ROTATIONS) {
    for (const mirrorH of [false, true] as const) {
      for (const mirrorV of [false, true] as const) {
        transforms.push({ rotation, mirrorH, mirrorV });
      }
    }
  }
  return transforms;
})();

/**
 * Filter entries trying all 16 transforms (4 rotations × 2 mirrorH × 2 mirrorV).
 * Returns all (entry, transform) pairs whose rendered signature satisfies constraints.
 */
function filterCompatibleSpritesWithTransforms(
  entries: SpriteEntry[],
  constraints: (boolean | null)[],
): CompatibleOption[] {
  const results: CompatibleOption[] = [];
  for (const entry of entries) {
    const rawSig = parseConnectionSignature(entry.id);
    if (!rawSig) {
      results.push({ entry, transform: CANONICAL_TRANSFORMS[0] });
      continue;
    }
    for (let ti = 0; ti < 16; ti++) {
      const t = CANONICAL_TRANSFORMS[ti];
      let matches = true;
      for (let p = 0; p < 8; p++) {
        if (constraints[p] === null) continue;
        if (rawSig[transformPointToRaw(p, t)] !== constraints[p]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        results.push({ entry, transform: t });
      }
    }
  }
  return results;
}

/**
 * Two-pass random selection using pre-computed bitmask signatures.
 * Pass 1: count matches via bitmask AND/CMP. Pass 2: find nth match.
 * Eliminates all parseConnectionSignature and transformPointToRaw calls.
 */
function pickRandomCompatibleOption(
  entries: SpriteEntry[],
  constraints: (boolean | null)[],
  symmetry?: MirrorSymmetry,
): CompatibleOption | null {
  const sigs = ensurePrecomputedSigs();
  const { mask, value } = constraintsToBitmask(constraints);

  // Pre-fetch mirror lookup tables if symmetry is needed
  let hLookup: Uint8Array | undefined;
  let vLookup: Uint8Array | undefined;
  let d1Lookup: Uint8Array | undefined;
  let d2Lookup: Uint8Array | undefined;
  if (symmetry) {
    const lookups = ensureMirrorSigLookups();
    if (symmetry.h) hLookup = lookups.h;
    if (symmetry.v) vLookup = lookups.v;
    if (symmetry.d1) d1Lookup = lookups.d1;
    if (symmetry.d2) d2Lookup = lookups.d2;
  }

  // Pass 1: count
  let count = 0;
  for (let ei = 0; ei < entries.length; ei++) {
    const idx = _spriteIdToIndex.get(entries[ei].id);
    if (idx === undefined) {
      // Unknown entry — treat as unconstrained
      count++;
      continue;
    }
    const base = idx * 16;
    for (let ti = 0; ti < 16; ti++) {
      const sig = sigs[base + ti];
      if (sig === UNCONSTRAINED_SIG || (sig & mask) === value) {
        if (sig !== UNCONSTRAINED_SIG && symmetry) {
          if (hLookup && sig !== hLookup[sig]) continue;
          if (vLookup && sig !== vLookup[sig]) continue;
          if (d1Lookup && sig !== d1Lookup[sig]) continue;
          if (d2Lookup && sig !== d2Lookup[sig]) continue;
        }
        count++;
      }
    }
  }
  if (count === 0) return null;

  // Pass 2: find the nth match
  let target = Math.floor(Math.random() * count);
  for (let ei = 0; ei < entries.length; ei++) {
    const entry = entries[ei];
    const idx = _spriteIdToIndex.get(entry.id);
    if (idx === undefined) {
      if (target === 0) return { entry, transform: CANONICAL_TRANSFORMS[0] };
      target--;
      continue;
    }
    const base = idx * 16;
    for (let ti = 0; ti < 16; ti++) {
      const sig = sigs[base + ti];
      if (sig === UNCONSTRAINED_SIG || (sig & mask) === value) {
        if (sig !== UNCONSTRAINED_SIG && symmetry) {
          if (hLookup && sig !== hLookup[sig]) continue;
          if (vLookup && sig !== vLookup[sig]) continue;
          if (d1Lookup && sig !== d1Lookup[sig]) continue;
          if (d2Lookup && sig !== d2Lookup[sig]) continue;
        }
        if (target === 0) return { entry, transform: CANONICAL_TRANSFORMS[ti] };
        target--;
      }
    }
  }
  return null;
}

// ── Pick Random Compatible Sprite ────────────────────────────────────

/**
 * Top-level function: gather constraints → filter sprites → pick random from compatible set.
 * Progressive fallback: all constraints → cardinal-only → any sprite.
 */
export function pickRandomCompatibleSprite(
  cellX: number,
  cellY: number,
  layer: Layer,
  allLayers: Layer[],
  allowBorderConnections: boolean,
  excludedFamilies?: Set<string>,
  regionBoundsL0?: RegionBoundsL0,
  canvasWidthL0: number = CELL_COUNTS[0],
  canvasHeightL0: number = CELL_COUNTS[0],
  index?: L0PointIndex,
  symmetry?: MirrorSymmetry,
  canvasOriginL0X: number = 0,
  canvasOriginL0Y: number = 0,
): CellState {
  const entries = getFilteredEntries(excludedFamilies);

  const constraints = gatherConstraints(cellX, cellY, layer, allLayers, allowBorderConnections, regionBoundsL0, canvasWidthL0, canvasHeightL0, false, index, canvasOriginL0X, canvasOriginL0Y);
  let choice = pickRandomCompatibleOption(entries, constraints, symmetry);

  // Fallback: relax corners, keep cardinals (should rarely be needed now)
  if (!choice) {
    for (let i = 0; i < 8; i++) _cardinalOnly[i] = (i & 1) === 0 ? constraints[i] : null;
    choice = pickRandomCompatibleOption(entries, _cardinalOnly, symmetry);
  }

  // Fallback: drop all constraints, pick any random sprite
  if (!choice) {
    choice = pickRandomCompatibleOption(entries, _noConstraints);
  }

  if (!choice) {
    // No sprite entries loaded at all — fall back to null (erase)
    return null;
  }

  // Use canonical transform reference directly — cell states are replaced, never mutated.
  return {
    type: 'sprite',
    spriteId: choice.entry.id,
    transform: choice.transform,
  };
}

// ── Rendered Signature ──────────────────────────────────────────────

/**
 * Returns the 8-bit connection signature as rendered (accounting for transform).
 * Returns null for non-sprite cells or sprites without a conforming suffix.
 */
export function getRenderedSignature(cell: CellState): boolean[] | null {
  if (!cell || cell.type !== 'sprite') return null;
  const rawSig = parseConnectionSignature(cell.spriteId);
  if (!rawSig) return null;
  const rendered: boolean[] = new Array(8);
  for (let p = 0; p < 8; p++) {
    rendered[p] = rawSig[transformPointToRaw(p, cell.transform)];
  }
  return rendered;
}

// ── Find Minimal Replacement ────────────────────────────────────────

/**
 * Find the best replacement sprite for a cell that satisfies all constraints
 * while maximizing similarity to the original cell.
 * Scoring: +2000 same spriteId AND same transform, +1000 same spriteId,
 * +500 same transform, +100 same family, +1 per matching unconstrained point.
 *
 * `symmetry` filters candidates to those whose rendered signature is self-symmetric
 * on the active axes — required when the cell sits on a mirror axis.
 * `precomputedConstraints` lets callers (e.g. reconcile) supply an externally-merged
 * constraint set; if omitted, constraints are gathered for the cell directly.
 */
export function findMinimalReplacement(
  cellX: number,
  cellY: number,
  layer: Layer,
  allLayers: Layer[],
  allowBorderConnections: boolean,
  originalCell: CellState,
  excludedFamilies?: Set<string>,
  canvasWidthL0: number = CELL_COUNTS[0],
  canvasHeightL0: number = CELL_COUNTS[0],
  symmetry?: MirrorSymmetry,
  precomputedConstraints?: (boolean | null)[],
  canvasOriginL0X: number = 0,
  canvasOriginL0Y: number = 0,
): CellState | null {
  const constraints = precomputedConstraints
    ?? gatherConstraints(cellX, cellY, layer, allLayers, allowBorderConnections, undefined, canvasWidthL0, canvasHeightL0, true, undefined, canvasOriginL0X, canvasOriginL0Y);

  const originalSig = getRenderedSignature(originalCell);
  const originalFamily = originalCell && originalCell.type === 'sprite'
    ? originalCell.spriteId.split('/')[0]
    : null;
  const originalSpriteId = originalCell && originalCell.type === 'sprite'
    ? originalCell.spriteId
    : null;
  const originalTransform = originalCell && originalCell.type === 'sprite'
    ? originalCell.transform
    : null;

  const entries = getFilteredEntries(excludedFamilies);

  const compatible = filterCompatibleSpritesWithTransforms(entries, constraints);
  if (compatible.length === 0) return null;

  let hLookup: Uint8Array | undefined;
  let vLookup: Uint8Array | undefined;
  let d1Lookup: Uint8Array | undefined;
  let d2Lookup: Uint8Array | undefined;
  if (symmetry) {
    const lookups = ensureMirrorSigLookups();
    if (symmetry.h) hLookup = lookups.h;
    if (symmetry.v) vLookup = lookups.v;
    if (symmetry.d1) d1Lookup = lookups.d1;
    if (symmetry.d2) d2Lookup = lookups.d2;
  }
  const hasSymmetry = !!(hLookup || vLookup || d1Lookup || d2Lookup);

  let bestScore = -1;
  let bestOption: CompatibleOption | null = null;

  for (const option of compatible) {
    if (hasSymmetry) {
      const sig = renderedSigPacked(option.entry.id, option.transform);
      if (sig !== UNCONSTRAINED_SIG) {
        if (hLookup && sig !== hLookup[sig]) continue;
        if (vLookup && sig !== vLookup[sig]) continue;
        if (d1Lookup && sig !== d1Lookup[sig]) continue;
        if (d2Lookup && sig !== d2Lookup[sig]) continue;
      }
    }

    let score = 0;

    const sameSprite = option.entry.id === originalSpriteId;
    const sameTransform = originalTransform != null &&
      option.transform.rotation === originalTransform.rotation &&
      option.transform.mirrorH === originalTransform.mirrorH &&
      option.transform.mirrorV === originalTransform.mirrorV;

    if (sameSprite && sameTransform) score += 2000;
    else if (sameSprite) score += 1000;
    if (sameTransform) score += 500;
    if (originalFamily && option.entry.family === originalFamily) score += 100;

    if (originalSig) {
      const rawSig = parseConnectionSignature(option.entry.id);
      if (rawSig) {
        for (let i = 0; i < 8; i++) {
          if (constraints[i] === null) {
            const renderedVal = rawSig[transformPointToRaw(i, option.transform)];
            if (renderedVal === originalSig[i]) {
              score += 1;
            }
          }
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestOption = option;
    }
  }

  if (!bestOption) return null;

  return {
    type: 'sprite',
    spriteId: bestOption.entry.id,
    transform: bestOption.transform,
  };
}

// ── Mirror Helpers ──────────────────────────────────────────────────

/**
 * Compute mirrored cell state from a primary cell state.
 * Matches the transform logic used in APPLY_TOOL.
 */
export function mirrorCellState(
  state: CellState,
  mH: boolean,
  mV: boolean,
  rotateOffset: 0 | 90 | 180 | 270,
): CellState {
  if (!state || state.type !== 'sprite') return state;
  if (rotateOffset === 0 && !mH && !mV) return state;

  const R = state.transform.rotation;
  const H = state.transform.mirrorH;
  const V = state.transform.mirrorV;

  let newR: 0 | 90 | 180 | 270;
  let newH: boolean;
  let newV: boolean;

  if (rotateOffset !== 0 && (mH || mV)) {
    // Combined rotation + mirror: diagonal reflection.
    // The pixel LUT applies rotation then mirrors, so composing a diagonal
    // canvas-level reflection with an existing tile transform requires a
    // dedicated formula derived from the LUT pipeline algebra.
    // \ diagonal (rot=270, mH=true): pixel source = (dy, dx) = transpose
    // / diagonal (rot=90, mH=true): pixel source = (max-dy, max-dx) = anti-transpose
    const effectiveOffset = V
      ? (360 - rotateOffset) as 0 | 90 | 180 | 270
      : rotateOffset;
    const rawR = effectiveOffset - R;
    newR = (rawR < 0 ? rawR + 360 : rawR) as 0 | 90 | 180 | 270;
    newH = V ? H : !H;
    newV = false;
  } else if (rotateOffset !== 0) {
    // Pure rotation
    newR = MOD_360[R + rotateOffset];
    newH = H;
    newV = V;
  } else {
    // Pure mirror (canvas-level H/V flip)
    // Compose canvas-level mirror with existing transform via XOR.
    newH = H !== mH;
    newV = V !== mV;
    newR = (mH !== mV) ? MOD_360[360 - R] : R;
  }

  return { ...state, transform: {
    ...state.transform,
    rotation: newR,
    mirrorH: newH,
    mirrorV: newV,
  }};
}


// ── Reconcile Canvas ────────────────────────────────────────────────

/**
 * Symmetric reconcile: only canonical cells (one per mirror-orbit) are
 * reconciled directly. After each canonical fix the orbit partners are
 * cloned from the canonical via `computePaintMirrorTargets` +
 * `mirrorCellState`, so the layer is symmetric by construction under
 * every active mirror mode. Non-canonical cells are never reconciled
 * themselves — their state is always derived from their canonical.
 *
 * Reuses the existing per-cell repair primitives (`gatherConstraints`,
 * `findMinimalReplacement`) on a smaller set of cells. The orbit math
 * goes through `paintMirror`, the single source of truth shared with
 * paint, so reconcile partners always land where paint would stamp.
 *
 * No partner-merge / fallback ladder: a canonical cell that can't be
 * fixed under its self-symmetry is left as-is. Reconcile must not
 * silently produce asymmetric output when a mirror flag is on.
 */
function reconcileCanvasSymmetric(
  layers: Layer[],
  allLayers: Layer[],
  allowBorderConnections: boolean,
  placementOrder: Map<number, number>,
  excludedFamilies: Set<string> | undefined,
  widthL0: number,
  heightL0: number,
  originL0X: number,
  originL0Y: number,
  borderOnly: boolean,
  flags: PaintMirrorFlags,
  allOps: UndoOp[],
): void {
  const canvasCfg: CanvasConfig = { widthL0, heightL0, originL0X, originL0Y };
  const layerIdx = new Map<string, number>();
  layers.forEach((l, i) => layerIdx.set(l.id, i));
  const numKey = (li: number, cx: number, cy: number) => li * 4096 + cy * 64 + cx;
  const MAX_PASSES = 10;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let fixCount = 0;

    for (const layer of layers) {
      if (!layer.visible || layer.locked) continue;
      const w = canvasCellWindow(layer, canvasCfg);
      const count = CELL_COUNTS[layer.level];
      const yMax = Math.min(w.endCellY, count);
      const xMax = Math.min(w.endCellX, count);
      const maxCX = editableCells(widthL0, layer.level);
      const maxCY = editableCells(heightL0, layer.level);
      const li = layerIdx.get(layer.id) ?? 0;

      // Collect mismatched canonical cells, sorted by ordinal so older
      // placements get fixed first (same ordering as the legacy path).
      const needsFix: Array<{ x: number; y: number; ordinal: number }> = [];
      for (let y = w.edgeMinCellY; y < yMax; y++) {
        for (let x = w.edgeMinCellX; x < xMax; x++) {
          if (!isCanonical(x, y, layer, canvasCfg, flags)) continue;
          const cell = _getCell(layer, x, y);
          if (!cell || cell.type !== 'sprite') continue;

          if (borderOnly) {
            const isBorder =
              x <= 0 || y <= 0 || x >= maxCX - 1 || y >= maxCY - 1 ||
              !_getCell(layer, x, y - 1) || !_getCell(layer, x, y + 1) ||
              !_getCell(layer, x - 1, y) || !_getCell(layer, x + 1, y);
            if (!isBorder) continue;
          }

          const sig = getRenderedSignature(cell);
          if (!sig) continue;
          const cs = gatherConstraints(x, y, layer, allLayers, allowBorderConnections, undefined, widthL0, heightL0, true, undefined, originL0X, originL0Y);
          let mismatch = false;
          for (let p = 0; p < 8; p++) {
            if (cs[p] !== null && cs[p] !== sig[p]) { mismatch = true; break; }
          }
          if (mismatch) {
            const ordinal = placementOrder.get(numKey(li, x, y)) ?? -1;
            needsFix.push({ x, y, ordinal });
          }
        }
      }
      needsFix.sort((a, b) => a.ordinal - b.ordinal);

      const handledThisPass = new Set<number>();
      for (const { x, y } of needsFix) {
        const cellKey = numKey(li, x, y);
        if (handledThisPass.has(cellKey)) continue;

        const cell = _getCell(layer, x, y);
        if (!cell || cell.type !== 'sprite') continue;
        const cs = gatherConstraints(x, y, layer, allLayers, allowBorderConnections, undefined, widthL0, heightL0, true, undefined, originL0X, originL0Y);
        const sig2 = getRenderedSignature(cell);
        if (!sig2) continue;
        let stillMis = false;
        for (let p = 0; p < 8; p++) {
          if (cs[p] !== null && cs[p] !== sig2[p]) { stillMis = true; break; }
        }
        if (!stillMis) continue;

        const symmetry = computeMirrorSymmetry(x, y, layer, canvasCfg, flags);
        const merged: (boolean | null)[] = [
          cs[0], cs[1], cs[2], cs[3], cs[4], cs[5], cs[6], cs[7],
        ];
        const replacement = findMinimalReplacement(
          x, y, layer, allLayers, allowBorderConnections, cell, excludedFamilies,
          widthL0, heightL0, symmetry, merged, originL0X, originL0Y,
        );
        if (!replacement) continue;
        if (replacement.type === 'sprite' && cell.type === 'sprite' && cell.tintR !== undefined) {
          replacement.tintR = cell.tintR;
          replacement.tintG = cell.tintG;
          replacement.tintB = cell.tintB;
        }
        handledThisPass.add(cellKey);

        // Stage primary write so its sibling-partner relationship to other
        // canonical cells reflects the new state when partners are cloned.
        const primaryChanged = !cellStatesEqual(cell, replacement);
        if (primaryChanged) {
          _setCell(layer, x, y, replacement);
          layer.cellsGeneration++;
          allOps.push({ op: 'cell', layerId: layer.id, cellX: x, cellY: y, oldState: cell, newState: replacement });
          fixCount++;
        }

        // Clone canonical → orbit partners. Partner-equality guard
        // prevents redundant writes on already-symmetric canvases.
        const partners = computePaintMirrorTargets(x, y, layer, canvasCfg, flags);
        for (let i = 0; i < partners.length; i++) {
          const t = partners[i];
          const mKey = numKey(li, t.x, t.y);
          if (handledThisPass.has(mKey)) continue;
          const newP = mirrorCellState(replacement, t.mH, t.mV, t.rot);
          const oldP = _getCell(layer, t.x, t.y);
          if (cellStatesEqual(oldP, newP)) continue;
          handledThisPass.add(mKey);
          _setCell(layer, t.x, t.y, newP);
          layer.cellsGeneration++;
          allOps.push({ op: 'cell', layerId: layer.id, cellX: t.x, cellY: t.y, oldState: oldP, newState: newP });
          fixCount++;
        }
      }
    }

    if (fixCount === 0) break;
  }

  // Final sweep: ensure every canonical cell's orbit partners equal the
  // clone of the canonical, regardless of whether the canonical was
  // mismatched. This catches the case where the canonical is already
  // well-connected (no fix needed) but its partners were never
  // populated — strict symmetry requires us to fill them in.
  for (const layer of layers) {
    if (!layer.visible || layer.locked) continue;
    forEachCanonicalCell(layer, canvasCfg, flags, (x, y) => {
      const cell = _getCell(layer, x, y);
      if (!cell) return;
      const partners = computePaintMirrorTargets(x, y, layer, canvasCfg, flags);
      for (let i = 0; i < partners.length; i++) {
        const t = partners[i];
        const newP = mirrorCellState(cell, t.mH, t.mV, t.rot);
        const oldP = _getCell(layer, t.x, t.y);
        if (cellStatesEqual(oldP, newP)) continue;
        _setCell(layer, t.x, t.y, newP);
        layer.cellsGeneration++;
        allOps.push({ op: 'cell', layerId: layer.id, cellX: t.x, cellY: t.y, oldState: oldP, newState: newP });
      }
    });
  }
}

/**
 * Iteratively fix all mismatched tiles on the canvas.
 * Cells with higher placement ordinals "win" — their neighbors adapt.
 * Locked layers are never modified. Mutates layer.cells in place.
 * When mirror/rotate is active, fixes are symmetrically applied.
 * Returns UndoOps for all changes (caller handles pixel rendering).
 */
export function reconcileCanvas(
  layers: Layer[],
  allLayers: Layer[],
  allowBorderConnections: boolean,
  placementOrder: Map<number, number>,
  excludedFamilies?: Set<string>,
  mirrorH: boolean = false,
  mirrorV: boolean = false,
  mirrorRotate: boolean = false,
  widthL0: number = 32,
  heightL0: number = 32,
  borderOnly: boolean = false,
  mirrorQuad: boolean = false,
  mirrorRow: boolean = false,
  mirrorCol: boolean = false,
  mirrorDiag1: boolean = false,
  mirrorDiag2: boolean = false,
  mirrorDiagBoth: boolean = false,
  mirrorStar: boolean = false,
  originL0X: number = 0,
  originL0Y: number = 0,
): UndoOp[] {
  const allOps: UndoOp[] = [];
  const MAX_PASSES = 10;
  const hasMirror = mirrorH || mirrorV || mirrorRotate || mirrorQuad || mirrorRow || mirrorCol || mirrorDiag1 || mirrorDiag2 || mirrorDiagBoth || mirrorStar;

  // Build numeric layer index for fast key computation
  const layerIdx = new Map<string, number>();
  layers.forEach((l, i) => layerIdx.set(l.id, i));
  // Numeric key: layerIndex * 4096 + cy * 64 + cx (supports up to 64×64 cells)
  const numKey = (li: number, cx: number, cy: number) => li * 4096 + cy * 64 + cx;

  // Phase 0: erase every partial tile in visible, unlocked layers — a tile
  // whose cell rectangle overlaps the clip/canvas rectangle but is not fully
  // contained in it. With treatEmptyAsFalse=true the rest of reconcile then
  // sees those slots as 00000000, so no neighbor is forced to connect to a
  // partial tile. Cells fully outside the clip are left alone (the user may
  // have placed them before adjusting the clip box).
  const clipL = originL0X;
  const clipT = originL0Y;
  const clipR = originL0X + widthL0;
  const clipB = originL0Y + heightL0;
  const canvasCfg = { widthL0, heightL0, originL0X, originL0Y };
  for (const layer of layers) {
    if (!layer.visible || layer.locked) continue;
    const count = CELL_COUNTS[layer.level];
    const S = CELL_COUNTS[0] / CELL_COUNTS[layer.level];
    const shX = layer.shiftX;
    const shY = layer.shiftY;
    let erased = false;

    const erasePartialAt = (cx: number, cy: number, cell: CellState): boolean => {
      const xL = (cx + shX) * S;
      const xR = xL + S;
      const yT = (cy + shY) * S;
      const yB = yT + S;
      const overlaps = xL < clipR && xR > clipL && yT < clipB && yB > clipT;
      if (!overlaps) return false;
      if (isCellFullyInsideCanvas(layer, cx, cy, canvasCfg)) return false;
      allOps.push({ op: 'cell', layerId: layer.id, cellX: cx, cellY: cy, oldState: cell, newState: null });
      return true;
    };

    for (let cy = 0; cy < count; cy++) {
      const row = layer.cells[cy];
      for (let cx = 0; cx < count; cx++) {
        const cell = row[cx];
        if (cell == null) continue;
        if (erasePartialAt(cx, cy, cell)) {
          row[cx] = null;
          erased = true;
        }
      }
    }
    if (layer.edgeRowTop) {
      for (let cx = 0; cx < count; cx++) {
        const cell = layer.edgeRowTop[cx];
        if (cell == null) continue;
        if (erasePartialAt(cx, -1, cell)) {
          layer.edgeRowTop[cx] = null;
          erased = true;
        }
      }
    }
    if (layer.edgeColLeft) {
      for (let cy = 0; cy < count; cy++) {
        const cell = layer.edgeColLeft[cy];
        if (cell == null) continue;
        if (erasePartialAt(-1, cy, cell)) {
          layer.edgeColLeft[cy] = null;
          erased = true;
        }
      }
    }
    if (layer.edgeCorner != null) {
      if (erasePartialAt(-1, -1, layer.edgeCorner)) {
        layer.edgeCorner = null;
        erased = true;
      }
    }
    if (erased) layer.cellsGeneration++;
  }

  if (hasMirror) {
    reconcileCanvasSymmetric(
      layers, allLayers, allowBorderConnections, placementOrder, excludedFamilies,
      widthL0, heightL0, originL0X, originL0Y, borderOnly,
      { mirrorH, mirrorV, mirrorRotate, mirrorQuad, mirrorRow, mirrorCol,
        mirrorDiag1, mirrorDiag2, mirrorDiagBoth, mirrorStar },
      allOps,
    );
    return allOps;
  }

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let fixCount = 0;

    // Collect all mismatched cells with their ordinals
    const needsFix: { layer: Layer; cellX: number; cellY: number; ordinal: number }[] = [];

    for (let li_scan = 0; li_scan < layers.length; li_scan++) {
      const layer = layers[li_scan];
      if (!layer.visible) continue;
      if (layer.locked) continue;

      const count = CELL_COUNTS[layer.level];

      // Helper: read cell at any index (including edge cells at -1)
      const readCell = (l: Layer, x: number, y: number): CellState | null => {
        if (x === -1 && y === -1) return l.edgeCorner;
        if (y === -1) return l.edgeRowTop ? l.edgeRowTop[x] ?? null : null;
        if (x === -1) return l.edgeColLeft ? l.edgeColLeft[y] ?? null : null;
        return l.cells[y]?.[x] ?? null;
      };

      // Helper: check one cell for connectivity mismatch
      const checkCell = (cx: number, cy: number, cell: CellState | null) => {
        if (!cell || cell.type !== 'sprite') return;

        // Border-only mode: skip interior cells
        if (borderOnly) {
          const maxCX = editableCells(widthL0, layer.level);
          const maxCY = editableCells(heightL0, layer.level);
          const isBorder =
            cx <= 0 || cy <= 0 || cx >= maxCX - 1 || cy >= maxCY - 1 ||
            !readCell(layer, cx, cy - 1) || !readCell(layer, cx, cy + 1) ||
            !readCell(layer, cx - 1, cy) || !readCell(layer, cx + 1, cy);
          if (!isBorder) return;
        }

        const renderedSig = getRenderedSignature(cell);
        if (!renderedSig) return;

        const constraints = gatherConstraints(cx, cy, layer, allLayers, allowBorderConnections, undefined, widthL0, heightL0, true, undefined, originL0X, originL0Y);

        let hasMismatch = false;
        for (let p = 0; p < 8; p++) {
          if (constraints[p] !== null && constraints[p] !== renderedSig[p]) {
            hasMismatch = true;
            break;
          }
        }

        if (hasMismatch) {
          const li = layerIdx.get(layer.id) ?? 0;
          const ordinal = placementOrder.get(numKey(li, cx, cy)) ?? -1;
          needsFix.push({ layer, cellX: cx, cellY: cy, ordinal });
        }
      };

      // Main grid cells
      for (let cy = 0; cy < count; cy++) {
        for (let cx = 0; cx < count; cx++) {
          checkCell(cx, cy, layer.cells[cy][cx]);
        }
      }
      // Edge cells for shifted layers
      if (layer.edgeRowTop) {
        for (let cx = 0; cx < count; cx++) {
          checkCell(cx, -1, layer.edgeRowTop[cx]);
        }
      }
      if (layer.edgeColLeft) {
        for (let cy = 0; cy < count; cy++) {
          checkCell(-1, cy, layer.edgeColLeft[cy]);
        }
      }
      if (layer.edgeCorner != null) {
        checkCell(-1, -1, layer.edgeCorner);
      }
    }

    if (needsFix.length === 0) break;

    // Sort by ordinal ascending — oldest cells get fixed first (newer cells win)
    needsFix.sort((a, b) => a.ordinal - b.ordinal);

    // Track cells already written as mirror targets in this pass
    const handledThisPass = new Set<number>();

    for (let nfi = 0; nfi < needsFix.length; nfi++) {
      const { layer, cellX, cellY } = needsFix[nfi];
      const li = layerIdx.get(layer.id) ?? 0;
      const cellKey = numKey(li, cellX, cellY);
      if (handledThisPass.has(cellKey)) continue;

      // Re-check: cell might have been fixed by an earlier fix in this pass
      // Use safe accessor for edge cells at -1 indices
      let currentCell: CellState | null;
      if (cellX === -1 && cellY === -1) {
        currentCell = layer.edgeCorner;
      } else if (cellY === -1) {
        currentCell = layer.edgeRowTop ? layer.edgeRowTop[cellX] ?? null : null;
      } else if (cellX === -1) {
        currentCell = layer.edgeColLeft ? layer.edgeColLeft[cellY] ?? null : null;
      } else {
        currentCell = layer.cells[cellY]?.[cellX] ?? null;
      }
      if (!currentCell || currentCell.type !== 'sprite') continue;

      const currentSig = getRenderedSignature(currentCell);
      if (!currentSig) continue;

      const constraints = gatherConstraints(cellX, cellY, layer, allLayers, allowBorderConnections, undefined, widthL0, heightL0, true, undefined, originL0X, originL0Y);
      let stillMismatched = false;
      for (let p = 0; p < 8; p++) {
        if (constraints[p] !== null && constraints[p] !== currentSig[p]) {
          stillMismatched = true;
          break;
        }
      }
      if (!stillMismatched) continue;

      // No-mirror path: pick a replacement using the cell's own
      // constraints. The hasMirror branch returns earlier via
      // `reconcileCanvasSymmetric`, so partner-merging is not needed
      // here.
      const replacement = findMinimalReplacement(
        cellX, cellY, layer, allLayers, allowBorderConnections, currentCell, excludedFamilies, widthL0, heightL0,
        undefined, constraints, originL0X, originL0Y,
      );
      if (!replacement) continue;

      // Carry over tint from the original cell
      if (replacement.type === 'sprite' && currentCell.type === 'sprite' && currentCell.tintR !== undefined) {
        replacement.tintR = currentCell.tintR;
        replacement.tintG = currentCell.tintG;
        replacement.tintB = currentCell.tintB;
      }

      // A "no-op" replacement (same sprite + transform) can still leave empty or
      // stale mirror partners; suppress only the primary write/undo so the partner
      // loop below still runs and re-syncs them.
      const primaryIdentical = replacement.type === 'sprite' && currentCell.type === 'sprite' &&
          replacement.spriteId === currentCell.spriteId &&
          replacement.transform.rotation === currentCell.transform.rotation &&
          replacement.transform.mirrorH === currentCell.transform.mirrorH &&
          replacement.transform.mirrorV === currentCell.transform.mirrorV;

      handledThisPass.add(cellKey);

      if (!primaryIdentical) {
        const oldState = currentCell;
        if (cellX === -1 && cellY === -1) {
          layer.edgeCorner = replacement;
        } else if (cellY === -1 && layer.edgeRowTop) {
          layer.edgeRowTop[cellX] = replacement;
        } else if (cellX === -1 && layer.edgeColLeft) {
          layer.edgeColLeft[cellY] = replacement;
        } else {
          layer.cells[cellY][cellX] = replacement;
        }
        layer.cellsGeneration++;
        allOps.push({ op: 'cell', layerId: layer.id, cellX, cellY, oldState, newState: replacement });
        fixCount++;
      }

    }

    if (fixCount === 0) break;
  }

  return allOps;
}
