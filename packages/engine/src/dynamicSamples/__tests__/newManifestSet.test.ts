// In-memory mock of engine/storage so the store can run without IndexedDB.
jest.mock('../../storage', () => {
  const data = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: (k: string) => Promise.resolve(data.get(k) ?? null),
      setItem: (k: string, v: string) => {
        data.set(k, v);
        return Promise.resolve();
      },
      removeItem: (k: string) => {
        data.delete(k);
        return Promise.resolve();
      },
      multiGet: (keys: string[]) =>
        Promise.resolve(keys.map((k) => [k, data.get(k) ?? null] as [string, string | null])),
      multiRemove: (keys: string[]) => {
        for (const k of keys) data.delete(k);
        return Promise.resolve();
      },
      clear: () => {
        data.clear();
        return Promise.resolve();
      },
      getBinary: () => Promise.resolve(null),
      setBinary: () => Promise.resolve(),
    },
  };
});

import {
  __resetForTests,
  clearManifestEntryNew,
  getNewManifestSet,
  recomputeFromVisible,
  subscribeNewManifestSet,
} from '../newManifestSet';

describe('newManifestSet', () => {
  beforeEach(() => {
    __resetForTests();
  });

  it('starts empty', () => {
    expect(getNewManifestSet().size).toBe(0);
  });

  it('recomputeFromVisible marks first-time visible ids and returns them', () => {
    const added = recomputeFromVisible(['a', 'b']);
    expect(added.sort()).toEqual(['a', 'b']);
    expect(Array.from(getNewManifestSet()).sort()).toEqual(['a', 'b']);
  });

  it('recomputeFromVisible is idempotent — no re-marking on second pass', () => {
    recomputeFromVisible(['a', 'b']);
    const added = recomputeFromVisible(['a', 'b']);
    expect(added).toEqual([]);
    expect(getNewManifestSet().size).toBe(2);
  });

  it('clearing an id does not re-mark on next recompute', () => {
    recomputeFromVisible(['a']);
    clearManifestEntryNew('a');
    expect(getNewManifestSet().has('a')).toBe(false);
    const added = recomputeFromVisible(['a']);
    expect(added).toEqual([]);
    expect(getNewManifestSet().has('a')).toBe(false);
  });

  it('clearing one id leaves the others alone', () => {
    recomputeFromVisible(['a', 'b']);
    clearManifestEntryNew('a');
    expect(Array.from(getNewManifestSet())).toEqual(['b']);
  });

  it('notifies subscribers with a fresh Set snapshot on each change', () => {
    const snapshots: Set<string>[] = [];
    subscribeNewManifestSet((s) => snapshots.push(s));
    recomputeFromVisible(['a']);
    recomputeFromVisible(['b']);
    clearManifestEntryNew('a');
    expect(snapshots.length).toBe(3);
    expect(Array.from(snapshots[0])).toEqual(['a']);
    expect(Array.from(snapshots[1]).sort()).toEqual(['a', 'b']);
    expect(Array.from(snapshots[2])).toEqual(['b']);
  });

  it('subscribe returns an unsubscribe that stops further notifications', () => {
    let calls = 0;
    const unsubscribe = subscribeNewManifestSet(() => {
      calls++;
    });
    recomputeFromVisible(['a']);
    unsubscribe();
    recomputeFromVisible(['b']);
    expect(calls).toBe(1);
  });

  it('isolates a thrown listener from blocking the rest', () => {
    let secondSaw: Set<string> | null = null;
    subscribeNewManifestSet(() => {
      throw new Error('boom');
    });
    subscribeNewManifestSet((s) => {
      secondSaw = s;
    });
    recomputeFromVisible(['a']);
    expect(secondSaw).not.toBeNull();
    expect((secondSaw as unknown as Set<string>).has('a')).toBe(true);
  });

  it('__resetForTests clears state and listeners', () => {
    let calls = 0;
    subscribeNewManifestSet(() => {
      calls++;
    });
    recomputeFromVisible(['a']);
    __resetForTests();
    expect(getNewManifestSet().size).toBe(0);
    recomputeFromVisible(['b']);
    expect(calls).toBe(1);
  });
});
