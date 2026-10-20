import {
  closedSegmentLoops, computeSignedArea, isClosedPath,
} from '@/engine/compositionArcMath';
import { pointInClosedPath } from '@/engine/compositionPathHitTest';
import { PathSegment } from '@/engine/types';
import { sliceIntoFaces } from '../planarFaces';

// The planar arrangement: a bag of curves in, the regions they cut the plane
// into out. Patchwork's own use of it is covered where Patchwork is
// (patchwork.test.ts, which checks the day's loop and frame really do tile
// their frame); these are the module's own cases, and in particular the
// three it has to get right for a bag of curves that was DRAWN rather than
// constructed — a loose end, an island, and a tolerance that has to be
// loosened to suit.

const line = (a: [number, number], b: [number, number]): PathSegment => (
  { kind: 'line', start: a, end: b }
);

/** A box, clockwise from its top-left. */
function rect(x: number, y: number, w: number, h: number): PathSegment[] {
  const pts: [number, number][] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  return pts.map((start, i) => line(start, pts[(i + 1) % pts.length]));
}

const areas = (faces: PathSegment[][]) => faces.map((f) => computeSignedArea(f));
const total = (faces: PathSegment[][]) => areas(faces).reduce((a, b) => a + b, 0);

describe('sliceIntoFaces', () => {
  it('cuts a box in two along a line across it', () => {
    const faces = sliceIntoFaces([...rect(0, 0, 4, 4), line([2, 0], [2, 4])]);
    expect(areas(faces)).toEqual([8, 8]);
    for (const f of faces) expect(isClosedPath(f)).toBe(true);
  });

  it('hands back one face for a box with nothing in it', () => {
    expect(areas(sliceIntoFaces(rect(0, 0, 4, 4)))).toEqual([16]);
  });

  it('every face comes back wound clockwise, as the engine draws its shapes', () => {
    const faces = sliceIntoFaces([
      ...rect(0, 0, 6, 6), line([2, 0], [2, 6]), line([0, 3], [6, 3]),
    ]);
    expect(faces).toHaveLength(4);
    for (const a of areas(faces)) expect(a).toBeGreaterThan(0);
  });

  it('gives an ISLAND its own face and cuts its shape out of the one around it', () => {
    // A box with a second box floating inside it, touching nothing. The two
    // regions are the inner box and the RING — not the inner box and the
    // outer box, which is the same ground claimed twice.
    const faces = sliceIntoFaces([...rect(0, 0, 10, 10), ...rect(2, 2, 3, 3)]);
    expect(faces).toHaveLength(2);
    expect(total(faces)).toBeCloseTo(100, 9);
    const ring = faces.find((f) => computeSignedArea(f) > 50)!;
    expect(computeSignedArea(ring)).toBeCloseTo(91, 9);
    // The ring is two loops — its own outline and the island's, counter-wound,
    // which is how the renderer spells a hole.
    expect(closedSegmentLoops(ring)).toHaveLength(2);
    // …and the hole really is a hole: a point in the island is not in the ring.
    expect(pointInClosedPath(ring, 3.5, 3.5)).toBe(false);
    expect(pointInClosedPath(ring, 1, 1)).toBe(true);
  });

  it('nests islands inside islands', () => {
    const faces = sliceIntoFaces([
      ...rect(0, 0, 10, 10), ...rect(2, 2, 6, 6), ...rect(3, 3, 2, 2),
    ]);
    expect(total(faces)).toBeCloseTo(100, 9);
    expect(areas(faces).sort((a, b) => a - b)).toEqual([4, 32, 64]);
  });

  it('PRUNES a stroke with a loose end — it bounds nothing', () => {
    // A whisker poking into the box from one side, and a second whisker off
    // the first: neither separates anything, and taking the first away is
    // what leaves the second loose, so one pass over the ends is not enough.
    const faces = sliceIntoFaces([
      ...rect(0, 0, 4, 4), line([0, 2], [2, 2]), line([2, 2], [2, 3]),
    ]);
    expect(faces).toHaveLength(1);
    expect(computeSignedArea(faces[0])).toBeCloseTo(16, 9);
    // The box's own outline, still split where the whisker met it — the
    // pruning takes the whisker away, not the vertex it landed on.
    expect(faces[0]).toHaveLength(5);
    for (const seg of faces[0]) {
      expect(Math.min(seg.start[0], seg.end[0])).toBeLessThanOrEqual(4);
      expect(seg.start[0] === 0 || seg.start[0] === 4 || seg.start[1] === 0 || seg.start[1] === 4)
        .toBe(true);
    }
  });

  it('keeps a stroke that runs from the box to an island — as a slit', () => {
    // Both ends are ON something, so it is not a hair. It separates nothing
    // either, so the region around the island stays ONE region whose
    // boundary runs in along the stroke and back out.
    const faces = sliceIntoFaces([
      ...rect(0, 0, 10, 10), ...rect(2, 2, 3, 3), line([0, 3], [2, 3]),
    ]);
    expect(faces).toHaveLength(2);
    expect(total(faces)).toBeCloseTo(100, 9);
    const ring = faces.find((f) => computeSignedArea(f) > 50)!;
    // Walked down and back: the stroke appears twice on the boundary and
    // adds no area.
    expect(computeSignedArea(ring)).toBeCloseTo(91, 9);
    expect(ring.filter((s) => Math.abs(s.start[1] - 3) < 1e-9 && Math.abs(s.end[1] - 3) < 1e-9))
      .toHaveLength(2);
  });

  it('reads the curves at the tolerance it is given', () => {
    // A line down the middle of the box, drawn in two pieces that stop a
    // thousandth short of each other. At the default (lattice) tolerance
    // that is two loose ends, both pruned, and the box is undivided; told
    // that a thousandth is nothing, the same curves cut it in two.
    const gap = 1e-3;
    const curves = [
      ...rect(0, 0, 4, 4),
      line([2, 0], [2, 2 - gap]),
      line([2, 2], [2, 4]),
    ];
    expect(areas(sliceIntoFaces(curves))).toEqual([16]);
    const joined = sliceIntoFaces(curves, 1e-2);
    expect(joined).toHaveLength(2);
    expect(total(joined)).toBeCloseTo(16, 6);
  });

  it('is nothing at all for curves that enclose nothing', () => {
    expect(sliceIntoFaces([])).toEqual([]);
    expect(sliceIntoFaces([line([0, 0], [4, 0])])).toEqual([]);
    expect(sliceIntoFaces([line([0, 0], [4, 0]), line([4, 0], [4, 4])])).toEqual([]);
  });

  it('finds the faces of several separate drawings at once', () => {
    // Two boxes side by side, neither inside the other: two faces, and the
    // outside of BOTH is dropped rather than only the outside of one.
    const faces = sliceIntoFaces([...rect(0, 0, 2, 2), ...rect(5, 0, 3, 3)]);
    expect(areas(faces).sort((a, b) => a - b)).toEqual([4, 9]);
  });
});
