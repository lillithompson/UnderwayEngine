/**
 * PaintObject helpers (paintObject.ts): the world→tile frame map
 * ({@link paintLocalFrame}), the in-creation-frame predicate, construction
 * from committed tiles, alpha hit-testing, and the island merge (flatten) —
 * plus the composition-level merge entry builder
 * (compositionMergeObjects.ts `buildMergePaintEntry`).
 */

import {
  CanvasPaintIsland,
  CompositionState,
  PaintObject,
  RGBColor,
  SVGObject,
  makeViewport,
} from '../types';
import {
  commitCanvasPaint,
  createCanvasPaintWorking,
  islandHeightCells,
  paintTileAlphaAt,
  paintTilesContentRect,
  stampCanvasPaint,
} from '../canvasPaint';
import {
  canMergePaintObjects,
  createPaintObjectFromTiles,
  mergePaintObjects,
  mintPaintObjectId,
  paintLocalFrame,
  paintObjectAlphaHitTest,
  paintObjectIsUntransformed,
} from '../paintObject';
import {
  applyCompOps,
  computeSVGBbox,
  revertCompOps,
} from '../compositionOps';
import { canMergePaintSelection, buildMergePaintEntry } from '../compositionMergeObjects';

const RED: RGBColor = { r: 255, g: 0, b: 0 };
const BLUE: RGBColor = { r: 0, g: 0, b: 255 };

// A texel-center-aligned coordinate at density 8 (texel = 1/8 cell), so a
// dab center sits exactly on a texel center and deposits full alpha there.
const C = 0.0625;

/** Committed tiles holding one full-alpha dab per (x, y) given. */
function dabTiles(
  dabs: readonly [number, number][],
  color: RGBColor = RED,
  radius = 1,
): CanvasPaintIsland[] {
  const working = createCanvasPaintWorking(undefined);
  for (const [x, y] of dabs) stampCanvasPaint(working, x, y, radius, color, 1);
  const tiles = commitCanvasPaint(working);
  if (!tiles) throw new Error('fixture dabs painted nothing');
  return tiles;
}

/** A fresh in-session island: 1:1, bbox == contentRect == ink bounds. */
function dabPaint(
  id: string,
  dabs: readonly [number, number][],
  color: RGBColor = RED,
): PaintObject {
  const p = createPaintObjectFromTiles(id, dabTiles(dabs, color));
  if (!p) throw new Error('fixture island had no ink');
  return p;
}

/** A minimal frame-math fixture: tiles are irrelevant to paintLocalFrame,
 *  so a literal with the given rects is enough. */
function bareRect(
  content: { x: number; y: number; w: number; h: number },
  bbox: { x: number; y: number; w: number; h: number },
  extras: Partial<PaintObject> = {},
): PaintObject {
  return {
    id: 'pnt_bare',
    cellX: bbox.x, cellY: bbox.y, cellWidth: bbox.w, cellHeight: bbox.h,
    tiles: [],
    contentX: content.x, contentY: content.y, contentW: content.w, contentH: content.h,
    ...extras,
  };
}

/** RGBA at tile-space (x, y) across `tiles`; all zeros where unallocated. */
function texelAt(
  tiles: readonly CanvasPaintIsland[],
  x: number,
  y: number,
): { r: number; g: number; b: number; a: number } {
  for (const isl of tiles) {
    if (x < isl.x || x >= isl.x + isl.widthCells || y < isl.y) continue;
    const h = islandHeightCells(isl);
    if (y >= isl.y + h) continue;
    const { cols, rows, rgba } = isl.overlay;
    const c = Math.min(cols - 1, Math.max(0, Math.floor(((x - isl.x) / isl.widthCells) * cols)));
    const r = Math.min(rows - 1, Math.max(0, Math.floor(((y - isl.y) / h) * rows)));
    const i = (r * cols + c) * 4;
    return { r: rgba[i], g: rgba[i + 1], b: rgba[i + 2], a: rgba[i + 3] };
  }
  return { r: 0, g: 0, b: 0, a: 0 };
}

const closeTo = (got: readonly [number, number], want: readonly [number, number]) => {
  expect(got[0]).toBeCloseTo(want[0], 9);
  expect(got[1]).toBeCloseTo(want[1], 9);
};

describe('paintLocalFrame', () => {
  it('is the identity for an untransformed island — tile space IS world space', () => {
    const p = dabPaint('pnt_a', [[8 + C, 8 + C]]);
    const frame = paintLocalFrame(p);
    closeTo(frame.toTile(8 + C, 8 + C), [8 + C, 8 + C]);
    closeTo(frame.toTile(0, 0), [0, 0]);
    expect(frame.radiusScale).toBeCloseTo(1, 9);
    expect(frame.cullRadius).toBeCloseTo(Math.hypot(p.cellWidth, p.cellHeight) / 2, 9);
    // The identity map lands the world dab position on inked texels.
    const [tx, ty] = frame.toTile(8 + C, 8 + C);
    expect(paintTileAlphaAt(p.tiles, tx, ty)).toBe(255);
  });

  it('undoes a translation — a moved bbox maps world points back into the tiles', () => {
    const p = dabPaint('pnt_a', [[8 + C, 8 + C]]);
    // A move changes cellX/Y only; contentRect and tiles stay put.
    const moved: PaintObject = { ...p, cellX: p.cellX + 100, cellY: p.cellY - 50 };
    const frame = paintLocalFrame(moved);
    const [tx, ty] = frame.toTile(8 + C + 100, 8 + C - 50);
    closeTo([tx, ty], [8 + C, 8 + C]);
    expect(paintTileAlphaAt(moved.tiles, tx, ty)).toBe(255);
    expect(frame.radiusScale).toBeCloseTo(1, 9);
  });

  it('undoes rotation 90 — the swapped-dims world bbox maps corners back', () => {
    // 8×4 content rotated 90° CW: the world bbox is 4×8. World corners come
    // back to the tile corners a CW turn sent them from: the bbox top-right
    // was the content origin, the bbox bottom-left was its far corner.
    const p = bareRect(
      { x: 0, y: 0, w: 8, h: 4 },
      { x: 0, y: 0, w: 4, h: 8 },
      { rotation: 90 },
    );
    const frame = paintLocalFrame(p);
    closeTo(frame.toTile(4, 0), [0, 0]);
    closeTo(frame.toTile(0, 8), [8, 4]);
    // The world bbox center is the tile-space content center.
    closeTo(frame.toTile(2, 4), [4, 2]);
    expect(frame.radiusScale).toBeCloseTo(1, 9);
  });

  it('undoes a horizontal mirror — the world left edge reads the tile right edge', () => {
    const p = bareRect(
      { x: 0, y: 0, w: 8, h: 4 },
      { x: 0, y: 0, w: 8, h: 4 },
      { mirrorH: true },
    );
    const frame = paintLocalFrame(p);
    closeTo(frame.toTile(0, 2), [8, 2]);
    closeTo(frame.toTile(8, 2), [0, 2]);
    // The un-mirrored axis is untouched.
    closeTo(frame.toTile(4, 0), [4, 0]);
  });

  it('undoes free rotation (angleDeg 45) about the bbox center', () => {
    const p = bareRect(
      { x: 0, y: 0, w: 8, h: 8 },
      { x: 0, y: 0, w: 8, h: 8 },
      { angleDeg: 45 },
    );
    const frame = paintLocalFrame(p);
    // The center is the fixed point of the rotation.
    closeTo(frame.toTile(4, 4), [4, 4]);
    // A 45° CW turn carries tile (6, 2) — northeast of center — to due east
    // of center in world space, 2√2 out; the inverse map brings it home.
    closeTo(frame.toTile(4 + 2 * Math.SQRT2, 4), [6, 2]);
  });

  it('reflects a bbox stretch in the map and in radiusScale', () => {
    // 8×8 content stretched onto a 16×16 world bbox: world distances are
    // twice tile distances, so a world brush radius must shrink by half to
    // keep its on-screen footprint.
    const p = bareRect(
      { x: 0, y: 0, w: 8, h: 8 },
      { x: 0, y: 0, w: 16, h: 16 },
    );
    const frame = paintLocalFrame(p);
    closeTo(frame.toTile(0, 0), [0, 0]);
    closeTo(frame.toTile(16, 16), [8, 8]);
    closeTo(frame.toTile(8, 8), [4, 4]);
    expect(frame.radiusScale).toBeCloseTo(0.5, 9);
  });
});

describe('paintObjectIsUntransformed', () => {
  it('is true at creation — the session frame', () => {
    expect(paintObjectIsUntransformed(dabPaint('pnt_a', [[8 + C, 8 + C]]))).toBe(true);
  });

  it('is false after any transform field, group membership, or bbox drift', () => {
    const p = dabPaint('pnt_a', [[8 + C, 8 + C]]);
    expect(paintObjectIsUntransformed({ ...p, rotation: 90 })).toBe(false);
    expect(paintObjectIsUntransformed({ ...p, angleDeg: 5 })).toBe(false);
    expect(paintObjectIsUntransformed({ ...p, mirrorH: true })).toBe(false);
    expect(paintObjectIsUntransformed({ ...p, mirrorV: true })).toBe(false);
    expect(paintObjectIsUntransformed({ ...p, groupId: 'g1' })).toBe(false);
    // bbox ≠ contentRect: a move or a scale each end the session frame.
    expect(paintObjectIsUntransformed({ ...p, cellX: p.cellX + 1 })).toBe(false);
    expect(paintObjectIsUntransformed({ ...p, cellWidth: p.cellWidth * 2 })).toBe(false);
  });
});

describe('createPaintObjectFromTiles', () => {
  it('mints a 1:1 island: bbox == contentRect == the tiles’ ink bounds', () => {
    const tiles = dabTiles([[8 + C, 8 + C], [40 + C, 20 + C]]);
    const p = createPaintObjectFromTiles('pnt_a', tiles)!;
    expect(p).not.toBeNull();
    expect(p.id).toBe('pnt_a');
    expect(p.tiles).toBe(tiles);
    const rect = paintTilesContentRect(tiles)!;
    expect(p.cellX).toBe(rect.x);
    expect(p.cellY).toBe(rect.y);
    expect(p.cellWidth).toBe(rect.w);
    expect(p.cellHeight).toBe(rect.h);
    expect(p.contentX).toBe(rect.x);
    expect(p.contentY).toBe(rect.y);
    expect(p.contentW).toBe(rect.w);
    expect(p.contentH).toBe(rect.h);
    expect(paintObjectIsUntransformed(p)).toBe(true);
  });

  it('is null when the tiles hold no ink — the caller commits nothing', () => {
    expect(createPaintObjectFromTiles('pnt_a', undefined)).toBeNull();
    expect(createPaintObjectFromTiles('pnt_a', [])).toBeNull();
  });
});

describe('paintObjectAlphaHitTest', () => {
  it('hits on ink and misses the blank gap of one sparse island', () => {
    // One object, two blobs 32 cells apart: the bbox spans the gap, but the
    // gap has no allocated tile — a tap there must fall through to whatever
    // sits behind the island.
    const p = dabPaint('pnt_a', [[8 + C, 8 + C], [40 + C, 8 + C]]);
    expect(paintObjectAlphaHitTest(p, 8 + C, 8 + C, 0)).toBe(true);
    expect(paintObjectAlphaHitTest(p, 40 + C, 8 + C, 0)).toBe(true);
    expect(paintObjectAlphaHitTest(p, 24, 8 + C, 0)).toBe(false);
  });

  it('tolerance turns a near-miss into a hit', () => {
    const p = dabPaint('pnt_a', [[8 + C, 8 + C]]);
    // Two cells right of the dab center — clear of the radius-1 dab…
    expect(paintObjectAlphaHitTest(p, 10 + C, 8 + C, 0)).toBe(false);
    // …but the 5-point tolerance cross reaches back onto the ink.
    expect(paintObjectAlphaHitTest(p, 10 + C, 8 + C, 2)).toBe(true);
  });
});

describe('canMergePaintObjects', () => {
  it('needs at least two islands, each with tiles', () => {
    const a = dabPaint('pnt_a', [[8 + C, 8 + C]]);
    const b = dabPaint('pnt_b', [[12 + C, 8 + C]]);
    expect(canMergePaintObjects([])).toBe(false);
    expect(canMergePaintObjects([a])).toBe(false);
    expect(canMergePaintObjects([a, { ...b, tiles: [] }])).toBe(false);
    expect(canMergePaintObjects([a, b])).toBe(true);
  });
});

describe('mergePaintObjects', () => {
  it('composites overlapping islands source-over in z-order — red over blue is red', () => {
    const blue = dabPaint('pnt_blue', [[8 + C, 8 + C]], BLUE);
    const red = dabPaint('pnt_red', [[8 + C, 8 + C]], RED);
    // Sources are given back→front: red is the front island.
    const merged = mergePaintObjects([blue, red], 'pnt_m')!;
    expect(merged).not.toBeNull();
    const texel = texelAt(merged.tiles, 8 + C, 8 + C);
    // Full-alpha red on top hides the blue beneath entirely.
    expect(texel.a).toBe(255);
    expect(texel.r).toBe(255);
    expect(texel.b).toBe(0);
    // The merged island is 1:1 again: contentRect == bbox == ink bounds.
    expect(paintObjectIsUntransformed(merged)).toBe(true);
  });

  it('bakes per-island opacity into texel alpha; the result itself is opaque', () => {
    const faded: PaintObject = { ...dabPaint('pnt_a', [[8 + C, 8 + C]]), opacity: 0.5 };
    const solid = dabPaint('pnt_b', [[40 + C, 8 + C]], BLUE);
    const merged = mergePaintObjects([faded, solid], 'pnt_m')!;
    // The faded island's full-alpha center texel lands at half alpha…
    expect(texelAt(merged.tiles, 8 + C, 8 + C).a).toBe(Math.round(0.5 * 255));
    // …the solid one is untouched…
    expect(texelAt(merged.tiles, 40 + C, 8 + C).a).toBe(255);
    // …and the fade is spent: rendering the result at its own opacity again
    // would fade the pixels twice.
    expect(merged.opacity ?? 1).toBe(1);
  });

  it('merges far-apart islands into sparse tiles that skip the empty gap', () => {
    const a = dabPaint('pnt_a', [[8 + C, 8 + C]]);
    const b = dabPaint('pnt_b', [[808 + C, 8 + C]], BLUE);
    const merged = mergePaintObjects([a, b], 'pnt_m')!;
    // Both blobs survive where they were…
    expect(texelAt(merged.tiles, 8 + C, 8 + C).a).toBe(255);
    expect(texelAt(merged.tiles, 808 + C, 8 + C).a).toBe(255);
    // …and the bbox spans the whole 800-cell gap…
    expect(merged.cellWidth).toBeGreaterThan(790);
    // …but the tile list only holds the blobs' own tiles, a small fraction
    // of what tiling the full AABB would take (the sparse-merge guarantee).
    const fullTiling =
      (Math.floor((merged.cellX + merged.cellWidth) / 16) - Math.floor(merged.cellX / 16) + 1)
      * (Math.floor((merged.cellY + merged.cellHeight) / 16) - Math.floor(merged.cellY / 16) + 1);
    expect(fullTiling).toBeGreaterThanOrEqual(50);
    expect(merged.tiles.length).toBeLessThanOrEqual(4);
    expect(merged.tiles.length).toBeLessThan(fullTiling / 10);
  });

  it('resamples a rotated source in place — ink lands at its rotated world position', () => {
    // Two dabs on a horizontal line, then the island turned 90° CW about its
    // bbox center (dims swap about the fixed center, like the rotate op).
    const p = dabPaint('pnt_a', [[2 + C, 2 + C], [10 + C, 2 + C]]);
    const cx = p.cellX + p.cellWidth / 2;
    const cy = p.cellY + p.cellHeight / 2;
    const p90: PaintObject = {
      ...p,
      rotation: 90,
      cellX: cx - p.cellHeight / 2,
      cellY: cy - p.cellWidth / 2,
      cellWidth: p.cellHeight,
      cellHeight: p.cellWidth,
    };
    // Where the CW turn puts the left dab: (dx, dy) about the center maps to
    // (-dy, dx) in screen (y-down) coordinates.
    const dx = 2 + C - cx;
    const dy = 2 + C - cy;
    const wx = cx - dy;
    const wy = cy + dx;
    // Pin the convention against the source's own world-space hit test first,
    // so the merge assertion below cannot pass for the wrong reason.
    expect(paintObjectAlphaHitTest(p90, wx, wy, 0.1)).toBe(true);

    const other = dabPaint('pnt_b', [[100 + C, 100 + C]], BLUE);
    const merged = mergePaintObjects([other, p90], 'pnt_m')!;
    // The merged island is world-anchored 1:1, so tile space is world space:
    // the ink shows at the rotated position and not at the pre-rotation one.
    expect(texelAt(merged.tiles, wx, wy).a).toBeGreaterThan(0);
    expect(texelAt(merged.tiles, 2 + C, 2 + C).a).toBe(0);
  });

  it('takes its name from the front-most source', () => {
    const back: PaintObject = { ...dabPaint('pnt_a', [[8 + C, 8 + C]]), name: 'Under' };
    const front: PaintObject = { ...dabPaint('pnt_b', [[12 + C, 8 + C]], BLUE), name: 'Over' };
    expect(mergePaintObjects([back, front], 'pnt_m')!.name).toBe('Over');
    // An unnamed front-most source names nothing.
    expect(mergePaintObjects([back, dabPaint('pnt_c', [[12 + C, 8 + C]])], 'pnt_m2')!.name)
      .toBeUndefined();
  });

  it('refuses fewer than two sources', () => {
    expect(mergePaintObjects([dabPaint('pnt_a', [[8 + C, 8 + C]])], 'pnt_m')).toBeNull();
    expect(mergePaintObjects([], 'pnt_m')).toBeNull();
  });

  it('mints ids in the pnt_ namespace', () => {
    // The prefix is load-bearing: SCENE_ADAPTERS routes by it.
    expect(mintPaintObjectId().startsWith('pnt_')).toBe(true);
    expect(mintPaintObjectId()).not.toBe(mintPaintObjectId());
  });
});

// ── Composition-level merge entry ───────────────────────────────────

function makeSVG(id: string): SVGObject {
  const segments = [
    { kind: 'line' as const, start: [50, 0] as [number, number], end: [60, 0] as [number, number] },
  ];
  return { id, segments, color: { r: 255, g: 255, b: 255 }, ...computeSVGBbox(segments) };
}

function makeState(
  paintObjects: PaintObject[],
  svgObjects: SVGObject[] = [],
  sceneOrder?: string[],
): CompositionState {
  return {
    id: 'test', name: 'test',
    figures: [], svgObjects, images: [], imageBlobs: {},
    paintObjects,
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 }, customColors: [],
    groups: [],
    sceneOrder: sceneOrder ?? [...paintObjects.map((p) => p.id), ...svgObjects.map((s) => s.id)],
    gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null,
    compTool: 'select',
    createRegion: null,
    renderGeneration: 0,
  };
}

describe('buildMergePaintEntry', () => {
  it('builds one replaceScene entry that applies and reverts exactly', () => {
    const a = dabPaint('pnt_a', [[8 + C, 8 + C]]);
    const b = dabPaint('pnt_b', [[8 + C, 8 + C]], BLUE);
    const state = makeState([a, b]);

    const built = buildMergePaintEntry(state, new Set(['pnt_a', 'pnt_b']))!;
    expect(built).not.toBeNull();
    expect(built.entry).toHaveLength(1);
    expect(built.entry[0].op).toBe('replaceScene');

    const next = applyCompOps(state, built.entry);
    expect((next.paintObjects ?? []).map((p) => p.id)).toEqual([built.resultId]);
    expect(next.sceneOrder).toEqual([built.resultId]);
    // The merged pixels are what the screen showed: b was the front island.
    expect(texelAt(next.paintObjects![0].tiles, 8 + C, 8 + C).b).toBe(255);

    // Undo restores the exact prior scene — the entry holds the old
    // collections by reference, so this is identity, not reconstruction.
    const back = revertCompOps(next, built.entry);
    expect(back.paintObjects).toBe(state.paintObjects);
    expect(back.sceneOrder).toEqual(state.sceneOrder);
    expect(back.svgObjects).toEqual(state.svgObjects);
    expect(back.groups).toEqual(state.groups);
  });

  it('lands the result at the front-most source’s z-slot, under what was above it', () => {
    const a = dabPaint('pnt_a', [[8 + C, 8 + C]]);
    const b = dabPaint('pnt_b', [[12 + C, 8 + C]], BLUE);
    const top = makeSVG('svg_top');
    const state = makeState([a, b], [top], ['pnt_a', 'pnt_b', 'svg_top']);

    const built = buildMergePaintEntry(state, new Set(['pnt_a', 'pnt_b']))!;
    const next = applyCompOps(state, built.entry);
    expect(next.sceneOrder).toEqual([built.resultId, 'svg_top']);
    expect(built.resultId.startsWith('pnt_')).toBe(true);
  });

  it('refuses a mixed selection — raster brushwork can’t join an svg flatten', () => {
    const a = dabPaint('pnt_a', [[8 + C, 8 + C]]);
    const b = dabPaint('pnt_b', [[12 + C, 8 + C]]);
    const svg = makeSVG('svg_1');
    const state = makeState([a, b], [svg]);

    const mixed = new Set(['pnt_a', 'pnt_b', 'svg_1']);
    expect(canMergePaintSelection(state, mixed)).toBe(false);
    expect(buildMergePaintEntry(state, mixed)).toBeNull();
  });

  it('refuses fewer than two paint islands', () => {
    const a = dabPaint('pnt_a', [[8 + C, 8 + C]]);
    const state = makeState([a]);
    expect(canMergePaintSelection(state, new Set(['pnt_a']))).toBe(false);
    expect(buildMergePaintEntry(state, new Set(['pnt_a']))).toBeNull();
  });
});
