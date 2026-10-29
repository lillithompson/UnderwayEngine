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
import { importCompositionBundle, loadCompositionState } from '../persistence';

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

// ── bakeFigures: a host whose canvas draws no figures ───────────────
//
// The shared editor renders svgObjects, images, texts, paint and patterns
// and a CompositionFigure nowhere, so its PAGE_IO asks the import to bake
// every figure the bundle carries the file for into the svg that draws the
// same thing — from the bundle's bytes, with nothing of the file stored.

/** A level-2 (8×8) file whose top-left cell is a red colour cell: one
 *  filled rect, 4 L0 cells on a side. */
function makeColorFileBytes(fileId: string): Uint8Array {
  const cells = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => null as any));
  cells[0][0] = { type: 'color', r: 200, g: 40, b: 40, transform: { rotation: 0, mirrorH: false, mirrorV: false } };
  const layers = [{
    id: `${fileId}_l0`, name: 'Layer', level: 2 as const, visible: true, opacity: 1, order: 0, cells,
  }];
  return serializeFile(layers as any, layers[0].id, 32, 32, fileId);
}

async function figureBundle(figures: CompositionFigure[], files: EmbeddedFile[], extra?: object): Promise<Uint8Array> {
  return compressTile(serializeComposition({
    name: 'Letters',
    gridLevel: 1 as const,
    strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures,
    ...extra,
  }, files));
}

describe('importCompositionBundle with bakeFigures', () => {
  const red: EmbeddedFile = { id: 'red', name: 'R', widthL0: 32, heightL0: 32, data: makeColorFileBytes('red') };

  test('every file-backed figure lands as an svg under its own id, and the file is never stored', async () => {
    const bytes = await figureBundle([
      makeFigure({ id: 'a', figureKey: 'file_red_L0', fileId: 'red', cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32, name: 'R', locked: true }),
      makeFigure({ id: 'b', figureKey: 'file_red_L0', fileId: 'red', cellX: 16, cellY: 16, cellWidth: 16, cellHeight: 16, colorOverride: { r: 0, g: 0, b: 255 } }),
    ], [red], { sceneOrder: ['b', 'a'] });
    const id = await importCompositionBundle(bytes, 'Letters.tile', undefined, { normalize: false, bakeFigures: true });
    const state = (await loadCompositionState(id, { normalize: false }))!;

    expect(state.figures).toEqual([]);
    expect(state.svgObjects!.map((o) => o.id)).toEqual(['a', 'b']);
    expect(state.sceneOrder).toEqual(['b', 'a']);
    // The 32-cell file's one level-2 cell is 4 L0 cells; placed over a
    // 32-cell box it is 4 cells, over a 16-cell box 2.
    const a = state.svgObjects![0];
    expect(a.subpaths).toHaveLength(1);
    expect(a.subpaths![0].fill).toBe(true);
    expect(a.subpaths![0].color).toEqual({ r: 200, g: 40, b: 40 });
    expect([a.cellX, a.cellY, a.cellWidth, a.cellHeight]).toEqual([0, 0, 4, 4]);
    expect(a.name).toBe('R');
    expect(a.locked).toBe(true);
    const b = state.svgObjects![1];
    expect([b.cellX, b.cellY, b.cellWidth, b.cellHeight]).toEqual([16, 16, 2, 2]);
    expect(b.color).not.toEqual({ r: 200, g: 40, b: 40 });

    // Nothing of the file: no meta record, no bake, no entry in the file list.
    expect(Object.keys(storage).filter((k) => k.startsWith('file_meta_'))).toEqual([]);
    expect(bakeFileMock).not.toHaveBeenCalled();
    expect(JSON.parse((storage['files'] as string) ?? '[]')).toEqual([]);
  });

  test('a figure the bundle has no file for stays a figure, and only its file is stored', async () => {
    const other: EmbeddedFile = { id: 'other', name: 'O', widthL0: 32, heightL0: 32, data: makeColorFileBytes('other') };
    const bytes = await figureBundle([
      makeFigure({ id: 'baked', figureKey: 'file_red_L0', fileId: 'red' }),
      makeFigure({ id: 'sprite', figureKey: 'all_L0:3' }),
      makeFigure({ id: 'orphan', figureKey: 'file_gone_L0', fileId: 'gone' }),
    ], [red, other]);
    const id = await importCompositionBundle(bytes, 'Mixed.tile', undefined, { bakeFigures: true });
    const state = (await loadCompositionState(id))!;
    expect(state.svgObjects!.map((o) => o.id)).toEqual(['baked']);
    expect(state.figures!.map((f) => f.id)).toEqual(['sprite', 'orphan']);
    // `other` backs no figure after the bake and `red` was baked away: no
    // file is stored at all, and no bake runs.
    expect(Object.keys(storage).filter((k) => k.startsWith('file_meta_'))).toEqual([]);
    expect(bakeFileMock).not.toHaveBeenCalled();
  });

  test('without the option figures and their files import as before', async () => {
    const bytes = await figureBundle([
      makeFigure({ id: 'a', figureKey: 'file_red_L0', fileId: 'red' }),
    ], [red]);
    const id = await importCompositionBundle(bytes, 'Letters.tile', undefined, { normalize: false });
    const state = (await loadCompositionState(id, { normalize: false }))!;
    expect(state.svgObjects).toEqual([]);
    expect(state.figures).toHaveLength(1);
    expect(Object.keys(storage).filter((k) => k.startsWith('file_meta_'))).toHaveLength(1);
    expect(bakeFileMock).toHaveBeenCalledTimes(1);
  });
});

// ── Host-data chunks (format v70) through the store ──────────────────
//
// The engine carries a host's chunks and never reads them: in with an
// import, kept in the comp_meta record as base64 across every save and
// load, out again with an export. A host that keeps its own record outside
// the composition takes its chunk at import and hands it back at export.

import { deserializeComposition } from '../compositionBinaryFormat';
import { decompressTile } from '../tileIO';
import { exportCompositionBundle } from '../persistence';

describe('host-data chunks through the store', () => {
  const sol = new Uint8Array([1, 2, 3]);
  const other = new Uint8Array([9]);

  async function chunkyBundle(hostChunks?: Record<string, Uint8Array>): Promise<Uint8Array> {
    return compressTile(serializeComposition({
      name: 'Chunky',
      gridLevel: 1,
      strokeScale: 8, gridIntensity: 0.5,
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      figures: [],
      hostChunks,
    }, []));
  }

  async function exported(id: string, hostChunks?: Record<string, Uint8Array>) {
    const bytes = await exportCompositionBundle(id, undefined, hostChunks);
    return deserializeComposition(await decompressTile(bytes!)).meta.hostChunks;
  }

  test('come in with an import, sit in the record as base64, and go out with an export', async () => {
    const id = await importCompositionBundle(await chunkyBundle({ sol, other }), 'Chunky.tile');
    expect((await loadCompositionState(id))?.hostChunks).toEqual({ sol, other });
    const record = JSON.parse(storage[`comp_meta_${id}`] as string);
    expect(record.hostChunks).toEqual({ sol: 'AQID', other: 'CQ==' });
    expect(await exported(id)).toEqual({ sol, other });
  });

  test('a host takes its own chunk at import, and the rest stay with the composition', async () => {
    const taken: number[] = [];
    const id = await importCompositionBundle(
      await chunkyBundle({ sol, other }), 'Chunky.tile', undefined, undefined, undefined,
      (chunks) => {
        const { sol: mine, ...rest } = chunks;
        taken.push(...Array.from(mine));
        return rest;
      },
    );
    expect(taken).toEqual([1, 2, 3]);
    expect((await loadCompositionState(id))?.hostChunks).toEqual({ other });
    expect(JSON.parse(storage[`comp_meta_${id}`] as string).hostChunks).toEqual({ other: 'CQ==' });
  });

  test('the export lays the caller’s chunks over the stored ones', async () => {
    const id = await importCompositionBundle(await chunkyBundle({ sol, other }), 'Chunky.tile');
    const fresh = new Uint8Array([7, 7]);
    expect(await exported(id, { sol: fresh })).toEqual({ sol: fresh, other });
  });

  test('a composition with no chunks has no field in its record and no section in its file', async () => {
    const id = await importCompositionBundle(await chunkyBundle(), 'Plain.tile');
    expect((await loadCompositionState(id))?.hostChunks).toBeUndefined();
    expect(JSON.parse(storage[`comp_meta_${id}`] as string)).not.toHaveProperty('hostChunks');
    expect(await exported(id)).toBeUndefined();
    // A taker that takes everything leaves no field either.
    const id2 = await importCompositionBundle(
      await chunkyBundle({ sol }), 'Chunky.tile', undefined, undefined, undefined, () => ({}),
    );
    expect((await loadCompositionState(id2))?.hostChunks).toBeUndefined();
    expect(JSON.parse(storage[`comp_meta_${id2}`] as string)).not.toHaveProperty('hostChunks');
  });
});
