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

import { computeSVGBbox } from '../compositionOps';
import {
  SceneGraph, SceneNode, fromLegacy, getNode, leafNodeFromLegacy, legacyLeafOf, worldMatrix,
} from '../sceneGraph';
import { localMatrix, matEquals, matInvert, matUniformScale, MAT_IDENTITY } from '../sceneTransform';
import {
  CompositionState, ImageObject, PathSegment, SVGObject, TextObject, makeViewport,
} from '../types';

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

/**
 * A grouped path's own frame.
 *
 * The legacy model bakes every ancestor turn into a member's VERTICES and
 * then measures the member with an upright rectangle, so what it stores
 * about a path inside a turned group is a tilted shape and the loose box
 * around it. The node takes the parent's turn back off the inside — the
 * segments un-turned, the same turn put on the transform — so the frame
 * the shape was authored in comes back: own axes, tight box. The pose is
 * untouched by the respelling, and so is everything the arrays store.
 */
describe('a path inside a turned group', () => {
  /** `pts` as a closed polyline, with the stored box the legacy model
   *  keeps for it. */
  function pathOf(id: string, pts: Array<[number, number]>, extra: Partial<SVGObject> = {}): SVGObject {
    const segments: PathSegment[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      segments.push({ kind: 'line', start: pts[i], end: pts[i + 1] });
    }
    return {
      id, segments, color: { r: 0, g: 0, b: 0 },
      ...computeSVGBbox(segments), ...extra,
    } as SVGObject;
  }

  /** A quarter turn clockwise about the origin — what a `rotation: 90`
   *  group bakes into its members' world coordinates. */
  const turned = (pts: Array<[number, number]>): Array<[number, number]> =>
    pts.map(([x, y]) => [-y, x] as [number, number]);

  /** An L, so the shape's own centre and the centre of the upright
   *  rectangle around its turned self are not the same point — which is
   *  what the free-angle pivot has to get right. */
  const ELL: Array<[number, number]> = [[10, 10], [14, 10], [14, 11], [11, 11], [11, 12], [10, 12], [10, 10]];

  const grouped = (extra: Partial<SVGObject> = {}) => makeState({
    svgObjects: [pathOf('path', turned(ELL), { groupId: 'g1', ...extra })],
    groups: [{
      id: 'g1', name: 'g1', translateX: 0, translateY: 0,
      scaleX: 1, scaleY: 1, rotation: 90, mirrorH: false, mirrorV: false,
    }],
    sceneOrder: ['path'],
  });

  test('is measured in its own axes, not the page s', () => {
    const graph = fromLegacy(grouped());
    const node = getNode(graph, 'path')!;
    // The L is 4 across and 2 down as it was drawn; turned a quarter, the
    // page measures it 2 across and 4 down.
    expect(node.localBox!.width).toBeCloseTo(4, 9);
    expect(node.localBox!.height).toBeCloseTo(2, 9);
    expect(graph.nodes.get('path')!.content!.cellWidth).toBeCloseTo(2, 9);
  });

  /**
   * The leaf under a group turned `parentDeg`, and the graph holding the
   * two — built by hand because a `GroupNode` cannot spell a turn off the
   * quarters, which is the case with the most to lose here.
   */
  function underTurn(parentDeg: number, extra: Partial<SVGObject> = {}) {
    const transform = { tx: 0, ty: 0, sx: 1, sy: 1, rotationDeg: parentDeg };
    const th = (parentDeg * Math.PI) / 180;
    const c = Math.cos(th), s = Math.sin(th);
    const leaf = pathOf('path', ELL.map(([x, y]) => [x * c - y * s, x * s + y * c] as [number, number]),
      { groupId: 'g1', ...extra });
    const node = leafNodeFromLegacy('svg', leaf, matInvert(localMatrix(transform)));
    const graph: SceneGraph = {
      nodes: new Map<string, SceneNode>([
        ['g1', { id: 'g1', kind: 'group', transform, children: ['path'] }],
        ['path', node],
      ]),
      roots: ['g1'],
      generation: 0,
    };
    return { leaf, node, graph };
  }

  test('a turn off the quarters gets a tight box too', () => {
    // The L is 4 x 2 however the group is turned; the page's rectangle
    // around it at 37 degrees is neither.
    const { node, leaf } = underTurn(37);
    expect(node.localBox!.width).toBeCloseTo(4, 9);
    expect(node.localBox!.height).toBeCloseTo(2, 9);
    expect(leaf.cellWidth).toBeGreaterThan(4);
  });

  test.each([
    [90, undefined], [90, 33], [37, undefined], [37, 33],
  ])('renders back to the very fields it came from (parent %s, angleDeg %s)', (parentDeg, angleDeg) => {
    const { leaf: was, node, graph } = underTurn(
      parentDeg, angleDeg === undefined ? {} : { angleDeg },
    );
    const out = legacyLeafOf(graph, node) as SVGObject;

    expect(out.angleDeg).toEqual(angleDeg);
    expect(out.cellX).toBeCloseTo(was.cellX, 9);
    expect(out.cellY).toBeCloseTo(was.cellY, 9);
    expect(out.cellWidth).toBeCloseTo(was.cellWidth, 9);
    expect(out.cellHeight).toBeCloseTo(was.cellHeight, 9);
    out.segments.forEach((seg, i) => {
      const before = was.segments[i] as Extract<PathSegment, { kind: 'line' }>;
      const after = seg as Extract<PathSegment, { kind: 'line' }>;
      expect(after.start[0]).toBeCloseTo(before.start[0], 9);
      expect(after.start[1]).toBeCloseTo(before.start[1], 9);
      expect(after.end[0]).toBeCloseTo(before.end[0], 9);
      expect(after.end[1]).toBeCloseTo(before.end[1], 9);
    });
  });

  test('a repeat-mode path keeps the page s frame: its box is a region', () => {
    // The stored box of a tiling path is the REGION it fills, not the
    // path's own bounds, and an upright world rectangle has no un-turned
    // spelling to recover — so this one is left in world axes.
    const state = grouped({ tileMode: 'repeat', cellX: -20, cellY: 4, cellWidth: 9, cellHeight: 7 });
    const node = getNode(fromLegacy(state), 'path')!;
    expect(node.localBox!.width).toBeCloseTo(9, 9);
    expect(node.localBox!.height).toBeCloseTo(7, 9);
  });
});
