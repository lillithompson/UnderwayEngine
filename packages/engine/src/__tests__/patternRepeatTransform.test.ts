import { GEOMETRY_ADAPTERS } from '../sceneNodeGeometry';
import { PatternObject } from '../types';

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
});
