import type {
  CellState,
  CellTransform,
  CompositionState,
  PatternObject,
  RGBColor,
  SVGStroke,
} from '@/engine/types';
import { DEFAULT_TRANSFORM } from '@/engine/types';
import { buildRemoveObjectOps, findItem, isItemLocked } from '@/engine/compositionOps';
import type { SceneGraph } from '@/engine/sceneGraph';
import { graphOf, leafHitFrame } from '@/engine/sceneHitFrame';
import { drawnLeafFor } from './drawnPose';
import {
  cellStatesEqual,
  getRenderedSignature,
  mirrorCellState,
  pickRandomSpriteForConstraints,
} from '@/engine/connectivity';
import {
  MAX_PATTERN_GRID, applyPatternCellEdits, mintPatternObjectId, patternApplyToolAt, patternCellAt,
  patternCellAtWorldPoint,
  tintedPatternCell, type PatternSubTool,
} from '@/engine/patternObject';
import { shapePatternGrid } from '@/engine/shapePatternFill';
import { canvasSymmetryStamps, type CanvasSymmetrySpec } from './canvasSymmetry';
import { pathEnds } from '@/engine/svgEndpoints';
import { rotatePointAboutCW } from '@/engine/compositionArcMath';
import { compSnapStep } from '@/engine/compositionCellMath';
import { buildEditPatternCells, buildReplacePattern, SessionEntry } from './editorSession';

// ── The Tile tool ───────────────────────────────────────────────────
// A tap fills the grid cell under it (at the current grid level) with ONE
// Pattern tile, picked to CONNECT with what already touches the cell: the 8
// connection points around the cell border — the 4 corners and the 4 edge
// midpoints, in the engine's signature order N, NE, E, SE, S, SW, W, NW —
// are checked against
//   - neighbouring tiles: any pattern object whose own tile grid has a
//     connection point AT one of the 8 (its rendered signature true there);
//   - the loose ends of drawn lines: an endpoint of any OPEN path (a
//     freehand stroke, a line, an arc) sufficiently close to one of the 8.
// Each point's filled/empty answer becomes the constraint the placed tile's
// connection signature must satisfy, so lines appear to continue INTO the
// tile and tiles knit onto each other exactly as they do inside a pattern
// grid. Closed shapes (rectangles, circles, polygons) have no loose end to
// continue, so they leave the constraint alone by construction.
//
// Each point yields a TRI-STATE constraint, exactly as the pattern grid's
// own gatherConstraints does: TRUE where something connects (a neighbour
// tile's live connection point, a line's endpoint), FALSE where a
// neighbouring tile's border occupies the point WITHOUT connecting (its
// signature is false there — the placed tile must not run a line into that
// wall), and NULL where nothing is near the point at all. A cell with
// nothing around it is all-null — free to pick any tile, the way the
// Pattern tool's random brush is on an empty grid.
//
// Resolutions may differ: tiles are stamped at whatever grid level was
// current, so a small cell can sit against a bigger tile. A border point of
// the small cell then lands on the big tile's edge BETWEEN that tile's own
// connection points — and between its points an occupied tile's edge is a
// solid wall, so the point is a mandatory non-connection (the engine's
// coarser-cell blocking rule, isBlockedByCoarserCell in connectivity.ts).
// Only TILES block this way; freehand/line/arc geometry speaks through its
// endpoints alone. (The coarser side needs no such rule: a coarse border
// point on a finer occupied cell's edge always coincides with one of the
// finer grid's own connection points, the grids being nested powers of 2.)
//
// The placed tile is a 1×1 PatternObject sized to the grid cell — the same
// scene kind the pattern tool creates, so rendering, hit-testing, undo,
// recolouring and the pattern properties bars all apply to it unchanged.

/** How close (as a fraction of the cell step) a path endpoint must land to a
 *  connection point to count as filling it. Adjacent connection points sit
 *  half a step apart, so anything below 0.25 is unambiguous; 0.2 keeps a
 *  freehand stroke's unsnapped tail forgiving without ever double-counting. */
export const TILE_ENDPOINT_TOL_FRAC = 0.2;

/**
 * Hard ceiling on FILLED pattern cells across the whole drawing. Every
 * filled cell is live SVG (segments in the baked view, path data in the
 * DOM) plus per-stamp constraint-gathering work, so an unbounded fill —
 * scribbling a whole page at a fine grid — grows the document until iOS
 * WKWebView hits memory pressure and reloads the page. 4096 is sixteen
 * full pattern grids (16 × MAX_PATTERN_GRID²): a whole 3:4 page at grid
 * step 1 is ~1.4k cells, so the budget holds nearly 3 pages of default-
 * grid tiling and stops the fine-grid runaway well before the reload.
 *
 * Enforced in buildPlaceTile: filling a NEW cell (a fresh stamp, or an
 * empty slot of an existing grid) spends budget; RE-ROLLING a filled cell
 * is free — at the cap the tool still reworks what's there, it just stops
 * adding. Pattern-tool regions count toward the total (their cells cost
 * the same to render) but are placed whole by their own builder.
 */
export const MAX_TILE_CELLS_TOTAL = 4096;

/** How many filled (non-null) cells the drawing holds — what
 *  MAX_TILE_CELLS_TOTAL is measured against. Pattern objects and the
 *  square tile a shape's pattern FILL repeats alike: both bake to live
 *  SVG, and the budget is about what the document costs to render.
 *
 *  A fill is cheap by construction — one tile is at most 8×8 cells however
 *  many copies of it show (the markup is one `<pattern>` def and a rect) —
 *  so it barely moves the total; it is counted because leaving it out
 *  would be a second answer to "what is a filled cell". */
export function filledPatternCellCount(state: CompositionState): number {
  let n = 0;
  for (const p of state.patternObjects ?? []) {
    for (const c of p.cells) {
      if (c != null) n += 1;
    }
  }
  for (const svg of state.svgObjects) {
    for (const c of svg.patternFill?.cells ?? []) {
      if (c != null) n += 1;
    }
  }
  return n;
}

/** The world position of connection point `k` (signature order N..NW) on the
 *  axis-aligned box at (`x`, `y`) sized `w`×`h`. Mirrors the engine's
 *  connectionPointL0 layout, in world cells rather than layer L0. */
function boxConnectionPoint(
  x: number, y: number, w: number, h: number, k: number,
): [number, number] {
  switch (k) {
    case 0: return [x + w / 2, y];         // N
    case 1: return [x + w, y];             // NE
    case 2: return [x + w, y + h / 2];     // E
    case 3: return [x + w, y + h];         // SE
    case 4: return [x + w / 2, y + h];     // S
    case 5: return [x, y + h];             // SW
    case 6: return [x, y + h / 2];         // W
    default: return [x, y];                // NW
  }
}

/** A pattern object whose stored cell grid maps straight onto the page —
 *  no free rotation, no discrete pose, no repeat wrap. Only these can
 *  answer "is one of your connection points at this world position" from
 *  the stored cells alone; a posed pattern is skipped (it reads as empty
 *  to the Tile tool rather than as a wall). */
function patternGridIsAxisAligned(p: PatternObject): boolean {
  return !p.angleDeg && !(p.rotation ?? 0) && !p.mirrorH && !p.mirrorV
    && p.tileMode !== 'repeat';
}

/** The composition grid level the Tile tool works this pattern AT: the
 *  level whose cell step (compSnapStep) is the pattern's own, so a tap on
 *  one of its cells re-rolls or fills THAT cell in place (findTileCellAt's
 *  match) instead of stacking a tile of another size over it. Null when no
 *  level fits: a posed or repeating grid the tool never joins, or cells
 *  that aren't square at a power-of-two step. */
export function tileGridLevelOf(p: PatternObject): number | null {
  if (!patternGridIsAxisAligned(p)) return null;
  const step = p.cellWidth / p.cols;
  if (!(step > 0) || Math.abs(p.cellHeight / p.rows - step) > step * 1e-6) return null;
  const level = Math.log2(step);
  const rounded = Math.round(level);
  return Math.abs(level - rounded) <= 1e-9 ? rounded : null;
}

/**
 * The pattern the Tile tool is ALLOWED to change — the one the user put
 * into edit mode by hand, with the Edit capsule in the lower right, and
 * which wears the double border for as long as it stays there.
 *
 * The tool used to work out its own target: whatever grid the tap happened
 * to land in or against, or the last one a stroke had touched. That meant
 * a stroke laid near an old pattern silently grew it, and two patterns
 * drawn side by side merged into one — an edit nobody asked for. Editing
 * is an explicit mode now: with nothing editable the Tile tool only ever
 * CREATES (a dragged region mints a fresh Pattern object), and with
 * something editable the stamps go into THAT object and nothing else.
 *
 * A closed shape's PATTERN FILL is one of these grids too: the id then
 * names the SHAPE, and what comes back is the grid it carries dressed as
 * a PatternObject in its own box (`shapePatternGrid`). Everything
 * downstream — the stamp, the grid actions, the symmetry — works that
 * object without knowing which of the two it came from, which is the
 * whole point of the shape-id convention (engine/shapePatternFill.ts).
 *
 * Null when the id names nothing, names something that is neither a
 * pattern nor a patterned shape, or names one that is hidden or locked —
 * none of which can take an edit.
 */
export function editableTilePattern(
  state: CompositionState,
  editableId: string | null | undefined,
): PatternObject | null {
  if (!editableId) return null;
  const ref = findItem(state, editableId);
  if (!ref) return null;
  if (ref.kind === 'svg') {
    const grid = shapePatternGrid(ref.item);
    if (!grid || ref.item.hidden || isItemLocked(state, ref.item.id)) return null;
    return grid;
  }
  if (ref.kind !== 'pattern') return null;
  const p = ref.item;
  if (p.hidden || isItemLocked(state, p.id)) return null;
  return p;
}

/**
 * Whether a tap on `id` is a tap on a GRID — a pattern object, or a shape
 * carrying a pattern fill — the two things a double tap opens for editing.
 * Read before the lock and the hidden flag (editableTilePattern): this is
 * "is that a grid under the finger", asked by the gesture recognisers on
 * the canvas and in the shell, and the opener then decides whether the
 * grid can be worked on.
 */
export function tapLandsOnPatternGrid(
  state: CompositionState, id: string | null | undefined,
): boolean {
  if (!id) return false;
  const ref = findItem(state, id);
  return ref?.kind === 'pattern' || (ref?.kind === 'svg' && ref.item.patternFill != null);
}

/** Whether `id` names a grid that is a SHAPE's pattern fill rather than a
 *  pattern object — the one difference the stamp path has to know about:
 *  a fill's grid is the shape's box and cannot grow past it. */
export function isShapePatternFillGrid(
  state: CompositionState, id: string | null | undefined,
): boolean {
  if (!id) return false;
  const ref = findItem(state, id);
  return ref?.kind === 'svg' && ref.item.patternFill != null;
}

/**
 * The ONE pattern object the floating grid actions (Flood / Close /
 * Clear) aim at — they rewrite a grid's contents, so they aim where the
 * Tile tool's stamps do:
 *
 *   1. the SELECTED pattern — an explicit choice outranks everything;
 *   2. the EDITABLE pattern (the double border) — the target when the
 *      tool is in hand with nothing selected.
 *
 * Null when neither stands: the action then has no target and no-ops.
 * (It used to guess besides — the sole pattern at the current grid level,
 * else the last one a stroke had touched — which is exactly the implicit
 * targeting the Edit mode replaced.)
 */
export function patternGridActionTarget(
  state: CompositionState,
  selectedId: string | null | undefined,
  editableId: string | null | undefined,
): string | null {
  const selected = selectedId ? findItem(state, selectedId) : null;
  // A patterned SHAPE answers here only while its grid is the open one:
  // selecting a shape says nothing about its fill (it has an outline, a
  // colour and a pattern), where selecting a pattern object names the
  // grid outright.
  if (selected?.kind === 'pattern') return selectedId!;
  return editableTilePattern(state, editableId)?.id ?? null;
}

/**
 * Whether the floating grid-actions capsule (Flood | Close | Clear) has a
 * target it may actually rewrite — the shell's visibility gate.
 *
 * The actions rewrite a grid's CONTENTS, so they may only stand over a
 * grid whose contents are open: the one in edit mode, wearing the double
 * border. That is the same licence the brush radial asks for, and the two
 * now agree — a pattern nobody has opened cannot be stamped into, and it
 * cannot be flooded, closed or cleared either. Until it is opened the
 * Edit pill in the radial's seat is the whole offer.
 *
 * `editableId` is the pattern already resolved as editable
 * (editableTilePattern) — so a hidden or LOCKED pattern never reaches
 * here, and a selected one that can't be opened at all takes the capsule
 * down with it.
 *
 * A selected pattern that ISN'T the open one takes them down too: the
 * actions aim at the selection first (patternGridActionTarget), and that
 * selection's contents are closed. Selecting something that is not a
 * pattern at all leaves the open grid as the target, so the capsule keeps
 * standing while the tool is in hand.
 */
export function patternGridActionsTargetOpen(
  selectedPatternId: string | null | undefined,
  editableId: string | null | undefined,
): boolean {
  if (!editableId) return false;
  return !selectedPatternId || selectedPatternId === editableId;
}

// ── Stamping INTO the editable pattern's own grid ───────────────────
// The Edit capsule puts a pattern into edit mode and arms the Tile tool.
// The pattern's grid need not sit on the composition grid — its cells may
// be another size, offset from the lattice, or the whole grid turned — and
// the plain stamp (buildPlaceTile) works the composition grid: on such a
// pattern it laid loose 1×1 tiles of the CURRENT step over the grid it
// was meant to edit. For an editable pattern, a stamp is in THAT grid's
// coordinate space instead: a cell of it re-rolls in place (the pattern
// brush's own move, its own symmetry and all), and a point past its edge
// GROWS the grid to reach it, the existing cells staying exactly where
// they are on the page.

/** The pattern the Tile tool stamps INTO, in its own space: the EDITABLE
 *  one (editableTilePattern), unless its grid already IS the composition
 *  grid at the current level (tileGridLevelOf) — then the plain stamp
 *  edits it in place with the lines' ends as constraints, as ever. */
export function tileTargetPattern(
  state: CompositionState,
  editableId: string | null | undefined,
  gridLevel: number,
): PatternObject | null {
  const p = editableTilePattern(state, editableId);
  if (!p) return null;
  // A shape's pattern FILL is always worked in its own space, whatever
  // the composition grid happens to be: the plain stamp would mint a
  // loose 1×1 pattern object on top of the shape instead of painting the
  // grid inside it, which is the one thing a fill must never do.
  if (isShapePatternFillGrid(state, p.id)) return p;
  // The composition grid: the same step AND in phase with the lattice —
  // findTileCellAt's own match — so an off-lattice grid of the current
  // step is still worked in its own space.
  if (tileGridLevelOf(p) === gridLevel) {
    const step = compSnapStep(gridLevel);
    const eps = step * 1e-6 + 1e-9;
    const onLattice = (v: number) => Math.abs(v / step - Math.round(v / step)) * step <= eps;
    if (onLattice(p.cellX) && onLattice(p.cellY)) return null;
  }
  return p;
}

/** Whether a grid can be GROWN past its edge: a plain grid (free
 *  rotation allowed — it turns about the box centre and the maths below
 *  keeps the cells put), never a quarter-turned, mirrored or repeating one,
 *  whose content frame is not its box. */
function patternGridGrowable(p: PatternObject): boolean {
  return !(p.rotation ?? 0) && !p.mirrorH && !p.mirrorV && p.tileMode !== 'repeat';
}

/**
 * The cell of `p`'s grid under world point (`wx`, `wy`), as (col, row):
 * inside the grid, or, for a growable grid, past its edge (a negative or
 * over-range index the grow will make room for). Null when nothing
 * sensible names it.
 *
 * The point is carried into the pattern's OWN frame first — through the
 * inverse of its world matrix (sceneHitFrame), so a pattern inside a bound
 * group is tapped where the group draws it, and one the group has scaled
 * answers at the size it is drawn. `patternCellAtWorldPoint` then undoes
 * the BAKE (the discrete turn and mirror the cells were laid down through)
 * in that frame, against the local object, whose box is the frame's own.
 *
 * `graph` is the composition's, and is used only when it holds this very
 * object (drawnLeafFor): the Tile tool also asks about grids it is still
 * building and variants a caller spread a field onto, and those have no
 * node — only their own world fields.
 */
export function tileCellInPattern(
  p: PatternObject,
  wx: number,
  wy: number,
  graph?: SceneGraph,
): { col: number; row: number } | null {
  const d = drawnLeafFor('pattern', p, graph);
  const frame = leafHitFrame(d.node, d.world);
  const local = frame.object as PatternObject;
  const [hx, hy] = frame.toLocal(wx, wy);
  const inside = patternCellAtWorldPoint(local, hx, hy);
  if (inside) return { col: inside.x, row: inside.y };
  // Growable is read off the STORED object, not the local one: the flags
  // say how the cells were BAKED, and the grow writes cols/rows and cell
  // indices straight back into that grid.
  if (!patternGridGrowable(p)) return null;
  const stepX = local.cellWidth / p.cols;
  const stepY = local.cellHeight / p.rows;
  if (!(stepX > 0) || !(stepY > 0)) return null;
  return {
    col: Math.floor((hx - local.cellX) / stepX),
    row: Math.floor((hy - local.cellY) / stepY),
  };
}

/**
 * How far past its own edge a stamp may land and still GROW the grid it is
 * editing: one cell, the square against the boundary.
 *
 * An open grid grows to meet a stamp beside it — that is how a pattern is
 * extended without redrawing it — but "beside" has to mean beside. A tap
 * in the grid's own space grew it to reach WHEREVER it fell, so a tap
 * across the page turned a 2×2 into a grid the width of the drawing, or
 * hit the cap and did nothing at all. Past the reach a tap is not aimed at
 * the pattern: it clears the selection, the way an empty-canvas tap does
 * under every other tool (canvasTap's tile branch), and edit mode closes
 * with it.
 *
 * A drag is unaffected: the trail stamps every cell it crosses
 * (stampTileTrail interpolates), so each stamp lands against the edge the
 * one before it grew, and a stroke extends the grid as far as it is drawn.
 *
 * The composition-grid path reads the same rule more strictly still: a
 * stamp joins the open grid only where it shares an EDGE with a filled
 * cell of it (findJoinableTilePatterns → stampTouchesPattern), which is
 * always inside this reach.
 */
export const TILE_GROW_REACH_CELLS = 1;

/** Is a cell index in `p`'s own grid (tileCellInPattern — inside the grid,
 *  or past its edge) near enough to the grid for a stamp to grow it there?
 *  Inside always is; outside, at most TILE_GROW_REACH_CELLS beyond the
 *  boundary, on either axis. */
export function tileCellWithinGrowReach(p: PatternObject, col: number, row: number): boolean {
  const r = TILE_GROW_REACH_CELLS;
  return col >= -r && row >= -r && col < p.cols + r && row < p.rows + r;
}

/**
 * `p` with its grid grown to hold (`col`, `row`) — the cells it has stay
 * exactly where they are on the page. The box grows in the pattern's OWN
 * frame by whole cells of its own step; under a free rotation (about the
 * box centre) the new box's centre moves by the growth's local offset
 * turned through that angle, so the old cells' world positions hold.
 * Null past the grid cap, or for a grid that can't grow.
 */
export function grownPatternGrid(p: PatternObject, col: number, row: number): PatternObject | null {
  if (!patternGridGrowable(p)) return null;
  const minCol = Math.min(0, col);
  const minRow = Math.min(0, row);
  const cols = Math.max(p.cols - 1, col) - minCol + 1;
  const rows = Math.max(p.rows - 1, row) - minRow + 1;
  if (cols > MAX_PATTERN_GRID || rows > MAX_PATTERN_GRID) return null;
  if (cols === p.cols && rows === p.rows) return p;
  const stepX = p.cellWidth / p.cols;
  const stepY = p.cellHeight / p.rows;
  const cells: (CellState | null)[] = new Array(cols * rows).fill(null);
  for (let i = 0; i < p.cells.length; i++) {
    const x = (i % p.cols) - minCol;
    const y = Math.floor(i / p.cols) - minRow;
    cells[y * cols + x] = p.cells[i] ?? null;
  }
  const w2 = cols * stepX;
  const h2 = rows * stepY;
  // New centre − old centre, in the unrotated frame…
  const dLocal: [number, number] = [
    minCol * stepX + w2 / 2 - p.cellWidth / 2,
    minRow * stepY + h2 / 2 - p.cellHeight / 2,
  ];
  // …turned through the free rotation to the page.
  const [ddx, ddy] = p.angleDeg ? rotatePointAboutCW(dLocal[0], dLocal[1], 0, 0, p.angleDeg) : dLocal;
  const cx = p.cellX + p.cellWidth / 2 + ddx;
  const cy = p.cellY + p.cellHeight / 2 + ddy;
  return {
    ...p,
    cellX: cx - w2 / 2,
    cellY: cy - h2 / 2,
    cellWidth: w2,
    cellHeight: h2,
    cols,
    rows,
    cells,
  };
}

/**
 * Stamp a Tile-tool tile INTO `patternId`'s own grid at world point
 * (`wx`, `wy`): the cell there re-rolls (or takes the armed `pick`)
 * through the pattern brush's own move — patternApplyToolAt, the
 * pattern's stored symmetry included — and a point just past the grid's
 * edge grows the grid first (grownPatternGrid; one replace op carries the
 * grown grid and the stamp). Null when the point names no cell, lands
 * further out than the grid's reach (TILE_GROW_REACH_CELLS), the pattern
 * is locked or missing, the grid is capped, or the cell budget is spent.
 */
export function buildPlaceTileInPattern(
  state: CompositionState,
  patternId: string,
  wx: number,
  wy: number,
  color: RGBColor,
  excludedFamilies?: Set<string>,
  pick?: { spriteId: string; transform?: CellTransform },
): SessionEntry | null {
  const p = editableTilePattern(state, patternId);
  if (!p) return null;
  const cell = tileCellInPattern(p, wx, wy, graphOf(state));
  if (!cell) return null;
  const tool: PatternSubTool = pick
    ? { kind: 'tile', spriteId: pick.spriteId, transform: pick.transform ?? { ...DEFAULT_TRANSFORM } }
    : { kind: 'random' };
  const inside = cell.col >= 0 && cell.row >= 0 && cell.col < p.cols && cell.row < p.rows;
  if (inside) {
    // Filling an EMPTY cell spends the budget; a re-roll is free.
    if (p.cells[cell.row * p.cols + cell.col] == null
      && MAX_TILE_CELLS_TOTAL - filledPatternCellCount(state) <= 0) return null;
    const edits = patternApplyToolAt(p, cell.col, cell.row, tool, excludedFamilies, color);
    return buildEditPatternCells(state, p.id, edits);
  }
  // A shape's pattern FILL never grows: the grid IS the shape's box, and
  // a stamp outside the outline has no cell to land in — the tiles would
  // be clipped away the moment they were laid.
  if (isShapePatternFillGrid(state, p.id)) return null;
  // Past the edge: the grid grows to meet the stamp, but only as far as
  // the square against its boundary (TILE_GROW_REACH_CELLS). Every caller
  // gates on the same reach; this is the floor under all of them.
  if (!tileCellWithinGrowReach(p, cell.col, cell.row)) return null;
  if (MAX_TILE_CELLS_TOTAL - filledPatternCellCount(state) <= 0) return null;
  const grown = grownPatternGrid(p, cell.col, cell.row);
  if (!grown) return null;
  const minCol = Math.min(0, cell.col);
  const minRow = Math.min(0, cell.row);
  const edits = patternApplyToolAt(grown, cell.col - minCol, cell.row - minRow, tool, excludedFamilies, color);
  if (edits.length === 0) return null;
  return buildReplacePattern(state, applyPatternCellEdits(grown, edits));
}

/**
 * The tri-state constraint at the 8 connection points around the border of
 * the grid cell at (`originX`, `originY`) sized `step`, gathered from the
 * scene: pattern-tile connection points and open-path endpoints, per the
 * module comment — true = must connect, false = must not (a tile border
 * occupies the point without connecting), null = nothing there, free.
 * `excludeCell` leaves ONE CELL of one pattern object out — the cell being
 * re-rolled must not constrain its own replacement, while its siblings in
 * the same object still do.
 */
export function gatherTileConstraints(
  state: CompositionState,
  originX: number,
  originY: number,
  step: number,
  excludeCell?: { id: string; index: number },
): (boolean | null)[] {
  const constraints: (boolean | null)[] = [null, null, null, null, null, null, null, null];
  const tol = step * TILE_ENDPOINT_TOL_FRAC;
  const tolSq = tol * tol;
  const points: [number, number][] = [];
  for (let k = 0; k < 8; k++) {
    points.push(boxConnectionPoint(originX, originY, step, step, k));
  }
  // A connecting mark wins over a non-connecting one at the same point,
  // matching the engine's corner-vertex model (any live connection there
  // means the placed tile should meet it).
  const mark = (x: number, y: number, connects: boolean) => {
    for (let j = 0; j < 8; j++) {
      const dx = x - points[j][0];
      const dy = y - points[j][1];
      if (dx * dx + dy * dy > tolSq) continue;
      if (connects) constraints[j] = true;
      else if (constraints[j] == null) constraints[j] = false;
    }
  };

  // Open-path endpoints: a stroke's ends are where a line can continue, so
  // they are what a tile may connect to. Free rotation is layered rather
  // than baked, so it is applied here the same way render and hit-test do.
  for (const obj of state.svgObjects) {
    if (obj.hidden) continue;
    const ends = pathEnds(obj.segments);
    if (!ends) continue;
    for (const end of [ends.start.at, ends.end.at]) {
      let [x, y] = end;
      if (obj.angleDeg) {
        [x, y] = rotatePointAboutCW(
          x, y,
          obj.cellX + obj.cellWidth / 2, obj.cellY + obj.cellHeight / 2,
          obj.angleDeg,
        );
      }
      mark(x, y, true);
    }
  }

  // Pattern tiles: every filled cell of an axis-aligned pattern object has
  // its rendered signature at known world positions — a TRUE point landing
  // on a border point asks the placed tile to meet it, a FALSE one forbids
  // running a line into that edge.
  const minX = originX - tol, maxX = originX + step + tol;
  const minY = originY - tol, maxY = originY + step + tol;
  for (const p of state.patternObjects ?? []) {
    if (p.hidden) continue;
    if (!patternGridIsAxisAligned(p)) continue;
    if (p.cellX > maxX || p.cellX + p.cellWidth < minX) continue;
    if (p.cellY > maxY || p.cellY + p.cellHeight < minY) continue;
    const cw = p.cellWidth / p.cols;
    const ch = p.cellHeight / p.rows;
    for (let i = 0; i < p.cells.length; i++) {
      if (excludeCell && p.id === excludeCell.id && i === excludeCell.index) continue;
      const sig = getRenderedSignature(p.cells[i] ?? null);
      if (!sig) continue;
      const cx = p.cellX + (i % p.cols) * cw;
      const cy = p.cellY + Math.floor(i / p.cols) * ch;
      for (let k = 0; k < 8; k++) {
        const [x, y] = boxConnectionPoint(cx, cy, cw, ch, k);
        mark(x, y, sig[k]);
      }
      // Between its connection points, this occupied cell's border is a
      // solid wall (the multiresolution rule in the module comment): a
      // target point on the edge that no point-mark above claimed is a
      // mandatory non-connection. mark() lets a live point from another
      // cell still win the spot, so the order here doesn't matter.
      for (let j = 0; j < 8; j++) {
        if (constraints[j] != null) continue;
        if (onBoxBorder(points[j][0], points[j][1], cx, cy, cw, ch, tol)) {
          constraints[j] = false;
        }
      }
    }
  }

  return constraints;
}

/** Whether (`px`, `py`) lies within `tol` of the OUTLINE of the axis-aligned
 *  box — on an edge or corner, either side of it, but not in the interior
 *  away from the border. */
function onBoxBorder(
  px: number, py: number, x: number, y: number, w: number, h: number, tol: number,
): boolean {
  if (px < x - tol || px > x + w + tol) return false;
  if (py < y - tol || py > y + h + tol) return false;
  return Math.abs(px - x) <= tol || Math.abs(px - (x + w)) <= tol
    || Math.abs(py - y) <= tol || Math.abs(py - (y + h)) <= tol;
}

/** The cell of the EDITABLE pattern already covering the grid cell, if its
 *  grid matches the current step and contains it. That cell is what a
 *  re-tap re-rolls (or an empty slot fills) in place, instead of stacking
 *  a second object over it.
 *
 *  Only the editable object answers: every other pattern on the page is
 *  scenery to the Tile tool, so a stamp that lands over one lays a fresh
 *  object on top rather than quietly rewriting a grid nobody opened for
 *  editing. A LOCKED editable pattern is still found — the edit it refuses
 *  (buildEditPatternCells returns null) must not fall through to stacking
 *  a tile over what the user pinned down. */
function findTileCellAt(
  state: CompositionState,
  originX: number,
  originY: number,
  step: number,
  editableId: string | null | undefined,
): { p: PatternObject; index: number } | undefined {
  if (!editableId) return undefined;
  const eps = step * 1e-6 + 1e-9;
  for (const p of state.patternObjects ?? []) {
    if (p.id !== editableId) continue;
    if (p.hidden || !patternGridIsAxisAligned(p)) continue;
    if (Math.abs(p.cellWidth / p.cols - step) > eps) continue;
    if (Math.abs(p.cellHeight / p.rows - step) > eps) continue;
    const ix = Math.round((originX - p.cellX) / step);
    const iy = Math.round((originY - p.cellY) / step);
    if (ix < 0 || iy < 0 || ix >= p.cols || iy >= p.rows) continue;
    // The object's grid must actually be ALIGNED with the target cell,
    // not merely overlap it.
    if (Math.abs(p.cellX + ix * step - originX) > eps) continue;
    if (Math.abs(p.cellY + iy * step - originY) > eps) continue;
    return { p, index: iy * p.cols + ix };
  }
  return undefined;
}

/**
 * Place a Tile-tool tile at the world point (`cellX`, `cellY`): resolve the
 * grid cell under it at `gridLevel`, gather the 8-point constraint from the
 * scene, pick a connecting tile from the Pattern tile set (`excludedFamilies`
 * narrows the pick exactly as it does the pattern random brush), and commit
 * it in the active colour.
 *
 * A fresh cell gets a new 1×1 PatternObject sized to the cell (`stroke`
 * seeds its authored line weight, as buildPlacePattern's does); a cell of
 * the EDITABLE grid (`editableId`, step-matched and in phase) gets THAT
 * cell re-rolled (or filled) in place, one edit on the existing object, so
 * taps into the open grid never stack copies. Any OTHER pattern the stamp
 * lands over is scenery: it keeps its cells and the stamp lays a fresh
 * object above it. Returns null when there is nothing to do: no sprite
 * registry at all, a re-roll that happened to pick the very tile already
 * there, or the drawing already at the MAX_TILE_CELLS_TOTAL cell budget
 * (re-rolls of filled cells still work at the cap; only NEW fills stop).
 *
 * With `symmetry` set (the canvas Symmetry control), the stamp's mirror
 * partners about the symmetry frame land in the same entry — each partner
 * the SAME tile flipped/rotated per its orbit position (mirrorCellState,
 * the pattern grid's own rule), never an independent pick, so the mirrored
 * image is exact. A stamp ON an axis constrains the pick to self-symmetric
 * tiles first. Partners re-roll tiles already at their cells and skip
 * locked ones; they change nothing when the primary itself is a no-op.
 *
 * With `pick` set (the radial's Choose fan — a specific tile armed), THAT
 * sprite is laid in its pose instead of a connectivity-respecting roll:
 * the user chose the tile, so what already borders the cell constrains
 * nothing. Everything else — the ink, the in-place edit, the symmetry
 * partners' mirrored copies — behaves exactly as a rolled stamp does.
 */
/**
 * Would a tile placed at (`cellX`, `cellY`) JOIN the EDITABLE pattern —
 * fill (or re-roll) one of its cells, or land edge-on against it?
 *
 * The tile tool's tap asks this before it places anything. A tap that
 * would answer no is starting a pattern from nothing, and a pattern is
 * DRAGGED out as a region rather than tapped into existence — so that tap
 * clears the selection instead, the way every other tool's empty-canvas
 * tap does (see canvasTap's tile branch).
 *
 * The yeses are the ways a tap places: into an editable pattern whose grid
 * is its own, into that grid where it lands (findTileCellAt — an empty
 * slot of one included), or beside it, which grows that object
 * (mergeTileStrokeOps). With nothing editable every tap answers no: the
 * Tile tool then only creates.
 */
export function tileTapJoinsPattern(
  state: CompositionState,
  cellX: number,
  cellY: number,
  gridLevel: number,
  /** The pattern in edit mode, because one whose grid is not the
   *  composition grid takes the tap in its own space
   *  (tileTargetPattern → buildPlaceTileInPattern) — within reach of its
   *  edge (TILE_GROW_REACH_CELLS); further out the tap is not its. */
  editableId?: string | null,
): boolean {
  const own = tileTargetPattern(state, editableId, gridLevel);
  if (own) {
    const cell = tileCellInPattern(own, cellX, cellY, graphOf(state));
    return cell !== null && tileCellWithinGrowReach(own, cell.col, cell.row);
  }
  const step = compSnapStep(gridLevel);
  const originX = Math.floor(cellX / step) * step;
  const originY = Math.floor(cellY / step) * step;
  if (findTileCellAt(state, originX, originY, step, editableId)) return true;
  return findJoinableTilePatterns(
    state, originX, originY, step, step, step, EMPTY_EXCLUDE, editableId,
  ).length > 0;
}

const EMPTY_EXCLUDE: ReadonlySet<string> = new Set<string>();

export function buildPlaceTile(
  state: CompositionState,
  cellX: number,
  cellY: number,
  gridLevel: number,
  color: RGBColor,
  excludedFamilies?: Set<string>,
  stroke?: SVGStroke,
  symmetry?: CanvasSymmetrySpec,
  pick?: { spriteId: string; transform?: CellTransform },
  /** The pattern in edit mode — the ONLY object a stamp may rework. With
   *  none, every stamp mints its own fresh 1×1 object. */
  editableId?: string | null,
): SessionEntry | null {
  const step = compSnapStep(gridLevel);
  const originX = Math.floor(cellX / step) * step;
  const originY = Math.floor(cellY / step) * step;

  const existing = findTileCellAt(state, originX, originY, step, editableId);
  // The cell budget (MAX_TILE_CELLS_TOTAL): filling a new cell spends it,
  // re-rolling a filled one is free. At zero, a tap that isn't a re-roll
  // has nothing it may do — bail before the constraint gather and the
  // sprite roll, so a capped stroke stays cheap per crossed cell.
  let budget = MAX_TILE_CELLS_TOTAL - filledPatternCellCount(state);
  if (budget <= 0 && !(existing && existing.p.cells[existing.index] != null)) {
    return null;
  }
  const sym = symmetry ? canvasSymmetryStamps(originX, originY, step, symmetry) : undefined;
  const picked: CellState = pick
    ? { type: 'sprite', spriteId: pick.spriteId, transform: pick.transform ?? { ...DEFAULT_TRANSFORM } }
    : pickRandomSpriteForConstraints(
        gatherTileConstraints(
          state, originX, originY, step,
          existing ? { id: existing.p.id, index: existing.index } : undefined,
        ),
        excludedFamilies, sym?.self,
      );
  if (!picked) return null;
  const cell = tintedPatternCell(picked, color);

  const entry: SessionEntry['entry'] = [];
  let id: string | undefined;
  const stampAt = (ox: number, oy: number, c: typeof cell) => {
    const there = ox === originX && oy === originY
      ? existing
      : findTileCellAt(state, ox, oy, step, editableId);
    if (there) {
      const oldState = there.p.cells[there.index] ?? null;
      if (cellStatesEqual(oldState, c)) return;
      // Filling an EMPTY slot of an existing grid adds a cell to the
      // drawing just as a fresh stamp does, so it spends budget; a
      // re-roll replaces one and is free.
      if (oldState == null && budget <= 0) return;
      // A locked object refuses the edit — nothing stacks over what the
      // user pinned down.
      const se = buildEditPatternCells(state, there.p.id, [
        { index: there.index, oldState, newState: c },
      ]);
      if (!se) return;
      if (oldState == null) budget -= 1;
      entry.push(...se.entry);
      id ??= there.p.id;
      return;
    }
    if (budget <= 0) return;
    budget -= 1;
    const item: PatternObject = {
      id: mintPatternObjectId(),
      cellX: ox,
      cellY: oy,
      cellWidth: step,
      cellHeight: step,
      cols: 1,
      rows: 1,
      cells: [c],
      ...(stroke ? { stroke } : null),
    };
    entry.push({ op: 'placeObject', kind: 'pattern', item });
    id ??= item.id;
  };

  stampAt(originX, originY, cell);
  // The primary refusing (locked) or landing exactly what is already there
  // makes the whole tap a no-op — partners must not drift away from a
  // primary that did not change.
  if (entry.length === 0) return null;
  for (const p of sym?.partners ?? []) {
    stampAt(p.x, p.y, mirrorCellState(cell, p.mH, p.mV, p.rot));
  }
  return { entry, id };
}

/** The existing pattern objects the stamped box — a single cell, or a
 *  freshly dragged region's whole rect — can JOIN, nearest first:
 *  unlocked, ungrouped, not hidden, axis-aligned, their grid at the SAME
 *  step and in phase with the box — and either TOUCHING it (edge, corner,
 *  or overlap) or, when the gesture's `view` is given, showing somewhere
 *  in it. On-screen is the reach the tool works at: a pattern the user can
 *  SEE at this resolution is the pattern they are adding to, however far
 *  across the view it sits, while a hidden or scrolled-away one is left
 *  alone (touching still joins without a view — the pure callers' rule).
 *  A box fully inside such an object never reaches here — a cell takes the
 *  edit-in-place path in buildPlaceTile. Grouped objects are left alone:
 *  absorbing one would have to re-place it outside its frame, which is a
 *  bigger intervention than a tile stamp should make. */
/**
 * Does the stamp box (`x`, `y`, `w`, `h`, on `step` cells) TOUCH `p` — is
 * any of its cells edge-adjacent to a cell `p` actually holds a tile in?
 *
 * Cells, not boxes. A pattern's box is the bounding box of its filled
 * cells and can be mostly empty (a diagonal run, an L), so two boxes can
 * abut across a corner where no two tiles do. "Touching" is what the
 * merge rule is written in — two patterns whose cells share an edge are
 * one pattern — so it is what this asks.
 *
 * Diagonals are not touching: a corner is not an edge, and the tile
 * connectivity the whole tool is built on joins across edges alone.
 */
function stampTouchesPattern(
  p: PatternObject,
  x: number,
  y: number,
  w: number,
  h: number,
  step: number,
): boolean {
  const cols = Math.max(1, Math.round(w / step));
  const rows = Math.max(1, Math.round(h / step));
  const colOf = (wx: number) => Math.round((wx - p.cellX) / step);
  const rowOf = (wy: number) => Math.round((wy - p.cellY) / step);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const col = colOf(x + cx * step);
      const row = rowOf(y + cy * step);
      if (patternCellAt(p, col - 1, row) != null) return true;
      if (patternCellAt(p, col + 1, row) != null) return true;
      if (patternCellAt(p, col, row - 1) != null) return true;
      if (patternCellAt(p, col, row + 1) != null) return true;
    }
  }
  return false;
}

/**
 * The pattern object a stamp at (`x`, `y`) may join — at most one, and
 * only ever the EDITABLE one: same grid step, same lattice phase, unlocked
 * and loose, and TOUCHING, a cell of the stamp sharing an edge with a cell
 * the pattern holds.
 *
 * Reach used to be the whole question here — every compatible pattern on
 * screen, then every compatible pattern TOUCHING — and the answer was
 * always "grow it". Both readings grew a grid the user never asked to
 * change: a stroke laid alongside an old pattern absorbed it, and a line
 * of tiles drawn between two patterns welded them into one. Editing is
 * opt-in now, so the question is no longer which grids are near but which
 * grid is OPEN: stamps join the pattern wearing the double border, and
 * everything else on the page is left exactly as it is.
 *
 * A list rather than a single value because the merge walks the ways a
 * group can grow; with one editable object it holds 0 or 1 entries.
 */
function findJoinableTilePatterns(
  state: CompositionState,
  x: number,
  y: number,
  w: number,
  h: number,
  step: number,
  exclude: ReadonlySet<string>,
  editableId: string | null | undefined,
): PatternObject[] {
  if (!editableId) return [];
  const eps = step * 1e-6 + 1e-9;
  const found: PatternObject[] = [];
  for (const p of state.patternObjects ?? []) {
    if (p.id !== editableId) continue;
    if (p.hidden || p.locked || p.groupId != null) continue;
    if (exclude.has(p.id) || !patternGridIsAxisAligned(p)) continue;
    if (Math.abs(p.cellWidth / p.cols - step) > eps) continue;
    if (Math.abs(p.cellHeight / p.rows - step) > eps) continue;
    const phaseX = (x - p.cellX) / step;
    const phaseY = (y - p.cellY) / step;
    if (Math.abs(phaseX - Math.round(phaseX)) > 1e-6) continue;
    if (Math.abs(phaseY - Math.round(phaseY)) > 1e-6) continue;
    const inside = x >= p.cellX - eps && x + w <= p.cellX + p.cellWidth + eps
      && y >= p.cellY - eps && y + h <= p.cellY + p.cellHeight + eps;
    if (inside) continue;
    if (!stampTouchesPattern(p, x, y, w, h, step)) continue;
    found.push(p);
  }
  return found;
}

/**
 * Consolidate a Tile gesture's accumulated ops so ONE gesture leaves (or
 * edits) ONE object. The freshly placed 1×1 tiles merge into a single
 * multi-cell PatternObject covering their bounding box (stamped cells
 * filled, the rest null — the same sparse grid a pattern region carries);
 * and the EDITABLE pattern (`editableId`), where the stamps TOUCH it — a
 * stamped cell sharing an edge with a cell it holds — is absorbed into it:
 * cells, id, stroke dress and z-order carried into the grown grid,
 * together with any same-gesture re-rolls of those cells, as one
 * removeObject + placeObject swap in the same undo step.
 *
 * ONLY the editable pattern is ever absorbed. Every compatible pattern in
 * reach used to be — first any showing on screen, later any the stamps
 * touched — so a stroke laid beside an old grid swallowed it and a line of
 * tiles between two patterns welded them into one, neither of which anyone
 * had asked for. A pattern is opened for editing by hand now (the Edit
 * capsule, the double border), and that is the only grid a gesture may
 * grow. Re-rolls of objects that were NOT absorbed pass through untouched.
 *
 * A pattern grid tops out at MAX_PATTERN_GRID cells per axis, and a
 * symmetry orbit's partners land far across the frame, so one box cannot
 * always hold everything. Stamps therefore group GREEDILY, in stroke
 * order, into as few grid-sized boxes as fit: a plain drag makes exactly
 * one object; a mirrored drag makes one per orbit region (each free to
 * absorb ITS neighbour); an absorb only happens while the union still
 * fits the cap; only a stroke spanning more than 16 cells splits, at the
 * cap the pattern kind itself imposes.
 *
 * The entry's selection id follows the merge: a stamp id that dissolved
 * into a group re-points at the group's surviving object.
 *
 * Placed items need not be 1×1: a pattern-tool REGION (buildPlacePattern —
 * one multi-cell grid plus its flood-fill edits) consolidates by the same
 * rule, so dragging out a region beside an existing compatible pattern
 * grows THAT object rather than leaving a second one. Its flood edits are
 * folded into the grown grid along with everything else, since the id they
 * target retires in the swap.
 */
export function mergeTileStrokeOps(
  state: CompositionState,
  se: SessionEntry,
  /** The pattern in edit mode — the only pre-existing object a gesture may
   *  absorb. Omitted (the creating case), the gesture's own stamps still
   *  consolidate into one object and nothing already on the page is
   *  touched. */
  editableId?: string | null,
): SessionEntry {
  const placed: PatternObject[] = [];
  const rest: SessionEntry['entry'] = [];
  for (const op of se.entry) {
    if (op.op === 'placeObject' && op.kind === 'pattern') placed.push(op.item as PatternObject);
    else rest.push(op);
  }
  if (placed.length === 0) return se;

  interface Group {
    minX: number; minY: number; maxX: number; maxY: number;
    items: PatternObject[];
    /** Every pre-existing pattern this group swallowed, in scene order.
     *  More than one when the stamps bridge neighbours. */
    absorbed: PatternObject[];
  }
  const groups: Group[] = [];
  const absorbedIds = new Set<string>();
  for (const item of placed) {
    // A placed item is usually a 1×1 stamp, but a pattern-tool region
    // arrives as one multi-cell grid — its step is the grid's own.
    const step = item.cellWidth / item.cols;
    const cap = MAX_PATTERN_GRID * step;
    let g = groups.find((grp) =>
      Math.max(grp.maxX, item.cellX + item.cellWidth) - Math.min(grp.minX, item.cellX) <= cap
      && Math.max(grp.maxY, item.cellY + item.cellHeight) - Math.min(grp.minY, item.cellY) <= cap);
    if (!g) {
      g = {
        minX: item.cellX, minY: item.cellY,
        maxX: item.cellX + item.cellWidth, maxY: item.cellY + item.cellHeight,
        items: [], absorbed: [],
      };
      groups.push(g);
    }
    g.minX = Math.min(g.minX, item.cellX);
    g.minY = Math.min(g.minY, item.cellY);
    g.maxX = Math.max(g.maxX, item.cellX + item.cellWidth);
    g.maxY = Math.max(g.maxY, item.cellY + item.cellHeight);
    g.items.push(item);
    // A stamp in reach of a pre-existing pattern object turns the group
    // into an edit of it — the nearest joinable one whose union with the
    // group still fits one pattern grid wins; past the cap the
    // next-nearest gets its chance.
    // EVERY touching neighbour, not just the first: a stamp laid between
    // two patterns is what joins them, and taking only one would leave the
    // other sitting against the seam as a separate object.
    for (const p of findJoinableTilePatterns(
      state, item.cellX, item.cellY, item.cellWidth, item.cellHeight, step,
      absorbedIds, editableId,
    )) {
      if (Math.max(g.maxX, p.cellX + p.cellWidth) - Math.min(g.minX, p.cellX) > cap
        || Math.max(g.maxY, p.cellY + p.cellHeight) - Math.min(g.minY, p.cellY) > cap) {
        continue;
      }
      g.absorbed.push(p);
      absorbedIds.add(p.id);
      g.minX = Math.min(g.minX, p.cellX);
      g.minY = Math.min(g.minY, p.cellY);
      g.maxX = Math.max(g.maxX, p.cellX + p.cellWidth);
      g.maxY = Math.max(g.maxY, p.cellY + p.cellHeight);
    }
  }

  // Nothing to consolidate — the tap/stroke left a single fresh tile and
  // touched no neighbour: hand the entry back untouched.
  if (groups.length === placed.length && absorbedIds.size === 0) return se;

  // Same-gesture edits of an object about to be swapped out fold into the
  // grown grid instead of riding as separate ops: re-rolls of an ABSORBED
  // object's cells, and a region's own flood fill (buildPlacePattern
  // places the empty grid and floods it by id — an id the rebuild
  // retires whenever the region merges into a group).
  const rebuiltIds = new Set(absorbedIds);
  for (const g of groups) {
    if (g.absorbed.length > 0 || g.items.length > 1) {
      for (const it of g.items) rebuiltIds.add(it.id);
    }
  }
  const folded = new Map<string, { index: number; newState: CellState | null }[]>();
  const keptRest: SessionEntry['entry'] = [];
  for (const op of rest) {
    if (op.op === 'editPatternCells' && rebuiltIds.has(op.patternId)) {
      const list = folded.get(op.patternId) ?? [];
      for (const e of op.edits) list.push({ index: e.index, newState: e.newState ?? null });
      folded.set(op.patternId, list);
    } else {
      keptRest.push(op);
    }
  }

  const removals = absorbedIds.size > 0
    ? buildRemoveObjectOps(state, groups.flatMap((g) => g.absorbed.map((p) => p.id)))
    : [];

  const placements: SessionEntry['entry'] = groups.map((g) => {
    if (g.absorbed.length === 0 && g.items.length === 1) {
      return { op: 'placeObject', kind: 'pattern', item: g.items[0] };
    }
    const step = g.items[0].cellWidth / g.items[0].cols;
    const cols = Math.round((g.maxX - g.minX) / step);
    const rows = Math.round((g.maxY - g.minY) / step);
    const cells: (CellState | null)[] = new Array(cols * rows).fill(null);
    const put = (x: number, y: number, c: CellState | null) => {
      cells[Math.round((y - g.minY) / step) * cols + Math.round((x - g.minX) / step)] = c;
    };
    // The absorbed neighbours first, back to front — the stamps lay over
    // them below, as the gesture did on the page.
    for (const p of g.absorbed) {
      for (let i = 0; i < p.cells.length; i++) {
        put(p.cellX + (i % p.cols) * step, p.cellY + Math.floor(i / p.cols) * step, p.cells[i] ?? null);
      }
      for (const e of folded.get(p.id) ?? []) {
        put(p.cellX + (e.index % p.cols) * step, p.cellY + Math.floor(e.index / p.cols) * step, e.newState);
      }
    }
    for (const item of g.items) {
      // A multi-cell item (a region) lays its whole grid; its EMPTY slots
      // write nothing, so an overlap never erases what an absorbed
      // neighbour already holds there. Its folded edits — the flood that
      // targeted the region's now-retired id — land after, at the same
      // translation.
      for (let i = 0; i < item.cells.length; i++) {
        const c = item.cells[i] ?? null;
        if (c == null) continue;
        put(item.cellX + (i % item.cols) * step, item.cellY + Math.floor(i / item.cols) * step, c);
      }
      for (const e of folded.get(item.id) ?? []) {
        put(
          item.cellX + (e.index % item.cols) * step,
          item.cellY + Math.floor(e.index / item.cols) * step,
          e.newState,
        );
      }
    }
    // The surviving object is the back-most neighbour it swallowed — its
    // id, its dress, its seat in the stack — or, absorbing none, the
    // group's own first stamp.
    const base = g.absorbed[0] ?? g.items[0];
    const item: PatternObject = {
      ...(g.absorbed[0] ?? null),
      id: base.id,
      cellX: g.minX,
      cellY: g.minY,
      cellWidth: cols * step,
      cellHeight: rows * step,
      cols,
      rows,
      cells,
      ...(base.stroke ? { stroke: base.stroke } : null),
    };
    // An absorbed object keeps its place in the stack — the swap re-enters
    // sceneOrder where the removal took it out.
    const orderIndex = g.absorbed.length > 0 ? state.sceneOrder.indexOf(g.absorbed[0].id) : -1;
    return {
      op: 'placeObject', kind: 'pattern', item,
      ...(orderIndex >= 0 ? { sceneOrderIndex: orderIndex } : null),
    };
  });

  let id = se.id;
  if (id != null) {
    const home = groups.find((grp) => grp.items.some((it) => it.id === id));
    if (home) id = (home.absorbed[0] ?? home.items[0]).id;
  }
  return { ...se, entry: [...keptRest, ...removals, ...placements], id };
}
