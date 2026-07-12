import { figureToNode, svgToNode, imageToNode, groupToNode2 } from '../nodeConversion';
import { CompositionFigure, SVGObject, ImageObject, GroupNode, PathSegment } from '../types';
import { applyToBbox, applyToPoint, Bbox, IDENTITY } from '../transform2d';
import { applyGroupTransform, applyGroupTransformPoint, applyChainedGroupTransform } from '../compositionOps';
import { WorldTransformCache, NodeTransformInfo } from '../worldTransformCache';

// ── Helpers ────────────────────────────────────────────────────────────

function closeTo(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}

function bboxClose(a: Bbox, b: { cellX: number; cellY: number; cellWidth: number; cellHeight: number }, eps = 1e-6): boolean {
  return closeTo(a.x, b.cellX, eps) && closeTo(a.y, b.cellY, eps)
    && closeTo(a.width, b.cellWidth, eps) && closeTo(a.height, b.cellHeight, eps);
}

function makeFigure(overrides: Partial<CompositionFigure> = {}): CompositionFigure {
  return {
    id: 'fig1', figureKey: 'test',
    cellX: 10, cellY: 8, resolutionX: 2, resolutionY: 2,
    cellWidth: 4, cellHeight: 4,
    ...overrides,
  };
}

function makeGroup(overrides: Partial<GroupNode> = {}): GroupNode {
  return {
    id: 'g1', name: 'Group 1',
    translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
    rotation: 0, mirrorH: false, mirrorV: false,
    ...overrides,
  };
}

function makeSVG(overrides: Partial<SVGObject> = {}): SVGObject {
  return {
    id: 'svg_1', color: { r: 0, g: 0, b: 0 },
    segments: [{ kind: 'line' as const, start: [2, 3] as [number, number], end: [6, 3] as [number, number] }],
    cellX: 2, cellY: 3, cellWidth: 4, cellHeight: 0,
    ...overrides,
  };
}

function makeImage(overrides: Partial<ImageObject> = {}): ImageObject {
  return {
    id: 'img_1', imageId: 'blob1', mimeType: 'image/png',
    pixelWidth: 100, pixelHeight: 200,
    cellX: 5, cellY: 10, cellWidth: 4, cellHeight: 8,
    ...overrides,
  };
}

// ── Figure conversion tests ────────────────────────────────────────────

describe('figureToNode', () => {
  test('ungrouped figure: world bbox matches legacy', () => {
    const fig = makeFigure({ cellX: 10, cellY: 8, cellWidth: 4, cellHeight: 4, resolutionX: 2, resolutionY: 2 });
    const node = figureToNode(fig);

    // World bbox should be (10, 8, 4, 4) — same as cellX/Y/Width/Height
    const worldBbox = applyToBbox(node.transform, node.localBbox);
    expect(bboxClose(worldBbox, fig)).toBe(true);
  });

  test('ungrouped figure with non-square resolution', () => {
    const fig = makeFigure({ cellX: 5, cellY: 3, cellWidth: 6, cellHeight: 4, resolutionX: 3, resolutionY: 2 });
    const node = figureToNode(fig);
    const worldBbox = applyToBbox(node.transform, node.localBbox);
    expect(bboxClose(worldBbox, fig)).toBe(true);
  });

  test('ungrouped figure with 90-degree rotation', () => {
    // A 2x2 resolution figure placed at (10,8) with 4x2 post-rotation dims
    // (rotation=90 swaps width/height from the pre-rotation state)
    const fig = makeFigure({
      cellX: 10, cellY: 8, cellWidth: 4, cellHeight: 2,
      resolutionX: 2, resolutionY: 2,
      rotation: 90,
    });
    const node = figureToNode(fig);
    const worldBbox = applyToBbox(node.transform, node.localBbox);
    expect(closeTo(worldBbox.width, fig.cellWidth)).toBe(true);
    expect(closeTo(worldBbox.height, fig.cellHeight)).toBe(true);
  });

  test('ungrouped figure with 180-degree rotation', () => {
    const fig = makeFigure({
      cellX: 10, cellY: 8, cellWidth: 4, cellHeight: 6,
      resolutionX: 2, resolutionY: 3,
      rotation: 180,
    });
    const node = figureToNode(fig);
    const worldBbox = applyToBbox(node.transform, node.localBbox);
    expect(closeTo(worldBbox.width, fig.cellWidth)).toBe(true);
    expect(closeTo(worldBbox.height, fig.cellHeight)).toBe(true);
  });

  test('ungrouped figure with mirrorH', () => {
    const fig = makeFigure({
      cellX: 10, cellY: 8, cellWidth: 4, cellHeight: 4,
      mirrorH: true,
    });
    const node = figureToNode(fig);
    const worldBbox = applyToBbox(node.transform, node.localBbox);
    expect(closeTo(worldBbox.width, fig.cellWidth)).toBe(true);
    expect(closeTo(worldBbox.height, fig.cellHeight)).toBe(true);
  });

  test('grouped figure with local coords: world bbox via cache matches legacy', () => {
    const group = makeGroup({
      translateX: 100, translateY: 50, scaleX: 2, scaleY: 3, rotation: 0,
    });
    const fig = makeFigure({
      cellX: 204, cellY: 62, cellWidth: 8, cellHeight: 12,  // world (materialized)
      resolutionX: 2, resolutionY: 2,
      groupId: 'g1',
      localCellX: 2, localCellY: 4, localCellWidth: 4, localCellHeight: 4,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
    });

    // Legacy world bbox
    const legacyWorld = applyGroupTransform(group, {
      cellX: fig.localCellX!, cellY: fig.localCellY!,
      cellWidth: fig.localCellWidth!, cellHeight: fig.localCellHeight!,
    });

    // New system: convert both, compose via cache
    const groupNode = groupToNode2(group);
    const figNode = figureToNode(fig);

    const cache = new WorldTransformCache();
    const nodes = new Map<string, NodeTransformInfo>([
      [groupNode.id, groupNode],
      [figNode.id, figNode],
    ]);
    const worldBbox = cache.getWorldBbox(figNode.id, figNode.localBbox, id => nodes.get(id));

    expect(bboxClose(worldBbox, legacyWorld)).toBe(true);
  });

  test('grouped figure with rotation: world bbox via cache matches legacy', () => {
    const group = makeGroup({
      translateX: 10, translateY: 20, scaleX: 1, scaleY: 1, rotation: 90,
    });
    const fig = makeFigure({
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
      resolutionX: 2, resolutionY: 2,
      groupId: 'g1',
      localCellX: 5, localCellY: 3, localCellWidth: 4, localCellHeight: 4,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
    });

    const legacyWorld = applyGroupTransform(group, {
      cellX: 5, cellY: 3, cellWidth: 4, cellHeight: 4,
    });

    const groupNode = groupToNode2(group);
    const figNode = figureToNode(fig);

    const cache = new WorldTransformCache();
    const nodes = new Map<string, NodeTransformInfo>([
      [groupNode.id, groupNode],
      [figNode.id, figNode],
    ]);
    const worldBbox = cache.getWorldBbox(figNode.id, figNode.localBbox, id => nodes.get(id));

    expect(bboxClose(worldBbox, legacyWorld)).toBe(true);
  });

  test('figure preserves tile mode fields', () => {
    const fig = makeFigure({ tileMode: 'repeat', tileWidthL0: 4, tileHeightL0: 4 });
    const node = figureToNode(fig);
    expect(node.tileMode).toBe('repeat');
    expect(node.tileWidthL0).toBe(4);
    expect(node.tileHeightL0).toBe(4);
  });

  test('grouped figure uses local tile dims', () => {
    const fig = makeFigure({
      tileMode: 'repeat',
      tileWidthL0: 8, tileHeightL0: 12, // world tile dims
      localTileWidthL0: 4, localTileHeightL0: 4, // local tile dims
      groupId: 'g1',
      localCellX: 0, localCellY: 0, localCellWidth: 4, localCellHeight: 4,
    });
    const node = figureToNode(fig);
    expect(node.tileWidthL0).toBe(4);
    expect(node.tileHeightL0).toBe(4);
  });
});

// ── SVG conversion tests ───────────────────────────────────────────────

describe('svgToNode', () => {
  test('ungrouped SVG uses world segments as-is', () => {
    const segs: PathSegment[] = [
      { kind: 'line', start: [2, 3], end: [6, 3] },
      { kind: 'line', start: [6, 3], end: [6, 7] },
    ];
    const svg = makeSVG({ segments: segs, cellX: 2, cellY: 3, cellWidth: 4, cellHeight: 4 });
    const node = svgToNode(svg);
    expect(node.segments).toEqual(segs);
    expect(node.transform).toEqual(IDENTITY);
    expect(node.parentId).toBeUndefined();
  });

  test('grouped SVG uses localSegments', () => {
    const worldSegs: PathSegment[] = [
      { kind: 'line', start: [10, 20], end: [14, 20] },
    ];
    const localSegs: PathSegment[] = [
      { kind: 'line', start: [2, 3], end: [6, 3] },
    ];
    const svg = makeSVG({
      segments: worldSegs, localSegments: localSegs,
      groupId: 'g1',
      cellX: 10, cellY: 20, cellWidth: 4, cellHeight: 0,
      localCellX: 2, localCellY: 3, localCellWidth: 4, localCellHeight: 0,
    });
    const node = svgToNode(svg);
    expect(node.segments).toEqual(localSegs);
    expect(node.parentId).toBe('g1');
  });

  test('grouped SVG segment points match legacy through cache', () => {
    const group = makeGroup({
      translateX: 100, translateY: 50, scaleX: 2, scaleY: 2, rotation: 0,
    });
    const localSegs: PathSegment[] = [
      { kind: 'line', start: [1, 2], end: [5, 2] },
    ];
    const svg = makeSVG({
      segments: [
        { kind: 'line', start: [102, 54], end: [110, 54] },
      ],
      localSegments: localSegs,
      groupId: 'g1',
      cellX: 102, cellY: 54, cellWidth: 8, cellHeight: 0,
      localCellX: 1, localCellY: 2, localCellWidth: 4, localCellHeight: 0,
    });

    // Legacy: transform local segment points through group
    const [legacyStartX, legacyStartY] = applyGroupTransformPoint(group, 1, 2);
    const [legacyEndX, legacyEndY] = applyGroupTransformPoint(group, 5, 2);

    // New system: get world transform, apply to local segment points
    const groupNode = groupToNode2(group);
    const svgNode = svgToNode(svg);
    const cache = new WorldTransformCache();
    const nodes = new Map<string, NodeTransformInfo>([
      [groupNode.id, groupNode],
      [svgNode.id, svgNode],
    ]);
    const wt = cache.getWorldTransform(svgNode.id, id => nodes.get(id));
    const [newStartX, newStartY] = applyToPoint(wt, 1, 2);
    const [newEndX, newEndY] = applyToPoint(wt, 5, 2);

    expect(closeTo(newStartX, legacyStartX)).toBe(true);
    expect(closeTo(newStartY, legacyStartY)).toBe(true);
    expect(closeTo(newEndX, legacyEndX)).toBe(true);
    expect(closeTo(newEndY, legacyEndY)).toBe(true);
  });

  test('SVG preserves lineDirection and creationBox', () => {
    const svg = makeSVG({
      lineDirection: 'horizontal',
      creationBox: { minX: 2, minY: 3, width: 4, height: 1 },
    });
    const node = svgToNode(svg);
    expect(node.lineDirection).toBe('horizontal');
    expect(node.creationBox).toEqual({ minX: 2, minY: 3, width: 4, height: 1 });
  });
});

// ── Image conversion tests ─────────────────────────────────────────────

describe('imageToNode', () => {
  test('ungrouped image: world bbox matches legacy', () => {
    const img = makeImage({ cellX: 5, cellY: 10, cellWidth: 4, cellHeight: 8 });
    const node = imageToNode(img);
    const worldBbox = applyToBbox(node.transform, node.localBbox);
    expect(bboxClose(worldBbox, img)).toBe(true);
  });

  test('ungrouped image with rotation', () => {
    const img = makeImage({
      cellX: 5, cellY: 10, cellWidth: 8, cellHeight: 4,
      rotation: 90,
    });
    const node = imageToNode(img);
    const worldBbox = applyToBbox(node.transform, node.localBbox);
    expect(closeTo(worldBbox.width, img.cellWidth)).toBe(true);
    expect(closeTo(worldBbox.height, img.cellHeight)).toBe(true);
  });

  test('grouped image: world bbox via cache matches legacy', () => {
    const group = makeGroup({
      translateX: 50, translateY: 50, scaleX: 3, scaleY: 2,
    });
    const img = makeImage({
      cellX: 62, cellY: 70, cellWidth: 12, cellHeight: 16, // world (materialized)
      groupId: 'g1',
      localCellX: 4, localCellY: 10, localCellWidth: 4, localCellHeight: 8,
    });

    const legacyWorld = applyGroupTransform(group, {
      cellX: 4, cellY: 10, cellWidth: 4, cellHeight: 8,
    });

    const groupNode = groupToNode2(group);
    const imgNode = imageToNode(img);

    const cache = new WorldTransformCache();
    const nodes = new Map<string, NodeTransformInfo>([
      [groupNode.id, groupNode],
      [imgNode.id, imgNode],
    ]);
    const worldBbox = cache.getWorldBbox(imgNode.id, imgNode.localBbox, id => nodes.get(id));

    expect(bboxClose(worldBbox, legacyWorld)).toBe(true);
  });

  test('image preserves opacity', () => {
    const img = makeImage({ opacity: 0.5 });
    const node = imageToNode(img);
    expect(node.opacity).toBe(0.5);
  });
});

// ── Group conversion tests ─────────────────────────────────────────────

describe('groupToNode2', () => {
  test('converts identity group', () => {
    const g = makeGroup();
    const node = groupToNode2(g);
    expect(node.kind).toBe('group');
    expect(node.id).toBe('g1');
    expect(node.name).toBe('Group 1');
    expect(node.parentId).toBeUndefined();
    expect(node.transform).toEqual(IDENTITY);
  });

  test('converts group with transform', () => {
    const g = makeGroup({
      translateX: 10, translateY: 20, scaleX: 2, scaleY: 3,
      rotation: 90, mirrorH: true, mirrorV: false,
    });
    const node = groupToNode2(g);
    expect(node.transform.tx).toBe(10);
    expect(node.transform.ty).toBe(20);
    expect(node.transform.sx).toBe(2);
    expect(node.transform.sy).toBe(3);
    expect(node.transform.rotation).toBe(90);
    expect(node.transform.mirrorH).toBe(true);
    expect(node.transform.mirrorV).toBe(false);
  });

  test('converts nested group with parentGroupId', () => {
    const g = makeGroup({ id: 'g2', parentGroupId: 'g1' });
    const node = groupToNode2(g);
    expect(node.parentId).toBe('g1');
  });
});

// ── Nested hierarchy integration test ──────────────────────────────────

describe('nested hierarchy conversion', () => {
  test('two-level group hierarchy matches legacy chained transform', () => {
    const outerGroup = makeGroup({
      id: 'outer', translateX: 100, translateY: 100, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: true, mirrorV: false,
    });
    const innerGroup = makeGroup({
      id: 'inner', parentGroupId: 'outer',
      translateX: 10, translateY: 10, scaleX: 2, scaleY: 2,
      rotation: 90, mirrorH: false, mirrorV: false,
    });
    const fig = makeFigure({
      id: 'fig_nested', resolutionX: 2, resolutionY: 2,
      cellX: 0, cellY: 0, cellWidth: 0, cellHeight: 0, // world (placeholder)
      groupId: 'inner',
      localCellX: 1, localCellY: 2, localCellWidth: 4, localCellHeight: 4,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
    });

    // Legacy chained transform: [inner, outer] applied to local bbox
    const legacyWorld = applyChainedGroupTransform(
      [innerGroup, outerGroup],
      { cellX: 1, cellY: 2, cellWidth: 4, cellHeight: 4 },
    );

    // New system
    const outerNode = groupToNode2(outerGroup);
    const innerNode = groupToNode2(innerGroup);
    const figNode = figureToNode(fig);

    const cache = new WorldTransformCache();
    const nodes = new Map<string, NodeTransformInfo>([
      [outerNode.id, outerNode],
      [innerNode.id, innerNode],
      [figNode.id, figNode],
    ]);
    const worldBbox = cache.getWorldBbox(figNode.id, figNode.localBbox, id => nodes.get(id));

    expect(bboxClose(worldBbox, legacyWorld)).toBe(true);
  });

  test('three-level hierarchy with mixed transforms', () => {
    const g1 = makeGroup({
      id: 'g1', translateX: 50, translateY: 50, scaleX: 2, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    });
    const g2 = makeGroup({
      id: 'g2', parentGroupId: 'g1',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 3,
      rotation: 90, mirrorH: false, mirrorV: false,
    });
    const g3 = makeGroup({
      id: 'g3', parentGroupId: 'g2',
      translateX: 5, translateY: -2, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: true, mirrorV: false,
    });
    const fig = makeFigure({
      id: 'fig_deep', resolutionX: 4, resolutionY: 2,
      cellX: 0, cellY: 0, cellWidth: 0, cellHeight: 0,
      groupId: 'g3',
      localCellX: 1, localCellY: 1, localCellWidth: 8, localCellHeight: 4,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
    });

    // Legacy
    const legacyWorld = applyChainedGroupTransform(
      [g3, g2, g1],
      { cellX: 1, cellY: 1, cellWidth: 8, cellHeight: 4 },
    );

    // New system
    const cache = new WorldTransformCache();
    const nodes = new Map<string, NodeTransformInfo>([
      [g1.id, groupToNode2(g1)],
      [g2.id, groupToNode2(g2)],
      [g3.id, groupToNode2(g3)],
    ]);
    const figNode = figureToNode(fig);
    nodes.set(figNode.id, figNode);
    const worldBbox = cache.getWorldBbox(figNode.id, figNode.localBbox, id => nodes.get(id));

    expect(bboxClose(worldBbox, legacyWorld)).toBe(true);
  });
});
