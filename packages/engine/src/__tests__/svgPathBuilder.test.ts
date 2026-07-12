import { PathSegment } from '../types';
import { buildClosedFillPathD } from '../svgPathBuilder';
import { computeCircleSegments } from '../compositionArcMath';
import { unionRegionContours } from '../outlineUnion';

const countSubpaths = (d: string) => (d.match(/M/g) || []).length;

function rect(x: number, y: number, w: number, h: number, ccw = false): PathSegment[] {
  const pts: [number, number][] = ccw
    ? [[x, y], [x, y + h], [x + w, y + h], [x + w, y]]
    : [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  return pts.map((p, i) => ({ kind: 'line', start: p, end: pts[(i + 1) % pts.length] }));
}

describe('buildClosedFillPathD — multi-loop fill', () => {
  it('emits one subpath for a single closed loop', () => {
    const d = buildClosedFillPathD(rect(0, 0, 10, 10));
    expect(d).not.toBe('');
    expect(countSubpaths(d)).toBe(1);
    expect(d.trimEnd().endsWith('Z')).toBe(true);
  });

  it('emits one subpath per loop for a disjoint union (regression: was empty)', () => {
    // Two non-overlapping circles → union is two separate loops.
    const a = computeCircleSegments(-10, -10, 10, 10);   // center (0,0) r10
    const b = computeCircleSegments(30, -10, 50, 10);     // center (40,0) r10
    const out = unionRegionContours([...a, ...b]);
    const d = buildClosedFillPathD(out);
    expect(d).not.toBe('');             // previously '' → no fill rendered
    expect(countSubpaths(d)).toBe(2);
  });

  it('emits outer + hole subpaths for a ring (regression: was empty)', () => {
    const outer = rect(0, 0, 20, 20);          // CW outer
    const hole = rect(6, 6, 8, 8, true);       // CCW hole
    const out = unionRegionContours([...outer, ...hole]);
    const d = buildClosedFillPathD(out);
    expect(d).not.toBe('');
    // outer loop + hole loop → two subpaths; nonzero fill-rule renders the hole.
    expect(countSubpaths(d)).toBe(2);
  });

  it('fills an overlapping-circle union as a single subpath', () => {
    const a = computeCircleSegments(-10, -10, 10, 10);   // center (0,0) r10
    const b = computeCircleSegments(0, -10, 20, 10);      // center (10,0) r10
    const out = unionRegionContours([...a, ...b]);
    const d = buildClosedFillPathD(out);
    expect(countSubpaths(d)).toBe(1);
  });

  it('returns empty for an unchainable (open) bag', () => {
    const open: PathSegment[] = [
      { kind: 'line', start: [0, 0], end: [10, 0] },
      { kind: 'line', start: [10, 0], end: [10, 10] },
    ];
    expect(buildClosedFillPathD(open)).toBe('');
  });
});
