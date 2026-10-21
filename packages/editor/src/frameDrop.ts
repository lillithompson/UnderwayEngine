import { CompositionState, SVGObject } from '@/engine/types';
import { applyCompOps, findItem } from '@/engine/compositionOps';
import { buildFrameRectMap, frameGroupIdForNode } from '@/engine/compositionFrame';
import { computeOutlineTree, reparentToSceneOrder, OutlineTreeNode } from '@/editor-ui/logic/outlineTree';
import { buildOutlineObjects } from './sceneOutlineModel';
import {
  SessionEntry,
  buildMoveNode,
  buildReparent,
  isFrameLocked,
} from './editorSession';
import { type CellBbox, rotatedAabb } from './resizeMath';

// Figma-style frame membership from on-canvas drags. Dropping an element so it
// overlaps a frame's space makes it a child of that frame; dropping it fully
// outside removes it. One rule covers both directions: after the drag, the
// node belongs to the front-most frame its bounds overlap (or to no frame).
// This applies only to `isFrame` groups — dragging a plain group's member
// around never re-homes it (unless a frame is involved).
//
// The drag commit stays a single undo entry: the moveNode op first, then the
// reparentNode op built AGAINST THE MOVED STATE, so the engine's local-coord
// reconcile sees the final world position and undo reverts both together
// (revertCompOps walks the entry backwards).

/** The frame that currently owns `nodeId` (nearest `isFrame` ancestor), or
 *  null for a node outside any frame. */
export function currentFrameId(state: CompositionState, nodeId: string): string | null {
  const ref = findItem(state, nodeId);
  if (!ref) return null;
  return frameGroupIdForNode(state.groups, ref.item.groupId) ?? null;
}

/** Strict interior overlap — edge-touching boxes count as "fully out". */
function bboxesOverlap(a: CellBbox, b: CellBbox): boolean {
  return a.cellX < b.cellX + b.cellWidth && a.cellX + a.cellWidth > b.cellX
    && a.cellY < b.cellY + b.cellHeight && a.cellY + a.cellHeight > b.cellY;
}

/**
 * The frame that should own `nodeId` after dragging it by (dxCells, dyCells):
 * the front-most unlocked frame whose boundary rect overlaps the node's
 * displaced (rotation-aware) bounds, or null when it lands on no frame.
 * Cheap enough to run per pointermove: pass the render's memoized
 * `buildFrameRectMap` result as `frameRects` to skip recomputing it.
 */
export function dragTargetFrameId(
  state: CompositionState,
  nodeId: string,
  dxCells: number,
  dyCells: number,
  frameRects: ReadonlyMap<string, SVGObject> = buildFrameRectMap(state),
): string | null {
  if (frameRects.size === 0) return null;
  const ref = findItem(state, nodeId);
  if (!ref) return null;
  const { cellX, cellY, cellWidth, cellHeight } = ref.item;
  const angleDeg = (ref.item as { angleDeg?: number }).angleDeg ?? 0;
  const bbox = rotatedAabb(
    { cellX: cellX + dxCells, cellY: cellY + dyCells, cellWidth, cellHeight },
    angleDeg,
  );
  let best: string | null = null;
  let bestIdx = -1;
  for (const [frameId, rect] of frameRects) {
    if (isFrameLocked(state, frameId)) continue; // a locked frame accepts no drops
    if (!bboxesOverlap(bbox, rect)) continue;
    // Front-most boundary wins when frames overlap (matches what the user
    // sees the node dropped onto).
    const idx = state.sceneOrder.indexOf(rect.id);
    if (idx > bestIdx) {
      bestIdx = idx;
      best = frameId;
    }
  }
  return best;
}

function findTreeNode(roots: readonly OutlineTreeNode[], id: string): OutlineTreeNode | null {
  for (const n of roots) {
    if (n.id === id) return n;
    const r = findTreeNode(n.children, id);
    if (r) return r;
  }
  return null;
}

/** Top-most group in `groupId`'s parent chain (itself when already a root). */
function rootAncestorGroupId(state: CompositionState, groupId: string): string {
  let gid = groupId;
  let hops = 0;
  while (hops < 100) {
    const parent = state.groups.find((g) => g.id === gid)?.parentGroupId;
    if (!parent) return gid;
    gid = parent;
    hops++;
  }
  return gid;
}

/**
 * The back→front sceneOrder after re-homing `nodeId` under `newParentId`
 * (null = top level). Into a frame the node lands FRONT-MOST among the
 * frame's children (it was rendered on top while dragging, and this keeps it
 * in front of the frame's boundary rect); out of a frame it lands just in
 * front of the frame it left (Figma's layer placement on both counts).
 */
export function frameDropSceneOrder(
  state: CompositionState,
  nodeId: string,
  newParentId: string | null,
  oldFrameId: string | null,
): string[] {
  const roots = computeOutlineTree(buildOutlineObjects(state), state.sceneOrder);
  let beforeId: string | null = null;
  if (newParentId) {
    // children[] is display order (front→back): inserting before the first
    // child makes the dropped node the frame's front-most member.
    beforeId = findTreeNode(roots, newParentId)?.children[0]?.id ?? null;
  } else if (oldFrameId) {
    beforeId = rootAncestorGroupId(state, oldFrameId);
  }
  return reparentToSceneOrder(roots, nodeId, newParentId, beforeId);
}

/**
 * The canvas drag commit: the move, plus — when the drop changes which frame
 * owns the node — the Figma-style reparent, as ONE undo entry. Falls back to
 * the plain move when membership is unchanged, when the dragged node is a
 * frame's own boundary rect (the frame's surface never leaves its frame), or
 * when the reparent turns out to be a no-op.
 */
export function buildMoveNodeWithFrameReparent(
  state: CompositionState,
  nodeId: string,
  dx: number,
  dy: number,
): SessionEntry | null {
  const moveSe = buildMoveNode(state, nodeId, dx, dy);
  if (!moveSe) return null;
  const frameRects = buildFrameRectMap(state);
  for (const rect of frameRects.values()) {
    if (rect.id === nodeId) return moveSe;
  }
  const from = currentFrameId(state, nodeId);
  const target = dragTargetFrameId(state, nodeId, dx, dy, frameRects);
  if (target === from) return moveSe;
  const moved = applyCompOps(state, moveSe.entry);
  const rep = buildReparent(moved, nodeId, target, frameDropSceneOrder(moved, nodeId, target, from));
  if (!rep) return moveSe;
  return { entry: [...moveSe.entry, ...rep.entry] };
}
