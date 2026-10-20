import { compSnapStep, snapCellToCompGrid } from '@/engine/compositionCellMath';
import { type CellBbox, bboxCornerCell, RESIZE_CORNERS } from './resizeMath';

// Grid snap for arrange and creation gestures, gated on the View Settings
// "Grid Snap" toggle (engine gridSnapStore). Pure so the live preview and the
// commit can call the SAME function — snapping in only one of the two would
// leave the object somewhere other than where the drag showed it.
//
// The snap resolution is the VISIBLE grid: step = compSnapStep(gridLevel), so
// coarsening the grid coarsens the snap without a second control.

/**
 * The snap step in world cells, or 0 when the preference is off — the
 * "follow the cursor exactly" sentinel, so a caller that sizes something off
 * the step (the resize floor) needn't re-derive whether snapping is on.
 */
export function snapStepCells(gridLevel: number, enabled: boolean): number {
  return enabled ? compSnapStep(gridLevel) : 0;
}

/** Snap a world-cell point onto the nearest grid intersection. `enabled`
 *  false passes it through untouched (freeform, the editor's default). */
export function snapPoint(
  cellX: number,
  cellY: number,
  gridLevel: number,
  enabled: boolean,
): { cellX: number; cellY: number } {
  if (!enabled) return { cellX, cellY };
  return {
    cellX: snapCellToCompGrid(cellX, gridLevel),
    cellY: snapCellToCompGrid(cellY, gridLevel),
  };
}

/**
 * Grid Snap's rotation quantum: the eighth turn — so a twisted object lands
 * parallel to a gridline or to a grid diagonal.
 */
export const SNAP_ANGLE_DEG = 45;

/**
 * Quantize a free rotation onto the nearest multiple of 45°. `enabled` false
 * passes it through (freeform twist, the editor's default).
 *
 * Takes the ABSOLUTE angle rather than the gesture's twist so an object that
 * was already off-angle pulls into alignment on its first two-finger twist —
 * the same "snapping straightens what you touch" rule as `snapDragDelta`.
 *
 * Rounds in degrees rather than bucketing into [0, 360): bucketing would map
 * -30° to 315° and send a live preview spinning almost a full turn to reach
 * the same pose. Keeping the snapped angle next to the raw one is what an
 * accumulated twist needs.
 */
export function snapAngleDeg(angleDeg: number, enabled: boolean): number {
  if (!enabled) return angleDeg;
  return Math.round(angleDeg / SNAP_ANGLE_DEG) * SNAP_ANGLE_DEG;
}

/**
 * The twist to APPLY to something drawn at `startDeg` so that, after a
 * two-finger twist of `accumDeg`, it lands on a 45° multiple — the same
 * absolute rule as {@link snapAngleDeg}, for a gesture that commits a DELTA
 * rather than an angle (the whole-unit twist of a group or a multi-selection,
 * CanvasSurface's multiManipulate, which turns every member about one pivot).
 *
 * Snapping the delta itself made the unit rotate BY eighth turns: a group
 * standing at 10° went to 55°, and never straightened, where a single object
 * pulled to 45° on its first twist (bug report a289ecc4). Snapping the
 * absolute frame angle and handing back the difference lands the unit ON
 * the eighth turn instead: 10° + 20° → 45°, so the delta is 35°. A unit
 * whose frame is square (a loose selection, a group on a quarter turn) has
 * `startDeg` 0 and behaves exactly as before. `enabled` false passes the
 * raw twist through.
 */
export function snapTwistDeltaDeg(startDeg: number, accumDeg: number, enabled: boolean): number {
  if (!enabled) return accumDeg;
  return snapAngleDeg(startDeg + accumDeg, true) - startDeg;
}

/**
 * Quantize a uniform scale factor (the two-finger pinch's finger-separation
 * ratio) so the scaled box measures a whole number of grid steps. `enabled`
 * false returns the factor untouched.
 *
 * A pinch scales both axes by ONE factor, so only one of them can be made to
 * land on the grid: the anchor is the LONGER side, the extent the user is
 * actually sizing. That also keeps an axis-locked line honest — its thin side
 * is 0 and stays 0 through `scaleBboxAboutCenter`, so the stroke's LENGTH is
 * what steps grid square by grid square.
 *
 * Floored at one grid step: at this resolution a smaller box isn't
 * expressible on the grid, and a `round` that reached 0 would hand the caller
 * factor 0 (`buildScaleNode` rejects it, so the pinch would silently die).
 *
 * The box stays centred where it was (`scaleBboxAboutCenter`), so this makes
 * the SIZE a grid multiple, not the origin — growing a 1-step box to 3 steps
 * about its centre leaves the corners on the half step. Position snapping is
 * the drag's job.
 */
export function snapScaleFactor(
  bbox: Pick<CellBbox, 'cellWidth' | 'cellHeight'>,
  factor: number,
  gridLevel: number,
  enabled: boolean,
): number {
  if (!enabled) return factor;
  const extent = Math.max(bbox.cellWidth, bbox.cellHeight);
  if (!(extent > 0) || !(factor > 0)) return factor;
  const step = compSnapStep(gridLevel);
  const snapped = Math.max(Math.round((extent * factor) / step), 1) * step;
  return snapped / extent;
}

/**
 * The drag delta that lands a corner of the ROTATED bbox on a grid
 * intersection: the drawn box's four vertices (bboxCornerCell — the same
 * projection the corner handles and the hit-test use), each offered the
 * correction that would snap it, and the SMALLEST of those corrections wins.
 *
 * A translation can't align all four vertices of a freely rotated box — only a
 * quarter turn keeps them mutually grid-compatible — so the achievable rule is
 * "one vertex lands exactly, and nothing moves further than it has to". Taking
 * the nearest corner bounds the pull at half a grid step per axis (the same
 * bound the un-rotated origin snap has), so the object never lurches away from
 * the finger, and the winning corner simply changes as the drag travels.
 *
 * Ties go to the first corner in RESIZE_CORNERS order (local top-left), so a
 * box sitting symmetrically between candidates picks the same one every frame
 * instead of flickering between two equal poses.
 */
function snapRotatedDragDelta(
  bbox: CellBbox,
  angleDeg: number,
  dxCells: number,
  dyCells: number,
  gridLevel: number,
): { dxCells: number; dyCells: number } {
  let bestX = 0;
  let bestY = 0;
  let bestDist2 = Infinity;
  for (const corner of RESIZE_CORNERS) {
    const p = bboxCornerCell(bbox, angleDeg, corner.sign);
    const x = p.x + dxCells;
    const y = p.y + dyCells;
    const cx = snapCellToCompGrid(x, gridLevel) - x;
    const cy = snapCellToCompGrid(y, gridLevel) - y;
    const dist2 = cx * cx + cy * cy;
    if (dist2 < bestDist2) {
      bestDist2 = dist2;
      bestX = cx;
      bestY = cy;
    }
  }
  return { dxCells: dxCells + bestX, dyCells: dyCells + bestY };
}

/** Does `angleDeg` actually turn the box off its stored axes? Whole turns are
 *  the identity, so they take the (cheaper, more predictable) origin path. */
function isRotated(angleDeg: number): boolean {
  return Number.isFinite(angleDeg) && angleDeg % 360 !== 0;
}

/**
 * Adjust a drag delta (world cells) so the moved object lands on the grid.
 * Returns the delta to actually apply, so the caller can keep feeding a plain
 * translation to both the preview transform and
 * buildMoveNodeWithFrameReparent.
 *
 * Un-rotated (the common case), the anchor is the bbox ORIGIN — the point the
 * engine stores, and the box's own top-left vertex — so a node that was
 * already off-grid pulls into alignment on its first drag, which is what "snap
 * to the grid" means everywhere else.
 *
 * `opts.angleDeg` switches to {@link snapRotatedDragDelta}, which snaps the
 * VERTICES of the box as drawn. A rotated node's stored origin is no longer a
 * corner of anything the user can see — it's the top-left of the un-rotated
 * rect, which floats off the shape entirely at a steep angle — so snapping it
 * would leave every visible corner off-grid and the object looking unsnapped.
 *
 * NOT the engine's `computeMoveSnapDelta`, deliberately: that one anchors on
 * the bbox edge the drag is heading toward and clamps to the cursor's cell,
 * which reads better for edge alignment but is only continuous if the caller
 * rebases the drag-start bbox every time the drag reverses direction (see the
 * note on it, and Facet's CompositionCanvas move handler). Anchoring on the
 * origin needs no such per-gesture state and never jumps mid-drag.
 *
 * `opts.halfStepAxis` snaps that ONE axis at half the grid step — Facet's
 * rule for dragging a simple H/V line, whose perpendicular position is the
 * line's fine placement ("H/V lines snap to half-grid increments in the
 * orthogonal dimension"): pass the axis PERPENDICULAR to the stroke. It is
 * ignored when rotated — it places the stroke along a WORLD axis, and once the
 * stroke is turned off that axis there is no half-step to place it on.
 */
export function snapDragDelta(
  bbox: CellBbox,
  dxCells: number,
  dyCells: number,
  gridLevel: number,
  enabled: boolean,
  opts?: { halfStepAxis?: 'x' | 'y' | null; angleDeg?: number },
): { dxCells: number; dyCells: number } {
  if (!enabled) return { dxCells, dyCells };
  const angleDeg = opts?.angleDeg ?? 0;
  if (isRotated(angleDeg)) {
    return snapRotatedDragDelta(bbox, angleDeg, dxCells, dyCells, gridLevel);
  }
  // compSnapStep(level) = 2^level, so level - 1 is exactly a half step.
  const levelX = opts?.halfStepAxis === 'x' ? gridLevel - 1 : gridLevel;
  const levelY = opts?.halfStepAxis === 'y' ? gridLevel - 1 : gridLevel;
  return {
    dxCells: snapCellToCompGrid(bbox.cellX + dxCells, levelX) - bbox.cellX,
    dyCells: snapCellToCompGrid(bbox.cellY + dyCells, levelY) - bbox.cellY,
  };
}

/**
 * Creation is FREEFORM for every shape on the bar, snap or no snap: the box
 * is whatever the finger drew and the shape stretches to fill it — a wide
 * drag makes a wide ellipse, a tall drag a tall hexagon, and an arc dragged
 * wide comes out a wide quarter-ellipse. Grid Snap decides where the two
 * corners LAND, not what shape they are allowed to describe; an oval on the
 * grid is still an oval on the grid.
 *
 * There is no `shapeDragForcesSquare` any more, and no caller squaring a
 * drag off, because nothing answers yes to it. Two things used to.
 *
 * The literal N-gons did, ON the grid, on the grounds that "regular" is the
 * whole of what makes a hexagon a hexagon rather than a six-sided blob. It
 * cost more than it bought: turning Snap on to place a triangle NEATLY is
 * the commonest reason to turn it on at all, and it was the one state in
 * which the triangle's proportions stopped being the drawer's to choose.
 *
 * The ARC did, in its arc state, because its whole record is center + start
 * + end — one radius by construction — so a non-square box was a wrong arc
 * rather than a skewed one. The geometry answers that for itself now: a
 * square box still keeps the exact arc segment, and any other is drawn as
 * the quarter-ellipse polyline it actually is (computeQuarterArcSegments).
 * So the arc joins every other shape in being the shape it was dragged.
 */
