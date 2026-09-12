import { get, set, del, clear, keys } from 'idb-keyval';

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
   *  short strings instead. */
  hasBinary(key: string): Promise<boolean>;
}

const storage: Storage = {
  getItem: (key: string) => get(key).then((v: unknown) => (v as string) ?? null),
  setItem: (key: string, value: string) => set(key, value),
  removeItem: (key: string) => del(key),
  multiGet: (ks: string[]) =>
    Promise.all(ks.map((k) => get(k).then((v: unknown) => [k, (v as string) ?? null] as [string, string | null]))),
  multiRemove: (ks: string[]) => Promise.all(ks.map((k) => del(k))).then(() => {}),
  clear,
  getBinary: (key: string) => get(key).then((v: unknown) => (v instanceof Uint8Array ? v : null)),
  setBinary: (key: string, value: Uint8Array) => set(key, value),
  hasBinary: (key: string) => keys().then((ks: IDBValidKey[]) => ks.includes(key)),
};

export default storage;
