import { SVGObject } from '../types';

// ── DOM mocks (node test env) ───────────────────────────────────────
// rasterizeSvgToObjectURL loads an SVG into an <img>, draws to a <canvas>,
// and converts to a blob objectURL. Mock all three so the async build path
// runs without a real DOM.
class MockImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  _src = '';
  set src(val: string) {
    this._src = val;
    if (val) setTimeout(() => this.onload?.(), 0);
  }
  get src() { return this._src; }
}
(global as any).Image = MockImage;

const mockCtx = { drawImage: jest.fn() };
const mockCanvas = {
  width: 0,
  height: 0,
  getContext: jest.fn((): any => mockCtx),
  toBlob: (cb: (b: any) => void) => cb({ size: 1 }),
};
(global as any).document = {
  createElement: jest.fn((tag: string) => (tag === 'canvas' ? mockCanvas : {})),
};

let createObjectURLCount = 0;
const revokeObjectURL = jest.fn();
(global as any).URL = {
  createObjectURL: jest.fn(() => `blob:mock/${++createObjectURLCount}`),
  revokeObjectURL,
};

// Import after globals are in place.
import {
  getSVGObjectTileBitmapSync,
  clearTileBitmapCache,
} from '../tileBitmapCache';

/** Let the serialized rasterize queue + MockImage onload settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise<void>(r => setTimeout(r, 0));
  }
}

function makeRepeatSVG(overrides: Partial<SVGObject> = {}): SVGObject {
  return {
    id: 'obj1',
    segments: [{ kind: 'line', start: [2, 2], end: [4, 4] }],
    color: { r: 10, g: 20, b: 30 },
    cellX: 2,
    cellY: 2,
    cellWidth: 4,
    cellHeight: 4,
    tileMode: 'repeat',
    tileWidthL0: 2,
    tileHeightL0: 2,
    tileOffsetXL0: 0,
    tileOffsetYL0: 0,
    ...overrides,
  } as SVGObject;
}

describe('getSVGObjectTileBitmapSync', () => {
  beforeEach(() => {
    clearTileBitmapCache();
    createObjectURLCount = 0;
    revokeObjectURL.mockClear();
    ((global as any).URL.createObjectURL as jest.Mock).mockClear();
  });

  it('rasterizes once on first request and serves the cached bitmap', async () => {
    const obj = makeRepeatSVG();

    // First call: nothing cached yet.
    expect(getSVGObjectTileBitmapSync(obj, 1)).toBeNull();
    await flush();

    const bmp = getSVGObjectTileBitmapSync(obj, 1);
    expect(bmp).not.toBeNull();
    expect((global as any).URL.createObjectURL).toHaveBeenCalledTimes(1);

    // Same identity again: pure cache hit, no new rasterize.
    getSVGObjectTileBitmapSync(obj, 1);
    await flush();
    expect((global as any).URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('reuses the bitmap across a compensated resize-drag (no flicker)', async () => {
    // Frame 0: original object.
    const f0 = makeRepeatSVG();
    getSVGObjectTileBitmapSync(f0, 1);
    await flush();
    const url0 = getSVGObjectTileBitmapSync(f0, 1)!.objectURL;
    expect((global as any).URL.createObjectURL).toHaveBeenCalledTimes(1);

    // Frame 1..3: each drag frame is a NEW object instance with cellX moved
    // and tileOffset compensating, so cellX + tileOffset (the tile-content
    // anchor) is invariant — the rasterizable content is byte-identical.
    let lastUrl = url0;
    for (let i = 1; i <= 3; i++) {
      const frame = makeRepeatSVG({ cellX: 2 + i, tileOffsetXL0: -i });
      const bmp = getSVGObjectTileBitmapSync(frame, 1);
      expect(bmp).not.toBeNull();
      lastUrl = bmp!.objectURL;
      await flush();
    }

    // Bitmap reused: same objectURL throughout, only one rasterize total,
    // and no objectURL was revoked (no swap → no background-image flash).
    expect(lastUrl).toBe(url0);
    expect((global as any).URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('rebuilds when the content genuinely changes', async () => {
    const f0 = makeRepeatSVG();
    getSVGObjectTileBitmapSync(f0, 1);
    await flush();
    getSVGObjectTileBitmapSync(f0, 1);
    expect((global as any).URL.createObjectURL).toHaveBeenCalledTimes(1);

    // New object with different geometry (not a compensated move).
    const edited = makeRepeatSVG({
      segments: [{ kind: 'line', start: [2, 2], end: [5, 5] }],
    });
    getSVGObjectTileBitmapSync(edited, 1);
    await flush();
    const bmp = getSVGObjectTileBitmapSync(edited, 1);
    expect(bmp).not.toBeNull();
    expect((global as any).URL.createObjectURL).toHaveBeenCalledTimes(2);
  });
});
