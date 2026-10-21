import { SYSTEM_STACK, fontFamilyFor, registerFontFamily } from '../fontFamily';

// The node layer's one app-dependent reading: which CSS family a
// TextStyle.fontId resolves to. The rule is the package's, the PACK is the
// app's, installed from its web/fonts/loadPackFonts.ts the way the brush's
// glyph-ink probe is (docs/shared-editor.md §4.2 item 5).

describe('fontFamilyFor', () => {
  afterEach(() => registerFontFamily(null));

  it('is the system stack when no app has installed a pack', () => {
    // Which is what a unit test sees, and what an app shows before its
    // faces have loaded — never a throw and never an empty family.
    expect(fontFamilyFor('system')).toBe(SYSTEM_STACK);
    expect(fontFamilyFor('')).toBe(SYSTEM_STACK);
    expect(fontFamilyFor('karla')).toBe(SYSTEM_STACK);
  });

  it('goes through the installed pack once one is, for every id', () => {
    const asked: string[] = [];
    registerFontFamily((id) => {
      asked.push(id);
      return `'${id}-face', ${SYSTEM_STACK}`;
    });
    expect(fontFamilyFor('karla')).toBe(`'karla-face', ${SYSTEM_STACK}`);
    // 'system' and the empty id are the pack's to answer too: the rule for
    // them lives in the app's resolver, so the package does not shortcut
    // past it and leave the two spellings disagreeing.
    expect(fontFamilyFor('system')).toBe(`'system-face', ${SYSTEM_STACK}`);
    expect(asked).toEqual(['karla', 'system']);
  });

  it('falls back to the system stack again when the pack is uninstalled', () => {
    registerFontFamily(() => 'whatever');
    expect(fontFamilyFor('karla')).toBe('whatever');
    registerFontFamily(null);
    expect(fontFamilyFor('karla')).toBe(SYSTEM_STACK);
  });
});
