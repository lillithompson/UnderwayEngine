// `hasBinary` asks the store for its key list, and that list is read ONCE.
//
// It used to call `keys()` per blob — a walk of the whole key space, every
// composition meta, every thumb, every figure file — so the cost of asking
// "is this photo already stored?" grew with the size of the journal rather
// than with the page being saved. Image bytes are immutable per id, so the
// answer only ever changes through the writes below, and those keep the
// cached set in step.

const store = new Map<string, unknown>();
let keysCalls = 0;

jest.mock('idb-keyval', () => ({
  get: jest.fn(async (key: string) => store.get(key)),
  set: jest.fn(async (key: string, value: unknown) => { store.set(key, value); }),
  del: jest.fn(async (key: string) => { store.delete(key); }),
  keys: jest.fn(async () => { keysCalls++; return Array.from(store.keys()); }),
  clear: jest.fn(async () => { store.clear(); }),
}));

import storage, { __resetStorageKeyCacheForTest } from '../storage';

beforeEach(() => {
  store.clear();
  keysCalls = 0;
  __resetStorageKeyCacheForTest();
});

describe('hasBinary', () => {
  it('scans the key space once, however many keys are asked about', async () => {
    store.set('imgblob_a', new Uint8Array([1]));
    expect(await storage.hasBinary('imgblob_a')).toBe(true);
    expect(await storage.hasBinary('imgblob_b')).toBe(false);
    expect(await storage.hasBinary('imgblob_a')).toBe(true);
    expect(keysCalls).toBe(1);
  });

  it('concurrent first callers share the one scan', async () => {
    store.set('imgblob_a', new Uint8Array([1]));
    const answers = await Promise.all([
      storage.hasBinary('imgblob_a'),
      storage.hasBinary('imgblob_b'),
      storage.hasBinary('imgblob_a'),
    ]);
    expect(answers).toEqual([true, false, true]);
    expect(keysCalls).toBe(1);
  });

  it('sees a key this session just wrote, without re-scanning', async () => {
    expect(await storage.hasBinary('imgblob_new')).toBe(false);
    await storage.setBinary('imgblob_new', new Uint8Array([1, 2, 3]));
    expect(await storage.hasBinary('imgblob_new')).toBe(true);
    await storage.setItem('comp_meta_1', '{}');
    expect(await storage.hasBinary('comp_meta_1')).toBe(true);
    expect(keysCalls).toBe(1);
  });

  it('forgets a key this session removed', async () => {
    store.set('imgblob_a', new Uint8Array([1]));
    store.set('imgblob_b', new Uint8Array([2]));
    store.set('imgblob_c', new Uint8Array([3]));
    expect(await storage.hasBinary('imgblob_a')).toBe(true);
    await storage.removeItem('imgblob_a');
    expect(await storage.hasBinary('imgblob_a')).toBe(false);
    await storage.multiRemove(['imgblob_b', 'imgblob_c']);
    expect(await storage.hasBinary('imgblob_b')).toBe(false);
    expect(await storage.hasBinary('imgblob_c')).toBe(false);
    expect(keysCalls).toBe(1);
  });

  it('a cleared store is empty, not stale', async () => {
    store.set('imgblob_a', new Uint8Array([1]));
    expect(await storage.hasBinary('imgblob_a')).toBe(true);
    await storage.clear();
    expect(await storage.hasBinary('imgblob_a')).toBe(false);
    expect(keysCalls).toBe(1);
  });

  it('a failed scan is retried, never cached as an empty store', async () => {
    // Caching the failure would tell the save path "nothing is stored" and
    // every blob would be rewritten for the rest of the session.
    const { keys } = require('idb-keyval') as { keys: jest.Mock };
    store.set('imgblob_a', new Uint8Array([1]));
    keys.mockRejectedValueOnce(new Error('IndexedDB unavailable'));
    await expect(storage.hasBinary('imgblob_a')).rejects.toThrow('IndexedDB unavailable');
    expect(await storage.hasBinary('imgblob_a')).toBe(true);
  });
});
