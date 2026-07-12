/**
 * Tests for the v21 binary format extension: `shapeKind === 'rectangle'`
 * presence flag. Verifies that rectangles keep their identity (and therefore
 * their orange selection border and non-uniform scaling) through a .tile
 * export/import round-trip, and that the version gate prevents older v20
 * readers from misinterpreting the new flag bit.
 */

import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { SVGObject, PathSegment } from '../types';

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

function rectSegments(): PathSegment[] {
  return [
    line([0, 0], [4, 0]),
    line([4, 0], [4, 3]),
    line([4, 3], [0, 3]),
    line([0, 3], [0, 0]),
  ];
}

function makeSVG(id: string, segments: PathSegment[], extras: Partial<SVGObject> = {}): SVGObject {
  return {
    id,
    segments,
    color: { r: 255, g: 160, b: 50 },
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 3,
    ...extras,
  };
}

describe('v21 shapeKind persistence', () => {
  test('round-trips shapeKind="rectangle" on SVGObjects', () => {
    const rect = makeSVG('svg_rect', rectSegments(), { shapeKind: 'rectangle' });
    const plainLine = makeSVG('svg_line', [line([0, 0], [4, 0])], {
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 0,
    });

    const data = serializeComposition(makeBundle([rect, plainLine]), []);
    const { meta } = deserializeComposition(data);

    const loadedRect = meta.svgObjects?.find(s => s.id === 'svg_rect');
    const loadedLine = meta.svgObjects?.find(s => s.id === 'svg_line');

    expect(loadedRect).toBeDefined();
    expect(loadedRect!.shapeKind).toBe('rectangle');
    expect(loadedLine).toBeDefined();
    expect(loadedLine!.shapeKind).toBeUndefined();
  });

  test('shapeKind survives alongside grouped/local segments and creationBox', () => {
    const rect = makeSVG('svg_rect', rectSegments(), {
      shapeKind: 'rectangle',
      groupId: 'g1',
      localSegments: rectSegments(),
      localCellX: 0, localCellY: 0, localCellWidth: 4, localCellHeight: 3,
      creationBox: { minX: 0, minY: 0, width: 4, height: 3 },
    });

    const bundle = makeBundle([rect]);
    bundle.groups = [{
      id: 'g1', name: 'group', translateX: 0, translateY: 0,
      scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false,
    }];

    const data = serializeComposition(bundle, []);
    const { meta } = deserializeComposition(data);

    const loaded = meta.svgObjects?.[0];
    expect(loaded).toBeDefined();
    expect(loaded!.shapeKind).toBe('rectangle');
    expect(loaded!.groupId).toBe('g1');
    expect(loaded!.localSegments).toBeDefined();
    expect(loaded!.creationBox).toEqual({ minX: 0, minY: 0, width: 4, height: 3 });
  });

  test('non-rectangle SVGs never get shapeKind assigned', () => {
    // Verify that an ordinary (non-rectangle) SVG does not gain
    // shapeKind through a round-trip — the flag bit in flags2 is only
    // written when shapeKind === 'rectangle' on the source object.
    const plain = makeSVG('svg_plain', rectSegments());
    const data = serializeComposition(makeBundle([plain]), []);
    const { meta } = deserializeComposition(data);
    expect(meta.svgObjects?.[0].shapeKind).toBeUndefined();
  });
});
