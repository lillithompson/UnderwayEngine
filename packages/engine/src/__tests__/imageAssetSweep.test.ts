import {
  hasImageAsset, holdImageAssets, imageAssetRefs, putImageAsset, purgeImageAssets,
  setAssetSweepGuard, sweepImageAssets,
} from '../imageAssetStore';

// The janitor persistence.ts's key helpers said was missing: "nothing
// deletes these". Undo after a place, Replace, and deleting an image all
// orphan bytes permanently — replacing one photo five times leaves ~19 MB of
// dead blobs for the life of the install, and nothing has ever reclaimed a
// byte of it short of a full reset.

const store: Record<string, string | Uint8Array> = {};

jest.mock('@/engine/storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((k: string) => Promise.resolve(typeof store[k] === 'string' ? store[k] as string : null)),
    setItem: jest.fn((k: string, v: string) => { store[k] = v; return Promise.resolve(); }),
    removeItem: jest.fn((k: string) => { delete store[k]; return Promise.resolve(); }),
    multiGet: jest.fn(() => Promise.resolve([])),
    multiRemove: jest.fn((ks: string[]) => { for (const k of ks) delete store[k]; return Promise.resolve(); }),
    clear: jest.fn(() => Promise.resolve()),
    getBinary: jest.fn((k: string) => Promise.resolve(store[k] instanceof Uint8Array ? store[k] as Uint8Array : null)),
    setBinary: jest.fn((k: string, v: Uint8Array) => { store[k] = v; return Promise.resolve(); }),
    hasBinary: jest.fn((k: string) => Promise.resolve(k in store)),
    keys: jest.fn((prefix?: string) => Promise.resolve(
      Object.keys(store).filter((k) => !prefix || k.startsWith(prefix)))),
  },
}));

function meta(compId: string, images: { imageId: string; originalImageId?: string }[], paints: string[] = []): void {
  store[`comp_meta_${compId}`] = JSON.stringify({
    name: compId,
    figures: [],
    images: images.map((i, n) => ({ id: `img_${n}`, mimeType: 'image/jpeg', ...i })),
    paintObjects: paints.map((id) => ({ id })),
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
  });
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  purgeImageAssets();
  setAssetSweepGuard(null);
});

describe('sweepImageAssets', () => {
  it('deletes exactly the unreferenced blobs, and reports what it recovered', async () => {
    store['imgblob_live'] = new Uint8Array(100);
    store['imgblob_master'] = new Uint8Array(1000);
    store['imgblob_orphan'] = new Uint8Array(340);
    store['pntblob_live'] = new Uint8Array(10);
    store['pntblob_orphan'] = new Uint8Array(20);
    meta('a', [{ imageId: 'live', originalImageId: 'master' }], ['live']);

    const result = await sweepImageAssets();
    expect(result).toEqual({ deleted: 2, bytesFreed: 360, scanned: 5, skipped: false });
    expect(Object.keys(store).filter((k) => k.startsWith('imgblob_')).sort())
      .toEqual(['imgblob_live', 'imgblob_master']);
    expect(store['pntblob_live']).toBeDefined();
    expect(store['pntblob_orphan']).toBeUndefined();
  });

  it('keeps a blob any OTHER composition still references', async () => {
    // Content addressing means one photo on two pages is one blob; the page
    // that no longer draws it does not get to take it away from the one that
    // does. It is why nothing deletes a blob by name.
    store['imgblob_shared'] = new Uint8Array(50);
    meta('a', []);
    meta('b', [{ imageId: 'shared' }]);
    expect((await sweepImageAssets()).deleted).toBe(0);
    expect(store['imgblob_shared']).toBeDefined();
  });

  it('leaves nothing but blob keys alone', async () => {
    store['imgblob_orphan'] = new Uint8Array(1);
    store['comp_thumb_a'] = 'data:image/png;base64,AA==';
    store['cozy:entry:1'] = '{}';
    meta('a', []);
    await sweepImageAssets();
    expect(store['comp_thumb_a']).toBeDefined();
    expect(store['cozy:entry:1']).toBeDefined();
  });

  it('collects nothing at all while a session could still reach the bytes', async () => {
    // An undo stack reaching back to a replaced photo, a deleted node redo
    // would bring back: both reference bytes no STORED record does.
    store['imgblob_orphan'] = new Uint8Array(340);
    meta('a', []);
    setAssetSweepGuard(() => false);
    expect(await sweepImageAssets()).toEqual({ deleted: 0, bytesFreed: 0, scanned: 1, skipped: true });
    expect(store['imgblob_orphan']).toBeDefined();
    setAssetSweepGuard(() => true);
    expect((await sweepImageAssets()).deleted).toBe(1);
  });

  it('collects nothing while a write is in flight', async () => {
    // A save writes blobs first and its record after; a sweep in that window
    // would take a photo out of the page being saved.
    store['imgblob_justwritten'] = new Uint8Array(9);
    meta('a', []);
    const release = holdImageAssets();
    expect((await sweepImageAssets()).skipped).toBe(true);
    expect(store['imgblob_justwritten']).toBeDefined();
    release();
    expect((await sweepImageAssets()).deleted).toBe(1);
  });

  it('refuses outright when a composition record cannot be read', async () => {
    // Its references are unknown, so every id only IT holds would read as
    // garbage. All-or-nothing: a wrong delete is unrecoverable, a missed
    // sweep costs a day.
    store['imgblob_live'] = new Uint8Array(1);
    store['imgblob_orphan'] = new Uint8Array(1);
    meta('a', [{ imageId: 'live' }]);
    store['comp_meta_broken'] = '{not json';
    expect((await sweepImageAssets()).skipped).toBe(true);
    expect(store['imgblob_orphan']).toBeDefined();
  });

  it('an empty journal collects every blob, and an empty store is a no-op', async () => {
    expect(await sweepImageAssets()).toEqual({ deleted: 0, bytesFreed: 0, scanned: 0, skipped: false });
    store['imgblob_a'] = new Uint8Array(5);
    expect((await sweepImageAssets()).deleted).toBe(1);
  });
});

describe('imageAssetRefs', () => {
  it('is the display copies, the masters and the paint islands', async () => {
    meta('a', [{ imageId: 'd1', originalImageId: 'o1' }, { imageId: 'd2' }], ['p1', 'p2']);
    const refs = await imageAssetRefs('a');
    expect(Array.from(refs!.images).sort()).toEqual(['d1', 'd2', 'o1']);
    expect(Array.from(refs!.paints).sort()).toEqual(['p1', 'p2']);
  });

  it('is null for a record that is absent or unreadable', async () => {
    expect(await imageAssetRefs('missing')).toBeNull();
    store['comp_meta_bad'] = 'not json';
    expect(await imageAssetRefs('bad')).toBeNull();
  });
});

describe('putImageAsset', () => {
  it('writes once for bytes the store already holds, and hands back the same id', async () => {
    const { default: storage } = require('@/engine/storage') as { default: { setBinary: jest.Mock } };
    const photo = new Uint8Array([1, 2, 3, 4]);
    const first = await putImageAsset(photo);
    storage.setBinary.mockClear();
    const second = await putImageAsset(new Uint8Array(photo));
    expect(second).toBe(first);
    expect(storage.setBinary).not.toHaveBeenCalled();
    expect(await hasImageAsset(first)).toBe(true);
  });
});
