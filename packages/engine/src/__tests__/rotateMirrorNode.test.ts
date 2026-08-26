import { computeSVGBbox, rotateSVG90CW, mirrorSVG, rotateFigureIndividual90CW, mirrorFigureIndividual } from '../compositionOps';
import { SVGObject, PathSegment, CompositionFigure } from '../types';

const WHITE = { r: 255, g: 255, b: 255 };

function makeSVGFromVertices(id: string, vertices: [number, number][]): SVGObject {
  const segments: PathSegment[] = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    segments.push({ kind: 'line', start: vertices[i], end: vertices[i + 1] });
  }
  return { id, segments, color: WHITE, ...computeSVGBbox(segments) };
}

function makeSVG(id: string, segments: PathSegment[]): SVGObject {
  return { id, segments, color: WHITE, ...computeSVGBbox(segments) };
}

function pointsClose(a: ReadonlyArray<readonly [number, number]>, b: ReadonlyArray<readonly [number, number]>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i][0] - b[i][0]) > 1e-9) return false;
    if (Math.abs(a[i][1] - b[i][1]) > 1e-9) return false;
  }
  return true;
}

function segmentEndpoints(obj: SVGObject): [number, number][] {
  const pts: [number, number][] = [];
  for (const seg of obj.segments) {
    if (pts.length === 0 || pts[pts.length - 1][0] !== seg.start[0] || pts[pts.length - 1][1] !== seg.start[1]) {
      pts.push(seg.start as [number, number]);
    }
    pts.push(seg.end as [number, number]);
  }
  return pts;
}

describe('rotateSVG90CW (line-like)', () => {
  test('four rotations return to identity segments and clear identitySegments', () => {
    const svg = makeSVGFromVertices('l1', [[1, 1], [4, 1], [4, 5]]);
    let r = svg;
    for (let i = 0; i < 4; i++) r = rotateSVG90CW(r);
    const origPts = segmentEndpoints(svg);
    const roundPts = segmentEndpoints(r);
    expect(pointsClose(roundPts, origPts)).toBe(true);
    expect(r.rotation).toBe(0);
    expect(r.identitySegments).toBeUndefined();
  });

  test('single rotation produces 90° rotation and bbox follows the new segments', () => {
    const svg = makeSVGFromVertices('l1', [[0, 0], [4, 0]]);
    const r = rotateSVG90CW(svg);
    expect(r.rotation).toBe(90);
    // Identity bbox center is (2, 0); rotating (0, 0) and (4, 0) 90° CW
    // around (2, 0) in screen-y-down coords gives (2, -2) and (2, 2).
    const pts = segmentEndpoints(r);
    expect(pointsClose(pts, [[2, -2], [2, 2]])).toBe(true);
    expect(r.cellX).toBe(2);
    expect(r.cellY).toBe(-2);
    expect(r.cellWidth).toBe(0);
    expect(r.cellHeight).toBe(4);
    // identityCellX/Y are tile-only — must remain undefined for non-tile.
    expect(r.identityCellX).toBeUndefined();
    expect(r.identityCellY).toBeUndefined();
  });
});

describe('mirrorSVG (line-like)', () => {
  test('mirror twice on the same axis returns to identity', () => {
    const svg = makeSVGFromVertices('l1', [[0, 0], [4, 2], [6, 0]]);
    const m1 = mirrorSVG(svg, 'h');
    const m2 = mirrorSVG(m1, 'h');
    const origPts = segmentEndpoints(svg);
    const roundPts = segmentEndpoints(m2);
    expect(pointsClose(roundPts, origPts)).toBe(true);
    expect(m2.mirrorH).toBe(false);
    expect(m2.identitySegments).toBeUndefined();
  });

  test('horizontal mirror across the bbox center reflects each vertex x', () => {
    const svg = makeSVGFromVertices('l1', [[0, 0], [4, 4]]);
    const m = mirrorSVG(svg, 'h');
    // bbox center (2, 2); mirror across the vertical line x = 2.
    const pts = segmentEndpoints(m);
    expect(pointsClose(pts, [[4, 0], [0, 4]])).toBe(true);
  });
});

describe('rotateSVG90CW (arc-like)', () => {
  test('four rotations return to identity', () => {
    const svg = makeSVG('a1', [{ kind: 'arc', start: [0, 0], end: [3, 3], center: [0, 3] }]);
    let r = svg;
    for (let i = 0; i < 4; i++) r = rotateSVG90CW(r);
    const orig = svg.segments[0];
    const round = r.segments[0];
    if (orig.kind === 'arc' && round.kind === 'arc') {
      expect(Math.abs(round.start[0] - orig.start[0])).toBeLessThan(1e-9);
      expect(Math.abs(round.start[1] - orig.start[1])).toBeLessThan(1e-9);
      expect(Math.abs(round.end[0] - orig.end[0])).toBeLessThan(1e-9);
      expect(Math.abs(round.end[1] - orig.end[1])).toBeLessThan(1e-9);
      expect(Math.abs(round.center[0] - orig.center[0])).toBeLessThan(1e-9);
      expect(Math.abs(round.center[1] - orig.center[1])).toBeLessThan(1e-9);
    }
    expect(r.rotation).toBe(0);
    expect(r.identitySegments).toBeUndefined();
  });

  test('single rotation preserves the radius invariant', () => {
    const svg = makeSVG('a1', [{ kind: 'arc', start: [1, 0], end: [0, 1], center: [0, 0] }]);
    const r = rotateSVG90CW(svg);
    const seg = r.segments[0];
    if (seg.kind === 'arc') {
      const r1 = Math.hypot(seg.start[0] - seg.center[0], seg.start[1] - seg.center[1]);
      const r2 = Math.hypot(seg.end[0]   - seg.center[0], seg.end[1]   - seg.center[1]);
      expect(Math.abs(r1 - r2)).toBeLessThan(1e-9);
    }
  });
});

describe('mirrorSVG (arc-like)', () => {
  test('mirror twice on the same axis returns to identity', () => {
    const svg = makeSVG('a1', [{ kind: 'arc', start: [1, 0], end: [0, 1], center: [0, 0] }]);
    const m = mirrorSVG(mirrorSVG(svg, 'v'), 'v');
    const orig = svg.segments[0];
    const round = m.segments[0];
    if (orig.kind === 'arc' && round.kind === 'arc') {
      expect(Math.abs(round.start[0] - orig.start[0])).toBeLessThan(1e-9);
      expect(Math.abs(round.center[0] - orig.center[0])).toBeLessThan(1e-9);
    }
    expect(m.mirrorV).toBe(false);
    expect(m.identitySegments).toBeUndefined();
  });

  test('preserves the quarter-circle radius invariant after mirror', () => {
    const svg = makeSVG('a1', [{ kind: 'arc', start: [3, 0], end: [0, 3], center: [0, 0] }]);
    const m = mirrorSVG(svg, 'h');
    const seg = m.segments[0];
    if (seg.kind === 'arc') {
      const r1 = Math.hypot(seg.start[0] - seg.center[0], seg.start[1] - seg.center[1]);
      const r2 = Math.hypot(seg.end[0]   - seg.center[0], seg.end[1]   - seg.center[1]);
      expect(Math.abs(r1 - r2)).toBeLessThan(1e-9);
    }
  });

  test('preserves radius invariant on a joined arc + line chain', () => {
    const segs: PathSegment[] = [
      { kind: 'line', start: [0, 0], end: [3, 3] },
      { kind: 'arc',  start: [3, 3], end: [6, 0], center: [6, 3] },
    ];
    const svg = makeSVG('a1', segs);
    let r = svg;
    r = rotateSVG90CW(r);
    r = mirrorSVG(r, 'v');
    const arcSeg = r.segments[1];
    if (arcSeg.kind === 'arc') {
      const r1 = Math.hypot(arcSeg.start[0] - arcSeg.center[0], arcSeg.start[1] - arcSeg.center[1]);
      const r2 = Math.hypot(arcSeg.end[0]   - arcSeg.center[0], arcSeg.end[1]   - arcSeg.center[1]);
      expect(Math.abs(r1 - r2)).toBeLessThan(1e-9);
    }
  });
});

// Build a tile-mode SVG: a small pattern unit (segments) over a larger
// rectangular region (cellX/Y/Width/Height). Mirrors the shape used by
// the Composer's Block tool — the unit defines the design, the region
// defines the filled area.
function makeTileSVG(opts: {
  id: string;
  segments: PathSegment[];
  region: { cellX: number; cellY: number; cellWidth: number; cellHeight: number };
  tileWidthL0: number;
  tileHeightL0: number;
}): SVGObject {
  return {
    id: opts.id, segments: opts.segments, color: WHITE,
    ...opts.region,
    tileMode: 'repeat',
    tileWidthL0: opts.tileWidthL0,
    tileHeightL0: opts.tileHeightL0,
  };
}

function makeTileFigure(opts: {
  id: string;
  region: { cellX: number; cellY: number; cellWidth: number; cellHeight: number };
  tileWidthL0: number;
  tileHeightL0: number;
}): CompositionFigure {
  return {
    id: opts.id, figureKey: 'k', resolutionX: opts.tileWidthL0, resolutionY: opts.tileHeightL0,
    ...opts.region,
    tileMode: 'repeat',
    tileWidthL0: opts.tileWidthL0,
    tileHeightL0: opts.tileHeightL0,
  };
}

describe('rotateSVG90CW (tile mode)', () => {
  test('region swaps W/H around the center on a single 90° rotation', () => {
    const svg = makeTileSVG({
      id: 's1',
      segments: [{ kind: 'line', start: [0, 0], end: [2, 4] }],
      region: { cellX: 10, cellY: 20, cellWidth: 12, cellHeight: 6 },
      tileWidthL0: 2, tileHeightL0: 4,
    });
    const r = rotateSVG90CW(svg);
    // Center stays fixed (10 + 6, 20 + 3) = (16, 23). New W=6, H=12, so
    // cellX = 16 - 3 = 13, cellY = 23 - 6 = 17.
    expect(r.cellX).toBe(13);
    expect(r.cellY).toBe(17);
    expect(r.cellWidth).toBe(6);
    expect(r.cellHeight).toBe(12);
    expect(r.rotation).toBe(90);
    // Tile cell dimensions swap on each 90° rotation — the SVG-tile
    // renderer translates segments into a `tileWidthL0 × tileHeightL0`
    // cell, so the tile dims must track the rotated design's AABB.
    expect(r.tileWidthL0).toBe(4);
    expect(r.tileHeightL0).toBe(2);
    expect(r.identityCellX).toBe(10);
    expect(r.identityCellY).toBe(20);
  });

  test('four rotations return to the original region and tile dims', () => {
    const svg = makeTileSVG({
      id: 's1',
      segments: [{ kind: 'line', start: [0, 0], end: [2, 4] }],
      region: { cellX: 10, cellY: 20, cellWidth: 12, cellHeight: 6 },
      tileWidthL0: 2, tileHeightL0: 4,
    });
    let r = svg;
    for (let i = 0; i < 4; i++) r = rotateSVG90CW(r);
    expect(r.cellX).toBe(10);
    expect(r.cellY).toBe(20);
    expect(r.cellWidth).toBe(12);
    expect(r.cellHeight).toBe(6);
    expect(r.tileWidthL0).toBe(2);
    expect(r.tileHeightL0).toBe(4);
    expect(r.rotation).toBe(0);
    expect(r.identityCellX).toBeUndefined();
    expect(r.identityCellY).toBeUndefined();
  });

  test('does not collapse the region to the pattern-unit AABB', () => {
    // Regression: prior bug spread `computeSVGBbox(newSegs)` over the
    // result, which shrank a tiled region down to the unit's AABB on
    // rotate. Region MUST remain a tiled region.
    const svg = makeTileSVG({
      id: 's1',
      segments: [{ kind: 'line', start: [0, 0], end: [2, 4] }],
      region: { cellX: 10, cellY: 20, cellWidth: 12, cellHeight: 6 },
      tileWidthL0: 2, tileHeightL0: 4,
    });
    const r = rotateSVG90CW(svg);
    // Area must stay at 12*6 = 72 (after W/H swap it's 6*12). If the bug
    // returned, area would collapse to ~ tileW * tileH = 8.
    expect(r.cellWidth * r.cellHeight).toBe(72);
  });

  test('matches rotateFigureIndividual90CW region behavior', () => {
    const region = { cellX: 10, cellY: 20, cellWidth: 12, cellHeight: 6 };
    const svg = makeTileSVG({
      id: 's1',
      segments: [{ kind: 'line', start: [0, 0], end: [2, 4] }],
      region, tileWidthL0: 2, tileHeightL0: 4,
    });
    const fig = makeTileFigure({ id: 'f1', region, tileWidthL0: 2, tileHeightL0: 4 });
    const rSvg = rotateSVG90CW(svg);
    const rFig = rotateFigureIndividual90CW(fig);
    expect(rSvg.cellX).toBe(rFig.cellX);
    expect(rSvg.cellY).toBe(rFig.cellY);
    expect(rSvg.cellWidth).toBe(rFig.cellWidth);
    expect(rSvg.cellHeight).toBe(rFig.cellHeight);
    expect(rSvg.identityCellX).toBe(rFig.identityCellX);
    expect(rSvg.identityCellY).toBe(rFig.identityCellY);
  });
});

describe('mirrorSVG (tile mode)', () => {
  test('region stays unchanged on horizontal mirror', () => {
    const svg = makeTileSVG({
      id: 's1',
      segments: [{ kind: 'line', start: [0, 0], end: [2, 4] }],
      region: { cellX: 10, cellY: 20, cellWidth: 12, cellHeight: 6 },
      tileWidthL0: 2, tileHeightL0: 4,
    });
    const m = mirrorSVG(svg, 'h');
    expect(m.cellX).toBe(10);
    expect(m.cellY).toBe(20);
    expect(m.cellWidth).toBe(12);
    expect(m.cellHeight).toBe(6);
    expect(m.mirrorH).toBe(true);
    // tile dims untouched
    expect(m.tileWidthL0).toBe(2);
    expect(m.tileHeightL0).toBe(4);
  });

  test('region stays unchanged on vertical mirror', () => {
    const svg = makeTileSVG({
      id: 's1',
      segments: [{ kind: 'line', start: [0, 0], end: [2, 4] }],
      region: { cellX: 10, cellY: 20, cellWidth: 12, cellHeight: 6 },
      tileWidthL0: 2, tileHeightL0: 4,
    });
    const m = mirrorSVG(svg, 'v');
    expect(m.cellWidth).toBe(12);
    expect(m.cellHeight).toBe(6);
    expect(m.mirrorV).toBe(true);
  });

  test('matches mirrorFigureIndividual region behavior', () => {
    const region = { cellX: 10, cellY: 20, cellWidth: 12, cellHeight: 6 };
    const svg = makeTileSVG({
      id: 's1',
      segments: [{ kind: 'line', start: [0, 0], end: [2, 4] }],
      region, tileWidthL0: 2, tileHeightL0: 4,
    });
    const fig = makeTileFigure({ id: 'f1', region, tileWidthL0: 2, tileHeightL0: 4 });
    const mSvg = mirrorSVG(svg, 'h');
    const mFig = mirrorFigureIndividual(fig, 'h');
    expect(mSvg.cellX).toBe(mFig.cellX);
    expect(mSvg.cellY).toBe(mFig.cellY);
    expect(mSvg.cellWidth).toBe(mFig.cellWidth);
    expect(mSvg.cellHeight).toBe(mFig.cellHeight);
  });
});

// The tiled markup draws segments RELATIVE to the grid anchor
// (cellX + tileOffset) and the <pattern> cell clips to tileW × tileH, so a
// transform must keep the artwork exactly inside the anchored tile box —
// and that box must go where the rigid turn/flip takes it, or the region
// clips a DIFFERENT sub-section of the pattern afterwards (the "rotate a
// partially-visible repeating pattern and it shifts" bug).
describe('tile mode transforms rigidly (artwork stays in the anchored tile box)', () => {
  /** One 6×4 tile of art at (4,6), region grown rightward to (4,6) 18×8 —
   *  the shape the editor's repeat toggle + edge drag produces. */
  function anchoredTileSVG(): SVGObject {
    return {
      id: 's1', color: WHITE,
      segments: [
        { kind: 'line', start: [4, 6], end: [10, 6] },
        { kind: 'line', start: [10, 6], end: [10, 10] },
        { kind: 'line', start: [10, 10], end: [4, 10] },
        { kind: 'line', start: [4, 10], end: [4, 6] },
      ],
      cellX: 4, cellY: 6, cellWidth: 18, cellHeight: 8,
      tileMode: 'repeat', tileWidthL0: 6, tileHeightL0: 4,
    };
  }
  const segBox = (s: SVGObject) => computeSVGBbox(s.segments);
  const anchor = (s: SVGObject) => [s.cellX + (s.tileOffsetXL0 ?? 0), s.cellY + (s.tileOffsetYL0 ?? 0)];

  test('rotate carries artwork, grid, and region round together', () => {
    const r = rotateSVG90CW(anchoredTileSVG());
    // Region swings about its centre (13, 10) → (9, 1) 8×18.
    expect([r.cellX, r.cellY, r.cellWidth, r.cellHeight]).toEqual([9, 1, 8, 18]);
    // The tile box lands where the quarter turn takes it — the old box's
    // BOTTOM-left corner (4, 10) becomes the new top-left, (13, 1)…
    expect(anchor(r)).toEqual([13, 1]);
    // …and the segments land exactly inside it (that is what renders).
    expect(segBox(r)).toEqual({ cellX: 13, cellY: 1, cellWidth: 4, cellHeight: 6 });
  });

  test('mirror reflects artwork and grid about the region centre', () => {
    const m = mirrorSVG(anchoredTileSVG(), 'h');
    // Tile box reflected within the 18-wide region: 18 − (0 + 6) = 12.
    expect(anchor(m)).toEqual([16, 6]);
    expect(segBox(m)).toEqual({ cellX: 16, cellY: 6, cellWidth: 6, cellHeight: 4 });
  });

  test('four rotations land artwork and grid exactly back', () => {
    let r = anchoredTileSVG();
    for (let i = 0; i < 4; i++) r = rotateSVG90CW(r);
    expect(segBox(r)).toEqual({ cellX: 4, cellY: 6, cellWidth: 6, cellHeight: 4 });
    expect(anchor(r)).toEqual([4, 6]);
    expect(r.identitySegments).toBeUndefined();
  });

  test('two mirrors land artwork and grid exactly back', () => {
    const m = mirrorSVG(mirrorSVG(anchoredTileSVG(), 'h'), 'h');
    expect(segBox(m)).toEqual({ cellX: 4, cellY: 6, cellWidth: 6, cellHeight: 4 });
    expect(anchor(m)).toEqual([4, 6]);
  });

  test('rotate after mirror still keeps artwork inside the anchored box', () => {
    const rm = rotateSVG90CW(mirrorSVG(anchoredTileSVG(), 'h'));
    const [ax, ay] = anchor(rm);
    const b = segBox(rm);
    expect(b.cellX).toBeCloseTo(ax);
    expect(b.cellY).toBeCloseTo(ay);
    expect(b.cellWidth).toBeCloseTo(rm.tileWidthL0!);
    expect(b.cellHeight).toBeCloseTo(rm.tileHeightL0!);
  });
});

// A joined SVG: one primary path + N colored subpaths over the same
// bbox. Rotating/mirroring must keep all pieces aligned — they share an
// identity center and rotate as a unit.
function makeJoinedSVG(opts: {
  id: string;
  mainSegments: PathSegment[];
  subpaths: { segments: PathSegment[]; color: { r: number; g: number; b: number } }[];
}): SVGObject {
  // Bbox covers main + all subpaths so the identity-center pivot reflects
  // the whole design, matching how join() computes the bbox.
  const allSegs = [...opts.mainSegments, ...opts.subpaths.flatMap(s => s.segments)];
  return { id: opts.id, segments: opts.mainSegments, color: WHITE, subpaths: opts.subpaths,
    ...computeSVGBbox(allSegs) };
}

describe('rotateSVG90CW (joined SVG with subpaths)', () => {
  test('subpath rotates by 90° on the first call (matches main)', () => {
    const svg = makeJoinedSVG({
      id: 'u1',
      mainSegments: [{ kind: 'line', start: [0, 0], end: [4, 0] }],
      subpaths: [{ segments: [{ kind: 'line', start: [0, 4], end: [4, 4] }], color: { r: 1, g: 2, b: 3 } }],
    });
    const r = rotateSVG90CW(svg);
    // Pivot is the MAIN segments' bbox center = (2, 0) — the function
    // doesn't consider subpaths when computing the rotation center.
    // Rotating subpath endpoints 90° CW around (2, 0) in screen-y-down:
    // (0, 4)→(-2, -2); (4, 4)→(-2, 2).
    expect(r.subpaths).toBeDefined();
    const sub = r.subpaths![0];
    const seg = sub.segments[0];
    expect(seg.kind).toBe('line');
    if (seg.kind === 'line') {
      expect(seg.start[0]).toBeCloseTo(-2, 9);
      expect(seg.start[1]).toBeCloseTo(-2, 9);
      expect(seg.end[0]).toBeCloseTo(-2, 9);
      expect(seg.end[1]).toBeCloseTo(2, 9);
    }
  });

  test('four rotations bring both main and subpaths back to identity', () => {
    // Regression for the bug: previously subpaths over-rotated by
    // `steps - 1` per call, so after 2 rotations they were at 270° while
    // main was at 180°, and they never realigned across a full cycle.
    const svg = makeJoinedSVG({
      id: 'u1',
      mainSegments: [{ kind: 'line', start: [0, 0], end: [4, 0] }],
      subpaths: [
        { segments: [{ kind: 'line', start: [0, 4], end: [4, 4] }], color: { r: 1, g: 2, b: 3 } },
        { segments: [{ kind: 'arc', start: [0, 0], end: [4, 4], center: [2, 2] }], color: { r: 4, g: 5, b: 6 } },
      ],
    });
    let r = svg;
    for (let i = 0; i < 4; i++) r = rotateSVG90CW(r);
    // Main: line endpoints should land back on (0, 0) and (4, 0).
    const mainSeg = r.segments[0];
    if (mainSeg.kind === 'line') {
      expect(mainSeg.start[0]).toBeCloseTo(0, 9);
      expect(mainSeg.start[1]).toBeCloseTo(0, 9);
      expect(mainSeg.end[0]).toBeCloseTo(4, 9);
      expect(mainSeg.end[1]).toBeCloseTo(0, 9);
    }
    // First subpath: line back to (0, 4)-(4, 4).
    const sub0 = r.subpaths![0].segments[0];
    if (sub0.kind === 'line') {
      expect(sub0.start[0]).toBeCloseTo(0, 9);
      expect(sub0.start[1]).toBeCloseTo(4, 9);
      expect(sub0.end[0]).toBeCloseTo(4, 9);
      expect(sub0.end[1]).toBeCloseTo(4, 9);
    }
    // Second subpath (arc): back to its original endpoints + center.
    const sub1 = r.subpaths![1].segments[0];
    if (sub1.kind === 'arc') {
      expect(sub1.start[0]).toBeCloseTo(0, 9);
      expect(sub1.start[1]).toBeCloseTo(0, 9);
      expect(sub1.end[0]).toBeCloseTo(4, 9);
      expect(sub1.end[1]).toBeCloseTo(4, 9);
      expect(sub1.center[0]).toBeCloseTo(2, 9);
      expect(sub1.center[1]).toBeCloseTo(2, 9);
    }
  });

  test('subpath stays aligned with main after two cumulative rotations', () => {
    // Specifically tests the bug case: rotation #2 must put subpath at 180°,
    // not 270°. We verify by checking the relative offset between the two
    // pieces is preserved (they should still be `(0, 4) - (0, 0) = (0, 4)`
    // apart at identity, which under R^2 becomes `(0, -4)`).
    const svg = makeJoinedSVG({
      id: 'u1',
      mainSegments: [{ kind: 'line', start: [0, 0], end: [4, 0] }],
      subpaths: [{ segments: [{ kind: 'line', start: [0, 4], end: [4, 4] }], color: { r: 1, g: 2, b: 3 } }],
    });
    let r = svg;
    r = rotateSVG90CW(r); // 90°
    r = rotateSVG90CW(r); // 180°
    const mainStart = (r.segments[0] as { kind: 'line'; start: [number, number] }).start;
    const subStart = (r.subpaths![0].segments[0] as { kind: 'line'; start: [number, number] }).start;
    // Identity offset (sub - main) = (0, 4); R^2 of (0, 4) = (0, -4).
    expect(subStart[0] - mainStart[0]).toBeCloseTo(0, 9);
    expect(subStart[1] - mainStart[1]).toBeCloseTo(-4, 9);
  });
});

describe('mirrorSVG (joined SVG with subpaths)', () => {
  test('two horizontal mirrors return both main and subpaths to identity', () => {
    // Regression: previously the mirror reducer applied the NEW flags to
    // the already-mirrored subpath state, so two mirrors on the same axis
    // left subpaths still mirrored while main returned to identity.
    const svg = makeJoinedSVG({
      id: 'u1',
      mainSegments: [{ kind: 'line', start: [0, 0], end: [4, 0] }],
      subpaths: [{ segments: [{ kind: 'line', start: [0, 4], end: [4, 4] }], color: { r: 1, g: 2, b: 3 } }],
    });
    const m = mirrorSVG(mirrorSVG(svg, 'h'), 'h');
    const sub = m.subpaths![0].segments[0];
    if (sub.kind === 'line') {
      expect(sub.start[0]).toBeCloseTo(0, 9);
      expect(sub.start[1]).toBeCloseTo(4, 9);
      expect(sub.end[0]).toBeCloseTo(4, 9);
      expect(sub.end[1]).toBeCloseTo(4, 9);
    }
  });

  test('mirror after rotate keeps subpath aligned with main', () => {
    const svg = makeJoinedSVG({
      id: 'u1',
      mainSegments: [{ kind: 'line', start: [0, 0], end: [4, 0] }],
      subpaths: [{ segments: [{ kind: 'line', start: [0, 4], end: [4, 4] }], color: { r: 1, g: 2, b: 3 } }],
    });
    // Apply same transforms: identity offset (sub - main) is (0, 4); after
    // rotate 90° CW around (2, 2) then mirror screen-h, the offset must
    // match between main and subpath.
    let r = svg;
    r = rotateSVG90CW(r);
    r = mirrorSVG(r, 'h');
    const mainStart = (r.segments[0] as { kind: 'line'; start: [number, number] }).start;
    const mainEnd = (r.segments[0] as { kind: 'line'; end: [number, number] }).end;
    const subStart = (r.subpaths![0].segments[0] as { kind: 'line'; start: [number, number] }).start;
    const subEnd = (r.subpaths![0].segments[0] as { kind: 'line'; end: [number, number] }).end;
    // The relative offset (sub - main) at identity is (0, 4). Under any
    // rigid transform (rotation + mirror) applied to BOTH pieces, the
    // offset is transformed identically — so the *difference* between
    // corresponding endpoints must equal the transformed (0, 4) vector,
    // and it must be the same for start and end.
    expect(subStart[0] - mainStart[0]).toBeCloseTo(subEnd[0] - mainEnd[0], 9);
    expect(subStart[1] - mainStart[1]).toBeCloseTo(subEnd[1] - mainEnd[1], 9);
  });
});

// ── Free rotation under a mirror ────────────────────────────────────
// A reflection conjugates a clockwise turn into a counter-clockwise one
// (M ∘ R(θ) = R(−θ) ∘ M), so every mirror path negates `angleDeg`. Left
// alone, a tilted member of a mirrored selection leans the wrong way —
// the reported group-flip bug.

import { GEOMETRY_ADAPTERS, mirroredAngleDeg } from '../sceneNodeGeometry';

describe('mirroring negates the free rotation', () => {
  test('mirroredAngleDeg negates into [0, 360) and keeps zero as undefined', () => {
    expect(mirroredAngleDeg(undefined)).toBeUndefined();
    expect(mirroredAngleDeg(0)).toBeUndefined();
    expect(mirroredAngleDeg(30)).toBe(330);
    expect(mirroredAngleDeg(330)).toBe(30);
    expect(mirroredAngleDeg(-45)).toBe(45);
    expect(mirroredAngleDeg(180)).toBe(180);
  });

  test('mirrorSVG carries the negated angle (and a double flip restores it)', () => {
    const svg = { ...makeSVGFromVertices('a1', [[1, 1], [4, 1], [4, 5]]), angleDeg: 30 };
    const once = mirrorSVG(svg, 'h');
    expect(once.angleDeg).toBe(330);
    expect(mirrorSVG(once, 'h').angleDeg).toBe(30);
    const vertical = mirrorSVG(svg, 'v');
    expect(vertical.angleDeg).toBe(330);
  });

  test('the bbox adapters negate it too — image, text, paint, pattern alike', () => {
    for (const kind of ['image', 'text', 'paint', 'pattern'] as const) {
      const node = {
        id: `${kind}_x`, cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2, angleDeg: 30,
      };
      const flipped = GEOMETRY_ADAPTERS[kind].mirror(node as never, 'h') as { angleDeg?: number };
      expect(flipped.angleDeg).toBe(330);
    }
  });

  test('a discrete quarter turn leaves the free angle alone (co-axial turns compose)', () => {
    const svg = { ...makeSVGFromVertices('a2', [[1, 1], [4, 1], [4, 5]]), angleDeg: 30 };
    expect(rotateSVG90CW(svg).angleDeg).toBe(30);
    const node = { id: 'img_y', cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2, angleDeg: 30 };
    expect((GEOMETRY_ADAPTERS.image.rotate90CW(node as never) as { angleDeg?: number }).angleDeg).toBe(30);
  });
});
