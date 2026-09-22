/**
 * A closed shape's PATTERN fill (v67+): the tile that REPEATS inside its
 * own outline — {@link SVGObject.patternFill}.
 *
 * A fill is one square tile — `size × size` cells, the Pattern page's
 * RESOLUTION slider — laid over and over across the shape's box and
 * clipped to its outline. It is not a grid stretched to fit: a bigger
 * shape shows more copies.
 *
 * The page asks two independent questions about that tile. Resolution is
 * how finely one repeat is cut (`size`): raising it holds the repeat where
 * it is and cuts it into smaller cells. SIZE is how big the repeat itself
 * draws (`tileL0`, {@link setShapePatternSpan}), in tenths of the shape's
 * own width — 10 is one repeat across the whole of it, 1 is ten repeats:
 * moving it scales the whole motif, cells and all, and leaves the cell
 * count alone. The two stored numbers are the two sliders, one each, so
 * moving either leaves the other's handle exactly where it stood.
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

/** The RESOLUTION slider's range: one repeat holds 1×1 to 8×8 cells. */
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
 * It is the CREATION pitch only — a fresh fill lands on the lattice the
 * rest of the page is drawn to, at half its pitch, so a seeded pattern
 * lines up with the drawing around it. What the Size row then says about
 * that tile is measured against the SHAPE, not against this
 * ({@link shapePatternSpanOfWidth}). (The pattern TOOL's dragged region is
 * one cell per square — a region is a patch of grid, where a fill is a
 * motif inside a shape.)
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
 *  divided by its own edge. Derived from both sliders and stored by
 *  neither: Resolution changes it by changing the count, Size by changing
 *  the repeat. */
export function shapePatternCellL0(fill: ShapePatternFill): number {
  return fill.tileL0 / Math.max(1, fill.size);
}

/**
 * The SIZE slider's range: 1 to 10, in whole steps, read as TENTHS of the
 * width of the shape being filled.
 *
 * 10 is one repeat across the whole shape — the motif drawn once, as big
 * as the area it fills. 1 is a repeat a tenth of that width, so ten of
 * them step across it. Every number in between is that fraction: 5 is
 * half the width, two repeats across.
 *
 * Measured against the SHAPE rather than against the page's grid, because
 * what a pattern looks like is how many times it repeats inside the
 * outline you can see — a repeat that reads as fine cloth in a big patch
 * reads as two big blobs in a small one, at the very same number of grid
 * squares. Whole tenths keep the row's ten stops nameable; the tile
 * lattice no longer needs to be a sub-lattice of the page's, the shape's
 * own edges being what a fill is measured and clipped by.
 *
 * What is STORED is still absolute world cells ({@link ShapePatternFill}'s
 * `tileL0`), so resizing a patterned shape lays more or fewer copies
 * rather than stretching the one — and the row then reads the new
 * fraction, which is the truth about the pattern, it having not moved.
 */
export const MIN_SHAPE_PATTERN_SPAN = 1;
export const MAX_SHAPE_PATTERN_SPAN = 10;
export const SHAPE_PATTERN_SPAN_STEP = 1;

/** The slider's top, which is also its unit: a span of N means N/10 of the
 *  shape's width, so MAX is the whole of it. One name for the two, so the
 *  "1 means a tenth" rule cannot drift from the range that states it. */
export const SHAPE_PATTERN_SPAN_SCALE = MAX_SHAPE_PATTERN_SPAN;

/** Where the row sits for a fill whose tile says nothing readable — a
 *  fifth of the shape, five repeats across. Only the clamp's fallback for
 *  a non-finite number; a real fill's span is read off its tile. */
export const DEFAULT_SHAPE_PATTERN_SPAN = 2;

/** `span` clamped into the Size slider's range and put on its step. */
export function clampShapePatternSpan(span: number): number {
  const stepped = Math.round((Number.isFinite(span) ? span : DEFAULT_SHAPE_PATTERN_SPAN)
    / SHAPE_PATTERN_SPAN_STEP) * SHAPE_PATTERN_SPAN_STEP;
  return Math.max(MIN_SHAPE_PATTERN_SPAN, Math.min(MAX_SHAPE_PATTERN_SPAN, stepped));
}

/**
 * Where the Size row's handle sits for a fill inside a shape `widthL0`
 * wide: the repeat as tenths of that width, on the slider's own step.
 *
 * The other half of the pair the Pattern page asks about a tile.
 * RESOLUTION (`size`) is how finely the repeat is cut; SIZE is how big it
 * draws. The two are independent: moving one leaves the other where it is.
 *
 * `widthL0` is the shape's own box width in world cells — its local frame,
 * the same one the tile is laid in, so a group's scale (which carries both)
 * cannot change the number. Clamped, so a tile finer or coarser than the
 * row can say still seats the handle at an end of the track rather than
 * off it.
 */
export function shapePatternSpanOfWidth(fill: ShapePatternFill, widthL0: number): number {
  const width = widthL0 > 0 ? widthL0 : 1;
  return clampShapePatternSpan((fill.tileL0 / width) * SHAPE_PATTERN_SPAN_SCALE);
}

/**
 * The same fill with its repeat at a new SPAN — what the Pattern page's
 * Size slider commits: `span` tenths of the shape's width, written down as
 * the absolute tile the fill stores.
 *
 * The CELLS are untouched, unlike a resolution change
 * ({@link resizeShapePatternFill}, which re-rolls): the same motif at a
 * different scale is still that motif, so there is nothing to re-roll and
 * a slider swept back and forth hands back exactly what it started with.
 * Only `tileL0` moves, and each cell moves with it
 * ({@link shapePatternCellL0} is derived, never stored).
 *
 * Returns the same object when the span is unchanged, so a slider that
 * lands where it started commits nothing.
 */
export function setShapePatternSpan(
  fill: ShapePatternFill, span: number, widthL0: number,
): ShapePatternFill {
  const width = widthL0 > 0 ? widthL0 : 1;
  const tileL0 = (clampShapePatternSpan(span) / SHAPE_PATTERN_SPAN_SCALE) * width;
  if (tileL0 === fill.tileL0) return fill;
  return { ...fill, tileL0 };
}

/**
 * The line the TILES OPEN in: HALF the shape's own, so the pattern reads
 * as the finer mark inside the outline that frames it.
 *
 * A STARTING POINT, not a tie. {@link buildShapePatternFill} writes this
 * number down as the fill's own width the moment the pattern is added, so
 * the shape's Stroke page and the Pattern page's Stroke tab go their
 * separate ways from there: moving the shape's outline leaves the pattern
 * inside it exactly as it was drawn. (It used to be derived at every draw
 * instead of seeded once, which made the shape's Width row move both
 * lines at the same time — the pattern had no width of its own to keep.)
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

/** The seeding width itself — and the fallback for a fill from before it
 *  was seeded, which has no width of its own to keep (see
 *  {@link shapePatternStrokeWidthCells}). */
export function derivedTileStrokeWidth(svg: SVGObject, strokeScale = 1): number {
  const u = SVG_UNITS_PER_L0_CELL;
  const scaled = strokeScaleForUnits(strokeScale, u);
  const own = svgStrokeWidthCells(svg, scaled, u);
  const width = own > 0 ? own : svgStrokeWidthCells({ stroke: undefined }, scaled, u);
  return width * SHAPE_PATTERN_STROKE_FRACTION;
}

/**
 * The width the tiles are ACTUALLY drawn at, in world cells: the fill's
 * own, which is seeded at half the shape's when the pattern is added
 * ({@link derivedTileStrokeWidth}) and moved after that only by the
 * Pattern page's Stroke tab.
 *
 * The derived value is still the fallback, for a fill stored by a build
 * that seeded no width. Such a pattern goes on following the outline that
 * frames it until something writes a width down — which the editor does
 * the first time the shape's own Width row moves, so an old page freezes
 * at what it was already drawing rather than jumping.
 *
 * Also the number that page's Width slider seeds at, so an untouched
 * pattern opens the row at the width it is being drawn with rather than
 * at zero (the same rule `svgStrokeWidthCells` keeps for an object).
 */
export function shapePatternStrokeWidthCells(
  svg: SVGObject, strokeScale = 1,
): number {
  const stored = svg.patternFill?.stroke?.width;
  return stored != null ? Math.max(0, stored) : derivedTileStrokeWidth(svg, strokeScale);
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
  const strokeWidth = shapePatternStrokeWidthCells(svg, opts?.strokeScale ?? 1);
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
    // The fill's own block carries the dash and the rest; the WIDTH is
    // resolved — the fill's where its Stroke page set one, half the
    // shape's where it did not (shapePatternStrokeWidthCells).
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
 *  move.
 *
 *  The stroke's WIDTH is the one field that does not cross back. The grid
 *  carries a RESOLVED width — the fill's own where it has one, half the
 *  shape's where it does not — so copying the grid's block wholesale would
 *  write that resolved number down as the fill's, and the first cell
 *  anyone painted would silently freeze a pattern to the width the shape
 *  happened to be at. The fill keeps its own answer (including having
 *  none), and everything else about the line comes from the grid. */
export function shapePatternFillOf(
  fill: ShapePatternFill, grid: PatternObject,
): ShapePatternFill {
  const next: ShapePatternFill = { ...fill, cells: grid.cells };
  if (grid.symmetry) next.symmetry = grid.symmetry; else delete next.symmetry;
  if (grid.allowBorderConnections === false) next.allowBorderConnections = false;
  else delete next.allowBorderConnections;
  const stroke = grid.stroke
    ? { ...grid.stroke, ...(fill.stroke?.width != null ? { width: fill.stroke.width } : null) }
    : undefined;
  if (stroke && fill.stroke?.width == null) delete stroke.width;
  if (stroke && Object.keys(stroke).length > 0) next.stroke = stroke; else delete next.stroke;
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
 * The page's Size row then reads that tile against the SHAPE rather than
 * against the grid ({@link shapePatternSpanOfWidth}), so where its handle
 * opens depends on how big the shape is — a fresh fill in a small shape
 * opens nearer the top of the row than the same fill in a large one,
 * which is what the row is for.
 *
 * `flood` fills it with connectivity-respecting random tiles under
 * `symmetry`, in the ink `tint` — which is what makes an added pattern
 * arrive as a PATTERN rather than as an empty tile drawing nothing.
 *
 * The line weight IS seeded, at half the shape's own
 * ({@link derivedTileStrokeWidth}, `strokeScale` the composition-wide
 * one): the pattern opens as the finer mark inside the outline that frames
 * it, and then keeps that width whatever the shape's Stroke page does
 * next. The two lines are two decisions and the Pattern page's Stroke tab
 * is where the pattern's is made.
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
    strokeScale?: number;
  },
): ShapePatternFill {
  const size = clampShapePatternSize(opts?.size ?? DEFAULT_SHAPE_PATTERN_SIZE);
  const fill: ShapePatternFill = {
    size,
    cells: new Array(size * size).fill(null),
    tileL0: size * ((step > 0 ? step : 1) / SHAPE_PATTERN_CELLS_PER_GRID),
    stroke: { width: derivedTileStrokeWidth(svg, opts?.strokeScale ?? 1) },
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
 * The same fill at a new RESOLUTION — what the Pattern page's Resolution
 * slider commits. (Its SIZE slider is {@link setShapePatternSpan}, which
 * moves the other quantity and keeps this one.)
 *
 * The REPEAT is held still and cut finer or coarser inside it: `tileL0` is
 * untouched, so each cell shrinks as the count grows
 * ({@link shapePatternCellL0} is derived from the two). That is what makes
 * the page's two sliders independent — Resolution moves the cell count and
 * nothing else, Size moves the repeat and nothing else, and neither
 * handle drags the other one along. (Holding the CELL still instead grew
 * the repeat with the count, which walked the Size slider up the moment
 * Resolution was touched.)
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
    // tileL0 rides along untouched: the repeat draws exactly as big as it
    // did, only cut into a different number of cells.
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
