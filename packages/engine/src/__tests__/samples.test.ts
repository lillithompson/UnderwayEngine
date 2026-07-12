import { CompositionEntry } from '../types';

// Mock storage
const mockStorage: Record<string, string | Uint8Array> = {};

jest.mock('@/engine/storage', () => ({
  default: {
    getItem: jest.fn((key: string) => {
      const v = mockStorage[key];
      return Promise.resolve(typeof v === 'string' ? v : null);
    }),
    setItem: jest.fn((key: string, value: string) => {
      mockStorage[key] = value;
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      delete mockStorage[key];
      return Promise.resolve();
    }),
    multiRemove: jest.fn((keys: string[]) => {
      for (const key of keys) delete mockStorage[key];
      return Promise.resolve();
    }),
    multiGet: jest.fn((keys: string[]) => {
      return Promise.resolve(keys.map(k => [k, typeof mockStorage[k] === 'string' ? mockStorage[k] : null]));
    }),
    getBinary: jest.fn((key: string) => {
      const v = mockStorage[key];
      return Promise.resolve(v instanceof Uint8Array ? v : null);
    }),
    setBinary: jest.fn((key: string, value: Uint8Array) => {
      mockStorage[key] = value;
      return Promise.resolve();
    }),
  },
  __esModule: true,
}));

// Register fixture content (the engine ships none of its own)
import { registerBuiltInContent } from '../content';
registerBuiltInContent({
  samples: [
    { name: 'Sample1', filename: 'Sample1.tile', order: 1 },
    { name: 'Sample2', filename: 'Sample2.tile', order: 2 },
  ],
});

// Track IDs returned by importCompositionBundle
let importCounter = 0;
jest.mock('../persistence', () => {
  const actual = jest.requireActual('../persistence');
  return {
    ...actual,
    importCompositionBundle: jest.fn(async (_data: Uint8Array, _name?: string, _entryFields?: Partial<CompositionEntry>) => {
      const id = `mock_${++importCounter}`;
      // Simulate what the real function does: add to composition list in storage
      const raw = mockStorage['compositions'];
      const list: CompositionEntry[] = typeof raw === 'string' ? JSON.parse(raw) : [];
      list.unshift({ id, name: _name ?? 'Untitled', ..._entryFields });
      mockStorage['compositions'] = JSON.stringify(list);
      return id;
    }),
    loadCompositionList: jest.fn(async () => {
      const raw = mockStorage['compositions'];
      return typeof raw === 'string' ? JSON.parse(raw) : [];
    }),
    saveCompositionList: jest.fn(async (entries: CompositionEntry[]) => {
      mockStorage['compositions'] = JSON.stringify(entries);
    }),
  };
});

// Mock global fetch
const mockFetchData = new Uint8Array([1, 2, 3, 4]);
(globalThis as any).fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    arrayBuffer: () => Promise.resolve(mockFetchData.buffer.slice(0)),
  })
);

import { importAllSamples, areSamplesImported } from '../samples';

beforeEach(() => {
  for (const key of Object.keys(mockStorage)) delete mockStorage[key];
  importCounter = 0;
  jest.clearAllMocks();
});

describe('areSamplesImported', () => {
  test('returns false when samples have not been imported', async () => {
    expect(await areSamplesImported()).toBe(false);
  });

  test('returns true after samples are imported', async () => {
    await importAllSamples();
    expect(await areSamplesImported()).toBe(true);
  });
});

describe('importAllSamples', () => {
  test('creates composition entries with isSample: true', async () => {
    const result = await importAllSamples();
    const samples = result.filter(c => c.isSample);
    expect(samples).toHaveLength(2);
    const names = samples.map(s => s.name).sort();
    expect(names).toEqual(['Sample1', 'Sample2']);
  });

  test('fetches each sample file from /samples/', async () => {
    await importAllSamples();
    expect(fetch).toHaveBeenCalledWith('/samples/Sample1.tile');
    expect(fetch).toHaveBeenCalledWith('/samples/Sample2.tile');
  });

  test('sets samples_imported flag in storage', async () => {
    await importAllSamples();
    expect(mockStorage['samples_imported']).toBe('true');
  });

  test('reimport creates entries with new IDs', async () => {
    const first = await importAllSamples();
    const firstIds = first.filter(c => c.isSample).map(c => c.id);

    // Clear samples from list (simulate user delete) and flag
    mockStorage['compositions'] = '[]';
    delete mockStorage['samples_imported'];

    const second = await importAllSamples();
    const secondIds = second.filter(c => c.isSample).map(c => c.id);

    expect(secondIds).toHaveLength(2);
    for (const id of secondIds) {
      expect(firstIds).not.toContain(id);
    }
  });

  test('calls onProgress after each sample is imported', async () => {
    const progress = jest.fn();
    await importAllSamples(progress);
    expect(progress).toHaveBeenCalledTimes(2);

    // First call should have 1 sample entry, second should have 2
    const firstList = progress.mock.calls[0][0] as CompositionEntry[];
    const secondList = progress.mock.calls[1][0] as CompositionEntry[];
    expect(firstList.filter(c => c.isSample)).toHaveLength(1);
    expect(secondList.filter(c => c.isSample)).toHaveLength(2);
  });

  test('skips samples that already exist in the composition list', async () => {
    const first = await importAllSamples();
    expect(first.filter(c => c.isSample)).toHaveLength(2);

    // Clear only the flag, not the compositions (simulates the bug scenario)
    delete mockStorage['samples_imported'];
    const { importCompositionBundle } = require('../persistence');
    (importCompositionBundle as jest.Mock).mockClear();

    const second = await importAllSamples();
    expect(importCompositionBundle).not.toHaveBeenCalled();
    expect(second.filter(c => c.isSample)).toHaveLength(2);
  });

  test('only imports missing samples when some already exist', async () => {
    const first = await importAllSamples();
    expect(first.filter(c => c.isSample)).toHaveLength(2);

    // Remove one sample from the list but keep the other
    const kept = first.filter(c => c.name !== 'Sample1');
    mockStorage['compositions'] = JSON.stringify(kept);
    delete mockStorage['samples_imported'];
    const { importCompositionBundle } = require('../persistence');
    (importCompositionBundle as jest.Mock).mockClear();

    const second = await importAllSamples();
    expect(importCompositionBundle).toHaveBeenCalledTimes(1);
    expect(second.filter(c => c.isSample)).toHaveLength(2);
  });

  test('does not skip import when a non-sample has the same name', async () => {
    // Pre-seed a user-created composition with the same name as a sample
    const userComp: CompositionEntry = { id: 'user_1', name: 'Sample1' };
    mockStorage['compositions'] = JSON.stringify([userComp]);

    const result = await importAllSamples();
    expect(result.filter(c => c.isSample)).toHaveLength(2);
    expect(result.find(c => c.id === 'user_1')).toBeDefined();
  });

  test('dedup guard prevents concurrent imports', async () => {
    const [result1, result2] = await Promise.all([
      importAllSamples(),
      importAllSamples(),
    ]);
    // Both should return the same result (same promise)
    expect(result1).toEqual(result2);
    // importCompositionBundle should only be called twice (once per sample), not four times
    const { importCompositionBundle } = require('../persistence');
    expect(importCompositionBundle).toHaveBeenCalledTimes(2);
  });
});

