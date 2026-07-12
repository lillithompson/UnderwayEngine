import {
  reconcileGroupLocals,
  materializeGroupMembers,
  applyCompOps,
  materializeGroupHierarchy,
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

function makeState(overrides: Partial<CompositionState> = {}): CompositionState {
  return {
    id: 'test',
    name: 'test',
    figures: [],
    svgObjects: [],
    lineDraft: null,
    arcDraft: null,
    editingLineId: null,
    selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups: [],
    sceneOrder: [],
    gridLevel: 0,
    strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null,
    compTool: 'select',
    createRegion: null,
    renderGeneration: 0,
    ...overrides,
  };
}

describe('reconcileGroupLocals — orientation correction', () => {
  test('corrects localRotation for figure in group with rotation=90', () => {
    // Group has rotation 90. Figure's world rotation is 90, meaning
    // the group contributes the full rotation and localRotation should be 0.
    const group: GroupNode = {
      id: 'g1', name: 'G1',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 90, mirrorH: false, mirrorV: false,
    };
    const fig = makeFigure({
      id: 'a', groupId: 'g1',
      cellX: 0, cellY: -2, cellWidth: 2, cellHeight: 2,
      rotation: 90,
      // Stale locals (as if seeded from world values by backfillMissingLocals):
      localCellX: 0, localCellY: -2, localCellWidth: 2, localCellHeight: 2,
      localRotation: 90, localMirrorH: false, localMirrorV: false,
    });
    const state = makeState({ figures: [fig], groups: [group], sceneOrder: ['a'] });
    const fixed = reconcileGroupLocals(state);

    expect(fixed.figures[0].localRotation).toBe(0);
    expect(fixed.figures[0].localMirrorH).toBe(false);
    expect(fixed.figures[0].localMirrorV).toBe(false);
  });

  test('corrects localRotation for figure in group with rotation=180', () => {
    const group: GroupNode = {
      id: 'g1', name: 'G1',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 180, mirrorH: false, mirrorV: false,
    };
    const fig = makeFigure({
      id: 'a', groupId: 'g1',
      cellX: -2, cellY: -2, cellWidth: 2, cellHeight: 2,
      rotation: 180,
      localCellX: -2, localCellY: -2, localCellWidth: 2, localCellHeight: 2,
      localRotation: 180, localMirrorH: false, localMirrorV: false,
    });
    const state = makeState({ figures: [fig], groups: [group], sceneOrder: ['a'] });
    const fixed = reconcileGroupLocals(state);

    expect(fixed.figures[0].localRotation).toBe(0);
  });

  test('corrects localMirrorH for figure in mirrored group', () => {
    const group: GroupNode = {
      id: 'g1', name: 'G1',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: true, mirrorV: false,
    };
    const fig = makeFigure({
      id: 'a', groupId: 'g1',
      cellX: -2, cellY: 0, cellWidth: 2, cellHeight: 2,
      mirrorH: true,
      localCellX: -2, localCellY: 0, localCellWidth: 2, localCellHeight: 2,
      localRotation: 0, localMirrorH: true, localMirrorV: false,
    });
    const state = makeState({ figures: [fig], groups: [group], sceneOrder: ['a'] });
    const fixed = reconcileGroupLocals(state);

    expect(fixed.figures[0].localMirrorH).toBe(false);
  });

  test('round-trip: reconcile then materialize preserves world rotation', () => {
    // Group with rotation 90 + translate.
    const group: GroupNode = {
      id: 'g1', name: 'G1',
      translateX: 5, translateY: 10, scaleX: 1, scaleY: 1,
      rotation: 90, mirrorH: false, mirrorV: false,
    };
    // Forward: local(0,0,4,6) with group rot=90 →
    //   rot90: x'=-(y+h)=-6, y'=x=0, w'=h=6, h'=w=4 → (-6, 0, 6, 4)
    //   translate: (-6+5, 0+10, 6, 4) = (-1, 10, 6, 4)
    const fig = makeFigure({
      id: 'a', groupId: 'g1',
      cellX: -1, cellY: 10, cellWidth: 6, cellHeight: 4,
      resolutionX: 4, resolutionY: 6,
      rotation: 90,
      // Stale locals (backfillMissingLocals would seed from world):
      localCellX: -1, localCellY: 10, localCellWidth: 6, localCellHeight: 4,
      localRotation: 90, localMirrorH: false, localMirrorV: false,
    });
    const state = makeState({ figures: [fig], groups: [group], sceneOrder: ['a'] });

    // Step 1: reconcile fixes locals.
    const fixed = reconcileGroupLocals(state);
    expect(fixed.figures[0].localRotation).toBe(0);
    // localCellX/Y/W/H should be the pre-group-transform values.
    expect(fixed.figures[0].localCellX).toBeCloseTo(0, 10);
    expect(fixed.figures[0].localCellY).toBeCloseTo(0, 10);
    expect(fixed.figures[0].localCellWidth).toBe(4);
    expect(fixed.figures[0].localCellHeight).toBe(6);

    // Step 2: materialize from corrected locals → world should match original.
    const materialized = materializeGroupMembers(fixed, 'g1');
    expect(materialized.figures[0].cellX).toBe(-1);
    expect(materialized.figures[0].cellY).toBe(10);
    expect(materialized.figures[0].cellWidth).toBe(6);
    expect(materialized.figures[0].cellHeight).toBe(4);
    expect(materialized.figures[0].rotation).toBe(90);
    expect(materialized.figures[0].mirrorH ?? false).toBe(false);
    expect(materialized.figures[0].mirrorV ?? false).toBe(false);
  });

  test('load-path simulation: backfill + reconcile + materialize preserves world', () => {
    // Simulate deserializing a file: figure has world values, no local fields.
    const group: GroupNode = {
      id: 'g1', name: 'G1',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 90, mirrorH: false, mirrorV: false,
    };
    // Forward: local(0, 0, 4, 6) → rot90: (-(0+6), 0, 6, 4) = (-6, 0, 6, 4)
    const fig = makeFigure({
      id: 'a', groupId: 'g1',
      cellX: -6, cellY: 0, cellWidth: 6, cellHeight: 4,
      resolutionX: 4, resolutionY: 6,
      rotation: 90,
      // No local fields (as if freshly deserialized).
    });
    const state = makeState({ figures: [fig], groups: [group], sceneOrder: ['a'] });

    // materializeGroupHierarchy calls backfillMissingLocals.
    const afterHierarchy = materializeGroupHierarchy(state);
    // backfill seeds localRotation=90 (world value — wrong).
    expect(afterHierarchy.figures[0].localRotation).toBe(90);

    // reconcileGroupLocals corrects the incorrectly-seeded locals.
    const afterReconcile = reconcileGroupLocals(afterHierarchy);
    expect(afterReconcile.figures[0].localRotation).toBe(0);
    expect(afterReconcile.figures[0].localCellX).toBeCloseTo(0, 6);
    expect(afterReconcile.figures[0].localCellY).toBeCloseTo(0, 6);
    expect(afterReconcile.figures[0].localCellWidth).toBeCloseTo(4, 6);
    expect(afterReconcile.figures[0].localCellHeight).toBeCloseTo(6, 6);

    // Materialize should reproduce original world values.
    const materialized = materializeGroupMembers(afterReconcile, 'g1');
    expect(materialized.figures[0].cellX).toBeCloseTo(-6, 6);
    expect(materialized.figures[0].cellY).toBeCloseTo(0, 6);
    expect(materialized.figures[0].cellWidth).toBeCloseTo(6, 6);
    expect(materialized.figures[0].cellHeight).toBeCloseTo(4, 6);
    expect(materialized.figures[0].rotation).toBe(90);
  });

  test('nested group: 2-level chain with rotations', () => {
    // Inner group rot=90, outer group rot=90 → total chain rotation = 180.
    const innerGroup: GroupNode = {
      id: 'inner', name: 'Inner', parentGroupId: 'outer',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 90, mirrorH: false, mirrorV: false,
    };
    const outerGroup: GroupNode = {
      id: 'outer', name: 'Outer',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 90, mirrorH: false, mirrorV: false,
    };
    // World rotation is 180 (inner 90 + outer 90).
    // Local rotation should be 0 (both groups contribute 90 each).
    const fig = makeFigure({
      id: 'a', groupId: 'inner',
      cellX: -2, cellY: -2, cellWidth: 2, cellHeight: 2,
      rotation: 180,
      // Stale: localRotation = 180 (world value from backfill).
      localCellX: -2, localCellY: -2, localCellWidth: 2, localCellHeight: 2,
      localRotation: 180, localMirrorH: false, localMirrorV: false,
    });
    const state = makeState({
      figures: [fig],
      groups: [innerGroup, outerGroup],
      sceneOrder: ['a'],
    });

    const fixed = reconcileGroupLocals(state);
    expect(fixed.figures[0].localRotation).toBe(0);

    // Round-trip: materialize should reproduce world=180.
    const materialized = materializeGroupMembers(fixed, 'outer');
    expect(materialized.figures[0].rotation).toBe(180);
  });

  test('corrects localTileWidthL0/HeightL0 for tile-mode figure in rotated group', () => {
    const group: GroupNode = {
      id: 'g1', name: 'G1',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 90, mirrorH: false, mirrorV: false,
    };
    // Group rot=90 swaps tile dims:
    //   local tile (4, 8) → rot90 of {0,0,4,8}: {-(0+8), 0, 8, 4} → world tile W=8, H=4.
    // Figure local(0, 0, 4, 8) → rot90: (-8, 0, 8, 4).
    const fig = makeFigure({
      id: 'a', groupId: 'g1',
      cellX: -8, cellY: 0, cellWidth: 8, cellHeight: 4,
      resolutionX: 4, resolutionY: 8,
      rotation: 90,
      tileMode: 'repeat' as const,
      tileWidthL0: 8, tileHeightL0: 4,
      // Stale locals from backfill:
      localCellX: -8, localCellY: 0, localCellWidth: 8, localCellHeight: 4,
      localRotation: 90,
      localMirrorH: false, localMirrorV: false,
      localTileWidthL0: 8, localTileHeightL0: 4, // world values — wrong!
    });
    const state = makeState({ figures: [fig], groups: [group], sceneOrder: ['a'] });
    const fixed = reconcileGroupLocals(state);

    // After reconcile, local tile dims should be the pre-rotation values.
    expect(fixed.figures[0].localTileWidthL0).toBe(4);
    expect(fixed.figures[0].localTileHeightL0).toBe(8);

    // Round-trip: materialize → world tile dims should match original.
    const materialized = materializeGroupMembers(fixed, 'g1');
    expect(materialized.figures[0].tileWidthL0).toBe(8);
    expect(materialized.figures[0].tileHeightL0).toBe(4);
  });

  test('RugBug scenario: group a rotated group with a loose SVG, then materialize', () => {
    // Simulates the RugBug.tile scenario:
    // - Rug_Outline group (rot=90) containing two pattern-mode figures
    // - A loose SVG line
    // - User groups them → nested group
    // - Moving the parent group triggers materializeGroupMembers

    const rugOutline: GroupNode = {
      id: 'rug', name: 'Rug_Outline',
      translateX: 10, translateY: 5, scaleX: 1, scaleY: 1,
      rotation: 90, mirrorH: false, mirrorV: false,
    };
    // Figure 1: local(0, 0, 4, 8) → group rot=90 + translate(10,5):
    //   rot90: x'=-(0+8)=-8, y'=0, w'=8, h'=4 → (-8, 0, 8, 4)
    //   translate: (-8+10, 0+5, 8, 4) = (2, 5, 8, 4)
    // World rotation = compose(group:90, local:0) = 90.
    const fig1 = makeFigure({
      id: 'fig1', groupId: 'rug',
      cellX: 2, cellY: 5, cellWidth: 8, cellHeight: 4,
      resolutionX: 4, resolutionY: 8,
      rotation: 90,
      tileMode: 'repeat' as const,
      tileWidthL0: 8, tileHeightL0: 4, // world tile dims (rotated from local 4×8)
      // Stale locals (as if loaded from binary → backfilled from world):
      localCellX: 2, localCellY: 5, localCellWidth: 8, localCellHeight: 4,
      localRotation: 90,
      localMirrorH: false, localMirrorV: false,
      localTileWidthL0: 8, localTileHeightL0: 4,
    });
    // Figure 2: local(5, 0, 4, 8) → group rot=90 + translate(10,5):
    //   rot90: x'=-(0+8)=-8, y'=5, w'=8, h'=4 → (-8, 5, 8, 4)
    //   translate: (-8+10, 5+5, 8, 4) = (2, 10, 8, 4)
    const fig2 = makeFigure({
      id: 'fig2', groupId: 'rug',
      cellX: 2, cellY: 10, cellWidth: 8, cellHeight: 4,
      resolutionX: 4, resolutionY: 8,
      rotation: 90,
      tileMode: 'repeat' as const,
      tileWidthL0: 8, tileHeightL0: 4,
      localCellX: 2, localCellY: 10, localCellWidth: 8, localCellHeight: 4,
      localRotation: 90,
      localMirrorH: false, localMirrorV: false,
      localTileWidthL0: 8, localTileHeightL0: 4,
    });

    let state = makeState({
      figures: [fig1, fig2],
      svgObjects: [{
        id: 'line1',
        segments: [{ kind: 'line' as const, start: [0, 0] as [number, number], end: [5, 5] as [number, number] }],
        color: { r: 0, g: 0, b: 0 },
        cellX: 0, cellY: 0, cellWidth: 5, cellHeight: 5,
      }],
      groups: [rugOutline],
      sceneOrder: ['fig1', 'fig2', 'line1'],
    });

    // Step 1: reconcile fixes the stale locals (simulates load path).
    state = reconcileGroupLocals(state);
    expect(state.figures[0].localRotation).toBe(0);
    expect(state.figures[1].localRotation).toBe(0);
    expect(state.figures[0].localTileWidthL0).toBe(4);
    expect(state.figures[0].localTileHeightL0).toBe(8);

    // Step 2: group Rug_Outline + line → nested group.
    const groupEntry: CompUndoEntry = [{
      op: 'groupFigures',
      figureIds: ['line1'],
      groupId: 'parent',
      groupName: 'Parent Group',
      oldNames: [undefined],
      childGroupIds: ['rug'],
    }];
    state = applyCompOps(state, groupEntry);

    // Verify nesting.
    expect(state.groups.find(g => g.id === 'rug')!.parentGroupId).toBe('parent');

    // Step 3: move the parent group (triggers materializeGroupMembers).
    const parentGroups = state.groups.map(g =>
      g.id === 'parent' ? { ...g, translateX: 20, translateY: 0 } : g
    );
    state = materializeGroupMembers({ ...state, groups: parentGroups }, 'parent');

    // World rotation should still be 90, NOT 180 (the old double-rotation bug).
    expect(state.figures[0].rotation).toBe(90);
    expect(state.figures[1].rotation).toBe(90);

    // World tile dims should still be correct.
    expect(state.figures[0].tileWidthL0).toBe(8);
    expect(state.figures[0].tileHeightL0).toBe(4);

    // Positions should be shifted by parent translate (20, 0).
    expect(state.figures[0].cellX).toBe(22); // 2 + 20
    expect(state.figures[0].cellY).toBe(5);
    expect(state.figures[1].cellX).toBe(22);
    expect(state.figures[1].cellY).toBe(10);
  });

  test('no-op when locals are already consistent', () => {
    const group: GroupNode = {
      id: 'g1', name: 'G1',
      translateX: 5, translateY: 5, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const fig = makeFigure({
      id: 'a', groupId: 'g1',
      cellX: 5, cellY: 5, cellWidth: 2, cellHeight: 2,
      rotation: 0,
      localCellX: 0, localCellY: 0, localCellWidth: 2, localCellHeight: 2,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
    });
    const state = makeState({ figures: [fig], groups: [group], sceneOrder: ['a'] });
    const fixed = reconcileGroupLocals(state);

    // Should return same reference (no changes needed).
    expect(fixed).toBe(state);
  });

  test('corrects localQuads for figure in rotated group', () => {
    const group: GroupNode = {
      id: 'g1', name: 'G1',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 90, mirrorH: false, mirrorV: false,
    };
    // Local quad (0, 0, 2, 3) in local bbox (4, 6), rotated 90 CW:
    //   rotateQuad90CW({0, 0, 2, 3}, 6) = {6-0-3, 0, 3, 2} = {3, 0, 3, 2}
    // World bbox after rot90 of (4, 6) = (6, 4).
    const fig = makeFigure({
      id: 'a', groupId: 'g1',
      cellX: 0, cellY: -4, cellWidth: 6, cellHeight: 4,
      resolutionX: 4, resolutionY: 6,
      rotation: 90,
      quads: [{ offsetX: 3, offsetY: 0, cellWidth: 3, cellHeight: 2 }],
      // Stale locals:
      localCellX: 0, localCellY: -4, localCellWidth: 6, localCellHeight: 4,
      localRotation: 90,
      localMirrorH: false, localMirrorV: false,
      localQuads: [{ offsetX: 3, offsetY: 0, cellWidth: 3, cellHeight: 2 }], // world quads
    });
    const state = makeState({ figures: [fig], groups: [group], sceneOrder: ['a'] });
    const fixed = reconcileGroupLocals(state);

    // Local quads should be the pre-rotation values.
    expect(fixed.figures[0].localQuads).toEqual([
      { offsetX: 0, offsetY: 0, cellWidth: 2, cellHeight: 3 },
    ]);

    // Round-trip: materialize should reproduce world quads.
    const materialized = materializeGroupMembers(fixed, 'g1');
    expect(materialized.figures[0].quads).toEqual([
      { offsetX: 3, offsetY: 0, cellWidth: 3, cellHeight: 2 },
    ]);
  });
});
