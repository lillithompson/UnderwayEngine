/**
 * Finding a node, and asking whether it is locked or hidden.
 *
 * The bottom of `compositionOps`: every function here reads the per-kind
 * arrays and the group list and nothing else — no geometry, no ops, no
 * graph — which is what lets the scene-order module and the ops module
 * both sit on top of it without importing each other.
 *
 * Split out of `compositionOps.ts` in P7 (docs/transform-refactor-next.md
 * §4). A move only: `compositionOps` re-exports all of it, so no caller
 * changed.
 */

import {
  CompositionFigure, CompositionState, CompUndoEntry, GroupNode, ImageObject,
  PaintObject, PatternObject, SVGObject, TextObject,
} from './types';

export type CompItemRef =
  | { kind: 'figure'; item: CompositionFigure }
  | { kind: 'svg';    item: SVGObject }
  | { kind: 'image';  item: ImageObject }
  | { kind: 'text';   item: TextObject }
  | { kind: 'paint';  item: PaintObject }
  | { kind: 'pattern'; item: PatternObject };

/**
 * Single canonical lookup across figures, svgObjects, images, texts, and
 * paintObjects. Selection ids share a namespace (svg ids start with
 * `svg_`, image ids with `img_`, text ids with `txt_`, paint islands with
 * `pnt_`, figures use bare timestamps), so any id resolves to exactly one
 * item.
 */
export function findItem(state: CompositionState, id: string): CompItemRef | null {
  const fig = state.figures.find(f => f.id === id);
  if (fig) return { kind: 'figure', item: fig };
  const svg = state.svgObjects.find(s => s.id === id);
  if (svg) return { kind: 'svg', item: svg };
  const img = (state.images ?? []).find(i => i.id === id);
  if (img) return { kind: 'image', item: img };
  const txt = (state.texts ?? []).find(t => t.id === id);
  if (txt) return { kind: 'text', item: txt };
  const pnt = (state.paintObjects ?? []).find(p => p.id === id);
  if (pnt) return { kind: 'paint', item: pnt };
  const pat = (state.patternObjects ?? []).find(p => p.id === id);
  if (pat) return { kind: 'pattern', item: pat };
  return null;
}

/** A group's OWN lock flag (does not consider ancestors). */
export function isGroupLocked(state: CompositionState, groupId: string): boolean {
  return !!state.groups.find((g) => g.id === groupId)?.locked;
}

/** True when `groupId` OR any of its ancestor groups is locked. Passing a
 *  leaf's `groupId` answers "is this leaf inside a locked group subtree?";
 *  passing a frame's own id answers "is this frame effectively locked?"
 *  (groupAncestorChain includes the group itself). */
export function isGroupChainLocked(state: CompositionState, groupId: string | undefined): boolean {
  if (!groupId) return false;
  for (const g of groupAncestorChain(state.groups, groupId)) {
    if (g.locked) return true;
  }
  return false;
}

/** A leaf's EFFECTIVE lock: its own `locked` flag OR the lock of any group in
 *  its ancestor chain. Locking a group therefore makes every member act as
 *  locked without mutating the members' own flags — an inherited lock. Every
 *  interaction guard (hit-test, move, edit, delete) reads this so children of
 *  a locked frame are inert while their individual lock settings are
 *  preserved. */
export function isItemLocked(state: CompositionState, id: string): boolean {
  const ref = findItem(state, id);
  if (!ref) return false;
  return (ref.item.locked ?? false) || isGroupChainLocked(state, ref.item.groupId);
}

/** A group's OWN hidden flag (does not consider ancestors). */
export function isGroupHidden(state: CompositionState, groupId: string): boolean {
  return !!state.groups.find((g) => g.id === groupId)?.hidden;
}

/**
 * THE inheritance walk both group flags share: every group id carrying
 * `flag`, by its own field or from an ancestor. One O(groups) pass — each
 * chain is walked at most once, since a walk stops at the first
 * already-classified group.
 */
function flaggedGroupIds(
  groups: readonly GroupNode[],
  flag: 'hidden' | 'locked',
): Set<string> {
  const marked = new Set<string>();
  const byId = new Map(groups.map((g) => [g.id, g]));
  for (const g of groups) {
    // Walk to the root, remembering the path so every group on it can be
    // marked in one pass.
    const path: GroupNode[] = [];
    const onPath = new Set<string>(); // cycle guard for a malformed parent chain
    let cur: GroupNode | undefined = g;
    let inherited = false;
    while (cur && !onPath.has(cur.id)) {
      if (marked.has(cur.id)) { inherited = true; break; }
      path.push(cur);
      onPath.add(cur.id);
      if (cur[flag]) { inherited = true; break; }
      cur = cur.parentGroupId ? byId.get(cur.parentGroupId) : undefined;
    }
    if (inherited) for (const p of path) marked.add(p.id);
  }
  return marked;
}

/**
 * THE definition of "hidden" for groups: every group id that is hidden, either
 * by its own `hidden` flag or inherited from an ancestor.
 *
 * Call this ONCE per pass (render, hit-test, export) and test membership in
 * O(1); {@link isGroupChainHidden} wraps it for one-off queries.
 */
export function hiddenGroupIds(groups: readonly GroupNode[]): Set<string> {
  return flaggedGroupIds(groups, 'hidden');
}

/**
 * THE definition of "locked" for groups: every group id that is locked, either
 * by its own `locked` flag or inherited from an ancestor — the set form of
 * {@link isGroupChainLocked}, for a pass that has to ask about many nodes at
 * once (the paint brush's, which tests every object under every dab).
 *
 * Call this ONCE per pass and test membership in O(1).
 */
export function lockedGroupIds(groups: readonly GroupNode[]): Set<string> {
  return flaggedGroupIds(groups, 'locked');
}

/** True when `groupId` OR any of its ancestor groups is hidden. Passing a
 *  leaf's `groupId` answers "is this leaf inside a hidden group subtree?";
 *  passing a frame's own id answers "is this frame effectively hidden?"
 *  Mirror of {@link isGroupChainLocked}. Delegates to {@link hiddenGroupIds}
 *  so there is one implementation of the inheritance rule; prefer that set
 *  directly in any loop over nodes. */
export function isGroupChainHidden(state: CompositionState, groupId: string | undefined): boolean {
  if (!groupId) return false;
  return hiddenGroupIds(state.groups).has(groupId);
}

/** A leaf's EFFECTIVE visibility: its own `hidden` flag OR the hidden flag of
 *  any group in its ancestor chain. Hiding a group therefore makes every
 *  member invisible without mutating the members' own flags — an inherited
 *  hide, exactly like {@link isItemLocked}. Un-hiding the group restores each
 *  member's individual visibility setting. */
export function isItemHidden(state: CompositionState, id: string): boolean {
  const ref = findItem(state, id);
  if (!ref) return false;
  return ((ref.item as { hidden?: boolean }).hidden ?? false)
    || isGroupChainHidden(state, ref.item.groupId);
}

export function getItemGroupId(state: CompositionState, id: string): string | undefined {
  return findItem(state, id)?.item.groupId;
}

export interface GroupHiddenToggle {
  ids: string[];
  newHidden: boolean;
  undoOps: CompUndoEntry;
}

/**
 * Compute the visibility (hidden) toggle for a group/leaf anchor — the single
 * authority behind the Scene Outline's eye toggle.
 *
 * Visibility works exactly like lock (see the `lockGroup` op): it does NOT fan
 * out. A GROUP anchor flips the group's own `hidden` flag, which every member
 * inherits (isItemHidden's ancestor walk) while their individual `hidden`
 * settings stay untouched — so un-hiding the frame restores each child's own
 * visibility rather than revealing everything. A LEAF anchor flips only that
 * leaf, even when it belongs to a group. Null when the anchor resolves to
 * nothing.
 */
export function computeGroupHiddenToggle(
  state: CompositionState,
  anchorId: string,
): GroupHiddenToggle | null {
  const group = state.groups.find((g) => g.id === anchorId);
  if (group) {
    const oldValue = group.hidden ?? false;
    return {
      ids: [anchorId],
      newHidden: !oldValue,
      undoOps: [{ op: 'hideGroup', id: anchorId, oldValue, newValue: !oldValue }],
    };
  }
  const anchor = findItem(state, anchorId);
  if (!anchor) return null;
  const oldValue = (anchor.item as { hidden?: boolean }).hidden ?? false;
  return {
    ids: [anchorId],
    newHidden: !oldValue,
    undoOps: [{ op: 'setObjectHidden', id: anchorId, oldValue, newValue: !oldValue }],
  };
}

// â”€â”€ Nested-group hierarchy helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Walk parentGroupId from `groupId` up to the root. Returns the root group's id. */
export function findRootGroupId(groups: readonly GroupNode[], groupId: string): string {
  const byId = new Map(groups.map(g => [g.id, g]));
  let cur = groupId;
  for (;;) {
    const node = byId.get(cur);
    if (!node || !node.parentGroupId) return cur;
    cur = node.parentGroupId;
  }
}

/** Return the ancestor chain from `groupId` to the root: [self, parent, ..., root]. */
export function groupAncestorChain(groups: readonly GroupNode[], groupId: string): GroupNode[] {
  const byId = new Map(groups.map(g => [g.id, g]));
  const chain: GroupNode[] = [];
  let cur = byId.get(groupId);
  while (cur) {
    chain.push(cur);
    if (!cur.parentGroupId) break;
    cur = byId.get(cur.parentGroupId);
  }
  return chain;
}

/** Return all descendant group IDs (children, grandchildren, ...) of `groupId`. Does NOT include `groupId` itself. */
export function descendantGroupIds(groups: readonly GroupNode[], groupId: string): string[] {
  const children: string[] = [];
  for (const g of groups) {
    if (g.parentGroupId === groupId) {
      children.push(g.id);
      children.push(...descendantGroupIds(groups, g.id));
    }
  }
  return children;
}

/** Return all leaf member IDs (figures + svgs + images + texts) that belong to `groupId` or any of its descendant groups. */
export function allDescendantMemberIds(state: CompositionState, groupId: string): string[] {
  const groupSet = new Set([groupId, ...descendantGroupIds(state.groups, groupId)]);
  return [
    ...state.figures.filter(f => f.groupId && groupSet.has(f.groupId)).map(f => f.id),
    ...state.svgObjects.filter(s => s.groupId && groupSet.has(s.groupId)).map(s => s.id),
    ...(state.images ?? []).filter(i => i.groupId && groupSet.has(i.groupId)).map(i => i.id),
    ...(state.texts ?? []).filter(t => t.groupId && groupSet.has(t.groupId)).map(t => t.id),
    ...(state.paintObjects ?? []).filter(p => p.groupId && groupSet.has(p.groupId)).map(p => p.id),
    ...(state.patternObjects ?? []).filter(p => p.groupId && groupSet.has(p.groupId)).map(p => p.id),
  ];
}
