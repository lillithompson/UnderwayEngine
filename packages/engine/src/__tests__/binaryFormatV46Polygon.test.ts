/**
 * Tests for the v46 binary format extension: `shapeKind === 'polygon'`
 * presence flag (flags4 bit 0x10), plus the regular-polygon segment builder
 * the polygon tool commits and the subtype classification that hangs off the
 * persisted tag. Mirrors binaryFormatV21Rectangle.test.ts for the rectangle
 * flag.
 */

import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { computeRegularPolygonSegments } from '../compositionLineBboxMath';
import { isClosedPath } from '../compositionArcMath';
import { svgSubtype } from '../svgStroke';
import { SVGObject, PathSegment } from '../types';

function makeBundle(svgObjects: SVGObject[]): CompositionBundle {
  return {
    name: 'Test', gridLevel: 1, strokeScale: 8, gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [],
    svgObjects,
    sceneOrder: svgObjects.map(s => s.id),
  };
}

function makeSVG(id: string, segments: PathSegment[], extras: Partial<SVGObject> = {}): SVGObject {
  return {
    id,
    segments,
    color: { r: 255, g: 160, b: 50 },
    cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8,
    ...extras,
  };
}

describe('computeRegularPolygonSegments', () => {
  test('produces a closed chain of `sides` line segments', () => {
    for (const sides of [3, 5, 6, 12, 20]) {
      const segs = computeRegularPolygonSegments(0, 0, 8, 8, sides);
      expect(segs).toHaveLength(sides);
      expect(segs.every(s => s.kind === 'line')).toBe(true);
      // Consecutive endpoints are bit-for-bit equal (each vertex computed once).
      for (let i = 0; i < segs.length; i++) {
        const next = segs[(i + 1) % segs.length];
        expect(segs[i].end).toEqual(next.start);
      }
    }
  });

  test('is regular: every vertex on one circle, every side the same length', () => {
    const segs = computeRegularPolygonSegments(2, 2, 10, 10, 7);
    const r = 4; // half the 8-cell box
    const side = segs[0];
    const sideLen = Math.hypot(side.end[0] - side.start[0], side.end[1] - side.start[1]);
    for (const s of segs) {
      expect(Math.hypot(s.start[0] - 6, s.start[1] - 6)).toBeCloseTo(r, 10);
      expect(Math.hypot(s.end[0] - s.start[0], s.end[1] - s.start[1])).toBeCloseTo(sideLen, 10);
    }
  });

  test('puts the first vertex at 12 o\'clock and winds clockwise (y-down)', () => {
    const segs = computeRegularPolygonSegments(0, 0, 8, 8, 4);
    expect(segs[0].start[0]).toBeCloseTo(4, 10); // center x
    expect(segs[0].start[1]).toBeCloseTo(0, 10); // top of the box
    // Clockwise in screen coords: the second vertex sits to the RIGHT.
    expect(segs[0].end[0]).toBeGreaterThan(4);
  });

  test('handles corners given in any order and clamps a sub-3 side count', () => {
    const a = computeRegularPolygonSegments(8, 8, 0, 0, 5);
    const b = computeRegularPolygonSegments(0, 0, 8, 8, 5);
    expect(a).toEqual(b);
    expect(computeRegularPolygonSegments(0, 0, 8, 8, 2)).toHaveLength(3);
  });

  test('closes under the engine\'s own path predicate', () => {
    const segs = computeRegularPolygonSegments(0, 0, 8, 8, 9);
    expect(isClosedPath(segs)).toBe(true);
  });
});

describe('svgSubtype polygon classification', () => {
  test('classifies by the persisted tag, surviving any resize of the geometry', () => {
    const segs = computeRegularPolygonSegments(0, 0, 8, 8, 5);
    // Untagged, an irregular closed polyline is a generic 'shape'…
    expect(svgSubtype({ segments: segs })).toBe('shape');
    // …the tag is what makes it a polygon.
    expect(svgSubtype({ segments: segs, shapeKind: 'polygon' })).toBe('polygon');
  });
});

describe('v46 shapeKind="polygon" persistence', () => {
  test('round-trips shapeKind="polygon" on SVGObjects', () => {
    const poly = makeSVG('svg_poly', computeRegularPolygonSegments(0, 0, 8, 8, 6), {
      shapeKind: 'polygon',
      name: 'polygon',
    });
    const plain = makeSVG('svg_plain', computeRegularPolygonSegments(0, 0, 8, 8, 6));

    const data = serializeComposition(makeBundle([poly, plain]), []);
    const { meta } = deserializeComposition(data);

    const loadedPoly = meta.svgObjects?.find(s => s.id === 'svg_poly');
    const loadedPlain = meta.svgObjects?.find(s => s.id === 'svg_plain');
    expect(loadedPoly?.shapeKind).toBe('polygon');
    expect(loadedPoly?.name).toBe('polygon');
    expect(loadedPlain?.shapeKind).toBeUndefined();
  });

  test('polygon tag coexists with fill and the flags4 opacity payload', () => {
    const poly = makeSVG('svg_poly', computeRegularPolygonSegments(0, 0, 8, 8, 8), {
      shapeKind: 'polygon',
      fillColor: { r: 10, g: 20, b: 30 },
      fillOpacity: 0.5,
      opacity: 0.75,
      edgeSoften: 0.25,
    });
    const data = serializeComposition(makeBundle([poly]), []);
    const { meta } = deserializeComposition(data);
    const loaded = meta.svgObjects?.[0];
    expect(loaded?.shapeKind).toBe('polygon');
    expect(loaded?.fillColor).toEqual({ r: 10, g: 20, b: 30 });
    expect(loaded?.fillOpacity).toBeCloseTo(0.5, 2);
    expect(loaded?.opacity).toBeCloseTo(0.75, 2);
    expect(loaded?.edgeSoften).toBeCloseTo(0.25, 2);
  });

  test('rectangle and polygon tags do not cross wires', () => {
    const rect = makeSVG('svg_rect', [
      { kind: 'line', start: [0, 0], end: [4, 0] },
      { kind: 'line', start: [4, 0], end: [4, 3] },
      { kind: 'line', start: [4, 3], end: [0, 3] },
      { kind: 'line', start: [0, 3], end: [0, 0] },
    ], { shapeKind: 'rectangle', cellWidth: 4, cellHeight: 3 });
    const poly = makeSVG('svg_poly', computeRegularPolygonSegments(0, 0, 8, 8, 3), {
      shapeKind: 'polygon',
    });
    const data = serializeComposition(makeBundle([rect, poly]), []);
    const { meta } = deserializeComposition(data);
    expect(meta.svgObjects?.find(s => s.id === 'svg_rect')?.shapeKind).toBe('rectangle');
    expect(meta.svgObjects?.find(s => s.id === 'svg_poly')?.shapeKind).toBe('polygon');
  });
});
