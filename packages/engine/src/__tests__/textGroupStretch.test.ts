/**
 * A TEXT INSIDE A GROUP PULLED OFF SQUARE.
 *
 * Every other kind takes a group's non-uniform scale into its content — a
 * path into its points, an image into its box, a pattern into its bake — so
 * the record says the whole of what the screen draws. A text lays out in
 * its box at its own type size, so a box pulled twice as wide just re-wraps
 * the same letters: the view had to round the scale off to `min(kx, ky)`
 * and drop the rest (docs/transform-refactor.md Q3).
 *
 * The screen was right (the node layer draws the glyphs through the matrix)
 * and the RECORD was wrong, which is what a DUPLICATE and a reopened page
 * read: both came back with the stretch gone. `TextObject.stretchX` (v66)
 * is where it lives now.
 */

import { applyCompOps, buildDuplicateOps, withSceneGraph } from '../compositionOps';
import { fromLegacy, toLegacyView, worldMatrix } from '../sceneGraph';
import { decomposeMatrix } from '../sceneTransform';
import { CompositionState, GroupNode, TextObject, makeViewport } from '../types';
import { setGroupTransform } from './groupTransform.test-utils';

const INK = { r: 0, g: 0, b: 0 };

const text = (over: Partial<TextObject> = {}): TextObject => ({
  id: 'txt_1', content: 'hello', style: { fontId: 'system', size: 2, color: INK },
  cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 2.4, groupId: 'g1', ...over,
});

const group: GroupNode = {
  id: 'g1', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
  rotation: 0, mirrorH: false, mirrorV: false,
} as GroupNode;

function makeState(texts: TextObject[]): CompositionState {
  return {
    id: 't', name: 't',
    figures: [], svgObjects: [], images: [], texts,
    imageBlobs: {},
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: INK, customColors: [],
    groups: [group], sceneOrder: texts.map((t) => t.id),
    gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null, compTool: 'select',
    createRegion: null, renderGeneration: 0,
  } as unknown as CompositionState;
}

/** The world scale a node is drawn at, per axis. */
const scaleOf = (state: CompositionState, id: string) => {
  const t = decomposeMatrix(worldMatrix(state.graph!, id));
  return { sx: Math.abs(t.sx), sy: Math.abs(t.sy) };
};

/** The state after pulling the group `kx` wide and `ky` tall. */
const stretched = (kx: number, ky = 1) =>
  setGroupTransform(withSceneGraph(makeState([text()])), 'g1', { scaleX: kx, scaleY: ky });

describe('the record says what the screen draws', () => {
  test('a sideways pull is a stretch, not a wider box of the same letters', () => {
    const t = stretched(3).texts![0];
    expect(t.cellWidth).toBeCloseTo(24);
    expect(t.cellHeight).toBeCloseTo(2.4);
    // The type is as tall as the box got taller — not at all — and the rest
    // of the pull is the stretch.
    expect(t.style.size).toBeCloseTo(2);
    expect(t.stretchX).toBeCloseTo(3);
  });

  test('a UNIFORM scale still goes into the type size, with no stretch at all', () => {
    const t = stretched(2, 2).texts![0];
    expect(t.style.size).toBeCloseTo(4);
    expect(t.cellWidth).toBeCloseTo(16);
    expect(t.stretchX).toBeUndefined();
  });

  test('a vertical pull grows the type and squeezes it back in x', () => {
    const t = stretched(1, 2).texts![0];
    expect(t.style.size).toBeCloseTo(4);
    expect(t.cellHeight).toBeCloseTo(4.8);
    expect(t.cellWidth).toBeCloseTo(8);
    expect(t.stretchX).toBeCloseTo(0.5);
  });
});

describe('and reading it back draws the same thing', () => {
  test('reopening the page keeps the stretch — it used to lose it', () => {
    const after = stretched(3);
    const before = scaleOf(after, 'txt_1');
    expect(before.sx / before.sy).toBeCloseTo(3);
    const reopened = fromLegacy({ ...after, ...toLegacyView(after.graph!), graph: undefined });
    const now = decomposeMatrix(worldMatrix(reopened, 'txt_1'));
    expect(Math.abs(now.sx) / Math.abs(now.sy)).toBeCloseTo(3);
    // …and the box the glyphs lay out in is the NARROW one, so the line
    // breaks are the reader's and the stretch is on the letters.
    expect(reopened.nodes.get('txt_1')!.localBox!.width).toBeCloseTo(8);
  });

  test('a second pull multiplies with the first instead of replacing it', () => {
    const once = stretched(3);
    const twice = setGroupTransform(once, 'g1', { scaleX: 6 });
    const t = twice.texts![0];
    expect(t.cellWidth).toBeCloseTo(48);
    expect(t.stretchX).toBeCloseTo(6);
    expect(t.style.size).toBeCloseTo(2);
  });

  test('pulling back to square takes the stretch off again', () => {
    const back = setGroupTransform(stretched(3), 'g1', { scaleX: 1 });
    expect(back.texts![0].stretchX).toBeUndefined();
    expect(back.texts![0].cellWidth).toBeCloseTo(8);
  });

  test('the duplicate is stretched too — the reported bug', () => {
    const after = stretched(3);
    const dup = applyCompOps(after, buildDuplicateOps(after, ['txt_1']).ops);
    const copy = dup.texts!.find((t) => t.id !== 'txt_1')!;
    expect(copy.stretchX).toBeCloseTo(3);
    expect(copy.cellWidth).toBeCloseTo(24);
    expect(copy.style.size).toBeCloseTo(2);
  });
});
