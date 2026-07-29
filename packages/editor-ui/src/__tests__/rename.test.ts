import { resolveRename } from '../logic/rename';

describe('resolveRename', () => {
  it('commits a trimmed, changed name', () => {
    expect(resolveRename('  New Name  ', 'Old')).toEqual({ committed: true, name: 'New Name' });
  });
  it('reverts an empty/whitespace name to the original', () => {
    expect(resolveRename('   ', 'Old')).toEqual({ committed: false, name: 'Old' });
  });
  it('treats an unchanged name as a no-op', () => {
    expect(resolveRename('Old', 'Old')).toEqual({ committed: false, name: 'Old' });
  });
});
