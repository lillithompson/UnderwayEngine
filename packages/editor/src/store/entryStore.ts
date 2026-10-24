import { del, get, keys, set } from 'idb-keyval';
import type { CommonFormatIssue } from '../formats/editorConfig';
import { type JournalEntryBase, isIssuedEntry } from './entryRecord';
import { storeKey } from './storeKeys';

// The ENTRY STORE: a page's record and its binary sidecars, in IndexedDB
// beside the engine's composition storage so one export path covers
// everything. Conventions mirror the engine's `persistence.ts`: JSON-string
// values under namespaced keys, with binary payloads split into their own
// keys (comp_meta_/comp_thumb_ → `<app>:entry:`/`<app>:thumb:`) so the JSON
// stays small and structured-clone quirks never touch the metadata.
//
// Keys, under the app's own namespace (`store/storeKeys.ts`):
//   <app>:entry:<id>       JSON entry record (sans thumbPng)
//   <app>:thumb:<id>       Uint8Array PNG or JPEG (~300 px card thumbnail)
//   <app>:view:<id>        Uint8Array PNG or JPEG (1080–2160 px view image)
//   <app>:index:<formatId> JSON string[] of entry ids for that format
//   <app>:settings         JSON partial settings (merged over defaults on read)
// …plus whatever extra sidecars the app declares (see
// `EntryStoreOptions.sidecars` — CozyJournal's Today cutout and seed reveal).
//
// The per-format index exists so `listEntries` never scans every IDB key. It
// is best-effort consistent: create/delete keep it in sync, and every reader
// tolerates a stale index by skipping ids whose entry is missing.
//
// WHY A FACTORY RATHER THAN A MODULE OF FUNCTIONS. The record an app files
// is its own — 27 fields in CozyJournal, 26 in DrawBots, 18 in Sol — and the
// owner settled how the shared store carries it (docs/shared-editor.md §4.3,
// asked at 6.2b's measurement): a BASE RECORD plus a generic.
// `JournalEntryBase` is the 18 fields all three declared, and this store is
// generic over the app's own type, so every read hands that type back and
// every write takes it. A module of free generic functions would make each
// of the 95 call sites across the three apps name the type; a factory names
// it ONCE, in each app's own `web/store/entryStore.ts`, which re-exports the
// members under the names its callers have always imported.
//
// Of the 41 declarations all three apps had, 35 are here and five became
// `storeKey()` calls — the prefixes 6.2a promised would. Four more were held
// by two of the three apps, byte-identical in both.
//
// FOUR declarations stay each app's, three of them for one reason: a
// declaration that reads a field outside this base cannot be generic over
// it. `createEntry` is the one §4.3 names (`pageId`, `unlisted`);
// `setEntrySeededFills` and `setEntryTitle` are the other two, and that
// answer missed them because it was taken over the 41 declarations ALL
// THREE apps had and these two are in only CozyJournal's and DrawBots'.
// `createEntryIfMissing` is the fourth and its reason is different: it
// reads no field of its own, it CALLS `createEntry`. All four are a handful
// of lines over `patchEntryMeta`, `mutateEntry`, `readEntryMeta`,
// `upsertEntry` and `asRead`, which this store exposes for exactly that.

/** Extra binary sidecars an app keys by entry id, beyond the thumb and the
 *  view this store keeps itself. Named in the options so `clearEntryImages`
 *  drops them with the rest and `sidecarPresence` can be asked about them —
 *  CozyJournal's are `todayThumb` and `reveal`. */
export type SidecarKind = string;

export interface EntryStoreOptions<TSettings> {
  /**
   * The app's format ids whose pages are NEVER work in progress — one with
   * no way to say "I'm Done", so a page of it is read as done the moment it
   * exists (every Sol canvas, whose bandless page carries no info page to
   * press Done on).
   *
   * Handed in rather than read off `formats/formatIds`' installed set, and
   * REQUIRED, which is the one place in this plan where that distinction has
   * teeth. An install that had not run yet would make this store file a page
   * `new` that every reader should see as `done` — silently, in the user's
   * data — and 6.2b found exactly that: a suite importing only TYPES from
   * the app's `web/formats/types` never loads it, so the install never ran.
   * A required option is checked by the compiler instead of by a convention.
   */
  readonly alwaysDoneFormats: ReadonlySet<string>;
  /** @see SidecarKind */
  readonly sidecars?: readonly SidecarKind[];
  /**
   * The app's own merge of a stored settings PARTIAL over its defaults, so
   * new settings fields pick up their defaults on old installs without a
   * migration. Required: the defaults are the app's and this store has no
   * way to guess them.
   */
  readonly mergeSettings: (stored: Partial<TSettings>) => TSettings;
  /**
   * What a settings WRITE stores, given what was stored and the patch.
   * `{ ...stored, ...patch }` when absent, which is the whole of it for an
   * app whose settings are independent fields (Sol's).
   *
   * It exists because CozyJournal's and DrawBots' are not: their games list
   * is reconciled against the formats the build offers before the patch
   * lands, and the record of what was on offer is only ever stamped
   * together with the list it describes. That is a fact about those apps'
   * format sets, so it is installed rather than lived here.
   */
  readonly combineSettings?: (
    stored: Partial<TSettings>, patch: Partial<TSettings>,
  ) => Partial<TSettings>;
  /**
   * Whether a format's index belongs in the union `listEntries` reads when
   * no format is named. True for every format when absent.
   *
   * DrawBots' SCRATCH formats are the reason: a look page is no file, and is
   * listed only when asked for by name.
   */
  readonly listableFormat?: (formatId: string) => boolean;
}

export interface EntryFilter {
  /** The app's own format id. `string` here, as every id this package takes
   *  IN is — §4.3's `ToolId` decision. */
  formatId?: string;
  /** Inclusive 'YYYY-MM-DD' issueDate bounds. */
  from?: string;
  to?: string;
}

/**
 * How an image write treats the entry's edit stamp.
 *
 * The images a save writes ARE the page's stamp (see `mutateEntry` below),
 * so every write that is a REDRAW of a page nobody changed has to say so: a
 * backfill catching an old page up, or an editor session that only looked at
 * one. Without it the page reads as edited and floats to the top of the home
 * list, which orders by that stamp.
 */
export interface ImageWriteOptions {
  /** The write is a redraw of the same page, not an edit: `updatedAt` stays
   *  where the last real edit put it. */
  keepStamp?: boolean;
}

/**
 * The store, over the app's own entry record and settings type. Built by
 * {@link createEntryStore}; each app's `web/store/entryStore.ts` builds one
 * and re-exports its members.
 */
export interface EntryStore<TEntry extends JournalEntryBase, TSettings> {
  // ── reads ─────────────────────────────────────────────────────────────
  /** A format's entries WITHOUT their thumbnail bytes — for a caller that
   *  reads only the bookkeeping, where `listEntries` would hydrate a PNG per
   *  page to read an id. */
  listEntryMetas(formatId: string): Promise<TEntry[]>;
  getEntry(id: string): Promise<TEntry | undefined>;
  /** The entry's record WITHOUT its thumbnail bytes — for a caller that only
   *  wants the bookkeeping (the image stamps below), where hydrating a
   *  ~300 px PNG out of IndexedDB to read a number is the whole cost. */
  getEntryMeta(id: string): Promise<TEntry | undefined>;
  /**
   * The entry the app issued for (formatId, isoDate), if it exists.
   *
   * Imported pages are skipped even when they share the date: they are
   * archive copies, and returning one here would hand `createEntryIfMissing`
   * the import instead of the user's real page for that day.
   */
  getEntryByFormatAndDate(formatId: string, isoDate: string): Promise<TEntry | undefined>;
  /**
   * List entries, sorted by issueDate then id (both ISO/ULID, so plain
   * string compare is chronological). With a formatId filter this reads one
   * index; without, it unions every `<app>:index:` key found via keys() —
   * still no full entry scan, and without a format the app says is not
   * listable (`listableFormat`). Thumbnails are hydrated (the callers are
   * the home and library card grids, which need them anyway).
   */
  listEntries(filter?: EntryFilter): Promise<TEntry[]>;
  /** Which cached images exist, without reading a byte of them: ONE key
   *  listing answers for every entry, so a home-state push can decide which
   *  slots to list and read only the images it has to send — and the editor
   *  can ask whether a page it is closing already has the lot, for the same
   *  one listing. */
  sidecarPresence(): Promise<(kind: SidecarKind, id: string) => boolean>;
  /** Load the full-screen view image bytes for one entry, or undefined when
   *  the entry has none (never rasterized, or an older PNG-only entry). */
  getView(id: string): Promise<Uint8Array | undefined>;

  // ── writes ────────────────────────────────────────────────────────────
  /**
   * Persist an entry verbatim (timestamps are the caller's responsibility;
   * the mark* helpers bump them). `thumbPng`, when present, is written to
   * its binary sidecar key; when absent, any existing thumbnail is left
   * untouched (`setThumb` is the thumbnail write path). Keeps the per-format
   * index consistent.
   */
  upsertEntry(entry: TEntry): Promise<void>;
  deleteEntry(id: string): Promise<void>;
  /**
   * Record first open: attach the engine composition and move 'new' →
   * 'in_progress'. A 'done' entry keeps its status (re-opening a finished
   * entry to keep editing never un-completes it).
   */
  markInProgress(id: string, compositionId: string): Promise<TEntry>;
  /**
   * Record that the page's drawn CONTENT was just written (`pageSavedAt`).
   * Called by the editor's save queue only for a write that changed the
   * picture — a camera move persists in the same record and leaves the
   * images correct, so stamping it would make the editor redraw them for a
   * pan.
   *
   * A page with no entry record (the editor's own scratch composition)
   * simply has nothing to stamp: bookkeeping must never be the reason a
   * save fails.
   */
  markPageSaved(id: string, at?: number): Promise<void>;
  /**
   * Record that the entry's FULL image set was drawn from the page as it
   * stood at `at` (`imagesAt` / `imagesRecipe`). `at` is the time taken
   * BEFORE the exports ran, so an edit saved while they were drawing stamps
   * later and the next run still redraws.
   */
  markEntryImagesDrawn(id: string, at: number, recipe: number): Promise<void>;
  /** Re-freeze the entry's issue. The issue is otherwise written once (at
   *  create) and never touched; the one thing that may change it is an info
   *  modal's "new prompt", which swaps the day's subject and must stick
   *  across reloads. */
  setEntryIssue(id: string, issue: CommonFormatIssue): Promise<TEntry>;
  /**
   * Re-freeze the entry's issue WITHOUT moving `updatedAt`: a correction of
   * what the page was issued under (a page brought onto a week's schedule),
   * not an edit of the page. The stamp is what a sharing upload and the
   * image windows read as "the user touched this", and a relabel touched
   * nothing.
   */
  correctEntryIssue(id: string, issue: CommonFormatIssue): Promise<TEntry>;
  markDone(id: string): Promise<TEntry>;
  /** The un-done half of an info page's "I'm Done" toggle: back to
   *  'in_progress', the completion stamp dropped so a later re-mark stamps
   *  afresh. Done is the user's own declaration, so it must be theirs to
   *  take back. */
  markNotDone(id: string): Promise<TEntry>;
  /** Cache the card thumbnail (rasterized on editor close, off the frame
   *  path). `aspect` (width/height) is recorded onto the entry for a
   *  content-framed export whose ratio is per-entry; omit it for
   *  page-framed formats. `topLuma` is how bright the top of that thumbnail
   *  is, measured from the very bytes passed here. `whiteStrokes` says the
   *  page strokes white. See {@link ImageWriteOptions} for `keepStamp`. */
  setThumb(
    id: string, png: Uint8Array, aspect?: number, opts?: ImageWriteOptions,
    topLuma?: number, whiteStrokes?: boolean,
  ): Promise<void>;
  /** Cache the full-screen view image — larger than the card thumbnail, PNG
   *  or JPEG by its own pixels, rasterized on editor close. Loaded on demand
   *  (not hydrated onto every entry) and shipped over the bridge only for
   *  recent entries, so it never bloats the card-grid list or the batched
   *  home payload. */
  setView(id: string, bytes: Uint8Array, opts?: ImageWriteOptions): Promise<void>;
  /**
   * Drop every cached image for an entry — the card thumb, the view image
   * and every sidecar the app declared — leaving the entry and its
   * composition alone.
   *
   * The counterpart of the raster pass: the editor calls this instead when
   * the page closes UNINITIALIZED (nothing the user made —
   * `formats/edited`), which is also how a page that is edited, saved, then
   * undone back to blank loses the stale picture of marks it no longer
   * holds. Without images the entry drops out of the home feed — exactly an
   * unopened page.
   */
  clearEntryImages(id: string): Promise<void>;

  // ── settings ──────────────────────────────────────────────────────────
  /** Stored as a partial and merged over the app's defaults so new settings
   *  fields pick up their defaults on old installs without a migration. */
  getSettings(): Promise<TSettings>;
  updateSettings(patch: Partial<TSettings>): Promise<TSettings>;

  // ── what an app's own declarations build on ────────────────────────────
  /** The record as a READ would give it back — the always-done rule
   *  applied. For an app's own `createEntry`, which mints the literal, files
   *  it through {@link upsertEntry}, and must hand the caller what a reader
   *  would see rather than the literal. */
  asRead(entry: TEntry): TEntry;
  /** Rewrite an entry's record as an EDIT: `updatedAt` moves to now. For an
   *  app's own declaration over a field of its own. Throws when the entry
   *  does not exist. */
  mutateEntry(id: string, mutate: (entry: TEntry) => void): Promise<TEntry>;
  /** …and the same write WITHOUT touching the edit stamp, for a write that
   *  is not an edit (a redrawn image, a bookkeeping field). */
  patchEntryMeta(id: string, mutate: (entry: TEntry) => void): Promise<TEntry>;
  /** …and the one an IMAGE write makes: an edit by default, a plain rewrite
   *  when the caller says the page itself is unchanged. For an app that
   *  keeps a sidecar of its own ({@link EntryStoreOptions.sidecars}) and
   *  must treat its stamp the way `setThumb` and `setView` treat theirs. */
  writeImageMeta(
    id: string, mutate: (entry: TEntry) => void, opts: ImageWriteOptions,
  ): Promise<TEntry>;
  /** Load the JSON metadata record only, through the one read funnel — so an
   *  app's own declaration sees the always-done rule like every other
   *  read. */
  readEntryMeta(id: string): Promise<TEntry | undefined>;
  /** The key a binary sidecar of `kind` lives under, for an app that keeps
   *  one of its own (see {@link EntryStoreOptions.sidecars}). */
  sidecarKey(kind: SidecarKind, id: string): string;
}

/**
 * Build the store over an app's own entry record and settings type. Called
 * once, from the app's `web/store/entryStore.ts`:
 *
 * ```ts
 * const store = createEntryStore<JournalEntry, AppSettings>({ mergeSettings });
 * export const { getEntry, listEntries, upsertEntry, … } = store;
 * ```
 */
export function createEntryStore<TEntry extends JournalEntryBase, TSettings>(
  options: EntryStoreOptions<TSettings>,
): EntryStore<TEntry, TSettings> {
  const {
    alwaysDoneFormats, mergeSettings, combineSettings, listableFormat, sidecars = [],
  } = options;

  // Keys are READ THROUGH the namespace at each use rather than captured
  // into module constants: the app's `registerStoreNamespace` and this
  // module's load are both module-scope effects and their order is the
  // bundler's, and `assetJanitor` already reads its stamp's key this way.
  const entryKey = (id: string) => storeKey('entry', id);
  const thumbKey = (id: string) => storeKey('thumb', id);
  const viewKey = (id: string) => storeKey('view', id);
  const indexKey = (formatId: string) => storeKey('index', formatId);
  const sidecarKey = (kind: SidecarKind, id: string) => storeKey(kind, id);
  const settingsKey = () => storeKey('settings');
  /** The prefix a key SCAN matches — with the trailing colon kept, which is
   *  what `storeKey` with an empty tail builds and what stops
   *  `<app>:index:` matching `<app>:indexDraft:`. */
  const indexPrefix = () => storeKey('index', '');

  /** A page of a format with no way to say "I'm Done", read as done — one
   *  whose bandless page carries no info page to press it on
   *  ({@link EntryStoreOptions.alwaysDoneFormats}).
   *
   *  On READ rather than on create, so the files already on disk are covered
   *  with no migration: every one of them was written `in_progress` and
   *  could never leave it. A record is only rewritten when something else
   *  writes it (`mutateEntry` reads through here first), so this costs no
   *  I/O of its own. */
  function alwaysDone(entry: TEntry): TEntry {
    if (entry.status === 'done' || !alwaysDoneFormats.has(entry.formatId)) return entry;
    return { ...entry, status: 'done', completedAt: entry.completedAt ?? entry.createdAt };
  }

  /** Load the JSON metadata record only (no thumbnail bytes).
   *
   *  THE ONE READ FUNNEL for an entry record: every read and every mutate
   *  below comes through here, which is why the always-done rule is applied
   *  at this point and nowhere else. */
  async function readEntryMeta(id: string): Promise<TEntry | undefined> {
    const raw = await get<string>(entryKey(id));
    if (!raw) return undefined;
    return alwaysDone(JSON.parse(raw) as TEntry);
  }

  async function hydrateThumb(entry: TEntry): Promise<TEntry> {
    const png = await get<Uint8Array>(thumbKey(entry.id));
    if (png instanceof Uint8Array) entry.thumbPng = png;
    return entry;
  }

  async function readIndex(formatId: string): Promise<string[]> {
    const raw = await get<string>(indexKey(formatId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  }

  async function writeIndex(formatId: string, ids: string[]): Promise<void> {
    await set(indexKey(formatId), JSON.stringify(ids));
  }

  /** Load a format's entries via its index, skipping stale ids. */
  async function readFormatEntries(formatId: string): Promise<TEntry[]> {
    const ids = await readIndex(formatId);
    // Annotated because `Promise.all` over a generic-returning map infers
    // `Awaited<TEntry>`, which TypeScript will not narrow back to `TEntry`.
    const metas: (TEntry | undefined)[] = await Promise.all(ids.map((id) => readEntryMeta(id)));
    return metas.filter((e): e is TEntry => e !== undefined);
  }

  async function patchEntryMeta(
    id: string, mutate: (entry: TEntry) => void,
  ): Promise<TEntry> {
    const meta = await readEntryMeta(id);
    if (!meta) throw new Error(`entryStore: no entry with id "${id}"`);
    mutate(meta);
    await set(entryKey(id), JSON.stringify(meta));
    return meta;
  }

  async function mutateEntry(
    id: string, mutate: (entry: TEntry) => void,
  ): Promise<TEntry> {
    return patchEntryMeta(id, (meta) => {
      mutate(meta);
      meta.updatedAt = Date.now();
    });
  }

  /** The record write an image cache write makes: an EDIT by default, a
   *  plain rewrite when the caller says the page itself is unchanged. */
  function writeImageMeta(
    id: string, mutate: (entry: TEntry) => void, opts: ImageWriteOptions,
  ): Promise<TEntry> {
    return opts.keepStamp ? patchEntryMeta(id, mutate) : mutateEntry(id, mutate);
  }

  async function getEntry(id: string): Promise<TEntry | undefined> {
    const meta = await readEntryMeta(id);
    if (!meta) return undefined;
    return hydrateThumb(meta);
  }

  async function getEntryByFormatAndDate(
    formatId: string, isoDate: string,
  ): Promise<TEntry | undefined> {
    const metas = await readFormatEntries(formatId);
    const match = metas.find((e) => e.issueDate === isoDate && isIssuedEntry(e));
    if (!match) return undefined;
    return hydrateThumb(match);
  }

  async function clearEntryImages(id: string): Promise<void> {
    await del(thumbKey(id));
    await del(viewKey(id));
    for (const kind of sidecars) await del(sidecarKey(kind, id));
  }

  return {
    readEntryMeta,
    patchEntryMeta,
    mutateEntry,
    writeImageMeta,
    sidecarKey,
    asRead: alwaysDone,
    getEntry,
    getEntryByFormatAndDate,
    clearEntryImages,

    async listEntryMetas(formatId) {
      return readFormatEntries(formatId);
    },

    async getEntryMeta(id) {
      return readEntryMeta(id);
    },

    async listEntries(filter) {
      let metas: TEntry[];
      if (filter?.formatId) {
        metas = await readFormatEntries(filter.formatId);
      } else {
        const prefix = indexPrefix();
        const allKeys = await keys();
        const formatIds = allKeys
          .filter((k): k is string => typeof k === 'string' && k.startsWith(prefix))
          .map((k) => k.slice(prefix.length))
          .filter((f) => listableFormat?.(f) ?? true);
        const perFormat = await Promise.all(formatIds.map(readFormatEntries));
        metas = perFormat.flat();
      }
      if (filter?.from) metas = metas.filter((e) => e.issueDate >= filter.from!);
      if (filter?.to) metas = metas.filter((e) => e.issueDate <= filter.to!);
      metas.sort((a, b) =>
        a.issueDate < b.issueDate ? -1 : a.issueDate > b.issueDate ? 1 : a.id < b.id ? -1 : 1,
      );
      return Promise.all(metas.map(hydrateThumb));
    },

    async upsertEntry(entry) {
      // …and the always-done rule on the way IN as well, so what is on disk
      // agrees with what every read gives back. A page filed as `new` or
      // `in_progress` in a format with no way to press "I'm Done" would
      // otherwise be a record no reader ever honours.
      const { thumbPng, ...meta } = alwaysDone(entry);
      await set(entryKey(entry.id), JSON.stringify(meta));
      if (thumbPng) await set(thumbKey(entry.id), thumbPng);
      const ids = await readIndex(entry.formatId);
      if (!ids.includes(entry.id)) {
        ids.push(entry.id);
        await writeIndex(entry.formatId, ids);
      }
    },

    async deleteEntry(id) {
      const meta = await readEntryMeta(id);
      await del(entryKey(id));
      await clearEntryImages(id); // every binary sidecar, in one place

      if (!meta) return; // Already gone; readers skip stale index ids anyway.
      const ids = await readIndex(meta.formatId);
      const filtered = ids.filter((x) => x !== id);
      if (filtered.length !== ids.length) await writeIndex(meta.formatId, filtered);
    },

    async markInProgress(id, compositionId) {
      // Opening a page is not an edit: a re-open that changes nothing (the
      // same composition, already in progress or done) writes nothing and
      // leaves `updatedAt` where the last edit put it — otherwise every
      // open read as an edit to a sharing uploader, and a page merely
      // looked at shipped again.
      const meta = await readEntryMeta(id);
      if (meta && meta.compositionId === compositionId && meta.status !== 'new') return meta;
      return mutateEntry(id, (e) => {
        e.compositionId = compositionId;
        if (e.status !== 'done') e.status = 'in_progress';
      });
    },

    async markPageSaved(id, at = Date.now()) {
      if (!(await readEntryMeta(id))) return;
      await patchEntryMeta(id, (e) => { e.pageSavedAt = at; });
    },

    async markEntryImagesDrawn(id, at, recipe) {
      if (!(await readEntryMeta(id))) return;
      await patchEntryMeta(id, (e) => {
        e.imagesAt = at;
        e.imagesRecipe = recipe;
      });
    },

    async setEntryIssue(id, issue) {
      return mutateEntry(id, (e) => { e.issue = issue; });
    },

    async correctEntryIssue(id, issue) {
      return patchEntryMeta(id, (e) => { e.issue = issue; });
    },

    async markDone(id) {
      return mutateEntry(id, (e) => {
        e.status = 'done';
        if (e.completedAt === undefined) e.completedAt = Date.now();
      });
    },

    async markNotDone(id) {
      return mutateEntry(id, (e) => {
        if (e.status === 'done') e.status = 'in_progress';
        delete e.completedAt;
      });
    },

    async setThumb(id, png, aspect, opts = {}, topLuma, whiteStrokes) {
      // Ensure the entry exists so thumbs can't orphan silently.
      await writeImageMeta(id, (e) => {
        if (aspect !== undefined) e.thumbAspect = aspect;
        // Written beside the pixels it describes, and CLEARED when this run
        // could not measure them: a stale brightness off the page's last
        // picture would ink the label against the one before it — which is
        // worse than the fallback, since it is confidently wrong.
        if (topLuma === undefined) delete e.thumbTopLuma;
        else e.thumbTopLuma = topLuma;
        if (whiteStrokes) e.whiteStrokes = true;
        else delete e.whiteStrokes;
      }, opts);
      await set(thumbKey(id), png);
    },

    async setView(id, bytes, opts = {}) {
      await writeImageMeta(id, () => {}, opts);
      await set(viewKey(id), bytes);
    },

    async getView(id) {
      const bytes = await get<Uint8Array>(viewKey(id));
      return bytes instanceof Uint8Array ? bytes : undefined;
    },

    async sidecarPresence() {
      const all = new Set((await keys()).filter((k): k is string => typeof k === 'string'));
      return (kind, id) => all.has(
        kind === 'thumb' ? thumbKey(id) : kind === 'view' ? viewKey(id) : sidecarKey(kind, id),
      );
    },

    async getSettings() {
      const raw = await get<string>(settingsKey());
      const stored: Partial<TSettings> = raw ? JSON.parse(raw) : {};
      return mergeSettings(stored);
    },

    async updateSettings(patch) {
      // Persist only user-touched fields (previous partial + patch), never
      // the merged defaults — otherwise a later change to the app's defaults
      // would be frozen out for anyone who ever changed any setting.
      const raw = await get<string>(settingsKey());
      const stored: Partial<TSettings> = raw ? JSON.parse(raw) : {};
      const nextStored = combineSettings
        ? combineSettings(stored, patch)
        : { ...stored, ...patch };
      await set(settingsKey(), JSON.stringify(nextStored));
      return mergeSettings(nextStored);
    },
  };
}
