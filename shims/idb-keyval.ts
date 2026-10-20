// In-memory stand-in for the `idb-keyval` API surface the engine's storage.ts
// imports (get/set/del/keys/clear). Jest maps '^idb-keyval$' here
// (jest.config.js) because the real lib needs IndexedDB, which the node test
// environment lacks. The same stand-in each app keeps as its
// __mocks__/idb-keyval.ts.
//
// The optional `customStore` param exists on every real idb-keyval fn; we
// accept and ignore it so call sites that pass one still type-check.

const store = new Map<IDBValidKey, unknown>();

export async function get<T = unknown>(key: IDBValidKey, _customStore?: unknown): Promise<T | undefined> {
  return store.get(key) as T | undefined;
}

export async function set(key: IDBValidKey, value: unknown, _customStore?: unknown): Promise<void> {
  store.set(key, value);
}

export async function del(key: IDBValidKey, _customStore?: unknown): Promise<void> {
  store.delete(key);
}

export async function keys<K extends IDBValidKey = IDBValidKey>(_customStore?: unknown): Promise<K[]> {
  return Array.from(store.keys()) as K[];
}

export async function clear(_customStore?: unknown): Promise<void> {
  store.clear();
}
