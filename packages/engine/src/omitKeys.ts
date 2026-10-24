/**
 * A copy of `record` with `keys` dropped — the one spelling of "copy,
 * then delete" for state that is never mutated in place (the friends
 * store's maps, a component's busy flags, a node's effects). The keys
 * are the map's own, and dropping one is only sound where the map allows
 * it to be absent: an index signature, or an optional field.
 *
 * RN-free: the editor's bundle imports it as well as the app.
 */
export function omitKeys<R extends object>(record: R, keys: readonly (keyof R)[]): R {
  const next = { ...record };
  for (const key of keys) delete next[key];
  return next;
}
