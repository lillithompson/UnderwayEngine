/**
 * A content edit inside a group pulled off-square (the fifth device bug).
 *
 * Reported as: put objects in a group, scale it non-uniformly, set the
 * stroke widths on the objects — and the objects change position.
 *
 * The shape of it is the one every device bug on this branch has had, a
 * reader that had not moved onto the graph. `toLegacyView` mints a fresh
 * leaf object for every leaf a pose op moved, and the nodes' `content`
 * still points at the leaf they were READ from, so
 * `regraphChangedLeaves`' copy-on-write identity test called the whole
 * page changed and read every leaf back in through the legacy fields.
 * That round trip is lossy in exactly one place: a member of a
 * non-uniformly scaled group is SHEARED, and an upright box plus an angle
 * cannot say shear. So a stroke width moved every member of the group,
 * including the members it had not been applied to.
 *
 * The assertions are on the DRAWN quad — the world corners of each node's
 * content box — because that is what the user watched move, and because
 * the legacy arrays agree with themselves either way: the path segments
 * come back identical while the box and the transform they are split
 * across do not.
 */

import { applyCompOps, revertCompOps, withSceneGraph } from '../compositionOps';
import { getNode, worldMatrix } from '../sceneGraph';
import { localContentBox } from '../sceneHitFrame';
import { matApplyCorners } from '../sceneTransform';
import {
  CompUndoEntry, CompositionState, ImageObject, SVGObject, TextObject, makeViewport,
} from '../types';

jest.mock('@/native-shell/bridge/webBridge', () => ({ logToNative: jest.fn() }));

// ── A scene of one group, its members turned off the axes ──────────────

function makeState(overrides: Partial<CompositionState> = {}): CompositionState {
  return {
    id: 'test', name: 'test',
    figures: [], svgObjects: [], images: [], texts: [],
    paintObjects: [], patternObjects: [], imageBlobs: {},
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 }, customColors: [],
    groups: [], sceneOrder: [],
    gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(), activeFigureKey: null,
    compTool: 'select', createRegion: null, renderGeneration: 0,
    ...overrides,
  };
}

/** A 4 x 3 rectangle at (x, y), turned off the quarters so a group scaled
 *  off-square shears it — the case the legacy fields cannot hold. */
function svg(id: string, x: number, y: number): SVGObject {
  return {
    id, color: { r: 0, g: 0, b: 0 }, angleDeg: 37,
    segments: [
      { kind: 'line', start: [x, y], end: [x + 4, y] },
      { kind: 'line', start: [x + 4, y], end: [x + 4, y + 3] },
      { kind: 'line', start: [x + 4, y + 3], end: [x, y + 3] },
      { kind: 'line', start: [x, y + 3], end: [x, y] },
    ],
    cellX: x, cellY: y, cellWidth: 4, cellHeight: 3,
  } as SVGObject;
}

const image = (id: string, x: number, y: number): ImageObject => ({
  id, imageId: 'blob', mimeType: 'image/png', pixelWidth: 40, pixelHeight: 30,
  cellX: x, cellY: y, cellWidth: 4, cellHeight: 3, angleDeg: 37,
});

const text = (id: string, x: number, y: number): TextObject => ({
  id, content: 'hi',
  style: { fontId: 'CozySans', size: 2, color: { r: 0, g: 0, b: 0 } },
  cellX: x, cellY: y, cellWidth: 4, cellHeight: 2, angleDeg: 37,
});

const IDS = ['svg_1', 'svg_2', 'img_1', 'txt_1'];

const scene = () => withSceneGraph(makeState({
  svgObjects: [svg('svg_1', 2, 2), svg('svg_2', 10, 8)],
  images: [image('img_1', 2, 12)],
  texts: [text('txt_1', 12, 2)],
  sceneOrder: IDS,
}));

const groupOp: CompUndoEntry = [
  { op: 'groupFigures', figureIds: IDS, groupId: 'g1', groupName: 'g1' },
];

/** Scale the group: `sy` off `sx` is the whole point. */
function scaleGroup(state: CompositionState, sx: number, sy: number): CompositionState {
  const from = getNode(state.graph!, 'g1')!.transform;
  return applyCompOps(state, [{
    op: 'setTransform', nodeId: 'g1', from, to: { ...from, sx, sy },
  }]);
}

/** The four world corners of a node's content box: what the layer draws
 *  the leaf inside, and what the selection outline rings. */
function quad(state: CompositionState, id: string): string {
  const node = getNode(state.graph!, id)!;
  return JSON.stringify(
    matApplyCorners(worldMatrix(state.graph!, id), localContentBox(node))
      .map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]),
  );
}

const quads = (state: CompositionState) =>
  Object.fromEntries(IDS.map((id) => [id, quad(state, id)]));

/** The stroke-width commit, in the shape the Stroke bar builds it: one
 *  `replaceScene` whose arrays are the current ones with a `stroke` block
 *  on one svg. */
function setStroke(state: CompositionState, id: string, width: number): CompositionState {
  const svgObjects = state.svgObjects.map((o) => (o.id === id ? { ...o, stroke: { width } } : o));
  return applyCompOps(state, [{
    op: 'replaceScene',
    oldFigures: state.figures, newFigures: state.figures,
    oldSVGObjects: state.svgObjects, newSVGObjects: svgObjects,
    oldImages: state.images!, newImages: state.images!,
    oldGroups: state.groups, newGroups: state.groups,
    oldSceneOrder: state.sceneOrder, newSceneOrder: state.sceneOrder,
    oldTexts: state.texts!, newTexts: state.texts!,
  }]);
}

const grouped = (sx: number, sy: number): CompositionState =>
  scaleGroup(applyCompOps(scene(), groupOp), sx, sy);

describe('a stroke width does not move the group', () => {
  for (const [label, sx, sy] of [
    ['uniform', 2, 2], ['off-square', 2, 1], ['off-square the other way', 0.5, 2],
  ] as const) {
    test(label, () => {
      const before = grouped(sx, sy);
      expect(quads(setStroke(before, 'svg_1', 0.4))).toEqual(quads(before));
    });
  }

  test('nor does one applied to every member in turn', () => {
    // The bar applies to a whole selection and each commit is its own
    // entry, so read the page after all of them rather than after the
    // first: the damage compounded.
    let s = grouped(2, 1);
    const q0 = quads(s);
    for (const width of [0.2, 0.3, 0.4]) {
      s = setStroke(s, 'svg_1', width);
      s = setStroke(s, 'svg_2', width);
    }
    expect(quads(s)).toEqual(q0);
  });

  test('nor does undoing one', () => {
    // A revert reaches the arrays through `revertOpInner`, which used to
    // delegate to the RECONCILING `applyOp`. That stamped `local*` caches
    // onto every grouped leaf — fields the view does not write — so the
    // graph read the whole page in again on the way back out and the
    // group moved on undo instead of on the edit.
    const before = grouped(2, 1);
    const entry: CompUndoEntry = [{
      op: 'replaceScene',
      oldFigures: before.figures, newFigures: before.figures,
      oldSVGObjects: before.svgObjects,
      newSVGObjects: before.svgObjects.map((o) => (o.id === 'svg_1'
        ? { ...o, stroke: { width: 0.4 } } : o)),
      oldImages: before.images!, newImages: before.images!,
      oldGroups: before.groups, newGroups: before.groups,
      oldSceneOrder: before.sceneOrder, newSceneOrder: before.sceneOrder,
      oldTexts: before.texts!, newTexts: before.texts!,
    }];
    const back = revertCompOps(applyCompOps(before, entry), entry);
    expect(back.svgObjects.find((o) => o.id === 'svg_1')!.stroke).toBeUndefined();
    expect(quads(back)).toEqual(quads(before));
  });

  test('nor does editing the TEXT, whose type carries a world size', () => {
    // The awkward kind. A scaled node's content holds its world-unit
    // lengths at scale 1 and the view writes them out scaled
    // (`scaleContentLengths`), so a content spelling taken from the view
    // would have the scale applied twice — and one taken from the node's
    // own content comes back as an equal COPY of the style object rather
    // than the same one. Both are why the probe tries two spellings and
    // compares by value.
    const before = grouped(2, 1);
    const sizes = before.texts!.map((t) => t.style.size);
    const after = applyCompOps(before, [{
      op: 'replaceScene',
      oldFigures: before.figures, newFigures: before.figures,
      oldSVGObjects: before.svgObjects, newSVGObjects: before.svgObjects,
      oldImages: before.images!, newImages: before.images!,
      oldGroups: before.groups, newGroups: before.groups,
      oldSceneOrder: before.sceneOrder, newSceneOrder: before.sceneOrder,
      oldTexts: before.texts!,
      newTexts: before.texts!.map((t) => ({ ...t, name: 'renamed' })),
    }]);
    expect(after.texts!.map((t) => t.style.size)).toEqual(sizes);
    expect(after.texts![0].name).toBe('renamed');
    expect(quads(after)).toEqual(quads(before));
  });

  test('the edit still lands', () => {
    const after = setStroke(grouped(2, 1), 'svg_1', 0.4);
    expect(after.svgObjects.find((o) => o.id === 'svg_1')!.stroke).toEqual({ width: 0.4 });
    expect(after.svgObjects.find((o) => o.id === 'svg_2')!.stroke).toBeUndefined();
  });

  test('a member the edit did not name keeps its very node', () => {
    // The fix stated directly: a content op is as local to the graph as
    // it is to the arrays. Identity, because a re-read that happened to
    // land on the same pose would still tell every memoised reader on the
    // page that the leaf had changed.
    const before = grouped(2, 1);
    const after = setStroke(before, 'svg_1', 0.4);
    for (const id of ['svg_2', 'img_1', 'txt_1']) {
      expect(getNode(after.graph!, id)).toBe(getNode(before.graph!, id));
    }
    expect(getNode(after.graph!, 'svg_1')).not.toBe(getNode(before.graph!, 'svg_1'));
  });
});

describe('a pose the arrays DO carry still reads back', () => {
  test('a move written straight into the arrays moves the node', () => {
    // The other half of the contract: a leaf that really moved must still
    // be read in again. Written as the legacy reducer writes it — new
    // world fields on the array object — which is what every op the
    // bridge does not translate does.
    const before = grouped(2, 2);
    const shift = (o: SVGObject): SVGObject => ({
      ...o,
      cellX: o.cellX + 5,
      segments: o.segments.map((sg) => ({
        ...sg,
        start: [sg.start[0] + 5, sg.start[1]] as [number, number],
        end: [sg.end[0] + 5, sg.end[1]] as [number, number],
      })),
    });
    const moved = applyCompOps(before, [{
      op: 'replaceScene',
      oldFigures: before.figures, newFigures: before.figures,
      oldSVGObjects: before.svgObjects,
      newSVGObjects: before.svgObjects.map((o) => (o.id === 'svg_2' ? shift(o) : o)),
      oldImages: before.images!, newImages: before.images!,
      oldGroups: before.groups, newGroups: before.groups,
      oldSceneOrder: before.sceneOrder, newSceneOrder: before.sceneOrder,
      oldTexts: before.texts!, newTexts: before.texts!,
    }]);
    expect(quad(moved, 'svg_2')).not.toEqual(quad(before, 'svg_2'));
    expect(quad(moved, 'svg_1')).toEqual(quad(before, 'svg_1'));
  });
});
