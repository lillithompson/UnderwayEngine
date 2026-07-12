const storage: Record<string, string> = {};

jest.mock('@/engine/storage', () => ({
  default: {
    getItem: jest.fn((key: string) => Promise.resolve(storage[key] ?? null)),
    setItem: jest.fn((key: string, value: string) => {
      storage[key] = value;
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      delete storage[key];
      return Promise.resolve();
    }),
  },
  __esModule: true,
}));

import {
  subscribe,
  getSnapshot,
  setShowDimensions,
  __resetShowDimensionsStoreForTest,
} from '../showDimensionsStore';
import { loadShowDimensions } from '../persistence';

const SHOW_DIMENSIONS_KEY = 'app_show_dimensions';

beforeEach(() => {
  for (const key of Object.keys(storage)) delete storage[key];
  __resetShowDimensionsStoreForTest(true);
});

describe('showDimensionsStore', () => {
  test('default is true (synchronous snapshot before storage resolves)', () => {
    expect(getSnapshot()).toBe(true);
  });

  test('persistence default is true when no key is stored', async () => {
    expect(await loadShowDimensions()).toBe(true);
  });

  test('persistence respects an explicitly stored false', async () => {
    storage[SHOW_DIMENSIONS_KEY] = JSON.stringify(false);
    expect(await loadShowDimensions()).toBe(false);
  });

  test('multiple subscribers all see updates from setShowDimensions', () => {
    const a = jest.fn();
    const b = jest.fn();
    const unsubA = subscribe(a);
    const unsubB = subscribe(b);

    setShowDimensions(false);
    expect(getSnapshot()).toBe(false);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    setShowDimensions(true);
    expect(getSnapshot()).toBe(true);
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(2);

    unsubA();
    unsubB();
  });

  test('no-op when value is unchanged', () => {
    const listener = jest.fn();
    subscribe(listener);
    setShowDimensions(true); // already true (default)
    expect(listener).not.toHaveBeenCalled();
  });

  test('setShowDimensions persists to storage', async () => {
    subscribe(() => {});
    setShowDimensions(false);
    // saveShowDimensions returns a promise; flush microtasks
    await Promise.resolve();
    expect(storage[SHOW_DIMENSIONS_KEY]).toBe(JSON.stringify(false));
  });

  test('first subscribe loads persisted value and notifies', async () => {
    storage[SHOW_DIMENSIONS_KEY] = JSON.stringify(false);
    const listener = jest.fn();
    subscribe(listener);
    // load is async; flush
    await Promise.resolve();
    await Promise.resolve();
    expect(getSnapshot()).toBe(false);
    expect(listener).toHaveBeenCalled();
  });

  test('unsubscribed listeners do not receive updates', () => {
    const a = jest.fn();
    const unsub = subscribe(a);
    unsub();
    setShowDimensions(false);
    expect(a).not.toHaveBeenCalled();
  });
});
