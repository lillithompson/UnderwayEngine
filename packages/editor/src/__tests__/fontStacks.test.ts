import {
  FONT_BODY_CSS, FONT_BODY_SEMI_CSS, FONT_DISPLAY_CSS,
} from '../fontStacks';

// The three faces the editor's web-side chrome names. Byte-identical in all
// three apps before stage 6.5a of docs/shared-editor.md.

describe('fontStacks — every run of text names its face', () => {
  it('each stack ends in a generic family, so nothing falls back to Times', () => {
    expect(FONT_DISPLAY_CSS.endsWith('serif')).toBe(true);
    expect(FONT_BODY_CSS.endsWith('sans-serif')).toBe(true);
    expect(FONT_BODY_SEMI_CSS.endsWith('sans-serif')).toBe(true);
  });

  it('the display face is a serif and the body a sans, and they are not the same', () => {
    expect(FONT_DISPLAY_CSS).not.toEqual(FONT_BODY_CSS);
    expect(FONT_DISPLAY_CSS).toContain('Newsreader');
    expect(FONT_BODY_CSS).toContain('Karla');
  });

  it('the semibold body is the body face at another weight, not another family', () => {
    // The two differ in the loaded family NAME (the weight is baked into
    // the webfont), and both name plain Karla as the step before the
    // generic — a page without the webfont keeps one family throughout.
    expect(FONT_BODY_SEMI_CSS).not.toEqual(FONT_BODY_CSS);
    for (const stack of [FONT_BODY_CSS, FONT_BODY_SEMI_CSS]) {
      expect(stack.split(',').map((s) => s.trim()).slice(1)).toEqual(['Karla', 'sans-serif']);
    }
  });

  it('every stack is a comma list with no empty slot', () => {
    for (const stack of [FONT_DISPLAY_CSS, FONT_BODY_CSS, FONT_BODY_SEMI_CSS]) {
      const faces = stack.split(',').map((s) => s.trim());
      expect(faces.length).toBeGreaterThanOrEqual(3);
      expect(faces.every((f) => f.length > 0)).toBe(true);
    }
  });
});
