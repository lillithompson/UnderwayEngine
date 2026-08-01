import type { OutlineObject } from '../adapter';

// Pure scene-outline TREE math (no react-native), unit-tested in node.
//
// The outline is a Figma-style tree: containers (groups/frames) are their own
// rows, with their contents shown indented BELOW them. Every row — leaf or
// group — is an `OutlineObject` keyed by id, and nesting is expressed purely by
// `parentGroupId` (a leaf's immediate group, or a group's own parent group).
// A group row has `kind === 'group'`; groups are NOT present in `sceneOrder`
// (only leaves are), so a group's display position is derived from its leaves.
//
// Display order is top→bottom = front→back, the reverse of the engine's
// back→front `sceneOrder` — same convention the old flat block list used.

export interface OutlineTreeNode {
  id: string;
  isGroup: boolean;
  /** Container chrome (a frame's clip-rect boundary): part of the tree/order
   *  but never shown as a row. */
  chrome: boolean;
  /** Children in display order (top→bottom). Empty for leaves. */
  children: OutlineTreeNode[];
}

/** One visible row after applying collapse state. */
export interface FlatOutlineRow {
  id: string;
  /** Nesting depth from the roots (0 = top level). Drives indentation. */
  depth: number;
  isGroup: boolean;
  hasChildren: boolean;
}

/**
 * Build the outline forest from the normalized objects + back→front
 * `sceneOrder`. Roots are objects with no `parentGroupId`; a group's children
 * are objects whose `parentGroupId` is that group's id. Siblings are ordered
 * by their front-most position (largest `sceneOrder` index first = top), where
 * a leaf's position is its own index and a group's is the max index over its
 * leaf descendants (groups cluster contiguously, so any in-range representative
 * orders them correctly against sibling leaves). Objects referencing a missing
 * parent are treated as roots; stale ids are ignored.
 */
export function computeOutlineTree(
  objects: ReadonlyMap<string, OutlineObject>,
  sceneOrder: readonly string[],
): OutlineTreeNode[] {
  const leafIndex = new Map<string, number>();
  sceneOrder.forEach((id, i) => leafIndex.set(id, i));

  // Direct children (ids) per parent group, plus the root set.
  const childrenOf = new Map<string, string[]>();
  const roots: string[] = [];
  for (const obj of objects.values()) {
    const pid = obj.parentGroupId;
    if (pid !== undefined && objects.has(pid)) {
      const list = childrenOf.get(pid);
      if (list) list.push(obj.id);
      else childrenOf.set(pid, [obj.id]);
    } else {
      roots.push(obj.id);
    }
  }

  // Front-most position of a node (memoized): leaf → its index; group → max
  // over descendant leaves (−1 when it has none, so empty groups sink).
  const frontPos = new Map<string, number>();
  const computeFrontPos = (id: string): number => {
    const cached = frontPos.get(id);
    if (cached !== undefined) return cached;
    frontPos.set(id, -1); // cycle guard
    const obj = objects.get(id);
    let pos: number;
    if (obj && obj.kind === 'group') {
      let max = -1;
      for (const childId of childrenOf.get(id) ?? []) max = Math.max(max, computeFrontPos(childId));
      pos = max;
    } else {
      pos = leafIndex.get(id) ?? -1;
    }
    frontPos.set(id, pos);
    return pos;
  };

  const buildNode = (id: string): OutlineTreeNode => {
    const obj = objects.get(id);
    const isGroup = obj?.kind === 'group';
    const childIds = isGroup ? (childrenOf.get(id) ?? []).slice() : [];
    childIds.sort((a, b) => computeFrontPos(b) - computeFrontPos(a));
    return { id, isGroup, chrome: !!obj?.chrome, children: childIds.map(buildNode) };
  };

  roots.sort((a, b) => computeFrontPos(b) - computeFrontPos(a));
  return roots.map(buildNode);
}

/**
 * Flatten the tree to visible rows in display order, omitting the descendants
 * of any group whose id is in `collapsed`.
 */
export function flattenTree(
  roots: readonly OutlineTreeNode[],
  collapsed: ReadonlySet<string>,
): FlatOutlineRow[] {
  const rows: FlatOutlineRow[] = [];
  const walk = (node: OutlineTreeNode, depth: number) => {
    if (node.chrome) return; // container chrome — never a row
    // Only non-chrome children count toward the expand/collapse affordance.
    const visibleChildren = node.children.filter((c) => !c.chrome);
    const hasChildren = visibleChildren.length > 0;
    rows.push({ id: node.id, depth, isGroup: node.isGroup, hasChildren });
    if (node.isGroup && hasChildren && !collapsed.has(node.id)) {
      for (const child of visibleChildren) walk(child, depth + 1);
    }
  };
  for (const root of roots) walk(root, 0);
  return rows;
}

/**
 * Serialize the (full, collapse-independent) tree back to a back→front
 * `sceneOrder` of leaf ids. Groups are not emitted (they aren't in sceneOrder).
 * Contiguous by construction: each group's leaves form one run.
 */
export function treeToSceneOrder(roots: readonly OutlineTreeNode[]): string[] {
  const displayLeaves: string[] = []; // top→bottom = front→back
  const walk = (node: OutlineTreeNode) => {
    if (node.isGroup) {
      for (const child of node.children) walk(child);
    } else {
      displayLeaves.push(node.id);
    }
  };
  for (const root of roots) walk(root);
  displayLeaves.reverse(); // → back→front
  return displayLeaves;
}

/**
 * Move `draggedId` (with its whole subtree) under `parentId` (null = top
 * level), inserted before the direct child `beforeId` (null = append last),
 * and return the resulting back→front `sceneOrder`. Pure: operates on a clone.
 * A no-op (dragged id absent) returns the tree's current order.
 */
export function reparentToSceneOrder(
  roots: readonly OutlineTreeNode[],
  draggedId: string,
  parentId: string | null,
  beforeId: string | null,
): string[] {
  const clone = (n: OutlineTreeNode): OutlineTreeNode => ({ ...n, children: n.children.map(clone) });
  const newRoots = roots.map(clone);

  let dragged: OutlineTreeNode | null = null;
  const detach = (list: OutlineTreeNode[]): boolean => {
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === draggedId) { dragged = list[i]; list.splice(i, 1); return true; }
      if (detach(list[i].children)) return true;
    }
    return false;
  };
  detach(newRoots);
  if (!dragged) return treeToSceneOrder(newRoots);

  let target: OutlineTreeNode[] = newRoots;
  if (parentId !== null) {
    const find = (list: OutlineTreeNode[]): OutlineTreeNode | null => {
      for (const n of list) {
        if (n.id === parentId) return n;
        const r = find(n.children);
        if (r) return r;
      }
      return null;
    };
    const parentNode = find(newRoots);
    if (parentNode) target = parentNode.children;
  }
  const idx = beforeId ? target.findIndex((n) => n.id === beforeId) : -1;
  if (idx >= 0) target.splice(idx, 0, dragged);
  else target.push(dragged);

  return treeToSceneOrder(newRoots);
}
