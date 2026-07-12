import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { applyGroupTransform, materializeGroupHierarchy, applyCompOps, revertCompOps } from '../compositionOps';
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

describe('applyGroupTransform', () => {
  test('identity transform leaves world = local', () => {
    const id: GroupNode = { id: 'g', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    expect(applyGroupTransform(id, { cellX: 3, cellY: 5, cellWidth: 4, cellHeight: 2 })).toEqual({ cellX: 3, cellY: 5, cellWidth: 4, cellHeight: 2 });
  });

  test('translate offsets world by (tx, ty)', () => {
    const g: GroupNode = { id: 'g', name: 'G', translateX: 10, translateY: -3, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    expect(applyGroupTransform(g, { cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2 })).toEqual({ cellX: 10, cellY: -3, cellWidth: 4, cellHeight: 2 });
  });

  test('non-uniform scale scales width and height independently — float, no rounding', () => {
    const g: GroupNode = { id: 'g', name: 'G', translateX: 0, translateY: 0, scaleX: 1.5, scaleY: 0.75, rotation: 0, mirrorH: false, mirrorV: false };
    const r = applyGroupTransform(g, { cellX: 4, cellY: 2, cellWidth: 4, cellHeight: 4 });
    expect(r.cellX).toBeCloseTo(6);
    expect(r.cellY).toBeCloseTo(1.5);
    expect(r.cellWidth).toBeCloseTo(6);
    expect(r.cellHeight).toBeCloseTo(3);
  });

  test('rotation 90° swaps width/height and rotates position', () => {
    const g: GroupNode = { id: 'g', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 90, mirrorH: false, mirrorV: false };
    // Local rect (1, 0, 4, 2) → 90° CW rotation around local origin →
    // x' = -(y + h) = -2, y' = x = 1, w' = h = 2, h' = w = 4.
    expect(applyGroupTransform(g, { cellX: 1, cellY: 0, cellWidth: 4, cellHeight: 2 })).toEqual({ cellX: -2, cellY: 1, cellWidth: 2, cellHeight: 4 });
  });

  test('mirrorH flips local x about origin (before rotation)', () => {
    const g: GroupNode = { id: 'g', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: true, mirrorV: false };
    expect(applyGroupTransform(g, { cellX: 2, cellY: 0, cellWidth: 3, cellHeight: 1 })).toEqual({ cellX: -5, cellY: 0, cellWidth: 3, cellHeight: 1 });
  });

  test('combined transform: scale 2x then translate (5, 5)', () => {
    const g: GroupNode = { id: 'g', name: 'G', translateX: 5, translateY: 5, scaleX: 2, scaleY: 2, rotation: 0, mirrorH: false, mirrorV: false };
    expect(applyGroupTransform(g, { cellX: 1, cellY: 1, cellWidth: 1, cellHeight: 1 })).toEqual({ cellX: 7, cellY: 7, cellWidth: 2, cellHeight: 2 });
  });
});

describe('materializeGroupHierarchy', () => {
  test('does nothing when state is already current', () => {
    const g: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    // All local fields populated: bbox + orientation. The migration
    // backfills any missing locals, so an "already current" fixture
    // has to seed every one of them.
    const fig = makeFigure({ id: 'a', cellX: 3, cellY: 4, groupId: 'g1',
      localCellX: 3, localCellY: 4, localCellWidth: 2, localCellHeight: 2,
      localRotation: 0, localMirrorH: false, localMirrorV: false });
    const state = makeState([fig], [g]);
    expect(materializeGroupHierarchy(state)).toBe(state);
  });

  test('creates GroupNode and seeds locals for legacy figures with groupId', () => {
    const fig = makeFigure({ id: 'a', cellX: 3, cellY: 4, groupId: 'g1', name: 'My Group' });
    const state = makeState([fig]);
    const out = materializeGroupHierarchy(state);
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0]).toMatchObject({ id: 'g1', name: 'My Group', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false });
    expect(out.figures[0]).toMatchObject({ localCellX: 3, localCellY: 4, localCellWidth: 2, localCellHeight: 2 });
  });

  test('is idempotent', () => {
    const fig = makeFigure({ id: 'a', cellX: 3, cellY: 4, groupId: 'g1', name: 'My Group' });
    const state = makeState([fig]);
    const once = materializeGroupHierarchy(state);
    const twice = materializeGroupHierarchy(once);
    expect(twice).toBe(once);
  });

  test('leaves ungrouped figures alone', () => {
    const fig = makeFigure({ id: 'a', cellX: 1, cellY: 2 });
    const state = makeState([fig]);
    const out = materializeGroupHierarchy(state);
    expect(out.groups).toHaveLength(0);
    expect(out.figures[0].localCellX).toBeUndefined();
  });

  test('handles multiple groups with multiple members each', () => {
    const figs = [
      makeFigure({ id: 'a', cellX: 0, cellY: 0, groupId: 'g1', name: 'Group A' }),
      makeFigure({ id: 'b', cellX: 4, cellY: 0, groupId: 'g1' }),
      makeFigure({ id: 'c', cellX: 0, cellY: 4, groupId: 'g2', name: 'Group B' }),
    ];
    const out = materializeGroupHierarchy(makeState(figs));
    expect(out.groups.map(g => g.id).sort()).toEqual(['g1', 'g2']);
    expect(out.figures.every(f => f.groupId == null || f.localCellX !== undefined)).toBe(true);
  });
});

describe('groupFigures op creates a GroupNode and seeds locals', () => {
  test('apply', () => {
    const figs = [
      makeFigure({ id: 'a', cellX: 0, cellY: 0, name: 'A' }),
      makeFigure({ id: 'b', cellX: 3, cellY: 0, name: 'B' }),
    ];
    const state = makeState(figs);
    const entry: CompUndoEntry = [{
      op: 'groupFigures', figureIds: ['a', 'b'], groupId: 'g1', groupName: 'My Group', oldNames: ['A', 'B'],
    }];
    const out = applyCompOps(state, entry);
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0]).toMatchObject({ id: 'g1', name: 'My Group', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false });
    // Each member's local seeds match its world coords at group create time.
    expect(out.figures[0]).toMatchObject({ localCellX: 0, localCellY: 0, localCellWidth: 2, localCellHeight: 2 });
    expect(out.figures[1]).toMatchObject({ localCellX: 3, localCellY: 0, localCellWidth: 2, localCellHeight: 2 });
  });

  test('revert removes the GroupNode and clears locals', () => {
    const figs = [
      makeFigure({ id: 'a', cellX: 0, cellY: 0, name: 'A' }),
      makeFigure({ id: 'b', cellX: 3, cellY: 0, name: 'B' }),
    ];
    const state = makeState(figs);
    const entry: CompUndoEntry = [{
      op: 'groupFigures', figureIds: ['a', 'b'], groupId: 'g1', groupName: 'My Group', oldNames: ['A', 'B'],
    }];
    const grouped = applyCompOps(state, entry);
    expect(grouped.groups).toHaveLength(1);
    const ungrouped = revertCompOps(grouped, entry);
    expect(ungrouped.groups).toHaveLength(0);
    expect(ungrouped.figures.every(f => f.localCellX === undefined)).toBe(true);
  });

  test('ungroupFigures removes the GroupNode', () => {
    const g: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    const figs = [
      makeFigure({ id: 'a', cellX: 0, cellY: 0, groupId: 'g1', name: 'G', preGroupName: 'A', localCellX: 0, localCellY: 0, localCellWidth: 2, localCellHeight: 2 }),
    ];
    const state = makeState(figs, [g]);
    const entry: CompUndoEntry = [{
      op: 'ungroupFigures', figureIds: ['a'], groupId: 'g1', groupName: 'G',
    }];
    const out = applyCompOps(state, entry);
    expect(out.groups).toHaveLength(0);
    expect(out.figures[0].localCellX).toBeUndefined();
  });
});

describe('binary format v6 round-trip with groups + locals', () => {
  test('serialize then deserialize preserves groups and figure locals', () => {
    const bundle: CompositionBundle = {
      name: 'Hierarchy Test',
      gridLevel: 2,
      strokeScale: 8, gridIntensity: 0.5,
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      figures: [
        { id: 'a', figureKey: 'test', cellX: 4, cellY: 6, resolutionX: 2, resolutionY: 2, cellWidth: 2, cellHeight: 2, rotation: 0, groupId: 'g1', localCellX: 4, localCellY: 6, localCellWidth: 2, localCellHeight: 2 },
        { id: 'b', figureKey: 'test', cellX: 7, cellY: 6, resolutionX: 2, resolutionY: 2, cellWidth: 2, cellHeight: 2, rotation: 0, groupId: 'g1', localCellX: 7, localCellY: 6, localCellWidth: 2, localCellHeight: 2 },
      ],
      groups: [
        { id: 'g1', name: 'My Group', translateX: 1.5, translateY: -2, scaleX: 1.25, scaleY: 0.75, rotation: 90, mirrorH: true, mirrorV: false },
      ],
    };
    const payload = serializeComposition(bundle, []);
    const result = deserializeComposition(payload);
    expect(result.meta.groups).toHaveLength(1);
    expect(result.meta.groups![0]).toMatchObject({
      id: 'g1', name: 'My Group',
      rotation: 90, mirrorH: true, mirrorV: false,
    });
    expect(result.meta.groups![0].translateX).toBeCloseTo(1.5);
    expect(result.meta.groups![0].translateY).toBeCloseTo(-2);
    expect(result.meta.groups![0].scaleX).toBeCloseTo(1.25);
    expect(result.meta.groups![0].scaleY).toBeCloseTo(0.75);
    expect(result.meta.figures[0].localCellX).toBe(4);
    expect(result.meta.figures[0].localCellY).toBe(6);
    expect(result.meta.figures[1].localCellX).toBe(7);
    expect(result.meta.figures[1].localCellY).toBe(6);
  });

  test('round-trip with empty groups array', () => {
    const bundle: CompositionBundle = {
      name: 'No Groups',
      gridLevel: 0,
      strokeScale: 8, gridIntensity: 0.5,
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      figures: [
        { id: 'a', figureKey: 'test', cellX: 0, cellY: 0, resolutionX: 2, resolutionY: 2, cellWidth: 2, cellHeight: 2, rotation: 0 },
      ],
      groups: [],
    };
    const payload = serializeComposition(bundle, []);
    const result = deserializeComposition(payload);
    expect(result.meta.groups).toEqual([]);
    expect(result.meta.figures[0].localCellX).toBeUndefined();
  });
});

