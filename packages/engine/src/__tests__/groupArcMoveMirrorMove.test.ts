/**
 * Regression: an arc-only group used to fall through to a per-member
 * move path that shifted both world and local segments by (dx, dy).
 * That was equivalent to the group-translate path only when the
 * group's mirror/rotation were identity. Once the group had been
 * mirrored (translate adjusted to pivot around the local center), a
 * second move desynced locals from world, and the next rotate or
 * mirror pivoted far outside the visible bbox.
 *
 * These tests assert the user's exact repro: group → translate →
 * mirror → translate → rotate. The post-rotate world-bbox center must
 * equal the pre-rotate world-bbox center (pivot stays at the visible
 * center). Equivalent coverage for line-only and mixed groups guards
 * the unified-path refactor.
 */

import {
  applyCompOps,
  applyGroupTransformPoint,
  bucketMovedIds,
  computeSVGBbox,
  groupBounds,
  groupLocalCenter,
  materializeGroupMembers,
} from '../compositionOps';
import {
  SVGObject,
  PathSegment,
  CompositionFigure,
  CompositionState,
  makeViewport,
} from '../types';

const WHITE = { r: 255, g: 255, b: 255 };

function makeState(over: Partial<CompositionState> = {}): CompositionState {
  const figures = over.figures ?? [];
  const svgObjects = over.svgObjects ?? [];
  const images = over.images ?? [];
  const groups = over.groups ?? [];
  return {
    id: 't', name: 't',
    figures, svgObjects, images,
    imageBlobs: {},
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: WHITE,
    customColors: [],
    groups,
    sceneOrder: [
      ...images.map(i => i.id),
      ...figures.map(f => f.id),
      ...svgObjects.map(s => s.id),
    ],
    gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null, compTool: 'select',
    createRegion: null, renderGeneration: 0,
    ...over,
  };
}

function makeSVG(id: string, segments: PathSegment[], over: Partial<SVGObject> = {}): SVGObject {
  return { id, segments, color: WHITE, ...computeSVGBbox(segments), ...over };
}

function makeSVGFromVertices(id: string, vertices: [number, number][], over: Partial<SVGObject> = {}): SVGObject {
  const segments: PathSegment[] = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    segments.push({ kind: 'line', start: vertices[i], end: vertices[i + 1] });
  }
  return { id, segments, color: WHITE, ...computeSVGBbox(segments), ...over };
}

function makeFigure(id: string, over: Partial<CompositionFigure> = {}): CompositionFigure {
  return { id, figureKey: 'k', cellX: 0, cellY: 0, resolutionX: 2, resolutionY: 2,
    cellWidth: 2, cellHeight: 2, ...over };
}

/** Mimic the reducer's bucketed MOVE_FIGURES_DELTA: shift each touched
 *  group's translate by (dx, dy), materialize, and shift any ungrouped
 *  ids' world coords directly. */
function applyMoveDelta(state: CompositionState, ids: string[], dx: number, dy: number): CompositionState {
  const { groupIds, ungrouped } = bucketMovedIds(state, ids);
  const ungroupedSet = new Set(ungrouped);
  let next: CompositionState = {
    ...state,
    groups: state.groups.map(g => groupIds.has(g.id)
      ? { ...g, translateX: g.translateX + dx, translateY: g.translateY + dy }
      : g),
    figures: state.figures.map(f => ungroupedSet.has(f.id)
      ? { ...f, cellX: f.cellX + dx, cellY: f.cellY + dy }
      : f),
    svgObjects: state.svgObjects.map(s => {
      if (!ungroupedSet.has(s.id)) return s;
      const newSegs: PathSegment[] = s.segments.map(seg => seg.kind === 'arc'
        ? { kind: 'arc', start: [seg.start[0] + dx, seg.start[1] + dy], end: [seg.end[0] + dx, seg.end[1] + dy], center: [seg.center[0] + dx, seg.center[1] + dy] }
        : { kind: 'line', start: [seg.start[0] + dx, seg.start[1] + dy], end: [seg.end[0] + dx, seg.end[1] + dy] });
      return { ...s, segments: newSegs, ...computeSVGBbox(newSegs) };
    }),
  };
  for (const gid of groupIds) next = materializeGroupMembers(next, gid);
  return next;
}

/** Mimic handlePropsRotate's group path: pivot 90° CW around the
 *  group's visual center by adjusting translate so the world center
 *  stays pinned. */
function applyGroupRotate90(state: CompositionState, groupId: string): CompositionState {
  const groupNode = state.groups.find(g => g.id === groupId)!;
  const [lcx, lcy] = groupLocalCenter(state, groupId);
  const oldWorldCenter = applyGroupTransformPoint(groupNode, lcx, lcy);
  const newRot = ((groupNode.rotation + 90) % 360) as 0 | 90 | 180 | 270;
  const newGroupForCompute = { ...groupNode, rotation: newRot };
  const newWorldCenter = applyGroupTransformPoint(newGroupForCompute, lcx, lcy);
  const newTranslateX = groupNode.translateX + (oldWorldCenter[0] - newWorldCenter[0]);
  const newTranslateY = groupNode.translateY + (oldWorldCenter[1] - newWorldCenter[1]);
  const groups = state.groups.map(g => g.id === groupId
    ? { ...g, rotation: newRot, translateX: newTranslateX, translateY: newTranslateY } : g);
  return materializeGroupMembers({ ...state, groups }, groupId);
}

/** Mimic handlePropsMirror's group path: toggle mirrorH or mirrorV
 *  with the matching translate adjustment. */
function applyGroupMirror(state: CompositionState, groupId: string, axis: 'h' | 'v'): CompositionState {
  const groupNode = state.groups.find(g => g.id === groupId)!;
  const [lcx, lcy] = groupLocalCenter(state, groupId);
  const oldWorldCenter = applyGroupTransformPoint(groupNode, lcx, lcy);
  const newMirrorH = axis === 'h' ? !groupNode.mirrorH : groupNode.mirrorH;
  const newMirrorV = axis === 'v' ? !groupNode.mirrorV : groupNode.mirrorV;
  const newGroupForCompute = { ...groupNode, mirrorH: newMirrorH, mirrorV: newMirrorV };
  const newWorldCenter = applyGroupTransformPoint(newGroupForCompute, lcx, lcy);
  const newTranslateX = groupNode.translateX + (oldWorldCenter[0] - newWorldCenter[0]);
  const newTranslateY = groupNode.translateY + (oldWorldCenter[1] - newWorldCenter[1]);
  const groups = state.groups.map(g => g.id === groupId
    ? { ...g, mirrorH: newMirrorH, mirrorV: newMirrorV, translateX: newTranslateX, translateY: newTranslateY } : g);
  return materializeGroupMembers({ ...state, groups }, groupId);
}

function bboxCenter(state: CompositionState, groupId: string): [number, number] {
  const b = groupBounds(state.figures, groupId, state.svgObjects, state.images);
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
}

function expectClose([ax, ay]: [number, number], [bx, by]: [number, number]) {
  expect(ax).toBeCloseTo(bx, 9);
  expect(ay).toBeCloseTo(by, 9);
}

describe('group → move → mirror → move → rotate keeps the rotation pivot at the visible center', () => {
  function buildArcGroup(): CompositionState {
    const a1 = makeSVG('svg_1', [{ kind: 'arc', start: [0, 0], end: [4, 0], center: [2, 2] }]);
    const a2 = makeSVG('svg_2', [{ kind: 'arc', start: [6, 0], end: [10, 0], center: [8, 2] }]);
    const state = makeState({ svgObjects: [a1, a2] });
    return applyCompOps(state, [{
      op: 'groupFigures', figureIds: ['svg_1', 'svg_2'], groupId: 'g1', groupName: 'G',
      oldNames: [undefined, undefined],
    }]);
  }

  test('arc-only group: move → mirrorH → move → rotate pivots around current visible center', () => {
    let s = buildArcGroup();
    s = applyMoveDelta(s, ['svg_1', 'svg_2'], 100, 0);
    s = applyGroupMirror(s, 'g1', 'h');
    s = applyMoveDelta(s, ['svg_1', 'svg_2'], 50, 25);

    const beforeRotate = bboxCenter(s, 'g1');
    s = applyGroupRotate90(s, 'g1');
    const afterRotate = bboxCenter(s, 'g1');

    expectClose(afterRotate, beforeRotate);
  });

  test('arc-only group: move → mirrorH → move → mirrorH stays pinned', () => {
    let s = buildArcGroup();
    s = applyMoveDelta(s, ['svg_1', 'svg_2'], 100, 0);
    s = applyGroupMirror(s, 'g1', 'h');
    s = applyMoveDelta(s, ['svg_1', 'svg_2'], 50, 25);

    const before = bboxCenter(s, 'g1');
    s = applyGroupMirror(s, 'g1', 'h');
    const after = bboxCenter(s, 'g1');

    expectClose(after, before);
  });

  test('arc-only group: move → rotate → move → rotate pivots around current visible center', () => {
    let s = buildArcGroup();
    s = applyMoveDelta(s, ['svg_1', 'svg_2'], 100, 0);
    s = applyGroupRotate90(s, 'g1');
    s = applyMoveDelta(s, ['svg_1', 'svg_2'], 50, 25);

    const before = bboxCenter(s, 'g1');
    s = applyGroupRotate90(s, 'g1');
    const after = bboxCenter(s, 'g1');

    expectClose(after, before);
  });

  test('line-only group: move → mirror → move → rotate pivots around current visible center', () => {
    const l1 = makeSVGFromVertices('svg_1', [[0, 0], [10, 0]]);
    const l2 = makeSVGFromVertices('svg_2', [[0, 4], [10, 4]]);
    let s = makeState({ svgObjects: [l1, l2] });
    s = applyCompOps(s, [{
      op: 'groupFigures', figureIds: ['svg_1', 'svg_2'], groupId: 'g1', groupName: 'G',
      oldNames: [undefined, undefined],
    }]);
    s = applyMoveDelta(s, ['svg_1', 'svg_2'], 100, 0);
    s = applyGroupMirror(s, 'g1', 'h');
    s = applyMoveDelta(s, ['svg_1', 'svg_2'], 50, 25);

    const before = bboxCenter(s, 'g1');
    s = applyGroupRotate90(s, 'g1');
    const after = bboxCenter(s, 'g1');

    expectClose(after, before);
  });

  test('mixed group (figure + svg object): move → mirror → move → rotate stays pinned', () => {
    const fig = makeFigure('fig1', { cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 });
    const svgArc = makeSVG('svg_1', [{ kind: 'arc', start: [4, 0], end: [8, 0], center: [6, 2] }]);
    let s = makeState({ figures: [fig], svgObjects: [svgArc] });
    s = applyCompOps(s, [{
      op: 'groupFigures', figureIds: ['fig1', 'svg_1'], groupId: 'g1', groupName: 'G',
      oldNames: [undefined, undefined],
    }]);
    s = applyMoveDelta(s, ['fig1', 'svg_1'], 100, 0);
    s = applyGroupMirror(s, 'g1', 'h');
    s = applyMoveDelta(s, ['fig1', 'svg_1'], 50, 25);

    const before = bboxCenter(s, 'g1');
    s = applyGroupRotate90(s, 'g1');
    const after = bboxCenter(s, 'g1');

    expectClose(after, before);
  });
});

describe('bucketMovedIds', () => {
  test('groups grouped ids by groupId; loose ids land in ungrouped', () => {
    const fig = makeFigure('f1', { groupId: 'gA' });
    const svgLine = makeSVGFromVertices('svg_1', [[0, 0], [1, 0]], { groupId: 'gA' });
    const svgArc = makeSVG('svg_2', [{ kind: 'line', start: [0, 0], end: [1, 1] }], { groupId: 'gB' });
    const ungroupedFig = makeFigure('f2');
    const state = makeState({ figures: [fig, ungroupedFig], svgObjects: [svgLine, svgArc] });
    const { groupIds, ungrouped } = bucketMovedIds(state, ['f1', 'svg_1', 'svg_2', 'f2']);
    expect([...groupIds].sort()).toEqual(['gA', 'gB']);
    expect(ungrouped).toEqual(['f2']);
  });

  test('returns empty buckets for unknown ids', () => {
    const state = makeState();
    const { groupIds, ungrouped } = bucketMovedIds(state, ['ghost']);
    expect(groupIds.size).toBe(0);
    expect(ungrouped).toEqual(['ghost']);
  });
});
