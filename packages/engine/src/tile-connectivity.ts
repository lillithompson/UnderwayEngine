/**
 * Tile candidate selection by connection count and exact connection patterns.
 * Pure logic — no JSX.
 */

import { CellTransform } from './types';
import { SPRITE_ENTRIES, SpriteEntry } from './loadTile';
import { parseConnectionSignature, gatherConstraints } from './connectivity';
import type { Layer } from './types';

// ── Transform constants ──────────────────────────────────────────────

const ALL_ROTATIONS: readonly (0 | 90 | 180 | 270)[] = [0, 90, 180, 270];

// Mirror maps for transformPointToRaw (same as connectivity.ts)
const MIRROR_H_MAP = [0, 7, 6, 5, 4, 3, 2, 1];
const MIRROR_V_MAP = [4, 3, 2, 1, 0, 7, 6, 5];
const UNROTATE_OFFSET: Record<number, number> = { 0: 0, 90: 6, 180: 4, 270: 2 };

function transformPointToRaw(point: number, t: CellTransform): number {
  let p = point;
  p = (p + UNROTATE_OFFSET[t.rotation]) & 7;
  if (t.mirrorH) p = MIRROR_H_MAP[p];
  if (t.mirrorV) p = MIRROR_V_MAP[p];
  return p;
}

// ── Types ────────────────────────────────────────────────────────────

export interface TileCandidate {
  entry: SpriteEntry;
  transform: CellTransform;
}

// ── Rendered signature for a candidate ───────────────────────────────

function getRenderedSig(rawSig: boolean[], t: CellTransform): boolean[] {
  const rendered: boolean[] = new Array(8);
  for (let p = 0; p < 8; p++) {
    rendered[p] = rawSig[transformPointToRaw(p, t)];
  }
  return rendered;
}

// ── Connection count for a rendered variant ──────────────────────────

function renderedConnectionCount(rawSig: boolean[], t: CellTransform): number {
  let count = 0;
  for (let p = 0; p < 8; p++) {
    if (rawSig[transformPointToRaw(p, t)]) count++;
  }
  return count;
}

// ── Candidate selection functions ────────────────────────────────────

// ── Memoization for getCandidatesWithConnectionCount ──────────────────
// Cache keyed by (connectionCount, allowedSourceSetRef). Reference equality
// on the allowed set means cache hits during a stroke (set is stable).
// The "all sprites" case (no exclusions) is pre-computed on first access.

let _ccAllCache: Map<number, TileCandidate[]> | null = null;
let _ccFilteredCache: Map<number, TileCandidate[]> | null = null;
let _ccFilteredRef: Set<string> | null = null;

function _buildCandidatesByCount(entries: SpriteEntry[]): Map<number, TileCandidate[]> {
  const map = new Map<number, TileCandidate[]>();
  for (let n = 0; n <= 8; n++) map.set(n, []);
  for (const entry of entries) {
    const rawSig = parseConnectionSignature(entry.id);
    if (!rawSig) continue;
    for (const rotation of ALL_ROTATIONS) {
      for (const mirrorH of [false, true] as const) {
        for (const mirrorV of [false, true] as const) {
          const t: CellTransform = { rotation, mirrorH, mirrorV };
          const count = renderedConnectionCount(rawSig, t);
          map.get(count)!.push({ entry, transform: t });
        }
      }
    }
  }
  return map;
}

/**
 * Returns all (entry, transform) pairs with exactly `n` true connections.
 * If allowedSourceSet is provided, tries that first; falls back to all sources.
 */
export function getCandidatesWithConnectionCount(
  n: number,
  allowedSourceSet?: Set<string> | null,
): TileCandidate[] {
  // Filtered path
  if (allowedSourceSet && allowedSourceSet.size > 0) {
    if (_ccFilteredRef !== allowedSourceSet || !_ccFilteredCache) {
      const filtered = SPRITE_ENTRIES.filter(e => allowedSourceSet.has(e.family));
      _ccFilteredCache = _buildCandidatesByCount(filtered);
      _ccFilteredRef = allowedSourceSet;
    }
    const result = _ccFilteredCache.get(n);
    if (result && result.length > 0) return result;
  }

  // All-sprites path (pre-computed once)
  if (!_ccAllCache) {
    _ccAllCache = _buildCandidatesByCount(SPRITE_ENTRIES);
  }
  return _ccAllCache.get(n) ?? [];
}

/**
 * Returns all variants with exactly 2 connections, one being `requiredDir`.
 */
export function getCandidatesWithTwoConnectionsOneBeing(
  requiredDir: number,
  allowedSourceSet?: Set<string> | null,
): TileCandidate[] {
  const tryFilter = (entries: SpriteEntry[]) => {
    const results: TileCandidate[] = [];
    for (const entry of entries) {
      const rawSig = parseConnectionSignature(entry.id);
      if (!rawSig) continue;
      for (const rotation of ALL_ROTATIONS) {
        for (const mirrorH of [false, true] as const) {
          for (const mirrorV of [false, true] as const) {
            const t: CellTransform = { rotation, mirrorH, mirrorV };
            const rendered = getRenderedSig(rawSig, t);
            let count = 0;
            for (let p = 0; p < 8; p++) if (rendered[p]) count++;
            if (count === 2 && rendered[requiredDir]) {
              results.push({ entry, transform: t });
            }
          }
        }
      }
    }
    return results;
  };

  if (allowedSourceSet && allowedSourceSet.size > 0) {
    const filtered = SPRITE_ENTRIES.filter(e => allowedSourceSet.has(e.family));
    const result = tryFilter(filtered);
    if (result.length > 0) return result;
  }
  return tryFilter(SPRITE_ENTRIES);
}

/**
 * Returns all variants whose connections are true exactly in requiredDirs
 * and false elsewhere. Strictest filter.
 */
export function getCandidatesWithExactConnections(
  requiredDirs: number[],
  allowedSourceSet?: Set<string> | null,
): TileCandidate[] {
  // Build target mask
  const target = new Array(8).fill(false);
  for (const d of requiredDirs) target[d] = true;

  const tryFilter = (entries: SpriteEntry[]) => {
    const results: TileCandidate[] = [];
    for (const entry of entries) {
      const rawSig = parseConnectionSignature(entry.id);
      if (!rawSig) continue;
      for (const rotation of ALL_ROTATIONS) {
        for (const mirrorH of [false, true] as const) {
          for (const mirrorV of [false, true] as const) {
            const t: CellTransform = { rotation, mirrorH, mirrorV };
            const rendered = getRenderedSig(rawSig, t);
            let matches = true;
            for (let p = 0; p < 8; p++) {
              if (rendered[p] !== target[p]) { matches = false; break; }
            }
            if (matches) {
              results.push({ entry, transform: t });
            }
          }
        }
      }
    }
    return results;
  };

  if (allowedSourceSet && allowedSourceSet.size > 0) {
    const filtered = SPRITE_ENTRIES.filter(e => allowedSourceSet.has(e.family));
    const result = tryFilter(filtered);
    if (result.length > 0) return result;
  }
  return tryFilter(SPRITE_ENTRIES);
}

/**
 * Filter candidates by cross-layer constraint compatibility.
 * Uses gatherConstraints and checks that the candidate's rendered signature
 * satisfies all non-null constraints.
 */
export function filterByCrossLayer(
  candidates: TileCandidate[],
  cellX: number,
  cellY: number,
  layer: Layer,
  allLayers: Layer[],
  allowBorderConnections: boolean,
  canvasWidthL0: number = 32,
  canvasHeightL0: number = 32,
  canvasOriginL0X: number = 0,
  canvasOriginL0Y: number = 0,
): TileCandidate[] {
  const constraints = gatherConstraints(
    cellX, cellY, layer, allLayers, allowBorderConnections,
    undefined, canvasWidthL0, canvasHeightL0, false, undefined,
    canvasOriginL0X, canvasOriginL0Y,
  );
  // Copy constraints since gatherConstraints returns a shared array
  const c = [...constraints];

  return candidates.filter(({ entry, transform }) => {
    const rawSig = parseConnectionSignature(entry.id);
    if (!rawSig) return true;
    for (let p = 0; p < 8; p++) {
      if (c[p] === null) continue;
      if (rawSig[transformPointToRaw(p, transform)] !== c[p]) return false;
    }
    return true;
  });
}
