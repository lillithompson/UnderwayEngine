import { applyCompOps, revertCompOps } from '@/engine/compositionOps';
import { PATTERN_SYMMETRY_OFF, RGBColor, SVGObject } from '@/engine/types';
import { makeBlankComposition } from '../blankComposition';
import {
  buildPlaceArcShape,
  buildPlaceLineShape,
  buildPlacePolyline,
} from '../editorSession';
import { withSymmetryCopies } from '../symmetryObjects';

// The canvas Symmetry setting mirrors every VECTOR mark at commit: the
// entry gains one copy per orbit map, each the same object carried through
// the isometry point by point. These pin the copy math; the gesture wiring
// that routes each app's drawing tools through it is pinned in its own tree
// (docs/shared-editor.md §4.2 item 5).

const INK: RGBColor = { r: 10, g: 20, b: 30 };
const FRAME = { cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8 };
const H = { flags: { ...PATTERN_SYMMETRY_OFF, mirrorH: true }, frame: FRAME };
const HV = {
  flags: { ...PATTERN_SYMMETRY_OFF, mirrorH: true, mirrorV: true },
  frame: FRAME,
};
const D1 = { flags: { ...PATTERN_SYMMETRY_OFF, mirrorDiag1: true }, frame: FRAME };

function placedItems(se: NonNullable<ReturnType<typeof withSymmetryCopies>>): SVGObject[] {
  return se.entry.map((op) => {
    if (op.op !== 'placeObject' || op.kind !== 'svg') throw new Error(`unexpected op ${op.op}`);
    return op.item as SVGObject;
  });
}

describe('withSymmetryCopies', () => {
  test('a freehand stroke commits with its mirrored copies in one entry', () => {
    const se = withSymmetryCopies(buildPlacePolyline([[1, 1], [2, 3]], INK), HV, 1)!;
    const items = placedItems(se);
    expect(items).toHaveLength(4);
    // The H copy reflects every point about x = 4.
    const hCopy = items[1];
    expect(hCopy.segments).toEqual([
      { kind: 'line', start: [7, 1], end: [6, 3] },
    ]);
    // Fresh ids, shared ink, recomputed bbox.
    expect(new Set(items.map((i) => i.id)).size).toBe(4);
    expect(hCopy.color).toEqual(INK);
    expect(hCopy).toMatchObject({ cellX: 6, cellY: 1, cellWidth: 1, cellHeight: 2 });
    // The whole orbit reverts as one undo step.
    const state = applyCompOps(makeBlankComposition('c', 'Test'), se.entry);
    expect(state.svgObjects).toHaveLength(4);
    expect(revertCompOps(state, se.entry).svgObjects).toHaveLength(0);
  });

  test('an arc copy is still an arc — start, end and center all map', () => {
    const se = withSymmetryCopies(
      buildPlaceArcShape([1, 1], [2, 2], [1, 2], INK, 'arc'), H, 1,
    )!;
    const items = placedItems(se);
    expect(items).toHaveLength(2);
    const seg = items[1].segments[0];
    if (seg.kind !== 'arc') throw new Error('expected an arc');
    expect(seg.start).toEqual([7, 1]);
    expect(seg.end).toEqual([6, 2]);
    expect(seg.center).toEqual([7, 2]);
  });

  test('an axis-locked line’s metadata follows the transform', () => {
    // A horizontal line under the \ diagonal becomes a vertical one, its
    // creation box carried through the same map.
    const se = withSymmetryCopies(
      buildPlaceLineShape([1, 2], [3, 2], INK, 'line', 0), D1, 1,
    )!;
    const [primary, copy] = placedItems(se);
    expect(primary.lineDirection).toBe('horizontal');
    expect(copy.lineDirection).toBe('vertical');
    expect(copy.creationBox).toBeDefined();
    expect(copy.creationBox!.width).toBeCloseTo(primary.creationBox!.height);
    expect(copy.creationBox!.height).toBeCloseTo(primary.creationBox!.width);
  });

  test('no symmetry, no change', () => {
    const se = buildPlacePolyline([[1, 1], [2, 3]], INK);
    expect(withSymmetryCopies(se, undefined, 1)).toBe(se);
  });
});
