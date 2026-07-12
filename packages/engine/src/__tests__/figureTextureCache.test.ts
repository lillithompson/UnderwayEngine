import { CompositionFigure } from '../types';

// ── Storage / persistence / svgExport mocks ──────────────────────────
// figureTextureCache pulls SVG content through svgFigureCache, which
// loads file state via persistence. Mock the chain at the same layer
// svgFigureCache.test.ts mocks it so getFigureSVG resolves to a
// stable cached entry without touching disk.

jest.mock('@/engine/storage', () => ({
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    getBinary: jest.fn(() => Promise.resolve(null)),
  },
  __esModule: true,
}));

const mockLayers = [
  {
    id: 'l1',
    name: 'Layer 1',
    level: 0 as const,
    visible: true,
    opacity: 1,
    order: 0,
    shiftX: 0 as const,
    shiftY: 0 as const,
    locked: false,
    cells: Array.from({ length: 32 }, () => Array(32).fill(null)),
    cellsGeneration: 0,
  },
];

const loadFileStateLite = jest.fn((fileId: string) => {
  if (fileId === 'F-A' || fileId === 'F-B') {
    return Promise.resolve({
      layers: mockLayers,
      activeLayerId: 'l1',
      widthL0: 8,
      heightL0: 8,
    });
  }
  return Promise.resolve(null);
});

jest.mock('../persistence', () => ({
  loadFileState: jest.fn((fileId: string) => loadFileStateLite(fileId)),
  loadFileStateLite: jest.fn((fileId: string) => loadFileStateLite(fileId)),
  loadClipBox: jest.fn(() => Promise.resolve(null)),
}));

jest.mock('../svgExport', () => ({
  exportLayersToSVGInner: jest.fn(() => ({
    elements: ['<rect x="0" y="0" width="256" height="256" fill="red"/>'],
    widthL0: 8,
    heightL0: 8,
  })),
  SVG_UNITS_PER_L0_CELL: 256,
  SVG_STROKE_WIDTH: 5,
  prependTransform: jest.fn((elements: string[], transform: string) =>
    elements.map(el => el.replace(/<(\w+)\s/, `<$1 transform="${transform}" `))
  ),
  multiplyStrokeWidths: jest.fn((svg: string) => svg),
  maxStrokeWidth: jest.fn(() => 0),
}));

jest.mock('../bake', () => ({}));

// rasterizeSvgToPixels normally builds a DOM canvas. Replace with a fast
// stub that returns a deterministic byte pattern so we can detect
// rebuilds (each rebuild calls it once).
const rasterizeCalls = { count: 0 };
jest.mock('../svgRasterize', () => ({
  rasterizeSvgToPixels: jest.fn(async (_svg: string, w: number, h: number) => {
    rasterizeCalls.count++;
    return new Uint8Array(w * h * 4);
  }),
}));

// ── Fake WebGL context ───────────────────────────────────────────────
// figureTextureCache only invokes a small subset of the WebGL API.
// A handful of jest.fn stubs is enough to satisfy buildEntry and the
// eviction path. `isContextLost` returns false so deleteTexture fires;
// every other call is a no-op.

interface FakeTexture { __id: number }
let nextTextureId = 1;

function makeFakeGL() {
  const deleteTexture = jest.fn();
  const gl = {
    TEXTURE_2D: 0x0DE1,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    REPEAT: 0x2901,
    LINEAR: 0x2601,
    LINEAR_MIPMAP_LINEAR: 0x2703,
    isContextLost: jest.fn(() => false),
    createTexture: jest.fn((): FakeTexture => ({ __id: nextTextureId++ })),
    deleteTexture,
    bindTexture: jest.fn(),
    texParameteri: jest.fn(),
    texImage2D: jest.fn(),
    generateMipmap: jest.fn(),
  } as unknown as WebGLRenderingContext & { deleteTexture: jest.Mock };
  return gl as WebGLRenderingContext & { deleteTexture: jest.Mock };
}

// ── Imports under test (after mocks are registered) ──────────────────

import {
  getFigureTextureSync,
  evictFigureTextureByFileId,
  clearFigureTextureCache,
  __pickRasterSizeForTest,
} from '../gl/figureTextureCache';
import {
  evictFigureSVGByFileId,
  getFigureSVGSync,
  preloadFigureSVGs,
  markFigureDirty,
  drainDirtyFigureIds,
} from '../svgFigureCache';

// Helper: drain rasterizeQueue. Each buildEntry does ~5 microtask hops
// (await getFigureSVG, await rasterizeSvgToPixels, .finally, the queue's
// own .then/.finally). Queue is serialized, so n rebuilds need ~5n hops.
// 60 iterations covers a handful of rebuilds comfortably.
async function flushRebuilds(iterations = 60): Promise<void> {
  for (let i = 0; i < iterations; i++) {
    await Promise.resolve();
  }
}

// Helper: minimal tile figure. tileWidthL0/tileHeightL0 drive the cache
// key; rotation/mirror do NOT (texture is rotation-agnostic, the shader
// applies the transform at draw time).
function tileFigure(opts: {
  id: string;
  fileId: string;
  tileW: number;
  tileH: number;
  rotation?: 0 | 90 | 180 | 270;
  mirrorH?: boolean;
}): CompositionFigure {
  return {
    id: opts.id,
    figureKey: `file_${opts.fileId}_L0`,
    fileId: opts.fileId,
    cellX: 0,
    cellY: 0,
    cellWidth: opts.tileW * 2,
    cellHeight: opts.tileH * 2,
    resolutionX: 2,
    resolutionY: 2,
    tileMode: 'repeat',
    tileWidthL0: opts.tileW,
    tileHeightL0: opts.tileH,
    rotation: opts.rotation,
    mirrorH: opts.mirrorH,
  };
}

beforeEach(() => {
  clearFigureTextureCache();
  evictFigureSVGByFileId('F-A');
  evictFigureSVGByFileId('F-B');
  drainDirtyFigureIds();
  rasterizeCalls.count = 0;
  nextTextureId = 1;
});

// ── evictFigureTextureByFileId unit tests ────────────────────────────

describe('evictFigureTextureByFileId', () => {
  test('drops every entry for the given fileId across tile geometries', async () => {
    const gl = makeFakeGL();
    // Two placements of fileId F-A at different tile geometries — e.g.
    // a regular placement and a group-rotated copy whose chained group
    // transform swapped tileWidthL0 / tileHeightL0.
    const figGeoX = tileFigure({ id: 'a1', fileId: 'F-A', tileW: 4, tileH: 2 });
    const figGeoY = tileFigure({ id: 'a2', fileId: 'F-A', tileW: 2, tileH: 4 });
    // Pre-load SVG synchronously so the first sync call queues a rebuild
    // immediately (not after an async getFigureSVG roundtrip).
    await preloadFigureSVGs([figGeoX, figGeoY]);
    getFigureTextureSync(gl, figGeoX, 1);
    getFigureTextureSync(gl, figGeoY, 1);
    await flushRebuilds();
    // Confirm both entries are now resident.
    expect(getFigureTextureSync(gl, figGeoX, 1)).not.toBeNull();
    expect(getFigureTextureSync(gl, figGeoY, 1)).not.toBeNull();
    const deletedBefore = (gl.deleteTexture as jest.Mock).mock.calls.length;

    evictFigureTextureByFileId('F-A');

    // Both GPU textures were released.
    const deletedAfter = (gl.deleteTexture as jest.Mock).mock.calls.length;
    expect(deletedAfter - deletedBefore).toBe(2);
    // Subsequent sync calls return null (no entry; queueRebuild starts
    // fresh) until the next async rebuild completes.
    expect(getFigureTextureSync(gl, figGeoX, 1)).toBeNull();
    expect(getFigureTextureSync(gl, figGeoY, 1)).toBeNull();
  });

  test('leaves entries for other fileIds untouched', async () => {
    const gl = makeFakeGL();
    const figA = tileFigure({ id: 'a1', fileId: 'F-A', tileW: 4, tileH: 4 });
    const figB = tileFigure({ id: 'b1', fileId: 'F-B', tileW: 4, tileH: 4 });
    await preloadFigureSVGs([figA, figB]);
    getFigureTextureSync(gl, figA, 1);
    getFigureTextureSync(gl, figB, 1);
    await flushRebuilds();
    const deletedBefore = (gl.deleteTexture as jest.Mock).mock.calls.length;

    evictFigureTextureByFileId('F-A');

    // Only F-A's texture was deleted.
    expect((gl.deleteTexture as jest.Mock).mock.calls.length - deletedBefore).toBe(1);
    // F-B's texture is still resident.
    expect(getFigureTextureSync(gl, figB, 1)).not.toBeNull();
  });

  test('is a no-op for an unknown fileId', () => {
    const gl = makeFakeGL();
    expect(() => evictFigureTextureByFileId('nonexistent')).not.toThrow();
    expect((gl.deleteTexture as jest.Mock).mock.calls.length).toBe(0);
  });

  test('prefix anchoring with _t prevents fileId substring collisions', async () => {
    // Edge case: a fileId that is a prefix of another fileId. The cache
    // key separator `_t` between fileId and tile dims means
    // evictFigureTextureByFileId('F-A') must NOT also match keys for a
    // hypothetical 'F-A-extra' fileId. Cover the symmetric direction.
    const gl = makeFakeGL();
    // Register a custom fileId in the persistence mock.
    loadFileStateLite.mockImplementationOnce(() => Promise.resolve({
      layers: mockLayers, activeLayerId: 'l1', widthL0: 8, heightL0: 8,
    }));
    loadFileStateLite.mockImplementationOnce(() => Promise.resolve({
      layers: mockLayers, activeLayerId: 'l1', widthL0: 8, heightL0: 8,
    }));
    const figShort = tileFigure({ id: 's1', fileId: 'F-A', tileW: 4, tileH: 4 });
    const figLong = tileFigure({ id: 's2', fileId: 'F-A-extra', tileW: 4, tileH: 4 });
    await preloadFigureSVGs([figShort, figLong]);
    getFigureTextureSync(gl, figShort, 1);
    getFigureTextureSync(gl, figLong, 1);
    await flushRebuilds();

    evictFigureTextureByFileId('F-A');

    // Short fileId entry is gone, long fileId entry survives.
    expect(getFigureTextureSync(gl, figShort, 1)).toBeNull();
    expect(getFigureTextureSync(gl, figLong, 1)).not.toBeNull();
  });
});

// ── Regression test for the user-reported bug ────────────────────────

describe('rotated/mirrored pattern copies receive figure-edit updates', () => {
  test('eviction triggers fresh rasterization for all copies regardless of orientation', async () => {
    const gl = makeFakeGL();
    // Two placements of the SAME fileId with the SAME tile geometry but
    // different orientations. By design they share one cache entry — the
    // shader inverse-rotates the sample lookup, not the texture content.
    const unrotated = tileFigure({ id: 'p1', fileId: 'F-A', tileW: 4, tileH: 4, rotation: 0 });
    const rotated90 = tileFigure({ id: 'p2', fileId: 'F-A', tileW: 4, tileH: 4, rotation: 90 });
    const mirroredH = tileFigure({ id: 'p3', fileId: 'F-A', tileW: 4, tileH: 4, mirrorH: true });

    await preloadFigureSVGs([unrotated]);
    getFigureTextureSync(gl, unrotated, 1);
    getFigureTextureSync(gl, rotated90, 1);
    getFigureTextureSync(gl, mirroredH, 1);
    await flushRebuilds();

    // All three placements share one entry (one rasterization).
    expect(rasterizeCalls.count).toBe(1);
    const svgRefBefore = getFigureSVGSync(unrotated);
    expect(svgRefBefore).not.toBeNull();

    // Simulate a figure edit + return to composer: markFigureDirty fires
    // from the editor save path, then the composer drains it and evicts
    // both caches together (the fix under test).
    markFigureDirty('F-A');
    const dirty = drainDirtyFigureIds();
    expect(dirty.has('F-A')).toBe(true);
    evictFigureSVGByFileId('F-A');
    evictFigureTextureByFileId('F-A');

    // Re-render: each of the three placements queries the cache. With
    // explicit eviction the entry is gone, so the first lookup queues a
    // rebuild and subsequent same-key lookups dedupe via the inFlight
    // guard. After flush, exactly one new rasterization has occurred —
    // and crucially, the rebuild happens once for the shared key, which
    // updates ALL THREE placements (the rotated and mirrored copies are
    // the part that regressed in the user-reported bug).
    await preloadFigureSVGs([unrotated]);
    getFigureTextureSync(gl, unrotated, 1);
    getFigureTextureSync(gl, rotated90, 1);
    getFigureTextureSync(gl, mirroredH, 1);
    await flushRebuilds();

    expect(rasterizeCalls.count).toBe(2);
    const svgRefAfter = getFigureSVGSync(unrotated);
    expect(svgRefAfter).not.toBeNull();
    // Fresh CachedFigureSVG object — distinct identity from pre-edit.
    expect(svgRefAfter).not.toBe(svgRefBefore);
  });
});

// ── pickRasterSize unit tests ──────────────────────────────────────────

describe('pickRasterSize', () => {
  const FULL_BUDGET = 1024 * 1024;
  const DEGRADED_BUDGET = 512 * 512;

  function densityRatio(w: number, h: number, tileW: number, tileH: number): number {
    const dX = w / tileW;
    const dY = h / tileH;
    return Math.max(dX, dY) / Math.min(dX, dY);
  }

  function isPOT(n: number): boolean {
    return n > 0 && (n & (n - 1)) === 0;
  }

  test('square tile that fits budget returns ideal resolution', () => {
    const { widthPx, heightPx } = __pickRasterSizeForTest(4, 4, FULL_BUDGET);
    expect(widthPx).toBe(512);   // nextPOT(4*128) = 512
    expect(heightPx).toBe(512);
    expect(widthPx * heightPx).toBeLessThanOrEqual(FULL_BUDGET);
  });

  test('non-square tile that fits budget returns ideal resolution', () => {
    const { widthPx, heightPx } = __pickRasterSizeForTest(2, 8, FULL_BUDGET);
    expect(widthPx).toBe(256);   // nextPOT(2*128) = 256
    expect(heightPx).toBe(1024); // nextPOT(8*128) = 1024
    expect(widthPx * heightPx).toBeLessThanOrEqual(FULL_BUDGET);
  });

  test('5x15 tile (user repro) produces uniform density after halving', () => {
    const { widthPx, heightPx } = __pickRasterSizeForTest(5, 15, FULL_BUDGET);
    expect(widthPx * heightPx).toBeLessThanOrEqual(FULL_BUDGET);
    expect(isPOT(widthPx)).toBe(true);
    expect(isPOT(heightPx)).toBe(true);
    // The fix: density ratio should be <= 2:1 (was 3:1 before the fix).
    expect(densityRatio(widthPx, heightPx, 5, 15)).toBeLessThanOrEqual(2.0);
    // Verify the specific expected dimensions.
    expect(widthPx).toBe(512);
    expect(heightPx).toBe(2048);
  });

  test('3x9 tile fits exactly at budget boundary', () => {
    // nextPOT(3*128)=512, nextPOT(9*128)=2048 -> 512*2048=1048576 = budget
    const { widthPx, heightPx } = __pickRasterSizeForTest(3, 9, FULL_BUDGET);
    expect(widthPx).toBe(512);
    expect(heightPx).toBe(2048);
    expect(widthPx * heightPx).toBe(FULL_BUDGET);
  });

  test('wide tile (15x5) is symmetric with tall tile (5x15)', () => {
    const tall = __pickRasterSizeForTest(5, 15, FULL_BUDGET);
    const wide = __pickRasterSizeForTest(15, 5, FULL_BUDGET);
    expect(wide.widthPx).toBe(tall.heightPx);
    expect(wide.heightPx).toBe(tall.widthPx);
  });

  test('5x15 tile at degraded budget still has uniform density', () => {
    const { widthPx, heightPx } = __pickRasterSizeForTest(5, 15, DEGRADED_BUDGET);
    expect(widthPx * heightPx).toBeLessThanOrEqual(DEGRADED_BUDGET);
    expect(isPOT(widthPx)).toBe(true);
    expect(isPOT(heightPx)).toBe(true);
    expect(densityRatio(widthPx, heightPx, 5, 15)).toBeLessThanOrEqual(2.0);
  });

  test('MIN_AXIS_PX floor is enforced', () => {
    const { widthPx, heightPx } = __pickRasterSizeForTest(1, 16, DEGRADED_BUDGET);
    expect(widthPx).toBeGreaterThanOrEqual(64);
    expect(heightPx).toBeGreaterThanOrEqual(64);
    expect(isPOT(widthPx)).toBe(true);
    expect(isPOT(heightPx)).toBe(true);
  });
});
