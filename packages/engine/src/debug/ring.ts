// TEMP diagnostic — remove after iOS cold-start race bug is closed.
//
// Zero-overhead in-memory ring buffer for tracing cold-start timing.
// Push sites are on hot paths; we must avoid any I/O on push. Flushing
// to native happens only from failure handlers (ErrorBoundary,
// unhandledrejection, error) where timing no longer matters.

import { logToNative } from '@/native-shell/bridge/webBridge';

interface Entry {
  t: number;
  tag: string;
  data?: Record<string, unknown>;
}

const CAP = 256;
const ring: Entry[] = [];
let head = 0;
let anchor: number | null = null;

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** Record a timestamped marker. Designed to be cheap enough for hot paths. */
export function mark(tag: string, data?: Record<string, unknown>): void {
  const t = now();
  if (anchor === null) anchor = t;
  const entry: Entry = { t, tag, data };
  if (ring.length < CAP) {
    ring.push(entry);
  } else {
    ring[head] = entry;
    head = (head + 1) % CAP;
  }
}

/** Return entries in insertion order, normalized to ms since first mark. */
export function snapshot(): Entry[] {
  const ordered: Entry[] = [];
  if (ring.length < CAP) {
    ordered.push(...ring);
  } else {
    for (let i = 0; i < CAP; i++) ordered.push(ring[(head + i) % CAP]);
  }
  const base = anchor ?? 0;
  return ordered.map(e => ({ ...e, t: +(e.t - base).toFixed(2) }));
}

/** Format a snapshot as a compact text block suitable for a single console line. */
export function formatSnapshot(entries: Entry[]): string {
  if (entries.length === 0) return '(ring empty)';
  const lines = entries.map(e => {
    const tStr = e.t.toFixed(2).padStart(8);
    const data = e.data ? ' ' + safeJson(e.data) : '';
    return `${tStr}ms  ${e.tag}${data}`;
  });
  return '\n' + lines.join('\n');
}

function safeJson(obj: unknown): string {
  try { return JSON.stringify(obj); } catch { return '[unserializable]'; }
}

/** Send the current ring to native as a LOG message. */
export function flush(reason: string): void {
  const entries = snapshot();
  const text = `flush(${reason}) — ${entries.length} entries${formatSnapshot(entries)}`;
  logToNative('log', 'ring', text);
}

// COLD-START diag — sessionStorage key for persisted snapshot. Survives
// window.location.reload() (which the AsyncRequireError recovery path uses)
// but not app-kill — exactly the lifetime where we want pre-failure context
// to flow into the post-reload boot logs.
const SESSION_KEY = 'facet:ring:lastFlush';

/**
 * Persist the current ring snapshot to sessionStorage in addition to logging
 * it. The next session-after-reload should call replayFromSession() during
 * boot to forward it to native.
 */
export function flushToSession(reason: string): void {
  flush(reason);
  try {
    const entries = snapshot();
    const payload = JSON.stringify({ reason, t: Date.now(), entries });
    sessionStorage.setItem(SESSION_KEY, payload);
  } catch {
    // sessionStorage unavailable, quota exceeded, or non-browser env — drop.
  }
}

/**
 * Read any prior-session ring snapshot from sessionStorage, forward it to
 * native as a LOG so the Xcode console gets the pre-reload timeline, then
 * clear it. Safe to call unconditionally at boot.
 */
export function replayFromSession(): void {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) sessionStorage.removeItem(SESSION_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as { reason: string; t: number; entries: Entry[] };
    const ageMs = Date.now() - parsed.t;
    const text = `replay(${parsed.reason}) — ${parsed.entries.length} entries, age ${ageMs}ms${formatSnapshot(parsed.entries)}`;
    logToNative('log', 'ring.replay', text);
  } catch {
    logToNative('warn', 'ring.replay', 'failed to parse persisted snapshot');
  }
}

/** For tests: reset state. */
export function _reset(): void {
  ring.length = 0;
  head = 0;
  anchor = null;
}
