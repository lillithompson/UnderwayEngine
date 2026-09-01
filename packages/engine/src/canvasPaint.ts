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
import { gaussianFalloff } from './colorBlend';
import {
  BLUR_KERNEL_FRACTION, BLUR_MAX_KERNEL_TEXELS, BLUR_TAPS, clonePaintOverlay,
  eraseImagePaintOverlay, paintOverlayHasInk, stampImagePaintOverlay,
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

/** The working tile at (tx, ty) FOR READING — the stroke's copy if it has
 *  one, else the committed tile, and no clone either way. The smudge pass
 *  reads its neighbours through this: cloning a tile just to sample it
 *  would mark it touched and drag an unchanged 64 KB copy through the
 *  commit. */
function readIsland(
  working: CanvasPaintWorking, tx: number, ty: number,
): CanvasPaintIsland | undefined {
  const key = islandKey(tileOrigin(tx), tileOrigin(ty));
  return working.touched.get(key) ?? working.baseByKey.get(key);
}

/** Walk every tile the dab disc's AABB touches, handing `visit` the working
 *  island (or null — see {@link workingIsland}) plus its key. The one tile
 *  walk under stamp / erase / blur / smudge, so they all agree on coverage.
 *
 *  `order` walks an axis backwards (−1) instead of forwards. Only the smudge
 *  passes it, and for a reason it cannot do without: that pass READS one
 *  texel to write another, and walking away from where it reads is what
 *  keeps a dab from cascading into itself across a tile seam. */
function forEachIslandUnderDab(
  working: CanvasPaintWorking,
  cellX: number,
  cellY: number,
  radius: number,
  allocate: boolean,
  visit: (island: CanvasPaintIsland, key: string) => void,
  order: readonly [number, number] = [1, 1],
): void {
  const tx0 = Math.floor((cellX - radius) / CANVAS_ISLAND_CELLS);
  const tx1 = Math.floor((cellX + radius) / CANVAS_ISLAND_CELLS);
  const ty0 = Math.floor((cellY - radius) / CANVAS_ISLAND_CELLS);
  const ty1 = Math.floor((cellY + radius) / CANVAS_ISLAND_CELLS);
  if (order[0] < 0 || order[1] < 0) {
    const [sx, sy] = order;
    for (let ty = sy < 0 ? ty1 : ty0; sy < 0 ? ty >= ty0 : ty <= ty1; ty += sy < 0 ? -1 : 1) {
      for (let tx = sx < 0 ? tx1 : tx0; sx < 0 ? tx >= tx0 : tx <= tx1; tx += sx < 0 ? -1 : 1) {
        const island = workingIsland(working, tx, ty, allocate);
        if (island) visit(island, islandKey(island.x, island.y));
      }
    }
    return;
  }
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

/**
 * A reader over the stroke's whole texel plane. Every tile shares one texel
 * lattice, so a global texel index resolves to whichever tile holds it —
 * working copies first ({@link readIsland}) — or to null, off the painted
 * plane. The blur and smudge passes both sample their sources through this.
 *
 * One-entry tile memo: both passes walk row-major, so runs of consecutive
 * reads land in the same tile and skip the key lookup.
 */
function globalTexelReader(
  working: CanvasPaintWorking,
): (gx: number, gy: number) => { rgba: Uint8Array; i: number } | null {
  let memoTx = NaN;
  let memoTy = NaN;
  let memoIsl: CanvasPaintIsland | undefined;
  return (gx, gy) => {
    const tx = Math.floor(gx / CANVAS_ISLAND_TEXELS);
    const ty = Math.floor(gy / CANVAS_ISLAND_TEXELS);
    if (tx !== memoTx || ty !== memoTy) {
      memoTx = tx;
      memoTy = ty;
      memoIsl = readIsland(working, tx, ty);
    }
    if (!memoIsl) return null;
    const c = gx - tx * CANVAS_ISLAND_TEXELS;
    const r = gy - ty * CANVAS_ISLAND_TEXELS;
    return { rgba: memoIsl.overlay.rgba, i: (r * memoIsl.overlay.cols + c) * 4 };
  };
}

/** Reusable per-dab result buffer for {@link blurCanvasPaint}: the blurred
 *  texels of one dab's disc, computed in full before any is written back —
 *  the pass reads its own neighbourhood, so writing in place would cascade
 *  within the dab. Sized to the disc, not the tiles, so it stays small
 *  however many tiles the disc grazes. Grown on demand, never shrunk, never
 *  live across a call (the blur is synchronous). */
let blurDabScratch = new Uint8Array(0);

/**
 * Blur one canvas dab, unmasked (softening what is there is fine anywhere):
 * every texel under the disc moves toward its neighbourhood average by
 * `strength × gaussianFalloff` — one soft box-blur step per stamp, the
 * island counterpart of imagePaintOverlay's blur with the same kernel maths
 * ({@link BLUR_KERNEL_FRACTION} / {@link BLUR_TAPS} / the texel cap) and the
 * same alpha-weighted average (a transparent neighbour lends cover, not
 * colour, so a red edge feathers red rather than dragging black in).
 *
 * Unlike the per-object overlay pass, this one sees the WHOLE tile plane:
 *
 * It READS ACROSS TILE SEAMS. Tiles are an allocation detail the user never
 * chose, so a kernel clipped at a tile edge would draw the 16-cell grid over
 * every blurred stroke as a visible seam. Taps resolve through whatever tile
 * holds them ({@link readIsland}); a tap on unallocated plane is a
 * transparent texel like any other — it lends cover and no colour — so the
 * paint's true edge feathers identically mid-tile or on a seam.
 *
 * And it ALLOCATES. Softening an edge spreads alpha outward, and outward may
 * be a tile that does not exist yet; without allocation the spread would
 * pile against the tile border — a wall in what looks like empty space.
 * Tiles under the disc are allocated like the smudge pass's, and ones the
 * blur never fills are pruned at commit like any other empty tile.
 *
 * The dab computes into {@link blurDabScratch} first and writes back after,
 * so it cannot cascade into itself. The write-back re-derives each texel's
 * disc test with bit-identical arithmetic, which is what lets the scratch
 * skip a coverage plane: a texel is read back exactly when it was computed.
 *
 * `bounds` (tile-space rect) fences the WRITES exactly as it does for
 * {@link smudgeCanvasPaint}: an island whose frame cannot re-frame around
 * more content (a rotated one) would clip outward spread invisibly, so the
 * softening stays inside the rect instead. Reads are never fenced.
 */
export function blurCanvasPaint(
  working: CanvasPaintWorking,
  cellX: number,
  cellY: number,
  radiusCells: number,
  strength: number,
  bounds?: { x: number; y: number; w: number; h: number },
): string[] {
  if (!(strength > 0)) return [];
  const radius = effectiveRadius(radiusCells);
  const radiusSq = radius * radius;
  const tpc = CANVAS_PAINT_TEXELS_PER_CELL;
  // Kernel reach and tap spacing — the overlay pass's maths verbatim.
  const k = Math.max(1, Math.min(
    BLUR_MAX_KERNEL_TEXELS,
    Math.round(radius * tpc * BLUR_KERNEL_FRACTION * strength),
  ));
  const step = Math.max(1, Math.ceil(k / ((BLUR_TAPS - 1) / 2)));
  // The disc's bbox on the global texel lattice — the scratch's frame. Every
  // tile shares one lattice, so a global index resolves to whichever tile
  // holds it, or to transparent plane where none does.
  const gx0 = Math.floor((cellX - radius) * tpc);
  const gx1 = Math.ceil((cellX + radius) * tpc);
  const gy0 = Math.floor((cellY - radius) * tpc);
  const gy1 = Math.ceil((cellY + radius) * tpc);
  const gw = gx1 - gx0 + 1;
  const gh = gy1 - gy0 + 1;
  if (blurDabScratch.length < gw * gh * 4) blurDabScratch = new Uint8Array(gw * gh * 4);
  const out = blurDabScratch;
  const texelAt = globalTexelReader(working);
  for (let gy = gy0; gy <= gy1; gy++) {
    const dy = (gy + 0.5) / tpc - cellY;
    for (let gx = gx0; gx <= gx1; gx++) {
      const dx = (gx + 0.5) / tpc - cellX;
      const distSq = dx * dx + dy * dy;
      if (distSq > radiusSq) continue;
      const t = strength * gaussianFalloff(distSq / radiusSq);
      if (!(t > 0)) continue;
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0, n = 0;
      for (let dr = -k; dr <= k; dr += step) {
        for (let dc = -k; dc <= k; dc += step) {
          const tap = texelAt(gx + dc, gy + dr);
          if (tap) {
            const a = tap.rgba[tap.i + 3];
            rSum += tap.rgba[tap.i] * a;
            gSum += tap.rgba[tap.i + 1] * a;
            bSum += tap.rgba[tap.i + 2] * a;
            aSum += a;
          }
          // A null tap is the unallocated plane: a transparent texel, so it
          // counts toward the neighbourhood (n) and contributes nothing.
          n++;
        }
      }
      const own = texelAt(gx, gy);
      const sr = own ? own.rgba[own.i] : 0;
      const sg = own ? own.rgba[own.i + 1] : 0;
      const sb = own ? own.rgba[own.i + 2] : 0;
      const sa = own ? own.rgba[own.i + 3] : 0;
      // A fully transparent neighbourhood has no colour to pull toward — the
      // texel's own channels stand in (only its alpha, already 0, "moves").
      const avgR = aSum > 0 ? rSum / aSum : sr;
      const avgG = aSum > 0 ? gSum / aSum : sg;
      const avgB = aSum > 0 ? bSum / aSum : sb;
      const avgA = aSum / n;
      const o = ((gy - gy0) * gw + (gx - gx0)) * 4;
      out[o] = Math.round(sr + (avgR - sr) * t);
      out[o + 1] = Math.round(sg + (avgG - sg) * t);
      out[o + 2] = Math.round(sb + (avgB - sb) * t);
      out[o + 3] = Math.round(sa + (avgA - sa) * t);
    }
  }
  const texel = 1 / tpc;
  const changed: string[] = [];
  forEachIslandUnderDab(working, cellX, cellY, radius, true, (island, key) => {
    const { cols, rows, rgba } = island.overlay;
    const lx = cellX - island.x;
    const ly = cellY - island.y;
    let cMin = Math.max(0, Math.floor((lx - radius) / texel));
    let cMax = Math.min(cols - 1, Math.ceil((lx + radius) / texel));
    let rMin = Math.max(0, Math.floor((ly - radius) / texel));
    let rMax = Math.min(rows - 1, Math.ceil((ly + radius) / texel));
    if (bounds) {
      cMin = Math.max(cMin, Math.ceil((bounds.x - island.x) / texel));
      cMax = Math.min(cMax, Math.floor((bounds.x + bounds.w - island.x) / texel) - 1);
      rMin = Math.max(rMin, Math.ceil((bounds.y - island.y) / texel));
      rMax = Math.min(rMax, Math.floor((bounds.y + bounds.h - island.y) / texel) - 1);
    }
    // The island's origin on the global texel lattice (island.x is a whole
    // cell count, so this is exact).
    const bx = island.x * tpc;
    const by = island.y * tpc;
    let touched = false;
    for (let r = rMin; r <= rMax; r++) {
      const gy = by + r;
      // Same expression as the compute pass, so the disc test lands on the
      // same texels to the last ulp — a skipped texel is never read back.
      const dy = (gy + 0.5) / tpc - cellY;
      for (let c = cMin; c <= cMax; c++) {
        const gx = bx + c;
        const dx = (gx + 0.5) / tpc - cellX;
        const distSq = dx * dx + dy * dy;
        if (distSq > radiusSq) continue;
        if (!(strength * gaussianFalloff(distSq / radiusSq) > 0)) continue;
        const o = ((gy - gy0) * gw + (gx - gx0)) * 4;
        const i = (r * cols + c) * 4;
        for (let ch = 0; ch < 4; ch++) {
          if (rgba[i + ch] !== out[o + ch]) {
            rgba[i + ch] = out[o + ch];
            touched = true;
          }
        }
      }
    }
    if (touched) changed.push(key);
  });
  return changed;
}

/**
 * SMUDGE one canvas dab: every texel under the disc pulls in the colour from
 * `(x − dx·w, y − dy·w)`, `w` being the brush's own falloff times its
 * strength, and drifts toward it by that same `w`. Paint is dragged along
 * under the finger — hard in the middle of the brush, not at all at the rim,
 * so a stroke smears what it crosses instead of depositing anything. It is
 * the raster half of the push brush; the vector half warps path points
 * (compositionArcMath's warpSegments) and the rig half moves joints.
 *
 * Two things this pass does that the others do not.
 *
 * It READS ACROSS TILE SEAMS. Blur is allowed to treat each tile as its own
 * little world — softening within one costs a seam nobody can see — but a
 * smudge that could not carry colour over a tile boundary would draw a
 * visible 16-cell grid over every stroke, so the source texel is looked up
 * in whatever tile actually holds it ({@link readIsland}).
 *
 * And it walks AWAY from where it reads. Reading one texel to write another
 * means a dab can cascade into itself — smearing the same colour along the
 * whole disc — unless the source is always a texel this dab has not written
 * yet. Since the source sits at `−delta` from its destination, walking each
 * axis in the direction the paint is travelling, from the far end back,
 * guarantees exactly that: tiles first (`order`), then rows and columns
 * inside each. No snapshot, no scratch buffer, no allocation per dab.
 *
 * Tiles under the disc ARE allocated, so paint can be pushed out into empty
 * space; ones the smear never fills are pruned at commit like any other
 * empty tile. Returns the keys of tiles whose bytes changed.
 *
 * `bounds` (tile-space rect) fences the writes in. Its caller is an island
 * whose frame cannot be re-framed around more content — a rotated one — so
 * paint smeared past the rect it is drawn through would simply vanish;
 * fencing it piles up at the edge instead, which is at least what the user
 * can see happening. Reads are never fenced: colour may come from anywhere.
 */
export function smudgeCanvasPaint(
  working: CanvasPaintWorking,
  cellX: number,
  cellY: number,
  radiusCells: number,
  strength: number,
  dxCells: number,
  dyCells: number,
  bounds?: { x: number; y: number; w: number; h: number },
): string[] {
  if (!(strength > 0)) return [];
  if (!(Math.abs(dxCells) > 0) && !(Math.abs(dyCells) > 0)) return [];
  const radius = effectiveRadius(radiusCells);
  const radiusSq = radius * radius;
  const texel = 1 / CANVAS_PAINT_TEXELS_PER_CELL;
  const changed: string[] = [];
  // The reader's one-entry memo is safe under this pass's in-place writes: a
  // tile is cloned only on its first-ever touch, and the away-from-the-read
  // walk order means any texel read through a stale pre-clone reference
  // still holds exactly its pre-write bytes.
  const texelAt = globalTexelReader(working);
  // BILINEAR, and it has to be. The source sits `delta × falloff` behind its
  // destination, so across one disc the offset ranges continuously from the
  // full delta down to nothing — and nearest-neighbour sampling rounds most
  // of that back onto the destination texel itself, which leaves the middle
  // of the brush smearing and its skirt frozen in stepped rings. Reading
  // between texels makes the smear continuous, at four taps a texel.
  const sample = (x: number, y: number): [number, number, number, number] | null => {
    const fx = x * CANVAS_PAINT_TEXELS_PER_CELL - 0.5;
    const fy = y * CANVAS_PAINT_TEXELS_PER_CELL - 0.5;
    const c0 = Math.floor(fx);
    const r0 = Math.floor(fy);
    const u = fx - c0;
    const v = fy - r0;
    let r = 0, g = 0, b = 0, a = 0, cover = 0;
    for (let dr = 0; dr < 2; dr++) {
      for (let dc = 0; dc < 2; dc++) {
        const w = (dc ? u : 1 - u) * (dr ? v : 1 - v);
        if (!(w > 0)) continue;
        const t = texelAt(c0 + dc, r0 + dr);
        if (!t) continue; // off the plane: transparent, contributing nothing
        const ta = t.rgba[t.i + 3];
        a += ta * w;
        // Colour is alpha-weighted, so a transparent neighbour lends cover
        // rather than black — the same rule the blur pass averages by.
        const cw = ta * w;
        r += t.rgba[t.i] * cw;
        g += t.rgba[t.i + 1] * cw;
        b += t.rgba[t.i + 2] * cw;
        cover += cw;
      }
    }
    if (cover <= 0) return a > 0 ? [0, 0, 0, a] : null;
    return [r / cover, g / cover, b / cover, a];
  };
  const stepX = dxCells >= 0 ? -1 : 1;
  const stepY = dyCells >= 0 ? -1 : 1;
  forEachIslandUnderDab(working, cellX, cellY, radius, true, (island, key) => {
    const { cols, rows, rgba } = island.overlay;
    // The disc in this tile's own texel indices.
    const lx = cellX - island.x;
    const ly = cellY - island.y;
    let cMin = Math.max(0, Math.floor((lx - radius) / texel));
    let cMax = Math.min(cols - 1, Math.ceil((lx + radius) / texel));
    let rMin = Math.max(0, Math.floor((ly - radius) / texel));
    let rMax = Math.min(rows - 1, Math.ceil((ly + radius) / texel));
    if (bounds) {
      cMin = Math.max(cMin, Math.ceil((bounds.x - island.x) / texel));
      cMax = Math.min(cMax, Math.floor((bounds.x + bounds.w - island.x) / texel) - 1);
      rMin = Math.max(rMin, Math.ceil((bounds.y - island.y) / texel));
      rMax = Math.min(rMax, Math.floor((bounds.y + bounds.h - island.y) / texel) - 1);
    }
    let touched = false;
    for (let r = stepY < 0 ? rMax : rMin; stepY < 0 ? r >= rMin : r <= rMax; r += stepY) {
      const ty = (r + 0.5) * texel;
      for (let c = stepX < 0 ? cMax : cMin; stepX < 0 ? c >= cMin : c <= cMax; c += stepX) {
        const tx = (c + 0.5) * texel;
        const distSq = (tx - lx) * (tx - lx) + (ty - ly) * (ty - ly);
        if (distSq > radiusSq) continue;
        const w = strength * gaussianFalloff(distSq / radiusSq);
        if (!(w > 0)) continue;
        const src = sample(island.x + tx - dxCells * w, island.y + ty - dyCells * w);
        const i = (r * cols + c) * 4;
        // Nothing behind the brush: the texel drifts toward empty, which is
        // what pulling paint off the trailing edge of a smear looks like.
        const sa = src ? src[3] : 0;
        const da = rgba[i + 3];
        if (sa === 0 && da === 0) continue;
        // Colour mixes ALPHA-WEIGHTED, the way the blur pass averages its
        // neighbourhood: these are straight-alpha texels, so lerping RGB
        // toward a transparent source would drag black in and smear a red
        // stroke into a dark grey one.
        const ws = sa * w;
        const wd = da * (1 - w);
        const total = ws + wd;
        if (total > 0) {
          for (let ch = 0; ch < 3; ch++) {
            const s = sa === 0 ? rgba[i + ch] : src![ch];
            const v = Math.round((s * ws + rgba[i + ch] * wd) / total);
            if (rgba[i + ch] !== v) { rgba[i + ch] = v; touched = true; }
          }
        }
        const a = Math.round(da + (sa - da) * w);
        if (rgba[i + 3] !== a) { rgba[i + 3] = a; touched = true; }
      }
    }
    if (touched) changed.push(key);
  }, [stepX, stepY]);
  return changed;
}
