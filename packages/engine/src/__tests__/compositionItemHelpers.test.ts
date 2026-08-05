import { findItem, isItemLocked, isGroupChainLocked, isItemHidden, isGroupChainHidden, hiddenGroupIds, getItemGroupId, applyCompOps, revertCompOps, clonePathSegment, assertSceneOrderInvariant } from '../compositionOps';
import { SVGObject, PathSegment, CompositionState, CompositionFigure, makeViewport } from '../types';

function makeState(over: Partial<CompositionState> = {}): CompositionState {
  const figures = over.figures ?? [];
  const svgObjects = over.svgObjects ?? [];
  return {
    id: 'test', name: 'test',
    figures, svgObjects,
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
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

const FIG: CompositionFigure = {
  id: 'fig1', figureKey: 'k', cellX: 0, cellY: 0,
  resolutionX: 2, resolutionY: 2, cellWidth: 2, cellHeight: 2,
};

const SVG_LINE: SVGObject = {
  id: 'svg_a', segments: [{kind: 'line', start: [0, 0], end: [1, 1]}], color: { r: 0, g: 0, b: 0 },
  cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1,
};

const SVG_ARC: SVGObject = {
  id: 'svg_b',
  segments: [{ kind: 'arc', start: [0, 0], end: [3, 3], center: [0, 3] }],
  color: { r: 0, g: 0, b: 0 },
  // bbox includes the center: x:[0,3], y:[0,3]
  cellX: 0, cellY: 0, cellWidth: 3, cellHeight: 3,
};

describe('findItem', () => {
  it('returns kind=figure for a figure id', () => {
    const ref = findItem(makeState({ figures: [FIG] }), 'fig1');
    expect(ref?.kind).toBe('figure');
    expect(ref?.item.id).toBe('fig1');
  });
  it('returns kind=svg for a svg id (line-like)', () => {
    const ref = findItem(makeState({ svgObjects: [SVG_LINE] }), 'svg_a');
    expect(ref?.kind).toBe('svg');
  });
  it('returns kind=svg for a svg id (arc-like)', () => {
    const ref = findItem(makeState({ svgObjects: [SVG_ARC] }), 'svg_b');
    expect(ref?.kind).toBe('svg');
  });
  it('returns null for unknown ids', () => {
    expect(findItem(makeState(), 'nope')).toBeNull();
  });
});

describe('isItemLocked', () => {
  it('reads lock state from svg objects', () => {
    const lockedSVG = { ...SVG_ARC, locked: true };
    expect(isItemLocked(makeState({ svgObjects: [lockedSVG] }), 'svg_b')).toBe(true);
    expect(isItemLocked(makeState({ svgObjects: [SVG_ARC] }), 'svg_b')).toBe(false);
  });

  it('is EFFECTIVE: a member of a locked group reads as locked without its own flag set', () => {
    const member = { ...SVG_ARC, groupId: 'g1' }; // no own `locked`
    const openGroup = makeState({ svgObjects: [member], groups: [
      { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false },
    ] } as Partial<CompositionState>);
    expect(isItemLocked(openGroup, 'svg_b')).toBe(false);
    const lockedGroup = { ...openGroup, groups: openGroup.groups.map((g) => ({ ...g, locked: true })) };
    expect(isItemLocked(lockedGroup, 'svg_b')).toBe(true);
    // The member's OWN flag is never touched by the inherited lock.
    expect(lockedGroup.svgObjects[0].locked).toBeUndefined();
  });

  it('inherits a lock from ANY ancestor group (nested chain)', () => {
    const member = { ...SVG_ARC, groupId: 'child' };
    const state = makeState({ svgObjects: [member], groups: [
      { id: 'root', name: 'R', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false, locked: true },
      { id: 'child', name: 'C', parentGroupId: 'root', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false },
    ] } as Partial<CompositionState>);
    // The child group is unlocked, but its locked ROOT ancestor still locks the member.
    expect(isGroupChainLocked(state, 'child')).toBe(true);
    expect(isItemLocked(state, 'svg_b')).toBe(true);
  });
});

describe('isGroupChainLocked', () => {
  const chain = makeState({ groups: [
    { id: 'root', name: 'R', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false },
    { id: 'child', name: 'C', parentGroupId: 'root', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false },
  ] } as Partial<CompositionState>);

  it('is false for undefined / an unlocked chain', () => {
    expect(isGroupChainLocked(chain, undefined)).toBe(false);
    expect(isGroupChainLocked(chain, 'child')).toBe(false);
  });

  it('is true when the group itself or any ancestor is locked', () => {
    const rootLocked = { ...chain, groups: chain.groups.map((g) => (g.id === 'root' ? { ...g, locked: true } : g)) };
    expect(isGroupChainLocked(rootLocked, 'child')).toBe(true);
    expect(isGroupChainLocked(rootLocked, 'root')).toBe(true);
  });
});

describe('isItemHidden / isGroupChainHidden / hiddenGroupIds', () => {
  const nested = (over: Partial<CompositionState> = {}) => makeState({
    svgObjects: [{ ...SVG_ARC, groupId: 'child' }],
    groups: [
      { id: 'root', name: 'R', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false },
      { id: 'child', name: 'C', parentGroupId: 'root', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false },
    ],
    ...over,
  } as Partial<CompositionState>);

  it('is false throughout a visible chain', () => {
    const state = nested();
    expect(isGroupChainHidden(state, undefined)).toBe(false);
    expect(isGroupChainHidden(state, 'child')).toBe(false);
    expect(isItemHidden(state, 'svg_b')).toBe(false);
    expect(hiddenGroupIds(state.groups).size).toBe(0);
  });

  it('is EFFECTIVE: a member of a hidden group reads as hidden without its own flag set', () => {
    const state = nested();
    const hidden = { ...state, groups: state.groups.map((g) => (g.id === 'child' ? { ...g, hidden: true } : g)) };
    expect(isItemHidden(hidden, 'svg_b')).toBe(true);
    // The member's OWN flag is never touched by the inherited hide.
    expect(hidden.svgObjects[0].hidden).toBeUndefined();
  });

  it('inherits a hide from ANY ancestor group (nested chain)', () => {
    const state = nested();
    const rootHidden = { ...state, groups: state.groups.map((g) => (g.id === 'root' ? { ...g, hidden: true } : g)) };
    expect(isGroupChainHidden(rootHidden, 'child')).toBe(true);
    expect(isItemHidden(rootHidden, 'svg_b')).toBe(true);
    expect(hiddenGroupIds(rootHidden.groups)).toEqual(new Set(['root', 'child']));
  });

  it("does not clear a member's own hide when the group is visible", () => {
    const state = nested({ svgObjects: [{ ...SVG_ARC, groupId: 'child', hidden: true }] });
    expect(isItemHidden(state, 'svg_b')).toBe(true);
  });
});

describe('getItemGroupId', () => {
  it('reads groupId from svg objects', () => {
    const groupedSVG = { ...SVG_ARC, groupId: 'g1' };
    expect(getItemGroupId(makeState({ svgObjects: [groupedSVG] }), 'svg_b')).toBe('g1');
  });
});

describe('clonePathSegment', () => {
  it('preserves kind=arc and deep-copies points', () => {
    const seg: PathSegment = { kind: 'arc', start: [1, 2], end: [3, 4], center: [5, 6] };
    const c = clonePathSegment(seg);
    expect(c).toEqual(seg);
    seg.start[0] = 99;
    expect(c.start[0]).toBe(1);
  });
  it('preserves kind=line and deep-copies points', () => {
    const seg: PathSegment = { kind: 'line', start: [1, 2], end: [3, 4] };
    const c = clonePathSegment(seg);
    expect(c).toEqual(seg);
    expect(c.kind).toBe('line');
  });
});

describe('groupFigures op handles mixed selection (figure + svg objects)', () => {
  it('seeds locals on all items and creates one GroupNode', () => {
    const state = makeState({ figures: [FIG], svgObjects: [SVG_LINE, SVG_ARC] });
    const next = applyCompOps(state, [{
      op: 'groupFigures',
      figureIds: ['fig1', 'svg_a', 'svg_b'],
      groupId: 'g1',
      groupName: 'My Group',
      oldNames: [undefined, undefined, undefined],
    }]);
    expect(next.groups).toHaveLength(1);
    expect(next.groups[0].id).toBe('g1');
    expect(next.figures[0].groupId).toBe('g1');
    expect(next.figures[0].localCellX).toBe(0);
    expect(next.svgObjects[0].groupId).toBe('g1');
    expect(next.svgObjects[0].localSegments).toEqual([{kind: 'line', start: [0, 0], end: [1, 1]}]);
    expect(next.svgObjects[1].groupId).toBe('g1');
    expect(next.svgObjects[1].localSegments?.[0].kind).toBe('arc');
  });
});

describe('joinObjects undo apply/revert', () => {
  it('removes sources and inserts result on apply; restores on revert', () => {
    const state = makeState({
      svgObjects: [SVG_LINE, SVG_ARC],
      selectedFigureIds: new Set(['svg_a', 'svg_b']),
    });
    const resultSVG: SVGObject = {
      id: 'svg_u',
      segments: [
        { kind: 'line', start: [0, 0], end: [1, 1] },
        { kind: 'arc', start: [1, 1], end: [3, 3], center: [0, 3] },
      ],
      color: { r: 0, g: 0, b: 0 },
      cellX: 0, cellY: 0, cellWidth: 3, cellHeight: 3,
    };
    const op = { op: 'joinObjects' as const,
      sourceSVGs: [SVG_LINE, SVG_ARC], sourceSVGIndices: [0, 1],
      result: resultSVG, resultInsertIndex: 0,
      oldSceneOrder: state.sceneOrder.slice(),
    };
    const after = applyCompOps(state, [op]);
    expect(after.svgObjects).toHaveLength(1);
    expect(after.svgObjects[0].id).toBe('svg_u');
    expect(after.selectedFigureIds.has('svg_u')).toBe(true);
    // sceneOrder must drop both source ids and contain the result id at
    // the position of the earliest source — this is what was missing
    // before and made the joined object invisible in the renderer/outline.
    expect(after.sceneOrder).toEqual(['svg_u']);
    expect(() => assertSceneOrderInvariant(after)).not.toThrow();

    const back = revertCompOps(after, [op]);
    expect(back.svgObjects).toHaveLength(2);
    expect(back.svgObjects[0].id).toBe('svg_a');
    expect(back.svgObjects[1].id).toBe('svg_b');
    expect(back.selectedFigureIds.has('svg_a')).toBe(true);
    expect(back.selectedFigureIds.has('svg_b')).toBe(true);
    expect(back.selectedFigureIds.has('svg_u')).toBe(false);
    expect(back.sceneOrder).toEqual(state.sceneOrder);
    expect(() => assertSceneOrderInvariant(back)).not.toThrow();
  });

  it('inserts result at the earliest source position when sources are interleaved with non-sources', () => {
    const otherSVG1: SVGObject = { ...SVG_LINE, id: 'svg_z', segments: [{kind:'line', start:[10,10], end:[11,11]}], cellX: 10, cellY: 10 };
    const otherSVG2: SVGObject = { ...SVG_ARC, id: 'svg_w' };
    // sceneOrder weaves: svg_a (source), svg_z, svg_w, svg_b (source)
    const state = makeState({
      svgObjects: [SVG_LINE, otherSVG1, otherSVG2, SVG_ARC],
      selectedFigureIds: new Set(['svg_a', 'svg_b']),
      sceneOrder: ['svg_a', 'svg_z', 'svg_w', 'svg_b'],
    });
    const resultSVG: SVGObject = {
      id: 'svg_u', segments: [{ kind: 'arc', start: [0, 0], end: [3, 3], center: [0, 3] }],
      color: { r: 0, g: 0, b: 0 }, cellX: 0, cellY: 0, cellWidth: 3, cellHeight: 3,
    };
    const op = { op: 'joinObjects' as const,
      sourceSVGs: [SVG_LINE, SVG_ARC], sourceSVGIndices: [0, 3],
      result: resultSVG, resultInsertIndex: 0,
      oldSceneOrder: state.sceneOrder.slice(),
    };
    const after = applyCompOps(state, [op]);
    // Result anchored at svg_a's old position (index 0); non-sources keep order.
    expect(after.sceneOrder).toEqual(['svg_u', 'svg_z', 'svg_w']);
    expect(() => assertSceneOrderInvariant(after)).not.toThrow();
  });

  it('does not select the result when no source was selected (mid-stroke paint expansion)', () => {
    // Mid-stroke "expand on recolor" joins a figure/tile the user never
    // selected. The result must NOT become selected, else a phantom grey
    // selection box flashes for the expansion move.
    const otherSVG: SVGObject = { ...SVG_LINE, id: 'svg_keep', segments: [{kind:'line', start:[10,10], end:[11,11]}], cellX: 10, cellY: 10 };
    const state = makeState({
      svgObjects: [SVG_LINE, SVG_ARC, otherSVG],
      selectedFigureIds: new Set(['svg_keep']), // unrelated object selected; sources are not
      sceneOrder: ['svg_a', 'svg_b', 'svg_keep'],
    });
    const resultSVG: SVGObject = {
      id: 'svg_u',
      segments: [{ kind: 'arc', start: [0, 0], end: [3, 3], center: [0, 3] }],
      color: { r: 0, g: 0, b: 0 }, cellX: 0, cellY: 0, cellWidth: 3, cellHeight: 3,
    };
    const op = { op: 'joinObjects' as const,
      sourceSVGs: [SVG_LINE, SVG_ARC], sourceSVGIndices: [0, 1],
      result: resultSVG, resultInsertIndex: 0,
      oldSceneOrder: state.sceneOrder.slice(),
    };
    const after = applyCompOps(state, [op]);
    expect(after.selectedFigureIds.has('svg_u')).toBe(false);
    // The unrelated already-selected object is untouched.
    expect(after.selectedFigureIds.has('svg_keep')).toBe(true);
    expect(after.selectedFigureIds.size).toBe(1);
  });
});

describe('joinObjects (line-like svg) undo apply/revert', () => {
  it('updates sceneOrder on apply and restores it on revert', () => {
    const a: SVGObject = { ...SVG_LINE, id: 'svg_a', segments: [{kind:'line', start:[0,0], end:[1,0]}] };
    const b: SVGObject = { ...SVG_LINE, id: 'svg_c', segments: [{kind:'line', start:[1,0], end:[2,0]}] };
    const state = makeState({
      svgObjects: [a, b],
      selectedFigureIds: new Set(['svg_a', 'svg_c']),
    });
    const resultSVG: SVGObject = {
      id: 'svg_u', segments: [{kind:'line', start:[0,0], end:[1,0]}, {kind:'line', start:[1,0], end:[2,0]}],
      color: { r: 0, g: 0, b: 0 }, cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 0,
    };
    const op = { op: 'joinObjects' as const,
      sourceSVGs: [a, b], sourceSVGIndices: [0, 1],
      result: resultSVG, resultInsertIndex: 0,
      oldSceneOrder: state.sceneOrder.slice(),
    };
    const after = applyCompOps(state, [op]);
    expect(after.svgObjects.map(s => s.id)).toEqual(['svg_u']);
    expect(after.sceneOrder).toEqual(['svg_u']);
    expect(() => assertSceneOrderInvariant(after)).not.toThrow();

    const back = revertCompOps(after, [op]);
    expect(back.svgObjects.map(s => s.id)).toEqual(['svg_a', 'svg_c']);
    expect(back.sceneOrder).toEqual(state.sceneOrder);
    expect(() => assertSceneOrderInvariant(back)).not.toThrow();
  });
});
