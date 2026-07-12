import { rasterizeSvgToPixels } from '../svgRasterize';

// Mock global Image for web path
class MockImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  _src = '';
  set src(val: string) {
    this._src = val;
    setTimeout(() => this.onload?.(), 0);
  }
  get src() { return this._src; }
}
(global as any).Image = MockImage;

// Mock canvas context
const mockImageData = { data: new Uint8Array(4 * 4 * 4).fill(255) };
const mockCtx = {
  drawImage: jest.fn(),
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
