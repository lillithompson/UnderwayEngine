/**
 * A node that CHANGES SIZE by being dragged (dragScale.ts): the host says
 * by how much, and composing that with the move — about the node's own
 * centre, as one undo step, for a single node and for a multi-selection
 * dragged as one — is the same in every app and is the package's.
 *
 * A made-up app whose own node is a BALLOON: the further down the page it
 * is carried the bigger it gets, which is CozyJournal's word sticker in
 * miniature (there a template's mask coverage decides the size).
 */

import { applyCompOps, findItem } from '@/engine/compositionOps';
import type { CompositionState, RGBColor, SVGObject } from '@/engine/types';
import { makeBlankComposition } from '@/editor/blankComposition';
import {
  buildMoveNodes, buildPlaceShape, commitEntry, createEditorSession,
} from '../editorSession';
import {
  buildMoveNodeWithDragScale, buildMoveNodesWithDragScale, dragScaleFactor,
} from '../dragScale';
import { clearSessionHost, installSessionHost } from '../sessionHost';

const INK: RGBColor = { r: 0, g: 0, b: 0 };

/** A balloon grows by a tenth per cell of downward travel; everything else
 *  keeps its size. The host's rule is named by the object, as every app's
 *  is — a name tag here, a hidden record there. */
const BALLOONS = {
  dragScale: (state: CompositionState, nodeId: string, _dx: number, dy: number) => {
    const ref = findItem(state, nodeId);
    const name = (ref?.item as SVGObject | undefined)?.name;
    return name === 'balloon' ? 1 + dy / 10 : 1;
  },
};

function page(): [CompositionState, string, string] {
  let s = createEditorSession(makeBlankComposition('ds1'));
  const a = buildPlaceShape('rect', { cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 }, INK);
  s = commitEntry(s, a);
  const b = buildPlaceShape('rect', { cellX: 10, cellY: 0, cellWidth: 4, cellHeight: 4 }, INK);
  s = commitEntry(s, b);
  const named = {
    ...s.state,
    svgObjects: s.state.svgObjects.map((o): SVGObject => (
      o.id === a.id ? { ...o, name: 'balloon' } : o
    )),
  };
  return [named, a.id!, b.id!];
}

const widthOf = (state: CompositionState, id: string) =>
  (findItem(state, id)!.item as SVGObject).cellWidth;

beforeEach(() => clearSessionHost());
afterEach(() => clearSessionHost());

describe('the factor', () => {
  it('is 1 with no host, and 1 for a node the host does not grow', () => {
    const [state, balloon, plain] = page();
    expect(dragScaleFactor(state, balloon, 0, 10)).toBe(1);
    installSessionHost({ nodes: BALLOONS });
    expect(dragScaleFactor(state, plain, 0, 10)).toBe(1);
    expect(dragScaleFactor(state, balloon, 0, 10)).toBe(2);
  });
});

describe('one node dragged', () => {
  it('moves and scales in ONE entry, and undoes as one step', () => {
    installSessionHost({ nodes: BALLOONS });
    const [state, balloon] = page();
    const se = buildMoveNodeWithDragScale(state, balloon, 0, 10)!;
    const after = applyCompOps(state, se.entry);
    // Carried ten cells down: twice the size, about its own centre.
    expect(widthOf(after, balloon)).toBeCloseTo(8, 6);
    expect(se.entry.length).toBeGreaterThan(1);
  });

  it('is the plain move, untouched, where nothing scales', () => {
    installSessionHost({ nodes: BALLOONS });
    const [state, , plain] = page();
    const se = buildMoveNodeWithDragScale(state, plain, 3, 10)!;
    const after = applyCompOps(state, se.entry);
    expect(widthOf(after, plain)).toBeCloseTo(4, 6);
  });

  it('scales about where the node LANDED, not where it started', () => {
    // The user is looking at where the thing arrived; growing it about the
    // centre it left would walk it away from the finger.
    installSessionHost({ nodes: BALLOONS });
    const [state, balloon] = page();
    const after = applyCompOps(state, buildMoveNodeWithDragScale(state, balloon, 0, 10)!.entry);
    const box = findItem(after, balloon)!.item as SVGObject;
    // Moved to y 10..14, grown to 8 tall about that centre (12).
    expect(box.cellY + box.cellHeight / 2).toBeCloseTo(12, 6);
  });
});

describe('a multi-selection dragged as one', () => {
  it('each member the host grows takes its own scale; the others just move', () => {
    installSessionHost({ nodes: BALLOONS });
    const [state, balloon, plain] = page();
    const se = buildMoveNodesWithDragScale(state, [balloon, plain], 0, 10)!;
    const after = applyCompOps(state, se.entry);
    expect(widthOf(after, balloon)).toBeCloseTo(8, 6);
    expect(widthOf(after, plain)).toBeCloseTo(4, 6);
    // A handful carried together grow just as they would one at a time.
    const alone = applyCompOps(state, buildMoveNodeWithDragScale(state, balloon, 0, 10)!.entry);
    expect(widthOf(after, balloon)).toBeCloseTo(widthOf(alone, balloon), 6);
  });

  it('is the plain multi move where the host grows none of them', () => {
    const [state, balloon, plain] = page();
    const with_ = buildMoveNodesWithDragScale(state, [balloon, plain], 2, 3);
    const without = buildMoveNodes(state, [balloon, plain], 2, 3);
    expect(with_).toEqual(without);
  });

  // The host's own ITEMS ride a mixed drag too (`HostItems.through`, stage
  // 3), and this wrapper has to carry what `buildMoveNodes` attached. A
  // made-up app with a PIN — a thing its document holds, which the scene
  // knows nothing about — selected beside the shapes.
  describe('with the host’s own items in the selection', () => {
    interface Doc { pins: { id: string; x: number; y: number }[] }
    const doc: Doc = { pins: [{ id: 'pin_1', x: 20, y: 20 }] };
    const ITEMS = {
      isHostId: (id: string) => id.startsWith('pin_'),
      itemById: (d: Doc, id: string) => d.pins.find((p) => p.id === id) ?? null,
      items: (d: Doc) => d.pins,
      box: (d: Doc, id: string) => {
        const p = d.pins.find((q) => q.id === id);
        return p ? { cellX: p.x, cellY: p.y, cellWidth: 1, cellHeight: 1 } : null;
      },
      through: (d: Doc, ids: ReadonlySet<string>, m: { e: number; f: number }) => ({
        pins: d.pins.map((p) => (ids.has(p.id) ? { ...p, x: p.x + m.e, y: p.y + m.f } : p)),
      }),
      remove: (d: Doc) => d,
      setGroup: (d: Doc) => d,
      setLocked: (d: Doc) => d,
      duplicate: (d: Doc) => ({ doc: d, ids: [] as string[] }),
      // The op the host would commit: where its pins ended up.
      change: (_before: Doc, after: Doc) => ({ pins: after.pins }),
    };

    beforeEach(() => installSessionHost({ items: ITEMS as never }));

    it('carries the host ops out, beside the shapes’ own entry', () => {
      // The bug this pins (DrawBot's db99d9c8, regressed by stage 5b.4a and
      // caught in its review): the wrapper rebuilt its result as
      // `{ entry }` and dropped `move.hostOps`, so a marquee of a shape AND
      // a loose host item committed the shape and snapped the item back —
      // after the host's layer had already previewed it at the new place.
      // Passing `hostDoc` IN is not carrying `hostOps` OUT, which is why
      // the per-call-site pin in sessionHost.test could not see it.
      const [state, balloon, plain] = page();
      const se = buildMoveNodesWithDragScale(state, [plain, 'pin_1'], 3, -4, doc)!;
      expect(se.hostOps).toEqual({ pins: [{ id: 'pin_1', x: 23, y: 16 }] });
      expect(se.entry.length).toBeGreaterThan(0);
      // The same ops the plain move attaches: the wrapper adds the scales
      // and changes nothing else about them.
      expect(buildMoveNodes(state, [plain, 'pin_1'], 3, -4, doc)!.hostOps)
        .toEqual(se.hostOps);
      void balloon;
    });

    it('commits the item alone, where the scene has nothing to move', () => {
      // `entry` is empty with no scene node selected, and the old reading
      // returned null there — so a drag of host items by themselves
      // committed NOTHING at all.
      const [state] = page();
      const se = buildMoveNodesWithDragScale(state, ['pin_1'], 3, -4, doc);
      expect(se).not.toBeNull();
      expect(se!.entry).toEqual([]);
      expect(se!.hostOps).toEqual({ pins: [{ id: 'pin_1', x: 23, y: 16 }] });
    });

    it('…and still answers null when nothing moves at all', () => {
      const [state] = page();
      expect(buildMoveNodesWithDragScale(state, [], 3, -4, doc)).toBeNull();
    });
  });
});
