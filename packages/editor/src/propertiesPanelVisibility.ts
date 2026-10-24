// Who occupies the bottom-center strip: the object-properties panel, and the
// rig's Turn slider that stands on top of it.
//
// A selection is the user pointing at an object to say something about it, so
// the panel that describes it comes up whenever anything is selected —
// whatever tool is armed. The panel rides with the selection, not with the
// tool: a tap no longer disarms the brush (see select), and it shouldn't have
// to in order to expose the object's properties. Only overlays that would
// collide with the panel suppress it — including the brush-size slider,
// which claims the same bottom-center strip while any colours-group brush
// is armed, the recolour brush included (the one tool-keyed exception to
// "the panel follows the selection").
//
// The same flag also gates the desktop Delete key (see deleteKeyShortcut) —
// "the Delete button is on screen" has exactly one definition.
//
// One declaration, byte-identical in all three apps (stage 6.5a of
// docs/shared-editor.md). CozyJournal keeps `rigTurnSliderVisible` beside a
// re-export of it, that being a question only an app with a rig can ask;
// Sol and DrawBots had nothing else here and their importers read this file
// directly.

export function objectPropertiesPanelVisible(input: {
  /** A leaf item or a frame group is selected (the panel has a target). */
  hasSelection: boolean;
  /** The text overlay is up — the two bottom sheets must never stack. */
  editingText: boolean;
  /** A colours-group brush (color / paint / erase / blur / push) is armed,
   *  so the brush-size slider stands where the panel would; the panel
   *  slides away for it and comes back when the brush is put down. */
  brushToolActive: boolean;
}): boolean {
  return input.hasSelection && !input.editingText && !input.brushToolActive;
}
