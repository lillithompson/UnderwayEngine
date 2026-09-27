import { GEOMETRY_ADAPTERS } from '../sceneNodeGeometry';
import { CompositionState, PatternObject, makeViewport } from '../types';
import { fromLegacy, worldMatrix } from '../sceneGraph';
import { matApplyPoint } from '../sceneTransform';
import { patternLocalObject } from '../sceneDrawnContent';
import { localHitObject } from '../sceneHitFrame';

// Turning a REPEATING pattern turns the whole thing — region and tiling
// together, rigidly. The bug this pins: the bbox adapter swung the region
// about its centre and left the tile grid where it was, so the tiling slid
// under the region and a different sub-section of it came into view.
//
// The tile box is what does the clipping: the grid is anchored at
// `cellX + tileOffset` and repeats every `tileWidth × tileHeight` across
// the region (see patternCellAtWorldPoint and buildPatternSVGView), so
// "the clipping is unchanged" means that box goes exactly where the
// rotation takes it.

const A = GEOMETRY_ADAPTERS.pattern;

/** Region (2,3) 8×4 — centre (6,5). Tile 2×1 anchored at (3, 3.5).
 *  Deliberately non-square in both, and off-centre, so a transform that
 *  ignored any term shows up. */
function pat(over: Partial<PatternObject> = {}): PatternObject {
  return {
    id: 'pat_1', cellX: 2, cellY: 3, cellWidth: 8, cellHeight: 4,
    cols: 2, rows: 2, cells: new Array(4).fill(null),
    tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 1,
    tileOffsetXL0: 1, tileOffsetYL0: 0.5,
    ...over,
  };
}

/** The tile box in WORLD cells — where the clipping actually is. */
function tileBox(p: PatternObject) {
  return {
    x: p.cellX + (p.tileOffsetXL0 ?? 0),
    y: p.cellY + (p.tileOffsetYL0 ?? 0),
    w: p.tileWidthL0,
    h: p.tileHeightL0,
  };
}

describe('rotating a repeating pattern', () => {
  it('carries the tile box round with the region', () => {
    const p = pat();
    const q = A.rotate90CW(p) as PatternObject;
    // The region swings about its centre (6,5), swapping its dimensions.
    expect({ x: q.cellX, y: q.cellY, w: q.cellWidth, h: q.cellHeight })
      .toEqual({ x: 4, y: 1, w: 4, h: 8 });
    // The tile stands on end with it…
    expect(q.tileWidthL0).toBe(1);
    expect(q.tileHeightL0).toBe(2);
    // …and its box lands where the same quarter turn takes it: the old
    // box's BOTTOM-left corner (3, 4.5) becomes the new TOP-left,
    // (x, y) → (cx + (cy − y), cy + (x − cx)) = (6.5, 2).
    expect(tileBox(q)).toEqual({ x: 6.5, y: 2, w: 1, h: 2 });
  });

  it('comes back exactly after four turns', () => {
    // The strongest statement of "the transform does not drift": every
    // field, region and tiling alike, is the one it started as.
    const p = pat();
    let q = p;
    for (let i = 0; i < 4; i++) q = A.rotate90CW(q) as PatternObject;
    expect(q).toEqual({ ...p, rotation: 0 });
  });

  it('leaves a NON-repeating pattern exactly as the bbox rule has it', () => {
    // Without a tiling there is no clipping to preserve — a stretch-mode
    // pattern is baked into its box and simply turns with it.
    const p = pat({ tileMode: undefined, tileWidthL0: undefined, tileHeightL0: undefined,
      tileOffsetXL0: undefined, tileOffsetYL0: undefined });
    const q = A.rotate90CW(p) as PatternObject;
    expect(q.tileWidthL0).toBeUndefined();
    expect(q.tileOffsetXL0).toBeUndefined();
    expect({ x: q.cellX, y: q.cellY, w: q.cellWidth, h: q.cellHeight })
      .toEqual({ x: 4, y: 1, w: 4, h: 8 });
  });

  it('ignores a repeat flag with no tile box behind it', () => {
    // `repeat` without both dimensions is inert — the bake ignores it, and
    // so must this, or it would read undefined tile dims as zero.
    const p = pat({ tileWidthL0: undefined });
    const q = A.rotate90CW(p) as PatternObject;
    expect(q.tileOffsetXL0).toBe(p.tileOffsetXL0);
    expect(q.tileOffsetYL0).toBe(p.tileOffsetYL0);
  });
});

describe('mirroring a repeating pattern', () => {
  it('reflects the tile box within the region, on each axis', () => {
    const p = pat();
    const h = A.mirror(p, 'h') as PatternObject;
    // Region span 8, tile 2 wide at offset 1 → the reflected offset is
    // 8 − (1 + 2) = 5, so the box sits the same distance from the far edge.
    expect(h.tileOffsetXL0).toBe(5);
    expect(h.tileOffsetYL0).toBe(p.tileOffsetYL0);
    expect(h.mirrorH).toBe(true);

    const v = A.mirror(p, 'v') as PatternObject;
    // Region span 4, tile 1 tall at offset 0.5 → 4 − (0.5 + 1) = 2.5.
    expect(v.tileOffsetYL0).toBe(2.5);
    expect(v.tileOffsetXL0).toBe(p.tileOffsetXL0);
    expect(v.mirrorV).toBe(true);
  });

  it('is its own inverse', () => {
    const p = pat();
    for (const axis of ['h', 'v'] as const) {
      const back = A.mirror(A.mirror(p, axis) as PatternObject, axis) as PatternObject;
      expect(tileBox(back)).toEqual(tileBox(p));
    }
  });

  it('flips a quarter-turned pattern about the LOCAL axis the rotation maps to', () => {
    // The render applies mirrors BEFORE the discrete rotation, so a
    // screen-H flip of a 90°-turned node must land on the local V flag
    // (mirrorH would read as a vertical flip on screen). The tile box
    // still reflects across the SCREEN axis — it lives in world space.
    const turned = A.rotate90CW(pat()) as PatternObject; // rotation: 90
    const h = A.mirror(turned, 'h') as PatternObject;
    expect(h.mirrorV).toBe(true);
    expect(h.mirrorH).toBeUndefined();
    // Region x-span 4 (post-turn), tile 1 wide at offset 2.5 →
    // reflected offset is 4 − (2.5 + 1) = 0.5.
    expect(h.tileOffsetXL0).toBe(0.5);
    expect(h.tileOffsetYL0).toBe(turned.tileOffsetYL0);
  });
});

describe('moving a repeating pattern', () => {
  // The reported bug: flip a repeating pattern, then drag it — the picture
  // jumped to another orientation. The bbox translate cleared the mirror
  // flag but kept the reflected tile offset, so the UNFLIPPED artwork
  // re-baked onto the reflected grid: misaligned AND unflipped. A move is
  // rigid — orientation and tiling travel with the region, untouched.
  it('after a flip, keeps the flip and carries the tiling rigidly', () => {
    const p = pat();
    const flipped = A.mirror(p, 'h') as PatternObject;
    const moved = A.translate(flipped, 5, -2) as PatternObject;
    expect(moved.mirrorH).toBe(true);
    expect(moved.tileOffsetXL0).toBe(flipped.tileOffsetXL0);
    expect(moved.tileOffsetYL0).toBe(flipped.tileOffsetYL0);
    expect(tileBox(moved)).toEqual({
      x: tileBox(flipped).x + 5, y: tileBox(flipped).y - 2,
      w: flipped.tileWidthL0, h: flipped.tileHeightL0,
    });
  });

  it('after a quarter turn, keeps the rotation and its identity anchoring', () => {
    const turned = A.rotate90CW(pat()) as PatternObject;
    const moved = A.translate(turned, 3, 3) as PatternObject;
    expect(moved.rotation).toBe(90);
    // The identity box rides along, so the next turn in the cycle swings
    // about the MOVED centre rather than a stale pre-move one.
    expect(moved.identityCellX).toBe((turned.identityCellX ?? turned.cellX) + 3);
    expect(moved.identityCellY).toBe((turned.identityCellY ?? turned.cellY) + 3);
    const turnedAgain = A.rotate90CW(moved) as PatternObject;
    expect(turnedAgain.rotation).toBe(180);
    // At 180 the box regains the identity dims (8×4), centred where the
    // moved identity box is centred.
    expect(turnedAgain.cellWidth).toBe(8);
    expect(turnedAgain.cellHeight).toBe(4);
  });
});

describe('resizing a repeating pattern', () => {
  it('still holds the tiling fixed in world space', () => {
    // The other rule, unchanged: dragging an edge reveals more or less of
    // a tiling that does NOT move. Pinned here beside its opposite so the
    // two stay deliberately different.
    const p = pat();
    const bigger = A.rescale(p, { cellX: 2, cellY: 3, cellWidth: 8, cellHeight: 4 },
      { cellX: 0, cellY: 1, cellWidth: 10, cellHeight: 6 }) as PatternObject;
    expect(tileBox(bigger)).toEqual(tileBox(p));
  });

  // …and holds it still for a TILTED region too, which is what it used to
  // fail at: a free rotation is drawn about the box's centre, a resize
  // moves that centre, and the tiling slid across the page as the region's
  // shape changed. The tile box is stored in the node's own (unrotated)
  // frame, so what has to hold still is where the rotation PUTS it.
  const RAD = (deg: number) => (deg * Math.PI) / 180;
  /** The tile box's anchor as the page sees it: turned clockwise about the
   *  region's centre, the transform the render draws the node through. */
  const drawnAnchor = (p: PatternObject) => {
    const cx = p.cellX + p.cellWidth / 2;
    const cy = p.cellY + p.cellHeight / 2;
    const dx = p.cellX + (p.tileOffsetXL0 ?? 0) - cx;
    const dy = p.cellY + (p.tileOffsetYL0 ?? 0) - cy;
    const cos = Math.cos(RAD(p.angleDeg ?? 0));
    const sin = Math.sin(RAD(p.angleDeg ?? 0));
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  };

  it.each([30, 90, 137, -45, 180])('holds it still at %i°', (angleDeg) => {
    const p = pat({ angleDeg });
    const before = drawnAnchor(p);
    const old = { cellX: 2, cellY: 3, cellWidth: 8, cellHeight: 4 };
    for (const box of [
      { cellX: 0, cellY: 1, cellWidth: 10, cellHeight: 6 },   // origin corner out
      { cellX: 2, cellY: 3, cellWidth: 13, cellHeight: 9 },   // far corner out
      { cellX: 5, cellY: 4, cellWidth: 3, cellHeight: 2 },    // origin corner in
      { cellX: 2, cellY: 1, cellWidth: 8, cellHeight: 6 },    // one edge only
    ]) {
      const q = A.rescale(p, old, box) as PatternObject;
      const after = drawnAnchor(q);
      expect(after.x).toBeCloseTo(before.x, 9);
      expect(after.y).toBeCloseTo(before.y, 9);
      // The tile keeps its size — the region is a window, not a scale.
      expect(q.tileWidthL0).toBe(p.tileWidthL0);
      expect(q.tileHeightL0).toBe(p.tileHeightL0);
    }
  });

  it('leaves an upright region exactly where it always put it', () => {
    // The rotation term must vanish at 0°, or every existing repeat
    // pattern on every page shifts by a hair on its next resize.
    const old = { cellX: 2, cellY: 3, cellWidth: 8, cellHeight: 4 };
    const box = { cellX: 0, cellY: 1, cellWidth: 10, cellHeight: 6 };
    const q = A.rescale(pat(), old, box) as PatternObject;
    expect(q.tileOffsetXL0).toBe(3);
    expect(q.tileOffsetYL0).toBe(2.5);
  });
});

// …and the OTHER kind of resize: the pattern as one member of a group
// being scaled. There the whole arrangement is being made bigger, so the
// tiling scales with the region rather than repeating more — which is also
// what the live preview draws, the group's members being scaled by a
// transform until the drop.
describe('scaling a group that holds a repeating pattern', () => {
  const OLD = { cellX: 2, cellY: 3, cellWidth: 8, cellHeight: 4 };
  const scaled = (kx: number, ky: number) => A.rescale(
    pat(),
    OLD,
    { cellX: 2, cellY: 3, cellWidth: 8 * kx, cellHeight: 4 * ky },
    { scaleContent: true },
  ) as PatternObject;

  it('scales the tile with the region, so the repeat count holds', () => {
    const q = scaled(2, 2);
    expect(q.tileWidthL0).toBe(4);
    expect(q.tileHeightL0).toBe(2);
    // Four tiles across and four down, before and after.
    expect(q.cellWidth / q.tileWidthL0!).toBe(OLD.cellWidth / pat().tileWidthL0!);
    expect(q.cellHeight / q.tileHeightL0!).toBe(OLD.cellHeight / pat().tileHeightL0!);
  });

  it('scales the offset too, so the tiling keeps its phase in the box', () => {
    const q = scaled(2, 2);
    expect(q.tileOffsetXL0).toBe(2);
    expect(q.tileOffsetYL0).toBe(1);
  });

  it('takes each axis on its own', () => {
    const q = scaled(3, 0.5);
    expect(q.tileWidthL0).toBe(6);
    expect(q.tileHeightL0).toBe(0.5);
    expect(q.tileOffsetXL0).toBe(3);
    expect(q.tileOffsetYL0).toBe(0.25);
  });

  it('drops an offset that scales to zero rather than storing a 0', () => {
    const q = A.rescale(
      pat({ tileOffsetXL0: undefined, tileOffsetYL0: undefined }),
      OLD, { cellX: 2, cellY: 3, cellWidth: 16, cellHeight: 8 }, { scaleContent: true },
    ) as PatternObject;
    expect(q.tileOffsetXL0).toBeUndefined();
    expect(q.tileOffsetYL0).toBeUndefined();
  });

  it('leaves a STRETCH pattern to the plain bbox map, option or no', () => {
    const stretch = pat({ tileMode: undefined, tileWidthL0: undefined, tileHeightL0: undefined });
    const a = A.rescale(stretch, OLD, { cellX: 0, cellY: 0, cellWidth: 16, cellHeight: 8 }, { scaleContent: true });
    const b = A.rescale(stretch, OLD, { cellX: 0, cellY: 0, cellWidth: 16, cellHeight: 8 });
    expect(a).toEqual(b);
  });

  it('a repeat pattern MISSING a tile dimension is inert, and falls back', () => {
    // isRepeating: without both dims there is no tile box to scale, so the
    // window rule applies as before rather than multiplying an undefined.
    const half = pat({ tileHeightL0: undefined });
    const q = A.rescale(half, OLD, { cellX: 2, cellY: 3, cellWidth: 16, cellHeight: 8 },
      { scaleContent: true }) as PatternObject;
    expect(q.tileWidthL0).toBe(2);
    expect(q.tileHeightL0).toBeUndefined();
  });

  it('a degenerate old box scales nothing', () => {
    const q = A.rescale(pat(), { cellX: 2, cellY: 3, cellWidth: 0, cellHeight: 4 },
      { cellX: 2, cellY: 3, cellWidth: 8, cellHeight: 8 }, { scaleContent: true }) as PatternObject;
    expect(q.tileWidthL0).toBe(2);
  });
});

// The scene graph draws (and hit-tests) a pattern in its UN-POSED local box
// and lets the node's matrix supply the quarter turn and flip. The record's
// tile box, though, is posed with the region by the adapters above. The
// reported bug: a repeat region duplicated and turned drew nothing at all —
// the local bake framed the un-turned grid with the TURNED tile (a 2×30
// region wearing a 6×2 tile at offset 24), so its one drawn copy fell
// outside the region. Pinned here as: the local tile box, carried back out
// through the node's world matrix, is exactly the record's.
describe('the local frame a posed repeat pattern is drawn in', () => {
  function stateWith(p: PatternObject): CompositionState {
    return {
      id: 'test', name: 'test',
      figures: [], svgObjects: [], images: [], texts: [],
      paintObjects: [], patternObjects: [p],
      imageBlobs: {},
      lineDraft: null, arcDraft: null,
      editingLineId: null, selectedVertexIndex: null,
      lastChosenColor: { r: 255, g: 255, b: 255 },
      customColors: [],
      groups: [], sceneOrder: [p.id],
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

  /** A local tile box's image in world space, as an axis-aligned box. */
  function worldTileOf(p: PatternObject, local: Partial<PatternObject>) {
    const graph = fromLegacy(stateWith(p));
    const m = worldMatrix(graph, p.id);
    const x0 = local.tileOffsetXL0 ?? 0;
    const y0 = local.tileOffsetYL0 ?? 0;
    const pts = [[x0, y0], [x0 + local.tileWidthL0!, y0 + local.tileHeightL0!]]
      .map(([x, y]) => matApplyPoint(m, x, y));
    const round = (v: number) => Math.round(v * 1e6) / 1e6;
    return {
      x: round(Math.min(pts[0][0], pts[1][0])), y: round(Math.min(pts[0][1], pts[1][1])),
      w: round(Math.abs(pts[1][0] - pts[0][0])), h: round(Math.abs(pts[1][1] - pts[0][1])),
    };
  }

  const poses: Array<[string, (p: PatternObject) => PatternObject]> = [
    ['turned once', (p) => A.rotate90CW(p) as PatternObject],
    ['turned twice', (p) => A.rotate90CW(A.rotate90CW(p)) as PatternObject],
    ['turned three times', (p) => A.rotate90CW(A.rotate90CW(A.rotate90CW(p))) as PatternObject],
    ['flipped H', (p) => A.mirror(p, 'h') as PatternObject],
    ['flipped V', (p) => A.mirror(p, 'v') as PatternObject],
    ['turned then flipped H', (p) => A.mirror(A.rotate90CW(p), 'h') as PatternObject],
    ['flipped V then turned', (p) => A.rotate90CW(A.mirror(p, 'v')) as PatternObject],
  ];

  it.each(poses)('%s: the drawn tile lands on the record\'s', (_label, pose) => {
    const q = pose(pat());
    const node = fromLegacy(stateWith(q)).nodes.get(q.id)!;
    const expected = tileBox(q);
    expect(worldTileOf(q, patternLocalObject(node))).toEqual(expected);
    expect(worldTileOf(q, localHitObject(node) as PatternObject)).toEqual(expected);
  });

  it('the reported case: a tall region turned once keeps its tile upright in its own box', () => {
    // A 1×3 grid in a 2×30 region, tile 2×6 — duplicated and turned.
    const tall = pat({ cellX: 12, cellY: 26, cellWidth: 2, cellHeight: 30,
      tileWidthL0: 2, tileHeightL0: 6, tileOffsetXL0: undefined, tileOffsetYL0: undefined });
    const q = A.rotate90CW(tall) as PatternObject;
    const local = patternLocalObject(fromLegacy(stateWith(q)).nodes.get(q.id)!);
    expect(local.rotation).toBeUndefined();
    expect([local.cellWidth, local.cellHeight]).toEqual([2, 30]);
    expect([local.tileWidthL0, local.tileHeightL0]).toEqual([2, 6]);
    expect(local.tileOffsetXL0).toBeUndefined();
    expect(local.tileOffsetYL0).toBeUndefined();
  });
});
