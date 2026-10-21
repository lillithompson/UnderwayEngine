import { AFTER_READY_FALLBACK_MS, afterReady, pageIsReady, __resetAfterReadyForTest } from '../afterReady';

// §3.2b of CozyJournal's docs/response_open_speed.md: module-scope
// background work ran while the page was still booting behind the splash —
// a CMS fetch on the same radio and the same thread as the open it was
// holding up. This pins the gate itself; WHICH of an app's work waits on it
// is pinned in that app's own tree (docs/shared-editor.md §4.2 item 5).

describe('waiting for the frame the splash lifts on', () => {
  afterEach(__resetAfterReadyForTest);

  test('nothing runs before READY, and everything does after it, in order', () => {
    const ran: string[] = [];
    afterReady(() => ran.push('cms'));
    afterReady(() => ran.push('janitor'));
    expect(ran).toEqual([]);
    pageIsReady();
    expect(ran).toEqual(['cms', 'janitor']);
  });

  test('registering after READY runs at once', () => {
    pageIsReady();
    const ran: string[] = [];
    afterReady(() => ran.push('late'));
    expect(ran).toEqual(['late']);
  });

  test('READY twice runs the queue once', () => {
    const ran: string[] = [];
    afterReady(() => ran.push('once'));
    pageIsReady();
    pageIsReady();
    expect(ran).toEqual(['once']);
  });

  test('one throwing job never takes the page — or the jobs after it — down', () => {
    const ran: string[] = [];
    afterReady(() => { throw new Error('offline'); });
    afterReady(() => ran.push('after'));
    expect(() => pageIsReady()).not.toThrow();
    expect(ran).toEqual(['after']);
  });

  test('a route that never signals still gets its background work, eventually', () => {
    jest.useFakeTimers();
    const ran: string[] = [];
    afterReady(() => ran.push('fallback'));
    jest.advanceTimersByTime(AFTER_READY_FALLBACK_MS);
    expect(ran).toEqual(['fallback']);
    jest.useRealTimers();
  });
});
