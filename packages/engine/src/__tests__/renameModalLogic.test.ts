import { resolveRename } from '../renameModalLogic';

describe('resolveRename', () => {
  it('commits a trimmed non-empty name that differs from original', () => {
    expect(resolveRename('  Hello ', 'Original')).toEqual({ committed: true, name: 'Hello' });
  });

  it('does not commit when the trimmed value equals the original', () => {
    expect(resolveRename('Original', 'Original')).toEqual({ committed: false, name: 'Original' });
  });

  it('does not commit when the trimmed value equals the original after trimming', () => {
    expect(resolveRename('  Original ', 'Original')).toEqual({ committed: false, name: 'Original' });
  });

  it('does not commit when the input is empty', () => {
    expect(resolveRename('', 'Original')).toEqual({ committed: false, name: 'Original' });
  });

  it('does not commit when the input is only whitespace', () => {
    expect(resolveRename('   ', 'Original')).toEqual({ committed: false, name: 'Original' });
  });

  it('preserves internal spaces in the committed name', () => {
    expect(resolveRename(' My  File ', 'Original')).toEqual({ committed: true, name: 'My  File' });
  });
});
