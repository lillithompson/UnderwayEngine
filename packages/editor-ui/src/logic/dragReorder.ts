import { OutlineBlock, blocksToSceneOrder } from './outlineBlocks';

// Pure drag-resolution for the scene outline (extracted from the
// PanResponder release handler so it's unit-testable). The panel drags a
// whole block (one row) by `dy` pixels; a group block moves as a unit. The
// result is always a permutation of the input order.

/** Clamp the raw drag delta to a valid block index. */
export function dragTargetIndex(
  fromIndex: number,
  dy: number,
  rowHeight: number,
  blockCount: number,
): number {
  const raw = fromIndex + Math.round(dy / rowHeight);
  return Math.max(0, Math.min(blockCount - 1, raw));
}

/** Resolve a block drag into a new back→front `sceneOrder`. Returns the
 *  (possibly unchanged) permutation of the current order — a no-op drag
 *  (targetIndex === fromIndex) yields the same order the caller passed in. */
export function resolveDragReorder(
  blocks: readonly OutlineBlock[],
  fromIndex: number,
  dy: number,
  rowHeight: number,
): string[] {
  const target = dragTargetIndex(fromIndex, dy, rowHeight, blocks.length);
  const next = blocks.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(target, 0, moved);
  return blocksToSceneOrder(next);
}
