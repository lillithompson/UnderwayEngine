import {
  applyCompOps,
  revertCompOps,
  computeGroupHiddenToggle,
  hiddenGroupIds,
  isGroupChainHidden,
  isGroupHidden,
  isItemHidden,
  isItemLocked,
  isGroupLocked,
} from '../compositionOps';
import { CompositionFigure, CompositionState, CompUndoEntry, GroupNode, makeViewport } from '../types';

function makeFigure(overrides: Partial<CompositionFigure> & { id: string }): CompositionFigure {
  return {
    figureKey: 'test', cellX: 0, cellY: 0, resolutionX: 2, resolutionY: 2,
    cellWidth: 2, cellHeight: 2, rotation: 0, ...overrides,
  };
}

function makeState(figures: CompositionFigure[], groups: GroupNode[] = []): CompositionState {
  return {
    id: 'test', name: 'test', figures, svgObjects: [],
    lineDraft: null, arcDraft: null, editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 }, customColors: [], groups,
    sceneOrder: figures.map((f) => f.id), gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 }, viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(), activeFigureKey: null, compTool: 'select',
    createRegion: null, renderGeneration: 0,
  } as unknown as CompositionState;
}

/** Build a state with an identity group `g1` containing a,b, plus a loose c. */
function grouped(): CompositionState {
  const figs = [
    makeFigure({ id: 'a', cellX: 0, cellY: 0, name: 'A' }),
    makeFigure({ id: 'b', cellX: 3, cellY: 0, name: 'B' }),
    makeFigure({ id: 'c', cellX: 10, cellY: 10, name: 'C' }),
  ];
  const entry: CompUndoEntry = [{
    op: 'groupFigures', figureIds: ['a', 'b'], groupId: 'g1', groupName: 'G', oldNames: ['A', 'B'],
  }];
  return applyCompOps(makeState(figs), entry);
}

describe('reparentNode — leaf into a group', () => {
  it('sets groupId, preserves world coords, seeds locals, clusters sceneOrder', () => {
    const state = grouped();
    const c = state.figures.find((f) => f.id === 'c')!;
    const op: CompUndoEntry = [{
      op: 'reparentNode', nodeId: 'c', newParentGroupId: 'g1',
      newSceneOrder: [...state.sceneOrder], oldSceneOrder: [...state.sceneOrder],
      prevFigures: [c],
    }];
    const out = applyCompOps(state, op);
    const nc = out.figures.find((f) => f.id === 'c')!;
    expect(nc.groupId).toBe('g1');
    // Identity group ⇒ world unchanged and local == world.
    expect(nc.cellX).toBe(10);
    expect(nc.cellY).toBe(10);
    expect(nc.localCellX).toBe(10);
    expect(nc.localCellY).toBe(10);
    // a, b, c contiguous in sceneOrder.
    const idx = ['a', 'b', 'c'].map((id) => out.sceneOrder.indexOf(id)).sort((x, y) => x - y);
    expect(idx[2] - idx[0]).toBe(2);
  });

  it('undo restores the loose node exactly', () => {
    const state = grouped();
    const c = state.figures.find((f) => f.id === 'c')!;
    const op: CompUndoEntry = [{
      op: 'reparentNode', nodeId: 'c', newParentGroupId: 'g1',
      newSceneOrder: [...state.sceneOrder], oldSceneOrder: [...state.sceneOrder],
      prevFigures: [c],
    }];
    const out = applyCompOps(state, op);
    const back = revertCompOps(out, op);
    const rc = back.figures.find((f) => f.id === 'c')!;
    expect(rc.groupId).toBeUndefined();
    expect(rc.localCellX).toBeUndefined();
    expect(rc.cellX).toBe(10);
    expect(back.sceneOrder).toEqual(state.sceneOrder);
  });
});

describe('reparentNode — leaf out to top level', () => {
  it('clears membership + locals, preserves world coords', () => {
    const state = grouped();
    const b = state.figures.find((f) => f.id === 'b')!;
    const op: CompUndoEntry = [{
      op: 'reparentNode', nodeId: 'b', newParentGroupId: undefined,
      newSceneOrder: [...state.sceneOrder], oldSceneOrder: [...state.sceneOrder],
      prevFigures: [b],
    }];
    const out = applyCompOps(state, op);
    const nb = out.figures.find((f) => f.id === 'b')!;
    expect(nb.groupId).toBeUndefined();
    expect(nb.localCellX).toBeUndefined();
    expect(nb.cellX).toBe(3); // world preserved
  });
});

describe('lockGroup op — inherited lock, members untouched', () => {
  it('sets the group flag and makes members effectively locked WITHOUT touching their own flags', () => {
    const state = grouped();
    const locked = applyCompOps(state, [{ op: 'lockGroup', id: 'g1', oldValue: false, newValue: true }]);
    // Group carries its own lock…
    expect(isGroupLocked(locked, 'g1')).toBe(true);
    // …members' OWN flags stay untouched…
    expect(locked.figures.find((f) => f.id === 'a')!.locked).toBeUndefined();
    expect(locked.figures.find((f) => f.id === 'b')!.locked).toBeUndefined();
    // …but they read as effectively locked (inherited), while the loose node does not.
    expect(isItemLocked(locked, 'a')).toBe(true);
    expect(isItemLocked(locked, 'b')).toBe(true);
    expect(isItemLocked(locked, 'c')).toBe(false);
  });

  it('unlocking the group restores members to unlocked (their own flags were never set)', () => {
    const state = grouped();
    const op: CompUndoEntry = [{ op: 'lockGroup', id: 'g1', oldValue: false, newValue: true }];
    const locked = applyCompOps(state, op);
    const back = revertCompOps(locked, op);
    expect(isGroupLocked(back, 'g1')).toBe(false);
    expect(isItemLocked(back, 'a')).toBe(false);
    expect(isItemLocked(back, 'b')).toBe(false);
  });

  it('computeGroupHiddenToggle targets the group itself, not its members', () => {
    const state = grouped();
    const t = computeGroupHiddenToggle(state, 'g1');
    expect(t!.ids).toEqual(['g1']);
    expect(t!.newHidden).toBe(true);
    expect(t!.undoOps).toEqual([{ op: 'hideGroup', id: 'g1', oldValue: false, newValue: true }]);
  });
});

describe('hideGroup op — inherited hide, members untouched', () => {
  it('sets the group flag and makes members effectively hidden WITHOUT touching their own flags', () => {
    const state = grouped();
    const hid = applyCompOps(state, [{ op: 'hideGroup', id: 'g1', oldValue: false, newValue: true }]);
    expect(isGroupHidden(hid, 'g1')).toBe(true);
    // …members' OWN flags stay untouched…
    expect(hid.figures.find((f) => f.id === 'a')!.hidden).toBeUndefined();
    expect(hid.figures.find((f) => f.id === 'b')!.hidden).toBeUndefined();
    // …but they read as effectively hidden (inherited), while the loose node does not.
    expect(isItemHidden(hid, 'a')).toBe(true);
    expect(isItemHidden(hid, 'b')).toBe(true);
    expect(isItemHidden(hid, 'c')).toBe(false);
  });

  it("un-hiding the group restores each member's OWN visibility setting", () => {
    // 'a' was individually hidden before the frame was hidden.
    const state = applyCompOps(grouped(), [
      { op: 'setObjectHidden', id: 'a', oldValue: false, newValue: true },
    ]);
    const op: CompUndoEntry = [{ op: 'hideGroup', id: 'g1', oldValue: false, newValue: true }];
    const hid = applyCompOps(state, op);
    expect(isItemHidden(hid, 'a')).toBe(true);
    expect(isItemHidden(hid, 'b')).toBe(true);
    const back = revertCompOps(hid, op);
    expect(isGroupHidden(back, 'g1')).toBe(false);
    // 'a' is still individually hidden; 'b' is visible again — the group
    // toggle never touched either flag.
    expect(back.figures.find((f) => f.id === 'a')!.hidden).toBe(true);
    expect(isItemHidden(back, 'a')).toBe(true);
    expect(isItemHidden(back, 'b')).toBe(false);
  });

  it('toggling a CHILD leaves its siblings and the group alone', () => {
    const state = grouped();
    const t = computeGroupHiddenToggle(state, 'a');
    expect(t!.undoOps).toEqual([{ op: 'setObjectHidden', id: 'a', oldValue: false, newValue: true }]);
    const next = applyCompOps(state, t!.undoOps);
    expect(isItemHidden(next, 'a')).toBe(true);
    expect(isItemHidden(next, 'b')).toBe(false);
    expect(isGroupHidden(next, 'g1')).toBe(false);
  });

  it('inherits through nested groups', () => {
    // Nest g1 under a new outer frame and hide the outer one.
    const state = grouped();
    const nested: CompositionState = {
      ...state,
      groups: [
        ...state.groups.map((g) => (g.id === 'g1' ? { ...g, parentGroupId: 'g0' } : g)),
        { ...state.groups[0], id: 'g0', name: 'Outer', parentGroupId: undefined, isFrame: true },
      ],
    };
    const hid = applyCompOps(nested, [{ op: 'hideGroup', id: 'g0', oldValue: false, newValue: true }]);
    expect(isGroupChainHidden(hid, 'g1')).toBe(true);
    expect(isItemHidden(hid, 'a')).toBe(true);
    expect(isItemHidden(hid, 'c')).toBe(false);
    expect(hiddenGroupIds(hid.groups)).toEqual(new Set(['g0', 'g1']));
  });
});
