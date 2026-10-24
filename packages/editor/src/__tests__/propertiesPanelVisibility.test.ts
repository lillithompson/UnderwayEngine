import { objectPropertiesPanelVisible } from '../propertiesPanelVisibility';

// One declaration, byte-identical in all three apps before stage 6.5a of
// docs/shared-editor.md. The same flag gates the desktop Delete key, so
// "the Delete button is on screen" has exactly one definition.

const PANEL = { hasSelection: true, editingText: false, brushToolActive: false };

describe('objectPropertiesPanelVisible — who occupies the bottom-center strip', () => {
  it('a selection brings the panel up, whatever tool is armed', () => {
    expect(objectPropertiesPanelVisible(PANEL)).toBe(true);
  });

  it('nothing selected, no panel: it describes an object, and there is none', () => {
    expect(objectPropertiesPanelVisible({ ...PANEL, hasSelection: false })).toBe(false);
  });

  it('the text overlay wins the strip — the two bottom sheets never stack', () => {
    expect(objectPropertiesPanelVisible({ ...PANEL, editingText: true })).toBe(false);
  });

  it('a colours-group brush wins it too, and the panel comes back when the brush is put down', () => {
    expect(objectPropertiesPanelVisible({ ...PANEL, brushToolActive: true })).toBe(false);
    expect(objectPropertiesPanelVisible({ ...PANEL, brushToolActive: false })).toBe(true);
  });

  it('either overlay alone suppresses it; both do not somehow cancel out', () => {
    expect(objectPropertiesPanelVisible({
      hasSelection: true, editingText: true, brushToolActive: true,
    })).toBe(false);
  });
});
