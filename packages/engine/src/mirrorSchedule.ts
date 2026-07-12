/**
 * Per-orbit canonical cell selection for symmetric reconcile.
 *
 * Picks a single representative for each mirror-orbit on the canvas
 * using lex-order in (y, x). Reconcile uses this to (1) reconcile only
 * canonical cells with all non-canonical cells cleared, then (2) clone
 * each canonical cell out to its orbit partners. The result is
 * symmetric by construction under any active mirror mode.
 *
 * Orbit math is shared with paint via {@link computePaintMirrorTargets} —
 * `engine/paintMirror.ts` is the single source of truth, so reconcile
 * partners always land on the same cells paint would have stamped.
 */

import { Layer, CELL_COUNTS } from './types';
import { canvasCellWindow, type CanvasConfig } from './canvas-bounds';
import { computePaintMirrorTargets, type MirrorFlags } from './paintMirror';
import { getCell } from './cellEdge';

/** True when `(cellX, cellY)` is the chosen canonical representative
 *  of its mirror-orbit:
 *
 *    - If **any** cell in the orbit has content, the rep is the
 *      lex-smallest cell that has content. Empty cells are never reps.
 *      This lets reconcile work even when the user painted without the
 *      mirror flag — the existing content drives the canonical, then
 *      clones out to the empty positions.
 *    - If the entire orbit is empty, the rep is the lex-smallest cell.
 *      (Mostly academic: reconcile skips empty cells anyway.)
 *
 *  Cells on a mirror axis (1-cell orbits) are always canonical when
 *  they have content. With no active mirror the orbit is empty and
 *  every cell is canonical. */
export function isCanonical(
  cellX: number, cellY: number,
  layer: Layer, canvasCfg: CanvasConfig, flags: MirrorFlags,
): boolean {
  const partners = computePaintMirrorTargets(cellX, cellY, layer, canvasCfg, flags);
  const selfHasContent = getCell(layer, cellX, cellY) != null;

  let smallerWithContent = false;
  let smallerExists = false;
  let anyContent = selfHasContent;

  for (let i = 0; i < partners.length; i++) {
    const t = partners[i];
    const partnerHasContent = getCell(layer, t.x, t.y) != null;
    if (partnerHasContent) anyContent = true;
    const isSmaller = t.y < cellY || (t.y === cellY && t.x < cellX);
    if (isSmaller) {
      smallerExists = true;
      if (partnerHasContent) smallerWithContent = true;
    }
  }

  if (anyContent) return selfHasContent && !smallerWithContent;
  return !smallerExists;
}

/** Visit each in-window cell of the layer that's a canonical orbit rep.
 *  Includes the shift-exposed -1 edge cells when applicable. */
export function forEachCanonicalCell(
  layer: Layer, canvasCfg: CanvasConfig, flags: MirrorFlags,
  fn: (cellX: number, cellY: number) => void,
): void {
  const w = canvasCellWindow(layer, canvasCfg);
  const count = CELL_COUNTS[layer.level];
  const xMax = Math.min(w.endCellX, count);
  const yMax = Math.min(w.endCellY, count);
  for (let y = w.edgeMinCellY; y < yMax; y++) {
    for (let x = w.edgeMinCellX; x < xMax; x++) {
      if (isCanonical(x, y, layer, canvasCfg, flags)) fn(x, y);
    }
  }
}
