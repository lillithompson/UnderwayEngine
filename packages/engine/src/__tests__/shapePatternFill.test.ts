/**
 * A closed shape's pattern fill: the square tile it REPEATS, the ops that
 * write it, and the markup it draws.
 *
 * The point of the model is that a fill is NOT a second pattern
 * implementation — `shapePatternGrid` dresses the stored block as the
 * PatternObject the rest of the engine already works in, under the
 * SHAPE's own id, so the cell ops address it exactly as they address a
 * loose pattern object. These pin that: the derivation, both directions
 * of both ops, and that the tiles come out clipped to the shape rather
 * than square across its box.
 */

import { applyCompOps, revertCompOps } from '../compositionOps';
import { patternApplyToolAt } from '../patternObject';
import { patternGridThumbnailUri, shapePatternFillTiles } from '../patternObjectRender';
import {
  DEFAULT_SHAPE_PATTERN_SIZE,
  MAX_SHAPE_PATTERN_SIZE,
  MAX_SHAPE_PATTERN_SPAN,
  MIN_SHAPE_PATTERN_SIZE,
  MIN_SHAPE_PATTERN_SPAN,
  buildShapePatternFill,
  clampShapePatternSpan,
  resizeShapePatternFill,
  setShapePatternSpan,
  shapePatternCellL0,
  shapePatternSpanOfWidth,
  shapePatternStrokeWidthCells,
  shapePatternFillIsEmpty,
  shapePatternFillOf,
  shapePatternGrid,
  withShapePatternFill,
} from '../shapePatternFill';
import { buildClosedFillPathD, buildSVGObjectContent, svgEnclosesArea } from '../svgPathBuilder';
import {
  CellState,
  CompositionState,
  CompUndoOp,
  DEFAULT_TRANSFORM,
  PathSegment,
  PatternSymmetry,
  PATTERN_SYMMETRY_OFF,
  ShapePatternFill,
  SVGObject,
  makeViewport,
} from '../types';
import { isClosedPath } from '../compositionArcMath';

const TILE = 'test/tile_00000000';
// The mocked sprite registry carries no vector source, so a cell of it
// bakes to nothing; the markup tests need a REAL tile to draw.
const DRAWN_TILE = 'angular/tile_00000001';

const spriteCell = (spriteId: string = TILE): CellState => ({
  type: 'sprite', spriteId, transform: { ...DEFAULT_TRANSFORM },
});

function rect(id: string, x: number, y: number, w: number, h: number): SVGObject {
  return {
    id,
    segments: [
      { kind: 'line', start: [x, y], end: [x + w, y] },
      { kind: 'line', start: [x + w, y], end: [x + w, y + h] },
      { kind: 'line', start: [x + w, y + h], end: [x, y + h] },
      { kind: 'line', start: [x, y + h], end: [x, y] },
    ],
    color: { r: 0, g: 0, b: 0 },
    cellX: x, cellY: y, cellWidth: w, cellHeight: h,
  } as SVGObject;
}

function makeState(svgObjects: SVGObject[]): CompositionState {
  return {
    figures: [],
    svgObjects,
    groups: [],
    sceneOrder: svgObjects.map((s) => s.id),
    selectedFigureIds: new Set<string>(),
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    gridLevel: 1,
    strokeScale: 1,
    renderGeneration: 0,
  } as unknown as CompositionState;
}

function filledFill(size = 2, spriteId?: string, tileL0 = size): ShapePatternFill {
  const cells: CellState[] = new Array(size * size).fill(null);
  cells[0] = spriteCell(spriteId);
  return { size, cells, tileL0 };
}

describe('shapePatternGrid', () => {
  it('dresses the tile as a REPEATING PatternObject over the shape s box', () => {
    const svg = { ...rect('svg_1', 2, 3, 8, 6), patternFill: filledFill(4, undefined, 2) };
    const grid = shapePatternGrid(svg)!;
    // The id is the SHAPE's: it is what the ops address and what the
    // scene graph resolves the grid's frame by.
    expect(grid.id).toBe('svg_1');
    // The REGION is the shape's box; the tile is the square that repeats
    // across it, phased so a whole copy sits centred on the region.
    expect(grid).toMatchObject({
      cellX: 2, cellY: 3, cellWidth: 8, cellHeight: 6,
      cols: 4, rows: 4, tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2,
    });
    expect(grid.tileOffsetXL0).toBeCloseTo(3, 5);
    expect(grid.tileOffsetYL0).toBeCloseTo(2, 5);
    // No pose of its own — the shape's matrix carries all of it.
    expect(grid.rotation).toBeUndefined();
    expect(grid.mirrorH).toBeUndefined();
  });

  it('grows the tile with the matrix, so a scaled group keeps its repeats', () => {
    // A tile is a world length like a stroke width: the drawn geometry
    // folds the matrix's scale into the vertices, so the tile has to come
    // with them or the shape would repeat at the wrong size.
    const svg = { ...rect('svg_1', 0, 0, 8, 8), patternFill: filledFill(2, undefined, 2) };
    const grown = shapePatternGrid(svg, { gx: 3, gy: 2 })!;
    expect(grown.tileWidthL0).toBeCloseTo(6, 5);
    expect(grown.tileHeightL0).toBeCloseTo(4, 5);
  });

  it('is null for a shape with no fill', () => {
    expect(shapePatternGrid(rect('svg_1', 0, 0, 4, 4))).toBeNull();
  });

  it('hands back the same object while nothing moves, and a new one when the box does', () => {
    // The bake caches per object identity, so a pan that re-renders the
    // page must not re-bake every patterned shape on it.
    const fill = filledFill();
    const svg = { ...rect('svg_1', 0, 0, 4, 4), patternFill: fill };
    expect(shapePatternGrid(svg)).toBe(shapePatternGrid({ ...svg }));
    expect(shapePatternGrid({ ...svg, cellX: 1 })).not.toBe(shapePatternGrid(svg));
    expect(shapePatternGrid(svg, { gx: 2, gy: 2 })).not.toBe(shapePatternGrid(svg));
  });

  it('round-trips the tile s fields through shapePatternFillOf', () => {
    const symmetry: PatternSymmetry = { ...PATTERN_SYMMETRY_OFF, mirrorH: true };
    const fill: ShapePatternFill = { ...filledFill(), symmetry, stroke: { dash: 3 } };
    const svg = { ...rect('svg_1', 0, 0, 4, 4), patternFill: fill };
    const grid = shapePatternGrid(svg)!;
    // The WIDTH the grid wears is derived and does not cross back — what
    // the fill stores of its stroke (the dash) is what round-trips.
    expect(shapePatternFillOf(fill, grid).stroke?.dash).toBe(3);
    expect({ ...shapePatternFillOf(fill, grid), stroke: fill.stroke }).toEqual(fill);
  });

  it('draws the tiles at HALF the shape s own line, and follows it', () => {
    const fill = filledFill();
    const thick = { ...rect('svg_1', 0, 0, 4, 4), patternFill: fill, stroke: { width: 0.8 } };
    expect(shapePatternGrid(thick)!.stroke!.width).toBeCloseTo(0.4, 6);
    // Move the Stroke page's Width and the pattern thins with it.
    const thin = { ...thick, stroke: { width: 0.2 } };
    expect(shapePatternGrid(thin)!.stroke!.width).toBeCloseTo(0.1, 6);
    // A shape drawing NO outline still shows its pattern: half of the
    // composition's own default rather than half of nothing.
    const bare = { ...thick, stroke: { width: 0 } };
    expect(shapePatternGrid(bare)!.stroke!.width).toBeGreaterThan(0);
    // …and the dash the fill stores rides along with it.
    const dashed = { ...thick, patternFill: { ...fill, stroke: { dash: 2 } } };
    expect(shapePatternGrid(dashed)!.stroke).toMatchObject({ dash: 2 });
  });
});

describe('buildShapePatternFill', () => {
  it('makes a square tile at TWICE the grid s resolution', () => {
    const fill = buildShapePatternFill(rect('svg_1', 0, 0, 8, 4), 2, { size: 3 });
    expect(fill.size).toBe(3);
    expect(fill.cells).toHaveLength(9);
    // Two cells to a grid square (SHAPE_PATTERN_CELLS_PER_GRID): a cell is
    // half a step, so a 3×3 tile spans one and a half squares.
    expect(shapePatternCellL0(fill)).toBeCloseTo(1, 5);
    expect(fill.tileL0).toBeCloseTo(3, 5);
    expect(shapePatternFillIsEmpty(fill)).toBe(true);
  });

  it('seeds a repeat to the composition s own grid square', () => {
    // Creation lands on the page's lattice: a 2×2 tile at two cells to the
    // square spans ONE square, so a shape two squares across shows it twice.
    const step = 2;
    const shape = rect('svg_1', 0, 0, 2 * step, 2 * step);
    const fill = buildShapePatternFill(shape, step, { size: 2 });
    expect(fill.tileL0).toBeCloseTo(step, 5);
    const grid = shapePatternGrid({ ...shape, patternFill: fill })!;
    expect(grid.cellWidth / grid.tileWidthL0!).toBeCloseTo(2, 5);
    expect(grid.cellHeight / grid.tileHeightL0!).toBeCloseTo(2, 5);
  });

  it('opens at the default size, and never outside the slider s range', () => {
    expect(buildShapePatternFill(rect('svg_1', 0, 0, 8, 4), 1).size)
      .toBe(DEFAULT_SHAPE_PATTERN_SIZE);
    expect(buildShapePatternFill(rect('svg_1', 0, 0, 8, 4), 1, { size: 99 }).size)
      .toBe(MAX_SHAPE_PATTERN_SIZE);
    expect(buildShapePatternFill(rect('svg_1', 0, 0, 8, 4), 1, { size: 0 }).size).toBe(1);
  });

  it('is independent of the shape s size — a bigger shape shows more copies', () => {
    const small = buildShapePatternFill(rect('a', 0, 0, 4, 4), 2, { size: 2 });
    const big = buildShapePatternFill(rect('b', 0, 0, 40, 40), 2, { size: 2 });
    expect(big.tileL0).toBe(small.tileL0);
    expect(big.cells).toHaveLength(small.cells.length);
  });

  it('arrives as a PATTERN when asked to flood, not as an empty tile', () => {
    const fill = buildShapePatternFill(rect('svg_1', 0, 0, 4, 4), 2, { flood: true });
    expect(shapePatternFillIsEmpty(fill)).toBe(false);
    expect(fill.cells.every((c) => c != null)).toBe(true);
  });
});

describe('resizeShapePatternFill', () => {
  const seeded = () => buildShapePatternFill(rect('svg_1', 0, 0, 8, 8), 1, {
    size: 2, flood: true,
  });

  it('cuts the repeat finer and leaves the repeat the size it DRAWS at', () => {
    const fill = seeded();
    const bigger = resizeShapePatternFill(fill, 4);
    expect(bigger.size).toBe(4);
    expect(bigger.cells).toHaveLength(16);
    // The Size slider's quantity is untouched — the two sliders are
    // independent — so the cells halve to fit the same repeat.
    expect(bigger.tileL0).toBeCloseTo(fill.tileL0, 9);
    expect(shapePatternCellL0(bigger)).toBeCloseTo(shapePatternCellL0(fill) / 2, 9);
    // …and the other way: coarser cuts the same repeat into bigger cells.
    const coarser = resizeShapePatternFill(fill, 1);
    expect(coarser.tileL0).toBeCloseTo(fill.tileL0, 9);
    expect(shapePatternCellL0(coarser)).toBeCloseTo(shapePatternCellL0(fill) * 2, 9);
  });

  it('never moves the Size slider, at any resolution', () => {
    // The whole of the independence rule, read the way the page reads it:
    // sweep Resolution end to end and the span the Size row shows is the
    // one it opened at.
    const fill = seeded();
    const WIDTH = 8;
    const span = shapePatternSpanOfWidth(fill, WIDTH);
    for (let size = MIN_SHAPE_PATTERN_SIZE; size <= MAX_SHAPE_PATTERN_SIZE; size += 1) {
      const at = resizeShapePatternFill(fill, size);
      expect(shapePatternSpanOfWidth(at, WIDTH)).toBe(span);
    }
  });

  it('RE-ROLLS at the new size — a finished pattern, not a cropped one', () => {
    // A size change is a change of motif: the old cells carried into a
    // bigger tile would sit in one corner of it, and into a smaller one
    // would be a quarter of what was there.
    const fill = seeded();
    const bigger = resizeShapePatternFill(fill, 3);
    expect(bigger.cells).toHaveLength(9);
    expect(bigger.cells.every((c) => c != null)).toBe(true);
    const smaller = resizeShapePatternFill(fill, 1);
    expect(smaller.size).toBe(1);
    expect(smaller.cells.every((c) => c != null)).toBe(true);
  });

  it('hands the same block back for no change, and clamps the range', () => {
    const fill = seeded();
    expect(resizeShapePatternFill(fill, 2)).toBe(fill);
    expect(resizeShapePatternFill(fill, 99).size).toBe(MAX_SHAPE_PATTERN_SIZE);
  });
});

describe('setShapePatternSpan — how big one repeat DRAWS', () => {
  // The Size row is read against the SHAPE, in tenths of its width, so
  // every case here names one: a 10-cell-wide box makes a tenth exactly
  // one cell, which keeps the arithmetic on the page.
  const WIDTH = 10;
  const seeded = () => buildShapePatternFill(rect('svg_1', 0, 0, WIDTH, WIDTH), 2, {
    size: 2, flood: true,
  });

  it('reads 10 as ONE repeat across the whole shape', () => {
    const fill = setShapePatternSpan(seeded(), MAX_SHAPE_PATTERN_SPAN, WIDTH);
    expect(fill.tileL0).toBeCloseTo(WIDTH, 9);
    expect(shapePatternSpanOfWidth(fill, WIDTH)).toBe(MAX_SHAPE_PATTERN_SPAN);
  });

  it('reads 1 as a repeat a TENTH of the shape s width — ten across it', () => {
    const fill = setShapePatternSpan(seeded(), MIN_SHAPE_PATTERN_SPAN, WIDTH);
    expect(fill.tileL0).toBeCloseTo(WIDTH / 10, 9);
    expect(shapePatternSpanOfWidth(fill, WIDTH)).toBe(MIN_SHAPE_PATTERN_SPAN);
  });

  it('is that fraction at every stop in between', () => {
    for (let span = MIN_SHAPE_PATTERN_SPAN; span <= MAX_SHAPE_PATTERN_SPAN; span += 1) {
      const fill = setShapePatternSpan(seeded(), span, WIDTH);
      expect(fill.tileL0).toBeCloseTo((span / 10) * WIDTH, 9);
      expect(shapePatternSpanOfWidth(fill, WIDTH)).toBe(span);
    }
  });

  it('is measured against the SHAPE, so the same number scales with it', () => {
    // The whole point of the units: 5 is half the width of whatever shape
    // is being filled, so the motif reads the same in a big patch and a
    // small one.
    const small = setShapePatternSpan(seeded(), 5, 4);
    const big = setShapePatternSpan(seeded(), 5, 40);
    expect(small.tileL0).toBeCloseTo(2, 9);
    expect(big.tileL0).toBeCloseTo(20, 9);
  });

  it('scales the whole motif — cells and all — and keeps the cell COUNT', () => {
    const fill = setShapePatternSpan(seeded(), 4, WIDTH);
    const bigger = setShapePatternSpan(fill, 8, WIDTH);
    expect(shapePatternSpanOfWidth(bigger, WIDTH)).toBe(8);
    // Resolution is untouched: same cells, same count, same order.
    expect(bigger.size).toBe(fill.size);
    expect(bigger.cells).toEqual(fill.cells);
    // …and each CELL doubled with the repeat, which is what makes this a
    // scale rather than a re-cut (the Resolution slider holds this still).
    expect(shapePatternCellL0(bigger)).toBeCloseTo(shapePatternCellL0(fill) * 2, 9);
  });

  it('goes SMALLER as well as bigger', () => {
    const fill = setShapePatternSpan(seeded(), 4, WIDTH);
    const smaller = setShapePatternSpan(fill, 2, WIDTH);
    expect(smaller.tileL0).toBeCloseTo(fill.tileL0 / 2, 9);
    expect(smaller.cells).toEqual(fill.cells);
  });

  it('never re-rolls, so a sweep back hands the pattern back untouched', () => {
    // The whole difference from a Resolution change: the same motif at a
    // new scale is still that motif, so there is nothing to re-roll.
    const fill = setShapePatternSpan(seeded(), 3, WIDTH);
    const there = setShapePatternSpan(fill, 9, WIDTH);
    const back = setShapePatternSpan(there, 3, WIDTH);
    expect(back.cells).toEqual(fill.cells);
    expect(back.tileL0).toBeCloseTo(fill.tileL0, 9);
  });

  it('hands the same block back for no change', () => {
    const fill = setShapePatternSpan(seeded(), 6, WIDTH);
    expect(setShapePatternSpan(fill, 6, WIDTH)).toBe(fill);
  });

  it('clamps to the slider s range and lands on its whole steps', () => {
    expect(clampShapePatternSpan(99)).toBe(MAX_SHAPE_PATTERN_SPAN);
    expect(clampShapePatternSpan(0)).toBe(MIN_SHAPE_PATTERN_SPAN);
    expect(clampShapePatternSpan(-5)).toBe(MIN_SHAPE_PATTERN_SPAN);
    // Whole tenths: the row has ten stops and every one of them is sayable.
    expect(clampShapePatternSpan(3.4)).toBe(3);
    expect(clampShapePatternSpan(3.6)).toBe(4);
  });

  it('seats the handle at an end for a tile finer or coarser than the row', () => {
    // A seeded fill in a very large shape can repeat more than ten times
    // across it; the row says 1 rather than something off its own track.
    const fine = { ...seeded(), tileL0: WIDTH / 100 };
    expect(shapePatternSpanOfWidth(fine, WIDTH)).toBe(MIN_SHAPE_PATTERN_SPAN);
    const coarse = { ...seeded(), tileL0: WIDTH * 4 };
    expect(shapePatternSpanOfWidth(coarse, WIDTH)).toBe(MAX_SHAPE_PATTERN_SPAN);
  });

  it('survives a shape with no width at all', () => {
    const fill = seeded();
    expect(() => setShapePatternSpan(fill, 5, 0)).not.toThrow();
    expect(shapePatternSpanOfWidth(fill, 0)).toBeGreaterThanOrEqual(MIN_SHAPE_PATTERN_SPAN);
  });
});

describe('the line the TILES are drawn in', () => {
  it('is half the shape s when the fill says nothing, and follows it', () => {
    const svg = { ...rect('svg_1', 0, 0, 8, 8), stroke: { width: 0.6 }, patternFill: filledFill() };
    expect(shapePatternStrokeWidthCells(svg)).toBeCloseTo(0.3, 9);
    expect(shapePatternGrid(svg)!.stroke!.width).toBeCloseTo(0.3, 9);
    // …and moves with it, being derived at every draw rather than seeded.
    const thinner = { ...svg, stroke: { width: 0.2 } };
    expect(shapePatternGrid(thinner)!.stroke!.width).toBeCloseTo(0.1, 9);
  });

  it('is the fill s OWN width once its Stroke section sets one', () => {
    // Asking for a width means the pattern stops tracking the shape.
    const fill = { ...filledFill(), stroke: { width: 0.05 } };
    const svg = { ...rect('svg_1', 0, 0, 8, 8), stroke: { width: 0.6 }, patternFill: fill };
    expect(shapePatternStrokeWidthCells(svg)).toBeCloseTo(0.05, 9);
    expect(shapePatternGrid(svg)!.stroke!.width).toBeCloseTo(0.05, 9);
  });

  it('never writes the DERIVED width back into the fill', () => {
    // The grid carries a RESOLVED width, so copying its stroke block
    // wholesale on the way back would freeze an untouched pattern to
    // whatever the shape happened to be at the first time a cell moved.
    const svg = { ...rect('svg_1', 0, 0, 8, 8), stroke: { width: 0.6 }, patternFill: filledFill() };
    const grid = shapePatternGrid(svg)!;
    const back = shapePatternFillOf(svg.patternFill!, grid);
    expect(back.stroke?.width).toBeUndefined();
    // A width the fill DOES own survives the same round trip.
    const owned = { ...filledFill(), stroke: { width: 0.05 } };
    const ownedGrid = shapePatternGrid({ ...svg, patternFill: owned })!;
    expect(shapePatternFillOf(owned, ownedGrid).stroke?.width).toBeCloseTo(0.05, 9);
  });

  it('carries the fill s DASH through, both ways', () => {
    const dashed = { ...filledFill(), stroke: { dash: 4 } };
    const svg = { ...rect('svg_1', 0, 0, 8, 8), patternFill: dashed };
    const grid = shapePatternGrid(svg)!;
    expect(grid.stroke!.dash).toBe(4);
    expect(shapePatternFillOf(dashed, grid).stroke!.dash).toBe(4);
  });
});

describe('the ops', () => {
  it('setShapePatternFill adds, and reverting takes the field away entirely', () => {
    const state = makeState([rect('svg_1', 0, 0, 4, 4)]);
    const fill = filledFill();
    const ops: CompUndoOp[] = [{
      op: 'setShapePatternFill', svgId: 'svg_1', oldFill: undefined, newFill: fill,
    }];
    const added = applyCompOps(state, ops);
    expect(added.svgObjects[0].patternFill).toEqual(fill);
    const back = revertCompOps(added, ops);
    expect('patternFill' in back.svgObjects[0]).toBe(false);
  });

  it('setShapePatternFill removes, and reverting brings the same grid back', () => {
    const fill = filledFill();
    const state = makeState([{ ...rect('svg_1', 0, 0, 4, 4), patternFill: fill }]);
    const ops: CompUndoOp[] = [{
      op: 'setShapePatternFill', svgId: 'svg_1', oldFill: fill, newFill: undefined,
    }];
    const removed = applyCompOps(state, ops);
    expect(removed.svgObjects[0].patternFill).toBeUndefined();
    expect(revertCompOps(removed, ops).svgObjects[0].patternFill).toEqual(fill);
  });

  it('editPatternCells paints into the fill the shape s id names', () => {
    const state = makeState([{
      ...rect('svg_1', 0, 0, 4, 4),
      patternFill: { size: 2, cells: new Array(4).fill(null), tileL0: 2 },
    }]);
    const grid = shapePatternGrid(state.svgObjects[0])!;
    const edits = patternApplyToolAt(grid, 1, 0, { kind: 'tile', spriteId: TILE });
    const ops: CompUndoOp[] = [{ op: 'editPatternCells', patternId: 'svg_1', edits }];
    const painted = applyCompOps(state, ops);
    expect(painted.svgObjects[0].patternFill!.cells[1]).toMatchObject({ spriteId: TILE });
    // …and undo empties the cell again, through the same op read backwards.
    expect(revertCompOps(painted, ops).svgObjects[0].patternFill!.cells[1]).toBeNull();
  });

  it('setPatternSettings sets a fill s symmetry without touching a pattern object', () => {
    const symmetry: PatternSymmetry = { ...PATTERN_SYMMETRY_OFF, mirrorV: true };
    const state = makeState([{ ...rect('svg_1', 0, 0, 4, 4), patternFill: filledFill() }]);
    const ops: CompUndoOp[] = [{
      op: 'setPatternSettings', patternId: 'svg_1',
      oldSymmetry: undefined, newSymmetry: symmetry,
      oldAllowBorderConnections: undefined, newAllowBorderConnections: undefined,
    }];
    const set = applyCompOps(state, ops);
    expect(set.svgObjects[0].patternFill!.symmetry).toEqual(symmetry);
    expect(revertCompOps(set, ops).svgObjects[0].patternFill!.symmetry).toBeUndefined();
  });

  it('leaves the cells alone when the id names nothing patterned', () => {
    const state = makeState([rect('svg_1', 0, 0, 4, 4)]);
    expect(applyCompOps(state, [{
      op: 'editPatternCells', patternId: 'svg_1', edits: [{ index: 0, oldState: null, newState: spriteCell() }],
    }]).svgObjects).toEqual(state.svgObjects);
  });
});

describe('withShapePatternFill', () => {
  it('removes the FIELD rather than storing an empty block', () => {
    const svg = { ...rect('svg_1', 0, 0, 4, 4), patternFill: filledFill() };
    expect('patternFill' in withShapePatternFill(svg, undefined)).toBe(false);
  });

  it('hands an unpatterned shape straight back', () => {
    const svg = rect('svg_1', 0, 0, 4, 4);
    expect(withShapePatternFill(svg, undefined)).toBe(svg);
  });
});

describe('the markup', () => {
  const svg = { ...rect('svg_1', 0, 0, 4, 4), patternFill: filledFill(2, DRAWN_TILE) };

  it('bakes the tiles for a filled grid and nothing for an empty one', () => {
    expect(shapePatternFillTiles(svg, 1)).not.toBe('');
    expect(shapePatternFillTiles(
      { ...svg, patternFill: { size: 2, cells: new Array(4).fill(null), tileL0: 2 } }, 1,
    )).toBe('');
    expect(shapePatternFillTiles(rect('svg_1', 0, 0, 4, 4), 1)).toBe('');
  });

  it('clips the tiles to the shape s own outline, over the fill and under the stroke', () => {
    const content = buildSVGObjectContent(svg, 1, 256, {
      patternFillMarkup: '<path d="M 0 0" />',
    });
    // The clip is the shape's, and the tiles ride inside it.
    expect(content).toContain('<clipPath id="patfill_svg_1"');
    const clipAt = content.indexOf('clip-path="url(#patfill_svg_1)"');
    expect(clipAt).toBeGreaterThan(-1);
    // Under the stroke: the outline is painted after the pattern group.
    expect(content.indexOf('stroke="rgb(0,0,0)"')).toBeGreaterThan(clipAt);
  });

  it('draws nothing for a path that never closes — a pattern would spill', () => {
    const open: SVGObject = {
      ...rect('svg_1', 0, 0, 4, 4),
      segments: [{ kind: 'line', start: [0, 0], end: [4, 0] }],
      patternFill: filledFill(2, DRAWN_TILE),
    };
    expect(buildSVGObjectContent(open, 1, 256, { patternFillMarkup: '<path d="M 0 0" />' }))
      .not.toContain('patfill_');
  });
});

describe('the swatch thumbnail', () => {
  const grid = shapePatternGrid({
    ...rect('svg_1', 0, 0, 4, 4), patternFill: filledFill(2, DRAWN_TILE),
  })!;

  it('draws the pattern in its own box, and nothing for an empty grid', () => {
    const uri = patternGridThumbnailUri(grid, 44)!;
    expect(uri.startsWith('data:image/svg+xml')).toBe(true);
    expect(decodeURIComponent(uri)).toContain('width="44" height="44"');
    const empty = shapePatternGrid({
      ...rect('svg_2', 0, 0, 4, 4),
      patternFill: { size: 2, cells: new Array(4).fill(null), tileL0: 2 },
    })!;
    expect(patternGridThumbnailUri(empty, 44)).toBeNull();
  });

  it('re-inks the tiles when asked — a white pattern is no swatch at all', () => {
    // The banner bakes in the PANEL's ink: what the press chooses is the
    // tiles, not the colour they happen to be painted in, and a pattern
    // in the page's own white would be a blank chip.
    const inked = decodeURIComponent(patternGridThumbnailUri(grid, 44, 1, { r: 42, g: 42, b: 42 })!);
    expect(inked).toContain('stroke="rgb(42,42,42)"');
    expect(inked).not.toContain('stroke="rgb(255,255,255)"');
  });

  it('hands back the same string for the same ask', () => {
    expect(patternGridThumbnailUri(grid, 44)).toBe(patternGridThumbnailUri(grid, 44));
  });
});

describe('what counts as a shape with an interior', () => {
  const square = (x = 0): PathSegment[] => [
    { kind: 'line', start: [x, 0], end: [x + 4, 0] },
    { kind: 'line', start: [x + 4, 0], end: [x + 4, 4] },
    { kind: 'line', start: [x + 4, 4], end: [x, 4] },
    { kind: 'line', start: [x, 4], end: [x, 0] },
  ];
  const withSegments = (segments: PathSegment[]): SVGObject =>
    ({ ...rect('svg_1', 0, 0, 4, 4), segments } as SVGObject);

  it('is anything that encloses an area, however it was drawn', () => {
    expect(svgEnclosesArea(withSegments(square()))).toBe(true);
    // A bag of lines that MERGED into a closed loop — the order they were
    // flattened in is not the order they chain in.
    expect(svgEnclosesArea(withSegments([square()[2], square()[0], square()[3], square()[1]])))
      .toBe(true);
    // Two separate loops (a flatten of two shapes).
    expect(svgEnclosesArea(withSegments([...square(), ...square(10)]))).toBe(true);
  });

  it('is TRUE for a loop with a loose line beside it — the loop is still an area', () => {
    // The case a merge makes and `isClosedPath` refuses: one stray chain
    // used to cost the whole object its interior.
    const merged = withSegments([
      ...square(),
      { kind: 'line', start: [8, 8], end: [10, 10] },
    ]);
    expect(isClosedPath(merged.segments)).toBe(false);
    expect(svgEnclosesArea(merged)).toBe(true);
    // …and what gets PAINTED is the loop, not the stray.
    const d = buildClosedFillPathD(merged.segments);
    expect(d).not.toBe('');
    expect(d.match(/Z/g)).toHaveLength(1);
  });

  it('is false for a path that closes nowhere', () => {
    expect(svgEnclosesArea(withSegments([
      { kind: 'line', start: [0, 0], end: [4, 0] },
      { kind: 'line', start: [4, 0], end: [4, 4] },
    ]))).toBe(false);
    expect(svgEnclosesArea(withSegments([]))).toBe(false);
    expect(buildClosedFillPathD([
      { kind: 'line', start: [0, 0], end: [4, 0] },
    ] as PathSegment[])).toBe('');
  });

  it('lets a merged object take a pattern fill', () => {
    const merged = withSegments([
      ...square(),
      { kind: 'line', start: [8, 8], end: [10, 10] },
    ]);
    const fill = buildShapePatternFill(merged, 1, { flood: true });
    const state = makeState([{ ...merged, patternFill: fill }]);
    expect(shapePatternGrid(state.svgObjects[0])).not.toBeNull();
    const content = buildSVGObjectContent(state.svgObjects[0], 1, 256, {
      patternFillMarkup: '<path d="M 0 0" />',
    });
    expect(content).toContain('clip-path="url(#patfill_svg_1)"');
  });
});
