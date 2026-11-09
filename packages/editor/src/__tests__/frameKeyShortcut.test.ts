import { isFrameSelectionKey } from '../frameKeyShortcut';

const key = (
  k: string,
  mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {},
) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('isFrameSelectionKey', () => {
  it('is a bare F, in either case', () => {
    expect(isFrameSelectionKey(key('f'), null)).toBe(true);
    expect(isFrameSelectionKey(key('F'), null)).toBe(true);
    expect(isFrameSelectionKey(key('f'), { tagName: 'DIV', isContentEditable: false })).toBe(true);
  });

  it('leaves every modified F alone (Cmd/Ctrl+F is the browser\'s Find)', () => {
    for (const mod of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey'] as const) {
      expect([mod, isFrameSelectionKey(key('f', { [mod]: true }), null)]).toEqual([mod, false]);
    }
  });

  it('is never a letter typed into a field', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'input']) {
      expect(isFrameSelectionKey(key('f'), { tagName, isContentEditable: false })).toBe(false);
    }
    expect(isFrameSelectionKey(key('f'), { tagName: 'DIV', isContentEditable: true })).toBe(false);
  });

  it('ignores other keys', () => {
    for (const k of ['g', 'Enter', 'Backspace', 'ƒ']) expect(isFrameSelectionKey(key(k), null)).toBe(false);
  });
});
