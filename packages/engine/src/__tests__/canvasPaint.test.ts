/**
 * The paint tool's sparse canvas raster (canvasPaint.ts): tile-island
 * allocation wherever a dab lands (the draw-anywhere contract), the global
 * texel lattice across island borders, the erase/blur passes that never
 * allocate, the memory budget, the occlusion mask, legacy single-layer
 * conversion, the setCanvasPaint undo op, and the v50→v51 binary story.
 */

import {
  CANVAS_ISLAND_CELLS, CANVAS_ISLAND_TEXELS, CANVAS_PAINT_TEXELS_PER_CELL,
  CANVAS_PAINT_WIDTH_CELLS, canvasPaintBytes, canvasPaintHasInk, canvasPaintInkBounds,
  commitCanvasPaint, composeCanvasPaint, createCanvasPaint, createCanvasPaintMask,
  createCanvasPaintWorking, eraseCanvasPaint, islandHeightCells, islandKey,
  legacyCanvasPaintToIslands, normalizeCanvasPaintIslands, stampCanvasPaint,
} from '../canvasPaint';
import { paintOverlayHasInk, stampImagePaintOverlay } from '../imagePaintOverlay';
import { applyCompOps, revertCompOps } from '../compositionOps';
import { serializeComposition, deserializeComposition } from '../compositionBinaryFormat';
import {
  CanvasPaintIsland, CompositionState, PathSegment, RGBColor, SVGObject, makeViewport,
} from '../types';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const RED: RGBColor = { r: 255, g: 0, b: 0 };
const BLACK: RGBColor = { r: 0, g: 0, b: 0 };

const line = (start: [number, number], end: [number, number]): PathSegment =>
  ({ kind: 'line', start, end });

/** A closed 8×8 rectangle outline at (8, 8). */
function rect(id: string, extras: Partial<SVGObject> = {}): SVGObject {
  return {
    id,
    segments: [
      line([8, 8], [16, 8]),
      line([16, 8], [16, 16]),
      line([16, 16], [8, 16]),
      line([8, 16], [8, 8]),
    ],
    color: BLACK,
    cellX: 8, cellY: 8, cellWidth: 8, cellHeight: 8,
    ...extras,
  };
}

function makeState(svgObjects: SVGObject[], extras: Partial<CompositionState> = {}): CompositionState {
  return {
    id: 'test',
    name: 'test',
    figures: [],
    svgObjects,
    lineDraft: null,
    arcDraft: null,
    editingLineId: null,
    selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups: [],
    sceneOrder: svgObjects.map((s) => s.id),
    gridLevel: 0,
    strokeScale: 1,
    gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null,
    compTool: 'select',
    createRegion: null,
    renderGeneration: 0,
    ...extras,
  };
}

/** The island containing world-cell (x, y), or undefined. */
function islandAt(islands: readonly CanvasPaintIsland[] | undefined, x: number, y: number) {
  return (islands ?? []).find((isl) =>
    x >= isl.x && x < isl.x + isl.widthCells
    && y >= isl.y && y < isl.y + islandHeightCells(isl));
}

/** RGBA byte offset of the texel whose center is nearest world (x, y) in
 *  `isl`. */
function texelOffset(isl: CanvasPaintIsland, x: number, y: number): number {
  const texW = isl.widthCells / isl.overlay.cols;
  const c = Math.min(isl.overlay.cols - 1, Math.max(0, Math.floor((x - isl.x) / texW)));
  const r = Math.min(isl.overlay.rows - 1, Math.max(0, Math.floor((y - isl.y) / texW)));
  return (r * isl.overlay.cols + c) * 4;
}

/** Alpha at world (x, y) across an island list; 0 where nothing is allocated. */
function alphaAt(islands: readonly CanvasPaintIsland[] | undefined, x: number, y: number): number {
  const isl = islandAt(islands, x, y);
  return isl ? isl.overlay.rgba[texelOffset(isl, x, y) + 3] : 0;
}

// A texel-center-aligned coordinate at density 8 (texel = 1/8 cell), so the
// centermost texel sits at distance 0 → falloff exactly 1.
const C = 0.0625;

describe('stampCanvasPaint allocation', () => {
  it('allocates the covering tile where a dab lands on nothing', () => {
    const working = createCanvasPaintWorking(undefined);
    const changed = stampCanvasPaint(working, 8 + C, 8 + C, 2, RED, 1);
    expect(changed).toEqual([islandKey(0, 0)]);
    const islands = commitCanvasPaint(working)!;
    expect(islands).toHaveLength(1);
    expect(islands[0].x).toBe(0);
    expect(islands[0].y).toBe(0);
    expect(islands[0].widthCells).toBe(CANVAS_ISLAND_CELLS);
    expect(islands[0].overlay.cols).toBe(CANVAS_ISLAND_TEXELS);
    expect(alphaAt(islands, 8 + C, 8 + C)).toBe(255);
    const i = texelOffset(islands[0], 8 + C, 8 + C);
    expect(islands[0].overlay.rgba[i]).toBe(255);   // brush red
    expect(islands[0].overlay.rgba[i + 1]).toBe(0);
  });

  it('a dab far from the origin allocates only its own tile — draw anywhere', () => {
    const working = createCanvasPaintWorking(undefined);
    stampCanvasPaint(working, 1000 + C, -500 + C, 1, RED, 1);
    const islands = commitCanvasPaint(working)!;
    expect(islands).toHaveLength(1);
    expect(islands[0].x).toBe(Math.floor(1000 / CANVAS_ISLAND_CELLS) * CANVAS_ISLAND_CELLS);
    expect(islands[0].y).toBe(Math.floor(-500 / CANVAS_ISLAND_CELLS) * CANVAS_ISLAND_CELLS);
    expect(alphaAt(islands, 1000 + C, -500 + C)).toBe(255);
    // Total allocation: one 64 KB tile, not a bitmap spanning the origin.
    expect(canvasPaintBytes(islands)).toBe(CANVAS_ISLAND_TEXELS * CANVAS_ISLAND_TEXELS * 4);
  });

  it('a dab across a tile border stamps both tiles on one shared lattice', () => {
    const working = createCanvasPaintWorking(undefined);
    const edge = CANVAS_ISLAND_CELLS; // world x = 16, the tile boundary
    const changed = stampCanvasPaint(working, edge, 8 + C, 2, RED, 1);
    expect(new Set(changed)).toEqual(new Set([islandKey(0, 0), islandKey(CANVAS_ISLAND_CELLS, 0)]));
    const islands = commitCanvasPaint(working)!;
    // Ink on both sides of the border…
    const left = alphaAt(islands, edge - C, 8 + C);
    const right = alphaAt(islands, edge + C, 8 + C);
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
    // …and symmetric: the two texel centers sit at the same distance from
    // the dab center, so a split lattice would betray itself here.
    expect(left).toBe(right);
  });

  it('sub-texel radius still lands a dab (radius floor)', () => {
    const working = createCanvasPaintWorking(undefined);
    expect(stampCanvasPaint(working, 8 + C, 8 + C, 1 / 64, RED, 1).length).toBe(1);
    expect(canvasPaintHasInk(commitCanvasPaint(working))).toBe(true);
  });

  it('clones a committed island on first touch instead of mutating it', () => {
    const first = createCanvasPaintWorking(undefined);
    stampCanvasPaint(first, 8 + C, 8 + C, 2, RED, 1);
    const committed = commitCanvasPaint(first)!;
    const before = committed[0].overlay.rgba.slice();

    const second = createCanvasPaintWorking(committed);
    stampCanvasPaint(second, 4 + C, 4 + C, 2, RED, 1);
    expect(committed[0].overlay.rgba).toEqual(before); // untouched
    const next = commitCanvasPaint(second)!;
    expect(next[0].overlay).not.toBe(committed[0].overlay);
    expect(alphaAt(next, 4 + C, 4 + C)).toBe(255);
  });

  it('stops allocating past the byte budget but keeps stamping existing tiles', () => {
    const oneTile = CANVAS_ISLAND_TEXELS * CANVAS_ISLAND_TEXELS * 4;
    const working = createCanvasPaintWorking(undefined, oneTile);
    expect(stampCanvasPaint(working, 8 + C, 8 + C, 1, RED, 1).length).toBe(1);
    // Second tile would exceed the budget: nothing allocates, nothing lands.
    expect(stampCanvasPaint(working, 100 + C, 100 + C, 1, RED, 1)).toEqual([]);
    // The existing tile still takes paint.
    expect(stampCanvasPaint(working, 12 + C, 12 + C, 1, RED, 1).length).toBe(1);
    expect(commitCanvasPaint(working)).toHaveLength(1);
  });
});

describe('erase and compose/commit', () => {
  it('erases back out and prunes an emptied island at commit', () => {
    const paint = createCanvasPaintWorking(undefined);
    stampCanvasPaint(paint, 8 + C, 8 + C, 2, RED, 1);
    const committed = commitCanvasPaint(paint)!;

    const erase = createCanvasPaintWorking(committed);
    expect(eraseCanvasPaint(erase, 8 + C, 8 + C, 4, 1).length).toBe(1);
    // The falloff thins the dab's rim rather than zeroing it in one pass
    // (same soft edge a stamp lays down) — a few more passes lift it fully.
    for (let i = 0; i < 8; i++) eraseCanvasPaint(erase, 8 + C, 8 + C, 6, 1);
    expect(commitCanvasPaint(erase)).toBeUndefined();
  });

  it('erasing never allocates', () => {
    const working = createCanvasPaintWorking(undefined);
    expect(eraseCanvasPaint(working, 8, 8, 4, 1)).toEqual([]);
    expect(working.touched.size).toBe(0);
  });

  it('composeCanvasPaint keeps untouched islands by reference', () => {
    const a = createCanvasPaintWorking(undefined);
    stampCanvasPaint(a, 8 + C, 8 + C, 1, RED, 1);
    stampCanvasPaint(a, 100 + C, 8 + C, 1, RED, 1);
    const committed = commitCanvasPaint(a)!;
    expect(committed).toHaveLength(2);

    const b = createCanvasPaintWorking(committed);
    stampCanvasPaint(b, 8 + C, 8 + C, 1, RED, 0.5);
    const composed = composeCanvasPaint(b);
    const untouched = composed.find((isl) => isl.x !== 0)!;
    expect(untouched).toBe(committed.find((isl) => isl.x !== 0));
  });
});

describe('unary blend modes', () => {
  it('invert rewrites each texel once per stroke, not once per dab', () => {
    const paint = createCanvasPaintWorking(undefined);
    stampCanvasPaint(paint, 8 + C, 8 + C, 2, RED, 1);
    const committed = commitCanvasPaint(paint)!;

    const invert = createCanvasPaintWorking(committed);
    const blend = { mode: 'invert' as const, beneath: undefined };
    stampCanvasPaint(invert, 8 + C, 8 + C, 2, RED, 1, undefined, blend);
    const once = islandAt(composeCanvasPaint(invert), 8 + C, 8 + C)!;
    const value = once.overlay.rgba[texelOffset(once, 8 + C, 8 + C)];
    expect(value).toBe(0); // 255 red inverted
    // A second dab of the same stroke must not invert back.
    stampCanvasPaint(invert, 8 + C, 8 + C, 2, RED, 1, undefined, blend);
    const twice = islandAt(composeCanvasPaint(invert), 8 + C, 8 + C)!;
    expect(twice.overlay.rgba[texelOffset(twice, 8 + C, 8 + C)]).toBe(0);
  });
});

describe('createCanvasPaintMask', () => {
  it('a filled shape blocks its interior; an unfilled one only its stroke band', () => {
    const filled = createCanvasPaintMask(makeState([rect('a', { fillColor: RED })]));
    expect(filled.blockedAt(12, 12)).toBe(true);   // interior
    expect(filled.blockedAt(4, 4)).toBe(false);    // outside

    const outline = createCanvasPaintMask(makeState([rect('a')]));
    expect(outline.blockedAt(12, 12)).toBe(false); // interior of an UNFILLED shape paints
    expect(outline.blockedAt(12, 8)).toBe(true);   // on the stroke centerline
  });

  it('ignores hidden objects and members of hidden groups', () => {
    const hiddenObj = createCanvasPaintMask(
      makeState([rect('a', { fillColor: RED, hidden: true })]),
    );
    expect(hiddenObj.blockedAt(12, 12)).toBe(false);

    const hiddenGroup = createCanvasPaintMask(
      makeState(
        [rect('a', { fillColor: RED, groupId: 'g1' })],
        {
          groups: [{
            id: 'g1', name: 'g', hidden: true,
            translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
            rotation: 0, mirrorH: false, mirrorV: false,
          }],
        },
      ),
    );
    expect(hiddenGroup.blockedAt(12, 12)).toBe(false);
  });

  it('memoizes per island texel through forIsland', () => {
    const mask = createCanvasPaintMask(makeState([rect('a', { fillColor: RED })]));
    const texels = CANVAS_ISLAND_TEXELS * CANVAS_ISLAND_TEXELS;
    const blocked = mask.forIsland(islandKey(0, 0), texels);
    expect(blocked(0, 12, 12)).toBe(true);
    // Cached: even a lying coordinate returns the memoized answer.
    expect(blocked(0, 0, 0)).toBe(true);
  });

  it('masks a stamp: the dab paints around the shape, not under it', () => {
    const working = createCanvasPaintWorking(undefined);
    const mask = createCanvasPaintMask(makeState([rect('a', { fillColor: RED })]));
    // Dab centered on the shape's left edge: half in, half out.
    stampCanvasPaint(working, 8, 12, 2, RED, 1, mask);
    const islands = commitCanvasPaint(working);
    expect(alphaAt(islands, 6.5, 12)).toBeGreaterThan(0);  // outside the shape
    expect(alphaAt(islands, 9, 12)).toBe(0);               // occluded interior
  });
});

describe('canvasPaintInkBounds', () => {
  it('bounds the painted texels tightly, not the island rects', () => {
    const working = createCanvasPaintWorking(undefined);
    stampCanvasPaint(working, 8 + C, 8 + C, 1, RED, 1);
    stampCanvasPaint(working, 200 + C, 40 + C, 1, RED, 1);
    const bounds = canvasPaintInkBounds(commitCanvasPaint(working))!;
    expect(bounds.minX).toBeGreaterThan(6.5);
    expect(bounds.minX).toBeLessThan(8);
    expect(bounds.maxX).toBeGreaterThan(200);
    expect(bounds.maxX).toBeLessThan(202);
    expect(bounds.minY).toBeGreaterThan(6.5);
    expect(bounds.maxY).toBeGreaterThan(40);
    expect(canvasPaintInkBounds(undefined)).toBeNull();
  });
});

describe('legacy conversion', () => {
  it('re-tiles the old page layer exactly and drops empty tiles', () => {
    // Legacy page layer: 32 cells wide, 40 tall (4:5 page) — 256×320 texels.
    const legacy = createCanvasPaint(40);
    stampImagePaintOverlay(legacy, CANVAS_PAINT_WIDTH_CELLS, 40, 8 + C, 8 + C, 2, RED, 1);
    const islands = legacyCanvasPaintToIslands(legacy)!;
    // One dab near (8, 8): only the (0, 0) tile holds ink; the other tiles
    // of the 2×3-tile page never allocate.
    expect(islands).toHaveLength(1);
    expect(islands[0].x).toBe(0);
    expect(islands[0].y).toBe(0);
    // The lattices coincide, so the byte survives exactly.
    const legacyOff = ((Math.floor((8 + C) * CANVAS_PAINT_TEXELS_PER_CELL) * legacy.cols)
      + Math.floor((8 + C) * CANVAS_PAINT_TEXELS_PER_CELL)) * 4;
    const tileOff = texelOffset(islands[0], 8 + C, 8 + C);
    expect(islands[0].overlay.rgba[tileOff + 3]).toBe(legacy.rgba[legacyOff + 3]);
    expect(islands[0].overlay.rgba[tileOff]).toBe(legacy.rgba[legacyOff]);
  });

  it('an all-empty legacy layer converts to no islands at all', () => {
    expect(legacyCanvasPaintToIslands(createCanvasPaint(40))).toBeUndefined();
  });

  it('normalize passes conforming islands through by reference', () => {
    const working = createCanvasPaintWorking(undefined);
    stampCanvasPaint(working, 8 + C, 8 + C, 1, RED, 1);
    const islands = commitCanvasPaint(working)!;
    expect(normalizeCanvasPaintIslands(islands)![0]).toBe(islands[0]);
  });
});

describe('setCanvasPaint op', () => {
  it('applies and reverts the island-list swap', () => {
    const state = makeState([]);
    const working = createCanvasPaintWorking(undefined);
    stampCanvasPaint(working, 16, 16, 2, RED, 1);
    const islands = commitCanvasPaint(working)!;
    const entry = [{ op: 'setCanvasPaint' as const, oldIslands: undefined, newIslands: islands }];
    const applied = applyCompOps(state, entry);
    expect(applied.canvasPaint).toBe(islands);
    const reverted = revertCompOps(applied, entry);
    expect(reverted.canvasPaint).toBeUndefined();
  });
});

describe('binary round trip', () => {
  it('round-trips the island list through serialize/deserialize (v51)', () => {
    const working = createCanvasPaintWorking(undefined);
    stampCanvasPaint(working, 16 + C, 16 + C, 2, RED, 1);
    stampCanvasPaint(working, -50 + C, 300 + C, 1, RED, 0.7);
    const islands = commitCanvasPaint(working)!;
    const bytes = serializeComposition(
      {
        name: 'x', gridLevel: 0, strokeScale: 1, gridIntensity: 0.5,
        camera: { offsetX: 0, offsetY: 0, zoom: 1 }, figures: [],
        svgObjects: [], groups: [], sceneOrder: [], canvasPaint: islands,
      },
      [],
    );
    const back = deserializeComposition(bytes).meta.canvasPaint!;
    expect(back).toHaveLength(islands.length);
    for (let i = 0; i < islands.length; i++) {
      const src = islands.find((isl) => isl.x === back[i].x && isl.y === back[i].y)!;
      expect(src).toBeDefined();
      expect(back[i].widthCells).toBe(src.widthCells);
      expect(Array.from(back[i].overlay.rgba)).toEqual(Array.from(src.overlay.rgba));
    }
  });

  it('omits the section cleanly when there are no islands', () => {
    const bytes = serializeComposition(
      {
        name: 'x', gridLevel: 0, strokeScale: 1, gridIntensity: 0.5,
        camera: { offsetX: 0, offsetY: 0, zoom: 1 }, figures: [],
        svgObjects: [], groups: [], sceneOrder: [],
      },
      [],
    );
    expect(deserializeComposition(bytes).meta.canvasPaint).toBeUndefined();
  });

  it('reads a real v50 file as re-tiled islands (fixture written by the v50 writer)', () => {
    // Fixture: a 32×4-cell legacy layer with two dabs — full-alpha red at
    // (16.0625, 2.0625) and 0.8-alpha blue at (30, 3) — serialized by the
    // pre-island (v50) writer.
    const b64 = readFileSync(
      resolve(__dirname, 'fixtures/canvasPaint-v50.bin.b64'), 'utf8',
    ).trim();
    const bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
    const islands = deserializeComposition(bytes).meta.canvasPaint!;
    expect(islands.length).toBeGreaterThan(0);
    for (const isl of islands) {
      expect(isl.widthCells).toBe(CANVAS_ISLAND_CELLS);
      expect(isl.x % CANVAS_ISLAND_CELLS).toBe(0);
      expect(isl.y % CANVAS_ISLAND_CELLS).toBe(0);
      expect(paintOverlayHasInk(isl.overlay)).toBe(true);
    }
    expect(alphaAt(islands, 16.0625, 2.0625)).toBe(255);
    const blueIsl = islandAt(islands, 30, 3)!;
    const off = texelOffset(blueIsl, 30, 3);
    expect(blueIsl.overlay.rgba[off + 2]).toBe(255);      // blue channel
    expect(blueIsl.overlay.rgba[off + 3]).toBeGreaterThan(150);
  });
});
