// "After the next paint": a promise that resolves once the browser has
// had one rendering opportunity — the first thing an update queued now
// gets on screen.
//
// It exists for the Done press (EditorShell setDone, bug 057ec9ce). The
// press mounts the confetti and, in the same handler, starts the page's
// full raster (flushEntryImages: the GL render, the read-back, the PNG
// encode, the push over the bridge — hundreds of milliseconds, seconds on
// a big page). React commits the burst as the handler returns, so the
// burst's keyframes are STARTED before the raster — but the raster runs in
// the microtasks right behind the handler, before the browser ever gets
// to paint, and a Web Animation cannot begin until its first frame is
// painted. The particles waited on the main thread for as long as the
// raster took, and started only then; meanwhile the burst's own cleanup
// timer had been running since the commit. A short raster cut the burst
// off early; a long one unmounted it before a single particle was drawn.
// "Sometimes it just doesn't happen."
//
// Started AFTER the paint, the raster finds the burst already on the
// compositor — transform and opacity keyframes, no main-thread work per
// frame — and can block the main thread for as long as it likes without
// stalling a particle. The burst plays at the tap, where the thump is.
//
// A rendering opportunity is asked for with requestAnimationFrame, whose
// callback runs BEFORE that frame is painted; a macrotask queued from
// inside it runs after. rAF does not fire at all while the document is
// hidden (the app backgrounded, a WebView paused), and the work waiting on
// this must not wait on the app coming back — a mark that is not stored
// until the next resume is a mark a kill loses — so the wait is CAPPED:
// whichever comes first, the paint or `capMs`.

/** The most the wait can take, in ms: six frames at 60 Hz, and a hidden
 *  document's whole wait. Long enough for one paint on a busy frame (the
 *  canvas may be drawing one of its own), short enough that nothing
 *  behind it can be said to have waited. */
export const AFTER_PAINT_CAP_MS = 100;

/** Resolves after the browser's next paint, or after `capMs` (default
 *  AFTER_PAINT_CAP_MS), whichever is first. Never rejects. Where there is
 *  no requestAnimationFrame (a test, a worker) it is the cap alone. */
export function afterNextPaint(capMs: number = AFTER_PAINT_CAP_MS): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(cap);
      resolve();
    };
    const cap = setTimeout(settle, capMs);
    if (typeof requestAnimationFrame !== 'function') return;
    // rAF runs before the frame is painted; a timer queued from inside it
    // runs once the frame is out.
    requestAnimationFrame(() => { setTimeout(settle, 0); });
  });
}
