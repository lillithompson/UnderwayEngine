// The editor's query vocabulary — the half of it every Underway app reads
// the same way. `EditorHost` turns these params into an `EditorConfig` + a
// `FormatIssue`; this module is how a query string, a router's params and
// the live URL are read, and nothing here knows a format or a store.
//
// On a plain-web SPA navigation the params MUST come from expo-router
// (synchronized with the route, populated on the first render after
// router.push); reading raw `window.location.search` on mount raced that
// navigation and intermittently saw an empty search, so the editor fell to
// its no-save freeform route — the "web never saves" bug.
// `window.location.search` remains the fallback for full-page and
// native-WebView loads, where it is correct from the initial URL.
//
// Each app's `web/editor/editorQuery.ts` keeps its own `QUERY_KEYS` — the
// only part of this that is genuinely the app's, because the keys ARE its
// routes — and binds the readers below to it in thin wrappers whose names
// and signatures are unchanged, so no caller moved when this half did.

/**
 * The query keys all three apps declare. Not a list anyone must use: an
 * app's `QUERY_KEYS` is its own and is normally longer. It is here because
 * the shared host state machine reads exactly these, so it is the key set
 * {@link CommonQuery} is over.
 */
export const COMMON_QUERY_KEYS = [
  // The page to open, or the format and day to mint one for.
  'entryId', 'format', 'date',
  // An action screen instead of a page, and the format its export writes.
  'action', 'exportFormat',
  // The ids a selection action was asked for, comma separated.
  'entryIds',
  // View settings ride along — native owns them.
  'gridWeight', 'gridSnap', 'showDims',
  // The dev route's opt-in.
  'dev',
  // `?warm=1`: the page was loaded before the host knew which page to
  // open, so that the bundle parses while it works that out. It resolves
  // NOTHING and holds until a route arrives over the bridge.
  'warm',
] as const;

export type CommonQueryKey = (typeof COMMON_QUERY_KEYS)[number];

/** A query read over {@link COMMON_QUERY_KEYS}. An app's own `Query` is a
 *  superset of this, so it stands wherever one is asked for. */
export type CommonQuery = Partial<Record<CommonQueryKey, string>>;

/** A query read over an app's own key list. */
export type QueryOver<K extends string> = Partial<Record<K, string>>;

/** Router params as expo-router hands them over. */
export type RouterParams = Record<string, string | string[] | undefined>;

/**
 * The keys a MINTED page's id replaces on the URL: the ones that asked for
 * a page to be made rather than opened. An app whose mint is told anything
 * more passes its own list (DrawBots adds `design`, the bot a new canvas
 * places as it opens).
 */
export const DEFAULT_MINT_KEYS = ['format', 'date', 'random'] as const;

/** expo-router params arrive as `string | string[]`; the first value wins.
 *  Empty strings are treated as absent. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v !== undefined && v !== '' ? v : undefined;
}

/** One query string read into the keys given. Shared by the
 *  `window.location` fallback and by a route arriving over the bridge, so
 *  the two can never read the same URL differently. */
export function parseSearchFor<K extends string>(keys: readonly K[], search: string): QueryOver<K> {
  const params = new URLSearchParams(search);
  const q: QueryOver<K> = {};
  for (const key of keys) {
    const value = params.get(key);
    if (value !== null && value !== '') q[key] = value;
  }
  return q;
}

/** Raw `window.location.search` parse — the fallback source. Guarded for
 *  SSR / the node test harness (no window → empty query). */
export function parseQueryFor<K extends string>(keys: readonly K[]): QueryOver<K> {
  if (typeof window === 'undefined') return {};
  return parseSearchFor(keys, window.location.search);
}

/** The editor query, preferring the router's params (synchronized with
 *  navigation) and falling back per-key to `window.location.search`. */
export function resolveQueryFor<K extends string>(
  keys: readonly K[],
  routerParams: RouterParams,
): QueryOver<K> {
  const fallback = parseQueryFor(keys);
  const q: QueryOver<K> = {};
  for (const key of keys) {
    q[key] = firstParam(routerParams[key]) ?? fallback[key];
  }
  return q;
}

/**
 * Whether the query asks for a page (or an action on one) rather than the
 * bare dev canvas. A route that names a page and cannot open it must SAY
 * so: falling to the dev canvas would open a blank canvas in place of the
 * page asked for, with nothing to tell the player their page was not
 * there.
 *
 * This reads the three keys every app has. An app with page-naming keys of
 * its OWN ors them in — CozyJournal's `respond` and `social` name a page
 * as surely as an `entryId` does.
 */
export function namesACommonPage(q: CommonQuery): boolean {
  return Boolean(q.entryId || q.date || q.action);
}

/**
 * The search string with a minted page pinned to it: `entryId=…` in place
 * of the keys that asked for a page to be MADE. Every other param — the
 * settings ride-alongs — is kept as it stands.
 *
 * A multi-file open mints a new file on purpose, guarded once per editor
 * session by the host. That guard lives in JS memory, and the WebView's
 * URL is what a reload replays: the shell reloads the page whenever iOS
 * kills the content process (backgrounding the app for a while is enough),
 * and the same format+date URL minted ANOTHER blank file — the player saw
 * a flash of their drawing, then an empty canvas, with the real file left
 * behind. Rewriting the URL to the file's id the moment it is minted makes
 * a reload the same as opening the file.
 */
export function pinnedEntrySearchFor(
  mintKeys: readonly string[],
  search: string,
  entryId: string,
): string {
  const params = new URLSearchParams(search);
  for (const key of mintKeys) params.delete(key);
  params.set('entryId', entryId);
  return '?' + params.toString();
}

/** Pin the minted page onto the live URL (`history.replaceState` — no
 *  navigation, no reload; expo-router only listens for popstate). A no-op
 *  outside a browser, or when the URL already names the page. */
export function pinEntryToLocationFor(mintKeys: readonly string[], entryId: string): void {
  if (typeof window === 'undefined') return;
  const { search } = window.location;
  if (new URLSearchParams(search).get('entryId') === entryId) return;
  replaceLocationSearch(pinnedEntrySearchFor(mintKeys, search, entryId));
}

/**
 * Put a query onto the live URL, in place. The same `history.replaceState`
 * {@link pinEntryToLocationFor} uses, for the same reason: the shell
 * reloads the page when iOS kills the content process, and what it reloads
 * is the URL — so a route that arrived over the bridge has to be written
 * there or the reload replays the page's LOAD query (`?warm=1`, and a hold
 * nothing would ever answer).
 */
export function replaceLocationSearch(search: string): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const { pathname, hash } = window.location;
  const query = search === '' || search.startsWith('?') ? search : '?' + search;
  try {
    window.history.replaceState(window.history.state, '', pathname + query + hash);
  } catch { /* a sandboxed frame can refuse; the next open still works */ }
}
