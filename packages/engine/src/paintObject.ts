/**
 * {@link PaintObject} helpers: the frame mapping between world space and an
 * island's tile space, constructors, and the island merge (flatten).
 *
 * Kept free of compositionOps imports on purpose — compositionOps registers
 * the paint SCENE_ADAPTER against these helpers, so this module must sit
 * below it in the import graph. The merge UNDO ENTRY builder (which needs
 * compositionOps) lives beside the svg one in compositionMergeObjects.ts.
 */

import { CanvasPaintIsland, PaintObject } from './types';
import {
  CANVAS_ISLAND_CELLS,
  createIslandAt,
  islandHeightCells,
  paintTileAlphaAt,
  paintTilesContentRect,
} from './canvasPaint';

// ── Id minting ──────────────────────────────────────────────────────
// The 'pnt_' namespace is load-bearing: SCENE_ADAPTERS and persistence
// resolve node kind by id prefix. Counter + timestamp keeps ids unique
// within and across sessions (the mintNodeId pattern).

let mintCounter = 0;

export function mintPaintObjectId(): string {
  return `pnt_${Date.now().toString(36)}_${(mintCounter++).toString(36)}`;
}

// ── World ↔ tile-space frame ────────────────────────────────────────

/**
 * The inverse map from world space into a paint island's tile space, plus
 * the scale factor for carrying a world brush radius over. The paint twin
 * of the app brush's `bboxLocalFrame`, engine-side because hit-testing and
 * merging need it too.
 *
 * Mirrors the bbox-node render recipe (orientedInnerStyle): outer bbox at
 * `cell*`, inner content frame (dims swapped for 90/270) centered in it,
 * then — outermost first — rotate(angleDeg), rotate(rotation), mirror, all
 * about the shared center. The island's contentRect maps onto that inner
 * frame, so `toTile` finishes with the inner-frame → contentRect stretch.
 */
export interface PaintLocalFrame {
  toTile(cellX: number, cellY: number): [number, number];
  /** Mean world→tile stretch — multiply a world brush radius by this to
   *  keep the dab's tile-space footprint matching what's on screen. 1 for
   *  an untransformed island. */
  radiusScale: number;
  /** Conservative cull radius about the bbox center: half the bbox
   *  diagonal, covering the content under any rotation. */
  cullRadius: number;
}

export function paintLocalFrame(p: PaintObject): PaintLocalFrame {
  const w = p.cellWidth;
  const h = p.cellHeight;
  const rot = p.rotation ?? 0;
  const swapped = rot === 90 || rot === 270;
  const iw = swapped ? h : w;
  const ih = swapped ? w : h;
  const cx = p.cellX + w / 2;
  const cy = p.cellY + h / 2;
  // Inverse of A = R(angleDeg)·R(rotation)·M about the center: rotate by the
  // negated total angle, then un-mirror (M is its own inverse).
  const theta = (-((p.angleDeg ?? 0) + rot) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const mx = p.mirrorH ? -1 : 1;
  const my = p.mirrorV ? -1 : 1;
  const sx = iw > 0 ? p.contentW / iw : 1;
  const sy = ih > 0 ? p.contentH / ih : 1;
  const toTile = (px: number, py: number): [number, number] => {
    const dx = px - cx;
    const dy = py - cy;
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    return [
      p.contentX + (iw / 2 + rx * mx) * sx,
      p.contentY + (ih / 2 + ry * my) * sy,
    ];
  };
  return { toTile, radiusScale: (sx + sy) / 2, cullRadius: Math.hypot(w, h) / 2 };
}

/**
 * True while the island still sits in its creation frame — tile space ==
 * world space (bbox == contentRect verbatim, no rotation/mirror/angle, not
 * group-transformed). The gate for continuing a paint session into it:
 * in-frame islands take strokes with plain world coordinates and can grow
 * their bbox as fresh ink lands; anything transformed starts a new island
 * instead (any transform requires leaving the paint tool group, which ends
 * the session anyway — this predicate is the reconcile-time check).
 */
export function paintObjectIsUntransformed(p: PaintObject): boolean {
  return !p.rotation && !p.angleDeg && !p.mirrorH && !p.mirrorV && !p.groupId
    && p.cellX === p.contentX && p.cellY === p.contentY
    && p.cellWidth === p.contentW && p.cellHeight === p.contentH;
}

/**
 * Precise hit refinement for the scene walk: does the island have ink at
 * (or within `toleranceCells` of) the query point? The point arrives in
 * the node's angleDeg-UNROTATED frame — `findSceneObjectAtCell` rotates
 * the query back before every per-node test — so the frame here strips
 * `angleDeg` and maps only the discrete rotation / mirror / stretch. A
 * 5-point cross at the tolerance offset keeps thin strokes grabbable.
 */
export function paintObjectAlphaHitTest(
  p: PaintObject,
  hx: number,
  hy: number,
  toleranceCells: number,
): boolean {
  const frame = paintLocalFrame(p.angleDeg ? { ...p, angleDeg: undefined } : p);
  const t = Math.max(0, toleranceCells);
  const probes: ReadonlyArray<readonly [number, number]> = [
    [hx, hy], [hx - t, hy], [hx + t, hy], [hx, hy - t], [hx, hy + t],
  ];
  for (const [px, py] of probes) {
    const [tx, ty] = frame.toTile(px, py);
    if (paintTileAlphaAt(p.tiles, tx, ty) > 0) return true;
  }
  return false;
}

// ── Construction ────────────────────────────────────────────────────

/**
 * A fresh island from a committed world-space tile set (a session's first
 * stroke): 1:1, bbox == contentRect == the tiles' ink bounds. Null when the
 * tiles hold no ink — the caller commits nothing.
 */
export function createPaintObjectFromTiles(
  id: string,
  tiles: CanvasPaintIsland[] | undefined,
): PaintObject | null {
  if (!tiles || tiles.length === 0) return null;
  const rect = paintTilesContentRect(tiles);
  if (!rect || !(rect.w > 0) || !(rect.h > 0)) return null;
  return {
    id,
    cellX: rect.x, cellY: rect.y, cellWidth: rect.w, cellHeight: rect.h,
    tiles,
    contentX: rect.x, contentY: rect.y, contentW: rect.w, contentH: rect.h,
  };
}

// ── Merge (flatten) ─────────────────────────────────────────────────

/** True when these islands can be flattened into one: ≥2 of them, each with
 *  content. Nothing is asked of their transforms — rotated/scaled sources
 *  resample in place. */
export function canMergePaintObjects(items: readonly PaintObject[]): boolean {
  if (items.length < 2) return false;
  return items.every((p) => p.tiles.length > 0);
}

/** A source's world-space AABB: its content frame under the full transform
 *  (rotation swaps the frame; angleDeg needs the rotated-rect bound). */
function sourceWorldAabb(p: PaintObject): { minX: number; minY: number; maxX: number; maxY: number } {
  const w = p.cellWidth;
  const h = p.cellHeight;
  const rot = p.rotation ?? 0;
  const swapped = rot === 90 || rot === 270;
  const iw = swapped ? h : w;
  const ih = swapped ? w : h;
  const theta = (((p.angleDeg ?? 0) + rot) * Math.PI) / 180;
  const c = Math.abs(Math.cos(theta));
  const s = Math.abs(Math.sin(theta));
  const halfW = (iw * c + ih * s) / 2;
  const halfH = (iw * s + ih * c) / 2;
  const cx = p.cellX + w / 2;
  const cy = p.cellY + h / 2;
  return { minX: cx - halfW, minY: cy - halfH, maxX: cx + halfW, maxY: cy + halfH };
}

/**
 * Flatten ≥2 paint islands (given BACK→FRONT) into one: resample each
 * source nearest-neighbor through its transform into a fresh world-anchored
 * tile set, compositing source-over in z-order with each source's `opacity`
 * baked into texel alpha. The result is 1:1 (contentRect == bbox == ink
 * bounds), opacity 1, named after the front-most source, and leaves any
 * group (a baked resample has no pre-group local geometry to carry).
 *
 * Sparse tiles keep a merge of far-apart islands cheap in MEMORY (the gap
 * allocates nothing — destination tiles that sample no ink are dropped),
 * but note the app renders an island as one canvas spanning its content
 * rect, so a far-apart merge does produce one large, mostly-empty canvas
 * backing store. Bounded by the shared tile budget; the session "far"
 * heuristic is what keeps unmerged rects tight.
 *
 * Replaces the retiler's first-writer-wins overlap rule with true
 * source-over: islands CAN overlap now that they're z-ordered scene
 * objects, and the merged pixels must match what the screen showed.
 */
export function mergePaintObjects(
  sources: readonly PaintObject[],
  id: string,
): PaintObject | null {
  if (sources.length < 2) return null;

  const frames = sources.map(paintLocalFrame);
  const aabbs = sources.map(sourceWorldAabb);
  const alphas = sources.map((p) => Math.min(1, Math.max(0, p.opacity ?? 1)));

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of aabbs) {
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  if (!(maxX > minX) || !(maxY > minY)) return null;

  const tx0 = Math.floor(minX / CANVAS_ISLAND_CELLS);
  const tx1 = Math.floor(maxX / CANVAS_ISLAND_CELLS);
  const ty0 = Math.floor(minY / CANVAS_ISLAND_CELLS);
  const ty1 = Math.floor(maxY / CANVAS_ISLAND_CELLS);

  const tiles: CanvasPaintIsland[] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const tile = createIslandAt(tx, ty);
      const texW = tile.widthCells / tile.overlay.cols;
      // Skip destination tiles no source can reach — what keeps a
      // far-apart merge from scanning the empty gap between the blobs.
      const tileMaxX = tile.x + tile.widthCells;
      const tileMaxY = tile.y + islandHeightCells(tile);
      if (!aabbs.some((b) =>
        b.minX < tileMaxX && b.maxX > tile.x && b.minY < tileMaxY && b.maxY > tile.y,
      )) continue;

      const { cols, rows, rgba } = tile.overlay;
      let any = false;
      for (let r = 0; r < rows; r++) {
        const wy = tile.y + (r + 0.5) * texW;
        for (let c = 0; c < cols; c++) {
          const wx = tile.x + (c + 0.5) * texW;
          // Composite the sources back→front at this texel, straight alpha.
          let outR = 0, outG = 0, outB = 0, outA = 0;
          for (let s = 0; s < sources.length; s++) {
            const b = aabbs[s];
            if (wx < b.minX || wx > b.maxX || wy < b.minY || wy > b.maxY) continue;
            const [px, py] = frames[s].toTile(wx, wy);
            // Nearest-neighbor sample from the source's own tiles.
            let sr = 0, sg = 0, sb = 0, sa = 0;
            for (const isl of sources[s].tiles) {
              if (px < isl.x || px >= isl.x + isl.widthCells || py < isl.y) continue;
              const ihCells = islandHeightCells(isl);
              if (py >= isl.y + ihCells) continue;
              const sc = Math.min(isl.overlay.cols - 1, Math.max(0,
                Math.floor(((px - isl.x) / isl.widthCells) * isl.overlay.cols)));
              const srow = Math.min(isl.overlay.rows - 1, Math.max(0,
                Math.floor(((py - isl.y) / ihCells) * isl.overlay.rows)));
              const si = (srow * isl.overlay.cols + sc) * 4;
              sr = isl.overlay.rgba[si];
              sg = isl.overlay.rgba[si + 1];
              sb = isl.overlay.rgba[si + 2];
              sa = isl.overlay.rgba[si + 3];
              break;
            }
            if (sa === 0) continue;
            const a = (sa / 255) * alphas[s];
            const na = a + outA * (1 - a);
            if (na <= 0) continue;
            outR = (sr * a + outR * outA * (1 - a)) / na;
            outG = (sg * a + outG * outA * (1 - a)) / na;
            outB = (sb * a + outB * outA * (1 - a)) / na;
            outA = na;
          }
          if (outA <= 0) continue;
          const di = (r * cols + c) * 4;
          rgba[di] = Math.round(outR);
          rgba[di + 1] = Math.round(outG);
          rgba[di + 2] = Math.round(outB);
          rgba[di + 3] = Math.round(outA * 255);
          any = true;
        }
      }
      if (any) tiles.push(tile);
    }
  }

  const merged = createPaintObjectFromTiles(id, tiles);
  if (!merged) return null;
  const top = sources[sources.length - 1];
  return top.name ? { ...merged, name: top.name } : merged;
}
