import { foldLegacyGroupNames, LAST_NAME_STASHING_VERSION } from '../legacyGroupNames';

// Pre-v59 files hold a grouped member's own name in `preGroupName` (the
// group op cleared `name` and gave the first member the group's label). The
// fold puts every member's own name back where every reader now looks.

describe('foldLegacyGroupNames', () => {
  test('a grouped leaf takes its stash as its name — the group label it wore goes', () => {
    const leader = { groupId: 'g1', name: 'Group 1', preGroupName: 'Sun' };
    const member = { groupId: 'g1', name: undefined, preGroupName: 'Moon' };
    foldLegacyGroupNames(LAST_NAME_STASHING_VERSION, [[leader, member]], []);
    expect(leader).toEqual({ groupId: 'g1', name: 'Sun' });
    expect(member).toEqual({ groupId: 'g1', name: 'Moon' });
    expect('preGroupName' in leader).toBe(false);
  });

  test('a grouped leaf that had no name of its own is nameless, even the one wearing the label', () => {
    const leader = { groupId: 'g1', name: 'Group 1' };
    const member = { groupId: 'g1' };
    foldLegacyGroupNames(38, [[leader], [member]], []);
    expect(leader).toEqual({ groupId: 'g1' });
    expect('name' in leader).toBe(false);
    expect(member).toEqual({ groupId: 'g1' });
  });

  test('a rename made while grouped gives way to the stash, as the old ungroup would have', () => {
    const renamed = { groupId: 'g1', name: 'Renamed in group', preGroupName: 'Original' };
    foldLegacyGroupNames(58, [[renamed]], []);
    expect(renamed.name).toBe('Original');
  });

  test('a loose leaf keeps its name and only drops a stale stash; a group node drops its copy', () => {
    const loose = { name: 'arc', preGroupName: 'old' };
    const plain = { name: 'line' };
    const group = { name: 'Inner', preGroupName: 'Inner' };
    foldLegacyGroupNames(58, [[loose, plain]], [group]);
    expect(loose).toEqual({ name: 'arc' });
    expect(plain).toEqual({ name: 'line' });
    expect(group).toEqual({ name: 'Inner' });
  });

  test('a file written since grouping stopped stashing is left exactly as read', () => {
    const grouped = { groupId: 'g1', name: 'Sun' };
    const odd = { groupId: 'g1', name: 'Sun', preGroupName: 'x' };
    foldLegacyGroupNames(LAST_NAME_STASHING_VERSION + 1, [[grouped, odd]], []);
    expect(grouped).toEqual({ groupId: 'g1', name: 'Sun' });
    expect(odd).toEqual({ groupId: 'g1', name: 'Sun', preGroupName: 'x' });
  });
});
