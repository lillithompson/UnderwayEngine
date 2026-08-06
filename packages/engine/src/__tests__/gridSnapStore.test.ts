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
  setGridSnapDefault,
  __resetGridSnapStoreForTest,
} from '../gridSnapStore';
import { loadGridSnap } from '../persistence';

const GRID_SNAP_KEY = 'app_grid_snap';

beforeEach(() => {
  for (const key of Object.keys(storage)) delete storage[key];
  __resetGridSnapStoreForTest();
});

describe('gridSnapStore', () => {
  test('default is false (synchronous snapshot before storage resolves)', () => {
    expect(getSnapshot()).toBe(false);
  });

  test('persistence reports null when no key is stored', async () => {
    expect(await loadGridSnap()).toBeNull();
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

// The format default (EditorConfig.canvas.gridSnapDefault, seeded by
// EditorShell): it fills in for a user who has never touched the toggle, and
// is overridden — never overrides — once they have.
describe('format snap default', () => {
  beforeEach(() => { __resetGridSnapStoreForTest(null); });

  test('applies when the user has never set the toggle, and notifies', () => {
    const listener = jest.fn();
    subscribe(listener);
    expect(getSnapshot()).toBe(false);

    setGridSnapDefault(true);
    expect(getSnapshot()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    // Leaving the format takes its default with it.
    setGridSnapDefault(false);
    expect(getSnapshot()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test('never persists — it is not a user choice', async () => {
    subscribe(() => {});
    setGridSnapDefault(true);
    await Promise.resolve();
    expect(storage[GRID_SNAP_KEY]).toBeUndefined();
  });

  test('the user’s toggle wins over it, in both directions', () => {
    subscribe(() => {});
    setGridSnapDefault(true);

    // Turning it off inside a snap-by-default format sticks…
    setGridSnap(false);
    expect(getSnapshot()).toBe(false);
    // …including across a re-seed of the same default.
    setGridSnapDefault(false);
    setGridSnapDefault(true);
    expect(getSnapshot()).toBe(false);

    // And a user who wants snap keeps it in formats that don't default to it.
    setGridSnap(true);
    setGridSnapDefault(false);
    expect(getSnapshot()).toBe(true);
  });

  test('a toggle made before the stored read resolves is not clobbered by it', async () => {
    storage[GRID_SNAP_KEY] = JSON.stringify(false);
    subscribe(() => {});
    setGridSnap(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(getSnapshot()).toBe(true);
  });

  test('a stored user preference beats the default once it loads', async () => {
    storage[GRID_SNAP_KEY] = JSON.stringify(false);
    setGridSnapDefault(true);
    const listener = jest.fn();
    subscribe(listener);
    expect(getSnapshot()).toBe(true); // pre-load: the default answers
    await Promise.resolve();
    await Promise.resolve();
    expect(getSnapshot()).toBe(false);
    expect(listener).toHaveBeenCalled();
  });

  test('a no-op re-seed does not notify', () => {
    const listener = jest.fn();
    subscribe(listener);
    setGridSnapDefault(false);
    expect(listener).not.toHaveBeenCalled();
  });
});
