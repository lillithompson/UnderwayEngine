/**
 * Parametric shape presets (shapePresets.ts). Pins the module's core
 * invariant — every preset is a CLOSED loop with shared point values
 * between adjacent segments — plus bbox containment, option clamping,
 * and SVGObject assembly.
 */

import {
  buildShapePreset,
  buildShapeSVGObject,
  ShapePresetKind,
  ShapePresetOptions,
} from '../shapePresets';
import { PathSegment } from '../types';

const KINDS: ShapePresetKind[] = [
  'rect', 'roundedRect', 'ellipse', 'star', 'banner', 'speechBubble', 'comicFrame',
];

const EPS = 1e-9;

/** Every segment's end must equal the next segment's start; the last
 *  wraps to the first. */
function expectClosedLoop(segments: PathSegment[]): void {
  expect(segments.length).toBeGreaterThanOrEqual(3);
  for (let i = 0; i < segments.length; i++) {
    const next = segments[(i + 1) % segments.length];
    expect(Math.abs(segments[i].end[0] - next.start[0])).toBeLessThanOrEqual(EPS);
    expect(Math.abs(segments[i].end[1] - next.start[1])).toBeLessThanOrEqual(EPS);
  }
}

/** All segment endpoints (and arc centers) inside the bbox. */
function expectWithinBbox(
  segments: PathSegment[],
  bbox: { cellX: number; cellY: number; cellWidth: number; cellHeight: number },
): void {
  const x0 = bbox.cellX - EPS;
  const y0 = bbox.cellY - EPS;
  const x1 = bbox.cellX + bbox.cellWidth + EPS;
  const y1 = bbox.cellY + bbox.cellHeight + EPS;
  for (const seg of segments) {
    const pts: [number, number][] = [seg.start, seg.end];
    if (seg.kind === 'arc') pts.push(seg.center);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(x0);
      expect(x).toBeLessThanOrEqual(x1);
      expect(y).toBeGreaterThanOrEqual(y0);
      expect(y).toBeLessThanOrEqual(y1);
    }
  }
}

const NON_SQUARE = { cellX: 2, cellY: 3, cellWidth: 8, cellHeight: 6 };
const SQUARE = { cellX: -4, cellY: 1.5, cellWidth: 5, cellHeight: 5 };

describe.each(KINDS)('preset %s', (kind) => {
  test.each([
    ['non-square bbox', NON_SQUARE],
    ['square bbox', SQUARE],
  ])('forms a closed loop and stays within the %s', (_label, bbox) => {
    const { segments, closed } = buildShapePreset(kind, bbox);
    expect(closed).toBe(true);
    expectClosedLoop(segments);
    expectWithinBbox(segments, bbox);
  });

  test.each([
    [{ radius: 100, points: 9, innerRatio: 0.2, notchDepth: 100, tailCorner: 'bottomRight' } as ShapePresetOptions],
    [{ radius: 0, points: 3, innerRatio: 0.9, notchDepth: 0, tailCorner: 'bottomLeft' } as ShapePresetOptions],
  ])('stays closed and in-bbox under extreme options %#', (options) => {
    const { segments } = buildShapePreset(kind, NON_SQUARE, options);
    expectClosedLoop(segments);
    expectWithinBbox(segments, NON_SQUARE);
  });
});

describe('rect / comicFrame', () => {
  test('rect spans the bbox exactly with 4 line segments', () => {
    const { segments } = buildShapePreset('rect', NON_SQUARE);
    expect(segments).toHaveLength(4);
    expect(segments.every((s) => s.kind === 'line')).toBe(true);
    const xs = segments.flatMap((s) => [s.start[0], s.end[0]]);
    const ys = segments.flatMap((s) => [s.start[1], s.end[1]]);
    expect(Math.min(...xs)).toBe(2);
    expect(Math.max(...xs)).toBe(10);
    expect(Math.min(...ys)).toBe(3);
    expect(Math.max(...ys)).toBe(9);
  });

  test('comicFrame is geometrically identical to rect', () => {
    expect(buildShapePreset('comicFrame', NON_SQUARE).segments)
      .toEqual(buildShapePreset('rect', NON_SQUARE).segments);
  });
});

describe('roundedRect', () => {
  test('has 4 corner arcs inset by the requested radius', () => {
    const { segments } = buildShapePreset('roundedRect', NON_SQUARE, { radius: 1 });
    const arcs = segments.filter((s) => s.kind === 'arc');
    expect(arcs).toHaveLength(4);
    // All arc centers sit 1 cell inside the bbox corners.
    const centers = arcs.map((a) => (a as Extract<PathSegment, { kind: 'arc' }>).center);
    expect(centers).toEqual(expect.arrayContaining([
      [3, 4], [9, 4], [9, 8], [3, 8],
    ]));
  });

  test('clamps radius to half the short side', () => {
    // bbox 8x6: short side 6 → r clamps to 3 even when 100 is requested.
    const clamped = buildShapePreset('roundedRect', NON_SQUARE, { radius: 100 });
    const explicit = buildShapePreset('roundedRect', NON_SQUARE, { radius: 3 });
    expect(clamped.segments).toEqual(explicit.segments);
    expectWithinBbox(clamped.segments, NON_SQUARE);
  });

  test('negative radius clamps to a sharp rect', () => {
    const { segments } = buildShapePreset('roundedRect', NON_SQUARE, { radius: -5 });
    expect(segments.every((s) => s.kind === 'line')).toBe(true);
    expect(segments).toHaveLength(4);
  });

  test('default radius is a quarter of the short side', () => {
    expect(buildShapePreset('roundedRect', NON_SQUARE).segments)
      .toEqual(buildShapePreset('roundedRect', NON_SQUARE, { radius: 1.5 }).segments);
  });
});

describe('ellipse', () => {
  test('square bbox yields an exact circle of 4 quarter arcs', () => {
    const { segments } = buildShapePreset('ellipse', SQUARE);
    expect(segments).toHaveLength(4);
    expect(segments.every((s) => s.kind === 'arc')).toBe(true);
  });

  test('non-square bbox falls back to a polyline whose AABB matches the bbox', () => {
    const { segments } = buildShapePreset('ellipse', NON_SQUARE);
    expect(segments.every((s) => s.kind === 'line')).toBe(true);
    const xs = segments.map((s) => s.start[0]);
    const ys = segments.map((s) => s.start[1]);
    expect(Math.min(...xs)).toBeCloseTo(2, 9);
    expect(Math.max(...xs)).toBeCloseTo(10, 9);
    expect(Math.min(...ys)).toBeCloseTo(3, 9);
    expect(Math.max(...ys)).toBeCloseTo(9, 9);
  });
});

describe('star', () => {
  test('respects the points option: 2 segments per point', () => {
    expect(buildShapePreset('star', NON_SQUARE, { points: 5 }).segments).toHaveLength(10);
    expect(buildShapePreset('star', NON_SQUARE, { points: 7 }).segments).toHaveLength(14);
    expect(buildShapePreset('star', NON_SQUARE, { points: 3 }).segments).toHaveLength(6);
  });

  test('default is 5 points', () => {
    expect(buildShapePreset('star', NON_SQUARE).segments).toHaveLength(10);
  });

  test('point counts below 3 clamp to 3', () => {
    expect(buildShapePreset('star', NON_SQUARE, { points: 2 }).segments).toHaveLength(6);
  });

  test('exactly fills the bbox AABB regardless of point count', () => {
    for (const points of [3, 5, 8]) {
      const { segments } = buildShapePreset('star', NON_SQUARE, { points });
      const xs = segments.map((s) => s.start[0]);
      const ys = segments.map((s) => s.start[1]);
      expect(Math.min(...xs)).toBeCloseTo(2, 9);
      expect(Math.max(...xs)).toBeCloseTo(10, 9);
      expect(Math.min(...ys)).toBeCloseTo(3, 9);
      expect(Math.max(...ys)).toBeCloseTo(9, 9);
    }
  });
});

describe('banner', () => {
  test('notch depth clamps to half the width', () => {
    const clamped = buildShapePreset('banner', NON_SQUARE, { notchDepth: 100 });
    const explicit = buildShapePreset('banner', NON_SQUARE, { notchDepth: 4 });
    expect(clamped.segments).toEqual(explicit.segments);
  });

  test('chevron notch vertices sit at mid-height, inset by the depth', () => {
    const { segments } = buildShapePreset('banner', NON_SQUARE, { notchDepth: 2 });
    const points = segments.map((s) => s.start);
    // bbox x [2,10], y [3,9] → notches at (8, 6) and (4, 6).
    expect(points).toEqual(expect.arrayContaining([[8, 6], [4, 6]]));
  });
});

describe('speechBubble', () => {
  test('tail reaches the bbox bottom on the requested corner side', () => {
    const midX = NON_SQUARE.cellX + NON_SQUARE.cellWidth / 2;
    const bottom = NON_SQUARE.cellY + NON_SQUARE.cellHeight;
    for (const tailCorner of ['bottomLeft', 'bottomRight'] as const) {
      const { segments } = buildShapePreset('speechBubble', NON_SQUARE, { tailCorner });
      const tips = segments
        .flatMap((s) => [s.start, s.end])
        .filter(([, y]) => Math.abs(y - bottom) <= EPS);
      expect(tips.length).toBeGreaterThan(0);
      for (const [x] of tips) {
        if (tailCorner === 'bottomLeft') expect(x).toBeLessThan(midX);
        else expect(x).toBeGreaterThan(midX);
      }
    }
  });
});

describe('buildShapeSVGObject', () => {
  const color = { r: 10, g: 20, b: 30 };

  test('assembles a complete SVGObject with the given id, color, and bbox', () => {
    const obj = buildShapeSVGObject('svg_shape1', 'star', NON_SQUARE, color);
    expect(obj.id).toBe('svg_shape1');
    expect(obj.color).toEqual(color);
    expect(obj.cellX).toBe(NON_SQUARE.cellX);
    expect(obj.cellY).toBe(NON_SQUARE.cellY);
    expect(obj.cellWidth).toBe(NON_SQUARE.cellWidth);
    expect(obj.cellHeight).toBe(NON_SQUARE.cellHeight);
    expect(obj.segments).toEqual(buildShapePreset('star', NON_SQUARE).segments);
    expect(obj.shapeKind).toBeUndefined();
    expect(obj.fillColor).toBeUndefined();
    expect(obj.fillPaint).toBeUndefined();
  });

  test('rect and comicFrame get the rectangle shapeKind', () => {
    expect(buildShapeSVGObject('svg_r', 'rect', NON_SQUARE, color).shapeKind).toBe('rectangle');
    expect(buildShapeSVGObject('svg_c', 'comicFrame', NON_SQUARE, color).shapeKind).toBe('rectangle');
    expect(buildShapeSVGObject('svg_e', 'ellipse', NON_SQUARE, color).shapeKind).toBeUndefined();
  });

  test('fillColor and fillPaint options are carried through', () => {
    const fillColor = { r: 200, g: 100, b: 50 };
    const fillPaint = {
      kind: 'linear' as const,
      stops: [
        { offset: 0, color: { r: 0, g: 0, b: 0 } },
        { offset: 1, color: { r: 255, g: 255, b: 255 } },
      ],
      x1: 0, y1: 0, x2: 1, y2: 1,
    };
    const obj = buildShapeSVGObject('svg_f', 'roundedRect', NON_SQUARE, color, { fillColor, fillPaint });
    expect(obj.fillColor).toEqual(fillColor);
    expect(obj.fillPaint).toEqual(fillPaint);
  });

  test('preset options flow through to geometry', () => {
    const obj = buildShapeSVGObject('svg_s', 'star', NON_SQUARE, color, { points: 6 });
    expect(obj.segments).toHaveLength(12);
  });
});
