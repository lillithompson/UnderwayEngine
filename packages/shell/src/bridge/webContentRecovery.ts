// Loop-guard for WKWebView content-process termination recovery.
//
// When the iOS WKWebView renderer is reaped (memory pressure, jetsam),
// react-native-webview fires `onContentProcessDidTerminate`. The shell
// reloads the WebView in response. If the underlying memory cause is
// still present, the new renderer can be reaped immediately, and we'd
// pinwheel — so we cap how many terminations within a rolling window
// we'll auto-recover before falling back to a user-facing error UI.
//
// State lives in module scope (process lifetime). This is intentional:
//   - sessionStorage on the web side is destroyed by the very event we
//     are trying to recover from.
//   - AsyncStorage would punish cold launches with a stale counter.
//   - useState would force this logic into the .tsx component.
// The guard resets implicitly on app cold start (fresh JS modules) and
// explicitly via resetGuard() on a successful READY handshake.

export const MAX_TERMINATIONS = 2;
export const WINDOW_MS = 60_000;

let timestamps: number[] = [];

export interface RecordResult {
  /** True if the shell should reload the WebView; false if the guard tripped. */
  allowReload: boolean;
  /** 1-based count of terminations within the current window (post-prune). */
  attempt: number;
}

/**
 * Record a content-process termination at `now` (defaults to Date.now()).
 * Returns whether the caller should attempt a reload.
 */
export function recordTermination(now: number = Date.now()): RecordResult {
  const cutoff = now - WINDOW_MS;
  timestamps = timestamps.filter((t) => t >= cutoff);
  timestamps.push(now);
  const attempt = timestamps.length;
  const allowReload = attempt <= MAX_TERMINATIONS;
  return { allowReload, attempt };
}

/** Clear the guard. Call on a successful READY handshake or explicit user retry. */
export function resetGuard(): void {
  timestamps = [];
}

// Internal hooks for unit testing. Not part of the public API.
export const __webContentRecoveryInternals = {
  peekTimestamps(): number[] { return timestamps.slice(); },
  MAX_TERMINATIONS,
  WINDOW_MS,
};
