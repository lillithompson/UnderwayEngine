import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

// The copy of one origin's saved work to another (modules/static-server/
// web/originMigration.js), the piece of the port move that decides whether
// an install keeps its journal. Driven here over fake-indexeddb — two
// factories stand for the two origins — and stand-in windows for the
// postMessage glue; the real pages are the Swift module's
// (StaticServerModule.swift `adoptLegacyOrigin`).

/* eslint-disable @typescript-eslint/no-var-requires */
// A plain script, not a module: it embeds in Swift as it is.
const migration = require('../../../modules/static-server/web/originMigration.js') as {
  exportOrigin: (idb: IDBFactory, storage: StorageLike | null, send: (m: Message) => Promise<unknown>, options?: { pageSize?: number }) => Promise<Totals>;
  createImporter: (idb: IDBFactory, storage: StorageLike | null) => { handle: (m: Message) => Promise<unknown> };
  readSchema: (db: IDBDatabase) => Schema;
  runParent: (options: ParentOptions) => Promise<void>;
  runChild: (options: ChildOptions) => void;
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
interface FakeWindow {
  addEventListener(type: 'message', fn: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', fn: (event: MessageEvent) => void): void;
  postMessage(data: unknown, targetOrigin: string): void;
}
interface ParentOptions {
  idb: IDBFactory | null;
  storage: StorageLike | null;
  origin: string;
  expectedOrigin: string;
  childUrl: string;
  childOrigin: string;
  document: { createElement(tag: string): FakeIframe; body: { appendChild(el: FakeIframe): void } };
  window: FakeWindow;
  report: (m: Message) => void;
  pageSize?: number;
}
interface ChildOptions {
  idb: IDBFactory | null;
  storage: StorageLike | null;
  parentOrigin: string;
  window: FakeWindow;
  parent: { postMessage(data: unknown, targetOrigin: string): void };
}
interface FakeIframe {
  contentWindow: FakeWindow | null;
  style: Record<string, string>;
  setAttribute(name: string, value: string): void;
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
      data[store.name] = keys.map((k, i) => [k, values[i]]);
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

/** The whole copy, source to target, through the importer directly. */
function copy(source: IDBFactory, sourceStorage: StorageLike, target: IDBFactory, targetStorage: StorageLike, options?: { pageSize?: number; tap?: (m: Message) => Message }) {
  const importer = migration.createImporter(target, targetStorage);
  const messages: Message[] = [];
  const send = (m: Message) => {
    messages.push(m);
    return importer.handle(options?.tap ? options.tap(m) : m);
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
    expect(thumb[1]).toEqual(bytes(0x89, 0x50, 0x4e, 0x47, 1, 2, 3));
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
    const a = new IDBFactory(); const b = new IDBFactory();
    await seedSource(a, fakeStorage());
    const { messages } = await copy(a, fakeStorage(), b, fakeStorage(), { pageSize: 2 });
    const pages = messages.filter((m) => m.type === 'records' && m.store === 'rows') as unknown as Array<{ keys: number[] }>;
    // 2, then 4 (small records double the page), then the last 1.
    expect(pages.map((p) => p.keys.length)).toEqual([2, 4, 1]);
    expect(pages.flatMap((p) => p.keys)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // An empty store sends no page, and a database with none of its own
    // stores still arrives.
    expect(messages.some((m) => m.type === 'records' && m.store === 'empty')).toBe(false);
    expect(messages.filter((m) => m.type === 'database').length).toBe(2);
    expect(messages.map((m) => m.type).slice(-2)).toEqual(['localStorage', 'finish']);
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

// Two stand-in windows wired as a parent and its iframe: postMessage
// delivers asynchronously, stamped with the sender's origin.
function pairWindows(parentOrigin: string, childOrigin: string) {
  type Listener = (event: MessageEvent) => void;
  function makeWindow(origin: string) {
    const listeners = new Set<Listener>();
    const w = {
      origin,
      peer: null as unknown as { deliver(data: unknown, from: string, source: unknown): void; origin: string },
      listeners,
      addEventListener(_: 'message', fn: Listener) { listeners.add(fn); },
      removeEventListener(_: 'message', fn: Listener) { listeners.delete(fn); },
      // As the browser does: a message posted to this window reaches this
      // window's listeners, from the other window, if the target origin is
      // this window's.
      postMessage(data: unknown, targetOrigin: string) {
        if (targetOrigin !== '*' && targetOrigin !== origin) return;
        const snapshot = structuredClone(data);
        setTimeout(() => w.deliver(snapshot, w.peer.origin, w.peer), 0);
      },
      deliver(data: unknown, from: string, source: unknown) {
        for (const fn of Array.from(listeners)) fn({ data, origin: from, source } as unknown as MessageEvent);
      },
    };
    return w;
  }
  const parent = makeWindow(parentOrigin);
  const child = makeWindow(childOrigin);
  parent.peer = child;
  child.peer = parent;
  return { parent, child };
}

describe('originMigration: the two pages', () => {
  const OLD = 'http://localhost:18730';
  const NEW = 'http://localhost:18750';

  function parentOptions(windows: ReturnType<typeof pairWindows>, a: IDBFactory, sa: StorageLike, b: IDBFactory, sb: StorageLike, report: (m: Message) => void, origin = OLD): ParentOptions {
    const iframe: FakeIframe = {
      contentWindow: null,
      style: {},
      setAttribute(name, value) {
        expect(name).toBe('src');
        expect(value).toBe(`${NEW}/__underway/origin-migration`);
      },
    };
    return {
      idb: a, storage: sa, origin, expectedOrigin: OLD,
      childUrl: `${NEW}/__underway/origin-migration`, childOrigin: NEW,
      document: {
        createElement(tag) { expect(tag).toBe('iframe'); return iframe; },
        body: {
          appendChild(el) {
            expect(el).toBe(iframe);
            // The iframe "loads": the child page starts on the new origin.
            iframe.contentWindow = windows.child;
            setTimeout(() => migration.runChild({ idb: b, storage: sb, parentOrigin: OLD, window: windows.child, parent: windows.parent }), 0);
          },
        },
      },
      window: windows.parent,
      report,
      pageSize: 2,
    };
  }

  it('exports through the iframe and reports progress, then done with the totals', async () => {
    const a = new IDBFactory(); const sa = fakeStorage();
    const b = new IDBFactory(); const sb = fakeStorage();
    await seedSource(a, sa);
    const reports: Message[] = [];
    await migration.runParent(parentOptions(pairWindows(OLD, NEW), a, sa, b, sb, (m) => reports.push(m)));

    expect(reports[reports.length - 1]).toEqual({ type: 'done', databases: 2, records: 16, localStorage: 3 });
    const progress = reports.filter((m) => m.type === 'progress').map((m) => m.records);
    expect(progress[progress.length - 1]).toBe(16);
    expect(progress).toEqual([...progress].sort((x, y) => (x as number) - (y as number)));
    expect(await dump(b)).toEqual(await dump(a));
    expect(sb.getItem('editor:theme')).toBe('dark');
  });

  it('reports an error and touches nothing when the page did not get the old origin', async () => {
    const a = new IDBFactory(); const b = new IDBFactory();
    await seedSource(a, fakeStorage());
    const reports: Message[] = [];
    const windows = pairWindows('about:blank', NEW);
    const options = parentOptions(windows, a, fakeStorage(), b, fakeStorage(), (m) => reports.push(m), 'null');
    options.document.createElement = () => { throw new Error('no iframe should be made'); };
    await migration.runParent(options);
    expect(reports).toEqual([{ type: 'error', message: `origin mismatch: this page is null, expected ${OLD}` }]);
    expect(await b.databases()).toEqual([]);
  });

  it('reports the importer\'s failure as an error', async () => {
    const a = new IDBFactory(); const sa = fakeStorage();
    await seedSource(a, sa);
    const reports: Message[] = [];
    const windows = pairWindows(OLD, NEW);
    // A target whose databases cannot be dropped.
    const broken = {
      deleteDatabase() {
        const r = { onerror: null as null | (() => void), onsuccess: null, onblocked: null, error: new Error('disk full') };
        setTimeout(() => r.onerror && r.onerror(), 0);
        return r;
      },
    } as unknown as IDBFactory;
    await migration.runParent(parentOptions(windows, a, sa, broken, fakeStorage(), (m) => reports.push(m)));
    expect(reports).toEqual([{ type: 'error', message: 'disk full' }]);
  });

  it('hears only the other page\'s origin, on both sides', async () => {
    const a = new IDBFactory(); const sa = fakeStorage();
    const b = new IDBFactory(); const sb = fakeStorage();
    await seedSource(a, sa);
    const windows = pairWindows(OLD, NEW);
    // An intruder on the child's listeners: an ack for a message never sent,
    // from a third origin, and a records message to the child from a
    // third origin. Neither must be acted on.
    const reports: Message[] = [];
    const run = migration.runParent(parentOptions(windows, a, sa, b, sb, (m) => reports.push(m)));
    await new Promise((r) => setTimeout(r, 5));
    windows.parent.deliver({ type: 'fail', id: 1, message: 'forged' }, 'http://evil.example', windows.child);
    windows.child.deliver({ type: 'database', id: 999, schema: { name: 'forged', version: 1, stores: [] } }, 'http://evil.example', windows.parent);
    await run;
    expect(reports[reports.length - 1].type).toBe('done');
    expect((await b.databases()).map((d) => d.name).sort()).toEqual(['entries', 'keyval-store']);
  });
});
