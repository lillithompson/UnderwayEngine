import { insertAfterInLibraryGroup, nextLibraryGroupName, pruneLibraryGroups, LibraryFigureGroup } from '../libraryFigureGroups';

describe('nextLibraryGroupName', () => {
  it('returns Group 1 for empty array', () => {
    expect(nextLibraryGroupName([])).toBe('Group 1');
  });

  it('increments past existing groups', () => {
    const groups: LibraryFigureGroup[] = [
      { id: '1', name: 'Group 1', fileIds: ['a'] },
      { id: '2', name: 'Group 3', fileIds: ['b'] },
    ];
    expect(nextLibraryGroupName(groups)).toBe('Group 4');
  });

  it('ignores non-matching names', () => {
    const groups: LibraryFigureGroup[] = [
      { id: '1', name: 'My Figures', fileIds: ['a'] },
      { id: '2', name: 'Group 2', fileIds: ['b'] },
    ];
    expect(nextLibraryGroupName(groups)).toBe('Group 3');
  });
});

describe('pruneLibraryGroups', () => {
  it('returns same reference when no changes needed', () => {
    const groups: LibraryFigureGroup[] = [
      { id: '1', name: 'Group 1', fileIds: ['a', 'b'] },
    ];
    const valid = new Set(['a', 'b', 'c']);
    const result = pruneLibraryGroups(groups, valid);
    expect(result).toBe(groups);
  });

  it('removes invalid fileIds from groups', () => {
    const groups: LibraryFigureGroup[] = [
      { id: '1', name: 'Group 1', fileIds: ['a', 'b', 'c'] },
    ];
    const valid = new Set(['a', 'c']);
    const result = pruneLibraryGroups(groups, valid);
    expect(result).not.toBe(groups);
    expect(result).toHaveLength(1);
    expect(result[0].fileIds).toEqual(['a', 'c']);
  });

  it('drops groups that become empty', () => {
    const groups: LibraryFigureGroup[] = [
      { id: '1', name: 'Group 1', fileIds: ['a'] },
      { id: '2', name: 'Group 2', fileIds: ['b', 'c'] },
    ];
    const valid = new Set(['b', 'c']);
    const result = pruneLibraryGroups(groups, valid);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
    expect(result[0].fileIds).toEqual(['b', 'c']);
  });

  it('handles all groups becoming empty', () => {
    const groups: LibraryFigureGroup[] = [
      { id: '1', name: 'Group 1', fileIds: ['a'] },
    ];
    const valid = new Set<string>();
    const result = pruneLibraryGroups(groups, valid);
    expect(result).toEqual([]);
  });
});

describe('insertAfterInLibraryGroup', () => {
  it('inserts the new fileId immediately after the anchor', () => {
    const groups: LibraryFigureGroup[] = [
      { id: '1', name: 'Group 1', fileIds: ['a', 'b', 'c'] },
    ];
    const result = insertAfterInLibraryGroup(groups, 'b', 'b_copy');
    expect(result[0].fileIds).toEqual(['a', 'b', 'b_copy', 'c']);
  });

  it('inserts at end when anchor is last', () => {
    const groups: LibraryFigureGroup[] = [
      { id: '1', name: 'Group 1', fileIds: ['a', 'b'] },
    ];
    const result = insertAfterInLibraryGroup(groups, 'b', 'b_copy');
    expect(result[0].fileIds).toEqual(['a', 'b', 'b_copy']);
  });

  it('returns the same reference when anchor is not in any group', () => {
    const groups: LibraryFigureGroup[] = [
      { id: '1', name: 'Group 1', fileIds: ['a', 'b'] },
      { id: '2', name: 'Group 2', fileIds: ['c'] },
    ];
    const result = insertAfterInLibraryGroup(groups, 'z', 'z_copy');
    expect(result).toBe(groups);
  });

  it('returns the same reference when newFileId is already in the anchor group', () => {
    const groups: LibraryFigureGroup[] = [
      { id: '1', name: 'Group 1', fileIds: ['a', 'b'] },
    ];
    const result = insertAfterInLibraryGroup(groups, 'a', 'b');
    expect(result).toBe(groups);
  });

  it('only modifies the group that contains the anchor', () => {
    const groups: LibraryFigureGroup[] = [
      { id: '1', name: 'Group 1', fileIds: ['a', 'b'] },
      { id: '2', name: 'Group 2', fileIds: ['c', 'd'] },
    ];
    const result = insertAfterInLibraryGroup(groups, 'c', 'c_copy');
    expect(result[0]).toBe(groups[0]);
    expect(result[1].fileIds).toEqual(['c', 'c_copy', 'd']);
  });
});
