import { registerStoreNamespace, storeKey, storeNamespace } from '../store/storeKeys';

// The one piece of an app's store that can never be unified: the word every
// key it writes begins with. A wrong namespace does not look wrong — it
// writes a page where nothing will ever look for it again — which is why
// this seam refuses rather than defaults (docs/shared-editor.md §4.2 item 6).

afterEach(() => registerStoreNamespace(null));

describe('with no app installed', () => {
  it('refuses to build a key rather than guessing a namespace', () => {
    // The alternative — falling back to some default, the way the font
    // family probe falls back to the system stack — would write every page
    // of an app that forgot to install under a namespace it will never read
    // back. A boot-time throw is the cheap failure.
    expect(() => storeNamespace()).toThrow(/no app namespace installed/);
    expect(() => storeKey('entry', 'abc')).toThrow(/no app namespace installed/);
  });
});

describe('once an app installs one', () => {
  beforeEach(() => registerStoreNamespace('cozy'));

  it('is the first segment of every key', () => {
    expect(storeNamespace()).toBe('cozy');
    expect(storeKey('entry', 'abc')).toBe('cozy:entry:abc');
    expect(storeKey('settings')).toBe('cozy:settings');
    expect(storeKey('assetSweep', 'last')).toBe('cozy:assetSweep:last');
    expect(storeKey('homeState', 'manifest')).toBe('cozy:homeState:manifest');
  });

  it('keeps the trailing colon of a scan PREFIX', () => {
    // What an index scan matches on. Without the colon the prefix would
    // match `cozy:entryDraft:` too, and a scan for pages would return
    // whatever else the app happens to key under a longer word.
    expect(storeKey('entry', '')).toBe('cozy:entry:');
    expect(storeKey('entry', '').endsWith(':')).toBe(true);
  });

  it('is each app’s own word — the three never collide', () => {
    const keys: string[] = [];
    for (const ns of ['cozy', 'sol', 'drawbots']) {
      registerStoreNamespace(ns);
      keys.push(storeKey('entry', 'abc'));
    }
    expect(keys).toEqual(['cozy:entry:abc', 'sol:entry:abc', 'drawbots:entry:abc']);
    expect(new Set(keys).size).toBe(3);
  });
});

describe('what it refuses to install', () => {
  it('a word with a colon in it, which would re-shape every key', () => {
    // `a:b` as the namespace makes `a:b:entry:x`, which anything scanning
    // reads as namespace `a` — so the app's pages would answer a scan no
    // part of it performs.
    expect(() => registerStoreNamespace('a:b')).toThrow(/not a bare lowercase word/);
  });

  it('an empty word, and anything that is not a bare lowercase one', () => {
    expect(() => registerStoreNamespace('')).toThrow(/not a bare lowercase word/);
    expect(() => registerStoreNamespace('Cozy')).toThrow(/not a bare lowercase word/);
    expect(() => registerStoreNamespace('my app')).toThrow(/not a bare lowercase word/);
    expect(() => registerStoreNamespace('cozy/journal')).toThrow(/not a bare lowercase word/);
  });

  it('…but takes the three the apps actually use', () => {
    for (const ns of ['cozy', 'sol', 'drawbots']) {
      expect(() => registerStoreNamespace(ns)).not.toThrow();
    }
  });
});
