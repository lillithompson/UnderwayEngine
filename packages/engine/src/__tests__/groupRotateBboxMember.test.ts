import {
  applyCompOps,
  applyGroupTransform,
  revertCompOps,
} from '../compositionOps';
import { CompositionState, CompUndoOp, GroupNode, TextObject, ImageObject, makeViewport } from '../types';
import { flipOf, poseOf, turnOf } from './groupTransform.test-utils';

// A bbox-only member (a text, an image, a paint island, a pattern) of a
// rotated or flipped group renders, hit-tests and boxes where it is DRAWN.
// The bugs these pin are both "it turned when nothing asked it to": a text
// in a 90° frame gained a quarter past its bbox on the frame's next
// transform, and a word dropped into a rotated frame turned on the spot
// while its box stayed put (the Adrift report).
//
// These used to be about a LOCAL orientation snapshot kept beside the
// world fields and composed with the group on every materialize. P6-B
// retired the snapshot: a member's pose is its world pose, and its parent
// is the group, so "turning twice" has nowhere to come from. What is left
// worth pinning is the behaviour — the look holds — asked through
// `turnOf` / `flipOf` rather than of whichever field spells it.

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

/** Where a box's CENTRE lands under a group's transform. The box itself is
 *  not compared: a quarter turn swaps the stored width and height on a leaf
 *  that carries a discrete rotation channel and leaves them alone on one
 *  that does not, and both draw the same rectangle (§1.3). */
const centreUnder = (g: GroupNode, box: typeof LOCAL): [number, number] => {
  const w = applyGroupTransform(g, box);
  return [w.cellX + w.cellWidth / 2, w.cellY + w.cellHeight / 2];
};


describe('a text in a group that turns', () => {
  const g = group({ id: 'g' });
  const member = text({
    id: 't', groupId: 'g', ...LOCAL,
  });

  test('turns with the group once, and stays turned once on the next transform', () => {
    const s0 = makeState({ groups: [g], texts: [member] });
    const g90 = { ...g, rotation: 90 as const };
    const s1 = applyCompOps(s0, [transformGroupOp(g, { rotation: 90 })]);
    expect(turnOf(s1, 't')).toBe(90);
    expect(poseOf(s1, 't').at).toEqual(centreUnder(g90, LOCAL));
    expect(poseOf(s1, 't').box).toEqual([6, 2]);
    // The frame slides: the text keeps its quarter turn (it used to gain
    // another — the world orientation composed with the group again).
    const g90t = { ...g90, translateX: 5 };
    const s2 = applyCompOps(s1, [transformGroupOp(g90, { translateX: 5 })]);
    expect(turnOf(s2, 't')).toBe(90);
    expect(poseOf(s2, 't').at).toEqual(centreUnder(g90t, LOCAL));
    // And a no-op transform moves nothing.
    const s3 = applyCompOps(s2, [transformGroupOp(g90t, {})]);
    expect(s3.texts![0]).toEqual(s2.texts![0]);
  });

  test('a free rotation keeps its sense through a quarter turn and flips through a mirror', () => {
    const spun = { ...member, angleDeg: 30 };
    const s0 = makeState({ groups: [g], texts: [spun] });
    // A quarter turn ADDS to the free angle: 30 + 90.
    const turned = applyCompOps(s0, [transformGroupOp(g, { rotation: 90 })]);
    expect(turnOf(turned, 't')).toBe(120);
    expect(flipOf(turned, 't')).toBe(false);
    // A mirror reverses the sense of the free angle. Canonically that is
    // "flipped, turned 150": reflecting about the vertical axis and then
    // spinning 30 is the same matrix as spinning 180 - 30 and reflecting
    // about the horizontal one, and `flip` does not record which axis.
    const flipped = applyCompOps(s0, [transformGroupOp(g, { mirrorH: true })]);
    expect(flipOf(flipped, 't')).toBe(true);
    expect(turnOf(flipped, 't')).toBe(150);
    // Both mirrors are a half turn, not a reflection: the sense holds.
    const both = applyCompOps(s0, [transformGroupOp(g, { mirrorH: true, mirrorV: true })]);
    expect(flipOf(both, 't')).toBe(false);
    expect(turnOf(both, 't')).toBe(210);
  });

  test('an upright member of an already-turned group stays upright until the group turns again', () => {
    // A member sitting upright inside a quarter-turned group. Its world
    // pose is the truth as it stands, so a transform that changes nothing
    // must leave it exactly where it is — and a further quarter must turn
    // it by a quarter, not to a quarter.
    const upright = text({ id: 't', groupId: 'g', ...LOCAL });
    const g90 = { ...g, rotation: 90 as const };
    const s0 = makeState({ groups: [g90], texts: [upright] });

    const s1 = applyCompOps(s0, [transformGroupOp(g90, {})]);
    expect(turnOf(s1, 't')).toBe(0);
    expect(bbox(s1.texts![0])).toEqual(bbox(upright));

    const s2 = applyCompOps(s0, [transformGroupOp(g90, { rotation: 180 })]);
    expect(turnOf(s2, 't')).toBe(90);
    // The group went from a quarter to a half, so the member swings by the
    // quarter between them, about the group's origin.
    expect(poseOf(s2, 't').at).toEqual(centreUnder(
      group({ id: 'g', rotation: 90 }), bbox(upright)));

    // Undoing the quarter that put the group here takes it back a quarter.
    const back = revertCompOps(s0, [transformGroupOp(g, { rotation: 90 })]);
    expect(turnOf(back, 't')).toBe(270);
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

  test('keeps the look it was dropped with — joining a turned frame turns nothing', () => {
    const s1 = drop(makeState({ groups: [frame], texts: [word] }));
    const w1 = s1.texts![0];
    expect(w1.groupId).toBe('f');
    expect(bbox(w1)).toEqual(bbox(word));
    expect(turnOf(s1, 'w')).toBe(0);
    // A no-op transform of the frame moves nothing (it used to turn the
    // word a quarter on the spot, off its box).
    const s2 = applyCompOps(s1, [transformGroupOp(frame, {})]);
    expect(s2.texts![0]).toEqual(w1);
  });

  test('then turns with the frame', () => {
    const s1 = drop(makeState({ groups: [frame], texts: [word] }));
    const f180 = { ...frame, rotation: 180 as const };
    const s2 = applyCompOps(s1, [transformGroupOp(frame, { rotation: 180 })]);
    // The frame went from a quarter to a half, so the word turns by the
    // quarter between them — and its own drawn size is untouched.
    expect(turnOf(s2, 'w')).toBe(90);
    expect(poseOf(s2, 'w').box).toEqual(poseOf(s1, 'w').box);
    // And it rides the frame: it stays at the same place INSIDE it. The
    // word was dropped at world (10,10,6,2), which under this frame
    // (a quarter turn slid to x=32) is (10,16,2,6) — so where the frame's
    // new transform puts that box is where the word has to be.
    const inFrame = { cellX: 10, cellY: 16, cellWidth: 2, cellHeight: 6 };
    expect(poseOf(s2, 'w').at).toEqual(centreUnder(f180, inFrame));
  });

  test('a move inside the frame sticks (a later transform moves nothing)', () => {
    const s1 = drop(makeState({ groups: [frame], texts: [word] }));
    const s2 = applyCompOps(s1, [{ op: 'moveNode', nodeId: 'w', dx: 3, dy: 1 }]);
    const w2 = s2.texts![0];
    expect(bbox(w2)).toEqual({ cellX: 13, cellY: 11, cellWidth: 6, cellHeight: 2 });
    // The op that used to undo a per-member edit — an ancestor transform,
    // which re-derived the member from a cache the move never updated.
    const s3 = applyCompOps(s2, [transformGroupOp(frame, {})]);
    expect(s3.texts![0]).toEqual(w2);
  });
});

describe('joining and leaving a group changes nothing about the look', () => {
  test('grouping leaves every member drawn exactly as it was', () => {
    const t = text({ id: 't', rotation: 90, angleDeg: 45 });
    const i = image({ id: 'i', mirrorV: true });
    const s0 = makeState({ texts: [t], images: [i] });
    const s1 = applyCompOps(s0, [{ op: 'groupFigures', figureIds: ['t', 'i'], groupId: 'g', groupName: 'g' }]);
    // A quarter plus a free 45 is a turn of 135, however it is spelled.
    expect(turnOf(s1, 't')).toBe(turnOf(s0, 't'));
    expect(flipOf(s1, 't')).toBe(flipOf(s0, 't'));
    expect(bbox(s1.texts![0])).toEqual(bbox(t));
    expect(turnOf(s1, 'i')).toBe(turnOf(s0, 'i'));
    expect(flipOf(s1, 'i')).toBe(flipOf(s0, 'i'));
    expect(bbox(s1.images![0])).toEqual(bbox(i));
  });

  test('leaving for the top level keeps the look, and the membership goes', () => {
    const g = group({ id: 'g', rotation: 90 });
    const t = text({ id: 't', groupId: 'g', ...LOCAL, rotation: 90 });
    const s0 = makeState({ groups: [g], texts: [t] });
    const s1 = applyCompOps(s0, [{
      op: 'reparentNode', nodeId: 't', newParentGroupId: undefined,
      newSceneOrder: ['t'], oldSceneOrder: ['t'],
      prevFigures: [], prevSVGs: [], prevImages: [], prevTexts: [t], prevPaints: [], prevPatterns: [], prevGroups: [],
    }]);
    const t1 = s1.texts![0];
    expect(t1.groupId).toBeUndefined();
    expect(turnOf(s1, 't')).toBe(turnOf(s0, 't'));
    expect(bbox(t1)).toEqual(bbox(t));
  });
});
