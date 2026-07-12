/**
 * Background prefetch for dynamic-sample image URLs. Two tiers:
 *  - prefetchThumbnails: small images. Constructs an `Image`, awaits
 *    decode(). Warms the HTTP byte cache AND the decoded-bitmap cache so
 *    the `<img>` mounts paint instantly.
 *  - prefetchToHttpCache: larger images (example carousel slides). Uses
 *    `fetch` with `cache: 'force-cache'` to populate the HTTP cache only.
 *    Avoids bitmap-cache pressure for images the user may never see;
 *    decode happens lazily when the `<img>` mounts.
 *
 * Both are fire-and-forget. Errors are swallowed — a failed prefetch is
 * invisible; the `<img>` retries naturally when it mounts. Both share a
 * single module-level Set of URLs already requested this session so
 * repeat callers, manifest store updates, and re-renders never re-queue
 * work. The Set is bounded by the number of distinct CDN URLs in a
 * session (~100) so it doesn't grow without bound.
 *
 * Outer scheduling defers to `requestIdleCallback` (with a setTimeout
 * fallback) so prefetch work runs only when the browser is idle — never
 * delays first paint of the screen that triggered it.
 */

const requested = new Set<string>();

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void) => number;
};

/**
 * Run `cb` once the runtime is idle. In WKWebView this defers past the
 * next paint via requestIdleCallback. In environments without it (older
 * Safari, jsdom), falls back to a 2s setTimeout. In Node (jest test env)
 * runs inline so tests can await a returned Promise without timer
 * orchestration.
 */
function schedule(cb: () => Promise<void>): Promise<void> {
  if (typeof window === 'undefined') {
    return cb();
  }
  const w = window as IdleWindow;
  if (typeof w.requestIdleCallback === 'function') {
    return new Promise<void>((resolve) => {
      w.requestIdleCallback!(() => {
        cb().finally(resolve);
      });
    });
  }
  return new Promise<void>((resolve) => {
    window.setTimeout(() => {
      cb().finally(resolve);
    }, 2000);
  });
}

async function runWithConcurrency(
  items: string[],
  concurrency: number,
  work: (url: string) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workerCount = Math.min(concurrency, items.length);
  const workers: Promise<void>[] = [];
  for (let w = 0; w < workerCount; w++) {
    workers.push((async () => {
      while (true) {
        const idx = next++;
        if (idx >= items.length) return;
        try {
          await work(items[idx]);
        } catch {
          // swallowed — failed prefetch is invisible
        }
      }
    })());
  }
  await Promise.all(workers);
}

function takeFresh(urls: string[]): string[] {
  const out: string[] = [];
  for (const u of urls) {
    if (!requested.has(u)) {
      requested.add(u);
      out.push(u);
    }
  }
  return out;
}

async function decodeOne(url: string): Promise<void> {
  if (typeof Image === 'undefined') return;
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  if (typeof img.decode === 'function') {
    await img.decode().catch(() => undefined);
    return;
  }
  await new Promise<void>((resolve) => {
    img.onload = () => resolve();
    img.onerror = () => resolve();
  });
}

async function fetchOne(url: string): Promise<void> {
  if (typeof fetch === 'undefined') return;
  const resp = await fetch(url, { cache: 'force-cache' });
  // Drain body so the response can be released and the connection
  // freed for the next worker.
  if (resp.body) {
    try { await resp.arrayBuffer(); } catch { /* ignore */ }
  }
}

/**
 * Decode-warm a batch of small image URLs. Idempotent and fire-and-forget;
 * the returned Promise exists only for tests to await completion. Do not
 * await in production code.
 *
 * Fires immediately (no idle scheduling). The work of constructing an
 * `Image` and setting `.src` is sub-millisecond on the main thread; the
 * actual download and decode happen off-thread. Idle-scheduling thumbnail
 * prefetch was self-defeating: it lost the race against the `<img>` tags
 * mounting on cold start (which kicked off the same fetches without
 * prefetch acceleration), and the lazy-chunk prefetch in `_layout.tsx`
 * starved the idle queue. Fire-now lets the prefetch start *before* the
 * `<img>` tags mount when called from the manifest store.
 */
export function prefetchThumbnails(
  urls: string[],
  opts: { concurrency?: number } = {},
): Promise<void> {
  const fresh = takeFresh(urls);
  if (fresh.length === 0) return Promise.resolve();
  const concurrency = opts.concurrency ?? 6;
  return runWithConcurrency(fresh, concurrency, decodeOne);
}

/**
 * HTTP-cache-warm a batch of larger image URLs without decoding. Idempotent
 * and fire-and-forget; returned Promise is for tests only.
 */
export function prefetchToHttpCache(
  urls: string[],
  opts: { concurrency?: number } = {},
): Promise<void> {
  const fresh = takeFresh(urls);
  if (fresh.length === 0) return Promise.resolve();
  const concurrency = opts.concurrency ?? 4;
  return schedule(() => runWithConcurrency(fresh, concurrency, fetchOne));
}

export function __resetForTests(): void {
  requested.clear();
}
