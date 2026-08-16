import { constrainToSquare, pickCenter, computeSweepFlag, arcRadius, arcEndpoints, translateSegments, computeCircleSegments, isClosedPath, chainSegments, reverseSegment, computeSignedArea, normalizeClosedSegments, rotatePointAboutCW, rotateSegmentsAbout, warpSegments, computeOvalSegments, computeEllipsePolyline, ELLIPSE_POLYLINE_SEGMENTS } from '../compositionArcMath';
import { computeRectSegments } from '../compositionLineBboxMath';
import { PathSegment, SVGObject } from '../types';

describe('constrainToSquare', () => {
  it('clamps to square using min(|dx|,|dy|), snapped to grid', () => {
    // Drag from (0,0) to (5,3) with gridStep=1 → side=3
    expect(constrainToSquare(0, 0, 5, 3, 1)).toEqual([3, 3]);
  });

  it('preserves drag direction signs', () => {
    expect(constrainToSquare(4, 4, 1, 1, 1)).toEqual([1, 1]);
    expect(constrainToSquare(0, 0, -3, -5, 1)).toEqual([-3, -3]);
    expect(constrainToSquare(0, 0, 4, -6, 2)).toEqual([4, -4]);
  });

  it('snaps side length to grid step', () => {
    // gridStep=4, drag (0,0)→(5,7) → min(5,7)=5, round(5/4)*4 = 4
    expect(constrainToSquare(0, 0, 5, 7, 4)).toEqual([4, 4]);
  });

  it('returns start when side would be zero', () => {
    expect(constrainToSquare(0, 0, 0.4, 0.4, 1)).toEqual([0, 0]);
  });
});

describe('pickCenter', () => {
  it('picks center that bulges upward for drag down-right', () => {
    // Drag (0,0)→(3,3): C1=(0,3) midY≈0.88, C2=(3,0) midY≈2.12 → picks C1
    const center = pickCenter(0, 0, 3, 3);
    expect(center).toEqual([0, 3]);
  });

  it('picks center that bulges downward for drag down-left', () => {
    // Drag (3,0)→(0,3): C1=(3,3) midY≈0.88, C2=(0,0) midY≈2.12 → picks C2 (bulge down)
    const center = pickCenter(3, 0, 0, 3);
    expect(center).toEqual([0, 0]);
  });

  it('picks center that bulges upward for drag up-right', () => {
    // Drag (0,3)→(3,0): C1=(0,0) midY≈2.12, C2=(3,3) midY≈0.88 → picks C2 (bulge up)
    const center = pickCenter(0, 3, 3, 0);
    expect(center).toEqual([3, 3]);
  });

  it('picks center that bulges downward for drag up-left', () => {
    // Drag (3,3)→(0,0): C1=(3,0) midY≈2.12, C2=(0,3) midY≈0.88 → picks C1 (bulge down)
    const center = pickCenter(3, 3, 0, 0);
    expect(center).toEqual([3, 0]);
  });
});

describe('computeSweepFlag', () => {
  it('returns 1 for clockwise (screen coords)', () => {
    // Center (0,3), arc from (0,0) to (3,3) → CW in screen
    const sf = computeSweepFlag([0, 0], [3, 3], [0, 3]);
    expect(sf).toBe(1);
  });

  it('returns 0 for counterclockwise', () => {
    // Center (3,0), arc from (0,0) to (3,3) → CCW in screen
    const sf = computeSweepFlag([0, 0], [3, 3], [3, 0]);
    expect(sf).toBe(0);
  });
});

describe('arcRadius', () => {
  it('computes distance from center to start', () => {
    const seg: PathSegment = { kind: 'arc', start: [0, 0], end: [3, 3], center: [0, 3] };
    expect(arcRadius(seg)).toBe(3);
  });

  it('handles diagonal center', () => {
    const seg: PathSegment = { kind: 'arc', start: [0, 0], end: [4, 4], center: [4, 0] };
    expect(arcRadius(seg)).toBe(4);
  });
});

describe('arcEndpoints', () => {
  it('returns first start and last end of segments', () => {
    const arc: SVGObject = {
      id: 'test',
      segments: [
        { kind: 'arc', start: [0, 0], end: [3, 3], center: [0, 3] },
        { kind: 'arc', start: [3, 3], end: [6, 0], center: [6, 3] },
      ],
      color: { r: 255, g: 255, b: 255 },
      cellX: 0, cellY: 0, cellWidth: 6, cellHeight: 3,
    };
    const ep = arcEndpoints(arc);
    expect(ep.first).toEqual([0, 0]);
    expect(ep.last).toEqual([6, 0]);
  });
});

describe('translateSegments', () => {
  it('translates all points by (dx, dy)', () => {
    const segs: PathSegment[] = [
      { kind: 'arc', start: [0, 0], end: [3, 3], center: [0, 3] },
    ];
    const result = translateSegments(segs, 2, 5);
    expect(result[0].start).toEqual([2, 5]);
    expect(result[0].end).toEqual([5, 8]);
    const r0 = result[0];
    if (r0.kind === 'arc') expect(r0.center).toEqual([2, 8]);
  });

  it('handles mixed arc and line segments', () => {
    const segs: PathSegment[] = [
      { kind: 'arc', start: [0, 0], end: [3, 3], center: [0, 3] },
      { kind: 'line', start: [3, 3], end: [5, 5] },
    ];
    const result = translateSegments(segs, 1, 1);
    expect(result[0].kind).toBe('arc');
    expect(result[1].kind).toBe('line');
    expect(result[1].start).toEqual([4, 4]);
    expect(result[1].end).toEqual([6, 6]);
  });
});

describe('computeCircleSegments', () => {
  it('produces 4 arc segments', () => {
    const segs = computeCircleSegments(0, 0, 8, 8);
    expect(segs).toHaveLength(4);
    expect(segs.every(s => s.kind === 'arc')).toBe(true);
  });

  it('all arcs share the same center (midpoint of square)', () => {
    const segs = computeCircleSegments(0, 0, 8, 8);
    for (const seg of segs) {
      if (seg.kind === 'arc') {
        expect(seg.center).toEqual([4, 4]);
      }
    }
  });

  it('segments form a closed loop (each end connects to next start)', () => {
    const segs = computeCircleSegments(0, 0, 8, 8);
    for (let i = 0; i < segs.length; i++) {
      const next = segs[(i + 1) % segs.length];
      expect(segs[i].end).toEqual(next.start);
    }
  });

  it('endpoints are at cardinal positions', () => {
    const segs = computeCircleSegments(0, 0, 8, 8);
    // top, right, bottom, left
    expect(segs[0].start).toEqual([4, 0]); // top
    expect(segs[0].end).toEqual([8, 4]);   // right
    expect(segs[1].end).toEqual([4, 8]);   // bottom
    expect(segs[2].end).toEqual([0, 4]);   // left
    expect(segs[3].end).toEqual([4, 0]);   // back to top
  });

  it('handles negative direction (bottom-right to top-left)', () => {
    const segs = computeCircleSegments(8, 8, 0, 0);
    // Should normalize to same circle as (0,0)→(8,8)
    for (const seg of segs) {
      if (seg.kind === 'arc') {
        expect(seg.center).toEqual([4, 4]);
      }
    }
    expect(segs[0].start).toEqual([4, 0]);
  });

  it('non-zero origin', () => {
    const segs = computeCircleSegments(4, 4, 12, 12);
    for (const seg of segs) {
      if (seg.kind === 'arc') {
        expect(seg.center).toEqual([8, 8]);
      }
    }
    expect(segs[0].start).toEqual([8, 4]); // top
    expect(segs[0].end).toEqual([12, 8]);   // right
  });

  it('all arcs have consistent clockwise sweep', () => {
    const segs = computeCircleSegments(0, 0, 8, 8);
    for (const seg of segs) {
      if (seg.kind === 'arc') {
        const sf = computeSweepFlag(seg.start, seg.end, seg.center);
        expect(sf).toBe(1); // clockwise in screen-y-down
      }
    }
  });
});

describe('isClosedPath', () => {
  it('returns false for empty segments', () => {
    expect(isClosedPath([])).toBe(false);
  });

  it('returns true for a rectangle', () => {
    const segs = computeRectSegments(0, 0, 8, 4);
    expect(isClosedPath(segs)).toBe(true);
  });

  it('returns true for a circle', () => {
    const segs = computeCircleSegments(0, 0, 8, 8);
    expect(isClosedPath(segs)).toBe(true);
  });

  it('returns false for an open polyline', () => {
    const segs: PathSegment[] = [
      { kind: 'line', start: [0, 0], end: [4, 0] },
      { kind: 'line', start: [4, 0], end: [4, 4] },
    ];
    expect(isClosedPath(segs)).toBe(false);
  });

  it('returns true when gap is within epsilon (1e-7)', () => {
    const segs: PathSegment[] = [
      { kind: 'line', start: [0, 0], end: [4, 0] },
      { kind: 'line', start: [4, 0], end: [4, 4] },
      { kind: 'line', start: [4, 4], end: [1e-7, 1e-7] },
    ];
    expect(isClosedPath(segs)).toBe(true);
  });

  it('returns false when gap exceeds epsilon (1e-5)', () => {
    const segs: PathSegment[] = [
      { kind: 'line', start: [0, 0], end: [4, 0] },
      { kind: 'line', start: [4, 0], end: [4, 4] },
      { kind: 'line', start: [4, 4], end: [1e-5, 1e-5] },
    ];
    expect(isClosedPath(segs)).toBe(false);
  });

  it('returns true for unordered segments that form a closed loop', () => {
    // Segments out of order — same as a join result where segments
    // are collected by color rather than chained sequentially.
    const segs: PathSegment[] = [
      { kind: 'line', start: [0, 0], end: [4, 0] },
      { kind: 'line', start: [4, 4], end: [0, 4] },
      { kind: 'line', start: [4, 0], end: [4, 4] },
      { kind: 'line', start: [0, 4], end: [0, 0] },
    ];
    expect(isClosedPath(segs)).toBe(true);
  });

  it('returns true for segments requiring reversal to form a closed loop', () => {
    // seg 0: A→B, seg 1: C→B (reversed relative to chain), seg 2: A→C (reversed)
    const segs: PathSegment[] = [
      { kind: 'line', start: [0, 0], end: [4, 0] },
      { kind: 'line', start: [4, 4], end: [4, 0] },
      { kind: 'line', start: [0, 0], end: [4, 4] },
    ];
    expect(isClosedPath(segs)).toBe(true);
  });

  it('returns false for unordered segments that do not close', () => {
    const segs: PathSegment[] = [
      { kind: 'line', start: [0, 0], end: [4, 0] },
      { kind: 'line', start: [8, 8], end: [4, 4] },
      { kind: 'line', start: [4, 0], end: [4, 4] },
    ];
    expect(isClosedPath(segs)).toBe(false);
  });
});

describe('chainSegments', () => {
  it('returns null for empty segments', () => {
    expect(chainSegments([])).toBeNull();
  });

  it('returns a copy for already-sequential segments', () => {
    const segs: PathSegment[] = [
      { kind: 'line', start: [0, 0], end: [4, 0] },
      { kind: 'line', start: [4, 0], end: [4, 4] },
      { kind: 'line', start: [4, 4], end: [0, 0] },
    ];
    const result = chainSegments(segs);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(3);
    // Chained result should be sequential: each end matches next start
    for (let i = 0; i < result!.length; i++) {
      const next = result![(i + 1) % result!.length];
      expect(Math.abs(result![i].end[0] - next.start[0])).toBeLessThan(1e-6);
      expect(Math.abs(result![i].end[1] - next.start[1])).toBeLessThan(1e-6);
    }
  });

  it('chains unordered segments into connected order', () => {
    const segs: PathSegment[] = [
      { kind: 'line', start: [0, 0], end: [4, 0] },
      { kind: 'line', start: [4, 4], end: [0, 4] },
      { kind: 'line', start: [4, 0], end: [4, 4] },
      { kind: 'line', start: [0, 4], end: [0, 0] },
    ];
    const result = chainSegments(segs);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(4);
    for (let i = 0; i < result!.length; i++) {
      const next = result![(i + 1) % result!.length];
      expect(Math.abs(result![i].end[0] - next.start[0])).toBeLessThan(1e-6);
      expect(Math.abs(result![i].end[1] - next.start[1])).toBeLessThan(1e-6);
    }
  });

  it('chains segments requiring reversal', () => {
    // seg 0: A→B, seg 1: C→B (reversed), seg 2: A→C (reversed)
    const segs: PathSegment[] = [
      { kind: 'line', start: [0, 0], end: [4, 0] },
      { kind: 'line', start: [4, 4], end: [4, 0] },
      { kind: 'line', start: [0, 0], end: [4, 4] },
    ];
    const result = chainSegments(segs);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(3);
    for (let i = 0; i < result!.length; i++) {
      const next = result![(i + 1) % result!.length];
      expect(Math.abs(result![i].end[0] - next.start[0])).toBeLessThan(1e-6);
      expect(Math.abs(result![i].end[1] - next.start[1])).toBeLessThan(1e-6);
    }
  });

  it('returns null for disconnected segments', () => {
    const segs: PathSegment[] = [
      { kind: 'line', start: [0, 0], end: [4, 0] },
      { kind: 'line', start: [10, 10], end: [14, 10] },
    ];
    expect(chainSegments(segs)).toBeNull();
  });
});

describe('computeSignedArea', () => {
  it('CW rectangle has positive area', () => {
    // computeRectSegments goes (sx,sy)→(ex,sy)→(ex,ey)→(sx,ey)→back = CW
    const segs = computeRectSegments(0, 0, 3, 3);
    expect(computeSignedArea(segs)).toBeCloseTo(9, 6);
  });

  it('CCW rectangle (reversed) has negative area', () => {
    const segs = computeRectSegments(0, 0, 3, 3);
    const reversed = segs.map(s => reverseSegment(s)).reverse();
    expect(computeSignedArea(reversed)).toBeCloseTo(-9, 6);
  });

  it('CW circle has positive area close to pi*r^2', () => {
    const r = 3;
    // computeCircleSegments takes bounding box corners
    const segs = computeCircleSegments(5 - r, 5 - r, 5 + r, 5 + r);
    expect(computeSignedArea(segs)).toBeCloseTo(Math.PI * r * r, 1);
  });

  it('mixed line+arc closed path', () => {
    // Half-circle dome: arc from (0,0) to (4,0) around (2,0) radius 2,
    // then a straight line back from (4,0) to (0,0).
    // Area should be half-circle = pi*r^2/2 = pi*4/2 = 2*pi
    // But sign depends on which way the arc sweeps.
    // Arc from (0,0) to (4,0) around (2,0): cross = (-2)*(0) - (0)*(2) = 0
    // Degenerate cross — let's use a non-degenerate example instead.
    // Arc from (0,0) to (2,2) around (0,2), radius=2, then line back.
    const segs2: PathSegment[] = [
      { kind: 'arc', start: [0, 0], end: [2, 2], center: [0, 2] },
      { kind: 'line', start: [2, 2], end: [0, 0] },
    ];
    // This is a "pie slice": triangle (0,0)→(2,2) with an arc bulge.
    // The area should be nonzero.
    const area = computeSignedArea(segs2);
    expect(area).not.toBe(0);
  });
});

describe('normalizeClosedSegments', () => {
  it('CW segments returned in same winding', () => {
    const segs = computeRectSegments(0, 0, 4, 3);
    const normalized = normalizeClosedSegments(segs);
    expect(computeSignedArea(normalized)).toBeGreaterThan(0);
    // Same number of segments
    expect(normalized).toHaveLength(segs.length);
  });

  it('CCW segments returned reversed to CW', () => {
    const cwSegs = computeRectSegments(0, 0, 4, 3);
    const ccwSegs = cwSegs.map(s => reverseSegment(s)).reverse();
    // Verify these are actually CCW
    expect(computeSignedArea(ccwSegs)).toBeLessThan(0);
    const normalized = normalizeClosedSegments(ccwSegs);
    expect(computeSignedArea(normalized)).toBeGreaterThan(0);
  });

  it('unordered bag forming closed path is chained and CW', () => {
    const segs = computeRectSegments(0, 0, 5, 5);
    // Shuffle: put them in wrong order
    const shuffled = [segs[2], segs[0], segs[3], segs[1]];
    const normalized = normalizeClosedSegments(shuffled);
    expect(normalized).toHaveLength(4);
    expect(computeSignedArea(normalized)).toBeCloseTo(25, 6);
    // Sequential connectivity
    for (let i = 0; i < normalized.length; i++) {
      const next = normalized[(i + 1) % normalized.length];
      expect(normalized[i].end[0]).toBe(next.start[0]);
      expect(normalized[i].end[1]).toBe(next.start[1]);
    }
  });

  it('different orderings produce same normalized winding', () => {
    const segs = computeRectSegments(0, 0, 4, 4);
    const order1 = [segs[0], segs[1], segs[2], segs[3]];
    const order2 = [segs[2], segs[3], segs[0], segs[1]];
    const n1 = normalizeClosedSegments(order1);
    const n2 = normalizeClosedSegments(order2);
    // Both should have same positive area
    expect(computeSignedArea(n1)).toBeCloseTo(16, 6);
    expect(computeSignedArea(n2)).toBeCloseTo(16, 6);
  });

  it('open path is chained but not reversed', () => {
    const segs: PathSegment[] = [
      { kind: 'line', start: [0, 0], end: [1, 0] },
      { kind: 'line', start: [1, 0], end: [2, 1] },
    ];
    const normalized = normalizeClosedSegments(segs);
    expect(normalized).toHaveLength(2);
    expect(normalized[0].start).toEqual([0, 0]);
    expect(normalized[1].end).toEqual([2, 1]);
  });

  it('vertices are merged exactly after normalization', () => {
    // Introduce small epsilon differences at shared vertices
    const segs: PathSegment[] = [
      { kind: 'line', start: [0, 0], end: [4, 0] },
      { kind: 'line', start: [4.0000005, 0], end: [4, 3] },
      { kind: 'line', start: [4, 3], end: [0, 3.0000003] },
      { kind: 'line', start: [0, 3], end: [0, 0] },
    ];
    const normalized = normalizeClosedSegments(segs);
    for (let i = 0; i < normalized.length; i++) {
      const next = normalized[(i + 1) % normalized.length];
      expect(normalized[i].end[0]).toBe(next.start[0]);
      expect(normalized[i].end[1]).toBe(next.start[1]);
    }
  });

  it('empty input returns empty array', () => {
    expect(normalizeClosedSegments([])).toEqual([]);
  });
});

describe('rotatePointAboutCW / rotateSegmentsAbout', () => {
  it('turns clockwise in the y-down frame', () => {
    // A quarter turn CW takes the point to the right of the center to the one
    // below it (y grows downward).
    const [x, y] = rotatePointAboutCW(1, 0, 0, 0, 90);
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(1, 9);
  });

  it('leaves the pivot and a full turn alone', () => {
    expect(rotatePointAboutCW(3, 4, 3, 4, 37)).toEqual([3, 4]);
    const [x, y] = rotatePointAboutCW(3, 4, 0, 0, 360);
    expect(x).toBeCloseTo(3, 9);
    expect(y).toBeCloseTo(4, 9);
  });

  it('turns an arc whole — center with endpoints, radius intact', () => {
    const arc: PathSegment = { kind: 'arc', start: [1, 0], end: [0, 1], center: [0, 0] };
    const [turned] = rotateSegmentsAbout([arc], 0, 0, 90);
    if (turned.kind !== 'arc') throw new Error('kind must survive');
    expect(turned.center[0]).toBeCloseTo(0, 9);
    expect(turned.center[1]).toBeCloseTo(0, 9);
    expect(arcRadius(turned)).toBeCloseTo(arcRadius(arc), 9);
    expect(turned.start[0]).toBeCloseTo(0, 9);
    expect(turned.start[1]).toBeCloseTo(1, 9);
  });

  it('does not touch the segments it was handed', () => {
    const segs: PathSegment[] = [{ kind: 'line', start: [0, 0], end: [2, 0] }];
    rotateSegmentsAbout(segs, 0, 0, 45);
    expect(segs[0].end).toEqual([2, 0]);
  });
});

describe('warpSegments', () => {
  /** A push-brush-shaped warp: everything within `radius` of (cx, cy) moves
   *  by `(dx, dy)` scaled by a linear falloff, everything outside stays. */
  const push = (cx: number, cy: number, radius: number, dx: number, dy: number) =>
    (x: number, y: number): [number, number] => {
      const t = Math.hypot(x - cx, y - cy) / radius;
      const w = t >= 1 ? 0 : 1 - t;
      return [x + dx * w, y + dy * w];
    };

  it('moves a line\'s ends by what the warp says at each of them', () => {
    const segs: PathSegment[] = [{ kind: 'line', start: [0, 0], end: [10, 0] }];
    // Centred on the left end with a reach of 4: that end takes the whole
    // push, the far end is outside and takes none. A straight segment is
    // still a straight segment either way.
    const out = warpSegments(segs, push(0, 0, 4, 0, 3));
    expect(out[0].kind).toBe('line');
    expect(out[0].start).toEqual([0, 3]);
    expect(out[0].end).toEqual([10, 0]);
  });

  it('keeps a shared join shared — a pushed path never comes apart', () => {
    // The warp is a function of POSITION, so two segments handed the same
    // point get back the same answer. This is the whole reason the brush
    // can move path points at all.
    const segs: PathSegment[] = [
      { kind: 'line', start: [0, 0], end: [5, 0] },
      { kind: 'line', start: [5, 0], end: [10, 0] },
    ];
    const out = warpSegments(segs, push(5, 0, 6, 1, -2));
    expect(out[0].end).toEqual(out[1].start);
  });

  it('an arc stays an arc: quarter-circle invariant and sweep both hold', () => {
    // Its center is REBUILT from the warped chord rather than warped, since
    // a falloff that moves the three points unequally would leave geometry
    // no renderer, hit-test or exporter could agree on.
    const seg: PathSegment = { kind: 'arc', start: [0, 0], end: [4, 4], center: [0, 4] };
    const was = computeSweepFlag(seg.start, seg.end, seg.center);
    const [out] = warpSegments([seg], push(0, 0, 5, 2, 1));
    expect(out.kind).toBe('arc');
    if (out.kind !== 'arc') return;
    // Moved…
    expect(out.start[0]).toBeGreaterThan(0);
    // …still a quarter circle…
    expect(arcRadius({ start: out.start, center: out.center }))
      .toBeCloseTo(arcRadius({ start: out.end, center: out.center }), 9);
    const ax = out.start[0] - out.center[0];
    const ay = out.start[1] - out.center[1];
    const bx = out.end[0] - out.center[0];
    const by = out.end[1] - out.center[1];
    expect(ax * bx + ay * by).toBeCloseTo(0, 9); // square corner at C
    // …and bulging the way it did.
    expect(computeSweepFlag(out.start, out.end, out.center)).toBe(was);
  });

  it('leaves geometry alone where the warp is the identity', () => {
    const segs: PathSegment[] = [
      { kind: 'line', start: [0, 0], end: [1, 1] },
      { kind: 'arc', start: [0, 0], end: [4, 4], center: [0, 4] },
    ];
    expect(warpSegments(segs, (x, y) => [x, y])).toEqual(segs);
  });

  it('collapses an arc whose chord the warp pinched to nothing', () => {
    // No chord, no center to pick — a line beats emitting NaN.
    const seg: PathSegment = { kind: 'arc', start: [0, 0], end: [4, 4], center: [0, 4] };
    const [out] = warpSegments([seg], () => [2, 2]);
    expect(out).toEqual({ kind: 'line', start: [2, 2], end: [2, 2] });
  });
});

describe('computeOvalSegments', () => {
  it('is the exact 4-arc circle when the box is square', () => {
    expect(computeOvalSegments(0, 0, 8, 8)).toEqual(computeCircleSegments(0, 0, 8, 8));
  });

  it('is a smooth polyline ellipse when it is not', () => {
    // Four circular arcs around a rectangle are not an ellipse: each is
    // handed a start and an end at different distances from its own centre,
    // so the renderer stretches its one radius to reach and the shape comes
    // out kinked. That is the half-computed circle a non-square drag drew.
    const segs = computeOvalSegments(0, 0, 20, 8);
    expect(segs).toHaveLength(ELLIPSE_POLYLINE_SEGMENTS);
    expect(segs.every((s) => s.kind === 'line')).toBe(true);
  });

  it('closes, and touches all four edges of the box exactly', () => {
    const segs = computeOvalSegments(0, 0, 20, 8);
    for (let i = 0; i < segs.length; i++) {
      expect(segs[i].end).toEqual(segs[(i + 1) % segs.length].start);
    }
    const xs = segs.map((s) => s.start[0]);
    const ys = segs.map((s) => s.start[1]);
    expect(Math.min(...xs)).toBeCloseTo(0, 9);
    expect(Math.max(...xs)).toBeCloseTo(20, 9);
    expect(Math.min(...ys)).toBeCloseTo(0, 9);
    expect(Math.max(...ys)).toBeCloseTo(8, 9);
  });

  it('really is an ellipse — every vertex satisfies its equation', () => {
    const segs = computeOvalSegments(-6, 2, 14, 12);
    const cx = 4, cy = 7, rx = 10, ry = 5;
    for (const s of segs) {
      const dx = (s.start[0] - cx) / rx;
      const dy = (s.start[1] - cy) / ry;
      expect(dx * dx + dy * dy).toBeCloseTo(1, 9);
    }
  });

  it('is smooth enough that no chord reads as a flat', () => {
    // The sag of a chord against the true curve, worst case, as a share of
    // the radius: a thousandth is far under a pixel at any zoom offered.
    const r = 1 - Math.cos(Math.PI / ELLIPSE_POLYLINE_SEGMENTS);
    expect(r).toBeLessThan(0.005);
  });

  it('takes a drag from either corner the same way', () => {
    expect(computeOvalSegments(20, 8, 0, 0)).toEqual(computeOvalSegments(0, 0, 20, 8));
  });
});

describe('computeEllipsePolyline', () => {
  it('is the polyline form even for a SQUARE box — a circle in segments', () => {
    // What a resize needs: a circle has to shed its arcs BEFORE a per-axis
    // map touches them, and it sheds them into the exact circle it already
    // is, so nothing moves on the way past.
    const segs = computeEllipsePolyline(0, 0, 8, 8);
    expect(segs).toHaveLength(ELLIPSE_POLYLINE_SEGMENTS);
    expect(segs.every((s) => s.kind === 'line')).toBe(true);
    for (const s of segs) {
      expect(Math.hypot(s.start[0] - 4, s.start[1] - 4)).toBeCloseTo(4, 9);
    }
    // …unlike computeOvalSegments, which keeps a square box's arcs.
    expect(computeOvalSegments(0, 0, 8, 8).every((s) => s.kind === 'arc')).toBe(true);
  });

  it('maps into an exact ellipse under a per-axis stretch', () => {
    // The whole point: the polyline survives the map that broke the arcs.
    const before = computeEllipsePolyline(0, 0, 8, 8);
    const stretched = before.map((s) => ({
      ...s,
      start: [s.start[0] * 2, s.start[1] * 0.5] as [number, number],
      end: [s.end[0] * 2, s.end[1] * 0.5] as [number, number],
    }));
    for (const s of stretched) {
      const dx = (s.start[0] - 8) / 8;
      const dy = (s.start[1] - 2) / 2;
      expect(dx * dx + dy * dy).toBeCloseTo(1, 9);
    }
  });
});
