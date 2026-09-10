// Files written before format v59 carry a grouped member's own name in
// `preGroupName`: grouping then cleared every member's `name` into that
// stash and wrote the group's own name onto the first member — a hold-over
// from before GroupNode had a name of its own — and ungroup put the stash
// back. So in such a file a grouped leaf's own name IS `preGroupName`;
// whatever `name` holds is the group's (possibly since-renamed) label, or a
// rename made while grouped that the old ungroup would have discarded. A
// group node kept its own name and only stashed a copy.
//
// Grouping no longer touches names (compositionOps `groupFigures`), so the
// stash is folded back into `name` once, as the file loads, and nothing sets
// it after that: every reader asks `name` alone.

/** The last format version whose writer had grouping stash names. */
export const LAST_NAME_STASHING_VERSION = 58;

export interface LegacyNamedLeaf { groupId?: string; name?: string; preGroupName?: string }
export interface LegacyNamedGroup { preGroupName?: string }

/**
 * Fold the stash back into `name`, in place, for a file of `version`. A
 * no-op for files written since grouping stopped stashing (they never carry
 * the field). A stash on a LOOSE leaf — left behind by an older ungroup that
 * did not clear it — is dropped, its `name` already its own.
 */
export function foldLegacyGroupNames(
  version: number,
  leaves: readonly (readonly LegacyNamedLeaf[])[],
  groups: readonly LegacyNamedGroup[],
): void {
  if (version > LAST_NAME_STASHING_VERSION) return;
  for (const kind of leaves) {
    for (const leaf of kind) {
      if (leaf.groupId) {
        if (leaf.preGroupName !== undefined) leaf.name = leaf.preGroupName;
        else delete leaf.name;
      }
      delete leaf.preGroupName;
    }
  }
  for (const g of groups) delete g.preGroupName;
}
