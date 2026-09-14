import type { NativeToWebMessage } from '../protocol';

// initBridge had no caller anywhere in the app. Every web entry imports this
// module for isInWebView/postAppEvent/signalReady and none of them called the
// init, so its handlers were never registered — and native was sending all
// three messages the whole time.
//
// The worst of it was the liveness probe. After a background longer than
// LONG_BACKGROUND_MS native pings and arms a WATCHDOG_MS timer that RELOADS
// the WebView if no pong arrives (WebViewShell). Nothing ponged. So the app
// threw away its WebView every time it was reopened more than five minutes
// later — a false positive every time, for the one bug the probe exists to
// catch.
//
// These import the module fresh under a fake window: the property being
// pinned is that importing is enough, because relying on a caller is what
// broke it.

type W = { window?: Record<string, unknown>; requestAnimationFrame?: unknown };

let posted: unknown[];
let rafs: (() => void)[];

function setWindow(inShell: boolean): void {
  posted = [];
  rafs = [];
  const w: Record<string, unknown> = {
    ReactNativeWebView: { postMessage: (s: string) => { posted.push(JSON.parse(s)); } },
    addEventListener: () => {},
    dispatchEvent: (e: unknown) => { (w.__dispatched as unknown[]).push(e); return true; },
    __dispatched: [],
    documentElement: { style: { setProperty: () => {} } },
  };
  if (inShell) w.__FACET_NATIVE_SHELL = true;
  (globalThis as unknown as W).window = w;
  (globalThis as unknown as W).requestAnimationFrame = (cb: () => void) => { rafs.push(cb); return 1; };
}

async function importFresh(inShell = true): Promise<(msg: NativeToWebMessage) => void> {
  setWindow(inShell);
  jest.resetModules();
  await import('../webBridge');
  await Promise.resolve();
  return (globalThis as unknown as W).window!.__facetBridgeHandler as (m: NativeToWebMessage) => void;
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  delete (globalThis as unknown as W).window;
  delete (globalThis as unknown as W).requestAnimationFrame;
});

test('importing the bridge registers the native handlers — no init call required', async () => {
  const deliver = await importFresh();
  expect(deliver).toBeDefined();
});

test('a liveness ping is ponged, so the watchdog does not reload a healthy WebView', async () => {
  const deliver = await importFresh();
  deliver({ type: 'RESUME_HEALTH_PING', payload: { nonce: 'abc' } } as NativeToWebMessage);

  // The pong is sent from INSIDE a requestAnimationFrame callback: the point
  // is not that JS is alive but that the paint loop has actually ticked.
  expect(posted).toHaveLength(0);
  rafs.forEach((cb) => cb());

  expect(posted).toContainEqual({ type: 'RESUME_HEALTH_PONG', payload: { nonce: 'abc' } });
});

test('the pong carries back the nonce it was given, or it is ignored', async () => {
  const deliver = await importFresh();
  deliver({ type: 'RESUME_HEALTH_PING', payload: { nonce: 'n1' } } as NativeToWebMessage);
  rafs.forEach((cb) => cb());
  const pong = posted.find((p) => (p as { type: string }).type === 'RESUME_HEALTH_PONG');
  expect(pong).toEqual({ type: 'RESUME_HEALTH_PONG', payload: { nonce: 'n1' } });
});

test('an app-state change is re-broadcast for anything listening', async () => {
  const deliver = await importFresh();
  deliver({ type: 'APP_STATE', payload: { state: 'active' } } as NativeToWebMessage);
  const dispatched = (globalThis as unknown as W).window!.__dispatched as unknown[];
  expect(dispatched).toHaveLength(1);
});

test('initializing twice does not double-register — onNativeMessage chains', async () => {
  const deliver = await importFresh();
  const { initBridge } = await import('../webBridge');
  initBridge();
  initBridge();

  deliver({ type: 'RESUME_HEALTH_PING', payload: { nonce: 'once' } } as NativeToWebMessage);
  rafs.forEach((cb) => cb());
  const pongs = posted.filter((p) => (p as { type: string }).type === 'RESUME_HEALTH_PONG');
  expect(pongs).toHaveLength(1);
});

test('installs nothing outside the shell', async () => {
  const deliver = await importFresh(false);
  expect(deliver).toBeUndefined();
});
