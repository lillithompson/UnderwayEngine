import { LAYER_PX, CELL_COUNTS, ClipBox, cellPx } from '../types';
import {
  computeBoundingBox,
  hashFileContent,
  loadFigurePaletteThumb,
  bakeFile,
  BoundingBox,
  onBakedThumbReady,
  offBakedThumbReady,
  copyBakedArtifacts,
  loadAllBakedFigures,
} from '../bake';
import {
  loadFacetFile,
  facetToLayers,
} from './facet-pipeline';

// ── Mock storage (required by bake.ts import) ───────────────────

const storage: Record<string, string> = {};

jest.mock('@/engine/storage', () => ({
  default: {
    getItem: jest.fn((key: string) => Promise.resolve(storage[key] ?? null)),
    setItem: jest.fn((key: string, value: string) => {
      storage[key] = value;
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      delete storage[key];
      return Promise.resolve();
    }),
  },
  __esModule: true,
}));

jest.mock('../svgExport', () => ({
  exportToSVG: jest.fn(() => '<svg width="64" height="64"></svg>'),
  multiplyStrokeWidths: jest.fn((svg: string) => svg),
}));

// bake.ts uses dynamic import('./thumbnail'), so jest.mock still intercepts it
jest.mock('../thumbnail', () => ({
  svgToThumbnailDataUri: jest.fn(() => Promise.resolve('data:image/png;base64,THUMB')),
}));

// ── Load test data once ──────────────────────────────────────────────

const facet = loadFacetFile('Example_00.facet');
const layers = facetToLayers(facet.meta);

// ── Tests ────────────────────────────────────────────────────────────

describe('facet bake pipeline (Example_00)', () => {
  beforeEach(() => {
    // Clear mock storage between tests
    for (const key of Object.keys(storage)) delete storage[key];
  });

  test('loads .facet file and reconstructs layers with pixel data', () => {
    expect(facet.version).toBe(1);
    expect(facet.meta.layers.length).toBeGreaterThan(0);
    expect(layers.length).toBe(facet.meta.layers.length);

    // At least one layer should have non-null cells
    let totalCells = 0;
    for (const layer of layers) {
      const count = CELL_COUNTS[layer.level];
      for (let y = 0; y < count; y++) {
        for (let x = 0; x < count; x++) {
          if (layer.cells[y][x] !== null) totalCells++;
        }
      }
    }
    expect(totalCells).toBeGreaterThan(0);

    // At least one layer should have non-transparent pixel data
    let hasPixels = false;
    for (const layer of layers) {
      for (let i = 3; i < layer.data.length; i += 4) {
        if (layer.data[i] > 0) { hasPixels = true; break; }
      }
      if (hasPixels) break;
    }
    expect(hasPixels).toBe(true);
  });

  test('computes valid bounding box for Example_00', () => {
    const bounds = computeBoundingBox(layers);
    expect(bounds).not.toBeNull();

    const b = bounds as BoundingBox;
    expect(b.resolutionX).toBeGreaterThan(0);
    expect(b.resolutionY).toBeGreaterThan(0);
    expect(b.pxMinX).toBeGreaterThanOrEqual(0);
    expect(b.pxMinY).toBeGreaterThanOrEqual(0);
    expect(b.pxMaxX).toBeLessThanOrEqual(LAYER_PX);
    expect(b.pxMaxY).toBeLessThanOrEqual(LAYER_PX);
    expect(b.pxMaxX).toBeGreaterThan(b.pxMinX);
    expect(b.pxMaxY).toBeGreaterThan(b.pxMinY);
  });

  test('content hash is stable across identical inputs', () => {
    const hash1 = hashFileContent(layers);
    const hash2 = hashFileContent(layers);
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBeGreaterThan(0);
  });

  test('content hash changes when widthL0 or heightL0 differ', () => {
    const hashNoSize = hashFileContent(layers);
    const hashA = hashFileContent(layers, 3, 5);
    const hashB = hashFileContent(layers, 3, 6);
    const hashC = hashFileContent(layers, 4, 5);
    const hashA2 = hashFileContent(layers, 3, 5);

    // Same dimensions produce the same hash
    expect(hashA).toBe(hashA2);
    // Different dimensions produce different hashes
    expect(hashA).not.toBe(hashB);
    expect(hashA).not.toBe(hashC);
    // Providing dimensions differs from omitting them
    expect(hashA).not.toBe(hashNoSize);
  });

  test('bakeFile stores SVG palette thumbnail under fig_thumb_ key', async () => {
    // Ensure no stale index blocks the bake (hash-unchanged check)
    delete storage['baked_fig_index'];

    bakeFile('thumb-test', layers, 8, 8);

    // bakeFile is fire-and-forget; flush async phases
    for (let i = 0; i < 100; i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    const thumb = await loadFigurePaletteThumb('thumb-test');
    expect(thumb).toBe('data:image/png;base64,THUMB');
    expect(storage['fig_thumb_thumb-test']).toBe('data:image/png;base64,THUMB');
  });

  test('loadFigurePaletteThumb returns null when no thumbnail stored', async () => {
    const thumb = await loadFigurePaletteThumb('nonexistent');
    expect(thumb).toBeNull();
  });

  test('bakeFile notifies listeners when fig_thumb is written', async () => {
    delete storage['baked_fig_index'];

    const listener = jest.fn();
    onBakedThumbReady(listener);

    bakeFile('notify-test', layers, 8, 8);

    // bakeFile is fire-and-forget; flush async phases
    for (let i = 0; i < 100; i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    expect(listener).toHaveBeenCalledWith('notify-test', 'data:image/png;base64,THUMB');
    offBakedThumbReady(listener);
  });

  test('copyBakedArtifacts copies index entry, thumb, and notifies listener', async () => {
    delete storage['baked_fig_index'];

    // Seed source: bake to populate index + fig_thumb
    bakeFile('src-fig', layers, 8, 8);
    for (let i = 0; i < 100; i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(storage['fig_thumb_src-fig']).toBeTruthy();

    const listener = jest.fn();
    onBakedThumbReady(listener);

    const ok = await copyBakedArtifacts('src-fig', 'dst-fig');
    expect(ok).toBe(true);

    // Index now contains a dst entry mirroring the src entry but with new id
    const index = await loadAllBakedFigures();
    const srcEntry = index.find(e => e.fileId === 'src-fig');
    const dstEntry = index.find(e => e.fileId === 'dst-fig');
    expect(srcEntry).toBeTruthy();
    expect(dstEntry).toBeTruthy();
    expect(dstEntry!.contentHash).toBe(srcEntry!.contentHash);
    expect(dstEntry!.resolutionX).toBe(srcEntry!.resolutionX);
    expect(dstEntry!.resolutionY).toBe(srcEntry!.resolutionY);
    expect(dstEntry!.pxWidth).toBe(srcEntry!.pxWidth);
    expect(dstEntry!.pxHeight).toBe(srcEntry!.pxHeight);

    // fig_thumb_ key was duplicated to dst
    expect(storage['fig_thumb_dst-fig']).toBe(storage['fig_thumb_src-fig']);

    // Listener fired for the dst id with the copied data uri
    expect(listener).toHaveBeenCalledWith('dst-fig', storage['fig_thumb_src-fig']);

    offBakedThumbReady(listener);
  });

  test('copyBakedArtifacts returns false and writes nothing when source has no entry', async () => {
    delete storage['baked_fig_index'];

    const listener = jest.fn();
    onBakedThumbReady(listener);

    const ok = await copyBakedArtifacts('missing-src', 'dst-fig');
    expect(ok).toBe(false);

    // No index entry created for dst
    const index = await loadAllBakedFigures();
    expect(index.find(e => e.fileId === 'dst-fig')).toBeUndefined();

    // No fig_thumb written for dst
    expect(storage['fig_thumb_dst-fig']).toBeUndefined();

    // Listener not fired
    expect(listener).not.toHaveBeenCalled();

    offBakedThumbReady(listener);
  });

  test('bakeFile does not notify when hash is unchanged', async () => {
    delete storage['baked_fig_index'];

    // First bake to establish the hash
    bakeFile('skip-test', layers, 8, 8);
    for (let i = 0; i < 100; i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    const listener = jest.fn();
    onBakedThumbReady(listener);

    // Second bake with same content — hash matches, Phase 4 skipped
    bakeFile('skip-test', layers, 8, 8);
    for (let i = 0; i < 100; i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    expect(listener).not.toHaveBeenCalled();
    offBakedThumbReady(listener);
  });

  test('computeBoundingBox uses clip box when provided', () => {
    const clipBox: ClipBox = { clipL0X: 4, clipL0Y: 6, clipL0W: 10, clipL0H: 8 };
    const bounds = computeBoundingBox(layers, 32, 32, 0, 0, clipBox);
    expect(bounds).not.toBeNull();
    const b = bounds as BoundingBox;
    const l0cpx = cellPx(0); // 64
    expect(b.pxMinX).toBe(4 * l0cpx);
    expect(b.pxMinY).toBe(6 * l0cpx);
    expect(b.pxMaxX).toBe(14 * l0cpx);
    expect(b.pxMaxY).toBe(14 * l0cpx);
    expect(b.resolutionX).toBe(10 / 4);
    expect(b.resolutionY).toBe(8 / 4);
  });

  test('hashFileContent changes when clip box is added', () => {
    const hash1 = hashFileContent(layers, 32, 32, 0, 0);
    const clipBox: ClipBox = { clipL0X: 4, clipL0Y: 4, clipL0W: 8, clipL0H: 8 };
    const hash2 = hashFileContent(layers, 32, 32, 0, 0, clipBox);
    expect(hash1).not.toBe(hash2);
  });

  test('hashFileContent changes when clip box coordinates change', () => {
    const clip1: ClipBox = { clipL0X: 4, clipL0Y: 4, clipL0W: 8, clipL0H: 8 };
    const clip2: ClipBox = { clipL0X: 6, clipL0Y: 4, clipL0W: 8, clipL0H: 8 };
    const hash1 = hashFileContent(layers, 32, 32, 0, 0, clip1);
    const hash2 = hashFileContent(layers, 32, 32, 0, 0, clip2);
    expect(hash1).not.toBe(hash2);
  });
});
