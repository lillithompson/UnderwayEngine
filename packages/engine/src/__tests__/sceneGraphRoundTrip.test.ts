/**
 * The scene graph reproduces the legacy scene, exactly.
 *
 * This is the acceptance test for P2 of docs/transform-refactor.md. The
 * graph is a different way of storing where things are — local transforms
 * multiplying down a hierarchy, instead of world coordinates on every
 * leaf — and the only thing that matters about the change is that it is
 * invisible. So: take a scene, convert it to a graph, convert it back,
 * and require the world poses to be unmoved, on every `.tile` fixture the
 * repo has plus hand-built scenes that isolate the hard cases.
 *
 * `worldSnapshot` is the judge, and it describes only what renders — no
 * local caches, no identity stashes, no storage of any kind. That is what
 * makes it a fair one.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

import { deserializeComposition } from '../compositionBinaryFormat';
import {
  applyCompOps, assertGroupLocalsConsistent, materializeGroupHierarchy,
  revertCompOps, withSceneGraph,
} from '../compositionOps';
import {
  EMPTY_GRAPH, SceneGraph, ancestors, descendants, flattenLeaves, fromLegacy,
  getNode, toLegacyView, worldBbox, worldMatrix, worldSegments,
} from '../sceneGraph';
import { LOCAL_IDENTITY, localMatrix, matIsSimilarity } from '../sceneTransform';
import { applySceneOps, buildUngroup } from '../sceneGraphOps';
import { diffWorldSnapshots, worldSnapshot } from '../worldSnapshot';
import {
  CompUndoEntry, CompositionState, GroupNode, ImageObject, PathSegment,
  SVGObject, TextObject, makeViewport,
} from '../types';

jest.mock('@/native-shell/bridge/webBridge', () => ({
  logToNative: jest.fn(),
}));

// ── Scaffolding ────────────────────────────────────────────────────────

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

/** Convert to a graph and back, then say what moved. */
function roundTripDiff(state: CompositionState): string | null {
  const view = toLegacyView(fromLegacy(state));
  const after: CompositionState = { ...state, ...view };
  return diffWorldSnapshots(
    worldSnapshot(state), worldSnapshot(after), { ignoreSvgBbox: true },
  );
}

function expectRoundTrips(state: CompositionState): void {
  const diff = roundTripDiff(state);
  if (diff) throw new Error('the graph moved something:\n' + diff);
}

function group(overrides: Partial<GroupNode> & { id: string }): GroupNode {
  return {
    name: overrides.id,
    translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
    rotation: 0, mirrorH: false, mirrorV: false,
    ...overrides,
  };
}

function image(overrides: Partial<ImageObject> & { id: string }): ImageObject {
  return {
    imageId: 'blob', mimeType: 'image/png', pixelWidth: 40, pixelHeight: 30,
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 3,
    ...overrides,
  };
}

function text(overrides: Partial<TextObject> & { id: string }): TextObject {
  return {
    content: 'hi',
    style: { fontId: 'CozySans', size: 2, color: { r: 0, g: 0, b: 0 } },
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2,
    ...overrides,
  };
}

function line(start: [number, number], end: [number, number]): PathSegment {
  return { kind: 'line', start, end };
}

function svg(overrides: Partial<SVGObject> & { id: string }): SVGObject {
  return {
    color: { r: 0, g: 0, b: 0 },
    segments: [line([0, 0], [4, 2])],
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2,
    ...overrides,
  };
}

// ── Structure ──────────────────────────────────────────────────────────

describe('the graph is the outline', () => {
  test('an empty scene is an empty graph', () => {
    const g = fromLegacy(makeState());
    expect(g.nodes.size).toBe(0);
    expect(g.roots).toEqual([]);
    expect(flattenLeaves(g)).toEqual([]);
  });

  test('every leaf and every group is a node', () => {
    const state = makeState({
      images: [image({ id: 'img_1', groupId: 'g1' })],
      texts: [text({ id: 'txt_1' })],
      groups: [group({ id: 'g1' })],
      sceneOrder: ['img_1', 'txt_1'],
    });
    const g = fromLegacy(state);
    expect([...g.nodes.keys()].sort()).toEqual(['g1', 'img_1', 'txt_1']);
    expect(getNode(g, 'g1')!.kind).toBe('group');
    expect(getNode(g, 'img_1')!.parentId).toBe('g1');
    expect(getNode(g, 'txt_1')!.parentId).toBeUndefined();
  });

  test('a group with no content still has a transform and a name', () => {
    const g = fromLegacy(makeState({ groups: [group({ id: 'g1', name: 'Roof', translateX: 5 })] }));
    const node = getNode(g, 'g1')!;
    expect(node.name).toBe('Roof');
    expect(node.transform.tx).toBe(5);
    expect(node.content).toBeUndefined();
    expect(node.localBox).toBeUndefined();
  });

  test('children carry the paint order, and flattening restores it', () => {
    const state = makeState({
      images: [image({ id: 'img_1', groupId: 'g1' }), image({ id: 'img_2', groupId: 'g1' })],
      texts: [text({ id: 'txt_1' })],
      groups: [group({ id: 'g1' })],
      sceneOrder: ['img_1', 'img_2', 'txt_1'],
    });
    const g = fromLegacy(state);
    expect(getNode(g, 'g1')!.children).toEqual(['img_1', 'img_2']);
    expect(flattenLeaves(g).map((n) => n.id)).toEqual(['img_1', 'img_2', 'txt_1']);
  });

  test('nesting walks both ways', () => {
    const state = makeState({
      images: [image({ id: 'img_1', groupId: 'inner' })],
      groups: [group({ id: 'outer' }), group({ id: 'inner', parentGroupId: 'outer' })],
      sceneOrder: ['img_1'],
    });
    const g = fromLegacy(state);
    expect(ancestors(g, 'img_1').map((n) => n.id)).toEqual(['inner', 'outer']);
    expect(descendants(g, 'outer').map((n) => n.id).sort()).toEqual(['img_1', 'inner']);
    expect(g.roots).toEqual(['outer']);
  });

  test('a parent cycle in broken data terminates instead of hanging', () => {
    const state = makeState({
      groups: [group({ id: 'a', parentGroupId: 'b' }), group({ id: 'b', parentGroupId: 'a' })],
    });
    const g = fromLegacy(state);
    expect(ancestors(g, 'a').length).toBeLessThanOrEqual(2);
  });
});

// ── World transforms ───────────────────────────────────────────────────

describe('world transforms multiply down the hierarchy', () => {
  test('a root node\'s world matrix is its local one', () => {
    const g = fromLegacy(makeState({
      images: [image({ id: 'img_1', cellX: 3, cellY: 4 })], sceneOrder: ['img_1'],
    }));
    const node = getNode(g, 'img_1')!;
    expect(worldMatrix(g, 'img_1')).toEqual(localMatrix(node.transform));
  });

  test('a group translate moves its members', () => {
    const state = makeState({
      images: [image({ id: 'img_1', groupId: 'g1', cellX: 10, cellY: 10 })],
      groups: [group({ id: 'g1', translateX: 5, translateY: -2 })],
      sceneOrder: ['img_1'],
    });
    const g = fromLegacy(state);
    const box = worldBbox(g, 'img_1');
    // fromLegacy reads WORLD fields, so the member is already where the
    // legacy state said it was; the group transform is divided out of its
    // local pose rather than added to its world one.
    expect(box.x).toBeCloseTo(10, 9);
    expect(box.y).toBeCloseTo(10, 9);
  });

  test('a group\'s world bbox is the union of its members\'', () => {
    const state = makeState({
      images: [
        image({ id: 'img_1', groupId: 'g1', cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 }),
        image({ id: 'img_2', groupId: 'g1', cellX: 10, cellY: 5, cellWidth: 2, cellHeight: 2 }),
      ],
      groups: [group({ id: 'g1' })],
      sceneOrder: ['img_1', 'img_2'],
    });
    const box = worldBbox(fromLegacy(state), 'g1');
    expect(box).toEqual({ x: 0, y: 0, width: 12, height: 7 });
  });

  test('world segments come back in world coordinates', () => {
    const state = makeState({
      svgObjects: [svg({ id: 'svg_1', segments: [line([1, 2], [3, 4])], cellX: 1, cellY: 2, cellWidth: 2, cellHeight: 2 })],
      sceneOrder: ['svg_1'],
    });
    expect(worldSegments(fromLegacy(state), 'svg_1')).toEqual([line([1, 2], [3, 4])]);
  });

  test(`the cache serves one scene its own matrices, not another's`, () => {
    // Every graph fromLegacy builds starts at generation 0, so a cache
    // keyed on generation alone would hand the second scene the first
    // one's answers. It is keyed on the nodes map instead.
    const near = fromLegacy(makeState({
      images: [image({ id: 'img_1', cellX: 0, cellY: 0 })], sceneOrder: ['img_1'],
    }));
    const far = fromLegacy(makeState({
      images: [image({ id: 'img_1', cellX: 100, cellY: 50 })], sceneOrder: ['img_1'],
    }));
    expect(near.generation).toBe(far.generation);
    expect(worldMatrix(near, 'img_1')).not.toEqual(worldMatrix(far, 'img_1'));
    expect(worldBbox(near, 'img_1').x).toBeCloseTo(0, 9);
    expect(worldBbox(far, 'img_1').x).toBeCloseTo(100, 9);
  });

  test('repeated reads are stable', () => {
    const g = fromLegacy(makeState({
      images: [image({ id: 'img_1', groupId: 'g1' })],
      groups: [group({ id: 'g1', translateX: 3, rotation: 90 })],
      sceneOrder: ['img_1'],
    }));
    const first = worldMatrix(g, 'img_1');
    expect(worldMatrix(g, 'img_1')).toEqual(first);
  });

  test('an unknown id is the identity, not a crash', () => {
    expect(worldMatrix(EMPTY_GRAPH, 'nope')).toEqual(localMatrix(LOCAL_IDENTITY));
    expect(worldBbox(EMPTY_GRAPH, 'nope')).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

// ── Round trip: hand-built scenes ──────────────────────────────────────

describe('a scene survives the round trip', () => {
  test('a bare leaf', () => {
    expectRoundTrips(makeState({
      images: [image({ id: 'img_1', cellX: 3, cellY: 4 })], sceneOrder: ['img_1'],
    }));
  });

  test('every quarter turn and flip', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      for (const mirrorH of [false, true]) {
        for (const mirrorV of [false, true]) {
          expectRoundTrips(makeState({
            images: [image({ id: 'img_1', cellX: 3, cellY: 4, rotation, mirrorH, mirrorV })],
            sceneOrder: ['img_1'],
          }));
        }
      }
    }
  });

  test('a free angle, alone and on top of a quarter turn', () => {
    for (const angleDeg of [15, 45, 137.5, 300]) {
      for (const rotation of [0, 90, 180, 270] as const) {
        expectRoundTrips(makeState({
          texts: [text({ id: 'txt_1', cellX: 1, cellY: 1, rotation, angleDeg })],
          sceneOrder: ['txt_1'],
        }));
      }
    }
  });

  test('a leaf inside a translated group', () => {
    expectRoundTrips(makeState({
      images: [image({ id: 'img_1', groupId: 'g1', cellX: 10, cellY: 10 })],
      groups: [group({ id: 'g1', translateX: 5, translateY: -2 })],
      sceneOrder: ['img_1'],
    }));
  });

  test('a leaf inside a scaled, turned, flipped group', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      expectRoundTrips(makeState({
        images: [image({ id: 'img_1', groupId: 'g1', cellX: 10, cellY: 10, rotation: 90 })],
        groups: [group({ id: 'g1', translateX: 5, scaleX: 2, scaleY: 2, rotation, mirrorH: true })],
        sceneOrder: ['img_1'],
      }));
    }
  });

  test('nested groups', () => {
    expectRoundTrips(makeState({
      images: [image({ id: 'img_1', groupId: 'inner', cellX: 6, cellY: 6 })],
      texts: [text({ id: 'txt_1', groupId: 'outer', cellX: 1, cellY: 1, angleDeg: 20 })],
      groups: [
        group({ id: 'outer', translateX: 2, scaleX: 3, scaleY: 3 }),
        group({ id: 'inner', parentGroupId: 'outer', translateY: 4, rotation: 270 }),
      ],
      sceneOrder: ['img_1', 'txt_1'],
    }));
  });

  test('svg geometry, grouped and turned', () => {
    expectRoundTrips(makeState({
      svgObjects: [
        svg({ id: 'svg_1', segments: [line([0, 0], [4, 0]), { kind: 'arc', start: [4, 0], end: [6, 2], center: [4, 2] }] }),
        svg({ id: 'svg_2', groupId: 'g1', segments: [line([2, 2], [5, 9])], cellX: 2, cellY: 2, cellWidth: 3, cellHeight: 7, angleDeg: 33 }),
      ],
      groups: [group({ id: 'g1', translateX: 1, scaleX: 2, scaleY: 0.5, rotation: 90 })],
      sceneOrder: ['svg_1', 'svg_2'],
    }));
  });

  test('a mixed scene of every kind', () => {
    expectRoundTrips(makeState({
      figures: [{
        id: 'fig_1', figureKey: 'k', resolutionX: 2, resolutionY: 2,
        cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2, rotation: 90, groupId: 'g1',
      }],
      svgObjects: [svg({ id: 'svg_1', groupId: 'g1' })],
      images: [image({ id: 'img_1', angleDeg: 12 })],
      texts: [text({ id: 'txt_1', rotation: 270, mirrorH: true })],
      groups: [group({ id: 'g1', translateX: 3, translateY: 3 })],
      sceneOrder: ['fig_1', 'svg_1', 'img_1', 'txt_1'],
    }));
  });

  test('paint order is preserved through the tree', () => {
    const state = makeState({
      images: [image({ id: 'img_1' }), image({ id: 'img_2', groupId: 'g1' })],
      texts: [text({ id: 'txt_1', groupId: 'g1' }), text({ id: 'txt_2' })],
      groups: [group({ id: 'g1' })],
      sceneOrder: ['img_1', 'img_2', 'txt_1', 'txt_2'],
    });
    expect(toLegacyView(fromLegacy(state)).sceneOrder).toEqual(
      ['img_1', 'img_2', 'txt_1', 'txt_2'],
    );
  });

  test('group flags survive', () => {
    const state = makeState({
      images: [image({ id: 'img_1', groupId: 'g1' })],
      groups: [group({ id: 'g1', name: 'Frame 1', isFrame: true, locked: true, hidden: true })],
      sceneOrder: ['img_1'],
    });
    const back = toLegacyView(fromLegacy(state)).groups[0];
    expect(back).toMatchObject({
      id: 'g1', name: 'Frame 1', isFrame: true, locked: true, hidden: true,
    });
  });

  test('content that is not pose is carried through untouched', () => {
    const state = makeState({
      texts: [text({ id: 'txt_1', content: 'hello there', sticker: true })],
      sceneOrder: ['txt_1'],
    });
    const back = toLegacyView(fromLegacy(state)).texts[0];
    expect(back.content).toBe('hello there');
    expect(back.sticker).toBe(true);
    expect(back.style.fontId).toBe('CozySans');
  });
});

// ── The cases the legacy model could not express ───────────────────────

describe('what the graph can say that the legacy model could not', () => {
  test('a group can hold a free rotation', () => {
    // GroupNode has no angleDeg at all, so a group twist had to be fanned
    // out into a per-member orbit plus a per-member angle.
    const g = fromLegacy(makeState({
      images: [image({ id: 'img_1', groupId: 'g1' })],
      groups: [group({ id: 'g1' })],
      sceneOrder: ['img_1'],
    }));
    const turned: SceneGraph = {
      ...g,
      generation: g.generation + 1,
      nodes: new Map(g.nodes).set('g1', {
        ...getNode(g, 'g1')!,
        transform: { ...getNode(g, 'g1')!.transform, rotationDeg: 33 },
      }),
    };
    // One transform changed; the member did not move relative to it.
    expect(getNode(turned, 'img_1')).toBe(getNode(g, 'img_1'));
    const m = worldMatrix(turned, 'img_1');
    expect(matIsSimilarity(m)).toBe(true);
    expect(worldBbox(turned, 'img_1').width).toBeCloseTo(
      4 * Math.abs(Math.cos(33 * Math.PI / 180)) + 3 * Math.abs(Math.sin(33 * Math.PI / 180)), 6,
    );
  });

  test('a non-uniform group scale over a turned child produces shear, and keeps it', () => {
    const g = fromLegacy(makeState({
      images: [image({ id: 'img_1', groupId: 'g1', angleDeg: 45 })],
      groups: [group({ id: 'g1' })],
      sceneOrder: ['img_1'],
    }));
    const squashed: SceneGraph = {
      ...g,
      generation: g.generation + 1,
      nodes: new Map(g.nodes).set('g1', {
        ...getNode(g, 'g1')!,
        transform: { ...getNode(g, 'g1')!.transform, sx: 3, sy: 1 },
      }),
    };
    // The legacy model had nowhere to put this and approximated it with
    // "the nearest rotated rectangle"; here it is just a matrix.
    expect(matIsSimilarity(worldMatrix(squashed, 'img_1'))).toBe(false);
  });
});

// ── Round trip: the .tile fixtures ─────────────────────────────────────

const TEST_DATA = path.join(__dirname, '../../test_data');

function findTiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...findTiles(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith('.tile')) out.push(rel);
  }
  return out.sort();
}

function loadTile(rel: string): CompositionState {
  const data = new Uint8Array(fs.readFileSync(path.join(TEST_DATA, rel)));
  const { meta } = deserializeComposition(zlib.inflateSync(data));
  return materializeGroupHierarchy(makeState({
    id: rel, name: rel,
    figures: meta.figures ?? [],
    svgObjects: meta.svgObjects ?? [],
    images: meta.images ?? [],
    texts: meta.texts ?? [],
    paintObjects: meta.paintObjects ?? [],
    patternObjects: meta.patternObjects ?? [],
    groups: meta.groups ?? [],
    sceneOrder: meta.sceneOrder ?? [],
    gridLevel: meta.gridLevel ?? 0,
  }));
}

describe('every .tile fixture survives the round trip', () => {
  test.each(findTiles(TEST_DATA))('%s', (rel) => {
    expectRoundTrips(loadTile(rel));
  });
});

// ── Round trip after an edit ───────────────────────────────────────────

describe('the graph tracks the scene through edits', () => {
  test('a move', () => {
    let state = makeState({
      images: [image({ id: 'img_1' })], sceneOrder: ['img_1'],
    });
    state = applyCompOps(state, [{ op: 'moveNode', nodeId: 'img_1', dx: 3, dy: 4 }]);
    expectRoundTrips(state);
  });

  test('a group, then a group transform', () => {
    let state = makeState({
      images: [image({ id: 'img_1' }), image({ id: 'img_2', cellX: 8 })],
      sceneOrder: ['img_1', 'img_2'],
    });
    const groupOp: CompUndoEntry = [{
      op: 'groupFigures', figureIds: ['img_1', 'img_2'], groupId: 'g1', groupName: 'g1',
    }];
    state = applyCompOps(state, groupOp);
    expectRoundTrips(state);

    state = applyCompOps(state, [{
      op: 'transformGroup', groupId: 'g1',
      oldTranslateX: 0, oldTranslateY: 0, oldScaleX: 1, oldScaleY: 1,
      oldRotation: 0, oldMirrorH: false, oldMirrorV: false,
      newTranslateX: 4, newTranslateY: 1, newScaleX: 2, newScaleY: 2,
      newRotation: 90, newMirrorH: false, newMirrorV: false,
    }]);
    expectRoundTrips(state);
  });

  test('a twist inside a group', () => {
    let state = makeState({
      texts: [text({ id: 'txt_1' })], sceneOrder: ['txt_1'],
    });
    state = applyCompOps(state, [{
      op: 'groupFigures', figureIds: ['txt_1'], groupId: 'g1', groupName: 'g1',
    }]);
    state = applyCompOps(state, [{
      op: 'setNodeRotation', id: 'txt_1', oldAngleDeg: undefined, newAngleDeg: 30,
    }]);
    expectRoundTrips(state);
  });
});

// ── The graph as a live field on the state ─────────────────────────────

describe('a composition that carries a graph keeps it true', () => {
  /** The graph on the state agrees with the arrays beside it. */
  function expectAgrees(state: CompositionState): void {
    expect(state.graph).toBeDefined();
    const diff = diffWorldSnapshots(
      worldSnapshot(state),
      worldSnapshot({ ...state, ...toLegacyView(state.graph!) }),
      { ignoreSvgBbox: true },
    );
    if (diff) throw new Error('the graph and the arrays disagree:\n' + diff);
  }

  test('a state without one pays nothing', () => {
    const state = makeState({ images: [image({ id: 'img_1' })], sceneOrder: ['img_1'] });
    expect(state.graph).toBeUndefined();
    const moved = applyCompOps(state, [{ op: 'moveNode', nodeId: 'img_1', dx: 1, dy: 1 }]);
    expect(moved.graph).toBeUndefined();
  });

  test('opting in builds one that matches', () => {
    expectAgrees(withSceneGraph(makeState({
      images: [image({ id: 'img_1', groupId: 'g1', angleDeg: 20 })],
      groups: [group({ id: 'g1', translateX: 2, rotation: 90 })],
      sceneOrder: ['img_1'],
    })));
  });

  test('it survives a move, a group, a transform and an undo', () => {
    let state = withSceneGraph(makeState({
      images: [image({ id: 'img_1' }), image({ id: 'img_2', cellX: 8 })],
      sceneOrder: ['img_1', 'img_2'],
    }));
    expectAgrees(state);

    state = applyCompOps(state, [{ op: 'moveNode', nodeId: 'img_1', dx: 3, dy: 4 }]);
    expectAgrees(state);

    const groupOp: CompUndoEntry = [{
      op: 'groupFigures', figureIds: ['img_1', 'img_2'], groupId: 'g1', groupName: 'g1',
    }];
    state = applyCompOps(state, groupOp);
    expectAgrees(state);
    expect(getNode(state.graph!, 'img_1')!.parentId).toBe('g1');

    const transformOp: CompUndoEntry = [{
      op: 'transformGroup', groupId: 'g1',
      oldTranslateX: 0, oldTranslateY: 0, oldScaleX: 1, oldScaleY: 1,
      oldRotation: 0, oldMirrorH: false, oldMirrorV: false,
      newTranslateX: 4, newTranslateY: 1, newScaleX: 2, newScaleY: 2,
      newRotation: 90, newMirrorH: false, newMirrorV: false,
    }];
    state = applyCompOps(state, transformOp);
    expectAgrees(state);

    state = revertCompOps(state, transformOp);
    expectAgrees(state);

    state = revertCompOps(state, groupOp);
    expectAgrees(state);
    expect(getNode(state.graph!, 'img_1')!.parentId).toBeUndefined();
  });

  test('a removed node leaves the graph', () => {
    let state = withSceneGraph(makeState({
      images: [image({ id: 'img_1' })], sceneOrder: ['img_1'],
    }));
    expect(state.graph!.nodes.has('img_1')).toBe(true);
    state = applyCompOps(state, [{
      op: 'removeObject', kind: 'image', item: state.images![0], sceneOrderIndex: 0,
    }]);
    expect(state.graph!.nodes.has('img_1')).toBe(false);
    expectAgrees(state);
  });
});

// ── The local caches, gone ─────────────────────────────────────────────

describe('a graph-backed leaf carries no local caches', () => {
  /**
   * The second copy of a grouped leaf's pose is not derived, not stored,
   * and not there.
   *
   * That is the fix for the stale-locals bug at its root: a cache that
   * does not exist cannot disagree with the pose. The legacy materialize
   * pass leaves a leaf with no locals alone, which is exactly right for a
   * leaf whose truth is the graph — so the invariant checker has nothing
   * to complain about either.
   */
  function expectNoLocals(state: CompositionState): void {
    const view = toLegacyView(fromLegacy(state));
    const leaves = [
      ...view.figures, ...view.svgObjects, ...view.images,
      ...view.texts, ...view.paintObjects, ...view.patternObjects,
    ] as unknown as Array<Record<string, unknown>>;
    for (const leaf of leaves) {
      for (const field of [
        'localCellX', 'localCellY', 'localCellWidth', 'localCellHeight',
        'localRotation', 'localMirrorH', 'localMirrorV', 'localAngleDeg',
        'localSegments', 'localSubpaths',
      ]) {
        expect({ id: leaf.id, field, value: leaf[field] })
          .toEqual({ id: leaf.id, field, value: undefined });
      }
    }
    // And nothing an ancestor transform would move.
    expect(() => assertGroupLocalsConsistent({ ...state, ...view })).not.toThrow();
  }

  test('a scaled, turned, flipped group', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      expectNoLocals(makeState({
        images: [image({ id: 'img_1', groupId: 'g1', cellX: 5, cellY: 5, rotation: 90 })],
        texts: [text({ id: 'txt_1', groupId: 'g1', cellX: 1, cellY: 1, angleDeg: 25 })],
        groups: [group({
          id: 'g1', translateX: 3, scaleX: 2, scaleY: 2, rotation, mirrorH: true,
        })],
        sceneOrder: ['img_1', 'txt_1'],
      }));
    }
  });

  test('svg geometry in a group', () => {
    expectNoLocals(makeState({
      svgObjects: [svg({
        id: 'svg_1', groupId: 'g1',
        segments: [line([2, 2], [6, 5])], cellX: 2, cellY: 2, cellWidth: 4, cellHeight: 3,
      })],
      groups: [group({ id: 'g1', translateX: 1, scaleX: 2, scaleY: 2, rotation: 90 })],
      sceneOrder: ['svg_1'],
    }));
  });

  test('nested groups', () => {
    expectNoLocals(makeState({
      images: [image({ id: 'img_1', groupId: 'inner', cellX: 6, cellY: 6 })],
      groups: [
        group({ id: 'outer', translateX: 2, scaleX: 3, scaleY: 3 }),
        group({ id: 'inner', parentGroupId: 'outer', translateY: 4, rotation: 270 }),
      ],
      sceneOrder: ['img_1'],
    }));
  });

  test('every .tile fixture', () => {
    for (const rel of findTiles(TEST_DATA)) expectNoLocals(loadTile(rel));
  });

  test('ungrouping keeps the node where it was', () => {
    const state = makeState({
      images: [image({ id: 'img_1', groupId: 'g1', cellX: 5, cellY: 5 })],
      groups: [group({ id: 'g1', translateX: 3 })],
      sceneOrder: ['img_1'],
    });
    const g = fromLegacy(state);
    const ungrouped = applySceneOps(g, buildUngroup(g, 'g1'));
    const img = toLegacyView(ungrouped).images[0];
    expect(img.groupId).toBeUndefined();
    expect(img.cellX).toBeCloseTo(5, 9);
  });
});
