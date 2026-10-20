// What a sideways drag across a floating capsule means. The under-toolbar
// slot holds one menu at a time and several are often eligible (the armed
// tool's, an open radial's second level, a host's own capsules — each
// app's `topCapsuleSlot.ts` is the arbitration), so a horizontal swipe
// across the row asks for the next one in line without touching the
// toolbar. The thresholds and the reading of a released drag are here, a
// leaf beside the capsule that takes the gesture (components/
// ToolModeCapsule.tsx), because the apps' slot models re-export them and
// test them, and the capsule and the slot must agree on what a swipe is.

/** Horizontal travel that commits a swipe, in px. Well past a press's
 *  slop, short of the capsule's own width, so a deliberate flick lands
 *  and a wobbling tap does not. */
export const CAPSULE_SWIPE_COMMIT_PX = 48;
/** …or the speed that commits one that stopped short (px/ms, the
 *  responder's `vx`): a quick flick need not travel the whole way. */
export const CAPSULE_SWIPE_COMMIT_VX = 0.4;
/** Travel before the capsule's row claims the gesture from its segments at
 *  all; under this a press stays a press. */
export const CAPSULE_SWIPE_CLAIM_PX = 8;

/** What a released drag across the capsule means: 1 for a swipe left
 *  (next menu), -1 for a swipe right (previous), null for a drag that
 *  neither travelled nor moved fast enough to be a swipe. */
export function capsuleSwipeDirection(dx: number, vx: number): 1 | -1 | null {
  if (dx === 0) return null;
  if (Math.abs(dx) < CAPSULE_SWIPE_COMMIT_PX && Math.abs(vx) < CAPSULE_SWIPE_COMMIT_VX) return null;
  return dx < 0 ? 1 : -1;
}
