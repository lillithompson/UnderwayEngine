import {
  __resetForTests,
  prefetchThumbnails,
  prefetchToHttpCache,
} from '../imagePrefetch';

// jest runs in node env (jest.config.js: testEnvironment: 'node') so
// `Image` and `fetch` are not naturally present. The schedule helper in
// imagePrefetch.ts detects `typeof window === 'undefined'` and runs work
// inline, so awaiting the returned Promise is sufficient — no fake
// timers needed.

type MockImageInstance = {
  src: string;
  decoding: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  decode: jest.Mock<Promise<void>, []>;
};

function installMockImage() {
  const instances: MockImageInstance[] = [];
  let activeCount = 0;
  let maxConcurrent = 0;
  const resolvers: Array<() => void> = [];

  class FakeImage {
    src = '';
    decoding = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    decode = jest.fn(async () => {
      activeCount++;
      if (activeCount > maxConcurrent) maxConcurrent = activeCount;
      await new Promise<void>((resolve) => { resolvers.push(resolve); });
      activeCount--;
    });
    constructor() {
      instances.push(this as unknown as MockImageInstance);
    }
  }
  (globalThis as unknown as { Image: typeof FakeImage }).Image = FakeImage;

  return {
    instances,
    getMaxConcurrent: () => maxConcurrent,
    getActiveCount: () => activeCount,
    resolveOne: () => {
      const r = resolvers.shift();
      if (r) r();
    },
    resolveAll: () => {
      while (resolvers.length > 0) resolvers.shift()!();
    },
  };
}

function uninstallMockImage() {
  delete (globalThis as unknown as { Image?: unknown }).Image;
}

function installMockFetch() {
  let activeCount = 0;
  let maxConcurrent = 0;
  const resolvers: Array<(value: Response) => void> = [];
  const calls: string[] = [];

  const fakeFetch = jest.fn(async (url: string) => {
    calls.push(url);
    activeCount++;
    if (activeCount > maxConcurrent) maxConcurrent = activeCount;
    const resp = await new Promise<Response>((resolve) => {
      resolvers.push(resolve);
    });
    activeCount--;
    return resp;
  });
  (globalThis as unknown as { fetch: typeof fakeFetch }).fetch = fakeFetch;

  const makeResponse = (): Response => ({
    body: null,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response);

  return {
    calls,
    fetchMock: fakeFetch,
    getMaxConcurrent: () => maxConcurrent,
    resolveAll: () => {
      while (resolvers.length > 0) resolvers.shift()!(makeResponse());
    },
  };
}

function uninstallMockFetch() {
  delete (globalThis as unknown as { fetch?: unknown }).fetch;
}

describe('imagePrefetch', () => {
  beforeEach(() => {
    __resetForTests();
  });

  afterEach(() => {
    uninstallMockImage();
    uninstallMockFetch();
  });

  describe('prefetchThumbnails', () => {
    it('dedupes within a single call', async () => {
      const m = installMockImage();
      const p = prefetchThumbnails(['a', 'a', 'b']);
      // Drain decode promises
      // wait a microtask for runners to start
      await Promise.resolve();
      expect(m.instances).toHaveLength(2);
      m.resolveAll();
      await p;
    });

    it('dedupes across calls', async () => {
      const m = installMockImage();
      const p1 = prefetchThumbnails(['a', 'b']);
      await Promise.resolve();
      m.resolveAll();
      await p1;
      const p2 = prefetchThumbnails(['a', 'c']);
      await Promise.resolve();
      // Only 'c' is new
      expect(m.instances).toHaveLength(3);
      m.resolveAll();
      await p2;
    });

    it('respects concurrency cap', async () => {
      const m = installMockImage();
      const urls = Array.from({ length: 20 }, (_, i) => `u${i}`);
      const p = prefetchThumbnails(urls, { concurrency: 3 });
      // Let runners start
      await Promise.resolve();
      await Promise.resolve();
      // Drain them one at a time and keep ticking
      while (m.getActiveCount() > 0 || m.instances.length < 20) {
        m.resolveOne();
        await Promise.resolve();
        await Promise.resolve();
      }
      await p;
      expect(m.getMaxConcurrent()).toBeLessThanOrEqual(3);
      expect(m.instances).toHaveLength(20);
    });

    it('no-ops when Image is unavailable', async () => {
      // No installMockImage — Image is undefined
      // Should not throw
      await prefetchThumbnails(['a', 'b']);
    });

    it('swallows decode errors', async () => {
      // Replace Image with one whose decode rejects
      class FailingImage {
        src = '';
        decoding = '';
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        decode = jest.fn(async () => { throw new Error('boom'); });
      }
      (globalThis as unknown as { Image: typeof FailingImage }).Image = FailingImage;
      // Should resolve without throwing
      await prefetchThumbnails(['a']);
    });
  });

  describe('prefetchToHttpCache', () => {
    it('calls fetch with force-cache, never constructs Image', async () => {
      const f = installMockFetch();
      const m = installMockImage();
      const p = prefetchToHttpCache(['a', 'b']);
      await Promise.resolve();
      f.resolveAll();
      await p;
      expect(f.fetchMock).toHaveBeenCalledTimes(2);
      expect(f.fetchMock).toHaveBeenCalledWith('a', { cache: 'force-cache' });
      expect(m.instances).toHaveLength(0);
    });

    it('respects concurrency cap', async () => {
      const f = installMockFetch();
      const urls = Array.from({ length: 12 }, (_, i) => `e${i}`);
      const p = prefetchToHttpCache(urls, { concurrency: 2 });
      // Drain fetches one at a time, letting runners pick up the next URL
      for (let i = 0; i < 12; i++) {
        await Promise.resolve();
        await Promise.resolve();
        f.resolveAll();
      }
      await p;
      expect(f.getMaxConcurrent()).toBeLessThanOrEqual(2);
      expect(f.calls).toHaveLength(12);
    });

    it('no-ops when fetch is unavailable', async () => {
      // No installMockFetch — fetch is undefined (after uninstallation)
      uninstallMockFetch();
      await prefetchToHttpCache(['a']);
    });

    it('swallows fetch errors', async () => {
      const fakeFetch = jest.fn(async () => { throw new Error('net'); });
      (globalThis as unknown as { fetch: typeof fakeFetch }).fetch = fakeFetch;
      await prefetchToHttpCache(['a']);
      expect(fakeFetch).toHaveBeenCalled();
    });
  });

  describe('cross-tier dedupe', () => {
    it('URL from prefetchThumbnails is skipped by prefetchToHttpCache', async () => {
      const m = installMockImage();
      const f = installMockFetch();
      const p1 = prefetchThumbnails(['a']);
      await Promise.resolve();
      m.resolveAll();
      await p1;
      const p2 = prefetchToHttpCache(['a', 'b']);
      await Promise.resolve();
      f.resolveAll();
      await p2;
      expect(f.fetchMock).toHaveBeenCalledTimes(1);
      expect(f.fetchMock).toHaveBeenCalledWith('b', { cache: 'force-cache' });
    });

    it('URL from prefetchToHttpCache is skipped by prefetchThumbnails', async () => {
      const m = installMockImage();
      const f = installMockFetch();
      const p1 = prefetchToHttpCache(['a']);
      await Promise.resolve();
      f.resolveAll();
      await p1;
      const p2 = prefetchThumbnails(['a', 'b']);
      await Promise.resolve();
      m.resolveAll();
      await p2;
      expect(m.instances).toHaveLength(1);
      expect(m.instances[0].src).toBe('b');
    });
  });

  describe('__resetForTests', () => {
    it('clears the dedupe set so URLs can be re-fetched', async () => {
      const m = installMockImage();
      const p1 = prefetchThumbnails(['a']);
      await Promise.resolve();
      m.resolveAll();
      await p1;
      expect(m.instances).toHaveLength(1);
      __resetForTests();
      const p2 = prefetchThumbnails(['a']);
      await Promise.resolve();
      m.resolveAll();
      await p2;
      expect(m.instances).toHaveLength(2);
    });
  });
});
