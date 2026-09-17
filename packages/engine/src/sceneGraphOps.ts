/**
 * Ops on the scene graph (docs/transform-refactor.md §3.4).
 *
 * Five of them, where the legacy model had nine ways to change a pose:
 *
 * - `setTransform` — every move, turn, flip, scale and twist, of a leaf or
 *   a group, at any depth. A group gesture edits ONE transform; its
 *   children are not touched.
 * - `setParent` — group, ungroup, reparent-by-drag. The child's new local
 *   transform is `inverse(newParentWorld) . oldWorld`, which is exact:
 *   the node does not move, and there is no reconcile pass afterwards
 *   because there is nothing to reconcile.
 * - `reorder`, `addNode`, `removeNode` — structure.
 *
 * Every op carries both sides of the change, so `revertSceneOp` is
 * `applySceneOp` with the sides swapped and needs no separate knowledge.
 * That is the existing engine convention for undo, kept deliberately: an
 * op that can only be applied forwards is an op whose undo drifts.
 */

import {
  LOCAL_IDENTITY, LocalTransform, Mat2D, decomposeMatrix, localMatrix, matInvert, matMul,
  respellMirror,
} from './sceneTransform';
import {
  SceneGraph, SceneNode, ancestors, descendants, worldMatrix,
} from './sceneGraph';

// ── Ops ────────────────────────────────────────────────────────────────

export type SceneOp =
  /** Re-pose a node. The only op any gesture needs. */
  | {
    op: 'setTransform';
    nodeId: string;
    from: LocalTransform;
    to: LocalTransform;
  }
  /** Move a node to a new parent and position, keeping its world pose. */
  | {
    op: 'setParent';
    nodeId: string;
    fromParentId?: string; fromIndex: number; fromTransform: LocalTransform;
    toParentId?: string; toIndex: number; toTransform: LocalTransform;
  }
  /** Re-order one parent's children (or the roots, when `parentId` is
   *  absent). Both orders are carried whole — a child list is short and
   *  a diff would be harder to reason about than the list. */
  | {
    op: 'reorder';
    parentId?: string;
    from: readonly string[];
    to: readonly string[];
  }
  | { op: 'addNode'; node: SceneNode; parentId?: string; index: number }
  | { op: 'removeNode'; node: SceneNode; parentId?: string; index: number }
  /** Replace a node's content payload — colour, text, framing, cells.
   *  Pose never travels this way. */
  | { op: 'setContent'; nodeId: string; from: SceneNode; to: SceneNode };

export type SceneEntry = SceneOp[];

// ── Applying ───────────────────────────────────────────────────────────

export function applySceneOp(graph: SceneGraph, op: SceneOp): SceneGraph {
  switch (op.op) {
    case 'setTransform':
      return withTransform(graph, op.nodeId, op.to);
    case 'setParent':
      return withParent(graph, op.nodeId, op.toParentId, op.toIndex, op.toTransform);
    case 'reorder':
      return withChildOrder(graph, op.parentId, op.to);
    case 'addNode':
      return withNodeAdded(graph, op.node, op.parentId, op.index);
    case 'removeNode':
      return withNodeRemoved(graph, op.node.id);
    case 'setContent':
      return replaceNode(graph, op.to);
  }
}

export function revertSceneOp(graph: SceneGraph, op: SceneOp): SceneGraph {
  switch (op.op) {
    case 'setTransform':
      return withTransform(graph, op.nodeId, op.from);
    case 'setParent':
      return withParent(graph, op.nodeId, op.fromParentId, op.fromIndex, op.fromTransform);
    case 'reorder':
      return withChildOrder(graph, op.parentId, op.from);
    case 'addNode':
      return withNodeRemoved(graph, op.node.id);
    case 'removeNode':
      return withNodeAdded(graph, op.node, op.parentId, op.index);
    case 'setContent':
      return replaceNode(graph, op.from);
  }
}

export function applySceneOps(graph: SceneGraph, entry: SceneEntry): SceneGraph {
  return entry.reduce(applySceneOp, graph);
}

export function revertSceneOps(graph: SceneGraph, entry: SceneEntry): SceneGraph {
  let out = graph;
  for (let i = entry.length - 1; i >= 0; i--) out = revertSceneOp(out, entry[i]);
  return out;
}

// ── Builders ───────────────────────────────────────────────────────────

/**
 * Re-pose a node, keeping both sides for undo.
 *
 * This one op is a move, a turn, a flip, a scale and a twist — of a leaf
 * or of a group. A group drag used to fan out into one `moveNode` per
 * member plus a reconcile pass over the group; here the group's own
 * transform changes and the members are not touched at all.
 */
export function buildSetTransform(
  graph: SceneGraph, nodeId: string, to: LocalTransform,
): SceneOp | null {
  const node = graph.nodes.get(nodeId);
  if (!node) return null;
  return { op: 'setTransform', nodeId, from: node.transform, to };
}

/**
 * Move a node under a new parent without moving it on screen.
 *
 * The new local transform is `inverse(newParentWorld) . oldWorld` —
 * exact, by construction. Grouping, ungrouping and dragging into a frame
 * are all this, which is why none of them needs a reconcile pass and why
 * none of them can leave a member behind.
 *
 * Refuses to put a node inside its own descendant, which would detach
 * that subtree from the scene.
 */
export function buildSetParent(
  graph: SceneGraph, nodeId: string,
  toParentId: string | undefined, toIndex: number,
): SceneOp | null {
  const node = graph.nodes.get(nodeId);
  if (!node) return null;
  if (toParentId === nodeId) return null;
  if (toParentId && descendants(graph, nodeId).some((n) => n.id === toParentId)) return null;

  return {
    op: 'setParent',
    nodeId,
    fromParentId: node.parentId,
    fromIndex: indexOfChild(graph, node.parentId, nodeId),
    fromTransform: node.transform,
    toParentId,
    toIndex,
    toTransform: localUnder(graph, nodeId, toParentId),
  };
}

/** The local transform `nodeId` needs under `parentId` to stay put. */
export function localUnder(
  graph: SceneGraph, nodeId: string, parentId: string | undefined,
): LocalTransform {
  const world = worldMatrix(graph, nodeId);
  if (!parentId) return decomposeMatrix(world);
  const parent = graph.nodes.get(parentId);
  if (!parent) return decomposeMatrix(world);
  try {
    return decomposeMatrix(matMul(matInvert(worldMatrix(graph, parentId)), world));
  } catch {
    // A collapsed ancestor has no inverse. Keeping the node's own
    // transform leaves it somewhere recoverable instead of at the origin.
    return graph.nodes.get(nodeId)?.transform ?? LOCAL_IDENTITY;
  }
}

/** Where `nodeId` sits among its parent's children (or the roots). */
export function indexOfChild(
  graph: SceneGraph, parentId: string | undefined, nodeId: string,
): number {
  const siblings = parentId
    ? graph.nodes.get(parentId)?.children ?? []
    : graph.roots;
  const i = siblings.indexOf(nodeId);
  return i < 0 ? siblings.length : i;
}

/**
 * Group `nodeIds` under a new node: one `addNode` plus one `setParent`
 * each. The group is born at the identity, so every member's local
 * transform is its world one — and every member keeps its world pose by
 * the same exact formula that any other reparent uses.
 */
export function buildGroup(
  graph: SceneGraph, nodeIds: readonly string[], groupId: string, groupName: string,
  opts?: { isFrame?: boolean; transform?: LocalTransform },
): SceneEntry {
  const members = nodeIds.filter((id) => graph.nodes.get(id));
  if (members.length === 0) return [];

  // The group lands under the members' deepest common ancestor, and where
  // the back-most of them sat, so paint order holds. Taking the first
  // member's parent instead would quietly nest a cross-group selection
  // inside whichever member happened to be listed first.
  const parentId = commonAncestor(graph, members);
  const index = Math.min(...members.map(
    (id) => indexOfChild(graph, parentId, outermostUnder(graph, id, parentId)),
  ));

  // The group is born with its transform ALREADY on it, so each member's
  // local pose is computed against the group as it will actually be.
  // Creating it at the identity and transforming it afterwards would move
  // every member by that transform — which is what undoing the ungroup of
  // a transformed group needs to not do.
  const group: SceneNode = {
    id: groupId, kind: 'group', name: groupName,
    parentId, children: [], transform: opts?.transform ?? LOCAL_IDENTITY,
    ...(opts?.isFrame ? { isFrame: true } : {}),
  };

  const entry: SceneEntry = [{ op: 'addNode', node: group, parentId, index }];

  let next = applySceneOp(graph, entry[0]);
  members.forEach((id, i) => {
    const op = buildSetParent(next, id, groupId, i);
    if (!op) return;
    entry.push(op);
    next = applySceneOp(next, op);
  });
  return entry;
}

/**
 * The deepest node that is an ancestor of every one of `ids`, or
 * undefined when they only meet at the root.
 */
export function commonAncestor(
  graph: SceneGraph, ids: readonly string[],
): string | undefined {
  if (ids.length === 0) return undefined;
  const chainOf = (id: string) => [...ancestors(graph, id)].reverse().map((n) => n.id);
  let common = chainOf(ids[0]);
  for (const id of ids.slice(1)) {
    const chain = chainOf(id);
    let i = 0;
    while (i < common.length && i < chain.length && common[i] === chain[i]) i++;
    common = common.slice(0, i);
  }
  return common[common.length - 1];
}

/** Walking up from `id`, the last node still strictly under `parentId`. */
function outermostUnder(
  graph: SceneGraph, id: string, parentId: string | undefined,
): string {
  let cur = id;
  for (const a of ancestors(graph, id)) {
    if (a.id === parentId) break;
    cur = a.id;
  }
  return cur;
}

/**
 * Dissolve a group: every child moves up to the group's parent, in the
 * group's place, then the group node goes. Each child keeps its world
 * pose by the same formula as any other reparent — the inverse
 * composition that grouping applied, undone exactly.
 */
export function buildUngroup(graph: SceneGraph, groupId: string): SceneEntry {
  const group = graph.nodes.get(groupId);
  if (!group || group.kind !== 'group') return [];

  const parentId = group.parentId;
  const at = indexOfChild(graph, parentId, groupId);
  const entry: SceneEntry = [];
  let next = graph;

  (group.children ?? []).forEach((childId, i) => {
    const op = buildSetParent(next, childId, parentId, at + i);
    if (!op) return;
    entry.push(op);
    next = applySceneOp(next, op);
  });

  const emptied = next.nodes.get(groupId);
  if (emptied) {
    entry.push({
      op: 'removeNode', node: emptied, parentId,
      index: indexOfChild(next, parentId, groupId),
    });
  }
  return entry;
}

// ── Graph edits ────────────────────────────────────────────────────────

/** A new graph with `node` in place of whatever had its id. */
function replaceNode(graph: SceneGraph, node: SceneNode): SceneGraph {
  const nodes = new Map(graph.nodes);
  nodes.set(node.id, node);
  return { ...graph, nodes, generation: graph.generation + 1 };
}

function withTransform(
  graph: SceneGraph, nodeId: string, transform: LocalTransform,
): SceneGraph {
  const node = graph.nodes.get(nodeId);
  if (!node) return graph;
  return replaceNode(graph, { ...node, transform });
}

function withChildOrder(
  graph: SceneGraph, parentId: string | undefined, order: readonly string[],
): SceneGraph {
  if (!parentId) {
    return { ...graph, roots: [...order], generation: graph.generation + 1 };
  }
  const parent = graph.nodes.get(parentId);
  if (!parent) return graph;
  return replaceNode(graph, { ...parent, children: [...order] });
}

function withNodeAdded(
  graph: SceneGraph, node: SceneNode, parentId: string | undefined, index: number,
): SceneGraph {
  const nodes = new Map(graph.nodes);
  nodes.set(node.id, { ...node, parentId });
  let roots = graph.roots;

  if (parentId) {
    const parent = nodes.get(parentId);
    if (parent) {
      const children = [...(parent.children ?? [])];
      children.splice(clamp(index, children.length), 0, node.id);
      nodes.set(parentId, { ...parent, children });
    }
  } else {
    const next = [...roots];
    next.splice(clamp(index, next.length), 0, node.id);
    roots = next;
  }
  return { nodes, roots, generation: graph.generation + 1 };
}

/**
 * Remove a node and everything under it.
 *
 * Descendants go too: a group whose node is gone would leave its children
 * pointing at nothing, reachable from no root and invisible — the legacy
 * model needed `pruneEmptyGroups` and `computeAliveGroupIds` to sweep up
 * after exactly that.
 */
function withNodeRemoved(graph: SceneGraph, nodeId: string): SceneGraph {
  const node = graph.nodes.get(nodeId);
  if (!node) return graph;

  const doomed = new Set<string>([nodeId]);
  for (const d of descendants(graph, nodeId)) doomed.add(d.id);

  const nodes = new Map(graph.nodes);
  for (const id of doomed) nodes.delete(id);

  const parent = node.parentId ? nodes.get(node.parentId) : undefined;
  if (parent) {
    nodes.set(parent.id, {
      ...parent,
      children: (parent.children ?? []).filter((id) => id !== nodeId),
    });
  }
  return {
    nodes,
    roots: graph.roots.filter((id) => !doomed.has(id)),
    generation: graph.generation + 1,
  };
}

/**
 * Move a node under a new parent, at a given position, with a given local
 * transform. The transform is passed in rather than derived so that
 * applying and reverting take the same path — an undo that recomputed
 * would be at the mercy of whatever else had changed in between.
 */
function withParent(
  graph: SceneGraph, nodeId: string,
  parentId: string | undefined, index: number, transform: LocalTransform,
): SceneGraph {
  const node = graph.nodes.get(nodeId);
  if (!node) return graph;
  if (parentId && (parentId === nodeId
    || descendants(graph, nodeId).some((n) => n.id === parentId))) {
    return graph;
  }

  const nodes = new Map(graph.nodes);
  // Out of the old place. The roots are filtered whatever the node's
  // `parentId` says: a leaf can arrive pointing at a group that does not
  // exist yet — a duplicate is placed carrying its copy-group's id one op
  // before that group is made — and `fromLegacy` files such a leaf under
  // the roots. Trusting the phantom parent here left the node in the
  // roots AND in its new parent's children, so it rendered twice.
  let roots = graph.roots.filter((id) => id !== nodeId);
  const old = node.parentId ? nodes.get(node.parentId) : undefined;
  if (old) {
    nodes.set(old.id, {
      ...old, children: (old.children ?? []).filter((id) => id !== nodeId),
    });
  }

  nodes.set(nodeId, { ...node, parentId, transform });

  // Into the new one.
  if (parentId) {
    const parent = nodes.get(parentId);
    if (parent) {
      const children = [...(parent.children ?? [])].filter((id) => id !== nodeId);
      children.splice(clamp(index, children.length), 0, nodeId);
      nodes.set(parentId, { ...parent, children });
    }
  } else {
    const next = roots.filter((id) => id !== nodeId);
    next.splice(clamp(index, next.length), 0, nodeId);
    roots = next;
  }
  return { nodes, roots, generation: graph.generation + 1 };
}

function clamp(index: number, length: number): number {
  return Math.max(0, Math.min(Math.floor(index), length));
}

// ── Pose helpers for gestures ──────────────────────────────────────────

/**
 * The world-space delta `(dx, dy)`, expressed in `nodeId`'s parent space.
 *
 * What a drag needs: the user moves things by what they see, and a node
 * inside a turned or scaled group needs that distance in its own parent's
 * axes. One inverse, no per-member special cases.
 */
export function worldDeltaToParent(
  graph: SceneGraph, nodeId: string, dx: number, dy: number,
): [number, number] {
  const node = graph.nodes.get(nodeId);
  const parentId = node?.parentId;
  if (!parentId) return [dx, dy];
  try {
    const inv = matInvert(worldMatrix(graph, parentId));
    return [inv.a * dx + inv.c * dy, inv.b * dx + inv.d * dy];
  } catch {
    return [dx, dy];
  }
}

/** Translate a node by a world-space delta. */
export function buildMoveBy(
  graph: SceneGraph, nodeId: string, dx: number, dy: number,
): SceneOp | null {
  const node = graph.nodes.get(nodeId);
  if (!node) return null;
  const [lx, ly] = worldDeltaToParent(graph, nodeId, dx, dy);
  return buildSetTransform(graph, nodeId, {
    ...node.transform, tx: node.transform.tx + lx, ty: node.transform.ty + ly,
  });
}

/**
 * The nodes a gesture should actually move: the outermost selected
 * ancestor of each, de-duplicated.
 *
 * Dragging a group and one of its members must move the group once, not
 * the group and then the member again on top of it. In the legacy model
 * the fan-out made that a real hazard; here it is one filter.
 */
export function gestureRoots(
  graph: SceneGraph, selected: Iterable<string>,
): string[] {
  const set = new Set(selected);
  const out: string[] = [];
  for (const id of set) {
    if (!graph.nodes.has(id)) continue;
    if (ancestors(graph, id).some((a) => set.has(a.id))) continue;
    out.push(id);
  }
  return out;
}

/**
 * The local transform `nodeId` needs so that its WORLD matrix becomes
 * `gesture . world` — a world-space affine applied on top of where the
 * node already is.
 *
 * This is what every host gesture reduces to. A drag is a translation, a
 * twist is a rotation about the selection centre, a corner resize is a
 * scale about the pinned corner, a flip is a reflection about a frame's
 * middle: each one a matrix in the space the user works in, and each one
 * lands on the node through the same inverse-parent conjugation,
 * `inverse(P) . gesture . P . local`. A node at the root, a leaf three
 * groups deep and the group itself all take it identically, which is why
 * a group gesture is one op on one node.
 *
 * The result is decomposed to the nearest `LocalTransform`, exact
 * whenever the product carries no shear (every gesture the editor makes
 * on a node whose ancestors are similarities). The mirror flags are
 * respelled to `flags` when given, else kept as the node had them, so a
 * flip the user named reads back the way they named it.
 */
export function worldGestureToLocal(
  graph: SceneGraph, nodeId: string, gesture: Mat2D,
  flags?: { mirrorH?: boolean; mirrorV?: boolean },
): LocalTransform | null {
  const node = graph.nodes.get(nodeId);
  if (!node) return null;
  const parent = node.parentId ? worldMatrix(graph, node.parentId) : undefined;
  let inv: Mat2D | undefined;
  if (parent) {
    try { inv = matInvert(parent); } catch { return null; }
  }
  const local = localMatrix(node.transform);
  const next = parent && inv
    ? matMul(inv, matMul(gesture, matMul(parent, local)))
    : matMul(gesture, local);
  return respellMirror(decomposeMatrix(next), flags ?? {
    mirrorH: node.transform.mirrorH, mirrorV: node.transform.mirrorV,
  });
}

/** `setTransform` for {@link worldGestureToLocal}, or null when the node
 *  is missing, its parent chain has collapsed, or nothing would change. */
export function buildWorldGesture(
  graph: SceneGraph, nodeId: string, gesture: Mat2D,
  flags?: { mirrorH?: boolean; mirrorV?: boolean },
): SceneOp | null {
  const to = worldGestureToLocal(graph, nodeId, gesture, flags);
  if (!to) return null;
  return buildSetTransform(graph, nodeId, to);
}

/** The world matrix a node would have under a proposed local transform —
 *  what a live gesture preview draws with, without committing. */
export function previewWorldMatrix(
  graph: SceneGraph, nodeId: string, proposed: LocalTransform,
) {
  const node = graph.nodes.get(nodeId);
  const parentId = node?.parentId;
  const parent = parentId ? worldMatrix(graph, parentId) : undefined;
  const local = localMatrix(proposed);
  return parent ? matMul(parent, local) : local;
}
