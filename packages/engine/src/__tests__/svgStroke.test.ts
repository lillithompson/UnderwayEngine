/**
 * The per-object SVG stroke: subtype classification (which option menu a
 * vector object gets), the effective width, and the corner-rounding geometry
 * and alignment rules behind the Stroke bar's Radius and Position rows.
 */

import {
  DOM_PX_PER_CELL,
  roundPathCorners,
  STROKE_SCALE_CELLS,
  strokeScaleForUnits,
  svgStrokeCanAlign,
  svgStrokeAlignment,
  svgStrokeRadiusCells,
  svgStrokeWidthCells,
  svgStrokeWidthUnits,
  svgSubtype,
} from '../svgStroke';
import { SVG_STROKE_WIDTH, SVG_UNITS_PER_L0_CELL } from '../svgExport';
import { arcRadius } from '../compositionArcMath';
import { PathSegment, SVGObject } from '../types';

const line = (start: [number, number], end: [number, number]): PathSegment =>
  ({ kind: 'line', start, end });
const arc = (
  start: [number, number], end: [number, number], center: [number, number],
): PathSegment => ({ kind: 'arc', start, end, center });

const rect = (w = 4, h = 3): PathSegment[] => [
  line([0, 0], [w, 0]),
  line([w, 0], [w, h]),
  line([w, h], [0, h]),
  line([0, h], [0, 0]),
];

/** A closed circle as the arc tool builds one: four quarter arcs about a
 *  shared centre. */
const circle = (cx = 2, cy = 2, r = 2): PathSegment[] => [
  arc([cx - r, cy], [cx, cy - r], [cx, cy]),
  arc([cx, cy - r], [cx + r, cy], [cx, cy]),
  arc([cx + r, cy], [cx, cy + r], [cx, cy]),
  arc([cx, cy + r], [cx - r, cy], [cx, cy]),
];

const obj = (segments: PathSegment[], extras: Partial<SVGObject> = {}): SVGObject => ({
  id: 'svg_1',
  segments,
  color: { r: 0, g: 0, b: 0 },
  cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 3,
  ...extras,
});

describe('svgSubtype', () => {
  it('classifies a single straight segment as a line', () => {
    expect(svgSubtype(obj([line([0, 0], [3, 4])]))).toBe('line');
  });

  it('classifies a single curved segment as an arc', () => {
    expect(svgSubtype(obj([arc([0, 2], [2, 0], [2, 2])]))).toBe('arc');
  });

  it('classifies an axis-aligned closed box as a rectangle', () => {
    expect(svgSubtype(obj(rect()))).toBe('rectangle');
  });

  it('honours the persisted shapeKind over the geometric sniff', () => {
    // A rectangle that has been freely rotated is no longer axis-aligned, but
    // it is still a rectangle and must keep the rectangle menu.
    const rotated = [
      line([0, 0], [3, 1]),
      line([3, 1], [2, 4]),
      line([2, 4], [-1, 3]),
      line([-1, 3], [0, 0]),
    ];
    expect(svgSubtype(obj(rotated))).toBe('shape');
    expect(svgSubtype(obj(rotated, { shapeKind: 'rectangle' }))).toBe('rectangle');
  });

  it('classifies an all-arc closed path as a circle', () => {
    expect(svgSubtype(obj(circle()))).toBe('circle');
  });

  it('classifies any other closed path as a shape', () => {
    const triangle = [line([0, 0], [4, 0]), line([4, 0], [2, 3]), line([2, 3], [0, 0])];
    expect(svgSubtype(obj(triangle))).toBe('shape');
  });

  it('classifies an open multi-segment polyline as a freehand stroke', () => {
    const polyline = [line([0, 0], [1, 1]), line([1, 1], [2, 0]), line([2, 0], [3, 2])];
    expect(svgSubtype(obj(polyline))).toBe('stroke');
  });

  it('does not depend on the name — a rename must not change the menu', () => {
    const before = svgSubtype(obj(rect(), { name: 'rectangle' }));
    const after = svgSubtype(obj(rect(), { name: 'my favourite box' }));
    expect(after).toBe(before);
  });
});

describe('svgStrokeWidthUnits', () => {
  it('falls back to the composition-wide stroke for an untouched object', () => {
    expect(svgStrokeWidthUnits(obj(rect()), 0.2, 16)).toBeCloseTo(SVG_STROKE_WIDTH * 0.2);
  });

  it('converts an authored width from world cells into the caller unit', () => {
    expect(svgStrokeWidthUnits(obj(rect(), { stroke: { width: 0.375 } }), 0.2, 16)).toBeCloseTo(6);
  });

  it('reports the fallback width in cells so the slider opens under the line', () => {
    // 5 × 0.2 = 1 base px, and one cell spans 16 of them.
    expect(svgStrokeWidthCells(obj(rect()), 0.2, 16)).toBeCloseTo(1 / 16);
  });

  it('clamps a negative authored width to zero', () => {
    expect(svgStrokeWidthUnits(obj(rect(), { stroke: { width: -3 } }), 0.2, 16)).toBe(0);
  });
});

describe('strokeScaleForUnits', () => {
  // The fallback width above is a raw number that ignores `unitsPerCell`, so a
  // caller drawing in anything but the DOM layer's base pixel has to convert or
  // it renders the same object at a different WORLD width than the canvas.
  // Getting this wrong is what made exported drawings 12.5× fatter than the
  // page they were drawn on.
  const cells = (strokeScale: number, unitsPerCell: number) =>
    svgStrokeWidthUnits(obj(rect()), strokeScaleForUnits(strokeScale, unitsPerCell), unitsPerCell)
    / unitsPerCell;

  it('lands the fallback at the same world width in every unit', () => {
    for (const unitsPerCell of [DOM_PX_PER_CELL, SVG_UNITS_PER_L0_CELL, 1, 1000]) {
      expect(cells(0.2, unitsPerCell)).toBeCloseTo(0.2 * STROKE_SCALE_CELLS, 9);
    }
  });

  it('is the identity for the DOM node layer, whose unit it is defined in', () => {
    expect(strokeScaleForUnits(0.2, DOM_PX_PER_CELL)).toBeCloseTo(0.2, 9);
  });

  it('puts a strokeScale of 1.0 at 5/16 of a cell', () => {
    // A journal page holds strokeScale 1.0, so this is the width every
    // Reimagine line is drawn and exported at.
    expect(STROKE_SCALE_CELLS).toBeCloseTo(0.3125, 9);
    expect(cells(1.0, SVG_UNITS_PER_L0_CELL)).toBeCloseTo(0.3125, 9);
  });
});

describe('svgStrokeRadiusCells', () => {
  it('is zero when unset', () => {
    expect(svgStrokeRadiusCells(obj(rect()))).toBe(0);
  });

  it('reads as a fraction of the SHORTER bbox side', () => {
    // cellWidth 4, cellHeight 3 → shorter side 3; 0.25 × 3 = 0.75 cells.
    expect(svgStrokeRadiusCells(obj(rect(), { stroke: { radius: 0.25 } }))).toBeCloseTo(0.75);
  });

  it('clamps the fraction at 0.5', () => {
    expect(svgStrokeRadiusCells(obj(rect(), { stroke: { radius: 3 } }))).toBeCloseTo(1.5);
  });
});

describe('svgStrokeCanAlign / svgStrokeAlignment', () => {
  it('a closed path can align', () => {
    expect(svgStrokeCanAlign(obj(rect()))).toBe(true);
    expect(svgStrokeCanAlign(obj(circle()))).toBe(true);
  });

  it('an open path cannot — a line has no inside', () => {
    expect(svgStrokeCanAlign(obj([line([0, 0], [3, 4])]))).toBe(false);
    const polyline = [line([0, 0], [1, 1]), line([1, 1], [2, 0])];
    expect(svgStrokeCanAlign(obj(polyline))).toBe(false);
  });

  it('reports an open path as centered however it was stored', () => {
    const openInside = obj([line([0, 0], [3, 4])], { stroke: { position: 'inside' } });
    expect(svgStrokeAlignment(openInside)).toBe('center');
  });

  it('reports a closed path at its stored alignment', () => {
    expect(svgStrokeAlignment(obj(rect(), { stroke: { position: 'outside' } }))).toBe('outside');
    expect(svgStrokeAlignment(obj(rect()))).toBe('center');
  });
});

describe('roundPathCorners', () => {
  it('is a no-op at radius zero', () => {
    expect(roundPathCorners(rect(), 0)).toEqual(rect());
  });

  it('rounds all four corners of a closed rectangle', () => {
    const out = roundPathCorners(rect(4, 3), 0.5);
    // Four lines + one arc spliced at each of the four corners.
    expect(out).toHaveLength(8);
    expect(out.filter((s) => s.kind === 'arc')).toHaveLength(4);
    expect(out.filter((s) => s.kind === 'line')).toHaveLength(4);
  });

  it('leaves the path continuous — every segment starts where the last ended', () => {
    const out = roundPathCorners(rect(4, 3), 0.5);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].start[0]).toBeCloseTo(out[i - 1].end[0]);
      expect(out[i].start[1]).toBeCloseTo(out[i - 1].end[1]);
    }
    // …and still closes back on itself.
    expect(out[0].start[0]).toBeCloseTo(out[out.length - 1].end[0]);
    expect(out[0].start[1]).toBeCloseTo(out[out.length - 1].end[1]);
  });

  it('emits arcs of exactly the requested radius on a right-angled corner', () => {
    const out = roundPathCorners(rect(4, 3), 0.5);
    for (const seg of out) {
      if (seg.kind === 'arc') expect(arcRadius(seg)).toBeCloseTo(0.5);
    }
  });

  it('trims each edge by the tangent length, which is the radius at 90°', () => {
    // The first edge runs (0,0)→(4,0); with 90° corners the tangent length
    // equals the radius, so it should now run (0.5,0)→(3.5,0).
    const out = roundPathCorners(rect(4, 3), 0.5);
    const first = out.find((s) => s.kind === 'line')!;
    expect(first.start[0]).toBeCloseTo(0.5);
    expect(first.end[0]).toBeCloseTo(3.5);
  });

  it('does not round the loose ends of an open path', () => {
    const polyline = [line([0, 0], [2, 0]), line([2, 0], [2, 2])];
    const out = roundPathCorners(polyline, 0.5);
    // One interior corner → one arc; the two free endpoints are untouched.
    expect(out.filter((s) => s.kind === 'arc')).toHaveLength(1);
    expect(out[0].start).toEqual([0, 0]);
    expect(out[out.length - 1].end).toEqual([2, 2]);
  });

  it('clamps the radius so two corners cannot consume the same edge', () => {
    // A 1×1 box asked for a radius far larger than it can take: the result
    // must still be continuous and stay inside the original span.
    const out = roundPathCorners(rect(1, 1), 10);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].start[0]).toBeCloseTo(out[i - 1].end[0]);
      expect(out[i].start[1]).toBeCloseTo(out[i - 1].end[1]);
    }
    for (const seg of out) {
      expect(seg.start[0]).toBeGreaterThanOrEqual(-1e-6);
      expect(seg.start[0]).toBeLessThanOrEqual(1 + 1e-6);
      expect(seg.start[1]).toBeGreaterThanOrEqual(-1e-6);
      expect(seg.start[1]).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it('leaves joins that already involve an arc alone', () => {
    const out = roundPathCorners(circle(), 0.5);
    expect(out).toEqual(circle());
  });

  it('skips collinear joins — there is no corner to round', () => {
    const straight = [line([0, 0], [1, 0]), line([1, 0], [2, 0])];
    expect(roundPathCorners(straight, 0.5)).toEqual(straight);
  });

  it('never mutates the input segments', () => {
    const input = rect(4, 3);
    const snapshot = JSON.parse(JSON.stringify(input));
    roundPathCorners(input, 0.5);
    expect(input).toEqual(snapshot);
  });
});
