// Multi-finger tap → undo / redo classification, copied from Facet's Canvas
// gestures. A two- or three-finger tap that lifts within MULTI_TAP_MAX_DURATION
// ms without any finger moving past MULTI_TAP_MOVE_THRESHOLD px is an undo (two
// fingers) / redo (three). A pinch / pan / rotate moves further than the
// threshold, so it's cleanly distinguished from a tap. The canvas gesture
// handler (CanvasSurface) tracks the raw finger state and defers the decision
// to these pure helpers so the classification is unit-testable.

export const MULTI_TAP_MAX_DURATION = 300;
export const MULTI_TAP_MOVE_THRESHOLD = 10;
/** Every finger of a tap lands together: a finger joining one that was
 *  already down longer than this is not a tap — a held finger and a later
 *  touch beside it must not undo (bug b3a2a998). Generous enough for the
 *  few tens of ms a real two-finger tap staggers by. */
export const MULTI_TAP_LAND_WINDOW = 150;

export interface MultiTap {
  /** Most fingers down at once during the gesture (0 when never multi-touch). */
  maxFingers: number;
  /** True once any tracked finger has moved past MULTI_TAP_MOVE_THRESHOLD. */
  moved: boolean;
  /** Milliseconds from the multi-touch start to the last finger lifting. */
  elapsed: number;
  /** Milliseconds from the FIRST finger touching to the last one joining —
   *  how far apart the fingers landed. */
  stagger: number;
  /** The gesture ended on pointercancel rather than a clean lift. */
  cancelled: boolean;
}

/** Classify a completed multi-finger gesture: 'undo' for a stationary two-finger
 *  tap, 'redo' for three, null for everything else (moved, too slow, fingers
 *  that did not land together, cancelled, or the wrong finger count). Pure decision point behind the canvas handler. */
export function classifyMultiTap(t: MultiTap): 'undo' | 'redo' | null {
  if (t.cancelled || t.moved) return null;
  if (t.elapsed >= MULTI_TAP_MAX_DURATION) return null;
  if (t.stagger > MULTI_TAP_LAND_WINDOW) return null;
  if (t.maxFingers === 2) return 'undo';
  if (t.maxFingers === 3) return 'redo';
  return null;
}

/** Did any currently-tracked finger move past the tap slop from its touch-down
 *  point? Per-finger displacement (not the midpoint) is checked so even a small
 *  pinch / rotate, where the centre barely moves, still reads as movement. */
export function anyFingerMoved(
  current: Iterable<[number, { x: number; y: number }]>,
  start: Map<number, { x: number; y: number }>,
): boolean {
  for (const [id, pos] of current) {
    const s = start.get(id);
    if (s && (Math.abs(pos.x - s.x) > MULTI_TAP_MOVE_THRESHOLD
      || Math.abs(pos.y - s.y) > MULTI_TAP_MOVE_THRESHOLD)) {
      return true;
    }
  }
  return false;
}
