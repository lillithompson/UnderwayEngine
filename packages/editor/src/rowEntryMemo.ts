import type { SessionEntry } from './editorSession';

/**
 * What a property row's drag remembers between its preview frames and its
 * release: the entry the LAST preview built, so the release can land that
 * very entry instead of building a second one.
 *
 * It exists for the pattern rows. A Resolution step re-rolls the cells its
 * new grid exposes, and a roll is not repeatable: building the same step
 * twice hands back two different patterns. The drag previewed one of them
 * and the release built the other, so letting go of the slider replaced
 * the pattern the drag had settled on with one nobody had seen — drag
 * until you like it, let go, and you lost it. Landing the remembered entry
 * makes the release a no-op on screen, which is what a release should be.
 *
 * The entry is remembered under a KEY naming what it was built for (the
 * row, what it acts on, and the value) — a release on a step this drag
 * never previewed is still built fresh, and two rows can never hand each
 * other an entry. `reset` starts a drag; `commit` ends one and forgets,
 * so the next drag can only reuse what it saw itself.
 */
export type RowEntryMemo = {
  /** A preview frame: the entry for `key`, built now unless this drag has
   *  already built that very one, and remembered as the one to land. */
  preview(key: string, build: () => SessionEntry | null): SessionEntry | null;
  /** The release: the entry this drag previewed for `key`, or one built
   *  now when it previewed something else (or nothing). Forgets either
   *  way — the drag is over. */
  commit(key: string, build: () => SessionEntry | null): SessionEntry | null;
  /** A fresh drag begins: nothing from the last one may be landed. */
  reset(): void;
};

export function createRowEntryMemo(): RowEntryMemo {
  let held: { key: string; entry: SessionEntry | null } | null = null;
  const entryFor = (key: string, build: () => SessionEntry | null): SessionEntry | null => (
    held && held.key === key ? held.entry : build()
  );
  return {
    preview(key, build) {
      const entry = entryFor(key, build);
      held = { key, entry };
      return entry;
    },
    commit(key, build) {
      const entry = entryFor(key, build);
      held = null;
      return entry;
    },
    reset() {
      held = null;
    },
  };
}
