import { __asyncRequireInternals } from '../webBridge';

const { recoverFromAsyncRequireFailure, isAsyncRequireError, extractChunkUrl, RECOVERY_KEY, MAX_RECOVERIES, resetForTest } = __asyncRequireInternals;

const CHUNK_URL = 'http://localhost:18730/_expo/static/js/web/CompositionEditor-d281c971c2ead791edaacbfe2cace3da.js';
const ERROR_MSG = `AsyncRequireError: Loading module ${CHUNK_URL} failed.\n  at entry-bc.js:701:487`;

interface StubStorage {
  store: Map<string, string>;
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function makeStubStorage(): StubStorage {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => { store.set(k, v); },
    removeItem: (k) => { store.delete(k); },
  };
}

function setGlobals(opts: { fetch: jest.Mock; storage: StubStorage; reload: jest.Mock; origin?: string }): void {
  (globalThis as { fetch?: unknown }).fetch = opts.fetch;
  (globalThis as { sessionStorage?: unknown }).sessionStorage = opts.storage;
  (globalThis as { window?: unknown }).window = {
    location: {
      origin: opts.origin ?? 'http://localhost:18730',
      reload: opts.reload,
    },
  };
}

afterEach(() => {
  resetForTest();
  jest.useRealTimers();
  delete (globalThis as { fetch?: unknown }).fetch;
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  delete (globalThis as { window?: unknown }).window;
});

describe('isAsyncRequireError', () => {
  it('matches the canonical AsyncRequireError message', () => {
    expect(isAsyncRequireError(ERROR_MSG)).toBe(true);
  });

  it('matches the looser "Loading module …localhost:" pattern (no AsyncRequireError prefix)', () => {
    expect(isAsyncRequireError('TypeError: Loading module http://localhost:18730/foo.js failed')).toBe(true);
  });

  it('does not match unrelated errors', () => {
    expect(isAsyncRequireError('TypeError: Cannot read property foo of undefined')).toBe(false);
    expect(isAsyncRequireError('NetworkError loading http://example.com/bar.js')).toBe(false);
  });
});

describe('extractChunkUrl', () => {
  it('pulls the chunk URL out of an AsyncRequireError', () => {
    expect(extractChunkUrl(ERROR_MSG)).toBe(CHUNK_URL);
  });

  it('returns null when no URL is present', () => {
    expect(extractChunkUrl('Plain old error with no URL')).toBeNull();
  });
});

describe('recoverFromAsyncRequireFailure', () => {
  it('polls the server, warms the chunk, and reloads on a healthy first attempt', async () => {
    jest.useFakeTimers();
    const storage = makeStubStorage();
    const reload = jest.fn();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
    setGlobals({ fetch: fetchMock, storage, reload });

    const promise = recoverFromAsyncRequireFailure(ERROR_MSG);
    await jest.runAllTimersAsync();
    await promise;

    const calls = fetchMock.mock.calls.map((c) => c[0]);
    expect(calls).toContain('http://localhost:18730/index.html');
    expect(calls).toContain(CHUNK_URL);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem(RECOVERY_KEY)).toBe('1');
  });

  it('still reloads (without warming) when the server poll never succeeds', async () => {
    jest.useFakeTimers();
    const storage = makeStubStorage();
    const reload = jest.fn();
    const fetchMock = jest.fn().mockRejectedValue(new TypeError('Network error'));
    setGlobals({ fetch: fetchMock, storage, reload });

    const promise = recoverFromAsyncRequireFailure(ERROR_MSG);
    await jest.runAllTimersAsync();
    await promise;

    // Server poll fails for the full 5s budget, then we reload anyway.
    expect(reload).toHaveBeenCalledTimes(1);
    // Warm-chunk should not have been attempted because server poll failed.
    // The diagnostic probe runs unconditionally and hits the chunk URL exactly
    // once, so any warmChunk attempt would show as additional CHUNK_URL hits.
    const chunkCalls = fetchMock.mock.calls.filter((c) => c[0] === CHUNK_URL).length;
    expect(chunkCalls).toBe(1);
  });

  it('gives up after MAX_RECOVERIES attempts and does not reload again', async () => {
    jest.useFakeTimers();
    const storage = makeStubStorage();
    storage.setItem(RECOVERY_KEY, String(MAX_RECOVERIES));
    const reload = jest.fn();
    const fetchMock = jest.fn();
    setGlobals({ fetch: fetchMock, storage, reload });

    const promise = recoverFromAsyncRequireFailure(ERROR_MSG);
    await jest.runAllTimersAsync();
    await promise;

    expect(reload).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    // Counter cleared so a future fresh boot starts over.
    expect(storage.getItem(RECOVERY_KEY)).toBeNull();
  });

  it('ignores non-AsyncRequire errors', async () => {
    jest.useFakeTimers();
    const storage = makeStubStorage();
    const reload = jest.fn();
    const fetchMock = jest.fn();
    setGlobals({ fetch: fetchMock, storage, reload });

    await recoverFromAsyncRequireFailure('TypeError: something else broke');

    expect(reload).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storage.getItem(RECOVERY_KEY)).toBeNull();
  });

  it('does not start a second concurrent recovery while one is in-flight', async () => {
    jest.useFakeTimers();
    const storage = makeStubStorage();
    const reload = jest.fn();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });
    setGlobals({ fetch: fetchMock, storage, reload });

    const first = recoverFromAsyncRequireFailure(ERROR_MSG);
    // Second call before the first awaits; should early-return.
    await recoverFromAsyncRequireFailure(ERROR_MSG);
    await jest.runAllTimersAsync();
    await first;

    expect(reload).toHaveBeenCalledTimes(1);
    // Counter incremented exactly once.
    expect(storage.getItem(RECOVERY_KEY)).toBe('1');
  });
});
