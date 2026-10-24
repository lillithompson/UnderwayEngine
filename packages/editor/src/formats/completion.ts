import { CompositionState } from '@/engine/types';
import { isEntryEdited, TemplateBaseline } from './edited';
import { isSlotFilled } from './scaffold';
import type { ScaffoldEditorConfig } from './editorConfig';

// Completion rules (CozyJournal.md §4.3): when an entry counts as "done".
// Pure derivation from the composition — evaluated by the editor after
// committed ops and on close; never stored (nothing to drift, §7).

/**
 * Evaluate a format's completion rule against the composition.
 *
 * - allSlotsFilled: every scaffold slot passes isSlotFilled.
 * - slotsFilled: the listed slots pass (ids missing from the scaffold can
 *   never be filled → false, and validateScaffoldEditorConfig flags them).
 * - anyEdit: the user made something — exactly the question `isEntryEdited`
 *   answers for thumbnails (edited.ts), so a page worth a thumbnail and a page
 *   that counts as done are the same page. That includes floating a word
 *   into the magnetic-poetry mask, which changes no node count and fills no
 *   slot.
 *
 * `templateBaseline` (entries minted from a page template) answers the whole
 * question on its own, WHATEVER the format's rule: a template page never held
 * the scaffold, so there are no slots on it to fill and a slot-based rule
 * could only ever say "not done" — the Collage, whose rule names its
 * background and title slots, would never complete on a template page at all.
 * What a template instance can be asked is the same thing `isEntryEdited`
 * asks it, which keeps "worth a thumbnail" and "done" the same question for
 * template pages the way anyEdit already does for scaffolded ones.
 */
export function isEntryComplete(
  config: ScaffoldEditorConfig,
  state: CompositionState,
  slotNodeIds: Record<string, string>,
  templateBaseline?: TemplateBaseline,
  seededFills?: Record<string, number>,
): boolean {
  if (templateBaseline) return isEntryEdited(config, state, slotNodeIds, templateBaseline);
  const rule = config.completion;
  switch (rule.kind) {
    case 'allSlotsFilled':
      return config.scaffold.every((slot) => isSlotFilled(state, slot, slotNodeIds));
    case 'slotsFilled':
      return rule.slotIds.every((slotId) => {
        const slot = config.scaffold.find((s) => s.slotId === slotId);
        return slot !== undefined && isSlotFilled(state, slot, slotNodeIds);
      });
    case 'anyEdit':
      return isEntryEdited(config, state, slotNodeIds, undefined, seededFills);
  }
}
