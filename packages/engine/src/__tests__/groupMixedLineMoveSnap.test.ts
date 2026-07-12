/**
 * Repro: a mixed (arc + H-line) group, duplicated, doesn't snap to
 * grid on first drag because the line's creationBox stays glued to
 * the post-duplicate offset (here a fixed 1×1 to keep the test
 * deterministic; the shipped duplicate offset is bbox-relative) and
 * is consulted by snap-adjacent code paths (lineBoundingBox /
 * lineHitsCell / selectedNodeBBox). Arc-only groups don't show the
 * bug because no creationBox is involved.
 *
 * The unit under test isn't the live reducer (hard to invoke) — it's
 * the snap-anchor + delta math the canvas down-handler uses for a
 * grouped drag, plus the member-update math the reducer applies. This
 * pair is the same path real drags walk, so any divergence between
 * "segment AABB" and "creationBox-derived AABB" surfaces here.
 */

import {
  applyCompOps,
  bucketMovedIds,
  computeSVGBbox,
  groupBounds,
  materializeGroupMembers,
  SCENE_ADAPTERS,
} from '../compositionOps';
import { computeMoveSnapDelta } from '../compositionCellMath';
import { lineBoundingBox, lineHitsCell } from '../compositionLineHitTest';
import {
  SVGObject,
  PathSegment,
  CompositionState,
  CompUndoEntry,
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
    gridLevel: 2, strokeScale: 8, gridIntensity: 0.5,
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

/** Mirror MOVE_FIGURES_DELTA's bucketed reducer: route grouped ids
 *  through their group's translate update + materialize. */
function applyMoveDelta(state: CompositionState, ids: string[], dx: number, dy: number): CompositionState {
  const { groupIds, ungrouped } = bucketMovedIds(state, ids);
  const ungroupedSet = new Set(ungrouped);
  const groups = state.groups.map(g => groupIds.has(g.id)
    ? { ...g, translateX: g.translateX + dx, translateY: g.translateY + dy }
    : g);
  let next: CompositionState = {
    ...state,
    groups,
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

/** Build a grid-aligned mixed group (arc + H-line with creationBox)
 *  on L2 (step=4), then run handlePropsDuplicate's op pipeline so the
 *  duplicate has groupId pointing at a fresh GroupNode at identity.
 *  Returns the post-duplicate state plus the duplicate's ids. */
function buildAndDuplicateMixed(): {
  state: CompositionState;
  dupArcId: string;
  dupLineId: string;
  dupGroupId: string;
} {
  // Arc: a half-circle from (0, 0) to (4, 0) curving up, center (2, 0).
  const svgArc = makeSVG('svg_1', [{ kind: 'arc', start: [0, 0], end: [4, 0], center: [2, 0] }]);
  // H-line with explicit creationBox (one-cell-wide perpendicular).
  // creationBox spans (0..4, 3..5), height=2 — a typical L1 H-line bbox.
  const svgLine = makeSVGFromVertices('svg_2', [[0, 4], [4, 4]],
    { creationBox: { minX: 0, minY: 3, width: 4, height: 2 }, lineDirection: 'horizontal' });
  let state = makeState({ svgObjects: [svgArc, svgLine] });
  state = applyCompOps(state, [{
    op: 'groupFigures', figureIds: ['svg_2', 'svg_1'], groupId: 'g1', groupName: 'G',
    oldNames: [undefined, undefined],
  }]);

  // Duplicate flow: cloneWithOffset(dx, dy) per kind, placeObject,
  // groupFigures. Uses a fixed (1, 1) offset for deterministic snap
  // assertions; the shipped buildDuplicateOps scales the offset to
  // the composition's content bbox.
  const svgAdapter = SCENE_ADAPTERS.find(a => a.kind === 'svg')!;
  const dupLine = svgAdapter.cloneWithOffset(state.svgObjects.find(s => s.id === 'svg_2')!, 1, 1, 'svg_dup_line', 'g_dup') as SVGObject;
  const dupArc = svgAdapter.cloneWithOffset(state.svgObjects.find(s => s.id === 'svg_1')!, 1, 1, 'svg_dup_arc', 'g_dup') as SVGObject;
  const ops: CompUndoEntry = [
    { op: 'placeObject', kind: 'svg', item: dupLine },
    { op: 'placeObject', kind: 'svg', item: dupArc },
    { op: 'groupFigures', figureIds: ['svg_dup_line', 'svg_dup_arc'], groupId: 'g_dup', groupName: 'G copy',
      oldNames: [undefined, undefined] },
  ];
  state = applyCompOps(state, ops);
  return { state, dupArcId: 'svg_dup_arc', dupLineId: 'svg_dup_line', dupGroupId: 'g_dup' };
}

function buildAndDuplicateArcOnly(): {
  state: CompositionState;
  dupArcId: string;
  dupGroupId: string;
} {
  const a1 = makeSVG('svg_1', [{ kind: 'arc', start: [0, 0], end: [4, 0], center: [2, 0] }]);
  const a2 = makeSVG('svg_2', [{ kind: 'arc', start: [0, 4], end: [4, 4], center: [2, 4] }]);
  let state = makeState({ svgObjects: [a1, a2] });
  state = applyCompOps(state, [{
    op: 'groupFigures', figureIds: ['svg_1', 'svg_2'], groupId: 'g1', groupName: 'G',
    oldNames: [undefined, undefined],
  }]);
  const svgAdapter = SCENE_ADAPTERS.find(a => a.kind === 'svg')!;
  const dup1 = svgAdapter.cloneWithOffset(state.svgObjects[0], 1, 1, 'svg_dup_1', 'g_dup') as SVGObject;
  const dup2 = svgAdapter.cloneWithOffset(state.svgObjects[1], 1, 1, 'svg_dup_2', 'g_dup') as SVGObject;
  state = applyCompOps(state, [
    { op: 'placeObject', kind: 'svg', item: dup1 },
    { op: 'placeObject', kind: 'svg', item: dup2 },
    { op: 'groupFigures', figureIds: ['svg_dup_1', 'svg_dup_2'], groupId: 'g_dup', groupName: 'G copy',
      oldNames: [undefined, undefined] },
  ]);
  return { state, dupArcId: 'svg_dup_1', dupGroupId: 'g_dup' };
}

/** Mirror the canvas down-handler's snap-anchor pick (groupBounds for
 *  grouped) and computeMoveSnapDelta dispatch. Returns the state after
 *  applying the snapped delta. */
function dragGroupedBy(
  state: CompositionState, groupId: string, ids: string[],
  rawDx: number, rawDy: number, step: number,
): CompositionState {
  const b = groupBounds(state.figures, groupId, state.svgObjects, state.images);
  // Cursor at the group's bbox center, displaced by rawD — mirrors the
  // canvas's screenToRawCell at the current move tick.
  const cursorX = (b.minX + b.maxX) / 2 + rawDx;
  const cursorY = (b.minY + b.maxY) / 2 + rawDy;
  const dirX = rawDx > 0 ? 1 : rawDx < 0 ? -1 : 0;
  const dirY = rawDy > 0 ? 1 : rawDy < 0 ? -1 : 0;
  const { dx, dy } = computeMoveSnapDelta(b, cursorX, cursorY, rawDx, rawDy, step, step, dirX, dirY);
  return applyMoveDelta(state, ids, dx, dy);
}

describe('first drag of a duplicated group should snap to the active grid', () => {
  test('arc-only group snaps to L2 grid (control)', () => {
    const { state, dupGroupId } = buildAndDuplicateArcOnly();
    // Pre-drag: duplicate is offset by the fixture's hardcoded (1, 1) —
    // off-grid for L2 step=4. (Real duplicates use a bbox-relative
    // offset which is also typically off-grid.)
    const pre = groupBounds(state.figures, dupGroupId, state.svgObjects, state.images);
    expect(pre.minX % 4).not.toBe(0);

    // Small drag past the no-op zone — first significant move should
    // realign to the grid.
    const next = dragGroupedBy(state, dupGroupId, ['svg_dup_1', 'svg_dup_2'], 3, 3, 4);
    const post = groupBounds(next.figures, dupGroupId, next.svgObjects, next.images);
    expect(post.minX % 4).toBe(0);
    expect(post.maxY % 4).toBe(0);
  });

  test('mixed arc+line group snaps to L2 grid (regression)', () => {
    const { state, dupGroupId, dupArcId, dupLineId } = buildAndDuplicateMixed();
    const pre = groupBounds(state.figures, dupGroupId, state.svgObjects, state.images);
    expect(pre.minX % 4).not.toBe(0);

    const next = dragGroupedBy(state, dupGroupId, [dupLineId, dupArcId], 3, 3, 4);
    const post = groupBounds(next.figures, dupGroupId, next.svgObjects, next.images);
    expect(post.minX % 4).toBe(0);
    expect(post.maxY % 4).toBe(0);
  });
});

describe('lineBoundingBox ignores creationBox once the line is grouped', () => {
  test('ungrouped line: creationBox wins over segment AABB (existing behavior)', () => {
    const svgLine = makeSVGFromVertices('svg_1', [[0, 4], [4, 4]],
      { creationBox: { minX: 0, minY: 3, width: 4, height: 2 } });
    const bb = lineBoundingBox(svgLine);
    expect(bb).toEqual({ minX: 0, minY: 3, maxX: 4, maxY: 5 });
  });

  test('grouped line: creationBox is ignored, segment AABB returned', () => {
    const svgLine = makeSVGFromVertices('svg_1', [[0, 4], [4, 4]],
      { creationBox: { minX: 0, minY: 3, width: 4, height: 2 }, groupId: 'g1' });
    const bb = lineBoundingBox(svgLine);
    expect(bb).toEqual({ minX: 0, minY: 4, maxX: 4, maxY: 4 });
  });

  test('grouped H-line hit-test uses inflated segment AABB, not creationBox', () => {
    const svgLine = makeSVGFromVertices('svg_1', [[0, 4], [4, 4]],
      { creationBox: { minX: 0, minY: 3, width: 4, height: 2 }, groupId: 'g1' });
    // (2, 4) is on the line segment extent — hits.
    expect(lineHitsCell(svgLine, 2, 4)).toBe(true);
    // (2, 3.0) was inside the creationBox but well outside the
    // inflated segment AABB (minSize=0.25 → y in [3.875, 4.125]); now
    // it correctly misses for a grouped line.
    expect(lineHitsCell(svgLine, 2, 3.0)).toBe(false);
  });
});
