/**
 * Integration tests: verify that the new Transform2D-based world
 * coordinate derivation matches the legacy system exactly.
 *
 * For each test, we:
 * 1. Build objects with legacy types (with proper local coords)
 * 2. Compute expected world coords via legacy applyChainedGroupTransform
 * 3. Convert to nodeMap via stateConversion
 * 4. Derive world coords via worldCoords accessors
 * 5. Assert the derived values match the legacy world fields
 */

import {
  CompositionFigure, CompositionState, GroupNode, SVGObject,
  ImageObject, PathSegment, makeViewport,
  FigureNode, SVGNode, ImageNode,
} from '../types';
import {
  applyGroupTransform, applyChainedGroupTransform,
  applyChainedGroupTransformPoint,
} from '../compositionOps';
import { convertToNodeMap, createCacheFromNodeMap } from '../stateConversion';
import { worldFigureCoords, worldSVGCoords, worldImageCoords } from '../worldCoords';

// ── Helpers ────────────────────────────────────────────────────────────

function closeTo(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}

function makeFigure(overrides: Partial<CompositionFigure> & { id: string }): CompositionFigure {
  return {
    figureKey: 'test', cellX: 0, cellY: 0,
    resolutionX: 2, resolutionY: 2,
    cellWidth: 2, cellHeight: 2,
    ...overrides,
  };
}

function makeSVG(overrides: Partial<SVGObject> & { id: string }): SVGObject {
  return {
    color: { r: 0, g: 0, b: 0 },
    segments: [{ kind: 'line' as const, start: [0, 0] as [number, number], end: [4, 0] as [number, number] }],
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 0,
    ...overrides,
  };
}

function makeImage(overrides: Partial<ImageObject> & { id: string }): ImageObject {
  return {
    imageId: 'blob1', mimeType: 'image/png',
    pixelWidth: 100, pixelHeight: 200,
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 8,
    ...overrides,
  };
}

function makeGroup(overrides: Partial<GroupNode> & { id: string }): GroupNode {
  return {
    name: 'G', translateX: 0, translateY: 0,
    scaleX: 1, scaleY: 1, rotation: 0,
    mirrorH: false, mirrorV: false,
    ...overrides,
  };
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
  const allIds = [
    ...figures.map(f => f.id),
    ...svgs.map(s => s.id),
    ...images.map(i => i.id),
  ];
  return {
    id: 'test', name: 'test',
    figures, svgObjects: svgs, images,
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups: opts.groups ?? [],
    sceneOrder: allIds,
    gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null, compTool: 'select',
    createRegion: null, renderGeneration: 0,
  };
}

// ── Ungrouped figures ──────────────────────────────────────────────────

describe('ungrouped figures', () => {
  test('simple figure at position', () => {
    const state = makeState({
      figures: [makeFigure({ id: 'f1', cellX: 10, cellY: 8, cellWidth: 4, cellHeight: 4 })],
    });
    const nodeMap = convertToNodeMap(state);
    const { cache, getNode } = createCacheFromNodeMap(nodeMap);
    const node = nodeMap.get('f1') as FigureNode;
    const wc = worldFigureCoords(node, cache, getNode);

    expect(closeTo(wc.cellX, 10)).toBe(true);
    expect(closeTo(wc.cellY, 8)).toBe(true);
    expect(closeTo(wc.cellWidth, 4)).toBe(true);
    expect(closeTo(wc.cellHeight, 4)).toBe(true);
  });

  test('figure with 90-degree rotation', () => {
    const fig = makeFigure({
      id: 'f1', cellX: 10, cellY: 8,
      cellWidth: 4, cellHeight: 2,
      resolutionX: 2, resolutionY: 2, rotation: 90,
    });
    const state = makeState({ figures: [fig] });
    const nodeMap = convertToNodeMap(state);
    const { cache, getNode } = createCacheFromNodeMap(nodeMap);
    const node = nodeMap.get('f1') as FigureNode;
    const wc = worldFigureCoords(node, cache, getNode);

    expect(closeTo(wc.cellWidth, 4)).toBe(true);
    expect(closeTo(wc.cellHeight, 2)).toBe(true);
    expect(wc.rotation).toBe(90);
  });

  test('figure with mirrorH', () => {
    const fig = makeFigure({
      id: 'f1', cellX: 5, cellY: 3,
      cellWidth: 6, cellHeight: 4,
      resolutionX: 3, resolutionY: 2, mirrorH: true,
    });
    const state = makeState({ figures: [fig] });
    const nodeMap = convertToNodeMap(state);
    const { cache, getNode } = createCacheFromNodeMap(nodeMap);
    const node = nodeMap.get('f1') as FigureNode;
    const wc = worldFigureCoords(node, cache, getNode);

    expect(closeTo(wc.cellWidth, 6)).toBe(true);
    expect(closeTo(wc.cellHeight, 4)).toBe(true);
    expect(wc.mirrorH).toBe(true);
    expect(wc.mirrorV).toBe(false);
  });

  test('non-square resolution with 270-degree rotation', () => {
    const fig = makeFigure({
      id: 'f1', cellX: 0, cellY: 0,
      cellWidth: 6, cellHeight: 4,
      resolutionX: 2, resolutionY: 3, rotation: 270,
    });
    const state = makeState({ figures: [fig] });
    const nodeMap = convertToNodeMap(state);
    const { cache, getNode } = createCacheFromNodeMap(nodeMap);
    const node = nodeMap.get('f1') as FigureNode;
    const wc = worldFigureCoords(node, cache, getNode);

    expect(closeTo(wc.cellWidth, fig.cellWidth)).toBe(true);
    expect(closeTo(wc.cellHeight, fig.cellHeight)).toBe(true);
    expect(wc.rotation).toBe(270);
  });
});

// ── Grouped figures ────────────────────────────────────────────────────

describe('grouped figures', () => {
  test('figure in identity group', () => {
    const group = makeGroup({ id: 'g1' });
    const fig = makeFigure({
      id: 'f1', cellX: 5, cellY: 3, cellWidth: 4, cellHeight: 4,
      groupId: 'g1',
      localCellX: 5, localCellY: 3, localCellWidth: 4, localCellHeight: 4,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
    });

    // Expected: identity group, so world = local
    const expected = applyGroupTransform(group, {
      cellX: 5, cellY: 3, cellWidth: 4, cellHeight: 4,
    });

    const state = makeState({ figures: [fig], groups: [group] });
    const nodeMap = convertToNodeMap(state);
    const { cache, getNode } = createCacheFromNodeMap(nodeMap);
    const node = nodeMap.get('f1') as FigureNode;
    const wc = worldFigureCoords(node, cache, getNode);

    expect(closeTo(wc.cellX, expected.cellX)).toBe(true);
    expect(closeTo(wc.cellY, expected.cellY)).toBe(true);
    expect(closeTo(wc.cellWidth, expected.cellWidth)).toBe(true);
    expect(closeTo(wc.cellHeight, expected.cellHeight)).toBe(true);
  });

  test('figure in translated+scaled group', () => {
    const group = makeGroup({
      id: 'g1', translateX: 100, translateY: 50, scaleX: 2, scaleY: 3,
    });

    const localBbox = { cellX: 5, cellY: 3, cellWidth: 4, cellHeight: 4 };
    const expected = applyGroupTransform(group, localBbox);

    const fig = makeFigure({
      id: 'f1', cellX: expected.cellX, cellY: expected.cellY,
      cellWidth: expected.cellWidth, cellHeight: expected.cellHeight,
      groupId: 'g1',
      localCellX: 5, localCellY: 3, localCellWidth: 4, localCellHeight: 4,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
    });

    const state = makeState({ figures: [fig], groups: [group] });
    const nodeMap = convertToNodeMap(state);
    const { cache, getNode } = createCacheFromNodeMap(nodeMap);
    const node = nodeMap.get('f1') as FigureNode;
    const wc = worldFigureCoords(node, cache, getNode);

    expect(closeTo(wc.cellX, expected.cellX)).toBe(true);
    expect(closeTo(wc.cellY, expected.cellY)).toBe(true);
    expect(closeTo(wc.cellWidth, expected.cellWidth)).toBe(true);
    expect(closeTo(wc.cellHeight, expected.cellHeight)).toBe(true);
  });

  test('figure in rotated group', () => {
    const group = makeGroup({
      id: 'g1', translateX: 10, translateY: 20, scaleX: 1, scaleY: 1, rotation: 90,
    });

    const localBbox = { cellX: 2, cellY: 3, cellWidth: 4, cellHeight: 6 };
    const expected = applyGroupTransform(group, localBbox);

    const fig = makeFigure({
      id: 'f1', cellX: expected.cellX, cellY: expected.cellY,
      cellWidth: expected.cellWidth, cellHeight: expected.cellHeight,
      resolutionX: 2, resolutionY: 3,
      groupId: 'g1',
      localCellX: 2, localCellY: 3, localCellWidth: 4, localCellHeight: 6,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
    });

    const state = makeState({ figures: [fig], groups: [group] });
    const nodeMap = convertToNodeMap(state);
    const { cache, getNode } = createCacheFromNodeMap(nodeMap);
    const node = nodeMap.get('f1') as FigureNode;
    const wc = worldFigureCoords(node, cache, getNode);

    expect(closeTo(wc.cellX, expected.cellX)).toBe(true);
    expect(closeTo(wc.cellY, expected.cellY)).toBe(true);
    expect(closeTo(wc.cellWidth, expected.cellWidth)).toBe(true);
    expect(closeTo(wc.cellHeight, expected.cellHeight)).toBe(true);
  });

  test('figure with local rotation in scaled+mirrored group', () => {
    const group = makeGroup({
      id: 'g1', translateX: 0, translateY: 0,
      scaleX: 2, scaleY: 1, rotation: 0, mirrorH: true,
    });

    const localBbox = { cellX: 3, cellY: 1, cellWidth: 4, cellHeight: 2 };
    const expected = applyGroupTransform(group, localBbox);

    const fig = makeFigure({
      id: 'f1', cellX: expected.cellX, cellY: expected.cellY,
      cellWidth: expected.cellWidth, cellHeight: expected.cellHeight,
      resolutionX: 2, resolutionY: 2,
      groupId: 'g1',
      localCellX: 3, localCellY: 1, localCellWidth: 4, localCellHeight: 2,
      localRotation: 90, localMirrorH: false, localMirrorV: false,
    });

    const state = makeState({ figures: [fig], groups: [group] });
    const nodeMap = convertToNodeMap(state);
    const { cache, getNode } = createCacheFromNodeMap(nodeMap);
    const node = nodeMap.get('f1') as FigureNode;
    const wc = worldFigureCoords(node, cache, getNode);

    expect(closeTo(wc.cellX, expected.cellX)).toBe(true);
    expect(closeTo(wc.cellY, expected.cellY)).toBe(true);
    expect(closeTo(wc.cellWidth, expected.cellWidth)).toBe(true);
    expect(closeTo(wc.cellHeight, expected.cellHeight)).toBe(true);
  });
});

// ── Nested groups ──────────────────────────────────────────────────────

describe('nested groups', () => {
  test('two-level nested group matches legacy chained transform', () => {
    const outerGroup = makeGroup({
      id: 'outer', translateX: 100, translateY: 100,
      scaleX: 1, scaleY: 1, rotation: 0, mirrorH: true,
    });
    const innerGroup = makeGroup({
      id: 'inner', parentGroupId: 'outer',
      translateX: 10, translateY: 10,
      scaleX: 2, scaleY: 2, rotation: 90,
    });

    const localBbox = { cellX: 1, cellY: 2, cellWidth: 4, cellHeight: 4 };
    const expected = applyChainedGroupTransform(
      [innerGroup, outerGroup], localBbox,
    );

    const fig = makeFigure({
      id: 'f1', cellX: expected.cellX, cellY: expected.cellY,
      cellWidth: expected.cellWidth, cellHeight: expected.cellHeight,
      resolutionX: 2, resolutionY: 2,
      groupId: 'inner',
      localCellX: 1, localCellY: 2, localCellWidth: 4, localCellHeight: 4,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
    });

    const state = makeState({
      figures: [fig], groups: [outerGroup, innerGroup],
    });
    const nodeMap = convertToNodeMap(state);
    const { cache, getNode } = createCacheFromNodeMap(nodeMap);
    const node = nodeMap.get('f1') as FigureNode;
    const wc = worldFigureCoords(node, cache, getNode);

    expect(closeTo(wc.cellX, expected.cellX)).toBe(true);
    expect(closeTo(wc.cellY, expected.cellY)).toBe(true);
    expect(closeTo(wc.cellWidth, expected.cellWidth)).toBe(true);
    expect(closeTo(wc.cellHeight, expected.cellHeight)).toBe(true);
  });
});

// ── SVG objects ────────────────────────────────────────────────────────

describe('ungrouped SVGs', () => {
  test('segment points preserved for ungrouped SVG', () => {
    const segs: PathSegment[] = [
      { kind: 'line', start: [2, 3], end: [6, 3] },
      { kind: 'line', start: [6, 3], end: [6, 7] },
    ];
    const svg = makeSVG({ id: 's1', segments: segs, cellX: 2, cellY: 3, cellWidth: 4, cellHeight: 4 });

    const state = makeState({ svgObjects: [svg] });
    const nodeMap = convertToNodeMap(state);
    const { cache, getNode } = createCacheFromNodeMap(nodeMap);
    const node = nodeMap.get('s1') as SVGNode;
    const wc = worldSVGCoords(node, cache, getNode);

    expect(wc.segments[0].start).toEqual([2, 3]);
    expect(wc.segments[0].end).toEqual([6, 3]);
    expect(wc.segments[1].start).toEqual([6, 3]);
    expect(wc.segments[1].end).toEqual([6, 7]);
  });
});

describe('grouped SVGs', () => {
  test('segment points match legacy transform', () => {
    const group = makeGroup({
      id: 'g1', translateX: 100, translateY: 50, scaleX: 2, scaleY: 2,
    });
    const localSegs: PathSegment[] = [
      { kind: 'line', start: [1, 2], end: [5, 2] },
    ];

    // Compute expected world segment points via legacy
    const [expS0, expS1] = [
      applyChainedGroupTransformPoint([group], 1, 2),
      applyChainedGroupTransformPoint([group], 5, 2),
    ];

    const svg = makeSVG({
      id: 's1',
      segments: [{ kind: 'line', start: expS0, end: expS1 }],
      localSegments: localSegs,
      groupId: 'g1',
      cellX: expS0[0], cellY: expS0[1],
      cellWidth: expS1[0] - expS0[0], cellHeight: 0,
    });

    const state = makeState({ svgObjects: [svg], groups: [group] });
    const nodeMap = convertToNodeMap(state);
    const { cache, getNode } = createCacheFromNodeMap(nodeMap);
    const node = nodeMap.get('s1') as SVGNode;
    const wc = worldSVGCoords(node, cache, getNode);

    expect(closeTo(wc.segments[0].start[0], expS0[0])).toBe(true);
    expect(closeTo(wc.segments[0].start[1], expS0[1])).toBe(true);
    expect(closeTo(wc.segments[0].end[0], expS1[0])).toBe(true);
    expect(closeTo(wc.segments[0].end[1], expS1[1])).toBe(true);
  });

  test('SVG in rotated group matches legacy', () => {
    const group = makeGroup({
      id: 'g1', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 90,
    });
    const localSegs: PathSegment[] = [
      { kind: 'line', start: [2, 0], end: [2, 4] },
    ];

    const [expS0, expS1] = [
      applyChainedGroupTransformPoint([group], 2, 0),
      applyChainedGroupTransformPoint([group], 2, 4),
    ];

    const svg = makeSVG({
      id: 's1',
      segments: [{ kind: 'line', start: expS0, end: expS1 }],
      localSegments: localSegs,
      groupId: 'g1',
    });

    const state = makeState({ svgObjects: [svg], groups: [group] });
    const nodeMap = convertToNodeMap(state);
    const { cache, getNode } = createCacheFromNodeMap(nodeMap);
    const node = nodeMap.get('s1') as SVGNode;
    const wc = worldSVGCoords(node, cache, getNode);

    expect(closeTo(wc.segments[0].start[0], expS0[0])).toBe(true);
    expect(closeTo(wc.segments[0].start[1], expS0[1])).toBe(true);
    expect(closeTo(wc.segments[0].end[0], expS1[0])).toBe(true);
    expect(closeTo(wc.segments[0].end[1], expS1[1])).toBe(true);
  });
});

// ── Images ─────────────────────────────────────────────────────────────

describe('ungrouped images', () => {
  test('image world bbox matches legacy fields', () => {
    const img = makeImage({ id: 'i1', cellX: 5, cellY: 10, cellWidth: 4, cellHeight: 8 });
    const state = makeState({ images: [img] });
    const nodeMap = convertToNodeMap(state);
    const { cache, getNode } = createCacheFromNodeMap(nodeMap);
    const node = nodeMap.get('i1') as ImageNode;
    const wc = worldImageCoords(node, cache, getNode);

    expect(closeTo(wc.cellX, 5)).toBe(true);
    expect(closeTo(wc.cellY, 10)).toBe(true);
    expect(closeTo(wc.cellWidth, 4)).toBe(true);
    expect(closeTo(wc.cellHeight, 8)).toBe(true);
  });

  test('rotated image', () => {
    const img = makeImage({
      id: 'i1', cellX: 5, cellY: 10, cellWidth: 8, cellHeight: 4, rotation: 90,
    });
    const state = makeState({ images: [img] });
    const nodeMap = convertToNodeMap(state);
    const { cache, getNode } = createCacheFromNodeMap(nodeMap);
    const node = nodeMap.get('i1') as ImageNode;
    const wc = worldImageCoords(node, cache, getNode);

    expect(closeTo(wc.cellWidth, 8)).toBe(true);
    expect(closeTo(wc.cellHeight, 4)).toBe(true);
    expect(wc.rotation).toBe(90);
  });
});

describe('grouped images', () => {
  test('image in scaled group matches legacy', () => {
    const group = makeGroup({
      id: 'g1', translateX: 50, translateY: 50, scaleX: 3, scaleY: 2,
    });

    const localBbox = { cellX: 4, cellY: 10, cellWidth: 4, cellHeight: 8 };
    const expected = applyGroupTransform(group, localBbox);

    const img = makeImage({
      id: 'i1', cellX: expected.cellX, cellY: expected.cellY,
      cellWidth: expected.cellWidth, cellHeight: expected.cellHeight,
      groupId: 'g1',
      localCellX: 4, localCellY: 10, localCellWidth: 4, localCellHeight: 8,
    });

    const state = makeState({ images: [img], groups: [group] });
    const nodeMap = convertToNodeMap(state);
    const { cache, getNode } = createCacheFromNodeMap(nodeMap);
    const node = nodeMap.get('i1') as ImageNode;
    const wc = worldImageCoords(node, cache, getNode);

    expect(closeTo(wc.cellX, expected.cellX)).toBe(true);
    expect(closeTo(wc.cellY, expected.cellY)).toBe(true);
    expect(closeTo(wc.cellWidth, expected.cellWidth)).toBe(true);
    expect(closeTo(wc.cellHeight, expected.cellHeight)).toBe(true);
  });
});

// ── Mixed scene ────────────────────────────────────────────────────────

describe('mixed scene', () => {
  test('all object kinds in a group produce correct world coords', () => {
    const group = makeGroup({
      id: 'g1', translateX: 10, translateY: 10, scaleX: 2, scaleY: 2,
    });

    // Figure
    const figLocal = { cellX: 1, cellY: 1, cellWidth: 2, cellHeight: 2 };
    const figExpected = applyGroupTransform(group, figLocal);
    const fig = makeFigure({
      id: 'f1', cellX: figExpected.cellX, cellY: figExpected.cellY,
      cellWidth: figExpected.cellWidth, cellHeight: figExpected.cellHeight,
      groupId: 'g1',
      localCellX: 1, localCellY: 1, localCellWidth: 2, localCellHeight: 2,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
    });

    // SVG
    const localSegs: PathSegment[] = [{ kind: 'line', start: [0, 0], end: [3, 0] }];
    const [expS, expE] = [
      applyChainedGroupTransformPoint([group], 0, 0),
      applyChainedGroupTransformPoint([group], 3, 0),
    ];
    const svg = makeSVG({
      id: 's1', segments: [{ kind: 'line', start: expS, end: expE }],
      localSegments: localSegs, groupId: 'g1',
    });

    // Image
    const imgLocal = { cellX: 5, cellY: 5, cellWidth: 4, cellHeight: 8 };
    const imgExpected = applyGroupTransform(group, imgLocal);
    const img = makeImage({
      id: 'i1', cellX: imgExpected.cellX, cellY: imgExpected.cellY,
      cellWidth: imgExpected.cellWidth, cellHeight: imgExpected.cellHeight,
      groupId: 'g1',
      localCellX: 5, localCellY: 5, localCellWidth: 4, localCellHeight: 8,
    });

    const state = makeState({
      figures: [fig], svgObjects: [svg], images: [img], groups: [group],
    });
    const nodeMap = convertToNodeMap(state);
    const { cache, getNode } = createCacheFromNodeMap(nodeMap);

    // Figure
    const fNode = nodeMap.get('f1') as FigureNode;
    const fWc = worldFigureCoords(fNode, cache, getNode);
    expect(closeTo(fWc.cellX, figExpected.cellX)).toBe(true);
    expect(closeTo(fWc.cellY, figExpected.cellY)).toBe(true);
    expect(closeTo(fWc.cellWidth, figExpected.cellWidth)).toBe(true);
    expect(closeTo(fWc.cellHeight, figExpected.cellHeight)).toBe(true);

    // SVG
    const sNode = nodeMap.get('s1') as SVGNode;
    const sWc = worldSVGCoords(sNode, cache, getNode);
    expect(closeTo(sWc.segments[0].start[0], expS[0])).toBe(true);
    expect(closeTo(sWc.segments[0].start[1], expS[1])).toBe(true);
    expect(closeTo(sWc.segments[0].end[0], expE[0])).toBe(true);
    expect(closeTo(sWc.segments[0].end[1], expE[1])).toBe(true);

    // Image
    const iNode = nodeMap.get('i1') as ImageNode;
    const iWc = worldImageCoords(iNode, cache, getNode);
    expect(closeTo(iWc.cellX, imgExpected.cellX)).toBe(true);
    expect(closeTo(iWc.cellY, imgExpected.cellY)).toBe(true);
    expect(closeTo(iWc.cellWidth, imgExpected.cellWidth)).toBe(true);
    expect(closeTo(iWc.cellHeight, imgExpected.cellHeight)).toBe(true);
  });
});
