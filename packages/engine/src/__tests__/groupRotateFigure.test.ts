import {
  applyCompOps,
  composeOrientations,
  computeSVGBbox,
  transformQuadsByGroup,
} from '../compositionOps';
import { SVGObject, PathSegment, CompositionFigure, CompositionState, FigureQuad, GroupNode, makeViewport } from '../types';
import { flipOf, poseOf, setGroupTransform, turnOf } from './groupTransform.test-utils';
import { fromLegacy, worldMatrix } from '../sceneGraph';
import { leafHitFrame } from '../sceneHitFrame';

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

describe('a group transform propagates a figure member\'s orientation', () => {
  test('rotating a group rotates its figure member (the user-reported bug)', () => {
    // A figure grouped at identity, then the group rotates 90°. Before
    // this fix, the figure's bbox followed the group rotation but its
    // `rotation` field stayed at 0, so the rendered sprite did not rotate.
    const fig = makeFigure({
      id: 'f1', cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2,
      groupId: 'g1',
    });
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    const state = makeState({ figures: [fig], groups: [group] });
    const next = setGroupTransform(state, 'g1', { rotation: 90 });
    expect(turnOf(next, 'f1')).toBe(90);
    // Bbox dims swap under 90°, but for a 2×2 figure they're unchanged.
    expect(next.figures[0].cellWidth).toBe(2);
    expect(next.figures[0].cellHeight).toBe(2);
  });

  test('a figure that already has rotation=90 in a group rotated 90° composes to 180', () => {
    const fig = makeFigure({
      id: 'f1', cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2,
      groupId: 'g1',
      rotation: 90,
    });
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    const state = makeState({ figures: [fig], groups: [group] });
    const next = setGroupTransform(state, 'g1', { rotation: 90 });
    expect(turnOf(next, 'f1')).toBe(180);
  });

  test('mirroring a group flips its figure member across the group origin', () => {
    const fig = makeFigure({
      id: 'f1', cellX: 1, cellY: 0, cellWidth: 2, cellHeight: 2,
      groupId: 'g1',
    });
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    const state = makeState({ figures: [fig], groups: [group] });
    const next = setGroupTransform(state, 'g1', { mirrorH: true });
    // Handedness reversed. WHICH axis is not asked: a flip about one is a
    // flip about the other plus a half turn, and both spellings draw the
    // same picture — so the question is where the figure ended up.
    expect(flipOf(next, 'f1')).toBe(true);
    // x ∈ [1, 3] reflects about x = 0 to x ∈ [-3, -1]; y is untouched.
    expect(poseOf(next, 'f1').at).toEqual([-2, 1]);
    expect(poseOf(next, 'f1').box).toEqual([2, 2]);
  });

  test('a group quarter turn is carried by a figure\'s frame, not its quad list', () => {
    // The legacy pass re-spelled the quad list on every quarter turn —
    // each offset rewritten into the new orientation and the box swapped.
    // The graph keeps a figure's quads in its own content frame and spends
    // the quarter in the frame's matrix instead (`sceneHitFrame.quadSpinDeg`).
    // Same picture, one fewer rewrite, and — the part worth pinning — a
    // graph rebuilt from the arrays this wrote reads the quads in exactly
    // the same frame, so the spelling survives a save and reopen.
    const quads: FigureQuad[] = [{ offsetX: 0, offsetY: 0, cellWidth: 1, cellHeight: 2 }];
    const fig = makeFigure({
      id: 'f1', cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2,
      groupId: 'g1', rotation: 0, quads,
    });
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    const state = makeState({ figures: [fig], groups: [group] });
    const next = setGroupTransform(state, 'g1', { rotation: 90 });

    expect(turnOf(next, 'f1')).toBe(90);
    expect(next.figures[0].quads).toEqual(quads);

    const rebuilt = fromLegacy(next);
    const live = next.graph ?? rebuilt;
    const frameOf = (g: typeof rebuilt) =>
      leafHitFrame(g.nodes.get('f1')!, worldMatrix(g, 'f1'));
    expect(frameOf(rebuilt).box).toEqual(frameOf(live).box);
    expect(frameOf(rebuilt).toNode).toEqual(frameOf(live).toNode);
  });

  test('mixed group (figure + svg objects) — group rotation rotates all uniformly', () => {
    // The user-reported scenario: a figure grouped with svg objects.
    // Rotating the group rotates the figure (this fix), and the svg
    // objects continue to rotate via point-by-point applyGroupTransformPoint.
    const fig = makeFigure({
      id: 'f1', cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2,
      groupId: 'g1',
    });
    const svgLine = makeSVGFromVertices('l1', [[0, 0], [4, 0]], { groupId: 'g1' });
    const svgArc = makeSVG('a1', [{ kind: 'arc', start: [1, 0], end: [0, 1], center: [0, 0] }], { groupId: 'g1' });
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    const state = makeState({ figures: [fig], svgObjects: [svgLine, svgArc], groups: [group] });
    const next = setGroupTransform(state, 'g1', { rotation: 90 });
    expect(turnOf(next, 'f1')).toBe(90);
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

describe('grouping is not a move', () => {
  // These used to check that `groupFigures` SEEDED a member's `local*`
  // caches — its orientation, its quads, its box — from world. P6-B
  // retired the caches, so what is left to pin is the property they were
  // maintained FOR: joining or leaving a group changes where nothing is.

  test('a turned, flipped, quadded figure is drawn the same after grouping', () => {
    const fig = makeFigure({
      id: 'f1', cellX: 1, cellY: 1, cellWidth: 2, cellHeight: 4,
      rotation: 90, mirrorH: true, mirrorV: false,
      quads: [{ offsetX: 0, offsetY: 0, cellWidth: 2, cellHeight: 4 }],
    });
    const state = makeState({ figures: [fig] });
    const after = applyCompOps(state, [{
      op: 'groupFigures', figureIds: ['f1'], groupId: 'g1', groupName: 'G',
    }]);
    expect(after.figures[0].groupId).toBe('g1');
    expect(turnOf(after, 'f1')).toBe(turnOf(state, 'f1'));
    expect(flipOf(after, 'f1')).toBe(flipOf(state, 'f1'));
    expect(poseOf(after, 'f1').at).toEqual(poseOf(state, 'f1').at);
    expect(after.figures[0].quads).toEqual(fig.quads);
  });

  test('ungrouping drops the membership and leaves the pose', () => {
    const fig = makeFigure({
      id: 'f1', cellX: 1, cellY: 1, cellWidth: 2, cellHeight: 2,
      groupId: 'g1',
    });
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    const state = makeState({ figures: [fig], groups: [group] });
    const after = applyCompOps(state, [{
      op: 'ungroupFigures', figureIds: ['f1'], groupId: 'g1', groupName: 'G',
    }]);
    expect(after.figures[0].groupId).toBeUndefined();
    expect(poseOf(after, 'f1').at).toEqual(poseOf(state, 'f1').at);
    expect(turnOf(after, 'f1')).toBe(turnOf(state, 'f1'));
  });

  test('a line and an arc keep their paths and their boxes through grouping', () => {
    const svgLine = makeSVGFromVertices('l1', [[1, 2], [5, 2]]);
    const svgArc = makeSVG('a1', [{ kind: 'arc', start: [0, 0], end: [3, 3], center: [0, 3] }]);
    const state = makeState({ svgObjects: [svgLine, svgArc] });
    const after = applyCompOps(state, [{
      op: 'groupFigures', figureIds: ['l1', 'a1'], groupId: 'g1', groupName: 'G',
    }]);
    for (const before of [svgLine, svgArc]) {
      const now = after.svgObjects.find((s) => s.id === before.id)!;
      expect(now.groupId).toBe('g1');
      expect(now.segments).toEqual(before.segments);
      expect(now.cellX).toBe(before.cellX);
      expect(now.cellY).toBe(before.cellY);
      expect(now.cellWidth).toBe(before.cellWidth);
      expect(now.cellHeight).toBe(before.cellHeight);
    }
  });
});

describe('end-to-end group rotate/mirror via applyCompOps then materialize', () => {
  test('svg-objects-only group — rotation updates segments', () => {
    const s1 = makeSVGFromVertices('l1', [[0, 0], [4, 0]]);
    const s2 = makeSVGFromVertices('l2', [[0, 2], [4, 2]]);
    const state = makeState({ svgObjects: [s1, s2] });
    const grouped = applyCompOps(state, [{
      op: 'groupFigures', figureIds: ['l1', 'l2'], groupId: 'g1', groupName: 'G',
    }]);
    const rotated = setGroupTransform(grouped, 'g1', { rotation: 90 });
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
      op: 'groupFigures', figureIds: ['a1', 'a2'], groupId: 'g1', groupName: 'G',
    }]);
    const rotated = setGroupTransform(grouped, 'g1', { rotation: 90 });
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
    }]);
    // Mirror horizontally
    const mirrored = setGroupTransform(grouped, 'g1', { mirrorH: true });
    // The figure comes out flipped
    expect(flipOf(mirrored, 'f1')).toBe(true);
    // Line segment start (2, 0) -> (-2, 0), end (6, 0) -> (-6, 0)
    expect(mirrored.svgObjects[0].segments[0].start[0]).toBe(-2);
    expect(mirrored.svgObjects[0].segments[0].end[0]).toBe(-6);
    // Arc start (1, 0) -> (-1, 0)
    expect(mirrored.svgObjects[1].segments[0].start[0]).toBe(-1);
  });
});
