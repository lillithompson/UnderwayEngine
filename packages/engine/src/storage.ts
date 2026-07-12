import { get, set, del, clear } from 'idb-keyval';

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
};

export default storage;
