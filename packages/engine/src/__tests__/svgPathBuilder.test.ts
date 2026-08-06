import { PathSegment, RGBColor, SVGObject } from '../types';
import { buildClosedFillPathD, withSVGObjectStrokeColor } from '../svgPathBuilder';
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

describe('withSVGObjectStrokeColor', () => {
  const WHITE: RGBColor = { r: 255, g: 255, b: 255 };
  const AUTHORED: RGBColor = { r: 40, g: 30, b: 60 };

  const shape = (over: Partial<SVGObject> = {}): SVGObject => ({
    id: 'svg_1',
    segments: rect(0, 0, 10, 10),
    color: AUTHORED,
    cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10,
    ...over,
  } as SVGObject);

  it('repaints the object’s own stroke', () => {
    expect(withSVGObjectStrokeColor(shape(), WHITE).color).toEqual(WHITE);
  });

  it('repaints stroked subpaths and leaves filled ones alone', () => {
    // A joined object carries a subpath per source color; the stroked ones are
    // lines, the filled ones are areas (figure→SVG baking makes both).
    const fillInk: RGBColor = { r: 200, g: 40, b: 40 };
    const out = withSVGObjectStrokeColor(shape({
      subpaths: [
        { segments: rect(0, 0, 4, 4), color: AUTHORED },
        { segments: rect(5, 5, 4, 4), color: fillInk, fill: true },
      ],
    }), WHITE);
    expect(out.subpaths![0].color).toEqual(WHITE);
    expect(out.subpaths![1].color).toEqual(fillInk);
  });

  it('repaints every per-copy override a pattern carries', () => {
    // Recoloring the base color alone would leave a recolored tile copy
    // painting its old ink in the middle of the white ones.
    const overrides = new Map<number, RGBColor>([[7, { r: 1, g: 2, b: 3 }], [9, { r: 4, g: 5, b: 6 }]]);
    const out = withSVGObjectStrokeColor(shape({ tileMode: 'repeat', segmentOverrides: overrides }), WHITE);
    expect([...out.segmentOverrides!.keys()].sort()).toEqual([7, 9]);
    for (const c of out.segmentOverrides!.values()) expect(c).toEqual(WHITE);
  });

  it('leaves the source object and its geometry untouched', () => {
    const src = shape({ subpaths: [{ segments: rect(0, 0, 4, 4), color: AUTHORED }] });
    const out = withSVGObjectStrokeColor(src, WHITE);
    expect(src.color).toEqual(AUTHORED);
    expect(src.subpaths![0].color).toEqual(AUTHORED);
    expect(out.segments).toBe(src.segments);
    expect(out.cellX).toBe(src.cellX);
    expect(out.cellWidth).toBe(src.cellWidth);
  });

  it('keeps the fill a filled shape paints its interior with', () => {
    const src = shape({ fillColor: { r: 10, g: 20, b: 30 }, fillOpacity: 0.5 });
    const out = withSVGObjectStrokeColor(src, WHITE);
    expect(out.fillColor).toEqual({ r: 10, g: 20, b: 30 });
    expect(out.fillOpacity).toBe(0.5);
  });
});
