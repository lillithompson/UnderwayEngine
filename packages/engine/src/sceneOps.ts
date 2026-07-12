/**
 * Scene-graph operations: pure functions that produce an updated node map
 * by rewriting Transform2D fields on scene nodes (inputs are never
 * mutated). Every operation returns the updated node map plus an undo
 * entry that can revert the change.
 *
 * Key design properties:
 * - ALL operations (grouped or ungrouped) just modify the target node's
 *   transform. No materialization. No identity stash. No dual-update.
 * - Grouping/ungrouping only changes parentId and transform — child
 *   geometry is never touched.
 * - Undo is symmetric: apply and revert swap old/new transform values.
 */

import {
  AnySceneNode, GroupNode2,
} from './types';
import {
  Transform2D, IDENTITY,
  compose,
} from './transform2d';

// ── Undo op types ──────────────────────────────────────────────────────

export type SceneUndoOp =
  | { op: 'setTransform'; nodeId: string; oldTransform: Transform2D; newTransform: Transform2D }
  | { op: 'addNode'; node: AnySceneNode }
  | { op: 'removeNode'; node: AnySceneNode }
  | { op: 'setParent'; nodeId: string;
      oldParentId: string | undefined; newParentId: string | undefined;
      oldTransform: Transform2D; newTransform: Transform2D }
  | { op: 'reorder'; oldOrder: string[]; newOrder: string[] };

export type SceneUndoEntry = SceneUndoOp[];

// ── Node map helpers ───────────────────────────────────────────────────

/** Immutably update a single node in the map. */
function setNode(nodes: Map<string, AnySceneNode>, node: AnySceneNode): Map<string, AnySceneNode> {
  const next = new Map(nodes);
  next.set(node.id, node);
  return next;
}

/** Immutably update a node's transform. */
function setTransform(
  nodes: Map<string, AnySceneNode>,
  nodeId: string,
  transform: Transform2D,
): Map<string, AnySceneNode> {
  const node = nodes.get(nodeId);
  if (!node) return nodes;
  return setNode(nodes, { ...node, transform } as AnySceneNode);
}

/** Get all direct children of a node. */
function childrenOf(nodes: Map<string, AnySceneNode>, parentId: string): AnySceneNode[] {
  const children: AnySceneNode[] = [];
  for (const node of nodes.values()) {
    if (node.parentId === parentId) children.push(node);
  }
  return children;
}

// ── Move ───────────────────────────────────────────────────────────────

export interface MoveResult {
  nodes: Map<string, AnySceneNode>;
  undoEntry: SceneUndoEntry;
}

/**
 * Move a node by (dx, dy). Simply adds to the node's transform.tx/ty.
 *
 * For grouped items, the caller decides what to move: the individual
 * item or its root group. This function moves exactly what it's told —
 * no automatic group resolution.
 */
export function moveNode(
  nodes: Map<string, AnySceneNode>,
  nodeId: string,
  dx: number,
  dy: number,
): MoveResult {
  const node = nodes.get(nodeId);
  if (!node) return { nodes, undoEntry: [] };

  const oldTransform = node.transform;
  const newTransform: Transform2D = {
    ...oldTransform,
    tx: oldTransform.tx + dx,
    ty: oldTransform.ty + dy,
  };

  return {
    nodes: setTransform(nodes, nodeId, newTransform),
    undoEntry: [{ op: 'setTransform', nodeId, oldTransform, newTransform }],
  };
}

// ── Rotate ─────────────────────────────────────────────────────────────

/**
 * Rotate a node 90 degrees clockwise. Only modifies the transform's
 * rotation field — geometry stays in local space, no drift possible.
 *
 * For leaf nodes (figures, SVGs, images): rotates the node itself.
 * For groups: rotates the group, which affects all descendants via the
 * transform chain (no materialization needed — cache handles it).
 *
 * The pivot parameter controls where the rotation centers. If provided,
 * the translate is adjusted so the pivot point stays fixed in the
 * parent's coordinate space.
 */
export function rotateNode90CW(
  nodes: Map<string, AnySceneNode>,
  nodeId: string,
  pivot?: { x: number; y: number },
): MoveResult {
  const node = nodes.get(nodeId);
  if (!node) return { nodes, undoEntry: [] };

  const oldTransform = node.transform;
  const newRotation = ((oldTransform.rotation + 90) % 360) as 0 | 90 | 180 | 270;

  let newTx = oldTransform.tx;
  let newTy = oldTransform.ty;

  if (pivot) {
    // Adjust translate so that the pivot point in parent space stays
    // fixed after rotation. The pivot is given in the parent's coordinate
    // system (i.e., the space this node's transform maps into).
    //
    // Before rotation: pivot = tx + R_old * S * local_pivot
    // After rotation:  pivot = tx' + R_new * S * local_pivot
    // So: tx' = pivot - R_new * S * local_pivot
    //        = pivot - (R_new/R_old) * (pivot - tx)
    //
    // For 90 CW: (px-tx, py-ty) -> (-(py-ty), px-tx)
    const rx = pivot.x - oldTransform.tx;
    const ry = pivot.y - oldTransform.ty;
    newTx = pivot.x + ry;
    newTy = pivot.y - rx;
  }

  const newTransform: Transform2D = {
    ...oldTransform,
    tx: newTx,
    ty: newTy,
    rotation: newRotation,
  };

  return {
    nodes: setTransform(nodes, nodeId, newTransform),
    undoEntry: [{ op: 'setTransform', nodeId, oldTransform, newTransform }],
  };
}

// ── Mirror ─────────────────────────────────────────────────────────────

/**
 * Mirror a node on a screen axis. Toggles mirrorH or mirrorV on the
 * node's transform.
 *
 * The pivot parameter adjusts translate so the mirror centers around a
 * point in the parent's coordinate space (e.g., the node's visual center).
 */
export function mirrorNode(
  nodes: Map<string, AnySceneNode>,
  nodeId: string,
  axis: 'h' | 'v',
  pivot?: { x: number; y: number },
): MoveResult {
  const node = nodes.get(nodeId);
  if (!node) return { nodes, undoEntry: [] };

  const oldTransform = node.transform;

  let newTx = oldTransform.tx;
  let newTy = oldTransform.ty;

  if (pivot) {
    // After toggling mirrorH, the node's visual extent flips around
    // tx. To keep the pivot fixed: tx' = 2*pivot - tx (for H axis).
    if (axis === 'h') {
      newTx = 2 * pivot.x - oldTransform.tx;
    } else {
      newTy = 2 * pivot.y - oldTransform.ty;
    }
  }

  const newTransform: Transform2D = {
    ...oldTransform,
    tx: newTx,
    ty: newTy,
    mirrorH: axis === 'h' ? !oldTransform.mirrorH : oldTransform.mirrorH,
    mirrorV: axis === 'v' ? !oldTransform.mirrorV : oldTransform.mirrorV,
  };

  return {
    nodes: setTransform(nodes, nodeId, newTransform),
    undoEntry: [{ op: 'setTransform', nodeId, oldTransform, newTransform }],
  };
}

// ── Scale ──────────────────────────────────────────────────────────────

/**
 * Scale a node by modifying its transform's sx/sy. Used for proportional
 * scaling (e.g., group scale handles).
 *
 * For geometry-level resize (drag handle on a leaf), the caller should
 * modify the node's geometry directly instead (not through this function).
 */
export function scaleNode(
  nodes: Map<string, AnySceneNode>,
  nodeId: string,
  newSx: number,
  newSy: number,
  newTx?: number,
  newTy?: number,
): MoveResult {
  const node = nodes.get(nodeId);
  if (!node) return { nodes, undoEntry: [] };

  const oldTransform = node.transform;
  const newTransform: Transform2D = {
    ...oldTransform,
    sx: newSx,
    sy: newSy,
    tx: newTx ?? oldTransform.tx,
    ty: newTy ?? oldTransform.ty,
  };

  return {
    nodes: setTransform(nodes, nodeId, newTransform),
    undoEntry: [{ op: 'setTransform', nodeId, oldTransform, newTransform }],
  };
}

/**
 * Set a node's full transform (used for group transforms where multiple
 * fields change at once).
 */
export function setNodeTransform(
  nodes: Map<string, AnySceneNode>,
  nodeId: string,
  newTransform: Transform2D,
): MoveResult {
  const node = nodes.get(nodeId);
  if (!node) return { nodes, undoEntry: [] };

  const oldTransform = node.transform;
  return {
    nodes: setTransform(nodes, nodeId, newTransform),
    undoEntry: [{ op: 'setTransform', nodeId, oldTransform, newTransform }],
  };
}

// ── Group ──────────────────────────────────────────────────────────────

export interface GroupResult {
  nodes: Map<string, AnySceneNode>;
  groupId: string;
  undoEntry: SceneUndoEntry;
}

/**
 * Group a set of nodes under a new GroupNode2 with identity transform.
 *
 * Children are reparented to the new group. Their transforms are
 * unchanged — since the group has identity transform, the visual
 * output is identical. No coordinate copying, no backfill.
 *
 * @param childIds IDs of nodes to group (can include other groups)
 * @param groupId ID for the new group node
 * @param groupName Display name for the group
 */
export function groupNodes(
  nodes: Map<string, AnySceneNode>,
  childIds: string[],
  groupId: string,
  groupName: string,
): GroupResult {
  const undoEntry: SceneUndoEntry = [];
  let next = new Map(nodes);

  // Determine parent: all children should share the same parent.
  // Use the first child's parent (caller ensures consistency).
  const firstChild = next.get(childIds[0]);
  const parentId = firstChild?.parentId;

  // Create the group node with identity transform.
  const groupNode: GroupNode2 = {
    kind: 'group',
    id: groupId,
    name: groupName,
    parentId,
    transform: IDENTITY,
  };
  next.set(groupId, groupNode);
  undoEntry.push({ op: 'addNode', node: groupNode });

  // Reparent children to the new group.
  for (const childId of childIds) {
    const child = next.get(childId);
    if (!child) continue;

    const oldParentId = child.parentId;
    const reparented = { ...child, parentId: groupId } as AnySceneNode;
    next.set(childId, reparented);

    undoEntry.push({
      op: 'setParent',
      nodeId: childId,
      oldParentId,
      newParentId: groupId,
      oldTransform: child.transform,
      newTransform: child.transform, // unchanged
    });
  }

  return { nodes: next, groupId, undoEntry };
}

// ── Ungroup ────────────────────────────────────────────────────────────

export interface UngroupResult {
  nodes: Map<string, AnySceneNode>;
  freedIds: string[];
  undoEntry: SceneUndoEntry;
}

/**
 * Ungroup: dissolve a GroupNode2, reparenting its direct children to
 * the group's parent. Each child absorbs the group's transform so
 * visual positions are preserved.
 *
 * child.newTransform = compose(group.transform, child.oldTransform)
 * child.newParentId = group.parentId
 *
 * This is the inverse of groupNodes (when the group was at identity).
 * For groups that have been transformed, the children's transforms
 * change to absorb the group's transform — but world positions stay
 * identical.
 */
export function ungroupNodes(
  nodes: Map<string, AnySceneNode>,
  groupId: string,
): UngroupResult {
  const group = nodes.get(groupId);
  if (!group || group.kind !== 'group') {
    return { nodes, freedIds: [], undoEntry: [] };
  }

  const undoEntry: SceneUndoEntry = [];
  let next = new Map(nodes);
  const freedIds: string[] = [];

  // Reparent direct children, absorbing the group's transform.
  const children = childrenOf(next, groupId);
  for (const child of children) {
    const oldTransform = child.transform;
    const newTransform = compose(group.transform, child.transform);
    const newParentId = group.parentId;

    const updated = { ...child, parentId: newParentId, transform: newTransform } as AnySceneNode;
    next.set(child.id, updated);
    freedIds.push(child.id);

    undoEntry.push({
      op: 'setParent',
      nodeId: child.id,
      oldParentId: groupId,
      newParentId,
      oldTransform,
      newTransform,
    });
  }

  // Remove the group node.
  undoEntry.push({ op: 'removeNode', node: group });
  next.delete(groupId);

  return { nodes: next, freedIds, undoEntry };
}

// ── Undo / Redo ────────────────────────────────────────────────────────

/**
 * Apply an undo entry (forward). Used for redo.
 */
export function applySceneUndoEntry(
  nodes: Map<string, AnySceneNode>,
  entry: SceneUndoEntry,
): Map<string, AnySceneNode> {
  let next = nodes;
  for (const op of entry) {
    switch (op.op) {
      case 'setTransform':
        next = setTransform(next, op.nodeId, op.newTransform);
        break;
      case 'addNode': {
        const m = new Map(next);
        m.set(op.node.id, op.node);
        next = m;
        break;
      }
      case 'removeNode': {
        const m = new Map(next);
        m.delete(op.node.id);
        next = m;
        break;
      }
      case 'setParent': {
        const node = next.get(op.nodeId);
        if (node) {
          next = setNode(next, {
            ...node,
            parentId: op.newParentId,
            transform: op.newTransform,
          } as AnySceneNode);
        }
        break;
      }
      case 'reorder':
        break; // sceneOrder is separate from nodeMap
    }
  }
  return next;
}

/**
 * Revert an undo entry (backward). Used for undo.
 */
export function revertSceneUndoEntry(
  nodes: Map<string, AnySceneNode>,
  entry: SceneUndoEntry,
): Map<string, AnySceneNode> {
  let next = nodes;
  // Apply ops in reverse order
  for (let i = entry.length - 1; i >= 0; i--) {
    const op = entry[i];
    switch (op.op) {
      case 'setTransform':
        next = setTransform(next, op.nodeId, op.oldTransform);
        break;
      case 'addNode': {
        // Undo of addNode = remove
        const m = new Map(next);
        m.delete(op.node.id);
        next = m;
        break;
      }
      case 'removeNode': {
        // Undo of removeNode = add back
        const m = new Map(next);
        m.set(op.node.id, op.node);
        next = m;
        break;
      }
      case 'setParent': {
        const node = next.get(op.nodeId);
        if (node) {
          next = setNode(next, {
            ...node,
            parentId: op.oldParentId,
            transform: op.oldTransform,
          } as AnySceneNode);
        }
        break;
      }
      case 'reorder':
        break;
    }
  }
  return next;
}
