/**
 * End-to-end integration test: verify the full pipeline from
 * CompositionState → syncNodeMap → worldCoords accessors matches
 * the legacy world coordinate fields for realistic compositions.
 */

import {
  CompositionFigure, CompositionState, GroupNode, SVGObject,
  ImageObject, PathSegment, makeViewport,
} from '../types';
import {
  applyGroupTransform, applyChainedGroupTransform,
  applyChainedGroupTransformPoint,
} from '../compositionOps';
import { syncNodeMap } from '../stateConversion';
import { getWorldFigure, getWorldSVG, getWorldImage, getWorldBbox } from '../useWorldCoords';

function closeTo(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}

function makeState(opts: {
  figures?: CompositionFigure[];
  svgObjects?: SVGObject[];
  images?: ImageObject[];
  groups?: GroupNode[];
}): CompositionState {
  const figures = opts.figures ?? [];
  const svgs = opts.svgObjects ?? [];
  const images = opts.images ?? [];
  return {
    id: 'test', name: 'test',
    figures, svgObjects: svgs, images,
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups: opts.groups ?? [],
    sceneOrder: [
      ...figures.map(f => f.id),
      ...svgs.map(s => s.id),
      ...images.map(i => i.id),
    ],
    gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null, compTool: 'select',
    createRegion: null, renderGeneration: 0,
  };
}

describe('state integration: syncNodeMap → getWorld*', () => {
  test('ungrouped figure world coords match legacy fields', () => {
    const fig: CompositionFigure = {
      id: 'f1', figureKey: 'test',
      cellX: 10, cellY: 8, resolutionX: 2, resolutionY: 2,
      cellWidth: 4, cellHeight: 4, rotation: 0,
    };
    const state = syncNodeMap(makeState({ figures: [fig] }));
    expect(state.nodeMap).toBeDefined();

    const wc = getWorldFigure(state, 'f1');
    expect(wc).not.toBeNull();
    expect(closeTo(wc!.cellX, fig.cellX)).toBe(true);
    expect(closeTo(wc!.cellY, fig.cellY)).toBe(true);
    expect(closeTo(wc!.cellWidth, fig.cellWidth)).toBe(true);
    expect(closeTo(wc!.cellHeight, fig.cellHeight)).toBe(true);
  });

  test('grouped figure world coords match legacy materialization', () => {
    const group: GroupNode = {
      id: 'g1', name: 'G',
      translateX: 100, translateY: 50, scaleX: 2, scaleY: 3,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const localBbox = { cellX: 5, cellY: 3, cellWidth: 4, cellHeight: 4 };
    const expected = applyGroupTransform(group, localBbox);

    const fig: CompositionFigure = {
      id: 'f1', figureKey: 'test',
      cellX: expected.cellX, cellY: expected.cellY,
      cellWidth: expected.cellWidth, cellHeight: expected.cellHeight,
      resolutionX: 2, resolutionY: 2,
      groupId: 'g1',
      localCellX: 5, localCellY: 3, localCellWidth: 4, localCellHeight: 4,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
    };

    const state = syncNodeMap(makeState({ figures: [fig], groups: [group] }));
    const wc = getWorldFigure(state, 'f1');

    expect(wc).not.toBeNull();
    expect(closeTo(wc!.cellX, expected.cellX)).toBe(true);
    expect(closeTo(wc!.cellY, expected.cellY)).toBe(true);
    expect(closeTo(wc!.cellWidth, expected.cellWidth)).toBe(true);
    expect(closeTo(wc!.cellHeight, expected.cellHeight)).toBe(true);
  });

  test('ungrouped SVG segment points preserved', () => {
    const segs: PathSegment[] = [
      { kind: 'line', start: [2, 3], end: [6, 3] },
    ];
    const svg: SVGObject = {
      id: 'svg_1', color: { r: 0, g: 0, b: 0 },
      segments: segs, cellX: 2, cellY: 3, cellWidth: 4, cellHeight: 0,
    };
    const state = syncNodeMap(makeState({ svgObjects: [svg] }));
    const wc = getWorldSVG(state, 'svg_1');

    expect(wc).not.toBeNull();
    expect(wc!.segments[0].start).toEqual([2, 3]);
    expect(wc!.segments[0].end).toEqual([6, 3]);
  });

  test('grouped SVG segment points match legacy', () => {
    const group: GroupNode = {
      id: 'g1', name: 'G',
      translateX: 10, translateY: 10, scaleX: 2, scaleY: 2,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const localSegs: PathSegment[] = [
      { kind: 'line', start: [1, 2], end: [5, 2] },
    ];
    const [expS, expE] = [
      applyChainedGroupTransformPoint([group], 1, 2),
      applyChainedGroupTransformPoint([group], 5, 2),
    ];
    const svg: SVGObject = {
      id: 'svg_1', color: { r: 0, g: 0, b: 0 },
      segments: [{ kind: 'line', start: expS, end: expE }],
      localSegments: localSegs,
      groupId: 'g1',
      cellX: expS[0], cellY: expS[1],
      cellWidth: expE[0] - expS[0], cellHeight: 0,
      localCellX: 1, localCellY: 2, localCellWidth: 4, localCellHeight: 0,
    };
    const state = syncNodeMap(makeState({ svgObjects: [svg], groups: [group] }));
    const wc = getWorldSVG(state, 'svg_1');

    expect(wc).not.toBeNull();
    expect(closeTo(wc!.segments[0].start[0], expS[0])).toBe(true);
    expect(closeTo(wc!.segments[0].start[1], expS[1])).toBe(true);
    expect(closeTo(wc!.segments[0].end[0], expE[0])).toBe(true);
    expect(closeTo(wc!.segments[0].end[1], expE[1])).toBe(true);
  });

  test('ungrouped image world coords match', () => {
    const img: ImageObject = {
      id: 'img_1', imageId: 'blob1', mimeType: 'image/png',
      pixelWidth: 100, pixelHeight: 200,
      cellX: 5, cellY: 10, cellWidth: 4, cellHeight: 8,
    };
    const state = syncNodeMap(makeState({ images: [img] }));
    const wc = getWorldImage(state, 'img_1');

    expect(wc).not.toBeNull();
    expect(closeTo(wc!.cellX, 5)).toBe(true);
    expect(closeTo(wc!.cellY, 10)).toBe(true);
    expect(closeTo(wc!.cellWidth, 4)).toBe(true);
    expect(closeTo(wc!.cellHeight, 8)).toBe(true);
  });

  test('getWorldBbox works for all node kinds', () => {
    const fig: CompositionFigure = {
      id: 'f1', figureKey: 'test',
      cellX: 10, cellY: 10, resolutionX: 2, resolutionY: 2,
      cellWidth: 4, cellHeight: 4,
    };
    const svg: SVGObject = {
      id: 'svg_1', color: { r: 0, g: 0, b: 0 },
      segments: [{ kind: 'line', start: [0, 0], end: [8, 0] }],
      cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 0,
    };
    const img: ImageObject = {
      id: 'img_1', imageId: 'blob1', mimeType: 'image/png',
      pixelWidth: 100, pixelHeight: 200,
      cellX: 20, cellY: 20, cellWidth: 6, cellHeight: 12,
    };
    const state = syncNodeMap(makeState({ figures: [fig], svgObjects: [svg], images: [img] }));

    const fBbox = getWorldBbox(state, 'f1');
    expect(fBbox).not.toBeNull();
    expect(closeTo(fBbox!.cellX, 10)).toBe(true);
    expect(closeTo(fBbox!.cellWidth, 4)).toBe(true);

    const sBbox = getWorldBbox(state, 'svg_1');
    expect(sBbox).not.toBeNull();
    expect(closeTo(sBbox!.cellWidth, 8)).toBe(true);

    const iBbox = getWorldBbox(state, 'img_1');
    expect(iBbox).not.toBeNull();
    expect(closeTo(iBbox!.cellX, 20)).toBe(true);
    expect(closeTo(iBbox!.cellWidth, 6)).toBe(true);
  });

  test('nested group hierarchy matches legacy', () => {
    const outer: GroupNode = {
      id: 'outer', name: 'Outer',
      translateX: 50, translateY: 50, scaleX: 2, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const inner: GroupNode = {
      id: 'inner', name: 'Inner', parentGroupId: 'outer',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 3,
      rotation: 90, mirrorH: false, mirrorV: false,
    };
    const localBbox = { cellX: 1, cellY: 1, cellWidth: 2, cellHeight: 4 };
    const expected = applyChainedGroupTransform([inner, outer], localBbox);

    const fig: CompositionFigure = {
      id: 'f1', figureKey: 'test',
      cellX: expected.cellX, cellY: expected.cellY,
      cellWidth: expected.cellWidth, cellHeight: expected.cellHeight,
      resolutionX: 1, resolutionY: 2,
      groupId: 'inner',
      localCellX: 1, localCellY: 1, localCellWidth: 2, localCellHeight: 4,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
    };

    const state = syncNodeMap(makeState({
      figures: [fig], groups: [outer, inner],
    }));
    const wc = getWorldFigure(state, 'f1');

    expect(wc).not.toBeNull();
    expect(closeTo(wc!.cellX, expected.cellX)).toBe(true);
    expect(closeTo(wc!.cellY, expected.cellY)).toBe(true);
    expect(closeTo(wc!.cellWidth, expected.cellWidth)).toBe(true);
    expect(closeTo(wc!.cellHeight, expected.cellHeight)).toBe(true);
  });

  test('returns null for nonexistent node', () => {
    const state = syncNodeMap(makeState({}));
    expect(getWorldFigure(state, 'nonexistent')).toBeNull();
    expect(getWorldSVG(state, 'nonexistent')).toBeNull();
    expect(getWorldImage(state, 'nonexistent')).toBeNull();
    expect(getWorldBbox(state, 'nonexistent')).toBeNull();
  });
});
