import { maskPolygonCSS } from '../compositionMaskCSS';
import { buildClosedFillPathD } from '../svgPathBuilder';
import { SVG_UNITS_PER_L0_CELL } from '../svgExport';
import { PathSegment } from '../types';

const U = SVG_UNITS_PER_L0_CELL;

function squareSegments(x: number, y: number, size: number): PathSegment[] {
  return [
    { kind: 'line', start: [x, y], end: [x + size, y] },
    { kind: 'line', start: [x + size, y], end: [x + size, y + size] },
    { kind: 'line', start: [x + size, y + size], end: [x, y + size] },
    { kind: 'line', start: [x, y + size], end: [x, y] },
  ];
}

describe('maskPolygonCSS', () => {
  test('rectangle → 4-vertex polygon scaled by SVG_UNITS_PER_L0_CELL', () => {
    const poly = maskPolygonCSS(squareSegments(0, 0, 4));
    expect(poly).toBe(
      `polygon(0px 0px, ${4 * U}px 0px, ${4 * U}px ${4 * U}px, 0px ${4 * U}px)`,
    );
  });

  test('offset rectangle scales each vertex', () => {
    const poly = maskPolygonCSS(squareSegments(2, 3, 1));
    expect(poly).toBe(
      `polygon(${2 * U}px ${3 * U}px, ${3 * U}px ${3 * U}px, ${3 * U}px ${4 * U}px, ${2 * U}px ${4 * U}px)`,
    );
  });

  test('circle (4 quarter arcs) → densely sampled polygon', () => {
    const circle: PathSegment[] = [
      { kind: 'arc', start: [2, 0], end: [4, 2], center: [2, 2] },
      { kind: 'arc', start: [4, 2], end: [2, 4], center: [2, 2] },
      { kind: 'arc', start: [2, 4], end: [0, 2], center: [2, 2] },
      { kind: 'arc', start: [0, 2], end: [2, 0], center: [2, 2] },
    ];
    const poly = maskPolygonCSS(circle);
    expect(poly).not.toBeNull();
    // Dense flatten = 24 samples/arc × 4 arcs = 96 vertices.
    const vertCount = (poly!.match(/px /g) || []).length;
    expect(vertCount).toBe(96);
  });

  test('two disjoint loops → clip-path: path() covering BOTH (regression)', () => {
    // A geometric union of non-overlapping shapes is multi-loop; polygon()
    // can only express one ring, which clipped the pattern/color to a single
    // shape. path() carries both subpaths so each region is filled.
    const two = [...squareSegments(0, 0, 4), ...squareSegments(10, 0, 4)];
    const clip = maskPolygonCSS(two);
    expect(clip).not.toBeNull();
    expect(clip!.startsWith('path(')).toBe(true);
    expect(clip).toContain('nonzero');
    // Two subpaths → two move commands, both regions present.
    expect((clip!.match(/M/g) || []).length).toBe(2);
    expect(clip).toContain(buildClosedFillPathD(two));
  });

  test('open path → null (no clip applied)', () => {
    const open: PathSegment[] = [
      { kind: 'line', start: [0, 0], end: [4, 0] },
      { kind: 'line', start: [4, 0], end: [4, 4] },
    ];
    expect(maskPolygonCSS(open)).toBeNull();
  });

  test('empty segments → null', () => {
    expect(maskPolygonCSS([])).toBeNull();
  });

  test('straight-edge mask: polygon vertices match buildClosedFillPathD ×256', () => {
    // Guards against the SVG and CSS clip paths forking on straight masks.
    const segs = squareSegments(1, 1, 5);
    const poly = maskPolygonCSS(segs)!;
    const cssVerts = poly
      .slice('polygon('.length, -1)
      .split(', ')
      .map((pt) => pt.split(' ').map((n) => parseFloat(n)));
    // buildClosedFillPathD emits "M x,y L x,y … Z" in SVG units already.
    const d = buildClosedFillPathD(segs);
    const svgVerts = [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)]
      .map((m) => [parseFloat(m[1]), parseFloat(m[2])]);
    // The SVG path explicitly closes back to the first vertex; the polygon
    // omits that duplicate. Drop it before comparing the unique vertices.
    if (svgVerts.length === cssVerts.length + 1) {
      expect(svgVerts[svgVerts.length - 1]).toEqual(svgVerts[0]);
      svgVerts.pop();
    }
    expect(cssVerts).toEqual(svgVerts);
  });
});
