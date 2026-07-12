import {
  applySceneOrder,
  deriveSceneOrderFromKindArrays,
  findFigureAtCell,
  findImageAtCell,
} from '../compositionOps';
import {
  CompositionFigure,
  CompositionState,
  GroupNode,
  ImageObject,
  SVGObject,
  makeViewport,
} from '../types';

const WHITE = { r: 255, g: 255, b: 255 };

function makeFigure(id: string, overrides: Partial<CompositionFigure> = {}): CompositionFigure {
  return {
    id,
    figureKey: 'k',
    cellX: 0, cellY: 0,
    resolutionX: 2, resolutionY: 2,
    cellWidth: 2, cellHeight: 2,
    ...overrides,
  };
}

function makeImage(id: string, overrides: Partial<ImageObject> = {}): ImageObject {
  return {
    id,
    imageId: id,
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
    pixelWidth: 64, pixelHeight: 64,
    mimeType: 'image/png',
    ...overrides,
  };
}

function makeState(parts: Partial<CompositionState> = {}): CompositionState {
  const figures = parts.figures ?? [];
  const svgObjects = parts.svgObjects ?? [];
  const images = parts.images ?? [];
  return {
    id: 't', name: 't',
    figures, svgObjects, images, imageBlobs: {},
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: WHITE,
    customColors: [],
    groups: parts.groups ?? [],
    sceneOrder: parts.sceneOrder ?? deriveSceneOrderFromKindArrays({ figures, svgObjects, images }),
    gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null,
    compTool: 'select',
    createRegion: null,
    renderGeneration: 0,
    ...parts,
  };
}

describe('findFigureAtCell — z-order respects sceneOrder', () => {
  test('after applySceneOrder swaps a back figure to the front, hit-test returns the new front figure', () => {
    // BIG covers (0,0)-(10,10). SMALL covers (4,4)-(7,7), inside BIG.
    const big = makeFigure('big', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const small = makeFigure('small', { cellX: 4, cellY: 4, cellWidth: 3, cellHeight: 3 });
    // Initial: big created first so it's at the back; small on top.
    let state = makeState({ figures: [big, small] });
    expect(state.sceneOrder).toEqual(['big', 'small']);
    expect(findFigureAtCell(5, 5, state)).toBe('small');

    // Drag big in front of small in the Scene Outline. applySceneOrder
    // updates sceneOrder but leaves state.figures untouched — exactly the
    // condition that triggered the original bug.
    state = applySceneOrder(state, ['small', 'big']);
    expect(state.figures.map(f => f.id)).toEqual(['big', 'small']); // unchanged
    expect(findFigureAtCell(5, 5, state)).toBe('big');
  });

  test('non-overlapping figures still resolve to the figure under the point', () => {
    const a = makeFigure('a', { cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 });
    const b = makeFigure('b', { cellX: 5, cellY: 5, cellWidth: 2, cellHeight: 2 });
    const state = makeState({ figures: [a, b] });
    expect(findFigureAtCell(1, 1, state)).toBe('a');
    expect(findFigureAtCell(6, 6, state)).toBe('b');
    expect(findFigureAtCell(20, 20, state)).toBeNull();
  });

  test('locked figures are skipped even when on top in sceneOrder', () => {
    const big = makeFigure('big', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const small = { ...makeFigure('small', { cellX: 4, cellY: 4, cellWidth: 3, cellHeight: 3 }), locked: true };
    const state = makeState({ figures: [big, small] });
    expect(findFigureAtCell(5, 5, state)).toBe('big');
  });

  test('hidden ungrouped figure is not picked even when it covers the point', () => {
    const fig = { ...makeFigure('f', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 }), hidden: true };
    const state = makeState({ figures: [fig] });
    expect(findFigureAtCell(5, 5, state)).toBeNull();
  });

  test('hidden figure z-above a visible figure falls through to the visible one', () => {
    const big = makeFigure('big', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const small = { ...makeFigure('small', { cellX: 4, cellY: 4, cellWidth: 3, cellHeight: 3 }), hidden: true };
    const state = makeState({ figures: [big, small] });
    expect(findFigureAtCell(5, 5, state)).toBe('big');
  });

  test('group whose figure member is hidden is skipped (negative-space bbox fallback)', () => {
    // Two figures grouped, far apart; the click is in the gap inside groupBounds.
    const a = makeFigure('a', { groupId: 'g', cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 });
    const b = { ...makeFigure('b', { groupId: 'g', cellX: 20, cellY: 20, cellWidth: 2, cellHeight: 2 }), hidden: true };
    const group = makeGroup('g');
    const state = makeState({ figures: [a, b], groups: [group] });
    // (10, 10) is in the group's bbox but outside both members' own bboxes.
    // With one member hidden, the bbox-fallback group hit must be skipped.
    expect(findFigureAtCell(10, 10, state)).toBeNull();
  });

  test('quad figures hit-test against each quad, not the bounding box', () => {
    const fig = makeFigure('f', {
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
      quads: [
        { offsetX: 0, offsetY: 0, cellWidth: 2, cellHeight: 2 },
        { offsetX: 2, offsetY: 2, cellWidth: 2, cellHeight: 2 },
      ],
    });
    const state = makeState({ figures: [fig] });
    expect(findFigureAtCell(1, 1, state)).toBe('f');
    expect(findFigureAtCell(3, 3, state)).toBe('f');
    // Inside the bounding box but outside both quads.
    expect(findFigureAtCell(0.5, 3.5, state)).toBeNull();
  });
});

describe('findImageAtCell — z-order respects sceneOrder', () => {
  test('after applySceneOrder swaps a back image to the front, hit-test returns the new front image', () => {
    const big = makeImage('big', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const small = makeImage('small', { cellX: 4, cellY: 4, cellWidth: 3, cellHeight: 3 });
    let state = makeState({ images: [big, small] });
    expect(findImageAtCell(5, 5, state)).toBe('small');

    state = applySceneOrder(state, ['small', 'big']);
    expect(state.images!.map(i => i.id)).toEqual(['big', 'small']); // unchanged
    expect(findImageAtCell(5, 5, state)).toBe('big');
  });

  test('locked images are skipped', () => {
    const big = makeImage('big', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const small = { ...makeImage('small', { cellX: 4, cellY: 4, cellWidth: 3, cellHeight: 3 }), locked: true };
    const state = makeState({ images: [big, small] });
    expect(findImageAtCell(5, 5, state)).toBe('big');
  });

  test('hidden ungrouped image is not picked', () => {
    const img = { ...makeImage('i', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 }), hidden: true };
    const state = makeState({ images: [img] });
    expect(findImageAtCell(5, 5, state)).toBeNull();
  });

  test('hidden image z-above a visible image falls through to the visible one', () => {
    const big = makeImage('big', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const small = { ...makeImage('small', { cellX: 4, cellY: 4, cellWidth: 3, cellHeight: 3 }), hidden: true };
    const state = makeState({ images: [big, small] });
    expect(findImageAtCell(5, 5, state)).toBe('big');
  });

  test('returns null when no images and tolerates undefined images array', () => {
    const state = makeState();
    expect(findImageAtCell(0, 0, state)).toBeNull();
  });
});

const BLACK = { r: 0, g: 0, b: 0 };

function makeSVG(id: string, overrides: Partial<SVGObject> = {}): SVGObject {
  // Default segments must match cellX/cellY because groupBounds uses segment
  // endpoints, not cellX/cellY, for SVG bbox computation.
  const cellX = (overrides.cellX ?? 0);
  const cellY = (overrides.cellY ?? 0);
  const cellWidth = (overrides.cellWidth ?? 1);
  const cellHeight = (overrides.cellHeight ?? 1);
  return {
    id,
    segments: [{ kind: 'line' as const, start: [cellX, cellY] as [number, number], end: [cellX + cellWidth, cellY + cellHeight] as [number, number] }],
    color: BLACK,
    cellX, cellY, cellWidth, cellHeight,
    ...overrides,
  };
}

function makeGroup(id: string, overrides: Partial<GroupNode> = {}): GroupNode {
  return {
    id,
    name: id,
    translateX: 0, translateY: 0,
    scaleX: 1, scaleY: 1,
    rotation: 0, mirrorH: false, mirrorV: false,
    ...overrides,
  };
}

describe('findFigureAtCell — nested group bbox', () => {
  test('hit-tests the full descendant bbox of a root group, not just direct members', () => {
    // Root group "root" has one direct SVG near Y=0 and a child group "child"
    // whose SVG is near Y=100.  A click at Y=50 is inside the full bbox
    // (Y=0..110) but outside both individual member bboxes.
    const svgDirect = makeSVG('s1', { groupId: 'root', cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const svgChild = makeSVG('s2', { groupId: 'child', cellX: 0, cellY: 100, cellWidth: 10, cellHeight: 10 });
    const rootGroup = makeGroup('root');
    const childGroup = makeGroup('child', { parentGroupId: 'root' });

    const state = makeState({
      svgObjects: [svgDirect, svgChild],
      groups: [rootGroup, childGroup],
    });

    // Click at (5, 50) — in the gap between direct member (Y=0..10) and
    // child member (Y=100..110).  Should find a member of the root group.
    expect(findFigureAtCell(5, 50, state)).not.toBeNull();
  });

  test('returns null when clicking outside the full descendant bbox', () => {
    const svgDirect = makeSVG('s1', { groupId: 'root', cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const svgChild = makeSVG('s2', { groupId: 'child', cellX: 0, cellY: 100, cellWidth: 10, cellHeight: 10 });
    const rootGroup = makeGroup('root');
    const childGroup = makeGroup('child', { parentGroupId: 'root' });

    const state = makeState({
      svgObjects: [svgDirect, svgChild],
      groups: [rootGroup, childGroup],
    });

    // Click at Y=200 — outside both the direct and full bbox.
    expect(findFigureAtCell(5, 200, state)).toBeNull();
  });

  test('figure-anchored nested groups include descendants in bbox', () => {
    // Root group has a figure member and a child group with another figure.
    const figDirect = makeFigure('f1', { groupId: 'root', cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const figChild = makeFigure('f2', { groupId: 'child', cellX: 0, cellY: 100, cellWidth: 10, cellHeight: 10 });
    const rootGroup = makeGroup('root');
    const childGroup = makeGroup('child', { parentGroupId: 'root' });

    const state = makeState({
      figures: [figDirect, figChild],
      groups: [rootGroup, childGroup],
    });

    // Gap between direct member and child member — should still hit.
    expect(findFigureAtCell(5, 50, state)).not.toBeNull();
  });
});

describe('findFigureAtCell — Mannequin1.tile regression', () => {
  test('click at visual center of nested group selects a member', () => {
    const fs = require('fs');
    const zlib = require('zlib');
    const path = require('path');
    const { deserializeComposition } = require('../compositionBinaryFormat');
    const compressed = fs.readFileSync(path.join(__dirname, '../../test_data/Mannequin1.tile'));
    const payload = new Uint8Array(zlib.inflateSync(compressed));
    const result = deserializeComposition(payload);

    const state = makeState({
      figures: result.meta.figures,
      svgObjects: result.meta.svgObjects,
      images: result.meta.images,
      groups: result.meta.groups,
      sceneOrder: result.meta.sceneOrder,
    });

    // (160, 944) is the center of the full-descendants bbox of the root
    // "Mannequin" group.  Without the fix, groupBounds excluded nested
    // sub-group members and maxY was only 732, so this point missed.
    expect(findFigureAtCell(160, 944, state)).not.toBeNull();
  });
});
