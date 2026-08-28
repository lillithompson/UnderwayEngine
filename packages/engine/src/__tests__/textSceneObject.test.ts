/**
 * Text scene-object ('text' kind, txt_ namespace) coverage through the
 * composition ops layer: place/remove/duplicate/lock/hide/move, hit-test,
 * group aliveness, sceneOrder derivation/repair, and the v29 undo ops
 * (setText, setTextStyle, setNodeEffects, setFillPaint, setImageTint,
 * setBackground, replaceScene texts) — each as an apply+revert round-trip.
 */

import {
  applyCompOps,
  revertCompOps,
  buildDuplicateOps,
  buildRemoveObjectOp,
  translateNodeByDelta,
  findTextAtCell,
  findSceneObjectAtCell,
  computeAliveGroupIds,
  deriveSceneOrderFromKindArrays,
  repairSceneOrder,
  computeSVGBbox,
  findItem,
} from '../compositionOps';
import {
  CompositionState,
  CompositionFigure,
  SVGObject,
  ImageObject,
  TextObject,
  TextStyle,
  GroupNode,
  NodeEffects,
  Paint,
  ImageTint,
  CompUndoEntry,
  makeViewport,
} from '../types';

function makeStyle(overrides: Partial<TextStyle> = {}): TextStyle {
  return { fontId: 'font_a', size: 2, color: { r: 255, g: 255, b: 255 }, ...overrides };
}

function makeText(id: string, overrides: Partial<TextObject> = {}): TextObject {
  return {
    id,
    content: 'hello',
    style: makeStyle(),
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2,
    ...overrides,
  };
}

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

function makeSVG(id: string, overrides: Partial<SVGObject> = {}): SVGObject {
  const segs = overrides.segments
    ?? [{ kind: 'line' as const, start: [0, 0] as [number, number], end: [10, 0] as [number, number] }];
  return {
    id,
    segments: segs,
    color: { r: 255, g: 255, b: 255 },
    ...computeSVGBbox(segs),
    ...overrides,
  };
}

function makeFigure(id: string, overrides: Partial<CompositionFigure> = {}): CompositionFigure {
  return {
    id,
    figureKey: 'test',
    cellX: 0, cellY: 0,
    resolutionX: 2, resolutionY: 2,
    cellWidth: 2, cellHeight: 2,
    rotation: 0,
    ...overrides,
  };
}

function makeGroup(id: string, overrides: Partial<GroupNode> = {}): GroupNode {
  return {
    id, name: 'Group ' + id,
    translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
    rotation: 0, mirrorH: false, mirrorV: false,
    ...overrides,
  };
}

function makeState(parts: Partial<CompositionState> = {}): CompositionState {
  const figures = parts.figures ?? [];
  const svgObjects = parts.svgObjects ?? [];
  const images = parts.images ?? [];
  const texts = parts.texts ?? [];
  return {
    id: 'test',
    name: 'test',
    figures,
    svgObjects,
    images,
    texts,
    imageBlobs: {},
    lineDraft: null,
    arcDraft: null,
    editingLineId: null,
    selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups: [],
    sceneOrder: parts.sceneOrder
      ?? deriveSceneOrderFromKindArrays({ figures, svgObjects, images, texts }),
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

describe('text placeObject / removeObject', () => {
  test('placeObject adds the text and appends to sceneOrder; revert removes both', () => {
    const txt = makeText('txt_a');
    const state = makeState({ svgObjects: [makeSVG('svg_a')] });
    const entry: CompUndoEntry = [{ op: 'placeObject', kind: 'text', item: txt }];
    const after = applyCompOps(state, entry);
    expect(after.texts!).toHaveLength(1);
    expect(after.texts![0].id).toBe('txt_a');
    expect(after.sceneOrder).toEqual(['svg_a', 'txt_a']);
    const reverted = revertCompOps(after, entry);
    expect(reverted.texts!).toHaveLength(0);
    expect(reverted.sceneOrder).toEqual(['svg_a']);
  });

  test('findItem resolves a placed text to kind "text"', () => {
    const txt = makeText('txt_a');
    const state = makeState({ texts: [txt] });
    const ref = findItem(state, 'txt_a');
    expect(ref).not.toBeNull();
    expect(ref!.kind).toBe('text');
    expect(ref!.item).toBe(txt);
  });

  test('removeObject drops the text; revert splices it back at its sceneOrder index', () => {
    const state = makeState({
      images: [makeImage('img_a')],
      svgObjects: [makeSVG('svg_a')],
      texts: [makeText('txt_a')],
      sceneOrder: ['img_a', 'txt_a', 'svg_a'], // text in the MIDDLE
    });
    const op = buildRemoveObjectOp(state, 'txt_a')!;
    expect(op.kind).toBe('text');
    expect(op.sceneOrderIndex).toBe(1);
    const entry: CompUndoEntry = [op];
    const after = applyCompOps(state, entry);
    expect(after.texts!).toHaveLength(0);
    expect(after.sceneOrder).toEqual(['img_a', 'svg_a']);
    const reverted = revertCompOps(after, entry);
    expect(reverted.texts!.map((t) => t.id)).toEqual(['txt_a']);
    expect(reverted.sceneOrder).toEqual(['img_a', 'txt_a', 'svg_a']);
  });

  test('removeObject clears the text from the selection', () => {
    const state = makeState({
      texts: [makeText('txt_a')],
      selectedFigureIds: new Set(['txt_a']),
    });
    const entry: CompUndoEntry = [buildRemoveObjectOp(state, 'txt_a')!];
    const after = applyCompOps(state, entry);
    expect(after.selectedFigureIds.has('txt_a')).toBe(false);
  });
});

describe('text buildDuplicateOps', () => {
  const original = () => makeText('txt_a', {
    cellX: 2, cellY: 3,
    style: makeStyle({ stroke: { width: 1, color: { r: 9, g: 8, b: 7 } } }),
  });

  test('mints a fresh txt_-prefixed id and offsets the bbox', () => {
    const state = makeState({ texts: [original()] });
    const { ops, newIds } = buildDuplicateOps(state, ['txt_a']);
    expect(newIds).toHaveLength(1);
    expect(newIds[0]).toMatch(/^txt_/);
    expect(newIds[0]).not.toBe('txt_a');
    const after = applyCompOps(state, ops);
    expect(after.texts!).toHaveLength(2);
    const dup = after.texts!.find((t) => t.id === newIds[0])!;
    expect(dup.cellX).toBe(3); // default offset 1
    expect(dup.cellY).toBe(4);
    expect(dup.cellWidth).toBe(4);
    expect(dup.cellHeight).toBe(2);
    expect(dup.content).toBe('hello');
    expect(dup.locked).toBe(false);
  });

  test('duplicate carries a cloned style block; mutating it leaves the original intact', () => {
    const orig = original();
    const state = makeState({ texts: [orig] });
    const { ops, newIds } = buildDuplicateOps(state, ['txt_a']);
    const after = applyCompOps(state, ops);
    const dup = after.texts!.find((t) => t.id === newIds[0])!;
    expect(dup.style).toEqual(orig.style);
    expect(dup.style).not.toBe(orig.style);
    expect(dup.style.stroke).not.toBe(orig.style.stroke);
    dup.style.size = 99;
    dup.style.stroke!.width = 55;
    expect(orig.style.size).toBe(2);
    expect(orig.style.stroke!.width).toBe(1);
    // The surviving original in the new state is untouched too.
    const stillOrig = after.texts!.find((t) => t.id === 'txt_a')!;
    expect(stillOrig.style.size).toBe(2);
    expect(stillOrig.style.stroke!.width).toBe(1);
  });

  test('revert of the duplicate ops removes the copy', () => {
    const state = makeState({ texts: [original()] });
    const { ops, newIds } = buildDuplicateOps(state, ['txt_a']);
    const after = applyCompOps(state, ops);
    const reverted = revertCompOps(after, ops);
    expect(reverted.texts!.map((t) => t.id)).toEqual(['txt_a']);
    expect(reverted.sceneOrder).not.toContain(newIds[0]);
  });
});

describe('text lock / hidden', () => {
  test('lockObject toggles locked on a text; revert restores', () => {
    const state = makeState({ texts: [makeText('txt_a')] });
    const entry: CompUndoEntry = [{ op: 'lockObject', id: 'txt_a', oldValue: false, newValue: true }];
    const after = applyCompOps(state, entry);
    expect(after.texts![0].locked).toBe(true);
    const reverted = revertCompOps(after, entry);
    expect(reverted.texts![0].locked ?? false).toBe(false);
  });

  test('setObjectHidden toggles hidden on a text; revert restores', () => {
    const state = makeState({ texts: [makeText('txt_a')] });
    const entry: CompUndoEntry = [{ op: 'setObjectHidden', id: 'txt_a', oldValue: false, newValue: true }];
    const after = applyCompOps(state, entry);
    expect(after.texts![0].hidden).toBe(true);
    const reverted = revertCompOps(after, entry);
    expect(reverted.texts![0].hidden ?? false).toBe(false);
  });

  test('lockObject only mutates the text that holds the id', () => {
    const state = makeState({ texts: [makeText('txt_a'), makeText('txt_b')] });
    const entry: CompUndoEntry = [{ op: 'lockObject', id: 'txt_b', oldValue: false, newValue: true }];
    const after = applyCompOps(state, entry);
    expect(after.texts![0].locked ?? false).toBe(false);
    expect(after.texts![1].locked).toBe(true);
  });
});

describe('translateNodeByDelta on text', () => {
  test('moves the bbox rigidly: orientation kept, identity anchors ride along', () => {
    // rotation/mirror are the RENDERED orientation of a bbox node — a move
    // must leave the picture exactly as it was, just elsewhere.
    const txt = makeText('txt_a', {
      cellX: 1, cellY: 2, rotation: 90, mirrorH: true, mirrorV: true,
      identityCellX: 0, identityCellY: 0, identityCellWidth: 4, identityCellHeight: 2,
    });
    const state = makeState({ texts: [txt] });
    const next = translateNodeByDelta(state, 'txt_a', 3, 4);
    const moved = next.texts![0];
    expect(moved.cellX).toBe(4);
    expect(moved.cellY).toBe(6);
    expect(moved.identityCellX).toBe(3);
    expect(moved.identityCellY).toBe(4);
    expect(moved.identityCellWidth).toBe(4);
    expect(moved.identityCellHeight).toBe(2);
    expect(moved.rotation).toBe(90);
    expect(moved.mirrorH).toBe(true);
    expect(moved.mirrorV).toBe(true);
  });

  test('shifts group-local coords alongside the world bbox', () => {
    const txt = makeText('txt_a', {
      cellX: 5, cellY: 5, groupId: 'g1',
      localCellX: 1, localCellY: 1, localCellWidth: 4, localCellHeight: 2,
    });
    const state = makeState({ texts: [txt], groups: [makeGroup('g1')] });
    const next = translateNodeByDelta(state, 'txt_a', 2, 3);
    expect(next.texts![0].localCellX).toBe(3);
    expect(next.texts![0].localCellY).toBe(4);
  });

  test('moveNode is rigid: orientation survives the move, identity rides along, revert is exact', () => {
    // The rotation/mirror flags ARE a text's rendered orientation — a move
    // must not touch them (clearing them here visibly un-turned the text).
    // The identity stash shifts with the node, so the transform cycle picks
    // up mid-way after a move and the inverse translate restores everything.
    const txt = makeText('txt_a', {
      cellX: 1, cellY: 2, rotation: 180, mirrorH: true,
      identityCellX: 0, identityCellY: 0, identityCellWidth: 4, identityCellHeight: 2,
    });
    const state = makeState({ texts: [txt] });
    const entry: CompUndoEntry = [{
      op: 'moveNode', nodeId: 'txt_a', dx: 3, dy: 4,
    }];
    const after = applyCompOps(state, entry);
    expect(after.texts![0].cellX).toBe(4);
    expect(after.texts![0].rotation).toBe(180);
    expect(after.texts![0].mirrorH).toBe(true);
    expect(after.texts![0].identityCellX).toBe(3);
    expect(after.texts![0].identityCellY).toBe(4);
    expect(after.texts![0].identityCellWidth).toBe(4);
    const reverted = revertCompOps(after, entry);
    expect(reverted.texts![0]).toEqual(state.texts![0]);
  });
});

describe('text hit-testing', () => {
  test('findTextAtCell hits inside the bbox, misses outside (half-open)', () => {
    const state = makeState({ texts: [makeText('txt_a', { cellX: 2, cellY: 3, cellWidth: 4, cellHeight: 2 })] });
    expect(findTextAtCell(2, 3, state)).toBe('txt_a');
    expect(findTextAtCell(5.9, 4.9, state)).toBe('txt_a');
    expect(findTextAtCell(6, 4, state)).toBeNull();  // x == cellX + width
    expect(findTextAtCell(3, 5, state)).toBeNull();  // y == cellY + height
    expect(findTextAtCell(1.9, 3, state)).toBeNull();
  });

  test('findTextAtCell skips hidden and locked texts', () => {
    const hidden = makeState({ texts: [makeText('txt_a', { hidden: true })] });
    expect(findTextAtCell(1, 1, hidden)).toBeNull();
    const locked = makeState({ texts: [makeText('txt_a', { locked: true })] });
    expect(findTextAtCell(1, 1, locked)).toBeNull();
  });

  test('findTextAtCell respects z-order between overlapping texts', () => {
    const a = makeText('txt_a');
    const b = makeText('txt_b');
    const front = makeState({ texts: [a, b], sceneOrder: ['txt_a', 'txt_b'] });
    expect(findTextAtCell(1, 1, front)).toBe('txt_b');
    const flipped = makeState({ texts: [a, b], sceneOrder: ['txt_b', 'txt_a'] });
    expect(findTextAtCell(1, 1, flipped)).toBe('txt_a');
  });

  test('findSceneObjectAtCell returns the text over an image behind it', () => {
    const state = makeState({
      images: [makeImage('img_a')],                    // 0,0 8x6
      texts: [makeText('txt_a', { cellX: 1, cellY: 1, cellWidth: 2, cellHeight: 2 })],
      sceneOrder: ['img_a', 'txt_a'],                  // text in front
    });
    expect(findSceneObjectAtCell(state, 1.5, 1.5)).toEqual({ kind: 'text', id: 'txt_a' });
    // Outside the text bbox the image takes the hit.
    expect(findSceneObjectAtCell(state, 5, 5)).toEqual({ kind: 'image', id: 'img_a' });
  });

  test('findSceneObjectAtCell falls through a hidden text to the image', () => {
    const state = makeState({
      images: [makeImage('img_a')],
      texts: [makeText('txt_a', { cellX: 1, cellY: 1, cellWidth: 2, cellHeight: 2, hidden: true })],
      sceneOrder: ['img_a', 'txt_a'],
    });
    expect(findSceneObjectAtCell(state, 1.5, 1.5)).toEqual({ kind: 'image', id: 'img_a' });
  });

  test('findSceneObjectAtCell honors sceneOrder when the image is in front', () => {
    const state = makeState({
      images: [makeImage('img_a')],
      texts: [makeText('txt_a', { cellX: 1, cellY: 1, cellWidth: 2, cellHeight: 2 })],
      sceneOrder: ['txt_a', 'img_a'],                  // image in front
    });
    expect(findSceneObjectAtCell(state, 1.5, 1.5)).toEqual({ kind: 'image', id: 'img_a' });
  });
});

describe('computeAliveGroupIds with text members', () => {
  test('a text member keeps its group and ancestor chain alive', () => {
    const groups = [
      makeGroup('g0'),
      makeGroup('g1', { parentGroupId: 'g0' }),
      makeGroup('g2'),
    ];
    const alive = computeAliveGroupIds(groups, [], [], [], [{ groupId: 'g1' }]);
    expect(alive).toEqual(new Set(['g1', 'g0']));
  });

  test('counts members across all five arrays', () => {
    const groups = [makeGroup('gf'), makeGroup('gs'), makeGroup('gi'), makeGroup('gt')];
    const alive = computeAliveGroupIds(
      groups,
      [{ groupId: 'gf' }],
      [{ groupId: 'gs' }],
      [{ groupId: 'gi' }],
      [{ groupId: 'gt' }],
    );
    expect(alive).toEqual(new Set(['gf', 'gs', 'gi', 'gt']));
  });

  test('no text members: group with only text children dies when texts are gone', () => {
    const groups = [makeGroup('g1')];
    expect(computeAliveGroupIds(groups, [], [], [], [])).toEqual(new Set());
  });
});

describe('sceneOrder derivation with texts', () => {
  test('deriveSceneOrderFromKindArrays paints texts last (front)', () => {
    const order = deriveSceneOrderFromKindArrays({
      figures: [makeFigure('f1')],
      svgObjects: [makeSVG('svg_1')],
      images: [makeImage('img_1')],
      texts: [makeText('txt_1'), makeText('txt_2')],
    });
    expect(order).toEqual(['img_1', 'f1', 'svg_1', 'txt_1', 'txt_2']);
  });

  test('repairSceneOrder appends missing text ids', () => {
    const repaired = repairSceneOrder({
      figures: [makeFigure('f1')],
      svgObjects: [],
      images: [],
      texts: [makeText('txt_1'), makeText('txt_2')],
      sceneOrder: ['f1', 'txt_2'], // txt_1 missing
    });
    expect(repaired).toEqual(['f1', 'txt_2', 'txt_1']);
  });

  test('repairSceneOrder leaves an already-complete order untouched', () => {
    const repaired = repairSceneOrder({
      figures: [],
      svgObjects: [],
      images: [],
      texts: [makeText('txt_1')],
      sceneOrder: ['txt_1'],
    });
    expect(repaired).toEqual(['txt_1']);
  });
});

describe('setText op', () => {
  test('apply swaps content and bbox; revert restores both', () => {
    const state = makeState({ texts: [makeText('txt_a')] }); // 'hello', 4x2
    const entry: CompUndoEntry = [{
      op: 'setText', textId: 'txt_a',
      oldContent: 'hello', newContent: 'hello\nworld',
      oldCellWidth: 4, oldCellHeight: 2,
      newCellWidth: 6, newCellHeight: 4,
    }];
    const after = applyCompOps(state, entry);
    expect(after.texts![0].content).toBe('hello\nworld');
    expect(after.texts![0].cellWidth).toBe(6);
    expect(after.texts![0].cellHeight).toBe(4);
    const reverted = revertCompOps(after, entry);
    expect(reverted.texts![0].content).toBe('hello');
    expect(reverted.texts![0].cellWidth).toBe(4);
    expect(reverted.texts![0].cellHeight).toBe(2);
  });

  test('only the targeted text is touched', () => {
    const state = makeState({ texts: [makeText('txt_a'), makeText('txt_b')] });
    const entry: CompUndoEntry = [{
      op: 'setText', textId: 'txt_b',
      oldContent: 'hello', newContent: 'edited',
      oldCellWidth: 4, oldCellHeight: 2,
      newCellWidth: 5, newCellHeight: 2,
    }];
    const after = applyCompOps(state, entry);
    expect(after.texts![0].content).toBe('hello');
    expect(after.texts![1].content).toBe('edited');
  });
});

describe('setText / setTextStyle anchored origin (optional cellX/Y)', () => {
  // Auto-size re-measures anchor the box by alignment, so the origin can
  // move with the size; the optional fields carry it through undo exactly.
  test('setText apply moves the origin; revert restores it', () => {
    const state = makeState({ texts: [makeText('txt_a', { cellX: 10, cellY: 20 })] });
    const entry: CompUndoEntry = [{
      op: 'setText', textId: 'txt_a',
      oldContent: 'hello', newContent: 'hello!',
      oldCellWidth: 4, oldCellHeight: 2,
      newCellWidth: 6, newCellHeight: 2,
      oldCellX: 10, oldCellY: 20,
      newCellX: 9, newCellY: 20,
    }];
    const after = applyCompOps(state, entry);
    expect(after.texts![0].cellX).toBe(9);
    expect(after.texts![0].cellWidth).toBe(6);
    const reverted = revertCompOps(after, entry);
    expect(reverted.texts![0].cellX).toBe(10);
    expect(reverted.texts![0].cellY).toBe(20);
    expect(reverted.texts![0].cellWidth).toBe(4);
  });

  test('setTextStyle apply moves the origin; revert restores it', () => {
    const state = makeState({ texts: [makeText('txt_a', { cellX: 5, cellY: 7 })] });
    const entry: CompUndoEntry = [{
      op: 'setTextStyle', textId: 'txt_a',
      oldStyle: makeStyle(), newStyle: makeStyle({ size: 4 }),
      oldCellWidth: 4, oldCellHeight: 2,
      newCellWidth: 8, newCellHeight: 4,
      oldCellX: 5, oldCellY: 7,
      newCellX: 3, newCellY: 6,
    }];
    const after = applyCompOps(state, entry);
    expect(after.texts![0].cellX).toBe(3);
    expect(after.texts![0].cellY).toBe(6);
    const reverted = revertCompOps(after, entry);
    expect(reverted.texts![0].cellX).toBe(5);
    expect(reverted.texts![0].cellY).toBe(7);
    expect(reverted.texts![0].style).toEqual(makeStyle());
  });

  test('entries without the optional fields leave the origin untouched', () => {
    const state = makeState({ texts: [makeText('txt_a', { cellX: 10, cellY: 20 })] });
    const entry: CompUndoEntry = [{
      op: 'setText', textId: 'txt_a',
      oldContent: 'hello', newContent: 'edited',
      oldCellWidth: 4, oldCellHeight: 2,
      newCellWidth: 5, newCellHeight: 2,
    }];
    const after = applyCompOps(state, entry);
    expect(after.texts![0].cellX).toBe(10);
    expect(after.texts![0].cellY).toBe(20);
  });
});

describe('setTextStyle op', () => {
  test('apply swaps the whole style block and bbox; revert restores both', () => {
    const oldStyle = makeStyle();
    const newStyle = makeStyle({
      size: 4, bold: true, align: 'center',
      color: { r: 10, g: 20, b: 30 },
      stroke: { width: 0.5, color: { r: 0, g: 0, b: 0 } },
    });
    const state = makeState({ texts: [makeText('txt_a', { style: oldStyle })] });
    const entry: CompUndoEntry = [{
      op: 'setTextStyle', textId: 'txt_a',
      oldStyle, newStyle,
      oldCellWidth: 4, oldCellHeight: 2,
      newCellWidth: 8, newCellHeight: 4,
    }];
    const after = applyCompOps(state, entry);
    expect(after.texts![0].style).toBe(newStyle);
    expect(after.texts![0].cellWidth).toBe(8);
    expect(after.texts![0].cellHeight).toBe(4);
    const reverted = revertCompOps(after, entry);
    expect(reverted.texts![0].style).toBe(oldStyle);
    expect(reverted.texts![0].cellWidth).toBe(4);
    expect(reverted.texts![0].cellHeight).toBe(2);
  });
});

describe('setNodeEffects op', () => {
  const effects: NodeEffects = {
    shadow: { dx: 1, dy: 2, blur: 3, color: { r: 0, g: 0, b: 0 }, alpha: 0.5 },
  };
  const otherEffects: NodeEffects = {
    glow: { radius: 4, color: { r: 255, g: 255, b: 0 }, alpha: 0.8 },
  };

  test.each([
    ['svg', 'svg_a'],
    ['image', 'img_a'],
    ['text', 'txt_a'],
  ])('sets effects on a %s node from undefined; revert clears', (_kind, id) => {
    const state = makeState({
      svgObjects: [makeSVG('svg_a')],
      images: [makeImage('img_a')],
      texts: [makeText('txt_a')],
    });
    const entry: CompUndoEntry = [{ op: 'setNodeEffects', id, oldEffects: undefined, newEffects: effects }];
    const after = applyCompOps(state, entry);
    const findEffects = (s: CompositionState) =>
      [...s.svgObjects, ...(s.images ?? []), ...(s.texts ?? [])].find((n) => n.id === id)!.effects;
    expect(findEffects(after)).toBe(effects);
    const reverted = revertCompOps(after, entry);
    expect(findEffects(reverted)).toBeUndefined();
  });

  test('replaces an existing effects block; revert restores the old one', () => {
    const state = makeState({ texts: [makeText('txt_a', { effects })] });
    const entry: CompUndoEntry = [{
      op: 'setNodeEffects', id: 'txt_a', oldEffects: effects, newEffects: otherEffects,
    }];
    const after = applyCompOps(state, entry);
    expect(after.texts![0].effects).toBe(otherEffects);
    const reverted = revertCompOps(after, entry);
    expect(reverted.texts![0].effects).toBe(effects);
  });

  test('clearing effects (newEffects undefined) round-trips', () => {
    const state = makeState({ images: [makeImage('img_a', { effects })] });
    const entry: CompUndoEntry = [{
      op: 'setNodeEffects', id: 'img_a', oldEffects: effects, newEffects: undefined,
    }];
    const after = applyCompOps(state, entry);
    expect(after.images![0].effects).toBeUndefined();
    const reverted = revertCompOps(after, entry);
    expect(reverted.images![0].effects).toBe(effects);
  });
});

describe('setFillPaint op', () => {
  const paint: Paint = {
    kind: 'linear',
    stops: [
      { offset: 0, color: { r: 255, g: 0, b: 0 } },
      { offset: 1, color: { r: 0, g: 0, b: 255 }, alpha: 0.5 },
    ],
    x1: 0, y1: 0, x2: 1, y2: 1,
  };

  test('sets a gradient fill from undefined; revert clears it', () => {
    const state = makeState({ svgObjects: [makeSVG('svg_a')] });
    const entry: CompUndoEntry = [{ op: 'setFillPaint', svgId: 'svg_a', oldPaint: undefined, newPaint: paint }];
    const after = applyCompOps(state, entry);
    expect(after.svgObjects[0].fillPaint).toBe(paint);
    const reverted = revertCompOps(after, entry);
    expect(reverted.svgObjects[0].fillPaint).toBeUndefined();
  });

  test('replaces an existing paint; revert restores it', () => {
    const solid: Paint = { kind: 'solid', color: { r: 1, g: 2, b: 3 } };
    const state = makeState({ svgObjects: [makeSVG('svg_a', { fillPaint: solid })] });
    const entry: CompUndoEntry = [{ op: 'setFillPaint', svgId: 'svg_a', oldPaint: solid, newPaint: paint }];
    const after = applyCompOps(state, entry);
    expect(after.svgObjects[0].fillPaint).toBe(paint);
    const reverted = revertCompOps(after, entry);
    expect(reverted.svgObjects[0].fillPaint).toBe(solid);
  });
});

describe('setImageTint op', () => {
  const tint: ImageTint = { color: { r: 200, g: 100, b: 50 }, amount: 0.7, mode: 'tint' };

  test('sets a tint from undefined; revert clears it', () => {
    const state = makeState({ images: [makeImage('img_a')] });
    const entry: CompUndoEntry = [{ op: 'setImageTint', nodeId: 'img_a', oldTint: undefined, newTint: tint }];
    const after = applyCompOps(state, entry);
    expect(after.images![0].tint).toBe(tint);
    const reverted = revertCompOps(after, entry);
    expect(reverted.images![0].tint).toBeUndefined();
  });

  test('replaces an existing tint; revert restores it', () => {
    const wash: ImageTint = { color: { r: 0, g: 0, b: 255 }, amount: 1, mode: 'wash' };
    const state = makeState({ images: [makeImage('img_a', { tint: wash })] });
    const entry: CompUndoEntry = [{ op: 'setImageTint', nodeId: 'img_a', oldTint: wash, newTint: tint }];
    const after = applyCompOps(state, entry);
    expect(after.images![0].tint).toBe(tint);
    const reverted = revertCompOps(after, entry);
    expect(reverted.images![0].tint).toBe(wash);
  });
});

describe('setBackground op', () => {
  const paint: Paint = { kind: 'radial', stops: [
    { offset: 0, color: { r: 20, g: 20, b: 40 } },
    { offset: 1, color: { r: 0, g: 0, b: 0 } },
  ], cx: 0.5, cy: 0.5, r: 1 };

  test('sets the background from undefined; revert clears it', () => {
    const state = makeState();
    expect(state.background).toBeUndefined();
    const entry: CompUndoEntry = [{ op: 'setBackground', oldPaint: undefined, newPaint: paint }];
    const after = applyCompOps(state, entry);
    expect(after.background).toBe(paint);
    const reverted = revertCompOps(after, entry);
    expect(reverted.background).toBeUndefined();
  });

  test('replaces an existing background; revert restores it', () => {
    const solid: Paint = { kind: 'solid', color: { r: 255, g: 255, b: 255 } };
    const state = makeState({ background: solid });
    const entry: CompUndoEntry = [{ op: 'setBackground', oldPaint: solid, newPaint: paint }];
    const after = applyCompOps(state, entry);
    expect(after.background).toBe(paint);
    const reverted = revertCompOps(after, entry);
    expect(reverted.background).toBe(solid);
  });
});

describe('replaceScene with texts', () => {
  test('swaps oldTexts/newTexts and round-trips', () => {
    const txtA = makeText('txt_a');
    const txtB = makeText('txt_b', { content: 'replacement' });
    const state = makeState({ texts: [txtA] });
    const entry: CompUndoEntry = [{
      op: 'replaceScene',
      oldFigures: [], newFigures: [],
      oldSVGObjects: [], newSVGObjects: [],
      oldImages: [], newImages: [],
      oldGroups: [], newGroups: [],
      oldSceneOrder: ['txt_a'], newSceneOrder: ['txt_b'],
      oldTexts: [txtA], newTexts: [txtB],
    }];
    const after = applyCompOps(state, entry);
    expect(after.texts).toEqual([txtB]);
    expect(after.sceneOrder).toEqual(['txt_b']);
    const reverted = revertCompOps(after, entry);
    expect(reverted.texts).toEqual([txtA]);
    expect(reverted.sceneOrder).toEqual(['txt_a']);
  });

  test('replaceScene WITHOUT texts leaves state.texts untouched (pre-text entries)', () => {
    const txtA = makeText('txt_a');
    const figA = makeFigure('f1');
    const figB = makeFigure('f2');
    const state = makeState({ figures: [figA], texts: [txtA], sceneOrder: ['f1', 'txt_a'] });
    const entry: CompUndoEntry = [{
      op: 'replaceScene',
      oldFigures: [figA], newFigures: [figB],
      oldSVGObjects: [], newSVGObjects: [],
      oldImages: [], newImages: [],
      oldGroups: [], newGroups: [],
      oldSceneOrder: ['f1', 'txt_a'], newSceneOrder: ['f2', 'txt_a'],
      // No oldTexts / newTexts: a pre-v29 undo entry.
    }];
    const after = applyCompOps(state, entry);
    expect(after.figures).toEqual([figB]);
    expect(after.texts).toBe(state.texts); // untouched, not wiped
    const reverted = revertCompOps(after, entry);
    expect(reverted.figures).toEqual([figA]);
    expect(reverted.texts).toBe(state.texts);
  });
});
