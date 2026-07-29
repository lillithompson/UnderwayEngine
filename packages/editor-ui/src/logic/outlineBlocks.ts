import type { OutlineObject } from '../adapter';

// Pure scene-outline block math (no react-native), extracted so it can be
// unit-tested in a node environment. The outline renders one row per
// BLOCK, top→bottom in front→back order (the reverse of the engine's
// back→front `sceneOrder`). Contiguous runs of objects sharing the same
// `parentGroupId` collapse into a single group block; everything else is a
// one-id block. This is the same collapse Facet's SceneOutlinePanel does,
// lifted free of any engine dependency.

export interface OutlineBlock {
  /** Group id when this block is a collapsed group; undefined for a single. */
  groupId?: string;
  /** Member ids in display order (front→back = top→bottom within the block). */
  ids: string[];
}

/** Collapse a back→front `sceneOrder` into display-order blocks. Ids absent
 *  from `objects` (stale sceneOrder entries) are skipped. */
export function computeOutlineBlocks(
  objects: ReadonlyMap<string, OutlineObject>,
  sceneOrder: readonly string[],
): OutlineBlock[] {
  const blocks: OutlineBlock[] = [];
  // Walk front→back (reverse of the back→front paint order).
  for (let i = sceneOrder.length - 1; i >= 0; i--) {
    const id = sceneOrder[i];
    const obj = objects.get(id);
    if (!obj) continue;
    const gid = obj.parentGroupId;
    const prev = blocks[blocks.length - 1];
    if (gid !== undefined && prev && prev.groupId === gid) {
      prev.ids.push(id);
    } else {
      blocks.push(gid !== undefined ? { groupId: gid, ids: [id] } : { ids: [id] });
    }
  }
  return blocks;
}

/** Flatten display-order blocks back into a back→front `sceneOrder`. Inverse
 *  of computeOutlineBlocks' ordering (drop back to paint order on commit). */
export function blocksToSceneOrder(blocks: readonly OutlineBlock[]): string[] {
  const displayIds: string[] = [];
  for (const b of blocks) displayIds.push(...b.ids);
  displayIds.reverse();
  return displayIds;
}
