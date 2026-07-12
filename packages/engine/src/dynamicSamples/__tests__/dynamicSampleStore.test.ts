// In-memory mock of engine/storage so the store can run without IndexedDB.
jest.mock('../../storage', () => {
  const data = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: (k: string) => Promise.resolve(data.get(k) ?? null),
      setItem: (k: string, v: string) => {
        data.set(k, v);
        return Promise.resolve();
      },
      removeItem: (k: string) => {
        data.delete(k);
        return Promise.resolve();
      },
      multiGet: (keys: string[]) =>
        Promise.resolve(keys.map((k) => [k, data.get(k) ?? null] as [string, string | null])),
      multiRemove: (keys: string[]) => {
        for (const k of keys) data.delete(k);
        return Promise.resolve();
      },
      clear: () => {
        data.clear();
        return Promise.resolve();
      },
      getBinary: () => Promise.resolve(null),
      setBinary: () => Promise.resolve(),
    },
  };
});

import {
  ensureHydrated,
  getCachedManifest,
  getCachedEtag,
  setManifest,
  subscribeManifest,
} from '../dynamicSampleStore';
import { MANIFEST_SCHEMA_VERSION } from '../manifestSchema';

const VALID_SHA = 'a'.repeat(64);

function makeSample(id: string) {
  return {
    id,
    name: id,
    createdAt: 1_700_000_000_000,
    publishDate: 1_700_000_000_000,
    compPath: `/dynamic-samples/blob/${VALID_SHA}.tile`,
    compSize: 1024,
    compSha256: VALID_SHA,
    thumbPath: `/dynamic-samples/thumb/${VALID_SHA}.webp`,
  };
}

function makeManifest(ids: string[] = ['sample-1']) {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedAt: 1_700_000_000_000,
    samples: ids.map(makeSample),
  } as const;
}

describe('dynamicSampleStore', () => {
  beforeAll(async () => {
    await ensureHydrated();
  });

  it('round-trips a manifest and ETag', async () => {
    await setManifest(makeManifest(['sample-1']) as any, 'W/"abc"');
    const cached = getCachedManifest();
    expect(cached?.samples).toHaveLength(1);
    expect(cached?.samples[0].id).toBe('sample-1');
    expect(getCachedEtag()).toBe('W/"abc"');
  });

  it('clears the ETag when null is passed', async () => {
    await setManifest(makeManifest() as any, null);
    expect(getCachedEtag()).toBeNull();
  });

  it('notifies subscribers on setManifest', async () => {
    const events: Array<string | null> = [];
    const unsubscribe = subscribeManifest((m) => {
      events.push(m ? `samples=${m.samples.length}` : null);
    });
    await setManifest(makeManifest(['sample-1']) as any, 'tag-1');
    await setManifest(makeManifest(['sample-1', 'sample-2']) as any, 'tag-2');
    unsubscribe();
    expect(events.length).toBeGreaterThanOrEqual(2);
  });
});
