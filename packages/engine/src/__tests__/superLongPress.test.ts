import { findSceneObjectAtCell, clearGroupLocals, groupMemberIds, applyCompOps, buildRemoveObjectOp } from '../compositionOps';
import { CompositionState, CompositionFigure, SVGObject, ImageObject, CompUndoEntry, makeViewport } from '../types';

function makeFigure(overrides: Partial<CompositionFigure> = {}): CompositionFigure {
  return {
    id: 'fig1',
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

function makeSvg(overrides: Partial<SVGObject> = {}): SVGObject {
  return {
    id: 'svg_1',
    segments: [{ kind: 'line' as const, start: [0, 0], end: [2, 2] }],
    color: { r: 255, g: 255, b: 255 },
    cellX: 0,
    cellY: 0,
    cellWidth: 2,
    cellHeight: 2,
    ...overrides,
  };
}

function makeState(opts: {
  figures?: CompositionFigure[];
  svgObjects?: SVGObject[];
  images?: ImageObject[];
  sceneOrder?: string[];
  groups?: CompositionState['groups'];
}): CompositionState {
  const figures = opts.figures ?? [];
  const svgObjects = opts.svgObjects ?? [];
  const images = opts.images ?? [];
  const sceneOrder = opts.sceneOrder ?? [
    ...figures.map(f => f.id),
    ...svgObjects.map(s => s.id),
    ...images.map(i => i.id),
  ];
  return {
    id: 'test',
    name: 'test',
    figures,
    svgObjects,
    lineDraft: null,
    arcDraft: null,
    editingLineId: null,
    selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups: opts.groups ?? [],
    sceneOrder,
    gridLevel: 0,
    strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null,
    compTool: 'select',
    createRegion: null,
    renderGeneration: 0,
    images,
  };
}

// ── findSceneObjectAtCell with ignoreLock ─────────────────────────────

describe('findSceneObjectAtCell with ignoreLock', () => {
  test('normally skips locked figures', () => {
    const fig = makeFigure({ locked: true });
    const state = makeState({ figures: [fig] });
    expect(findSceneObjectAtCell(state, 1, 1)).toBeNull();
  });

  test('ignoreLock hits locked figures', () => {
    const fig = makeFigure({ locked: true });
    const state = makeState({ figures: [fig] });
    const hit = findSceneObjectAtCell(state, 1, 1, { ignoreLock: true });
    expect(hit).toEqual({ kind: 'figure', id: 'fig1' });
  });

  test('normally skips locked SVG objects', () => {
    const svg = makeSvg({ locked: true });
    const state = makeState({ svgObjects: [svg] });
    expect(findSceneObjectAtCell(state, 1, 1)).toBeNull();
  });

  test('ignoreLock hits locked SVG objects', () => {
    const svg = makeSvg({ locked: true });
    const state = makeState({ svgObjects: [svg] });
    const hit = findSceneObjectAtCell(state, 1, 1, { ignoreLock: true });
    expect(hit).toEqual({ kind: 'svg', id: 'svg_1' });
  });

  test('unlocked objects are hit regardless of ignoreLock', () => {
    const fig = makeFigure({ locked: false });
    const state = makeState({ figures: [fig] });
    expect(findSceneObjectAtCell(state, 1, 1)).toEqual({ kind: 'figure', id: 'fig1' });
    expect(findSceneObjectAtCell(state, 1, 1, { ignoreLock: true })).toEqual({ kind: 'figure', id: 'fig1' });
  });
});

// ── clearGroupLocals ──────────────────────────────────────────────────

describe('clearGroupLocals', () => {
  test('clears figure group-local fields', () => {
    const fig = makeFigure({
      groupId: 'g1',
      preGroupName: 'old',
      localCellX: 1,
      localCellY: 2,
      localCellWidth: 3,
      localCellHeight: 4,
      localRotation: 90,
      localMirrorH: true,
      localMirrorV: false,
      identityCellX: 5,
      identityCellY: 6,
      transformCycleStep: 1,
    }) as any;
    clearGroupLocals(fig, 'figure');
    expect(fig.groupId).toBeUndefined();
    expect(fig.preGroupName).toBeUndefined();
    expect(fig.localCellX).toBeUndefined();
    expect(fig.localCellY).toBeUndefined();
    expect(fig.localCellWidth).toBeUndefined();
    expect(fig.localCellHeight).toBeUndefined();
    expect(fig.localRotation).toBeUndefined();
    expect(fig.localMirrorH).toBeUndefined();
    expect(fig.localMirrorV).toBeUndefined();
    expect(fig.identityCellX).toBeUndefined();
    expect(fig.identityCellY).toBeUndefined();
    expect(fig.transformCycleStep).toBeUndefined();
    // Non-local fields should be untouched
    expect(fig.cellX).toBe(0);
    expect(fig.cellY).toBe(0);
  });

  test('clears SVG group-local fields', () => {
    const svg = makeSvg({
      groupId: 'g1',
      preGroupName: 'old',
      localSegments: [{ kind: 'line', start: [0, 0], end: [1, 1] }],
      localCellX: 1,
      localCellY: 2,
      localCellWidth: 3,
      localCellHeight: 4,
      rotation: 90,
      mirrorH: true,
      mirrorV: false,
    }) as any;
    clearGroupLocals(svg, 'svg');
    expect(svg.groupId).toBeUndefined();
    expect(svg.preGroupName).toBeUndefined();
    expect(svg.localSegments).toBeUndefined();
    expect(svg.localCellX).toBeUndefined();
    expect(svg.rotation).toBeUndefined();
    expect(svg.mirrorH).toBeUndefined();
    expect(svg.mirrorV).toBeUndefined();
    // Non-local fields untouched
    expect(svg.segments).toHaveLength(1);
    expect(svg.cellX).toBe(0);
  });

  test('clears image group-local fields', () => {
    const img: any = {
      id: 'img_1',
      uri: 'test.png',
      cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2,
      groupId: 'g1',
      preGroupName: 'old',
      localCellX: 1, localCellY: 2,
      localCellWidth: 3, localCellHeight: 4,
      identityCellX: 5, identityCellY: 6,
      identityCellWidth: 7, identityCellHeight: 8,
      rotation: 90, mirrorH: true, mirrorV: false,
    };
    clearGroupLocals(img, 'image');
    expect(img.groupId).toBeUndefined();
    expect(img.preGroupName).toBeUndefined();
    expect(img.localCellX).toBeUndefined();
    expect(img.identityCellX).toBeUndefined();
    expect(img.identityCellWidth).toBeUndefined();
    expect(img.rotation).toBeUndefined();
    expect(img.cellX).toBe(0);
  });
});

// ── Group dissolution on delete ───────────────────────────────────────

describe('group dissolution', () => {
  test('removing a member from a 2-member group should dissolve the group', () => {
    const fig1 = makeFigure({ id: 'fig1', groupId: 'g1', cellX: 0, cellY: 0 });
    const fig2 = makeFigure({ id: 'fig2', groupId: 'g1', cellX: 4, cellY: 0 });
    const state = makeState({
      figures: [fig1, fig2],
      sceneOrder: ['fig1', 'fig2'],
      groups: [{
        id: 'g1', name: 'Group 1',
        translateX: 0, translateY: 0,
        scaleX: 1, scaleY: 1,
        rotation: 0, mirrorH: false, mirrorV: false,
      }],
    });

    // Verify group has 2 members
    expect(groupMemberIds(state, 'g1')).toHaveLength(2);

    // Build ops: remove fig1 + dissolve group
    const ops: CompUndoEntry = [];
    const removeOp = buildRemoveObjectOp(state, 'fig1');
    if (removeOp) ops.push(removeOp);
    ops.push({
      op: 'ungroupFigures',
      figureIds: ['fig2'],
      groupId: 'g1',
      groupName: 'Group 1',
    });

    const result = applyCompOps(state, ops);
    // fig1 should be removed
    expect(result.figures.find(f => f.id === 'fig1')).toBeUndefined();
    // fig2 should be ungrouped
    expect(result.figures.find(f => f.id === 'fig2')?.groupId).toBeUndefined();
    // Group should be dissolved
    expect(result.groups.find(g => g.id === 'g1')).toBeUndefined();
  });

  test('removing a member from a 3-member group should NOT dissolve the group', () => {
    const fig1 = makeFigure({ id: 'fig1', groupId: 'g1', cellX: 0, cellY: 0 });
    const fig2 = makeFigure({ id: 'fig2', groupId: 'g1', cellX: 4, cellY: 0 });
    const fig3 = makeFigure({ id: 'fig3', groupId: 'g1', cellX: 8, cellY: 0 });
    const state = makeState({
      figures: [fig1, fig2, fig3],
      sceneOrder: ['fig1', 'fig2', 'fig3'],
      groups: [{
        id: 'g1', name: 'Group 1',
        translateX: 0, translateY: 0,
        scaleX: 1, scaleY: 1,
        rotation: 0, mirrorH: false, mirrorV: false,
      }],
    });

    expect(groupMemberIds(state, 'g1')).toHaveLength(3);

    // Remove fig1 only — group should survive (2 members remain)
    const ops: CompUndoEntry = [];
    const removeOp = buildRemoveObjectOp(state, 'fig1');
    if (removeOp) ops.push(removeOp);
    // No ungroupFigures because members.length - 1 = 2 >= 2

    const result = applyCompOps(state, ops);
    expect(result.figures.find(f => f.id === 'fig1')).toBeUndefined();
    expect(result.figures.find(f => f.id === 'fig2')?.groupId).toBe('g1');
    expect(result.groups.find(g => g.id === 'g1')).toBeDefined();
  });
});
