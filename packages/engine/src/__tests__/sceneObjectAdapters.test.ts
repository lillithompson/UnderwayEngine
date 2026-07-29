import {
  SCENE_ADAPTERS,
  reorderSceneObjects,
  captureSceneOrder,
  applySceneOrder,
  computeSVGBbox,
  deriveSceneOrderFromKindArrays,
} from '../compositionOps';
import {
  CompositionState,
  CompositionFigure,
  SVGObject,
  makeViewport,
} from '../types';

function makeFigure(id: string, overrides: Partial<CompositionFigure> = {}): CompositionFigure {
  return {
    id,
    figureKey: 'test',
    cellX: 0, cellY: 0,
    resolutionX: 2, resolutionY: 2,
    cellWidth: 2, cellHeight: 2,
    rotation: 0,
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

function makeState(parts: Partial<CompositionState> = {}): CompositionState {
  const figures = parts.figures ?? [];
  const svgObjects = parts.svgObjects ?? [];
  const images = parts.images ?? [];
  return {
    id: 'test',
    name: 'test',
    figures,
    svgObjects,
    images,
    imageBlobs: {},
    lineDraft: null,
    arcDraft: null,
    editingLineId: null,
    selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups: [],
    sceneOrder: parts.sceneOrder ?? deriveSceneOrderFromKindArrays({ figures, svgObjects, images }),
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
    ...parts,
  };
}

describe('SCENE_ADAPTERS', () => {
  test('one adapter per kind', () => {
    const kinds = SCENE_ADAPTERS.map((a) => a.kind).sort();
    expect(kinds).toEqual(['figure', 'image', 'svg', 'text']);
  });

  test('matchesId routes ids by namespace', () => {
    const figureA = SCENE_ADAPTERS.find((a) => a.kind === 'figure')!;
    const svgA = SCENE_ADAPTERS.find((a) => a.kind === 'svg')!;
    const imgA = SCENE_ADAPTERS.find((a) => a.kind === 'image')!;
    expect(figureA.matchesId('1234')).toBe(true);
    expect(figureA.matchesId('svg_1')).toBe(false);
    expect(figureA.matchesId('img_1')).toBe(false);
    expect(svgA.matchesId('svg_1')).toBe(true);
    expect(svgA.matchesId('img_1')).toBe(false);
    expect(imgA.matchesId('img_1')).toBe(true);
    expect(imgA.matchesId('1234')).toBe(false);
    expect(imgA.matchesId('svg_1')).toBe(false);
  });
});

describe('reorderSceneObjects', () => {
  test('back moves selected ids to the front of sceneOrder (= back of paint)', () => {
    const state = makeState({
      figures: [makeFigure('a'), makeFigure('b'), makeFigure('c')],
    });
    const next = reorderSceneObjects(state, new Set(['c']), 'back');
    expect(next.sceneOrder).toEqual(['c', 'a', 'b']);
    expect(next.renderGeneration).toBe(state.renderGeneration + 1);
  });

  test('front moves selected ids to the end of sceneOrder (= front of paint)', () => {
    const state = makeState({
      figures: [makeFigure('a'), makeFigure('b'), makeFigure('c')],
    });
    const next = reorderSceneObjects(state, new Set(['a']), 'front');
    expect(next.sceneOrder).toEqual(['b', 'c', 'a']);
  });

  test('preserves relative order of moved items', () => {
    const state = makeState({
      figures: [makeFigure('a'), makeFigure('b'), makeFigure('c'), makeFigure('d')],
    });
    const next = reorderSceneObjects(state, new Set(['c', 'a']), 'back');
    expect(next.sceneOrder).toEqual(['a', 'c', 'b', 'd']);
  });

  test('reorders mixed-kind selection in a single sceneOrder pass', () => {
    const state = makeState({
      figures: [makeFigure('f1'), makeFigure('f2')],
      svgObjects: [makeSVG('svg_1'), makeSVG('svg_2'), makeSVG('svg_3'), makeSVG('svg_4')],
    });
    const next = reorderSceneObjects(
      state,
      new Set(['f2', 'svg_2', 'svg_4']),
      'back',
    );
    // sceneOrder starts as: fig+svg = [f1, f2, svg_1, svg_2, svg_3, svg_4]
    // After 'back' for {f2, svg_2, svg_4}: moved=[f2,svg_2,svg_4] (input order), rest=[f1,svg_1,svg_3]
    expect(next.sceneOrder).toEqual(['f2', 'svg_2', 'svg_4', 'f1', 'svg_1', 'svg_3']);
    // Kind arrays themselves are not reordered â€” sceneOrder is the source of truth.
    expect(next.figures.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(next.svgObjects.map((s) => s.id)).toEqual(['svg_1', 'svg_2', 'svg_3', 'svg_4']);
  });

  test('no-op when no ids match â€” does not bump renderGeneration', () => {
    const state = makeState({ figures: [makeFigure('a')], renderGeneration: 7 });
    const next = reorderSceneObjects(state, new Set(['nonexistent']), 'back');
    expect(next).toBe(state);
    expect(next.renderGeneration).toBe(7);
  });

});

describe('captureSceneOrder + applySceneOrder', () => {
  test('round-trip preserves sceneOrder', () => {
    const state = makeState({
      figures: [makeFigure('a'), makeFigure('b'), makeFigure('c')],
      svgObjects: [makeSVG('svg_1')],
    });
    const captured = captureSceneOrder(state);
    const reordered = reorderSceneObjects(state, new Set(['c']), 'back');
    expect(reordered.sceneOrder).not.toEqual(captured);
    const restored = applySceneOrder(reordered, captured);
    expect(restored.sceneOrder).toEqual(captured);
  });

  test('captureSceneOrder is a defensive copy (mutating it must not touch state)', () => {
    const state = makeState({
      figures: [makeFigure('a'), makeFigure('b')],
    });
    const captured = captureSceneOrder(state);
    captured.push('mutated');
    expect(state.sceneOrder).toEqual(['a', 'b']);
  });

  test('applySceneOrder bumps renderGeneration', () => {
    const state = makeState({
      figures: [makeFigure('a'), makeFigure('b')],
      renderGeneration: 5,
    });
    const next = applySceneOrder(state, ['b', 'a']);
    expect(next.sceneOrder).toEqual(['b', 'a']);
    expect(next.renderGeneration).toBe(6);
  });
});

describe('deriveSceneOrderFromKindArrays', () => {
});
