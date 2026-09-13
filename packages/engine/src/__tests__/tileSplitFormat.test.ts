import { deserializeComposition, serializeComposition, type CompositionBundle } from '../compositionBinaryFormat';
import { exportCompositionBundle, exportCompositionBundleSplit, importCompositionBundle, resetPersistenceCaches } from '../persistence';

// The document and the photos used to share one 4 MB cap, so the third
// photo on a page silently cost the page its editability everywhere — the
// owner's other devices could not open it and no friend could import it.
// The split form (v60) names its pixels instead of carrying them.

jest.mock('@/native-shell/bridge/webBridge', () => ({ logToNative: jest.fn() }));

/** The server's cap on a page's `.tile` (the app's components/shareCaps.ts,
 *  mirrored from backend validation.ts). Restated here because the engine
 *  cannot import the app. */
const TILE_MAX_BYTES = 4 * 1024 * 1024;

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

/** JPEG-ish bytes that do not compress away — a real photo's do not either,
 *  which is the whole reason the monolithic tile runs to megabytes. */
function photoBytes(seed: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed * 2654435761 >>> 0;
  for (let i = 0; i < length; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

function imageNode(n: number): Record<string, unknown> {
  return {
    id: `img_${n}`, imageId: `imgblob_d${n}`, originalImageId: `imgblob_o${n}`,
    mimeType: 'image/jpeg', pixelWidth: 1024, pixelHeight: 768,
    cellX: n * 2, cellY: 0, cellWidth: 8, cellHeight: 6,
  };
}

/** The storage key an asset id lives under — the id already carries its own
 *  `imgblob_` prefix (imageAssetStore.imageAssetKey adds the key's). */
const keyOf = (assetId: string) => `imgblob_${assetId}`;

/** A page of `n` photos: a ~340 KB display copy and a ~3.4 MB master each,
 *  the shape compositionImageImport actually produces. */
function photoPage(compId: string, n: number): void {
  const images = Array.from({ length: n }, (_, i) => imageNode(i));
  store[`comp_meta_${compId}`] = JSON.stringify({
    name: 'Photo page', figures: [], images,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 }, strokeScale: 0.04, gridIntensity: 0.5,
  });
  for (let i = 0; i < n; i++) {
    store[keyOf(`imgblob_d${i}`)] = photoBytes(i + 1, 340 * 1024);
    store[keyOf(`imgblob_o${i}`)] = photoBytes(100 + i, 3400 * 1024);
  }
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  // The store is being emptied out from under the module, so its
  // session-lifetime caches have to go with it (resetPersistenceCaches).
  resetPersistenceCaches();
});

const PAGE_IO = { normalize: false };

describe('the split document', () => {
  it('round-trips everything but the pixels, and names them instead', () => {
    const display = photoBytes(1, 2048);
    const master = photoBytes(2, 9000);
    const bundle: CompositionBundle = {
      name: 'Page', gridLevel: 1, strokeScale: 0.04, gridIntensity: 0.5,
      camera: { offsetX: 3, offsetY: 4, zoom: 1.5 },
      figures: [],
      images: [imageNode(0) as never],
      imageBlobs: { imgblob_d0: display, imgblob_o0: master },
      texts: [{
        id: 'txt_1', content: 'still here',
        style: { fontId: 'system', size: 1.5, color: { r: 0, g: 0, b: 0 } },
        cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2,
      } as never],
    };
    const whole = serializeComposition(bundle, []);
    const split = serializeComposition(bundle, [], { omitImageBytes: true });

    // The pixels are the difference, and nothing else is.
    expect(whole.length - split.length).toBe(display.length + master.length);

    const read = deserializeComposition(split).meta;
    expect(read.name).toBe('Page');
    expect(read.camera).toEqual({ offsetX: 3, offsetY: 4, zoom: 1.5 });
    expect(read.images![0].imageId).toBe('imgblob_d0');
    expect(read.texts![0].content).toBe('still here');
    expect(read.imageBlobs).toEqual({});
    expect(read.imageAssetRefs).toEqual([
      { imageId: 'imgblob_d0', mimeType: 'image/jpeg', byteLength: display.length },
      { imageId: 'imgblob_o0', mimeType: 'image/jpeg', byteLength: master.length },
    ]);
  });

  it('costs a page with no photos nothing but the flag that says so', () => {
    const bundle: CompositionBundle = {
      name: 'Ink', gridLevel: 1, strokeScale: 0.04, gridIntensity: 0.5,
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      figures: [],
      svgObjects: [{
        id: 'svg_a', segments: [{ kind: 'line', start: [0, 0], end: [8, 8] }],
        color: { r: 0, g: 0, b: 0 }, cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8,
      } as never],
    };
    const split = serializeComposition(bundle, [], { omitImageBytes: true });
    const whole = serializeComposition(bundle, []);
    expect(split.length).toBe(whole.length);
    expect(deserializeComposition(split).meta.svgObjects)
      .toEqual(deserializeComposition(whole).meta.svgObjects);
  });

  it('an ordinary bundle still carries its bytes, and reports no refs', () => {
    const bundle: CompositionBundle = {
      name: 'Page', gridLevel: 1, strokeScale: 0.04, gridIntensity: 0.5,
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      figures: [], images: [imageNode(0) as never],
      imageBlobs: { imgblob_d0: photoBytes(1, 64), imgblob_o0: photoBytes(2, 128) },
    };
    const read = deserializeComposition(serializeComposition(bundle, [])).meta;
    expect(read.imageAssetRefs).toBeUndefined();
    expect(read.imageBlobs!.imgblob_o0.length).toBe(128);
  });
});

describe('exportCompositionBundleSplit', () => {
  it('a three-photo page exports under the share cap, where the whole one is far over', async () => {
    photoPage('p3', 3);
    const whole = await exportCompositionBundle('p3', PAGE_IO);
    expect(whole!.length).toBeGreaterThan(TILE_MAX_BYTES);

    const split = await exportCompositionBundleSplit('p3', PAGE_IO);
    expect(split!.bytes.length).toBeLessThan(50 * 1024);
    expect(split!.assets.map((a) => a.assetId)).toEqual([
      'imgblob_d0', 'imgblob_o0', 'imgblob_d1', 'imgblob_o1', 'imgblob_d2', 'imgblob_o2',
    ]);
    expect(split!.assets[1].byteLength).toBe(3400 * 1024);
  });

  it('a page of twenty photos still exports under the cap — the cap stops being a photo limit', async () => {
    photoPage('p20', 20);
    const split = await exportCompositionBundleSplit('p20', PAGE_IO);
    expect(split!.bytes.length).toBeLessThan(TILE_MAX_BYTES);
    expect(split!.assets).toHaveLength(40);
  });

  it('is null for a composition that is not there, like the monolithic form', async () => {
    expect(await exportCompositionBundleSplit('nope', PAGE_IO)).toBeNull();
  });
});

describe('importing a split document', () => {
  it('resolves what this device already holds and fetches only the rest', async () => {
    photoPage('src', 2);
    const split = (await exportCompositionBundleSplit('src', PAGE_IO))!;

    // A second device: it has one of the four assets already (the same
    // photo on another page — content ids make that provable) and must
    // fetch the other three.
    const heldLocally = store[keyOf('imgblob_d0')] as Uint8Array;
    const remote: Record<string, Uint8Array> = {
      imgblob_o0: store[keyOf('imgblob_o0')] as Uint8Array,
      imgblob_d1: store[keyOf('imgblob_d1')] as Uint8Array,
      imgblob_o1: store[keyOf('imgblob_o1')] as Uint8Array,
    };
    for (const k of Object.keys(store)) delete store[k];
    resetPersistenceCaches();
    store[keyOf('imgblob_d0')] = heldLocally;

    const asked: string[] = [];
    const compId = await importCompositionBundle(
      split.bytes, 'page.tile', undefined, PAGE_IO,
      async (id) => { asked.push(id); return remote[id] ?? null; },
    );
    expect(asked.sort()).toEqual(['imgblob_d1', 'imgblob_o0', 'imgblob_o1']);
    // …and every asset is on disk afterwards, so the page opens whole.
    for (const id of ['imgblob_d0', 'imgblob_o0', 'imgblob_d1', 'imgblob_o1']) {
      expect(store[keyOf(id)]).toBeDefined();
    }
    expect(typeof compId).toBe('string');
  });

  it('files the page even when an asset cannot be fetched', async () => {
    // The page is still worth having: everything else on it draws, and the
    // next import picks the photo up.
    photoPage('src', 1);
    const split = (await exportCompositionBundleSplit('src', PAGE_IO))!;
    for (const k of Object.keys(store)) delete store[k];
    resetPersistenceCaches();
    const compId = await importCompositionBundle(
      split.bytes, 'page.tile', undefined, PAGE_IO,
      async () => { throw new Error('offline'); },
    );
    expect(typeof compId).toBe('string');
    expect(store[`comp_meta_${compId}`]).toBeDefined();
  });

  it('a monolithic file still imports with no fetcher at all', async () => {
    photoPage('src', 1);
    const whole = (await exportCompositionBundle('src', PAGE_IO))!;
    for (const k of Object.keys(store)) delete store[k];
    resetPersistenceCaches();
    const compId = await importCompositionBundle(whole, 'page.tile', undefined, PAGE_IO);
    expect(store[keyOf('imgblob_d0')]).toBeDefined();
    expect(store[keyOf('imgblob_o0')]).toBeDefined();
    expect(typeof compId).toBe('string');
  });
});
