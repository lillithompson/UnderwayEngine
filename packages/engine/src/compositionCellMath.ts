import { CELL_COUNTS, GridLevel, MAX_LAYER_LEVEL } from './types';

/** A figure's native footprint in L0 cells: resolution × 4 recovers the
 *  figure's intrinsic widthL0 / heightL0 (a 2×2-resolution figure is 8×8 L0).
 *  Used for default placement size and for pattern tile dimensions. */
export function figureSizeNative(resX: number, resY: number): { cellWidth: number; cellHeight: number } {
  return { cellWidth: resX * 4, cellHeight: resY * 4 };
}

/**
 * Snap step in L0 units at the given composition grid level. The level is
 * an integer (may be negative or exceed 6 — the composition snap grid is
 * unbounded). step = 2^level, so L0 → 1, L2 → 4, L−1 → 0.5.
 */
export function compSnapStep(level: number): number {
  return Math.pow(2, level);
}

/**
 * Project a composition grid level onto the discrete layer-level range
 * `[0, MAX_LAYER_LEVEL]`. Used when the comp snap level needs to be
 * converted to a baked-layer resolution. Critical: clamps negative values
 * to 0 so they don't underflow into the 3-bit `placementLevel` packing
 * (`-1 & 0x07 = 7` would alias the "absent" sentinel).
 */
export function clampToLayerLevel(level: number): GridLevel {
  return Math.max(0, Math.min(MAX_LAYER_LEVEL, level)) as GridLevel;
}

/**
 * Round-snap a screen click to the nearest grid intersection at the given
 * grid level. This is the right snap for *vertex placement* (line tool)
 * because the click should land on the closest gridline, not on the
 * top-left of the surrounding cell. For figure placement use
 * `screenToContainingCompCell` instead — it floor-snaps to the cell
 * under the cursor.
 */
export function screenToNearestGridIntersection(
  screenX: number,
  screenY: number,
  viewport: { width: number; height: number },
  camera: { offsetX: number; offsetY: number; zoom: number },
  gridLevel: number = 0,
): { cellX: number; cellY: number } {
  const vw = viewport.width;
  const vh = viewport.height;
  const offsetU = camera.offsetX / vw;
  const offsetV = camera.offsetY / vw;

  const uvX = (screenX / vw - 0.5) / camera.zoom - offsetU + 0.5;
  const uvY = ((screenY / vh - 0.5) * vh / vw) / camera.zoom - offsetV + 0.5;

  const cellCount = 32;
  const rawX = uvX * cellCount;
  const rawY = uvY * cellCount;

  const step = compSnapStep(gridLevel);
  const cellX = Math.round(rawX / step) * step;
  const cellY = Math.round(rawY / step) * step;

  return { cellX, cellY };
}

/**
 * Convert screen coordinates to the top-left of the cell that *contains* the
 * touch point, snapped to the active grid level. Unlike a nearest-gridline
 * snap, this floors so the result always names the cell under the user's
 * finger. Returns the snap step alongside the coordinates so callers can
 * compute the inclusive far edge as `cellX + step`.
 */
export function screenToContainingCompCell(
  screenX: number,
  screenY: number,
  viewport: { width: number; height: number },
  camera: { offsetX: number; offsetY: number; zoom: number },
  gridLevel: number = 0,
): { cellX: number; cellY: number; step: number } {
  const vw = viewport.width;
  const vh = viewport.height;
  const offsetU = camera.offsetX / vw;
  const offsetV = camera.offsetY / vw;

  const uvX = (screenX / vw - 0.5) / camera.zoom - offsetU + 0.5;
  const uvY = ((screenY / vh - 0.5) * vh / vw) / camera.zoom - offsetV + 0.5;

  const cellCount = 32;
  const rawX = uvX * cellCount;
  const rawY = uvY * cellCount;

  const step = compSnapStep(gridLevel);
  const cellX = Math.floor(rawX / step) * step;
  const cellY = Math.floor(rawY / step) * step;

  return { cellX, cellY, step };
}

/**
 * Snap a figure-drag delta so the bbox's **leading edge** in the direction of
 * motion lands on the active grid. `dirX`/`dirY` are the caller's committed
 * per-axis directions (1 = forward, -1 = backward, 0 = uncommitted). The
 * caller (CompositionCanvas) maintains them with a frame-motion threshold
 * so touch jitter on an idle axis can't flip the direction.
 *
 * Forward direction snaps the trailing-to-leading edge (`maxX`/`maxY`),
 * backward snaps the leading-to-trailing edge (`minX`/`minY`), and the
 * uncommitted axis falls back to (`minX`, `minY`) — the top-left default
 * that keeps fractional-anchor realignment working for first-tick drags. **Direction is NOT inferred from `sign(rawDx/rawDy)`** — a tiny
 * `rawDy` from cursor jitter would otherwise flip the snap target across the
 * cell every frame.
 *
 * The cursor position bounds the snap target so the object can never land in
 * a cell the cursor isn't in: for a small object whose leading edge sits
 * just shy of a grid line, raw `Math.round` would otherwise push it into the
 * neighboring cell. The clamp pulls the target back to the cursor's cell
 * wall (in the motion's direction) when that happens.
 *
 * Caller must pass the *original* drag-start bbox (or the rebased bbox after
 * a direction flip — see `CompositionCanvas`'s move handler). The result is
 * an absolute snapped delta from that bbox to where it should sit now.
 *
 * Pulls fractional anchors onto the grid as a side effect, which is what
 * realigns groups whose world coords drifted during a fractional scale.
 *
 * `stepX` and `stepY` may differ — this is how solo H/V line drags get a
 * sub-grid snap on the perpendicular axis. For zero-width or zero-height
 * bboxes (H/V lines), leading-edge selection collapses to a single Y or X
 * coordinate and the math behaves identically on that axis.
 */
export function computeMoveSnapDelta(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  cursorX: number,
  cursorY: number,
  rawDx: number,
  rawDy: number,
  stepX: number,
  stepY: number,
  dirX: number,
  dirY: number,
): { dx: number; dy: number } {
  const anchorX = dirX > 0 ? bbox.maxX : bbox.minX;
  const anchorY = dirY > 0 ? bbox.maxY : bbox.minY;
  let targetX = Math.round((anchorX + rawDx) / stepX) * stepX;
  let targetY = Math.round((anchorY + rawDy) / stepY) * stepY;
  if (dirX > 0 && targetX < cursorX) targetX = Math.ceil(cursorX / stepX) * stepX;
  else if (dirX < 0 && targetX > cursorX) targetX = Math.floor(cursorX / stepX) * stepX;
  if (dirY > 0 && targetY < cursorY) targetY = Math.ceil(cursorY / stepY) * stepY;
  else if (dirY < 0 && targetY > cursorY) targetY = Math.floor(cursorY / stepY) * stepY;
  return {
    dx: targetX - anchorX,
    dy: targetY - anchorY,
  };
}

/**
 * Pick the largest grid level (≤ preferredLevel) at which a `cellW × cellH`
 * selection still fits within the 32×32 L0 file budget. Returns L0 as the
 * unconditional floor — any selection with both dims ≤ 32 fits at L0.
 */
export function pickFigureGridLevel(
  cellW: number,
  cellH: number,
  preferredLevel: GridLevel,
): GridLevel {
  const maxDim = Math.max(cellW, cellH);
  for (let lvl = Math.min(preferredLevel, MAX_LAYER_LEVEL); lvl > 0; lvl--) {
    if (CELL_COUNTS[lvl as GridLevel] >= maxDim) return lvl as GridLevel;
  }
  return 0;
}
