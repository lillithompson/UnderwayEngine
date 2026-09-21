/**
 * A closed shape's PATTERN fill (v67+): the tile that REPEATS inside its
 * own outline — {@link SVGObject.patternFill}.
 *
 * A fill is one square tile — `size × size` cells, the Pattern page's Size
 * slider — laid over and over across the shape's box and clipped to its
 * outline. It is not a grid stretched to fit: a bigger shape shows more
 * copies, and the Size slider changes how many CELLS one copy holds, so
 * the cells keep their size and the repeat grows around them.
 *
 * The tile is the pattern kind's own grid, not a second one. Everything
 * about WHERE a pattern sits — box, quarter turn, mirrors, opacity, fade —
 * the shape already says, so a fill stores none of it; `shapePatternGrid`
 * dresses the stored tile as the {@link PatternObject} the rest of the
 * engine already knows how to bake, mirror, reconcile and stamp into: a
 * `tileMode: 'repeat'` object whose region is the shape's box and whose id
 * is the SHAPE's. That id is the whole trick — the ops address a grid by
 * id (`editPatternCells`), the tile tool carries a world point into a
 * grid's frame through the scene graph by id, and the shape is the node
 * that frame belongs to — so a fill is worked by the same code a loose
 * pattern object is, with no parallel path to drift from it. Repeat mode
 * is also why ONE stamp changes every copy: `patternCellAtWorldPoint`
 * wraps the press into the tile.
 *
 * Two things are deliberately NOT here.
 *
 * The BAKE — `shapePatternFillTiles` sits beside the bake it calls, in
 * patternObjectRender.ts: this module is imported by compositionOps, and
 * the bake's own import chain reaches back into compositionOps, which is
 * the cycle that put that file beside patternObject.ts in the first place.
 *
 * The CLIP — a pattern fill is clipped to the same closed outline the
 * solid fill paints, corner rounding and all, and that outline is built
 * where the fill is drawn (`shapePatternFillMarkup`, in svgPathBuilder.ts,
 * which both renderers wrap the tiles with).
 */

import {
  CompositionState,
  PatternObject,
  PatternSymmetry,
  RGBColor,
  ShapePatternFill,
  SVGObject,
} from './types';
import { patternFloodEdits } from './patternObject';
import { SVG_UNITS_PER_L0_CELL } from './svgExport';
import { strokeScaleForUnits, svgStrokeWidthCells } from './svgStroke';

/** The Size slider's range: one repeat holds 1×1 to 8×8 cells. */
export const MIN_SHAPE_PATTERN_SIZE = 1;
export const MAX_SHAPE_PATTERN_SIZE = 8;

/** What a fresh pattern opens at. A 2×2 tile reads as a PATTERN at first
 *  sight — it has an inside to answer itself across, and every mirror mode
 *  has something to mirror — where a 1×1 is one tile stamped everywhere. */
export const DEFAULT_SHAPE_PATTERN_SIZE = 2;

/**
 * How many pattern CELLS a fresh fill lays across one square of the
 * composition's grid: two, so its tiles are drawn at TWICE the grid's own
 * resolution.
 *
 * It is what makes the Size slider's number read as a count of repeats
 * rather than of grid squares: at 2 cells per square, a 2×2 tile spans one
 * square, so a shape two squares across shows the pattern twice. (The
 * pattern TOOL's dragged region is one cell per square — a region is a
 * patch of grid, where a fill is a motif inside a shape.)
 */
export const SHAPE_PATTERN_CELLS_PER_GRID = 2;

/** `size` clamped into the slider's range and made whole. */
export function clampShapePatternSize(size: number): number {
  return Math.max(
    MIN_SHAPE_PATTERN_SIZE,
    Math.min(MAX_SHAPE_PATTERN_SIZE, Math.round(size) || MIN_SHAPE_PATTERN_SIZE),
  );
}

/** What ONE CELL of the fill spans on the page, in world cells — the tile
 *  divided by its own edge. The quantity the Size slider holds still while
 *  it changes how many of them a repeat is made of. */
export function shapePatternCellL0(fill: ShapePatternFill): number {
  return fill.tileL0 / Math.max(1, fill.size);
}

/**
 * The line the TILES are drawn in: HALF the shape's own, so the pattern
 * reads as the finer mark inside the outline that frames it — and follows
 * it, since it is derived at every draw rather than seeded once. Move the
 * Stroke page's Width and the pattern thins with it.
 *
 * Half the composition's default for a shape drawing NO outline (its
 * stroke removed, width 0): half of nothing is nothing, and a pattern that
 * vanished because the frame around it did would read as a bug.
 *
 * `strokeScale` is the composition-wide one; omitted (a swatch thumbnail,
 * the hit tests) it stands at 1, which is the shape's own authored width
 * wherever there is one.
 */
export const SHAPE_PATTERN_STROKE_FRACTION = 0.5;

function tileStrokeWidth(svg: SVGObject, strokeScale: number): number {
  const u = SVG_UNITS_PER_L0_CELL;
  const scaled = strokeScaleForUnits(strokeScale, u);
  const own = svgStrokeWidthCells(svg, scaled, u);
  const width = own > 0 ? own : svgStrokeWidthCells({ stroke: undefined }, scaled, u);
  return width * SHAPE_PATTERN_STROKE_FRACTION;
}

/**
 * The stored tile dressed as a {@link PatternObject} — what every
 * grid-taking function in the engine wants. Null when the shape carries no
 * fill.
 *
 * A repeating one: the REGION is the shape's own box and the tile is
 * `tileL0` square, phased so a whole copy sits centred on the region (the
 * partial copies then fall symmetrically at all four edges instead of the
 * lattice being pinned to the top-left corner).
 *
 * NO pose of its own: the cells are laid in the shape's frame and the
 * shape's node matrix carries the turn, the mirrors and the lean, so
 * handing the bake a rotation here would apply it twice.
 *
 * `gx` / `gy` are what the drawn geometry took OUT of that matrix and
 * folded into the vertices (sceneDrawnContent's `growX` / `growY`) — a tile
 * is a world length like a stroke width, so it has to grow with them or a
 * shape inside a scaled group would repeat at the wrong size. Omitted (the
 * hit tests, which ask in world coordinates) they stand at 1.
 *
 * The tiles' own line is derived here too, at half the shape's
 * ({@link tileStrokeWidth}), which is why `strokeScale` comes along.
 *
 * Cached per fill block so `patternSVGView`'s own per-object cache hits:
 * the block is immutable per edit (every op replaces it), which makes it
 * exactly the right key.
 */
const grids = new WeakMap<ShapePatternFill, { key: string; grid: PatternObject }>();

export function shapePatternGrid(
  svg: SVGObject,
  opts?: { gx?: number; gy?: number; strokeScale?: number },
): PatternObject | null {
  const fill = svg.patternFill;
  if (!fill) return null;
  const gx = opts?.gx ?? 1;
  const gy = opts?.gy ?? 1;
  const strokeWidth = tileStrokeWidth(svg, opts?.strokeScale ?? 1);
  // The box is the shape's, and it moves (a drag, a resize, a group's
  // scale) while the block stays the very same object — so it is part of
  // the cache key, not just of the value. The tiles' line rides the SHAPE's
  // stroke, so it is keyed too.
  const key = `${svg.id}|${svg.cellX}|${svg.cellY}|${svg.cellWidth}|${svg.cellHeight}`
    + `|${gx}|${gy}|${strokeWidth}`;
  const hit = grids.get(fill);
  if (hit && hit.key === key) return hit.grid;
  const tileWidthL0 = fill.tileL0 * gx;
  const tileHeightL0 = fill.tileL0 * gy;
  const grid: PatternObject = {
    id: svg.id,
    cellX: svg.cellX,
    cellY: svg.cellY,
    cellWidth: svg.cellWidth,
    cellHeight: svg.cellHeight,
    cols: fill.size,
    rows: fill.size,
    cells: fill.cells,
    tileMode: 'repeat',
    tileWidthL0,
    tileHeightL0,
    tileOffsetXL0: (svg.cellWidth - tileWidthL0) / 2,
    tileOffsetYL0: (svg.cellHeight - tileHeightL0) / 2,
    ...(fill.symmetry ? { symmetry: fill.symmetry } : null),
    ...(fill.allowBorderConnections === false ? { allowBorderConnections: false } : null),
    // The fill's own block carries the dash and the rest; the WIDTH is the
    // shape's half, whatever is stored.
    stroke: { ...fill.stroke, width: strokeWidth },
  };
  grids.set(fill, { key, grid });
  return grid;
}

/** The fill block a grid's cells stand for — the way back from
 *  {@link shapePatternGrid}, for an op that ran the tile through the
 *  pattern machinery and has a new {@link PatternObject} in hand. Only the
 *  CELLS and the settings cross back: the box, the region and the tile's
 *  own geometry are the shape's and the slider's, not the grid's to
 *  move. */
export function shapePatternFillOf(
  fill: ShapePatternFill, grid: PatternObject,
): ShapePatternFill {
  const next: ShapePatternFill = { ...fill, cells: grid.cells };
  if (grid.symmetry) next.symmetry = grid.symmetry; else delete next.symmetry;
  if (grid.allowBorderConnections === false) next.allowBorderConnections = false;
  else delete next.allowBorderConnections;
  if (grid.stroke) next.stroke = grid.stroke; else delete next.stroke;
  return next;
}

/** True when the tile has nothing in it — it then draws nothing at all,
 *  which is what a freshly added fill looks like until something paints
 *  into it. */
export function shapePatternFillIsEmpty(fill: ShapePatternFill | undefined): boolean {
  return !fill || !fill.cells.some((c) => c != null);
}

/**
 * A fresh pattern fill for `svg`: a `size × size` tile drawn at twice the
 * composition grid's resolution — `step` is one grid square, and a cell is
 * {@link SHAPE_PATTERN_CELLS_PER_GRID} to the square. So a 2×2 tile spans
 * ONE square, and a shape two squares across repeats it twice; the tiles
 * still land on the lattice everything else is drawn on, at half its
 * pitch.
 *
 * `flood` fills it with connectivity-respecting random tiles under
 * `symmetry`, in the ink `tint` — which is what makes an added pattern
 * arrive as a PATTERN rather than as an empty tile drawing nothing.
 *
 * No line weight is seeded: the tiles are drawn at half the SHAPE's,
 * derived at every draw ({@link tileStrokeWidth}), so there is nothing
 * here to go stale when the Stroke page moves.
 */
export function buildShapePatternFill(
  svg: SVGObject,
  step: number,
  opts?: {
    size?: number;
    symmetry?: PatternSymmetry;
    flood?: boolean;
    excludedFamilies?: Set<string>;
    tint?: RGBColor | null;
  },
): ShapePatternFill {
  const size = clampShapePatternSize(opts?.size ?? DEFAULT_SHAPE_PATTERN_SIZE);
  const fill: ShapePatternFill = {
    size,
    cells: new Array(size * size).fill(null),
    tileL0: size * ((step > 0 ? step : 1) / SHAPE_PATTERN_CELLS_PER_GRID),
    ...(opts?.symmetry ? { symmetry: opts.symmetry } : null),
  };
  if (!opts?.flood) return fill;
  const grid = shapePatternGrid({ ...svg, patternFill: fill });
  if (!grid) return fill;
  const edits = patternFloodEdits(grid, { kind: 'random' }, opts.excludedFamilies, opts.tint);
  if (edits.length === 0) return fill;
  const cells = fill.cells.slice();
  for (const e of edits) cells[e.index] = e.newState;
  return { ...fill, cells };
}

/**
 * The same fill at a new tile SIZE — what the Pattern page's slider
 * commits.
 *
 * The cells keep the size they are drawn at ({@link shapePatternCellL0}),
 * so the repeat grows or shrinks AROUND them rather than the art being
 * scaled: that is what "a 2 makes a 2×2 pattern" means on the page.
 *
 * The tile is RE-ROLLED at its new size — a fresh connectivity-respecting
 * flood under the fill's own mirror, in `tint`. A size change is a change
 * of motif, not a crop: carrying the old cells into a bigger tile left
 * their pattern sitting in one corner of it (and into a smaller one, a
 * cropped quarter of what was there). The slider is a way of trying sizes,
 * so each one hands back a finished pattern. Returns the same object when
 * the size is unchanged, so a slider that lands where it started commits
 * nothing.
 */
export function resizeShapePatternFill(
  fill: ShapePatternFill,
  size: number,
  opts?: { excludedFamilies?: Set<string>; tint?: RGBColor | null },
): ShapePatternFill {
  const next = clampShapePatternSize(size);
  if (next === fill.size) return fill;
  const resized: ShapePatternFill = {
    ...fill,
    size: next,
    cells: new Array(next * next).fill(null),
    tileL0: shapePatternCellL0(fill) * next,
  };
  // The flood needs a box to reason about; only the CELLS are being asked
  // for, and connectivity reads the grid rather than the page, so a bare
  // unit square does.
  const box = { id: 'fill', cellX: 0, cellY: 0, cellWidth: next, cellHeight: next } as SVGObject;
  const grid = shapePatternGrid({ ...box, patternFill: resized });
  if (!grid) return resized;
  const edits = patternFloodEdits(grid, { kind: 'random' }, opts?.excludedFamilies, opts?.tint);
  if (edits.length === 0) return resized;
  const cells = resized.cells.slice();
  for (const e of edits) cells[e.index] = e.newState;
  return { ...resized, cells };
}

// ── Reading and writing a fill on the scene ─────────────────────────

/** `svg` with `fill` as its pattern fill, or with none when `fill` is
 *  undefined — the one place the field is set, so an absent pattern is
 *  always an ABSENT field rather than an empty block. */
export function withShapePatternFill(
  svg: SVGObject, fill: ShapePatternFill | undefined,
): SVGObject {
  if (!fill) {
    if (!svg.patternFill) return svg;
    const next = { ...svg };
    delete next.patternFill;
    return next;
  }
  return { ...svg, patternFill: fill };
}

/** The shape whose pattern fill `patternId` names — a grid addressed by
 *  its SHAPE's id (see the module note) — or undefined when the id is a
 *  loose pattern object's, or nothing's. */
export function shapeHoldingPatternGrid(
  state: CompositionState, patternId: string,
): SVGObject | undefined {
  return state.svgObjects.find((s) => s.id === patternId && s.patternFill != null);
}

/**
 * Run a shape's pattern fill through a function that speaks
 * {@link PatternObject} — the pattern machinery's own currency — and put
 * the result back as a fill. The state is returned untouched when
 * `patternId` names no patterned shape, so a caller may ask without
 * checking first.
 */
export function mapShapePatternGrid(
  state: CompositionState,
  patternId: string,
  edit: (grid: PatternObject) => PatternObject,
): CompositionState {
  let touched = false;
  const svgObjects = state.svgObjects.map((s) => {
    if (s.id !== patternId || !s.patternFill) return s;
    const grid = shapePatternGrid(s);
    if (!grid) return s;
    touched = true;
    return { ...s, patternFill: shapePatternFillOf(s.patternFill, edit(grid)) };
  });
  return touched ? { ...state, svgObjects } : state;
}
