import { applyCompOps, findItem, revertCompOps } from '@/engine/compositionOps';
import { measureTextBbox } from '@/engine/textLayout';
import { RGBColor, SVGObject, TextStyle } from '@/engine/types';
import { COVER_FRAMING } from '@/engine/imageFraming';
import { makeBlankComposition } from '@/editor/blankComposition';
import { drawnAabb, drawnSegments, expectSegmentsClose, poseOf, turnOf } from './test-utils';
import {
  buildDuplicateSelected,
  buildDuplicateSelectedMulti,
  buildSuperDuplicate,
  buildMirrorSelected,
  buildMoveNode,
  buildToggleLock,
  buildToggleLockGroup,
  buildPlaceImage,
  buildPlacePhotoPlaceholder,
  buildReplaceImageContent,
  buildSetImageCornerRadius,
  buildPanImageFraming,
  buildZoomImageFraming,
  buildSetImageFraming,
  buildSetImageTintFill,
  withPannedFraming,
  withZoomedFraming,
  withImageCornerRadius,
  withImageTintFill,
  containBboxInto,
  buildPlacePolyline,
  buildPlaceShape,
  buildPlaceText,
  buildRecolorSVG,
  buildRemoveSelected,
  buildReorder,
  buildReorderSelection,
  buildGroupSelectedMulti,
  buildResizeNode,
  requiresUniformScale,
  buildRotateNodeFree,
  buildRotateSelected,
  buildScaleNode,
  scaleBboxAboutCenter,
  buildToggleStickerInvert,
  buildSetBackground,
  buildSetEffects,
  buildSetFillPaint,
  buildSetTextContent,
  buildSetTextStyle,
  buildSetTint,
  commit,
  commitEntry,
  createEditorSession,
  filterPolylinePoints,
  markSaved,
  mintNodeId,
  redo,
  select,
  selectMany,
  setTool,
  undo,
} from '../editorSession';

import { TEST_PHOTO_PLACEHOLDER as PLACEHOLDER } from './test-utils';

const INK: RGBColor = { r: 40, g: 40, b: 40 };
const RED: RGBColor = { r: 200, g: 60, b: 60 };

const STYLE: TextStyle = { fontId: 'system', size: 2, color: INK };

function sessionWithShape() {
  let session = createEditorSession(makeBlankComposition('c1'));
  const se = buildPlaceShape('rect', { cellX: 4, cellY: 4, cellWidth: 8, cellHeight: 6 }, INK);
  session = commitEntry(session, se);
  return { session, id: se.id! };
}

describe('mintNodeId', () => {
  test('honors engine id namespaces and stays unique', () => {
    const a = mintNodeId('svg');
    const b = mintNodeId('text');
    const c = mintNodeId('image');
    expect(a).toMatch(/^svg_/);
    expect(b).toMatch(/^txt_/);
    expect(c).toMatch(/^img_/);
    expect(new Set([a, b, c, mintNodeId('svg')]).size).toBe(4);
  });
});

describe('commit / undo / redo discipline', () => {
  test('commit applies ops, pushes undo, clears redo, marks dirty', () => {
    let { session } = sessionWithShape();
    expect(session.state.svgObjects).toHaveLength(1);
    expect(session.undoStack).toHaveLength(1);
    expect(session.dirty).toBe(true);

    session = undo(session);
    expect(session.state.svgObjects).toHaveLength(0);
    expect(session.redoStack).toHaveLength(1);

    // A fresh commit after undo clears the redo stack.
    session = commitEntry(session, buildPlaceShape('ellipse', { cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 }, INK));
    expect(session.redoStack).toHaveLength(0);
    expect(session.undoStack).toHaveLength(1);
  });

  test('undo/redo round-trip restores state exactly', () => {
    const { session, id } = sessionWithShape();
    const afterUndo = undo(session);
    expect(afterUndo.state.svgObjects).toHaveLength(0);
    expect(afterUndo.state.sceneOrder).toHaveLength(0);
    const afterRedo = redo(afterUndo);
    expect(afterRedo.state.svgObjects.map((s) => s.id)).toEqual([id]);
    expect(afterRedo.state.sceneOrder).toEqual([id]);
    expect(afterRedo.undoStack).toHaveLength(1);
    expect(afterRedo.redoStack).toHaveLength(0);
  });

  test('undo clears a selection whose node vanished', () => {
    const { session, id } = sessionWithShape();
    expect(session.selectedId).toBe(id); // commitEntry auto-selects mints
    const afterUndo = undo(session);
    expect(afterUndo.selectedId).toBeNull();
  });

  test('a delete clears the selection it removed, without waiting for undo', () => {
    // Nothing on screen shows a selection whose node is gone (the outline
    // needs a box), but a selection is also the raster brush's object
    // filter — a leftover id confines every later stroke to an object that
    // no longer exists, and the brush quietly stops painting.
    const { session, id } = sessionWithShape();
    expect(session.selectedId).toBe(id);
    const deleted = commitEntry(session, buildRemoveSelected(session.state, id)!);
    expect(deleted.state.svgObjects).toHaveLength(0);
    expect(deleted.selectedId).toBeNull();
    // Undo brings the node back as it always did — unselected, since the
    // undo stack carries document ops and not the selection.
    const restored = undo(deleted);
    expect(restored.state.svgObjects.map((s) => s.id)).toEqual([id]);
    expect(restored.selectedId).toBeNull();
  });

  test('a multi-selection drops only the members a delete took', () => {
    let { session, id } = sessionWithShape();
    const second = buildPlaceShape('ellipse', { cellX: 20, cellY: 20, cellWidth: 4, cellHeight: 4 }, INK);
    session = commitEntry(session, second);
    session = selectMany(session, [id, second.id!]);
    const deleted = commitEntry(session, buildRemoveSelected(session.state, id)!);
    // Below two survivors the multi collapses to a single selection — the
    // same normalization selectMany applies on the way in.
    expect(deleted.selectedIds).toEqual([]);
    expect(deleted.selectedId).toBe(second.id);
  });

  test('empty entries and no-op stacks return the same session', () => {
    const { session } = sessionWithShape();
    expect(commit(session, [])).toBe(session);
    expect(redo(session)).toBe(session);
    const fresh = createEditorSession(makeBlankComposition('c2'));
    expect(undo(fresh)).toBe(fresh);
  });

  test('select / setTool / markSaved', () => {
    let { session, id } = sessionWithShape();
    session = select(session, null);
    expect(session.selectedId).toBeNull();
    session = select(session, id);
    expect(session.selectedId).toBe(id);
    session = setTool(session, 'draw');
    expect(session.activeTool).toBe('draw');
    session = markSaved(session);
    expect(session.dirty).toBe(false);
  });

  test('untoggling every tool clears the selection with it', () => {
    let { session, id } = sessionWithShape();
    session = select(session, id);
    const none = setTool(session, null);
    expect(none.activeTool).toBeNull();
    // No canvas gesture can act on a selection with no tool — no handles, and
    // a tap is inert (see resolveCanvasTap) — so leaving one set would strand
    // an outline the user can no longer clear.
    expect(none.selectedId).toBeNull();
    // Untoggling is not a document edit.
    expect(none.dirty).toBe(session.dirty);
    expect(none.state).toBe(session.state);
    // Re-pressing a tool from the no-tool state just activates it.
    expect(setTool(none, 'draw').activeTool).toBe('draw');
    // Already off is a no-op — same object, so React skips the re-render.
    expect(setTool(none, null)).toBe(none);
  });
});

describe('select keeps the armed tool', () => {
  function sessionWithSvg(extra: Partial<SVGObject>) {
    let session = createEditorSession(makeBlankComposition('c1'));
    const svg: SVGObject = {
      id: 'svg_1',
      segments: [{ kind: 'line', start: [0, 0], end: [4, 0] }],
      color: INK, cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
      ...extra,
    };
    session = commit(session, [{ op: 'placeObject', kind: 'svg', item: svg }]);
    // Start on a non-arrange tool so a switch would be observable.
    session = setTool(session, 'draw');
    return session;
  }

  test('tapping an unlocked, visible object selects it and stays on the tool', () => {
    const session = select(sessionWithSvg({}), 'svg_1');
    expect(session.selectedId).toBe('svg_1');
    expect(session.activeTool).toBe('draw');
  });

  test('tapping a locked object selects it and stays on the tool', () => {
    const session = select(sessionWithSvg({ locked: true }), 'svg_1');
    expect(session.selectedId).toBe('svg_1');
    expect(session.activeTool).toBe('draw');
  });

  test('tapping a hidden object selects it and stays on the tool', () => {
    const session = select(sessionWithSvg({ hidden: true }), 'svg_1');
    expect(session.selectedId).toBe('svg_1');
    expect(session.activeTool).toBe('draw');
  });

  test('a null (empty-canvas) tap clears the selection and stays on the tool', () => {
    const session = select(select(sessionWithSvg({}), 'svg_1'), null);
    expect(session.selectedId).toBeNull();
    expect(session.activeTool).toBe('draw');
  });

  test('retargeting the selection from one object to another keeps the tool', () => {
    const base = select(sessionWithSvg({}), 'svg_1');
    const next = select(base, 'svg_missing');
    expect(next.selectedId).toBe('svg_missing');
    expect(next.activeTool).toBe('draw');
  });
});

describe('locked-node rejection', () => {
  function sessionWithLockedSvg() {
    let session = createEditorSession(makeBlankComposition('c1'));
    const locked: SVGObject = {
      id: 'svg_locked', locked: true,
      segments: [{ kind: 'line', start: [0, 0], end: [4, 0] }],
      color: INK, cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 0,
    };
    session = commit(session, [{ op: 'placeObject', kind: 'svg', item: locked }]);
    return session;
  }

  test('move / remove / recolor of a locked node are rejected unchanged', () => {
    const session = sessionWithLockedSvg();
    // The move builder itself leaves a locked node out…
    expect(buildMoveNode(session.state, 'svg_locked', 1, 1)).toBeNull();
    // …and the commit guard catches a transform aimed at one regardless.
    const t = session.state.graph!.nodes.get('svg_locked')!.transform;
    expect(commit(session, [{ op: 'setTransform', nodeId: 'svg_locked', from: t, to: { ...t, tx: t.tx + 1 } }]))
      .toBe(session);

    const remove = buildRemoveSelected(session.state, 'svg_locked');
    expect(commit(session, remove!.entry)).toBe(session);

    const recolor = buildRecolorSVG(session.state, 'svg_locked', RED);
    expect(commit(session, recolor!.entry)).toBe(session);
  });

  test('rotate/mirror builders refuse locked nodes up front', () => {
    const session = sessionWithLockedSvg();
    expect(buildRotateSelected(session.state, 'svg_locked')).toBeNull();
    expect(buildMirrorSelected(session.state, 'svg_locked')).toBeNull();
  });

  test('duplicating a locked node is allowed and the copy comes out unlocked', () => {
    const session = sessionWithLockedSvg();
    const se = buildDuplicateSelected(session.state, 'svg_locked');
    expect(se).not.toBeNull();
    const next = commitEntry(session, se!);
    expect(next).not.toBe(session);
    // Engine contract (cloneWithOffset): duplicates always start unlocked
    // so the fresh copy is immediately editable.
    const dup = next.state.svgObjects.find((s) => s.id === se!.id)!;
    expect(dup.locked ?? false).toBe(false);
  });
});

describe('buildDuplicateSelected', () => {
  test('places an offset copy with a fresh id that commitEntry selects', () => {
    const { session, id } = sessionWithShape();
    const original = session.state.svgObjects[0];
    const se = buildDuplicateSelected(session.state, id);
    expect(se).not.toBeNull();
    expect(se!.id).toBeDefined();
    expect(se!.id).not.toBe(id);

    const next = commitEntry(session, se!);
    expect(next.state.svgObjects).toHaveLength(2);
    expect(next.selectedId).toBe(se!.id);
    const dup = next.state.svgObjects.find((s) => s.id === se!.id)!;
    // Same size, nudged by the zoom-scaled duplicate offset.
    expect(dup.cellWidth).toBeCloseTo(original.cellWidth, 9);
    expect(dup.cellHeight).toBeCloseTo(original.cellHeight, 9);
    expect(dup.cellX).toBeGreaterThan(original.cellX);
    expect(dup.cellY).toBeGreaterThan(original.cellY);

    // Undo removes exactly the duplicate.
    const reverted = undo(next);
    expect(reverted.state.svgObjects.map((s) => s.id)).toEqual([id]);
  });

  test('a fresh image is born scale-to-fill; the unset placeholder stays bare', () => {
    // Placed with bytes: plain cover (fill @ zoom 1), so dragging the
    // bounding box afterwards CROPS the picture instead of stretching it.
    // Zoom is an explicit 1, not the crop bar's 1.3 seat, so nothing zooms
    // in on arrival — with the box at the image's own aspect, cover at 1 is
    // exactly the whole picture. The node SAYS what it is here; an image
    // reaching a renderer without the record is drawn the same way anyway
    // (engine effectiveFraming), so there is no path back to the deform.
    const place = buildPlaceImage('imgblob_f', 'image/png', 40, 30,
      { cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 6 }, new Uint8Array([1]));
    const img = (place.entry[0] as { item: { framing?: unknown } }).item;
    expect(img.framing).toEqual({ mode: 'fill', zoom: 1 });
    expect(img.framing).toEqual(COVER_FRAMING);
    // Its own copy, not the shared constant — a crop edit on one image must
    // not reach into every other image's framing.
    expect(img.framing).not.toBe(COVER_FRAMING);
    // The unset photo placeholder (no bytes) keeps no framing: the "no
    // image" mountain renders plain (MissingImageFill is chosen by the
    // absent bytes, not by the framing), and the eventual replacement seeds
    // the cover framing itself (buildReplaceImageContent).
    const ph = buildPlacePhotoPlaceholder({ cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 6 }, PLACEHOLDER);
    expect((ph.entry[0] as { item: { framing?: unknown } }).item.framing).toBeUndefined();
  });

  test('a crop gesture on an image with no framing record starts from cover, not 130%', () => {
    // `{ mode: 'fill' }` alone resolves zoom to the Crop bar's 1.3 default,
    // so the first pinch or pan on an older, record-less image used to jump
    // the picture to 130% before the gesture's own delta was applied.
    let session = createEditorSession(makeBlankComposition('c_crop'));
    const place = buildPlaceImage('imgblob_c', 'image/png', 40, 20,
      { cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 4 }, new Uint8Array([1]));
    session = commitEntry(session, place);
    // Strip the record, as a page written before the birth framing has it.
    const bare = {
      ...session.state,
      images: session.state.images!.map((i) => { const { framing, ...rest } = i; return rest; }),
    };
    // A pinch of exactly 1 — no change asked for — must not move the zoom.
    const zoomed = withZoomedFraming(bare, place.id!, 1);
    expect(zoomed.images![0].framing?.zoom ?? 1).toBeCloseTo(1, 9);
  });

  test('an image duplicate shares the source imageId (no blob copy)', () => {
    let session = createEditorSession(makeBlankComposition('c1'));
    const bytes = new Uint8Array([1, 2, 3]);
    const place = buildPlaceImage('imgblob_1', 'image/png', 40, 30,
      { cellX: 2, cellY: 2, cellWidth: 8, cellHeight: 6 }, bytes);
    session = commitEntry(session, place);

    const se = buildDuplicateSelected(session.state, place.id!);
    session = commitEntry(session, se!);
    expect(session.state.images).toHaveLength(2);
    expect(session.state.images![1].imageId).toBe('imgblob_1');
    expect(se!.blobs).toBeUndefined();
  });

  test('unknown id → null', () => {
    const { session } = sessionWithShape();
    expect(buildDuplicateSelected(session.state, 'svg_nope')).toBeNull();
  });

  describe('a copy lands adjacent ABOVE its original, not on top of the page', () => {
    const three = () => {
      let session = createEditorSession(makeBlankComposition('c1'));
      const a = buildPlaceShape('rect', { cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 }, INK);
      const b = buildPlaceShape('rect', { cellX: 2, cellY: 2, cellWidth: 4, cellHeight: 4 }, RED);
      const c = buildPlaceShape('rect', { cellX: 4, cellY: 4, cellWidth: 4, cellHeight: 4 }, INK);
      session = commitEntry(session, a);
      session = commitEntry(session, b);
      session = commitEntry(session, c);
      expect(session.state.sceneOrder).toEqual([a.id, b.id, c.id]);
      return { session, a: a.id!, b: b.id!, c: c.id! };
    };

    test('a single duplicate slots in just above what it copies', () => {
      const { session, a, b, c } = three();
      const se = buildDuplicateSelected(session.state, a)!;
      const next = commitEntry(session, se);
      expect(next.state.sceneOrder).toEqual([a, se.id, b, c]);
      // Undo takes the copy back out and leaves the order as it was.
      expect(undo(next).state.sceneOrder).toEqual([a, b, c]);
      // The front-most object's copy goes to the front, as before.
      const top = buildDuplicateSelected(session.state, c)!;
      expect(commitEntry(session, top).state.sceneOrder).toEqual([a, b, c, top.id]);
    });

    test('a multi duplicate lands as one block above the topmost original, in the originals’ order', () => {
      const { session, a, b, c } = three();
      // Selected c first, then a: the copies still stack a′ under c′.
      const se = buildDuplicateSelectedMulti(session.state, [c, a])!;
      const next = commitEntry(session, se);
      const [aCopy, cCopy] = [se.ids![1], se.ids![0]];
      expect(next.state.sceneOrder).toEqual([a, b, c, aCopy, cCopy]);
    });

    test('a grouped original’s copy lands above its whole group, never inside the group’s run', () => {
      const { session: base, a, b, c } = three();
      const session = commitEntry(base, buildGroupSelectedMulti(base.state, [a, b])!);
      expect(session.state.sceneOrder).toEqual([a, b, c]);
      const se = buildDuplicateSelected(session.state, a)!;
      const next = commitEntry(session, se);
      expect(next.state.sceneOrder).toEqual([a, b, se.id, c]);
      // The copy sits in a sibling group of its own, not in a's.
      const copy = next.state.svgObjects.find((o) => o.id === se.id)!;
      const orig = next.state.svgObjects.find((o) => o.id === a)!;
      expect(copy.groupId).toBeDefined();
      expect(copy.groupId).not.toBe(orig.groupId);
      // A whole-group duplicate lands above the group as a block too.
      const whole = buildDuplicateSelectedMulti(session.state, [a, b])!;
      expect(commitEntry(session, whole).state.sceneOrder).toEqual([a, b, ...whole.ids!, c]);
    });

    test('the punch-through duplicate of a locked object slots in the same way', () => {
      const { session, a, b, c } = three();
      const locked = commitEntry(session, buildToggleLock(session.state, b)!);
      const se = buildSuperDuplicate(locked.state, b)!;
      expect(commitEntry(locked, se).state.sceneOrder).toEqual([a, b, se.id, c]);
    });
  });

  test('carries a full-res original blob under originalImageId', () => {
    let session = createEditorSession(makeBlankComposition('c1'));
    const display = new Uint8Array([1, 2, 3]);
    const original = new Uint8Array([9, 9, 9, 9]);
    const place = buildPlaceImage('imgblob_d', 'image/jpeg', 40, 30,
      { cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 6 }, display,
      { originalImageId: 'imgblob_o', originalBytes: original });
    // Both blobs ride the entry, keyed separately.
    expect(place.blobs).toEqual({ imgblob_d: display, imgblob_o: original });
    session = commitEntry(session, place);
    const img = session.state.images![0];
    expect(img.imageId).toBe('imgblob_d');
    expect(img.originalImageId).toBe('imgblob_o');
    // Both live in the merged blob map for export to reach.
    expect(session.state.imageBlobs!.imgblob_o).toEqual(original);
  });

  test('omits originalImageId when no original is supplied', () => {
    const place = buildPlaceImage('imgblob_d', 'image/png', 40, 30,
      { cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 6 }, new Uint8Array([1]));
    expect(place.blobs).toEqual({ imgblob_d: new Uint8Array([1]) });
    const img = (place.entry[0] as { item: { originalImageId?: string } }).item;
    expect(img.originalImageId).toBeUndefined();
  });
});

describe('containBboxInto', () => {
  test('aspect-fits and centers a wide bitmap inside a square rect', () => {
    // 40×20 into 10×10 → scale 0.25 → 10×5, centered vertically.
    const fit = containBboxInto({ cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 }, 40, 20);
    expect(fit).toEqual({ cellX: 0, cellY: 2.5, cellWidth: 10, cellHeight: 5 });
  });
  test('aspect-fits and centers a tall bitmap inside a square rect', () => {
    // 20×40 into 10×10 → scale 0.25 → 5×10, centered horizontally.
    const fit = containBboxInto({ cellX: 4, cellY: 4, cellWidth: 10, cellHeight: 10 }, 20, 40);
    expect(fit).toEqual({ cellX: 6.5, cellY: 4, cellWidth: 5, cellHeight: 10 });
  });
});

describe('buildReplaceImageContent', () => {
  function withImage() {
    let session = createEditorSession(makeBlankComposition('c1'));
    const place = buildPlaceImage('imgblob_old', 'image/png', 40, 30,
      { cellX: 2, cellY: 2, cellWidth: 8, cellHeight: 6 }, new Uint8Array([1, 2, 3]));
    session = commitEntry(session, place);
    return { session, id: place.id! };
  }

  test('swaps pixels + carries new bytes, keeping the same node id', () => {
    let { session, id } = withImage();
    const se = buildReplaceImageContent(
      session.state, id, 'imgblob_new', 'image/jpeg', 20, 20, new Uint8Array([9, 9]));
    expect(se).not.toBeNull();
    expect(se!.blobs).toEqual({ imgblob_new: new Uint8Array([9, 9]) });
    session = commitEntry(session, se!);

    expect(session.state.images).toHaveLength(1);
    const img = session.state.images![0];
    expect(img.id).toBe(id); // same container
    expect(img.imageId).toBe('imgblob_new');
    expect(img.mimeType).toBe('image/jpeg');
    expect(img.pixelWidth).toBe(20);
    expect(img.pixelHeight).toBe(20);
    // Box is left exactly as it was (8×6) — the FULL bitmap is stored and a
    // plain-cover Fill framing fits it into the same space, so nothing is
    // discarded and Crop mode can still reach the overflow.
    expect(img.cellX).toBe(2);
    expect(img.cellY).toBe(2);
    expect(img.cellWidth).toBe(8);
    expect(img.cellHeight).toBe(6);
    // Framing is seeded to plain cover (fill @ zoom 1), NOT the crop-bar
    // default of 1.3 — replace must not silently zoom in.
    expect(img.framing).toEqual({ mode: 'fill', zoom: 1 });
    // Old bytes stay for undo; new bytes are present.
    expect(session.state.imageBlobs?.imgblob_old).toBeDefined();
    expect(session.state.imageBlobs?.imgblob_new).toBeDefined();
  });

  test('carries a replacement original blob and sets originalImageId', () => {
    let { session, id } = withImage();
    const se = buildReplaceImageContent(
      session.state, id, 'imgblob_new', 'image/jpeg', 20, 20, new Uint8Array([9, 9]),
      { originalImageId: 'imgblob_new_o', originalBytes: new Uint8Array([7, 7, 7]) });
    expect(se!.blobs).toEqual({
      imgblob_new: new Uint8Array([9, 9]),
      imgblob_new_o: new Uint8Array([7, 7, 7]),
    });
    session = commitEntry(session, se!);
    const img = session.state.images![0];
    expect(img.originalImageId).toBe('imgblob_new_o');
    expect(session.state.imageBlobs?.imgblob_new_o).toEqual(new Uint8Array([7, 7, 7]));
  });

  test('clears a stale originalImageId when the replacement has no original', () => {
    // Seed a node that already carries an original, then replace with a
    // small image — the dangling original id must be dropped, not kept.
    let session = createEditorSession(makeBlankComposition('c1'));
    const place = buildPlaceImage('imgblob_old', 'image/png', 40, 30,
      { cellX: 2, cellY: 2, cellWidth: 8, cellHeight: 6 }, new Uint8Array([1]),
      { originalImageId: 'imgblob_old_o', originalBytes: new Uint8Array([2, 2]) });
    session = commitEntry(session, place);
    const se = buildReplaceImageContent(
      session.state, place.id!, 'imgblob_new', 'image/png', 10, 10, new Uint8Array([3]));
    session = commitEntry(session, se!);
    const img = session.state.images![0];
    expect(img.imageId).toBe('imgblob_new');
    expect(img.originalImageId).toBeUndefined();
  });

  test('undo restores the original pixels and framing', () => {
    let { session, id } = withImage();
    session = commitEntry(session, buildReplaceImageContent(
      session.state, id, 'imgblob_new', 'image/jpeg', 20, 20, new Uint8Array([9]))!);
    session = undo(session);
    const img = session.state.images![0];
    expect(img.imageId).toBe('imgblob_old');
    expect(img.pixelWidth).toBe(40);
    expect(img.cellWidth).toBeCloseTo(8);
    // …and the framing the image was BORN with (plain cover — every image
    // starts scale-to-fill now) comes back with it.
    expect(img.framing).toEqual({ mode: 'fill', zoom: 1 });
  });

  test('rejects a locked target and a non-image id', () => {
    const { session, id } = withImage();
    const locked = commit(session, buildToggleLock(session.state, id)!.entry);
    expect(buildReplaceImageContent(
      locked.state, id, 'x', 'image/png', 10, 10, new Uint8Array())).toBeNull();
    expect(buildReplaceImageContent(
      session.state, 'img_nope', 'x', 'image/png', 10, 10, new Uint8Array())).toBeNull();
  });
});

describe('crop pan (buildPanImageFraming / withPannedFraming)', () => {
  // A 2:1 landscape bitmap in an 8×8 square frame, Fill @ zoom 1 — the
  // framing every image is now BORN with (COVER_FRAMING): cover is 16×8,
  // so 8 cells of width overflow → pan range ±4 cells; no height slack.
  function withFramedImage() {
    let session = createEditorSession(makeBlankComposition('c1'));
    const place = buildPlaceImage('blob_1', 'image/jpeg', 40, 20,
      { cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8 }, new Uint8Array([1]));
    session = commitEntry(session, place);
    return { session, id: place.id! };
  }

  test('adds the delta to the offset on the loose axis, pins the tight axis', () => {
    const { session, id } = withFramedImage();
    const se = buildPanImageFraming(session.state, id, 2, 3);
    expect(se).not.toBeNull();
    const next = commitEntry(session, se!);
    const img = next.state.images![0];
    expect(img.framing).toMatchObject({ mode: 'fill', zoom: 1, offsetX: 2 });
    expect(img.framing!.offsetY).toBeUndefined(); // tight axis pinned → stays clean
  });

  test('clamps the pan to the frame edge so no gap is exposed', () => {
    const { session, id } = withFramedImage();
    const next = commitEntry(session, buildPanImageFraming(session.state, id, 999, 0)!);
    expect(next.state.images![0].framing!.offsetX).toBeCloseTo(4, 6); // half of 8-cell overflow
  });

  test('a second pan accumulates from the committed offset', () => {
    const { session, id } = withFramedImage();
    let next = commitEntry(session, buildPanImageFraming(session.state, id, 1.5, 0)!);
    next = commitEntry(next, buildPanImageFraming(next.state, id, 1, 0)!);
    expect(next.state.images![0].framing!.offsetX).toBeCloseTo(2.5, 6);
  });

  test('withPannedFraming previews the same offset without an undo entry', () => {
    const { session, id } = withFramedImage();
    const preview = withPannedFraming(session.state, id, 2, 0);
    expect(preview.images![0].framing).toMatchObject({ offsetX: 2 });
    expect(preview.images![0].framing!.offsetY).toBeUndefined();
  });

  test('a zero-length pan commits nothing (tap / cancel rollback)', () => {
    const { session, id } = withFramedImage();
    expect(buildPanImageFraming(session.state, id, 0, 0)).toBeNull();
  });

  test('rejects a locked target and a non-image id', () => {
    const { session, id } = withFramedImage();
    const locked = commit(session, buildToggleLock(session.state, id)!.entry);
    expect(buildPanImageFraming(locked.state, id, 2, 0)).toBeNull();
    expect(buildPanImageFraming(session.state, 'img_nope', 2, 0)).toBeNull();
  });
});

describe('crop zoom (buildZoomImageFraming / withZoomedFraming)', () => {
  function withFramedImage(framing: { mode: 'fill'; zoom: number; offsetX?: number; offsetY?: number }) {
    let session = createEditorSession(makeBlankComposition('c1'));
    const place = buildPlaceImage('blob_1', 'image/jpeg', 40, 20,
      { cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8 }, new Uint8Array([1]));
    session = commitEntry(session, place);
    // The birth framing is already Fill @ zoom 1 (COVER_FRAMING); only a
    // DIFFERENT ask builds an entry.
    const se = buildSetImageFraming(session.state, place.id!, framing);
    if (se) session = commitEntry(session, se);
    return { session, id: place.id! };
  }

  test('scales the zoom by the pinch factor', () => {
    const { session, id } = withFramedImage({ mode: 'fill', zoom: 1 });
    const next = commitEntry(session, buildZoomImageFraming(session.state, id, 1.5)!);
    expect(next.state.images![0].framing!.zoom).toBeCloseTo(1.5, 6);
  });

  test('clamps zoom to [1, 3]', () => {
    const zoomedIn = withFramedImage({ mode: 'fill', zoom: 2 });
    expect(commitEntry(zoomedIn.session, buildZoomImageFraming(zoomedIn.session.state, zoomedIn.id, 5)!)
      .state.images![0].framing!.zoom).toBeCloseTo(3, 6);
    const zoomedOut = withFramedImage({ mode: 'fill', zoom: 2 });
    expect(commitEntry(zoomedOut.session, buildZoomImageFraming(zoomedOut.session.state, zoomedOut.id, 0.1)!)
      .state.images![0].framing!.zoom).toBeCloseTo(1, 6);
  });

  test('a zoom-out re-clamps the pan offset to the smaller range', () => {
    // 2:1 bitmap in 8×8, zoom 2 → cover 32×16, width overflow 24 → range ±12,
    // so offsetX 10 is valid. Zooming back to ~1 shrinks the range to ±4.
    const { session, id } = withFramedImage({ mode: 'fill', zoom: 2, offsetX: 10 });
    const next = commitEntry(session, buildZoomImageFraming(session.state, id, 0.5)!); // → zoom 1
    const img = next.state.images![0];
    expect(img.framing!.zoom).toBeCloseTo(1, 6);
    expect(img.framing!.offsetX).toBeCloseTo(4, 6); // clamped from 10 to the new ±4
  });

  test('withZoomedFraming previews the scaled zoom without an undo entry', () => {
    const { session, id } = withFramedImage({ mode: 'fill', zoom: 1 });
    expect(withZoomedFraming(session.state, id, 2).images![0].framing!.zoom).toBeCloseTo(2, 6);
  });

  test('an unmoved pinch (factor 1) commits nothing', () => {
    const { session, id } = withFramedImage({ mode: 'fill', zoom: 1.3 });
    expect(buildZoomImageFraming(session.state, id, 1)).toBeNull();
  });

  test('rejects a locked target and a non-image id', () => {
    const { session, id } = withFramedImage({ mode: 'fill', zoom: 1 });
    const locked = commit(session, buildToggleLock(session.state, id)!.entry);
    expect(buildZoomImageFraming(locked.state, id, 1.5)).toBeNull();
    expect(buildZoomImageFraming(session.state, 'img_nope', 1.5)).toBeNull();
  });
});

describe('image corner radius', () => {
  function withImage(cornerRadius?: number) {
    let session = createEditorSession(makeBlankComposition('c1'));
    const place = buildPlaceImage('imgblob_1', 'image/png', 40, 30,
      { cellX: 2, cellY: 2, cellWidth: 8, cellHeight: 6 }, new Uint8Array([1]));
    session = commitEntry(session, place);
    if (cornerRadius !== undefined) {
      session = commitEntry(session, buildSetImageCornerRadius(session.state, place.id!, cornerRadius)!);
    }
    return { session, id: place.id! };
  }

  test('withImageCornerRadius sets, clamps to 0.5, and clears at 0 (no undo)', () => {
    const { session, id } = withImage();
    expect(withImageCornerRadius(session.state, id, 0.3).images![0].cornerRadius).toBe(0.3);
    expect(withImageCornerRadius(session.state, id, 5).images![0].cornerRadius).toBe(0.5); // clamped
    expect(withImageCornerRadius(session.state, id, -1).images![0].cornerRadius).toBeUndefined();
    expect(withImageCornerRadius(session.state, id, 0).images![0].cornerRadius).toBeUndefined();
  });

  test('buildSetImageCornerRadius commits one undoable step', () => {
    let { session, id } = withImage();
    const img = () => session.state.images![0];
    session = commitEntry(session, buildSetImageCornerRadius(session.state, id, 0.25)!);
    expect(img().cornerRadius).toBe(0.25);
    session = undo(session);
    expect(img().cornerRadius).toBeUndefined();
    session = redo(session);
    expect(img().cornerRadius).toBe(0.25);
  });

  test('an unchanged radius commits nothing (null)', () => {
    const { session, id } = withImage(0.2);
    expect(buildSetImageCornerRadius(session.state, id, 0.2)).toBeNull();
    // Within the 1e-4 epsilon still counts as unchanged.
    expect(buildSetImageCornerRadius(session.state, id, 0.20005)).toBeNull();
  });

  test('rejects a locked target and a non-image id', () => {
    const { session, id } = withImage();
    const locked = commit(session, buildToggleLock(session.state, id)!.entry);
    expect(buildSetImageCornerRadius(locked.state, id, 0.3)).toBeNull();
    expect(buildSetImageCornerRadius(session.state, 'img_nope', 0.3)).toBeNull();
  });
});

describe('image gradient tint (Tint bar)', () => {
  const TINT = {
    type: 'linear' as const,
    solid: { r: 18, g: 48, b: 71 },
    stops: [
      { offset: 0, color: { r: 46, g: 26, b: 61 } },
      { offset: 1, color: { r: 255, g: 159, b: 10 } },
    ],
    angle: 90, opacity: 0.7, blend: 'multiply' as const,
  };
  function withImage() {
    let session = createEditorSession(makeBlankComposition('c1'));
    const place = buildPlaceImage('imgblob_1', 'image/png', 40, 30,
      { cellX: 2, cellY: 2, cellWidth: 8, cellHeight: 6 }, new Uint8Array([1]));
    session = commitEntry(session, place);
    return { session, id: place.id! };
  }

  test('withImageTintFill sets the overlay and clears on null (no undo)', () => {
    const { session, id } = withImage();
    expect(withImageTintFill(session.state, id, TINT).images![0].tintFill).toEqual(TINT);
    const set = withImageTintFill(session.state, id, TINT);
    expect(withImageTintFill(set, id, null).images![0].tintFill).toBeUndefined();
  });

  test('buildSetImageTintFill commits one undoable step', () => {
    let { session, id } = withImage();
    const img = () => session.state.images![0];
    session = commitEntry(session, buildSetImageTintFill(session.state, id, TINT)!);
    expect(img().tintFill).toEqual(TINT);
    session = undo(session);
    expect(img().tintFill).toBeUndefined();
    session = redo(session);
    expect(img().tintFill!.blend).toBe('multiply');
  });

  test('an unchanged tint commits nothing (null)', () => {
    let { session, id } = withImage();
    session = commitEntry(session, buildSetImageTintFill(session.state, id, TINT)!);
    expect(buildSetImageTintFill(session.state, id, TINT)).toBeNull();
  });

  test('rejects a locked target and a non-image id', () => {
    const { session, id } = withImage();
    const locked = commit(session, buildToggleLock(session.state, id)!.entry);
    expect(buildSetImageTintFill(locked.state, id, TINT)).toBeNull();
    expect(buildSetImageTintFill(session.state, 'img_nope', TINT)).toBeNull();
  });
});

describe('buildToggleLock', () => {
  test('locks, then unlocks through commit (lock-guard exempt), and undoes', () => {
    let { session, id } = sessionWithShape();

    const lock = buildToggleLock(session.state, id);
    session = commit(session, lock!.entry);
    expect(session.state.svgObjects[0].locked).toBe(true);
    // Locked node now rejects edits...
    expect(buildMoveNode(session.state, id, 1, 0)).toBeNull();

    // ...but the unlock op itself must not be blocked by the guard.
    const unlock = buildToggleLock(session.state, id);
    expect(unlock!.entry[0]).toMatchObject({ op: 'lockObject', oldValue: true, newValue: false });
    const unlocked = commit(session, unlock!.entry);
    expect(unlocked).not.toBe(session);
    expect(unlocked.state.svgObjects[0].locked ?? false).toBe(false);

    // Undo restores the locked state.
    const undone = undo(unlocked);
    expect(undone.state.svgObjects[0].locked).toBe(true);
  });

  test('unknown id → null', () => {
    const { session } = sessionWithShape();
    expect(buildToggleLock(session.state, 'svg_nope')).toBeNull();
  });
});

describe('text builders', () => {
  test('buildPlaceText sizes the bbox from the deterministic layout', () => {
    const se = buildPlaceText('hello\nworld', STYLE, 16, 16);
    const state = applyCompOps(makeBlankComposition('c1'), se.entry);
    const text = state.texts![0];
    const expected = measureTextBbox('hello\nworld', STYLE);
    expect(text.cellWidth).toBeCloseTo(expected.width, 9);
    expect(text.cellHeight).toBeCloseTo(expected.height, 9);
    // Centered on the requested point.
    expect(text.cellX + text.cellWidth / 2).toBeCloseTo(16, 9);
    expect(text.cellY + text.cellHeight / 2).toBeCloseTo(16, 9);
  });

  test('buildPlaceText with bbox takes the dragged box verbatim', () => {
    const bbox = { cellX: 3, cellY: 5, cellWidth: 10, cellHeight: 4 };
    // The center args are ignored when a bbox is given — pass junk to prove it.
    const se = buildPlaceText('hello world', STYLE, 99, 99, { bbox });
    const state = applyCompOps(makeBlankComposition('c1'), se.entry);
    const text = state.texts![0];
    expect(text.cellX).toBe(3);
    expect(text.cellY).toBe(5);
    expect(text.cellWidth).toBe(10);
    expect(text.cellHeight).toBe(4);
    expect(text.content).toBe('hello world');
  });

  test('buildSetTextContent re-measures the bbox and round-trips', () => {
    let session = createEditorSession(makeBlankComposition('c1'));
    const place = buildPlaceText('short', STYLE, 16, 16);
    session = commitEntry(session, place);
    const before = session.state.texts![0];

    const se = buildSetTextContent(session.state, place.id!, 'a much longer line of text');
    session = commit(session, se!.entry);
    const after = session.state.texts![0];
    const expected = measureTextBbox('a much longer line of text', STYLE);
    expect(after.content).toBe('a much longer line of text');
    expect(after.cellWidth).toBeCloseTo(expected.width, 9);
    expect(after.cellHeight).toBeCloseTo(expected.height, 9);

    const reverted = revertCompOps(session.state, se!.entry);
    expect(reverted.texts![0]).toEqual(before);
  });

  test('buildSetTextStyle swaps the style block and re-measures', () => {
    let session = createEditorSession(makeBlankComposition('c1'));
    const place = buildPlaceText('resize me', STYLE, 10, 10);
    session = commitEntry(session, place);
    const bigger: TextStyle = { ...STYLE, size: 4, bold: true };
    const se = buildSetTextStyle(session.state, place.id!, bigger);
    const applied = applyCompOps(session.state, se!.entry);
    const text = applied.texts![0];
    const expected = measureTextBbox('resize me', bigger);
    expect(text.style).toEqual(bigger);
    expect(text.cellWidth).toBeCloseTo(expected.width, 9);
    const back = revertCompOps(applied, se!.entry);
    expect(back.texts![0].style).toEqual(STYLE);
  });

  test('no-op content edits return null', () => {
    let session = createEditorSession(makeBlankComposition('c1'));
    const place = buildPlaceText('same', STYLE, 0, 0);
    session = commitEntry(session, place);
    expect(buildSetTextContent(session.state, place.id!, 'same')).toBeNull();
    expect(buildSetTextContent(session.state, 'txt_missing', 'x')).toBeNull();
  });

  test('a corner resize fixes the box: later font/size/content edits keep it', () => {
    let session = createEditorSession(makeBlankComposition('c1'));
    const place = buildPlaceText('resize me', STYLE, 10, 10);
    session = commitEntry(session, place);
    const placed = session.state.texts![0];
    expect(placed.fixedSize).toBeUndefined(); // click-to-place starts auto

    // Corner-resize the box to double its height — the user authoring the
    // box, which is the moment the node leaves auto-size (Figma's rule).
    const taller = {
      cellX: placed.cellX, cellY: placed.cellY,
      cellWidth: placed.cellWidth, cellHeight: placed.cellHeight * 2,
    };
    session = commit(session, buildResizeNode(session.state, place.id!, taller)!.entry);
    const resized = session.state.texts![0];
    expect(resized.fixedSize).toBe(true);
    expect(resized.cellHeight).toBeCloseTo(placed.cellHeight * 2, 9);

    // From here on, style edits — even ones that change metrics — keep the
    // user's box; the renderer reflows the type within it.
    const bigger: TextStyle = { ...STYLE, size: 8 };
    const styled = applyCompOps(session.state, buildSetTextStyle(session.state, place.id!, bigger)!.entry);
    expect(styled.texts![0].cellWidth).toBeCloseTo(resized.cellWidth, 9);
    expect(styled.texts![0].cellHeight).toBeCloseTo(resized.cellHeight, 9);

    // Content edits keep it too.
    const edited = applyCompOps(session.state, buildSetTextContent(session.state, place.id!, 'a whole new much longer line')!.entry);
    expect(edited.texts![0].cellWidth).toBeCloseTo(resized.cellWidth, 9);
    expect(edited.texts![0].cellHeight).toBeCloseTo(resized.cellHeight, 9);

    // Undoing the resize restores auto-size.
    session = undo(session);
    expect(session.state.texts![0].fixedSize).toBeUndefined();
  });

  test('alignment (and color) changes never move the box, fixed or auto', () => {
    let session = createEditorSession(makeBlankComposition('c1'));
    const place = buildPlaceText('align me', STYLE, 10, 10);
    session = commitEntry(session, place);
    const before = session.state.texts![0];

    for (const style of [
      { ...STYLE, align: 'center' as const },
      { ...STYLE, align: 'right' as const },
      { ...STYLE, vAlign: 'bottom' as const },
      { ...STYLE, color: RED },
    ]) {
      const after = applyCompOps(session.state, buildSetTextStyle(session.state, place.id!, style)!.entry);
      expect(after.texts![0].cellX).toBe(before.cellX);
      expect(after.texts![0].cellY).toBe(before.cellY);
      expect(after.texts![0].cellWidth).toBe(before.cellWidth);
      expect(after.texts![0].cellHeight).toBe(before.cellHeight);
    }
  });

  test('auto-size re-measures track the font through the layout measurer', () => {
    let session = createEditorSession(makeBlankComposition('c1'));
    // A font-aware measurer: font 'wide' advances double what 'system' does
    // (stand-in for the app's canvas measurer, which is font-keyed the same way).
    const measurer = { advance: (_ch: string, s: TextStyle) => (s.fontId === 'wide' ? 1.2 : 0.6) };
    const place = buildPlaceText('aaaa', STYLE, 10, 10, { layout: { measurer } });
    session = commitEntry(session, place);
    const before = session.state.texts![0];

    const after = applyCompOps(session.state,
      buildSetTextStyle(session.state, place.id!, { ...STYLE, fontId: 'wide' }, { measurer })!.entry);
    expect(after.texts![0].cellWidth).toBeCloseTo(before.cellWidth * 2, 9);
  });

  test('auto-size growth anchors by alignment (Figma): center grows both ways, right grows left', () => {
    let session = createEditorSession(makeBlankComposition('c1'));
    const centered: TextStyle = { ...STYLE, align: 'center' };
    const place = buildPlaceText('aa', centered, 10, 10);
    session = commitEntry(session, place);
    const before = session.state.texts![0];
    const cx = before.cellX + before.cellWidth / 2;

    // Center-aligned: the box center stays put through a content change.
    const grown = applyCompOps(session.state, buildSetTextContent(session.state, place.id!, 'aaaaaa')!.entry);
    const g = grown.texts![0];
    expect(g.cellWidth).toBeGreaterThan(before.cellWidth);
    expect(g.cellX + g.cellWidth / 2).toBeCloseTo(cx, 9);

    // Right-aligned: the right edge stays put.
    const rightStyle: TextStyle = { ...STYLE, align: 'right' };
    session = commit(session, buildSetTextStyle(session.state, place.id!, rightStyle)!.entry);
    const beforeR = session.state.texts![0];
    const rightEdge = beforeR.cellX + beforeR.cellWidth;
    const grownR = applyCompOps(session.state, buildSetTextContent(session.state, place.id!, 'aaaaaaaaaa')!.entry);
    const r = grownR.texts![0];
    expect(r.cellX + r.cellWidth).toBeCloseTo(rightEdge, 9);
  });

  test('a pinch scale keeps auto-size (box and type scale together)', () => {
    let session = createEditorSession(makeBlankComposition('c1'));
    const place = buildPlaceText('pinch me', STYLE, 10, 10);
    session = commitEntry(session, place);
    session = commit(session, buildScaleNode(session.state, place.id!, 2)!.entry);
    const scaled = session.state.texts![0];
    expect(scaled.fixedSize).toBeUndefined();
    expect(scaled.style.size).toBeCloseTo(STYLE.size * 2, 9);
    // Still auto: a content edit re-hugs the (scaled) type.
    const edited = applyCompOps(session.state, buildSetTextContent(session.state, place.id!, 'pinch')!.entry);
    expect(edited.texts![0].cellWidth).toBeCloseTo(measureTextBbox('pinch', scaled.style).width, 9);
  });

  test('drag-to-place starts fixed-size: the dragged box survives edits', () => {
    let session = createEditorSession(makeBlankComposition('c1'));
    const bbox = { cellX: 3, cellY: 5, cellWidth: 10, cellHeight: 4 };
    const place = buildPlaceText('boxed text', STYLE, 99, 99, { bbox });
    session = commitEntry(session, place);
    expect(session.state.texts![0].fixedSize).toBe(true);

    const edited = applyCompOps(session.state, buildSetTextContent(session.state, place.id!, 'boxed text grew a lot longer')!.entry);
    expect(edited.texts![0]).toMatchObject(bbox);
  });
});

describe('polyline builder', () => {
  test('filterPolylinePoints thins the trail but keeps endpoints', () => {
    const pts: [number, number][] = [[0, 0], [0.05, 0], [0.3, 0], [0.31, 0], [1, 1]];
    const filtered = filterPolylinePoints(pts, 0.25);
    expect(filtered[0]).toEqual([0, 0]);
    expect(filtered[filtered.length - 1]).toEqual([1, 1]);
    expect(filtered.length).toBeLessThan(pts.length);
  });

  test('buildPlacePolyline creates a non-closed svg with a tight bbox', () => {
    const se = buildPlacePolyline([[2, 3], [6, 3], [6, 9]], RED);
    const state = applyCompOps(makeBlankComposition('c1'), se!.entry);
    const svg = state.svgObjects[0];
    expect(svg.segments).toHaveLength(2);
    expect(svg.cellX).toBe(2);
    expect(svg.cellY).toBe(3);
    expect(svg.cellWidth).toBe(4);
    expect(svg.cellHeight).toBe(6);
    // Non-closed: first start !== last end.
    expect(svg.segments[0].start).toEqual([2, 3]);
    expect(svg.segments[1].end).toEqual([6, 9]);
    expect(buildPlacePolyline([[1, 1]], RED)).toBeNull();
  });
});

describe('image placement + blob handling', () => {
  const BYTES = new Uint8Array([1, 2, 3, 4]);
  const CELL = { cellX: 8, cellY: 8, cellWidth: 8, cellHeight: 6 };

  test('commit merges blobs into imageBlobs alongside the node', () => {
    let session = createEditorSession(makeBlankComposition('c1'));
    const se = buildPlaceImage('imgblob_a', 'image/png', 640, 480, CELL, BYTES);
    session = commitEntry(session, se);
    const image = session.state.images![0];
    expect(image.id).toMatch(/^img_/);
    expect(image.imageId).toBe('imgblob_a');
    expect(image.pixelWidth).toBe(640);
    expect(session.state.imageBlobs!.imgblob_a).toBe(BYTES);
    expect(session.state.sceneOrder).toEqual([image.id]);
  });

  test('undo removes the node but keeps bytes for redo', () => {
    let session = createEditorSession(makeBlankComposition('c1'));
    session = commitEntry(session, buildPlaceImage('imgblob_b', 'image/jpeg', 100, 100, CELL, BYTES));
    session = undo(session);
    expect(session.state.images).toHaveLength(0);
    // Orphaned bytes are intentional: persistence only writes blobs
    // referenced by state.images, and redo needs the bytes back.
    expect(session.state.imageBlobs!.imgblob_b).toBe(BYTES);
    session = redo(session);
    expect(session.state.images).toHaveLength(1);
    expect(session.state.imageBlobs!.imgblob_b).toBe(BYTES);
  });

  test('buildPlacePhotoPlaceholder drops a tap-to-fill placeholder in the box', () => {
    let session = createEditorSession(makeBlankComposition('c1'));
    const se = buildPlacePhotoPlaceholder(CELL, PLACEHOLDER);
    session = commitEntry(session, se);
    const image = session.state.images![0];
    // The dragged box verbatim.
    expect(image).toMatchObject(CELL);
    // The sentinel imageId is what routes a tap on it into the replace
    // picker (the drag-to-place fallback when the drag-release couldn't
    // open the file dialog itself).
    expect(image.imageId).toBe(PLACEHOLDER.imageId);
    expect(image.mimeType).toBe(PLACEHOLDER.mime);
    // No blob rides along: the un-filled placeholder resolves to an empty src
    // so the canvas draws the "no image" mountain instead of a bundled bitmap.
    expect(session.state.imageBlobs?.[PLACEHOLDER.imageId]).toBeUndefined();
  });
});

describe('move', () => {
  test('buildMoveNode round-trips through apply/revert', () => {
    const { session, id } = sessionWithShape();
    const before = session.state.svgObjects[0];
    const se = buildMoveNode(session.state, id, 3, -2);
    const moved = applyCompOps(session.state, se!.entry);
    expect(moved.svgObjects[0].cellX).toBeCloseTo(before.cellX + 3, 9);
    expect(moved.svgObjects[0].cellY).toBeCloseTo(before.cellY - 2, 9);
    const back = revertCompOps(moved, se!.entry);
    expect(back.svgObjects[0].cellX).toBeCloseTo(before.cellX, 9);
    expect(back.svgObjects[0].segments).toEqual(before.segments);
    expect(buildMoveNode(session.state, id, 0, 0)).toBeNull();
    expect(buildMoveNode(session.state, 'nope', 1, 1)).toBeNull();
  });
});

describe('remove + reorder', () => {
  test('buildRemoveSelected round-trips and restores z-position', () => {
    let session = createEditorSession(makeBlankComposition('c1'));
    const a = buildPlaceShape('rect', { cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 }, INK);
    const b = buildPlaceShape('rect', { cellX: 2, cellY: 2, cellWidth: 4, cellHeight: 4 }, RED);
    session = commitEntry(session, a);
    session = commitEntry(session, b);
    const se = buildRemoveSelected(session.state, a.id!);
    const removed = applyCompOps(session.state, se!.entry);
    expect(removed.svgObjects.map((s) => s.id)).toEqual([b.id]);
    const back = revertCompOps(removed, se!.entry);
    expect(back.sceneOrder).toEqual([a.id, b.id]); // original z restored
  });

  test('buildReorder front/back swaps sceneOrder and round-trips', () => {
    let session = createEditorSession(makeBlankComposition('c1'));
    const a = buildPlaceShape('rect', { cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 }, INK);
    const b = buildPlaceShape('rect', { cellX: 2, cellY: 2, cellWidth: 4, cellHeight: 4 }, RED);
    session = commitEntry(session, a);
    session = commitEntry(session, b);
    expect(session.state.sceneOrder).toEqual([a.id, b.id]);

    const toFront = buildReorder(session.state, a.id!, 'front');
    const fronted = applyCompOps(session.state, toFront!.entry);
    expect(fronted.sceneOrder).toEqual([b.id, a.id]);
    expect(revertCompOps(fronted, toFront!.entry).sceneOrder).toEqual([a.id, b.id]);

    const toBack = buildReorder(fronted, a.id!, 'back');
    expect(applyCompOps(fronted, toBack!.entry).sceneOrder).toEqual([a.id, b.id]);

    // Already at the front → no-op.
    expect(buildReorder(fronted, a.id!, 'front')).toBeNull();
  });

  // The radial quick menu's two z-order buttons commit through the multi
  // form; buildReorder is the one-id case of it.
  test('buildReorderSelection moves a whole multi-selection together', () => {
    let session = createEditorSession(makeBlankComposition('c1'));
    const a = buildPlaceShape('rect', { cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 }, INK);
    const b = buildPlaceShape('rect', { cellX: 2, cellY: 2, cellWidth: 4, cellHeight: 4 }, RED);
    const c = buildPlaceShape('rect', { cellX: 4, cellY: 4, cellWidth: 4, cellHeight: 4 }, INK);
    session = commitEntry(session, a);
    session = commitEntry(session, b);
    session = commitEntry(session, c);
    expect(session.state.sceneOrder).toEqual([a.id, b.id, c.id]);

    // The two outer objects go to the front, keeping their order relative
    // to each other, and b is left behind them.
    const se = buildReorderSelection(session.state, [a.id!, c.id!], 'front');
    const fronted = applyCompOps(session.state, se!.entry);
    expect(fronted.sceneOrder).toEqual([b.id, a.id, c.id]);
    expect(revertCompOps(fronted, se!.entry).sceneOrder).toEqual([a.id, b.id, c.id]);

    const toBack = buildReorderSelection(fronted, [a.id!, c.id!], 'back');
    expect(applyCompOps(fronted, toBack!.entry).sceneOrder).toEqual([a.id, c.id, b.id]);

    // Nothing selected, or nothing to move: no entry.
    expect(buildReorderSelection(session.state, [], 'front')).toBeNull();
    expect(buildReorderSelection(fronted, [a.id!, c.id!], 'front')).toBeNull();
  });

  test('buildReorderSelection moves a whole GROUP within its container, not its members within the group', () => {
    // A tap on a grouped object selects every member, so the radial's Front
    // / Back arrive with the group's members. Moved as members, the scope
    // is the group itself and they already fill it: nothing happened. The
    // group is what moves, past the loose object beside it.
    let session = createEditorSession(makeBlankComposition('c1'));
    const a = buildPlaceShape('rect', { cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 }, INK);
    const b = buildPlaceShape('rect', { cellX: 2, cellY: 2, cellWidth: 4, cellHeight: 4 }, RED);
    const c = buildPlaceShape('rect', { cellX: 4, cellY: 4, cellWidth: 4, cellHeight: 4 }, INK);
    session = commitEntry(session, a);
    session = commitEntry(session, b);
    session = commitEntry(session, c);
    session = commitEntry(session, buildGroupSelectedMulti(session.state, [a.id!, b.id!])!);
    expect(session.state.sceneOrder).toEqual([a.id, b.id, c.id]);

    const se = buildReorderSelection(session.state, [a.id!, b.id!], 'front');
    expect(se).not.toBeNull();
    const fronted = applyCompOps(session.state, se!.entry);
    expect(fronted.sceneOrder).toEqual([c.id, a.id, b.id]);
    expect(revertCompOps(fronted, se!.entry).sceneOrder).toEqual([a.id, b.id, c.id]);

    const toBack = buildReorderSelection(fronted, [a.id!, b.id!], 'back');
    expect(applyCompOps(fronted, toBack!.entry).sceneOrder).toEqual([a.id, b.id, c.id]);
    // At the front already: no entry.
    expect(buildReorderSelection(fronted, [a.id!, b.id!], 'front')).toBeNull();
    // Part of a group (not the whole) still moves within the group.
    const inner = buildReorderSelection(session.state, [a.id!], 'front');
    expect(applyCompOps(session.state, inner!.entry).sceneOrder).toEqual([b.id, a.id, c.id]);
  });
});

describe('rotate / mirror', () => {
  test('svg rotate: 4×90° returns exactly to the original', () => {
    let session = createEditorSession(makeBlankComposition('c1'));
    const se = buildPlaceShape('banner', { cellX: 4, cellY: 6, cellWidth: 10, cellHeight: 4 }, INK);
    session = commitEntry(session, se);
    const original = session.state.svgObjects[0];

    let state = session.state;
    const entries = [];
    for (let i = 0; i < 4; i++) {
      const rot = buildRotateSelected(state, se.id!);
      entries.push(rot!.entry);
      state = applyCompOps(state, rot!.entry);
    }
    const final = state.svgObjects[0];
    expect(final.rotation ?? 0).toBe(0);
    expect(final.cellX).toBeCloseTo(original.cellX, 6);
    expect(final.cellY).toBeCloseTo(original.cellY, 6);
    expect(final.cellWidth).toBeCloseTo(original.cellWidth, 6);
    expect(final.cellHeight).toBeCloseTo(original.cellHeight, 6);

    // Undo the whole cycle in reverse restores the original object.
    for (let i = entries.length - 1; i >= 0; i--) state = revertCompOps(state, entries[i]);
    expect(state.svgObjects[0].segments).toEqual(original.segments);
    expect(state.svgObjects[0].rotation).toBe(original.rotation);
  });

  test('svg single rotate swaps the bbox and revert restores it', () => {
    let session = createEditorSession(makeBlankComposition('c1'));
    const se = buildPlaceShape('rect', { cellX: 4, cellY: 6, cellWidth: 10, cellHeight: 4 }, INK);
    session = commitEntry(session, se);
    const before = session.state.svgObjects[0];
    const rot = buildRotateSelected(session.state, se.id!);
    const rotated = applyCompOps(session.state, rot!.entry);
    // Drawn a quarter turn round: the footprint swaps, about the same centre.
    expect(turnOf(rotated, se.id!)).toBeCloseTo(90);
    const footprint = drawnAabb(rotated, se.id!);
    expect(footprint.cellWidth).toBeCloseTo(before.cellHeight, 6);
    expect(footprint.cellHeight).toBeCloseTo(before.cellWidth, 6);
    expect(footprint.cellX + footprint.cellWidth / 2).toBeCloseTo(before.cellX + before.cellWidth / 2, 6);
    const back = revertCompOps(rotated, rot!.entry);
    expectSegmentsClose(drawnSegments(back, se.id!), before.segments);
    expect(turnOf(back, se.id!)).toBe(0);
  });

  test('svg mirror twice returns to identity', () => {
    let session = createEditorSession(makeBlankComposition('c1'));
    const se = buildPlaceShape('speechBubble', { cellX: 2, cellY: 2, cellWidth: 8, cellHeight: 8 }, INK);
    session = commitEntry(session, se);
    const original = session.state.svgObjects[0];
    let state = session.state;
    const mirrorX = original.cellX + original.cellWidth / 2;
    const m1 = buildMirrorSelected(state, se.id!, 'h');
    state = applyCompOps(state, m1!.entry);
    // Drawn as the mirror image about its own centre line…
    expectSegmentsClose(drawnSegments(state, se.id!), original.segments, (p) => [2 * mirrorX - p[0], p[1]]);
    const m2 = buildMirrorSelected(state, se.id!, 'h');
    state = applyCompOps(state, m2!.entry);
    // …and back.
    expectSegmentsClose(drawnSegments(state, se.id!), original.segments);
  });

  test('image rotate swaps bbox around center; 4× cycle is exact; revert works', () => {
    let session = createEditorSession(makeBlankComposition('c1'));
    const CELL = { cellX: 8, cellY: 4, cellWidth: 12, cellHeight: 6 };
    const se = buildPlaceImage('imgblob_r', 'image/png', 400, 200, CELL, new Uint8Array([9]));
    session = commitEntry(session, se);
    const before = session.state.images![0];

    const rot = buildRotateSelected(session.state, se.id!);
    const rotated = applyCompOps(session.state, rot!.entry);
    // Drawn a quarter round: the footprint swaps, about the same centre.
    expect(turnOf(rotated, se.id!)).toBeCloseTo(90);
    const img = drawnAabb(rotated, se.id!);
    expect(img.cellWidth).toBeCloseTo(CELL.cellHeight, 9);
    expect(img.cellHeight).toBeCloseTo(CELL.cellWidth, 9);
    expect(img.cellX + img.cellWidth / 2).toBeCloseTo(CELL.cellX + CELL.cellWidth / 2, 9);
    expect(img.cellY + img.cellHeight / 2).toBeCloseTo(CELL.cellY + CELL.cellHeight / 2, 9);

    const back = revertCompOps(rotated, rot!.entry);
    expect(back.images![0]).toEqual(before);

    let state = rotated;
    for (let i = 0; i < 3; i++) {
      state = applyCompOps(state, buildRotateSelected(state, se.id!)!.entry);
    }
    const cycled = state.images![0];
    expect(turnOf(state, se.id!)).toBe(0);
    expect(cycled.cellX).toBeCloseTo(CELL.cellX, 9);
    expect(cycled.cellWidth).toBeCloseTo(CELL.cellWidth, 9);
    expect(cycled.identityCellX).toBeUndefined();
  });

  test('image mirror composes with rotation via the screen axis', () => {
    let session = createEditorSession(makeBlankComposition('c1'));
    const CELL = { cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2 };
    const se = buildPlaceImage('imgblob_m', 'image/png', 40, 20, CELL, new Uint8Array([1]));
    session = commitEntry(session, se);
    // Rotate once, then mirror on screen 'h' — with 90° rotation the local
    // flip axis is 'v'.
    let state = applyCompOps(session.state, buildRotateSelected(session.state, se.id!)!.entry);
    state = applyCompOps(state, buildMirrorSelected(state, se.id!, 'h')!.entry);
    // Drawn: one flip and a quarter turn. The legacy spelling was "90 and
    // a local vertical mirror"; the graph's keeps the flag the user pressed
    // and spells the same picture as a horizontal mirror plus its turn.
    expect(poseOf(state, se.id!)).toMatchObject({ turn: 90, flip: true });
    expect(state.images![0].mirrorH).toBe(true);
  });

  test('text rotate/mirror commit as one transform and round-trip', () => {
    let session = createEditorSession(makeBlankComposition('c1'));
    const place = buildPlaceText('spin me', STYLE, 16, 16);
    session = commitEntry(session, place);
    const before = session.state.texts![0];

    const rot = buildRotateSelected(session.state, place.id!);
    expect(rot!.entry[0].op).toBe('setTransform');
    const rotated = applyCompOps(session.state, rot!.entry);
    expect(turnOf(rotated, place.id!)).toBeCloseTo(90);
    const text = drawnAabb(rotated, place.id!);
    expect(text.cellWidth).toBeCloseTo(before.cellHeight, 9);
    expect(text.cellHeight).toBeCloseTo(before.cellWidth, 9);
    const back = revertCompOps(rotated, rot!.entry);
    expect(back.texts![0]).toEqual(before);

    const mir = buildMirrorSelected(rotated, place.id!, 'v');
    const mirrored = applyCompOps(rotated, mir!.entry);
    // A screen-vertical flip of a quarter-turned box: one flip, and the turn
    // reads the other way round (a reflection conjugates it) — the same
    // picture the legacy "90 plus a local horizontal mirror" spelled.
    expect(poseOf(mirrored, place.id!)).toMatchObject({ turn: 270, flip: true });
  });
});

describe('effects / paint / tint / background', () => {
  test('buildSetEffects round-trips', () => {
    const { session, id } = sessionWithShape();
    const effects = { shadow: { dx: 0.2, dy: 0.2, blur: 0.5, color: INK, alpha: 0.4 } };
    const se = buildSetEffects(session.state, id, effects);
    const applied = applyCompOps(session.state, se!.entry);
    expect(applied.svgObjects[0].effects).toEqual(effects);
    const cleared = buildSetEffects(applied, id, undefined);
    const off = applyCompOps(applied, cleared!.entry);
    expect(off.svgObjects[0].effects).toBeUndefined();
    expect(revertCompOps(off, cleared!.entry).svgObjects[0].effects).toEqual(effects);
  });

  test('buildSetFillPaint round-trips', () => {
    const { session, id } = sessionWithShape();
    const paint = { kind: 'solid' as const, color: RED };
    const se = buildSetFillPaint(session.state, id, paint);
    const applied = applyCompOps(session.state, se!.entry);
    expect(applied.svgObjects[0].fillPaint).toEqual(paint);
    expect(revertCompOps(applied, se!.entry).svgObjects[0].fillPaint).toBeUndefined();
    expect(buildSetFillPaint(session.state, 'missing', paint)).toBeNull();
  });

  test('buildSetBackground round-trips', () => {
    const session = createEditorSession(makeBlankComposition('c1'));
    const paint = {
      kind: 'linear' as const,
      stops: [{ offset: 0, color: INK }, { offset: 1, color: RED }],
      x1: 0, y1: 0, x2: 0, y2: 1,
    };
    const se = buildSetBackground(session.state, paint);
    const applied = applyCompOps(session.state, se.entry);
    expect(applied.background).toEqual(paint);
    expect(revertCompOps(applied, se.entry).background).toBeUndefined();
  });

  test('buildSetTint round-trips', () => {
    let session = createEditorSession(makeBlankComposition('c1'));
    const se = buildPlaceImage('imgblob_t', 'image/png', 10, 10,
      { cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 }, new Uint8Array([1]));
    session = commitEntry(session, se);
    const tint = { color: RED, amount: 0.8, mode: 'tint' as const };
    const st = buildSetTint(session.state, se.id!, tint);
    const applied = applyCompOps(session.state, st!.entry);
    expect(applied.images![0].tint).toEqual(tint);
    expect(revertCompOps(applied, st!.entry).images![0].tint).toBeUndefined();
  });

  test('buildRecolorSVG round-trips including subpath restore', () => {
    const { session, id } = sessionWithShape();
    const se = buildRecolorSVG(session.state, id, RED);
    const applied = applyCompOps(session.state, se!.entry);
    expect(applied.svgObjects[0].color).toEqual(RED);
    const back = revertCompOps(applied, se!.entry);
    expect(back.svgObjects[0].color).toEqual(INK);
  });
});

describe('scaleBboxAboutCenter', () => {
  const BOX = { cellX: 4, cellY: 4, cellWidth: 8, cellHeight: 6 };

  test('scales both axes about the box center', () => {
    expect(scaleBboxAboutCenter(BOX, 2)).toEqual({
      cellX: 0, cellY: 1, cellWidth: 16, cellHeight: 12,
    });
    // Center is invariant.
    const half = scaleBboxAboutCenter(BOX, 0.5);
    expect(half.cellX + half.cellWidth / 2).toBeCloseTo(8, 6);
    expect(half.cellY + half.cellHeight / 2).toBeCloseTo(7, 6);
  });

  test('floors each axis so a collapsing pinch cannot reach zero', () => {
    const tiny = scaleBboxAboutCenter(BOX, 0.0001);
    expect(tiny.cellWidth).toBeCloseTo(0.1, 6);
    expect(tiny.cellHeight).toBeCloseTo(0.1, 6);
  });

  test('is the box a pinch actually commits (HUD reads what lands)', () => {
    const { session, id } = sessionWithShape();
    const before = session.state.svgObjects.find(s => s.id === id)!;
    const predicted = scaleBboxAboutCenter(before, 1.5);
    const after = applyCompOps(session.state, buildScaleNode(session.state, id, 1.5)!.entry);
    const box = after.svgObjects.find(s => s.id === id)!;
    expect(box.cellX).toBeCloseTo(predicted.cellX, 6);
    expect(box.cellY).toBeCloseTo(predicted.cellY, 6);
    expect(box.cellWidth).toBeCloseTo(predicted.cellWidth, 6);
    expect(box.cellHeight).toBeCloseTo(predicted.cellHeight, 6);
  });
});

describe('word stickers (magnetic poetry)', () => {
  /** A session with one word sticker placed and selected. */
  function sessionWithSticker() {
    let session = createEditorSession(makeBlankComposition('c1'));
    const place = buildPlaceText('sun', STYLE, 10, 10, { sticker: true });
    session = commitEntry(session, place);
    return { session, id: place.id! };
  }

  test('buildToggleStickerInvert flips invert and round-trips', () => {
    const { session, id } = sessionWithSticker();
    expect(session.state.texts![0].invert).toBeUndefined();

    const on = buildToggleStickerInvert(session.state, id);
    const applied = applyCompOps(session.state, on!.entry);
    expect(applied.texts![0].invert).toBe(true);
    // Revert clears it back to the un-inverted sticker.
    expect(revertCompOps(applied, on!.entry).texts![0].invert).toBeUndefined();

    // Toggling again turns it off.
    const off = buildToggleStickerInvert(applied, id);
    expect(applyCompOps(applied, off!.entry).texts![0].invert).toBeUndefined();
  });

  test('buildToggleStickerInvert rejects non-sticker text and missing nodes', () => {
    let session = createEditorSession(makeBlankComposition('c1'));
    const plain = buildPlaceText('hello', STYLE, 5, 5); // not a sticker
    session = commitEntry(session, plain);
    expect(buildToggleStickerInvert(session.state, plain.id!)).toBeNull();
    expect(buildToggleStickerInvert(session.state, 'txt_missing')).toBeNull();
  });

  test('a sticker resizes as a WHOLE magnet — card and type together', () => {
    const { session, id } = sessionWithSticker();
    const box = session.state.texts![0];
    const bigger = {
      cellX: box.cellX, cellY: box.cellY,
      cellWidth: box.cellWidth * 2, cellHeight: box.cellHeight * 2,
    };
    // A corner drag would leave any other text's type alone and reflow it in
    // the new box (Figma's rule). A sticker's card IS its word plus a margin,
    // so the type goes with it, or the tile is a word rattling in a frame.
    const resized = applyCompOps(session.state, buildResizeNode(session.state, id, bigger)!.entry);
    expect(resized.texts![0].cellWidth).toBeCloseTo(box.cellWidth * 2, 6);
    expect(resized.texts![0].style.size).toBeCloseTo(box.style.size * 2, 6);
    const pinched = applyCompOps(session.state, buildScaleNode(session.state, id, 1.5)!.entry);
    expect(pinched.texts![0].cellWidth).toBeCloseTo(box.cellWidth * 1.5, 6);
    expect(pinched.texts![0].style.size).toBeCloseTo(box.style.size * 1.5, 6);
  });

  test('a sticker never stretches: the corner drag is aspect-locked', () => {
    // requiresUniformScale is what the gesture layer constrains the drag
    // with, and what resizeTarget re-applies as the backstop for every
    // other caller — so a box pulled wide alone lands square-ish, not as a
    // long thin card with small type adrift in it.
    const { session, id } = sessionWithSticker();
    const box = session.state.texts![0];
    expect(requiresUniformScale(session.state, id)).toBe(true);
    const stretched = applyCompOps(session.state, buildResizeNode(session.state, id, {
      cellX: box.cellX, cellY: box.cellY,
      cellWidth: box.cellWidth * 3, cellHeight: box.cellHeight,
    })!.entry).texts![0];
    expect(stretched.cellWidth / stretched.cellHeight)
      .toBeCloseTo(box.cellWidth / box.cellHeight, 6);
    // …and a PLAIN text is left free to be pulled into any shape it likes.
    const plain = buildPlaceText('hello', STYLE, 5, 5);
    const withPlain = commitEntry(session, plain);
    expect(requiresUniformScale(withPlain.state, plain.id!)).toBe(false);
  });

  test('a sticker IS still draggable and rotatable', () => {
    const { session, id } = sessionWithSticker();
    // Drag: moveNode commits.
    const moved = buildMoveNode(session.state, id, 3, -2);
    expect(moved).not.toBeNull();
    // Rotate: free rotation commits (angle recorded on the node).
    const rot = buildRotateNodeFree(session.state, id, 12);
    const applied = applyCompOps(session.state, rot!.entry);
    expect(applied.texts![0].angleDeg).toBeCloseTo(12, 6);
  });
});

describe('Group over a selection with locked members', () => {
  // Sol's rule, adopted at stage 3 (docs/shared-editor.md §4.3): a locked
  // member INSIDE a fully selected group goes with its group — the group
  // moves whole and the member's parent is untouched, so its lock has
  // nothing to refuse. Dropping it instead broke the group apart, lifting
  // the unlocked members out around it (a Sol seed's marker is locked by
  // design). A LOOSE locked member still sits out, and a group whose own
  // chain is locked still sits out whole.
  const rect = (x: number) => buildPlaceShape('rect', { cellX: x, cellY: 0, cellWidth: 4, cellHeight: 4 }, { r: 0, g: 0, b: 0 });
  const setup = () => {
    let s = createEditorSession(makeBlankComposition('grp-lock'));
    const [a, b, c] = [rect(0), rect(8), rect(16)];
    s = commitEntry(s, a); s = commitEntry(s, b); s = commitEntry(s, c);
    return { s, a: a.id!, b: b.id!, c: c.id! };
  };

  test('a locked member inside a fully selected group nests with its group, whole', () => {
    let { s, a, b, c } = setup();
    s = commitEntry(s, buildGroupSelectedMulti(s.state, [a, b])!);
    const inner = s.state.groups[0].id;
    s = commitEntry(s, buildToggleLock(s.state, b)!);
    expect(findItem(s.state, b)!.item.locked).toBe(true);
    const se = buildGroupSelectedMulti(s.state, [a, b, c], undefined)!;
    expect(se).not.toBeNull();
    const op = se.entry[0] as { op: string; figureIds: string[]; childGroupIds?: string[] };
    expect(op.op).toBe('groupFigures');
    // The inner group nests as a child, its locked member counted with the rest…
    expect(op.childGroupIds).toEqual([inner]);
    // …and only the loose shape is re-parented.
    expect(op.figureIds).toEqual([c]);
    const grouped = commitEntry(s, se);
    const outer = grouped.state.groups.find((g) => g.id !== inner)!;
    expect(grouped.state.groups.find((g) => g.id === inner)!.parentGroupId).toBe(outer.id);
    expect(findItem(grouped.state, b)!.item.groupId).toBe(inner);
    expect(findItem(grouped.state, b)!.item.locked).toBe(true);
  });

  test('a LOOSE locked member sits out, as it does for align and grid', () => {
    let { s, a, b, c } = setup();
    s = commitEntry(s, buildToggleLock(s.state, b)!);
    const se = buildGroupSelectedMulti(s.state, [a, b, c])!;
    const op = se.entry[0] as { figureIds: string[] };
    expect(op.figureIds).toEqual([a, c]);
    // Two locked loose members and one free: nothing to bind.
    const s2 = commitEntry(s, buildToggleLock(s.state, c)!);
    expect(buildGroupSelectedMulti(s2.state, [a, b, c])).toBeNull();
  });

  test('a group whose own chain is locked sits out whole', () => {
    let { s, a, b, c } = setup();
    s = commitEntry(s, buildGroupSelectedMulti(s.state, [a, b])!);
    const inner = s.state.groups[0].id;
    s = commitEntry(s, buildToggleLockGroup(s.state, inner)!);
    expect(s.state.groups[0].locked).toBe(true);
    // The locked group and one loose shape: one participant, nothing to bind.
    expect(buildGroupSelectedMulti(s.state, [a, b, c])).toBeNull();
    // …but with a second loose shape the two loose ones bind and the locked group is left alone.
    const d = rect(24);
    s = commitEntry(s, d);
    const se = buildGroupSelectedMulti(s.state, [a, b, c, d.id!])!;
    const op = se.entry[0] as { figureIds: string[]; childGroupIds?: string[] };
    expect(op.figureIds).toEqual([c, d.id]);
    expect(op.childGroupIds).toBeUndefined();
  });
});
