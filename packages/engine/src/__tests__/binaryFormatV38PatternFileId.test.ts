/**
 * Tests for the v38 binary format extension: the SVG flags4 byte carrying
 * `patternFileId` (the tile-file id a pattern object was baked from) as a
 * string-table ref.
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

describe('v38 patternFileId persistence', () => {
  it('round-trips patternFileId alongside the other string refs', () => {
    const svg: SVGObject = {
      id: 'svg_1',
      name: 'Pattern',
      segments: [line([0, 0], [4, 4])],
      color: { r: 255, g: 255, b: 255 },
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
      patternFileId: '1785883104495',
    };
    const result = deserializeComposition(serializeComposition(makeBundle([svg]), []));
    const out = result.meta.svgObjects![0];
    expect(out.patternFileId).toBe('1785883104495');
    expect(out.name).toBe('Pattern');
  });

  it('leaves patternFileId unset for ordinary objects', () => {
    const svg: SVGObject = {
      id: 'svg_1',
      segments: [line([0, 0], [4, 4])],
      color: { r: 255, g: 255, b: 255 },
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
    };
    const result = deserializeComposition(serializeComposition(makeBundle([svg]), []));
    expect(result.meta.svgObjects![0].patternFileId).toBeUndefined();
  });
});
