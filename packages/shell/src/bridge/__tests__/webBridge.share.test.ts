import { onNativeMessage, shareBinaryFile, shareFile } from '../webBridge';
import type { NativeToWebMessage } from '../protocol';

// The share sheet's wait. Native answers a SHARE_FILE once, when the sheet
// is dismissed — after a Drive upload that can take minutes — so the wait
// must hold for as long as that takes, pass everything else to the handler
// that was there before, and put that handler back when the answer lands.
// (A 30 s clock here reported a failure for an export that then landed:
// CozyJournal bug report 943b3694.)

type W = {
  window?: {
    __FACET_NATIVE_SHELL?: boolean;
    __facetBridgeHandler?: (msg: NativeToWebMessage) => void;
    ReactNativeWebView?: { postMessage(data: string): void };
  };
};

const posted: string[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  posted.length = 0;
  (globalThis as W).window = {
    __FACET_NATIVE_SHELL: true,
    ReactNativeWebView: { postMessage: (d) => { posted.push(d); } },
  };
});
afterEach(() => {
  jest.useRealTimers();
  delete (globalThis as W).window;
});

function deliver(msg: NativeToWebMessage): void {
  (globalThis as W).window!.__facetBridgeHandler!(msg);
}

/** Whether `p` has settled, judged after the microtasks drain. */
async function settled(p: Promise<unknown>): Promise<boolean> {
  let done = false;
  void p.then(() => { done = true; }, () => { done = true; });
  await Promise.resolve();
  await Promise.resolve();
  return done;
}

test('a binary share waits past any clock for the sheet to be dismissed, then reports what native said', async () => {
  const p = shareBinaryFile(new Uint8Array([1, 2, 3]), 'page.tile', 'application/octet-stream');
  expect(JSON.parse(posted[0])).toEqual({
    type: 'SHARE_FILE',
    payload: { data: 'AQID', filename: 'page.tile', mimeType: 'application/octet-stream', uti: undefined },
  });

  // Ten minutes in the sheet: still waiting, still not a failure.
  jest.advanceTimersByTime(10 * 60 * 1000);
  expect(await settled(p)).toBe(false);

  deliver({ type: 'SHARE_RESULT', payload: { success: true } });
  await expect(p).resolves.toEqual({ success: true });
  // The handler that was there before (none) is back.
  expect((globalThis as W).window!.__facetBridgeHandler).toBeUndefined();
});

test('a text share reports native’s failure word, and passes messages on to the earlier handler meanwhile', async () => {
  const before: string[] = [];
  (globalThis as W).window!.__facetBridgeHandler = (msg) => { before.push(msg.type); };

  const p = shareFile('<svg/>', 'page.svg', 'image/svg+xml', 'public.svg-image');
  jest.advanceTimersByTime(60 * 1000);
  deliver({ type: 'APP_STATE', payload: { state: 'active' } });
  expect(before).toEqual(['APP_STATE']);
  expect(await settled(p)).toBe(false);

  deliver({ type: 'SHARE_RESULT', payload: { success: false, error: 'failed' } });
  await expect(p).resolves.toEqual({ success: false, error: 'failed' });
  deliver({ type: 'APP_STATE', payload: { state: 'background' } });
  // Every message reaches every listener now — the share's answer too;
  // each listener picks out its own types — and the earlier handler is
  // the one left in place once the share's wait is gone.
  expect(before).toEqual(['APP_STATE', 'SHARE_RESULT', 'APP_STATE']);
  expect((globalThis as W).window!.__facetBridgeHandler).not.toBeUndefined();
});

test('a listener that came BEFORE the share and leaves while the sheet is open cannot take the answer with it', async () => {
  // Bug report e3825177: a reply listener (home state, asset urls) was
  // registered, the share started over it, and the listener unsubscribed
  // while the sheet was up. Under the old chain its unsubscribe put back
  // the handler from before the share — and the SHARE_RESULT that came
  // later reached nobody, leaving the export screen on "Packing this
  // page…" for good.
  const heard: string[] = [];
  const offEarlier = onNativeMessage((msg) => { heard.push(msg.type); });
  const p = shareBinaryFile(new Uint8Array([1]), 'page.tile', 'application/octet-stream');
  offEarlier();

  deliver({ type: 'SHARE_RESULT', payload: { success: true } });
  await expect(p).resolves.toEqual({ success: true });
  expect(heard).toEqual([]);
  expect((globalThis as W).window!.__facetBridgeHandler).toBeUndefined();
});

test('…and the share finishing first does not unlink a listener that came after it', async () => {
  const p = shareBinaryFile(new Uint8Array([1]), 'page.tile', 'application/octet-stream');
  const heard: string[] = [];
  const offLater = onNativeMessage((msg) => { heard.push(msg.type); });

  deliver({ type: 'SHARE_RESULT', payload: { success: true } });
  await expect(p).resolves.toEqual({ success: true });
  deliver({ type: 'APP_STATE', payload: { state: 'active' } });
  expect(heard).toEqual(['SHARE_RESULT', 'APP_STATE']);
  offLater();
  expect((globalThis as W).window!.__facetBridgeHandler).toBeUndefined();
});

test('two overlapping waits each get their own answer', async () => {
  const share = shareFile('<svg/>', 'a.svg', 'image/svg+xml');
  const heard: string[] = [];
  const off = onNativeMessage((msg) => { heard.push(msg.type); });
  const again = shareFile('<svg/>', 'b.svg', 'image/svg+xml');
  off();
  // One answer settles both pending share waits (native posts one per
  // sheet; only one sheet is ever up), and neither is lost.
  deliver({ type: 'SHARE_RESULT', payload: { success: true } });
  await expect(share).resolves.toEqual({ success: true });
  await expect(again).resolves.toEqual({ success: true });
});
