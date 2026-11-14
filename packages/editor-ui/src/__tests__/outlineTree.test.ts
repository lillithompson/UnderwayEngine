import {
  collapsedGroups,
  computeOutlineTree,
  flattenTree,
  liftedIds,
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

// A GROUP STARTS CLOSED. The panel holds the set of groups the reader has
// OPENED, and this reads it back as the set that is closed — so a group
// just made is closed by simply not being in the set, with no frame in
// which it is drawn open and nothing to notice it is new.
describe('collapsedGroups', () => {
  //        G
  //        ├─ a
  //        └─ H
  //           └─ c
  const objects = mapOf(
    group('G'), leaf('a', 'G'), group('H', 'G'), leaf('c', 'H'), leaf('top'),
  );
  const tree = computeOutlineTree(objects, ['a', 'c', 'top']);

  it('closes every group when nothing has been opened — a new group included', () => {
    expect(collapsedGroups(tree, new Set())).toEqual(new Set(['G', 'H']));
    // …and the flatten that reads it shows the closed group and no more.
    expect(flattenTree(tree, collapsedGroups(tree, new Set())).map((r) => r.id))
      .toEqual(['top', 'G']);
  });

  it('leaves a group the reader opened open, and closes it again when they close it', () => {
    expect(collapsedGroups(tree, new Set(['G']))).toEqual(new Set(['H']));
    expect(flattenTree(tree, collapsedGroups(tree, new Set(['G']))).map((r) => r.id))
      .toEqual(['top', 'G', 'H', 'a']);
    // Nested: opening both walks the whole way down.
    expect(collapsedGroups(tree, new Set(['G', 'H']))).toEqual(new Set());
    expect(flattenTree(tree, collapsedGroups(tree, new Set(['G', 'H']))).map((r) => r.id))
      .toEqual(['top', 'G', 'H', 'c', 'a']);
    // Closing G again puts it back, and H's own state is untouched.
    expect(collapsedGroups(tree, new Set(['H']))).toEqual(new Set(['G']));
  });

  it('never names a leaf, whatever the opened set says', () => {
    expect(collapsedGroups(tree, new Set(['a', 'top']))).toEqual(new Set(['G', 'H']));
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

describe('a scene row the host lists among its overlays (OutlineObject.overRank)', () => {
  // Paint order back→front: a, trail, b. Overlays: two markers (rank 0, 1)
  // and a walker (rank 10). The trail is listed under the walker, over
  // the markers.
  const objects = mapOf(
    leaf('a'), leaf('trail', undefined, { overRank: 9.5 }), leaf('b'),
    leaf('m0', undefined, { overlayRank: 0 }), leaf('m1', undefined, { overlayRank: 1 }),
    leaf('walker', undefined, { overlayRank: 10 }),
  );
  const order = ['a', 'trail', 'b'];
  const tree = computeOutlineTree(objects, order);

  it('is shown at its rank among them, and the rest of the scene below', () => {
    expect(flattenTree(tree, new Set()).map((r) => r.id)).toEqual(['walker', 'trail', 'm1', 'm0', 'b', 'a']);
    expect([...liftedIds(tree)]).toEqual(['trail']);
  });

  it('stands in the tree where the paint order has it, so a reorder leaves it there', () => {
    expect(tree.map((n) => n.id)).toEqual(['walker', 'm1', 'm0', 'b', 'trail', 'a']);
    expect(treeToSceneOrder(tree)).toEqual(order);
    // Another row dragged to the top level's end goes to the back, and
    // the lifted one keeps its place between the other two.
    expect(reparentToSceneOrder(tree, 'b', null, null)).toEqual(['b', 'a', 'trail']);
  });

  it('keeps the paint order among lifted rows of one rank, under an overlay of that rank', () => {
    const many = mapOf(
      leaf('t1', undefined, { overRank: 1 }), leaf('x'), leaf('t2', undefined, { overRank: 1 }),
      leaf('m1', undefined, { overlayRank: 1 }),
    );
    const t = computeOutlineTree(many, ['t1', 'x', 't2']);
    expect(flattenTree(t, new Set()).map((r) => r.id)).toEqual(['m1', 't2', 't1', 'x']);
  });

  it('is not lifted out of a group that holds anything else: there the paint order places it', () => {
    const grouped = mapOf(
      group('G'), leaf('trail', 'G', { overRank: 9.5 }), leaf('a', 'G'), leaf('top'),
      leaf('m0', undefined, { overlayRank: 0 }),
    );
    const t = computeOutlineTree(grouped, ['trail', 'a', 'top']);
    expect(flattenTree(t, new Set()).map((r) => r.id)).toEqual(['m0', 'top', 'G', 'a', 'trail']);
    expect(liftedIds(t).size).toBe(0);
  });

  it('a group of nothing but such rows is lifted whole, to the highest of them, an overlay riding it aside', () => {
    const folded = mapOf(
      leaf('a'), group('G'), leaf('t1', 'G', { overRank: 9.5 }), group('H', 'G'), leaf('t2', 'H', { overRank: 9.5 }),
      leaf('rider', 'G', { overlayRank: 3 }), leaf('b'),
      leaf('m0', undefined, { overlayRank: 0 }), leaf('walker', undefined, { overlayRank: 10 }),
    );
    const order = ['a', 't1', 't2', 'b'];
    const t = computeOutlineTree(folded, order);
    expect(flattenTree(t, new Set()).map((r) => r.id)).toEqual(['walker', 'G', 'rider', 'H', 't2', 't1', 'm0', 'b', 'a']);
    // Closed, as a group starts: one row.
    expect(flattenTree(t, new Set(['G'])).map((r) => r.id)).toEqual(['walker', 'G', 'm0', 'b', 'a']);
    expect([...liftedIds(t)].sort()).toEqual(['G', 'H', 'rider', 't1', 't2']);
    expect(treeToSceneOrder(t)).toEqual(order);
  });

  it('an empty group, and a group of overlays alone, are not lifted', () => {
    const t = computeOutlineTree(mapOf(group('E'), group('O'), leaf('rider', 'O', { overlayRank: 3 }), leaf('a')), ['a']);
    expect(liftedIds(t).size).toBe(0);
  });

  it('with none lifted, the rows are the tree’s own', () => {
    const plain = computeOutlineTree(mapOf(leaf('a'), leaf('b')), ['a', 'b']);
    expect(flattenTree(plain, new Set()).map((r) => r.id)).toEqual(['b', 'a']);
  });
});
