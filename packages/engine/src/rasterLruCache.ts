/**
 * Generic byte-budgeted LRU store shared by the CPU-side raster caches
 * (textTextureCache.ts, effectsCache.ts). Mirrors the eviction discipline
 * of gl/figureTextureCache.ts — recency-ordered, evict-oldest-until-fit —
 * but is host-agnostic (no GL, no timers) so it tests under node.
 *
 * Recency is tracked via Map insertion order: a `get` hit re-inserts the
 * key, so the first key in iteration order is always the LRU candidate.
 *
 * Each entry carries an `ownerId` (scene-node id) so a node-level
 * invalidation can drop every entry the node produced without the caller
 * maintaining its own reverse index.
 *
 * A value that OWNS something outside the heap — an object URL, a GPU
 * texture — passes an `onEvict`, because eviction is otherwise silent and
 * the thing it owns is leaked. It fires for every way an entry leaves:
 * eviction, replacement, `delete`, `invalidateOwner` and `clear`.
 */

interface LruSlot<V> {
  value: V;
  bytes: number;
  ownerId: string;
}

export interface RasterLruCache<V> {
  /** Lookup; bumps recency on hit. */
  get(key: string): V | undefined;
  /** Lookup without bumping recency. */
  peek(key: string): V | undefined;
  /** Insert (replacing any prior entry at `key`), then evict oldest
   *  entries until the byte budget is met. The just-inserted entry is
   *  never evicted, so a single entry larger than the budget still
   *  caches (cache-of-one) rather than thrashing. */
  set(key: string, ownerId: string, bytes: number, value: V): void;
  /** Drop every entry whose ownerId matches. Returns entries dropped. */
  invalidateOwner(ownerId: string): number;
  delete(key: string): boolean;
  clear(): void;
  totalBytes(): number;
  entryCount(): number;
}

export function createRasterLruCache<V>(
  budgetBytes: number,
  onEvict?: (key: string, value: V) => void,
): RasterLruCache<V> {
  const map = new Map<string, LruSlot<V>>();
  let bytes = 0;

  function drop(key: string, slot: LruSlot<V>): void {
    map.delete(key);
    bytes -= slot.bytes;
    onEvict?.(key, slot.value);
  }

  function evictToFit(protectedKey: string): void {
    if (bytes <= budgetBytes) return;
    for (const [key, slot] of map) {
      if (bytes <= budgetBytes) break;
      if (key === protectedKey) continue;
      drop(key, slot);
    }
  }

  return {
    get(key) {
      const slot = map.get(key);
      if (!slot) return undefined;
      // Re-insert to move to the most-recent end of iteration order.
      map.delete(key);
      map.set(key, slot);
      return slot.value;
    },
    peek(key) {
      return map.get(key)?.value;
    },
    set(key, ownerId, entryBytes, value) {
      const prior = map.get(key);
      if (prior) drop(key, prior);
      map.set(key, { value, bytes: entryBytes, ownerId });
      bytes += entryBytes;
      evictToFit(key);
    },
    invalidateOwner(ownerId) {
      let dropped = 0;
      for (const [key, slot] of Array.from(map.entries())) {
        if (slot.ownerId !== ownerId) continue;
        drop(key, slot);
        dropped++;
      }
      return dropped;
    },
    delete(key) {
      const slot = map.get(key);
      if (!slot) return false;
      drop(key, slot);
      return true;
    },
    clear() {
      for (const [key, slot] of Array.from(map.entries())) drop(key, slot);
      map.clear();
      bytes = 0;
    },
    totalBytes: () => bytes,
    entryCount: () => map.size,
  };
}
