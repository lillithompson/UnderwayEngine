import { get, set, del, clear, keys } from 'idb-keyval';
import { countStorageRead, countStorageWrite } from './debug/perfCounters';

type KeyValuePairs = [string, string | null][];

interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  multiGet(keys: string[]): Promise<KeyValuePairs>;
  multiRemove(keys: string[]): Promise<void>;
  clear(): Promise<void>;
  getBinary(key: string): Promise<Uint8Array | null>;
  setBinary(key: string, value: Uint8Array): Promise<void>;
  /** Whether a binary key is present, WITHOUT reading its value. The point
   *  is the value that isn't read: an image blob can be several megabytes
   *  (compositionImageImport keeps a full-resolution export original beside
   *  the display copy), and `getBinary` pulls every one of those bytes over
   *  the structured-clone boundary. Asking for the key list costs a scan of
   *  short strings instead — and, since that list is cached per session
   *  (see `keySet`), usually costs nothing at all. */
  hasBinary(key: string): Promise<boolean>;
  /** Every key in the store, or every key starting with `prefix`. Served
   *  from the same cached key set `hasBinary` uses, so enumerating the image
   *  blobs costs no more than asking about one of them. For the janitor
   *  (imageAssetStore's sweep), which has to ask what IS stored rather than
   *  whether one named thing is. */
  keys(prefix?: string): Promise<string[]>;
  /** Forget the cached key list, for a caller that empties the store out
   *  from under this module (persistence's resetPersistenceCaches).
   *  Optional: a store implementation that caches nothing has nothing to
   *  forget. */
  resetKeyCache?(): void;
}

/**
 * The store's key list, read once per session and kept in step with every
 * write that goes through here.
 *
 * `hasBinary` used to call `keys()` per blob, which walks the WHOLE key
 * space — every composition meta, every thumb, every figure file — so its
 * cost grew with the size of the journal rather than with the page being
 * saved. Once is enough: the answer only ever changes through `setBinary`,
 * `removeItem` / `multiRemove` and `clear`, all of which are below.
 *
 * Held as a promise so concurrent first callers share one scan rather than
 * racing several. A failed scan is dropped, not cached, so the next call
 * retries rather than treating the store as empty.
 */
let keySet: Promise<Set<string>> | null = null;

function loadKeySet(): Promise<Set<string>> {
  keySet ??= keys()
    .then((ks: IDBValidKey[]) => new Set(ks.map((k) => String(k))))
    .catch((err: unknown) => { keySet = null; throw err; });
  return keySet;
}

/** Record a key this session has just written, so a later `hasBinary` sees
 *  it without re-scanning. A no-op before the first scan: there is nothing
 *  to keep in step yet, and the scan will pick the key up. */
function noteKeyWritten(key: string): void {
  void keySet?.then((set) => set.add(key)).catch(() => {});
}

function noteKeysRemoved(ks: string[]): void {
  void keySet?.then((set) => { for (const k of ks) set.delete(k); }).catch(() => {});
}

const storage: Storage = {
  getItem: (key: string) => get(key).then((v: unknown) => (v as string) ?? null),
  setItem: (key: string, value: string) => set(key, value).then(() => { noteKeyWritten(key); }),
  removeItem: (key: string) => del(key).then(() => { noteKeysRemoved([key]); }),
  multiGet: (ks: string[]) =>
    Promise.all(ks.map((k) => get(k).then((v: unknown) => [k, (v as string) ?? null] as [string, string | null]))),
  multiRemove: (ks: string[]) => Promise.all(ks.map((k) => del(k))).then(() => { noteKeysRemoved(ks); }),
  clear: () => clear().then(() => { keySet = Promise.resolve(new Set<string>()); }),
  getBinary: (key: string) => get(key).then((v: unknown) => {
    const bytes = v instanceof Uint8Array ? v : null;
    // Counted where the bytes actually cross the boundary, so a miss
    // (and `hasBinary`, which reads no value at all) costs nothing here.
    if (bytes) countStorageRead(bytes.byteLength);
    return bytes;
  }),
  setBinary: (key: string, value: Uint8Array) =>
    set(key, value).then(() => { noteKeyWritten(key); countStorageWrite(value.byteLength); }),
  hasBinary: (key: string) => loadKeySet().then((set) => set.has(key)),
  resetKeyCache: () => { keySet = null; },
  keys: (prefix?: string) => loadKeySet().then((set) => {
    const all = Array.from(set);
    return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
  }),
};

/** Drop the cached key list — for tests that swap the underlying store out
 *  from under this module. The production path is `storage.resetKeyCache`. */
export function __resetStorageKeyCacheForTest(): void {
  keySet = null;
}

export default storage;
