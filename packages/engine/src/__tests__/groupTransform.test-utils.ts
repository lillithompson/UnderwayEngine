/**
 * Transforming a group in a test, the way the app does it.
 *
 * These tests used to poke a `GroupNode`'s fields and call
 * `materializeGroupMembers`, which recomputed every member's world pose
 * from its `local*` caches. P6-B retired those caches — a grouped leaf now
 * stores its pose once, in world, and a group's transform lives on its
 * node in the scene graph (docs/transform-refactor.md §4).
 *
 * So the equivalent of "set the group's fields and materialize" is "commit
 * a group transform": `transformGroup` goes through the bridge onto the
 * graph, which moves the members by moving their parent. Same question,
 * asked of the model that is actually shipped.
 *
 * Author members at their pose under the group AS IT STANDS, then call
 * these to turn, scale or move the group.
 */

import { CompositionState, GroupNode } from '../types';
import { applyCompOps } from '../compositionOps';
import { LeafWorldSnapshot, worldSnapshot } from '../worldSnapshot';

/** The group's transform fields, as `transformGroup` names them. */
type GroupPose = Pick<
  GroupNode,
  'translateX' | 'translateY' | 'scaleX' | 'scaleY' | 'rotation' | 'mirrorH' | 'mirrorV'
>;

function poseOfGroup(g: GroupNode): GroupPose {
  return {
    translateX: g.translateX, translateY: g.translateY,
    scaleX: g.scaleX, scaleY: g.scaleY,
    rotation: g.rotation, mirrorH: g.mirrorH, mirrorV: g.mirrorV,
  };
}

/**
 * Commit `t` onto `groupId`'s transform and return the state it lands.
 *
 * The replacement for `materializeGroupMembers({ ...state, groups }, id)`:
 * the fields you would have poked go in `t`, and the members follow
 * because the group they hang from moved.
 */
export function setGroupTransform(
  state: CompositionState, groupId: string, t: Partial<GroupPose>,
): CompositionState {
  const g = state.groups.find((x) => x.id === groupId);
  if (!g) return state;
  const from = poseOfGroup(g);
  const to = { ...from, ...t };
  // Whatever the caller handed over: a state carrying a graph runs on it,
  // one without takes the graph-less fallback. The two differ in
  // PRECISION, not in where things land — the fallback rebuilds each
  // member's local transform from its world pose on every op, so a scale
  // out and back comes home a few ULPs off, where a session that keeps
  // its graph leaves the local transform untouched and lands exactly. A
  // test that needs the exact answer should pass `withSceneGraph(state)`.
  return applyCompOps(state, [{
    op: 'transformGroup',
    groupId,
    oldTranslateX: from.translateX, oldTranslateY: from.translateY,
    oldScaleX: from.scaleX, oldScaleY: from.scaleY,
    oldRotation: from.rotation,
    oldMirrorH: from.mirrorH, oldMirrorV: from.mirrorV,
    newTranslateX: to.translateX, newTranslateY: to.translateY,
    newScaleX: to.scaleX, newScaleY: to.scaleY,
    newRotation: to.rotation,
    newMirrorH: to.mirrorH, newMirrorV: to.mirrorV,
  }]);
}

/**
 * Shift a group by `(dx, dy)` — what dragging a group commits.
 *
 * The translate is relative, so this reads the group's current one and
 * adds to it, rather than the caller having to.
 */
export function moveGroupBy(
  state: CompositionState, groupId: string, dx: number, dy: number,
): CompositionState {
  const g = state.groups.find((x) => x.id === groupId);
  if (!g) return state;
  return setGroupTransform(state, groupId, {
    translateX: g.translateX + dx, translateY: g.translateY + dy,
  });
}

// ── Reading a pose, not its spelling ───────────────────────────────────
//
// One pose has many spellings in the per-kind arrays: the same quarter
// turn lands in `rotation` on a leaf that carried one and in `angleDeg` on
// a leaf that did not, and a flip about either axis is the other plus a
// half turn. `worldSnapshot` already canonicalises all of that, so these
// are thin readers over it rather than a second opinion — assert through
// them, never on a stored `rotation` / `angleDeg` (see
// docs/transform-refactor.md §1.3).

/** One leaf's world-space pose: drawn content box, centre, canonical turn
 *  and flip bit. */
export function poseOf(state: CompositionState, id: string): LeafWorldSnapshot {
  const snap = worldSnapshot(state).find((s) => s.id === id);
  if (!snap) throw new Error(`no leaf ${id}`);
  return snap;
}

/** The turn a leaf is DRAWN at, in degrees clockwise, canonicalised. 0
 *  for a leaf that carries none, however it is spelled. */
export function turnOf(state: CompositionState, id: string): number {
  return poseOf(state, id).turn ?? 0;
}

/** Whether a leaf is drawn flipped (handedness reversed). Which axis is
 *  not asked: a flip about one is a flip about the other plus a turn. */
export function flipOf(state: CompositionState, id: string): boolean {
  return poseOf(state, id).flip ?? false;
}
