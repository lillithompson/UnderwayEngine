/**
 * The export reads poses off a scene graph (P5 of
 * docs/transform-refactor.md).
 *
 * Which graph is the first question, and the only one this file asks: a
 * live caller's own graph knows things its legacy arrays cannot spell (a
 * world scale, a shear), so it must be kept; a graph that no longer
 * describes those arrays must not, or the export draws a gesture behind
 * the picture it was handed.
 */

import { exportGraph } from '../compositionSVGCore';
import type { CompositionSVGInputs } from '../compositionSVGCore';
import { applyCompOps, withSceneGraph } from '../compositionOps';
import { fromLegacy, worldMatrix } from '../sceneGraph';
import { matUniformScale } from '../sceneTransform';
import { CompositionState, ImageObject, makeViewport } from '../types';

jest.mock('@/native-shell/bridge/webBridge', () => ({
  logToNative: jest.fn(),
}));

function makeState(overrides: Partial<CompositionState> = {}): CompositionState {
  return {
    id: 'test', name: 'test',
    figures: [], svgObjects: [], images: [], texts: [],
    paintObjects: [], patternObjects: [],
    imageBlobs: {},
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups: [], sceneOrder: [],
    gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
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

const image = (): ImageObject => ({
  id: 'img', imageId: 'blob', mimeType: 'image/png',
  pixelWidth: 40, pixelHeight: 20,
  cellX: 3, cellY: 5, cellWidth: 4, cellHeight: 2,
} as ImageObject);

/** The generator's inputs for a state, the way every live caller builds
 *  them: the arrays as they stand, and the state's own graph beside. */
function inputsFor(state: CompositionState): CompositionSVGInputs {
  return {
    name: state.name,
    figures: state.figures,
    svgObjects: state.svgObjects,
    images: state.images ?? [],
    imageBlobs: {},
    texts: state.texts,
    paintObjects: state.paintObjects,
    patternObjects: state.patternObjects,
    groups: state.groups,
    sceneOrder: state.sceneOrder,
    graph: state.graph,
    loadFigure: async () => null,
  };
}

describe('exportGraph', () => {
  test('builds one from the arrays when the caller has no graph', () => {
    const state = makeState({ images: [image()], sceneOrder: ['img'] });
    const graph = exportGraph(inputsFor(state));
    expect(graph.nodes.get('img')?.localBox)
      .toEqual({ x: 0, y: 0, width: 4, height: 2 });
  });

  test('keeps a live graph rather than rebuilding it', () => {
    const state = withSceneGraph(makeState({ images: [image()], sceneOrder: ['img'] }));
    expect(exportGraph(inputsFor(state))).toBe(state.graph);
  });

  test('keeps the world scale the legacy arrays cannot spell', () => {
    // A leaf scaled in place: the graph carries the scale on the node's
    // transform, and the legacy view can only report a bigger box. A
    // rebuild off that box gives a scale of 1 — the very thing the export
    // is meant to stop losing.
    const start = withSceneGraph(makeState({ images: [image()], sceneOrder: ['img'] }));
    const from = start.graph!.nodes.get('img')!.transform;
    const scaled = applyCompOps(start, [{
      op: 'setTransform', nodeId: 'img',
      from, to: { ...from, sx: 3, sy: 3 },
    }]);
    expect(matUniformScale(worldMatrix(scaled.graph!, 'img'))).toBeCloseTo(3);

    const kept = exportGraph(inputsFor(scaled));
    expect(kept).toBe(scaled.graph);
    expect(matUniformScale(worldMatrix(kept, 'img'))).toBeCloseTo(3);

    const rebuilt = fromLegacy(scaled);
    expect(matUniformScale(worldMatrix(rebuilt, 'img'))).toBeCloseTo(1);
  });

  test('rebuilds when the graph no longer describes the arrays', () => {
    // A preview path spreads new arrays over an old state; its graph is a
    // gesture behind the picture, so the arrays win.
    const state = withSceneGraph(makeState({ images: [image()], sceneOrder: ['img'] }));
    const moved: CompositionState = {
      ...state,
      images: [{ ...state.images![0], cellX: 30 }],
    };
    const graph = exportGraph(inputsFor(moved));
    expect(graph).not.toBe(state.graph);
    expect(worldMatrix(graph, 'img').e).toBeCloseTo(30);
  });
});
