/**
 * A legacy leaf on its own gets the node the graph would build for it.
 *
 * The host draws some objects that live in no graph — a ghost of a
 * proposed copy, the live preview of a corner resize — and it draws them
 * with the same layer it draws committed nodes with. That layer reads a
 * node and a world matrix, so a bare leaf needs the same conversion
 * `fromLegacy` makes, and it must be the SAME conversion: two readings
 * of one set of fields is the bug class the refactor exists to end.
 */

import { fromLegacy, getNode, leafNodeFromLegacy, worldMatrix } from '../sceneGraph';
import { localMatrix, matUniformScale, matEquals, MAT_IDENTITY } from '../sceneTransform';
import { CompositionState, ImageObject, SVGObject, TextObject, makeViewport } from '../types';

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

const image = (extra: Partial<ImageObject> = {}): ImageObject => ({
  id: 'img', imageId: 'blob', pixelWidth: 40, pixelHeight: 20,
  cellX: 3, cellY: 5, cellWidth: 4, cellHeight: 2,
  ...extra,
} as ImageObject);

const text = (): TextObject => ({
  id: 'txt', content: 'hi',
  style: { fontId: 'f', size: 1, color: { r: 0, g: 0, b: 0 } },
  cellX: 1, cellY: 1, cellWidth: 3, cellHeight: 1,
  rotation: 90, angleDeg: 20,
} as unknown as TextObject);

const svg = (): SVGObject => ({
  id: 'path', color: { r: 0, g: 0, b: 0 },
  segments: [
    { kind: 'line', start: [2, 2], end: [6, 2] },
    { kind: 'line', start: [6, 2], end: [6, 5] },
  ],
  cellX: 2, cellY: 2, cellWidth: 4, cellHeight: 3,
  angleDeg: 33,
} as unknown as SVGObject);

describe('leafNodeFromLegacy', () => {
  test.each([
    ['image', () => makeState({ images: [image({ mirrorH: true, rotation: 270 })], sceneOrder: ['img'] }), 'img'],
    ['text', () => makeState({ texts: [text()], sceneOrder: ['txt'] }), 'txt'],
    ['svg', () => makeState({ svgObjects: [svg()], sceneOrder: ['path'] }), 'path'],
  ] as const)('a root %s gets the node fromLegacy builds, at the same world matrix', (kind, make, id) => {
    const state = make();
    const graph = fromLegacy(state);
    const leaf = kind === 'image' ? state.images![0] : kind === 'text' ? state.texts![0] : state.svgObjects[0];
    const node = leafNodeFromLegacy(kind, leaf);
    expect(node).toEqual(getNode(graph, id));
    expect(matEquals(localMatrix(node.transform), worldMatrix(graph, id))).toBe(true);
  });

  test('the default parent is the world, so the transform IS the world pose', () => {
    const node = leafNodeFromLegacy('image', image({ angleDeg: 45 }));
    expect(node.parentId).toBeUndefined();
    expect(node.transform.rotationDeg).toBe(45);
    // The content box centre lands on the bbox centre, whatever the turn.
    const m = localMatrix(node.transform);
    const cx = m.a * 2 + m.c * 1 + m.e, cy = m.b * 2 + m.d * 1 + m.f;
    expect(cx).toBeCloseTo(5);
    expect(cy).toBeCloseTo(6);
  });
});

describe('matUniformScale', () => {
  test('the identity and a pure turn have no scale', () => {
    expect(matUniformScale(MAT_IDENTITY)).toBe(1);
    expect(matUniformScale(localMatrix({ tx: 0, ty: 0, sx: 1, sy: 1, rotationDeg: 37 }))).toBeCloseTo(1);
  });

  test('a uniform scale is read back exactly, flips and all', () => {
    expect(matUniformScale({ a: 2, b: 0, c: 0, d: 2, e: 9, f: 9 })).toBe(2);
    expect(matUniformScale({ a: -2, b: 0, c: 0, d: 2, e: 0, f: 0 })).toBe(2);
  });

  test('a stretch gives the geometric mean of its two factors', () => {
    expect(matUniformScale({ a: 4, b: 0, c: 0, d: 1, e: 0, f: 0 })).toBe(2);
  });
});
