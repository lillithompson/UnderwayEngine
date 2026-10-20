import { applyCompOps, findItem } from '@/engine/compositionOps';
import { getNode, worldMatrix } from '@/engine/sceneGraph';
import { matApplyPoint, matTranslate } from '@/engine/sceneTransform';
import type { RGBColor } from '@/engine/types';
import { makeBlankComposition } from '@/editor/blankComposition';
import {
  buildGroupSelectedMulti,
  buildPlacePhotoPlaceholder,
  buildPlaceShape,
  buildRotateNodeFree,
  buildToggleLock,
  commitEntry,
  createEditorSession,
  resolveMultiSelectionBox,
  resolveMultiSelectionFrame,
  type EditorSession,
} from '../editorSession';
import {
  boxToBoxGesture, dragDelta, drawnBox, graphOf, mirrorAbout, previewGesture, resizeBox,
  selectionRoots, snapNoise, twistAbout, worldCentre, worldTurnDeg,
} from '../transformGestures';
import { drawnSegments, expectSegmentsClose, poseOf, TEST_PHOTO_PLACEHOLDER } from './test-utils';

const INK: RGBColor = { r: 40, g: 40, b: 40 };

/** Two 2×2 squares at (0,0) and (4,4), and a 2×1 photo at (10,0). */
function scene() {
  let session = createEditorSession(makeBlankComposition('tg'));
  const a = buildPlaceShape('rect', { cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 }, INK);
  session = commitEntry(session, a);
  const b = buildPlaceShape('rect', { cellX: 4, cellY: 4, cellWidth: 2, cellHeight: 2 }, INK);
  session = commitEntry(session, b);
  const img = buildPlacePhotoPlaceholder({ cellX: 10, cellY: 0, cellWidth: 2, cellHeight: 1 }, TEST_PHOTO_PLACEHOLDER);
  session = commitEntry(session, img);
  return { session, aId: a.id!, bId: b.id!, imgId: img.id! };
}

function grouped(s: EditorSession, ids: string[]) {
  const next = commitEntry(s, buildGroupSelectedMulti(s.state, ids)!);
  const groupId = findItem(next.state, ids[0])!.item.groupId!;
  return { session: next, groupId };
}

describe('selectionRoots — what a gesture actually moves', () => {
  test('loose leaves are their own roots; unknown and locked ids drop out', () => {
    const { session, aId, bId } = scene();
    expect(selectionRoots(session.state, [aId, 'nope', bId]).sort()).toEqual([aId, bId].sort());
    const locked = commitEntry(session, buildToggleLock(session.state, aId)!);
    expect(selectionRoots(locked.state, [aId, bId])).toEqual([bId]);
  });

  test('a bound group whose every leaf is selected is lifted to the group node', () => {
    const { session, aId, bId, imgId } = scene();
    const { session: s, groupId } = grouped(session, [aId, bId]);
    expect(selectionRoots(s.state, [aId, bId])).toEqual([groupId]);
    // Part of a group stays leaves; the group and a loose leaf are two roots.
    expect(selectionRoots(s.state, [aId])).toEqual([aId]);
    expect(selectionRoots(s.state, [aId, bId, imgId]).sort()).toEqual([groupId, imgId].sort());
  });

  test('a group with a locked member is not lifted — the others move alone', () => {
    const { session, aId, bId } = scene();
    const { session: s } = grouped(session, [aId, bId]);
    const locked = commitEntry(s, buildToggleLock(s.state, aId)!);
    expect(selectionRoots(locked.state, [aId, bId])).toEqual([bId]);
  });

  test('a skip rule leaves a kind out', () => {
    const { session, aId, imgId } = scene();
    const isImage = (id: string) => findItem(session.state, id)?.kind === 'image';
    expect(selectionRoots(session.state, [aId, imgId], isImage)).toEqual([aId]);
  });
});

describe('the gestures land where they say', () => {
  test('a drag moves every root by the world delta, a bound group as one op', () => {
    const { session, aId, bId } = scene();
    const loose = dragDelta(session.state, [aId, bId], 3, -1)!;
    expect(loose).toHaveLength(2);
    expect(loose.every((op) => op.op === 'setTransform')).toBe(true);
    const moved = applyCompOps(session.state, loose);
    expect(poseOf(moved, aId).at).toEqual([4, 0]);
    expect(poseOf(moved, bId).at).toEqual([8, 4]);

    const { session: s, groupId } = grouped(session, [aId, bId]);
    const one = dragDelta(s.state, [aId, bId], 3, -1)!;
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ op: 'setTransform', nodeId: groupId });
    const movedGroup = applyCompOps(s.state, one);
    expect(poseOf(movedGroup, aId).at).toEqual([4, 0]);
    expect(poseOf(movedGroup, bId).at).toEqual([8, 4]);
    // The members' own transforms were not touched.
    expect(getNode(movedGroup.graph!, aId)!.transform).toBe(getNode(s.state.graph!, aId)!.transform);
  });

  test('a zero drag is nothing', () => {
    const { session, aId } = scene();
    expect(dragDelta(session.state, [aId], 0, 0)).toBeNull();
  });

  test('a twist turns about the pivot: centres orbit, turns advance, a factor scales the radius', () => {
    const { session, aId, bId } = scene();
    const entry = twistAbout(session.state, [aId, bId], [3, 3], 90, 2)!;
    const next = applyCompOps(session.state, entry);
    // A's centre (1,1) at radius √8 from (3,3) doubles and turns 90 CW → (7,-1).
    expect(poseOf(next, aId).at[0]).toBeCloseTo(7, 9);
    expect(poseOf(next, aId).at[1]).toBeCloseTo(-1, 9);
    expect(poseOf(next, aId).box[0]).toBeCloseTo(4, 9);
    expect(worldTurnDeg(next, aId)).toBeCloseTo(90, 9);
    // Figures never take a free gesture; a bad factor is refused outright.
    expect(twistAbout(session.state, [aId], [3, 3], 10, 0)).toBeNull();
  });

  test('a flip reflects every root across the axis and keeps the flag it was named by', () => {
    const { session, aId, imgId } = scene();
    const before = drawnSegments(session.state, aId);
    const entry = mirrorAbout(session.state, [aId, imgId], [5, 0], 'h')!;
    const next = applyCompOps(session.state, entry);
    expectSegmentsClose(drawnSegments(next, aId), before, (p) => [10 - p[0], p[1]]);
    expect(poseOf(next, imgId).at[0]).toBeCloseTo(-1, 9);
    expect(poseOf(next, imgId).flip).toBe(true);
    expect(getNode(next.graph!, imgId)!.transform.mirrorH).toBe(true);
    expect(next.images!.find((i) => i.id === imgId)!.mirrorH).toBe(true);
    // Twice is nothing.
    const back = applyCompOps(next, mirrorAbout(next, [aId, imgId], [5, 0], 'h')!);
    expectSegmentsClose(drawnSegments(back, aId), before);
    expect(poseOf(back, imgId).flip).toBeUndefined();
  });

  test('a box-to-box resize carries every root by the same affine, along the box axes', () => {
    const { session, aId, bId } = scene();
    const oldBox = { cellX: 0, cellY: 0, cellWidth: 6, cellHeight: 6 };
    const newBox = { cellX: 0, cellY: 0, cellWidth: 12, cellHeight: 3 };
    const g = boxToBoxGesture(oldBox, newBox);
    expect(matApplyPoint(g, 0, 0)).toEqual([0, 0]);
    expect(matApplyPoint(g, 6, 6)).toEqual([12, 3]);
    const next = applyCompOps(session.state, resizeBox(session.state, [aId, bId], oldBox, newBox)!);
    expect(poseOf(next, aId).box[0]).toBeCloseTo(4, 9);
    expect(poseOf(next, aId).box[1]).toBeCloseTo(1, 9);
    expect(poseOf(next, bId).at[0]).toBeCloseTo(10, 9);
    expect(poseOf(next, bId).at[1]).toBeCloseTo(2.5, 9);
    // A turned box scales along its own axes: at 90 the box's width runs
    // down the page, so doubling it doubles page-y about the old centre
    // (3,3), and the new centre (6,3) is where the old one lands.
    const tilted = boxToBoxGesture(oldBox, { ...oldBox, cellWidth: 12 }, 90);
    expect(matApplyPoint(tilted, 3, 3).map((n) => Math.round(n * 1e9) / 1e9)).toEqual([6, 3]);
    const [px, py] = matApplyPoint(tilted, 0, 0);
    expect(px).toBeCloseTo(3, 9);
    expect(py).toBeCloseTo(-3, 9);
    expect(resizeBox(session.state, [aId], oldBox, { ...oldBox, cellWidth: 0 })).toBeNull();
  });
});

describe('reading a pose', () => {
  test('the centre and the turn come off the graph, however the view spells them', () => {
    const { session, imgId } = scene();
    expect(worldCentre(session.state, imgId)).toEqual([11, 0.5]);
    expect(worldTurnDeg(session.state, imgId)).toBe(0);
    const turned = commitEntry(session, buildRotateNodeFree(session.state, imgId, 200)!);
    expect(worldTurnDeg(turned.state, imgId)).toBeCloseTo(-160, 9);
    expect(worldCentre(turned.state, imgId)![0]).toBeCloseTo(11, 9);
    expect(worldCentre(session.state, 'nope')).toBeNull();
    expect(worldTurnDeg(session.state, 'nope')).toBe(0);
  });

  test('drawnBox is the content box at its turn, centred where the matrix puts it', () => {
    const { session, imgId, aId } = scene();
    const turned = commitEntry(session, buildRotateNodeFree(session.state, imgId, 30)!);
    const box = drawnBox(turned.state, imgId)!;
    expect(box.bbox.cellWidth).toBeCloseTo(2, 9);
    expect(box.bbox.cellHeight).toBeCloseTo(1, 9);
    expect(box.bbox.cellX + box.bbox.cellWidth / 2).toBeCloseTo(11, 9);
    expect(box.angleDeg).toBeCloseTo(30, 9);
    // An svg carries its stored box too, drawn at its own turn.
    expect(drawnBox(turned.state, aId)).toEqual({ bbox: { cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 }, angleDeg: 0 });
  });

  test('snapNoise folds a rounding error out and leaves a real fraction alone', () => {
    expect(snapNoise({ tx: 1.0000000000002, ty: -0, sx: 0.9999999999999, sy: 1, rotationDeg: 359.9999999999 }))
      .toEqual({ tx: 1, ty: 0, sx: 1, sy: 1, rotationDeg: 0 });
    expect(snapNoise({ tx: 1.5, ty: 0.25, sx: 2, sy: 0.5, rotationDeg: 33.3 }))
      .toEqual({ tx: 1.5, ty: 0.25, sx: 2, sy: 0.5, rotationDeg: 33.3 });
  });
});

describe('the live preview draws what the commit renders', () => {
  test('each leaf\'s relative matrix carries its drawn centre to where the commit puts it', () => {
    const { session, aId, bId } = scene();
    const { session: s } = grouped(session, [aId, bId]);
    const entry = twistAbout(s.state, [aId, bId], [3, 3], 45)!;
    const preview = previewGesture(s.state, entry);
    const committed = applyCompOps(s.state, entry);
    for (const id of [aId, bId]) {
      const m = preview.get(id)!.css;
      expect(m).toBeDefined();
      // The element stands at its current drawn centre; the preview moves
      // that centre by exactly the commit's move of it.
      const [x0, y0] = poseOf(s.state, id).at;
      const [x1, y1] = poseOf(committed, id).at;
      expect(m.e).toBeCloseTo(x1 - x0, 5);
      expect(m.f).toBeCloseTo(y1 - y0, 5);
      // …and its linear part is the turn.
      expect(Math.atan2(m.b, m.a) * 180 / Math.PI).toBeCloseTo(45, 9);
    }
    // A translation previews as a translation.
    const slide = previewGesture(s.state, dragDelta(s.state, [aId, bId], 2, 1)!);
    expect(slide.get(aId)!.css).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 2, f: 1 });
    // An entry with nothing to move previews nothing.
    expect(previewGesture(s.state, [])).toEqual(new Map());
  });

  test('a preview is the exact relative matrix, shear included', () => {
    // A bound group pulled off-square shears a turned member. The node
    // layer draws that shear as it is (drawnPose), so the preview must say
    // the same: the proposed world matrix over the current one, not a
    // nearest rectangle that then jumps on release.
    const { session, aId, imgId } = scene();
    const { session: s } = grouped(session, [aId, imgId]);
    const turned = commitEntry(s, { entry: twistAbout(s.state, [imgId], [11, 0.5], 30)! });
    const box = resolveMultiSelectionBox(turned.state, [aId, imgId])!;
    const entry = resizeBox(turned.state, [aId, imgId], box, { ...box, cellWidth: box.cellWidth * 3 })!;
    const pose = previewGesture(turned.state, entry).get(imgId)!;
    const m = pose.css;
    const was = worldMatrix(turned.state.graph!, imgId);
    // The relative map over the current matrix is the matrix the member is
    // drawn with under the proposal — and its columns are not orthogonal:
    // a turned rectangle under a one-axis stretch is a parallelogram.
    const a = m.a * was.a + m.c * was.b, b = m.b * was.a + m.d * was.b;
    const c = m.a * was.c + m.c * was.d, d = m.b * was.c + m.d * was.d;
    expect(Math.abs(a * c + b * d)).toBeGreaterThan(1e-3);
    // And `world` says that very matrix outright — the linear part of the
    // composition above, and the translation the commit lands on. It is
    // what the canvas re-draws an off-square member through, so it has to
    // BE the committed pose and not merely agree about the shear.
    expect(pose.world.a).toBeCloseTo(a, 9);
    expect(pose.world.b).toBeCloseTo(b, 9);
    expect(pose.world.c).toBeCloseTo(c, 9);
    expect(pose.world.d).toBeCloseTo(d, 9);
    const after = worldMatrix(graphOf(applyCompOps(turned.state, entry)), imgId);
    expect(pose.world.e).toBeCloseTo(after.e, 9);
    expect(pose.world.f).toBeCloseTo(after.f, 9);
  });
});

describe('resolveMultiSelectionFrame — the box the canvas outlines', () => {
  test('a loose selection and a square bound group get the axis-aligned box at 0', () => {
    const { session, aId, bId } = scene();
    const aabb = resolveMultiSelectionBox(session.state, [aId, bId])!;
    expect(resolveMultiSelectionFrame(session.state, [aId, bId])).toEqual({ bbox: aabb, angleDeg: 0 });
    const { session: s } = grouped(session, [aId, bId]);
    expect(resolveMultiSelectionFrame(s.state, [aId, bId])).toEqual({ bbox: aabb, angleDeg: 0 });
    expect(resolveMultiSelectionFrame(s.state, ['nope'])).toBeNull();
  });

  test('a bound group turned off the quarters wears a box turned with it', () => {
    const { session, aId, bId } = scene();
    const { session: s } = grouped(session, [aId, bId]);
    // Turn the group 30 about the pair's centre (3,3).
    const turned = applyCompOps(s.state, twistAbout(s.state, [aId, bId], [3, 3], 30)!);
    const frame = resolveMultiSelectionFrame(turned, [aId, bId])!;
    expect(frame.angleDeg).toBeCloseTo(30, 9);
    // Centred on the pair, and exactly the group's own frame: the pair
    // spanned 6 by 6 before the turn and turned rigidly with it.
    const cx = frame.bbox.cellX + frame.bbox.cellWidth / 2;
    const cy = frame.bbox.cellY + frame.bbox.cellHeight / 2;
    expect(cx).toBeCloseTo(3, 6);
    expect(cy).toBeCloseTo(3, 6);
    expect(frame.bbox.cellWidth).toBeCloseTo(6, 6);
    expect(frame.bbox.cellHeight).toBeCloseTo(6, 6);
    // …where the page-aligned box around the tilted pair is the wrong shape.
    const aabb = resolveMultiSelectionBox(turned, [aId, bId])!;
    expect(aabb.cellWidth).not.toBeCloseTo(6, 3);
    // A quarter turn is axis-aligned again.
    const square = applyCompOps(s.state, twistAbout(s.state, [aId, bId], [3, 3], 90)!);
    expect(resolveMultiSelectionFrame(square, [aId, bId])!.angleDeg).toBe(0);
  });
});

describe('a preview and its commit agree on a translation', () => {
  test('matTranslate is the drag', () => {
    expect(matTranslate(2, 3)).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 2, f: 3 });
  });
});
