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
  setGridSnap,
  __resetGridSnapStoreForTest,
} from '../gridSnapStore';
import { loadGridSnap } from '../persistence';

const GRID_SNAP_KEY = 'app_grid_snap';

beforeEach(() => {
  for (const key of Object.keys(storage)) delete storage[key];
  __resetGridSnapStoreForTest(false);
});

describe('gridSnapStore', () => {
  test('default is false (synchronous snapshot before storage resolves)', () => {
    expect(getSnapshot()).toBe(false);
  });

  test('persistence default is false when no key is stored', async () => {
    expect(await loadGridSnap()).toBe(false);
  });

  test('persistence respects an explicitly stored true', async () => {
    storage[GRID_SNAP_KEY] = JSON.stringify(true);
    expect(await loadGridSnap()).toBe(true);
  });

  test('multiple subscribers all see updates from setGridSnap', () => {
    const a = jest.fn();
    const b = jest.fn();
    const unsubA = subscribe(a);
    const unsubB = subscribe(b);

    setGridSnap(true);
    expect(getSnapshot()).toBe(true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    setGridSnap(false);
    expect(getSnapshot()).toBe(false);
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(2);

    unsubA();
    unsubB();
  });

  test('no-op when value is unchanged', () => {
    const listener = jest.fn();
    subscribe(listener);
    setGridSnap(false); // already false (default)
    expect(listener).not.toHaveBeenCalled();
  });

  test('setGridSnap persists to storage', async () => {
    subscribe(() => {});
    setGridSnap(true);
    await Promise.resolve();
    expect(storage[GRID_SNAP_KEY]).toBe(JSON.stringify(true));
  });

  test('first subscribe loads persisted value and notifies', async () => {
    storage[GRID_SNAP_KEY] = JSON.stringify(true);
    const listener = jest.fn();
    subscribe(listener);
    await Promise.resolve();
    await Promise.resolve();
    expect(getSnapshot()).toBe(true);
    expect(listener).toHaveBeenCalled();
  });

  test('unsubscribed listeners do not receive updates', () => {
    const a = jest.fn();
    const unsub = subscribe(a);
    unsub();
    setGridSnap(true);
    expect(a).not.toHaveBeenCalled();
  });
});
