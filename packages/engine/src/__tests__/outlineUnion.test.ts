/**
 * Tests for engine/outlineUnion.ts — boolean-union cleanup of a closed,
 * CW-wound, possibly self-intersecting / multi-loop line+arc outline into
 * clean boundary contours (outer boundary, and outer + holes).
 */

import { PathSegment } from '../types';
import { unionOutline, unionRegionContours } from '../outlineUnion';
import { computeSignedArea, isClosedPath, arcAngles, chainSegmentsLoops } from '../compositionArcMath';
import { pointInClosedPath } from '../compositionPathHitTest';
import { countProperSelfCrossings } from './outlineUnion.test-utils';

function line(start: [number, number], end: [number, number]): PathSegment {
  return { kind: 'line', start, end };
}

function arc(start: [number, number], end: [number, number], center: [number, number]): PathSegment {
  return { kind: 'arc', start, end, center };
}

/** Closed polyline through the given vertices (last → first implied). */
function poly(...pts: [number, number][]): PathSegment[] {
  return pts.map((p, i) => line(p, pts[(i + 1) % pts.length]));
}

function expectSimpleClosedCW(out: PathSegment[]) {
  expect(out.length).toBeGreaterThan(0);
  expect(isClosedPath(out)).toBe(true);
  expect(computeSignedArea(out)).toBeGreaterThan(0);
  expect(countProperSelfCrossings(out)).toBe(0);
}

function hasVertexNear(out: PathSegment[], p: [number, number], tol = 1e-6): boolean {
  return out.some((seg) =>
    (Math.abs(seg.start[0] - p[0]) <= tol && Math.abs(seg.start[1] - p[1]) <= tol)
    || (Math.abs(seg.end[0] - p[0]) <= tol && Math.abs(seg.end[1] - p[1]) <= tol));
}

describe('unionOutline', () => {
  it('passes a simple rectangle through (region-identical, 4 lines)', () => {
    const rect = poly([0, 0], [8, 0], [8, 8], [0, 8]);
    const out = unionOutline(rect);
    expectSimpleClosedCW(out);
    expect(out).toHaveLength(4);
    expect(out.every((s) => s.kind === 'line')).toBe(true);
    expect(computeSignedArea(out)).toBeCloseTo(64, 9);
    for (const v of [[0, 0], [8, 0], [8, 8], [0, 8]] as [number, number][]) {
      expect(hasVertexNear(out, v)).toBe(true);
    }
  });

  it('bowtie: one crossing becomes a degree-4 vertex, both lobes kept', () => {
    // A→B→C→D→A crosses itself at (4,4); nonzero fill covers both triangles.
    const bowtie = poly([0, 0], [8, 0], [0, 8], [8, 8]);
    expect(countProperSelfCrossings(bowtie)).toBe(1);
    const out = unionOutline(bowtie);
    expectSimpleClosedCW(out);
    expect(computeSignedArea(out)).toBeCloseTo(32, 9); // two 16-area triangles
    expect(hasVertexNear(out, [4, 4])).toBe(true);
    expect(out).toHaveLength(6);
  });

  it('removes a doubled-back flap (opposite-direction coincident pair)', () => {
    const flap: PathSegment[] = [
      line([0, 0], [5, 0]),
      line([5, 0], [3, 0]), // doubles back along the top edge
      line([3, 0], [8, 0]),
      line([8, 0], [8, 8]),
      line([8, 8], [0, 8]),
      line([0, 8], [0, 0]),
    ];
    const out = unionOutline(flap);
    expectSimpleClosedCW(out);
    expect(out).toHaveLength(4);
    expect(computeSignedArea(out)).toBeCloseTo(64, 9);
  });

  it('keeps one copy of co-circular same-direction duplicate arcs', () => {
    const outline: PathSegment[] = [
      line([0, 0], [8, 0]),
      arc([8, 0], [16, 8], [8, 8]),
      line([16, 8], [8, 0]),   // chord back to the arc start
      arc([8, 0], [16, 8], [8, 8]), // the same arc drawn twice
      line([16, 8], [16, 16]),
      line([16, 16], [0, 16]),
      line([0, 16], [0, 0]),
    ];
    const out = unionOutline(outline);
    expectSimpleClosedCW(out);
    expect(out.filter((s) => s.kind === 'arc')).toHaveLength(1);
    // Pentagon 224 + circular segment of the r8 quarter arc (16π − 32).
    expect(computeSignedArea(out)).toBeCloseTo(192 + 16 * Math.PI, 6);
  });

  it('arc×arc crossing: overlapping bumps merge at their intersection', () => {
    const outline: PathSegment[] = [
      line([0, 0], [4, 0]),
      arc([4, 0], [8, -4], [8, 0]),
      arc([8, -4], [12, 0], [8, 0]),
      line([12, 0], [8, 0]), // double back under bump B
      arc([8, 0], [12, -4], [12, 0]),
      arc([12, -4], [16, 0], [12, 0]),
      line([16, 0], [20, 0]),
      line([20, 0], [20, 8]),
      line([20, 8], [0, 8]),
      line([0, 8], [0, 0]),
    ];
    const out = unionOutline(outline);
    expectSimpleClosedCW(out);
    expect(hasVertexNear(out, [10, -2 * Math.sqrt(3)], 1e-6)).toBe(true);
    // Rect 160 + two half-discs (8π each) − half-lens overlap (16π/3 − 4√3).
    const expected = 160 + 16 * Math.PI - (16 * Math.PI) / 3 + 4 * Math.sqrt(3);
    expect(computeSignedArea(out)).toBeCloseTo(expected, 6);
  });

  it('tangency + curvature tie-break: interior loop tangent to an edge is dropped', () => {
    // Full circle drawn as an interior detour, tangent to the top edge at
    // (8,0). At that vertex the line and the arc leave in the same direction;
    // the straighter (more left-bending) line must win.
    const outline: PathSegment[] = [
      line([0, 0], [8, 0]),
      arc([8, 0], [12, 4], [8, 4]),
      arc([12, 4], [8, 8], [8, 4]),
      arc([8, 8], [4, 4], [8, 4]),
      arc([4, 4], [8, 0], [8, 4]),
      line([8, 0], [16, 0]),
      line([16, 0], [16, 8]),
      line([16, 8], [0, 8]),
      line([0, 8], [0, 0]),
    ];
    const out = unionOutline(outline);
    expectSimpleClosedCW(out);
    expect(out).toHaveLength(4);
    expect(out.every((s) => s.kind === 'line')).toBe(true);
    expect(computeSignedArea(out)).toBeCloseTo(128, 9);
  });

  it('fills an enclosed hole (counter-wound inner ring vanishes)', () => {
    const outline: PathSegment[] = [
      line([0, 0], [20, 0]),
      line([20, 0], [20, 20]),
      line([20, 20], [0, 20]),
      line([0, 20], [0, 2]),
      line([0, 2], [2, 2]),   // seam out…
      line([2, 2], [2, 18]),  // inner ring, counter-wound (CCW)
      line([2, 18], [18, 18]),
      line([18, 18], [18, 2]),
      line([18, 2], [2, 2]),
      line([2, 2], [0, 2]),   // …seam back (coincident, opposite)
      line([0, 2], [0, 0]),
    ];
    const out = unionOutline(outline);
    expectSimpleClosedCW(out);
    expect(out).toHaveLength(4);
    expect(computeSignedArea(out)).toBeCloseTo(400, 9);
  });

  it('splits wide input arcs; output arcs all sweep < 180°', () => {
    // Pac-man-ish wedge with a 170° arc.
    const a0 = 0;
    const a1 = (170 * Math.PI) / 180;
    const r = 8;
    const c: [number, number] = [0, 0];
    const p0: [number, number] = [r * Math.cos(a0), r * Math.sin(a0)];
    const p1: [number, number] = [r * Math.cos(a1), r * Math.sin(a1)];
    const outline: PathSegment[] = [
      arc(p0, p1, c), // CW (y-down) 170° sweep
      line(p1, [0, 0]),
      line([0, 0], p0),
    ];
    const inputArea = computeSignedArea(outline);
    expect(inputArea).toBeCloseTo((170 / 360) * Math.PI * r * r, 6);
    const out = unionOutline(outline);
    expectSimpleClosedCW(out);
    expect(computeSignedArea(out)).toBeCloseTo(inputArea, 6);
    for (const seg of out) {
      if (seg.kind === 'arc') expect(Math.abs(arcAngles(seg).da)).toBeLessThan(Math.PI);
    }
  });

  it('mixed line+arc self-overlapping loop: trims the single self-crossing at x = 24 − 16√2', () => {
    // A closed line+arc outline with one fold-back: an edge (y=8) is traversed
    // out-and-back, and two co-circular arcs (r24, r16) overlap. The union
    // must trim the lone proper self-crossing and emit a clean simple boundary.
    const raw: PathSegment[] = [
      line([0, 8], [-8, 8]),
      line([-8, 8], [-8, 0]),
      line([-8, 0], [0, 0]),
      line([0, 0], [8, 0]),
      line([8, 0], [8, 8]),
      line([8, 8], [0, 8]),
      arc([0, 8], [24, -16], [24, 8]), // r24 arc
      line([24, -16], [24, -8]),
      arc([24, -8], [8, 8], [24, 8]),  // r16 arc (returning side)
      line([8, 8], [0, 8]),            // fold-back edge (reversed)
    ];
    expect(isClosedPath(raw)).toBe(true);
    expect(countProperSelfCrossings(raw)).toBe(1);
    const out = unionOutline(raw);
    expectSimpleClosedCW(out);
    const px = 24 - 16 * Math.SQRT2;
    expect(hasVertexNear(out, [px, 0], 1e-6)).toBe(true);
    // The connector face and the floor piece beyond the crossing are interior.
    expect(hasVertexNear(out, [8, 0])).toBe(false);
    // Exact expected area: rect 64 + corner remainder R + quarter annulus 80π,
    // where R is the d>24 corner of the corridor square (triangle − segment).
    const tri = 4 * px;
    const chord = Math.hypot(px, 8);
    const theta = 2 * Math.asin(chord / 48);
    const circSeg = 0.5 * 576 * (theta - Math.sin(theta));
    const expected = 64 + (tri - circSeg) + 80 * Math.PI;
    expect(computeSignedArea(out)).toBeCloseTo(expected, 6);
    // Union output is strictly smaller than the raw loop's winding-weighted
    // area (the overlap was counted twice in the raw signed area).
    expect(computeSignedArea(out)).toBeLessThan(computeSignedArea(raw) - 1);
  });

  it('is idempotent', () => {
    const bowtie = poly([0, 0], [8, 0], [0, 8], [8, 8]);
    const once = unionOutline(bowtie);
    const twice = unionOutline(once);
    expectSimpleClosedCW(twice);
    expect(computeSignedArea(twice)).toBeCloseTo(computeSignedArea(once), 9);
    expect(countProperSelfCrossings(twice)).toBe(0);
    expect(twice).toHaveLength(once.length);
  });
});

describe('unionRegionContours', () => {
  // The counter-wound inner ring from unionOutline's "fills an enclosed hole"
  // test — here it must be PRESERVED as a hole instead of filled.
  const ringWithHole: PathSegment[] = [
    line([0, 0], [20, 0]),
    line([20, 0], [20, 20]),
    line([20, 20], [0, 20]),
    line([0, 20], [0, 2]),
    line([0, 2], [2, 2]),   // seam out…
    line([2, 2], [2, 18]),  // inner ring, counter-wound (CCW)
    line([2, 18], [18, 18]),
    line([18, 18], [18, 2]),
    line([18, 2], [2, 2]),
    line([2, 2], [0, 2]),   // …seam back (coincident, opposite)
    line([0, 2], [0, 0]),
  ];

  it('passes a simple rectangle through (single loop, region-identical)', () => {
    const rect = poly([0, 0], [8, 0], [8, 8], [0, 8]);
    const out = unionRegionContours(rect);
    expect(isClosedPath(out)).toBe(true);
    expect(countProperSelfCrossings(out)).toBe(0);
    expect(out).toHaveLength(4);
    expect(chainSegmentsLoops(out)).toHaveLength(1);
    expect(computeSignedArea(out)).toBeCloseTo(64, 9);
  });

  it('preserves an enclosed hole as a counter-wound inner loop', () => {
    const out = unionRegionContours(ringWithHole);
    expect(isClosedPath(out)).toBe(true);
    expect(countProperSelfCrossings(out)).toBe(0);
    // Two clean loops: outer (CW) + hole (CCW); seam edges dropped.
    const loops = chainSegmentsLoops(out);
    expect(loops).toHaveLength(2);
    expect(computeSignedArea(loops![0])).toBeGreaterThan(0); // outer CW
    expect(computeSignedArea(loops![1])).toBeLessThan(0);    // hole CCW
    // Net region = outer 400 − hole 256.
    expect(computeSignedArea(out)).toBeCloseTo(144, 6);
    expect(pointInClosedPath(out, 10, 10)).toBe(false); // hole center
    expect(pointInClosedPath(out, 1, 10)).toBe(true);   // ring body
    expect(pointInClosedPath(out, -1, 10)).toBe(false); // outside
  });

  it('fold-back over solid area stays filled (no spurious hole)', () => {
    // Same shape but the inner ring is wound the SAME way as the outer, so the
    // overlap is doubly-wound (winding 2) → solid, not a hole.
    const foldBack: PathSegment[] = [
      line([0, 0], [20, 0]),
      line([20, 0], [20, 20]),
      line([20, 20], [0, 20]),
      line([0, 20], [0, 2]),
      line([0, 2], [2, 2]),   // seam out
      line([2, 2], [18, 2]),  // inner ring, SAME winding (CW)
      line([18, 2], [18, 18]),
      line([18, 18], [2, 18]),
      line([2, 18], [2, 2]),
      line([2, 2], [0, 2]),   // seam back
      line([0, 2], [0, 0]),
    ];
    const out = unionRegionContours(foldBack);
    expect(isClosedPath(out)).toBe(true);
    expect(chainSegmentsLoops(out)).toHaveLength(1); // single solid loop
    expect(computeSignedArea(out)).toBeCloseTo(400, 6); // full 20×20, no hole
    expect(pointInClosedPath(out, 10, 10)).toBe(true);
  });

  it('cleans a heavily self-overlapping multi-loop outline to outer + 2 holes', () => {
    // A large mixed line+arc outline that self-crosses many times and encloses
    // two empty regions. unionRegionContours must trim every crossing and emit
    // clean contours: one outer loop plus two hole loops.
    const raw: PathSegment[] = [
      line([48, 68], [16, 68]),
      line([16, 68], [16, 60]),
      line([16, 60], [48, 60]),
      arc([48, 60], [64, 76], [48, 76]),
      line([64, 76], [64, 84]),
      arc([64, 84], [48, 100], [48, 84]),
      arc([48, 100], [32, 84], [48, 84]),
      line([32, 84], [32, 40]),
      arc([32, 40], [72, 0], [72, 40]),
      arc([72, 0], [112, 40], [72, 40]),
      arc([112, 40], [96, 56], [96, 40]),
      line([96, 56], [0, 56]),
      line([0, 56], [0, 48]),
      line([0, 48], [96, 48]),
      arc([96, 48], [104, 40], [96, 40]),
      arc([104, 40], [72, 8], [72, 40]),
      arc([72, 8], [40, 40], [72, 40]),
      line([40, 40], [40, 84]),
      arc([40, 84], [48, 92], [48, 84]),
      arc([48, 92], [56, 84], [48, 84]),
      line([56, 84], [56, 76]),
      arc([56, 76], [48, 68], [48, 76]),
    ];
    expect(countProperSelfCrossings(raw)).toBeGreaterThan(1);
    const out = unionRegionContours(raw);
    expect(isClosedPath(out)).toBe(true);
    expect(countProperSelfCrossings(out)).toBe(0);
    expect(chainSegmentsLoops(out)).toHaveLength(3); // outer + 2 holes
    expect(computeSignedArea(out)).toBeGreaterThan(0);
    // Idempotent: re-running on the clean contours changes nothing material.
    expect(countProperSelfCrossings(unionRegionContours(out))).toBe(0);
  });

  it('extracts multiple holes', () => {
    const outer = poly([0, 0], [30, 0], [30, 30], [0, 30]); // CW
    const holeA = poly([2, 2], [2, 8], [8, 8], [8, 2]);     // CCW
    const holeB = poly([20, 20], [20, 26], [26, 26], [26, 20]); // CCW
    const out = unionRegionContours([...outer, ...holeA, ...holeB]);
    expect(isClosedPath(out)).toBe(true);
    expect(countProperSelfCrossings(out)).toBe(0);
    expect(chainSegmentsLoops(out)).toHaveLength(3); // outer + 2 holes
    expect(computeSignedArea(out)).toBeCloseTo(900 - 36 - 36, 6);
    expect(pointInClosedPath(out, 5, 5)).toBe(false);   // hole A
    expect(pointInClosedPath(out, 23, 23)).toBe(false); // hole B
    expect(pointInClosedPath(out, 15, 15)).toBe(true);  // solid between holes
  });
});
