import { saveCompositionState } from '../persistence';
import type { CompositionState } from '../types';

// Autosave must not READ image bytes back to decide whether to write them.
//
// An imported photo keeps two blobs: the display copy (MAX_EDGE_PX 1024,
// a few hundred KB) and a full-resolution original for export
// (ORIGINAL_MAX_EDGE_PX 4096 — several MB for a phone camera). The save
// used to fetch each stored blob and compare its length, so every debounced
// autosave pulled all of that back out of IndexedDB to be told "unchanged".
// The cost scaled with the number of photos on the page and with nothing
// else, which is what made a page with several images slow to edit.

const store: Record<string, string | Uint8Array> = {};
const calls = { get: [] as string[], set: [] as string[], has: [] as string[] };

jest.mock('@/engine/storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((key: string) => Promise.resolve(typeof store[key] === 'string' ? store[key] as string : null)),
    setItem: jest.fn((key: string, value: string) => { store[key] = value; return Promise.resolve(); }),
    removeItem: jest.fn((key: string) => { delete store[key]; return Promise.resolve(); }),
    multiGet: jest.fn(() => Promise.resolve([])),
    multiRemove: jest.fn(() => Promise.resolve()),
    clear: jest.fn(() => Promise.resolve()),
    getBinary: jest.fn((key: string) => {
      calls.get.push(key);
      const v = store[key];
      return Promise.resolve(v instanceof Uint8Array ? v : null);
    }),
    setBinary: jest.fn((key: string, value: Uint8Array) => {
      calls.set.push(key);
      store[key] = value;
      return Promise.resolve();
    }),
    hasBinary: jest.fn((key: string) => {
      calls.has.push(key);
      return Promise.resolve(key in store);
    }),
  },
}));

/** A one-photo page: the display copy, and the export original beside it. */
function pageWithPhoto(): CompositionState {
  return {
    name: 'Haiku',
    gridLevel: 1,
    strokeScale: 1,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [],
    svgObjects: [],
    texts: [],
    groups: [],
    sceneOrder: ['img_1'],
    customColors: [],
    paintObjects: [],
    patternObjects: [],
    images: [{
      id: 'img_1',
      imageId: 'blob_display',
      originalImageId: 'blob_original',
      mimeType: 'image/jpeg',
      pixelWidth: 768,
      pixelHeight: 1024,
      cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32,
    }],
    imageBlobs: {
      blob_display: new Uint8Array(64),
      // Stands in for the multi-megabyte original.
      blob_original: new Uint8Array(4096),
    },
  } as unknown as CompositionState;
}

function reset() {
  for (const k of Object.keys(store)) delete store[k];
  calls.get.length = 0;
  calls.set.length = 0;
  calls.has.length = 0;
  delete (globalThis as Record<string, unknown>).__facetImageBlobPresent;
}

const imageKeys = (keys: string[]) => keys.filter((k) => k.includes('blob_'));

describe('saving a page with photos', () => {
  beforeEach(reset);

  it('writes each blob once and never reads one back', async () => {
    const state = pageWithPhoto();
    await saveCompositionState(state, { normalize: false });
    expect(imageKeys(calls.set)).toHaveLength(2); // display + original
    expect(imageKeys(calls.get)).toHaveLength(0);
  });

  it('a second save touches no image bytes at all — not a read, not a write', async () => {
    const state = pageWithPhoto();
    await saveCompositionState(state, { normalize: false });
    calls.get.length = 0;
    calls.set.length = 0;
    calls.has.length = 0;
    await saveCompositionState(state, { normalize: false });
    expect(imageKeys(calls.set)).toHaveLength(0);
    expect(imageKeys(calls.get)).toHaveLength(0);
    // …and the session's answer stands, so not even the key scan repeats.
    expect(imageKeys(calls.has)).toHaveLength(0);
  });

  it('a blob already in storage from an earlier session is not rewritten', async () => {
    const state = pageWithPhoto();
    // A fresh session (the present-set is empty) over a store that holds
    // the bytes already: the keys are asked for, and nothing is written.
    store['imgblob_blob_display'] = new Uint8Array(64);
    store['imgblob_blob_original'] = new Uint8Array(4096);
    await saveCompositionState(state, { normalize: false });
    expect(imageKeys(calls.has)).toHaveLength(2);
    expect(imageKeys(calls.set)).toHaveLength(0);
    expect(imageKeys(calls.get)).toHaveLength(0);
  });

  it('an image with no original stores the one blob it has', async () => {
    const state = pageWithPhoto();
    delete (state.images![0] as { originalImageId?: string }).originalImageId;
    await saveCompositionState(state, { normalize: false });
    expect(imageKeys(calls.set)).toEqual(['imgblob_blob_display']);
  });
});
