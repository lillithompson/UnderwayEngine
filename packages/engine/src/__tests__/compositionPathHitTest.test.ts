import {
  pointToLineSegmentDistSq,
  pointToArcSegmentDistSq,
  svgPathHitsPoint,
  brushHitsSegments,
  computeHitToleranceCells,
  pointInClosedPath,
} from '../compositionPathHitTest';
import { CurveSegment, PathSegment, SVGObject } from '../types';

const WHITE = { r: 255, g: 255, b: 255 };

// ── pointToLineSegmentDistSq ──────────────────────────────────────────

describe('pointToLineSegmentDistSq', () => {
  test('point on the segment returns 0', () => {
    // Midpoint of (0,0)→(4,0)
    expect(pointToLineSegmentDistSq(2, 0, 0, 0, 4, 0)).toBeCloseTo(0);
  });

  test('point at segment start returns 0', () => {
    expect(pointToLineSegmentDistSq(0, 0, 0, 0, 4, 0)).toBeCloseTo(0);
  });

  test('point at segment end returns 0', () => {
    expect(pointToLineSegmentDistSq(4, 0, 0, 0, 4, 0)).toBeCloseTo(0);
  });

  test('point perpendicular to horizontal segment', () => {
    // (2, 3) is 3 units above the midpoint of (0,0)→(4,0)
    expect(pointToLineSegmentDistSq(2, 3, 0, 0, 4, 0)).toBeCloseTo(9);
  });

  test('point perpendicular to vertical segment', () => {
    expect(pointToLineSegmentDistSq(5, 2, 0, 0, 0, 4)).toBeCloseTo(25);
  });

  test('point beyond start endpoint clamps to start', () => {
    // (-2, 0) is beyond start of (0,0)→(4,0), closest point is (0,0)
    expect(pointToLineSegmentDistSq(-2, 0, 0, 0, 4, 0)).toBeCloseTo(4);
  });

  test('point beyond end endpoint clamps to end', () => {
    // (6, 0) is beyond end of (0,0)→(4,0), closest point is (4,0)
    expect(pointToLineSegmentDistSq(6, 0, 0, 0, 4, 0)).toBeCloseTo(4);
  });

  test('point near diagonal segment', () => {
    // Segment from (0,0) to (4,4). Point (0,4) perpendicular distance = 4/sqrt(2) = 2*sqrt(2)
    const distSq = pointToLineSegmentDistSq(0, 4, 0, 0, 4, 4);
    expect(distSq).toBeCloseTo(8); // (2*sqrt(2))^2 = 8
  });

  test('zero-length segment returns point-to-point distance', () => {
    expect(pointToLineSegmentDistSq(3, 4, 1, 1, 1, 1)).toBeCloseTo(13); // (3-1)^2 + (4-1)^2
  });
});

// ── pointToArcSegmentDistSq ───────────────────────────────────────────

describe('pointToArcSegmentDistSq', () => {
  // Arc: quarter circle, center (0,0), radius 4, from (4,0) to (0,4)
  const quarterArc: CurveSegment = {
    kind: 'arc',
    start: [4, 0],
    end: [0, 4],
    center: [0, 0],
  };

  test('point on the arc returns ~0', () => {
    // Point at 45 degrees on radius 4: (4/sqrt2, 4/sqrt2) ≈ (2.828, 2.828)
    const x = 4 * Math.SQRT1_2;
    const y = 4 * Math.SQRT1_2;
    expect(pointToArcSegmentDistSq(x, y, quarterArc)).toBeCloseTo(0, 4);
  });

  test('point inside the arc (closer to center)', () => {
    // Point at 45 degrees but radius 2: (sqrt2, sqrt2)
    const x = Math.SQRT2;
    const y = Math.SQRT2;
    // Radial distance = |2 - 4| = 2
    expect(pointToArcSegmentDistSq(x, y, quarterArc)).toBeCloseTo(4);
  });

  test('point outside the arc (farther from center)', () => {
    // Point at 45 degrees but radius 6: (6/sqrt2, 6/sqrt2)
    const x = 6 * Math.SQRT1_2;
    const y = 6 * Math.SQRT1_2;
    // Radial distance = |6 - 4| = 2
    expect(pointToArcSegmentDistSq(x, y, quarterArc)).toBeCloseTo(4);
  });

  test('point outside angular span snaps to nearest endpoint', () => {
    // Point at angle -45 degrees (below x-axis): (3, -3)
    // Outside the arc span, nearest endpoint is (4, 0)
    const distSq = pointToArcSegmentDistSq(3, -3, quarterArc);
    const expectedSq = (3 - 4) ** 2 + (-3 - 0) ** 2; // 1 + 9 = 10
    expect(distSq).toBeCloseTo(expectedSq);
  });

  test('point at arc start endpoint', () => {
    expect(pointToArcSegmentDistSq(4, 0, quarterArc)).toBeCloseTo(0);
  });

  test('point at arc end endpoint', () => {
    expect(pointToArcSegmentDistSq(0, 4, quarterArc)).toBeCloseTo(0);
  });

  test('degenerate arc (zero radius) returns endpoint distance', () => {
    const degenerate: CurveSegment = {
      kind: 'arc',
      start: [5, 5],
      end: [5, 5],
      center: [5, 5],
    };
    expect(pointToArcSegmentDistSq(8, 5, degenerate)).toBeCloseTo(9);
  });

  // Arc wrapping the -PI/+PI boundary
  test('arc crossing the -PI/+PI boundary', () => {
    // Arc from (−4, 1) to (−4, −1) around center (0,0), going through angle PI
    // This arc spans across the ±PI boundary
    const wrapArc: CurveSegment = {
      kind: 'arc',
      start: [-4, 1] as [number, number],
      end: [-4, -1] as [number, number],
      center: [0, 0],
    };
    const r = Math.sqrt(17); // radius = sqrt(16+1)
    // Point directly at angle PI (the -x axis), at distance r from center
    const px = -r;
    const py = 0;
    expect(pointToArcSegmentDistSq(px, py, wrapArc)).toBeCloseTo(0, 3);
  });
});

// ── svgPathHitsPoint ──────────────────────────────────────────────────

describe('svgPathHitsPoint', () => {
  function makeSvg(overrides: Partial<SVGObject> = {}): SVGObject {
    return {
      id: 'svg_test',
      segments: [],
      color: WHITE,
      cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10,
      ...overrides,
    };
  }

  test('point near a line segment returns true', () => {
    const svg = makeSvg({
      segments: [{ kind: 'line', start: [0, 0], end: [10, 0] }],
    });
    // Point 0.5 cells away, tolerance = 1 cell squared
    expect(svgPathHitsPoint(svg, 5, 0.5, 1)).toBe(true);
  });

  test('point far from a line segment returns false', () => {
    const svg = makeSvg({
      segments: [{ kind: 'line', start: [0, 0], end: [10, 0] }],
    });
    // Point 5 cells away, tolerance = 1 cell squared
    expect(svgPathHitsPoint(svg, 5, 5, 1)).toBe(false);
  });

  test('point near an arc segment returns true', () => {
    const svg = makeSvg({
      segments: [{
        kind: 'arc',
        start: [4, 0] as [number, number],
        end: [0, 4] as [number, number],
        center: [0, 0] as [number, number],
      }],
    });
    // Point on the arc
    const x = 4 * Math.SQRT1_2;
    const y = 4 * Math.SQRT1_2;
    expect(svgPathHitsPoint(svg, x, y, 0.01)).toBe(true);
  });

  test('hits on subpath segments', () => {
    const svg = makeSvg({
      segments: [{ kind: 'line', start: [0, 0], end: [1, 0] }],
      subpaths: [{
        segments: [{ kind: 'line', start: [5, 5], end: [10, 5] }],
        color: { r: 255, g: 0, b: 0 },
      }],
    });
    // Point near the subpath, far from primary
    expect(svgPathHitsPoint(svg, 7, 5, 0.25)).toBe(true);
  });

  test('empty segments returns false', () => {
    const svg = makeSvg({ segments: [] });
    expect(svgPathHitsPoint(svg, 5, 5, 1)).toBe(false);
  });

  test('mixed line and arc segments', () => {
    const svg = makeSvg({
      segments: [
        { kind: 'line', start: [0, 0], end: [2, 0] },
        { kind: 'arc', start: [2, 0] as [number, number], end: [4, 2] as [number, number], center: [2, 2] as [number, number] },
      ],
    });
    // Point near the arc portion at 45 degrees: (2 + sqrt2, 2 - sqrt2) on the circle of radius 2
    const x = 2 + 2 * Math.SQRT1_2;
    const y = 2 - 2 * Math.SQRT1_2;
    expect(svgPathHitsPoint(svg, x, y, 0.01)).toBe(true);
    // Point in the middle of nowhere
    expect(svgPathHitsPoint(svg, 10, 10, 0.01)).toBe(false);
  });

  test('tolerance boundary: exactly at tolerance distance', () => {
    const svg = makeSvg({
      segments: [{ kind: 'line', start: [0, 0], end: [10, 0] }],
    });
    // Point exactly 1 cell above, tolerance = 1 squared
    expect(svgPathHitsPoint(svg, 5, 1, 1)).toBe(true);
    // Point 1.01 cells above, tolerance = 1 squared
    expect(svgPathHitsPoint(svg, 5, 1.01, 1)).toBe(false);
  });
});

// ── brushHitsSegments ─────────────────────────────────────────────────

describe('brushHitsSegments', () => {
  function makeSvg(overrides: Partial<SVGObject> = {}): SVGObject {
    return {
      id: 'svg_test',
      segments: [],
      color: WHITE,
      cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10,
      ...overrides,
    };
  }

  test('returns {idx, distSq} entries for each in-range segment', () => {
    const svg = makeSvg({
      segments: [
        { kind: 'line', start: [0, 0], end: [10, 0] }, // y=0
        { kind: 'line', start: [0, 5], end: [10, 5] }, // y=5
        { kind: 'line', start: [0, 9], end: [10, 9] }, // y=9
      ],
    });
    // Brush center at (5, 0.5), radius 1 → only first line is in range
    const hits = brushHitsSegments(svg, 5, 0.5, 1);
    expect(hits).toHaveLength(1);
    expect(hits[0].idx).toBe(0);
    expect(hits[0].distSq).toBeCloseTo(0.25); // (0.5)^2
  });

  test('distSq stays under radius squared for every hit', () => {
    const svg = makeSvg({
      segments: [
        { kind: 'line', start: [0, 0], end: [10, 0] },
        { kind: 'line', start: [0, 0.5], end: [10, 0.5] },
      ],
    });
    const radius = 1;
    const hits = brushHitsSegments(svg, 5, 0, radius);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.distSq).toBeLessThanOrEqual(radius * radius);
    }
  });

  test('hits indexed against subpaths when present (subpaths-only)', () => {
    const svg = makeSvg({
      segments: [{ kind: 'line', start: [0, 0], end: [10, 0] }], // ignored
      subpaths: [
        {
          segments: [
            { kind: 'line', start: [0, 5], end: [10, 5] },
            { kind: 'line', start: [0, 6], end: [10, 6] },
          ],
          color: { r: 255, g: 0, b: 0 },
        },
      ],
    });
    // Brush at (5, 5.5), radius 1 → both subpath lines are 0.5 away
    const hits = brushHitsSegments(svg, 5, 5.5, 1);
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.idx).sort()).toEqual([0, 1]);
  });

  test('no hits when nothing is in range', () => {
    const svg = makeSvg({
      segments: [{ kind: 'line', start: [0, 0], end: [10, 0] }],
    });
    expect(brushHitsSegments(svg, 50, 50, 1)).toEqual([]);
  });

  test('tiled SVG: brush on non-origin tile hits same segments as origin', () => {
    // Origin tile has a segment at y=2, spanning x=[0,10].
    // Tile is 10x10, region is 30x10 (3 tiles wide).
    const svg = makeSvg({
      segments: [{ kind: 'line', start: [0, 2], end: [10, 2] }],
      cellX: 0, cellY: 0, cellWidth: 30, cellHeight: 10,
      tileMode: 'repeat' as const,
      tileWidthL0: 10,
      tileHeightL0: 10,
    });
    // Brush at x=5 (origin tile) and x=15 (second tile) should both hit.
    const originHits = brushHitsSegments(svg, 5, 2.5, 1);
    const secondTileHits = brushHitsSegments(svg, 15, 2.5, 1);
    expect(originHits).toHaveLength(1);
    expect(secondTileHits).toHaveLength(1);
    expect(secondTileHits[0].idx).toBe(originHits[0].idx);
  });

  test('tiled SVG: tile offset is accounted for', () => {
    // Tile anchor at cellX + tileOffsetXL0 = 0 + 2 = 2.
    // Segment at x=[2,8], y=3 (within the tile starting at anchor).
    const svg = makeSvg({
      segments: [{ kind: 'line', start: [2, 3], end: [8, 3] }],
      cellX: 0, cellY: 0, cellWidth: 20, cellHeight: 10,
      tileMode: 'repeat' as const,
      tileWidthL0: 10,
      tileHeightL0: 10,
      tileOffsetXL0: 2,
      tileOffsetYL0: 0,
    });
    // Brush at x=15 in the second tile should wrap to x=5 in the origin tile
    // (15 - anchor 2) % 10 + 2 = 5.
    const hits = brushHitsSegments(svg, 15, 3, 1);
    expect(hits).toHaveLength(1);
  });

  test('tiled SVG: brush outside region still wraps correctly', () => {
    // Even though the AABB pre-filter in the caller would normally reject
    // points outside the region, brushHitsSegments itself should handle
    // the wrap math gracefully for any input.
    const svg = makeSvg({
      segments: [{ kind: 'line', start: [0, 0], end: [10, 0] }],
      cellX: 0, cellY: 0, cellWidth: 20, cellHeight: 10,
      tileMode: 'repeat' as const,
      tileWidthL0: 10,
      tileHeightL0: 10,
    });
    // Brush at x=25 wraps to x=5, near the segment at y=0.
    const hits = brushHitsSegments(svg, 25, 0.5, 1);
    expect(hits).toHaveLength(1);
    expect(hits[0].idx).toBe(0);
  });
});

// ── brushHitsSegments perInstance (per-copy paint) ────────────────────

describe('brushHitsSegments perInstance', () => {
  // Tile 10×10 with one vertical segment at x=5 (mid-tile), region 30×10 so
  // there are 3 copies: col 0 @ x=5, col 1 @ x=15, col 2 @ x=25.
  function makeTiled(overrides: Partial<SVGObject> = {}): SVGObject {
    return {
      id: 'svg_tile',
      segments: [{ kind: 'line', start: [5, 0], end: [5, 10] }],
      color: WHITE,
      cellX: 0, cellY: 0, cellWidth: 30, cellHeight: 10,
      tileMode: 'repeat' as const,
      tileWidthL0: 10, tileHeightL0: 10,
      ...overrides,
    };
  }

  test('interior dab tags the hit with the copy it lands in', () => {
    const svg = makeTiled();
    // Brush on copy 1's segment (x=15).
    const hits = brushHitsSegments(svg, 15, 5, 1, true);
    expect(hits).toHaveLength(1);
    expect(hits[0].idx).toBe(0);
    expect(hits[0].col).toBe(1);
    expect(hits[0].row).toBe(0);
    expect(hits[0].distSq).toBeCloseTo(0);
  });

  test('boundary-straddling dab paints both adjacent copies with their own falloff', () => {
    const svg = makeTiled();
    // Brush at x=12, radius 8 reaches copy 0's segment (x=5, dist 7 → distSq 49)
    // and copy 1's segment (x=15, dist 3 → distSq 9); copy 2 (x=25) is 13 away
    // (distSq 169 > 64) and is excluded.
    const hits = brushHitsSegments(svg, 12, 5, 8, true);
    const byCol = new Map(hits.map((h) => [h.col, h]));
    expect([...byCol.keys()].sort()).toEqual([0, 1]);
    expect(byCol.get(0)!.distSq).toBeCloseTo(49);
    expect(byCol.get(1)!.distSq).toBeCloseTo(9);
    // True world distances — not folded back into one copy — so the nearer
    // copy gets the smaller distSq (stronger falloff).
    expect(byCol.get(1)!.distSq).toBeLessThan(byCol.get(0)!.distSq);
  });

  test('clamps to the region — never tags a copy outside the visible grid', () => {
    // Single-tile region (cellWidth 10 → only col 0 is rendered). A wide brush
    // reaching where col 1 would be must not emit a col-1 override.
    const svg = makeTiled({ cellWidth: 10 });
    const hits = brushHitsSegments(svg, 12, 5, 8, true);
    expect(hits.every((h) => h.col === 0)).toBe(true);
  });

  test('row index is tagged for vertically-stacked copies', () => {
    // 10×20 region → 2 rows. Horizontal segment at y=5 mid-tile.
    const svg = makeTiled({
      segments: [{ kind: 'line', start: [0, 5], end: [10, 5] }],
      cellWidth: 10, cellHeight: 20,
    });
    const hits = brushHitsSegments(svg, 5, 15, 1, true); // copy (col 0, row 1)
    expect(hits).toHaveLength(1);
    expect(hits[0].col).toBe(0);
    expect(hits[0].row).toBe(1);
  });
});

// ── computeHitToleranceCells ──────────────────────────────────────────

describe('computeHitToleranceCells', () => {
  test('zoom 1 on 800px viewport', () => {
    const t = computeHitToleranceCells({ width: 800 }, { zoom: 1 });
    expect(t).toBeCloseTo(24 / 25); // 24 / (800/32)
  });

  test('tolerance shrinks with higher zoom', () => {
    const t1 = computeHitToleranceCells({ width: 800 }, { zoom: 1 });
    const t2 = computeHitToleranceCells({ width: 800 }, { zoom: 2 });
    expect(t2).toBeLessThan(t1);
    expect(t2).toBeCloseTo(t1 / 2);
  });

  test('tolerance grows with lower zoom', () => {
    const t1 = computeHitToleranceCells({ width: 800 }, { zoom: 1 });
    const t05 = computeHitToleranceCells({ width: 800 }, { zoom: 0.5 });
    expect(t05).toBeCloseTo(t1 * 2);
  });

  test('degenerate viewport returns fallback', () => {
    expect(computeHitToleranceCells({ width: 0 }, { zoom: 1 })).toBe(0.75);
  });
});

// ── pointInClosedPath ─────────────────────────────────────────────────

describe('pointInClosedPath', () => {
  const square: PathSegment[] = [
    { kind: 'line', start: [0, 0], end: [4, 0] },
    { kind: 'line', start: [4, 0], end: [4, 4] },
    { kind: 'line', start: [4, 4], end: [0, 4] },
    { kind: 'line', start: [0, 4], end: [0, 0] },
  ];

  test('point inside square', () => {
    expect(pointInClosedPath(square, 2, 2)).toBe(true);
  });

  test('point outside square', () => {
    expect(pointInClosedPath(square, 5, 2)).toBe(false);
    expect(pointInClosedPath(square, 2, -1)).toBe(false);
  });

  test('point on edge follows half-open convention (left edge in, right edge out)', () => {
    expect(pointInClosedPath(square, 0, 2)).toBe(true);
    expect(pointInClosedPath(square, 4, 2)).toBe(false);
  });

  test('4-arc circle: center inside, bbox corner outside the disc', () => {
    // Circle of radius 2 centered at (2,2): four quarter arcs
    const circle: PathSegment[] = [
      { kind: 'arc', start: [2, 0], end: [4, 2], center: [2, 2] },
      { kind: 'arc', start: [4, 2], end: [2, 4], center: [2, 2] },
      { kind: 'arc', start: [2, 4], end: [0, 2], center: [2, 2] },
      { kind: 'arc', start: [0, 2], end: [2, 0], center: [2, 2] },
    ];
    expect(pointInClosedPath(circle, 2, 2)).toBe(true);
    // (0.2, 0.2) is inside the bbox but outside the disc
    // (distance from center ≈ 2.55 > r=2)
    expect(pointInClosedPath(circle, 0.2, 0.2)).toBe(false);
    // Just inside the disc near the right edge
    expect(pointInClosedPath(circle, 3.8, 2)).toBe(true);
  });

  test('unordered segment bag chains and tests correctly', () => {
    const bag: PathSegment[] = [
      { kind: 'line', start: [4, 4], end: [0, 4] },
      { kind: 'line', start: [0, 0], end: [4, 0] },
      { kind: 'line', start: [0, 4], end: [0, 0] },
      { kind: 'line', start: [4, 0], end: [4, 4] },
    ];
    expect(pointInClosedPath(bag, 2, 2)).toBe(true);
    expect(pointInClosedPath(bag, 5, 5)).toBe(false);
  });

  test('open path returns false everywhere', () => {
    const open: PathSegment[] = [
      { kind: 'line', start: [0, 0], end: [4, 0] },
      { kind: 'line', start: [4, 0], end: [4, 4] },
      { kind: 'line', start: [4, 4], end: [0, 4] },
    ];
    expect(pointInClosedPath(open, 2, 2)).toBe(false);
  });

  test('unchainable bag returns false', () => {
    const disjoint: PathSegment[] = [
      { kind: 'line', start: [0, 0], end: [1, 0] },
      { kind: 'line', start: [5, 5], end: [6, 5] },
    ];
    expect(pointInClosedPath(disjoint, 0.5, 0.1)).toBe(false);
  });

  test('empty segments return false', () => {
    expect(pointInClosedPath([], 0, 0)).toBe(false);
  });
});
