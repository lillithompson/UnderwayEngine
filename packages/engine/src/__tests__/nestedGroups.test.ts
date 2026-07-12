import {
  applyCompOps,
  revertCompOps,
  materializeGroupMembers,
  expandToGroup,
  expandIdsToGroups,
  findRootGroupId,
  allDescendantMemberIds,
  groupAncestorChain,
  descendantGroupIds,
} from '../compositionOps';
import { CompositionFigure, CompositionState, CompUndoEntry, GroupNode, makeViewport } from '../types';

function makeFigure(overrides: Partial<CompositionFigure> & { id: string }): CompositionFigure {
  return {
    figureKey: 'test',
    cellX: 0,
    cellY: 0,
    resolutionX: 2,
    resolutionY: 2,
    cellWidth: 2,
    cellHeight: 2,
    rotation: 0,
    ...overrides,
  };
}

function makeState(figures: CompositionFigure[], groups: GroupNode[] = []): CompositionState {
  return {
    id: 'test',
    name: 'test',
    figures,
    svgObjects: [],
    lineDraft: null,
    arcDraft: null,
    editingLineId: null,
    selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups,
    sceneOrder: figures.map((f) => f.id),
    gridLevel: 0,
    strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null,
    compTool: 'select',
    createRegion: null,
    renderGeneration: 0,
  };
}

describe('nested groups', () => {
  // Helper: group two figures into a group, returning the resulting state
  function groupFigures(state: CompositionState, figureIds: string[], groupId: string, groupName: string, childGroupIds?: string[]): CompositionState {
    const oldNames = figureIds.map(id => {
      const fig = state.figures.find(f => f.id === id);
      return fig?.name;
    });
    const entry: CompUndoEntry = [{
      op: 'groupFigures', figureIds, groupId, groupName, oldNames,
      childGroupIds,
    }];
    return applyCompOps(state, entry);
  }

  describe('group two groups into a nested group', () => {
    test('child GroupNodes get parentGroupId, member figures untouched', () => {
      const figs = [
        makeFigure({ id: 'a', cellX: 0, cellY: 0, name: 'Fig A' }),
        makeFigure({ id: 'b', cellX: 3, cellY: 0, name: 'Fig B' }),
        makeFigure({ id: 'c', cellX: 0, cellY: 4, name: 'Fig C' }),
        makeFigure({ id: 'd', cellX: 3, cellY: 4, name: 'Fig D' }),
      ];
      let state = makeState(figs);

      // Group A+B → G1
      state = groupFigures(state, ['a', 'b'], 'g1', 'Group 1');
      expect(state.groups).toHaveLength(1);
      expect(state.figures.find(f => f.id === 'a')!.groupId).toBe('g1');
      expect(state.figures.find(f => f.id === 'b')!.groupId).toBe('g1');

      // Group C+D → G2
      state = groupFigures(state, ['c', 'd'], 'g2', 'Group 2');
      expect(state.groups).toHaveLength(2);

      // Group G1+G2 → G3 (nested: no loose items, only child groups)
      state = groupFigures(state, [], 'g3', 'Group 3', ['g1', 'g2']);
      expect(state.groups).toHaveLength(3);

      // Child groups got parentGroupId
      const g1 = state.groups.find(g => g.id === 'g1')!;
      const g2 = state.groups.find(g => g.id === 'g2')!;
      const g3 = state.groups.find(g => g.id === 'g3')!;
      expect(g1.parentGroupId).toBe('g3');
      expect(g2.parentGroupId).toBe('g3');
      expect(g3.parentGroupId).toBeUndefined();

      // Member figures still reference their inner groups, not the outer
      expect(state.figures.find(f => f.id === 'a')!.groupId).toBe('g1');
      expect(state.figures.find(f => f.id === 'b')!.groupId).toBe('g1');
      expect(state.figures.find(f => f.id === 'c')!.groupId).toBe('g2');
      expect(state.figures.find(f => f.id === 'd')!.groupId).toBe('g2');

      // Original preGroupNames on figures preserved from inner group
      expect(state.figures.find(f => f.id === 'a')!.preGroupName).toBe('Fig A');
      expect(state.figures.find(f => f.id === 'b')!.preGroupName).toBe('Fig B');
    });
  });

  describe('ungroup outer group restores inner groups', () => {
    test('ungrouping nested group restores child groups with original names', () => {
      const figs = [
        makeFigure({ id: 'a', cellX: 0, cellY: 0, name: 'Fig A' }),
        makeFigure({ id: 'b', cellX: 3, cellY: 0, name: 'Fig B' }),
        makeFigure({ id: 'c', cellX: 0, cellY: 4, name: 'Fig C' }),
        makeFigure({ id: 'd', cellX: 3, cellY: 4, name: 'Fig D' }),
      ];
      let state = makeState(figs);

      // Group A+B → G1, C+D → G2
      state = groupFigures(state, ['a', 'b'], 'g1', 'Group 1');
      state = groupFigures(state, ['c', 'd'], 'g2', 'Group 2');

      // Nest into G3
      state = groupFigures(state, [], 'g3', 'Group 3', ['g1', 'g2']);
      expect(state.groups).toHaveLength(3);

      // Ungroup G3
      const ungroupEntry: CompUndoEntry = [{
        op: 'ungroupFigures', figureIds: [], groupId: 'g3', groupName: 'Group 3',
        childGroupIds: ['g1', 'g2'],
      }];
      state = applyCompOps(state, ungroupEntry);

      // G3 removed, G1 and G2 restored as independent groups
      expect(state.groups).toHaveLength(2);
      expect(state.groups.find(g => g.id === 'g1')).toBeDefined();
      expect(state.groups.find(g => g.id === 'g2')).toBeDefined();
      expect(state.groups.find(g => g.id === 'g3')).toBeUndefined();

      // Child groups' parentGroupId cleared
      expect(state.groups.find(g => g.id === 'g1')!.parentGroupId).toBeUndefined();
      expect(state.groups.find(g => g.id === 'g2')!.parentGroupId).toBeUndefined();

      // Child groups' names restored
      expect(state.groups.find(g => g.id === 'g1')!.name).toBe('Group 1');
      expect(state.groups.find(g => g.id === 'g2')!.name).toBe('Group 2');

      // Figures still in their inner groups with original preGroupNames
      expect(state.figures.find(f => f.id === 'a')!.groupId).toBe('g1');
      expect(state.figures.find(f => f.id === 'a')!.preGroupName).toBe('Fig A');
      expect(state.figures.find(f => f.id === 'b')!.groupId).toBe('g1');
      expect(state.figures.find(f => f.id === 'b')!.preGroupName).toBe('Fig B');
    });
  });

  describe('name preservation through full round-trip', () => {
    test('group → nest → ungroup-outer → ungroup-inner preserves all names', () => {
      const figs = [
        makeFigure({ id: 'a', cellX: 0, cellY: 0, name: 'Fig A' }),
        makeFigure({ id: 'b', cellX: 3, cellY: 0, name: 'Fig B' }),
        makeFigure({ id: 'c', cellX: 0, cellY: 4, name: 'Fig C' }),
        makeFigure({ id: 'd', cellX: 3, cellY: 4, name: 'Fig D' }),
      ];
      let state = makeState(figs);

      // Group A+B → G1, C+D → G2
      state = groupFigures(state, ['a', 'b'], 'g1', 'Group 1');
      state = groupFigures(state, ['c', 'd'], 'g2', 'Group 2');

      // Nest → G3
      state = groupFigures(state, [], 'g3', 'Group 3', ['g1', 'g2']);

      // Ungroup outer (G3)
      state = applyCompOps(state, [{
        op: 'ungroupFigures', figureIds: [], groupId: 'g3', groupName: 'Group 3',
        childGroupIds: ['g1', 'g2'],
      }]);

      // Ungroup G1
      const g1Members = state.figures.filter(f => f.groupId === 'g1').map(f => f.id);
      state = applyCompOps(state, [{
        op: 'ungroupFigures', figureIds: g1Members, groupId: 'g1', groupName: 'Group 1',
      }]);

      // A and B should have their original names
      expect(state.figures.find(f => f.id === 'a')!.name).toBe('Fig A');
      expect(state.figures.find(f => f.id === 'b')!.name).toBe('Fig B');
      expect(state.figures.find(f => f.id === 'a')!.groupId).toBeUndefined();

      // C and D still in G2
      expect(state.figures.find(f => f.id === 'c')!.groupId).toBe('g2');
      expect(state.figures.find(f => f.id === 'd')!.groupId).toBe('g2');

      // Ungroup G2
      const g2Members = state.figures.filter(f => f.groupId === 'g2').map(f => f.id);
      state = applyCompOps(state, [{
        op: 'ungroupFigures', figureIds: g2Members, groupId: 'g2', groupName: 'Group 2',
      }]);

      expect(state.figures.find(f => f.id === 'c')!.name).toBe('Fig C');
      expect(state.figures.find(f => f.id === 'd')!.name).toBe('Fig D');
      expect(state.groups).toHaveLength(0);
    });
  });

  describe('mixed group + loose items', () => {
    test('group an existing group with a loose item', () => {
      const figs = [
        makeFigure({ id: 'a', cellX: 0, cellY: 0, name: 'Fig A' }),
        makeFigure({ id: 'b', cellX: 3, cellY: 0, name: 'Fig B' }),
        makeFigure({ id: 'e', cellX: 6, cellY: 0, name: 'Fig E' }),
      ];
      let state = makeState(figs);

      // Group A+B → G1
      state = groupFigures(state, ['a', 'b'], 'g1', 'Group 1');

      // Group G1 + loose E → G3
      state = groupFigures(state, ['e'], 'g3', 'Group 3', ['g1']);
      expect(state.groups).toHaveLength(2);

      // E is directly in G3
      expect(state.figures.find(f => f.id === 'e')!.groupId).toBe('g3');
      // A, B still in G1
      expect(state.figures.find(f => f.id === 'a')!.groupId).toBe('g1');
      // G1 is child of G3
      expect(state.groups.find(g => g.id === 'g1')!.parentGroupId).toBe('g3');

      // Ungroup G3
      state = applyCompOps(state, [{
        op: 'ungroupFigures', figureIds: ['e'], groupId: 'g3', groupName: 'Group 3',
        childGroupIds: ['g1'],
      }]);

      // E is ungrouped with original name restored
      expect(state.figures.find(f => f.id === 'e')!.groupId).toBeUndefined();
      expect(state.figures.find(f => f.id === 'e')!.name).toBe('Fig E');
      // G1 restored as independent group
      expect(state.groups).toHaveLength(1);
      expect(state.groups[0].id).toBe('g1');
      expect(state.groups[0].parentGroupId).toBeUndefined();
      expect(state.groups[0].name).toBe('Group 1');
    });
  });

  describe('transform chain', () => {
    test('outer translate + inner translate = correct world coords', () => {
      const figs = [
        makeFigure({ id: 'a', cellX: 0, cellY: 0, name: 'Fig A' }),
        makeFigure({ id: 'b', cellX: 3, cellY: 0, name: 'Fig B' }),
      ];
      let state = makeState(figs);

      // Group → G1 at identity
      state = groupFigures(state, ['a', 'b'], 'g1', 'Group 1');

      // Translate G1 by (5, 5)
      const groups1 = state.groups.map(g => g.id === 'g1' ? { ...g, translateX: 5, translateY: 5 } : g);
      state = materializeGroupMembers({ ...state, groups: groups1 }, 'g1');

      // Verify inner group world coords
      expect(state.figures.find(f => f.id === 'a')!.cellX).toBe(5);
      expect(state.figures.find(f => f.id === 'a')!.cellY).toBe(5);
      expect(state.figures.find(f => f.id === 'b')!.cellX).toBe(8);
      expect(state.figures.find(f => f.id === 'b')!.cellY).toBe(5);

      // Now nest G1 into G3
      state = groupFigures(state, [], 'g3', 'Group 3', ['g1']);

      // Translate G3 by (10, 0)
      const groups2 = state.groups.map(g => g.id === 'g3' ? { ...g, translateX: 10, translateY: 0 } : g);
      state = materializeGroupMembers({ ...state, groups: groups2 }, 'g3');

      // World coords should be G3(10,0) + G1(5,5) + local
      // A: local=(0,0), G1=(5,5), G3=(10,0) → world = (15, 5)
      expect(state.figures.find(f => f.id === 'a')!.cellX).toBe(15);
      expect(state.figures.find(f => f.id === 'a')!.cellY).toBe(5);
      // B: local=(3,0), G1=(5,5), G3=(10,0) → world = (18, 5)
      expect(state.figures.find(f => f.id === 'b')!.cellX).toBe(18);
      expect(state.figures.find(f => f.id === 'b')!.cellY).toBe(5);
    });
  });

  describe('undo/redo cycle', () => {
    test('undo of groupFigures with childGroupIds restores state', () => {
      const figs = [
        makeFigure({ id: 'a', cellX: 0, cellY: 0, name: 'Fig A' }),
        makeFigure({ id: 'b', cellX: 3, cellY: 0, name: 'Fig B' }),
        makeFigure({ id: 'c', cellX: 0, cellY: 4, name: 'Fig C' }),
        makeFigure({ id: 'd', cellX: 3, cellY: 4, name: 'Fig D' }),
      ];
      let state = makeState(figs);

      // Group → G1, G2
      state = groupFigures(state, ['a', 'b'], 'g1', 'Group 1');
      state = groupFigures(state, ['c', 'd'], 'g2', 'Group 2');

      // Nest → G3
      const nestEntry: CompUndoEntry = [{
        op: 'groupFigures', figureIds: [], groupId: 'g3', groupName: 'Group 3',
        oldNames: [], childGroupIds: ['g1', 'g2'],
      }];
      state = applyCompOps(state, nestEntry);
      expect(state.groups).toHaveLength(3);
      expect(state.groups.find(g => g.id === 'g1')!.parentGroupId).toBe('g3');

      // Undo nest
      state = revertCompOps(state, nestEntry);
      expect(state.groups).toHaveLength(2);
      expect(state.groups.find(g => g.id === 'g1')!.parentGroupId).toBeUndefined();
      expect(state.groups.find(g => g.id === 'g2')!.parentGroupId).toBeUndefined();
      expect(state.groups.find(g => g.id === 'g3')).toBeUndefined();

      // Group names restored
      expect(state.groups.find(g => g.id === 'g1')!.name).toBe('Group 1');
      expect(state.groups.find(g => g.id === 'g2')!.name).toBe('Group 2');
    });

    test('undo of ungroupFigures with childGroupIds re-nests', () => {
      const figs = [
        makeFigure({ id: 'a', cellX: 0, cellY: 0, name: 'Fig A' }),
        makeFigure({ id: 'b', cellX: 3, cellY: 0, name: 'Fig B' }),
      ];
      let state = makeState(figs);

      // Group → G1, nest into G3
      state = groupFigures(state, ['a', 'b'], 'g1', 'Group 1');
      state = groupFigures(state, [], 'g3', 'Group 3', ['g1']);
      expect(state.groups.find(g => g.id === 'g1')!.parentGroupId).toBe('g3');

      // Ungroup G3
      const ungroupEntry: CompUndoEntry = [{
        op: 'ungroupFigures', figureIds: [], groupId: 'g3', groupName: 'Group 3',
        childGroupIds: ['g1'],
      }];
      state = applyCompOps(state, ungroupEntry);
      expect(state.groups).toHaveLength(1);
      expect(state.groups[0].parentGroupId).toBeUndefined();

      // Undo ungroup → G3 re-created, G1 re-nested
      state = revertCompOps(state, ungroupEntry);
      expect(state.groups).toHaveLength(2);
      expect(state.groups.find(g => g.id === 'g1')!.parentGroupId).toBe('g3');
      expect(state.groups.find(g => g.id === 'g3')).toBeDefined();
    });
  });

  describe('deep hierarchy (3 levels) undo', () => {
    test('nesting G3 (which contains G1+G2) under G5 preserves inner hierarchy', () => {
      const figs = [
        makeFigure({ id: 'a', cellX: 0, cellY: 0, name: 'Fig A' }),
        makeFigure({ id: 'b', cellX: 3, cellY: 0, name: 'Fig B' }),
        makeFigure({ id: 'c', cellX: 0, cellY: 4, name: 'Fig C' }),
        makeFigure({ id: 'd', cellX: 3, cellY: 4, name: 'Fig D' }),
        makeFigure({ id: 'e', cellX: 6, cellY: 0, name: 'Fig E' }),
        makeFigure({ id: 'f', cellX: 9, cellY: 0, name: 'Fig F' }),
      ];
      let state = makeState(figs);

      // Level 1: G1=[a,b], G2=[c,d]
      state = groupFigures(state, ['a', 'b'], 'g1', 'Group 1');
      state = groupFigures(state, ['c', 'd'], 'g2', 'Group 2');

      // Level 2: G3 = G1+G2
      state = groupFigures(state, [], 'g3', 'Group 3', ['g1', 'g2']);
      expect(state.groups.find(g => g.id === 'g1')!.parentGroupId).toBe('g3');
      expect(state.groups.find(g => g.id === 'g2')!.parentGroupId).toBe('g3');

      // G4=[e,f]
      state = groupFigures(state, ['e', 'f'], 'g4', 'Group 4');

      // Level 3: G5 = G3+G4  (G3 is the ROOT to nest, not G1/G2 individually)
      const level3Entry: CompUndoEntry = [{
        op: 'groupFigures', figureIds: [], groupId: 'g5', groupName: 'Group 5',
        oldNames: [], childGroupIds: ['g3', 'g4'],
      }];
      state = applyCompOps(state, level3Entry);

      // Verify 3-level hierarchy is intact
      expect(state.groups).toHaveLength(5);
      expect(state.groups.find(g => g.id === 'g3')!.parentGroupId).toBe('g5');
      expect(state.groups.find(g => g.id === 'g4')!.parentGroupId).toBe('g5');
      // G1 and G2 still children of G3, NOT of G5
      expect(state.groups.find(g => g.id === 'g1')!.parentGroupId).toBe('g3');
      expect(state.groups.find(g => g.id === 'g2')!.parentGroupId).toBe('g3');

      // Undo level 3 nesting
      state = revertCompOps(state, level3Entry);
      expect(state.groups).toHaveLength(4); // g1, g2, g3, g4
      expect(state.groups.find(g => g.id === 'g5')).toBeUndefined();
      expect(state.groups.find(g => g.id === 'g3')!.parentGroupId).toBeUndefined();
      expect(state.groups.find(g => g.id === 'g4')!.parentGroupId).toBeUndefined();
      // Inner hierarchy of G3 preserved
      expect(state.groups.find(g => g.id === 'g1')!.parentGroupId).toBe('g3');
      expect(state.groups.find(g => g.id === 'g2')!.parentGroupId).toBe('g3');
    });

    test('redo after undo restores the 3-level hierarchy', () => {
      const figs = [
        makeFigure({ id: 'a', cellX: 0, cellY: 0, name: 'Fig A' }),
        makeFigure({ id: 'b', cellX: 3, cellY: 0, name: 'Fig B' }),
        makeFigure({ id: 'c', cellX: 0, cellY: 4, name: 'Fig C' }),
        makeFigure({ id: 'd', cellX: 3, cellY: 4, name: 'Fig D' }),
        makeFigure({ id: 'e', cellX: 6, cellY: 0, name: 'Fig E' }),
        makeFigure({ id: 'f', cellX: 9, cellY: 0, name: 'Fig F' }),
      ];
      let state = makeState(figs);

      state = groupFigures(state, ['a', 'b'], 'g1', 'Group 1');
      state = groupFigures(state, ['c', 'd'], 'g2', 'Group 2');
      state = groupFigures(state, [], 'g3', 'Group 3', ['g1', 'g2']);
      state = groupFigures(state, ['e', 'f'], 'g4', 'Group 4');

      const level3Entry: CompUndoEntry = [{
        op: 'groupFigures', figureIds: [], groupId: 'g5', groupName: 'Group 5',
        oldNames: [], childGroupIds: ['g3', 'g4'],
      }];
      state = applyCompOps(state, level3Entry);

      // Undo
      state = revertCompOps(state, level3Entry);
      expect(state.groups.find(g => g.id === 'g5')).toBeUndefined();

      // Redo (re-apply)
      state = applyCompOps(state, level3Entry);
      expect(state.groups).toHaveLength(5);
      expect(state.groups.find(g => g.id === 'g3')!.parentGroupId).toBe('g5');
      expect(state.groups.find(g => g.id === 'g4')!.parentGroupId).toBe('g5');
      expect(state.groups.find(g => g.id === 'g1')!.parentGroupId).toBe('g3');
      expect(state.groups.find(g => g.id === 'g2')!.parentGroupId).toBe('g3');
    });
  });

  describe('scene order contiguity', () => {
    test('all descendants of a nested group are contiguous in sceneOrder', () => {
      const figs = [
        makeFigure({ id: 'a', cellX: 0, cellY: 0, name: 'Fig A' }),
        makeFigure({ id: 'b', cellX: 3, cellY: 0, name: 'Fig B' }),
        makeFigure({ id: 'c', cellX: 0, cellY: 4, name: 'Fig C' }),
        makeFigure({ id: 'd', cellX: 3, cellY: 4, name: 'Fig D' }),
        makeFigure({ id: 'e', cellX: 6, cellY: 0, name: 'Fig E' }),
      ];
      let state = makeState(figs);

      // Group A+B → G1, C+D → G2, nest G1+G2 → G3
      state = groupFigures(state, ['a', 'b'], 'g1', 'Group 1');
      state = groupFigures(state, ['c', 'd'], 'g2', 'Group 2');
      state = groupFigures(state, [], 'g3', 'Group 3', ['g1', 'g2']);

      // All 4 members of G3 (a,b,c,d) should be contiguous in sceneOrder
      const idxA = state.sceneOrder.indexOf('a');
      const idxB = state.sceneOrder.indexOf('b');
      const idxC = state.sceneOrder.indexOf('c');
      const idxD = state.sceneOrder.indexOf('d');
      const idxE = state.sceneOrder.indexOf('e');

      const groupIndices = [idxA, idxB, idxC, idxD].sort((a, b) => a - b);
      // They should be consecutive
      for (let i = 1; i < groupIndices.length; i++) {
        expect(groupIndices[i]).toBe(groupIndices[i - 1] + 1);
      }
      // E should not be interleaved
      expect(idxE < groupIndices[0] || idxE > groupIndices[3]).toBe(true);
    });
  });

  describe('expandToGroup with nesting', () => {
    test('clicking an inner group member returns all root group descendants', () => {
      const figs = [
        makeFigure({ id: 'a', cellX: 0, cellY: 0, name: 'Fig A' }),
        makeFigure({ id: 'b', cellX: 3, cellY: 0, name: 'Fig B' }),
        makeFigure({ id: 'c', cellX: 0, cellY: 4, name: 'Fig C' }),
        makeFigure({ id: 'd', cellX: 3, cellY: 4, name: 'Fig D' }),
      ];
      let state = makeState(figs);

      state = groupFigures(state, ['a', 'b'], 'g1', 'Group 1');
      state = groupFigures(state, ['c', 'd'], 'g2', 'Group 2');
      state = groupFigures(state, [], 'g3', 'Group 3', ['g1', 'g2']);

      // expandToGroup from any member should return all 4
      const expanded = expandToGroup(state, 'a');
      expect(expanded.sort()).toEqual(['a', 'b', 'c', 'd']);

      const expanded2 = expandToGroup(state, 'c');
      expect(expanded2.sort()).toEqual(['a', 'b', 'c', 'd']);
    });
  });

  describe('expandIdsToGroups with nesting', () => {
    // Hierarchy used in these tests:
    //   root g3
    //     ├─ direct members: d1, d2   (groupId = g3)
    //     └─ child group g4
    //          ├─ direct members: n1, n2  (groupId = g4)
    //   + ungrouped: u
    function buildState(): CompositionState {
      const figs = [
        makeFigure({ id: 'd1', cellX: 0, cellY: 0, name: 'D1' }),
        makeFigure({ id: 'd2', cellX: 3, cellY: 0, name: 'D2' }),
        makeFigure({ id: 'n1', cellX: 0, cellY: 4, name: 'N1' }),
        makeFigure({ id: 'n2', cellX: 3, cellY: 4, name: 'N2' }),
        makeFigure({ id: 'u',  cellX: 0, cellY: 8, name: 'U'  }),
      ];
      let state = makeState(figs);
      state = groupFigures(state, ['n1', 'n2'], 'g4', 'Inner');
      state = groupFigures(state, ['d1', 'd2'], 'g3', 'Outer', ['g4']);
      return state;
    }

    test('a direct member expands to every descendant of the root', () => {
      const state = buildState();
      expect(expandIdsToGroups(state, ['d1']).sort()).toEqual(['d1', 'd2', 'n1', 'n2']);
    });

    test('a nested-group member expands to every descendant of the root', () => {
      const state = buildState();
      expect(expandIdsToGroups(state, ['n1']).sort()).toEqual(['d1', 'd2', 'n1', 'n2']);
    });

    test('an ungrouped id is preserved as itself', () => {
      const state = buildState();
      expect(expandIdsToGroups(state, ['u'])).toEqual(['u']);
    });

    test('a direct member plus an ungrouped id pulls in nested descendants too', () => {
      // This is the regression case for the marquee bug: a partial selection
      // that touched only some root-direct members must still pull in the
      // members hiding in nested sub-groups.
      const state = buildState();
      expect(expandIdsToGroups(state, ['d1', 'u']).sort()).toEqual(['d1', 'd2', 'n1', 'n2', 'u']);
    });

    test('duplicate ids are deduped in the output', () => {
      const state = buildState();
      expect(expandIdsToGroups(state, ['d1', 'd1', 'n1']).sort()).toEqual(['d1', 'd2', 'n1', 'n2']);
    });
  });

  describe('hierarchy helpers', () => {
    test('findRootGroupId walks to root', () => {
      const groups: GroupNode[] = [
        { id: 'g1', name: 'G1', parentGroupId: 'g3', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false },
        { id: 'g2', name: 'G2', parentGroupId: 'g3', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false },
        { id: 'g3', name: 'G3', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false },
      ];
      expect(findRootGroupId(groups, 'g1')).toBe('g3');
      expect(findRootGroupId(groups, 'g2')).toBe('g3');
      expect(findRootGroupId(groups, 'g3')).toBe('g3');
    });

    test('groupAncestorChain returns [self, parent, root]', () => {
      const groups: GroupNode[] = [
        { id: 'g1', name: 'G1', parentGroupId: 'g2', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false },
        { id: 'g2', name: 'G2', parentGroupId: 'g3', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false },
        { id: 'g3', name: 'G3', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false },
      ];
      const chain = groupAncestorChain(groups, 'g1');
      expect(chain.map(g => g.id)).toEqual(['g1', 'g2', 'g3']);
    });

    test('descendantGroupIds finds children and grandchildren', () => {
      const groups: GroupNode[] = [
        { id: 'g1', name: 'G1', parentGroupId: 'g3', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false },
        { id: 'g2', name: 'G2', parentGroupId: 'g3', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false },
        { id: 'g3', name: 'G3', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false },
      ];
      expect(descendantGroupIds(groups, 'g3').sort()).toEqual(['g1', 'g2']);
      expect(descendantGroupIds(groups, 'g1')).toEqual([]);
    });

    test('allDescendantMemberIds returns all figures across nested groups', () => {
      const figs = [
        makeFigure({ id: 'a', groupId: 'g1' }),
        makeFigure({ id: 'b', groupId: 'g1' }),
        makeFigure({ id: 'c', groupId: 'g2' }),
        makeFigure({ id: 'd', groupId: 'g3' }),
      ];
      const groups: GroupNode[] = [
        { id: 'g1', name: 'G1', parentGroupId: 'g3', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false },
        { id: 'g2', name: 'G2', parentGroupId: 'g3', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false },
        { id: 'g3', name: 'G3', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false },
      ];
      const state = makeState(figs, groups);
      expect(allDescendantMemberIds(state, 'g3').sort()).toEqual(['a', 'b', 'c', 'd']);
      expect(allDescendantMemberIds(state, 'g1').sort()).toEqual(['a', 'b']);
    });
  });

  describe('renameGroup op', () => {
    test('renameGroup updates GroupNode.name', () => {
      const figs = [
        makeFigure({ id: 'a', cellX: 0, cellY: 0, name: 'Fig A' }),
        makeFigure({ id: 'b', cellX: 3, cellY: 0, name: 'Fig B' }),
      ];
      let state = makeState(figs);
      state = groupFigures(state, ['a', 'b'], 'g1', 'Group 1');
      expect(state.groups.find(g => g.id === 'g1')!.name).toBe('Group 1');

      state = applyCompOps(state, [{
        op: 'renameGroup', groupId: 'g1', oldName: 'Group 1', newName: 'My Custom Group',
      }]);

      expect(state.groups.find(g => g.id === 'g1')!.name).toBe('My Custom Group');
    });

    test('renameGroup does not change member figure names', () => {
      const figs = [
        makeFigure({ id: 'a', cellX: 0, cellY: 0, name: 'Fig A' }),
        makeFigure({ id: 'b', cellX: 3, cellY: 0, name: 'Fig B' }),
      ];
      let state = makeState(figs);
      state = groupFigures(state, ['a', 'b'], 'g1', 'Group 1');

      // A carries "Group 1", B carries undefined
      const aNameBefore = state.figures.find(f => f.id === 'a')!.name;

      state = applyCompOps(state, [{
        op: 'renameGroup', groupId: 'g1', oldName: 'Group 1', newName: 'Renamed',
      }]);

      // Figure names unchanged
      expect(state.figures.find(f => f.id === 'a')!.name).toBe(aNameBefore);
      expect(state.groups.find(g => g.id === 'g1')!.name).toBe('Renamed');
    });

    test('undo of renameGroup reverts GroupNode.name', () => {
      const figs = [
        makeFigure({ id: 'a', cellX: 0, cellY: 0, name: 'Fig A' }),
        makeFigure({ id: 'b', cellX: 3, cellY: 0, name: 'Fig B' }),
      ];
      let state = makeState(figs);
      state = groupFigures(state, ['a', 'b'], 'g1', 'Group 1');

      const renameEntry: CompUndoEntry = [{
        op: 'renameGroup', groupId: 'g1', oldName: 'Group 1', newName: 'Renamed',
      }];
      state = applyCompOps(state, renameEntry);
      expect(state.groups.find(g => g.id === 'g1')!.name).toBe('Renamed');

      state = revertCompOps(state, renameEntry);
      expect(state.groups.find(g => g.id === 'g1')!.name).toBe('Group 1');
    });

    test('renameGroup works even when figure name differs from GroupNode name', () => {
      // This is the RenameFail.tile scenario: figure name and GroupNode name are out of sync
      const figs = [
        makeFigure({ id: 'a', cellX: 0, cellY: 0, name: 'Left', groupId: 'g1', preGroupName: 'Fig A',
          localCellX: 0, localCellY: 0, localCellWidth: 2, localCellHeight: 2 }),
        makeFigure({ id: 'b', cellX: 3, cellY: 0, groupId: 'g1',
          localCellX: 3, localCellY: 0, localCellWidth: 2, localCellHeight: 2 }),
      ];
      const groups: GroupNode[] = [
        { id: 'g1', name: 'Group 1', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false },
      ];
      let state = makeState(figs, groups);

      // Figure name is "Left" but GroupNode name is "Group 1" — they're out of sync
      expect(state.figures[0].name).toBe('Left');
      expect(state.groups[0].name).toBe('Group 1');

      // renameGroup should still work
      state = applyCompOps(state, [{
        op: 'renameGroup', groupId: 'g1', oldName: 'Group 1', newName: 'My Group',
      }]);

      expect(state.groups[0].name).toBe('My Group');
    });
  });
});
