/**
 * Ops on the scene graph (docs/transform-refactor.md §3.4, P3).
 *
 * The properties that matter are the ones the legacy op set could not
 * guarantee:
 *
 * - a group gesture edits ONE transform and leaves its members alone;
 * - grouping, ungrouping and reparenting do not move anything, exactly,
 *   with no reconcile pass to forget;
 * - every op undoes to precisely where it started, however many times.
 */

import {
  SceneGraph, fromLegacy, getNode, toLegacyView, worldBbox, worldMatrix,
} from '../sceneGraph';
import {
  SceneEntry, applySceneOp, applySceneOps, buildGroup, buildMoveBy,
  buildSetParent, buildSetTransform, buildUngroup, gestureRoots,
  indexOfChild, localUnder, previewWorldMatrix, revertSceneOp, revertSceneOps,
  worldDeltaToParent,
} from '../sceneGraphOps';
import { LOCAL_IDENTITY, localEquals, localMatrix } from '../sceneTransform';
import { diffWorldSnapshots, worldSnapshot } from '../worldSnapshot';
import {
  CompositionState, GroupNode, ImageObject, TextObject, makeViewport,
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

/** A scene of two images and a text, the images grouped. */
function scene(): SceneGraph {
  return fromLegacy(makeState({
    images: [
      image({ id: 'img_1', groupId: 'g1', cellX: 0, cellY: 0 }),
      image({ id: 'img_2', groupId: 'g1', cellX: 10, cellY: 5 }),
    ],
    texts: [text({ id: 'txt_1', cellX: 20, cellY: 20 })],
    groups: [group({ id: 'g1' })],
    sceneOrder: ['img_1', 'img_2', 'txt_1'],
  }));
}

/** Nothing in the scene moved.
 *
 *  Compared leaf by leaf rather than position by position, because
 *  grouping re-orders on purpose: a group gathers its members together,
 *  and where they land among their new siblings is paint order, not
 *  position on the page. */
function expectUnmoved(before: SceneGraph, after: SceneGraph): void {
  const byId = (g: SceneGraph) =>
    worldSnapshot(makeState(toLegacyView(g))).sort((a, b) => a.id.localeCompare(b.id));
  const diff = diffWorldSnapshots(byId(before), byId(after),
    // Grouping and ungrouping are *about* changing who the parent is;
    // what they must not change is where anything sits.
    { ignoreSvgBbox: true, ignoreGroupId: true });
  if (diff) throw new Error(`something moved:\n${diff}`);
}

/** Applying then reverting an entry restores the scene exactly. */
function expectRoundTrips(graph: SceneGraph, entry: SceneEntry): SceneGraph {
  const applied = applySceneOps(graph, entry);
  expectUnmovedOrDifferent(graph, applied);
  const back = revertSceneOps(applied, entry);
  expectUnmoved(graph, back);
  expect([...back.nodes.keys()].sort()).toEqual([...graph.nodes.keys()].sort());
  expect(back.roots).toEqual(graph.roots);
  for (const [id, node] of graph.nodes) {
    const after = back.nodes.get(id)!;
    expect(localEquals(after.transform, node.transform)).toBe(true);
    expect(after.parentId).toBe(node.parentId);
    expect(after.children ?? []).toEqual(node.children ?? []);
  }
  return applied;
}

/** A placeholder so `expectRoundTrips` reads symmetrically; applying an
 *  entry may or may not move things, and that is the caller's business. */
function expectUnmovedOrDifferent(_a: SceneGraph, _b: SceneGraph): void { /* noop */ }

// ── setTransform ───────────────────────────────────────────────────────

describe('setTransform', () => {
  test('moves a leaf', () => {
    const g = scene();
    const op = buildSetTransform(g, 'txt_1', {
      ...getNode(g, 'txt_1')!.transform, tx: 100,
    })!;
    const moved = applySceneOp(g, op);
    expect(worldBbox(moved, 'txt_1').x).toBeCloseTo(100 - 0, 9);
  });

  test('a group gesture edits one transform and leaves the members alone', () => {
    // The legacy model fanned a group drag out into one moveNode per
    // member plus a reconcile pass. Here the members are untouched — not
    // merely unmoved relative to the group, but the same objects.
    const g = scene();
    const op = buildSetTransform(g, 'g1', { ...LOCAL_IDENTITY, tx: 7, ty: 3 })!;
    const moved = applySceneOp(g, op);

    expect(getNode(moved, 'img_1')).toBe(getNode(g, 'img_1'));
    expect(getNode(moved, 'img_2')).toBe(getNode(g, 'img_2'));
    expect(worldBbox(moved, 'img_1').x).toBeCloseTo(7, 9);
    expect(worldBbox(moved, 'img_2').x).toBeCloseTo(17, 9);
    // And the ungrouped text did not come along.
    expect(worldBbox(moved, 'txt_1').x).toBeCloseTo(20, 9);
  });

  test('a group twist is one transform, not an orbit per member', () => {
    // GroupNode had no angle at all, so a twist became a per-member orbit
    // plus a per-member angle, accumulating float error in N places.
    const g = scene();
    const op = buildSetTransform(g, 'g1', { ...LOCAL_IDENTITY, rotationDeg: 33 })!;
    const turned = applySceneOp(g, op);
    expect(getNode(turned, 'img_1')).toBe(getNode(g, 'img_1'));
    expect(getNode(turned, 'g1')!.transform.rotationDeg).toBe(33);
  });

  test('undoes exactly', () => {
    const g = scene();
    expectRoundTrips(g, [buildSetTransform(g, 'g1', {
      tx: 3, ty: -4, sx: 2, sy: 0.5, rotationDeg: 47, mirrorH: true,
    })!]);
  });

  test('a hundred turns and back leave the transform where it started', () => {
    // Per-member fan-out rounded each member's cell origin every turn
    // (the legacy Math.round in rotateGroupMemberFigure90CW), so a group
    // walked off its members. One transform cannot.
    let g = scene();
    const start = getNode(g, 'g1')!.transform;
    for (let i = 0; i < 100; i++) {
      g = applySceneOp(g, buildSetTransform(g, 'g1', {
        ...getNode(g, 'g1')!.transform,
        rotationDeg: getNode(g, 'g1')!.transform.rotationDeg + 90,
      })!);
    }
    expect(localEquals(getNode(g, 'g1')!.transform, {
      ...start, rotationDeg: 9000,
    })).toBe(true);
    // 9000 degrees is 25 full turns: the members are back where they began.
    expectUnmoved(scene(), g);
  });

  test('an unknown node is a no-op, not a crash', () => {
    const g = scene();
    expect(buildSetTransform(g, 'nope', LOCAL_IDENTITY)).toBeNull();
    expect(applySceneOp(g, {
      op: 'setTransform', nodeId: 'nope', from: LOCAL_IDENTITY, to: LOCAL_IDENTITY,
    })).toBe(g);
  });
});

// ── setParent ──────────────────────────────────────────────────────────

describe('setParent', () => {
  test('reparenting does not move the node', () => {
    const g = fromLegacy(makeState({
      images: [image({ id: 'img_1', cellX: 10, cellY: 10 })],
      groups: [group({ id: 'g1', translateX: 5, scaleX: 2, scaleY: 2, rotation: 90 })],
      sceneOrder: ['img_1'],
    }));
    const before = worldBbox(g, 'img_1');
    const moved = applySceneOp(g, buildSetParent(g, 'img_1', 'g1', 0)!);
    const after = worldBbox(moved, 'img_1');
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(after.width).toBeCloseTo(before.width, 9);
    expect(after.height).toBeCloseTo(before.height, 9);
  });

  test('the new local transform is the exact inverse composition', () => {
    const g = fromLegacy(makeState({
      images: [image({ id: 'img_1', cellX: 10, cellY: 10 })],
      groups: [group({ id: 'g1', translateX: 5, translateY: -3, rotation: 180 })],
      sceneOrder: ['img_1'],
    }));
    const local = localUnder(g, 'img_1', 'g1');
    const moved = applySceneOp(g, buildSetParent(g, 'img_1', 'g1', 0)!);
    expect(localEquals(getNode(moved, 'img_1')!.transform, local)).toBe(true);
    // Composing the parent back over it returns the original world matrix.
    expect(previewWorldMatrix(moved, 'img_1', local)).toEqual(worldMatrix(g, 'img_1'));
  });

  test('refuses to put a node inside its own descendant', () => {
    const g = fromLegacy(makeState({
      images: [image({ id: 'img_1', groupId: 'inner' })],
      groups: [group({ id: 'outer' }), group({ id: 'inner', parentGroupId: 'outer' })],
      sceneOrder: ['img_1'],
    }));
    expect(buildSetParent(g, 'outer', 'inner', 0)).toBeNull();
    expect(buildSetParent(g, 'outer', 'outer', 0)).toBeNull();
  });

  test('undoes exactly', () => {
    const g = scene();
    expectRoundTrips(g, [buildSetParent(g, 'txt_1', 'g1', 1)!]);
  });
});

// ── group / ungroup ────────────────────────────────────────────────────

describe('group and ungroup', () => {
  test('grouping moves nothing', () => {
    const g = scene();
    const entry = buildGroup(g, ['img_1', 'txt_1'], 'g2', 'G2');
    expectUnmoved(g, applySceneOps(g, entry));
  });

  test('grouping inside a transformed group still moves nothing', () => {
    const g = fromLegacy(makeState({
      images: [
        image({ id: 'img_1', groupId: 'g1', cellX: 2, cellY: 2 }),
        image({ id: 'img_2', groupId: 'g1', cellX: 9, cellY: 4, rotation: 90 }),
      ],
      groups: [group({ id: 'g1', translateX: 3, scaleX: 2, scaleY: 2, rotation: 270 })],
      sceneOrder: ['img_1', 'img_2'],
    }));
    expectUnmoved(g, applySceneOps(g, buildGroup(g, ['img_1', 'img_2'], 'g2', 'G2')));
  });

  test('ungrouping moves nothing', () => {
    const g = fromLegacy(makeState({
      images: [
        image({ id: 'img_1', groupId: 'g1', cellX: 2, cellY: 2 }),
        image({ id: 'img_2', groupId: 'g1', cellX: 9, cellY: 4, angleDeg: 20 }),
      ],
      groups: [group({ id: 'g1', translateX: 3, scaleX: 2, scaleY: 2, rotation: 90 })],
      sceneOrder: ['img_1', 'img_2'],
    }));
    const out = applySceneOps(g, buildUngroup(g, 'g1'));
    expectUnmoved(g, out);
    expect(out.nodes.has('g1')).toBe(false);
    expect(getNode(out, 'img_1')!.parentId).toBeUndefined();
  });

  test('group then ungroup is the identity', () => {
    const g = scene();
    const grouped = applySceneOps(g, buildGroup(g, ['img_1', 'img_2'], 'g2', 'G2'));
    const back = applySceneOps(grouped, buildUngroup(grouped, 'g2'));
    expectUnmoved(g, back);
    expect(getNode(back, 'img_1')!.parentId).toBe('g1');
  });

  test('grouping keeps paint order', () => {
    const g = scene();
    const grouped = applySceneOps(g, buildGroup(g, ['img_1', 'img_2'], 'g2', 'G2'));
    expect(toLegacyView(grouped).sceneOrder).toEqual(['img_1', 'img_2', 'txt_1']);
  });

  test('both undo exactly', () => {
    const g = scene();
    expectRoundTrips(g, buildGroup(g, ['img_1', 'txt_1'], 'g2', 'G2'));
    expectRoundTrips(g, buildUngroup(g, 'g1'));
  });

  test('grouping nothing is nothing', () => {
    const g = scene();
    expect(buildGroup(g, [], 'g2', 'G2')).toEqual([]);
    expect(buildGroup(g, ['nope'], 'g2', 'G2')).toEqual([]);
    expect(buildUngroup(g, 'img_1')).toEqual([]);
    expect(buildUngroup(g, 'nope')).toEqual([]);
  });
});

// ── add / remove / reorder ─────────────────────────────────────────────

describe('structure', () => {
  test('removing a group takes its children with it', () => {
    const g = scene();
    const out = applySceneOp(g, {
      op: 'removeNode', node: getNode(g, 'g1')!, parentId: undefined,
      index: indexOfChild(g, undefined, 'g1'),
    });
    expect(out.nodes.has('g1')).toBe(false);
    expect(out.nodes.has('img_1')).toBe(false);
    expect(out.nodes.has('img_2')).toBe(false);
    expect(out.nodes.has('txt_1')).toBe(true);
  });

  test('reorder undoes exactly', () => {
    const g = scene();
    expectRoundTrips(g, [{
      op: 'reorder', parentId: 'g1', from: ['img_1', 'img_2'], to: ['img_2', 'img_1'],
    }]);
  });

  test('reordering the roots works too', () => {
    const g = scene();
    const flipped = applySceneOp(g, {
      op: 'reorder', from: g.roots, to: [...g.roots].reverse(),
    });
    expect(flipped.roots).toEqual([...g.roots].reverse());
    expect(revertSceneOp(flipped, {
      op: 'reorder', from: g.roots, to: [...g.roots].reverse(),
    }).roots).toEqual(g.roots);
  });

  test('add undoes exactly', () => {
    const g = scene();
    expectRoundTrips(g, [{
      op: 'addNode',
      node: { id: 'g9', kind: 'group', name: 'G9', transform: LOCAL_IDENTITY, children: [] },
      parentId: undefined, index: 0,
    }]);
  });
});

// ── Gesture helpers ────────────────────────────────────────────────────

describe('gesture helpers', () => {
  test('a world delta becomes the parent\'s delta', () => {
    const g = fromLegacy(makeState({
      images: [image({ id: 'img_1', groupId: 'g1' })],
      groups: [group({ id: 'g1', scaleX: 2, scaleY: 2 })],
      sceneOrder: ['img_1'],
    }));
    // The group doubles everything, so a 2-cell world move is 1 cell local.
    const [lx, ly] = worldDeltaToParent(g, 'img_1', 2, 4);
    expect(lx).toBeCloseTo(1, 9);
    expect(ly).toBeCloseTo(2, 9);
  });

  test('a drag inside a scaled group lands where the user dragged', () => {
    const g = fromLegacy(makeState({
      images: [image({ id: 'img_1', groupId: 'g1', cellX: 0, cellY: 0 })],
      groups: [group({ id: 'g1', scaleX: 2, scaleY: 2 })],
      sceneOrder: ['img_1'],
    }));
    const moved = applySceneOp(g, buildMoveBy(g, 'img_1', 6, 0)!);
    expect(worldBbox(moved, 'img_1').x).toBeCloseTo(6, 9);
  });

  test('a gesture moves the outermost selected node, once', () => {
    const g = scene();
    // Selecting a group AND one of its members must not move the member
    // twice — once with the group and once on its own.
    expect(gestureRoots(g, ['g1', 'img_1']).sort()).toEqual(['g1']);
    expect(gestureRoots(g, ['img_1', 'txt_1']).sort()).toEqual(['img_1', 'txt_1']);
    expect(gestureRoots(g, ['nope'])).toEqual([]);
  });

  test('a preview matrix matches what committing would give', () => {
    const g = scene();
    const proposed = { ...getNode(g, 'img_1')!.transform, tx: 42 };
    const preview = previewWorldMatrix(g, 'img_1', proposed);
    const committed = applySceneOp(g, buildSetTransform(g, 'img_1', proposed)!);
    expect(preview).toEqual(worldMatrix(committed, 'img_1'));
  });

  test('a preview of a group is what its members will ride', () => {
    const g = scene();
    const proposed = { ...LOCAL_IDENTITY, tx: 9, rotationDeg: 45 };
    const committed = applySceneOp(g, buildSetTransform(g, 'g1', proposed)!);
    expect(previewWorldMatrix(g, 'g1', proposed)).toEqual(worldMatrix(committed, 'g1'));
    expect(localMatrix(getNode(committed, 'g1')!.transform)).toEqual(localMatrix(proposed));
  });
});
