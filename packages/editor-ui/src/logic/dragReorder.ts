import type { OutlineObject } from '../adapter';
import type { FlatOutlineRow } from './outlineTree';

// Pure drag-reparent resolution for the nested scene outline (extracted from
// the PanResponder release handler so it's unit-testable). Figma-style: a row
// drags vertically to a slot AND horizontally to choose a target depth/parent
// (drag right to nest into the group above, left to outdent to an ancestor).
// A group row carries its whole subtree. The result is a reparent target
// (new parent + sibling to insert before) that the caller turns into an
// engine reparent + reordered sceneOrder.

/** Clamp a raw vertical drag delta to a valid visible-row slot. */
export function dragTargetIndex(
  fromIndex: number,
  dy: number,
  rowHeight: number,
  rowCount: number,
): number {
  const raw = fromIndex + Math.round(dy / rowHeight);
  return Math.max(0, Math.min(rowCount - 1, raw));
}

export interface DropTarget {
  /** New parent group id for the dragged row, or null for top level. */
  parentId: string | null;
  /** Direct child of `parentId` to insert the dragged row before (display
   *  order), or null to append as the last child. */
  beforeId: string | null;
  /** Resolved nesting depth of the drop (0 = top level). For the drop
   *  indicator's indent. */
  depth: number;
}

/** Walk `id`'s parent chain to the group at `depth-1` (the parent for a row
 *  dropped at `depth`, anchored under `aboveId` at `aboveDepth`). */
function parentAtDepth(
  objects: ReadonlyMap<string, OutlineObject>,
  aboveId: string,
  aboveDepth: number,
  depth: number,
): string | null {
  let p = objects.get(aboveId)?.parentGroupId ?? null; // depth aboveDepth - 1
  let climbs = aboveDepth - depth;
  while (climbs > 0 && p) { p = objects.get(p)?.parentGroupId ?? null; climbs--; }
  return p;
}

/**
 * Resolve a drag gesture over the visible rows into a reparent target.
 *
 * `dy` moves the row vertically to an insertion slot; `dx` nudges the target
 * depth within the range allowed at that slot (into the group above at its
 * deepest, out to the row below's depth at its shallowest). The dragged row's
 * own subtree (its deeper visible descendants) is excluded from the slot math
 * so a group can't drop inside itself.
 */
export function computeDropTarget(
  rows: readonly FlatOutlineRow[],
  objects: ReadonlyMap<string, OutlineObject>,
  fromIndex: number,
  dy: number,
  dx: number,
  rowHeight: number,
  indent: number,
): DropTarget {
  const dragged = rows[fromIndex];
  // The dragged subtree spans the dragged row + following deeper visible rows.
  let end = fromIndex + 1;
  while (end < rows.length && rows[end].depth > dragged.depth) end++;
  const subtreeLen = end - fromIndex;

  // Rows with the dragged subtree removed.
  const rest = rows.filter((_, i) => i < fromIndex || i >= end);

  // Insertion index among `rest` from the dragged row's post-drag top.
  let ins = Math.round(fromIndex + dy / rowHeight);
  if (ins > fromIndex) ins -= subtreeLen; // account for the removed block above
  ins = Math.max(0, Math.min(rest.length, ins));

  const above = ins > 0 ? rest[ins - 1] : undefined;
  const below = ins < rest.length ? rest[ins] : undefined;

  // Depth range at this slot: into the group above (deepest) … the row below's
  // depth (shallowest, so `below` keeps a valid parent).
  const maxDepth = above ? (above.isGroup ? above.depth + 1 : above.depth) : 0;
  const minDepth = below ? below.depth : 0;
  const depth = Math.max(minDepth, Math.min(maxDepth, maxDepth + Math.round(dx / indent)));

  let parentId: string | null;
  if (!above) {
    parentId = null;
  } else if (depth === above.depth + 1) {
    parentId = above.id; // nest into the group above
  } else {
    parentId = parentAtDepth(objects, above.id, above.depth, depth);
  }

  // Insert before the ancestor-or-self of `below` that is a direct child of
  // `parentId`; if `below` is outside that parent, append (beforeId = null).
  let beforeId: string | null = null;
  if (below) {
    let cur: string | undefined = below.id;
    while (cur) {
      const p: string | null = objects.get(cur)?.parentGroupId ?? null;
      if (p === parentId) { beforeId = cur; break; }
      cur = p ?? undefined;
    }
  }

  return { parentId, beforeId, depth };
}
