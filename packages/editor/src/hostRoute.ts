import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { markOpen } from '@/native-shell/openTrace';
import { onNavigateTo, requestRoute } from '@/native-shell/bridge/webBridge';
import {
  firstParam, parseSearchFor, replaceLocationSearch, resolveQueryFor,
  type QueryOver, type RouterParams,
} from './editorQuery';

// The editor host's OPEN PATH — the part of `EditorHost.tsx` that is the
// same in every Underway app. Settled by the owner 2026-10-23
// (docs/shared-editor.md §4.3): the state machine moves and each app keeps
// a ROUTE TABLE over it, because the measurement says the three hosts are
// three route tables sharing a skeleton rather than one drifted file.
//
// What is here is the skeleton, and each line of it is load-bearing in a
// way a drifted copy would silently lose:
//
//  · the query is the router's, falling back to the URL per key — reading
//    `window.location.search` on mount raced expo-router's SPA navigation
//    and intermittently saw an empty search, so the editor fell to its
//    no-save freeform route (the "web never saves" bug);
//  · a route arriving over the bridge REPLACES that query whole, and is
//    written onto the page's own URL, because a WebView reload replays the
//    URL and replaying the load query (`?warm=1`) is a hold nothing ever
//    answers;
//  · a warm page resolves NOTHING until it is told which page it is;
//  · a superseded run commits nothing, because the resolve is async and
//    React StrictMode double-invokes effects.
//
// What is NOT here is every app's own: which actions its query names, what
// a page's config and issue are, how a multi-file page is minted and how
// long the mint is remembered (CozyJournal and Sol hold the promise for
// the session; DrawBots holds it for the OPEN, on purpose), and what it
// renders. Those are the route table's.

/** A query the open path can read. An app's own `Query` is a superset. */
export interface RoutableQuery {
  /** `?warm=1` — loaded before the host knew which page this is. */
  warm?: string;
}

/**
 * The editor query for this render: a route that arrived over the bridge
 * if one has, else the router's params over the URL.
 *
 * The arrived query wins WHOLE and is never merged key by key — the load
 * query is `?warm=1`, and a merge would leave that key standing over the
 * real route.
 */
export function queryForRender<K extends string>(
  keys: readonly K[],
  routerParams: RouterParams,
  override: QueryOver<K> | null,
): QueryOver<K> {
  return override ?? resolveQueryFor(keys, routerParams);
}

/**
 * What {@link queryForRender} must be re-run for: the COERCED value of
 * each key, not the params object. `useLocalSearchParams` hands back fresh
 * array refs every render, so depending on the object re-resolves the
 * route on renders where no param changed.
 */
export function queryMemoDeps<K extends string>(
  keys: readonly K[],
  routerParams: RouterParams,
): (string | undefined)[] {
  return keys.map((k) => firstParam(routerParams[k]));
}

/**
 * Whether this query holds at the placeholder instead of resolving.
 * Resolving a warm page would fall to the dev freeform route, which opens
 * a blank canvas and lifts the splash on it.
 */
export function holdsForRoute(q: RoutableQuery): boolean {
  return q.warm === '1';
}

/** What an app's route table is given, and what it answers with. */
export interface RouteTable<TQuery, TRoute> {
  /**
   * Clear whatever the last route left standing — the action screens. They
   * are state, and nothing else clears them: a route that ARRIVED may be
   * replacing an export or a delete this host is still showing.
   */
  clear(): void;
  /**
   * This app's routes. Answers the route to mount, or `null` when it has
   * put up something of its own instead (an action screen, a could-not-open
   * notice) and there is no page to show.
   *
   * `alive()` is false once a newer query has superseded this run — check
   * it before every state write, as the route table's own branches do.
   */
  resolve(q: TQuery, alive: () => boolean): Promise<TRoute | null>;
}

/**
 * One run of the open path, with no React in it: clear what stood, let the
 * route table resolve, and commit the route it answers unless the run was
 * superseded while it awaited. The open-trace marks bracket it, which is
 * what the open-speed traces are read against.
 *
 * `alive` is the caller's cancellation flag — the hook's effect cleanup
 * flips it. A superseded run commits NOTHING: not the route, and not the
 * `routeSet` mark that would make the trace read as if it had.
 */
export async function runRouteResolve<TQuery extends RoutableQuery, TRoute>(
  q: TQuery,
  table: RouteTable<TQuery, TRoute>,
  commit: (route: TRoute) => void,
  alive: () => boolean,
): Promise<void> {
  table.clear();
  markOpen('resolveStart');
  const resolved = await table.resolve(q, alive);
  if (resolved === null || !alive()) return;
  markOpen('routeSet');
  commit(resolved);
}

/**
 * The editor query, and the bridge handshake that can replace it.
 *
 * The host tells this page which page it is for in two ways round, because
 * either order happens: the page ASKS on mount (it may have loaded before
 * the host knew), and the host SENDS when it works the route out (the page
 * may still have been parsing its bundle, with no handler for the message
 * yet). Whichever lands first wins; the second is the same query and
 * re-resolving it is idempotent.
 *
 * `keys` is the app's `QUERY_KEYS`, a module constant — its length is what
 * fixes the size of the memo's dependency list.
 *
 * `alsoRouteFrom` is a SECOND place the app routes from, handed the same
 * handler so that a page routed to in place is resolved exactly as one the
 * host sent — DrawBots' in-page router (Redraw to a bot's look page and
 * back) is the one caller, and it answers an unregister as `onNavigateTo`
 * does. The other two apps pass nothing.
 */
export function useEditorQuery<K extends string>(
  keys: readonly K[],
  routerParams: RouterParams,
  alsoRouteFrom?: (go: (search: string) => void) => () => void,
): QueryOver<K> {
  const [override, setOverride] = useState<QueryOver<K> | null>(null);
  const q = useMemo(
    () => queryForRender(keys, routerParams, override),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [override, ...queryMemoDeps(keys, routerParams)],
  );
  const alsoRef = useRef(alsoRouteFrom);
  alsoRef.current = alsoRouteFrom;
  useEffect(() => {
    const go = (search: string) => {
      replaceLocationSearch(search);
      setOverride(parseSearchFor(keys, search));
    };
    const off = onNavigateTo(go);
    const offAlso = alsoRef.current?.(go);
    requestRoute();
    return () => { off(); offAlso?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return q;
}

/**
 * The route this host is showing, resolved from `q` by the app's route
 * table. Null while the page is opening, while a warm page waits to be
 * told what it is, and whenever the table answered with something of its
 * own instead.
 *
 * The table is read through a ref so that a route table rebuilt each
 * render — which every app's is, closing over its own state — does not
 * re-resolve the route.
 *
 * The SETTER comes back beside it because a route is not always
 * write-once: CozyJournal REVISES the one it resolved, in place and
 * without re-scaffolding the page, when a new prompt is drawn for the day
 * and when the answered page's picture arrives a fetch after boot. Both
 * guard on the entry id, so a revision cannot land on a page the route has
 * since moved to.
 */
export function useResolvedRoute<TQuery extends RoutableQuery, TRoute>(
  q: TQuery,
  table: RouteTable<TQuery, TRoute>,
): [TRoute | null, Dispatch<SetStateAction<TRoute | null>>] {
  const [route, setRoute] = useState<TRoute | null>(null);
  const tableRef = useRef(table);
  tableRef.current = table;
  useEffect(() => {
    if (holdsForRoute(q)) return;
    let cancelled = false;
    void runRouteResolve(q, tableRef.current, setRoute, () => !cancelled);
    return () => { cancelled = true; };
  }, [q]);
  return [route, setRoute];
}
