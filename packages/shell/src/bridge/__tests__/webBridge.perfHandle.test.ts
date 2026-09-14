import { initBridge } from '../webBridge';
import { countBase64, countDecode, resetPerfCounters } from '@/engine/debug/perfCounters';

// docs/image_refactor.md §5's budgets are per-tick quantities inside a JS
// heap, which is exactly what an Allocations trace cannot attribute. Jest
// asserts them directly; this is the other half — reading them off a real
// phone, where until now there was no way in at all.

interface PerfHandle {
  read(): { base64Count: number; decodeFullCount: number };
  reset(): string;
  log(reason?: string): { base64Count: number };
}

type W = {
  window?: Record<string, unknown>;
  setTimeout?: typeof setTimeout;
};

let posted: string[];

beforeEach(() => {
  // initBridge arms a 4 s splash-dismiss fallback; without fake timers it
  // outlives the test and jest force-exits the worker.
  jest.useFakeTimers();
  posted = [];
  resetPerfCounters();
  (globalThis as unknown as W).window = {
    __FACET_NATIVE_SHELL: true,
    ReactNativeWebView: { postMessage: (s: string) => { posted.push(s); } },
    addEventListener: () => {},
    dispatchEvent: () => true,
  };
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  delete (globalThis as unknown as W).window;
});

/** initBridge installs the handle through a dynamic import; let it land. */
async function bridgeUp(): Promise<PerfHandle> {
  initBridge();
  await Promise.resolve();
  await Promise.resolve();
  return (globalThis as unknown as W).window!.__perf as PerfHandle;
}

test('the counters are reachable from a Web Inspector attached to the WebView', async () => {
  const perf = await bridgeUp();
  expect(perf).toBeDefined();

  countBase64(1024);
  countDecode(false);
  expect(perf.read().base64Count).toBe(1);
  expect(perf.read().decodeFullCount).toBe(1);
});

test('reset zeroes them, so the next read covers one tick and not the session', async () => {
  const perf = await bridgeUp();
  countBase64(1024);
  expect(perf.reset()).toBe('perf counters zeroed');
  expect(perf.read().base64Count).toBe(0);
});

test('log sends one line to native, for a device with no inspector attached', async () => {
  const perf = await bridgeUp();
  countBase64(2048);
  countDecode(true);
  perf.log('tick');

  const logs = posted.map((p) => JSON.parse(p)).filter((m) => m.type === 'LOG');
  const line = logs.find((m) => m.payload.tag === 'perf');
  expect(line).toBeDefined();
  expect(line.payload.level).toBe('log');
  expect(line.payload.text).toBe(
    'tick — reads 0/0 B · writes 0/0 B · base64 1/2.0 KB · decodes 0 full, 1 scaled',
  );
});

test('the handle is absent outside the WebView — there is no native to log to', async () => {
  (globalThis as unknown as W).window = { addEventListener: () => {} };
  initBridge();
  await Promise.resolve();
  expect((globalThis as unknown as W).window!.__perf).toBeUndefined();
});
