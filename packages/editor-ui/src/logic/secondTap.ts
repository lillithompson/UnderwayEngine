// The "tap the same thing twice" rule, spelled once.
//
// Unrelated controls arm on the first tap and act on the second, and each
// wrote the same three lines with its own window: a pattern tile in the
// Tools bar rotates a quarter turn (400 ms — Facet's TilePalette window,
// ./patternEdit.ts), and an outline row opens on a double tap
// (SceneOutlinePanel). The WINDOW is the difference between them and
// stays each caller's; the rule does not.
//
// Pure, and the clock is the caller's: both callers already hold one
// (a gesture's timestamp, `Date.now()` in the hook) and neither can read a
// clock here — a host's pure model must stay testable without one.

/** The last tap seen on a set of things: which one, and when, on whatever
 *  clock the caller keeps (only differences are read). */
export interface TapRecord {
  id: string;
  time: number;
}

/**
 * Is a tap at `now` on `id` the SECOND of a pair — the same thing as the
 * last tap, within `windowMs` of it? `null` (nothing tapped yet) is never a
 * second tap.
 *
 * Inclusive at the boundary: a tap exactly `windowMs` after the one before
 * it is still within the window. (The pattern tile's own copy was
 * exclusive; one millisecond of one tile's rotation is not worth two
 * spellings of this.)
 */
export function secondTapWithin(
  last: TapRecord | null | undefined,
  id: string,
  now: number,
  windowMs: number,
): boolean {
  return last != null && last.id === id && now - last.time <= windowMs;
}
