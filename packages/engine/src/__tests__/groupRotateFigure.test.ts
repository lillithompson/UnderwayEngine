import {
  applyCompOps,
  composeOrientations,
  computeSVGBbox,
  materializeGroupMembers,
  transformQuadsByGroup,
} from '../compositionOps';
import { SVGObject, PathSegment, CompositionFigure, CompositionState, CompUndoEntry, FigureQuad, GroupNode, makeViewport } from '../types';

const WHITE = { r: 255, g: 255, b: 255 };

function makeState(over: Partial<CompositionState> = {}): CompositionState {
  const figures = over.figures ?? [];
  const svgObjects = over.svgObjects ?? [];
  return {
    id: 't', name: 't',
    figures, svgObjects,
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: WHITE,
    customColors: [],
    groups: [],
    sceneOrder: [...figures.map((f) => f.id), ...svgObjects.map((s) => s.id)],
    gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null, compTool: 'select',
    createRegion: null, renderGeneration: 0,
    ...over,
  };
}

function makeFigure(over: Partial<CompositionFigure> & { id: string }): CompositionFigure {
  return {
    figureKey: 'k',
    cellX: 0, cellY: 0,
    resolutionX: 2, resolutionY: 2,
    cellWidth: 2, cellHeight: 2,
    ...over,
  };
}

function makeSVGFromVertices(id: string, vertices: [number, number][], over: Partial<SVGObject> = {}): SVGObject {
  const segments: PathSegment[] = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    segments.push({ kind: 'line', start: vertices[i], end: vertices[i + 1] });
  }
  return { id, segments, color: WHITE, ...computeSVGBbox(segments), ...over };
}

function makeSVG(id: string, segments: PathSegment[], over: Partial<SVGObject> = {}): SVGObject {
  return { id, segments, color: WHITE, ...computeSVGBbox(segments), ...over };
}

describe('composeOrientations', () => {
  test('group rotation 90 onto local rotation 0 yields rotation 90', () => {
    expect(composeOrientations(
      { rotation: 90, mirrorH: false, mirrorV: false },
      { rotation: 0, mirrorH: false, mirrorV: false },
    )).toEqual({ rotation: 90, mirrorH: false, mirrorV: false });
  });

  test('group rotation 90 onto local rotation 90 yields rotation 180', () => {
    expect(composeOrientations(
      { rotation: 90, mirrorH: false, mirrorV: false },
      { rotation: 90, mirrorH: false, mirrorV: false },
    )).toEqual({ rotation: 180, mirrorH: false, mirrorV: false });
  });

  test('four 90° rotations compose back to identity', () => {
    let cur = { rotation: 0 as 0 | 90 | 180 | 270, mirrorH: false, mirrorV: false };
    for (let i = 0; i < 4; i++) {
      cur = composeOrientations({ rotation: 90, mirrorH: false, mirrorV: false }, cur);
    }
    expect(cur).toEqual({ rotation: 0, mirrorH: false, mirrorV: false });
  });

  test('mirror twice on the same axis cancels out', () => {
    const once = composeOrientations(
      { rotation: 0, mirrorH: true, mirrorV: false },
      { rotation: 0, mirrorH: false, mirrorV: false },
    );
    const twice = composeOrientations(
      { rotation: 0, mirrorH: true, mirrorV: false },
      once,
    );
    expect(twice).toEqual({ rotation: 0, mirrorH: false, mirrorV: false });
  });

  test('canonical form picks fewer mirrors over equivalent rotation', () => {
    // mirrorH ∘ mirrorV = rotation 180 (matrix [[-1,0],[0,-1]]).
    // Decomposer prefers `(rotation: 180, no mirrors)` over `(rotation: 0, both mirrors)`.
    expect(composeOrientations(
      { rotation: 0, mirrorH: true, mirrorV: false },
      { rotation: 0, mirrorH: false, mirrorV: true },
    )).toEqual({ rotation: 180, mirrorH: false, mirrorV: false });
  });
});

describe('transformQuadsByGroup', () => {
  test('rotation 90 swaps each quad axis and translates within the bbox', () => {
    const quads: FigureQuad[] = [{ offsetX: 0, offsetY: 0, cellWidth: 1, cellHeight: 2 }];
    const out = transformQuadsByGroup(quads, { cellWidth: 2, cellHeight: 2 }, { rotation: 90, mirrorH: false, mirrorV: false });
    // 90° CW within a 2×2 bound: (0,0,1,2) becomes offsetY swapped with width.
    // rotateQuad90CW formula: { offsetX: boundH - q.offsetY - q.cellHeight, offsetY: q.offsetX, cellW: q.cellH, cellH: q.cellW }
    // → (offsetX = 2 - 0 - 2 = 0, offsetY = 0, cellW = 2, cellH = 1)
    expect(out).toEqual([{ offsetX: 0, offsetY: 0, cellWidth: 2, cellHeight: 1 }]);
  });

  test('mirrorH flips offset across the bbox width', () => {
    const quads: FigureQuad[] = [{ offsetX: 0, offsetY: 0, cellWidth: 1, cellHeight: 1 }];
    const out = transformQuadsByGroup(quads, { cellWidth: 4, cellHeight: 4 }, { rotation: 0, mirrorH: true, mirrorV: false });
    expect(out).toEqual([{ offsetX: 3, offsetY: 0, cellWidth: 1, cellHeight: 1 }]);
  });
});

describe('materializeGroupMembers — figure orientation propagation', () => {
  test('rotating a group rotates its figure member (the user-reported bug)', () => {
    // A figure grouped at identity, then the group rotates 90°. Before
    // this fix, the figure's bbox followed the group rotation but its
    // `rotation` field stayed at 0, so the rendered sprite did not rotate.
    const fig = makeFigure({
      id: 'f1', cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2,
      groupId: 'g1',
      localCellX: 0, localCellY: 0, localCellWidth: 2, localCellHeight: 2,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
    });
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 90, mirrorH: false, mirrorV: false };
    const state = makeState({ figures: [fig], groups: [group] });
    const next = materializeGroupMembers(state, 'g1');
    expect(next.figures[0].rotation).toBe(90);
    // Bbox dims swap under 90°, but for a 2×2 figure they're unchanged.
    expect(next.figures[0].cellWidth).toBe(2);
    expect(next.figures[0].cellHeight).toBe(2);
  });

  test('a figure that already has rotation=90 in a group rotated 90° composes to 180', () => {
    const fig = makeFigure({
      id: 'f1', cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2,
      groupId: 'g1',
      localCellX: 0, localCellY: 0, localCellWidth: 2, localCellHeight: 2,
      localRotation: 90, localMirrorH: false, localMirrorV: false,
    });
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 90, mirrorH: false, mirrorV: false };
    const state = makeState({ figures: [fig], groups: [group] });
    const next = materializeGroupMembers(state, 'g1');
    expect(next.figures[0].rotation).toBe(180);
  });

  test('group mirror H flips the figure mirror H', () => {
    const fig = makeFigure({
      id: 'f1', cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2,
      groupId: 'g1',
      localCellX: 0, localCellY: 0, localCellWidth: 2, localCellHeight: 2,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
    });
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: true, mirrorV: false };
    const state = makeState({ figures: [fig], groups: [group] });
    const next = materializeGroupMembers(state, 'g1');
    expect(next.figures[0].mirrorH).toBe(true);
    expect(next.figures[0].mirrorV).toBe(false);
  });

  test('group rotation propagates to figure quads inside the group', () => {
    const localQuads: FigureQuad[] = [{ offsetX: 0, offsetY: 0, cellWidth: 1, cellHeight: 2 }];
    const fig = makeFigure({
      id: 'f1', cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2,
      groupId: 'g1',
      localCellX: 0, localCellY: 0, localCellWidth: 2, localCellHeight: 2,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
      localQuads,
      quads: localQuads,
    });
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 90, mirrorH: false, mirrorV: false };
    const state = makeState({ figures: [fig], groups: [group] });
    const next = materializeGroupMembers(state, 'g1');
    expect(next.figures[0].quads).toEqual([{ offsetX: 0, offsetY: 0, cellWidth: 2, cellHeight: 1 }]);
  });

  test('mixed group (figure + svg objects) — group rotation rotates all uniformly', () => {
    // The user-reported scenario: a figure grouped with svg objects.
    // Rotating the group rotates the figure (this fix), and the svg
    // objects continue to rotate via point-by-point applyGroupTransformPoint.
    const fig = makeFigure({
      id: 'f1', cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2,
      groupId: 'g1',
      localCellX: 0, localCellY: 0, localCellWidth: 2, localCellHeight: 2,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
    });
    const svgLine = makeSVGFromVertices('l1', [[0, 0], [4, 0]], {
      groupId: 'g1',
      localSegments: [{ kind: 'line', start: [0, 0], end: [4, 0] }],
      localCellX: 0, localCellY: 0, localCellWidth: 4, localCellHeight: 0,
    });
    const svgArc = makeSVG('a1', [{ kind: 'arc', start: [1, 0], end: [0, 1], center: [0, 0] }], {
      groupId: 'g1',
      localSegments: [{ kind: 'arc', start: [1, 0], end: [0, 1], center: [0, 0] }],
      localCellX: 0, localCellY: 0, localCellWidth: 1, localCellHeight: 1,
    });
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 90, mirrorH: false, mirrorV: false };
    const state = makeState({ figures: [fig], svgObjects: [svgLine, svgArc], groups: [group] });
    const next = materializeGroupMembers(state, 'g1');
    expect(next.figures[0].rotation).toBe(90);
    // Line segment end (4, 0) rotated 90° CW around the group's local origin
    // (translate=0, no pivot adjust) lands at (0, 4).
    expect(next.svgObjects[0].segments[0].end).toEqual([0, 4]);
    // Arc's center (0, 0) stays at (0, 0); its start (1, 0) rotates to (0, 1).
    const segs = next.svgObjects[1].segments[0];
    if (segs.kind === 'arc') {
      expect(segs.center).toEqual([0, 0]);
      expect(segs.start).toEqual([0, 1]);
    }
  });
});

describe('groupFigures op seeds local orientation', () => {
  test('seeds localRotation / localMirrorH / localMirrorV / localQuads from world', () => {
    const fig = makeFigure({
      id: 'f1', cellX: 1, cellY: 1, cellWidth: 2, cellHeight: 4,
      rotation: 90, mirrorH: true, mirrorV: false,
      quads: [{ offsetX: 0, offsetY: 0, cellWidth: 2, cellHeight: 4 }],
    });
    const state = makeState({ figures: [fig] });
    const entry: CompUndoEntry = [{
      op: 'groupFigures',
      figureIds: ['f1'],
      groupId: 'g1',
      groupName: 'G',
      oldNames: [undefined],
    }];
    const after = applyCompOps(state, entry);
    expect(after.figures[0].localRotation).toBe(90);
    expect(after.figures[0].localMirrorH).toBe(true);
    expect(after.figures[0].localMirrorV).toBe(false);
    expect(after.figures[0].localQuads).toEqual([{ offsetX: 0, offsetY: 0, cellWidth: 2, cellHeight: 4 }]);
  });

  test('ungroup clears local orientation alongside other locals', () => {
    const fig = makeFigure({
      id: 'f1', cellX: 1, cellY: 1, cellWidth: 2, cellHeight: 2,
      groupId: 'g1',
      localCellX: 1, localCellY: 1, localCellWidth: 2, localCellHeight: 2,
      localRotation: 90, localMirrorH: false, localMirrorV: false,
      localQuads: [{ offsetX: 0, offsetY: 0, cellWidth: 2, cellHeight: 2 }],
    });
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    const state = makeState({ figures: [fig], groups: [group] });
    const entry: CompUndoEntry = [{
      op: 'ungroupFigures',
      figureIds: ['f1'],
      groupId: 'g1',
      groupName: 'G',
    }];
    const after = applyCompOps(state, entry);
    expect(after.figures[0].localRotation).toBeUndefined();
    expect(after.figures[0].localMirrorH).toBeUndefined();
    expect(after.figures[0].localMirrorV).toBeUndefined();
    expect(after.figures[0].localQuads).toBeUndefined();
  });
});

describe('groupFigures op seeds local fields on svg objects', () => {
  test('seeds localCellX/Y/W/H on line-like svg objects', () => {
    const svgLine = makeSVGFromVertices('l1', [[1, 2], [5, 2]]);
    const state = makeState({ svgObjects: [svgLine] });
    const entry: CompUndoEntry = [{
      op: 'groupFigures', figureIds: ['l1'], groupId: 'g1', groupName: 'G', oldNames: [undefined],
    }];
    const after = applyCompOps(state, entry);
    expect(after.svgObjects[0].localSegments).toBeDefined();
    expect(after.svgObjects[0].localCellX).toBe(svgLine.cellX);
    expect(after.svgObjects[0].localCellY).toBe(svgLine.cellY);
    expect(after.svgObjects[0].localCellWidth).toBe(svgLine.cellWidth);
    expect(after.svgObjects[0].localCellHeight).toBe(svgLine.cellHeight);
  });

  test('seeds localCellX/Y/W/H on arc-like svg objects', () => {
    const svgArc = makeSVG('a1', [{ kind: 'arc', start: [0, 0], end: [3, 3], center: [0, 3] }]);
    const state = makeState({ svgObjects: [svgArc] });
    const entry: CompUndoEntry = [{
      op: 'groupFigures', figureIds: ['a1'], groupId: 'g1', groupName: 'G', oldNames: [undefined],
    }];
    const after = applyCompOps(state, entry);
    expect(after.svgObjects[0].localSegments).toBeDefined();
    expect(after.svgObjects[0].localCellX).toBe(svgArc.cellX);
    expect(after.svgObjects[0].localCellY).toBe(svgArc.cellY);
    expect(after.svgObjects[0].localCellWidth).toBe(svgArc.cellWidth);
    expect(after.svgObjects[0].localCellHeight).toBe(svgArc.cellHeight);
  });
});

describe('end-to-end group rotate/mirror via applyCompOps then materialize', () => {
  test('svg-objects-only group — rotation updates segments', () => {
    const s1 = makeSVGFromVertices('l1', [[0, 0], [4, 0]]);
    const s2 = makeSVGFromVertices('l2', [[0, 2], [4, 2]]);
    const state = makeState({ svgObjects: [s1, s2] });
    const grouped = applyCompOps(state, [{
      op: 'groupFigures', figureIds: ['l1', 'l2'], groupId: 'g1', groupName: 'G', oldNames: [undefined, undefined],
    }]);
    // Rotate the group by 90
    const groups = grouped.groups.map(g => g.id === 'g1' ? { ...g, rotation: 90 as const } : g);
    const rotated = materializeGroupMembers({ ...grouped, groups }, 'g1');
    // After 90 CW rotation around origin, end (4, 0) -> (0, 4)
    expect(rotated.svgObjects[0].segments[0].end).toEqual([0, 4]);
    // end (4, 2) -> (-2, 4)
    expect(rotated.svgObjects[1].segments[0].end).toEqual([-2, 4]);
    // Segments should differ from original
    expect(rotated.svgObjects[0].segments).not.toEqual(s1.segments);
    expect(rotated.svgObjects[1].segments).not.toEqual(s2.segments);
  });

  test('arc-like svg objects group — rotation updates segments', () => {
    const a1 = makeSVG('a1', [{ kind: 'arc', start: [1, 0], end: [0, 1], center: [0, 0] }]);
    const a2 = makeSVG('a2', [{ kind: 'line', start: [2, 0], end: [2, 3] }]);
    const state = makeState({ svgObjects: [a1, a2] });
    const grouped = applyCompOps(state, [{
      op: 'groupFigures', figureIds: ['a1', 'a2'], groupId: 'g1', groupName: 'G', oldNames: [undefined, undefined],
    }]);
    const groups = grouped.groups.map(g => g.id === 'g1' ? { ...g, rotation: 90 as const } : g);
    const rotated = materializeGroupMembers({ ...grouped, groups }, 'g1');
    // Arc start (1, 0) rotated 90 CW -> (0, 1)
    const seg0 = rotated.svgObjects[0].segments[0];
    expect(seg0.start).toEqual([0, 1]);
    // Segments should differ from original
    expect(rotated.svgObjects[0].segments).not.toEqual(a1.segments);
    expect(rotated.svgObjects[1].segments).not.toEqual(a2.segments);
  });

  test('mixed group — mirror flips all member types', () => {
    const fig = makeFigure({
      id: 'f1', cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2,
    });
    const svgLine = makeSVGFromVertices('l1', [[2, 0], [6, 0]]);
    const svgArc = makeSVG('a1', [{ kind: 'arc', start: [1, 0], end: [0, 1], center: [0, 0] }]);
    const state = makeState({ figures: [fig], svgObjects: [svgLine, svgArc] });
    const grouped = applyCompOps(state, [{
      op: 'groupFigures', figureIds: ['f1', 'l1', 'a1'], groupId: 'g1', groupName: 'G',
      oldNames: [undefined, undefined, undefined],
    }]);
    // Mirror horizontally
    const groups = grouped.groups.map(g => g.id === 'g1' ? { ...g, mirrorH: true } : g);
    const mirrored = materializeGroupMembers({ ...grouped, groups }, 'g1');
    // Figure mirrorH should be composed
    expect(mirrored.figures[0].mirrorH).toBe(true);
    // Line segment start (2, 0) -> (-2, 0), end (6, 0) -> (-6, 0)
    expect(mirrored.svgObjects[0].segments[0].start[0]).toBe(-2);
    expect(mirrored.svgObjects[0].segments[0].end[0]).toBe(-6);
    // Arc start (1, 0) -> (-1, 0)
    expect(mirrored.svgObjects[1].segments[0].start[0]).toBe(-1);
  });
});
