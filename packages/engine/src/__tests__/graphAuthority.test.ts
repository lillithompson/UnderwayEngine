/**
 * A composition whose truth is the scene graph.
 *
 * `withSceneGraph` turns the model round: the per-kind arrays stop being
 * where a pose lives and become what `toLegacyView` renders out of the
 * graph. Every existing reader keeps working, because the view it reads
 * is the same shape it always was — but there is now one copy of a pose
 * instead of two, and a group transform is a group's transform.
 *
 * These drive that path through the ops the editor actually commits, and
 * back out again through undo and redo.
 */

import {
  applyCompOps, computeSVGBbox, revertCompOps, withSceneGraph,
} from '../compositionOps';
import { fromLegacy, getNode, worldMatrix } from '../sceneGraph';
import { decomposeMatrix } from '../sceneTransform';
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

const scene = () => withSceneGraph(makeState({
  images: [
    image({ id: 'img_1', cellX: 2, cellY: 2 }),
    image({ id: 'img_2', cellX: 10, cellY: 4 }),
  ],
  texts: [text({ id: 'txt_1', cellX: 20, cellY: 20 })],
  sceneOrder: ['img_1', 'img_2', 'txt_1'],
}));

const groupOp = (ids: string[], id = 'g1'): CompUndoEntry => [
  { op: 'groupFigures', figureIds: ids, groupId: id, groupName: id },
];

function transformOp(
  groupId: string, from: Partial<GroupNode>, to: Partial<GroupNode>,
): CompUndoEntry {
  const base = {
    translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
    rotation: 0 as const, mirrorH: false, mirrorV: false,
  };
  const a = { ...base, ...from }, b = { ...base, ...to };
  return [{
    op: 'transformGroup', groupId,
    oldTranslateX: a.translateX, oldTranslateY: a.translateY,
    oldScaleX: a.scaleX, oldScaleY: a.scaleY,
    oldRotation: a.rotation, oldMirrorH: a.mirrorH, oldMirrorV: a.mirrorV,
    newTranslateX: b.translateX, newTranslateY: b.translateY,
    newScaleX: b.scaleX, newScaleY: b.scaleY,
    newRotation: b.rotation, newMirrorH: b.mirrorH, newMirrorV: b.mirrorV,
  }];
}

/**
 * Nothing on the page moved between these two states.
 *
 * `alsoRegrouped` for a comparison that spans a grouping change: who a
 * node's parent is is what such an op is FOR, and that it did not move
 * while changing hands is the thing worth asserting.
 */
function expectSamePage(
  a: CompositionState, b: CompositionState, alsoRegrouped = false,
): void {
  const byId = (s: CompositionState) =>
    worldSnapshot(s).sort((x, y) => x.id.localeCompare(y.id));
  const diff = diffWorldSnapshots(byId(a), byId(b), {
    ignoreSvgBbox: true, ignoreGroupId: alsoRegrouped,
  });
  if (diff) throw new Error(`the page moved:\n${diff}`);
}

/** Apply an entry, undo it, and require the page to come back. */
function expectUndoRestores(state: CompositionState, entry: CompUndoEntry): CompositionState {
  const after = applyCompOps(state, entry);
  expectSamePage(state, revertCompOps(after, entry));
  return after;
}

// ── The arrays are a view ──────────────────────────────────────────────

describe('the arrays become a view of the graph', () => {
  test('opting in does not move anything', () => {
    const plain = makeState({
      images: [image({ id: 'img_1', cellX: 2, cellY: 3, rotation: 90 })],
      sceneOrder: ['img_1'],
    });
    expectSamePage(plain, withSceneGraph(plain));
  });

  test('a state without a graph is untouched by any of this', () => {
    const plain = makeState({
      images: [image({ id: 'img_1' })], sceneOrder: ['img_1'],
    });
    const moved = applyCompOps(plain, [{ op: 'moveNode', nodeId: 'img_1', dx: 3, dy: 4 }]);
    expect(moved.graph).toBeUndefined();
    expect(moved.images![0].cellX).toBe(3);
  });

  test('the graph and the arrays cannot disagree, because one makes the other', () => {
    let s = scene();
    s = applyCompOps(s, groupOp(['img_1', 'img_2']));
    s = applyCompOps(s, transformOp('g1', {}, { translateX: 5, scaleX: 2, scaleY: 2 }));
    expect(getNode(s.graph!, 'g1')!.transform).toMatchObject({ tx: 5, sx: 2, sy: 2 });
    expect(s.images![0].cellX).toBeCloseTo(5 + 2 * 2, 9);
  });
});

// ── Gestures ───────────────────────────────────────────────────────────

describe('gestures, through the graph', () => {
  test('a move', () => {
    const s = expectUndoRestores(scene(), [
      { op: 'moveNode', nodeId: 'img_1', dx: 3, dy: 4 },
    ]);
    expect(s.images![0].cellX).toBeCloseTo(5, 9);
    expect(s.images![0].cellY).toBeCloseTo(6, 9);
  });

  test('a group, and undoing it', () => {
    const s = expectUndoRestores(scene(), groupOp(['img_1', 'img_2']));
    expect(s.groups.map((g) => g.id)).toEqual(['g1']);
    expect(s.images!.every((i) => i.groupId === 'g1')).toBe(true);
    expect(s.texts![0].groupId).toBeUndefined();
  });

  test('a group transform moves the members and nothing else', () => {
    let s = applyCompOps(scene(), groupOp(['img_1', 'img_2']));
    const before = s.texts![0].cellX;
    const entry = transformOp('g1', {}, { translateX: 6, translateY: 2 });
    s = expectUndoRestores(s, entry);
    s = applyCompOps(s, entry);
    expect(s.images![0].cellX).toBeCloseTo(8, 9);
    expect(s.images![1].cellX).toBeCloseTo(16, 9);
    expect(s.texts![0].cellX).toBe(before);
  });

  test('a group scale, turn and flip', () => {
    // Each from a freshly grouped scene: an op states the transform it is
    // moving FROM, so replaying them onto each other would undo to the
    // wrong place.
    for (const to of [
      { scaleX: 2, scaleY: 2 },
      { rotation: 90 as const },
      { rotation: 270 as const, mirrorH: true },
      { translateX: 3, scaleX: 0.5, scaleY: 0.5, rotation: 180 as const },
    ]) {
      const grouped = applyCompOps(scene(), groupOp(['img_1', 'img_2']));
      expectUndoRestores(grouped, transformOp('g1', {}, to));
    }
  });

  test('a free rotation, and undoing it', () => {
    const s = expectUndoRestores(scene(), [
      { op: 'setNodeRotation', id: 'txt_1', oldAngleDeg: undefined, newAngleDeg: 30 },
    ]);
    expect(s.texts![0].angleDeg).toBeCloseTo(30, 9);
  });

  test('an image resize, and undoing it', () => {
    const s = expectUndoRestores(scene(), [{
      op: 'editImage', imageId: 'img_1',
      oldCellX: 2, oldCellY: 2, oldCellWidth: 4, oldCellHeight: 3,
      newCellX: 2, newCellY: 2, newCellWidth: 8, newCellHeight: 6,
    }]);
    expect([s.images![0].cellWidth, s.images![0].cellHeight]).toEqual([8, 6]);
  });

  test('an ungroup restores the group at its own transform when undone', () => {
    let s = applyCompOps(scene(), groupOp(['img_1', 'img_2']));
    s = applyCompOps(s, transformOp('g1', {}, { translateX: 4, scaleX: 2, scaleY: 2 }));
    const grouped = s;

    const ungroup: CompUndoEntry = [{
      op: 'ungroupFigures', groupId: 'g1', groupName: 'g1',
      figureIds: ['img_1', 'img_2'],
      savedTranslateX: 4, savedTranslateY: 0,
      savedScaleX: 2, savedScaleY: 2,
      savedRotation: 0, savedMirrorH: false, savedMirrorV: false,
    }];
    s = applyCompOps(s, ungroup);
    expect(s.groups).toEqual([]);
    expectSamePage(grouped, s, true);

    // Undo: the group comes back AT ITS TRANSFORM, not at the identity.
    s = revertCompOps(s, ungroup);
    expect(getNode(s.graph!, 'g1')!.transform).toMatchObject({ tx: 4, sx: 2, sy: 2 });
    expectSamePage(grouped, s);
  });
});

// ── The bug this refactor is for ───────────────────────────────────────

describe('a member edited inside a group stays edited', () => {
  test('a resize survives every later group transform', () => {
    let s = applyCompOps(scene(), groupOp(['img_1', 'img_2']));
    s = applyCompOps(s, [{
      op: 'editImage', imageId: 'img_1',
      oldCellX: 2, oldCellY: 2, oldCellWidth: 4, oldCellHeight: 3,
      newCellX: 2, newCellY: 2, newCellWidth: 8, newCellHeight: 6,
    }]);
    expect([s.images![0].cellWidth, s.images![0].cellHeight]).toEqual([8, 6]);

    // Move the group four times over. Under the old model the first of
    // these snapped the image back to 4x3, because materializing the
    // group rewrote its world pose from a local cache the resize never
    // updated. There is no cache now.
    for (let i = 0; i < 4; i++) {
      s = applyCompOps(s, transformOp('g1',
        { translateX: i }, { translateX: i + 1 }));
      expect([s.images![0].cellWidth, s.images![0].cellHeight]).toEqual([8, 6]);
    }
    expect(s.images![0].cellX).toBeCloseTo(6, 9);
  });

  test('a twist survives it too', () => {
    let s = applyCompOps(scene(), groupOp(['img_1', 'txt_1']));
    s = applyCompOps(s, [{
      op: 'setNodeRotation', id: 'txt_1', oldAngleDeg: undefined, newAngleDeg: 30,
    }]);
    s = applyCompOps(s, transformOp('g1', {}, { translateX: 1 }));
    expect(s.texts![0].angleDeg).toBeCloseTo(30, 9);
  });
});

// ── Content ops still work ─────────────────────────────────────────────

describe('ops that are not about pose still travel the old way', () => {
  test('a text edit, beside a move, in one entry', () => {
    let s = scene();
    s = applyCompOps(s, [
      { op: 'moveNode', nodeId: 'txt_1', dx: 5, dy: 0 },
      {
        op: 'setText', textId: 'txt_1', oldContent: 'hi', newContent: 'there',
        oldCellWidth: 4, oldCellHeight: 2, newCellWidth: 6, newCellHeight: 2,
      },
    ]);
    expect(s.texts![0].content).toBe('there');
    expect(s.texts![0].cellX).toBeCloseTo(25, 9);
    expect(s.graph).toBeDefined();
  });

  test('placing and removing keeps the graph in step', () => {
    let s = scene();
    const fresh = image({ id: 'img_9', cellX: 30, cellY: 30 });
    s = applyCompOps(s, [{ op: 'placeObject', kind: 'image', item: fresh }]);
    expect(s.graph!.nodes.has('img_9')).toBe(true);

    s = applyCompOps(s, [{ op: 'removeObject', kind: 'image', item: fresh }]);
    expect(s.graph!.nodes.has('img_9')).toBe(false);
    expect(s.images!.some((i) => i.id === 'img_9')).toBe(false);
  });
});

// ── A content op is local to the graph too ─────────────────────────────

/**
 * A group turned off the quarters is a pose the legacy arrays CANNOT
 * spell: `GroupNode.rotation` is one of four, so the view rounds the turn
 * to none and the members carry the whole of it in their own world fields
 * (an svg's in its vertices). The picture is right either way — what is
 * lost is the group's word about its own frame, and with it every
 * member's: a path comes back measured by the upright rectangle around a
 * tilted shape, at no local turn.
 *
 * So a content op must not rebuild the graph from the arrays. It re-reads
 * what it wrote and keeps the rest, which is what these pin.
 */
describe('a content op does not flatten the graph', () => {
  const svg = (id: string, x: number, y: number, w: number, h: number): SVGObject => {
    const pts: Array<[number, number]> = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
    const segments: PathSegment[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      segments.push({ kind: 'line', start: pts[i], end: pts[i + 1] });
    }
    return { id, segments, color: { r: 0, g: 0, b: 0 }, ...computeSVGBbox(segments) };
  };

  /** Two members in a group twisted 37 degrees — an angle no `GroupNode`
   *  can hold. */
  function twistedGroup(): CompositionState {
    const s = withSceneGraph(makeState({
      svgObjects: [svg('svg_1', 10, 10, 4, 2)],
      images: [image({ id: 'img_1', cellX: 20, cellY: 10 })],
      sceneOrder: ['svg_1', 'img_1'],
    }));
    const grouped = applyCompOps(s, groupOp(['svg_1', 'img_1']));
    return applyCompOps(grouped, [{
      op: 'setTransform',
      nodeId: 'g1',
      from: { tx: 0, ty: 0, sx: 1, sy: 1, rotationDeg: 0 },
      to: { tx: 0, ty: 0, sx: 1, sy: 1, rotationDeg: 37 },
    }]);
  }

  const recolour: CompUndoEntry = [{
    op: 'recolorSVG', svgId: 'svg_1',
    oldColor: { r: 0, g: 0, b: 0 }, newColor: { r: 200, g: 0, b: 0 },
  }];

  test('the group keeps the turn the arrays cannot hold', () => {
    const before = twistedGroup();
    expect(getNode(before.graph!, 'g1')!.transform.rotationDeg).toBeCloseTo(37, 9);
    // The arrays have already rounded it away — that is the loss this is
    // about, not a thing the content op does.
    expect(before.groups!.find((g) => g.id === 'g1')!.rotation).toBe(0);

    const after = applyCompOps(before, recolour);
    expect(after.svgObjects![0].color).toEqual({ r: 200, g: 0, b: 0 });
    expect(getNode(after.graph!, 'g1')!.transform.rotationDeg).toBeCloseTo(37, 9);
    expectSamePage(before, after);
  });

  test("the member's own frame survives it: a tight box at the turn it is drawn at", () => {
    const after = applyCompOps(twistedGroup(), recolour);
    const node = getNode(after.graph!, 'svg_1')!;
    // The 4 x 2 the path was authored as, not the 4.4 x 2.9 upright
    // rectangle that fits it once it is tilted 37 degrees.
    expect(node.localBox!.width).toBeCloseTo(4, 9);
    expect(node.localBox!.height).toBeCloseTo(2, 9);
    expect(decomposeMatrix(worldMatrix(after.graph!, 'svg_1')).rotationDeg).toBeCloseTo(37, 6);
  });

  test('but a REBUILD from those arrays still flattens — what a reload does', () => {
    // The foil, and the part P6 owes: nothing in the file can say a group
    // is turned 37 degrees, so a page saved here and opened again comes
    // back with the turn in its members' vertices and the loose box round
    // each of them. Fixing that is the v61 loader's, not this path's.
    const after = applyCompOps(twistedGroup(), recolour);
    const reloaded = fromLegacy(after);
    expect(getNode(reloaded, 'g1')!.transform.rotationDeg).toBe(0);
    // The upright rectangle around a 4 x 2 path tilted 37 degrees.
    const th = (37 * Math.PI) / 180;
    expect(getNode(reloaded, 'svg_1')!.localBox!.width)
      .toBeCloseTo(4 * Math.cos(th) + 2 * Math.sin(th), 9);
  });

  test('an op that changes the scene SHAPE goes the long way round', () => {
    // Nothing to keep when the tree is what moved: adding a node has to
    // rebuild, and the rebuild has to be right.
    const before = twistedGroup();
    const fresh = image({ id: 'img_9', cellX: 30, cellY: 30 });
    const after = applyCompOps(before, [{ op: 'placeObject', kind: 'image', item: fresh }]);
    expect(after.graph!.nodes.has('img_9')).toBe(true);
    expect(getNode(after.graph!, 'img_9')!.parentId).toBeUndefined();
    expectSamePage(before, { ...after, images: after.images!.filter((i) => i.id !== 'img_9') });
  });
});
