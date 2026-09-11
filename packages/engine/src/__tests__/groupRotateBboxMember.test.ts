import {
  applyCompOps,
  applyGroupTransform,
  backfillMissingLocals,
  reconcileGroupLocals,
  revertCompOps,
} from '../compositionOps';
import { CompositionState, CompUndoOp, GroupNode, TextObject, ImageObject, makeViewport } from '../types';

// A bbox-only member (a text, an image, a paint island, a pattern) of a
// rotated or flipped group renders, hit-tests and boxes as its world
// fields say — because those fields re-derive from a LOCAL orientation
// snapshot composed with the group, the figure's own rule. Before the
// snapshot the world orientation was composed with the group on every
// materialize: a text in a 90° frame turned a quarter past its bbox on
// the frame's next transform, and a word dropped into a rotated frame
// turned on the spot while its box stayed put (the Adrift report).

const WHITE = { r: 255, g: 255, b: 255 };

function group(over: Partial<GroupNode> & { id: string }): GroupNode {
  return {
    name: over.id, translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
    rotation: 0, mirrorH: false, mirrorV: false, ...over,
  };
}

function text(over: Partial<TextObject> & { id: string }): TextObject {
  return {
    content: over.id, style: { fontId: 'system', size: 2, color: WHITE },
    cellX: 0, cellY: 0, cellWidth: 6, cellHeight: 2,
    ...over,
  } as unknown as TextObject;
}

function image(over: Partial<ImageObject> & { id: string }): ImageObject {
  return {
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 3, blobId: 'b', naturalWidth: 40, naturalHeight: 30,
    ...over,
  } as unknown as ImageObject;
}

function makeState(over: Partial<CompositionState> = {}): CompositionState {
  const texts = over.texts ?? [];
  const images = over.images ?? [];
  return {
    id: 't', name: 't',
    figures: [], svgObjects: [],
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: WHITE,
    customColors: [],
    groups: [],
    sceneOrder: [...texts.map((t) => t.id), ...images.map((i) => i.id)],
    gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null, compTool: 'select',
    createRegion: null, renderGeneration: 0,
    ...over,
    texts, images,
  } as CompositionState;
}

function transformGroupOp(g: GroupNode, next: Partial<GroupNode>): CompUndoOp {
  return {
    op: 'transformGroup', groupId: g.id,
    oldTranslateX: g.translateX, oldTranslateY: g.translateY,
    oldScaleX: g.scaleX, oldScaleY: g.scaleY,
    oldRotation: g.rotation, oldMirrorH: g.mirrorH, oldMirrorV: g.mirrorV,
    newTranslateX: next.translateX ?? g.translateX, newTranslateY: next.translateY ?? g.translateY,
    newScaleX: next.scaleX ?? g.scaleX, newScaleY: next.scaleY ?? g.scaleY,
    newRotation: next.rotation ?? g.rotation,
    newMirrorH: next.mirrorH ?? g.mirrorH, newMirrorV: next.mirrorV ?? g.mirrorV,
  };
}

const bbox = (n: { cellX: number; cellY: number; cellWidth: number; cellHeight: number }) => ({
  cellX: n.cellX, cellY: n.cellY, cellWidth: n.cellWidth, cellHeight: n.cellHeight,
});
const LOCAL = { cellX: 2, cellY: 4, cellWidth: 6, cellHeight: 2 };

describe('a text in a group that turns', () => {
  const g = group({ id: 'g' });
  const member = text({
    id: 't', groupId: 'g', ...LOCAL,
    localCellX: 2, localCellY: 4, localCellWidth: 6, localCellHeight: 2,
    localRotation: 0, localMirrorH: false, localMirrorV: false,
  });

  test('turns with the group once, and stays turned once on the next transform', () => {
    const s0 = makeState({ groups: [g], texts: [member] });
    const g90 = { ...g, rotation: 90 as const };
    const s1 = applyCompOps(s0, [transformGroupOp(g, { rotation: 90 })]);
    const t1 = s1.texts![0];
    expect(t1.rotation).toBe(90);
    expect(bbox(t1)).toEqual(applyGroupTransform(g90, LOCAL));
    // The frame slides: the text keeps its quarter turn (it used to gain
    // another — the world orientation composed with the group again).
    const g90t = { ...g90, translateX: 5 };
    const s2 = applyCompOps(s1, [transformGroupOp(g90, { translateX: 5 })]);
    const t2 = s2.texts![0];
    expect(t2.rotation).toBe(90);
    expect(bbox(t2)).toEqual(applyGroupTransform(g90t, LOCAL));
    // And a no-op transform moves nothing.
    const s3 = applyCompOps(s2, [transformGroupOp(g90t, {})]);
    expect(s3.texts![0]).toEqual(t2);
  });

  test('a free rotation keeps its sense through a quarter turn and flips through a mirror', () => {
    const spun = { ...member, angleDeg: 30, localAngleDeg: 30 };
    const s0 = makeState({ groups: [g], texts: [spun] });
    expect(applyCompOps(s0, [transformGroupOp(g, { rotation: 90 })]).texts![0].angleDeg).toBe(30);
    const flipped = applyCompOps(s0, [transformGroupOp(g, { mirrorH: true })]).texts![0];
    expect(flipped.mirrorH).toBe(true);
    expect(flipped.angleDeg).toBe(330);
    // Both mirrors are a half turn, not a reflection: the sense holds.
    expect(applyCompOps(s0, [transformGroupOp(g, { mirrorH: true, mirrorV: true })]).texts![0].angleDeg).toBe(30);
  });

  test('a member loaded without its snapshot keeps the look it has, then turns with the group', () => {
    // Written before the snapshot existed: locals for the bbox, none for
    // the orientation. Its world orientation is the truth as it stands —
    // upright in a quarter-turned group — and the first transform seeds
    // the snapshot under the chain as it was, so the member turns from
    // there instead of keeping its look and staying.
    const legacy = text({
      id: 't', groupId: 'g', ...LOCAL,
      localCellX: 2, localCellY: 4, localCellWidth: 6, localCellHeight: 2,
    });
    const g90 = { ...g, rotation: 90 as const };
    const s0 = makeState({ groups: [g90], texts: [legacy] });
    // A no-op transform: the look holds, and the snapshot now says so.
    const s1 = applyCompOps(s0, [transformGroupOp(g90, {})]);
    const t1 = s1.texts![0];
    expect(t1.rotation ?? 0).toBe(0);
    expect(t1.localRotation).toBe(270);
    expect(bbox(t1)).toEqual(applyGroupTransform(g90, LOCAL));
    // Another quarter turn turns it.
    const g180 = { ...g, rotation: 180 as const };
    const t2 = applyCompOps(s0, [transformGroupOp(g90, { rotation: 180 })]).texts![0];
    expect(t2.rotation).toBe(90);
    expect(bbox(t2)).toEqual(applyGroupTransform(g180, LOCAL));
    // Undo from a history that predates the snapshot seeds the same way.
    const back = revertCompOps(s0, [transformGroupOp(g, { rotation: 90 })]).texts![0];
    expect(back.rotation).toBe(270);
  });

  test('the load backfill seeds through the chain: a legacy member in a turned group keeps its look', () => {
    const legacy = text({ id: 't', groupId: 'g', ...LOCAL, localCellX: 2, localCellY: 4, localCellWidth: 6, localCellHeight: 2 });
    const out = backfillMissingLocals({ figures: [], svgObjects: [], texts: [legacy], groups: [{ ...g, rotation: 90 }] });
    expect(out.texts![0].localRotation).toBe(270);
  });
});

describe('a word dropped into a rotated frame', () => {
  // The frame: a quarter turn, slid so its local (0,0,42,32) sits at
  // world (0,0,32,42).
  const frame = group({ id: 'f', rotation: 90, translateX: 32, isFrame: true });
  const word = text({ id: 'w', cellX: 10, cellY: 10, cellWidth: 6, cellHeight: 2 });
  const drop = (s: CompositionState): CompositionState => applyCompOps(s, [{
    op: 'reparentNode', nodeId: 'w', newParentGroupId: 'f',
    newSceneOrder: ['w'], oldSceneOrder: ['w'],
    prevFigures: [], prevSVGs: [], prevImages: [], prevTexts: [word], prevPaints: [], prevPatterns: [], prevGroups: [],
  }]);

  test('keeps the look it was dropped with — the snapshot is its world orientation inverted through the frame', () => {
    const s1 = drop(makeState({ groups: [frame], texts: [word] }));
    const w1 = s1.texts![0];
    expect(w1.groupId).toBe('f');
    expect(bbox(w1)).toEqual(bbox(word));
    expect(w1.rotation ?? 0).toBe(0);
    expect(w1.localRotation).toBe(270);
    // A no-op transform of the frame moves nothing (it used to turn the
    // word a quarter on the spot, off its box).
    const s2 = applyCompOps(s1, [transformGroupOp(frame, {})]);
    expect(s2.texts![0]).toEqual(w1);
  });

  test('then turns with the frame', () => {
    const s1 = drop(makeState({ groups: [frame], texts: [word] }));
    const w1 = s1.texts![0];
    const f180 = { ...frame, rotation: 180 as const };
    const s2 = applyCompOps(s1, [transformGroupOp(frame, { rotation: 180 })]);
    const w2 = s2.texts![0];
    expect(w2.rotation).toBe(90);
    expect(bbox(w2)).toEqual(applyGroupTransform(f180, {
      cellX: w1.localCellX!, cellY: w1.localCellY!, cellWidth: w1.localCellWidth!, cellHeight: w1.localCellHeight!,
    }));
  });

  test('a move inside the frame keeps the locals true to the world (a later transform moves nothing)', () => {
    const s1 = drop(makeState({ groups: [frame], texts: [word] }));
    const s2 = applyCompOps(s1, [{ op: 'moveNode', nodeId: 'w', dx: 3, dy: 1 }]);
    const w2 = s2.texts![0];
    expect(bbox(w2)).toEqual({ cellX: 13, cellY: 11, cellWidth: 6, cellHeight: 2 });
    const s3 = applyCompOps(s2, [transformGroupOp(frame, {})]);
    expect(s3.texts![0]).toEqual(w2);
    // Reconcile agrees with what the move left.
    expect(reconcileGroupLocals(s2)).toBe(s2);
  });
});

describe('the snapshot is seeded wherever a bbox member joins a group', () => {
  test('grouping snapshots the orientation and the free rotation as they stand', () => {
    const t = text({ id: 't', rotation: 90, angleDeg: 45 });
    const i = image({ id: 'i', mirrorV: true });
    const s0 = makeState({ texts: [t], images: [i] });
    const s1 = applyCompOps(s0, [{ op: 'groupFigures', figureIds: ['t', 'i'], groupId: 'g', groupName: 'g' }]);
    const t1 = s1.texts![0];
    expect([t1.localRotation, t1.localMirrorH, t1.localMirrorV, t1.localAngleDeg]).toEqual([90, false, false, 45]);
    const i1 = s1.images![0];
    expect([i1.localRotation, i1.localMirrorH, i1.localMirrorV, i1.localAngleDeg]).toEqual([0, false, true, undefined]);
  });

  test('the load backfill seeds a grouped member written before the snapshot existed', () => {
    const t = text({ id: 't', groupId: 'g', rotation: 90, localCellX: 0, localCellY: 0, localCellWidth: 6, localCellHeight: 2 });
    const out = backfillMissingLocals({ figures: [], svgObjects: [], texts: [t], images: [image({ id: 'i' })] });
    expect(out.texts![0].localRotation).toBe(90);
    expect(out.texts![0].localMirrorH).toBe(false);
    // A loose image is left alone.
    expect(out.images![0].localRotation).toBeUndefined();
  });

  test('leaving for the top level clears the snapshot with the rest of the locals', () => {
    const g = group({ id: 'g', rotation: 90 });
    const t = text({
      id: 't', groupId: 'g', ...LOCAL, rotation: 90,
      localCellX: 2, localCellY: 4, localCellWidth: 6, localCellHeight: 2, localRotation: 0, localMirrorH: false, localMirrorV: false,
    });
    const s1 = applyCompOps(makeState({ groups: [g], texts: [t] }), [{
      op: 'reparentNode', nodeId: 't', newParentGroupId: undefined,
      newSceneOrder: ['t'], oldSceneOrder: ['t'],
      prevFigures: [], prevSVGs: [], prevImages: [], prevTexts: [t], prevPaints: [], prevPatterns: [], prevGroups: [],
    }]);
    const t1 = s1.texts![0];
    expect(t1.groupId).toBeUndefined();
    expect(t1.localRotation).toBeUndefined();
    expect(t1.rotation).toBe(90);
  });
});
