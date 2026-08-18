import { saveFileState, loadFileState, importFileData, exportFileData, FileMeta, duplicateCompositionData, saveClipBox, loadClipBox } from '../persistence';
import { Layer, CellState, LAYER_PX, cellPx } from '../types';
import { makeLayer, setCellForTest } from './test-utils';
import { clearBinaryCache } from '../binaryFormat';

jest.mock('../bake', () => ({
  bakeFile: jest.fn(() => Promise.resolve()),
  removeBakedFigure: jest.fn(() => Promise.resolve()),
}));

// Mock storage — supports both string and binary values
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
    multiRemove: jest.fn((keys: string[]) => {
      for (const key of keys) delete storage[key];
      return Promise.resolve();
    }),
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

/** Check that the first pixel of a cell has the expected RGBA values */
function expectCellPixel(layer: Layer, cellX: number, cellY: number, r: number, g: number, b: number, a: number) {
  const size = cellPx(layer.level);
  const idx = (cellY * size * LAYER_PX + cellX * size) * 4;
  expect(layer.data[idx]).toBe(r);
  expect(layer.data[idx + 1]).toBe(g);
  expect(layer.data[idx + 2]).toBe(b);
  expect(layer.data[idx + 3]).toBe(a);
}

beforeEach(() => {
  Object.keys(storage).forEach((k) => delete storage[k]);
  clearBinaryCache();
});

describe('Persistence', () => {
  test('save and load rebuilds pixel data from cells', async () => {
    const layer = makeLayer('l1', 2, 0);
    const color: CellState = { type: 'color', r: 42, g: 128, b: 200, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };
    setCellForTest(layer, 0, 0, color);
    setCellForTest(layer, 3, 5, color);

    await saveFileState('file1', [layer], 'l1');
    const loaded = await loadFileState('file1');

    expect(loaded).not.toBeNull();
    const loadedLayer = loaded!.layers[0];

    // Painted cells should have correct pixels
    expectCellPixel(loadedLayer, 0, 0, 42, 128, 200, 255);
    expectCellPixel(loadedLayer, 3, 5, 42, 128, 200, 255);
    // Empty cell should be zeroed
    expectCellPixel(loadedLayer, 1, 1, 0, 0, 0, 0);
  });

  test('save and load preserves cell metadata exactly', async () => {
    const layer = makeLayer('l1', 2, 0);
    const color1: CellState = { type: 'color', r: 10, g: 20, b: 30, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };
    const color2: CellState = { type: 'color', r: 100, g: 200, b: 255, transform: { mirrorH: true, mirrorV: false, rotation: 90 } };
    setCellForTest(layer, 0, 0, color1);
    setCellForTest(layer, 7, 7, color2);

    await saveFileState('file2', [layer], 'l1');
    const loaded = await loadFileState('file2');

    expect(loaded).not.toBeNull();
    const loadedLayer = loaded!.layers[0];
    expect(loadedLayer.cells[0][0]).toEqual(color1);
    expect(loadedLayer.cells[7][7]).toEqual(color2);
    expect(loadedLayer.cells[1][1]).toBeNull();
  });

  test('save and load multi-layer file preserves all layers', async () => {
    const layer1 = makeLayer('a', 2, 0);
    const layer2 = makeLayer('b', 1, 1);
    const color: CellState = { type: 'color', r: 50, g: 60, b: 70, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };
    setCellForTest(layer1, 2, 2, color);
    setCellForTest(layer2, 5, 5, color);

    await saveFileState('file3', [layer1, layer2], 'b');
    const loaded = await loadFileState('file3');

    expect(loaded).not.toBeNull();
    expect(loaded!.layers.length).toBe(2);
    expect(loaded!.activeLayerId).toBe('b');

    const ll1 = loaded!.layers.find(l => l.id === 'a')!;
    const ll2 = loaded!.layers.find(l => l.id === 'b')!;

    expect(ll1.cells[2][2]).toEqual(color);
    expect(ll2.cells[5][5]).toEqual(color);

    // Verify pixel data was rebuilt correctly
    expectCellPixel(ll1, 2, 2, 50, 60, 70, 255);
    expectCellPixel(ll2, 5, 5, 50, 60, 70, 255);
  });

  test('only stores metadata key, not per-layer pixel data', async () => {
    const layer = makeLayer('l1', 2, 0);
    const color: CellState = { type: 'color', r: 1, g: 2, b: 3, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };
    setCellForTest(layer, 0, 0, color);

    await saveFileState('file4', [layer], 'l1');

    // Should only have one key (metadata), not separate pixel data keys
    const keys = Object.keys(storage);
    expect(keys.length).toBe(1);
    expect(keys[0]).toBe('file_meta_file4');
  });

  test('load returns null for nonexistent file', async () => {
    const loaded = await loadFileState('nonexistent');
    expect(loaded).toBeNull();
  });

  test('saves and loads locked state', async () => {
    const layer = makeLayer('l1', 2, 0);
    layer.locked = true;

    await saveFileState('file_lock', [layer], 'l1');
    const loaded = await loadFileState('file_lock');

    expect(loaded).not.toBeNull();
    expect(loaded!.layers[0].locked).toBe(true);
  });

  test('stores data as binary (Uint8Array)', async () => {
    const layer = makeLayer('l1', 2, 0);
    await saveFileState('file_bin', [layer], 'l1');

    const stored = storage['file_meta_file_bin'];
    expect(stored).toBeInstanceOf(Uint8Array);
  });

  test('saves and loads widthL0 and heightL0', async () => {
    const layer = makeLayer('l1', 2, 0);
    await saveFileState('file_dims', [layer], 'l1', 48, 24);
    const loaded = await loadFileState('file_dims');

    expect(loaded).not.toBeNull();
    expect(loaded!.widthL0).toBe(48);
    expect(loaded!.heightL0).toBe(24);
  });

  test('saves and loads layer shift values', async () => {
    const layer = makeLayer('l1', 2, 0);
    layer.shiftX = 0.5;
    layer.shiftY = 0.5;

    await saveFileState('file_shift', [layer], 'l1');
    const loaded = await loadFileState('file_shift');

    expect(loaded).not.toBeNull();
    expect(loaded!.layers[0].shiftX).toBe(0.5);
    expect(loaded!.layers[0].shiftY).toBe(0.5);
  });

  test('saves and loads layer opacity', async () => {
    const layer = makeLayer('l1', 2, 0);
    layer.opacity = 0.75;

    await saveFileState('file_opacity', [layer], 'l1');
    const loaded = await loadFileState('file_opacity');

    expect(loaded).not.toBeNull();
    expect(loaded!.layers[0].opacity).toBeCloseTo(0.75, 2);
  });

  test('load evicts byte cache so re-edits are not stale', async () => {
    const layer = makeLayer('l1', 2, 0);
    const red: CellState = { type: 'color', r: 255, g: 0, b: 0, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };
    setCellForTest(layer, 0, 0, red);
    // cellsGeneration is now 1 after one edit
    await saveFileState('cacheTest', [layer], 'l1');

    // Reload (cellsGeneration resets to 0)
    const loaded = await loadFileState('cacheTest');
    expect(loaded).not.toBeNull();
    const layer2 = loaded!.layers[0];
    expect(layer2.cellsGeneration).toBe(0);

    // Make 1 edit — generation goes back to 1, matching session 1's cached generation
    const blue: CellState = { type: 'color', r: 0, g: 0, b: 255, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };
    setCellForTest(layer2, 0, 0, blue);

    // Save — must NOT return stale (red) bytes
    await saveFileState('cacheTest', [layer2], 'l1');

    // Verify by loading one more time
    const reloaded = await loadFileState('cacheTest');
    expect(reloaded).not.toBeNull();
    expect(reloaded!.layers[0].cells[0][0]).toEqual(
      expect.objectContaining({ type: 'color', r: 0, g: 0, b: 255 }),
    );
  });
});

describe('ClipBox in binary file', () => {
  it('saveFileState writes clipBox into the binary so it survives without the sidecar', async () => {
    const layer = makeLayer('l1', 2, 0);
    const clipBox = { clipL0X: 2, clipL0Y: 4, clipL0W: 8, clipL0H: 6 };

    await saveFileState('f_bin_clip', [layer], 'l1', 32, 32, 0, 0, clipBox);

    // Wipe the sidecar (proves we're reading from the binary) — re-import
    // and read it back via exportFileData (which calls deserializeFile).
    delete storage['clip_box_f_bin_clip'];

    const exported = await exportFileData('f_bin_clip');
    // exportFileData needs a name in the files list
    expect(storage[`file_meta_f_bin_clip`]).toBeInstanceOf(Uint8Array);
    expect(exported?.meta.clipBox).toEqual(clipBox);
  });

  it('importFileData populates both binary and sidecar clipBox', async () => {
    const layer = makeLayer('l1', 2, 0);
    const clipBox = { clipL0X: 1, clipL0Y: 1, clipL0W: 4, clipL0H: 4 };
    const meta: FileMeta = {
      activeLayerId: 'l1',
      layers: [{
        id: layer.id,
        name: layer.name,
        level: layer.level,
        visible: layer.visible,
        opacity: layer.opacity,
        order: layer.order,
        shiftX: layer.shiftX,
        shiftY: layer.shiftY,
        locked: layer.locked,
        cells: layer.cells,
        edgeRowTop: layer.edgeRowTop,
        edgeColLeft: layer.edgeColLeft,
        edgeCorner: layer.edgeCorner,
      }],
      widthL0: 32,
      heightL0: 32,
      clipBox,
    };

    const newId = await importFileData({ name: 'clipped', meta });

    // Sidecar mirrored
    expect(await loadClipBox(newId)).toEqual(clipBox);
    // Binary carries it
    const exported = await exportFileData(newId);
    expect(exported?.meta.clipBox).toEqual(clipBox);
  });
});

describe('ClipBox Persistence', () => {
  beforeEach(() => {
    for (const key of Object.keys(storage)) delete storage[key];
  });

  it('saves and loads clip box', async () => {
    const clipBox = { clipL0X: 4, clipL0Y: 6, clipL0W: 10, clipL0H: 8 };
    await saveClipBox('clip_test', clipBox);
    const loaded = await loadClipBox('clip_test');
    expect(loaded).toEqual(clipBox);
  });

  it('returns null when no clip box saved', async () => {
    const loaded = await loadClipBox('no_clip');
    expect(loaded).toBeNull();
  });

  it('clears clip box when saving null', async () => {
    const clipBox = { clipL0X: 2, clipL0Y: 2, clipL0W: 4, clipL0H: 4 };
    await saveClipBox('clip_clear', clipBox);
    expect(await loadClipBox('clip_clear')).toEqual(clipBox);

    await saveClipBox('clip_clear', null);
    expect(await loadClipBox('clip_clear')).toBeNull();
  });
});

describe('importFileData', () => {
  function makeMeta(): FileMeta {
    const layer = makeLayer('l1', 2, 0);
    return {
      activeLayerId: 'l1',
      layers: [{
        id: layer.id,
        name: layer.name,
        level: layer.level,
        visible: layer.visible,
        opacity: layer.opacity,
        order: layer.order,
        shiftX: layer.shiftX,
        shiftY: layer.shiftY,
        locked: layer.locked,
        cells: layer.cells,
        edgeRowTop: layer.edgeRowTop,
        edgeColLeft: layer.edgeColLeft,
        edgeCorner: layer.edgeCorner,
      }],
      widthL0: 32,
      heightL0: 32,
    };
  }

  test('sequential imports produce unique ids and preserve all names', async () => {
    const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
    const ids: string[] = [];
    for (const name of names) {
      const id = await importFileData({ name, meta: makeMeta() });
      ids.push(id);
    }

    // All returned ids must be unique
    expect(new Set(ids).size).toBe(ids.length);

    // Each id must have its own meta blob stored
    for (const id of ids) {
      expect(storage[`file_meta_${id}`]).toBeInstanceOf(Uint8Array);
    }

    // FILES_KEY list must contain all N entries with correct names
    const list = JSON.parse(storage['files'] as string) as { id: string; name: string }[];
    expect(list.length).toBe(names.length);
    for (const name of names) {
      expect(list.find((e) => e.name === name)).toBeDefined();
    }
    // Every entry's id is one of the returned ids
    for (const entry of list) {
      expect(ids).toContain(entry.id);
    }
  });
});

describe('duplicateCompositionData', () => {
  beforeEach(() => {
    for (const key of Object.keys(storage)) delete storage[key];
  });

  test('copies metadata with new name and thumbnail', async () => {
    const meta = { name: 'Original', figures: [], camera: { x: 0, y: 0, zoom: 1 }, gridLevel: 3 };
    storage['comp_meta_src1'] = JSON.stringify(meta);
    storage['comp_thumb_src1'] = 'data:image/png;base64,abc';

    const thumb = await duplicateCompositionData('src1', 'dst1', 'Original copy');

    expect(thumb).toBe('data:image/png;base64,abc');
    const copied = JSON.parse(storage['comp_meta_dst1'] as string);
    expect(copied.name).toBe('Original copy');
    expect(copied.figures).toEqual([]);
    expect(copied.gridLevel).toBe(3);
    expect(storage['comp_thumb_dst1']).toBe('data:image/png;base64,abc');
  });

  test('returns null when source has no metadata', async () => {
    const result = await duplicateCompositionData('missing', 'dst2', 'Copy');
    expect(result).toBeNull();
    expect(storage['comp_meta_dst2']).toBeUndefined();
  });

  test('copies metadata without thumbnail when none exists', async () => {
    const meta = { name: 'NoThumb', figures: [] };
    storage['comp_meta_src3'] = JSON.stringify(meta);

    const thumb = await duplicateCompositionData('src3', 'dst3', 'NoThumb copy');

    expect(thumb).toBeNull();
    const copied = JSON.parse(storage['comp_meta_dst3'] as string);
    expect(copied.name).toBe('NoThumb copy');
    expect(storage['comp_thumb_dst3']).toBeUndefined();
  });

  test('deep-clones figure files so duplicate does not share storage with source', async () => {
    // Source figure file: a single painted cell, persisted as binary.
    const layer = makeLayer('lA', 2, 0);
    const red: CellState = { type: 'color', r: 200, g: 10, b: 10, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };
    setCellForTest(layer, 0, 0, red);
    await saveFileState('src-fig-1', [layer], 'lA');

    // Register the figure in the global files list so name lookup succeeds.
    storage['files'] = JSON.stringify([{ id: 'src-fig-1', name: 'My Figure' }]);

    // Source composition references that figure twice (different instances).
    const meta = {
      name: 'Original',
      figures: [
        {
          id: 'figA', figureKey: 'figures/src-fig-1.v1', fileId: 'src-fig-1',
          cellX: 0, cellY: 0, resolutionX: 2, resolutionY: 2, cellWidth: 2, cellHeight: 2,
          locked: true,
        },
        {
          id: 'figB', figureKey: 'figures/src-fig-1.v1', fileId: 'src-fig-1',
          cellX: 4, cellY: 0, resolutionX: 2, resolutionY: 2, cellWidth: 2, cellHeight: 2,
        },
      ],
    };
    storage['comp_meta_src-comp'] = JSON.stringify(meta);

    await duplicateCompositionData('src-comp', 'dst-comp', 'Copy');

    const copied = JSON.parse(storage['comp_meta_dst-comp'] as string);
    expect(copied.figures).toHaveLength(2);

    const [dupA, dupB] = copied.figures;
    // Both instances point at the same NEW fileId (one clone per unique source fileId).
    expect(dupA.fileId).toBeDefined();
    expect(dupA.fileId).not.toBe('src-fig-1');
    expect(dupB.fileId).toBe(dupA.fileId);
    // figureKey was rewritten to embed the new fileId.
    expect(dupA.figureKey).toBe(`figures/${dupA.fileId}.v1`);
    expect(dupA.figureKey).not.toContain('src-fig-1');
    // Lock state on the instance carries over to the copy.
    expect(dupA.locked).toBe(true);
    expect(dupB.locked).toBeUndefined();

    // Edit the duplicate's figure the way the figure editor would (writes
    // fresh bytes via saveFileState); the source figure must be unaffected.
    const editedLayer = makeLayer('lA', 2, 0);
    const blue: CellState = { type: 'color', r: 10, g: 20, b: 230, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };
    setCellForTest(editedLayer, 1, 1, blue);
    await saveFileState(dupA.fileId, [editedLayer], 'lA');

    const sourceLoaded = await loadFileState('src-fig-1');
    expect(sourceLoaded).not.toBeNull();
    // Source still has its original red cell at (0,0) and nothing at (1,1).
    expectCellPixel(sourceLoaded!.layers[0], 0, 0, 200, 10, 10, 255);
    expectCellPixel(sourceLoaded!.layers[0], 1, 1, 0, 0, 0, 0);

    const dupLoaded = await loadFileState(dupA.fileId);
    expect(dupLoaded).not.toBeNull();
    // Duplicate reflects the new edit and not the source's red cell.
    expectCellPixel(dupLoaded!.layers[0], 1, 1, 10, 20, 230, 255);
    expectCellPixel(dupLoaded!.layers[0], 0, 0, 0, 0, 0, 0);
  });

  test('leaves figures without a fileId untouched', async () => {
    const meta = {
      name: 'AssetOnly',
      figures: [
        {
          id: 'figX', figureKey: 'builtin/star', cellX: 0, cellY: 0,
          resolutionX: 2, resolutionY: 2, cellWidth: 2, cellHeight: 2,
        },
      ],
    };
    storage['comp_meta_asset-src'] = JSON.stringify(meta);

    await duplicateCompositionData('asset-src', 'asset-dst', 'Asset copy');

    const copied = JSON.parse(storage['comp_meta_asset-dst'] as string);
    expect(copied.figures[0].figureKey).toBe('builtin/star');
    expect(copied.figures[0].fileId).toBeUndefined();
  });
});
