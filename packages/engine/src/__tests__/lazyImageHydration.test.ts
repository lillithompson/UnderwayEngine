import { loadCompositionState, exportCompositionBundle } from '../persistence';
import { exportCompositionImageSized, exportCompositionSVG } from '../compositionExport';
import { imageAssetBytes, purgeImageAssets } from '../imageAssetStore';

// A loaded composition holds DISPLAY copies. The export master beside each
// one is ten times the bytes (ORIGINAL_MAX_EDGE_PX 4096 vs MAX_EDGE_PX 1024)
// and the canvas never draws it — it renders the display copy — so
// hydrating both pinned ~3.79 MB per photo for the whole editing session,
// 91 % of it idle. The export path loads the master when it can use it and
// lets go of it when the raster is encoded.

jest.mock('../svgRasterize', () => ({
  rasterizeSvgToImageDataUri: jest.fn(async () => 'data:image/jpeg;base64,AA=='),
  rasterizeSvgToJpegDataUri: jest.fn(async () => 'data:image/jpeg;base64,AA=='),
  rasterizeSvgToPngDataUri: jest.fn(async () => 'data:image/png;base64,AA=='),
}));
jest.mock('@/native-shell/bridge/webBridge', () => ({ logToNative: jest.fn() }));
jest.mock('../bake', () => ({ loadBakedFigurePng: jest.fn(() => Promise.resolve(null)) }));

const store: Record<string, string | Uint8Array> = {};
const binaryReads: string[] = [];

jest.mock('@/engine/storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((k: string) => Promise.resolve(typeof store[k] === 'string' ? store[k] as string : null)),
    setItem: jest.fn((k: string, v: string) => { store[k] = v; return Promise.resolve(); }),
    removeItem: jest.fn((k: string) => { delete store[k]; return Promise.resolve(); }),
    multiGet: jest.fn(() => Promise.resolve([])),
    multiRemove: jest.fn(() => Promise.resolve()),
    clear: jest.fn(() => Promise.resolve()),
    getBinary: jest.fn((k: string) => {
      binaryReads.push(k);
      return Promise.resolve(store[k] instanceof Uint8Array ? store[k] as Uint8Array : null);
    }),
    setBinary: jest.fn((k: string, v: Uint8Array) => { store[k] = v; return Promise.resolve(); }),
    hasBinary: jest.fn((k: string) => Promise.resolve(k in store)),
  },
}));

/** A stand-in master: big enough that "is it in the heap?" is a real
 *  question, small enough to build in a test. */
const DISPLAY = new Uint8Array(340).fill(1);
const MASTER = new Uint8Array(3400).fill(2);
const displayB64 = Buffer.from(DISPLAY).toString('base64');
const masterB64 = Buffer.from(MASTER).toString('base64');

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  binaryReads.length = 0;
  purgeImageAssets();
  (globalThis as any).__facetCompMetaCache = undefined;
  store['comp_meta_photo'] = JSON.stringify({
    name: 'Photo page',
    figures: [],
    images: [{
      id: 'img_a', imageId: 'blob_d', originalImageId: 'blob_o',
      mimeType: 'image/jpeg', pixelWidth: 1024, pixelHeight: 1024,
      cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32,
    }],
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    strokeScale: 0.04, gridIntensity: 0.5,
  });
  store['imgblob_blob_d'] = DISPLAY;
  store['imgblob_blob_o'] = MASTER;
});

describe('loadCompositionState', () => {
  it('hydrates the display copy and leaves the master on disk', async () => {
    const state = await loadCompositionState('photo', { normalize: false });
    expect(Object.keys(state!.imageBlobs!)).toEqual(['blob_d']);
    expect(state!.imageBlobs!.blob_d).toEqual(DISPLAY);
    expect(binaryReads).toEqual(['imgblob_blob_d']);
    expect(imageAssetBytes('original')).toBe(0);
  });

  it('a second load reads nothing: the bytes are cached, not re-cloned', async () => {
    await loadCompositionState('photo', { normalize: false });
    binaryReads.length = 0;
    const again = await loadCompositionState('photo', { normalize: false });
    expect(again!.imageBlobs!.blob_d).toEqual(DISPLAY);
    expect(binaryReads).toEqual([]);
  });
});

describe('the export path reaches the master, and lets go of it', () => {
  it('a 300 px thumb never loads one', async () => {
    await exportCompositionImageSized('photo', 300, 0.9, undefined, {
      normalize: false, preferOriginalImages: true,
    });
    expect(binaryReads).not.toContain('imgblob_blob_o');
    const { rasterizeSvgToImageDataUri } = require('../svgRasterize') as { rasterizeSvgToImageDataUri: jest.Mock };
    expect(rasterizeSvgToImageDataUri.mock.calls[0][0]).toContain(displayB64);
  });

  it('a full-size view loads it, draws with it, and drops it again', async () => {
    await exportCompositionImageSized('photo', 2160, 0.9, undefined, {
      normalize: false, preferOriginalImages: true,
    });
    expect(binaryReads).toContain('imgblob_blob_o');
    const { rasterizeSvgToImageDataUri } = require('../svgRasterize') as { rasterizeSvgToImageDataUri: jest.Mock };
    expect(rasterizeSvgToImageDataUri.mock.calls.at(-1)![0]).toContain(masterB64);
    // Megabytes apiece, and the bytes are already inside the SVG string.
    expect(imageAssetBytes('original')).toBe(0);
    expect(imageAssetBytes('display')).toBeGreaterThan(0);
  });

  it('an SVG file export, which has no raster size, still takes the master', async () => {
    const svg = await exportCompositionSVG('photo', undefined, undefined, {
      normalize: false, preferOriginalImages: true,
    });
    expect(svg).toContain(masterB64);
  });

  it('a .tile carries both copies, so the file re-opens standalone', async () => {
    const bundle = await exportCompositionBundle('photo', { normalize: false });
    expect(bundle).not.toBeNull();
    const { deserializeComposition } = require('../compositionBinaryFormat') as {
      deserializeComposition: (b: Uint8Array) => { meta: { imageBlobs?: Record<string, Uint8Array> } };
    };
    const { decompressTile } = require('../tileIO') as { decompressTile: (b: Uint8Array) => Promise<Uint8Array> };
    const { meta } = deserializeComposition(await decompressTile(bundle!));
    expect(Object.keys(meta.imageBlobs ?? {}).sort()).toEqual(['blob_d', 'blob_o']);
    expect(meta.imageBlobs!.blob_o).toEqual(MASTER);
    expect(imageAssetBytes('original')).toBe(0);
  });
});
