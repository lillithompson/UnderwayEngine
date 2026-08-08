import { rasterizeSvgToPixels } from '../svgRasterize';

// Mock global Image for web path.
//
// Models WebKit's LAZY SVG decode, which is the behaviour the rasterizer has
// to defend against: `load` fires as soon as the src is set, but the frame
// that drawImage would paint (`decodedFrame`) only swaps to the new src when
// decode() resolves. Until then the pooled element still holds the frame
// decoded for the PREVIOUS call.
let decodeFails = false;
const images: MockImage[] = [];
class MockImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  _src = '';
  /** The src whose frame is currently drawable — what drawImage would paint. */
  decodedFrame = '';
  constructor() { images.push(this); }
  set src(val: string) {
    this._src = val;
    setTimeout(() => this.onload?.(), 0);
  }
  get src() { return this._src; }
  decode(): Promise<void> {
    return new Promise((resolve, reject) => setTimeout(() => {
      if (decodeFails) { reject(new Error('decode failed')); return; }
      this.decodedFrame = this._src;
      resolve();
    }, 0));
  }
}
(global as any).Image = MockImage;

// Mock canvas context. drawImage records which frame was drawable at the
// moment of the draw, so a test can catch a stale one being painted.
const drawnFrames: string[] = [];
const mockImageData = { data: new Uint8Array(4 * 4 * 4).fill(255) };
const mockCtx = {
  drawImage: jest.fn((img: any) => { drawnFrames.push(img?.decodedFrame ?? ''); }),
  getImageData: jest.fn(() => mockImageData),
};
const mockCanvas = {
  width: 0,
  height: 0,
  getContext: jest.fn((): any => mockCtx),
};

// Mock document.createElement to return our mock canvas
(global as any).document = {
  createElement: jest.fn((tag: string) => {
    if (tag === 'canvas') return mockCanvas;
    return {};
  }),
};

describe('rasterizeSvgToPixels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockImageData.data.fill(255);
    mockCanvas.getContext.mockReturnValue(mockCtx);
    drawnFrames.length = 0;
    decodeFails = false;
  });

  test('returns pixel data with correct dimensions', async () => {
    const result = await rasterizeSvgToPixels('<svg></svg>', 4, 4);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result!.length).toBe(4 * 4 * 4);
  });

  test('draws image onto pooled canvas', async () => {
    await rasterizeSvgToPixels('<svg></svg>', 2, 2);

    expect(mockCanvas.getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true });
    expect(mockCtx.drawImage).toHaveBeenCalled();
    expect(mockCtx.getImageData).toHaveBeenCalledWith(0, 0, 2, 2);
  });

  test('reuses the same canvas element across calls', async () => {
    const createSpy = document.createElement as jest.Mock;
    const before = createSpy.mock.calls.filter(c => c[0] === 'canvas').length;
    await rasterizeSvgToPixels('<svg></svg>', 2, 2);
    await rasterizeSvgToPixels('<svg></svg>', 3, 3);
    const after = createSpy.mock.calls.filter(c => c[0] === 'canvas').length;
    // Pool should not allocate a new canvas for either call.
    expect(after - before).toBe(0);
  });

  test('releases backing store after each call', async () => {
    await rasterizeSvgToPixels('<svg></svg>', 4, 4);
    // After return, pooled canvas should be 0×0 so it holds no IOSurface.
    expect(mockCanvas.width).toBe(0);
    expect(mockCanvas.height).toBe(0);
  });

  test('returns null when context creation fails', async () => {
    mockCanvas.getContext.mockReturnValueOnce(null);

    const result = await rasterizeSvgToPixels('<svg></svg>', 4, 4);
    expect(result).toBeNull();
    // Even on failure, backing store must be released.
    expect(mockCanvas.width).toBe(0);
    expect(mockCanvas.height).toBe(0);
  });

  test('concurrent calls are serialized — both return valid pixels', async () => {
    // Launch two rasterizations concurrently (no await between them).
    // Without serialization the second call would overwrite the first's
    // img.onload, causing the first to time out and return null.
    const p1 = rasterizeSvgToPixels('<svg>A</svg>', 4, 4);
    const p2 = rasterizeSvgToPixels('<svg>B</svg>', 4, 4);

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBeInstanceOf(Uint8Array);
    expect(r2).toBeInstanceOf(Uint8Array);
  });

  test('draws the frame decoded for THIS svg, never the pooled one left by the last call', async () => {
    // The pooled <img> outlives every call, so a rasterization that drew on
    // `load` alone would paint whatever was decoded for the previous svg —
    // which is how a journal entry's thumbnail came back one edit behind the
    // canvas: same artwork, earlier version, so it reads as a real render.
    await rasterizeSvgToPixels('<svg>first</svg>', 4, 4);
    await rasterizeSvgToPixels('<svg>second</svg>', 4, 4);

    expect(drawnFrames).toHaveLength(2);
    expect(drawnFrames[0]).toContain('first');
    expect(drawnFrames[1]).toContain('second');
    expect(drawnFrames[1]).not.toContain('first');
  });

  test('the three exports of one page each draw their own frame', async () => {
    // rasterizeEntryImages exports the same composition at three sizes
    // back-to-back through the shared element (entryRaster.ts).
    await rasterizeSvgToPixels('<svg>page-thumb</svg>', 4, 4);
    await rasterizeSvgToPixels('<svg>page-view</svg>', 4, 4);
    await rasterizeSvgToPixels('<svg>page-cutout</svg>', 4, 4);

    expect(drawnFrames[0]).toContain('page-thumb');
    expect(drawnFrames[1]).toContain('page-view');
    expect(drawnFrames[2]).toContain('page-cutout');
  });

  test('returns null when the frame never decodes, rather than drawing a stale one', async () => {
    await rasterizeSvgToPixels('<svg>good</svg>', 4, 4);
    decodeFails = true;

    const result = await rasterizeSvgToPixels('<svg>undecodable</svg>', 4, 4);

    expect(result).toBeNull();
    // One draw, from the successful first call — the failed call drew nothing.
    expect(drawnFrames).toEqual([expect.stringContaining('good')]);
  });

  test('a decode failure does not block the queue', async () => {
    decodeFails = true;
    const p1 = rasterizeSvgToPixels('<svg>bad</svg>', 4, 4);
    await p1;
    decodeFails = false;

    const r2 = await rasterizeSvgToPixels('<svg>after</svg>', 4, 4);

    expect(await p1).toBeNull();
    expect(r2).toBeInstanceOf(Uint8Array);
    expect(drawnFrames).toEqual([expect.stringContaining('after')]);
  });

  test('a failing call does not block the queue', async () => {
    // Make the first call fail by having getContext return null.
    mockCanvas.getContext.mockReturnValueOnce(null);

    const p1 = rasterizeSvgToPixels('<svg>fail</svg>', 4, 4);
    const p2 = rasterizeSvgToPixels('<svg>ok</svg>', 4, 4);

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBeNull();
    expect(r2).toBeInstanceOf(Uint8Array);
  });
});
