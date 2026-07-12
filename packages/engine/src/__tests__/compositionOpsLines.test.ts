import { applyCompOps, revertCompOps, buildColorToolOps, computeSVGBbox } from '../compositionOps';
import { CompositionState, CompositionFigure, SVGObject, CompUndoEntry, GroupNode, makeViewport } from '../types';

function makeFigure(overrides: Partial<CompositionFigure> = {}): CompositionFigure {
  return {
    id: 'fig1',
    figureKey: 'test',
    cellX: 10, cellY: 10,
    resolutionX: 2, resolutionY: 2,
    cellWidth: 2, cellHeight: 2,
    rotation: 0,
    ...overrides,
  };
}

function makeState(svgObjects: SVGObject[] = [], overrides: Partial<CompositionState> = {}): CompositionState {
  return {
    id: 'test',
    name: 'test',
    figures: [],
    svgObjects,
    lineDraft: null,
    arcDraft: null,
    editingLineId: null,
    selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups: [],
    sceneOrder: svgObjects.map((l) => l.id),
    gridLevel: 0,
    strokeScale: 8,
    gridIntensity: 0.5,
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

function makeSVG(id: string, overrides: Partial<SVGObject> = {}): SVGObject {
  const segs = overrides.segments ?? [{kind:'line' as const, start:[0,0] as [number,number], end:[10,0] as [number,number]}];
  return {
    id,
    segments: segs,
    color: { r: 255, g: 255, b: 255 },
    ...computeSVGBbox(segs),
    ...overrides,
  };
}

describe('svg undo ops round-trip', () => {
  test('createSVG + revert removes the svg object', () => {
    const svg = makeSVG('svg_1');
    const state = makeState([]);
    const entry: CompUndoEntry = [{ op: 'createSVG', svg }];
    const after = applyCompOps(state, entry);
    expect(after.svgObjects).toHaveLength(1);
    expect(after.svgObjects[0].id).toBe('svg_1');
    const reverted = revertCompOps(after, entry);
    expect(reverted.svgObjects).toHaveLength(0);
  });

  test('removeObject (svg) + revert restores the svg object', () => {
    const svg = makeSVG('svg_1');
    const state = makeState([svg]);
    const entry: CompUndoEntry = [{ op: 'removeObject', kind: 'svg', item: svg }];
    const after = applyCompOps(state, entry);
    expect(after.svgObjects).toHaveLength(0);
    const reverted = revertCompOps(after, entry);
    expect(reverted.svgObjects).toHaveLength(1);
    expect(reverted.svgObjects[0]).toEqual(svg);
  });

  test('editSVGSegments + revert restores original segments', () => {
    const svg = makeSVG('svg_1', { segments: [{kind:'line', start:[0,0], end:[10,0]}] });
    const state = makeState([svg]);
    const newSegments = [{kind:'line' as const, start:[0,0] as [number,number], end:[10,5] as [number,number]}];
    const entry: CompUndoEntry = [{
      op: 'editSVGSegments',
      svgId: 'svg_1',
      oldSegments: [{kind:'line', start:[0,0], end:[10,0]}],
      newSegments,
    }];
    const after = applyCompOps(state, entry);
    expect(after.svgObjects[0].segments).toEqual(newSegments);
    const reverted = revertCompOps(after, entry);
    expect(reverted.svgObjects[0].segments).toEqual([{kind:'line', start:[0,0], end:[10,0]}]);
  });

  test('editSVGSegments revert with localSegments restores world segments, not identity', () => {
    // Simulate an arc that was previously scaled: localSegments (identity) differs
    // from segments (world). The undo op's oldSegments must be the pre-scale WORLD
    // segments so that undo restores the correct size, not the identity size.
    const identitySegs = [{kind:'arc' as const, start:[0,0] as [number,number], end:[3,3] as [number,number], center:[0,3] as [number,number]}];
    const preScaleWorldSegs = [{kind:'arc' as const, start:[0,0] as [number,number], end:[6,6] as [number,number], center:[0,6] as [number,number]}];
    const postScaleWorldSegs = [{kind:'arc' as const, start:[0,0] as [number,number], end:[9,9] as [number,number], center:[0,9] as [number,number]}];
    const svg = makeSVG('arc_1', {
      segments: preScaleWorldSegs,
      localSegments: identitySegs,
      ...computeSVGBbox(preScaleWorldSegs),
    });
    const state = makeState([svg]);
    // The undo op should store pre-scale WORLD as oldSegments (not identity).
    const entry: CompUndoEntry = [{
      op: 'editSVGSegments',
      svgId: 'arc_1',
      oldSegments: preScaleWorldSegs,
      newSegments: postScaleWorldSegs,
      oldLocalSegments: identitySegs,
      newLocalSegments: identitySegs,
    }];
    const after = applyCompOps(state, entry);
    expect(after.svgObjects[0].segments).toEqual(postScaleWorldSegs);
    expect(after.svgObjects[0].localSegments).toEqual(identitySegs);
    const reverted = revertCompOps(after, entry);
    // Must restore pre-scale world segments, NOT identity segments
    expect(reverted.svgObjects[0].segments).toEqual(preScaleWorldSegs);
    expect(reverted.svgObjects[0].localSegments).toEqual(identitySegs);
    // Bbox must match pre-scale world, not identity
    expect(reverted.svgObjects[0].cellWidth).toBe(6);
    expect(reverted.svgObjects[0].cellHeight).toBe(6);
  });

  test('recolorSVG + revert restores original color', () => {
    const oldColor = { r: 255, g: 255, b: 255 };
    const newColor = { r: 200, g: 100, b: 50 };
    const svg = makeSVG('svg_1', { color: oldColor });
    const state = makeState([svg]);
    const entry: CompUndoEntry = [{ op: 'recolorSVG', svgId: 'svg_1', oldColor, newColor }];
    const after = applyCompOps(state, entry);
    expect(after.svgObjects[0].color).toEqual(newColor);
    const reverted = revertCompOps(after, entry);
    expect(reverted.svgObjects[0].color).toEqual(oldColor);
  });

  test('recolorFigure sets colorOverride and revert clears it', () => {
    const fig = makeFigure({ id: 'fig_1' });
    const state = makeState([], { figures: [fig], sceneOrder: ['fig_1'] });
    const newColor = { r: 200, g: 100, b: 50 };
    const entry: CompUndoEntry = [{ op: 'recolorFigure', figureId: 'fig_1', oldColor: undefined, newColor }];
    const after = applyCompOps(state, entry);
    expect(after.figures[0].colorOverride).toEqual(newColor);
    const reverted = revertCompOps(after, entry);
    expect(reverted.figures[0].colorOverride).toBeUndefined();
  });

  test('recolorFigure replaces an existing colorOverride and revert restores it', () => {
    const oldColor = { r: 10, g: 20, b: 30 };
    const newColor = { r: 200, g: 100, b: 50 };
    const fig = makeFigure({ id: 'fig_1', colorOverride: oldColor });
    const state = makeState([], { figures: [fig], sceneOrder: ['fig_1'] });
    const entry: CompUndoEntry = [{ op: 'recolorFigure', figureId: 'fig_1', oldColor, newColor }];
    const after = applyCompOps(state, entry);
    expect(after.figures[0].colorOverride).toEqual(newColor);
    const reverted = revertCompOps(after, entry);
    expect(reverted.figures[0].colorOverride).toEqual(oldColor);
  });

  test('recolorFigure sets colorOverrideBlendMode and revert restores it', () => {
    const fig = makeFigure({ id: 'fig_1' });
    const state = makeState([], { figures: [fig], sceneOrder: ['fig_1'] });
    const newColor = { r: 200, g: 100, b: 50 };
    const entry: CompUndoEntry = [{ op: 'recolorFigure', figureId: 'fig_1', oldColor: undefined, newColor, oldBlendMode: undefined, newBlendMode: 'multiply' }];
    const after = applyCompOps(state, entry);
    expect(after.figures[0].colorOverride).toEqual(newColor);
    expect(after.figures[0].colorOverrideBlendMode).toBe('multiply');
    const reverted = revertCompOps(after, entry);
    expect(reverted.figures[0].colorOverride).toBeUndefined();
    expect(reverted.figures[0].colorOverrideBlendMode).toBeUndefined();
  });

  test('recolorFigure replaces blend mode and revert restores old mode', () => {
    const oldColor = { r: 10, g: 20, b: 30 };
    const newColor = { r: 200, g: 100, b: 50 };
    const fig = makeFigure({ id: 'fig_1', colorOverride: oldColor, colorOverrideBlendMode: 'normal' });
    const state = makeState([], { figures: [fig], sceneOrder: ['fig_1'] });
    const entry: CompUndoEntry = [{ op: 'recolorFigure', figureId: 'fig_1', oldColor, newColor, oldBlendMode: 'normal', newBlendMode: 'dodge' }];
    const after = applyCompOps(state, entry);
    expect(after.figures[0].colorOverrideBlendMode).toBe('dodge');
    const reverted = revertCompOps(after, entry);
    expect(reverted.figures[0].colorOverrideBlendMode).toBe('normal');
  });

  test('lockObject (svg) + revert toggles lock state', () => {
    const svg = makeSVG('svg_1', { locked: false });
    const state = makeState([svg]);
    const entry: CompUndoEntry = [{ op: 'lockObject', id: 'svg_1', oldValue: false, newValue: true }];
    const after = applyCompOps(state, entry);
    expect(after.svgObjects[0].locked).toBe(true);
    const reverted = revertCompOps(after, entry);
    expect(reverted.svgObjects[0].locked).toBe(false);
  });

});

describe('groupFigures with mixed figures and svg objects', () => {
  test('apply sets groupId and localSegments on svg objects', () => {
    const fig = makeFigure({ id: 'a', name: 'Figure 1' });
    const svg = makeSVG('svg_1', { name: 'My SVG', segments: [{kind:'line', start:[0,0], end:[5,5]}] });
    const state = makeState([svg], { figures: [fig] });
    const entry: CompUndoEntry = [{
      op: 'groupFigures',
      figureIds: ['a', 'svg_1'],
      groupId: 'g1',
      groupName: 'Group 1',
      oldNames: ['Figure 1', 'My SVG'],
    }];
    const result = applyCompOps(state, entry);
    expect(result.figures[0].groupId).toBe('g1');
    expect(result.svgObjects[0].groupId).toBe('g1');
    expect(result.svgObjects[0].preGroupName).toBe('My SVG');
    expect(result.svgObjects[0].localSegments).toEqual([{kind:'line', start:[0,0], end:[5,5]}]);
  });

  test('apply assigns group name to first member (svg object)', () => {
    const svg1 = makeSVG('svg_1', { name: 'SVG A' });
    const svg2 = makeSVG('svg_2', { name: 'SVG B', segments: [{kind:'line', start:[1,1], end:[2,2]}] });
    const state = makeState([svg1, svg2]);
    const entry: CompUndoEntry = [{
      op: 'groupFigures',
      figureIds: ['svg_1', 'svg_2'],
      groupId: 'g1',
      groupName: 'Group 1',
      oldNames: ['SVG A', 'SVG B'],
    }];
    const result = applyCompOps(state, entry);
    expect(result.svgObjects[0].name).toBe('Group 1');
    expect(result.svgObjects[1].name).toBeUndefined();
  });

  test('revert clears groupId and restores names on svg objects', () => {
    const svg = makeSVG('svg_1', {
      name: undefined,
      groupId: 'g1',
      preGroupName: 'My SVG',
      localSegments: [{kind:'line', start:[0,0], end:[5,5]}],
    });
    const fig = makeFigure({ id: 'a', name: 'Group 1', groupId: 'g1', preGroupName: 'Fig A' });
    const state = makeState([svg], { figures: [fig] });
    const entry: CompUndoEntry = [{
      op: 'groupFigures',
      figureIds: ['a', 'svg_1'],
      groupId: 'g1',
      groupName: 'Group 1',
      oldNames: ['Fig A', 'My SVG'],
    }];
    const result = revertCompOps(state, entry);
    expect(result.svgObjects[0].groupId).toBeUndefined();
    expect(result.svgObjects[0].name).toBe('My SVG');
    expect(result.svgObjects[0].preGroupName).toBeUndefined();
    expect(result.svgObjects[0].localSegments).toBeUndefined();
    expect(result.figures[0].groupId).toBeUndefined();
    expect(result.figures[0].name).toBe('Fig A');
  });
});

describe('ungroupFigures with mixed figures and svg objects', () => {
  test('apply clears groupId and restores names on svg objects', () => {
    const fig = makeFigure({ id: 'a', name: 'Group 1', groupId: 'g1', preGroupName: 'Fig A' });
    const svg = makeSVG('svg_1', {
      name: undefined,
      groupId: 'g1',
      preGroupName: 'My SVG',
      localSegments: [{kind:'line', start:[0,0], end:[5,5]}],
    });
    const state = makeState([svg], { figures: [fig] });
    const entry: CompUndoEntry = [{
      op: 'ungroupFigures',
      figureIds: ['a', 'svg_1'],
      groupId: 'g1',
      groupName: 'Group 1',
    }];
    const result = applyCompOps(state, entry);
    expect(result.svgObjects[0].groupId).toBeUndefined();
    expect(result.svgObjects[0].name).toBe('My SVG');
    expect(result.svgObjects[0].preGroupName).toBeUndefined();
    expect(result.svgObjects[0].localSegments).toBeUndefined();
    expect(result.figures[0].groupId).toBeUndefined();
    expect(result.figures[0].name).toBe('Fig A');
  });

  test('revert re-groups svg objects via groupFigures forward op', () => {
    const fig = makeFigure({ id: 'a', name: 'Fig A' });
    const svg = makeSVG('svg_1', { name: 'My SVG', segments: [{kind:'line', start:[0,0], end:[5,5]}] });
    const state = makeState([svg], { figures: [fig] });
    const entry: CompUndoEntry = [{
      op: 'ungroupFigures',
      figureIds: ['a', 'svg_1'],
      groupId: 'g1',
      groupName: 'Group 1',
    }];
    const result = revertCompOps(state, entry);
    expect(result.svgObjects[0].groupId).toBe('g1');
    expect(result.svgObjects[0].preGroupName).toBe('My SVG');
    expect(result.svgObjects[0].localSegments).toEqual([{kind:'line', start:[0,0], end:[5,5]}]);
    expect(result.figures[0].groupId).toBe('g1');
  });

  test('full group/ungroup/undo round-trip with mixed figures and svg objects', () => {
    const fig = makeFigure({ id: 'a', name: 'Fig A' });
    const svg = makeSVG('svg_1', { name: 'My SVG', segments: [{kind:'line', start:[0,0], end:[5,5]}] });
    const state = makeState([svg], { figures: [fig] });

    // Group
    const groupEntry: CompUndoEntry = [{
      op: 'groupFigures',
      figureIds: ['a', 'svg_1'],
      groupId: 'g1',
      groupName: 'Group 1',
      oldNames: ['Fig A', 'My SVG'],
    }];
    const grouped = applyCompOps(state, groupEntry);
    expect(grouped.figures[0].groupId).toBe('g1');
    expect(grouped.svgObjects[0].groupId).toBe('g1');

    // Ungroup
    const ungroupEntry: CompUndoEntry = [{
      op: 'ungroupFigures',
      figureIds: ['a', 'svg_1'],
      groupId: 'g1',
      groupName: 'Group 1',
    }];
    const ungrouped = applyCompOps(grouped, ungroupEntry);
    expect(ungrouped.figures[0].name).toBe('Fig A');
    expect(ungrouped.svgObjects[0].name).toBe('My SVG');
    expect(ungrouped.figures[0].groupId).toBeUndefined();
    expect(ungrouped.svgObjects[0].groupId).toBeUndefined();

    // Undo ungroup (re-group)
    const reGrouped = revertCompOps(ungrouped, ungroupEntry);
    expect(reGrouped.figures[0].groupId).toBe('g1');
    expect(reGrouped.svgObjects[0].groupId).toBe('g1');

    // Undo group (fully restored)
    const fullyRestored = revertCompOps(reGrouped, groupEntry);
    expect(fullyRestored.figures[0].name).toBe('Fig A');
    expect(fullyRestored.figures[0].groupId).toBeUndefined();
    expect(fullyRestored.svgObjects[0].name).toBe('My SVG');
    expect(fullyRestored.svgObjects[0].groupId).toBeUndefined();
    expect(fullyRestored.svgObjects[0].localSegments).toBeUndefined();
  });
});

describe('buildColorToolOps', () => {
  const RED = { r: 255, g: 0, b: 0 };

  test('recolors selected SVGs and figures, skipping locked items', () => {
    const svgA = makeSVG('svg_a', { color: { r: 255, g: 255, b: 255 } });
    const svgB = makeSVG('svg_b', { color: { r: 255, g: 255, b: 255 }, locked: true });
    const figA = makeFigure({ id: 'fig_a' });
    const figB = makeFigure({ id: 'fig_b', locked: true });
    const state = makeState([svgA, svgB], {
      figures: [figA, figB],
      sceneOrder: ['svg_a', 'svg_b', 'fig_a', 'fig_b'],
      selectedFigureIds: new Set(['svg_a', 'svg_b', 'fig_a', 'fig_b']),
    });

    const ops = buildColorToolOps(state, RED);
    expect(ops).toHaveLength(2);
    const svgOp = ops.find(o => o.op === 'recolorSVG');
    const figOp = ops.find(o => o.op === 'recolorFigure');
    expect(svgOp).toMatchObject({ op: 'recolorSVG', svgId: 'svg_a', newColor: RED });
    expect(figOp).toMatchObject({ op: 'recolorFigure', figureId: 'fig_a', newColor: RED });
  });

  test('skips items already at the picked color', () => {
    const svg = makeSVG('svg_a', { color: RED });
    const fig = makeFigure({ id: 'fig_a', colorOverride: RED });
    const state = makeState([svg], {
      figures: [fig],
      sceneOrder: ['svg_a', 'fig_a'],
      selectedFigureIds: new Set(['svg_a', 'fig_a']),
    });
    expect(buildColorToolOps(state, RED)).toHaveLength(0);
  });

  test('returns empty when nothing is selected', () => {
    const svg = makeSVG('svg_a');
    const state = makeState([svg], { selectedFigureIds: new Set() });
    expect(buildColorToolOps(state, RED)).toHaveLength(0);
  });

  test('expands a group id in selection through all descendants', () => {
    const group: GroupNode = {
      id: 'g1', name: 'G',
      translateX: 0, translateY: 0,
      scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const svg = makeSVG('svg_a', { groupId: 'g1', color: { r: 255, g: 255, b: 255 } });
    const fig = makeFigure({ id: 'fig_a', groupId: 'g1' });
    const state = makeState([svg], {
      figures: [fig],
      groups: [group],
      sceneOrder: ['svg_a', 'fig_a'],
      // Stuff a group id into selection to exercise the defensive fan-out.
      selectedFigureIds: new Set(['g1']),
    });

    const ops = buildColorToolOps(state, RED);
    const ids = new Set(ops.map(o => o.op === 'recolorSVG' ? o.svgId : o.op === 'recolorFigure' ? o.figureId : ''));
    expect(ids.has('svg_a')).toBe(true);
    expect(ids.has('fig_a')).toBe(true);
  });
});
