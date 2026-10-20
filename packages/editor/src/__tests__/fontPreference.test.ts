import { DEFAULT_FONT_ID, resolveDefaultFontId, shouldRememberFont } from '../fontPreference';

describe('resolveDefaultFontId', () => {
  it('uses the stored last-chosen font when one is present', () => {
    expect(resolveDefaultFontId('Karla')).toBe('Karla');
  });

  it('falls back to the default font when nothing has been chosen', () => {
    expect(resolveDefaultFontId(undefined)).toBe(DEFAULT_FONT_ID);
    expect(resolveDefaultFontId(null)).toBe(DEFAULT_FONT_ID);
  });

  it('treats an empty stored value as no preference', () => {
    expect(resolveDefaultFontId('')).toBe(DEFAULT_FONT_ID);
  });

  it('lets a format’s opening font outrank the remembered one', () => {
    expect(resolveDefaultFontId('Karla', 'dm-serif-display')).toBe('dm-serif-display');
  });

  it('uses a format’s opening font when nothing has been remembered', () => {
    expect(resolveDefaultFontId(undefined, 'dm-serif-display')).toBe('dm-serif-display');
    expect(resolveDefaultFontId(null, 'dm-serif-display')).toBe('dm-serif-display');
  });

  it('ignores an absent or empty opening font', () => {
    expect(resolveDefaultFontId('Karla', undefined)).toBe('Karla');
    expect(resolveDefaultFontId('Karla', null)).toBe('Karla');
    expect(resolveDefaultFontId('Karla', '')).toBe('Karla');
    expect(resolveDefaultFontId(undefined, '')).toBe(DEFAULT_FONT_ID);
  });
});

describe('shouldRememberFont', () => {
  it('remembers a font that differs from the node’s previous font', () => {
    expect(shouldRememberFont('system', 'Karla')).toBe(true);
  });

  it('does not re-save when the font is unchanged (e.g. a size/color-only commit)', () => {
    expect(shouldRememberFont('Karla', 'Karla')).toBe(false);
  });

  it('remembers a first font choice on a node that had no prior font', () => {
    expect(shouldRememberFont(undefined, 'Karla')).toBe(true);
  });

  it('never remembers an empty font id', () => {
    expect(shouldRememberFont('Karla', '')).toBe(false);
  });
});
