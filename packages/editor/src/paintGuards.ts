// The overlay buttons' NO-PAINT margin.
//
// The brushes stamp on contact: the press itself is a dab, so that a tap
// leaves a mark without a drag (CanvasSurface's 'paint' gesture). That
// is right in the middle of the canvas and wrong at its edges, where the
// floating chrome lives — the grid/snap capsules down the left, undo and
// redo down the right, the mode capsules over the bottom. Those buttons
// are 44 px, and a finger that misses one by a few pixels lands on the
// canvas behind it and leaves paint where the user was reaching for a
// control. Every near-miss on a button was a dab to undo.
//
// So a stroke may not BEGIN inside a button, nor within
// {@link PAINT_GUARD_MARGIN_PX} of one. Only the press is guarded: a
// stroke that started on the canvas goes on painting wherever the finger
// takes it, buttons included — by then the hand is painting, not
// reaching.
//
// The rects are read from the DOM at the press rather than declared: the
// chrome's own layout constants live in the editor-ui package beside the
// components that use them, and a second copy of "where the capsules
// are" here would drift the first time one moved. One
// getBoundingClientRect pass over a dozen buttons, once per stroke,
// never on pointermove (the 90 fps rule).

/** How far outside a button the brushes stay, screen px. About a third
 *  of a capsule — wide enough to catch the near-miss that prompted this,
 *  narrow enough that the canvas beside a capsule is still paintable. */
export const PAINT_GUARD_MARGIN_PX = 14;

/**
 * The largest a guard may be, screen px, on either side. The selector is
 * "anything that answers as a button", which on a screen with a sheet up
 * can also match a full-bleed scrim or a list row the width of the page.
 * Those are not chrome the brush has to dodge — when one is up the canvas
 * is not being painted on at all — and treating them as guards would put
 * a no-paint band across the middle of the drawing. A control the finger
 * can miss is button-sized; anything bigger is left alone.
 */
export const PAINT_GUARD_MAX_PX = 200;

/** A screen-space rect, as `getBoundingClientRect` gives it. */
export interface GuardRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The CSS selector for "something the finger was probably reaching for".
 *  Both spellings: the editor draws some chrome as real `<button>`s and
 *  some as react-native-web Pressables, which render a div with a role. */
export const PAINT_GUARD_SELECTOR = 'button, [role="button"]';

/** Is this rect a BUTTON's — small enough that a finger aiming at it can
 *  miss and hit the canvas? See {@link PAINT_GUARD_MAX_PX}. */
export function isGuardSized(
  rect: GuardRect,
  max = PAINT_GUARD_MAX_PX,
): boolean {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  return width > 0 && height > 0 && width <= max && height <= max;
}

/** Does (`x`, `y`) — client coordinates — fall in any guard, grown by
 *  `margin` on every side? The test the press is refused by. */
export function pointInPaintGuard(
  guards: readonly GuardRect[],
  x: number,
  y: number,
  margin = PAINT_GUARD_MARGIN_PX,
): boolean {
  for (const g of guards) {
    if (x >= g.left - margin && x <= g.right + margin
      && y >= g.top - margin && y <= g.bottom + margin) return true;
  }
  return false;
}

/**
 * The button rects on screen right now, in client coordinates — every
 * button-sized control that is NOT inside `canvas` (the canvas's own
 * subtree holds the inert tap-target grid and the node layer, neither of
 * which the brush should dodge).
 *
 * `root` is injected so the node tests can hand it a stub; it defaults to
 * the live document, and returns nothing where there is none.
 */
export function collectPaintGuards(
  canvas: Element | null,
  root: { querySelectorAll(selector: string): ArrayLike<Element> } | null
    = typeof document === 'undefined' ? null : document,
): GuardRect[] {
  if (root === null) return [];
  const out: GuardRect[] = [];
  const found = root.querySelectorAll(PAINT_GUARD_SELECTOR);
  for (let i = 0; i < found.length; i++) {
    const el = found[i];
    if (canvas !== null && canvas.contains(el)) continue;
    const r = el.getBoundingClientRect();
    const rect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    if (isGuardSized(rect)) out.push(rect);
  }
  return out;
}
