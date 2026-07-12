/**
 * Tests for the v20 binary format extension: per-color subpaths and their
 * pre-group-transform mirror (localSubpaths). Verifies that per-segment
 * colors from drag-paint / join ops round-trip through save/load.
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
    color: { r: 255, g: 0, b: 0 },
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 0,
    ...extras,
  };
}

describe('v20 subpaths persistence', () => {
  it('round-trips an SVG with per-color subpaths', () => {
    // Mirrors the regroup output of a partial drag-paint:
    // 4 segments, first 1 in primary color, middle 2 in a paint color,
    // last 1 back to primary. Under the regroup invariant `segments`
    // carries the full flat list AND `subpaths` carries each color
    // group; the renderer reads subpaths when present.
    const red = { r: 255, g: 0, b: 0 };
    const blue = { r: 0, g: 0, b: 255 };
    const segs = [
      line([0, 0], [1, 0]),
      line([1, 0], [2, 0]),
      line([2, 0], [3, 0]),
      line([3, 0], [4, 0]),
    ];
    const subpaths: SVGSubpath[] = [
      { color: red,  segments: [segs[0]] },
      { color: blue, segments: [segs[1], segs[2]] },
      { color: red,  segments: [segs[3]] },
    ];
    const svg = makeSVG('svg_1', segs, { subpaths });

    const data = serializeComposition(makeBundle([svg]), []);
    const result = deserializeComposition(data);
    const loaded = result.meta.svgObjects?.[0];

    expect(loaded).toBeDefined();
    expect(loaded!.segments).toHaveLength(4);
    expect(loaded!.subpaths).toBeDefined();
    expect(loaded!.subpaths).toHaveLength(3);
    expect(loaded!.subpaths![0].color).toEqual(red);
    expect(loaded!.subpaths![0].segments).toHaveLength(1);
    expect(loaded!.subpaths![1].color).toEqual(blue);
    expect(loaded!.subpaths![1].segments).toHaveLength(2);
    expect(loaded!.subpaths![2].color).toEqual(red);
    expect(loaded!.subpaths![2].segments).toHaveLength(1);
  });

  it('round-trips an SVG with no subpaths (regression: writer must not emit empty subpaths block)', () => {
    const svg = makeSVG('svg_1', [line([0, 0], [1, 0])]);
    const data = serializeComposition(makeBundle([svg]), []);
    const result = deserializeComposition(data);
    const loaded = result.meta.svgObjects?.[0];
    expect(loaded).toBeDefined();
    expect(loaded!.subpaths).toBeUndefined();
  });

  it('round-trips localSubpaths on a grouped SVG (parallel to localSegments)', () => {
    // Grouped SVGs carry pre-group-transform geometry in localSegments;
    // v20 adds the same parallel field for subpaths so per-color splits
    // survive group transforms after load.
    const red = { r: 255, g: 0, b: 0 };
    const green = { r: 0, g: 255, b: 0 };
    const segs = [line([10, 10], [11, 10]), line([11, 10], [12, 10])];
    const localSegs = [line([0, 0], [1, 0]), line([1, 0], [2, 0])];
    const subpaths: SVGSubpath[] = [
      { color: red, segments: [segs[0]] },
      { color: green, segments: [segs[1]] },
    ];
    const localSubpaths: SVGSubpath[] = [
      { color: red, segments: [localSegs[0]] },
      { color: green, segments: [localSegs[1]] },
    ];
    const svg = makeSVG('svg_1', segs, {
      groupId: 'g_1',
      localSegments: localSegs,
      subpaths,
      localSubpaths,
    });

    const data = serializeComposition(makeBundle([svg]), []);
    const result = deserializeComposition(data);
    const loaded = result.meta.svgObjects?.[0];

    expect(loaded).toBeDefined();
    expect(loaded!.localSegments).toHaveLength(2);
    expect(loaded!.subpaths).toHaveLength(2);
    expect(loaded!.localSubpaths).toBeDefined();
    expect(loaded!.localSubpaths).toHaveLength(2);
    expect(loaded!.localSubpaths![0].color).toEqual(red);
    expect(loaded!.localSubpaths![1].color).toEqual(green);
    // Local-space coords stay distinct from world-space coords.
    expect(loaded!.localSubpaths![0].segments[0].start).toEqual([0, 0]);
    expect(loaded!.subpaths![0].segments[0].start).toEqual([10, 10]);
  });

  it('throws clearly on u16 overflow instead of silently corrupting the file', () => {
    // Synthesize a subpath with more than 65535 segments. Without the
    // writeCount16 guard this would truncate to (count & 0xffff) and
    // every subsequent SVG record in the file would misalign on read,
    // producing the bluetest.tile silent-corruption case.
    const segs: PathSegment[] = [];
    for (let i = 0; i <= 0xffff + 10; i++) {
      segs.push(line([i, 0], [i + 1, 0]));
    }
    const svg = makeSVG('svg_1', [line([0, 0], [1, 0])], {
      subpaths: [{ color: { r: 0, g: 0, b: 255 }, segments: segs }],
    });
    expect(() => serializeComposition(makeBundle([svg]), [])).toThrow(/exceeds u16 max/);
  });

  it('round-trips multi-SVG mix (no subpaths + with subpaths + with arcs in subpaths)', () => {
    const red = { r: 255, g: 0, b: 0 };
    const blue = { r: 0, g: 0, b: 255 };
    const plain = makeSVG('plain', [line([0, 0], [1, 0])]);
    const withSubs = makeSVG('painted', [line([0, 0], [1, 0]), line([1, 0], [2, 0])], {
      subpaths: [
        { color: red, segments: [line([0, 0], [1, 0])] },
        { color: blue, segments: [line([1, 0], [2, 0])] },
      ],
    });
    const arcSeg: PathSegment = { kind: 'arc', start: [0, 0], end: [1, 1], center: [0, 1] };
    const withArcSub = makeSVG('arcpath', [arcSeg], {
      subpaths: [{ color: blue, segments: [arcSeg] }],
    });

    const data = serializeComposition(makeBundle([plain, withSubs, withArcSub]), []);
    const result = deserializeComposition(data);
    const svgs = result.meta.svgObjects!;
    expect(svgs).toHaveLength(3);
    expect(svgs[0].subpaths).toBeUndefined();
    expect(svgs[1].subpaths).toHaveLength(2);
    expect(svgs[2].subpaths).toHaveLength(1);
    const reloadedArc = svgs[2].subpaths![0].segments[0];
    expect(reloadedArc.kind).toBe('arc');
    if (reloadedArc.kind === 'arc') {
      expect(reloadedArc.center).toEqual([0, 1]);
    }
  });
});
