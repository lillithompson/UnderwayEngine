// The options a MULTI-selection gets in its own right — the object panel's
// third carousel page, after the common actions and its members' type options.
// Kept pure (no react-native) so the set and its order are unit-tested in
// node; the panel only turns them into pills.
//
// What unites them: each asks nothing of the members but that there are
// several of them. Layout aligns them against their combined box, Group binds
// them, Merge spends them on one object — none needs the selection to be
// uniform, which is why they get a page rather than a place in a type's set: a
// mixed selection has this page and no type page at all.
//
// Merge is the structural flatten (N objects → 1 object), NOT a boolean shape
// operation. Union / difference / intersect / exclude belong to closed regions
// and are a separate family with a separate home (`onUnion` in the adapter, the
// engine's compositionGeometricUnion); nothing here should blur the two.

/** The selection-level actions, keyed the way the panel keys its options. */
export type MultiAction = 'layout' | 'group' | 'merge';

export interface MultiOption {
  action: MultiAction;
  /** Visible word (also the accessibility name — these are all one word). */
  label: string;
}

/** Which of the three the host has wired up. A host supplies the handler for
 *  an action it can perform on THIS selection and omits it otherwise, so an
 *  un-unionable selection is simply not offered Union. */
export interface MultiOptionAvailability {
  /** `onAlign` supplied — Layout, the one that opens a bar. */
  align?: boolean;
  group?: boolean;
  merge?: boolean;
}

/** The multi-selection options in display order: Layout · Group · Merge.
 *  Layout leads because it's the reversible one — it moves the members and
 *  leaves them selected — while Group and Merge change what the selection IS
 *  (one group, one object), so they close the row, shallowest first.
 *
 *  Group drops out once the selection IS a group: the way back is Ungroup, and
 *  that sits with the selection's TYPE options (where a frame's Ungroup sits
 *  too), not here. */
export function multiSelectionOptions(avail: MultiOptionAvailability): MultiOption[] {
  const out: MultiOption[] = [];
  if (avail.align) out.push({ action: 'layout', label: 'Layout' });
  if (avail.group) out.push({ action: 'group', label: 'Group' });
  if (avail.merge) out.push({ action: 'merge', label: 'Merge' });
  return out;
}
