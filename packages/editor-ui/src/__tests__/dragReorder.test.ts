import { computeDropTarget, dragTargetIndex } from '../logic/dragReorder';
import type { FlatOutlineRow } from '../logic/outlineTree';
import type { OutlineObject } from '../adapter';

const ROW = 44;
const INDENT = 16;

function leaf(id: string, parentGroupId?: string): OutlineObject {
  return { id, kind: 'svg', name: id, parentGroupId, locked: false, hidden: false };
}
function group(id: string, parentGroupId?: string): OutlineObject {
  return { id, kind: 'group', name: id, parentGroupId, locked: false, hidden: false };
}
function mapOf(...objs: OutlineObject[]): Map<string, OutlineObject> {
  return new Map(objs.map((o) => [o.id, o]));
}
function row(id: string, depth: number, isGroup = false, hasChildren = false): FlatOutlineRow {
  return { id, depth, isGroup, hasChildren };
}

describe('dragTargetIndex', () => {
  it('rounds dy/rowHeight and clamps to [0, count-1]', () => {
    expect(dragTargetIndex(1, 0, ROW, 4)).toBe(1);
    expect(dragTargetIndex(1, ROW, ROW, 4)).toBe(2);
    expect(dragTargetIndex(1, -ROW * 5, ROW, 4)).toBe(0);
    expect(dragTargetIndex(1, ROW * 10, ROW, 4)).toBe(3);
  });
});

describe('computeDropTarget', () => {
  // A frame group G (row 0) with two leaf children a, b (rows 1, 2), then a
  // top-level leaf c (row 3).
  const objects = mapOf(group('G'), leaf('a', 'G'), leaf('b', 'G'), leaf('c'));
  const rows = [row('G', 0, true, true), row('a', 1), row('b', 1), row('c', 0)];

  it('dragging a top-level leaf up onto the group nests it (into G)', () => {
    // Drag c (index 3) up to just below the group header (slot after row 0).
    const t = computeDropTarget(rows, objects, 3, -ROW * 2.5, 0, ROW, INDENT);
    expect(t.parentId).toBe('G');
    expect(t.depth).toBe(1);
  });

  it('horizontal outdent drops a child at top level', () => {
    // Drag child b (index 2) with a strong left nudge → outdent to top level.
    const t = computeDropTarget(rows, objects, 2, 0, -INDENT * 3, ROW, INDENT);
    expect(t.parentId).toBeNull();
    expect(t.depth).toBe(0);
  });

  it('a leaf reordered within its group stays in the group', () => {
    // Drag b (index 2) up one slot to before a — still a child of G.
    const t = computeDropTarget(rows, objects, 2, -ROW, 0, ROW, INDENT);
    expect(t.parentId).toBe('G');
    expect(t.beforeId).toBe('a');
  });

  it('excludes the dragged group\'s own subtree from the slot math', () => {
    // Dragging the group G down past its own children shouldn't try to nest G
    // into itself; parent resolves to top level or the trailing sibling.
    const t = computeDropTarget(rows, objects, 0, ROW * 3, 0, ROW, INDENT);
    expect(t.parentId).not.toBe('G');
  });
});
