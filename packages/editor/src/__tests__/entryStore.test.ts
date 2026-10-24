import { clear, get, keys, set } from 'idb-keyval';
import type { CommonFormatIssue } from '../formats/editorConfig';
import { type JournalEntryBase, entryImagesBehindPage } from '../store/entryRecord';
import { type EntryStoreOptions, createEntryStore } from '../store/entryStore';
import { registerStoreNamespace } from '../store/storeKeys';

// The ENTRY STORE (store/entryStore.ts): a page's record and its binary
// sidecars, over a MADE-UP app — the way `editorConfig.test` and 6.1's
// `loadPackFonts.test` drive their seams. The record an app files is its
// own, so the store is generic over it (§4.3's answer: a base record plus a
// generic), and what this suite drives is a record with one field of its
// own and settings of its own.
//
// What each app keeps is the half that cannot be made up: its real format
// ids through the always-done rule, its own `createEntry` (the declaration
// that mints the record), its own settings defaults and the games reconcile
// it hands in, and the declarations that read a field this base has not got.
//
// THIS SUITE IS ALSO WHAT TYPECHECKS THE STORE: the root tsconfig excludes
// packages/editor, so ts-jest's diagnostics while a suite loads a module are
// the only check a file here gets (see editorConfig.test.ts).

interface TestEntry extends JournalEntryBase {
  formatId: 'daily' | 'files' | 'scratch';
  /** A field of this app's own, the way each app's record really has some —
   *  so the generic is exercised rather than merely declared. */
  ownThing?: string;
}

interface TestSettings {
  reminderHour: number;
  enabledFormats: string[];
}

const DEFAULTS: TestSettings = { reminderHour: 9, enabledFormats: ['daily'] };
const mergeSettings = (stored: Partial<TestSettings>): TestSettings => ({ ...DEFAULTS, ...stored });

function makeStore(over: Partial<EntryStoreOptions<TestSettings>> = {}) {
  return createEntryStore<TestEntry, TestSettings>({
    alwaysDoneFormats: new Set(['files']),
    mergeSettings,
    ...over,
  });
}

let store = makeStore();

beforeEach(async () => {
  registerStoreNamespace('test');
  await clear();
  store = makeStore();
});

function makeIssue(formatId: TestEntry['formatId'], isoDate: string): CommonFormatIssue {
  return { formatId, isoDate, label: 'Test issue' };
}

function makeEntry(over: Partial<TestEntry> = {}): TestEntry {
  const formatId = over.formatId ?? 'daily';
  const issueDate = over.issueDate ?? '2026-07-28';
  return {
    id: `id_${Math.random().toString(36).slice(2)}`,
    formatId,
    issueDate,
    status: 'done',
    compositionId: null,
    issue: makeIssue(formatId, issueDate),
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  };
}

describe('the keys, which are the app’s namespace and this store’s shape', () => {
  test('a record, its thumb and its index land under the installed word', async () => {
    const thumb = new Uint8Array([137, 80, 78, 71]);
    const entry = makeEntry({ thumbPng: thumb });
    await store.upsertEntry(entry);
    expect(await get<string>(`test:entry:${entry.id}`)).toBeTruthy();
    expect(await get(`test:thumb:${entry.id}`)).toEqual(thumb);
    expect(await get<string>('test:index:daily')).toBe(JSON.stringify([entry.id]));
  });

  test('…and under a DIFFERENT word when a different app installs one', async () => {
    // The whole point of the namespace seam: two apps' pages never share a
    // key. Read through at each use, not captured at load.
    registerStoreNamespace('other');
    const entry = makeEntry();
    await store.upsertEntry(entry);
    expect(await get<string>(`other:entry:${entry.id}`)).toBeTruthy();
    expect(await get<string>(`test:entry:${entry.id}`)).toBeUndefined();
  });

  test('the thumbnail bytes are split out of the JSON', async () => {
    const entry = makeEntry({ thumbPng: new Uint8Array([1, 2]) });
    await store.upsertEntry(entry);
    expect(await get<string>(`test:entry:${entry.id}`)).not.toContain('thumbPng');
    // …and come back on a read, so a caller sees the record it filed.
    expect(await store.getEntry(entry.id)).toEqual(entry);
  });
});

describe('entry CRUD', () => {
  test('a read of a missing id is undefined, not a throw', async () => {
    expect(await store.getEntry('nope')).toBeUndefined();
    expect(await store.getEntryMeta('nope')).toBeUndefined();
  });

  test('getEntryMeta leaves the thumbnail bytes in the store', async () => {
    const entry = makeEntry({ thumbPng: new Uint8Array([9]) });
    await store.upsertEntry(entry);
    expect((await store.getEntryMeta(entry.id))?.thumbPng).toBeUndefined();
    expect((await store.getEntry(entry.id))?.thumbPng).toEqual(new Uint8Array([9]));
  });

  test('the app’s OWN field round-trips, which is what the generic is for', async () => {
    const entry = makeEntry({ ownThing: 'mine' });
    await store.upsertEntry(entry);
    expect((await store.getEntry(entry.id))?.ownThing).toBe('mine');
  });

  test('delete drops the record, its sidecars and its index entry', async () => {
    const entry = makeEntry({ thumbPng: new Uint8Array([1]) });
    await store.upsertEntry(entry);
    await store.setView(entry.id, new Uint8Array([2]));
    await store.deleteEntry(entry.id);
    expect(await store.getEntry(entry.id)).toBeUndefined();
    expect(await get(`test:thumb:${entry.id}`)).toBeUndefined();
    expect(await get(`test:view:${entry.id}`)).toBeUndefined();
    expect(await get<string>('test:index:daily')).toBe('[]');
  });

  test('deleting twice is not an error', async () => {
    const entry = makeEntry();
    await store.upsertEntry(entry);
    await store.deleteEntry(entry.id);
    await expect(store.deleteEntry(entry.id)).resolves.toBeUndefined();
  });

  test('a stale index id is skipped rather than throwing', async () => {
    // The index is best-effort consistent, and every reader tolerates it.
    const entry = makeEntry();
    await store.upsertEntry(entry);
    await set('test:index:daily', JSON.stringify([entry.id, 'ghost']));
    expect((await store.listEntries()).map((e) => e.id)).toEqual([entry.id]);
    expect(await store.listEntryMetas('daily')).toHaveLength(1);
  });

  test('an index that is not an array reads as empty', async () => {
    await set('test:index:daily', '"not an array"');
    expect(await store.listEntryMetas('daily')).toEqual([]);
  });

  test('a write to an entry that is not there throws rather than inventing one', async () => {
    await expect(store.mutateEntry('nope', () => {})).rejects.toThrow(/no entry with id/);
  });
});

describe('listEntries', () => {
  test('sorts by issueDate then id, and hydrates thumbnails', async () => {
    const late = makeEntry({ id: 'id_b', issueDate: '2026-07-29', thumbPng: new Uint8Array([2]) });
    const early = makeEntry({ id: 'id_a', issueDate: '2026-07-28' });
    const sameDay = makeEntry({ id: 'id_c', issueDate: '2026-07-28' });
    for (const e of [late, sameDay, early]) await store.upsertEntry(e);
    const listed = await store.listEntries();
    expect(listed.map((e) => e.id)).toEqual(['id_a', 'id_c', 'id_b']);
    expect(listed[2].thumbPng).toEqual(new Uint8Array([2]));
  });

  test('one index with a formatId, the union of every index without', async () => {
    await store.upsertEntry(makeEntry({ id: 'id_d', formatId: 'daily' }));
    await store.upsertEntry(makeEntry({ id: 'id_f', formatId: 'files' }));
    expect((await store.listEntries({ formatId: 'daily' })).map((e) => e.id)).toEqual(['id_d']);
    expect((await store.listEntries()).map((e) => e.id).sort()).toEqual(['id_d', 'id_f']);
  });

  test('the union skips a format the app says is not listable', async () => {
    // DrawBots' scratch formats: a look page is no file, and is listed only
    // when asked for by name.
    store = makeStore({ listableFormat: (f) => f !== 'scratch' });
    await store.upsertEntry(makeEntry({ id: 'id_d', formatId: 'daily' }));
    await store.upsertEntry(makeEntry({ id: 'id_s', formatId: 'scratch' }));
    expect((await store.listEntries()).map((e) => e.id)).toEqual(['id_d']);
    // …by NAME it is still there, which is the whole point of the rule.
    expect((await store.listEntries({ formatId: 'scratch' })).map((e) => e.id)).toEqual(['id_s']);
  });

  test('the index prefix keeps its colon, so a near-named key is not read', async () => {
    // `test:index:` must not match `test:indexDraft:` — the reason
    // `storeKey` keeps the trailing colon on a scan prefix.
    await store.upsertEntry(makeEntry({ id: 'id_d' }));
    await set('test:indexDraft:daily', JSON.stringify(['ghost']));
    expect((await store.listEntries()).map((e) => e.id)).toEqual(['id_d']);
  });

  test('the from/to bounds are inclusive', async () => {
    for (const d of ['2026-07-27', '2026-07-28', '2026-07-29']) {
      await store.upsertEntry(makeEntry({ id: `id_${d}`, issueDate: d }));
    }
    const listed = await store.listEntries({ from: '2026-07-28', to: '2026-07-29' });
    expect(listed.map((e) => e.issueDate)).toEqual(['2026-07-28', '2026-07-29']);
  });
});

describe('the always-done rule', () => {
  test('a record of such a format reads as done, stamped from its creation', async () => {
    const entry = makeEntry({ formatId: 'files', status: 'in_progress', createdAt: 500 });
    await store.upsertEntry(entry);
    const read = await store.getEntry(entry.id);
    expect(read?.status).toBe('done');
    expect(read?.completedAt).toBe(500);
  });

  test('…and so does what is ON DISK, so the two agree', async () => {
    // Applied on the way IN as well: a record no reader ever honours would
    // otherwise sit there.
    const entry = makeEntry({ formatId: 'files', status: 'new' });
    await store.upsertEntry(entry);
    expect(await get<string>(`test:entry:${entry.id}`)).toContain('"status":"done"');
  });

  test('nothing can put such a page back to work, as a READ sees it', async () => {
    const entry = makeEntry({ formatId: 'files' });
    await store.upsertEntry(entry);
    await store.markNotDone(entry.id);
    expect((await store.getEntry(entry.id))?.status).toBe('done');
    await store.markInProgress(entry.id, 'comp_1');
    expect((await store.getEntry(entry.id))?.status).toBe('done');
  });

  test('…though a WRITE hands back the literal it wrote, not a re-read', async () => {
    // Worth pinning because it is the one place the rule is not applied:
    // `markNotDone` returns the record it just mutated, and what is on disk
    // after it says `in_progress`. Every reader turns that back to `done`,
    // which is what makes the rule "on read rather than on create" — and
    // why a caller must not take a write's answer as the filed state.
    const entry = makeEntry({ formatId: 'files' });
    await store.upsertEntry(entry);
    expect((await store.markNotDone(entry.id)).status).toBe('in_progress');
    expect(await get<string>(`test:entry:${entry.id}`)).toContain('"status":"in_progress"');
    expect((await store.getEntry(entry.id))?.status).toBe('done');
  });

  test('a format the app did NOT name is work in progress like any other', async () => {
    const entry = makeEntry({ formatId: 'daily', status: 'in_progress' });
    await store.upsertEntry(entry);
    expect((await store.getEntry(entry.id))?.status).toBe('in_progress');
  });

  test('the rule is the SET the app handed in, not a word this package knows', async () => {
    store = makeStore({ alwaysDoneFormats: new Set(['daily']) });
    const entry = makeEntry({ formatId: 'daily', status: 'new' });
    await store.upsertEntry(entry);
    expect((await store.getEntry(entry.id))?.status).toBe('done');
    // …and an app with no such formats gets the plain behaviour.
    store = makeStore({ alwaysDoneFormats: new Set() });
    const other = makeEntry({ formatId: 'files', status: 'new' });
    await store.upsertEntry(other);
    expect((await store.getEntry(other.id))?.status).toBe('new');
  });

  test('an already-done record keeps the completion stamp it has', async () => {
    const entry = makeEntry({ formatId: 'files', status: 'done', completedAt: 77 });
    await store.upsertEntry(entry);
    expect((await store.getEntry(entry.id))?.completedAt).toBe(77);
  });
});

describe('status transitions', () => {
  test('first open attaches the composition and moves new → in_progress', async () => {
    const entry = makeEntry({ status: 'new' });
    await store.upsertEntry(entry);
    const open = await store.markInProgress(entry.id, 'comp_1');
    expect(open.status).toBe('in_progress');
    expect(open.compositionId).toBe('comp_1');
  });

  test('a done entry keeps its status when reopened', async () => {
    const entry = makeEntry({ status: 'done', completedAt: 5 });
    await store.upsertEntry(entry);
    expect((await store.markInProgress(entry.id, 'comp_1')).status).toBe('done');
  });

  test('a re-open that changes nothing writes nothing, and leaves the stamp', async () => {
    // Opening a page is not an edit: otherwise every open read as one to a
    // sharing uploader, and a page merely looked at shipped again.
    const entry = makeEntry({ status: 'in_progress', compositionId: 'comp_1', updatedAt: 1000 });
    await store.upsertEntry(entry);
    expect((await store.markInProgress(entry.id, 'comp_1')).updatedAt).toBe(1000);
  });

  test('markDone stamps once; markNotDone drops the stamp', async () => {
    const entry = makeEntry({ status: 'in_progress' });
    await store.upsertEntry(entry);
    const done = await store.markDone(entry.id);
    expect(done.status).toBe('done');
    expect(done.completedAt).toBeGreaterThan(0);
    const again = await store.markDone(entry.id);
    expect(again.completedAt).toBe(done.completedAt);
    const undone = await store.markNotDone(entry.id);
    expect(undone.status).toBe('in_progress');
    expect(undone.completedAt).toBeUndefined();
  });

  test('the issue can be re-frozen as an edit, or corrected without one', async () => {
    const entry = makeEntry({ updatedAt: 1000 });
    await store.upsertEntry(entry);
    const edited = await store.setEntryIssue(entry.id, makeIssue('daily', '2026-08-01'));
    expect(edited.issue.isoDate).toBe('2026-08-01');
    expect(edited.updatedAt).toBeGreaterThan(1000);
    const stamp = edited.updatedAt;
    const corrected = await store.correctEntryIssue(entry.id, makeIssue('daily', '2026-08-02'));
    expect(corrected.issue.isoDate).toBe('2026-08-02');
    expect(corrected.updatedAt).toBe(stamp);
  });
});

describe('the images, and the stamp they move', () => {
  test('setThumb records the aspect, the top luma and the white strokes', async () => {
    const entry = makeEntry();
    await store.upsertEntry(entry);
    await store.setThumb(entry.id, new Uint8Array([1]), 0.75, {}, 120, true);
    const read = (await store.getEntryMeta(entry.id))!;
    expect(read.thumbAspect).toBe(0.75);
    expect(read.thumbTopLuma).toBe(120);
    expect(read.whiteStrokes).toBe(true);
  });

  test('…and CLEARS the luma when this run could not measure it', async () => {
    // A stale brightness off the page's last picture would ink the label
    // against the one before it — confidently wrong, which is worse than
    // the fallback.
    const entry = makeEntry();
    await store.upsertEntry(entry);
    await store.setThumb(entry.id, new Uint8Array([1]), undefined, {}, 120, true);
    await store.setThumb(entry.id, new Uint8Array([2]));
    const read = (await store.getEntryMeta(entry.id))!;
    expect(read.thumbTopLuma).toBeUndefined();
    expect(read.whiteStrokes).toBeUndefined();
  });

  test('an image write IS the page’s edit stamp, unless it says it is a redraw', async () => {
    const entry = makeEntry({ updatedAt: 1000 });
    await store.upsertEntry(entry);
    await store.setThumb(entry.id, new Uint8Array([1]));
    const edited = (await store.getEntryMeta(entry.id))!.updatedAt;
    expect(edited).toBeGreaterThan(1000);
    await store.setThumb(entry.id, new Uint8Array([2]), undefined, { keepStamp: true });
    expect((await store.getEntryMeta(entry.id))!.updatedAt).toBe(edited);
    await store.setView(entry.id, new Uint8Array([3]), { keepStamp: true });
    expect((await store.getEntryMeta(entry.id))!.updatedAt).toBe(edited);
  });

  test('setView / getView round-trip, and a missing view is undefined', async () => {
    const entry = makeEntry();
    await store.upsertEntry(entry);
    expect(await store.getView(entry.id)).toBeUndefined();
    await store.setView(entry.id, new Uint8Array([4, 5]));
    expect(await store.getView(entry.id)).toEqual(new Uint8Array([4, 5]));
  });

  test('clearEntryImages drops every sidecar and leaves the record', async () => {
    store = makeStore({ sidecars: ['today', 'reveal'] });
    const entry = makeEntry();
    await store.upsertEntry(entry);
    await store.setThumb(entry.id, new Uint8Array([1]));
    await store.setView(entry.id, new Uint8Array([2]));
    await set(store.sidecarKey('today', entry.id), new Uint8Array([3]));
    await set(store.sidecarKey('reveal', entry.id), new Uint8Array([4]));
    await store.clearEntryImages(entry.id);
    for (const k of ['thumb', 'view', 'today', 'reveal']) {
      expect(await get(`test:${k}:${entry.id}`)).toBeUndefined();
    }
    expect(await store.getEntryMeta(entry.id)).toBeTruthy();
  });

  test('an app that declares no extra sidecar drops only the two', async () => {
    const entry = makeEntry();
    await store.upsertEntry(entry);
    await set('test:today:' + entry.id, new Uint8Array([3]));
    await store.clearEntryImages(entry.id);
    // Not this store's to delete: the app never told it about the key.
    expect(await get(`test:today:${entry.id}`)).toEqual(new Uint8Array([3]));
  });

  test('sidecarPresence answers for every kind off ONE key listing', async () => {
    store = makeStore({ sidecars: ['today'] });
    const a = makeEntry({ id: 'id_a' });
    const b = makeEntry({ id: 'id_b' });
    await store.upsertEntry(a);
    await store.upsertEntry(b);
    await store.setThumb(a.id, new Uint8Array([1]));
    await store.setView(a.id, new Uint8Array([2]));
    await set(store.sidecarKey('today', b.id), new Uint8Array([3]));
    const has = await store.sidecarPresence();
    expect(has('thumb', 'id_a')).toBe(true);
    expect(has('view', 'id_a')).toBe(true);
    expect(has('today', 'id_a')).toBe(false);
    expect(has('thumb', 'id_b')).toBe(false);
    expect(has('today', 'id_b')).toBe(true);
  });

  test('the freshness stamps are bookkeeping, never an edit', async () => {
    const entry = makeEntry({ updatedAt: 1000 });
    await store.upsertEntry(entry);
    await store.markPageSaved(entry.id, 2000);
    await store.markEntryImagesDrawn(entry.id, 1500, 7);
    const read = (await store.getEntryMeta(entry.id))!;
    expect(read.pageSavedAt).toBe(2000);
    expect(read.imagesAt).toBe(1500);
    expect(read.imagesRecipe).toBe(7);
    expect(read.updatedAt).toBe(1000);
    // …and the two together answer "are the images behind the page?"
    expect(entryImagesBehindPage(read)).toBe(true);
  });

  test('a page with no record has nothing to stamp, and does not throw', async () => {
    // Bookkeeping must never be the reason a save fails — the editor's own
    // scratch composition has no entry at all.
    await expect(store.markPageSaved('nope')).resolves.toBeUndefined();
    await expect(store.markEntryImagesDrawn('nope', 1, 1)).resolves.toBeUndefined();
  });
});

describe('getEntryByFormatAndDate', () => {
  test('finds the day’s entry', async () => {
    const entry = makeEntry({ issueDate: '2026-07-28' });
    await store.upsertEntry(entry);
    expect((await store.getEntryByFormatAndDate('daily', '2026-07-28'))?.id).toBe(entry.id);
    expect(await store.getEntryByFormatAndDate('daily', '2026-07-29')).toBeUndefined();
  });

  test('skips an IMPORTED page, which owns no calendar slot', async () => {
    // Archive material: returning one here would hand lazy entry creation
    // the import instead of the user's real page for that day.
    const real = makeEntry({ id: 'id_real', issueDate: '2026-07-28' });
    const imported = makeEntry({ id: 'id_imp', issueDate: '2026-07-28', imported: true });
    await store.upsertEntry(imported);
    await store.upsertEntry(real);
    expect((await store.getEntryByFormatAndDate('daily', '2026-07-28'))?.id).toBe('id_real');
    // …and with only the import there, the day has no entry.
    await store.deleteEntry('id_real');
    expect(await store.getEntryByFormatAndDate('daily', '2026-07-28')).toBeUndefined();
    // It is still LISTED, though: an archive copy shows in the home feed.
    expect((await store.listEntries()).map((e) => e.id)).toEqual(['id_imp']);
  });

  test('…and an UNLISTED one, for an app whose record has that field', async () => {
    // `isIssuedEntry` is typed structurally, so it reads a field this base
    // has not got on the records of the apps that do.
    const unlisted = { ...makeEntry({ id: 'id_un' }), unlisted: true } as TestEntry;
    await store.upsertEntry(unlisted);
    expect(await store.getEntryByFormatAndDate('daily', '2026-07-28')).toBeUndefined();
  });
});

describe('settings', () => {
  test('a stored partial is merged over the app’s defaults', async () => {
    expect(await store.getSettings()).toEqual(DEFAULTS);
    await store.updateSettings({ reminderHour: 20 });
    expect(await store.getSettings()).toEqual({ ...DEFAULTS, reminderHour: 20 });
  });

  test('only user-touched fields are persisted, never the merged defaults', async () => {
    // Otherwise a later change to the app's defaults would be frozen out
    // for anyone who ever changed any setting.
    await store.updateSettings({ reminderHour: 20 });
    expect(await get<string>('test:settings')).toBe('{"reminderHour":20}');
  });

  test('a write with no `combineSettings` is the stored partial plus the patch', async () => {
    await store.updateSettings({ reminderHour: 20 });
    await store.updateSettings({ enabledFormats: ['files'] });
    expect(JSON.parse((await get<string>('test:settings'))!))
      .toEqual({ reminderHour: 20, enabledFormats: ['files'] });
  });

  test('…and with one, the app decides what a write stores', async () => {
    // CozyJournal's and DrawBots' games list is reconciled against the
    // formats the build offers before the patch lands.
    store = makeStore({
      combineSettings: (stored, patch) => ({ ...stored, ...patch, reminderHour: 3 }),
    });
    await store.updateSettings({ enabledFormats: ['files'] });
    expect(await store.getSettings()).toEqual({ reminderHour: 3, enabledFormats: ['files'] });
  });

  test('settings and entries do not share a key', async () => {
    await store.updateSettings({ reminderHour: 20 });
    const stored = (await keys()).filter((k): k is string => typeof k === 'string');
    expect(stored).toEqual(['test:settings']);
  });
});

describe('what an app’s own declarations build on', () => {
  test('asRead gives the record as a read would, which is what createEntry needs', () => {
    const entry = makeEntry({ formatId: 'files', status: 'new', createdAt: 42 });
    expect(store.asRead(entry)).toMatchObject({ status: 'done', completedAt: 42 });
    // …and leaves a record the rule does not touch exactly alone.
    const plain = makeEntry({ formatId: 'daily', status: 'new' });
    expect(store.asRead(plain)).toBe(plain);
  });

  test('mutateEntry moves the stamp, patchEntryMeta does not', async () => {
    const entry = makeEntry({ updatedAt: 1000 });
    await store.upsertEntry(entry);
    expect((await store.patchEntryMeta(entry.id, (e) => { e.ownThing = 'a'; })).updatedAt).toBe(1000);
    expect((await store.mutateEntry(entry.id, (e) => { e.ownThing = 'b'; })).updatedAt)
      .toBeGreaterThan(1000);
    expect((await store.getEntryMeta(entry.id))?.ownThing).toBe('b');
  });

  test('writeImageMeta is an edit by default and a plain rewrite on request', async () => {
    const entry = makeEntry({ updatedAt: 1000 });
    await store.upsertEntry(entry);
    const edited = (await store.writeImageMeta(entry.id, () => {}, {})).updatedAt;
    expect(edited).toBeGreaterThan(1000);
    expect((await store.writeImageMeta(entry.id, () => {}, { keepStamp: true })).updatedAt)
      .toBe(edited);
  });

  test('readEntryMeta is the one read funnel, so an app’s own read sees the rule too', async () => {
    const entry = makeEntry({ formatId: 'files', status: 'new' });
    await store.upsertEntry(entry);
    expect((await store.readEntryMeta(entry.id))?.status).toBe('done');
  });

  test('sidecarKey is the app’s own key under the app’s own namespace', () => {
    expect(store.sidecarKey('today', 'id_a')).toBe('test:today:id_a');
    registerStoreNamespace('other');
    expect(store.sidecarKey('today', 'id_a')).toBe('other:today:id_a');
  });
});
