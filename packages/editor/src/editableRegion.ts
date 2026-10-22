import { compSnapStep } from '@/engine/compositionCellMath';
import { WORLD_CELLS } from './cameraMath';

// The editable band of a page (CozyJournal's social_game_spec design note
// §7.3, deleted there and read as prose — its CozyJournal.md says so): a
// format that lets a turn draw in one part of the canvas alone —
// Creature's half — hands the canvas a rect in world cells, and every
// draw sample and shape-drag point is CLAMPED into it here. Pure, so the
// drag and the draw paths share one rule and the tests pin it.

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

// ── Where a turn CONNECTS on a dividing line ────────────────────────────
// The band's edges are lines a stroke is meant to meet, so the grid points
// on one are an affordance (the chrome draws them faintly — see
// regionChromeScreen's `targets`) and a stroke's end is PULLED onto the
// nearest one. Both are pure geometry over `(gridLevel, ys)` with nothing
// of any format in them; CozyJournal's `creatureGeometry` had them, which
// is the one format that has lines so far.

/** How close (as a fraction of the grid step) a stroke's end must fall to
 *  a dividing line to be pulled onto it. Wider than the tolerance a
 *  CONNECTION is judged by, so the pull happens before the judgement. */
export const MAGNET_REACH_FRAC = 0.4;

/** The grid intersections of the line `y` across the page at `gridLevel`:
 *  x = k · step over the page's width, both edges included. What the
 *  chrome draws as faint targets, so where a stroke can END is on the
 *  board before it is drawn. */
export function lineGridPoints(gridLevel: number, y: number): [number, number][] {
  const step = compSnapStep(gridLevel);
  const out: [number, number][] = [];
  for (let x = 0; x <= WORLD_CELLS + 1e-9; x += step) out.push([x, y]);
  return out;
}

/**
 * A point that reaches one of `ys` — within {@link MAGNET_REACH_FRAC} of
 * the line — snapped onto that line at its NEAREST grid point: a stroke
 * that starts or ends on a dividing line is pulled onto the point it
 * connects at. Unchanged otherwise, and unchanged where there is no line
 * to pull to. A band with a line on each side of it is why this takes a
 * LIST.
 *
 * ANY x along the line snaps. It used to pull only an end already within
 * the connection tolerance of a grid point, so a shape whose sides
 * visibly met the dotted line between two grid points connected nothing,
 * and the turn was refused with no sign of where it fell short.
 */
export function magnetToLines(
  pt: [number, number], gridLevel: number, ys: readonly number[],
): [number, number] {
  const step = compSnapStep(gridLevel);
  const reach = step * MAGNET_REACH_FRAC;
  for (const y of ys) {
    if (Math.abs(pt[1] - y) > reach) continue;
    return [Math.round(pt[0] / step) * step, y];
  }
  return pt;
}
