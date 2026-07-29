/**
 * Shared byte-budgeted LRU (rasterLruCache.ts). Pins the eviction
 * discipline both raster caches (text, effects) depend on: recency via
 * Map re-insertion, evict-oldest-until-fit, owner-keyed invalidation,
 * and the cache-of-one guarantee for oversized entries.
 */

import { createRasterLruCache } from '../rasterLruCache';

describe('createRasterLruCache basics', () => {
  test('get returns undefined on miss, the stored value on hit', () => {
    const lru = createRasterLruCache<string>(100);
    expect(lru.get('a')).toBeUndefined();
    lru.set('a', 'node1', 10, 'A');
    expect(lru.get('a')).toBe('A');
  });

  test('peek returns the value without affecting anything', () => {
    const lru = createRasterLruCache<string>(100);
    lru.set('a', 'node1', 10, 'A');
    expect(lru.peek('a')).toBe('A');
    expect(lru.peek('missing')).toBeUndefined();
  });

  test('totalBytes and entryCount track inserts', () => {
    const lru = createRasterLruCache<string>(100);
    lru.set('a', 'n', 10, 'A');
    lru.set('b', 'n', 30, 'B');
    expect(lru.totalBytes()).toBe(40);
    expect(lru.entryCount()).toBe(2);
  });

  test('set on an existing key replaces the value and its byte count', () => {
    const lru = createRasterLruCache<string>(100);
    lru.set('a', 'n', 10, 'A');
    lru.set('a', 'n', 25, 'A2');
    expect(lru.get('a')).toBe('A2');
    expect(lru.totalBytes()).toBe(25);
    expect(lru.entryCount()).toBe(1);
  });

  test('delete removes an entry and reclaims its bytes', () => {
    const lru = createRasterLruCache<string>(100);
    lru.set('a', 'n', 10, 'A');
    lru.set('b', 'n', 20, 'B');
    expect(lru.delete('a')).toBe(true);
    expect(lru.delete('a')).toBe(false);
    expect(lru.peek('a')).toBeUndefined();
    expect(lru.totalBytes()).toBe(20);
  });

  test('clear empties the cache and resets byte accounting', () => {
    const lru = createRasterLruCache<string>(100);
    lru.set('a', 'n', 10, 'A');
    lru.set('b', 'n', 20, 'B');
    lru.clear();
    expect(lru.entryCount()).toBe(0);
    expect(lru.totalBytes()).toBe(0);
    expect(lru.peek('a')).toBeUndefined();
  });
});

describe('createRasterLruCache eviction', () => {
  test('inserting over budget evicts the oldest entry first', () => {
    const lru = createRasterLruCache<string>(8);
    lru.set('a', 'n', 4, 'A');
    lru.set('b', 'n', 4, 'B');
    lru.set('c', 'n', 4, 'C'); // 12 > 8: evict a
    expect(lru.peek('a')).toBeUndefined();
    expect(lru.peek('b')).toBe('B');
    expect(lru.peek('c')).toBe('C');
    expect(lru.totalBytes()).toBe(8);
    expect(lru.entryCount()).toBe(2);
  });

  test('a get hit bumps recency so the entry survives the next eviction', () => {
    const lru = createRasterLruCache<string>(8);
    lru.set('a', 'n', 4, 'A');
    lru.set('b', 'n', 4, 'B');
    lru.get('a'); // a is now most recent; b is the LRU candidate
    lru.set('c', 'n', 4, 'C');
    expect(lru.peek('a')).toBe('A');
    expect(lru.peek('b')).toBeUndefined();
    expect(lru.peek('c')).toBe('C');
  });

  test('peek does NOT bump recency', () => {
    const lru = createRasterLruCache<string>(8);
    lru.set('a', 'n', 4, 'A');
    lru.set('b', 'n', 4, 'B');
    lru.peek('a'); // no bump: a stays oldest
    lru.set('c', 'n', 4, 'C');
    expect(lru.peek('a')).toBeUndefined();
    expect(lru.peek('b')).toBe('B');
  });

  test('a single entry larger than the budget still caches (cache-of-one)', () => {
    const lru = createRasterLruCache<string>(8);
    lru.set('big', 'n', 100, 'BIG');
    expect(lru.peek('big')).toBe('BIG');
    expect(lru.totalBytes()).toBe(100);
    // The oversized entry evicts everything else but survives itself.
    lru.set('small', 'n', 4, 'S');
    expect(lru.peek('big')).toBeUndefined();
    expect(lru.peek('small')).toBe('S');
  });

  test('eviction drops multiple entries until the budget is met', () => {
    const lru = createRasterLruCache<string>(10);
    lru.set('a', 'n', 4, 'A');
    lru.set('b', 'n', 4, 'B');
    lru.set('big', 'n', 9, 'BIG'); // 17 > 10: evict a (13), then b (9)
    expect(lru.peek('a')).toBeUndefined();
    expect(lru.peek('b')).toBeUndefined();
    expect(lru.peek('big')).toBe('BIG');
    expect(lru.totalBytes()).toBe(9);
  });
});

describe('createRasterLruCache owner invalidation', () => {
  test('invalidateOwner drops every entry for that owner only', () => {
    const lru = createRasterLruCache<string>(100);
    lru.set('a1', 'nodeA', 10, 'A1');
    lru.set('a2', 'nodeA', 10, 'A2');
    lru.set('b1', 'nodeB', 10, 'B1');
    const dropped = lru.invalidateOwner('nodeA');
    expect(dropped).toBe(2);
    expect(lru.peek('a1')).toBeUndefined();
    expect(lru.peek('a2')).toBeUndefined();
    expect(lru.peek('b1')).toBe('B1');
    expect(lru.totalBytes()).toBe(10);
  });

  test('invalidateOwner with no matching entries is a no-op returning 0', () => {
    const lru = createRasterLruCache<string>(100);
    lru.set('a', 'nodeA', 10, 'A');
    expect(lru.invalidateOwner('nodeZ')).toBe(0);
    expect(lru.peek('a')).toBe('A');
  });
});
