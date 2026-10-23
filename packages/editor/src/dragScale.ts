import type { CompositionState } from '@/engine/types';
import { applyCompOps } from '@/engine/compositionOps';
import { buildMoveNodeWithFrameReparent } from './frameDrop';
import { type SessionEntry, buildMoveNodes, buildScaleNode } from './editorSession';
import { sessionHost } from './sessionHost';

// A node that CHANGES SIZE by being dragged (sessionHost.ts
// `HostNodeRules.dragScale`): where it lands decides how big it is, so the
// move and the scale are one gesture and one undo step.
//
// Only a host has such a node — CozyJournal's word sticker, carried into a
// template's mask, takes the size that mask's coverage asks for, so a word
// dropped into the narrow neck of a bottle lands small rather than clipped
// — and the host supplies only the FACTOR. Composing it with the move (and
// with the frame reparent the move may carry), about the node's own centre,
// in one entry, for a single node and for a multi-selection dragged as
// one, is the same in every app and is here.
//
// Every builder returns the plain move untouched where nothing scales,
// which is the path every node of every other kind takes.

/** The factor dragging `nodeId` by (`dx`, `dy`) would scale it by, about
 *  its own centre. `1` for a node no host grows — which is every node of
 *  every kind the package knows. Read per pointer move for the live
 *  preview, so the host's rule has to be cheap. */
export function dragScaleFactor(
  state: CompositionState, nodeId: string, dx: number, dy: number,
): number {
  return sessionHost().nodes?.dragScale?.(state, nodeId, dx, dy) ?? 1;
}

/**
 * The canvas drag commit for one node: the move (with its frame reparent)
 * and the drag scale about the node's own centre, as ONE undo step.
 *
 * The scale is built against the MOVED state, so it is taken about where
 * the node has landed rather than where it started — a word that grows as
 * it arrives grows around its new centre, which is where the user is
 * looking.
 */
export function buildMoveNodeWithDragScale(
  state: CompositionState,
  nodeId: string,
  dx: number,
  dy: number,
): SessionEntry | null {
  const move = buildMoveNodeWithFrameReparent(state, nodeId, dx, dy);
  const factor = dragScaleFactor(state, nodeId, dx, dy);
  if (factor === 1) return move;
  const moved = move ? applyCompOps(state, move.entry) : state;
  const scale = buildScaleNode(moved, nodeId, factor);
  if (!scale) return move;
  return { entry: [...(move?.entry ?? []), ...scale.entry] };
}

/**
 * The same for a multi-selection dragged as one: every member moves, and
 * each member the host grows takes its own scale about its own centre — a
 * handful of words carried into the bottle together grow just as they
 * would one at a time. One undo entry, the scales built against the moved
 * state in turn.
 *
 * `hostDoc` rides through to `buildMoveNodes`, which carries the host's own
 * items in the selection along with the shapes (`HostItems`, stage 3) —
 * DrawBot's bots and instruction tiles drag with a mixed group. Nothing
 * SCALES a host item: the drag-scale rule is about scene nodes, and the
 * loop below walks ids the scene knows.
 *
 * What that move attached as `hostOps` is carried back OUT, which is the
 * half stage 5b.4a lost: this rebuilt its result as `{ entry }` and
 * dropped them, so a drag of a shape and a loose host item together
 * committed the shape and snapped the item back — after the host's own
 * layer had previewed it at the new place. A selection of host items
 * ALONE leaves `entry` empty, and an empty entry with host ops is still a
 * step: only a drag that moves nothing at all answers null.
 */
export function buildMoveNodesWithDragScale<TDoc = undefined>(
  state: CompositionState,
  ids: readonly string[],
  dx: number,
  dy: number,
  hostDoc?: TDoc,
): SessionEntry | null {
  const move = buildMoveNodes(state, ids, dx, dy, hostDoc);
  const entry = [...(move?.entry ?? [])];
  let cur = move ? applyCompOps(state, move.entry) : state;
  for (const id of ids) {
    // Measured against the PRE-move state, which is where the node's own
    // box and the drag's delta are both expressed.
    const factor = dragScaleFactor(state, id, dx, dy);
    if (factor === 1) continue;
    const scale = buildScaleNode(cur, id, factor);
    if (!scale) continue;
    cur = applyCompOps(cur, scale.entry);
    entry.push(...scale.entry);
  }
  if (move?.hostOps) return { entry, hostOps: move.hostOps };
  return entry.length > 0 ? { entry } : null;
}
