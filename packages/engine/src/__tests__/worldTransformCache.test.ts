import { WorldTransformCache, NodeTransformInfo } from '../worldTransformCache';
import { Transform2D, Bbox, IDENTITY, applyToBbox, compose } from '../transform2d';

// ── Helpers ────────────────────────────────────────────────────────────

function makeNodes(defs: { id: string; parentId?: string; transform: Transform2D }[]): Map<string, NodeTransformInfo> {
  const map = new Map<string, NodeTransformInfo>();
  for (const d of defs) {
    map.set(d.id, { id: d.id, parentId: d.parentId, transform: d.transform });
  }
  return map;
}

function getNodeFn(map: Map<string, NodeTransformInfo>) {
  return (id: string) => map.get(id);
}

function closeTo(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

function bboxClose(a: Bbox, b: Bbox, eps = 1e-9): boolean {
  return closeTo(a.x, b.x, eps) && closeTo(a.y, b.y, eps)
    && closeTo(a.width, b.width, eps) && closeTo(a.height, b.height, eps);
}

const T_TRANSLATE: Transform2D = { ...IDENTITY, tx: 10, ty: 20 };
const T_SCALE2X: Transform2D = { ...IDENTITY, sx: 2, sy: 2 };
const T_COMPLEX: Transform2D = { tx: 5, ty: -3, sx: 2, sy: 1.5, rotation: 90, mirrorH: true, mirrorV: false };

// ── Tests ──────────────────────────────────────────────────────────────

describe('WorldTransformCache', () => {
  test('root node returns its own transform as world transform', () => {
    const cache = new WorldTransformCache();
    const nodes = makeNodes([{ id: 'a', transform: T_TRANSLATE }]);
    const wt = cache.getWorldTransform('a', getNodeFn(nodes));
    expect(wt.tx).toBe(10);
    expect(wt.ty).toBe(20);
    expect(wt.sx).toBe(1);
    expect(wt.sy).toBe(1);
    expect(wt.rotation).toBe(0);
  });

  test('child composes with parent (parent applied after child)', () => {
    const cache = new WorldTransformCache();
    const nodes = makeNodes([
      { id: 'parent', transform: T_SCALE2X },
      { id: 'child', parentId: 'parent', transform: T_TRANSLATE },
    ]);
    const wt = cache.getWorldTransform('child', getNodeFn(nodes));

    // Manual: child(p) = translate(10,20)(p), then parent = scale2x
    // So world(p) = scale2x(translate(10,20)(p))
    // For point (0,0): translate -> (10,20), scale2x -> (20,40)
    const bbox: Bbox = { x: 0, y: 0, width: 1, height: 1 };
    const result = applyToBbox(wt, bbox);
    expect(closeTo(result.x, 20)).toBe(true);
    expect(closeTo(result.y, 40)).toBe(true);
    expect(closeTo(result.width, 2)).toBe(true);
    expect(closeTo(result.height, 2)).toBe(true);
  });

  test('three-level hierarchy composes correctly', () => {
    const cache = new WorldTransformCache();
    const grandparent: Transform2D = { ...IDENTITY, tx: 100, ty: 100 };
    const parent: Transform2D = { ...IDENTITY, sx: 2, sy: 2 };
    const child: Transform2D = { ...IDENTITY, tx: 5, ty: 5 };
    const nodes = makeNodes([
      { id: 'gp', transform: grandparent },
      { id: 'p', parentId: 'gp', transform: parent },
      { id: 'c', parentId: 'p', transform: child },
    ]);

    const wt = cache.getWorldTransform('c', getNodeFn(nodes));
    const bbox: Bbox = { x: 0, y: 0, width: 1, height: 1 };
    const result = applyToBbox(wt, bbox);

    // Manual: child(0,0,1,1) -> (5,5,1,1), parent(scale2x) -> (10,10,2,2),
    //         grandparent(t100,100) -> (110,110,2,2)
    expect(closeTo(result.x, 110)).toBe(true);
    expect(closeTo(result.y, 110)).toBe(true);
    expect(closeTo(result.width, 2)).toBe(true);
    expect(closeTo(result.height, 2)).toBe(true);
  });

  test('cache returns same result on second call without invalidation', () => {
    const cache = new WorldTransformCache();
    const nodes = makeNodes([
      { id: 'parent', transform: T_COMPLEX },
      { id: 'child', parentId: 'parent', transform: T_TRANSLATE },
    ]);
    const get = getNodeFn(nodes);

    const wt1 = cache.getWorldTransform('child', get);
    const wt2 = cache.getWorldTransform('child', get);
    // Should be the exact same object (cache hit)
    expect(wt1).toBe(wt2);
  });

  test('invalidate causes recomputation', () => {
    const cache = new WorldTransformCache();
    const nodes = makeNodes([
      { id: 'a', transform: T_TRANSLATE },
    ]);
    const get = getNodeFn(nodes);

    const wt1 = cache.getWorldTransform('a', get);
    expect(wt1.tx).toBe(10);

    // Mutate the node (simulating a state update)
    nodes.set('a', { id: 'a', parentId: undefined, transform: { ...IDENTITY, tx: 99, ty: 99 } });
    cache.invalidate();

    const wt2 = cache.getWorldTransform('a', getNodeFn(nodes));
    expect(wt2.tx).toBe(99);
  });

  test('stale entry is not returned after invalidation', () => {
    const cache = new WorldTransformCache();
    const nodes = makeNodes([{ id: 'a', transform: T_TRANSLATE }]);
    cache.getWorldTransform('a', getNodeFn(nodes));
    const gen1 = cache.gen;

    cache.invalidate();
    expect(cache.gen).toBe(gen1 + 1);

    // Even though the node hasn't changed, it must recompute
    nodes.set('a', { id: 'a', parentId: undefined, transform: { ...IDENTITY, tx: 50, ty: 50 } });
    const wt = cache.getWorldTransform('a', getNodeFn(nodes));
    expect(wt.tx).toBe(50);
  });

  test('evict removes specific node', () => {
    const cache = new WorldTransformCache();
    const nodes = makeNodes([
      { id: 'a', transform: T_TRANSLATE },
      { id: 'b', transform: T_SCALE2X },
    ]);
    const get = getNodeFn(nodes);

    cache.getWorldTransform('a', get);
    cache.evict('a');

    // Change node a
    nodes.set('a', { id: 'a', parentId: undefined, transform: { ...IDENTITY, tx: 77 } });
    // Without invalidate, the entry was evicted so it will recompute
    // But generation hasn't changed, so evicted entry won't match
    cache.invalidate();
    const wt2 = cache.getWorldTransform('a', getNodeFn(nodes));
    expect(wt2.tx).toBe(77);
  });

  test('clear resets everything', () => {
    const cache = new WorldTransformCache();
    const nodes = makeNodes([{ id: 'a', transform: T_TRANSLATE }]);
    cache.getWorldTransform('a', getNodeFn(nodes));

    cache.clear();

    nodes.set('a', { id: 'a', parentId: undefined, transform: { ...IDENTITY, tx: 42 } });
    const wt = cache.getWorldTransform('a', getNodeFn(nodes));
    expect(wt.tx).toBe(42);
  });

  test('getWorldBbox combines world transform with local bbox', () => {
    const cache = new WorldTransformCache();
    const nodes = makeNodes([
      { id: 'group', transform: { ...IDENTITY, tx: 10, ty: 10, sx: 2, sy: 3 } },
      { id: 'obj', parentId: 'group', transform: { ...IDENTITY, tx: 1, ty: 2 } },
    ]);
    const localBbox: Bbox = { x: 0, y: 0, width: 5, height: 4 };
    const wb = cache.getWorldBbox('obj', localBbox, getNodeFn(nodes));

    // obj transform: translate(1,2), so local (0,0,5,4) -> (1,2,5,4)
    // group transform: scale(2,3) + translate(10,10), so (1,2,5,4) -> (10+1*2, 10+2*3, 5*2, 4*3) = (12, 16, 10, 12)
    expect(closeTo(wb.x, 12)).toBe(true);
    expect(closeTo(wb.y, 16)).toBe(true);
    expect(closeTo(wb.width, 10)).toBe(true);
    expect(closeTo(wb.height, 12)).toBe(true);
  });

  test('unknown node returns IDENTITY', () => {
    const cache = new WorldTransformCache();
    const nodes = makeNodes([]);
    const wt = cache.getWorldTransform('nonexistent', getNodeFn(nodes));
    expect(wt).toEqual(IDENTITY);
  });

  test('matches manual compose for complex hierarchy', () => {
    const cache = new WorldTransformCache();
    const rootT: Transform2D = { tx: 100, ty: 50, sx: 1, sy: 1, rotation: 0, mirrorH: true, mirrorV: false };
    const midT: Transform2D = { tx: 0, ty: 0, sx: 2, sy: 3, rotation: 90, mirrorH: false, mirrorV: false };
    const leafT: Transform2D = { tx: 5, ty: 5, sx: 1, sy: 1, rotation: 0, mirrorH: false, mirrorV: true };

    const nodes = makeNodes([
      { id: 'root', transform: rootT },
      { id: 'mid', parentId: 'root', transform: midT },
      { id: 'leaf', parentId: 'mid', transform: leafT },
    ]);

    const wtCached = cache.getWorldTransform('leaf', getNodeFn(nodes));
    const wtManual = compose(rootT, compose(midT, leafT));

    const bbox: Bbox = { x: 1, y: 2, width: 3, height: 4 };
    expect(bboxClose(applyToBbox(wtCached, bbox), applyToBbox(wtManual, bbox))).toBe(true);
  });

  test('sibling nodes are independent', () => {
    const cache = new WorldTransformCache();
    const nodes = makeNodes([
      { id: 'parent', transform: T_SCALE2X },
      { id: 'a', parentId: 'parent', transform: { ...IDENTITY, tx: 10 } },
      { id: 'b', parentId: 'parent', transform: { ...IDENTITY, tx: 20 } },
    ]);
    const get = getNodeFn(nodes);

    const wtA = cache.getWorldTransform('a', get);
    const wtB = cache.getWorldTransform('b', get);

    const bbox: Bbox = { x: 0, y: 0, width: 1, height: 1 };
    const resultA = applyToBbox(wtA, bbox);
    const resultB = applyToBbox(wtB, bbox);

    expect(closeTo(resultA.x, 20)).toBe(true); // 10 * 2
    expect(closeTo(resultB.x, 40)).toBe(true); // 20 * 2
  });
});
