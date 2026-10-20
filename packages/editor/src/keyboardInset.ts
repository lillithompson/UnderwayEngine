import { useEffect, useState } from 'react';

// Keyboard-avoidance for the in-WebView editor.
//
// The editor runs inside a WKWebView with scrollEnabled=false
// (vendor/UnderwayEngine/.../WebViewShell.tsx), so when the iOS software
// keyboard rises the OS does NOT resize or scroll the content — a
// bottom-pinned element (the text-edit bar) would sit *behind* the keyboard.
// In that mode the layout viewport (window.innerHeight) stays full-height
// while the visual viewport shrinks, so their difference is the height the
// keyboard overlaps from the bottom. We lift the bar by that amount.

interface ViewportLike {
  innerHeight: number;
  visualViewport?: { height: number; offsetTop: number } | null;
}

/** Pixels the on-screen keyboard overlaps from the bottom of the WebView.
 *  Returns 0 where there is no visualViewport or no on-screen keyboard
 *  (desktop web, hardware keyboard), where bottom:0 already rests correctly. */
export function keyboardOverlap(win: ViewportLike): number {
  const vv = win.visualViewport;
  if (!vv) return 0;
  const overlap = win.innerHeight - vv.height - vv.offsetTop;
  // Sub-pixel jitter and rounding noise shouldn't lift the bar.
  return overlap > 1 ? Math.round(overlap) : 0;
}

/** The air a centred card keeps between its last button and the top of
 *  the keyboard, once the keyboard has pushed it up. */
export const CARD_KEYBOARD_GAP = 12;

/**
 * The BOTTOM padding of the scrim a centred card stands in
 * (components/ConfirmCardModal): its resting padding while no keyboard is
 * up, and the keyboard's overlap plus {@link CARD_KEYBOARD_GAP} while one
 * is — so the box the card is centred in ends where the keyboard begins,
 * and the card rides up with it instead of keeping its place behind it
 * (bug report 562afda0: a comic's title card kept its *Mark game as
 * complete* button under the keyboard its own field had raised).
 */
export function scrimBottomPad(restPad: number, keyboardInset: number): number {
  return keyboardInset > 0 ? keyboardInset + CARD_KEYBOARD_GAP : restPad;
}

/** Tracks {@link keyboardOverlap} live as the keyboard animates in/out. */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const update = () => setInset(keyboardOverlap(window));
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}
