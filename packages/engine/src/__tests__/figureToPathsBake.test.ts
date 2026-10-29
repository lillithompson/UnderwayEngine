/**
 * bakeFigureToSVGObject / bakeFiguresToSVGObjects: a figure as the
 * SVGObject that draws the same thing, for a canvas with no figure render
 * path (the shared editor's). The art is handed in as a CachedFigureSVG,
 * the way an import holds it before anything is stored.
 */

import {
  bakeFigureToSVGObject,
  bakeFiguresToSVGObjects,
  figureStrokeWidthCells,
  tintColoredSegments,
  figureToTiledSVGObject,
} from '../figureToPaths';
import { computeSVGBbox } from '../sceneGraph';
import { CompositionFigure } from '../types';
import type { CachedFigureSVG } from '../svgFigureBuilders';

jest.mock('../svgFigureCache', () => ({
  getFigureSVGSync: jest.fn(() => null),
}));

/** A 2×2-cell file: a red colour cell at the top-left (a filled rect) and
 *  a white sprite stroke across the other diagonal, at the exporter's
 *  stroke-width (SVG_STROKE_WIDTH, 5 SVG units). */
const ART: CachedFigureSVG = {
  elements: [
    '<rect x="0" y="0" width="256" height="256" fill="rgb(200,40,40)"/>',
    '<path d="M 256,0 L 512,256" fill="none" stroke="rgb(255,255,255)" stroke-width="5"/>',
  ],
  svgWidth: 512,
  svgHeight: 512,
};

/** A Facet file's composition strokeScale: 0.04, the ×200 multiplier's 8. */
const S = 0.04;

function fig(overrides?: Partial<CompositionFigure>): CompositionFigure {
  return {
    id: 'fig1',
    figureKey: 'file_f1_L0',
    fileId: 'f1',
    cellX: 10, cellY: 20,
    cellWidth: 4, cellHeight: 4,
    resolutionX: 2, resolutionY: 2,
    ...overrides,
  };
}

describe('bakeFigureToSVGObject', () => {
  test('one subpath per colour, fills flagged, the box the segments’ own AABB, the figure’s id', () => {
    const svg = bakeFigureToSVGObject(fig(), ART, S)!;
    expect(svg).not.toBeNull();
    expect(svg.id).toBe('fig1');
    expect(svg.subpaths).toHaveLength(2);
    const fill = svg.subpaths!.find((s) => s.fill);
    const stroke = svg.subpaths!.find((s) => !s.fill);
    expect(fill!.color).toEqual({ r: 200, g: 40, b: 40 });
    expect(fill!.segments).toHaveLength(4);
    expect(stroke!.color).toEqual({ r: 255, g: 255, b: 255 });
    expect(stroke!.segments).toHaveLength(1);
    // Every subpath's segments are the object's segments, in L0 cells at the
    // figure's placement: the 2-cell art fills the 4-cell box at 2×.
    expect(svg.segments).toHaveLength(5);
    expect(stroke!.segments[0]).toEqual({ kind: 'line', start: [12, 20], end: [14, 22] });
    expect(fill!.segments.map((s) => s.start)).toEqual(
      expect.arrayContaining([[10, 20], [12, 20], [12, 22], [10, 22]]));
    const box = computeSVGBbox(svg.segments);
    expect([svg.cellX, svg.cellY, svg.cellWidth, svg.cellHeight])
      .toEqual([box.cellX, box.cellY, box.cellWidth, box.cellHeight]);
    expect(box).toEqual({ cellX: 10, cellY: 20, cellWidth: 4, cellHeight: 2 });
    // The discrete pose is in the segments, not on the object.
    expect(svg.rotation).toBeUndefined();
    expect(svg.mirrorH).toBeUndefined();
  });

  test('the override tint is baked into every colour, fill flags intact', () => {
    const svg = bakeFigureToSVGObject(fig({ colorOverride: { r: 241, g: 92, b: 0 } }), ART, S)!;
    const fill = svg.subpaths!.find((s) => s.fill)!;
    const stroke = svg.subpaths!.find((s) => !s.fill)!;
    expect(fill.color).not.toEqual({ r: 200, g: 40, b: 40 });
    expect(stroke.color).not.toEqual({ r: 255, g: 255, b: 255 });
    expect(svg.color).toEqual(svg.subpaths![0].color);
  });

  test('tintColoredSegments leaves an untinted figure’s groups as they are and keeps isFill', () => {
    const groups = [{ color: { r: 255, g: 255, b: 255 }, segments: [], isFill: true }];
    expect(tintColoredSegments(groups, fig())).toBe(groups);
    const tinted = tintColoredSegments(groups, fig({ colorOverride: { r: 241, g: 92, b: 0 } }));
    expect(tinted[0].isFill).toBe(true);
    expect(tinted[0].color).not.toEqual({ r: 255, g: 255, b: 255 });
  });

  test('rotation and mirror are applied to the geometry', () => {
    const plain = bakeFigureToSVGObject(fig(), ART, S)!;
    const turned = bakeFigureToSVGObject(fig({ rotation: 180 }), ART, S)!;
    const stroke = (o: typeof plain) => o.subpaths!.find((s) => !s.fill)!.segments[0];
    // The diagonal, turned half way round the 4×4 box at (10,20), runs the
    // other way across the lower-left quadrant.
    expect(stroke(plain)).toEqual({ kind: 'line', start: [12, 20], end: [14, 22] });
    expect(stroke(turned)).toEqual({ kind: 'line', start: [12, 24], end: [10, 22] });
  });

  test('scene bookkeeping carries over; nothing else is invented', () => {
    const svg = bakeFigureToSVGObject(
      fig({ name: 'I', groupId: 'g1', locked: true, hidden: true, preGroupName: 'old' }), ART, S)!;
    expect(svg.name).toBe('I');
    expect(svg.groupId).toBe('g1');
    expect(svg.locked).toBe(true);
    expect(svg.hidden).toBe(true);
    expect(svg.preGroupName).toBe('old');
    const bare = bakeFigureToSVGObject(fig(), ART, S)!;
    expect(bare).not.toHaveProperty('name');
    expect(bare).not.toHaveProperty('groupId');
    expect(bare).not.toHaveProperty('locked');
    expect(bare).not.toHaveProperty('hidden');
    expect(Object.keys(bare).sort()).toEqual(
      ['cellHeight', 'cellWidth', 'cellX', 'cellY', 'color', 'id', 'segments', 'stroke', 'subpaths']);
  });

  test('the stroke width is the one the figure was drawn at, in world cells', () => {
    // Art stroke-width 5 × (0.04 × 200) = 40 SVG units = 40/256 cells, the
    // width Facet's figure raster and the engine's SVG export both draw —
    // not the 5 × 0.04 base pixels the svg node layer would read the stored
    // scale as.
    const svg = bakeFigureToSVGObject(fig(), ART, S)!;
    expect(svg.stroke).toEqual({ width: 40 / 256 });
    expect(figureStrokeWidthCells(ART, 1)).toBeCloseTo(1000 / 256, 9);
    // Colour cells alone fill; nothing strokes, so no stroke block.
    const fills: CachedFigureSVG = { elements: [ART.elements[0]], svgWidth: 512, svgHeight: 512 };
    expect(figureStrokeWidthCells(fills, S)).toBeUndefined();
    expect(bakeFigureToSVGObject(fig(), fills, S)!).not.toHaveProperty('stroke');
    // The widest stroke in the art sets it.
    const wide: CachedFigureSVG = { elements: [ART.elements[1], ART.elements[1].replace('stroke-width="5"', 'stroke-width="10"')], svgWidth: 512, svgHeight: 512 };
    expect(figureStrokeWidthCells(wide, S)).toBeCloseTo(80 / 256, 9);
  });

  test('empty art bakes to nothing', () => {
    expect(bakeFigureToSVGObject(fig(), { elements: [], svgWidth: 512, svgHeight: 512 }, S)).toBeNull();
  });

  test('a repeating figure bakes as the tiled object figureToTiledSVGObject makes of the same art', () => {
    const repeat = fig({ tileMode: 'repeat', tileWidthL0: 4, tileHeightL0: 4, cellWidth: 12, cellHeight: 8, name: 'tile', locked: true });
    const svg = bakeFigureToSVGObject(repeat, ART, S)!;
    const direct = figureToTiledSVGObject(repeat, 'fig1', ART)!;
    expect(svg.tileMode).toBe('repeat');
    expect(svg.tileWidthL0).toBe(4);
    expect(svg.segments).toEqual(direct.segments);
    expect([svg.cellX, svg.cellY, svg.cellWidth, svg.cellHeight]).toEqual([10, 20, 12, 8]);
    expect(svg.locked).toBe(true);
    expect(svg.name).toBe('tile');
  });
});

describe('bakeFiguresToSVGObjects', () => {
  test('bakes the figures whose files it holds, keeps the rest, drops an empty one', () => {
    const files = new Map<string, CachedFigureSVG>([
      ['f1', ART],
      ['empty', { elements: [], svgWidth: 256, svgHeight: 256 }],
    ]);
    const figures = [
      fig({ id: 'a', fileId: 'f1' }),
      fig({ id: 'b', fileId: 'f1', cellX: 0, cellY: 0 }),
      fig({ id: 'sprite', fileId: undefined, figureKey: 'all_L0:12' }),
      fig({ id: 'missing', fileId: 'not-in-bundle' }),
      fig({ id: 'blank', fileId: 'empty' }),
    ];
    const out = bakeFiguresToSVGObjects(figures, files, S);
    expect(out.svgObjects.map((o) => o.id)).toEqual(['a', 'b']);
    expect(out.figures.map((f) => f.id)).toEqual(['sprite', 'missing']);
    expect(out.svgObjects[1].cellX).toBe(0);
  });

  test('with no files every figure stays a figure', () => {
    const figures = [fig({ id: 'a' })];
    const out = bakeFiguresToSVGObjects(figures, new Map(), S);
    expect(out.svgObjects).toEqual([]);
    expect(out.figures).toEqual(figures);
  });
});
