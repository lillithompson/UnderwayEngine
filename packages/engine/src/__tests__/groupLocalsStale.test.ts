/**
 * Regression: a per-member edit inside a group must survive the next
 * transform of an ancestor.
 *
 * The engine stores a grouped leaf's pose twice — world fields and
 * `local*` caches — and synchronises them opt-in. Most per-member ops
 * (`editImage`, `setNodeRotation`, `editSVGSegments`, the `replaceScene`
 * text/paint/pattern edits, `rotateFigure`, `mirrorFigure`, `scaleFigure`)
 * update world and leave local behind. The damage is invisible until an
 * ancestor is transformed: `materializeGroupMembers` then rewrites world
 * *from* the stale local and the member snaps back to its pre-edit pose.
 *
 * In the product this is "objects inside a group move relative to each
 * other": resize/rotate/twist one member, then drag the frame, and that
 * member jumps. Undoing the frame drag appears to fix it, which reads as
 * random.
 *
 * The three scenarios below are the probe from docs/transform-refactor.md
 * §2.1, one per broken op family. They are the acceptance test for the
 * containment fix (P1: reconcile after every world-mutating op).
 */

import {
  applyCompOps,
  assertGroupLocalsConsistent,
} from '../compositionOps';
import {
  CompositionState, CompUndoEntry, ImageObject, PathSegment,
  SVGObject, TextObject, makeViewport,
} from '../types';

jest.mock('@/native-shell/bridge/webBridge', () => ({
  logToNative: jest.fn(),
}));

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

/**
 * Group the given leaves, exactly as the Group button does: mint the
 * group at identity and let `groupFigures` seed each member's locals
 * from its world pose.
 */
function group(state: CompositionState, ids: string[], groupId = 'g1'): CompositionState {
  const op: CompUndoEntry = [
    { op: 'groupFigures', figureIds: ids, groupId, groupName: groupId },
  ];
  return applyCompOps(state, op);
}

/** Translate a group by (dx, dy) — the op a frame drag commits. */
function translateGroup(
  state: CompositionState, groupId: string, dx: number, dy: number,
): CompositionState {
  const g = state.groups.find((x) => x.id === groupId)!;
  const op: CompUndoEntry = [{
    op: 'transformGroup', groupId,
    oldTranslateX: g.translateX, oldTranslateY: g.translateY,
    oldScaleX: g.scaleX, oldScaleY: g.scaleY,
    oldRotation: g.rotation, oldMirrorH: g.mirrorH, oldMirrorV: g.mirrorV,
    newTranslateX: g.translateX + dx, newTranslateY: g.translateY + dy,
    newScaleX: g.scaleX, newScaleY: g.scaleY,
    newRotation: g.rotation, newMirrorH: g.mirrorH, newMirrorV: g.mirrorV,
  }];
  return applyCompOps(state, op);
}

function makeImage(overrides: Partial<ImageObject> & { id: string }): ImageObject {
  return {
    imageId: 'blob1', mimeType: 'image/png',
    pixelWidth: 40, pixelHeight: 30,
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 3,
    ...overrides,
  };
}

function makeText(overrides: Partial<TextObject> & { id: string }): TextObject {
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

function makeSVG(overrides: Partial<SVGObject> & { id: string }): SVGObject {
  return {
    color: { r: 0, g: 0, b: 0 },
    segments: [line([0, 0], [4, 0])],
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 0,
    ...overrides,
  };
}

describe('a per-member edit survives the next ancestor transform', () => {
  // These three are `test.failing`: they assert the behaviour the product
  // needs and today's engine does not provide, so jest passes them *because*
  // they fail. The containment fix (P1) flips them to plain `test`.

  // ── Scenario A: bbox edit (editImage) ────────────────────────────────
  test.failing('a resized image inside a group keeps its new size when the group moves', () => {
    const img = makeImage({ id: 'img_1' });
    let state = makeState({ images: [img], sceneOrder: ['img_1'] });
    state = group(state, ['img_1']);

    // Double the image's box. `buildEditImageTransformOp` carries the
    // `local*` fields across UNCHANGED from `prev`, so after this op the
    // locals still describe the original 4x3 box.
    state = applyCompOps(state, [{
      op: 'editImage', imageId: 'img_1',
      oldCellX: 0, oldCellY: 0, oldCellWidth: 4, oldCellHeight: 3,
      newCellX: 0, newCellY: 0, newCellWidth: 8, newCellHeight: 6,
    }]);
    expect(state.images![0].cellWidth).toBe(8);

    state = translateGroup(state, 'g1', 1, 0);

    const after = state.images![0];
    expect([after.cellWidth, after.cellHeight]).toEqual([8, 6]);
    expect([after.cellX, after.cellY]).toEqual([1, 0]);
  });

  // ── Scenario B: free rotation (setNodeRotation) ──────────────────────
  test.failing('a twisted text inside a group keeps its angle when the group moves', () => {
    const txt = makeText({ id: 'txt_1' });
    let state = makeState({ texts: [txt], sceneOrder: ['txt_1'] });
    state = group(state, ['txt_1']);

    state = applyCompOps(state, [{
      op: 'setNodeRotation', id: 'txt_1', oldAngleDeg: undefined, newAngleDeg: 30,
    }]);
    expect(state.texts![0].angleDeg).toBe(30);

    state = translateGroup(state, 'g1', 1, 0);

    expect(state.texts![0].angleDeg).toBe(30);
    expect(state.texts![0].cellX).toBe(1);
  });

  // ── Scenario C: geometry rewrite (editSVGSegments) ───────────────────
  test.failing('a quarter-turned line inside a group keeps its turn when the group moves', () => {
    const svg = makeSVG({ id: 'svg_1' });
    let state = makeState({ svgObjects: [svg], sceneOrder: ['svg_1'] });
    state = group(state, ['svg_1']);

    // A 90° turn of a horizontal line, as `rotateSVG90CW` produces it.
    // The host's `buildEditSVGOrientationOp` passes no `newLocalSegments`,
    // so `localSegments` keeps describing the un-turned line.
    const turned: PathSegment[] = [line([2, -2], [2, 2])];
    state = applyCompOps(state, [{
      op: 'editSVGSegments', svgId: 'svg_1',
      oldSegments: [line([0, 0], [4, 0])], newSegments: turned,
      oldLineDirection: 'horizontal', newLineDirection: 'vertical',
    }]);
    expect(state.svgObjects[0].segments).toEqual(turned);

    state = translateGroup(state, 'g1', 1, 0);

    expect(state.svgObjects[0].segments).toEqual([line([3, -2], [3, 2])]);
  });
});

describe('assertGroupLocalsConsistent', () => {
  test('passes for a freshly grouped, untouched scene', () => {
    const img = makeImage({ id: 'img_1' });
    let state = makeState({ images: [img], sceneOrder: ['img_1'] });
    state = group(state, ['img_1']);
    expect(() => assertGroupLocalsConsistent(state)).not.toThrow();
  });

  test('passes for an ungrouped scene', () => {
    const state = makeState({ images: [makeImage({ id: 'img_1' })], sceneOrder: ['img_1'] });
    expect(() => assertGroupLocalsConsistent(state)).not.toThrow();
  });

  test('catches a member whose locals were left behind', () => {
    const img = makeImage({ id: 'img_1' });
    let state = makeState({ images: [img], sceneOrder: ['img_1'] });
    state = group(state, ['img_1']);

    // Hand-forge the exact damage a non-reconciling op does: world moved,
    // locals untouched.
    const stale: CompositionState = {
      ...state,
      images: state.images!.map((i) => ({ ...i, cellWidth: 8, cellHeight: 6 })),
    };
    expect(() => assertGroupLocalsConsistent(stale)).toThrow(/stale/);
  });

  test('names the offending leaf', () => {
    const img = makeImage({ id: 'img_1' });
    let state = makeState({ images: [img], sceneOrder: ['img_1'] });
    state = group(state, ['img_1']);
    const stale: CompositionState = {
      ...state,
      images: state.images!.map((i) => ({ ...i, cellX: 99 })),
    };
    expect(() => assertGroupLocalsConsistent(stale)).toThrow(/img_1/);
  });
});
