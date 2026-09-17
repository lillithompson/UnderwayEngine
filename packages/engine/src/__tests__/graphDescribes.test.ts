/**
 * A graph knows which arrays it stands for.
 *
 * A host holding a state has to decide whether to trust the graph beside
 * its arrays or rebuild one from them. Rebuilding is only right when the
 * arrays were written behind the graph's back (a preview spreading new
 * arrays over an old state); a graph the reducer made says more than the
 * arrays can — a group's free turn has no legacy spelling — and must be
 * kept.
 */

import { applyCompOps, withSceneGraph } from '../compositionOps';
import { fromLegacy, graphDescribes, toLegacyView } from '../sceneGraph';
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
  id: 'img', imageId: 'blob', pixelWidth: 40, pixelHeight: 20,
  cellX: 3, cellY: 5, cellWidth: 4, cellHeight: 2,
} as ImageObject);

describe('graphDescribes', () => {
  test('a graph describes the arrays it was built from', () => {
    const state = makeState({ images: [image()], sceneOrder: ['img'] });
    const graph = fromLegacy(state);
    expect(graphDescribes(graph, state)).toBe(true);
    expect(graphDescribes(graph, { ...state, images: [...state.images!] })).toBe(false);
  });

  test('a graph describes the arrays it rendered', () => {
    const state = makeState({ images: [image()], sceneOrder: ['img'] });
    const graph = fromLegacy(state);
    const view = toLegacyView(graph);
    expect(graphDescribes(graph, { ...state, ...view })).toBe(true);
  });

  test('the reducer hands back a state its graph describes; a preview spread does not', () => {
    const state = withSceneGraph(makeState({ images: [image()], sceneOrder: ['img'] }));
    expect(graphDescribes(state.graph!, state)).toBe(true);
    const moved = applyCompOps(state, [{ op: 'moveNode', nodeId: 'img', dx: 1, dy: 0 }]);
    expect(graphDescribes(moved.graph!, moved)).toBe(true);
    // Arrays written behind the graph's back: the old graph is a gesture behind.
    const spread = { ...moved, images: moved.images!.map((i) => ({ ...i, cellX: 99 })) };
    expect(graphDescribes(spread.graph!, spread)).toBe(false);
  });

  test('a graph never seen says no', () => {
    const state = makeState();
    expect(graphDescribes({ nodes: new Map(), roots: [], generation: 0 }, state)).toBe(false);
  });
});
