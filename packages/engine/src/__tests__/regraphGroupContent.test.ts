/**
 * A group edit survives the next pose op anywhere in the scene.
 *
 * Reported as: moving one object frequently toggles the locked and
 * visibility state of unrelated objects or groups.
 *
 * The shape of it is the one every graph bug has had — a writer that had
 * not moved onto the graph. `lockGroup`, `hideGroup` and `renameGroup` are
 * content ops: the bridge does not translate them, so `runOnGraph`
 * materialises the arrays, applies them there, and hands the result to
 * `regraphChangedLeaves` to read back in. That pass read LEAVES only, so
 * the group nodes went on carrying the flags they were built with. The
 * next pose op — a drag of some other object — re-rendered the whole view
 * out of the graph, and with it the stale group: the lock the user had
 * just set came off, the hidden group reappeared, the rename reverted.
 *
 * `sameSceneShape` cannot catch it: the groups are the same groups in the
 * same places, and only the content moved.
 */

import { applyCompOps, withSceneGraph } from '../compositionOps';
import { CompUndoEntry, CompositionState, SVGObject, makeViewport } from '../types';

jest.mock('@/native-shell/bridge/webBridge', () => ({ logToNative: jest.fn() }));

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

/** A 4 x 3 rectangle at (x, y). */
const svg = (id: string, x: number, y: number): SVGObject => ({
  id, color: { r: 0, g: 0, b: 0 },
  segments: [
    { kind: 'line', start: [x, y], end: [x + 4, y] },
    { kind: 'line', start: [x + 4, y], end: [x + 4, y + 3] },
    { kind: 'line', start: [x + 4, y + 3], end: [x, y + 3] },
    { kind: 'line', start: [x, y + 3], end: [x, y] },
  ],
  cellX: x, cellY: y, cellWidth: 4, cellHeight: 3,
} as SVGObject);

/** `loose` outside any group; `in_a` and `in_b` inside group `g1`. */
function scene(): CompositionState {
  const grouped = withSceneGraph(makeState({
    svgObjects: [svg('loose', 0, 0), svg('in_a', 10, 0), svg('in_b', 10, 8)],
    sceneOrder: ['loose', 'in_a', 'in_b'],
  }));
  return applyCompOps(grouped, [
    { op: 'groupFigures', figureIds: ['in_a', 'in_b'], groupId: 'g1', groupName: 'Hat' },
  ]);
}

const group = (s: CompositionState) => s.groups.find((g) => g.id === 'g1')!;

/** Drag the loose object — a pose op that touches nothing in the group. */
function dragLoose(state: CompositionState): CompositionState {
  const from = state.graph!.nodes.get('loose')!.transform;
  return applyCompOps(state, [{
    op: 'setTransform', nodeId: 'loose', from, to: { ...from, tx: from.tx + 3, ty: from.ty - 1 },
  }]);
}

describe('an unrelated drag leaves a group’s own content alone', () => {
  const cases: Array<[string, CompUndoEntry, (s: CompositionState) => unknown, unknown]> = [
    ['a lock', [{ op: 'lockGroup', id: 'g1', oldValue: false, newValue: true }],
      (s) => group(s).locked, true],
    ['an unlock', [{ op: 'lockGroup', id: 'g1', oldValue: true, newValue: false }],
      (s) => group(s).locked ?? false, false],
    ['a hide', [{ op: 'hideGroup', id: 'g1', oldValue: false, newValue: true }],
      (s) => group(s).hidden, true],
    ['a rename', [{ op: 'renameGroup', groupId: 'g1', oldName: 'Hat', newName: 'Brim' }],
      (s) => group(s).name, 'Brim'],
  ];

  for (const [label, entry, read, want] of cases) {
    test(label, () => {
      // The unlock case needs something to undo: lock it first.
      const base = label === 'an unlock'
        ? applyCompOps(scene(), [{ op: 'lockGroup', id: 'g1', oldValue: false, newValue: true }])
        : scene();
      const edited = applyCompOps(base, entry);
      expect(read(edited)).toEqual(want);
      expect(read(dragLoose(edited))).toEqual(want);
    });
  }

  test('a member’s own lock and hide survive it too', () => {
    const edited = applyCompOps(scene(), [
      { op: 'lockObject', id: 'in_a', oldValue: false, newValue: true },
      { op: 'setObjectHidden', id: 'in_b', oldValue: false, newValue: true },
    ]);
    const after = dragLoose(edited);
    expect(after.svgObjects.find((o) => o.id === 'in_a')!.locked).toBe(true);
    expect(after.svgObjects.find((o) => o.id === 'in_b')!.hidden).toBe(true);
  });
});
