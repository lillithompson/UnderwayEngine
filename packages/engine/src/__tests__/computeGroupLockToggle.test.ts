import { computeGroupLockToggle } from '../compositionOps';
import { CompositionState, CompositionFigure, SVGObject, ImageObject, GroupNode, makeViewport } from '../types';

function makeState(over: Partial<CompositionState> = {}): CompositionState {
  const figures = over.figures ?? [];
  const svgObjects = over.svgObjects ?? [];
  const images = over.images ?? [];
  return {
    id: 'test', name: 'test',
    figures, svgObjects, images,
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups: over.groups ?? [],
    sceneOrder: [
      ...figures.map((f) => f.id),
      ...svgObjects.map((s) => s.id),
      ...images.map((i) => i.id),
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

function makeGroup(id: string, parentGroupId?: string): GroupNode {
  return {
    id, name: id, parentGroupId,
    translateX: 0, translateY: 0,
    scaleX: 1, scaleY: 1,
    rotation: 0, mirrorH: false, mirrorV: false,
  };
}

function makeFigure(id: string, opts: { groupId?: string; locked?: boolean } = {}): CompositionFigure {
  return {
    id, figureKey: 'k', cellX: 0, cellY: 0,
    resolutionX: 2, resolutionY: 2, cellWidth: 2, cellHeight: 2,
    groupId: opts.groupId, locked: opts.locked,
  };
}

function makeSVG(id: string, opts: { groupId?: string; locked?: boolean } = {}): SVGObject {
  return {
    id, segments: [{ kind: 'line', start: [0, 0], end: [1, 1] }],
    color: { r: 0, g: 0, b: 0 },
    cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1,
    groupId: opts.groupId, locked: opts.locked,
  };
}

function makeImage(id: string, opts: { groupId?: string; locked?: boolean } = {}): ImageObject {
  return {
    id, imageId: id, mimeType: 'image/png',
    pixelWidth: 10, pixelHeight: 10,
    cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1,
    groupId: opts.groupId, locked: opts.locked,
  };
}

describe('computeGroupLockToggle', () => {
  it('returns null for an unknown anchor id', () => {
    expect(computeGroupLockToggle(makeState(), 'nope')).toBeNull();
  });

  it('toggles a single ungrouped figure: unlocked → lock', () => {
    const state = makeState({ figures: [makeFigure('fig1')] });
    const r = computeGroupLockToggle(state, 'fig1');
    expect(r).not.toBeNull();
    expect(r!.ids).toEqual(['fig1']);
    expect(r!.newLocked).toBe(true);
    expect(r!.undoOps).toEqual([
      { op: 'lockObject', id: 'fig1', oldValue: false, newValue: true },
    ]);
  });

  it('toggles a single ungrouped figure: locked → unlock', () => {
    const state = makeState({ figures: [makeFigure('fig1', { locked: true })] });
    const r = computeGroupLockToggle(state, 'fig1');
    expect(r!.newLocked).toBe(false);
    expect(r!.undoOps[0]).toMatchObject({ oldValue: true, newValue: false });
  });

  it('grouped: anchor in parent, all descendants unlocked → lock everything', () => {
    const root = makeGroup('rootG');
    const child = makeGroup('childG', 'rootG');
    const state = makeState({
      groups: [root, child],
      figures: [makeFigure('fig_root', { groupId: 'rootG' }), makeFigure('fig_child', { groupId: 'childG' })],
      svgObjects: [makeSVG('svg_root', { groupId: 'rootG' })],
      images: [makeImage('img_child', { groupId: 'childG' })],
    });
    const r = computeGroupLockToggle(state, 'fig_root');
    expect(new Set(r!.ids)).toEqual(new Set(['fig_root', 'fig_child', 'svg_root', 'img_child']));
    expect(r!.newLocked).toBe(true);
    expect(r!.undoOps).toHaveLength(r!.ids.length);
    for (const op of r!.undoOps) {
      expect(op).toMatchObject({ op: 'lockObject', oldValue: false, newValue: true });
    }
  });

  it('grouped: anchor in parent, all descendants locked → unlock everything', () => {
    const root = makeGroup('rootG');
    const child = makeGroup('childG', 'rootG');
    const state = makeState({
      groups: [root, child],
      figures: [makeFigure('fig_root', { groupId: 'rootG', locked: true }), makeFigure('fig_child', { groupId: 'childG', locked: true })],
      svgObjects: [makeSVG('svg_root', { groupId: 'rootG', locked: true })],
      images: [makeImage('img_child', { groupId: 'childG', locked: true })],
    });
    const r = computeGroupLockToggle(state, 'fig_root');
    expect(r!.newLocked).toBe(false);
    for (const op of r!.undoOps) {
      expect(op).toMatchObject({ oldValue: true, newValue: false });
    }
  });

  it('grouped: mixed lock state across parent + nested → unlock everything', () => {
    const root = makeGroup('rootG');
    const child = makeGroup('childG', 'rootG');
    const state = makeState({
      groups: [root, child],
      // Parent's figures locked; nested group's figures unlocked.
      figures: [makeFigure('fig_root', { groupId: 'rootG', locked: true }), makeFigure('fig_child', { groupId: 'childG' })],
      svgObjects: [makeSVG('svg_child', { groupId: 'childG' })],
    });
    const r = computeGroupLockToggle(state, 'fig_root');
    // Aggregate rule: any descendant locked → newLocked = false (unlock).
    // Unlocking a partially-locked group propagates to every child so the
    // already-unlocked siblings don't get re-locked by the gesture.
    expect(r!.newLocked).toBe(false);
    expect(new Set(r!.ids)).toEqual(new Set(['fig_root', 'fig_child', 'svg_child']));
    const oldByid = Object.fromEntries(r!.undoOps.map((o) => [o.op === 'lockObject' ? o.id : '', o.op === 'lockObject' ? o.oldValue : null]));
    expect(oldByid['fig_root']).toBe(true);
    expect(oldByid['fig_child']).toBe(false);
    expect(oldByid['svg_child']).toBe(false);
  });

  it('grouped: anchor inside nested sub-group still resolves to root', () => {
    const root = makeGroup('rootG');
    const child = makeGroup('childG', 'rootG');
    const state = makeState({
      groups: [root, child],
      figures: [makeFigure('fig_root', { groupId: 'rootG' }), makeFigure('fig_child', { groupId: 'childG' })],
    });
    const r = computeGroupLockToggle(state, 'fig_child');
    expect(new Set(r!.ids)).toEqual(new Set(['fig_root', 'fig_child']));
  });

  it('grouped: three-level nesting (root → mid → leaf)', () => {
    const root = makeGroup('rootG');
    const mid = makeGroup('midG', 'rootG');
    const leaf = makeGroup('leafG', 'midG');
    const state = makeState({
      groups: [root, mid, leaf],
      figures: [
        makeFigure('fig_root', { groupId: 'rootG' }),
        makeFigure('fig_mid', { groupId: 'midG' }),
        makeFigure('fig_leaf', { groupId: 'leafG' }),
      ],
    });
    const r = computeGroupLockToggle(state, 'fig_leaf');
    expect(new Set(r!.ids)).toEqual(new Set(['fig_root', 'fig_mid', 'fig_leaf']));
    expect(r!.newLocked).toBe(true);
  });

  it('grouped: single-member group still goes through the group path', () => {
    const root = makeGroup('rootG');
    const state = makeState({
      groups: [root],
      figures: [makeFigure('fig1', { groupId: 'rootG' })],
    });
    const r = computeGroupLockToggle(state, 'fig1');
    expect(r!.ids).toEqual(['fig1']);
    expect(r!.newLocked).toBe(true);
  });
});
