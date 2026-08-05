/**
 * Image scene-object adapter coverage. Verifies that ImageObject rides
 * the SCENE_ADAPTERS plumbing for the same generic operations the user
 * expected to get "for free": delete, duplicate, lock, send-to-back, and
 * undo via placeObject/removeObject.
 *
 * Plus a focused round-trip on the editImage op (apply → revert restores
 * the prior state byte-for-byte) since that's the single op carrying all
 * three of scale/rotate/mirror — a regression there silently corrupts
 * undo across every transform path.
 */

import {
  SCENE_ADAPTERS,
  findItem,
  buildRemoveObjectOp,
  reorderSceneObjects,
  captureSceneOrder,
  applySceneOrder,
  applyCompOps,
  revertCompOps,
  groupMemberIds,
  materializeGroupMembers,
} from '../compositionOps';
import {
  CompositionState,
  ImageObject,
  GroupNode,
  CompUndoEntry,
  makeViewport,
} from '../types';

function makeImage(id: string, overrides: Partial<ImageObject> = {}): ImageObject {
  return {
    id,
    imageId: 'blob_' + id,
    mimeType: 'image/png',
    pixelWidth: 1024,
    pixelHeight: 768,
    cellX: 0, cellY: 0,
    cellWidth: 8, cellHeight: 6,
    ...overrides,
  };
}

function makeState(parts: Partial<CompositionState> = {}): CompositionState {
  const figures = parts.figures ?? [];
  const svgObjects = parts.svgObjects ?? [];
  const images = parts.images ?? [];
  return {
    id: 'test',
    name: 'test',
    figures,
    svgObjects,
    images,
    imageBlobs: {},
    lineDraft: null,
    arcDraft: null,
    editingLineId: null,
    selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups: [],
    sceneOrder: [
      ...images.map((i) => i.id),
      ...figures.map((f) => f.id),
      ...svgObjects.map((s) => s.id),
    ],
    gridLevel: 0,
    strokeScale: 8,
    gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null,
    compTool: 'select',
    createRegion: null,
    renderGeneration: 0,
    ...parts,
  };
}

describe('image scene-object adapter', () => {
  test('SCENE_ADAPTERS includes image adapter with img_ namespace', () => {
    const adapter = SCENE_ADAPTERS.find((a) => a.kind === 'image')!;
    expect(adapter).toBeDefined();
    expect(adapter.matchesId('img_xyz')).toBe(true);
    expect(adapter.matchesId('1234')).toBe(false);
    expect(adapter.matchesId('svg_xyz')).toBe(false);
  });

  test('findItem resolves an image id to its kind', () => {
    const img = makeImage('img_a');
    const state = makeState({ images: [img] });
    const ref = findItem(state, 'img_a');
    expect(ref).not.toBeNull();
    expect(ref!.kind).toBe('image');
    expect(ref!.item).toBe(img);
  });

  test('buildRemoveObjectOp produces a removeObject op for an image', () => {
    const img = makeImage('img_a');
    const state = makeState({ images: [img] });
    const op = buildRemoveObjectOp(state, 'img_a');
    expect(op).not.toBeNull();
    expect(op!.kind).toBe('image');
    expect(op!.item.id).toBe('img_a');
  });

  test('cloneWithOffset retains imageId so duplicates share pixel bytes', () => {
    const adapter = SCENE_ADAPTERS.find((a) => a.kind === 'image')!;
    const img = makeImage('img_a');
    const cloned = adapter.cloneWithOffset(img, 5, 7, 'img_b', undefined) as ImageObject;
    expect(cloned.id).toBe('img_b');
    expect(cloned.imageId).toBe(img.imageId); // shared, not deep-cloned
    expect(cloned.cellX).toBe(5);
    expect(cloned.cellY).toBe(7);
  });

  test('reorderSceneObjects sends an image to the front of sceneOrder', () => {
    const a = makeImage('img_a');
    const b = makeImage('img_b');
    const c = makeImage('img_c');
    const state = makeState({ images: [a, b, c] });
    const next = reorderSceneObjects(state, new Set(['img_a']), 'front');
    // sceneOrder is back→front; "front" appends so img_a moves to the end.
    expect(next.sceneOrder).toEqual(['img_b', 'img_c', 'img_a']);
    // Kind arrays are not reordered any more — sceneOrder is the authority.
    expect(next.images!.map((i) => i.id)).toEqual(['img_a', 'img_b', 'img_c']);
  });

  test('captureSceneOrder + applySceneOrder round-trips image z-order', () => {
    const a = makeImage('img_a');
    const b = makeImage('img_b');
    const c = makeImage('img_c');
    const state = makeState({ images: [a, b, c] });
    const order = captureSceneOrder(state);
    expect(order).toEqual(['img_a', 'img_b', 'img_c']);
    const reordered = reorderSceneObjects(state, new Set(['img_b']), 'back');
    expect(reordered.sceneOrder).toEqual(['img_b', 'img_a', 'img_c']);
    const restored = applySceneOrder(reordered, order);
    expect(restored.sceneOrder).toEqual(order);
  });
});

describe('image undo ops', () => {
  test('placeObject adds the image; revert removes it', () => {
    const img = makeImage('img_a');
    const state = makeState();
    const entry: CompUndoEntry = [{ op: 'placeObject', kind: 'image', item: img }];
    const after = applyCompOps(state, entry);
    expect(after.images!).toHaveLength(1);
    expect(after.images![0].id).toBe('img_a');
    const reverted = revertCompOps(after, entry);
    expect(reverted.images!).toHaveLength(0);
  });

  test('removeObject drops the image; revert puts it back', () => {
    const img = makeImage('img_a');
    const state = makeState({ images: [img] });
    const entry: CompUndoEntry = [{ op: 'removeObject', kind: 'image', item: img }];
    const after = applyCompOps(state, entry);
    expect(after.images!).toHaveLength(0);
    const reverted = revertCompOps(after, entry);
    expect(reverted.images!).toHaveLength(1);
    expect(reverted.images![0].id).toBe('img_a');
  });

  test('lockObject toggles locked across kinds, image included', () => {
    const img = makeImage('img_a');
    const state = makeState({ images: [img] });
    const entry: CompUndoEntry = [{ op: 'lockObject', id: 'img_a', oldValue: false, newValue: true }];
    const after = applyCompOps(state, entry);
    expect(after.images![0].locked).toBe(true);
    const reverted = revertCompOps(after, entry);
    expect(reverted.images![0].locked ?? false).toBe(false);
  });

  test('isItemLocked reflects the live image lock state', () => {
    const a = makeImage('img_a', { locked: true });
    const b = makeImage('img_b');
    const state = makeState({ images: [a, b] });
    // Direct read via the helper exposed for handlers like
    // handlePropsToggleLock — needs to find images in state.images,
    // not just figures/lines/arcs.
    const { isItemLocked } = require('../compositionOps');
    expect(isItemLocked(state, 'img_a')).toBe(true);
    expect(isItemLocked(state, 'img_b')).toBe(false);
  });

  test('lockObject undo only mutates the image that holds the id', () => {
    // Regression guard: SCENE_ADAPTERS' lockObject loop walks every
    // adapter. Make sure a figure id isn't accidentally locking an
    // image with the same suffix and vice versa.
    const fig = { id: '1234', figureKey: 'k', cellX: 0, cellY: 0,
      resolutionX: 2, resolutionY: 2, cellWidth: 2, cellHeight: 2 } as any;
    const img = makeImage('img_1234');
    const state = makeState({ figures: [fig], images: [img] });
    const entry: CompUndoEntry = [{ op: 'lockObject', id: 'img_1234', oldValue: false, newValue: true }];
    const after = applyCompOps(state, entry);
    expect(after.images![0].locked).toBe(true);
    expect(after.figures[0].locked ?? false).toBe(false);
  });

  test('moveNode shifts an image bbox; revert undoes it exactly', () => {
    const img = makeImage('img_a', { cellX: 1, cellY: 2 });
    const state = makeState({ images: [img] });
    const entry: CompUndoEntry = [{ op: 'moveNode', nodeId: 'img_a', dx: 3, dy: 4 }];
    const after = applyCompOps(state, entry);
    expect(after.images![0].cellX).toBe(4);
    expect(after.images![0].cellY).toBe(6);
    const reverted = revertCompOps(after, entry);
    expect(reverted.images![0].cellX).toBe(1);
    expect(reverted.images![0].cellY).toBe(2);
  });

  test('editImage round-trips opacity', () => {
    const img = makeImage('img_a', { opacity: 1 });
    const state = makeState({ images: [img] });
    const entry: CompUndoEntry = [{
      op: 'editImage', imageId: 'img_a',
      oldCellX: 0, oldCellY: 0, oldCellWidth: 8, oldCellHeight: 6,
      newCellX: 0, newCellY: 0, newCellWidth: 8, newCellHeight: 6,
      oldOpacity: 1, newOpacity: 0.4,
    }];
    const after = applyCompOps(state, entry);
    expect(after.images![0].opacity).toBe(0.4);
    const reverted = revertCompOps(after, entry);
    expect(reverted.images![0].opacity).toBe(1);
  });

  test('editImage round-trips bbox + rotation + mirror + identity', () => {
    const img = makeImage('img_a', { cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 6 });
    const state = makeState({ images: [img] });
    const entry: CompUndoEntry = [{
      op: 'editImage', imageId: 'img_a',
      oldCellX: 0, oldCellY: 0, oldCellWidth: 8, oldCellHeight: 6,
      newCellX: 4, newCellY: 4, newCellWidth: 12, newCellHeight: 9,
      oldRotation: undefined, newRotation: 90,
      oldMirrorH: undefined, newMirrorH: true,
      oldMirrorV: undefined, newMirrorV: undefined,
      oldIdentityCellX: undefined, newIdentityCellX: 0,
      oldIdentityCellY: undefined, newIdentityCellY: 0,
      oldIdentityCellWidth: undefined, newIdentityCellWidth: 8,
      oldIdentityCellHeight: undefined, newIdentityCellHeight: 6,
    }];
    const after = applyCompOps(state, entry);
    expect(after.images![0].cellX).toBe(4);
    expect(after.images![0].cellWidth).toBe(12);
    expect(after.images![0].rotation).toBe(90);
    expect(after.images![0].mirrorH).toBe(true);
    expect(after.images![0].identityCellWidth).toBe(8);
    const reverted = revertCompOps(after, entry);
    expect(reverted.images![0].cellX).toBe(0);
    expect(reverted.images![0].cellWidth).toBe(8);
    expect(reverted.images![0].rotation).toBeUndefined();
    expect(reverted.images![0].identityCellWidth).toBeUndefined();
  });
});

describe('image visibility (hidden)', () => {
  test('setObjectHidden flips hidden true→false and revert restores', () => {
    const img = makeImage('img_a');
    const state = makeState({ images: [img] });
    const entry: CompUndoEntry = [{ op: 'setObjectHidden', id: 'img_a', oldValue: false, newValue: true }];
    const after = applyCompOps(state, entry);
    expect(after.images![0].hidden).toBe(true);
    const reverted = revertCompOps(after, entry);
    expect(reverted.images![0].hidden ?? false).toBe(false);
  });

  test('setObjectHidden only mutates the targeted image', () => {
    const a = makeImage('img_a');
    const b = makeImage('img_b');
    const state = makeState({ images: [a, b] });
    const entry: CompUndoEntry = [{ op: 'setObjectHidden', id: 'img_a', oldValue: false, newValue: true }];
    const after = applyCompOps(state, entry);
    expect(after.images![0].hidden).toBe(true);
    expect(after.images![1].hidden ?? false).toBe(false);
  });

  test('single setObjectHidden op affects only the targeted member of a group', () => {
    // Group visibility is inherited, not propagated: hiding a group is a
    // single `hideGroup` op on the group's own flag. `setObjectHidden` is
    // single-id, mirroring lockObject — this test pins that the op alone
    // never silently fans out to group siblings.
    const a = makeImage('img_a', { groupId: 'g1' });
    const b = makeImage('img_b', { groupId: 'g1' });
    const group: GroupNode = {
      id: 'g1', name: 'Group',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const state = makeState({ images: [a, b], groups: [group] });
    const entry: CompUndoEntry = [{ op: 'setObjectHidden', id: 'img_a', oldValue: false, newValue: true }];
    const after = applyCompOps(state, entry);
    expect(after.images![0].hidden).toBe(true);
    expect(after.images![1].hidden ?? false).toBe(false);
  });
});

describe('image grouping', () => {
  test('groupFigures includes image members and seeds local bbox', () => {
    const img = makeImage('img_a', { cellX: 4, cellY: 8, cellWidth: 6, cellHeight: 4 });
    const state = makeState({ images: [img] });
    const entry: CompUndoEntry = [{ op: 'groupFigures',
      figureIds: ['img_a'], groupId: 'g1', groupName: 'Group',
      oldNames: [undefined],
    }];
    const after = applyCompOps(state, entry);
    expect(after.groups).toHaveLength(1);
    expect(after.images![0].groupId).toBe('g1');
    expect(after.images![0].localCellX).toBe(4);
    expect(after.images![0].localCellY).toBe(8);
    expect(after.images![0].localCellWidth).toBe(6);
    expect(after.images![0].localCellHeight).toBe(4);
  });

  test('ungroupFigures clears image local bbox + identity', () => {
    const img = makeImage('img_a', {
      groupId: 'g1', preGroupName: 'orig',
      localCellX: 4, localCellY: 8, localCellWidth: 6, localCellHeight: 4,
      identityCellX: 0, identityCellY: 0, identityCellWidth: 6, identityCellHeight: 4,
      rotation: 90,
    });
    const group: GroupNode = {
      id: 'g1', name: 'Group',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const state = makeState({ images: [img], groups: [group] });
    const entry: CompUndoEntry = [{ op: 'ungroupFigures',
      figureIds: ['img_a'], groupId: 'g1', groupName: 'Group',
    }];
    const after = applyCompOps(state, entry);
    expect(after.images![0].groupId).toBeUndefined();
    expect(after.images![0].localCellX).toBeUndefined();
    expect(after.images![0].identityCellX).toBeUndefined();
    expect(after.images![0].rotation).toBeUndefined();
    expect(after.groups).toHaveLength(0);
  });

  test('groupMemberIds enumerates image members alongside other kinds', () => {
    const img = makeImage('img_a', { groupId: 'g1' });
    const img2 = makeImage('img_b', { groupId: 'g1' });
    const state = makeState({ images: [img, img2] });
    const ids = groupMemberIds(state, 'g1');
    expect(ids).toEqual(expect.arrayContaining(['img_a', 'img_b']));
  });

  test('materializeGroupMembers applies a group transform to image bbox', () => {
    const img = makeImage('img_a', {
      groupId: 'g1',
      localCellX: 0, localCellY: 0, localCellWidth: 4, localCellHeight: 2,
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2,
    });
    const group: GroupNode = {
      id: 'g1', name: 'Group',
      translateX: 10, translateY: 20,
      scaleX: 2, scaleY: 3,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const state = makeState({ images: [img], groups: [group] });
    const next = materializeGroupMembers(state, 'g1');
    expect(next.images![0].cellX).toBeCloseTo(10);
    expect(next.images![0].cellY).toBeCloseTo(20);
    expect(next.images![0].cellWidth).toBeCloseTo(8); // 4 × scaleX 2
    expect(next.images![0].cellHeight).toBeCloseTo(6); // 2 × scaleY 3
  });
});
