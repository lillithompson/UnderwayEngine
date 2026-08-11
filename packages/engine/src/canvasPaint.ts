/**
 * The paint tool's CANVAS raster layer ({@link CompositionState.canvasPaint}):
 * a SPARSE set of raster islands, stamped wherever a paint dab lands on no
 * object. Rendered by the GL pass right after the grid — under every scene
 * object — and deliberately absent from `sceneOrder`, so it never appears in
 * the Scene Outline.
 *
 * ## Islands
 *
 * The canvas is effectively infinite: a dab can land anywhere in world-cell
 * space, arbitrarily far from the page origin. Backing that with one bitmap
 * would either cap the drawable area (the old model: one page-anchored layer,
 * dabs beyond it silently lost) or balloon to the bounding box of everything
 * ever painted. Instead the layer is a list of {@link CanvasPaintIsland}s —
 * independent RGBA bitmaps, each anchored at a world-cell origin — and only
 * regions that actually hold paint are allocated.
 *
 * Allocation is on a fixed tile grid: every island this module creates spans
 * {@link CANVAS_ISLAND_CELLS} cells per side, origin-aligned to that step. A
 * dab in unallocated space allocates exactly the tiles its disc touches, so
 * a stroke far from everything else starts its own island(s) and dead space
 * between drawings costs nothing. The uniform grid is what makes "is there
 * raster here?" trivial and — because islands can then never overlap — what
 * keeps a dab from double-depositing where two free-form islands would meet.
 * All islands share one global texel lattice ({@link
 * CANVAS_PAINT_TEXELS_PER_CELL} per cell, origin-anchored), so a stroke
 * crossing a tile boundary lays the exact texels one big bitmap would.
 *
 * Memory: a tile is 128×128 texels = 64 KB. Per-stroke working copies clone
 * only the tiles the stroke touches, and {@link CANVAS_PAINT_MAX_BYTES} caps
 * the total allocation — past it, dabs still land on existing islands but no
 * new ones are created. Islands the eraser empties are pruned at commit
 * ({@link commitCanvasPaint}), so a fully-erased region is byte-identical to
 * one never painted.
 *
 * Legacy: pre-island files persisted ONE page-anchored layer spanning
 * x ∈ [0, 32]. Loaders convert it with {@link legacyCanvasPaintToIslands} —
 * an exact texel-lattice copy into tiles, dropping the empty ones.
 *
 * Masking: visible vector objects can OCCLUDE the canvas (see
 * {@link createCanvasPaintMask}) — a dab's texels are dropped wherever a
 * visible SVGObject's ink would cover them. The mask is resolved lazily per
 * texel and cached per island for the stroke, so a stroke start costs
 * nothing and each texel is classified at most once.
 */

import {
  BlendMode, CanvasPaintIsland, CompositionState, ImagePaintOverlay, RGBColor, SVGObject,
} from './types';
import {
  blurImagePaintOverlay, clonePaintOverlay, eraseImagePaintOverlay, paintOverlayHasInk,
  stampImagePaintOverlay,
} from './imagePaintOverlay';
import { hiddenGroupIds } from './compositionOps';
import { pointInClosedPath, svgPathHitsPoint } from './compositionPathHitTest';
import { svgIsFilled } from './svgPathBuilder';
import { DOM_PX_PER_CELL, svgStrokeWidthCells } from './svgStroke';

/** The canonical composition box the LEGACY single layer always spanned
 *  horizontally — still the anchor for converting old files. */
export const CANVAS_PAINT_WIDTH_CELLS = 32;

/** Texel density. Double the per-object overlays' 4/cell: the canvas is the
 *  page itself, so a wash across it survives more zoom than a sticker-sized
 *  bbox layer. Shared by every island — one global lattice. */
export const CANVAS_PAINT_TEXELS_PER_CELL = 8;

/** World cells per island side. 16 cells = 128×128 texels = 64 KB per tile:
 *  fine enough that a stray dab in empty space doesn't cost much, coarse
 *  enough that a page-sized wash is a handful of textures, not hundreds. */
export const CANVAS_ISLAND_CELLS = 16;

/** Texels per island side (square). */
export const CANVAS_ISLAND_TEXELS = CANVAS_ISLAND_CELLS * CANVAS_PAINT_TEXELS_PER_CELL;

const ISLAND_BYTES = CANVAS_ISLAND_TEXELS * CANVAS_ISLAND_TEXELS * 4;

/**
 * Total canvas-paint budget across all islands, in rgba bytes. 32 MiB = 512
 * tiles ≈ 36 page-areas of solid coverage — far beyond any real drawing,
 * but a hard wall against runaway allocation on a memory-constrained device
 * (each committed byte is mirrored by a GL texture byte, and touched tiles
 * are cloned per stroke for undo). When a stroke would allocate past it,
 * existing islands still take paint; new tiles just stop appearing.
 */
export const CANVAS_PAINT_MAX_BYTES = 32 * 1024 * 1024;

/** Rows guard for degenerate LEGACY aspect ratios (kept for old-file
 *  conversion; island tiles are always square). */
const CANVAS_PAINT_MIN_ROWS = CANVAS_PAINT_TEXELS_PER_CELL;
const CANVAS_PAINT_MAX_ROWS = 4096;

/** A fresh transparent LEGACY page layer for a page `heightCells` tall —
 *  kept only so tests and converters can build pre-island layers. */
export function createCanvasPaint(heightCells: number): ImagePaintOverlay {
  const cols = CANVAS_PAINT_WIDTH_CELLS * CANVAS_PAINT_TEXELS_PER_CELL;
  const rows = Math.max(
    CANVAS_PAINT_MIN_ROWS,
    Math.min(CANVAS_PAINT_MAX_ROWS, Math.round(heightCells * CANVAS_PAINT_TEXELS_PER_CELL)),
  );
  return { cols, rows, rgba: new Uint8Array(cols * rows * 4), blend: 'normal' };
}

/** The world-cell height a LEGACY layer covers — texels are square, so it is
 *  derivable from the grid alone and was never persisted separately. */
export function canvasPaintHeightCells(layer: Pick<ImagePaintOverlay, 'cols' | 'rows'>): number {
  return (CANVAS_PAINT_WIDTH_CELLS * layer.rows) / layer.cols;
}

// ── Island geometry ─────────────────────────────────────────────────

/** The world-cell height an island covers (texels are square). */
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

/** A fresh transparent tile island at tile coords (tx, ty). */
function createIslandAt(tx: number, ty: number): CanvasPaintIsland {
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

// ── Legacy conversion / normalization ───────────────────────────────

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
 *  at each tile texel's world center. For a legacy page layer (same density,
 *  origin-anchored) the lattices coincide, so this is an exact byte copy.
 *  Tiles that end up fully transparent are dropped; tiles are merged into
 *  `into` (keyed by origin) so several source islands can retile together. */
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
 * Bring a loaded island list onto the allocation invariants: conforming
 * islands pass through (empty ones dropped), anything else — a legacy layer
 * wrapped as one big island, or a hand-edited save — is re-tiled onto the
 * grid. Every loader funnels through here so the stamp path can rely on the
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

/** Convert the pre-island single page layer (x ∈ [0, 32], height from the
 *  texel grid) into tile islands — an exact lattice copy, empty tiles
 *  dropped. Both persistence readers route old saves through this. */
export function legacyCanvasPaintToIslands(
  overlay: ImagePaintOverlay,
): CanvasPaintIsland[] | undefined {
  return normalizeCanvasPaintIslands([
    { x: 0, y: 0, widthCells: CANVAS_PAINT_WIDTH_CELLS, overlay },
  ]);
}

// ── Occlusion mask ──────────────────────────────────────────────────

interface MaskCandidate {
  svg: SVGObject;
  /** Object AABB inflated by the stroke half-width, world cells. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  strokeHalfSq: number;
  filled: boolean;
}

/** Per-stroke occlusion oracle: which canvas texels visible vector ink
 *  covers. `blockedAt` is the raw geometric test; `forIsland` returns a
 *  per-texel view memoized for the stroke's lifetime (the scene cannot
 *  change mid-stroke), one cache per island. */
export interface CanvasPaintMask {
  blockedAt(cellX: number, cellY: number): boolean;
  /** A memoized blocked-test for one island's texels: `i` is the texel's
   *  byte offset into that island's rgba, (cx, cy) its WORLD-cell center. */
  forIsland(key: string, texelCount: number): (i: number, cx: number, cy: number) => boolean;
}

/**
 * Build the stroke's occlusion mask from every VISIBLE vector object.
 * Filled outlines block their interior (nonzero winding, holes respected);
 * every object blocks within half its stroke width of its segments. Hidden
 * objects / hidden-group members and `isMask` clip shapes (invisible by
 * definition) are skipped; opacity is ignored per the masking contract.
 */
export function createCanvasPaintMask(state: CompositionState): CanvasPaintMask {
  const hidden = hiddenGroupIds(state.groups);
  const candidates: MaskCandidate[] = [];
  for (const svg of state.svgObjects) {
    if (svg.hidden || (svg.groupId && hidden.has(svg.groupId))) continue;
    if (svg.isMask) continue;
    const strokeHalf = svgStrokeWidthCells(svg, state.strokeScale, DOM_PX_PER_CELL) / 2;
    candidates.push({
      svg,
      minX: svg.cellX - strokeHalf,
      minY: svg.cellY - strokeHalf,
      maxX: svg.cellX + svg.cellWidth + strokeHalf,
      maxY: svg.cellY + svg.cellHeight + strokeHalf,
      strokeHalfSq: strokeHalf * strokeHalf,
      filled: svgIsFilled(svg),
    });
  }

  const blockedAt = (px: number, py: number): boolean => {
    for (const c of candidates) {
      if (px < c.minX || px > c.maxX || py < c.minY || py > c.maxY) continue;
      // Tiled patterns store one origin tile rendered as a grid of copies —
      // wrap the point into that tile so every copy occludes (the same wrap
      // brushHitsSegments' whole-object branch uses).
      let wx = px;
      let wy = py;
      if (c.svg.tileMode === 'repeat') {
        const tw = c.svg.tileWidthL0 ?? c.svg.cellWidth;
        const th = c.svg.tileHeightL0 ?? c.svg.cellHeight;
        if (tw > 0 && th > 0) {
          const ax = c.svg.cellX + (c.svg.tileOffsetXL0 ?? 0);
          const ay = c.svg.cellY + (c.svg.tileOffsetYL0 ?? 0);
          wx = ax + (((px - ax) % tw) + tw) % tw;
          wy = ay + (((py - ay) % th) + th) % th;
        }
      }
      if (c.filled && pointInClosedPath(c.svg.segments, wx, wy)) return true;
      const subs = c.svg.subpaths;
      if (Array.isArray(subs)) {
        for (const sub of subs) {
          if (sub.fill && pointInClosedPath(sub.segments, wx, wy)) return true;
        }
      }
      if (c.strokeHalfSq > 0 && svgPathHitsPoint(c.svg, wx, wy, c.strokeHalfSq)) return true;
    }
    return false;
  };

  // 0 = unresolved, 1 = blocked, 2 = free — one byte per texel per island,
  // resolved on first touch so a stroke start costs nothing and repeat dabs
  // are O(1).
  const caches = new Map<string, Uint8Array>();
  return {
    blockedAt,
    forIsland(key: string, texelCount: number) {
      let cache = caches.get(key);
      if (!cache || cache.length !== texelCount) {
        cache = new Uint8Array(texelCount);
        caches.set(key, cache);
      }
      const c = cache;
      return (i: number, cx: number, cy: number): boolean => {
        const t = i >> 2;
        const v = c[t];
        if (v !== 0) return v === 1;
        const b = blockedAt(cx, cy);
        c[t] = b ? 1 : 2;
        return b;
      };
    },
  };
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
 *  for their working copies) plus fresh allocations. What the GL preview
 *  renders mid-stroke. */
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
 *  `normal`) keeps the plain source-over deposit. `beneath` is what shows
 *  through still-transparent texels — see imagePaintOverlay's StampBlend;
 *  the per-stroke unary scratch is managed by the working set. */
export interface CanvasStampBlend {
  mode: BlendMode;
  beneath?: RGBColor;
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
 * Stamp one canvas dab at world-cell (cellX, cellY) into the stroke's
 * working set: the shared overlay stamp (same falloff / source-over rules as
 * every other brush surface) run against every tile the disc touches —
 * cloning committed tiles on first touch and ALLOCATING fresh ones where the
 * dab lands on nothing, which is what makes the canvas effectively infinite.
 * With `mask`, texels visible vector ink occludes are dropped.
 *
 * Returns the keys of islands whose bytes changed (empty = the dab landed on
 * nothing paintable), so callers can re-upload exactly those textures.
 *
 * `blend` makes the dab destructive — it mutates the color already under the
 * brush instead of laying the brush color over it. The canvas layer is drawn
 * source-over under every scene object, so a blend mode has no compositing
 * route here and this is the only place it can act; see the
 * destructive-blending section of imagePaintOverlay.ts.
 */
export function stampCanvasPaint(
  working: CanvasPaintWorking,
  cellX: number,
  cellY: number,
  radiusCells: number,
  color: RGBColor,
  alpha: number,
  mask?: CanvasPaintMask,
  blend?: CanvasStampBlend,
): string[] {
  const radius = effectiveRadius(radiusCells);
  const changed: string[] = [];
  forEachIslandUnderDab(working, cellX, cellY, radius, true, (island, key) => {
    const { cols, rows } = island.overlay;
    let unaryDone: Uint8Array | undefined;
    if (blend && isUnaryMode(blend.mode)) {
      unaryDone = working.unaryDone.get(key);
      if (!unaryDone) {
        unaryDone = new Uint8Array(cols * rows);
        working.unaryDone.set(key, unaryDone);
      }
    }
    const blocked = mask ? mask.forIsland(key, cols * rows) : undefined;
    if (stampImagePaintOverlay(
      island.overlay,
      island.widthCells,
      islandHeightCells(island),
      cellX - island.x,
      cellY - island.y,
      radius,
      color,
      alpha,
      // The overlay walks in ISLAND-local cells; the mask thinks in world
      // cells — shift the texel center back out.
      blocked ? (i, cx, cy) => blocked(i, island.x + cx, island.y + cy) : undefined,
      blend ? { mode: blend.mode, beneath: blend.beneath, unaryDone } : undefined,
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
