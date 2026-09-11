import { onAppEvent, onNativeMessage } from '../webBridge';
import type { NativeToWebMessage } from '../protocol';

// The reply leg of postAppEvent: native answers an APP_EVENT with one of its
// own, and the web listens per kind. Everything else must still reach the
// handlers registered before (the chain onNativeMessage builds).

type W = { window?: { __facetBridgeHandler?: (msg: NativeToWebMessage) => void } };

beforeEach(() => { (globalThis as W).window = {}; });
afterEach(() => { delete (globalThis as W).window; });

function deliver(msg: NativeToWebMessage): void {
  (globalThis as W).window!.__facetBridgeHandler!(msg);
}

test('receives the data of its kind, ignores other kinds and other messages', () => {
  const got: unknown[] = [];
  const off = onAppEvent('manifest', (data) => got.push(data));
  deliver({ type: 'APP_EVENT', payload: { kind: 'manifest', data: { a: 1 } } });
  deliver({ type: 'APP_EVENT', payload: { kind: 'other', data: { b: 2 } } });
  deliver({ type: 'APP_STATE', payload: { state: 'active' } });
  expect(got).toEqual([{ a: 1 }]);
  off();
  // Unsubscribing restores what was there before: nothing.
  expect((globalThis as W).window!.__facetBridgeHandler).toBeUndefined();
});

test('chains with handlers registered earlier and later', () => {
  const all: string[] = [];
  onNativeMessage((msg) => all.push(msg.type));
  const got: unknown[] = [];
  onAppEvent('manifest', (data) => got.push(data));
  deliver({ type: 'APP_EVENT', payload: { kind: 'manifest', data: 7 } });
  expect(got).toEqual([7]);
  expect(all).toEqual(['APP_EVENT']);
});
