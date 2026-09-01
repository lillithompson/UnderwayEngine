/**
 * The paint brush's sparse raster tiles (canvasPaint.ts): tile allocation
 * wherever a dab lands (the draw-anywhere contract), the shared texel
 * lattice across tile borders, the erase pass that never allocates and the
 * blur pass that spreads across seams and into fresh tiles, the memory
 * budget, commit-time pruning, loader normalization, and the tile-space
 * content queries ({@link paintTilesContentRect} / {@link paintTileAlphaAt})
 * that PaintObject geometry is derived from.
 *
 * The module is frame-agnostic since v52 — coordinates here are cells in
 * the tile lattice of ONE {@link PaintObject}'s tiles; the world↔tile
 * mapping lives in paintObject.ts and is tested there.
 */

import {
  CANVAS_ISLAND_CELLS, CANVAS_ISLAND_TEXELS, canvasPaintBytes, canvasPaintHasInk,
  canvasPaintInkBounds, blurCanvasPaint, commitCanvasPaint, composeCanvasPaint,
  createCanvasPaintWorking, eraseCanvasPaint, islandHeightCells, islandKey,
  normalizeCanvasPaintIslands, paintTileAlphaAt, paintTilesContentRect, smudgeCanvasPaint,
  stampCanvasPaint,
} from '../canvasPaint';
import { CanvasPaintIsland, RGBColor } from '../types';

const RED: RGBColor = { r: 255, g: 0, b: 0 };

/** The island containing tile-space cell (x, y), or undefined. */
function islandAt(islands: readonly CanvasPaintIsland[] | undefined, x: number, y: number) {
  return (islands ?? []).find((isl) =>
    x >= isl.x && x < isl.x + isl.widthCells
    && y >= isl.y && y < isl.y + islandHeightCells(isl));
}

/** RGBA byte offset of the texel whose center is nearest tile-space (x, y)
 *  in `isl`. */
function texelOffset(isl: CanvasPaintIsland, x: number, y: number): number {
  const texW = isl.widthCells / isl.overlay.cols;
  const c = Math.min(isl.overlay.cols - 1, Math.max(0, Math.floor((x - isl.x) / texW)));
  const r = Math.min(isl.overlay.rows - 1, Math.max(0, Math.floor((y - isl.y) / texW)));
  return (r * isl.overlay.cols + c) * 4;
}

/** Alpha at tile-space (x, y) across an island list; 0 where nothing is
 *  allocated. The test-local mirror of paintTileAlphaAt, kept separate so
 *  the assertions about that function don't test it with itself. */
function alphaAt(islands: readonly CanvasPaintIsland[] | undefined, x: number, y: number): number {
  const isl = islandAt(islands, x, y);
  return isl ? isl.overlay.rgba[texelOffset(isl, x, y) + 3] : 0;
}

// A texel-center-aligned coordinate at density 8 (texel = 1/8 cell), so the
// centermost texel sits at distance 0 → falloff exactly 1.
const C = 0.0625;

/** A conforming, fully-transparent tile at tile grid slot (tx, ty) — what a
 *  hand-built save could hold after an external eraser pass. */
function emptyTile(tx: number, ty: number): CanvasPaintIsland {
  return {
    x: tx * CANVAS_ISLAND_CELLS,
    y: ty * CANVAS_ISLAND_CELLS,
    widthCells: CANVAS_ISLAND_CELLS,
    overlay: {
      cols: CANVAS_ISLAND_TEXELS,
      rows: CANVAS_ISLAND_TEXELS,
      rgba: new Uint8Array(CANVAS_ISLAND_TEXELS * CANVAS_ISLAND_TEXELS * 4),
      blend: 'normal',
    },
  };
}

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
    const edge = CANVAS_ISLAND_CELLS; // tile-space x = 16, the tile boundary
    const changed = stampCanvasPaint(working, edge, 8 + C, 2, RED, 1);
    expect(new Set(changed)).toEqual(new Set([islandKey(0, 0), islandKey(CANVAS_ISLAND_CELLS, 0)]));
    const islands = commitCanvasPaint(working)!;
    // Ink on both sides of the border…
    const left = alphaAt(islands, edge - C, 8 + C);
    const right = alphaAt(islands, edge + C, 8 + C);
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
    // …and symmetric: the two texel centers sit at the same distance from
    // the dab center, so a split lattice would betray itself here. The
    // stroke lays the exact texels one big bitmap would.
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

describe('erase, blur and compose/commit', () => {
  it('erases back out and prunes an emptied island at commit', () => {
    const paint = createCanvasPaintWorking(undefined);
    stampCanvasPaint(paint, 8 + C, 8 + C, 2, RED, 1);
    const committed = commitCanvasPaint(paint)!;

    const erase = createCanvasPaintWorking(committed);
    expect(eraseCanvasPaint(erase, 8 + C, 8 + C, 4, 1).length).toBe(1);
    // The falloff thins the dab's rim rather than zeroing it in one pass
    // (same soft edge a stamp lays down) — a few more passes lift it fully.
    for (let i = 0; i < 8; i++) eraseCanvasPaint(erase, 8 + C, 8 + C, 6, 1);
    // Erased-empty tiles prune to undefined: byte-identical to never painted.
    expect(commitCanvasPaint(erase)).toBeUndefined();
  });

  it('erasing never allocates', () => {
    const working = createCanvasPaintWorking(undefined);
    expect(eraseCanvasPaint(working, 8, 8, 4, 1)).toEqual([]);
    expect(working.touched.size).toBe(0);
  });

  it('blurring empty plane changes nothing, and its scouting tiles prune at commit', () => {
    // The blur pass allocates tiles under the disc so spread has somewhere
    // to land — but a dab over nothing spreads nothing, reports nothing
    // changed, and the untouched allocations prune away at commit exactly
    // like an erased-empty tile.
    const working = createCanvasPaintWorking(undefined);
    expect(blurCanvasPaint(working, 8, 8, 4, 1)).toEqual([]);
    expect(commitCanvasPaint(working)).toBeUndefined();
  });

  /** A committed tile at grid slot (0,0) painted solid red over its
   *  rightmost two cells — a hard paint edge flush against the tile seam at
   *  x = 16, with nothing allocated beyond it. */
  function redEdgeAtSeam(): CanvasPaintIsland[] {
    const tile = emptyTile(0, 0);
    const { cols, rows, rgba } = tile.overlay;
    for (let r = 0; r < rows; r++) {
      for (let c = cols - 16; c < cols; c++) {
        const i = (r * cols + c) * 4;
        rgba[i] = 255;
        rgba[i + 3] = 255;
      }
    }
    return [tile];
  }

  it('blur reads and spreads across the tile seam — the grid is invisible', () => {
    const seam = CANVAS_ISLAND_CELLS;
    const working = createCanvasPaintWorking(redEdgeAtSeam());
    const changed = blurCanvasPaint(working, seam, 8 + C, 2, 1);
    // The paint's edge feathered PAST the seam, into a tile that did not
    // exist — the kernel read the red through the seam and the spread
    // allocated where it landed.
    expect(changed).toContain(islandKey(CANVAS_ISLAND_CELLS, 0));
    const tiles = commitCanvasPaint(working)!;
    expect(alphaAt(tiles, seam + C, 8 + C)).toBeGreaterThan(0);
    // What spread is the paint's own colour (alpha-weighted average), not
    // transparent black dragged in.
    const isl = islandAt(tiles, seam + C, 8 + C)!;
    const o = texelOffset(isl, seam + C, 8 + C);
    expect(isl.overlay.rgba[o]).toBeGreaterThan(200);      // red
    expect(isl.overlay.rgba[o + 1]).toBe(0);
    expect(isl.overlay.rgba[o + 2]).toBe(0);
    // And the last texel left of the seam softened DOWN — it now averages
    // with the genuinely transparent plane on the other side, exactly as an
    // edge in the middle of a tile would.
    expect(alphaAt(tiles, seam - C, 8 + C)).toBeLessThan(255);
  });

  it('blur bounds fence writes but not reads', () => {
    const seam = CANVAS_ISLAND_CELLS;
    const working = createCanvasPaintWorking(redEdgeAtSeam());
    const changed = blurCanvasPaint(working, seam, 8 + C, 2, 1, {
      x: 0, y: 0, w: CANVAS_ISLAND_CELLS, h: CANVAS_ISLAND_CELLS,
    });
    // Nothing lands past the fence…
    expect(changed).toEqual([islandKey(0, 0)]);
    const tiles = commitCanvasPaint(working)!;
    expect(alphaAt(tiles, seam + C, 8 + C)).toBe(0);
    // …but the fenced-in edge still softens (its reads crossed the seam to
    // the transparent plane as freely as ever).
    expect(alphaAt(tiles, seam - C, 8 + C)).toBeLessThan(255);
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
    // Undo entries hold committed tiles by reference, so a stroke that never
    // touched a tile must hand back the SAME object, not a copy.
    expect(untouched).toBe(committed.find((isl) => isl.x !== 0));
  });
});

describe('smudgeCanvasPaint — the push brush\'s raster half', () => {
  /** Colour at tile-space (x, y), or null where nothing is allocated. */
  const rgbaAt = (islands: readonly CanvasPaintIsland[] | undefined, x: number, y: number) => {
    const isl = islandAt(islands, x, y);
    if (!isl) return null;
    const i = texelOffset(isl, x, y);
    return [isl.overlay.rgba[i], isl.overlay.rgba[i + 1], isl.overlay.rgba[i + 2],
      isl.overlay.rgba[i + 3]];
  };

  it('drags paint along under the brush, leaving its old place thinner', () => {
    const paint = createCanvasPaintWorking(undefined);
    stampCanvasPaint(paint, 4 + C, 8 + C, 1, RED, 1);
    const committed = commitCanvasPaint(paint)!;
    const before = alphaAt(committed, 5, 8 + C);

    const push = createCanvasPaintWorking(committed);
    // Ten dabs walking +x, each carrying an eighth of a cell — a stroke, the
    // way the brush actually arrives.
    for (let i = 0; i < 10; i++) {
      smudgeCanvasPaint(push, 4 + C + i * 0.125, 8 + C, 1, 1, 0.125, 0);
    }
    const after = composeCanvasPaint(push);
    // Paint arrived ahead of where the blob ended…
    expect(alphaAt(after, 5, 8 + C)).toBeGreaterThan(before);
    // …and it is the blob's own colour that arrived, not some average.
    const [r, g, b] = rgbaAt(after, 5, 8 + C)!;
    expect(r).toBeGreaterThan(g + 100);
    expect(b).toBeLessThan(60);
    // …while the trailing edge gave some up.
    expect(alphaAt(after, 3.8, 8 + C)).toBeLessThan(alphaAt(committed, 3.8, 8 + C) - 20);
  });

  it('carries paint across a tile seam without a join showing', () => {
    // Blur may treat each tile as its own world; a smudge may not, or every
    // stroke would draw the 16-cell tile grid over itself. The dab reads
    // whichever tile actually holds the source texel.
    const seam = CANVAS_ISLAND_CELLS; // the first boundary, cell 16
    const paint = createCanvasPaintWorking(undefined);
    stampCanvasPaint(paint, seam - 0.5, 8 + C, 0.5, RED, 1);
    const committed = commitCanvasPaint(paint)!;
    expect(committed).toHaveLength(1); // all of it in the low tile

    const push = createCanvasPaintWorking(committed);
    for (let i = 0; i < 8; i++) {
      smudgeCanvasPaint(push, seam - 0.5 + i * 0.125, 8 + C, 0.5, 1, 0.125, 0);
    }
    const after = composeCanvasPaint(push);
    // Paint crossed into the neighbouring tile, which the pass allocated.
    expect(after.length).toBe(2);
    expect(alphaAt(after, seam + 0.1, 8 + C)).toBeGreaterThan(0);
  });

  it('does not cascade: one dab moves paint by its own delta, not the disc', () => {
    // The trap in reading one texel to write another. Walked the wrong way,
    // a single dab drags the leading colour the whole width of the brush.
    const paint = createCanvasPaintWorking(undefined);
    stampCanvasPaint(paint, 8 + C, 8 + C, 0.5, RED, 1);
    const committed = commitCanvasPaint(paint)!;

    const push = createCanvasPaintWorking(committed);
    smudgeCanvasPaint(push, 8 + C, 8 + C, 2, 1, 0.25, 0);
    const after = composeCanvasPaint(push);
    // The blob reached x ≈ 8.6; one dab carrying a quarter cell can put
    // paint a little past that and no further. A cascading pass would have
    // dragged the leading colour the whole two-cell width of the brush.
    expect(alphaAt(after, 9.0, 8 + C)).toBe(0);
    expect(alphaAt(after, 10, 8 + C)).toBe(0);
    expect(alphaAt(after, 8.8, 8 + C)).toBeLessThan(40);
  });

  it('is inert without a delta, or without strength', () => {
    const paint = createCanvasPaintWorking(undefined);
    stampCanvasPaint(paint, 8 + C, 8 + C, 1, RED, 1);
    const committed = commitCanvasPaint(paint)!;
    const push = createCanvasPaintWorking(committed);
    expect(smudgeCanvasPaint(push, 8 + C, 8 + C, 1, 1, 0, 0)).toEqual([]);
    expect(smudgeCanvasPaint(push, 8 + C, 8 + C, 1, 0, 1, 1)).toEqual([]);
    expect(push.touched.size).toBe(0);
  });

  it('leaves nothing behind on bare canvas', () => {
    // Tiles the disc covers are allocated so paint can be pushed OUT into
    // them; ones the smear never reaches prune away at commit, exactly as a
    // never-painted tile does.
    const push = createCanvasPaintWorking(undefined);
    smudgeCanvasPaint(push, 8 + C, 8 + C, 2, 1, 0.5, 0);
    expect(commitCanvasPaint(push)).toBeUndefined();
  });
});

describe('unary blend modes', () => {
  it('invert rewrites each texel once per stroke, not once per dab', () => {
    const paint = createCanvasPaintWorking(undefined);
    stampCanvasPaint(paint, 8 + C, 8 + C, 2, RED, 1);
    const committed = commitCanvasPaint(paint)!;

    const invert = createCanvasPaintWorking(committed);
    const blend = { mode: 'invert' as const };
    stampCanvasPaint(invert, 8 + C, 8 + C, 2, RED, 1, blend);
    const once = islandAt(composeCanvasPaint(invert), 8 + C, 8 + C)!;
    const value = once.overlay.rgba[texelOffset(once, 8 + C, 8 + C)];
    expect(value).toBe(0); // 255 red inverted
    // A second dab of the same stroke must not invert back.
    stampCanvasPaint(invert, 8 + C, 8 + C, 2, RED, 1, blend);
    const twice = islandAt(composeCanvasPaint(invert), 8 + C, 8 + C)!;
    expect(twice.overlay.rgba[texelOffset(twice, 8 + C, 8 + C)]).toBe(0);
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

describe('paintTilesContentRect', () => {
  it('is the ink bounds restated as an origin+size rect', () => {
    // The contentRect a fresh PaintObject is minted with: same texels the
    // ink bounds see, just the shape a bbox wants.
    const working = createCanvasPaintWorking(undefined);
    stampCanvasPaint(working, 8 + C, 8 + C, 1, RED, 1);
    stampCanvasPaint(working, 200 + C, 40 + C, 1, RED, 1);
    const tiles = commitCanvasPaint(working)!;
    const b = canvasPaintInkBounds(tiles)!;
    expect(paintTilesContentRect(tiles)).toEqual({
      x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY,
    });
  });

  it('is null when nothing is painted', () => {
    expect(paintTilesContentRect(undefined)).toBeNull();
    expect(paintTilesContentRect([])).toBeNull();
    // A tile can exist with no ink mid-stroke (fully erased, not yet
    // pruned); it must not produce a phantom rect.
    expect(paintTilesContentRect([emptyTile(0, 0)])).toBeNull();
  });
});

describe('paintTileAlphaAt', () => {
  it('samples the texel alpha under a tile-space point', () => {
    const working = createCanvasPaintWorking(undefined);
    stampCanvasPaint(working, 8 + C, 8 + C, 1, RED, 1);
    const tiles = commitCanvasPaint(working)!;
    expect(paintTileAlphaAt(tiles, 8 + C, 8 + C)).toBe(255);
    // Inside the allocated tile but outside the dab: transparent texel.
    expect(paintTileAlphaAt(tiles, 14, 14)).toBe(0);
  });

  it('is 0 where no tile is allocated — sparse space is not a hit', () => {
    const working = createCanvasPaintWorking(undefined);
    stampCanvasPaint(working, 8 + C, 8 + C, 1, RED, 1);
    const tiles = commitCanvasPaint(working)!;
    // Far outside every tile: no allocation, alpha 0, no throw.
    expect(paintTileAlphaAt(tiles, 500, 500)).toBe(0);
    expect(paintTileAlphaAt(undefined, 8, 8)).toBe(0);
    expect(paintTileAlphaAt([], 8, 8)).toBe(0);
  });
});

describe('normalizeCanvasPaintIslands', () => {
  it('passes conforming islands through by reference', () => {
    const working = createCanvasPaintWorking(undefined);
    stampCanvasPaint(working, 8 + C, 8 + C, 1, RED, 1);
    const islands = commitCanvasPaint(working)!;
    expect(normalizeCanvasPaintIslands(islands)![0]).toBe(islands[0]);
  });

  it('re-tiles a non-conforming island onto the allocation grid', () => {
    // A hand-edited save (or a foreign writer): 2×2 texels of solid red
    // spanning cells [3,7)×[5,9) — off-origin, wrong span, wrong density.
    const rgba = new Uint8Array(2 * 2 * 4);
    for (let i = 0; i < 4; i++) { rgba[i * 4] = 255; rgba[i * 4 + 3] = 255; }
    const foreign: CanvasPaintIsland = {
      x: 3, y: 5, widthCells: 4,
      overlay: { cols: 2, rows: 2, rgba, blend: 'normal' },
    };
    const out = normalizeCanvasPaintIslands([foreign])!;
    expect(out).toHaveLength(1);
    // Now on the fixed grid the stamp path relies on…
    expect(out[0].x).toBe(0);
    expect(out[0].y).toBe(0);
    expect(out[0].widthCells).toBe(CANVAS_ISLAND_CELLS);
    expect(out[0].overlay.cols).toBe(CANVAS_ISLAND_TEXELS);
    // …with the ink where the foreign island painted it, and nowhere else.
    expect(paintTileAlphaAt(out, 4, 6)).toBe(255);
    expect(paintTileAlphaAt(out, 1, 1)).toBe(0);
  });

  it('splits a non-conforming island that straddles the tile grid', () => {
    // Same foreign shape, but crossing the x = 16 grid line: cells [14,18).
    const rgba = new Uint8Array(2 * 2 * 4);
    for (let i = 0; i < 4; i++) { rgba[i * 4] = 255; rgba[i * 4 + 3] = 255; }
    const straddling: CanvasPaintIsland = {
      x: 14, y: 0, widthCells: 4,
      overlay: { cols: 2, rows: 2, rgba, blend: 'normal' },
    };
    const out = normalizeCanvasPaintIslands([straddling])!;
    expect(new Set(out.map((isl) => islandKey(isl.x, isl.y))))
      .toEqual(new Set([islandKey(0, 0), islandKey(CANVAS_ISLAND_CELLS, 0)]));
    expect(paintTileAlphaAt(out, 15, 1)).toBe(255);
    expect(paintTileAlphaAt(out, 17, 1)).toBe(255);
  });

  it('drops conforming-but-empty islands, and returns undefined when nothing survives', () => {
    const working = createCanvasPaintWorking(undefined);
    stampCanvasPaint(working, 8 + C, 8 + C, 1, RED, 1);
    const inked = commitCanvasPaint(working)![0];
    const out = normalizeCanvasPaintIslands([emptyTile(2, 2), inked])!;
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(inked);
    // All-empty in, undefined out — same shape a fully-erased commit has.
    expect(normalizeCanvasPaintIslands([emptyTile(0, 0)])).toBeUndefined();
    expect(normalizeCanvasPaintIslands([])).toBeUndefined();
    expect(normalizeCanvasPaintIslands(undefined)).toBeUndefined();
  });
});

describe('stampCanvasPaint occlusion mask', () => {
  const halfMask = { forIsland: () => () => 0.5 };

  it('weights every deposited texel by what the mask lets through', () => {
    const masked = createCanvasPaintWorking();
    const plain = createCanvasPaintWorking();
    stampCanvasPaint(masked, 8 + C, 8 + C, 2, RED, 1, undefined, halfMask);
    stampCanvasPaint(plain, 8 + C, 8 + C, 2, RED, 0.5);
    // A 0.5 mask over a full-alpha dab is byte-identical to an unmasked
    // half-alpha dab: occlusion is a scaled deposit, not a separate pass.
    expect(commitCanvasPaint(masked)).toEqual(commitCanvasPaint(plain));
  });

  it('a fully blocking mask deposits nothing — no tiles survive commit', () => {
    const working = createCanvasPaintWorking();
    stampCanvasPaint(working, 8 + C, 8 + C, 2, RED, 1, undefined, { forIsland: () => () => 0 });
    expect(commitCanvasPaint(working)).toBeUndefined();
  });

  it('hands forIsland each island origin so weights resolve in tile space', () => {
    const seen: [number, number][] = [];
    const mask = {
      forIsland: (_key: string, _n: number, ox: number, oy: number) => {
        seen.push([ox, oy]);
        return () => 1;
      },
    };
    const working = createCanvasPaintWorking();
    // A dab straddling the tile border at x=16 touches two tiles; each must
    // report its own origin (local texel coords alone would collide).
    stampCanvasPaint(working, 16, 8 + C, 2, RED, 1, undefined, mask);
    expect(seen.sort()).toEqual([[0, 0], [16, 0]]);
  });
});

describe('non-normal blends mutate existing paint only', () => {
  const BLUE = { r: 0, g: 0, b: 255 };
  const YELLOW = { r: 255, g: 255, b: 0 };

  it('a blend dab on empty canvas deposits nothing — and allocates nothing', () => {
    const working = createCanvasPaintWorking();
    expect(stampCanvasPaint(working, 8 + C, 8 + C, 2, YELLOW, 1, { mode: 'multiply' }))
      .toEqual([]);
    expect(working.touched.size).toBe(0);
    expect(commitCanvasPaint(working)).toBeUndefined();
  });

  it('dodge edits the color under the brush without touching its alpha', () => {
    const working = createCanvasPaintWorking();
    stampCanvasPaint(working, 8 + C, 8 + C, 2, BLUE, 0.5);
    const before = composeCanvasPaint(working);
    const isl = islandAt(before, 8 + C, 8 + C)!;
    const i = texelOffset(isl, 8 + C, 8 + C);
    const alphaBefore = isl.overlay.rgba[i + 3];
    expect(alphaBefore).toBeGreaterThan(0);
    expect(alphaBefore).toBeLessThan(255); // half-strength paint: the edit
    // must not thicken it toward full coverage.

    stampCanvasPaint(working, 8 + C, 8 + C, 2, YELLOW, 1, { mode: 'dodge' });
    const after = islandAt(composeCanvasPaint(working), 8 + C, 8 + C)!;
    // Dodging yellow blows out the channels the brush has; blue survives.
    expect(after.overlay.rgba[i]).toBeGreaterThan(0);
    expect(after.overlay.rgba[i + 1]).toBeGreaterThan(0);
    expect(after.overlay.rgba[i + 2]).toBe(255);
    // Alpha untouched — the stroke edited paint, it laid none down.
    expect(after.overlay.rgba[i + 3]).toBe(alphaBefore);
  });

  it('the mutate rule stops at the ink edge — texels past it stay empty', () => {
    const working = createCanvasPaintWorking();
    stampCanvasPaint(working, 8 + C, 8 + C, 1, BLUE, 1);
    // A much wider dodge dab centered on the same spot reaches plenty of
    // empty texels; none of them may take paint.
    stampCanvasPaint(working, 8 + C, 8 + C, 6, YELLOW, 1, { mode: 'dodge' });
    expect(alphaAt(composeCanvasPaint(working), 8 + C + 4, 8 + C)).toBe(0);
  });

  it("blend { mode: 'normal' } still deposits like a plain dab", () => {
    const plain = createCanvasPaintWorking();
    const normal = createCanvasPaintWorking();
    stampCanvasPaint(plain, 8 + C, 8 + C, 2, BLUE, 0.5);
    stampCanvasPaint(normal, 8 + C, 8 + C, 2, BLUE, 0.5, { mode: 'normal' });
    expect(commitCanvasPaint(normal)).toEqual(commitCanvasPaint(plain));
  });
});
