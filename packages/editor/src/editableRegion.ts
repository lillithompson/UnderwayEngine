// The editable band of a page (docs/social_game_spec.md §7.3): a format
// that lets a turn draw in one part of the canvas alone — Creature's
// half — hands the canvas a rect in world cells, and every draw sample
// and shape-drag point is CLAMPED into it here. Pure, so the drag and
// the draw paths share one rule and the tests pin it.

export interface EditableRegion {
  yMin: number;
  yMax: number;
  /** The band's SIDES, for a board that is a finite canvas rather than a
   *  pair of lines across an open one: Creature's 8 × 12 squares
   *  (creatureGeometry). Absent → the band spans the page's width and
   *  keeps going, which is what every other use of a region wants. */
  xMin?: number;
  xMax?: number;
}

/** `pt` pulled inside the band: each axis clamped to its bounds, an axis
 *  with no bounds left alone. The band's own edge is inside it. */
export function clampToRegion(pt: [number, number], region: EditableRegion): [number, number] {
  const y = Math.min(region.yMax, Math.max(region.yMin, pt[1]));
  const x = Math.min(region.xMax ?? Infinity, Math.max(region.xMin ?? -Infinity, pt[0]));
  return x === pt[0] && y === pt[1] ? pt : [x, y];
}

/** Whether a node's box lies inside the band, edges included — the rule
 *  a drag-placement or a resize is refused by when it would leave it. */
export function bboxInRegion(
  box: { cellX?: number; cellWidth?: number; cellY: number; cellHeight: number },
  region: EditableRegion,
  /** Float slack, so a box laid exactly on the midline is inside. */
  eps = 1e-6,
): boolean {
  if (box.cellY < region.yMin - eps || box.cellY + box.cellHeight > region.yMax + eps) return false;
  // The sides, when the band has them. A node with no box of its own on
  // that axis cannot leave a side it does not reach.
  if (region.xMin === undefined && region.xMax === undefined) return true;
  if (box.cellX === undefined || box.cellWidth === undefined) return true;
  return box.cellX >= (region.xMin ?? -Infinity) - eps
    && box.cellX + box.cellWidth <= (region.xMax ?? Infinity) + eps;
}
