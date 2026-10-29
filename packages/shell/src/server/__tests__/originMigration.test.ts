import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

// The copy of one origin's saved work to another (modules/static-server/
// web/originMigration.js), the piece of the port move that decides whether
// an install keeps its journal. Driven here over fake-indexeddb — two
// factories stand for the two origins — and a stand-in native side that
// spools what the exporter posts and hands it to the importer, as the Swift
// module does (StaticServerModule.swift `OriginMigrationRun`). The real
// pages are the Swift module's; what WebKit does with a frame's storage is
// not modelled here, which is why the script runs no frame at all.

/* eslint-disable @typescript-eslint/no-var-requires */
// A plain script, not a module: it embeds in Swift as it is.
const migration = require('../../../modules/static-server/web/originMigration.js') as {
  exportOrigin: (idb: IDBFactory, storage: StorageLike | null, send: (m: Message) => Promise<unknown>, options?: { pageSize?: number }) => Promise<Totals>;
  createImporter: (idb: IDBFactory, storage: StorageLike | null) => { handle: (m: Message) => Promise<unknown> };
  readSchema: (db: IDBDatabase) => Schema;
  encodeValue: (value: unknown) => Promise<unknown>;
  decodeValue: (data: unknown) => unknown;
  verifyCounts: (sent: Record<string, Record<string, number>>, localStorage: number, got: unknown) => void;
  runExporter: (options: PageOptions) => Promise<void>;
  runImporter: (options: PageOptions) => Promise<void>;
};

(globalThis as unknown as { IDBKeyRange: unknown }).IDBKeyRange = IDBKeyRange;

type Message = { type: string; [k: string]: unknown };
type Totals = { databases: number; records: number; localStorage: number };
type Schema = {
  name: string;
  version: number;
  stores: Array<{ name: string; keyPath: unknown; autoIncrement: boolean; indexes: Array<{ name: string; keyPath: unknown; unique: boolean; multiEntry: boolean }> }>;
};
interface StorageLike {
  readonly length: number;
  key(i: number): string | null;
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  clear(): void;
}
interface PageOptions {
  idb: IDBFactory | null;
  storage: StorageLike | null;
  origin: string;
  isTop: boolean;
  expectedOrigin: string;
  post: (m: Message) => Promise<unknown>;
  pageSize?: number;
}

function fakeStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    key(i) { return Array.from(m.keys())[i] ?? null; },
    getItem(k) { return m.has(k) ? (m.get(k) as string) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    clear() { m.clear(); },
  };
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function open(idb: IDBFactory, name: string, version?: number, upgrade?: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = version === undefined ? idb.open(name) : idb.open(name, version);
    if (upgrade) r.onupgradeneeded = () => upgrade(r.result);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * A stored value as plain data: bytes as number arrays, dates as ISO strings.
 * fake-indexeddb's clones live in node's own realm while the script's
 * decoded values live in jest's, and jest cannot compare typed arrays
 * across realms — so a dump holds neither.
 */
function plain(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  const tag = Object.prototype.toString.call(value);
  if (tag === '[object ArrayBuffer]') return { buffer: Array.from(new Uint8Array(value as ArrayBuffer)) };
  if (ArrayBuffer.isView(value)) return { [tag.slice(8, -1)]: Array.from(new Uint8Array((value as ArrayBufferView).buffer, (value as ArrayBufferView).byteOffset, (value as ArrayBufferView).byteLength)) };
  if (tag === '[object Date]') return { date: (value as Date).toISOString() };
  if (Array.isArray(value)) return value.map(plain);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as object)) out[k] = plain((value as Record<string, unknown>)[k]);
  return out;
}

/** Everything in a factory, as plain data a test can compare. */
async function dump(idb: IDBFactory): Promise<Record<string, { schema: Schema; data: Record<string, Array<[unknown, unknown]>> }>> {
  const out: Record<string, { schema: Schema; data: Record<string, Array<[unknown, unknown]>> }> = {};
  const infos = await idb.databases();
  for (const info of infos.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))) {
    const db = await open(idb, info.name as string);
    const schema = migration.readSchema(db);
    const data: Record<string, Array<[unknown, unknown]>> = {};
    for (const store of schema.stores) {
      const tx = db.transaction(store.name, 'readonly');
      const keys = await req(tx.objectStore(store.name).getAllKeys());
      const values = await req(tx.objectStore(store.name).getAll());
      data[store.name] = keys.map((k, i) => [plain(k), plain(values[i])]);
    }
    db.close();
    out[info.name as string] = { schema, data };
  }
  return out;
}

const bytes = (...b: number[]) => new Uint8Array(b);

/** A journal-shaped origin: an idb-keyval store, a versioned database with indexes, localStorage. */
async function seedSource(idb: IDBFactory, storage: StorageLike): Promise<void> {
  const keyval = await open(idb, 'keyval-store', 1, (db) => { db.createObjectStore('keyval'); });
  {
    const tx = keyval.transaction('keyval', 'readwrite');
    const s = tx.objectStore('keyval');
    s.put({ title: 'Monday', words: ['pine', 'fog'], at: new Date(2026, 9, 1) }, 'cozy:entry:a');
    s.put({ title: 'Tuesday', nested: { depth: { of: 3 } } }, 'cozy:entry:b');
    s.put(bytes(0x89, 0x50, 0x4e, 0x47, 1, 2, 3), 'cozy:thumb:a');
    s.put(new Uint8Array([7, 7, 7]).buffer, 'cozy:thumb:b');
    s.put('plain string', 'cozy:settings');
    s.put(42, 'cozy:count');
    s.put(null, 'cozy:nothing');
    await done(tx);
  }
  keyval.close();

  const rows = await open(idb, 'entries', 3, (db) => {
    const s = db.createObjectStore('rows', { keyPath: 'id', autoIncrement: true });
    s.createIndex('byDay', 'day', { unique: false, multiEntry: false });
    s.createIndex('byTag', 'tags', { unique: false, multiEntry: true });
    s.createIndex('bySlug', 'slug', { unique: true, multiEntry: false });
    const c = db.createObjectStore('composite', { keyPath: ['day', 'slot'] });
    c.createIndex('bySlot', 'slot');
    db.createObjectStore('empty');
  });
  {
    const tx = rows.transaction(['rows', 'composite'], 'readwrite');
    const r = tx.objectStore('rows');
    for (let i = 1; i <= 7; i++) r.put({ id: i, day: `2026-10-${i}`, slug: `s${i}`, tags: ['t', `t${i}`] });
    const c = tx.objectStore('composite');
    c.put({ day: '2026-10-01', slot: 1, body: 'x' });
    c.put({ day: '2026-10-01', slot: 2, body: 'y' });
    await done(tx);
  }
  rows.close();

  storage.setItem('underway:janitor:lastRun', '1760000000000');
  storage.setItem('editor:theme', 'dark');
  storage.setItem('empty', '');
}

/** What the native side does with a message: nothing but JSON survives it. */
const overTheWire = (m: Message): Message => JSON.parse(JSON.stringify(m)) as Message;

/** The whole copy, source to target, through the importer directly — every message crossing as JSON. */
function copy(source: IDBFactory, sourceStorage: StorageLike, target: IDBFactory, targetStorage: StorageLike, options?: { pageSize?: number; tap?: (m: Message) => Message }) {
  const importer = migration.createImporter(target, targetStorage);
  const messages: Message[] = [];
  const send = (m: Message) => {
    messages.push(m);
    return importer.handle(overTheWire(options?.tap ? options.tap(m) : m));
  };
  return migration.exportOrigin(source, sourceStorage, send, { pageSize: options?.pageSize }).then((totals) => ({ totals, messages }));
}

describe('originMigration: one origin copied to another', () => {
  it('reproduces every database, store, index, record and localStorage entry', async () => {
    const a = new IDBFactory(); const sa = fakeStorage();
    const b = new IDBFactory(); const sb = fakeStorage();
    await seedSource(a, sa);

    const { totals } = await copy(a, sa, b, sb, { pageSize: 2 });

    expect(totals).toEqual({ databases: 2, records: 7 + 7 + 2, localStorage: 3 });
    const before = await dump(a);
    const after = await dump(b);
    expect(after).toEqual(before);
    // Spot checks on what "equal" covered: the schema and the binary values.
    expect(after.entries.schema.version).toBe(3);
    expect(after.entries.schema.stores.map((s) => s.name)).toEqual(['composite', 'empty', 'rows']);
    const rows = after.entries.schema.stores.find((s) => s.name === 'rows')!;
    expect(rows).toMatchObject({ keyPath: 'id', autoIncrement: true });
    expect(rows.indexes).toEqual([
      { name: 'byDay', keyPath: 'day', unique: false, multiEntry: false },
      { name: 'bySlug', keyPath: 'slug', unique: true, multiEntry: false },
      { name: 'byTag', keyPath: 'tags', unique: false, multiEntry: true },
    ]);
    expect(after.entries.schema.stores.find((s) => s.name === 'composite')!.keyPath).toEqual(['day', 'slot']);
    const thumb = after['keyval-store'].data.keyval.find(([k]) => k === 'cozy:thumb:a')!;
    expect(thumb[1]).toEqual({ Uint8Array: [0x89, 0x50, 0x4e, 0x47, 1, 2, 3] });
    const buffer = after['keyval-store'].data.keyval.find(([k]) => k === 'cozy:thumb:b')!;
    expect(buffer[1]).toEqual({ buffer: [7, 7, 7] });
    const entry = after['keyval-store'].data.keyval.find(([k]) => k === 'cozy:entry:a')!;
    expect((entry[1] as { at: unknown }).at).toEqual({ date: new Date(2026, 9, 1).toISOString() });
    expect(sb.length).toBe(3);
    expect(sb.getItem('editor:theme')).toBe('dark');
    expect(sb.getItem('empty')).toBe('');
  });

  it('keeps a key generator ahead of the copied keys', async () => {
    const a = new IDBFactory(); const b = new IDBFactory();
    await seedSource(a, fakeStorage());
    await copy(a, fakeStorage(), b, fakeStorage());
    const db = await open(b, 'entries');
    const tx = db.transaction('rows', 'readwrite');
    const key = await req(tx.objectStore('rows').add({ day: 'later', slug: 'new', tags: [] }));
    await done(tx);
    db.close();
    expect(key).toBe(8);
  });

  it('pages through a store in key order, growing the page while records are small', async () => {
    const a = new IDBFactory(); const sa = fakeStorage(); const b = new IDBFactory();
    await seedSource(a, sa);
    const { messages } = await copy(a, sa, b, fakeStorage(), { pageSize: 2 });
    const pages = messages.filter((m) => m.type === 'records' && m.store === 'rows') as unknown as Array<{ keys: number[] }>;
    // 2, then 4 (small records double the page), then the last 1.
    expect(pages.map((p) => p.keys.length)).toEqual([2, 4, 1]);
    expect(pages.flatMap((p) => p.keys)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // An empty store sends no page, and a database with none of its own
    // stores still arrives.
    expect(messages.some((m) => m.type === 'records' && m.store === 'empty')).toBe(false);
    expect(messages.filter((m) => m.type === 'database').length).toBe(2);
    expect(messages.map((m) => m.type).slice(-2)).toEqual(['localStorage', 'finish']);
    // The last message carries what was read, for the importer to hold its
    // own counts against on the other origin.
    const finish = messages[messages.length - 1];
    expect(finish.sent).toEqual({ 'keyval-store': { keyval: 7 }, entries: { composite: 2, empty: 0, rows: 7 } });
    expect(finish.localStorage).toBe(3);
  });

  it('refuses a copy whose counts disagree, record or localStorage', async () => {
    const a = new IDBFactory(); const sa = fakeStorage();
    await seedSource(a, sa);
    const dropLast = (m: Message): Message => {
      if (m.type === 'records' && m.store === 'keyval') {
        const keys = (m.keys as unknown[]).slice(0, -1);
        const values = (m.values as unknown[]).slice(0, -1);
        return { ...m, keys, values };
      }
      return m;
    };
    await expect(copy(a, sa, new IDBFactory(), fakeStorage(), { tap: dropLast })).rejects.toThrow(/count mismatch in keyval-store\/keyval: sent 7, imported 6/);

    const dropStorage = (m: Message): Message => (m.type === 'localStorage' ? { ...m, entries: [] } : m);
    await expect(copy(a, sa, new IDBFactory(), fakeStorage(), { tap: dropStorage })).rejects.toThrow(/localStorage mismatch: sent 3, imported 0/);
  });

  it('starts a database over on the target, so an interrupted run leaves nothing stale', async () => {
    const a = new IDBFactory(); const sa = fakeStorage();
    const b = new IDBFactory(); const sb = fakeStorage();
    await seedSource(a, sa);
    // The target already holds a later version of one database with a
    // stray record, and a localStorage key of its own.
    const stale = await open(b, 'keyval-store', 9, (db) => { db.createObjectStore('keyval'); db.createObjectStore('stray'); });
    const tx = stale.transaction('keyval', 'readwrite');
    tx.objectStore('keyval').put('ghost', 'cozy:entry:zzz');
    await done(tx);
    stale.close();
    sb.setItem('left:over', '1');

    await copy(a, sa, b, sb);

    expect(await dump(b)).toEqual(await dump(a));
    expect(sb.getItem('left:over')).toBeNull();
  });

  it('copies an origin that holds nothing as nothing', async () => {
    const { totals } = await copy(new IDBFactory(), fakeStorage(), new IDBFactory(), fakeStorage());
    expect(totals).toEqual({ databases: 0, records: 0, localStorage: 0 });
  });

  it('names the missing API when indexedDB cannot list databases', async () => {
    const legacy = { open() { throw new Error('unused'); } } as unknown as IDBFactory;
    await expect(migration.exportOrigin(legacy, null, async () => null)).rejects.toThrow('indexedDB.databases() is unavailable');
  });
});

// The native side carries JSON and nothing else, so every key and value
// crosses encoded; what comes back must be what went in, bytes and all.
describe('originMigration: the wire encoding', () => {
  const roundTrip = async (value: unknown) => migration.decodeValue(JSON.parse(JSON.stringify(await migration.encodeValue(value))));

  it('passes JSON\'s own types through as they are', async () => {
    const plain = { s: 'x', n: 1.5, b: true, z: null, list: [1, 'two', { three: 3 }] };
    expect(await migration.encodeValue(plain)).toEqual(plain);
    expect(await roundTrip(plain)).toEqual(plain);
  });

  it('carries what structured clone carries and JSON does not', async () => {
    const view = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const value = {
      when: new Date(1760000000000),
      nothing: undefined,
      nan: NaN,
      inf: -Infinity,
      big: 2n ** 70n,
      bytes: view,
      buffer: new Uint8Array([7, 7, 7]).buffer,
      floats: new Float32Array([1.5, -2]),
      pattern: /a+b/gi,
      map: new Map<unknown, unknown>([['k', new Date(5)], [1, [1, 2]]]),
      set: new Set([1, 'two']),
      tagged: { $u: 'date', v: 1 },
    };
    const back = await roundTrip(value) as typeof value;
    expect(back.when).toEqual(new Date(1760000000000));
    expect('nothing' in back && back.nothing === undefined).toBe(true);
    expect(back.nan).toBeNaN();
    expect(back.inf).toBe(-Infinity);
    expect(back.big).toBe(2n ** 70n);
    expect(back.bytes).toEqual(view);
    expect(back.buffer).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(back.buffer)).toEqual(new Uint8Array([7, 7, 7]));
    expect(back.floats).toEqual(new Float32Array([1.5, -2]));
    expect(back.pattern).toEqual(/a+b/gi);
    expect(back.map).toEqual(new Map<unknown, unknown>([['k', new Date(5)], [1, [1, 2]]]));
    expect(back.set).toEqual(new Set([1, 'two']));
    // A plain object that owns the tag key is still that object.
    expect(back.tagged).toEqual({ $u: 'date', v: 1 });
  });

  it('carries a Blob as its bytes and type', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const back = await roundTrip(blob) as Blob;
    expect(back).toBeInstanceOf(Blob);
    expect(back.type).toBe('image/png');
    expect(new Uint8Array(await back.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('is the only form a record takes on the wire: a page of records is plain JSON', async () => {
    const a = new IDBFactory();
    await seedSource(a, fakeStorage());
    const messages: Message[] = [];
    await migration.exportOrigin(a, fakeStorage(), async (m) => { messages.push(m); return null; });
    for (const m of messages) {
      // JSON round-trips to itself, so nothing was lost to it.
      expect(JSON.parse(JSON.stringify(m))).toEqual(m);
      if (m.type === 'records') {
        for (const v of m.values as unknown[]) expect(v === null || ['string', 'number', 'boolean', 'object'].includes(typeof v)).toBe(true);
      }
    }
  });
});

// The native side between the two pages: it spools what the exporter posts
// and hands the spool to the importer one message at a time — as the Swift
// module does, through its reply-capable message handler — and remembers
// what each page reported. Everything crosses as JSON.
function fakeNative(options: { tamper?: (m: Message, index: number) => Message } = {}) {
  const spool: string[] = [];
  const reports: Message[] = [];
  let delivered = 0;
  return {
    spool,
    reports,
    exporterPost: async (m: Message): Promise<unknown> => {
      if (m.type === 'progress' || m.type === 'exported' || m.type === 'error') {
        reports.push(overTheWire(m));
        return null;
      }
      spool.push(JSON.stringify(m));
      return null;
    },
    importerPost: async (m: Message): Promise<unknown> => {
      if (m.type === 'next') {
        if (delivered >= spool.length) return { type: 'end' };
        const next = JSON.parse(spool[delivered]) as Message;
        return options.tamper ? options.tamper(next, delivered++) : (delivered++, next);
      }
      reports.push(overTheWire(m));
      return null;
    },
  };
}

describe('originMigration: the two top-level pages', () => {
  const OLD = 'http://localhost:18730';
  const NEW = 'http://localhost:18750';

  function exporterOptions(a: IDBFactory, sa: StorageLike, native: ReturnType<typeof fakeNative>, overrides: Partial<PageOptions> = {}): PageOptions {
    return { idb: a, storage: sa, origin: OLD, isTop: true, expectedOrigin: OLD, post: native.exporterPost, pageSize: 2, ...overrides };
  }
  function importerOptions(b: IDBFactory, sb: StorageLike, native: ReturnType<typeof fakeNative>, overrides: Partial<PageOptions> = {}): PageOptions {
    return { idb: b, storage: sb, origin: NEW, isTop: true, expectedOrigin: NEW, post: native.importerPost, ...overrides };
  }

  it('exports to the spool with progress, then the importer writes it on the new origin and reports done', async () => {
    const a = new IDBFactory(); const sa = fakeStorage();
    const b = new IDBFactory(); const sb = fakeStorage();
    await seedSource(a, sa);
    const native = fakeNative();

    await migration.runExporter(exporterOptions(a, sa, native));
    expect(native.reports[native.reports.length - 1]).toEqual({ type: 'exported', databases: 2, records: 16, localStorage: 3 });
    const progress = native.reports.filter((m) => m.type === 'progress').map((m) => m.records as number);
    expect(progress[progress.length - 1]).toBe(16);
    expect(progress).toEqual([...progress].sort((x, y) => x - y));
    // Nothing has been written anywhere yet: the spool is the only copy.
    expect(await b.databases()).toEqual([]);
    expect(native.spool.length).toBeGreaterThan(3);

    await migration.runImporter(importerOptions(b, sb, native));
    expect(native.reports[native.reports.length - 1]).toEqual({ type: 'done', databases: 2, records: 16, localStorage: 3 });
    expect(await dump(b)).toEqual(await dump(a));
    expect(sb.getItem('editor:theme')).toBe('dark');
  });

  it('refuses to export from a page that did not get the old origin, and touches nothing', async () => {
    const a = new IDBFactory();
    await seedSource(a, fakeStorage());
    const native = fakeNative();
    await migration.runExporter(exporterOptions(a, fakeStorage(), native, { origin: 'null' }));
    expect(native.reports).toEqual([{ type: 'error', message: `origin mismatch: this page is null, expected ${OLD}` }]);
    expect(native.spool).toEqual([]);
  });

  it('refuses to import into a page that is not the top document, or not on the new origin', async () => {
    // A frame's storage is partitioned and transient on WebKit: the lesson
    // of 2026-10-29, when the importer was an iframe and 745 records went
    // into a partition the app never read.
    const b = new IDBFactory();
    const framed = fakeNative();
    await migration.runImporter(importerOptions(b, fakeStorage(), framed, { isTop: false }));
    expect(framed.reports).toEqual([{ type: 'error', message: 'not a top-level document: a frame\'s storage is not the origin\'s' }]);

    const elsewhere = fakeNative();
    await migration.runImporter(importerOptions(b, fakeStorage(), elsewhere, { origin: OLD }));
    expect(elsewhere.reports).toEqual([{ type: 'error', message: `origin mismatch: this page is ${OLD}, expected ${NEW}` }]);
    expect(await b.databases()).toEqual([]);

    const exporterFramed = fakeNative();
    await migration.runExporter(exporterOptions(new IDBFactory(), fakeStorage(), exporterFramed, { isTop: false }));
    expect(exporterFramed.reports[0].type).toBe('error');
  });

  it('counts on the NEW origin, and a spool that lost a record is an error, not a copy', async () => {
    const a = new IDBFactory(); const sa = fakeStorage();
    await seedSource(a, sa);
    // One record lost from the first page of the keyval store.
    let dropped = false;
    const native = fakeNative({
      tamper: (m) => {
        if (dropped || m.type !== 'records' || m.store !== 'keyval') return m;
        dropped = true;
        return { ...m, keys: (m.keys as unknown[]).slice(0, -1), values: (m.values as unknown[]).slice(0, -1) };
      },
    });
    await migration.runExporter(exporterOptions(a, sa, native));
    const b = new IDBFactory();
    await migration.runImporter(importerOptions(b, fakeStorage(), native));
    expect(native.reports[native.reports.length - 1]).toEqual({ type: 'error', message: 'count mismatch in keyval-store/keyval: sent 7, imported 6' });
  });

  it('reports a spool that ends before finish, and an importer that cannot write', async () => {
    const a = new IDBFactory(); const sa = fakeStorage();
    await seedSource(a, sa);
    const cut = fakeNative();
    await migration.runExporter(exporterOptions(a, sa, cut));
    cut.spool.pop(); // the finish message never made it to disk
    await migration.runImporter(importerOptions(new IDBFactory(), fakeStorage(), cut));
    expect(cut.reports[cut.reports.length - 1]).toEqual({ type: 'error', message: 'the spool ended before finish' });

    const native = fakeNative();
    await migration.runExporter(exporterOptions(a, sa, native));
    // A target whose databases cannot be dropped.
    const broken = {
      deleteDatabase() {
        const r = { onerror: null as null | (() => void), onsuccess: null, onblocked: null, error: new Error('disk full') };
        setTimeout(() => r.onerror && r.onerror(), 0);
        return r;
      },
    } as unknown as IDBFactory;
    await migration.runImporter(importerOptions(broken, fakeStorage(), native));
    expect(native.reports[native.reports.length - 1]).toEqual({ type: 'error', message: 'disk full' });
  });
});
