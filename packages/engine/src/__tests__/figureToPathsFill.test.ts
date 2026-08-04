/**
 * ColoredSegments.isFill: fill-painted elements (color cells → rects with
 * fill="rgb(...)") group separately from stroked elements, flagged isFill,
 * so figure→SVG pattern baking can map them to filled subpaths.
 */

import { bakeFigureToColoredSegments } from '../figureToPaths';
import { CompositionFigure } from '../types';
import * as cache from '../svgFigureCache';

jest.mock('../svgFigureCache', () => ({
  getFigureSVGSync: jest.fn(),
}));

const mockGetSync = cache.getFigureSVGSync as jest.Mock;

function makeFig(overrides?: Partial<CompositionFigure>): CompositionFigure {
  return {
    id: 'fig1',
    figureKey: 'test',
    cellX: 0, cellY: 0,
    cellWidth: 2, cellHeight: 2,
    resolutionX: 2, resolutionY: 2,
    ...overrides,
  };
}

afterEach(() => mockGetSync.mockReset());

test('fill rects and stroke paths group separately with isFill set on fills', () => {
  mockGetSync.mockReturnValue({
    elements: [
      '<rect x="0" y="0" width="256" height="256" fill="rgb(200,40,40)"/>',
      '<path d="M 256,0 L 512,256" fill="none" stroke="rgb(255,255,255)"/>',
    ],
    svgWidth: 512,
    svgHeight: 512,
  });
  const groups = bakeFigureToColoredSegments(makeFig());
  expect(groups).toHaveLength(2);
  const fill = groups!.find(g => g.isFill);
  const stroke = groups!.find(g => !g.isFill);
  expect(fill).toBeDefined();
  expect(fill!.color).toEqual({ r: 200, g: 40, b: 40 });
  expect(fill!.segments).toHaveLength(4); // rect outline loop
  expect(stroke).toBeDefined();
  expect(stroke!.color).toEqual({ r: 255, g: 255, b: 255 });
  expect(stroke!.segments).toHaveLength(1);
});

test('same color used as both fill and stroke stays two groups', () => {
  mockGetSync.mockReturnValue({
    elements: [
      '<rect x="0" y="0" width="256" height="256" fill="rgb(10,20,30)"/>',
      '<path d="M 256,0 L 512,256" fill="none" stroke="rgb(10,20,30)"/>',
    ],
    svgWidth: 512,
    svgHeight: 512,
  });
  const groups = bakeFigureToColoredSegments(makeFig());
  expect(groups).toHaveLength(2);
  expect(groups!.filter(g => g.isFill)).toHaveLength(1);
  expect(groups!.filter(g => !g.isFill)).toHaveLength(1);
});
