/**
 * The paint tool's CANVAS raster layer ({@link CompositionState.canvasPaint}):
 * one RGBA bitmap covering the page rect, stamped wherever a paint dab lands
 * on no object. Rendered by the GL pass right after the grid — under every
 * scene object — and deliberately absent from `sceneOrder`, so it never
 * appears in the Scene Outline.
 *
 * The layer reuses {@link ImagePaintOverlay} (same stamp math, same PNG
 * bridge, same persistence converters) but is PAGE-anchored, not
 * bbox-anchored: it always spans x ∈ [0, 32] world cells, and its covered
 * height follows from the texel grid being square — 32 · rows / cols cells
 * (see {@link canvasPaintHeightCells}) — so nothing beyond cols × rows needs
 * persisting.
 *
 * Masking: visible vector objects OCCLUDE the canvas. A dab's texels are
 * dropped wherever a visible SVGObject's ink would cover them — inside a
 * filled outline (fill state respected via svgIsFilled), or within half the
 * object's stroke width of any segment (stroke widths respected via
 * svgStrokeWidthCells) — leaving an unpainted silhouette. Opacity /
 * transparency is deliberately ignored (a 10%-opacity shape masks fully),
 * as are hidden objects and members of hidden groups (they mask nothing).
 * The mask is resolved lazily per texel and cached for the stroke, so a
 * stroke start costs nothing and each texel is classified at most once.
 */

import { CompositionState, ImagePaintOverlay, RGBColor, SVGObject } from './types';
import { eraseImagePaintOverlay, stampImagePaintOverlay } from './imagePaintOverlay';
import { hiddenGroupIds } from './compositionOps';
import { pointInClosedPath, svgPathHitsPoint } from './compositionPathHitTest';
import { svgIsFilled } from './svgPathBuilder';
import { DOM_PX_PER_CELL, svgStrokeWidthCells } from './svgStroke';

/** The canonical composition box the layer always spans horizontally. */
export const CANVAS_PAINT_WIDTH_CELLS = 32;

/** Texel density. Double the per-object overlays' 4/cell: the canvas is the
 *  page itself, so a wash across it survives more zoom than a sticker-sized
 *  bbox layer — while a square page still stays a 256×256 (256 KB) bitmap. */
export const CANVAS_PAINT_TEXELS_PER_CELL = 8;

/** Rows guard for degenerate aspect ratios (a 1 : 16 "tapestry" page still
 *  gets a sane bitmap; nothing can allocate unboundedly). */
const CANVAS_PAINT_MIN_ROWS = CANVAS_PAINT_TEXELS_PER_CELL;
const CANVAS_PAINT_MAX_ROWS = 4096;

/** A fresh transparent canvas layer for a page `heightCells` tall. */
export function createCanvasPaint(heightCells: number): ImagePaintOverlay {
  const cols = CANVAS_PAINT_WIDTH_CELLS * CANVAS_PAINT_TEXELS_PER_CELL;
  const rows = Math.max(
    CANVAS_PAINT_MIN_ROWS,
    Math.min(CANVAS_PAINT_MAX_ROWS, Math.round(heightCells * CANVAS_PAINT_TEXELS_PER_CELL)),
  );
  return { cols, rows, rgba: new Uint8Array(cols * rows * 4), blend: 'normal' };
}

/** The world-cell height the layer covers — texels are square, so it is
 *  derivable from the grid alone and never persisted separately. */
export function canvasPaintHeightCells(layer: Pick<ImagePaintOverlay, 'cols' | 'rows'>): number {
  return (CANVAS_PAINT_WIDTH_CELLS * layer.rows) / layer.cols;
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
 *  covers. `blockedAt` is the raw geometric test; `blockedTexel` memoizes it
 *  per texel for the stroke's lifetime (the scene cannot change mid-stroke). */
export interface CanvasPaintMask {
  blockedAt(cellX: number, cellY: number): boolean;
  /** `i` is the texel's byte offset into the layer's rgba — the offset
   *  {@link stampImagePaintOverlay} hands its `blocked` callback. */
  blockedTexel(i: number, cellX: number, cellY: number): boolean;
}

/**
 * Build the stroke's occlusion mask from every VISIBLE vector object.
 * Filled outlines block their interior (nonzero winding, holes respected);
 * every object blocks within half its stroke width of its segments. Hidden
 * objects / hidden-group members and `isMask` clip shapes (invisible by
 * definition) are skipped; opacity is ignored per the masking contract.
 */
export function createCanvasPaintMask(
  state: CompositionState,
  layer: Pick<ImagePaintOverlay, 'cols' | 'rows'>,
): CanvasPaintMask {
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

  // 0 = unresolved, 1 = blocked, 2 = free — one byte per texel, resolved on
  // first touch so a stroke start costs nothing and repeat dabs are O(1).
  const cache = new Uint8Array(layer.cols * layer.rows);
  return {
    blockedAt,
    blockedTexel(i: number, cellX: number, cellY: number): boolean {
      const t = i >> 2;
      const v = cache[t];
      if (v !== 0) return v === 1;
      const b = blockedAt(cellX, cellY);
      cache[t] = b ? 1 : 2;
      return b;
    },
  };
}

// ── Brush ───────────────────────────────────────────────────────────

/** The brush radius floored to reach at least one texel center, so a dab at
 *  a deeply subdivided grid level (radius ≪ one texel) still deposits ink
 *  instead of silently painting nothing. */
function effectiveRadius(layer: Pick<ImagePaintOverlay, 'cols'>, radiusCells: number): number {
  const texelCells = CANVAS_PAINT_WIDTH_CELLS / layer.cols;
  return Math.max(radiusCells, texelCells * 0.75);
}

/** Stamp one canvas dab at world-cell (cellX, cellY): the shared overlay
 *  stamp (same falloff / source-over rules as every other brush surface),
 *  with `mask` dropping the texels visible vector ink occludes. Returns true
 *  when any byte changed, so callers can skip preview refreshes. */
export function stampCanvasPaint(
  layer: ImagePaintOverlay,
  cellX: number,
  cellY: number,
  radiusCells: number,
  color: RGBColor,
  alpha: number,
  mask?: CanvasPaintMask,
): boolean {
  return stampImagePaintOverlay(
    layer,
    CANVAS_PAINT_WIDTH_CELLS,
    canvasPaintHeightCells(layer),
    cellX,
    cellY,
    effectiveRadius(layer, radiusCells),
    color,
    alpha,
    mask ? (i, cx, cy) => mask.blockedTexel(i, cx, cy) : undefined,
  );
}

/** Erase one canvas dab — the deposit rule in reverse, unmasked (lifting
 *  paint back off is fine anywhere, occluded or not). */
export function eraseCanvasPaint(
  layer: ImagePaintOverlay,
  cellX: number,
  cellY: number,
  radiusCells: number,
  strength: number,
): boolean {
  return eraseImagePaintOverlay(
    layer,
    CANVAS_PAINT_WIDTH_CELLS,
    canvasPaintHeightCells(layer),
    cellX,
    cellY,
    effectiveRadius(layer, radiusCells),
    strength,
  );
}
