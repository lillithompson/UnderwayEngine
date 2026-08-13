/**
 * Sparse raster tiles for paint-island content ({@link PaintObject.tiles}).
 *
 * Every {@link PaintObject} holds its brushwork as a list of {@link
 * CanvasPaintIsland} tiles in the object's own TILE SPACE (== the world
 * frame it was painted in; see the PaintObject doc). This module owns the
 * tile lattice math: allocation, per-stroke working sets, and the
 * stamp/erase/blur brushes. It is deliberately frame-agnostic — coordinates
 * here are just "cells in the tile lattice"; callers map world points into
 * tile space before stamping (`paintLocalFrame`, paintObject.ts).
 *
 * ## Tiles
 *
 * The paintable plane is effectively infinite: a dab can land anywhere,
 * arbitrarily far from anything painted before. Backing that with one bitmap
 * would either cap the area or balloon to the bounding box of everything
 * ever painted. Instead content is a list of independent RGBA tiles, each
 * anchored at a cell origin — only regions that actually hold paint are
 * allocated.
 *
 * Allocation is on a fixed grid: every tile this module creates spans
 * {@link CANVAS_ISLAND_CELLS} cells per side, origin-aligned to that step. A
 * dab in unallocated space allocates exactly the tiles its disc touches, so
 * dead space costs nothing. The uniform grid is what makes "is there raster
 * here?" trivial and — because tiles can then never overlap — what keeps a
 * dab from double-depositing where two free-form tiles would meet. All tiles
 * share one lattice ({@link CANVAS_PAINT_TEXELS_PER_CELL} per cell,
 * origin-anchored), so a stroke crossing a tile boundary lays the exact
 * texels one big bitmap would.
 *
 * Memory: a tile is 128×128 texels = 64 KB. Per-stroke working copies clone
 * only the tiles the stroke touches, and {@link CANVAS_PAINT_MAX_BYTES} caps
 * the total allocation — past it, dabs still land on existing tiles but no
 * new ones are created. Tiles the eraser empties are pruned at commit
 * ({@link commitCanvasPaint}), so a fully-erased region is byte-identical to
 * one never painted.
 */

import { BlendMode, CanvasPaintIsland, RGBColor } from './types';
import {
  blurImagePaintOverlay, clonePaintOverlay, eraseImagePaintOverlay, paintOverlayHasInk,
  stampImagePaintOverlay,
} from './imagePaintOverlay';

/** Texel density. Double the per-object overlays' 4/cell: island brushwork
 *  is page-scale drawing, so it survives more zoom than a sticker-sized
 *  bbox layer. Shared by every tile — one lattice. */
export const CANVAS_PAINT_TEXELS_PER_CELL = 8;

/** Cells per tile side. 16 cells = 128×128 texels = 64 KB per tile:
 *  fine enough that a stray dab in empty space doesn't cost much, coarse
 *  enough that a page-sized wash is a handful of tiles, not hundreds. */
export const CANVAS_ISLAND_CELLS = 16;

/** Texels per island side (square). */
export const CANVAS_ISLAND_TEXELS = CANVAS_ISLAND_CELLS * CANVAS_PAINT_TEXELS_PER_CELL;

const ISLAND_BYTES = CANVAS_ISLAND_TEXELS * CANVAS_ISLAND_TEXELS * 4;

/**
 * Total paint-tile budget across all islands' tiles, in rgba bytes. 32 MiB =
 * 512 tiles ≈ 36 page-areas of solid coverage — far beyond any real drawing,
 * but a hard wall against runaway allocation on a memory-constrained device
 * (each committed byte is mirrored by a canvas backing-store byte, and
 * touched tiles are cloned per stroke for undo). When a stroke would
 * allocate past it, existing tiles still take paint; new tiles just stop
 * appearing.
 */
export const CANVAS_PAINT_MAX_BYTES = 32 * 1024 * 1024;

// ── Tile geometry ───────────────────────────────────────────────────

/** The cell height a tile covers (texels are square). */
export function islandHeightCells(island: CanvasPaintIsland): number {
  return (island.widthCells * island.overlay.rows) / island.overlay.cols;
}

/** An island's identity for texture caches and working sets: its origin.
 *  Islands never overlap, so the origin is unique. */
export function islandKey(x: number, y: number): string {
  return `${x},${y}`;
}

function tileOrigin(t: number): number {
  return t * CANVAS_ISLAND_CELLS;
}

/** A fresh transparent tile island at tile coords (tx, ty). Exported for
 *  paintObject.ts's merge resampler — the one other place tiles are born. */
export function createIslandAt(tx: number, ty: number): CanvasPaintIsland {
  return {
    x: tileOrigin(tx),
    y: tileOrigin(ty),
    widthCells: CANVAS_ISLAND_CELLS,
    overlay: {
      cols: CANVAS_ISLAND_TEXELS,
      rows: CANVAS_ISLAND_TEXELS,
      rgba: new Uint8Array(ISLAND_BYTES),
      blend: 'normal',
    },
  };
}

/** Total rgba bytes across a layer's islands — the budget accounting unit. */
export function canvasPaintBytes(islands: readonly CanvasPaintIsland[] | undefined): number {
  let bytes = 0;
  for (const isl of islands ?? []) bytes += isl.overlay.rgba.byteLength;
  return bytes;
}

/** Whether any island holds any paint at all. */
export function canvasPaintHasInk(islands: readonly CanvasPaintIsland[] | undefined): boolean {
  return (islands ?? []).some((isl) => paintOverlayHasInk(isl.overlay));
}

/**
 * Tight world-cell bounds of the actually-painted texels across all islands,
 * or null when nothing is painted. Content-framed exports use this so a
 * drawing far from the origin still lands inside the frame — island RECTS
 * would over-pad (a tile is mostly transparent around a small dab).
 */
export function canvasPaintInkBounds(
  islands: readonly CanvasPaintIsland[] | undefined,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const isl of islands ?? []) {
    const { cols, rows, rgba } = isl.overlay;
    const texW = isl.widthCells / cols;
    let tMinC = Infinity, tMinR = Infinity, tMaxC = -Infinity, tMaxR = -Infinity;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (rgba[(r * cols + c) * 4 + 3] === 0) continue;
        if (c < tMinC) tMinC = c;
        if (c > tMaxC) tMaxC = c;
        if (r < tMinR) tMinR = r;
        if (r > tMaxR) tMaxR = r;
      }
    }
    if (tMinC === Infinity) continue;
    minX = Math.min(minX, isl.x + tMinC * texW);
    maxX = Math.max(maxX, isl.x + (tMaxC + 1) * texW);
    minY = Math.min(minY, isl.y + tMinR * texW);
    maxY = Math.max(maxY, isl.y + (tMaxR + 1) * texW);
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

// ── Normalization ───────────────────────────────────────────────────

function islandConforms(isl: CanvasPaintIsland): boolean {
  return isl.widthCells === CANVAS_ISLAND_CELLS
    && isl.overlay.cols === CANVAS_ISLAND_TEXELS
    && isl.overlay.rows === CANVAS_ISLAND_TEXELS
    && isl.x % CANVAS_ISLAND_CELLS === 0
    && isl.y % CANVAS_ISLAND_CELLS === 0
    && Number.isInteger(isl.x)
    && Number.isInteger(isl.y);
}

/** Re-tile one arbitrary island onto the allocation grid by nearest-neighbor
 *  at each tile texel's center. For a source already on the shared lattice
 *  the lattices coincide, so this is an exact byte copy. Tiles that end up
 *  fully transparent are dropped; tiles are merged into `into` (keyed by
 *  origin) so several source islands can retile together. */
function retileIsland(isl: CanvasPaintIsland, into: Map<string, CanvasPaintIsland>): void {
  const h = islandHeightCells(isl);
  if (!(isl.widthCells > 0) || !(h > 0)) return;
  const srcTexW = isl.widthCells / isl.overlay.cols;
  const srcTexH = h / isl.overlay.rows;
  const tx0 = Math.floor(isl.x / CANVAS_ISLAND_CELLS);
  const tx1 = Math.ceil((isl.x + isl.widthCells) / CANVAS_ISLAND_CELLS) - 1;
  const ty0 = Math.floor(isl.y / CANVAS_ISLAND_CELLS);
  const ty1 = Math.ceil((isl.y + h) / CANVAS_ISLAND_CELLS) - 1;
  const texW = 1 / CANVAS_PAINT_TEXELS_PER_CELL;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const key = islandKey(tileOrigin(tx), tileOrigin(ty));
      let tile = into.get(key);
      let fresh = false;
      if (!tile) {
        tile = createIslandAt(tx, ty);
        fresh = true;
      }
      const dst = tile.overlay.rgba;
      let any = false;
      for (let r = 0; r < CANVAS_ISLAND_TEXELS; r++) {
        const wy = tile.y + (r + 0.5) * texW;
        const sr = Math.floor((wy - isl.y) / srcTexH);
        if (sr < 0 || sr >= isl.overlay.rows) continue;
        for (let c = 0; c < CANVAS_ISLAND_TEXELS; c++) {
          const wx = tile.x + (c + 0.5) * texW;
          const sc = Math.floor((wx - isl.x) / srcTexW);
          if (sc < 0 || sc >= isl.overlay.cols) continue;
          const si = (sr * isl.overlay.cols + sc) * 4;
          if (isl.overlay.rgba[si + 3] === 0) continue;
          const di = (r * CANVAS_ISLAND_TEXELS + c) * 4;
          // First writer wins on the (rare) overlap of two source islands —
          // matching the renderer, which drew the earlier island underneath.
          if (dst[di + 3] !== 0) continue;
          dst[di] = isl.overlay.rgba[si];
          dst[di + 1] = isl.overlay.rgba[si + 1];
          dst[di + 2] = isl.overlay.rgba[si + 2];
          dst[di + 3] = isl.overlay.rgba[si + 3];
          any = true;
        }
      }
      if (fresh && any) into.set(key, tile);
    }
  }
}

/**
 * Bring a loaded tile list onto the allocation invariants: conforming
 * tiles pass through (empty ones dropped), anything else — a hand-edited
 * save, or bytes from a future/foreign writer — is re-tiled onto the grid.
 * Every loader funnels through here so the stamp path can rely on the
 * uniform grid without defending against overlap.
 */
export function normalizeCanvasPaintIslands(
  islands: readonly CanvasPaintIsland[] | undefined,
): CanvasPaintIsland[] | undefined {
  if (!islands || islands.length === 0) return undefined;
  const out: CanvasPaintIsland[] = [];
  const seen = new Set<string>();
  const retiled = new Map<string, CanvasPaintIsland>();
  for (const isl of islands) {
    if (islandConforms(isl) && !seen.has(islandKey(isl.x, isl.y))) {
      if (paintOverlayHasInk(isl.overlay)) {
        out.push(isl);
        seen.add(islandKey(isl.x, isl.y));
      }
    } else {
      retileIsland(isl, retiled);
    }
  }
  for (const [key, tile] of retiled) {
    if (!seen.has(key)) {
      out.push(tile);
      seen.add(key);
    }
  }
  return out.length > 0 ? out : undefined;
}

// ── Paint-object content queries ────────────────────────────────────

/** Tile-space ink bounds as an origin+size rect — the contentRect (and, for
 *  a 1:1 in-session object, the bbox) of a {@link PaintObject} holding
 *  `tiles`. Null when nothing is painted. */
export function paintTilesContentRect(
  tiles: readonly CanvasPaintIsland[] | undefined,
): { x: number; y: number; w: number; h: number } | null {
  const b = canvasPaintInkBounds(tiles);
  if (!b) return null;
  return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
}

/** Alpha (0–255) at a tile-space point; 0 where no tile is allocated. The
 *  paint GeometryAdapter's hit-test samples this so the empty space of a
 *  sparse island doesn't swallow taps. O(tiles) — islands hold at most a
 *  few dozen. */
export function paintTileAlphaAt(
  tiles: readonly CanvasPaintIsland[] | undefined,
  tx: number,
  ty: number,
): number {
  for (const isl of tiles ?? []) {
    if (tx < isl.x || tx >= isl.x + isl.widthCells || ty < isl.y) continue;
    const h = islandHeightCells(isl);
    if (ty >= isl.y + h) continue;
    const { cols, rows, rgba } = isl.overlay;
    const c = Math.min(cols - 1, Math.max(0, Math.floor(((tx - isl.x) / isl.widthCells) * cols)));
    const r = Math.min(rows - 1, Math.max(0, Math.floor(((ty - isl.y) / h) * rows)));
    return rgba[(r * cols + c) * 4 + 3];
  }
  return 0;
}

// ── The stroke's working set ────────────────────────────────────────

/**
 * One paint stroke's canvas working set. Committed islands are immutable
 * (undo entries hold references into past scenes), so the stroke clones each
 * island on first touch and allocates fresh tiles where a dab lands on
 * nothing — all keyed by island origin. `commitCanvasPaint` folds it back
 * into a committed island list.
 */
export interface CanvasPaintWorking {
  /** Committed islands at stroke start, in their committed order. */
  readonly baseList: readonly CanvasPaintIsland[];
  readonly baseByKey: ReadonlyMap<string, CanvasPaintIsland>;
  /** Working islands: clones of touched base islands + fresh allocations. */
  readonly touched: Map<string, CanvasPaintIsland>;
  /** Keys of fresh allocations, in creation order (compose appends them
   *  after the base islands). */
  readonly added: string[];
  /** rgba bytes across base + allocations, for the budget gate. */
  bytes: number;
  readonly maxBytes: number;
  /** Per-island unary scratch: invert / rotate / randomize rewrite each
   *  texel once per stroke. Allocated lazily per island. */
  readonly unaryDone: Map<string, Uint8Array>;
}

export function createCanvasPaintWorking(
  committed?: readonly CanvasPaintIsland[],
  maxBytes: number = CANVAS_PAINT_MAX_BYTES,
): CanvasPaintWorking {
  const baseList = committed ?? [];
  const baseByKey = new Map<string, CanvasPaintIsland>();
  for (const isl of baseList) baseByKey.set(islandKey(isl.x, isl.y), isl);
  return {
    baseList,
    baseByKey,
    touched: new Map(),
    added: [],
    bytes: canvasPaintBytes(baseList),
    maxBytes,
    unaryDone: new Map(),
  };
}

/** The working set as an island list — base islands (touched ones swapped
 *  for their working copies) plus fresh allocations. What the live stroke
 *  preview renders mid-stroke. */
export function composeCanvasPaint(working: CanvasPaintWorking): CanvasPaintIsland[] {
  const out = working.baseList.map(
    (isl) => working.touched.get(islandKey(isl.x, isl.y)) ?? isl,
  );
  for (const key of working.added) {
    const isl = working.touched.get(key);
    if (isl) out.push(isl);
  }
  return out;
}

/** Fold the stroke back into a committed island list: compose, then prune
 *  islands with no ink left (an erased-empty region is byte-identical to one
 *  never painted). Undefined when nothing painted survives. */
export function commitCanvasPaint(working: CanvasPaintWorking): CanvasPaintIsland[] | undefined {
  const kept = composeCanvasPaint(working).filter((isl) => paintOverlayHasInk(isl.overlay));
  return kept.length > 0 ? kept : undefined;
}

// ── Brush ───────────────────────────────────────────────────────────

/** The brush radius floored to reach at least one texel center, so a dab at
 *  a deeply subdivided grid level (radius ≪ one texel) still deposits ink
 *  instead of silently painting nothing. */
function effectiveRadius(radiusCells: number): number {
  return Math.max(radiusCells, 0.75 / CANVAS_PAINT_TEXELS_PER_CELL);
}

/** How a canvas dab blends with what is already under it. Omitted (or
 *  `normal`) keeps the plain source-over deposit; any other mode is
 *  MUTATE-ONLY — it edits existing paint's color and never deposits new
 *  ink (see imagePaintOverlay's blending section). The per-stroke unary
 *  scratch is managed by the working set. */
export interface CanvasStampBlend {
  mode: BlendMode;
}

/**
 * Per-texel deposit weighting for {@link stampCanvasPaint} — the scene's
 * occlusion hook. For each island a dab touches, `forIsland` is handed the
 * island's key, texel count and TILE-SPACE origin, and returns the weight
 * function the stamp calls per texel: `i` is the texel's byte offset into
 * that island's rgba, (lx, ly) its center in island-LOCAL cells (add the
 * origin for the tile-space point). The returned weight is a 0–1 multiplier
 * on the texel's deposit: 0 where something opaque fully covers the canvas,
 * a fraction where a partially transparent object lets that share of the
 * stroke fall through. Implementations should memoize per island — a stroke
 * revisits the same texels dab after dab.
 */
export interface CanvasPaintStampMask {
  forIsland(
    key: string,
    texelCount: number,
    originX: number,
    originY: number,
  ): (i: number, lx: number, ly: number) => number;
}

function isUnaryMode(mode: BlendMode): boolean {
  return mode === 'invert' || mode === 'rotate' || mode === 'randomize';
}

/** The working island for `key`, cloning the committed one on first touch or
 *  — when `allocate` and the budget allows — creating a fresh tile. Null
 *  when there is nothing to stamp into (missing and not allocating, or the
 *  budget is spent). */
function workingIsland(
  working: CanvasPaintWorking,
  tx: number,
  ty: number,
  allocate: boolean,
): CanvasPaintIsland | null {
  const key = islandKey(tileOrigin(tx), tileOrigin(ty));
  const existing = working.touched.get(key);
  if (existing) return existing;
  const base = working.baseByKey.get(key);
  if (base) {
    const clone = { ...base, overlay: clonePaintOverlay(base.overlay) };
    working.touched.set(key, clone);
    return clone;
  }
  if (!allocate) return null;
  if (working.bytes + ISLAND_BYTES > working.maxBytes) return null;
  const fresh = createIslandAt(tx, ty);
  working.touched.set(key, fresh);
  working.added.push(key);
  working.bytes += ISLAND_BYTES;
  return fresh;
}

/** Walk every tile the dab disc's AABB touches, handing `visit` the working
 *  island (or null — see {@link workingIsland}) plus its key. The one tile
 *  walk under stamp / erase / blur, so all three agree on coverage. */
function forEachIslandUnderDab(
  working: CanvasPaintWorking,
  cellX: number,
  cellY: number,
  radius: number,
  allocate: boolean,
  visit: (island: CanvasPaintIsland, key: string) => void,
): void {
  const tx0 = Math.floor((cellX - radius) / CANVAS_ISLAND_CELLS);
  const tx1 = Math.floor((cellX + radius) / CANVAS_ISLAND_CELLS);
  const ty0 = Math.floor((cellY - radius) / CANVAS_ISLAND_CELLS);
  const ty1 = Math.floor((cellY + radius) / CANVAS_ISLAND_CELLS);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const island = workingIsland(working, tx, ty, allocate);
      if (island) visit(island, islandKey(island.x, island.y));
    }
  }
}

/**
 * Stamp one dab at tile-space (cellX, cellY) into the stroke's working set:
 * the shared overlay stamp (same falloff / source-over rules as every other
 * brush surface) run against every tile the disc touches — cloning committed
 * tiles on first touch and ALLOCATING fresh ones where the dab lands on
 * nothing, which is what makes the paintable plane effectively infinite.
 *
 * Returns the keys of tiles whose bytes changed (empty = the dab landed on
 * nothing paintable), so callers can redraw exactly those tiles.
 *
 * `blend` makes the dab destructive — it mutates the color already under the
 * brush instead of laying the brush color over it. An island renders
 * source-over into the scene, so a blend mode has no compositing route at
 * draw time and this is the only place it can act. Mutate-only: a
 * non-normal dab edits existing paint and deposits nothing on empty space,
 * so it also never allocates a tile — like the eraser, there is nothing for
 * it to do where no island exists. See imagePaintOverlay's blending section.
 *
 * `mask` weights each texel's deposit by what the scene lets through at that
 * point — see {@link CanvasPaintStampMask}. Omitted, the dab deposits
 * unweighted everywhere (the erase/blur brushes and unmasked callers).
 */
export function stampCanvasPaint(
  working: CanvasPaintWorking,
  cellX: number,
  cellY: number,
  radiusCells: number,
  color: RGBColor,
  alpha: number,
  blend?: CanvasStampBlend,
  mask?: CanvasPaintStampMask,
): string[] {
  const radius = effectiveRadius(radiusCells);
  const mutateOnly = !!blend && blend.mode !== 'normal';
  const changed: string[] = [];
  forEachIslandUnderDab(working, cellX, cellY, radius, !mutateOnly, (island, key) => {
    const { cols, rows } = island.overlay;
    let unaryDone: Uint8Array | undefined;
    if (blend && isUnaryMode(blend.mode)) {
      unaryDone = working.unaryDone.get(key);
      if (!unaryDone) {
        unaryDone = new Uint8Array(cols * rows);
        working.unaryDone.set(key, unaryDone);
      }
    }
    if (stampImagePaintOverlay(
      island.overlay,
      island.widthCells,
      islandHeightCells(island),
      cellX - island.x,
      cellY - island.y,
      radius,
      color,
      alpha,
      mask?.forIsland(key, cols * rows, island.x, island.y),
      blend ? { mode: blend.mode, unaryDone } : undefined,
    )) {
      changed.push(key);
    }
  });
  return changed;
}

/** Erase one canvas dab — the deposit rule in reverse, unmasked (lifting
 *  paint back off is fine anywhere). Never allocates: there is nothing to
 *  erase where no island exists. */
export function eraseCanvasPaint(
  working: CanvasPaintWorking,
  cellX: number,
  cellY: number,
  radiusCells: number,
  strength: number,
): string[] {
  const radius = effectiveRadius(radiusCells);
  const changed: string[] = [];
  forEachIslandUnderDab(working, cellX, cellY, radius, false, (island, key) => {
    if (eraseImagePaintOverlay(
      island.overlay, island.widthCells, islandHeightCells(island),
      cellX - island.x, cellY - island.y, radius, strength,
    )) {
      changed.push(key);
    }
  });
  return changed;
}

/** Blur one canvas dab — one box-blur step over each touched island's own
 *  texels, unmasked (softening what is there is fine anywhere). Never
 *  allocates. Each island blurs within itself: a texel at a tile edge
 *  doesn't read its neighbor tile, a soft-edged approximation that keeps the
 *  pass allocation-free. */
export function blurCanvasPaint(
  working: CanvasPaintWorking,
  cellX: number,
  cellY: number,
  radiusCells: number,
  strength: number,
): string[] {
  const radius = effectiveRadius(radiusCells);
  const changed: string[] = [];
  forEachIslandUnderDab(working, cellX, cellY, radius, false, (island, key) => {
    if (blurImagePaintOverlay(
      island.overlay, island.widthCells, islandHeightCells(island),
      cellX - island.x, cellY - island.y, radius, strength,
    )) {
      changed.push(key);
    }
  });
  return changed;
}
