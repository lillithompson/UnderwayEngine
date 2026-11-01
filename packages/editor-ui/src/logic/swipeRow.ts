// When a swipeable list line takes the finger, and where it comes to rest
// when the finger leaves — the whole of the gesture's decision-making, kept
// clear of the view so it can be read and tested as arithmetic
// (components/SwipeRow draws it). Lifted from CozyJournal's
// components/swipeRowModel.ts, whose group lines it serves (leave or
// delete a group), so every Underway app swipes a line the same way;
// DrawBots' Pen Motion step deletes a pen motion with it.
//
// `at` throughout is where the line is RESTING — 0 shut, `-width` open —
// and `dx` the live drag over it. `width` is the row's whole travel: the
// buttons' block, exactly.

/** Past this much of the actions' width, the release opens rather than
 *  springs back — a drag half-committed reads as committed. */
export const OPEN_FRACTION = 0.5;
/** A drag has to be this much more sideways than it is up-and-down before
 *  the row takes it: below that the finger belongs to the list's scroll. */
export const HORIZONTAL_BIAS = 1.6;
/** …and this far along at all. A tap is a drag of nothing. */
export const CLAIM_SLOP = 8;
/** Past this, a flick decides on its own however short it was. */
export const FLICK_VELOCITY = 0.3;

/** Is this movement the row's to take? Sideways enough to be a swipe and
 *  not the list's scroll, and going somewhere: left opens, right only
 *  matters to a row that is already out. */
export function claims(dx: number, dy: number, at: number, width: number): boolean {
  if (width === 0) return false;
  const sideways = Math.abs(dx) > CLAIM_SLOP && Math.abs(dx) > Math.abs(dy) * HORIZONTAL_BIAS;
  return sideways && (dx < 0 || at !== 0);
}

/** Where the line comes to rest when the finger leaves it: a flick decides
 *  by its direction however short it was, a tap puts an open row away,
 *  and anything else settles by how far it actually got. */
export function landing(dx: number, vx: number, at: number, width: number): number {
  if (width === 0) return 0;
  if (Math.abs(vx) > FLICK_VELOCITY) return vx < 0 ? -width : 0;
  // A touch that never really moved is a TAP, and a tap on an open row
  // puts it away — the row is its own way out, so there is nowhere else
  // to have to press.
  if (Math.abs(dx) < CLAIM_SLOP) return 0;
  return at + dx < -width * OPEN_FRACTION ? -width : 0;
}

/** Which way a touch drag is going, from its first move's travel `dx`,
 *  `dy` (px): 'x' mostly across — a swipe, so the page does not scroll
 *  under it — 'y' up or down (a tie too: a scroll), null not yet moved.
 *  Read once a gesture, and the gesture keeps it: in a browser, the one
 *  touchmove that can still be cancelled is the first, so this is asked
 *  before the row's own claim (which waits for `CLAIM_SLOP`). */
export function swipeAxis(dx: number, dy: number): 'x' | 'y' | null {
  if (dx === 0 && dy === 0) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
}

/** In a browser, cancel the moves of every touch on `el` whose first move
 *  goes mostly across (`swipeAxis`), so the page does not scroll under a
 *  sideways swipe; a touch whose first move goes up or down scrolls as
 *  ever. Listeners of its own, not React's, which listen passive and
 *  cannot cancel; nothing per move but the test. Returns their removal.
 *  The swipe row's (components/SwipeRow) and DrawBots' preview stage's. */
export function cancelCrossTouchMoves(el: HTMLElement): () => void {
  let x0 = 0;
  let y0 = 0;
  let axis: 'x' | 'y' | null = null;
  const start = (e: TouchEvent) => {
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
    axis = null;
  };
  const move = (e: TouchEvent) => {
    if (axis === null) axis = swipeAxis(e.touches[0].clientX - x0, e.touches[0].clientY - y0);
    if (axis === 'x' && e.cancelable) e.preventDefault();
  };
  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchmove', move, { passive: false });
  return () => {
    el.removeEventListener('touchstart', start);
    el.removeEventListener('touchmove', move);
  };
}
