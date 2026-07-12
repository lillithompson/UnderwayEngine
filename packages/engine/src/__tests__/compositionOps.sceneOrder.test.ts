import {
  applyCompOps,
  revertCompOps,
  appendToSceneOrder,
  removeFromSceneOrder,
  removeManyFromSceneOrder,
  insertIntoSceneOrder,
  reflowSceneOrderForGroups,
  iterateSceneOrder,
  assertSceneOrderInvariant,
  deriveSceneOrderFromKindArrays,
  repairSceneOrder,
  reorderSceneObjects,
  captureSceneOrder,
  applySceneOrder,
  computeSVGBbox,
  buildRemoveObjectOp,
  buildRemoveObjectOps,
} from '../compositionOps';
import {
  CompositionState,
  CompositionFigure,
  SVGObject,
  ImageObject,
  CompUndoEntry,
  makeViewport,
} from '../types';

const WHITE = { r: 255, g: 255, b: 255 };

function makeFigure(id: string, overrides: Partial<CompositionFigure> = {}): CompositionFigure {
  return {
    id,
    figureKey: 'k',
    cellX: 0, cellY: 0,
    resolutionX: 2, resolutionY: 2,
    cellWidth: 2, cellHeight: 2,
    ...overrides,
  };
}

function makeSVG(id: string, overrides: Partial<SVGObject> = {}): SVGObject {
  const segs = overrides.segments ?? [{kind:'line' as const, start:[0,0] as [number,number], end:[1,1] as [number,number]}];
  return { id, segments: segs, color: WHITE, ...computeSVGBbox(segs), ...overrides };
}

function makeImage(id: string, overrides: Partial<ImageObject> = {}): ImageObject {
  return {
    id,
    imageId: id,
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
    pixelWidth: 64, pixelHeight: 64,
    mimeType: 'image/png',
    ...overrides,
  };
}

function makeState(parts: Partial<CompositionState> = {}): CompositionState {
  const figures = parts.figures ?? [];
  const svgObjects = parts.svgObjects ?? [];
  const images = parts.images ?? [];
  return {
    id: 'test', name: 'test',
    figures, svgObjects, images, imageBlobs: {},
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: WHITE,
    customColors: [],
    groups: parts.groups ?? [],
    sceneOrder: parts.sceneOrder ?? deriveSceneOrderFromKindArrays({ figures, svgObjects, images }),
    gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
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

describe('sceneOrder helpers', () => {
  test('appendToSceneOrder is idempotent', () => {
    const state = makeState({ figures: [makeFigure('a')] });
    const next = appendToSceneOrder(state, 'a');
    expect(next).toBe(state);
    const added = appendToSceneOrder(state, 'b');
    expect(added.sceneOrder).toEqual(['a', 'b']);
  });

  test('removeFromSceneOrder no-op when id absent', () => {
    const state = makeState({ figures: [makeFigure('a')] });
    const next = removeFromSceneOrder(state, 'missing');
    expect(next).toBe(state);
    const removed = removeFromSceneOrder(state, 'a');
    expect(removed.sceneOrder).toEqual([]);
  });

  test('removeManyFromSceneOrder filters in one pass', () => {
    const state = makeState({
      figures: [makeFigure('a'), makeFigure('b'), makeFigure('c'), makeFigure('d')],
    });
    const next = removeManyFromSceneOrder(state, new Set(['b', 'd']));
    expect(next.sceneOrder).toEqual(['a', 'c']);
  });

  test('iterateSceneOrder yields back→front in scene order', () => {
    const a = makeFigure('a');
    const s = makeSVG('svg_1');
    const i = makeImage('img_1');
    const state = makeState({
      figures: [a],
      svgObjects: [s],
      images: [i],
      sceneOrder: ['svg_1', 'a', 'img_1'],
    });
    const refs = iterateSceneOrder(state);
    expect(refs.map((r) => r.kind)).toEqual(['svg', 'figure', 'image']);
    expect(refs.map((r) => r.item.id)).toEqual(['svg_1', 'a', 'img_1']);
  });

  test('iterateSceneOrder skips orphan ids quietly', () => {
    const a = makeFigure('a');
    const state = makeState({
      figures: [a],
      sceneOrder: ['a', 'ghost', 'b'],
    });
    const refs = iterateSceneOrder(state);
    expect(refs).toHaveLength(1);
    expect(refs[0].item.id).toBe('a');
  });
});

describe('deriveSceneOrderFromKindArrays', () => {
  test('legacy paint order: images → figures → svgObjects', () => {
    const order = deriveSceneOrderFromKindArrays({
      figures: [{ id: 'f1' }, { id: 'f2' }],
      svgObjects: [{ id: 's1' }, { id: 's2' }],
      images: [{ id: 'i1' }],
    });
    expect(order).toEqual(['i1', 'f1', 'f2', 's1', 's2']);
  });

  test('group members slide together at the earliest member position', () => {
    const order = deriveSceneOrderFromKindArrays({
      figures: [
        { id: 'f1', groupId: 'g1' },
        { id: 'f2' },
        { id: 'f3' },
        { id: 'f4', groupId: 'g1' },
      ],
      svgObjects: [],
    });
    // f4 hops up next to f1 (the earliest member of g1).
    expect(order).toEqual(['f1', 'f4', 'f2', 'f3']);
  });
});

describe('assertSceneOrderInvariant', () => {
  test('passes on a well-formed state', () => {
    const state = makeState({
      figures: [makeFigure('a'), makeFigure('b')],
    });
    expect(() => assertSceneOrderInvariant(state)).not.toThrow();
  });

  test('throws when sceneOrder contains an orphan id', () => {
    const state = makeState({
      figures: [makeFigure('a')],
      sceneOrder: ['a', 'ghost'],
    });
    expect(() => assertSceneOrderInvariant(state)).toThrow(/orphan/);
  });

  test('throws when sceneOrder is missing a live id', () => {
    const state = makeState({
      figures: [makeFigure('a'), makeFigure('b')],
      sceneOrder: ['a'],
    });
    expect(() => assertSceneOrderInvariant(state)).toThrow(/missing/);
  });

  test('throws when group members are not contiguous', () => {
    const state = makeState({
      figures: [
        makeFigure('a', { groupId: 'g1' }),
        makeFigure('b'),
        makeFigure('c', { groupId: 'g1' }),
      ],
      groups: [{ id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false }],
      sceneOrder: ['a', 'b', 'c'],
    });
    expect(() => assertSceneOrderInvariant(state)).toThrow(/contiguous/);
  });
});

describe('reflowSceneOrderForGroups', () => {
  test('clusters newly-grouped members together', () => {
    const state = makeState({
      figures: [
        makeFigure('a', { groupId: 'g1' }),
        makeFigure('b'),
        makeFigure('c', { groupId: 'g1' }),
      ],
      sceneOrder: ['a', 'b', 'c'],
    });
    const next = reflowSceneOrderForGroups(state);
    expect(next.sceneOrder).toEqual(['a', 'c', 'b']);
  });

  test('no-op when already contiguous', () => {
    const state = makeState({
      figures: [
        makeFigure('a', { groupId: 'g1' }),
        makeFigure('c', { groupId: 'g1' }),
        makeFigure('b'),
      ],
      sceneOrder: ['a', 'c', 'b'],
    });
    const next = reflowSceneOrderForGroups(state);
    expect(next).toBe(state);
  });
});

describe('placeObject / removeObject undo ops maintain sceneOrder', () => {
  test('placeObject appends id to sceneOrder; revert removes it', () => {
    const state = makeState({ figures: [makeFigure('a')] });
    const fig = makeFigure('b');
    const entry: CompUndoEntry = [{ op: 'placeObject', kind: 'figure', item: fig }];

    const placed = applyCompOps(state, entry);
    expect(placed.sceneOrder).toEqual(['a', 'b']);
    expect(placed.figures.map((f) => f.id)).toEqual(['a', 'b']);

    const reverted = revertCompOps(placed, entry);
    expect(reverted.sceneOrder).toEqual(['a']);
    expect(reverted.figures.map((f) => f.id)).toEqual(['a']);
  });

  test('removeObject strips sceneOrder; revert restores at the original index', () => {
    const state = makeState({
      figures: [makeFigure('a'), makeFigure('b'), makeFigure('c'), makeFigure('d')],
    });
    const op = buildRemoveObjectOp(state, 'b')!;
    expect(op.sceneOrderIndex).toBe(1);
    const entry: CompUndoEntry = [op];

    const removed = applyCompOps(state, entry);
    expect(removed.sceneOrder).toEqual(['a', 'c', 'd']);

    const restored = revertCompOps(removed, entry);
    expect(restored.sceneOrder).toEqual(['a', 'b', 'c', 'd']);
  });

  test('removeObject revert restores first item at index 0', () => {
    const state = makeState({
      figures: [makeFigure('a'), makeFigure('b'), makeFigure('c')],
    });
    const entry: CompUndoEntry = [buildRemoveObjectOp(state, 'a')!];
    const removed = applyCompOps(state, entry);
    expect(removed.sceneOrder).toEqual(['b', 'c']);
    const restored = revertCompOps(removed, entry);
    expect(restored.sceneOrder).toEqual(['a', 'b', 'c']);
  });

  test('removeObject revert restores last item at original tail index', () => {
    const state = makeState({
      figures: [makeFigure('a'), makeFigure('b'), makeFigure('c')],
    });
    const entry: CompUndoEntry = [buildRemoveObjectOp(state, 'c')!];
    const removed = applyCompOps(state, entry);
    expect(removed.sceneOrder).toEqual(['a', 'b']);
    const restored = revertCompOps(removed, entry);
    expect(restored.sceneOrder).toEqual(['a', 'b', 'c']);
  });

  test('multi-delete revert restores each item at its original index', () => {
    const state = makeState({
      figures: [makeFigure('a'), makeFigure('b'), makeFigure('c'), makeFigure('d'), makeFigure('e')],
    });
    const entry = buildRemoveObjectOps(state, ['b', 'd']);
    const removed = applyCompOps(state, entry);
    expect(removed.sceneOrder).toEqual(['a', 'c', 'e']);
    const restored = revertCompOps(removed, entry);
    expect(restored.sceneOrder).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  test('removeObject survives a delete → undo → redo → undo cycle', () => {
    const state = makeState({
      figures: [makeFigure('a'), makeFigure('b'), makeFigure('c')],
    });
    const entry: CompUndoEntry = [buildRemoveObjectOp(state, 'b')!];

    const afterDelete = applyCompOps(state, entry);
    expect(afterDelete.sceneOrder).toEqual(['a', 'c']);

    const afterUndo = revertCompOps(afterDelete, entry);
    expect(afterUndo.sceneOrder).toEqual(['a', 'b', 'c']);

    const afterRedo = applyCompOps(afterUndo, entry);
    expect(afterRedo.sceneOrder).toEqual(['a', 'c']);

    const afterUndoAgain = revertCompOps(afterRedo, entry);
    expect(afterUndoAgain.sceneOrder).toEqual(['a', 'b', 'c']);
  });

  test('insertIntoSceneOrder clamps out-of-range indices', () => {
    const state = makeState({ figures: [makeFigure('a'), makeFigure('b')] });
    const head = insertIntoSceneOrder(state, 'x', -5);
    expect(head.sceneOrder).toEqual(['x', 'a', 'b']);
    const tail = insertIntoSceneOrder(state, 'y', 99);
    expect(tail.sceneOrder).toEqual(['a', 'b', 'y']);
    const middle = insertIntoSceneOrder(state, 'm', 1);
    expect(middle.sceneOrder).toEqual(['a', 'm', 'b']);
    const idempotent = insertIntoSceneOrder(state, 'a', 0);
    expect(idempotent).toBe(state);
  });
});

describe('reorderObjects undo op operates on sceneOrder', () => {
  test('apply / revert restore the captured sceneOrder', () => {
    const state = makeState({
      figures: [makeFigure('a'), makeFigure('b'), makeFigure('c')],
    });
    const oldOrder = captureSceneOrder(state);
    const entry: CompUndoEntry = [{
      op: 'reorderObjects',
      oldOrder,
      newOrder: ['c', 'b', 'a'],
    }];
    const applied = applyCompOps(state, entry);
    expect(applied.sceneOrder).toEqual(['c', 'b', 'a']);

    const reverted = revertCompOps(applied, entry);
    expect(reverted.sceneOrder).toEqual(oldOrder);
  });
});

describe('reorderSceneObjects expands groups', () => {
  test('selecting one member moves the whole group', () => {
    const state = makeState({
      figures: [
        makeFigure('a'),
        makeFigure('b', { groupId: 'g1' }),
        makeFigure('c', { groupId: 'g1' }),
        makeFigure('d'),
      ],
      groups: [{ id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false }],
    });
    const next = reorderSceneObjects(state, new Set(['b']), 'front');
    expect(next.sceneOrder).toEqual(['a', 'd', 'b', 'c']);
    // Invariant still holds.
    expect(() => assertSceneOrderInvariant(next)).not.toThrow();
  });

  // Hierarchy for the nested-group cases below:
  //   root: g_outer
  //     direct members: d1, d2
  //     child group g_inner
  //       direct members: n1, n2
  //   plus loose figure x.
  function makeNestedState() {
    return makeState({
      figures: [
        makeFigure('x'),
        makeFigure('d1', { groupId: 'g_outer' }),
        makeFigure('d2', { groupId: 'g_outer' }),
        makeFigure('n1', { groupId: 'g_inner' }),
        makeFigure('n2', { groupId: 'g_inner' }),
      ],
      groups: [
        { id: 'g_outer', name: 'Outer', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false },
        { id: 'g_inner', name: 'Inner', parentGroupId: 'g_outer', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false },
      ],
      sceneOrder: ['x', 'd1', 'd2', 'n1', 'n2'],
    });
  }

  test('selecting a root-direct member also drags the nested-sub-group descendants', () => {
    // Pre-fix: the expansion keyed off the immediate groupId of d1
    // (g_outer), so only d1 and d2 would have been pulled in — n1/n2 left
    // behind, splitting the root tree across sceneOrder.
    const state = makeNestedState();
    const next = reorderSceneObjects(state, new Set(['d1']), 'back');
    expect(next.sceneOrder).toEqual(['d1', 'd2', 'n1', 'n2', 'x']);
    expect(() => assertSceneOrderInvariant(next)).not.toThrow();
  });

  test('selecting a nested-sub-group member also drags the root direct members', () => {
    // Symmetric: picking n1 (immediate group = g_inner) must still drag
    // d1/d2 — otherwise the root tree ends up split across sceneOrder.
    const state = makeNestedState();
    const next = reorderSceneObjects(state, new Set(['n1']), 'back');
    expect(next.sceneOrder).toEqual(['d1', 'd2', 'n1', 'n2', 'x']);
    expect(() => assertSceneOrderInvariant(next)).not.toThrow();
  });
});

describe('groupFigures op clusters sceneOrder', () => {
  test('grouping non-adjacent members re-flows sceneOrder so they are contiguous', () => {
    const state = makeState({
      figures: [
        makeFigure('a'),
        makeFigure('b'),
        makeFigure('c'),
      ],
    });
    const entry: CompUndoEntry = [{
      op: 'groupFigures',
      figureIds: ['a', 'c'],
      groupId: 'g1',
      groupName: 'My Group',
      oldNames: [undefined, undefined],
    }];
    const grouped = applyCompOps(state, entry);
    // a and c are now group members; they cluster at a's anchor index 0.
    expect(grouped.sceneOrder).toEqual(['a', 'c', 'b']);
    expect(() => assertSceneOrderInvariant(grouped)).not.toThrow();
  });
});

describe('applySceneOrder on undo', () => {
  test('round-trips a captured sceneOrder', () => {
    const state = makeState({
      figures: [makeFigure('a'), makeFigure('b'), makeFigure('c')],
    });
    const captured = captureSceneOrder(state);
    const after = applySceneOrder({ ...state, sceneOrder: ['c', 'b', 'a'] }, captured);
    expect(after.sceneOrder).toEqual(captured);
  });
});

describe('repairSceneOrder heals partial sceneOrder at load time', () => {
  test('appends kind-array ids that are missing from sceneOrder', () => {
    // Simulates loading a file saved by the buggy join path: the join
    // result is in the kind array but absent from sceneOrder. Without
    // repair, the loaded scene would render empty.
    const repaired = repairSceneOrder({
      figures: [makeFigure('a'), makeFigure('b')],
      svgObjects: [makeSVG('orphan_join')],
      sceneOrder: ['a', 'b'],
    });
    expect(repaired).toContain('orphan_join');
    expect(repaired).toContain('a');
    expect(repaired).toContain('b');
  });

  test('keeps existing sceneOrder positions stable for non-orphan ids', () => {
    const repaired = repairSceneOrder({
      figures: [makeFigure('a'), makeFigure('b'), makeFigure('c')],
      svgObjects: [],
      sceneOrder: ['c', 'a'],
    });
    expect(repaired.indexOf('c')).toBeLessThan(repaired.indexOf('a'));
    expect(repaired).toContain('b');
  });

  test('reflows so an orphan with a groupId clusters with existing members', () => {
    const repaired = repairSceneOrder({
      figures: [
        makeFigure('a', { groupId: 'g1' }),
        makeFigure('b'),
        makeFigure('c', { groupId: 'g1' }),
      ],
      svgObjects: [],
      sceneOrder: ['a', 'b'],
    });
    // c (orphan with groupId 'g1') should end up adjacent to a.
    const ai = repaired.indexOf('a');
    const ci = repaired.indexOf('c');
    expect(Math.abs(ai - ci)).toBe(1);
  });
});
