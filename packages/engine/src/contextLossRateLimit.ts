/**
 * Sliding-window rate limiter for forced GLView remounts after WebGL
 * context loss escalations. Prevents a remount storm if the WebKit GPU
 * process is wedged: at that point another remount won't help, and
 * looping at hundreds of escalations per second would just compound the
 * blank-canvas state with thrash.
 */

export const ESCALATION_WINDOW_MS = 5000;
export const ESCALATION_MAX_PER_WINDOW = 2;

/**
 * Decide whether a new escalation should fire, given the timestamps of
 * recent escalations. Returns the new (pruned + maybe appended) timestamp
 * list and a boolean indicating whether the caller should escalate. Pure;
 * the caller is responsible for storing the returned timestamps.
 */
export function admitEscalation(
  recent: readonly number[],
  now: number,
  windowMs: number = ESCALATION_WINDOW_MS,
  maxPerWindow: number = ESCALATION_MAX_PER_WINDOW,
): { admit: boolean; next: number[] } {
  const cutoff = now - windowMs;
  const pruned: number[] = [];
  for (let i = 0; i < recent.length; i++) {
    if (recent[i] >= cutoff) pruned.push(recent[i]);
  }
  if (pruned.length >= maxPerWindow) {
    return { admit: false, next: pruned };
  }
  pruned.push(now);
  return { admit: true, next: pruned };
}
