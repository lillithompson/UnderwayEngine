import { computeOutlineBlocks, blocksToSceneOrder, OutlineBlock } from '../logic/outlineBlocks';
import type { OutlineObject } from '../adapter';

function obj(id: string, parentGroupId?: string): OutlineObject {
  return { id, kind: 'svg', name: id, parentGroupId, locked: false, hidden: false };
}

function mapOf(...objs: OutlineObject[]): Map<string, OutlineObject> {
  return new Map(objs.map((o) => [o.id, o]));
}

describe('computeOutlineBlocks', () => {
  it('renders front→back (reverse of back→front sceneOrder), one block per ungrouped item', () => {
    const objects = mapOf(obj('a'), obj('b'), obj('c'));
    // sceneOrder is back→front: a painted first (bottom), c last (top).
    const blocks = computeOutlineBlocks(objects, ['a', 'b', 'c']);
    expect(blocks.map((b) => b.ids)).toEqual([['c'], ['b'], ['a']]);
    expect(blocks.every((b) => b.groupId === undefined)).toBe(true);
  });

  it('collapses a contiguous same-group run into one block', () => {
    const objects = mapOf(obj('a'), obj('g1', 'G'), obj('g2', 'G'), obj('b'));
    const blocks = computeOutlineBlocks(objects, ['a', 'g1', 'g2', 'b']);
    // display top→bottom: b, [g2,g1] (group), a
    expect(blocks).toEqual<OutlineBlock[]>([
      { ids: ['b'] },
      { groupId: 'G', ids: ['g2', 'g1'] },
      { ids: ['a'] },
    ]);
  });

  it('keeps distinct groups in separate blocks even when adjacent', () => {
    const objects = mapOf(obj('x', 'A'), obj('y', 'B'));
    const blocks = computeOutlineBlocks(objects, ['x', 'y']);
    expect(blocks).toEqual<OutlineBlock[]>([
      { groupId: 'B', ids: ['y'] },
      { groupId: 'A', ids: ['x'] },
    ]);
  });

  it('skips ids missing from the objects map (stale sceneOrder entries)', () => {
    const objects = mapOf(obj('a'), obj('c'));
    const blocks = computeOutlineBlocks(objects, ['a', 'ghost', 'c']);
    expect(blocks.map((b) => b.ids)).toEqual([['c'], ['a']]);
  });

  it('blocksToSceneOrder round-trips back to the original back→front order', () => {
    const objects = mapOf(obj('a'), obj('g1', 'G'), obj('g2', 'G'), obj('b'));
    const order = ['a', 'g1', 'g2', 'b'];
    expect(blocksToSceneOrder(computeOutlineBlocks(objects, order))).toEqual(order);
  });
});
