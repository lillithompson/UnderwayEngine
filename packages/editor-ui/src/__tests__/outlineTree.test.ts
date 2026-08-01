import {
  computeOutlineTree,
  flattenTree,
  treeToSceneOrder,
  reparentToSceneOrder,
} from '../logic/outlineTree';
import type { OutlineObject } from '../adapter';

function leaf(id: string, parentGroupId?: string, extra?: Partial<OutlineObject>): OutlineObject {
  return { id, kind: 'svg', name: id, parentGroupId, locked: false, hidden: false, ...extra };
}
function group(id: string, parentGroupId?: string): OutlineObject {
  return { id, kind: 'group', name: id, parentGroupId, locked: false, hidden: false };
}
function mapOf(...objs: OutlineObject[]): Map<string, OutlineObject> {
  return new Map(objs.map((o) => [o.id, o]));
}

describe('computeOutlineTree', () => {
  it('nests leaves under their group, ordered front→back (top→bottom)', () => {
    // sceneOrder back→front: [boundary, a, b]; a,b in group G.
    const objects = mapOf(group('G'), leaf('a', 'G'), leaf('b', 'G'), leaf('top'));
    // top is front-most (last in sceneOrder) so it sits above the group.
    const tree = computeOutlineTree(objects, ['a', 'b', 'top']);
    expect(tree.map((n) => n.id)).toEqual(['top', 'G']);
    const g = tree.find((n) => n.id === 'G')!;
    // Within G: b (front) above a (back).
    expect(g.children.map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('handles nested groups (group inside group)', () => {
    const objects = mapOf(group('outer'), group('inner', 'outer'), leaf('a', 'inner'), leaf('b', 'outer'));
    const tree = computeOutlineTree(objects, ['a', 'b']);
    const outer = tree.find((n) => n.id === 'outer')!;
    expect(outer.children.some((c) => c.id === 'inner')).toBe(true);
    const inner = outer.children.find((c) => c.id === 'inner')!;
    expect(inner.children.map((c) => c.id)).toEqual(['a']);
  });

  it('marks chrome leaves (frame boundary) but keeps them in the tree', () => {
    const objects = mapOf(group('G'), leaf('boundary', 'G', { chrome: true }), leaf('a', 'G'));
    const tree = computeOutlineTree(objects, ['boundary', 'a']);
    const g = tree.find((n) => n.id === 'G')!;
    expect(g.children.find((c) => c.id === 'boundary')?.chrome).toBe(true);
  });
});

describe('flattenTree', () => {
  const objects = mapOf(group('G'), leaf('boundary', 'G', { chrome: true }), leaf('a', 'G'), leaf('b', 'G'));
  const tree = computeOutlineTree(objects, ['boundary', 'a', 'b']);

  it('shows group + indented children, and never the chrome boundary', () => {
    const rows = flattenTree(tree, new Set());
    expect(rows.map((r) => r.id)).toEqual(['G', 'b', 'a']); // boundary omitted
    expect(rows.find((r) => r.id === 'G')!.depth).toBe(0);
    expect(rows.find((r) => r.id === 'a')!.depth).toBe(1);
  });

  it('collapse hides a group\'s descendants', () => {
    const rows = flattenTree(tree, new Set(['G']));
    expect(rows.map((r) => r.id)).toEqual(['G']);
    expect(rows[0].hasChildren).toBe(true); // chevron still shown
  });
});

describe('treeToSceneOrder', () => {
  it('round-trips the leaf order (including chrome), groups excluded', () => {
    const order = ['boundary', 'a', 'b', 'top'];
    const objects = mapOf(group('G'), leaf('boundary', 'G', { chrome: true }), leaf('a', 'G'), leaf('b', 'G'), leaf('top'));
    const tree = computeOutlineTree(objects, order);
    expect(treeToSceneOrder(tree).sort()).toEqual([...order].sort());
    // Contiguity: the group's leaves form one run.
    const out = treeToSceneOrder(tree);
    const gi = ['boundary', 'a', 'b'].map((id) => out.indexOf(id)).sort((x, y) => x - y);
    expect(gi[2] - gi[0]).toBe(2);
  });
});

describe('reparentToSceneOrder', () => {
  const objects = mapOf(group('G'), leaf('boundary', 'G', { chrome: true }), leaf('a', 'G'), leaf('top'));
  const tree = computeOutlineTree(objects, ['boundary', 'a', 'top']);

  it('moves a top-level leaf into the group', () => {
    const out = reparentToSceneOrder(tree, 'top', 'G', null);
    // top now clusters with G's leaves; still a permutation.
    expect(out.sort()).toEqual(['a', 'boundary', 'top']);
    const idxTop = out.indexOf('top');
    const idxA = out.indexOf('a');
    const idxB = out.indexOf('boundary');
    // All three (G's members) contiguous.
    const span = Math.max(idxTop, idxA, idxB) - Math.min(idxTop, idxA, idxB);
    expect(span).toBe(2);
  });

  it('moves a leaf out to top level (no crash, permutation preserved)', () => {
    const out = reparentToSceneOrder(tree, 'a', null, null);
    expect(out.sort()).toEqual(['a', 'boundary', 'top']);
  });
});
