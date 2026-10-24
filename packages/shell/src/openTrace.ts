import { DIAGNOSTICS } from '@/native-shell/profiling';

// How long an editor open takes, and where the time goes
// (CozyJournal's docs/response_open_speed.md §3, Phase 0 — the app the
// measurement was taken in; the two paths are every app's.)
//
// Opening a page crosses two JS contexts — the native one that pushes
// `/editor`, and the WebView's, which loads a 4 MB bundle before it can
// draw anything — so no single profiler sees the whole transition. Both
// sides record marks into their own copy of this module (one file, two
// module instances, one wall clock), the web posts its list over the
// bridge when the canvas is live, and native prints the merged table
// against the tap that started it.
//
// Marks the two paths record, in the order they happen:
//
//   push        native, the moment `/editor` is pushed
//   loadStart   native, WKWebView began fetching the page
//   pageStart   web, the page's navigation start (performance.timeOrigin)
//   scriptStart web, the editor module's own first statement — everything
//               between it and pageStart is bundle download + parse
//   registry    web, the bundled content packs are built
//   mount       web, EditorHost's first render
//   resolveStart / entryRead   web, around the IndexedDB read
//   thumbDone   web, the Response target's picture is in hand (noting how
//               big it was and where it came from)
//   routeSet    web, the resolved route is handed to the shell
//   glReady     web, the GL context exists and READY is posted — the
//               frame the splash lifts on
//
// Everything here is behind DIAGNOSTICS (a dev build, or the Release
// build `npm run ios:profile` makes): a shipping build records nothing
// and posts nothing, and Expo inlines the flag so the calls fold away.


/** One moment of an open, by wall clock, so the two sides' marks sort into
 *  one list. `note` carries what a mark needs beside its time — the bytes a
 *  download cost, and where its URL came from. */
export interface OpenMark {
  name: string;
  t: number;
  note?: string;
}

export interface OpenTracePayload {
  marks: OpenMark[];
}

/** How many marks one open may record before the list stops growing. A
 *  runaway recorder must never be the thing that costs the memory. */
const MAX_MARKS = 64;

let marks: OpenMark[] = [];

/**
 * Record one mark, by wall clock. `note` rides along for the numbers a
 * mark needs beside its time — the thumb's byte count, say. A no-op
 * outside a diagnostics build.
 *
 * `at` is only passed for a moment that has already gone by (the page's
 * navigation start, which is read after the fact).
 */
export function markOpen(name: string, note?: string, at: number = Date.now()): void {
  if (!DIAGNOSTICS) return;
  if (marks.length >= MAX_MARKS) return;
  marks.push(note === undefined ? { name, t: at } : { name, t: at, note });
}

/** The marks recorded so far, oldest first. */
export function openTraceMarks(): readonly OpenMark[] {
  return marks;
}

/** Forget them — the native side, once it has printed a table, so the
 *  next open starts from its own `push` rather than the last one's. */
export function resetOpenTrace(): void {
  marks = [];
}

/**
 * Coerce a posted trace into marks, or null. Everything arriving over the
 * bridge is `unknown` (it survived a JSON round trip through a WebView),
 * so a malformed one is dropped rather than printed half-built.
 */
export function sanitizeOpenTrace(data: unknown): OpenTracePayload | null {
  if (typeof data !== 'object' || data === null) return null;
  const list = (data as Partial<OpenTracePayload>).marks;
  if (!Array.isArray(list)) return null;
  const out: OpenMark[] = [];
  for (const raw of (list as unknown[]).slice(0, MAX_MARKS)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const { name, t, note } = raw as Record<string, unknown>;
    if (typeof name !== 'string' || name === '') continue;
    if (typeof t !== 'number' || !Number.isFinite(t)) continue;
    out.push(typeof note === 'string' ? { name, t, note } : { name, t });
  }
  return out.length > 0 ? { marks: out } : null;
}

/**
 * The table, as one string for the Xcode console: every mark's offset
 * from the FIRST one (the tap, when native recorded it) and its step from
 * the one before, so a single line names the slice that costs.
 *
 * Marks are sorted by time rather than by arrival: the two sides record
 * independently and the web's list arrives all at once, at the end.
 */
export function formatOpenTrace(all: readonly OpenMark[]): string {
  if (all.length === 0) return '[openTrace] (no marks)';
  const sorted = [...all].sort((a, b) => a.t - b.t);
  const zero = sorted[0].t;
  const lines = sorted.map((m, i) => {
    const step = i === 0 ? 0 : m.t - sorted[i - 1].t;
    const cells = [
      String(m.t - zero).padStart(6) + 'ms',
      ('+' + step).padStart(7),
      m.name,
    ];
    return '  ' + cells.join('  ') + (m.note ? `  (${m.note})` : '');
  });
  const total = sorted[sorted.length - 1].t - zero;
  return [`[openTrace] ${total}ms total`, ...lines].join('\n');
}
