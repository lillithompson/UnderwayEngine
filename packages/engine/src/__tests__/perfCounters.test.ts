import { toBase64 } from '../pngcodec';
import {
  countDecode, formatPerfCounters, perfDelta, readPerfCounters, resetPerfCounters,
} from '../debug/perfCounters';

// docs/image_refactor.md §5 states the refactor's budgets per debounce tick:
// bytes read from the store, base64 built, full-resolution decodes. An
// Allocations trace cannot see any of them — they happen inside a JS heap,
// where the trace sees anonymous malloc blocks attributed to the engine that
// ran the code rather than to the code. These pin them instead.

// The real storage module, over an in-memory idb-keyval, so the counting sits
// where the bytes actually cross the structured-clone boundary.
const idb: Record<string, unknown> = {};
jest.mock('idb-keyval', () => ({
  __esModule: true,
  get: jest.fn((k: string) => Promise.resolve(idb[k])),
  set: jest.fn((k: string, v: unknown) => { idb[k] = v; return Promise.resolve(); }),
  del: jest.fn((k: string) => { delete idb[k]; return Promise.resolve(); }),
  clear: jest.fn(() => { for (const k of Object.keys(idb)) delete idb[k]; return Promise.resolve(); }),
  keys: jest.fn(() => Promise.resolve(Object.keys(idb))),
}));

import storage, { __resetStorageKeyCacheForTest } from '../storage';

beforeEach(() => {
  for (const k of Object.keys(idb)) delete idb[k];
  __resetStorageKeyCacheForTest();
  resetPerfCounters();
});

describe('the counters themselves', () => {
  it('starts at zero and reports a copy, not a live view', () => {
    const snap = readPerfCounters();
    expect(snap.storageReadBytes).toBe(0);
    expect(snap.base64Count).toBe(0);

    snap.base64Count = 99;
    expect(readPerfCounters().base64Count).toBe(0);
  });

  it('reports the work of one call, and nesting does not zero the outer one', async () => {
    const outer = await perfDelta(async () => {
      countDecode(false);
      const inner = await perfDelta(() => { countDecode(true); });
      // The inner measurement sees only its own work…
      expect(inner.counters.decodeScaledCount).toBe(1);
      expect(inner.counters.decodeFullCount).toBe(0);
      countDecode(false);
    });
    // …and the outer one still sees everything, because a delta subtracts
    // rather than resetting. Two measurements can overlap.
    expect(outer.counters.decodeFullCount).toBe(2);
    expect(outer.counters.decodeScaledCount).toBe(1);
  });

  it('measures only what happened inside, not before or after', async () => {
    countDecode(false);
    const { counters } = await perfDelta(() => { countDecode(false); });
    countDecode(false);
    expect(counters.decodeFullCount).toBe(1);
    expect(readPerfCounters().decodeFullCount).toBe(3);
  });

  it('gives back the wrapped function\'s own result', async () => {
    const { result } = await perfDelta(() => 'tile');
    expect(result).toBe('tile');
  });
});

describe('storage reads and writes', () => {
  it('counts the bytes a binary read actually pulls across', async () => {
    await storage.setBinary('imgblob_a', new Uint8Array(1500));
    resetPerfCounters();

    const { counters } = await perfDelta(() => storage.getBinary('imgblob_a'));
    expect(counters.storageReadCount).toBe(1);
    expect(counters.storageReadBytes).toBe(1500);
  });

  it('counts a write by the bytes it sends', async () => {
    const { counters } = await perfDelta(() => storage.setBinary('imgblob_b', new Uint8Array(64)));
    expect(counters.storageWriteCount).toBe(1);
    expect(counters.storageWriteBytes).toBe(64);
  });

  it('charges nothing for a miss: there were no bytes to read', async () => {
    const { result, counters } = await perfDelta(() => storage.getBinary('imgblob_absent'));
    expect(result).toBeNull();
    expect(counters.storageReadCount).toBe(0);
    expect(counters.storageReadBytes).toBe(0);
  });

  it('charges nothing for hasBinary — the value is the thing it does not read', async () => {
    await storage.setBinary('imgblob_c', new Uint8Array(3_400_000));
    resetPerfCounters();

    const { result, counters } = await perfDelta(() => storage.hasBinary('imgblob_c'));
    expect(result).toBe(true);
    // The whole point of the key-set scan: a 3.4 MB master can be found
    // present without any of its bytes crossing the boundary.
    expect(counters.storageReadBytes).toBe(0);
  });

  it('adds up across a tick, which is the quantity §5 budgets', async () => {
    await storage.setBinary('imgblob_d', new Uint8Array(100));
    await storage.setBinary('imgblob_e', new Uint8Array(250));
    resetPerfCounters();

    const { counters } = await perfDelta(async () => {
      await storage.getBinary('imgblob_d');
      await storage.getBinary('imgblob_e');
      await storage.getBinary('imgblob_d');
    });
    expect(counters.storageReadCount).toBe(3);
    expect(counters.storageReadBytes).toBe(450);
  });
});

describe('base64', () => {
  it('counts the input bytes — the string built is 4/3 of them', async () => {
    const { result, counters } = await perfDelta(() => toBase64(new Uint8Array(3000)));
    expect(counters.base64Count).toBe(1);
    expect(counters.base64Bytes).toBe(3000);
    expect(result.length).toBe(4000);
  });

  it('counts every call, so a path that encodes twice cannot look like once', async () => {
    const { counters } = await perfDelta(() => {
      toBase64(new Uint8Array(30));
      toBase64(new Uint8Array(60));
    });
    expect(counters.base64Count).toBe(2);
    expect(counters.base64Bytes).toBe(90);
  });

  it('is zero for a tick that encodes nothing', async () => {
    const { counters } = await perfDelta(() => storage.getBinary('imgblob_absent'));
    expect(counters.base64Count).toBe(0);
  });
});

describe('formatPerfCounters', () => {
  it('reads in the order §5\'s table does, so a dump and the doc line up', async () => {
    const { counters } = await perfDelta(() => {
      countDecode(false);
      countDecode(true);
      countDecode(true);
      toBase64(new Uint8Array(2048));
    });
    expect(formatPerfCounters(counters)).toBe(
      'blob r0/0 B · w0/0 B · text r0/0 B · w0/0 B'
      + ' · base64 1/2.0 KB · decodes 1 full, 2 scaled · headers 0 read, 0 missed',
    );
  });

  it('scales units so a megabyte does not print as seven digits', () => {
    const c = readPerfCounters();
    expect(formatPerfCounters({ ...c, storageReadCount: 1, storageReadBytes: 3_566_305 }))
      .toContain('blob r1/3.40 MB');
    expect(formatPerfCounters({ ...c, base64Bytes: 900 })).toContain('base64 0/900 B');
  });
});

describe('the text path, where a page\'s own document lives', () => {
  it('counts a document read apart from a blob read', async () => {
    // persistence.ts saves a composition with setItem, not setBinary. Until
    // this was counted, a debounce tick that re-read the whole document
    // measured as zero — the blob counters cannot see it, and §5's
    // "68 MB read per tick" was mostly this.
    await storage.setItem('comp_meta_x', 'y'.repeat(4096));
    resetPerfCounters();

    const { counters } = await perfDelta(() => storage.getItem('comp_meta_x'));
    expect(counters.textReadCount).toBe(1);
    expect(counters.textReadBytes).toBe(4096);
    expect(counters.storageReadCount).toBe(0);
    expect(counters.storageReadBytes).toBe(0);
  });

  it('counts a document write by the characters it sends', async () => {
    const { counters } = await perfDelta(() => storage.setItem('comp_meta_y', 'z'.repeat(300)));
    expect(counters.textWriteCount).toBe(1);
    expect(counters.textWriteBytes).toBe(300);
    expect(counters.storageWriteCount).toBe(0);
  });

  it('charges nothing for a text miss', async () => {
    const { result, counters } = await perfDelta(() => storage.getItem('comp_meta_absent'));
    expect(result).toBeNull();
    expect(counters.textReadCount).toBe(0);
  });

  it('keeps the two paths separate, so a fat read says WHICH it was', async () => {
    await storage.setItem('doc', 'd'.repeat(1000));
    await storage.setBinary('blob', new Uint8Array(500));
    resetPerfCounters();

    const { counters } = await perfDelta(async () => {
      await storage.getItem('doc');
      await storage.getBinary('blob');
    });
    expect(counters.textReadBytes).toBe(1000);
    expect(counters.storageReadBytes).toBe(500);
  });
});
