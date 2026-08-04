/**
 * Tests for the v37 binary format extension: the per-subpath flags byte
 * carrying `fill` (subpath renders as filled closed loops instead of a
 * stroked path — figure→SVG pattern baking).
 */

import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { SVGObject, SVGSubpath, PathSegment } from '../types';

function line(start: [number, number], end: [number, number]): PathSegment {
  return { kind: 'line', start, end };
}

function rectLoop(x: number, y: number, w: number, h: number): PathSegment[] {
  return [
    line([x, y], [x + w, y]),
    line([x + w, y], [x + w, y + h]),
    line([x + w, y + h], [x, y + h]),
    line([x, y + h], [x, y]),
  ];
}

function makeBundle(svgObjects: SVGObject[]): CompositionBundle {
  return {
    name: 'Test', gridLevel: 1, strokeScale: 8, gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [],
    svgObjects,
    sceneOrder: svgObjects.map(s => s.id),
  };
}

describe('v37 subpath fill persistence', () => {
  it('round-trips fill and stroke subpaths, preserving the flag per subpath', () => {
    const loop = rectLoop(0, 0, 2, 2);
    const strokes = [line([2, 0], [4, 2]), line([4, 2], [2, 4])];
    const subpaths: SVGSubpath[] = [
      { color: { r: 200, g: 40, b: 40 }, segments: loop, fill: true },
      { color: { r: 255, g: 255, b: 255 }, segments: strokes },
    ];
    const svg: SVGObject = {
      id: 'svg_1',
      segments: [...loop, ...strokes],
      color: { r: 255, g: 255, b: 255 },
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
      subpaths,
    };

    const data = serializeComposition(makeBundle([svg]), []);
    const result = deserializeComposition(data);
    const out = result.meta.svgObjects![0];

    expect(out.subpaths).toHaveLength(2);
    expect(out.subpaths![0].fill).toBe(true);
    expect(out.subpaths![0].color).toEqual({ r: 200, g: 40, b: 40 });
    expect(out.subpaths![0].segments).toHaveLength(4);
    expect(out.subpaths![1].fill).toBeUndefined();
    expect(out.subpaths![1].segments).toHaveLength(2);
  });

  it('round-trips localSubpaths fill flags for grouped objects', () => {
    const loop = rectLoop(0, 0, 1, 1);
    const svg: SVGObject = {
      id: 'svg_1',
      segments: loop,
      color: { r: 10, g: 20, b: 30 },
      cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1,
      groupId: 'grp_1',
      subpaths: [{ color: { r: 10, g: 20, b: 30 }, segments: loop, fill: true }],
      localSegments: loop,
      localSubpaths: [{ color: { r: 10, g: 20, b: 30 }, segments: loop, fill: true }],
    };
    const bundle = makeBundle([svg]);
    bundle.groups = [{ id: 'grp_1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false }];

    const result = deserializeComposition(serializeComposition(bundle, []));
    const out = result.meta.svgObjects![0];
    expect(out.subpaths![0].fill).toBe(true);
    expect(out.localSubpaths![0].fill).toBe(true);
  });
});
