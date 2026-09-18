/**
 * `state.sceneOrder` — the one back→front paint order.
 *
 * Split out of `compositionOps.ts` in P7 (docs/transform-refactor-next.md
 * §4). A move only: `compositionOps` re-exports all of it, so no caller
 * changed.
 *
 * It sits on `compositionNodeLookup` and on nothing else in the ops file,
 * which is the whole reason this cut is clean — reordering a scene is a
 * question about ids and group membership, never about geometry.
 */

import { CompositionState, GroupNode } from './types';
import { buildActiveMaskMap } from './compositionMask';
import {
  CompItemRef, allDescendantMemberIds, findItem, findRootGroupId,
  getItemGroupId, groupAncestorChain,
} from './compositionNodeLookup';

// â”€â”€ Scene order (unified backâ†’front paint order) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// `state.sceneOrder` is the single source of truth for paint and hit-test
// across every scene-object kind. The three kind arrays still hold the
// items, but their internal order does not affect what you see â€” that's
// driven entirely by sceneOrder.

/** Build a sceneOrder list from the kind arrays in their legacy fixed
 *  paint order: images (back) â†’ figures â†’ svgObjects â†’ texts (front).
 *  Used to initialize sceneOrder for new state and to migrate older
 *  saves that predate the field. */
export function deriveSceneOrderFromKindArrays(state: {
  figures: readonly { id: string; groupId?: string }[];
  svgObjects: readonly { id: string; groupId?: string }[];
  images?: readonly { id: string; groupId?: string }[];
  texts?: readonly { id: string; groupId?: string }[];
  paintObjects?: readonly { id: string; groupId?: string }[];
  patternObjects?: readonly { id: string; groupId?: string }[];
}): string[] {
  const order: string[] = [];
  for (const i of state.images ?? []) order.push(i.id);
  for (const f of state.figures) order.push(f.id);
  for (const s of state.svgObjects) order.push(s.id);
  for (const t of state.texts ?? []) order.push(t.id);
  for (const p of state.paintObjects ?? []) order.push(p.id);
  for (const p of state.patternObjects ?? []) order.push(p.id);
  return enforceGroupContiguity(order, gatherGroupMemberIds(state));
}

/** Heal a sceneOrder that may be partially out of sync with the kind
 *  arrays: append any kind-array id that is missing, then re-flow so any
 *  group's members stay contiguous. Used at load time to repair files
 *  saved with bugged ops that mutated kind arrays without updating
 *  sceneOrder (e.g. joinLines/joinItems prior to the sceneOrder fix). */
export function repairSceneOrder(state: {
  figures: readonly { id: string; groupId?: string }[];
  svgObjects: readonly { id: string; groupId?: string }[];
  images?: readonly { id: string; groupId?: string }[];
  texts?: readonly { id: string; groupId?: string }[];
  paintObjects?: readonly { id: string; groupId?: string }[];
  patternObjects?: readonly { id: string; groupId?: string }[];
  sceneOrder: readonly string[];
}): string[] {
  const present = new Set(state.sceneOrder);
  const repaired = state.sceneOrder.slice();
  const append = (items: readonly { id: string }[] | undefined) => {
    if (!items) return;
    for (const x of items) if (!present.has(x.id)) { repaired.push(x.id); present.add(x.id); }
  };
  append(state.images);
  append(state.figures);
  append(state.svgObjects);
  append(state.texts);
  append(state.paintObjects);
  append(state.patternObjects);
  return enforceGroupContiguity(repaired, gatherGroupMemberIds(state));
}

/** Build a Map<rootGroupId, member-ids[]> from scene-object kind arrays.
 *  Members are mapped to their ROOT group so all descendants of a nested
 *  hierarchy cluster together in sceneOrder. */
function gatherGroupMemberIds(state: {
  figures: readonly { id: string; groupId?: string }[];
  svgObjects: readonly { id: string; groupId?: string }[];
  images?: readonly { id: string; groupId?: string }[];
  texts?: readonly { id: string; groupId?: string }[];
  paintObjects?: readonly { id: string; groupId?: string }[];
  patternObjects?: readonly { id: string; groupId?: string }[];
  groups?: readonly GroupNode[];
}): Map<string, string[]> {
  // Pre-compute root for each group.
  const groupNodes: readonly GroupNode[] = (state as { groups?: readonly GroupNode[] }).groups ?? [];
  const rootOf = new Map<string, string>();
  for (const g of groupNodes) {
    rootOf.set(g.id, findRootGroupId(groupNodes, g.id));
  }
  const result = new Map<string, string[]>();
  const collect = (items: readonly { id: string; groupId?: string }[]) => {
    for (const x of items) {
      if (!x.groupId) continue;
      const rootGid = rootOf.get(x.groupId) ?? x.groupId;
      const list = result.get(rootGid) ?? [];
      list.push(x.id);
      result.set(rootGid, list);
    }
  };
  collect(state.figures);
  collect(state.svgObjects);
  if (state.images) collect(state.images);
  if (state.texts) collect(state.texts);
  if (state.patternObjects) collect(state.patternObjects);
  return result;
}

/** Re-flow `order` so every group's members are contiguous. Members keep
 *  their relative order within the group. The group as a whole lands at
 *  the position of its earliest member in the input order. */
function enforceGroupContiguity(order: string[], groupMembers: Map<string, string[]>): string[] {
  if (groupMembers.size === 0) return order.slice();
  // For each group, mark every member-id with the index of its earliest
  // appearance in `order`. We then sort by (anchorIndex, originalIndex) so
  // members of the same group cluster around the earliest position while
  // non-grouped items keep their relative order to each other.
  const idToGroup = new Map<string, string>();
  for (const [gid, ids] of groupMembers) for (const id of ids) idToGroup.set(id, gid);
  const groupAnchor = new Map<string, number>();
  for (let i = 0; i < order.length; i++) {
    const gid = idToGroup.get(order[i]);
    if (gid === undefined) continue;
    if (!groupAnchor.has(gid)) groupAnchor.set(gid, i);
  }
  // Stable sort: anchorIndex (or own index for ungrouped), then own index.
  const decorated = order.map((id, i) => {
    const gid = idToGroup.get(id);
    const anchor = gid !== undefined ? groupAnchor.get(gid)! : i;
    return { id, gid, anchor, i };
  });
  decorated.sort((a, b) => {
    if (a.anchor !== b.anchor) return a.anchor - b.anchor;
    // Same anchor â†’ either same group (keep input order) or one item is
    // the group's anchor and the other a stray with the same index (can't
    // happen since indices are unique).
    return a.i - b.i;
  });
  return decorated.map((d) => d.id);
}

/** Iterate scene objects in paint order (backâ†’front). Returns null entries
 *  for any sceneOrder id that no longer resolves â€” caller can filter. */
export function iterateSceneOrder(state: CompositionState): CompItemRef[] {
  const byId = new Map<string, CompItemRef>();
  for (const f of state.figures) byId.set(f.id, { kind: 'figure', item: f });
  for (const s of state.svgObjects) byId.set(s.id, { kind: 'svg', item: s });
  for (const i of state.images ?? []) byId.set(i.id, { kind: 'image', item: i });
  for (const t of state.texts ?? []) byId.set(t.id, { kind: 'text', item: t });
  const out: CompItemRef[] = [];
  for (const id of state.sceneOrder) {
    const ref = byId.get(id);
    if (ref) out.push(ref);
  }
  return out;
}

/** Dev-only invariant: every scene object has exactly one entry in
 *  sceneOrder, sceneOrder has no orphans, and group members are contiguous.
 *  Throws on violation. Cheap enough to run in test paths. */
export function assertSceneOrderInvariant(state: CompositionState): void {
  const live = new Set<string>();
  for (const f of state.figures) live.add(f.id);
  for (const s of state.svgObjects) live.add(s.id);
  for (const i of state.images ?? []) live.add(i.id);
  for (const t of state.texts ?? []) live.add(t.id);
  const seen = new Set<string>();
  for (const id of state.sceneOrder) {
    if (!live.has(id)) throw new Error(`sceneOrder contains orphan id: ${id}`);
    if (seen.has(id)) throw new Error(`sceneOrder has duplicate id: ${id}`);
    seen.add(id);
  }
  for (const id of live) {
    if (!seen.has(id)) throw new Error(`scene object missing from sceneOrder: ${id}`);
  }
  // Group contiguity: walk sceneOrder and ensure each groupId run is
  // unbroken (no two non-adjacent runs of the same groupId).
  const seenGroups = new Set<string>();
  let prevGroup: string | undefined;
  for (const id of state.sceneOrder) {
    const ref = findItem(state, id);
    const gid = ref?.item.groupId;
    if (gid !== prevGroup) {
      if (gid !== undefined) {
        if (seenGroups.has(gid)) throw new Error(`group ${gid} is not contiguous in sceneOrder`);
        seenGroups.add(gid);
      }
      prevGroup = gid;
    }
  }
}

/** Parent group of an OUTLINE node: a group's own `parentGroupId`, or a
 *  leaf's `groupId`. Undefined for a top-level node (or an unknown id). */
function parentGroupOfNode(state: CompositionState, id: string): string | undefined {
  const g = (state.groups ?? []).find((x) => x.id === id);
  if (g) return g.parentGroupId;
  return getItemGroupId(state, id);
}

/** True when `id` names a GroupNode rather than a leaf scene object. */
function isGroupId(state: CompositionState, id: string): boolean {
  return (state.groups ?? []).some((g) => g.id === id);
}

/**
 * Reorder selected scene objects to the back or front, moving whole subtrees
 * so groups stay contiguous in `sceneOrder`. Bumps renderGeneration. `ids` may
 * name leaves OR groups (a scene-outline group / frame row).
 *
 * `scope` picks what "back" and "front" mean:
 *
 * - `'scene'` (default, the canvas selection's meaning): the extremes of the
 *   whole scene. Each id resolves to its ROOT group, so a nested hierarchy
 *   travels as one block.
 * - `'siblings'` (the scene outline's meaning): the extremes of the id's own
 *   parent container. Send-to-back on a node inside a frame drops it to the
 *   bottom of that frame instead of hauling the entire frame to the back of
 *   the page. The scope is the nearest common ancestor group of every id
 *   (undefined = top level, which is the scene and so behaves like `'scene'`),
 *   and each id travels as the ancestor-or-self that is a direct child of that
 *   scope — a node never leaves its parent.
 *
 * Sending to back within a group keeps the group's active mask pinned
 * back-most: for a frame that mask is its boundary rect, which carries the
 * frame's background fill, so a node dropped behind it would vanish under the
 * background. Pinning also keeps mask resolution (back-most `isMask` wins)
 * from silently switching masks.
 */
export function reorderSceneObjects(
  state: CompositionState,
  ids: ReadonlySet<string>,
  position: 'back' | 'front',
  scope: 'scene' | 'siblings' = 'scene',
): CompositionState {
  if (ids.size === 0) return state;

  // Container the move happens inside: undefined = the scene itself.
  let scopeGroupId: string | undefined;
  if (scope === 'siblings') {
    // Longest common root→…→parent prefix over every id's ancestor chain.
    let common: string[] | null = null;
    for (const id of ids) {
      const parent = parentGroupOfNode(state, id);
      const chain = parent
        ? groupAncestorChain(state.groups ?? [], parent).map((g) => g.id).reverse()
        : [];
      if (common === null) { common = chain; continue; }
      let i = 0;
      while (i < common.length && i < chain.length && common[i] === chain[i]) i++;
      common = common.slice(0, i);
    }
    scopeGroupId = common && common.length > 0 ? common[common.length - 1] : undefined;
  }

  // Each id travels as the whole subtree of its ancestor-or-self that sits
  // directly inside the scope (for scene scope that's its ROOT group, which
  // is what keeps a nested hierarchy contiguous when one branch is picked).
  const moved = new Set<string>();
  for (const id of ids) {
    let node = id;
    for (let hops = 0; hops < 100; hops++) {
      const parent = parentGroupOfNode(state, node);
      if (parent === scopeGroupId || parent === undefined) break;
      node = parent;
    }
    if (isGroupId(state, node)) for (const m of allDescendantMemberIds(state, node)) moved.add(m);
    else moved.add(node);
  }
  if (moved.size === 0) return state;

  // Slots this move may rewrite: the scope's leaves (all of sceneOrder at
  // scene scope). Everything outside keeps its exact index.
  const scopeLeaves = scopeGroupId ? new Set(allDescendantMemberIds(state, scopeGroupId)) : null;
  const slots: number[] = [];
  const seq: string[] = [];
  state.sceneOrder.forEach((id, i) => {
    if (scopeLeaves && !scopeLeaves.has(id)) return;
    slots.push(i);
    seq.push(id);
  });

  const movedSeq = seq.filter((id) => moved.has(id));
  if (movedSeq.length === 0) return state;
  const rest = seq.filter((id) => !moved.has(id));

  let pinnedId: string | undefined;
  if (position === 'back' && scopeGroupId) {
    const mask = buildActiveMaskMap(state).get(scopeGroupId);
    if (mask && !moved.has(mask.id)) pinnedId = mask.id;
  }

  const reordered = position === 'back'
    ? [...rest.filter((id) => id === pinnedId), ...movedSeq, ...rest.filter((id) => id !== pinnedId)]
    : [...rest, ...movedSeq];

  const next = state.sceneOrder.slice();
  let changed = false;
  slots.forEach((slot, i) => {
    if (next[slot] !== reordered[i]) changed = true;
    next[slot] = reordered[i];
  });
  if (!changed) return state;
  return { ...state, sceneOrder: next, renderGeneration: state.renderGeneration + 1 };
}

/** Append a freshly-created scene object's id to sceneOrder (front of paint).
 *  No-op if the id is already present. */
export function appendToSceneOrder(state: CompositionState, id: string): CompositionState {
  if (state.sceneOrder.includes(id)) return state;
  return { ...state, sceneOrder: [...state.sceneOrder, id] };
}

/** Splice an id into sceneOrder at the given index (clamped to
 *  [0, sceneOrder.length]). Used by undo-of-delete to restore the
 *  original z-position rather than dropping the item at the back.
 *  No-op if the id is already present. */
export function insertIntoSceneOrder(state: CompositionState, id: string, index: number): CompositionState {
  if (state.sceneOrder.includes(id)) return state;
  const clamped = Math.max(0, Math.min(index, state.sceneOrder.length));
  const next = state.sceneOrder.slice();
  next.splice(clamped, 0, id);
  return { ...state, sceneOrder: next };
}

/** Strip a deleted scene object's id from sceneOrder. */
export function removeFromSceneOrder(state: CompositionState, id: string): CompositionState {
  if (!state.sceneOrder.includes(id)) return state;
  return { ...state, sceneOrder: state.sceneOrder.filter((x) => x !== id) };
}

/** Strip multiple ids in one pass. */
export function removeManyFromSceneOrder(state: CompositionState, ids: ReadonlySet<string>): CompositionState {
  if (ids.size === 0) return state;
  const filtered = state.sceneOrder.filter((x) => !ids.has(x));
  if (filtered.length === state.sceneOrder.length) return state;
  return { ...state, sceneOrder: filtered };
}

/** Collapse a set of source ids in `order` down to a single `resultId` at
 *  the position of the earliest source. Used by join ops. If no source id
 *  is present, append the result at the end (front of paint). */
export function mergeIdsIntoSceneOrder(
  order: readonly string[],
  sourceIds: ReadonlySet<string>,
  resultId: string,
): string[] {
  let anchor = -1;
  for (let i = 0; i < order.length; i++) {
    if (sourceIds.has(order[i])) { anchor = i; break; }
  }
  const filtered = order.filter((id) => !sourceIds.has(id));
  if (anchor < 0) return [...filtered, resultId];
  // `anchor` is the source's position in the original order; after
  // filtering, every preceding non-source id keeps its position, so the
  // anchor index still names the right insertion point.
  return [...filtered.slice(0, anchor), resultId, ...filtered.slice(anchor)];
}

/** After mutating member groupId fields (group / ungroup), re-flow sceneOrder
 *  so every group's members stay contiguous. Cheap: O(n log n) sort over ids. */
export function reflowSceneOrderForGroups(state: CompositionState): CompositionState {
  const reflowed = enforceGroupContiguity(state.sceneOrder, gatherGroupMemberIds(state));
  // Bail if the order didn't change (avoids extra renders on no-op group ops).
  let same = reflowed.length === state.sceneOrder.length;
  if (same) {
    for (let i = 0; i < reflowed.length; i++) {
      if (reflowed[i] !== state.sceneOrder[i]) { same = false; break; }
    }
  }
  if (same) return state;
  return { ...state, sceneOrder: reflowed };
}

/** Snapshot sceneOrder for undo. */
export function captureSceneOrder(state: CompositionState): string[] {
  return state.sceneOrder.slice();
}

/** Restore a previously captured sceneOrder. Bumps renderGeneration. */
export function applySceneOrder(state: CompositionState, order: string[]): CompositionState {
  return { ...state, sceneOrder: order.slice(), renderGeneration: state.renderGeneration + 1 };
}
