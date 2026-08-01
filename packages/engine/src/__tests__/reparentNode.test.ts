import {
  applyCompOps,
  revertCompOps,
  computeGroupLockToggle,
  computeGroupHiddenToggle,
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

describe('computeGroupLockToggle / HiddenToggle accept a group id', () => {
  it('locks every member when passed the group id', () => {
    const state = grouped();
    const t = computeGroupLockToggle(state, 'g1');
    expect(t).not.toBeNull();
    expect(t!.ids.sort()).toEqual(['a', 'b']);
    expect(t!.newLocked).toBe(true);
    const locked = applyCompOps(state, t!.undoOps);
    expect(locked.figures.find((f) => f.id === 'a')!.locked).toBe(true);
    expect(locked.figures.find((f) => f.id === 'b')!.locked).toBe(true);
  });

  it('hides every member when passed the group id', () => {
    const state = grouped();
    const t = computeGroupHiddenToggle(state, 'g1');
    expect(t!.ids.sort()).toEqual(['a', 'b']);
    expect(t!.newHidden).toBe(true);
  });
});
