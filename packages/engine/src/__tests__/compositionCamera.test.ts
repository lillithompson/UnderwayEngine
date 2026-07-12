import { computeFrameAllCamera, computeFrameSelectionCamera } from '../compositionCamera';
import { CompositionFigure, SVGObject, PathSegment } from '../types';
import { computeSVGBbox } from '../compositionOps';

function makeFigure(overrides: Partial<CompositionFigure> = {}): CompositionFigure {
  return {
    id: 'f1',
    figureKey: 'k',
    cellX: 0, cellY: 0,
    resolutionX: 2, resolutionY: 2,
    cellWidth: 4, cellHeight: 4,
    ...overrides,
  };
}

function makeSVGFromVertices(id: string, vertices: [number, number][]): SVGObject {
  const segments: PathSegment[] = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    segments.push({ kind: 'line', start: vertices[i], end: vertices[i + 1] });
  }
  return { id, segments, color: { r: 255, g: 255, b: 255 }, ...computeSVGBbox(segments) };
}

/** A repeat-tiled SVG: its `segments` hold only the origin tile (here a 10×10
 *  L-corner), while its cell region spans the full repetition area. */
function makeTiledSVG(id: string, cellWidth: number, cellHeight: number): SVGObject {
  return {
    id,
    segments: [
      { kind: 'line', start: [0, 0], end: [10, 0] },
      { kind: 'line', start: [10, 0], end: [10, 10] },
    ],
    color: { r: 255, g: 255, b: 255 },
    cellX: 0, cellY: 0, cellWidth, cellHeight,
    tileMode: 'repeat', tileWidthL0: 10, tileHeightL0: 10,
  };
}

describe('computeFrameAllCamera', () => {
  test('returns null when nothing is on the canvas', () => {
    expect(computeFrameAllCamera([], 800, 600, [])).toBeNull();
    // Backwards-compat call without the svgObjects argument also returns null.
    expect(computeFrameAllCamera([], 800, 600)).toBeNull();
  });

  test('frames svg objects when there are no figures', () => {
    const svgObjects = [makeSVGFromVertices('l1', [[10, 12], [18, 20]])];
    const cam = computeFrameAllCamera([], 800, 600, svgObjects);
    expect(cam).not.toBeNull();
    expect(cam!.zoom).toBeGreaterThan(0);
  });

  test('expands the bounding box to include svg object segments that extend past the figures', () => {
    // A small figure clustered near the origin, plus a svg object whose far
    // segment reaches well past the figure's extents. The framed camera
    // must zoom out enough to include the svg object's far segment.
    const figs = [makeFigure({ cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 })];
    const figOnlyCam = computeFrameAllCamera(figs, 800, 600, [])!;
    const svgAndFigsCam = computeFrameAllCamera(
      figs, 800, 600,
      [makeSVGFromVertices('l1', [[1, 1], [20, 20]])],
    )!;
    // Including the svg object's (20,20) segment should force a smaller zoom
    // (zoomed out further) than figures alone.
    expect(svgAndFigsCam.zoom).toBeLessThan(figOnlyCam.zoom);
  });

  test('frames a repeat-tiled svg by its full cell region, not one tile', () => {
    // The tiled object's region is 40×40 but its segments cover only a 10×10
    // tile. Framing it must match framing a non-tiled object spanning the full
    // 40×40 region — not the single tile.
    const tiledCam = computeFrameAllCamera([], 800, 600, [makeTiledSVG('t1', 40, 40)])!;
    const fullRegionCam = computeFrameAllCamera(
      [], 800, 600, [makeSVGFromVertices('full', [[0, 0], [40, 0], [40, 40], [0, 40], [0, 0]])],
    )!;
    expect(tiledCam.zoom).toBeCloseTo(fullRegionCam.zoom, 5);
    expect(tiledCam.offsetX).toBeCloseTo(fullRegionCam.offsetX, 3);
    expect(tiledCam.offsetY).toBeCloseTo(fullRegionCam.offsetY, 3);
  });

  test('regression: a tiled object frames more zoomed-out than a single tile', () => {
    // Pre-fix, the tiled object framed to its one base tile (10×10). A 40×40
    // region covers 4× the span, so its zoom must be well below the single
    // tile's. (Before the fix these were equal.)
    const tiledCam = computeFrameAllCamera([], 800, 600, [makeTiledSVG('t1', 40, 40)])!;
    const oneTileCam = computeFrameAllCamera(
      [], 800, 600, [makeSVGFromVertices('one', [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]])],
    )!;
    expect(tiledCam.zoom).toBeLessThan(oneTileCam.zoom * 0.5);
  });
});

describe('computeFrameSelectionCamera', () => {
  test('frames a selected svg object by its segments', () => {
    const svgObjects = [makeSVGFromVertices('l1', [[5, 5], [15, 15]])];
    const cam = computeFrameSelectionCamera([], new Set(['l1']), 800, 600, svgObjects);
    expect(cam).not.toBeNull();
  });

  test('returns null when selection set is empty', () => {
    const svgObjects = [makeSVGFromVertices('l1', [[5, 5], [15, 15]])];
    expect(computeFrameSelectionCamera([], new Set(), 800, 600, svgObjects)).toBeNull();
  });

  test('mixed figure + svg object selection includes both in the frame', () => {
    const figs = [makeFigure({ id: 'f1', cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 })];
    const svgObjects = [makeSVGFromVertices('l1', [[20, 20], [25, 25]])];
    const cam = computeFrameSelectionCamera(
      figs, new Set(['f1', 'l1']), 800, 600, svgObjects,
    );
    expect(cam).not.toBeNull();
    // Selecting just the figure produces a tighter frame than selecting
    // both, since the svg object extends the bbox.
    const figOnly = computeFrameSelectionCamera(figs, new Set(['f1']), 800, 600, svgObjects)!;
    expect(cam!.zoom).toBeLessThan(figOnly.zoom);
  });
});
