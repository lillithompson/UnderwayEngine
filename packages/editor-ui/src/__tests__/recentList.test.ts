import { pushRecent, usedFirst } from '../logic/recentList';

describe('pushRecent', () => {
  it('puts the use first, says it once, and keeps the rest in their order', () => {
    expect(pushRecent(['a', 'b', 'c'], 'c', 9)).toEqual(['c', 'a', 'b']);
    expect(pushRecent(['a', 'b'], 'z', 9)).toEqual(['z', 'a', 'b']);
    expect(pushRecent([], 'a', 9)).toEqual(['a']);
  });

  it('keeps max at most, the oldest falling off', () => {
    expect(pushRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
  });

  it('is always a new array, even when the use is already first', () => {
    const recent = ['a', 'b'];
    const next = pushRecent(recent, 'a', 9);
    expect(next).toEqual(recent);
    expect(next).not.toBe(recent);
  });
});

describe('usedFirst', () => {
  const keyOf = (k: string) => k;

  it('puts the used first, the most recent first, and the rest after them in their own order', () => {
    expect(usedFirst(['a', 'b', 'c', 'd', 'e'], ['d', 'b'], keyOf)).toEqual(['d', 'b', 'a', 'c', 'e']);
  });

  it('skips a use that names nothing on offer, and says nothing twice', () => {
    expect(usedFirst(['a', 'b', 'c'], ['gone', 'c', 'c', 'a'], keyOf)).toEqual(['c', 'a', 'b']);
  });

  it('is the items’ own order where nothing was used, and never the caller’s array', () => {
    const items = ['a', 'b'];
    const out = usedFirst(items, [], keyOf);
    expect(out).toEqual(items);
    expect(out).not.toBe(items);
  });

  it('takes a shared key once: the last item for a use, the first for the rest', () => {
    const items = [
      { id: 'x', n: 1 },
      { id: 'y', n: 2 },
      { id: 'x', n: 3 },
      { id: 'y', n: 4 },
    ];
    const out = usedFirst(items, ['x'], (t) => t.id);
    expect(out.map((t) => t.n)).toEqual([3, 2]);
  });
});
