import {
  detectLineDirection,
  OCTANT_ZONE_RAD,
  constrainLineBbox,
  constrainRectBbox,
  computeLineVertices,
  computeCreationBox,
  computeRectSegments,
  recenterLineBoxOnGrid,
} from '../compositionLineBboxMath';

describe('detectLineDirection', () => {
  test('returns horizontal for zero dy', () => {
    expect(detectLineDirection(10, 0)).toBe('horizontal');
    expect(detectLineDirection(-5, 0)).toBe('horizontal');
  });

  test('returns vertical for zero dx', () => {
    expect(detectLineDirection(0, 10)).toBe('vertical');
    expect(detectLineDirection(0, -5)).toBe('vertical');
  });

  test('returns horizontal for small angle (< 15 degrees)', () => {
    // tan(10 degrees) ≈ 0.176 → well within horizontal zone
    expect(detectLineDirection(10, 1.7)).toBe('horizontal');
    expect(detectLineDirection(-10, -1.7)).toBe('horizontal');
  });

  test('returns vertical for steep angle (> 75 degrees)', () => {
    // tan(80 degrees) ≈ 5.67 → well within vertical zone
    expect(detectLineDirection(1.7, 10)).toBe('vertical');
    expect(detectLineDirection(-1.7, -10)).toBe('vertical');
  });

  test('returns diagonal for 45-degree angle', () => {
    expect(detectLineDirection(10, 10)).toBe('diagonal');
    expect(detectLineDirection(-10, 10)).toBe('diagonal');
    expect(detectLineDirection(10, -10)).toBe('diagonal');
    expect(detectLineDirection(-10, -10)).toBe('diagonal');
  });

  test('returns diagonal for angles well within the wide diagonal zone', () => {
    // 20 degrees: tan(20) ≈ 0.364 — inside the 15–75° diagonal zone
    expect(detectLineDirection(10, 3.6)).toBe('diagonal');
    // 70 degrees: tan(70) ≈ 2.747 — inside the diagonal zone
    expect(detectLineDirection(3.6, 10)).toBe('diagonal');
  });

  test('returns horizontal for zero vector', () => {
    expect(detectLineDirection(0, 0)).toBe('horizontal');
  });

  test('boundary at exactly 15 degrees falls to horizontal', () => {
    const dx = 10;
    const dy = dx * Math.tan(Math.PI / 12); // exactly at 15° boundary
    const result = detectLineDirection(dx, dy * 0.99);
    expect(result).toBe('horizontal');
  });

  test('a custom zone moves the boundary — OCTANT_ZONE_RAD gives nearest-of-8', () => {
    // 20°: diagonal under the default 15° zones, horizontal once the zones
    // meet halfway (22.5°), which is what a caller forcing the diagonal to an
    // exact 45° wants — nothing between 0° and 45° is left un-owned.
    expect(detectLineDirection(10, 3.6)).toBe('diagonal');
    expect(detectLineDirection(10, 3.6, OCTANT_ZONE_RAD)).toBe('horizontal');
    expect(detectLineDirection(3.6, 10, OCTANT_ZONE_RAD)).toBe('vertical');
    // 30° is still nearer 45 than 0, so it stays diagonal in both zonings.
    expect(detectLineDirection(10, 5.8, OCTANT_ZONE_RAD)).toBe('diagonal');
    expect(detectLineDirection(10, 10, OCTANT_ZONE_RAD)).toBe('diagonal');
  });

  test('the octant zones are symmetric across all four quadrants', () => {
    for (const [dx, dy] of [[10, 3.6], [-10, 3.6], [10, -3.6], [-10, -3.6]]) {
      expect(detectLineDirection(dx, dy, OCTANT_ZONE_RAD)).toBe('horizontal');
    }
  });
});

describe('constrainLineBbox', () => {
  const step = 4;

  test('horizontal drag produces constrained width and one-step height', () => {
    const [ex, ey] = constrainLineBbox(0, 0, 10, 1, step);
    // Width snaps to grid: round(10/4)*4 = 12
    expect(ex).toBe(12);
    // Height forced to one step
    expect(ey).toBe(step);
  });

  test('vertical drag produces constrained height and one-step width', () => {
    const [ex, ey] = constrainLineBbox(0, 0, 1, 10, step);
    // Width forced to one step
    expect(ex).toBe(step);
    // Height snaps to grid: round(10/4)*4 = round(2.5)*4 = 3*4 = 12
    expect(ey).toBe(12);
  });

  test('diagonal drag constrains to square', () => {
    const [ex, ey] = constrainLineBbox(0, 0, 7, 9, step);
    // Square: min(7, 9) = 7, round(7/4)*4 = 8
    expect(ex).toBe(8);
    expect(ey).toBe(8);
  });

  test('returns start when snap rounds to zero', () => {
    const [ex, ey] = constrainLineBbox(4, 4, 5, 5, step);
    // dx=1, dy=1 diagonal: min(1,1)=1, round(1/4)*4 = 0
    expect(ex).toBe(4);
    expect(ey).toBe(4);
  });

  test('negative direction preserves sign', () => {
    const [ex, ey] = constrainLineBbox(8, 8, -2, -2, step);
    // dx=-10, dy=-10 diagonal: min(10,10)=10, round(10/4)*4=12
    // ex = 8 + 12*sign(-10) = 8 - 12 = -4
    expect(ex).toBe(-4);
    expect(ey).toBe(-4);
  });

  test('horizontal with negative direction', () => {
    const [ex, ey] = constrainLineBbox(12, 4, 2, 5, step);
    // dx=-10, dy=1 → horizontal. Width: round(-10/4)*4 = round(-2.5)*4 = -2*4 = -8
    // ex = 12 + (-8) = 4
    expect(ex).toBe(4);
    // Perpendicular thickness is unconditionally +step
    expect(ey).toBe(4 + step);
  });

  test('vertical drag with leftward jitter keeps start cell in bbox', () => {
    // Mostly-vertical drag; cursor drifts a hair left of start (dx < 0).
    // Pre-fix this would have returned ex = sx - step, shifting the bbox
    // one cell west and dropping the start cell out of it.
    const [ex, ey] = constrainLineBbox(8, 8, 7.5, 20, step);
    expect(ex).toBe(8 + step);
    expect(ey).toBe(20);
  });

  test('vertical drag with dx === 0 places thickness on the right', () => {
    const [ex, ey] = constrainLineBbox(8, 8, 8, 20, step);
    expect(ex).toBe(8 + step);
    expect(ey).toBe(20);
  });

  test('vertical drag with rightward jitter places thickness on the right', () => {
    const [ex, ey] = constrainLineBbox(8, 8, 8.5, 20, step);
    expect(ex).toBe(8 + step);
    expect(ey).toBe(20);
  });

  test('horizontal drag with upward jitter keeps start cell in bbox', () => {
    // Mostly-horizontal drag; cursor drifts a hair above start (dy < 0).
    // Pre-fix this would have returned ey = sy - step, lifting the bbox
    // one cell north and dropping the start cell out of it.
    const [ex, ey] = constrainLineBbox(8, 8, 20, 7.5, step);
    expect(ex).toBe(20);
    expect(ey).toBe(8 + step);
  });

  test('horizontal drag with dy === 0 places thickness below', () => {
    const [ex, ey] = constrainLineBbox(8, 8, 20, 8, step);
    expect(ex).toBe(20);
    expect(ey).toBe(8 + step);
  });
});

describe('computeLineVertices', () => {
  test('horizontal: vertices at vertical midpoint, spanning full width', () => {
    const verts = computeLineVertices(0, 0, 8, 4, 'horizontal');
    expect(verts).toEqual([[0, 2], [8, 2]]);
  });

  test('vertical: vertices at horizontal midpoint, spanning full height', () => {
    const verts = computeLineVertices(0, 0, 4, 8, 'vertical');
    expect(verts).toEqual([[2, 0], [2, 8]]);
  });

  test('diagonal: vertices at opposite corners preserving direction', () => {
    const verts = computeLineVertices(2, 2, 6, 6, 'diagonal');
    expect(verts).toEqual([[2, 2], [6, 6]]);
  });

  test('diagonal with negative direction', () => {
    const verts = computeLineVertices(8, 8, 4, 4, 'diagonal');
    expect(verts).toEqual([[8, 8], [4, 4]]);
  });

  test('horizontal with negative direction: minX on left', () => {
    const verts = computeLineVertices(10, 2, 2, 6, 'horizontal');
    // midY = (2 + 6) / 2 = 4, minX = 2, maxX = 10
    expect(verts).toEqual([[2, 4], [10, 4]]);
  });
});

describe('computeCreationBox', () => {
  test('standard positive direction', () => {
    expect(computeCreationBox(2, 3, 8, 7)).toEqual({
      minX: 2, minY: 3, width: 6, height: 4,
    });
  });

  test('negative direction normalizes to positive box', () => {
    expect(computeCreationBox(8, 7, 2, 3)).toEqual({
      minX: 2, minY: 3, width: 6, height: 4,
    });
  });

  test('zero-size box', () => {
    expect(computeCreationBox(5, 5, 5, 5)).toEqual({
      minX: 5, minY: 5, width: 0, height: 0,
    });
  });
});

describe('recenterLineBoxOnGrid', () => {
  const step = 4;

  test('horizontal: line lands on the start grid line, box straddles it', () => {
    // constrainLineBbox(0,0,...) for a horizontal drag yields end (W, step).
    const [bsx, bsy, bex, bey] = recenterLineBoxOnGrid(0, 0, 8, step, 'horizontal');
    // Both y corners shift up by half the perpendicular thickness (step/2).
    expect([bsx, bsy, bex, bey]).toEqual([0, -step / 2, 8, step / 2]);
    // Line is at the original start y (= 0, on grid), spanning full width.
    expect(computeLineVertices(bsx, bsy, bex, bey, 'horizontal')).toEqual([[0, 0], [8, 0]]);
    // Box straddles the grid line: minY = -step/2, height = step.
    expect(computeCreationBox(bsx, bsy, bex, bey)).toEqual({
      minX: 0, minY: -step / 2, width: 8, height: step,
    });
  });

  test('horizontal with non-zero anchor', () => {
    const sy = 12;
    const [, bsy, , bey] = recenterLineBoxOnGrid(8, sy, 20, sy + step, 'horizontal');
    expect([bsy, bey]).toEqual([sy - step / 2, sy + step / 2]);
    const verts = computeLineVertices(8, bsy, 20, bey, 'horizontal');
    expect(verts).toEqual([[8, sy], [20, sy]]);
  });

  test('vertical: line lands on the start grid line, box straddles it', () => {
    const [bsx, bsy, bex, bey] = recenterLineBoxOnGrid(0, 0, step, 8, 'vertical');
    // Both x corners shift left by half the perpendicular thickness (step/2).
    expect([bsx, bsy, bex, bey]).toEqual([-step / 2, 0, step / 2, 8]);
    // Line is at the original start x (= 0, on grid), spanning full height.
    expect(computeLineVertices(bsx, bsy, bex, bey, 'vertical')).toEqual([[0, 0], [0, 8]]);
    expect(computeCreationBox(bsx, bsy, bex, bey)).toEqual({
      minX: -step / 2, minY: 0, width: step, height: 8,
    });
  });

  test('diagonal: corners unchanged', () => {
    expect(recenterLineBoxOnGrid(2, 2, 6, 6, 'diagonal')).toEqual([2, 2, 6, 6]);
    expect(recenterLineBoxOnGrid(8, 8, 4, 4, 'diagonal')).toEqual([8, 8, 4, 4]);
  });
});

describe('constrainRectBbox', () => {
  const step = 4;

  test('snaps both axes independently to grid', () => {
    const [ex, ey] = constrainRectBbox(0, 0, 7, 5, step);
    expect(ex).toBe(8);
    expect(ey).toBe(4);
  });

  test('allows non-square rectangles', () => {
    const [ex, ey] = constrainRectBbox(0, 0, 10, 3, step);
    // round(10/4)*4 = 12, round(3/4)*4 = 4
    expect(ex).toBe(12);
    expect(ey).toBe(4);
  });

  test('returns start when snap rounds to zero on both axes', () => {
    const [ex, ey] = constrainRectBbox(4, 4, 5, 5, step);
    expect(ex).toBe(4);
    expect(ey).toBe(4);
  });

  test('negative direction preserves sign', () => {
    const [ex, ey] = constrainRectBbox(8, 8, -2, 2, step);
    // round(-10/4)*4 = -12, round(-6/4)*4 = -8
    expect(ex).toBe(8 + Math.round(-10 / step) * step);
    expect(ey).toBe(8 + Math.round(-6 / step) * step);
  });

  test('non-zero origin', () => {
    const [ex, ey] = constrainRectBbox(4, 4, 11, 9, step);
    // round(7/4)*4 = 8, round(5/4)*4 = 4
    expect(ex).toBe(12);
    expect(ey).toBe(8);
  });
});

describe('computeRectSegments', () => {
  test('produces 4 closed line segments', () => {
    const segs = computeRectSegments(0, 0, 8, 4);
    expect(segs).toHaveLength(4);
    expect(segs.every(s => s.kind === 'line')).toBe(true);
  });

  test('segments form a closed rectangle', () => {
    const segs = computeRectSegments(0, 0, 8, 4);
    // top, right, bottom, left
    expect(segs[0]).toEqual({ kind: 'line', start: [0, 0], end: [8, 0] });
    expect(segs[1]).toEqual({ kind: 'line', start: [8, 0], end: [8, 4] });
    expect(segs[2]).toEqual({ kind: 'line', start: [8, 4], end: [0, 4] });
    expect(segs[3]).toEqual({ kind: 'line', start: [0, 4], end: [0, 0] });
  });

  test('each segment end connects to next segment start', () => {
    const segs = computeRectSegments(2, 3, 10, 7);
    for (let i = 0; i < segs.length; i++) {
      const next = segs[(i + 1) % segs.length];
      expect(segs[i].end).toEqual(next.start);
    }
  });

  test('negative direction corners', () => {
    const segs = computeRectSegments(8, 4, 0, 0);
    // Still uses the provided corners as-is
    expect(segs[0]).toEqual({ kind: 'line', start: [8, 4], end: [0, 4] });
    expect(segs[1]).toEqual({ kind: 'line', start: [0, 4], end: [0, 0] });
    expect(segs[2]).toEqual({ kind: 'line', start: [0, 0], end: [8, 0] });
    expect(segs[3]).toEqual({ kind: 'line', start: [8, 0], end: [8, 4] });
  });
});
