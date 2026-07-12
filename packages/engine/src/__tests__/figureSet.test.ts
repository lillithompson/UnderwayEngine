import { saveFileState, loadFileState, exportFileData, importFileData } from '../persistence';
import { CellState } from '../types';
import { applyCellEdit } from '../cells';
import { makeLayer } from './test-utils';
import { clearBinaryCache } from '../binaryFormat';

// Mock storage
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

// Mock bake (importFileData calls bakeFile)
jest.mock('@/engine/bake', () => ({
  bakeFile: jest.fn(() => Promise.resolve()),
}));

beforeEach(() => {
  Object.keys(storage).forEach((k) => delete storage[k]);
  clearBinaryCache();
});

describe('Figure Set (.facet)', () => {
  const color: CellState = { type: 'color', r: 42, g: 128, b: 200, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };

  async function createTestFile(fileId: string, name: string): Promise<void> {
    const layer = makeLayer('l1', 2, 0);
    applyCellEdit(layer, 0, 0, color);
    await saveFileState(fileId, [layer], 'l1');
    // Add to files list
    const raw = storage['files'];
    const files = raw ? JSON.parse(raw as string) : [];
    files.push({ id: fileId, name });
    storage['files'] = JSON.stringify(files);
  }

  test('exportFileData returns data for each figure', async () => {
    await createTestFile('f1', 'Figure A');
    await createTestFile('f2', 'Figure B');

    const dataA = await exportFileData('f1');
    const dataB = await exportFileData('f2');

    expect(dataA).not.toBeNull();
    expect(dataA!.name).toBe('Figure A');
    expect(dataA!.meta.layers).toHaveLength(1);

    expect(dataB).not.toBeNull();
    expect(dataB!.name).toBe('Figure B');
  });

  test('figure set envelope has correct structure', async () => {
    await createTestFile('f1', 'Figure A');
    await createTestFile('f2', 'Figure B');

    const figures: { name: string; meta: any; thumbnail?: string }[] = [];
    for (const fileId of ['f1', 'f2']) {
      const data = await exportFileData(fileId);
      if (data) figures.push({ name: data.name, meta: data.meta, thumbnail: data.thumbnail });
    }

    const envelope = { version: 1, type: 'figureset', figures };
    expect(envelope.type).toBe('figureset');
    expect(envelope.figures).toHaveLength(2);
    expect(envelope.figures[0].name).toBe('Figure A');
    expect(envelope.figures[1].name).toBe('Figure B');
    expect(envelope.figures[0].meta.layers).toBeDefined();
  });

  test('round-trip: export figures then import from envelope', async () => {
    await createTestFile('f1', 'Figure A');
    await createTestFile('f2', 'Figure B');

    // Export
    const figures: { name: string; meta: any; thumbnail?: string }[] = [];
    for (const fileId of ['f1', 'f2']) {
      const data = await exportFileData(fileId);
      if (data) figures.push({ name: data.name, meta: data.meta, thumbnail: data.thumbnail });
    }
    const envelope = { version: 1, type: 'figureset', figures };
    const json = JSON.stringify(envelope);

    // Clear storage to simulate importing on a fresh device
    Object.keys(storage).forEach((k) => delete storage[k]);
    clearBinaryCache();

    // Parse and import
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe('figureset');
    expect(Array.isArray(parsed.figures)).toBe(true);

    const importedIds: string[] = [];
    for (const fig of parsed.figures) {
      if (!fig.meta) continue;
      const id = await importFileData({ name: fig.name, meta: fig.meta, thumbnail: fig.thumbnail });
      importedIds.push(id);
    }

    expect(importedIds).toHaveLength(2);

    // Verify both files load correctly
    for (const id of importedIds) {
      const loaded = await loadFileState(id);
      expect(loaded).not.toBeNull();
      expect(loaded!.layers).toHaveLength(1);
      expect(loaded!.layers[0].cells[0][0]).toEqual(color);
    }

    // Verify files list has both entries
    const filesRaw = storage['files'] as string;
    const filesList = JSON.parse(filesRaw);
    expect(filesList.length).toBe(2);
  });

  test('round-trip preserves clipBox set on the source figure', async () => {
    const layer = makeLayer('l1', 2, 0);
    applyCellEdit(layer, 0, 0, color);
    const clipBox = { clipL0X: 4, clipL0Y: 8, clipL0W: 16, clipL0H: 12 };
    await saveFileState('f_clip', [layer], 'l1', 32, 32, 0, 0, clipBox);
    const filesRaw = storage['files'];
    const files = filesRaw ? JSON.parse(filesRaw as string) : [];
    files.push({ id: 'f_clip', name: 'Clipped' });
    storage['files'] = JSON.stringify(files);

    // Export
    const exported = await exportFileData('f_clip');
    expect(exported).not.toBeNull();
    expect(exported!.meta.clipBox).toEqual(clipBox);

    // Round-trip through JSON envelope
    const envelope = { version: 1, type: 'figureset', figures: [{ name: exported!.name, meta: exported!.meta }] };
    const parsed = JSON.parse(JSON.stringify(envelope));

    // Clear storage to simulate fresh device
    Object.keys(storage).forEach((k) => delete storage[k]);
    clearBinaryCache();

    const newId = await importFileData({ name: parsed.figures[0].name, meta: parsed.figures[0].meta });

    // Verify the imported file's binary carries the clipBox
    const reExported = await exportFileData(newId);
    expect(reExported).not.toBeNull();
    expect(reExported!.meta.clipBox).toEqual(clipBox);

    // And that the sidecar key was populated for runtime readers
    const sidecar = storage[`clip_box_${newId}`];
    expect(sidecar).toBeDefined();
    expect(JSON.parse(sidecar as string)).toEqual(clipBox);
  });

  test('import skips figures missing meta', async () => {
    const envelope = {
      version: 1,
      type: 'figureset',
      figures: [
        { name: 'No Meta' },
        { name: 'Also No Meta', meta: null },
      ],
    };
    const json = JSON.stringify(envelope);
    const parsed = JSON.parse(json);

    const importedIds: string[] = [];
    for (const fig of parsed.figures) {
      if (!fig.meta) continue;
      const id = await importFileData({ name: fig.name, meta: fig.meta });
      importedIds.push(id);
    }

    expect(importedIds).toHaveLength(0);
  });

});
