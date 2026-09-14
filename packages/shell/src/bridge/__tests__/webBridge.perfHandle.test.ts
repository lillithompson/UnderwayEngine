import type * as PerfModule from '@/engine/debug/perfCounters';

// docs/image_refactor.md §5's budgets are per-tick quantities inside a JS
// heap, which is exactly what an Allocations trace cannot attribute. Jest
// asserts them directly; this is the other half — reading them off a real
// phone, where until now there was no way in at all.
//
// These import the module FRESH under a fake window, because the property
// being pinned is that merely importing webBridge installs the handle. The
// first version hung it off initBridge() and called initBridge() from the
// test: green here, absent on the device, because initBridge has no caller
// anywhere in the app.

interface PerfHandle {
  read(): { base64Count: number; decodeFullCount: number };
  reset(): string;
  log(reason?: string): unknown;
}

type W = { window?: Record<string, unknown> };

let posted: string[];

/** A profiling build. DIAGNOSTICS reads this at module load, and Jest
 *  defines no __DEV__, so without it the handle is (correctly) absent. */
function setProfiling(on: boolean): void {
  if (on) process.env.EXPO_PUBLIC_WEBVIEW_INSPECTABLE = '1';
  else delete process.env.EXPO_PUBLIC_WEBVIEW_INSPECTABLE;
}

function setWindow(inShell: boolean): void {
  posted = [];
  (globalThis as unknown as W).window = {
    ...(inShell ? { __FACET_NATIVE_SHELL: true } : {}),
    ReactNativeWebView: { postMessage: (s: string) => { posted.push(s); } },
    addEventListener: () => {},
    dispatchEvent: () => true,
  };
}

/**
 * Import webBridge as a device would: window already carrying the shell flag
 * (injectedJavaScriptBeforeContentLoaded sets it before any page script), then
 * the module evaluated for the first time.
 *
 * resetModules gives the bridge a fresh perfCounters too, so the counting
 * functions must come from the SAME fresh registry — a top-level import here
 * would be a different module object holding different integers. In the app
 * there is one registry and no such split.
 */
async function importFresh(inShell = true, profiling = true): Promise<{
  perf: PerfHandle | undefined;
  counters: typeof PerfModule;
}> {
  setProfiling(profiling);
  setWindow(inShell);
  jest.resetModules();
  await import('../webBridge');
  const counters = await import('@/engine/debug/perfCounters');
  counters.resetPerfCounters();
  await Promise.resolve();
  await Promise.resolve();
  return {
    perf: (globalThis as unknown as W).window!.__perf as PerfHandle | undefined,
    counters,
  };
}

beforeEach(() => { jest.useFakeTimers(); });

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  setProfiling(false);
  delete (globalThis as unknown as W).window;
});

test('importing the bridge installs the handle — no init call required', async () => {
  const { perf, counters } = await importFresh();
  expect(perf).toBeDefined();

  counters.countBase64(1024);
  counters.countDecode(false);
  expect(perf!.read().base64Count).toBe(1);
  expect(perf!.read().decodeFullCount).toBe(1);
});

test('reset zeroes them, so the next read covers one tick and not the session', async () => {
  const { perf, counters } = await importFresh();
  counters.countBase64(1024);
  expect(perf!.reset()).toBe('perf counters zeroed');
  expect(perf!.read().base64Count).toBe(0);
});

test('log sends one line to native, for a device with no inspector attached', async () => {
  const { perf, counters } = await importFresh();
  counters.countBase64(2048);
  counters.countDecode(true);
  perf!.log('tick');

  const line = posted.map((p) => JSON.parse(p))
    .find((m) => m.type === 'LOG' && m.payload.tag === 'perf');
  expect(line).toBeDefined();
  expect(line.payload.level).toBe('log');
  expect(line.payload.text).toBe(
    'tick — blob r0/0 B · w0/0 B · text r0/0 B · w0/0 B'
    + ' · base64 1/2.0 KB · decodes 0 full, 1 scaled · headers 0 read, 0 missed',
  );
});

test('installs nothing outside the shell — plain web has no native to log to', async () => {
  expect((await importFresh(false)).perf).toBeUndefined();
});

test('a shipping build hands a page script no diagnostic surface', async () => {
  // Neither a dev build nor a profiling one: the counters still count (they
  // are integer adds on paths already doing I/O), but nothing is exposed,
  // and the dynamic import that would fetch a chunk at boot never happens.
  expect((await importFresh(true, false)).perf).toBeUndefined();
});
