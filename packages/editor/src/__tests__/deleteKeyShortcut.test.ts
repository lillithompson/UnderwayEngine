import {
  DESKTOP_POINTER_QUERY,
  isDeleteKey,
  isDesktopWeb,
  isTypingTarget,
  shouldDeleteSelection,
} from '../deleteKeyShortcut';

const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...mods,
});

describe('isDesktopWeb', () => {
  const media = (matches: boolean) => (q: string) => {
    expect(q).toBe(DESKTOP_POINTER_QUERY);
    return { matches };
  };

  it('is true in a browser with a mouse/trackpad', () => {
    expect(isDesktopWeb({ isInWebView: () => false, matchMedia: media(true) })).toBe(true);
  });

  it('is false on a touch-only browser (coarse pointer)', () => {
    expect(isDesktopWeb({ isInWebView: () => false, matchMedia: media(false) })).toBe(false);
  });

  it('is false inside the native WebView shell, mouse or not', () => {
    expect(isDesktopWeb({ isInWebView: () => true, matchMedia: media(true) })).toBe(false);
  });

  it('is false with no DOM to query', () => {
    expect(isDesktopWeb({ isInWebView: () => false, matchMedia: null })).toBe(false);
  });
});

describe('isDeleteKey', () => {
  it('accepts the bare Delete and Backspace keys', () => {
    expect(isDeleteKey(key('Backspace'))).toBe(true);
    expect(isDeleteKey(key('Delete'))).toBe(true);
  });

  it('ignores every other key', () => {
    for (const k of ['a', 'Enter', 'Escape', 'ArrowLeft', 'd']) {
      expect(isDeleteKey(key(k))).toBe(false);
    }
  });

  it('ignores modified presses (⌘⌫ and friends belong to the browser)', () => {
    expect(isDeleteKey(key('Backspace', { metaKey: true }))).toBe(false);
    expect(isDeleteKey(key('Backspace', { ctrlKey: true }))).toBe(false);
    expect(isDeleteKey(key('Delete', { altKey: true }))).toBe(false);
  });
});

describe('isTypingTarget', () => {
  it('recognizes form fields regardless of tag casing', () => {
    expect(isTypingTarget({ tagName: 'TEXTAREA', isContentEditable: false })).toBe(true);
    expect(isTypingTarget({ tagName: 'input', isContentEditable: false })).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT', isContentEditable: false })).toBe(true);
  });

  it('recognizes contenteditable hosts', () => {
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('is false for ordinary elements and for no target', () => {
    expect(isTypingTarget({ tagName: 'CANVAS', isContentEditable: false })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('shouldDeleteSelection', () => {
  const canvas = { tagName: 'CANVAS', isContentEditable: false };
  const ctx = { desktopWeb: true, deletableSelection: true, target: canvas };

  it('deletes on a bare Delete/Backspace over the canvas', () => {
    expect(shouldDeleteSelection(key('Backspace'), ctx)).toBe(true);
    expect(shouldDeleteSelection(key('Delete'), ctx)).toBe(true);
  });

  it('never fires off desktop web', () => {
    expect(shouldDeleteSelection(key('Backspace'), { ...ctx, desktopWeb: false })).toBe(false);
  });

  it('never fires with nothing deletable selected', () => {
    expect(shouldDeleteSelection(key('Backspace'), { ...ctx, deletableSelection: false })).toBe(false);
  });

  it('leaves the key to the field while typing', () => {
    const typing = { ...ctx, target: { tagName: 'TEXTAREA', isContentEditable: false } };
    expect(shouldDeleteSelection(key('Backspace'), typing)).toBe(false);
  });

  it('ignores other keys and modified presses', () => {
    expect(shouldDeleteSelection(key('x'), ctx)).toBe(false);
    expect(shouldDeleteSelection(key('Backspace', { metaKey: true }), ctx)).toBe(false);
  });
});
