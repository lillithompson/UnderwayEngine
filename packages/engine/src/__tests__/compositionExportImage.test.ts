import { exportCompositionImage, exportCompositionImageSized } from '../compositionExport';

// The encoder-by-alpha export: framed like every raster export, encoded by
// rasterizeSvgToImageDataUri with the caller's JPEG quality.

jest.mock('../svgRasterize', () => ({
  rasterizeSvgToImageDataUri: jest.fn(),
  rasterizeSvgToJpegDataUri: jest.fn(),
  rasterizeSvgToPngDataUri: jest.fn(),
}));
jest.mock('@/native-shell/bridge/webBridge', () => ({ logToNative: jest.fn() }));
jest.mock('../bake', () => ({ loadBakedFigurePng: jest.fn(() => Promise.resolve(null)) }));

const storage: Record<string, string | Uint8Array> = {};
jest.mock('@/engine/storage', () => ({
  default: {
    getItem: jest.fn((key: string) => Promise.resolve(typeof storage[key] === 'string' ? storage[key] : null)),
    setItem: jest.fn((key: string, value: string) => { storage[key] = value; return Promise.resolve(); }),
    removeItem: jest.fn((key: string) => { delete storage[key]; return Promise.resolve(); }),
    multiGet: jest.fn((keys: string[]) =>
      Promise.resolve(keys.map(k => [k, typeof storage[k] === 'string' ? storage[k] : null] as [string, string | null]))),
    getBinary: jest.fn((key: string) => Promise.resolve(storage[key] instanceof Uint8Array ? storage[key] : null)),
    setBinary: jest.fn((key: string, value: Uint8Array) => { storage[key] = value; return Promise.resolve(); }),
  },
  __esModule: true,
}));

const { rasterizeSvgToImageDataUri, rasterizeSvgToPngDataUri } = require('../svgRasterize') as {
  rasterizeSvgToImageDataUri: jest.Mock;
  rasterizeSvgToPngDataUri: jest.Mock;
};

beforeEach(() => {
  for (const key of Object.keys(storage)) delete storage[key];
  (globalThis as any).__facetCompMetaCache = undefined;
  jest.clearAllMocks();
  // A 32×16 page: one line across the canonical box's top half.
  storage['comp_meta_img1'] = JSON.stringify({
    name: 'Wide',
    figures: [],
    svgObjects: [{
      id: 'svg_a',
      segments: [{ kind: 'line', start: [0, 0], end: [32, 16] }],
      color: { r: 0, g: 0, b: 0 },
      cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 16,
    }],
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    strokeScale: 0.04, gridIntensity: 0.5,
  });
});

describe('exportCompositionImageSized', () => {
  it('frames like the PNG export and hands the quality to the encoder-by-alpha rasterizer', async () => {
    rasterizeSvgToImageDataUri.mockResolvedValue('data:image/jpeg;base64,AA==');
    const out = await exportCompositionImageSized('img1', 640, 0.9);
    expect(out).toEqual({ dataUri: 'data:image/jpeg;base64,AA==', width: 640, height: 320 });
    expect(rasterizeSvgToImageDataUri).toHaveBeenCalledTimes(1);
    const [svg, w, h, q] = rasterizeSvgToImageDataUri.mock.calls[0];
    expect([w, h, q]).toEqual([640, 320, 0.9]);
    expect(svg).toContain('width="640"');
    expect(rasterizeSvgToPngDataUri).not.toHaveBeenCalled();
  });

  it('is null when there is nothing to draw, or the encoder gives nothing back', async () => {
    rasterizeSvgToImageDataUri.mockResolvedValue(null);
    expect(await exportCompositionImageSized('img1', 640, 0.9)).toBeNull();
    expect(await exportCompositionImage('img1', 640, 0.9)).toBeNull();
    expect(await exportCompositionImageSized('missing', 640, 0.9)).toBeNull();
  });

  it('exportCompositionImage is the data URI alone', async () => {
    rasterizeSvgToImageDataUri.mockResolvedValue('data:image/png;base64,AA==');
    expect(await exportCompositionImage('img1', 640, 0.9, undefined, { normalize: false })).toBe('data:image/png;base64,AA==');
  });
});

// The export master is a PIXEL BUDGET, not a switch (compositionSVGCore's
// rasterLongEdgePx): the raster exporters hand the generator their own long
// edge, so a card thumbnail of a photo page samples the ~340 KB display copy
// rather than base64-ing a ~3.4 MB master into the string and asking WebKit
// to decode 4096² RGBA to sample it down to 300 px.
describe('the export master, against the raster actually being drawn', () => {
  const display = new Uint8Array([1, 2, 3, 4]);
  const original = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]);
  const displayB64 = Buffer.from(display).toString('base64');
  const originalB64 = Buffer.from(original).toString('base64');

  beforeEach(() => {
    // One photo filling the canonical 32-cell box, display copy 1024 px.
    storage['comp_meta_photo'] = JSON.stringify({
      name: 'Photo',
      figures: [],
      images: [{
        id: 'img_a', imageId: 'blob_d', originalImageId: 'blob_o',
        mimeType: 'image/jpeg', pixelWidth: 1024, pixelHeight: 1024,
        cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32,
      }],
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      strokeScale: 0.04, gridIntensity: 0.5,
    });
    storage['imgblob_blob_d'] = display;
    storage['imgblob_blob_o'] = original;
    rasterizeSvgToImageDataUri.mockResolvedValue('data:image/jpeg;base64,AA==');
  });

  it('a 300 px thumb of a page with a master present references the DISPLAY blob', async () => {
    await exportCompositionImageSized('photo', 300, 0.9, undefined, { preferOriginalImages: true });
    const svg = rasterizeSvgToImageDataUri.mock.calls[0][0] as string;
    expect(svg).toContain(displayB64);
    expect(svg).not.toContain(originalB64);
  });

  it('a 2160 px view of the same page references the MASTER', async () => {
    await exportCompositionImageSized('photo', 2160, 0.9, undefined, { preferOriginalImages: true });
    const svg = rasterizeSvgToImageDataUri.mock.calls[0][0] as string;
    expect(svg).toContain(originalB64);
    expect(svg).not.toContain(displayB64);
  });
});
