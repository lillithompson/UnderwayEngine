import {
  buildActiveMaskMap,
  clipRectToNodeMasks,
  getActiveMaskForGroup,
  getAncestorMasks,
  getGroupMaskChain,
  getNodeClipMasks,
  pointPassesMasks,
  pointVisibleThroughMasks,
  regionIntersectsGroupMasks,
  MaskScene,
} from '../compositionMask';
import { GroupNode, PathSegment, SVGObject } from '../types';

function squareSegments(x: number, y: number, size: number): PathSegment[] {
  return [
    { kind: 'line', start: [x, y], end: [x + size, y] },
    { kind: 'line', start: [x + size, y], end: [x + size, y + size] },
    { kind: 'line', start: [x + size, y + size], end: [x, y + size] },
    { kind: 'line', start: [x, y + size], end: [x, y] },
  ];
}

function makeSvg(id: string, overrides: Partial<SVGObject> = {}): SVGObject {
  return {
    id,
    color: { r: 0, g: 0, b: 0 },
    segments: squareSegments(0, 0, 4),
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
    ...overrides,
  };
}

function makeGroup(id: string, parentGroupId?: string): GroupNode {
  return {
    id, name: id, parentGroupId,
    translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
    rotation: 0, mirrorH: false, mirrorV: false,
  };
}

function makeScene(svgObjects: SVGObject[], groups: GroupNode[] = [], sceneOrder?: string[]): MaskScene {
  return {
    groups,
    svgObjects,
    sceneOrder: sceneOrder ?? svgObjects.map((s) => s.id),
  };
}

describe('buildActiveMaskMap', () => {
  test('no flagged objects returns the shared empty map (early bail)', () => {
    const scene = makeScene([makeSvg('svg_a', { groupId: 'g1' })], [makeGroup('g1')]);
    const map = buildActiveMaskMap(scene);
    expect(map.size).toBe(0);
    // Shared instance across calls
    expect(buildActiveMaskMap(scene)).toBe(map);
  });

  test('first-wins: lowest sceneOrder index among direct flagged members', () => {
    const a = makeSvg('svg_a', { groupId: 'g1', isMask: true });
    const b = makeSvg('svg_b', { groupId: 'g1', isMask: true });
    const scene = makeScene([b, a], [makeGroup('g1')], ['svg_a', 'svg_b']);
    expect(buildActiveMaskMap(scene).get('g1')!.id).toBe('svg_a');
  });

  test('reorder transfers the active-mask role', () => {
    const a = makeSvg('svg_a', { groupId: 'g1', isMask: true });
    const b = makeSvg('svg_b', { groupId: 'g1', isMask: true });
    const scene = makeScene([a, b], [makeGroup('g1')], ['svg_b', 'svg_a']);
    expect(buildActiveMaskMap(scene).get('g1')!.id).toBe('svg_b');
  });

  test('non-closed flagged shape is inert; next closed one promotes', () => {
    const open = makeSvg('svg_open', {
      groupId: 'g1', isMask: true,
      segments: [
        { kind: 'line', start: [0, 0], end: [4, 0] },
        { kind: 'line', start: [4, 0], end: [4, 4] },
      ],
    });
    const closed = makeSvg('svg_closed', { groupId: 'g1', isMask: true });
    const scene = makeScene([open, closed], [makeGroup('g1')]);
    expect(buildActiveMaskMap(scene).get('g1')!.id).toBe('svg_closed');
  });

  test('ungrouped flagged shape is inert', () => {
    const scene = makeScene([makeSvg('svg_a', { isMask: true })]);
    expect(buildActiveMaskMap(scene).size).toBe(0);
  });

  test('hidden mask still resolves as active', () => {
    const a = makeSvg('svg_a', { groupId: 'g1', isMask: true, hidden: true });
    const scene = makeScene([a], [makeGroup('g1')]);
    expect(buildActiveMaskMap(scene).get('g1')!.id).toBe('svg_a');
  });

  test('delete promotes the next eligible mask', () => {
    const a = makeSvg('svg_a', { groupId: 'g1', isMask: true });
    const b = makeSvg('svg_b', { groupId: 'g1', isMask: true });
    const before = makeScene([a, b], [makeGroup('g1')]);
    expect(buildActiveMaskMap(before).get('g1')!.id).toBe('svg_a');
    const after = makeScene([b], [makeGroup('g1')], ['svg_b']);
    expect(buildActiveMaskMap(after).get('g1')!.id).toBe('svg_b');
  });

  test('masks resolve independently per group', () => {
    const a = makeSvg('svg_a', { groupId: 'g1', isMask: true });
    const b = makeSvg('svg_b', { groupId: 'g2', isMask: true });
    const scene = makeScene([a, b], [makeGroup('g1'), makeGroup('g2')]);
    const map = buildActiveMaskMap(scene);
    expect(map.get('g1')!.id).toBe('svg_a');
    expect(map.get('g2')!.id).toBe('svg_b');
  });

  test('tiled object cannot be a mask; a non-tiled sibling still wins', () => {
    const tiled = makeSvg('svg_tiled', { groupId: 'g1', isMask: true, tileMode: 'repeat' });
    const scene = makeScene([tiled], [makeGroup('g1')]);
    expect(buildActiveMaskMap(scene).size).toBe(0);

    const plain = makeSvg('svg_plain', { groupId: 'g1', isMask: true });
    const scene2 = makeScene([tiled, plain], [makeGroup('g1')], ['svg_tiled', 'svg_plain']);
    // svg_tiled has the lower sceneOrder index but is excluded, so the
    // non-tiled svg_plain is the active mask.
    expect(buildActiveMaskMap(scene2).get('g1')!.id).toBe('svg_plain');
  });
});

describe('getNodeClipMasks', () => {
  test('returns the outermost-first chain for a plain member', () => {
    const outer = makeSvg('svg_outer', { groupId: 'gOuter', isMask: true });
    const inner = makeSvg('svg_inner', { groupId: 'gInner', isMask: true });
    const member = makeSvg('svg_m', { groupId: 'gInner' });
    const groups = [makeGroup('gOuter'), makeGroup('gInner', 'gOuter')];
    const map = buildActiveMaskMap(makeScene([outer, inner, member], groups));
    expect(getNodeClipMasks(map, groups, member).map((m) => m.id))
      .toEqual(['svg_outer', 'svg_inner']);
  });

  test('a mask is exempt from its own group but kept under ancestors', () => {
    const outer = makeSvg('svg_outer', { groupId: 'gOuter', isMask: true });
    const inner = makeSvg('svg_inner', { groupId: 'gInner', isMask: true });
    const groups = [makeGroup('gOuter'), makeGroup('gInner', 'gOuter')];
    const map = buildActiveMaskMap(makeScene([outer, inner], groups));
    // inner mask: drop gInner (itself), keep gOuter
    expect(getNodeClipMasks(map, groups, inner).map((m) => m.id)).toEqual(['svg_outer']);
    // outer mask: nothing above it
    expect(getNodeClipMasks(map, groups, outer)).toEqual([]);
  });

  test('empty when no masks or node is ungrouped', () => {
    const groups = [makeGroup('g1')];
    expect(getNodeClipMasks(new Map(), groups, makeSvg('svg_a', { groupId: 'g1' }))).toEqual([]);
    const a = makeSvg('svg_a', { groupId: 'g1', isMask: true });
    const map = buildActiveMaskMap(makeScene([a], groups));
    expect(getNodeClipMasks(map, groups, makeSvg('svg_x'))).toEqual([]);
  });
});

describe('getActiveMaskForGroup', () => {
  test('returns the group mask or undefined', () => {
    const a = makeSvg('svg_a', { groupId: 'g1', isMask: true });
    const scene = makeScene([a], [makeGroup('g1')]);
    expect(getActiveMaskForGroup(scene, 'g1')!.id).toBe('svg_a');
    expect(getActiveMaskForGroup(scene, 'g2')).toBeUndefined();
  });
});

describe('getAncestorMasks / getGroupMaskChain', () => {
  test('nested chain is outermost-first and includes the starting group', () => {
    const outer = makeSvg('svg_outer', { groupId: 'gOuter', isMask: true });
    const inner = makeSvg('svg_inner', { groupId: 'gInner', isMask: true });
    const groups = [makeGroup('gOuter'), makeGroup('gInner', 'gOuter')];
    const scene = makeScene([outer, inner], groups);
    const map = buildActiveMaskMap(scene);
    const chain = getAncestorMasks(map, groups, 'gInner');
    expect(chain.map((m) => m.id)).toEqual(['svg_outer', 'svg_inner']);
    expect(getGroupMaskChain(map, groups, 'gInner').map((m) => m.id))
      .toEqual(['svg_outer', 'svg_inner']);
  });

  test('undefined groupId or empty map returns []', () => {
    const groups = [makeGroup('g1')];
    expect(getAncestorMasks(new Map(), groups, 'g1')).toEqual([]);
    const a = makeSvg('svg_a', { groupId: 'g1', isMask: true });
    const map = buildActiveMaskMap(makeScene([a], groups));
    expect(getAncestorMasks(map, groups, undefined)).toEqual([]);
  });

  test('skips groups without masks in the chain', () => {
    const outer = makeSvg('svg_outer', { groupId: 'gOuter', isMask: true });
    const groups = [makeGroup('gOuter'), makeGroup('gMid', 'gOuter'), makeGroup('gInner', 'gMid')];
    const scene = makeScene([outer], groups);
    const map = buildActiveMaskMap(scene);
    expect(getAncestorMasks(map, groups, 'gInner').map((m) => m.id)).toEqual(['svg_outer']);
  });
});

describe('pointPassesMasks', () => {
  test('point must be inside every mask (intersection)', () => {
    const big = makeSvg('svg_big', { segments: squareSegments(0, 0, 8) });
    const small = makeSvg('svg_small', { segments: squareSegments(2, 2, 2) });
    const masks = [big, small];
    expect(pointPassesMasks(masks, undefined, 3, 3)).toBe(true);   // in both
    expect(pointPassesMasks(masks, undefined, 6, 6)).toBe(false);  // big only
    expect(pointPassesMasks(masks, undefined, 9, 9)).toBe(false);  // neither
  });

  test('self mask is exempt', () => {
    const small = makeSvg('svg_small', { segments: squareSegments(2, 2, 2) });
    expect(pointPassesMasks([small], 'svg_small', 9, 9)).toBe(true);
  });

  test('empty mask list always passes', () => {
    expect(pointPassesMasks([], undefined, 0, 0)).toBe(true);
  });
});

describe('pointVisibleThroughMasks', () => {
  // gOuter (0..8) ⊃ gInner (2..4): a member of gInner is visible only inside both.
  const outer = makeSvg('svg_outer', {
    groupId: 'gOuter', isMask: true,
    segments: squareSegments(0, 0, 8), cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8,
  });
  const inner = makeSvg('svg_inner', {
    groupId: 'gInner', isMask: true,
    segments: squareSegments(2, 2, 2), cellX: 2, cellY: 2, cellWidth: 2, cellHeight: 2,
  });
  const member = makeSvg('svg_member', { groupId: 'gInner' });
  const groups = [makeGroup('gOuter'), makeGroup('gInner', 'gOuter')];
  const map = buildActiveMaskMap(makeScene([outer, inner, member], groups));

  test('empty mask map → always visible', () => {
    expect(pointVisibleThroughMasks(new Map(), groups, member, 100, 100)).toBe(true);
  });

  test('member visible only inside the full ancestor chain', () => {
    expect(pointVisibleThroughMasks(map, groups, member, 3, 3)).toBe(true);   // in both
    expect(pointVisibleThroughMasks(map, groups, member, 6, 6)).toBe(false);  // outer only
    expect(pointVisibleThroughMasks(map, groups, member, 9, 9)).toBe(false);  // neither
  });

  test('ungrouped object is always visible (no clipping chain)', () => {
    expect(pointVisibleThroughMasks(map, groups, makeSvg('svg_loose'), 9, 9)).toBe(true);
  });

  test('a mask is exempt from its own clip but still clipped by ancestors', () => {
    // inner mask at (6,6): outside its own region but inside gOuter → visible.
    expect(pointVisibleThroughMasks(map, groups, inner, 6, 6)).toBe(true);
    // inner mask at (9,9): outside gOuter too → not visible.
    expect(pointVisibleThroughMasks(map, groups, inner, 9, 9)).toBe(false);
  });
});

describe('regionIntersectsGroupMasks', () => {
  test('region must intersect every mask bbox in the chain', () => {
    const outer = makeSvg('svg_outer', {
      groupId: 'gOuter', isMask: true,
      segments: squareSegments(0, 0, 8),
      cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8,
    });
    const inner = makeSvg('svg_inner', {
      groupId: 'gInner', isMask: true,
      segments: squareSegments(2, 2, 2),
      cellX: 2, cellY: 2, cellWidth: 2, cellHeight: 2,
    });
    const groups = [makeGroup('gOuter'), makeGroup('gInner', 'gOuter')];
    const scene = makeScene([outer, inner], groups);
    const map = buildActiveMaskMap(scene);
    // Overlaps both bboxes
    expect(regionIntersectsGroupMasks(map, groups, 'gInner', 1, 1, 3, 3)).toBe(true);
    // Overlaps outer only — misses the inner mask bbox
    expect(regionIntersectsGroupMasks(map, groups, 'gInner', 5, 5, 7, 7)).toBe(false);
    // Outside everything
    expect(regionIntersectsGroupMasks(map, groups, 'gInner', 20, 20, 30, 30)).toBe(false);
  });

  test('no masks in chain always passes', () => {
    expect(regionIntersectsGroupMasks(new Map(), [], 'g1', 0, 0, 1, 1)).toBe(true);
  });
});

describe('clipRectToNodeMasks', () => {
  test('passes the rect through unchanged when there are no masks', () => {
    const r = clipRectToNodeMasks(new Map(), [], { id: 'svg_x', groupId: 'g1' }, 0, 0, 100, 100);
    expect(r).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
  });

  test('clips a member rect to the mask bbox intersection', () => {
    const mask = makeSvg('svg_mask', {
      groupId: 'g1', isMask: true,
      segments: squareSegments(0, 0, 32),
      cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32,
    });
    const member = makeSvg('svg_member', { groupId: 'g1', cellX: 8, cellY: 8, cellWidth: 192, cellHeight: 1 });
    const groups = [makeGroup('g1')];
    const map = buildActiveMaskMap(makeScene([mask, member], groups));
    // Member spans 8..200 in x; mask caps it at 32.
    const r = clipRectToNodeMasks(map, groups, member, 8, 8, 200, 9);
    expect(r).toEqual({ minX: 8, minY: 8, maxX: 32, maxY: 9 });
  });

  test('returns null when the rect lies entirely outside the mask', () => {
    const mask = makeSvg('svg_mask', {
      groupId: 'g1', isMask: true,
      segments: squareSegments(0, 0, 32),
      cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32,
    });
    const member = makeSvg('svg_member', { groupId: 'g1' });
    const groups = [makeGroup('g1')];
    const map = buildActiveMaskMap(makeScene([mask, member], groups));
    expect(clipRectToNodeMasks(map, groups, member, 100, 100, 150, 150)).toBeNull();
  });

  test('a mask is framed by its own full extent (exempt from its own clip)', () => {
    const mask = makeSvg('svg_mask', {
      groupId: 'g1', isMask: true,
      segments: squareSegments(0, 0, 32),
      cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32,
    });
    const groups = [makeGroup('g1')];
    const map = buildActiveMaskMap(makeScene([mask], groups));
    const r = clipRectToNodeMasks(map, groups, mask, 0, 0, 32, 32);
    expect(r).toEqual({ minX: 0, minY: 0, maxX: 32, maxY: 32 });
  });
});
