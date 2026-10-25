import {
  COMMON_QUERY_KEYS, DEFAULT_MINT_KEYS, firstParam, namesACommonPage, parseQueryFor,
  parseSearchFor, pinEntryToLocationFor, pinnedEntrySearchFor, replaceLocationSearch,
  resolveQueryFor, type RouterParams,
} from '../editorQuery';

// The editor's query vocabulary, the half every Underway app reads the same
// way (docs/shared-editor.md §4.2 item 6, 6.6a). What each app keeps is its
// own QUERY_KEYS and five thin wrappers binding these to it, so the readers
// below are driven here over a MADE-UP key list — the way sessionHost and
// loadPackFonts drive their seams — rather than over any app's.

const KEYS = ['entryId', 'format', 'date', 'action', 'random', 'warm'] as const;
type Key = (typeof KEYS)[number];

// A browser just real enough for the three functions that touch one.
interface FakeWindow {
  location: { search: string; pathname: string; hash: string };
  history: { state: unknown; replaceState: (s: unknown, t: string, url: string) => void };
}
let fake: FakeWindow;
let replaced: string[];

function installWindow(search = '', opts: { throws?: boolean; noHistory?: boolean } = {}) {
  replaced = [];
  fake = {
    location: { search, pathname: '/editor', hash: '' },
    history: {
      state: { k: 1 },
      replaceState: (_s, _t, url) => {
        if (opts.throws) throw new Error('sandboxed');
        replaced.push(url);
      },
    },
  };
  if (opts.noHistory) (fake as { history?: unknown }).history = undefined;
  (globalThis as { window?: unknown }).window = fake;
}

afterEach(() => { delete (globalThis as { window?: unknown }).window; });

describe('COMMON_QUERY_KEYS — the set the shared host state machine reads', () => {
  it('names each key once', () => {
    expect(new Set(COMMON_QUERY_KEYS).size).toBe(COMMON_QUERY_KEYS.length);
  });

  it('holds the eleven the three apps share, and nothing an app alone has', () => {
    // Derived from the apps at 6.6a by intersecting their three QUERY_KEYS
    // lists (28 / 13 / 21 keys). An exact set, not a negative match: a key
    // added here that only one app declares makes the shared machine read a
    // param two apps never send.
    expect([...COMMON_QUERY_KEYS].sort()).toEqual([
      'action', 'date', 'dev', 'entryId', 'entryIds', 'exportFormat',
      'format', 'gridSnap', 'gridWeight', 'showDims', 'warm',
    ]);
  });
});

describe('firstParam — a router param is a string or an array of them', () => {
  it('takes the first of an array and the value of a bare string', () => {
    expect(firstParam(['a', 'b'])).toBe('a');
    expect(firstParam('a')).toBe('a');
  });

  it('reads an empty string, an empty array and an absent value as absent', () => {
    expect(firstParam('')).toBeUndefined();
    expect(firstParam([])).toBeUndefined();
    expect(firstParam(undefined)).toBeUndefined();
  });
});

describe('parseSearchFor — one query string over one key list', () => {
  it('reads the keys asked for and leaves every other param alone', () => {
    const q = parseSearchFor(KEYS, '?entryId=abc&format=tile&nothingOfOurs=1');
    expect(q).toEqual({ entryId: 'abc', format: 'tile' });
  });

  it('treats a present-but-empty param as absent', () => {
    expect(parseSearchFor(KEYS, '?entryId=&format=x')).toEqual({ format: 'x' });
  });

  it('decodes as a URL does', () => {
    expect(parseSearchFor(KEYS, '?date=2026-10-24&action=export%20all').action).toBe('export all');
  });
});

describe('parseQueryFor — the window.location fallback', () => {
  it('answers an empty query with no window at all (SSR, the node harness)', () => {
    expect(parseQueryFor(KEYS)).toEqual({});
  });

  it('reads the live search when there is one', () => {
    installWindow('?entryId=xyz');
    expect(parseQueryFor(KEYS)).toEqual({ entryId: 'xyz' });
  });
});

describe('resolveQueryFor — the router wins, the URL fills in', () => {
  const params: RouterParams = { entryId: ['router'], format: '' };

  it('prefers a router param over the same key on the URL', () => {
    installWindow('?entryId=url&date=2026-10-24');
    expect(resolveQueryFor(KEYS, params).entryId).toBe('router');
  });

  it('falls back per key, not whole-query', () => {
    installWindow('?entryId=url&date=2026-10-24');
    // `date` came only from the URL, and `entryId` only from the router:
    // a whole-query fallback would have dropped one of the two.
    expect(resolveQueryFor(KEYS, params).date).toBe('2026-10-24');
  });

  it('reads a router param that is the empty string as absent, so the URL answers', () => {
    installWindow('?format=fromUrl');
    expect(resolveQueryFor(KEYS, params).format).toBe('fromUrl');
  });

  it('answers with every key present, so a reader can destructure the lot', () => {
    installWindow('');
    const q = resolveQueryFor(KEYS, {});
    expect(Object.keys(q).sort()).toEqual([...KEYS].sort());
    expect(KEYS.every((k) => q[k as Key] === undefined)).toBe(true);
  });
});

describe('namesACommonPage — a route that names a page must not fall to the dev canvas', () => {
  it('is true of each of the three keys that name one', () => {
    expect(namesACommonPage({ entryId: 'a' })).toBe(true);
    expect(namesACommonPage({ date: '2026-10-24' })).toBe(true);
    expect(namesACommonPage({ action: 'deleteEntry' })).toBe(true);
  });

  it('is false of the bare dev route — a format alone, or nothing', () => {
    expect(namesACommonPage({})).toBe(false);
    expect(namesACommonPage({ format: 'tile', dev: '1' })).toBe(false);
  });
});

describe('pinnedEntrySearchFor — a minted page replaces what asked for it', () => {
  it('drops the mint keys, keeps the ride-alongs, and names the page', () => {
    const out = pinnedEntrySearchFor(
      DEFAULT_MINT_KEYS, '?format=sol&date=2026-10-24&random=7&gridSnap=1', 'E1',
    );
    const got = new URLSearchParams(out);
    expect(got.get('entryId')).toBe('E1');
    expect(got.get('gridSnap')).toBe('1');
    expect([...got.keys()].sort()).toEqual(['entryId', 'gridSnap']);
  });

  it('drops an app\'s own mint key when it passes one', () => {
    // DrawBots adds `design`, the bot a new canvas places as it opens — a
    // reload must not place it again.
    const out = pinnedEntrySearchFor([...DEFAULT_MINT_KEYS, 'design'], '?format=d&design=b7', 'E2');
    expect([...new URLSearchParams(out).keys()]).toEqual(['entryId']);
  });

  it('replaces an entryId already on the URL rather than appending a second', () => {
    const out = pinnedEntrySearchFor(DEFAULT_MINT_KEYS, '?entryId=OLD', 'NEW');
    expect(new URLSearchParams(out).getAll('entryId')).toEqual(['NEW']);
  });

  it('answers a search that begins with ?', () => {
    expect(pinnedEntrySearchFor(DEFAULT_MINT_KEYS, '', 'E3').startsWith('?')).toBe(true);
  });
});

describe('pinEntryToLocationFor — the reload has to reopen the file, not mint another', () => {
  it('writes the pinned search onto the live URL', () => {
    installWindow('?format=sol&date=2026-10-24&gridSnap=1');
    pinEntryToLocationFor(DEFAULT_MINT_KEYS, 'E1');
    expect(replaced).toEqual(['/editor?gridSnap=1&entryId=E1']);
  });

  it('does nothing when the URL already names that page', () => {
    installWindow('?entryId=E1');
    pinEntryToLocationFor(DEFAULT_MINT_KEYS, 'E1');
    expect(replaced).toEqual([]);
  });

  it('still writes when the URL names a DIFFERENT page', () => {
    installWindow('?entryId=OTHER');
    pinEntryToLocationFor(DEFAULT_MINT_KEYS, 'E1');
    expect(replaced).toEqual(['/editor?entryId=E1']);
  });

  it('is a no-op outside a browser', () => {
    expect(() => pinEntryToLocationFor(DEFAULT_MINT_KEYS, 'E1')).not.toThrow();
  });
});

describe('replaceLocationSearch — the URL a WebView reload replays', () => {
  it('keeps the path and the hash, and carries history state through', () => {
    installWindow('?old=1');
    fake.location.hash = '#frag';
    let sawState: unknown;
    fake.history.replaceState = (s, _t, url) => { sawState = s; replaced.push(url); };
    replaceLocationSearch('?entryId=E1');
    expect(replaced).toEqual(['/editor?entryId=E1#frag']);
    expect(sawState).toEqual({ k: 1 });
  });

  it('adds the ? a bare query lacks, and leaves an empty query empty', () => {
    installWindow();
    replaceLocationSearch('entryId=E1');
    replaceLocationSearch('');
    expect(replaced).toEqual(['/editor?entryId=E1', '/editor']);
  });

  it('swallows a sandboxed frame\'s refusal — the next open still works', () => {
    installWindow('', { throws: true });
    expect(() => replaceLocationSearch('?a=1')).not.toThrow();
  });

  it('is a no-op where history.replaceState is missing', () => {
    installWindow('', { noHistory: true });
    expect(() => replaceLocationSearch('?a=1')).not.toThrow();
  });
});
