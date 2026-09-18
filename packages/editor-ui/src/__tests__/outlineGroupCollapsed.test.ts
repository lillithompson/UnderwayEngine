// A GROUP STARTS CLOSED in the scene outline.
//
// A group is made to put things away; one that springs open with its
// contents spread down the outline undoes the tidying in the same breath
// as it is done. So the panel remembers which groups have been OPENED,
// not which have been closed — a group just made is closed by simply not
// being in that set, with no frame in which it is drawn open and nothing
// that has to notice it is new and correct it afterwards.
//
// The reading of that set is outlineTree.collapsedGroups, tested for real
// in outlineTree.test.ts. SceneOutlinePanel can't be imported here (it
// pulls in @expo/vector-icons, which has no node shim), so the state's
// shape is pinned at the source — same approach as outlineDragGrab.
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(
  join(__dirname, '..', 'components', 'SceneOutlinePanel.tsx'),
  'utf8',
);

describe('the outline holds what has been OPENED', () => {
  it('starts with nothing open, so every group — a new one above all — is closed', () => {
    expect(SRC).toContain('const [expanded, setExpanded] = useState<Set<string>>(() => new Set());');
    // The old shape: a set of CLOSED ids starting empty, which drew every
    // group open and had no way to tell a new group from an old one.
    expect(SRC).not.toContain('const [collapsed, setCollapsed]');
    expect(SRC).not.toContain('setCollapsed(');
  });

  it('remembers each group’s state: the toggle adds and removes one id', () => {
    expect(SRC).toContain('setExpanded((prev) => {');
    expect(SRC).toContain('if (next.has(id)) next.delete(id); else next.add(id);');
  });

  it('reads the closed set back through the one function that decides it', () => {
    expect(SRC).toContain(
      'const collapsed = useMemo(() => collapsedGroups(tree, expanded), [tree, expanded]);',
    );
    expect(SRC).toContain('const rows = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed]);');
    // …and the chevron still says which way the group is, off that set.
    expect(SRC).toContain("accessibilityLabel={collapsed.has(row.id) ? 'Expand' : 'Collapse'}");
  });
});
