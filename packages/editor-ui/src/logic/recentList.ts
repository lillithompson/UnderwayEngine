/**
 * A most-recently-used list, and a list of items put in its order: the
 * shape every "recent" row in an Underway editor takes — the Tiles bar's
 * recent pattern tiles (`patternEdit.pushRecentPatternTile`,
 * `recentPatternTiles`), and an app's own rows (DrawBots' Inklings and
 * Instructions rows). One move-to-front and one used-first order, so the
 * rows cannot drift apart in how they count a use.
 *
 * Pure: no React, no storage. A caller keeps the list where it likes.
 */

/** `recent` with `key` at its head, any earlier appearance dropped and
 *  the tail trimmed to `max`. Always a new array. */
export function pushRecent<K>(recent: readonly K[], key: K, max: number): K[] {
  return [key, ...recent.filter((k) => k !== key)].slice(0, max);
}

/**
 * `items` with the ones `recent` names first, in `recent`'s order (the
 * most recently used first), then the rest in their own order. A key in
 * `recent` that names none of `items` (one deleted or switched off
 * since) is skipped, and no key is taken twice: where two items share a
 * key, the last of them stands for it among the used and the first
 * among the rest. A new array, never `items` itself; the caller trims it
 * to the row it fills.
 */
export function usedFirst<T>(
  items: readonly T[],
  recent: readonly string[],
  keyOf: (item: T) => string,
): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) byKey.set(keyOf(item), item);
  const out: T[] = [];
  const seen = new Set<string>();
  for (const key of recent) {
    if (seen.has(key) || !byKey.has(key)) continue;
    seen.add(key);
    out.push(byKey.get(key) as T);
  }
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
