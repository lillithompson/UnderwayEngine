/**
 * Loading a save with a non-array `segments` (or `subpaths[].segments`)
 * shouldn't crash later spread/iterate sites with "object is not
 * iterable". The persistence loader coerces malformed geometry to []
 * (or drops malformed `subpaths` to undefined) and migration still
 * fires kind='arc' for legacy real-array shapes.
 */

import { loadCompositionState } from '../persistence';

jest.mock('../bake', () => ({
  bakeFile: jest.fn(() => Promise.resolve()),
  removeBakedFigure: jest.fn(() => Promise.resolve()),
}));

const storage: Record<string, string | Uint8Array> = {};
jest.mock('@/engine/storage', () => ({
  default: {
    getItem: jest.fn((key: string) => Promise.resolve(typeof storage[key] === 'string' ? (storage[key] as string) : null)),
    setItem: jest.fn((key: string, value: string) => { storage[key] = value; return Promise.resolve(); }),
    removeItem: jest.fn((key: string) => { delete storage[key]; return Promise.resolve(); }),
    multiRemove: jest.fn((keys: string[]) => { for (const k of keys) delete storage[k]; return Promise.resolve(); }),
    getBinary: jest.fn(() => Promise.resolve(null)),
    setBinary: jest.fn(() => Promise.resolve()),
  },
  __esModule: true,
}));

beforeEach(() => {
  Object.keys(storage).forEach(k => delete storage[k]);
  delete (globalThis as any).__facetCompMetaCache;
});

describe('corrupt-shape geometry coerces to safe defaults on load', () => {
  it('non-array segments coerces to []', async () => {
    const corrupt = {
      name: 'Corrupt',
      figures: [],
      svgObjects: [{
        id: 'svg_bad',
        // Array-like plain object — survived JSON if a buggy writer ever
        // produced it. The previous loader passed this through unchanged.
        segments: { 0: { kind: 'arc', start: [0, 0], end: [1, 1], center: [0, 1] }, length: 1 },
        color: { r: 0, g: 0, b: 0 },
      }],
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    };
    storage['comp_meta_cmp1'] = JSON.stringify(corrupt);
    const loaded = await loadCompositionState('cmp1');
    expect(loaded).not.toBeNull();
    expect(Array.isArray(loaded!.svgObjects![0].segments)).toBe(true);
    expect(loaded!.svgObjects![0].segments).toHaveLength(0);
  });

  it('non-array subpaths drops to undefined', async () => {
    const corrupt = {
      name: 'Corrupt',
      figures: [],
      svgObjects: [{
        id: 'svg_bad',
        segments: [{ kind: 'arc', start: [0, 0], end: [1, 1], center: [0, 1] }],
        subpaths: { 0: { color: { r: 1, g: 2, b: 3 }, segments: [] }, length: 1 },
        color: { r: 0, g: 0, b: 0 },
      }],
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    };
    storage['comp_meta_cmp1'] = JSON.stringify(corrupt);
    const loaded = await loadCompositionState('cmp1');
    expect(loaded!.svgObjects![0].subpaths).toBeUndefined();
  });

  it('subpaths[].segments non-array coerces to []', async () => {
    const corrupt = {
      name: 'Corrupt',
      figures: [],
      svgObjects: [{
        id: 'svg_bad',
        segments: [{ kind: 'arc', start: [0, 0], end: [1, 1], center: [0, 1] }],
        subpaths: [{ color: { r: 1, g: 2, b: 3 }, segments: { 0: {}, length: 1 } }],
        color: { r: 0, g: 0, b: 0 },
      }],
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    };
    storage['comp_meta_cmp1'] = JSON.stringify(corrupt);
    const loaded = await loadCompositionState('cmp1');
    expect(loaded!.svgObjects![0].subpaths).toHaveLength(1);
    expect(loaded!.svgObjects![0].subpaths![0].segments).toEqual([]);
  });
});
