// The multi-selection's structural actions — Group | Merge | Layout — as a
// FLOATING CAPSULE over the object-properties panel, in the slot (and the
// chrome) the tile tool's Flood | Close | Clear capsule stands in
// (FloatingActionsCapsule). They used to be word-pills on the panel's own
// options row; the capsule lifts them out so the panel row is left to what
// the selection is MADE OF, and the selection-level verbs float above it.
//
// Kept pure (no react-native) so the set and its order are unit-tested in
// node; the shell only turns them into capsule segments.
//
// Order: Group · Merge · Layout · Done — the two that change what the
// selection IS first (shallowest first: Group binds, Merge flattens), then
// Layout, the reversible one, which opens the full-screen alignment modal
// rather than firing outright, and last the one that ends the selection
// instead of doing anything to it. When the selection already IS one group,
// Ungroup stands in Group's place — binding a bound selection was a no-op
// that read as broken, and the way back belongs where the way in was.
//
// DONE is the selection's stated exit, and it is here because deselecting
// had no button at all: the only way out was a tap on empty canvas, and a
// selection can cover every bit of canvas there is — a plain group answers
// for its whole bounding box (groupHit), so a tap inside that box
// re-selects it rather than clearing. A group zoomed in on had nothing left
// to tap and could not be put down (docs/reimagine_stuck_selection.md). The
// canvas capping what a swallowing box may CLAIM is the other half of that
// fix (canvasTap's selectionSwallowsCanvas); this is the half that does not
// depend on how big the box is.
//
// Called "Done" rather than "Deselect": the other three segments are things
// you do to the selection, and the word for stopping is the word the rest of
// this editor uses for finishing with something.

/** A capsule segment's key. `layout` opens the modal; the rest fire once. */
export type MultiCapsuleAction = 'group' | 'ungroup' | 'merge' | 'layout' | 'deselect';

export interface MultiCapsuleOption {
  action: MultiCapsuleAction;
  /** Visible word (also the accessibility name — these are all one word). */
  label: string;
}

/** The capsule's segments for the current selection. `isGroup`: the
 *  selection covers exactly one plain group (wholeGroupIdOfSelection);
 *  `canMerge`: the selection can flatten (canMergeSelectedMulti) — an offer
 *  that can't fire reads as broken, so Merge drops out instead of graying.
 *  Done is unconditional: an exit that came and went with the selection's
 *  shape would not be an exit. */
export function multiCapsuleOptions(
  { isGroup, canMerge }: { isGroup: boolean; canMerge: boolean },
): MultiCapsuleOption[] {
  const out: MultiCapsuleOption[] = [
    isGroup
      ? { action: 'ungroup', label: 'Ungroup' }
      : { action: 'group', label: 'Group' },
  ];
  if (canMerge) out.push({ action: 'merge', label: 'Merge' });
  out.push({ action: 'layout', label: 'Layout' });
  out.push({ action: 'deselect', label: 'Done' });
  return out;
}
