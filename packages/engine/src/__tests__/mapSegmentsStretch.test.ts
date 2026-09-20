import { mapSegments } from '../sceneGraph';
import { computeCircleSegments, flattenArcs, ELLIPSE_POLYLINE_SEGMENTS } from '../compositionArcMath';
import { LOCAL_IDENTITY, Mat2D, localMatrix } from '../sceneTransform';
import { PathSegment } from '../types';

// An arc is (start, end, center) with ONE radius inferred from them, and it
// renders as `A r,r`. A map that is not a similarity — the per-axis scale a
// stretched GROUP or MULTI-SELECTION puts on its members' matrices — moves
// those three points independently, and the radius stops agreeing with its
// own endpoints: the renderer stretches each quarter to reach and a circle
// comes out kinked rather than oval. `mapSegments` is the one door every
// such map goes through, so that is where the arcs are shed.

const circle = () => computeCircleSegments(-4, -4, 4, 4);

/** The invariant `A r,r` lives by. */
function arcsIntact(segs: readonly PathSegment[]): boolean {
  return segs.every((seg) => {
    if (seg.kind !== 'arc') return true;
    const rs = Math.hypot(seg.start[0] - seg.center[0], seg.start[1] - seg.center[1]);
    const re = Math.hypot(seg.end[0] - seg.center[0], seg.end[1] - seg.center[1]);
    return Math.abs(rs - re) <= rs * 1e-9;
  });
}

const stretch = (sx: number, sy: number): Mat2D => ({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });

describe('flattenArcs', () => {
  test('hands a chain with no arc straight back — same array, no allocation', () => {
    const lines: PathSegment[] = [
      { kind: 'line', start: [0, 0], end: [1, 0] },
      { kind: 'line', start: [1, 0], end: [1, 1] },
    ];
    expect(flattenArcs(lines)).toBe(lines);
  });

  test('sheds a circle into the polyline of the circle it already is', () => {
    const flat = flattenArcs(circle());
    expect(flat).toHaveLength(ELLIPSE_POLYLINE_SEGMENTS);
    expect(flat.every((s) => s.kind === 'line')).toBe(true);
    // Sampled uniformly in angle on the circle it IS, so nothing moved.
    for (const seg of flat) expect(Math.hypot(seg.start[0], seg.start[1])).toBeCloseTo(4, 9);
  });
});

describe('mapSegments under a matrix that is NOT a similarity', () => {
  test('a stretched circle becomes a true ellipse', () => {
    const out = mapSegments(circle(), stretch(3, 1));
    expect(out.every((s) => s.kind === 'line')).toBe(true);
    for (const seg of out) {
      const [x, y] = seg.start;
      expect((x / 12) ** 2 + (y / 4) ** 2).toBeCloseTo(1, 9);
    }
  });

  test('mapping the arcs directly is what it is avoiding', () => {
    // The old behaviour, spelled out: the vertices land on the right ellipse
    // and the arcs are broken all the same — which is why a vertex-only
    // check could never have caught this.
    const naive = circle().map((seg) => seg.kind === 'arc' ? {
      kind: 'arc' as const,
      start: [seg.start[0] * 3, seg.start[1]] as [number, number],
      end: [seg.end[0] * 3, seg.end[1]] as [number, number],
      center: [seg.center[0] * 3, seg.center[1]] as [number, number],
    } : seg);
    expect(arcsIntact(naive)).toBe(false);
    expect(arcsIntact(mapSegments(circle(), stretch(3, 1)))).toBe(true);
  });

  test('a shear sheds the arcs too', () => {
    expect(mapSegments(circle(), { a: 1, b: 0, c: 0.4, d: 1, e: 0, f: 0 })
      .every((s) => s.kind === 'line')).toBe(true);
  });
});

describe('mapSegments under a similarity keeps its arcs exact', () => {
  test.each([
    ['identity', { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } as Mat2D],
    ['translate', { a: 1, b: 0, c: 0, d: 1, e: 7, f: -3 } as Mat2D],
    ['uniform scale', stretch(2.5, 2.5)],
    ['turn', localMatrix({ ...LOCAL_IDENTITY, rotationDeg: 37 })],
    ['mirror', { a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 } as Mat2D],
  ])('%s', (_name, m) => {
    const out = mapSegments(circle(), m);
    expect(out).toHaveLength(4);
    expect(out.every((s) => s.kind === 'arc')).toBe(true);
    expect(arcsIntact(out)).toBe(true);
  });

  test('float noise in an "exactly uniform" scale still reads as uniform', () => {
    const out = mapSegments(circle(), stretch(2, 2 * (1 + Number.EPSILON)));
    expect(out.every((s) => s.kind === 'arc')).toBe(true);
  });
});
