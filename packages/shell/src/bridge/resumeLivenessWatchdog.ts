// Liveness probe for WKWebView resume from deep iOS suspension.
//
// Observed bug: after overnight backgrounding, WKWebView can resume to a
// layer tree that points at a reclaimed IOSurface — `viewIsBecomingVisible`
// + `Unhiding layer tree` fire and JS is alive, but the screen is black and
// unresponsive and no server traffic flows from the bundle. `onContentProcessDidTerminate`
// does not fire because the process was not killed.
//
// Detection strategy: on resumes past LONG_BACKGROUND_MS, native posts a
// nonce'd ping and arms a watchdog. The web side schedules a
// requestAnimationFrame and pongs back with the same nonce from inside the
// rAF callback. A dead surface where the paint loop has stalled will not
// deliver the rAF in time; the watchdog then reloads the WebView. Healthy
// resumes round-trip the pong in ~one frame and avoid any UI churn.
//
// Short resumes skip the probe entirely (the IOSurface eviction case is only
// plausible after deep suspension), so quick lock-screen returns remain free.

export const LONG_BACKGROUND_MS = 5 * 60 * 1000;
export const WATCHDOG_MS = 1500;

/**
 * True if the resume warrants a liveness probe — i.e. the background was
 * long enough that an iOS IOSurface eviction is plausible.
 */
export function shouldProbeOnResume(
  backgroundedAt: number | null,
  now: number,
): boolean {
  if (backgroundedAt == null) return false;
  return now - backgroundedAt > LONG_BACKGROUND_MS;
}
