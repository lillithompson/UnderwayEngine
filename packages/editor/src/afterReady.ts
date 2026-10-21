// Work that must not stand in front of the first frame
// (docs/response_open_speed.md §3.2b).
//
// The editor page boots by parsing megabytes of JS, building the pack
// registry, reading IndexedDB and compiling shaders, and the native splash
// stays up over all of it until the page says READY. Anything that runs at
// module scope in that window — a CMS fetch, a disk scan — is competing
// with the open for the same main thread and the same network.
//
// So: register it here and it runs once the page is up, when the user has
// their canvas and nothing is waiting on it.
//
// The fallback timer is the same admission webBridge's own boot makes
// (`setTimeout(signalReady, 4000)`): a route that somehow never signals
// must not silently retire the background work for that session.

/** How long to wait for READY before running anyway. */
export const AFTER_READY_FALLBACK_MS = 6000;

let ready = false;
let waiting: (() => void)[] = [];
let fallback: ReturnType<typeof setTimeout> | null = null;

function run(fn: () => void): void {
  try {
    fn();
  } catch {
    // Background work, every one of them best-effort: a throw here must
    // not take the page down with it.
  }
}

/** Run `fn` once the page has signalled READY — at once if it already has. */
export function afterReady(fn: () => void): void {
  if (ready) {
    run(fn);
    return;
  }
  waiting.push(fn);
  if (fallback === null) {
    fallback = setTimeout(pageIsReady, AFTER_READY_FALLBACK_MS);
    // Never hold a node/test process open for this.
    (fallback as unknown as { unref?: () => void }).unref?.();
  }
}

/** The page is up. Called beside signalReady(), by every route that has
 *  one — the canvas, and the action screens' shared chrome. */
export function pageIsReady(): void {
  if (ready) return;
  ready = true;
  if (fallback !== null) {
    clearTimeout(fallback);
    fallback = null;
  }
  const queued = waiting;
  waiting = [];
  for (const fn of queued) run(fn);
}

export function __resetAfterReadyForTest(): void {
  ready = false;
  waiting = [];
  if (fallback !== null) clearTimeout(fallback);
  fallback = null;
}
