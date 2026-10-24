// ── The selection tool's Rotate slider: the arithmetic ──────────────
// Under the selection tool's Rotate mode (toolbarMeta ArrangeMode), a
// slider stands at the bottom of the screen where a floating row stands and
// turns the selection. One object turns to the ABSOLUTE angle the slider
// reads (its own free rotation, so the row seats on where the object already
// is); a group or multi-selection turns by the slider's DELTA about its
// combined centre, and the row reseats to zero once the turn lands (the
// members keep their own angles, so no one angle is "the group's").
//
// What is here is the part that was BYTE-IDENTICAL in all three apps: the
// slider's span, the two readings between a handle position and an angle,
// and where the row stands after a commit. Pure, so it tests plainly; the
// row itself is components/ArrangeRotateSlider.tsx.
//
// WHAT IS NOT HERE: `rotateSliderTargets`, which decides what the slider has
// in hand. It differs in all three apps — CozyJournal excludes its rig,
// whose turn is a yaw and not a free angle on a bbox; DrawBots reads a
// `SimSession` with a `hostDoc` and seats the row on one bot's heading — so
// each app declares its own over these four (stage 6.5a of
// docs/shared-editor.md).

/** The slider spans one full turn, −180° at the left to +180° at the right,
 *  straight up in the middle. */
export const ROTATE_SLIDER_SPAN_DEG = 360;

export function sliderFromAngle(angleDeg: number): number {
  return Math.min(1, Math.max(0, angleDeg / ROTATE_SLIDER_SPAN_DEG + 0.5));
}

export function angleFromSlider(t: number): number {
  return (Math.min(1, Math.max(0, t)) - 0.5) * ROTATE_SLIDER_SPAN_DEG;
}

/**
 * Where the row stands once a drag has committed.
 *
 * A DELTA row (a group) has just spent its drag: the turn landed on the
 * objects and the row means "no further turn" again, so it goes back to
 * its seat — the middle. An ABSOLUTE row (one object) committed the very
 * angle it reads, so it stays on it and the `seatDeg` prop catches up to
 * the same number on the next render.
 *
 * Kept here rather than inline in the row because the row's `seatDeg` for
 * a group is the constant 0, so an effect watching it never fires after a
 * commit: the handle stayed where the drag left it, and the NEXT drag's
 * first reading — the standing offset — was re-applied as a fresh delta.
 * A group turned near a half turn and then flipped therefore swung 180°
 * the instant the slider was touched again, which reads as the flip being
 * undone (a mirror plus a half turn is the other mirror).
 */
export function seatAfterCommit(
  mode: 'absolute' | 'delta', seatDeg: number, committedDeg: number,
): number {
  return mode === 'delta' ? seatDeg : committedDeg;
}
