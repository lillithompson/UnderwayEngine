import { RGBColor, SVGObject } from './types';

/**
 * Sparse per-instance segment-color overrides for tile-mode SVG objects.
 *
 * A repeating-pattern SVG object stores only ONE tile's geometry in
 * `segments`/`subpaths`. To let the user recolor an individual repeated copy
 * (and individual segments within that copy) without materializing the whole
 * pattern into a giant flat SVG, we store a sparse map:
 *
 *     packedKey  ->  RGBColor
 *
 * where `packedKey` encodes `(tileCol, tileRow, flatSegmentIndex)`:
 *   - `tileCol`/`tileRow` are the ANCHOR-RELATIVE absolute grid indices of the
 *     tile instance: `col = floor((x - anchorX) / tileW)` where the anchor is
 *     `cellX + tileOffset`. Anchor-relative (not region-relative) so the index
 *     of a given physical copy is stable across region resizes (which preserve
 *     the anchor by adjusting `tileOffset`). Indices may be negative; `packKey`
 *     biases them into the unsigned key range.
 *   - `flatSegmentIndex` is the index into the flat ordering produced by
 *     `flattenSVGSegmentsWithColor` (subpaths-when-present, else `segments`).
 *
 * Absent key ⇒ that segment renders at its base color. Memory scales with the
 * number of PAINTED (instance, segment) pairs, not with region size.
 *
 * This module is pure (no DOM/GL) and is the single source of truth for the
 * tile-index math, shared by the brush, the live overlay renderer, and SVG
 * export so the three can never drift.
 */

export type SegmentOverrides = Map<number, RGBColor>;

// Key packing: col (10 bits) | row (10 bits) | segIdx (12 bits) → 32-bit int.
// col/row are anchor-relative grid indices, biased by COORD_BIAS so the
// supported signed range is [-512, 511]; segIdx < 4096. A pattern needing
// indices or segment counts beyond these bounds is far past the full-expand
// fallback threshold, so it never reaches the sparse path.
const COL_BITS = 10;
const ROW_BITS = 10;
const SEG_BITS = 12;
const COL_MAX = (1 << COL_BITS) - 1;
const ROW_MAX = (1 << ROW_BITS) - 1;
const SEG_MAX = (1 << SEG_BITS) - 1;
/** Added to signed col/row before packing so negatives fit the unsigned key. */
export const COORD_BIAS = 512;

/** Pack a (col, row, segIdx) triple into a single non-negative 32-bit key.
 *  col/row are anchor-relative signed grid indices. Returns null when any
 *  component is out of representable range (caller should skip — these only
 *  occur in patterns past the full-expand cap). */
export function packKey(col: number, row: number, segIdx: number): number | null {
  const c = col + COORD_BIAS;
  const r = row + COORD_BIAS;
  if (segIdx < 0 || segIdx > SEG_MAX) return null;
  if (c < 0 || c > COL_MAX || r < 0 || r > ROW_MAX) return null;
  // >>> 0 keeps the result a non-negative integer (Map keys compare by value).
  return ((c << (ROW_BITS + SEG_BITS)) | (r << SEG_BITS) | segIdx) >>> 0;
}

export function unpackKey(key: number): { col: number; row: number; segIdx: number } {
  return {
    col: ((key >>> (ROW_BITS + SEG_BITS)) & COL_MAX) - COORD_BIAS,
    row: ((key >>> SEG_BITS) & ROW_MAX) - COORD_BIAS,
    segIdx: key & SEG_MAX,
  };
}

/** Tile-grid geometry for a tiled SVG object, in L0-cell units. Mirrors the
 *  pattern layout used by the live tile bitmap and SVG export: grid lines sit
 *  at `anchor + k·tile`. Tile indices are anchor-relative (col 0's left edge is
 *  at `anchorX`), so a physical copy keeps its index across region resizes.
 *  `colMin..colMax` / `rowMin..rowMax` are the index ranges of tiles that
 *  intersect the region `[cell, cell+size]` (the visible/rendered copies). */
export interface TileGrid {
  twL0: number;
  thL0: number;
  /** Pattern-grid anchor (cellX + tileOffset) — the origin of index 0. */
  anchorX: number;
  anchorY: number;
  colMin: number;
  colMax: number;
  rowMin: number;
  rowMax: number;
}

export function svgTileGrid(obj: SVGObject): TileGrid {
  const twL0 = obj.tileWidthL0 ?? obj.cellWidth;
  const thL0 = obj.tileHeightL0 ?? obj.cellHeight;
  const anchorX = obj.cellX + (obj.tileOffsetXL0 ?? 0);
  const anchorY = obj.cellY + (obj.tileOffsetYL0 ?? 0);
  const range = (cell: number, size: number, anchor: number, t: number): [number, number] => {
    if (t <= 0) return [0, -1]; // empty
    return [Math.floor((cell - anchor) / t), Math.ceil((cell + size - anchor) / t) - 1];
  };
  const [colMin, colMax] = range(obj.cellX, obj.cellWidth, anchorX, twL0);
  const [rowMin, rowMax] = range(obj.cellY, obj.cellHeight, anchorY, thL0);
  return { twL0, thL0, anchorX, anchorY, colMin, colMax, rowMin, rowMax };
}

/** Total tile instances rendered for the region. */
export function totalInstances(obj: SVGObject): number {
  const g = svgTileGrid(obj);
  return Math.max(0, g.colMax - g.colMin + 1) * Math.max(0, g.rowMax - g.rowMin + 1);
}

/** Anchor-relative grid index of the tile containing point (px,py). NOT
 *  clamped to the region — callers needing an in-region hit must additionally
 *  check `tileInRegion`. */
export function worldToTile(obj: SVGObject, px: number, py: number): { col: number; row: number } {
  const g = svgTileGrid(obj);
  const col = g.twL0 > 0 ? Math.floor((px - g.anchorX) / g.twL0) : 0;
  const row = g.thL0 > 0 ? Math.floor((py - g.anchorY) / g.thL0) : 0;
  return { col, row };
}

export function tileInRegion(obj: SVGObject, col: number, row: number): boolean {
  const g = svgTileGrid(obj);
  return col >= g.colMin && col <= g.colMax && row >= g.rowMin && row <= g.rowMax;
}

/** World-space (L0) center of tile (col,row). Used for transform re-keying:
 *  a cell center is robustly interior so it round-trips cleanly through an
 *  exact 90°/mirror transform back into the corresponding post-transform
 *  cell. */
export function tileWorldCenter(obj: SVGObject, col: number, row: number): { x: number; y: number } {
  const g = svgTileGrid(obj);
  return { x: g.anchorX + (col + 0.5) * g.twL0, y: g.anchorY + (row + 0.5) * g.thL0 };
}

/** World-space (L0) top-left of tile (col,row). Used by the overlay renderer
 *  and export to position each painted instance. */
export function tileWorldOrigin(obj: SVGObject, col: number, row: number): { x: number; y: number } {
  const g = svgTileGrid(obj);
  return { x: g.anchorX + col * g.twL0, y: g.anchorY + row * g.thL0 };
}

/** Iterate the anchor-relative indices of every tile copy that intersects the
 *  region (the visible/rendered/exported copies). */
export function forEachVisibleTile(obj: SVGObject, fn: (col: number, row: number) => void): void {
  const g = svgTileGrid(obj);
  for (let row = g.rowMin; row <= g.rowMax; row++) {
    for (let col = g.colMin; col <= g.colMax; col++) fn(col, row);
  }
}

/** Number of distinct painted tile instances (distinct col,row pairs). */
export function countPaintedInstances(overrides: SegmentOverrides | undefined): number {
  if (!overrides || overrides.size === 0) return 0;
  const seen = new Set<number>();
  for (const key of overrides.keys()) {
    // Strip the segment bits to collapse to a per-instance id.
    seen.add(key >>> SEG_BITS);
  }
  return seen.size;
}

/** Cap before the sparse overlay stops paying off: once most of the region is
 *  painted, a single full expansion is cheaper than bitmap + dense overlay.
 *  The absolute cap bounds worst-case DOM/vector node count for a huge region
 *  that is lightly but widely painted. */
export const MAX_SPARSE_PAINTED_INSTANCES = 400;
export const FULL_EXPAND_FRACTION = 0.5;

/** True when a painted tiled object should render/export via FULL expansion
 *  (every instance materialized) rather than the sparse bitmap+overlay path.
 *  Shared by live render, thumbnail, and export so they agree. */
export function shouldFullyExpandTiles(obj: SVGObject): boolean {
  const painted = countPaintedInstances(obj.segmentOverrides);
  if (painted === 0) return false;
  if (painted > MAX_SPARSE_PAINTED_INSTANCES) return true;
  return painted > FULL_EXPAND_FRACTION * totalInstances(obj);
}

/**
 * Re-key overrides through an exact geometric transform (90° rotation or
 * mirror) applied to the object's tiles. `objBefore`/`objAfter` are the tiled
 * object before and after the transform; `transformPoint` maps an
 * old-world-space point to the corresponding new-world-space point (the SAME
 * transform the reducer applies to the segments). Each override's tile CENTER
 * is mapped, then resolved to the post-transform grid cell. Flat segment
 * index is preserved (rotate/mirror keep segment array order). Overrides whose
 * mapped center falls outside the post-transform region grid are dropped.
 */
export function remapOverrides(
  overrides: SegmentOverrides,
  objBefore: SVGObject,
  objAfter: SVGObject,
  transformPoint: (x: number, y: number) => { x: number; y: number },
): SegmentOverrides {
  const out: SegmentOverrides = new Map();
  for (const [key, color] of overrides) {
    const { col, row, segIdx } = unpackKey(key);
    const c = tileWorldCenter(objBefore, col, row);
    const p = transformPoint(c.x, c.y);
    const t = worldToTile(objAfter, p.x, p.y);
    if (!tileInRegion(objAfter, t.col, t.row)) continue;
    const nk = packKey(t.col, t.row, segIdx);
    if (nk != null) out.set(nk, color);
  }
  return out;
}

/** Deep-copy overrides (RGBColor values are immutable, so the keys/values can
 *  be shared, but the Map itself must be cloned to avoid aliasing). */
export function cloneOverrides(overrides: SegmentOverrides | undefined): SegmentOverrides | undefined {
  if (!overrides) return undefined;
  return new Map(overrides);
}
