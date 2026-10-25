import {
  holdsForRoute, queryForRender, queryMemoDeps, runRouteResolve, type RouteTable,
} from '../hostRoute';

// The editor host's open path (docs/shared-editor.md §4.2 item 6, 6.6b).
// The two hooks there are twelve lines each over the functions below; what
// is worth pinning is what they decide, so the decisions are driven
// directly — the arrangement useSuppressIOSLoupe already uses in this
// package, there being no renderer in the engine's jest.

// The open trace is behind DIAGNOSTICS, which is off in this harness
// (`__DEV__` is not defined), so the real markOpen records nothing. What
// the machine must get right is WHICH marks it takes and when, so the
// module is mocked and the calls themselves are the subject.
const openMarks: string[] = [];
jest.mock('@/native-shell/openTrace', () => ({
  markOpen: (name: string) => { openMarks.push(name); },
}));

const KEYS = ['entryId', 'format', 'date', 'action', 'warm'] as const;

describe('queryForRender — a route that ARRIVED replaces the one the page loaded with', () => {
  it('reads the router params when nothing has arrived', () => {
    expect(queryForRender(KEYS, { entryId: 'E1', format: ['tile'] }, null))
      .toEqual({ entryId: 'E1', format: 'tile', date: undefined, action: undefined, warm: undefined });
  });

  it('takes an arrived query WHOLE, never merged key by key', () => {
    // The load query is `?warm=1`; a merge would leave that key standing
    // over the real route and hold the page at the placeholder for ever.
    const arrived = { entryId: 'E2' };
    expect(queryForRender(KEYS, { warm: '1' }, arrived)).toEqual(arrived);
  });

  it('keeps an arrived query even when the router params change under it', () => {
    const arrived = { entryId: 'E2' };
    expect(queryForRender(KEYS, { entryId: 'E9', date: '2026-10-24' }, arrived)).toBe(arrived);
  });
});

describe('queryMemoDeps — what a re-resolve is worth doing for', () => {
  it('is one coerced value per key, in the key list\'s order', () => {
    expect(queryMemoDeps(KEYS, { entryId: ['E1'], action: 'deleteEntry' }))
      .toEqual(['E1', undefined, undefined, 'deleteEntry', undefined]);
  });

  it('is equal across renders whose params only changed ARRAY IDENTITY', () => {
    // useLocalSearchParams hands back fresh array refs every render;
    // depending on the object itself re-resolved the route on renders
    // where no param had changed.
    const a = queryMemoDeps(KEYS, { entryId: ['E1'] });
    const b = queryMemoDeps(KEYS, { entryId: ['E1'] });
    expect(a).toEqual(b);
  });

  it('is a fixed length, which is what lets it be spread into a dep list', () => {
    expect(queryMemoDeps(KEYS, {})).toHaveLength(KEYS.length);
    expect(queryMemoDeps(KEYS, { entryId: 'E1', date: 'x', warm: '1' })).toHaveLength(KEYS.length);
  });
});

describe('holdsForRoute — a warm page resolves nothing', () => {
  it('holds on ?warm=1 and on nothing else', () => {
    expect(holdsForRoute({ warm: '1' })).toBe(true);
    expect(holdsForRoute({ warm: '0' })).toBe(false);
    expect(holdsForRoute({})).toBe(false);
  });
});

describe('runRouteResolve — one run of the open path', () => {
  type Q = { warm?: string; entryId?: string };
  type R = { page: string };

  function table(over: Partial<RouteTable<Q, R>> = {}): RouteTable<Q, R> & { cleared: number } {
    const t = {
      cleared: 0,
      clear() { t.cleared++; },
      resolve: async (q: Q) => (q.entryId ? { page: q.entryId } : null),
      ...over,
    };
    return t as RouteTable<Q, R> & { cleared: number };
  }

  beforeEach(() => { openMarks.length = 0; });

  it('clears what stood before it resolves anything', async () => {
    const order: string[] = [];
    const t = table({
      clear() { order.push('clear'); },
      resolve: async () => { order.push('resolve'); return { page: 'p' }; },
    });
    await runRouteResolve({ entryId: 'E1' }, t, () => order.push('commit'), () => true);
    expect(order).toEqual(['clear', 'resolve', 'commit']);
  });

  it('commits the route the table answers with', async () => {
    const got: R[] = [];
    await runRouteResolve({ entryId: 'E1' }, table(), (r) => got.push(r), () => true);
    expect(got).toEqual([{ page: 'E1' }]);
  });

  it('commits nothing when the table handled it itself (an action screen)', async () => {
    const got: R[] = [];
    const t = table();
    await runRouteResolve({}, t, (r) => got.push(r), () => true);
    expect(got).toEqual([]);
    // …but it still cleared: an arriving route replaces a screen that stands.
    expect(t.cleared).toBe(1);
  });

  it('commits nothing once a newer query has superseded the run', async () => {
    // The resolve is async and StrictMode double-invokes effects, so a
    // superseded run landing its route is the bug this guards.
    let alive = true;
    const got: R[] = [];
    const t = table({
      resolve: async () => { alive = false; return { page: 'stale' }; },
    });
    await runRouteResolve({ entryId: 'E1' }, t, (r) => got.push(r), () => alive);
    expect(got).toEqual([]);
  });

  it('hands the table a liveness flag it can read mid-resolve', async () => {
    let alive = true;
    const seen: boolean[] = [];
    const t = table({
      resolve: async (_q, isAlive) => {
        seen.push(isAlive());
        alive = false;
        seen.push(isAlive());
        return null;
      },
    });
    await runRouteResolve({ entryId: 'E1' }, t, () => {}, () => alive);
    expect(seen).toEqual([true, false]);
  });

  it('brackets the run with the open-trace marks the traces are read against', async () => {
    await runRouteResolve({ entryId: 'E1' }, table(), () => {}, () => true);
    expect(openMarks).toEqual(['resolveStart', 'routeSet']);
  });

  it('does not mark routeSet on a superseded run, which would read as an open that happened', async () => {
    let alive = true;
    const t = table({ resolve: async () => { alive = false; return { page: 'stale' }; } });
    await runRouteResolve({ entryId: 'E1' }, t, () => {}, () => alive);
    expect(openMarks).toEqual(['resolveStart']);
  });

  it('marks resolveStart before the table is asked, not after it answers', async () => {
    const order: string[] = [];
    const t = table({ resolve: async () => { order.push(openMarks.join(',')); return null; } });
    await runRouteResolve({ entryId: 'E1' }, t, () => {}, () => true);
    expect(order).toEqual(['resolveStart']);
  });
});
