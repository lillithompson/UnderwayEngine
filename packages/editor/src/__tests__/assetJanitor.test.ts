// WHEN the blob janitor runs. Two rules pulling opposite ways: never while a
// page is open (mark-and-sweep marks from what is STORED, and a live session
// holds an undo stack that is not), and rarely (a sweep reads every
// composition record, and the bytes it recovers were orphaned days ago).
//
// Driven over a made-up namespace, because the stamp is a key under the
// app's own (storeKeys.ts). WHICH app installs the janitor, and that its
// shell holds the sweep off while a page is open, stays pinned in each app.

jest.mock('@/engine/imageAssetStore', () => ({
  setAssetSweepGuard: jest.fn(),
  sweepImageAssets: jest.fn(async () => ({ deleted: 2, bytesFreed: 4096, scanned: 9, skipped: false })),
}));

const { setAssetSweepGuard, sweepImageAssets } =
  require('@/engine/imageAssetStore') as { setAssetSweepGuard: jest.Mock; sweepImageAssets: jest.Mock };

import {
  __resetAssetSweepHolds, holdAssetSweep, installAssetJanitor,
  registerExtraSweep, sweepIfDue,
} from '../store/assetJanitor';
import { registerStoreNamespace, storeKey } from '../store/storeKeys';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 13, 9, 0, 0);

/** A localStorage stand-in — the sweep stamp's home. */
function fakeLocalStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: () => null,
    get length() { return map.size; },
  } as unknown as Storage;
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetAssetSweepHolds();
  registerStoreNamespace('madeup');
  registerExtraSweep(null);
  Object.defineProperty(globalThis, 'localStorage', { value: fakeLocalStorage(), configurable: true });
});

afterEach(() => {
  registerExtraSweep(null);
  registerStoreNamespace(null);
});

describe('sweepIfDue', () => {
  it('sweeps on the first ask, then not again for a day', async () => {
    expect(await sweepIfDue(T0)).toEqual({ deleted: 2, bytesFreed: 4096, scanned: 9, skipped: false });
    expect(await sweepIfDue(T0 + 60_000)).toBeNull();
    expect(await sweepIfDue(T0 + DAY - 1)).toBeNull();
    expect(await sweepIfDue(T0 + DAY)).not.toBeNull();
    expect(sweepImageAssets).toHaveBeenCalledTimes(2);
  });

  it('declines while any page is open, and does not spend the day’s allowance doing so', async () => {
    const release = holdAssetSweep();
    expect(await sweepIfDue(T0)).toBeNull();
    expect(sweepImageAssets).not.toHaveBeenCalled();
    // …and the sweep it declined is still due the moment the page closes.
    release();
    expect(await sweepIfDue(T0 + 1)).not.toBeNull();
  });

  it('counts holds, so a second surface opening does not release the first’s', async () => {
    const a = holdAssetSweep();
    const b = holdAssetSweep();
    a();
    expect(await sweepIfDue(T0)).toBeNull();
    b();
    expect(await sweepIfDue(T0)).not.toBeNull();
  });

  it('a release is idempotent — a double-unmount cannot leave the count negative', async () => {
    const release = holdAssetSweep();
    release();
    release();
    const other = holdAssetSweep();
    expect(await sweepIfDue(T0)).toBeNull();
    other();
  });

  it('a sweep that throws is null, and is not retried a second later', async () => {
    // Best-effort by contract: a throw here must never be why a foreground
    // fails — and a sweep that dies half way through should not be retried
    // on every foreground until it succeeds.
    sweepImageAssets.mockRejectedValueOnce(new Error('IndexedDB gone'));
    expect(await sweepIfDue(T0)).toBeNull();
    expect(await sweepIfDue(T0 + 60_000)).toBeNull();
    expect(sweepImageAssets).toHaveBeenCalledTimes(1);
  });

  it('survives a store that will not answer', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } },
      configurable: true,
    });
    expect(await sweepIfDue(T0)).not.toBeNull();
  });
});

describe('installAssetJanitor', () => {
  it('registers the guard, which answers for every open page', () => {
    const teardown = installAssetJanitor();
    const guard = setAssetSweepGuard.mock.calls[0][0] as () => boolean;
    expect(guard()).toBe(true);
    const release = holdAssetSweep();
    expect(guard()).toBe(false);
    release();
    expect(guard()).toBe(true);
    teardown();
    expect(setAssetSweepGuard).toHaveBeenLastCalledWith(null);
  });
});

describe('the stamp', () => {
  it('lives under the app’s own namespace, so two apps never share a day', () => {
    const store = fakeLocalStorage();
    Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
    void sweepIfDue(T0);
    expect(store.getItem(storeKey('assetSweep', 'last'))).toBe(String(T0));
    expect(store.getItem('madeup:assetSweep:last')).toBe(String(T0));
  });

  it('is read through the namespace at each use, not captured at load', async () => {
    // Both the namespace install and this module's load are module-scope
    // effects, and their order is the bundler's. A key captured into a
    // module constant would be built before the install in whichever
    // bundle ordered them that way, and throw.
    const store = fakeLocalStorage();
    Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
    await sweepIfDue(T0);
    registerStoreNamespace('other');
    // A different app's stamp is a different key, so the sweep is due again.
    expect(await sweepIfDue(T0 + 1)).not.toBeNull();
    expect(store.getItem('other:assetSweep:last')).toBe(String(T0 + 1));
  });
});

describe('an app’s own sweep, riding along', () => {
  it('runs before the blob sweep, on the same day’s schedule', async () => {
    const order: string[] = [];
    registerExtraSweep(async () => { order.push('extra'); });
    sweepImageAssets.mockImplementationOnce(async () => {
      order.push('blobs');
      return { deleted: 0, bytesFreed: 0, scanned: 0, skipped: false };
    });
    await sweepIfDue(T0);
    // The app's own leftovers first: theirs is a key scan plus an entry
    // listing, and it must not cost the blob sweep its day.
    expect(order).toEqual(['extra', 'blobs']);
  });

  it('is not run when the sweep is declined for an open page', async () => {
    const extra = jest.fn(async () => {});
    registerExtraSweep(extra);
    const release = holdAssetSweep();
    expect(await sweepIfDue(T0)).toBeNull();
    expect(extra).not.toHaveBeenCalled();
    release();
  });

  it('does not cost the blob sweep its run when it throws', async () => {
    registerExtraSweep(async () => { throw new Error('key scan failed'); });
    expect(await sweepIfDue(T0)).not.toBeNull();
    expect(sweepImageAssets).toHaveBeenCalledTimes(1);
  });

  it('is absent for an app that installs none, which is the ordinary case', async () => {
    expect(await sweepIfDue(T0)).not.toBeNull();
    expect(sweepImageAssets).toHaveBeenCalledTimes(1);
  });

  // The seam takes `Promise<unknown>`, not `Promise<void>`: this module
  // discards whatever the sweep answers, and an app's existing sweep is
  // likely to report what it removed — DrawBots' `sweepOrphanSimDocuments`
  // returns a `SimSweepResult`. Narrowing it back to `Promise<void>` would
  // fail this file's COMPILE, which is the only tool there is for a
  // declaration; DrawBots' typecheck is what found it.
  it('takes a sweep that reports what it removed, not just a void one', async () => {
    const reporting = async () => ({ deleted: 3, scanned: 11 });
    registerExtraSweep(reporting);
    expect(await sweepIfDue(T0)).not.toBeNull();
  });
});
