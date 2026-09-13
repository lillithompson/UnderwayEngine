import { contentImageId, imageAssetBytes, imageAssetKey, loadImageAsset, loadImageAssets, peekImageAsset, purgeImageAssets, rememberImageAsset } from '../imageAssetStore';

// The bytes a loaded composition no longer holds.
//
// A photo keeps a display copy (~340 KB) and an export master (~3.4 MB).
// Hydrating both into CompositionState.imageBlobs pinned 3.79 MB per photo
// in the WebView's heap for the whole session, 91 % of it a master the
// canvas never draws — and re-read every byte of it on each of the five to
// seven loads a journal tick used to do.

const store: Record<string, Uint8Array> = {};
const reads: string[] = [];

jest.mock('@/engine/storage', () => ({
  __esModule: true,
  default: {
    getBinary: jest.fn((key: string) => {
      reads.push(key);
      return Promise.resolve(store[key] ?? null);
    }),
    setBinary: jest.fn(() => Promise.resolve()),
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    multiGet: jest.fn(() => Promise.resolve([])),
    multiRemove: jest.fn(() => Promise.resolve()),
    clear: jest.fn(() => Promise.resolve()),
    hasBinary: jest.fn(() => Promise.resolve(false)),
  },
}));

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  reads.length = 0;
  purgeImageAssets();
});

describe('imageAssetStore', () => {
  it('keys blobs by asset id alone, so duplicates share one', () => {
    expect(imageAssetKey('abc')).toBe('imgblob_abc');
  });

  it('reads an asset once, then serves it from memory', async () => {
    store['imgblob_a'] = new Uint8Array([1, 2, 3]);
    expect(peekImageAsset('a')).toBeNull();
    expect(await loadImageAsset('a')).toEqual(new Uint8Array([1, 2, 3]));
    expect(peekImageAsset('a')).toEqual(new Uint8Array([1, 2, 3]));
    expect(await loadImageAsset('a')).toEqual(new Uint8Array([1, 2, 3]));
    expect(reads).toEqual(['imgblob_a']);
  });

  it('collapses concurrent reads of one asset — N nodes, one photo, one read', async () => {
    store['imgblob_a'] = new Uint8Array([7]);
    const all = await Promise.all([loadImageAsset('a'), loadImageAsset('a'), loadImageAsset('a')]);
    expect(all.every((b) => b?.[0] === 7)).toBe(true);
    expect(reads).toEqual(['imgblob_a']);
  });

  it('loads a set into the shape imageBlobs takes, skipping what is not stored', async () => {
    store['imgblob_a'] = new Uint8Array([1]);
    store['imgblob_b'] = new Uint8Array([2]);
    const blobs = await loadImageAssets(['a', 'b', 'missing', undefined, null, 'a']);
    expect(Object.keys(blobs).sort()).toEqual(['a', 'b']);
    // The renderer skips a wrapper whose blob is absent rather than throwing.
    expect(blobs.missing).toBeUndefined();
  });

  it('keeps display copies and masters on separate budgets', async () => {
    store['imgblob_d'] = new Uint8Array(100);
    store['imgblob_o'] = new Uint8Array(1000);
    await loadImageAsset('d', 'display');
    await loadImageAsset('o', 'original');
    expect(imageAssetBytes('display')).toBe(100);
    expect(imageAssetBytes('original')).toBe(1000);
    // An export drops its masters and keeps the page's display copies.
    purgeImageAssets('original');
    expect(imageAssetBytes('original')).toBe(0);
    expect(imageAssetBytes('display')).toBe(100);
    expect(peekImageAsset('d', 'display')).not.toBeNull();
    purgeImageAssets();
    expect(imageAssetBytes()).toBe(0);
  });

  it('takes bytes the caller already holds instead of reading them back', async () => {
    // The save path has just written these; a read would be pure waste.
    rememberImageAsset('a', new Uint8Array([5, 6]));
    expect(await loadImageAsset('a')).toEqual(new Uint8Array([5, 6]));
    expect(reads).toEqual([]);
  });

  it('a failed read is null and is not cached as an answer', async () => {
    const { default: storage } = require('@/engine/storage') as { default: { getBinary: jest.Mock } };
    storage.getBinary.mockRejectedValueOnce(new Error('IndexedDB gone'));
    expect(await loadImageAsset('a')).toBeNull();
    store['imgblob_a'] = new Uint8Array([9]);
    expect(await loadImageAsset('a')).toEqual(new Uint8Array([9]));
  });
});

// An asset's id IS its bytes. The random ids this replaced meant the same
// photo picked twice stored its bytes twice, a duplicated page duplicated
// every blob, and "do I already have this?" could only ever be answered by
// convention.
describe('contentImageId', () => {
  const photo = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

  it('is the same id for the same bytes, and a different one for different bytes', async () => {
    const a = await contentImageId(photo);
    const b = await contentImageId(new Uint8Array(photo));
    expect(a).toBe(b);
    expect(await contentImageId(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 9]))).not.toBe(a);
    expect(await contentImageId(new Uint8Array(0))).not.toBe(a);
  });

  it('keeps the imgblob_ prefix, so new ids and stored ones read alike', async () => {
    expect(await contentImageId(photo)).toMatch(/^imgblob_[A-Za-z0-9_-]{22}$/);
  });

  it('is the head of the bytes\u2019 SHA-256, in base64url', async () => {
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(photo));
    const expected = Buffer.from(new Uint8Array(digest)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 22);
    expect(await contentImageId(photo)).toBe(`imgblob_${expected}`);
  });

  it('reads the VIEW it is given, not the buffer behind it', async () => {
    // The picker hands over subarrays; hashing the whole backing buffer
    // would make two identical photos hash differently.
    const backing = new Uint8Array(photo.length + 8);
    backing.set(photo, 8);
    expect(await contentImageId(backing.subarray(8))).toBe(await contentImageId(photo));
  });

  it('falls back to a unique id where SubtleCrypto is missing, rather than throwing', async () => {
    const real = (globalThis as { crypto?: Crypto }).crypto;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      const a = await contentImageId(photo);
      const b = await contentImageId(photo);
      expect(a).toMatch(/^imgblob_/);
      // No dedup without a digest — but never a COLLIDING id, which would
      // hand one photo's bytes to another photo's node.
      expect(a).not.toBe(b);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true });
    }
  });
});
