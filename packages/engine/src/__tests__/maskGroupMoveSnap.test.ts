/**
 * Regression: moving a mask-mode group used to snap the *member union* to the
 * grid instead of the mask shape. The selection box hugs the mask, so the move
 * anchor must be the mask's bbox — snapping the larger union left the visible
 * (mask-hugging) box landing off-grid, and the snap was influenced by sibling
 * members the mask had clipped away.
 *
 * The fix: CompositionCanvas.handlePointerDown's move branch now derives the
 * drag anchor from `groupSelectionBounds` (mask-aware), matching the scale
 * anchor, the corner-handle hit-test, and the overlay. This test pins the
 * snap outcome the user sees by feeding both the (correct) mask anchor and the
 * (old, buggy) union anchor through `computeMoveSnapDelta` with the same finger.
 */

import { computeMoveSnapDelta } from '../compositionCellMath';
import { groupSelectionBounds, groupBounds } from '../compositionOps';
import { buildActiveMaskMap } from '../compositionMask';
import { CompositionFigure, GroupNode, PathSegment, SVGObject } from '../types';

function squareSegments(x: number, y: number, size: number): PathSegment[] {
  return [
    { kind: 'line', start: [x, y], end: [x + size, y] },
    { kind: 'line', start: [x + size, y], end: [x + size, y + size] },
    { kind: 'line', start: [x + size, y + size], end: [x, y + size] },
    { kind: 'line', start: [x, y + size], end: [x, y] },
  ];
}

const group: GroupNode = {
  id: 'g', name: 'g', parentGroupId: undefined,
  translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
  rotation: 0, mirrorH: false, mirrorV: false,
};

// Mask bbox (2,2)-(6,6); 2 and 6 are off the L2 grid (step 4).
const mask = {
  id: 'mask', color: { r: 0, g: 0, b: 0 },
  segments: squareSegments(2, 2, 4), localSegments: squareSegments(2, 2, 4),
  cellX: 2, cellY: 2, cellWidth: 4, cellHeight: 4,
  groupId: 'g', isMask: true,
} as unknown as SVGObject;

// Sibling reaches x=13, giving the unmasked union a different mod-4 offset than
// the mask edge — so the two anchors produce visibly different snap deltas.
const sibling = {
  id: 'sibling', cellX: 9, cellY: 2, cellWidth: 4, cellHeight: 4, groupId: 'g',
  localCellX: 9, localCellY: 2, localCellWidth: 4, localCellHeight: 4,
} as unknown as CompositionFigure;

const STEP = 4; // L2

describe('mask-group move snaps the mask, not the member union', () => {
  const maskMap = buildActiveMaskMap({ groups: [group], svgObjects: [mask], sceneOrder: ['mask', 'sibling'] });

  test('anchor is the mask bbox, not the union', () => {
    const maskAnchor = groupSelectionBounds([sibling], 'g', [mask], [], [group], maskMap);
    expect(maskAnchor).toEqual({ minX: 2, minY: 2, maxX: 6, maxY: 6 });
    // The old (buggy) anchor — unmasked union — reached the sibling at x=13.
    const unionAnchor = groupBounds([sibling], 'g', [mask], [mask], [], [group]);
    expect(unionAnchor.maxX).toBe(13);
  });

  test('dragging +X lands the mask edges on the grid', () => {
    const anchor = groupSelectionBounds([sibling], 'g', [mask], [], [group], maskMap);
    // Finger grabs near the mask centre (x=4) and nudges +1 cell.
    const cursorX = 4 + 1;
    const { dx } = computeMoveSnapDelta(anchor, cursorX, 4, 1, 0, STEP, STEP, 1, 0);
    expect(dx).toBe(2); // maxX 6→8, minX 2→4
    expect((anchor.minX + dx) % STEP).toBe(0);
    expect((anchor.maxX + dx) % STEP).toBe(0);
  });

  test('the old union anchor would leave the mask off-grid (the bug)', () => {
    const union = groupBounds([sibling], 'g', [mask], [mask], [], [group]);
    const cursorX = 4 + 1; // same finger as above
    const { dx } = computeMoveSnapDelta(
      { minX: union.minX, minY: union.minY, maxX: union.maxX, maxY: union.maxY },
      cursorX, 4, 1, 0, STEP, STEP, 1, 0,
    );
    // Union edge (13) snaps to a delta of 3, which applied to the mask edge (6)
    // gives 9 — off the grid. This is exactly the visible misalignment we fixed.
    expect(dx).toBe(3);
    expect((6 + dx) % STEP).not.toBe(0);
  });
});
