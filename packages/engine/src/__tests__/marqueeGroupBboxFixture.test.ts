/**
 * Regression: marquee selection must hit-test a root group's bounding box,
 * not just its leaf members' bboxes. A marquee that crosses the empty
 * space between two far-apart members of the same group should still
 * select the group.
 *
 * This mirrors the production logic in `handleSelectRegion`
 * (components/CompositionEditor.tsx). The two implementations must stay in
 * sync.
 */

import {
  allDescendantMemberIds,
  groupBounds,
} from '../compositionOps';
import {
  CompositionFigure,
  CompositionState,
  GroupNode,
  makeViewport,
} from '../types';

jest.mock('@/native-shell/bridge/webBridge', () => ({
  logToNative: jest.fn(),
}));

function makeFigure(overrides: Partial<CompositionFigure> = {}): CompositionFigure {
  return {
    id: 'fig',
    figureKey: 'test',
    cellX: 0, cellY: 0,
    resolutionX: 2, resolutionY: 2,
    cellWidth: 10, cellHeight: 10,
    rotation: 0,
    ...overrides,
  };
}

function makeState(parts: Partial<CompositionState> = {}): CompositionState {
  const figures = parts.figures ?? [];
  const svgObjects = parts.svgObjects ?? [];
  const images = parts.images ?? [];
  const groups = parts.groups ?? [];
  return {
    id: 'test', name: 'test',
    figures, svgObjects, images,
    imageBlobs: {},
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups,
    sceneOrder: parts.sceneOrder ?? [
      ...images.map(i => i.id),
      ...figures.map(f => f.id),
      ...svgObjects.map(s => s.id),
    ],
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

/**
 * Mirrors the new `handleSelectRegion` (CompositionEditor.tsx). Returns
 * the ids the marquee would select for `region`.
 */
function simulateMarqueeSelect(
  state: CompositionState,
  region: { startCellX: number; startCellY: number; endCellX: number; endCellY: number },
): string[] {
  const rMinX = Math.min(region.startCellX, region.endCellX);
  const rMinY = Math.min(region.startCellY, region.endCellY);
  const rMaxX = Math.max(region.startCellX, region.endCellX);
  const rMaxY = Math.max(region.startCellY, region.endCellY);
  const matchingIds: string[] = [];

  const figLocked = new Map<string, boolean>();
  for (const f of state.figures) figLocked.set(f.id, !!f.locked);
  const svgLocked = new Map<string, boolean>();
  for (const v of state.svgObjects) svgLocked.set(v.id, !!v.locked);
  const imgLocked = new Map<string, boolean>();
  for (const i of (state.images ?? [])) imgLocked.set(i.id, !!i.locked);
  const isMemberLocked = (id: string) =>
    figLocked.get(id) ?? svgLocked.get(id) ?? imgLocked.get(id) ?? false;

  const figHidden = new Map<string, boolean>();
  for (const f of state.figures) figHidden.set(f.id, !!f.hidden);
  const svgHidden = new Map<string, boolean>();
  for (const v of state.svgObjects) svgHidden.set(v.id, !!v.hidden);
  const imgHidden = new Map<string, boolean>();
  for (const i of (state.images ?? [])) imgHidden.set(i.id, !!i.hidden);
  const isMemberHidden = (id: string) =>
    figHidden.get(id) ?? svgHidden.get(id) ?? imgHidden.get(id) ?? false;

  const groupedIds = new Set<string>();
  for (const g of state.groups) {
    const members = allDescendantMemberIds(state, g.id);
    for (const m of members) groupedIds.add(m);
    if (g.parentGroupId) continue;
    if (members.length === 0) continue;
    if (members.every(isMemberLocked)) continue;
    if (members.every(isMemberHidden)) continue;
    const b = groupBounds(state.figures, g.id, state.svgObjects, undefined, state.images, state.groups);
    if (!Number.isFinite(b.minX)) continue;
    if (b.minX < rMaxX && b.maxX > rMinX && b.minY < rMaxY && b.maxY > rMinY) {
      for (const m of members) matchingIds.push(m);
    }
  }

  for (const fig of state.figures) {
    if (fig.locked || fig.hidden || groupedIds.has(fig.id)) continue;
    if (fig.cellX < rMaxX && fig.cellX + fig.cellWidth > rMinX
      && fig.cellY < rMaxY && fig.cellY + fig.cellHeight > rMinY) {
      matchingIds.push(fig.id);
    }
  }
  return matchingIds;
}

describe('marquee bbox-tests root groups', () => {
  function farApartGroup(): CompositionState {
    const figA = makeFigure({ id: 'figA', cellX: 0, cellY: 0, groupId: 'gA' });
    const figB = makeFigure({ id: 'figB', cellX: 100, cellY: 100, groupId: 'gA' });
    const group: GroupNode = {
      id: 'gA', name: 'gA',
      translateX: 0, translateY: 0,
      scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    return makeState({ figures: [figA, figB], groups: [group] });
  }

  test('marquee through empty space between two far-apart group members selects the group', () => {
    const state = farApartGroup();
    // Region (40,40)→(60,60): touches neither figA (0..10) nor figB (100..110).
    const hits = simulateMarqueeSelect(state, {
      startCellX: 40, startCellY: 40, endCellX: 60, endCellY: 60,
    });
    expect(new Set(hits)).toEqual(new Set(['figA', 'figB']));
  });

  test('marquee outside the group bbox does not select it', () => {
    const state = farApartGroup();
    // Region way off to (-100,-100)→(-50,-50): doesn't touch group bbox (0,0)→(110,110).
    const hits = simulateMarqueeSelect(state, {
      startCellX: -100, startCellY: -100, endCellX: -50, endCellY: -50,
    });
    expect(hits).toEqual([]);
  });

  test('ungrouped figure outside the region is not pulled in', () => {
    const state = farApartGroup();
    // Add a loose figure far from the group and far from the region.
    const loose = makeFigure({ id: 'loose', cellX: 500, cellY: 500 });
    const next: CompositionState = {
      ...state,
      figures: [...state.figures, loose],
      sceneOrder: [...state.sceneOrder, loose.id],
    };
    const hits = simulateMarqueeSelect(next, {
      startCellX: 40, startCellY: 40, endCellX: 60, endCellY: 60,
    });
    expect(new Set(hits)).toEqual(new Set(['figA', 'figB']));
    expect(hits).not.toContain('loose');
  });

  test('fully-locked group is not selected even when its bbox intersects', () => {
    const figA = makeFigure({ id: 'figA', cellX: 0, cellY: 0, groupId: 'gL', locked: true });
    const figB = makeFigure({ id: 'figB', cellX: 100, cellY: 100, groupId: 'gL', locked: true });
    const group: GroupNode = {
      id: 'gL', name: 'gL',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const state = makeState({ figures: [figA, figB], groups: [group] });
    const hits = simulateMarqueeSelect(state, {
      startCellX: 40, startCellY: 40, endCellX: 60, endCellY: 60,
    });
    expect(hits).toEqual([]);
  });

  test('partially-locked group is still selected as a whole', () => {
    const figA = makeFigure({ id: 'figA', cellX: 0, cellY: 0, groupId: 'gM' });
    const figB = makeFigure({ id: 'figB', cellX: 100, cellY: 100, groupId: 'gM', locked: true });
    const group: GroupNode = {
      id: 'gM', name: 'gM',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const state = makeState({ figures: [figA, figB], groups: [group] });
    const hits = simulateMarqueeSelect(state, {
      startCellX: 40, startCellY: 40, endCellX: 60, endCellY: 60,
    });
    // The locked member is still pulled in (matches old expansion semantics).
    expect(new Set(hits)).toEqual(new Set(['figA', 'figB']));
  });

  test('fully-hidden group is not selected even when its bbox intersects', () => {
    const figA = makeFigure({ id: 'figA', cellX: 0, cellY: 0, groupId: 'gH', hidden: true });
    const figB = makeFigure({ id: 'figB', cellX: 100, cellY: 100, groupId: 'gH', hidden: true });
    const group: GroupNode = {
      id: 'gH', name: 'gH',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const state = makeState({ figures: [figA, figB], groups: [group] });
    const hits = simulateMarqueeSelect(state, {
      startCellX: 40, startCellY: 40, endCellX: 60, endCellY: 60,
    });
    expect(hits).toEqual([]);
  });

  test('hidden ungrouped figure inside the region is not selected', () => {
    const visible = makeFigure({ id: 'vis', cellX: 0, cellY: 0 });
    const hidden = { ...makeFigure({ id: 'hid', cellX: 20, cellY: 0 }), hidden: true };
    const state = makeState({ figures: [visible, hidden] });
    const hits = simulateMarqueeSelect(state, {
      startCellX: -5, startCellY: -5, endCellX: 40, endCellY: 15,
    });
    expect(new Set(hits)).toEqual(new Set(['vis']));
  });

  test('nested sub-group with members outside region is still pulled in via root', () => {
    // Root group "gRoot" with two children: figA (in region area) and a
    // sub-group "gSub" whose member sits far from the region.
    const figA = makeFigure({ id: 'figA', cellX: 0, cellY: 0, groupId: 'gRoot' });
    const figSub = makeFigure({ id: 'figSub', cellX: 200, cellY: 200, groupId: 'gSub' });
    const gRoot: GroupNode = {
      id: 'gRoot', name: 'gRoot',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const gSub: GroupNode = {
      id: 'gSub', name: 'gSub', parentGroupId: 'gRoot',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const state = makeState({ figures: [figA, figSub], groups: [gRoot, gSub] });
    // Region (5,5)→(15,15) overlaps figA only — but the root group's bbox
    // extends to (210,210), and the sub-group must come along for the ride.
    const hits = simulateMarqueeSelect(state, {
      startCellX: 5, startCellY: 5, endCellX: 15, endCellY: 15,
    });
    expect(new Set(hits)).toEqual(new Set(['figA', 'figSub']));
  });
});
