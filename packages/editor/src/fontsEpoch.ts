// A monotonic "fonts settled" counter. loadPackFonts registers the canvas text
// measurer immediately but loads the woff2 faces asynchronously, so the FIRST
// layout of any text node measures with the engine's font-blind fallback (the
// measurer returns null until document.fonts.check passes). The browser then
// repaints the glyphs when a face resolves, but the JS-computed line positions
// (which bake in the measured width) are NOT recomputed — invisible for
// left-aligned text (x = 0 regardless) but visibly wrong for center/right
// alignment, which drifts off its edge until something forces a re-render.
//
// This store lets the text layer subscribe: loadPackFonts bumps the epoch when
// the faces finish loading, and TextNodeLayer re-lays-out (now with real
// metrics) in response. Kept in its own dependency-free module so it's unit
// testable without pulling in expo-font (loadPackFonts) or React (the hook).

let epoch = 0;
const listeners = new Set<() => void>();

/** Current epoch; bumped once each time the pack fonts settle. */
export function getFontsEpoch(): number {
  return epoch;
}

/** Subscribe to epoch bumps; returns an unsubscribe fn. */
export function subscribeFontsEpoch(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Bump the epoch and notify subscribers (call when faces finish loading). */
export function bumpFontsEpoch(): void {
  epoch += 1;
  for (const listener of listeners) listener();
}
