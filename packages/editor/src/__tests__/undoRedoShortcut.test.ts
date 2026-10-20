import { classifyUndoRedoKey } from '../undoRedoShortcut';

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

describe('classifyUndoRedoKey', () => {
  it('maps Ctrl+Z to undo and Ctrl+V to redo', () => {
    expect(classifyUndoRedoKey(key('z', { ctrlKey: true }), null)).toBe('undo');
    expect(classifyUndoRedoKey(key('v', { ctrlKey: true }), null)).toBe('redo');
  });

  it('accepts Cmd (metaKey) as the accelerator too, and is case-insensitive', () => {
    expect(classifyUndoRedoKey(key('Z', { metaKey: true }), null)).toBe('undo');
    expect(classifyUndoRedoKey(key('V', { metaKey: true }), null)).toBe('redo');
  });

  it('ignores the bare keys with no accelerator', () => {
    expect(classifyUndoRedoKey(key('z'), null)).toBeNull();
    expect(classifyUndoRedoKey(key('v'), null)).toBeNull();
  });

  it('ignores the combo when Alt or Shift is also held', () => {
    expect(classifyUndoRedoKey(key('z', { ctrlKey: true, altKey: true }), null)).toBeNull();
    expect(classifyUndoRedoKey(key('z', { ctrlKey: true, shiftKey: true }), null)).toBeNull();
    expect(classifyUndoRedoKey(key('v', { ctrlKey: true, shiftKey: true }), null)).toBeNull();
  });

  it('leaves the event alone inside a typing target so paste / native undo work', () => {
    const input = { tagName: 'INPUT', isContentEditable: false };
    const editable = { tagName: 'DIV', isContentEditable: true };
    expect(classifyUndoRedoKey(key('v', { ctrlKey: true }), input)).toBeNull();
    expect(classifyUndoRedoKey(key('z', { ctrlKey: true }), editable)).toBeNull();
  });

  it('returns null for other accelerator combos', () => {
    expect(classifyUndoRedoKey(key('y', { ctrlKey: true }), null)).toBeNull();
    expect(classifyUndoRedoKey(key('c', { ctrlKey: true }), null)).toBeNull();
  });
});
