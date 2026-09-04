import {
  exportCompositionJPEG,
  exportCompositionJPEGSized,
  exportCompositionSVG,
} from '../compositionExport';

// viewBoxPadFraction (the uniform breathing margin around the export frame)
// and exportCompositionJPEGSized (the raster export that reports the pixel
// dimensions it drew at). Rasterization is environment-bound (<img>-based),
// so it's mocked; the frame math is asserted through the generated SVG.

const storage: Record<string, string | Uint8Array> = {};

jest.mock('@/engine/storage', () => ({
  default: {
    getItem: jest.fn((key: string) => {
      const v = storage[key];
      return Promise.resolve(typeof v === 'string' ? v : null);
    }),
    setItem: jest.fn((key: string, value: string) => {
      storage[key] = value;
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      delete storage[key];
      return Promise.resolve();
    }),
    multiGet: jest.fn((keys: string[]) =>
      Promise.resolve(
        keys.map(k => [k, typeof storage[k] === 'string' ? storage[k] : null] as [string, string | null]),
      ),
    ),
    getBinary: jest.fn((key: string) => {
      const v = storage[key];
      return Promise.resolve(v instanceof Uint8Array ? v : null);
    }),
    setBinary: jest.fn((key: string, value: Uint8Array) => {
      storage[key] = value;
      return Promise.resolve();
    }),
  },
  __esModule: true,
}));

jest.mock('@/native-shell/bridge/webBridge', () => ({
  logToNative: jest.fn(),
}));

jest.mock('../bake', () => ({
  loadBakedFigurePng: jest.fn(() => Promise.resolve(null)),
}));

jest.mock('../svgRasterize', () => ({
  rasterizeSvgToPixels: jest.fn(() => Promise.resolve(null)),
  rasterizeSvgToJpegDataUri: jest.fn(() => Promise.resolve('data:image/jpeg;base64,AQID')),
}));

const { rasterizeSvgToJpegDataUri } = require('../svgRasterize') as {
  rasterizeSvgToJpegDataUri: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
  rasterizeSvgToJpegDataUri.mockResolvedValue('data:image/jpeg;base64,AQID');
  for (const key of Object.keys(storage)) delete storage[key];
  // Persistence keeps a global write-through cache; clear it so each test
  // sees the storage we just seeded rather than a stale prior composition.
  (globalThis as any).__facetCompMetaCache = undefined;
});

/** A 32×16-cell diagonal line — content twice as wide as tall, so the tight
 *  frame (and the padded one) have a distinctive, checkable aspect. Read with
 *  normalize:false in every test, so the authored cells ARE the export's. */
function seedWide(id: string) {
  storage[`comp_meta_${id}`] = JSON.stringify({
    name: 'Wide',
    figures: [],
    svgObjects: [
      {
        id: 'svg_a',
        segments: [{ kind: 'line', start: [0, 0], end: [32, 16] }],
        color: { r: 0, g: 0, b: 0 },
        cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 16,
      },
    ],
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    strokeScale: 0.04, gridIntensity: 0.5,
  });
}

function parseViewBox(svg: string): [number, number, number, number] {
  // Numbers may carry float noise in scientific notation (a rotated 0 comes
  // out as ~1e-15), so split on spaces rather than matching digit runs.
  const m = svg.match(/viewBox="([^" ]+) ([^" ]+) ([^" ]+) ([^" ]+)"/);
  expect(m).not.toBeNull();
  return [parseFloat(m![1]), parseFloat(m![2]), parseFloat(m![3]), parseFloat(m![4])];
}

describe('viewBoxPadFraction', () => {
  it('defaults to the exact tight frame', async () => {
    seedWide('tight');
    const svg = await exportCompositionSVG('tight', undefined, undefined, { normalize: false });
    // 32×16 cells at 256 SVG units/cell.
    expect(parseViewBox(svg!)).toEqual([0, 0, 8192, 4096]);
  });

  it('grows the frame by the fraction of the LONGER edge, on all four sides', async () => {
    seedWide('padded');
    const svg = await exportCompositionSVG('padded', undefined, undefined, {
      normalize: false,
      viewBoxPadFraction: 0.05,
    });
    // pad = 32 cells × 0.05 = 1.6 cells = 409.6 units per side — the same
    // absolute margin on every edge, so the frame gains 2× that each axis.
    const [x, y, w, h] = parseViewBox(svg!);
    expect(x).toBeCloseTo(-409.6);
    expect(y).toBeCloseTo(-409.6);
    expect(w).toBeCloseTo(8192 + 819.2);
    expect(h).toBeCloseTo(4096 + 819.2);
  });

  it('is ignored when a frame pins the bounds — the framed page keeps its exact edge', async () => {
    // A 16×16 frame (isFrame group + rect mask boundary) with a member line
    // inside. Hosts pass the pad unconditionally for content-framed formats;
    // a page whose export pins to a Figma-style frame must not gain page
    // background outside the board the user framed.
    storage['comp_meta_framedpad'] = JSON.stringify({
      name: 'FramedPad',
      figures: [],
      groups: [{
        id: 'gFrame', name: 'Frame',
        translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
        rotation: 0, mirrorH: false, mirrorV: false, isFrame: true,
      }],
      svgObjects: [
        {
          id: 'svg_b', groupId: 'gFrame', isMask: true, color: { r: 0, g: 0, b: 0 },
          segments: [
            { kind: 'line', start: [0, 0], end: [16, 0] },
            { kind: 'line', start: [16, 0], end: [16, 16] },
            { kind: 'line', start: [16, 16], end: [0, 16] },
            { kind: 'line', start: [0, 16], end: [0, 0] },
          ],
          cellX: 0, cellY: 0, cellWidth: 16, cellHeight: 16,
        },
        {
          id: 'svg_m', groupId: 'gFrame',
          segments: [{ kind: 'line', start: [2, 2], end: [14, 14] }],
          color: { r: 0, g: 0, b: 0 },
          cellX: 2, cellY: 2, cellWidth: 12, cellHeight: 12,
        },
      ],
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      strokeScale: 0.04, gridIntensity: 0.5,
    });
    const svg = await exportCompositionSVG('framedpad', undefined, undefined, {
      normalize: false,
      viewBoxPadFraction: 0.05,
      frameInkExtents: true,
    });
    // Exactly the 16×16-cell frame — no pad, no ink growth past the frame.
    expect(parseViewBox(svg!)).toEqual([0, 0, 4096, 4096]);
  });
});

describe('frameInkExtents', () => {
  it('grows the frame by each boundary stroke half-width', async () => {
    seedWide('ink');
    const svg = await exportCompositionSVG('ink', undefined, undefined, {
      normalize: false,
      frameInkExtents: true,
    });
    // strokeScale 0.04 → a 0.0125-cell stroke → half-width 1.6 SVG units.
    // Without the flag the same composition frames at exactly 0 0 8192 4096
    // (the default-tight test above) and the boundary strokes are sliced.
    const [x, y, w, h] = parseViewBox(svg!);
    expect(x).toBeCloseTo(-1.6);
    expect(y).toBeCloseTo(-1.6);
    expect(w).toBeCloseTo(8195.2);
    expect(h).toBeCloseTo(4099.2);
  });
});

describe('rotated content framing', () => {
  it('frames a freely-rotated SVG object where its markup draws it', async () => {
    storage['comp_meta_rotsvg'] = JSON.stringify({
      name: 'RotSvg',
      figures: [],
      svgObjects: [
        {
          id: 'svg_r',
          segments: [{ kind: 'line', start: [0, 0], end: [32, 0] }],
          color: { r: 0, g: 0, b: 0 },
          cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32,
          angleDeg: 90,
        },
      ],
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      strokeScale: 0.04, gridIntensity: 0.5,
    });
    const svg = await exportCompositionSVG('rotsvg', undefined, undefined, { normalize: false });
    // The markup spins the top-edge line 90° about the node-box center
    // (16,16), drawing it as a vertical line at x=32 — the frame must follow
    // it there (the degenerate-width guard adds ±0.5 cell), not stay on the
    // unrotated horizontal span.
    const [x, y, w, h] = parseViewBox(svg!);
    expect(x).toBeCloseTo(31.5 * 256);
    expect(y).toBeCloseTo(0);
    expect(w).toBeCloseTo(256);
    expect(h).toBeCloseTo(8192);
  });

  it('frames a rotated image on its rotated corners', async () => {
    storage['comp_meta_rotimg'] = JSON.stringify({
      name: 'RotImg',
      figures: [],
      svgObjects: [],
      images: [
        {
          id: 'img_r', imageId: 'blob-absent', mimeType: 'image/png',
          cellX: 0, cellY: 0, cellWidth: 16, cellHeight: 8, rotation: 90,
        },
      ],
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      strokeScale: 0.04, gridIntensity: 0.5,
    });
    const svg = await exportCompositionSVG('rotimg', undefined, undefined, { normalize: false });
    // A 16×8 box spun 90° about its center (8,4) stands as an 8×16 box from
    // (4,−4) — a non-square rotated node overflows its unrotated box even at
    // the discrete steps.
    const [x, y, w, h] = parseViewBox(svg!);
    expect(x).toBeCloseTo(4 * 256);
    expect(y).toBeCloseTo(-4 * 256);
    expect(w).toBeCloseTo(8 * 256);
    expect(h).toBeCloseTo(16 * 256);
  });
});

describe('exportCompositionJPEGSized', () => {
  it('returns the data URI with the raster dimensions it drew at', async () => {
    seedWide('sized');
    const sized = await exportCompositionJPEGSized('sized', 300, 0.8, undefined, {
      normalize: false,
    });
    expect(sized).toEqual({ dataUri: 'data:image/jpeg;base64,AQID', width: 300, height: 150 });
    // The rasterizer was asked for exactly those pixels.
    expect(rasterizeSvgToJpegDataUri).toHaveBeenCalledWith(expect.any(String), 300, 150, 0.8);
  });

  it('sizes off the PADDED frame, so the reported aspect is the artifact aspect', async () => {
    seedWide('sizedpad');
    const sized = await exportCompositionJPEGSized('sizedpad', 300, 0.8, undefined, {
      normalize: false,
      viewBoxPadFraction: 0.05,
    });
    // Padded frame is 9011.2 × 4915.2 units — a 6/11 ratio.
    expect(sized).toMatchObject({ width: 300, height: Math.round(300 * (6 / 11)) });
  });

  it('returns null when the rasterizer produces nothing', async () => {
    seedWide('norender');
    rasterizeSvgToJpegDataUri.mockResolvedValue(null);
    expect(await exportCompositionJPEGSized('norender', 300, 0.8, undefined, { normalize: false }))
      .toBeNull();
  });

  it('returns null for a missing composition', async () => {
    expect(await exportCompositionJPEGSized('absent', 300)).toBeNull();
  });

  it('backs exportCompositionJPEG, which still returns the bare URI', async () => {
    seedWide('bare');
    expect(await exportCompositionJPEG('bare', 300, 0.8, undefined, { normalize: false }))
      .toBe('data:image/jpeg;base64,AQID');
  });
});

describe('the SVG handed to the rasterizer', () => {
  /** The width/height the SVG document declares itself to be. */
  const declared = (svg: string): [number, number] => {
    const tag = svg.slice(svg.indexOf('<svg'), svg.indexOf('>', svg.indexOf('<svg')));
    return [
      parseFloat(/\swidth="([^"]*)"/.exec(tag)![1]),
      parseFloat(/\sheight="([^"]*)"/.exec(tag)![1]),
    ];
  };

  it('declares itself at the PIXELS it is about to be drawn into', async () => {
    // The bug this fixes: the generator declares viewBox/10 — about 595 px
    // for a page — and the raster path then drew that into a 1080 px canvas.
    // WebKit rasterizes an SVG <img> once, at the size the document claims,
    // and drawImage scales the bitmap from there: the viewer image was a
    // 1.8x blow-up of a 595 px raster, soft at every edge and stepped
    // wherever the page held a smooth ramp.
    seedWide('rastersize');
    await exportCompositionJPEGSized('rastersize', 1080, 0.8, undefined, { normalize: false });
    const [svg, w, h] = rasterizeSvgToJpegDataUri.mock.calls[0];
    expect([w, h]).toEqual([1080, 540]);
    expect(declared(svg)).toEqual([1080, 540]);
  });

  it('leaves the viewBox — and so the drawing — exactly as it was', async () => {
    // Only the size the document claims changes. Re-heading it must not move
    // or rescale a single coordinate.
    seedWide('rasterframe');
    const plain = await exportCompositionSVG('rasterframe', undefined, undefined, { normalize: false });
    await exportCompositionJPEGSized('rasterframe', 1080, 0.8, undefined, { normalize: false });
    const [svg] = rasterizeSvgToJpegDataUri.mock.calls[0];
    expect(parseViewBox(svg)).toEqual(parseViewBox(plain!));
    expect(svg.slice(svg.indexOf('>', svg.indexOf('<svg')))).toBe(
      plain!.slice(plain!.indexOf('>', plain!.indexOf('<svg'))),
    );
  });

  it('still hands the plain .svg export its own natural size', async () => {
    // The file a user shares is a document, not a bitmap — it keeps the
    // generator's units and scales to whatever opens it.
    seedWide('rasterfile');
    const svg = await exportCompositionSVG('rasterfile', undefined, undefined, { normalize: false });
    expect(declared(svg!)).toEqual([819.2, 409.6]);
  });
});
