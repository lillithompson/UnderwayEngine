/**
 * Regression: scaling a group via corner drag used to assume the group
 * was at identity rotation (no mirror), so the live reducer's
 *   sX = newWidth / lb.width; tx = newCellX - lb.minX * sX
 * formula put the world bbox in the wrong place AND grew the wrong
 * axis when the group had been rotated 90°/270° (axis-swap) or
 * mirrored.
 *
 * The handler now picks sX/sY against whichever local axis maps to
 * world-X under the current rotation, and probes applyGroupTransform
 * (with zero translate) to solve tx/ty so the resulting world TL lands
 * exactly at (newCellX, newCellY). These tests assert the world bbox
 * matches the requested target across every (rotation, mirror)
 * configuration.
 */

import {
  applyGroupTransform,
  computeSVGBbox,
  groupBounds,
  materializeGroupMembers,
} from '../compositionOps';
import {
  CompositionState,
  GroupNode,
  SVGObject,
  PathSegment,
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

function makeSVGFromVertices(id: string, vertices: [number, number][], over: Partial<SVGObject> = {}): SVGObject {
  const segments: PathSegment[] = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    segments.push({ kind: 'line', start: vertices[i], end: vertices[i + 1] });
  }
  return { id, segments, color: WHITE, ...computeSVGBbox(segments), ...over };
}

/** Mirror the post-fix handleScaleFigure group path: pick sX/sY against
 *  whichever local axis maps to world-X under the start rotation, and
 *  solve translate by probing applyGroupTransform. */
function applyGroupScale(
  state: CompositionState, groupId: string,
  newCellX: number, newCellY: number, newCellWidth: number, newCellHeight: number,
  lb: { minX: number; minY: number; width: number; height: number },
): CompositionState {
  const start = state.groups.find(g => g.id === groupId)!;
  const swap = start.rotation === 90 || start.rotation === 270;
  const sX = swap ? newCellWidth / lb.height : newCellWidth / lb.width;
  const sY = swap ? newCellHeight / lb.width : newCellHeight / lb.height;
  const probe = applyGroupTransform(
    { translateX: 0, translateY: 0, scaleX: sX, scaleY: sY,
      rotation: start.rotation, mirrorH: start.mirrorH, mirrorV: start.mirrorV },
    { cellX: lb.minX, cellY: lb.minY, cellWidth: lb.width, cellHeight: lb.height },
  );
  const tx = newCellX - probe.cellX;
  const ty = newCellY - probe.cellY;
  const groups = state.groups.map(g => g.id === groupId
    ? { ...g, translateX: tx, translateY: ty, scaleX: sX, scaleY: sY }
    : g);
  return materializeGroupMembers({ ...state, groups }, groupId);
}

/** Build a tiny svg-object-only group at identity transform with a known
 *  local bbox (0..10, 0..4), then poke the group into the requested
 *  rotation/mirror state and re-materialize. Returns state +
 *  local-bbox descriptor matching what the live reducer captures at
 *  scale start. */
function buildGroupAt(
  rotation: 0 | 90 | 180 | 270,
  mirrorH: boolean, mirrorV: boolean,
  translate: [number, number] = [0, 0],
): { state: CompositionState; lb: { minX: number; minY: number; width: number; height: number } } {
  const l1 = makeSVGFromVertices('svg_1', [[0, 0], [10, 0]],
    { localSegments: [{ kind: 'line', start: [0, 0], end: [10, 0] }], localCellX: 0, localCellY: 0, localCellWidth: 10, localCellHeight: 0, groupId: 'g1' });
  const l2 = makeSVGFromVertices('svg_2', [[0, 4], [10, 4]],
    { localSegments: [{ kind: 'line', start: [0, 4], end: [10, 4] }], localCellX: 0, localCellY: 4, localCellWidth: 10, localCellHeight: 0, groupId: 'g1' });
  const group: GroupNode = {
    id: 'g1', name: 'G',
    translateX: translate[0], translateY: translate[1],
    scaleX: 1, scaleY: 1,
    rotation, mirrorH, mirrorV,
  };
  const state = makeState({ svgObjects: [l1, l2], groups: [group] });
  const materialized = materializeGroupMembers(state, 'g1');
  return { state: materialized, lb: { minX: 0, minY: 0, width: 10, height: 4 } };
}

describe('group scale lands the world bbox at the requested rect for every rotation/mirror', () => {
  const cases: Array<{ rotation: 0 | 90 | 180 | 270; mirrorH: boolean; mirrorV: boolean }> = [
    { rotation: 0, mirrorH: false, mirrorV: false },
    { rotation: 0, mirrorH: true, mirrorV: false },
    { rotation: 0, mirrorH: false, mirrorV: true },
    { rotation: 0, mirrorH: true, mirrorV: true },
    { rotation: 90, mirrorH: false, mirrorV: false },
    { rotation: 90, mirrorH: true, mirrorV: false },
    { rotation: 180, mirrorH: false, mirrorV: false },
    { rotation: 180, mirrorH: false, mirrorV: true },
    { rotation: 270, mirrorH: false, mirrorV: false },
    { rotation: 270, mirrorH: true, mirrorV: true },
  ];
  for (const c of cases) {
    test(`rotation=${c.rotation} mirrorH=${c.mirrorH} mirrorV=${c.mirrorV}`, () => {
      const { state, lb } = buildGroupAt(c.rotation, c.mirrorH, c.mirrorV, [50, 30]);
      const target = { x: 100, y: 60, w: 16, h: 12 };
      const after = applyGroupScale(state, 'g1', target.x, target.y, target.w, target.h, lb);
      const b = groupBounds(after.figures, 'g1', after.svgObjects, after.images);
      expect(b.minX).toBeCloseTo(target.x, 9);
      expect(b.minY).toBeCloseTo(target.y, 9);
      expect(b.maxX - b.minX).toBeCloseTo(target.w, 9);
      expect(b.maxY - b.minY).toBeCloseTo(target.h, 9);
    });
  }
});

describe('group scale: dragging a corner from rotation=90 grows the visually-correct axis', () => {
  test('rotation=90: doubling visible width grows local-Y not local-X', () => {
    // Group at rotation=90 — local axes are flipped from world axes. A
    // visible-width drag should map to a local-height (sY) increase.
    const { state, lb } = buildGroupAt(90, false, false);
    // After rotation=90, local (0..10, 0..4) maps to world ≈ (-4, 0, 4, 10).
    // Doubling the visible width to 8 should keep height=10, repositioning
    // along the visible-X axis only.
    const after = applyGroupScale(state, 'g1', -8, 0, 8, 10, lb);
    const b = groupBounds(after.figures, 'g1', after.svgObjects, after.images);
    expect(b.maxX - b.minX).toBeCloseTo(8, 9);
    expect(b.maxY - b.minY).toBeCloseTo(10, 9);
    // sX should have doubled (8 / lb.height=4) and sY stayed at 1 (10 / lb.width=10).
    const g = after.groups[0];
    expect(g.scaleX).toBeCloseTo(2, 9);
    expect(g.scaleY).toBeCloseTo(1, 9);
  });
});
