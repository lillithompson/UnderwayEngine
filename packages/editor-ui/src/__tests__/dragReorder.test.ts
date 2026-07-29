import { resolveDragReorder, dragTargetIndex } from '../logic/dragReorder';
import { computeOutlineBlocks } from '../logic/outlineBlocks';
import type { OutlineObject } from '../adapter';

const ROW = 44;

function obj(id: string, parentGroupId?: string): OutlineObject {
  return { id, kind: 'svg', name: id, parentGroupId, locked: false, hidden: false };
}
function mapOf(...objs: OutlineObject[]): Map<string, OutlineObject> {
  return new Map(objs.map((o) => [o.id, o]));
}

describe('dragTargetIndex', () => {
  it('rounds dy/rowHeight and clamps to [0, count-1]', () => {
    expect(dragTargetIndex(1, 0, ROW, 4)).toBe(1);
    expect(dragTargetIndex(1, ROW, ROW, 4)).toBe(2);
    expect(dragTargetIndex(1, -ROW * 5, ROW, 4)).toBe(0); // clamp low
    expect(dragTargetIndex(1, ROW * 10, ROW, 4)).toBe(3); // clamp high
    expect(dragTargetIndex(1, ROW * 0.4, ROW, 4)).toBe(1); // rounds down
    expect(dragTargetIndex(1, ROW * 0.6, ROW, 4)).toBe(2); // rounds up
  });
});

describe('resolveDragReorder', () => {
  // sceneOrder back→front ['a','b','c','d'] → display top→bottom d,c,b,a.
  // blocks[0]=d (front), blocks[3]=a (back).
  const objects = mapOf(obj('a'), obj('b'), obj('c'), obj('d'));
  const blocks = computeOutlineBlocks(objects, ['a', 'b', 'c', 'd']);

  it('is a no-op when the target equals the source index', () => {
    expect(resolveDragReorder(blocks, 0, 3, ROW)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('moves a row down the list (toward back) → later in sceneOrder shifts', () => {
    // Drag top row (d, index 0) down by 2 rows → display c,b,d,a.
    const out = resolveDragReorder(blocks, 0, ROW * 2, ROW);
    // display c,b,d,a → sceneOrder reverse = a,d,b,c
    expect(out).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves a row up the list (toward front)', () => {
    // Drag bottom row (a, index 3) up by 3 rows → display a,d,c,b.
    const out = resolveDragReorder(blocks, 3, -ROW * 3, ROW);
    expect(out).toEqual(['b', 'c', 'd', 'a']);
  });

  it('always returns a permutation of the input order', () => {
    const out = resolveDragReorder(blocks, 2, ROW * 7, ROW);
    expect([...out].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('moves a group block as a unit', () => {
    // display top→bottom: b, [g2,g1], a  (sceneOrder a,g1,g2,b)
    const gObjects = mapOf(obj('a'), obj('g1', 'G'), obj('g2', 'G'), obj('b'));
    const gBlocks = computeOutlineBlocks(gObjects, ['a', 'g1', 'g2', 'b']);
    // Drag the group block (index 1) to the top (up by 1 row).
    const out = resolveDragReorder(gBlocks, 1, -ROW, ROW);
    // display: [g2,g1], b, a → flatten g2,g1,b,a → reverse a,b,g1,g2
    expect(out).toEqual(['a', 'b', 'g1', 'g2']);
    // group members stay contiguous
    const gi1 = out.indexOf('g1');
    const gi2 = out.indexOf('g2');
    expect(Math.abs(gi1 - gi2)).toBe(1);
  });
});
