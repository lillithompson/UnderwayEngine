import { serializeComposition, EmbeddedFile } from '../compositionBinaryFormat';
import { serializeFile } from '../binaryFormat';
import { compressTile } from '../tileIO';
import { SVGObject, CompositionFigure, Layer, LAYER_PX } from '../types';

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
      Promise.resolve(keys.map(k => [k, typeof storage[k] === 'string' ? storage[k] : null] as [string, string | null])),
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

const bakeFileMock: jest.Mock<Promise<void>, unknown[]> = jest.fn(
  (..._args: unknown[]) => Promise.resolve(),
);
jest.mock('../bake', () => ({
  bakeFile: (...args: unknown[]) => bakeFileMock(...args),
}));

const rebuildPixelDataMock: jest.Mock<void, unknown[]> = jest.fn();
jest.mock('../cells', () => {
  const actual = jest.requireActual('../cells');
  return {
    ...actual,
    rebuildPixelData: (...args: unknown[]) => rebuildPixelDataMock(...args),
  };
});

// Import after mocks
import { importCompositionBundle } from '../persistence';

function makeFigure(overrides: Partial<CompositionFigure> & { id: string; figureKey: string }): CompositionFigure {
  return {
    cellX: 0,
    cellY: 0,
    resolutionX: 2,
    resolutionY: 2,
    cellWidth: 4,
    cellHeight: 4,
    ...overrides,
  };
}

function makeFileBytes(fileId: string, layerCount: number): Uint8Array {
  const layers = Array.from({ length: layerCount }, (_, i) => ({
    id: `${fileId}_l${i}`,
    name: `Layer ${i}`,
    level: 2 as const,
    visible: true,
    opacity: 1,
    order: i,
    cells: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => null)),
  }));
  return serializeFile(layers as any, layers[0].id, 32, 32, fileId);
}

async function makeBundleBytes(fileCount: number, layersPerFile: number): Promise<Uint8Array> {
  const embeddedFiles: EmbeddedFile[] = Array.from({ length: fileCount }, (_, i) => {
    const id = `f${i}`;
    return {
      id,
      name: `File ${i}`,
      widthL0: 32,
      heightL0: 32,
      data: makeFileBytes(id, layersPerFile),
    };
  });
  const bundle = {
    name: 'Test Bundle',
    gridLevel: 1 as const,
    strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: embeddedFiles.map((ef, i) =>
      makeFigure({ id: `fig${i}`, figureKey: `file_${ef.id}_L0`, fileId: ef.id }),
    ),
  };
  const payload = serializeComposition(bundle, embeddedFiles);
  return compressTile(payload);
}

beforeEach(() => {
  for (const key of Object.keys(storage)) delete storage[key];
  bakeFileMock.mockClear();
  rebuildPixelDataMock.mockClear();
});

describe('importCompositionBundle memory behavior', () => {
  test('bakes each embedded file once', async () => {
    const bytes = await makeBundleBytes(3, 2);
    await importCompositionBundle(bytes, 'Test.tile');
    expect(bakeFileMock).toHaveBeenCalledTimes(3);
  });

  test('does not allocate per-layer pixel buffers (uses metaToLayersLite)', async () => {
    // A full pixel buffer is LAYER_PX*LAYER_PX*4 = 16 MB. The import path
    // must not allocate these, or iOS will OOM-kill on sample import.
    const bytes = await makeBundleBytes(2, 3); // 2 files × 3 layers = 6 layers
    await importCompositionBundle(bytes, 'Test.tile');

    // rebuildPixelData is called only by metaToLayers, never by metaToLayersLite.
    expect(rebuildPixelDataMock).not.toHaveBeenCalled();

    // Every layer passed to bakeFile has empty pixel buffers.
    const bigBufferBytes = LAYER_PX * LAYER_PX * 4;
    for (const call of bakeFileMock.mock.calls) {
      const layers = call[1] as unknown as Layer[];
      for (const layer of layers) {
        expect(layer.data.length).toBe(0);
        expect(layer.dataU32.length).toBe(0);
        expect(layer.data.byteLength).toBeLessThan(bigBufferBytes);
      }
    }
  });

  test('stores entryFields in composition list entry', async () => {
    const bytes = await makeBundleBytes(1, 1);
    const compId = await importCompositionBundle(bytes, 'Sample.tile', { isSample: true });

    const listRaw = storage['compositions'] as string;
    expect(listRaw).toBeDefined();
    const list = JSON.parse(listRaw);
    const entry = list.find((e: any) => e.id === compId);
    expect(entry).toBeDefined();
    expect(entry.isSample).toBe(true);
    expect(entry.name).toBe('Sample');
  });

  test('omitting entryFields creates a plain entry', async () => {
    const bytes = await makeBundleBytes(1, 1);
    const compId = await importCompositionBundle(bytes, 'User.tile');

    const listRaw = storage['compositions'] as string;
    const list = JSON.parse(listRaw);
    const entry = list.find((e: any) => e.id === compId);
    expect(entry).toBeDefined();
    expect(entry.isSample).toBeUndefined();
  });

  test('preserves svgObjects through bundle import', async () => {
    // Authored at the canonical 32×32 bbox so the import-time normalization
    // (in saveCompositionState) is a no-op and the segment values pass
    // through unchanged.
    const svgLine: SVGObject = {
      id: 'svg-1',
      segments: [
        { kind: 'line', start: [0, 0], end: [16, 32] },
        { kind: 'line', start: [16, 32], end: [32, 0] },
      ],
      color: { r: 200, g: 100, b: 50 },
      rotation: 90,
      mirrorH: true,
      cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32,
    };
    const svgArc: SVGObject = {
      id: 'svg-2',
      segments: [
        { kind: 'arc', start: [0, 0], end: [16, 16], center: [16, 0] },
        { kind: 'line', start: [16, 16], end: [32, 16] },
      ],
      color: { r: 10, g: 20, b: 30 },
      locked: true,
      cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 16,
    };
    const bundle = {
      name: 'SVGObjects',
      gridLevel: 1 as const,
      strokeScale: 0.04, gridIntensity: 0.5,
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      figures: [],
      svgObjects: [svgLine, svgArc],
    };
    const payload = serializeComposition(bundle, []);
    const bytes = await compressTile(payload);

    const compId = await importCompositionBundle(bytes, 'SVGObjects.tile');

    const metaRaw = storage[`comp_meta_${compId}`] as string;
    expect(metaRaw).toBeDefined();
    const meta = JSON.parse(metaRaw);

    expect(meta.svgObjects).toHaveLength(2);
    expect(meta.svgObjects[0].id).toBe('svg-1');
    expect(meta.svgObjects[0].segments).toEqual([
      { kind: 'line', start: [0, 0], end: [16, 32] },
      { kind: 'line', start: [16, 32], end: [32, 0] },
    ]);
    expect(meta.svgObjects[0].color).toEqual({ r: 200, g: 100, b: 50 });
    expect(meta.svgObjects[0].rotation).toBe(90);
    expect(meta.svgObjects[0].mirrorH).toBe(true);

    expect(meta.svgObjects[1].id).toBe('svg-2');
    expect(meta.svgObjects[1].segments).toEqual([
      { kind: 'arc', start: [0, 0], end: [16, 16], center: [16, 0] },
      { kind: 'line', start: [16, 16], end: [32, 16] },
    ]);
    expect(meta.svgObjects[1].color).toEqual({ r: 10, g: 20, b: 30 });
    expect(meta.svgObjects[1].locked).toBe(true);
  });
});
