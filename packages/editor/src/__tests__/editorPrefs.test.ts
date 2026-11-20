import storage from '@/engine/storage';
import { copiesStickyPref, createEditorPref, recentBlendsPref } from '../editorPrefs';

// The editor's user-level preferences follow the PERSON, not the page: set
// on one file, read back on the next (a fresh store over the same storage
// is what another file, or another launch, starts from).

const flush = () => new Promise((r) => setTimeout(r, 0));
/** Past the save's settle (editorPrefs SAVE_SETTLE_MS). */
const settle = () => new Promise((r) => setTimeout(r, 350));

beforeEach(async () => {
  await storage.clear();
  recentBlendsPref.__resetForTest();
  copiesStickyPref.__resetForTest();
});

describe('createEditorPref', () => {
  it('stores what is set, and a fresh store over the same storage reads it back', async () => {
    const parse = (raw: unknown) => (typeof raw === 'number' ? raw : null);
    const first = createEditorPref('test_pref', 1, parse);
    first.set(7);
    await settle();
    const next = createEditorPref('test_pref', 1, parse);
    expect(next.get()).toBe(1);
    const seen: number[] = [];
    next.subscribe(() => seen.push(next.get()));
    await flush();
    expect(next.get()).toBe(7);
    expect(seen).toEqual([7]);
  });

  it('writes the LAST of a burst once it holds still, readers seeing every step', async () => {
    const parse = (raw: unknown) => (typeof raw === 'number' ? raw : null);
    const pref = createEditorPref('test_burst', 0, parse);
    const setItem = jest.spyOn(storage, 'setItem');
    for (let v = 1; v <= 20; v++) {
      pref.set(v);
      expect(pref.get()).toBe(v);
    }
    await flush();
    expect(setItem.mock.calls.filter(([k]) => k === 'test_burst')).toHaveLength(0);
    await settle();
    expect(setItem.mock.calls.filter(([k]) => k === 'test_burst')).toEqual([['test_burst', '20']]);
    setItem.mockRestore();
  });

  it('load() reads the stored copy with no reader, once, so the first reader opens at it (report 8628758e)', async () => {
    const parse = (raw: unknown) => (typeof raw === 'number' ? raw : null);
    await storage.setItem('test_ahead', '9');
    const getItem = jest.spyOn(storage, 'getItem');
    const pref = createEditorPref('test_ahead', 1, parse);
    pref.load();
    pref.load();
    await flush();
    // What a screen opening now reads on its first render, before any
    // subscribe of its own.
    expect(pref.get()).toBe(9);
    pref.subscribe(() => {});
    await flush();
    expect(getItem.mock.calls.filter(([k]) => k === 'test_ahead')).toHaveLength(1);
    getItem.mockRestore();
  });

  it('a set before load()’s read lands still wins', async () => {
    const parse = (raw: unknown) => (typeof raw === 'number' ? raw : null);
    await storage.setItem('test_ahead_set', '9');
    const pref = createEditorPref('test_ahead_set', 1, parse);
    pref.load();
    pref.set(4);
    await flush();
    expect(pref.get()).toBe(4);
    await settle();
    expect(await storage.getItem('test_ahead_set')).toBe('4');
  });

  it('reads junk, or a shape it no longer knows, as nothing stored', async () => {
    await storage.setItem('test_junk', '{not json');
    await storage.setItem('test_shape', JSON.stringify('a string'));
    const parse = (raw: unknown) => (typeof raw === 'number' ? raw : null);
    for (const key of ['test_junk', 'test_shape']) {
      const pref = createEditorPref(key, 3, parse);
      pref.subscribe(() => {});
      await flush();
      expect(pref.get()).toBe(3);
    }
  });
});
