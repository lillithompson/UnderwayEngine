/**
 * The graph puts things where the legacy ops put them.
 *
 * A differential test, and the gate P3 has to pass before anything is
 * allowed to depend on the graph: for each legacy pose op, apply it the
 * old way to the legacy state and the new way to the graph, and require
 * the two to agree about where every leaf ended up.
 *
 * Agreement is judged by `worldSnapshot`, which describes only what
 * renders. Nothing here asserts that the two models store the same
 * things — they emphatically do not, and that is the change.
 */

import { applyCompOps, revertCompOps, withSceneGraph } from '../compositionOps';
import {
  applyLegacyEntryToGraph, groupFieldsToTransform, isPoseOp,
  legacyOpToSceneOps, poseToWorldTransform,
} from '../legacyOpBridge';
import { fromLegacy, getNode, toLegacyView } from '../sceneGraph';
import { applySceneOps, revertSceneOps } from '../sceneGraphOps';
import { LOCAL_IDENTITY, localEquals } from '../sceneTransform';
import { diffWorldSnapshots, worldSnapshot } from '../worldSnapshot';
import {
  CompUndoOp, CompositionState, GroupNode, ImageObject, PathSegment,
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

/**
 * Apply an entry both ways and require the rendered result to agree.
 *
 * Compared by id, not by position: the two models order a scene by
 * different means (a flat `sceneOrder` with enforced group contiguity
 * versus a tree), and where a node sits in paint order is a separate
 * question from where it sits on the page.
 */
function expectAgrees(state: CompositionState, entry: CompUndoOp[]): void {
  const legacy = applyCompOps(state, entry);
  const viaGraph = applyLegacyEntryToGraph(fromLegacy(state), entry);

  const byId = (s: CompositionState) =>
    worldSnapshot(s).sort((a, b) => a.id.localeCompare(b.id));

  const diff = diffWorldSnapshots(
    byId(legacy),
    byId({ ...state, ...toLegacyView(viaGraph) }),
    { ignoreSvgBbox: true },
  );
  if (diff) {
    throw new Error(
      `the graph and the legacy ops disagree about ${entry.map((o) => o.op).join(', ')}:\n${diff}`,
    );
  }
}

// ── Scenes ─────────────────────────────────────────────────────────────

const loose = () => makeState({
  images: [image({ id: 'img_1', cellX: 2, cellY: 3 })],
  texts: [text({ id: 'txt_1', cellX: 12, cellY: 1 })],
  svgObjects: [svg({ id: 'svg_1', cellX: 0, cellY: 8, segments: [line([0, 8], [4, 10])] })],
  sceneOrder: ['img_1', 'txt_1', 'svg_1'],
});

/**
 * Scenes built the way the app builds them — through `groupFigures`,
 * not by declaring `groupId` and a `GroupNode` side by side.
 *
 * It matters. Hand-built grouped state has no `local*` caches, and
 * nothing puts them there — the loader drops a file's rather than
 * completing them. Such a group does not move when the LEGACY path
 * transforms it, because the materialize pass has no locals to
 * materialize from. Grouping through the op seeds them, so these
 * fixtures compare the graph against what the product actually does
 * rather than against that gap.
 */
const grouped = () => applyCompOps(makeState({
  images: [
    image({ id: 'img_1', cellX: 2, cellY: 2 }),
    image({ id: 'img_2', cellX: 10, cellY: 4 }),
  ],
  texts: [text({ id: 'txt_1', cellX: 20, cellY: 20 })],
  sceneOrder: ['img_1', 'img_2', 'txt_1'],
}), [{
  op: 'groupFigures', figureIds: ['img_1', 'img_2'], groupId: 'g1', groupName: 'g1',
}]);

const transformedGroup = () => applyCompOps(applyCompOps(makeState({
  images: [
    image({ id: 'img_1', cellX: 2, cellY: 2 }),
    image({ id: 'img_2', cellX: 10, cellY: 4, rotation: 90 }),
  ],
  sceneOrder: ['img_1', 'img_2'],
}), [{
  op: 'groupFigures', figureIds: ['img_1', 'img_2'], groupId: 'g1', groupName: 'g1',
}]), [{
  op: 'transformGroup', groupId: 'g1',
  oldTranslateX: 0, oldTranslateY: 0, oldScaleX: 1, oldScaleY: 1,
  oldRotation: 0, oldMirrorH: false, oldMirrorV: false,
  newTranslateX: 3, newTranslateY: -1, newScaleX: 2, newScaleY: 2,
  newRotation: 0, newMirrorH: false, newMirrorV: false,
}]);

const nested = () => applyCompOps(applyCompOps(makeState({
  images: [image({ id: 'img_1', cellX: 4, cellY: 4 })],
  texts: [text({ id: 'txt_1', cellX: 1, cellY: 1 })],
  sceneOrder: ['img_1', 'txt_1'],
}), [{
  op: 'groupFigures', figureIds: ['img_1'], groupId: 'inner', groupName: 'inner',
}]), [{
  op: 'groupFigures', figureIds: ['txt_1'], childGroupIds: ['inner'],
  groupId: 'outer', groupName: 'outer',
}]);

// ── moveNode ───────────────────────────────────────────────────────────

describe('moveNode', () => {
  test('a loose node', () => {
    expectAgrees(loose(), [{ op: 'moveNode', nodeId: 'img_1', dx: 5, dy: -2 }]);
  });

  test('a grouped node', () => {
    expectAgrees(grouped(), [{ op: 'moveNode', nodeId: 'img_1', dx: 5, dy: -2 }]);
  });

  test('a node inside a scaled group — the delta is what the user dragged', () => {
    expectAgrees(transformedGroup(), [{ op: 'moveNode', nodeId: 'img_1', dx: 6, dy: 4 }]);
  });

  test('a node two groups deep', () => {
    expectAgrees(nested(), [{ op: 'moveNode', nodeId: 'img_1', dx: 3, dy: 3 }]);
  });

  test('several moves in one entry', () => {
    expectAgrees(grouped(), [
      { op: 'moveNode', nodeId: 'img_1', dx: 1, dy: 1 },
      { op: 'moveNode', nodeId: 'img_2', dx: -2, dy: 4 },
      { op: 'moveNode', nodeId: 'txt_1', dx: 0, dy: 7 },
    ]);
  });
});

// ── transformGroup ─────────────────────────────────────────────────────

describe('transformGroup', () => {
  const transform = (g: GroupNode, to: Partial<GroupNode>): CompUndoOp => ({
    op: 'transformGroup', groupId: g.id,
    oldTranslateX: g.translateX, oldTranslateY: g.translateY,
    oldScaleX: g.scaleX, oldScaleY: g.scaleY,
    oldRotation: g.rotation, oldMirrorH: g.mirrorH, oldMirrorV: g.mirrorV,
    newTranslateX: to.translateX ?? g.translateX,
    newTranslateY: to.translateY ?? g.translateY,
    newScaleX: to.scaleX ?? g.scaleX, newScaleY: to.scaleY ?? g.scaleY,
    newRotation: to.rotation ?? g.rotation,
    newMirrorH: to.mirrorH ?? g.mirrorH, newMirrorV: to.mirrorV ?? g.mirrorV,
  });

  test('a translate', () => {
    const s = grouped();
    expectAgrees(s, [transform(s.groups[0], { translateX: 6, translateY: 2 })]);
  });

  test('a scale', () => {
    const s = grouped();
    expectAgrees(s, [transform(s.groups[0], { scaleX: 3, scaleY: 3 })]);
  });

  test('every quarter turn', () => {
    for (const rotation of [90, 180, 270] as const) {
      const s = grouped();
      expectAgrees(s, [transform(s.groups[0], { rotation })]);
    }
  });

  test('a flip', () => {
    const s = grouped();
    expectAgrees(s, [transform(s.groups[0], { mirrorH: true })]);
    expectAgrees(s, [transform(s.groups[0], { mirrorV: true })]);
  });

  test('on a group that already had a transform', () => {
    const s = transformedGroup();
    expectAgrees(s, [transform(s.groups[0], {
      translateX: 9, scaleX: 0.5, scaleY: 0.5, rotation: 270,
    })]);
  });

  test('on the outer of two nested groups', () => {
    const s = nested();
    const outer = s.groups.find((g) => g.id === 'outer')!;
    expectAgrees(s, [transform(outer, { translateY: 8, rotation: 90 })]);
  });
});

// ── setNodeRotation ────────────────────────────────────────────────────

describe('setNodeRotation', () => {
  test('a free angle on a loose node', () => {
    for (const newAngleDeg of [15, 45, 137.5, 300]) {
      expectAgrees(loose(), [{
        op: 'setNodeRotation', id: 'txt_1', oldAngleDeg: undefined, newAngleDeg,
      }]);
    }
  });

  test('a free angle inside a group', () => {
    expectAgrees(grouped(), [{
      op: 'setNodeRotation', id: 'img_1', oldAngleDeg: undefined, newAngleDeg: 33,
    }]);
  });

  test('changing an angle that was already there', () => {
    const s = makeState({
      texts: [text({ id: 'txt_1', angleDeg: 20 })], sceneOrder: ['txt_1'],
    });
    expectAgrees(s, [{
      op: 'setNodeRotation', id: 'txt_1', oldAngleDeg: 20, newAngleDeg: 65,
    }]);
  });

  test('back to none', () => {
    const s = makeState({
      texts: [text({ id: 'txt_1', angleDeg: 40 })], sceneOrder: ['txt_1'],
    });
    expectAgrees(s, [{
      op: 'setNodeRotation', id: 'txt_1', oldAngleDeg: 40, newAngleDeg: undefined,
    }]);
  });
});

// ── editImage ──────────────────────────────────────────────────────────

describe('editImage', () => {
  const edit = (over: Partial<Extract<CompUndoOp, { op: 'editImage' }>>): CompUndoOp => ({
    op: 'editImage', imageId: 'img_1',
    oldCellX: 2, oldCellY: 3, oldCellWidth: 4, oldCellHeight: 3,
    newCellX: 2, newCellY: 3, newCellWidth: 4, newCellHeight: 3,
    ...over,
  } as CompUndoOp);

  test('a resize', () => {
    expectAgrees(loose(), [edit({ newCellWidth: 8, newCellHeight: 6 })]);
  });

  test('a move and a resize together', () => {
    expectAgrees(loose(), [edit({
      newCellX: 10, newCellY: 1, newCellWidth: 2, newCellHeight: 1.5,
    })]);
  });

  test('a quarter turn', () => {
    expectAgrees(loose(), [edit({
      newCellWidth: 3, newCellHeight: 4, newRotation: 90,
    })]);
  });

  test('a flip', () => {
    expectAgrees(loose(), [edit({ newMirrorH: true })]);
  });

  test('a resize inside a group is not undone by the next group move', () => {
    // The §2.1 bug, asked of the new model: it has nowhere to put a stale
    // cache, so there is nothing for a later group transform to restore.
    const s = grouped();
    let g = fromLegacy(s);
    g = applySceneOps(g, legacyOpToSceneOps(g, {
      op: 'editImage', imageId: 'img_1',
      oldCellX: 2, oldCellY: 2, oldCellWidth: 4, oldCellHeight: 3,
      newCellX: 2, newCellY: 2, newCellWidth: 8, newCellHeight: 6,
    })!);
    const resized = toLegacyView(g).images.find((i) => i.id === 'img_1')!;
    expect([resized.cellWidth, resized.cellHeight]).toEqual([8, 6]);

    g = applySceneOps(g, legacyOpToSceneOps(g, {
      op: 'transformGroup', groupId: 'g1',
      oldTranslateX: 0, oldTranslateY: 0, oldScaleX: 1, oldScaleY: 1,
      oldRotation: 0, oldMirrorH: false, oldMirrorV: false,
      newTranslateX: 1, newTranslateY: 0, newScaleX: 1, newScaleY: 1,
      newRotation: 0, newMirrorH: false, newMirrorV: false,
    })!);
    const after = toLegacyView(g).images.find((i) => i.id === 'img_1')!;
    expect([after.cellWidth, after.cellHeight]).toEqual([8, 6]);
    expect(after.cellX).toBeCloseTo(3, 9);
  });
});

// ── group / ungroup / reparent ─────────────────────────────────────────

describe('grouping', () => {
  test('groupFigures', () => {
    expectAgrees(loose(), [{
      op: 'groupFigures', figureIds: ['img_1', 'txt_1'], groupId: 'g9', groupName: 'G9',
    }]);
  });

  test('groupFigures inside a transformed group', () => {
    expectAgrees(transformedGroup(), [{
      op: 'groupFigures', figureIds: ['img_1', 'img_2'], groupId: 'g9', groupName: 'G9',
    }]);
  });

  test('ungroupFigures', () => {
    expectAgrees(grouped(), [{
      op: 'ungroupFigures', groupId: 'g1', groupName: 'g1',
      figureIds: ['img_1', 'img_2'],
    }]);
  });

  test('ungroupFigures on a transformed group', () => {
    expectAgrees(transformedGroup(), [{
      op: 'ungroupFigures', groupId: 'g1', groupName: 'g1',
      figureIds: ['img_1', 'img_2'],
    }]);
  });

  test('reparentNode into a group', () => {
    const s = grouped();
    expectAgrees(s, [{
      op: 'reparentNode', nodeId: 'txt_1', newParentGroupId: 'g1',
      oldSceneOrder: s.sceneOrder, newSceneOrder: ['img_1', 'img_2', 'txt_1'],
    }]);
  });

  test('reparentNode out of a group', () => {
    const s = transformedGroup();
    expectAgrees(s, [{
      op: 'reparentNode', nodeId: 'img_1', newParentGroupId: undefined,
      oldSceneOrder: s.sceneOrder, newSceneOrder: s.sceneOrder,
    }]);
  });
});

// ── Undo ───────────────────────────────────────────────────────────────

describe('every translated op undoes exactly', () => {
  const cases: Array<[string, () => CompositionState, CompUndoOp]> = [
    ['moveNode', grouped, { op: 'moveNode', nodeId: 'img_1', dx: 5, dy: -2 }],
    ['setNodeRotation', grouped, {
      op: 'setNodeRotation', id: 'img_1', oldAngleDeg: undefined, newAngleDeg: 33,
    }],
    ['transformGroup', grouped, {
      op: 'transformGroup', groupId: 'g1',
      oldTranslateX: 0, oldTranslateY: 0, oldScaleX: 1, oldScaleY: 1,
      oldRotation: 0, oldMirrorH: false, oldMirrorV: false,
      newTranslateX: 5, newTranslateY: 2, newScaleX: 2, newScaleY: 2,
      newRotation: 90, newMirrorH: true, newMirrorV: false,
    }],
    ['groupFigures', loose, {
      op: 'groupFigures', figureIds: ['img_1', 'txt_1'], groupId: 'g9', groupName: 'G9',
    }],
    ['ungroupFigures', transformedGroup, {
      op: 'ungroupFigures', groupId: 'g1', groupName: 'g1',
      figureIds: ['img_1', 'img_2'],
    }],
    ['reparentNode', grouped, {
      op: 'reparentNode', nodeId: 'txt_1', newParentGroupId: 'g1',
      oldSceneOrder: ['img_1', 'img_2', 'txt_1'],
      newSceneOrder: ['img_1', 'img_2', 'txt_1'],
    }],
  ];

  test.each(cases)('%s', (_label, scene, op) => {
    const before = fromLegacy(scene());
    const entry = legacyOpToSceneOps(before, op)!;
    const after = applySceneOps(before, entry);
    const back = revertSceneOps(after, entry);

    expect([...back.nodes.keys()].sort()).toEqual([...before.nodes.keys()].sort());
    expect(back.roots).toEqual(before.roots);
    for (const [id, node] of before.nodes) {
      const restored = back.nodes.get(id)!;
      expect(localEquals(restored.transform, node.transform)).toBe(true);
      expect(restored.parentId).toBe(node.parentId);
      expect(restored.children ?? []).toEqual(node.children ?? []);
    }
  });
});

// ── Coverage of the translation itself ─────────────────────────────────

describe('the bridge says what it can and cannot translate', () => {
  test('pose ops translate', () => {
    for (const op of ['moveNode', 'transformGroup', 'setNodeRotation', 'editImage',
      'groupFigures', 'ungroupFigures', 'reparentNode']) {
      expect(isPoseOp({ op } as CompUndoOp)).toBe(true);
    }
  });

  test('content ops do not, and say so rather than guessing', () => {
    const g = fromLegacy(loose());
    expect(legacyOpToSceneOps(g, {
      op: 'renameSVG', svgId: 'svg_1', oldName: 'a', newName: 'b',
    } as CompUndoOp)).toBeNull();
    expect(isPoseOp({ op: 'renameSVG' } as CompUndoOp)).toBe(false);
  });

  test('an op naming a node that is gone is a no-op', () => {
    const g = fromLegacy(loose());
    expect(legacyOpToSceneOps(g, { op: 'moveNode', nodeId: 'nope', dx: 1, dy: 1 })).toEqual([]);
    expect(legacyOpToSceneOps(g, {
      op: 'ungroupFigures', groupId: 'nope', groupName: 'nope', figureIds: [],
    })).toEqual([]);
  });
});

// ── The conversions the bridge rests on ────────────────────────────────

describe('field conversions', () => {
  test('a group\'s scales swap on a quarter turn, and only then', () => {
    const base = {
      translateX: 1, translateY: 2, scaleX: 3, scaleY: 5,
      mirrorH: false, mirrorV: false,
    };
    expect(groupFieldsToTransform({ ...base, rotation: 0 })).toMatchObject({ sx: 3, sy: 5 });
    expect(groupFieldsToTransform({ ...base, rotation: 90 })).toMatchObject({ sx: 5, sy: 3 });
    expect(groupFieldsToTransform({ ...base, rotation: 180 })).toMatchObject({ sx: 3, sy: 5 });
    expect(groupFieldsToTransform({ ...base, rotation: 270 })).toMatchObject({ sx: 5, sy: 3 });
  });

  test('a pose with no turn is a plain translate and scale', () => {
    const t = poseToWorldTransform(
      { cellX: 10, cellY: 20, cellWidth: 8, cellHeight: 6 },
      { width: 4, height: 3 },
    );
    expect(t).toMatchObject({ tx: 10, ty: 20, sx: 2, sy: 2, rotationDeg: 0 });
  });

  test('a quarter turn is on the transform, not in a swapped box', () => {
    const t = poseToWorldTransform(
      { cellX: 0, cellY: 0, cellWidth: 3, cellHeight: 4, rotation: 90 },
      { width: 4, height: 3 },
    );
    expect(t.rotationDeg).toBe(90);
    // The local box is 4x3 and stays 4x3; the world bbox is 3x4 because
    // the transform turned it, not because anything swapped.
    expect(t.sx).toBeCloseTo(1, 9);
    expect(t.sy).toBeCloseTo(1, 9);
  });

  test('a group node keeps its flags through the graph', () => {
    const s = makeState({
      images: [image({ id: 'img_1', groupId: 'g1' })],
      groups: [group({ id: 'g1', name: 'Frame', isFrame: true, locked: true })],
      sceneOrder: ['img_1'],
    });
    expect(getNode(fromLegacy(s), 'g1')).toMatchObject({
      name: 'Frame', isFrame: true, locked: true,
    });
  });
});

describe('setTransform travels as a legacy op', () => {
  function two(): CompositionState {
    return makeState({
      images: [
        image({ id: 'img_1', groupId: 'g1', cellX: 0, cellY: 0 }),
        image({ id: 'img_2', cellX: 10, cellY: 5 }),
      ],
      groups: [group({ id: 'g1', translateX: 2, translateY: 2 })],
      sceneOrder: ['img_1', 'img_2'],
    });
  }

  const setGroup: CompUndoOp = {
    op: 'setTransform', nodeId: 'g1',
    from: { ...LOCAL_IDENTITY, tx: 2, ty: 2 },
    to: { ...LOCAL_IDENTITY, tx: 7, ty: -1, rotationDeg: 90 },
  };

  test('is a pose op the bridge passes straight through', () => {
    expect(isPoseOp(setGroup)).toBe(true);
    const graph = fromLegacy(two());
    expect(legacyOpToSceneOps(graph, setGroup)).toEqual([setGroup]);
    expect(legacyOpToSceneOps(graph, { ...setGroup, nodeId: 'nope' })).toEqual([]);
  });

  test('a composition without a graph applies and reverts it through one', () => {
    const before = two();
    const after = applyCompOps(before, [setGroup]);
    // The member rode the group's new transform: its 4x3 box sits at
    // (-2,-2) in group space, which turned 90 about the group origin and
    // carried to (7,-1) is drawn a quarter round, centred on (7.5, -1).
    const img = worldSnapshot(after).find((s) => s.id === 'img_1')!;
    expect(img.at[0]).toBeCloseTo(7.5, 9);
    expect(img.at[1]).toBeCloseTo(-1, 9);
    expect(img.box).toEqual([4, 3]);
    expect(img.turn).toBe(90);
    expect(after.groups.find((g) => g.id === 'g1')!.rotation).toBe(90);
    // The other leaf is untouched.
    expect(after.images!.find((i) => i.id === 'img_2')).toMatchObject({ cellX: 10, cellY: 5 });
    // And revert lands exactly back.
    const back = revertCompOps(after, [setGroup]);
    expect(diffWorldSnapshots(worldSnapshot(before), worldSnapshot(back))).toBeNull();
  });

  test('a composition with a graph lands in the same place', () => {
    const plain = applyCompOps(two(), [setGroup]);
    const graphed = applyCompOps(withSceneGraph(two()), [setGroup]);
    expect(diffWorldSnapshots(worldSnapshot(plain), worldSnapshot(graphed))).toBeNull();
    expect(getNode(graphed.graph!, 'g1')!.transform).toEqual(setGroup.to);
  });
});
