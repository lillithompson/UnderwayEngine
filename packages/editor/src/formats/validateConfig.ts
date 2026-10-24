import type { CommonEditorConfig, ScaffoldEditorConfig } from './editorConfig';
import { deadContentModes } from '../components/toolbarMeta';
import type { HostTools } from '../hostTools';

// EditorConfig authoring-time validation (CozyJournal.md §12: "per-format
// EditorConfig validation — every scaffold slot has a prompt step,
// completion rules satisfiable"). Configs are code, so this runs in tests
// and dev asserts, returning human-readable problems rather than throwing.
//
// WHY THE SCAFFOLD HALF IS A `Partial`, and it is the reason ONE function
// serves all three apps. CozyJournal's and DrawBots' configs declare the
// format layer and Sol's does not, so a validator typed over
// `ScaffoldEditorConfig` would refuse Sol's config outright — and Sol's own
// copy of this file was exactly these checks with every scaffold one deleted
// (37 lines against 129, and byte-identical in the other two apps). Taking
// the layer as optional makes those checks VACUOUS on a config that declares
// none of it rather than absent, which is the same answer with nothing to
// keep in sync. Nothing is weakened for the apps that do declare it: there
// the members are required by their own interface, so a misspelt `scaffold`
// fails where the config is written.
//
// `hostTools` is a PARAMETER because the registry is the app's by design
// (each app's `web/editor/hostTools.ts` — the seam stage 2 built, which
// `deadContentModes` already took this way). Each app keeps a one-line
// `web/formats/validateConfig.ts` wrapper passing its own, so its call sites
// did not move.

/** A config this validator can read: the common half, plus as much of the
 *  format layer as the app declares. */
export type ValidatableEditorConfig = CommonEditorConfig & Partial<ScaffoldEditorConfig>;

/**
 * Validate a format's EditorConfig. Returns a list of problems; empty
 * means valid. Every check over the format layer is skipped on a config
 * that does not declare it (see the module header). Checks:
 * - scaffold slotIds are unique and slot rects have positive size;
 * - every 'fillSlot' prompt step references an existing slot;
 * - a 'slotsFilled' completion rule only lists existing slots;
 * - the tool carousel is non-empty and canvas.aspect is positive;
 * - no content mode is turned on by a flag and then filtered out by name;
 * - decorTexts have unique ids, positive size, and only ask to join a frame
 *   the format actually declares;
 * - every slot the completion rule DEPENDS ON has a fillSlot prompt step,
 *   so completion is reachable through the guided flow: all scaffold
 *   slots under 'allSlotsFilled', the listed slots under 'slotsFilled'
 *   (unlisted slots are optional garnish), and
 *   none under 'anyEdit', where slots are backdrop, not chores.
 */
export function validateEditorConfig(
  config: ValidatableEditorConfig,
  hostTools: HostTools,
): string[] {
  const errors: string[] = [];

  const slotIds = new Set<string>();
  for (const slot of config.scaffold ?? []) {
    if (slotIds.has(slot.slotId)) {
      errors.push(`scaffold: duplicate slotId "${slot.slotId}"`);
    }
    slotIds.add(slot.slotId);
    if (!(slot.cellWidth > 0) || !(slot.cellHeight > 0)) {
      errors.push(
        `scaffold: slot "${slot.slotId}" must have positive size (got ${slot.cellWidth}×${slot.cellHeight})`,
      );
    }
  }

  const fillSlotIds = new Set<string>();
  for (const step of config.promptFlow ?? []) {
    if (step.kind !== 'fillSlot') continue;
    fillSlotIds.add(step.slotId);
    if (!slotIds.has(step.slotId)) {
      errors.push(`promptFlow: step "${step.id}" references unknown slotId "${step.slotId}"`);
    }
  }

  if (config.completion?.kind === 'slotsFilled') {
    for (const slotId of config.completion.slotIds) {
      if (!slotIds.has(slotId)) {
        errors.push(`completion: slotsFilled references unknown slotId "${slotId}"`);
      }
    }
  }

  if (config.tools.length === 0) {
    errors.push('tools: must be non-empty');
  }

  // A mode granted by a flag (rigTool / wordTool / tileTool) and then left
  // out of `contentTools` is a flag that grants nothing — and the loss runs
  // wider than the pushdown: the Tile mode is also what tells a format that
  // shapes may wear a PATTERN FILL (buttonArmingTool → shapePatternFills),
  // so Comic dropped the Pattern button from every shape's Effects page by
  // forgetting one word in a list. Caught here rather than read off the bar,
  // because the symptom shows up in the properties panel.
  for (const mode of deadContentModes(config, hostTools)) {
    errors.push(
      `contentTools: "${mode}" is turned on by its flag but not listed, so the flag does nothing`,
    );
  }

  if (!(config.canvas.aspect > 0)) {
    errors.push(`canvas: aspect must be > 0 (got ${config.canvas.aspect})`);
  }

  if (config.frame) {
    if (!(config.frame.cellWidth > 0) || !(config.frame.cellHeight > 0)) {
      errors.push(
        `frame: must have positive size (got ${config.frame.cellWidth}×${config.frame.cellHeight})`,
      );
    }
    // A member-less frame is only meaningful as a decorative board — it must
    // declare a background (else it's an invisible clip around nothing). A
    // frame WITH members clips them and may be background-less.
    if (config.frame.memberSlotIds.length === 0 && !config.frame.background) {
      errors.push('frame: memberSlotIds must be non-empty unless the frame has a background');
    }
    for (const slotId of config.frame.memberSlotIds) {
      if (!slotIds.has(slotId)) {
        errors.push(`frame: memberSlotIds references unknown slotId "${slotId}"`);
      }
    }
  }

  const decorIds = new Set<string>();
  for (const dec of config.decorTexts ?? []) {
    if (decorIds.has(dec.decorId)) {
      errors.push(`decorTexts: duplicate decorId "${dec.decorId}"`);
    }
    decorIds.add(dec.decorId);
    if (!(dec.cellWidth > 0) || !(dec.cellHeight > 0)) {
      errors.push(
        `decorTexts: "${dec.decorId}" must have positive size (got ${dec.cellWidth}×${dec.cellHeight})`,
      );
    }
    // `inFrame` asks to join a frame group that has to exist to be joined.
    if (dec.inFrame && !config.frame) {
      errors.push(`decorTexts: "${dec.decorId}" sets inFrame but the format declares no frame`);
    }
  }

  const requiredSlotIds =
    config.completion?.kind === 'allSlotsFilled'
      ? (config.scaffold ?? []).map((s) => s.slotId)
      : config.completion?.kind === 'slotsFilled'
        ? config.completion.slotIds.filter((id) => slotIds.has(id))
        : [];
  for (const slotId of requiredSlotIds) {
    if (!fillSlotIds.has(slotId)) {
      errors.push(`promptFlow: scaffold slot "${slotId}" has no fillSlot step`);
    }
  }

  return errors;
}
