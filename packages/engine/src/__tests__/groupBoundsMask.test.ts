import { groupBounds, groupLocalUnionBounds, groupSelectionBounds } from '../compositionOps';
import { buildActiveMaskMap } from '../compositionMask';
import { CompositionFigure, GroupNode, PathSegment, SVGObject } from '../types';

function squareSegments(x: number, y: number, size: number): PathSegment[] {
  return [
    { kind: 'line', start: [x, y], end: [x + size, y] },
    { kind: 'line', start: [x + size, y], end: [x + size, y + size] },
    { kind: 'line', start: [x + size, y + size], end: [x, y + size] },
    { kind: 'line', start: [x, y + size], end: [x, y] },
  ];
}

function makeGroup(id: string, parentGroupId?: string): GroupNode {
  return {
    id, name: id, parentGroupId,
    translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
    rotation: 0, mirrorH: false, mirrorV: false,
  };
}

function makeFig(id: string, groupId: string, x: number, y: number, w: number, h: number): CompositionFigure {
  return {
    id, cellX: x, cellY: y, cellWidth: w, cellHeight: h, groupId,
    localCellX: x, localCellY: y, localCellWidth: w, localCellHeight: h,
  } as unknown as CompositionFigure;
}

/** A closed-square mask of `size` at (x,y), with local == world geometry
 *  (identity group transforms in these fixtures). */
function makeMask(id: string, groupId: string, x: number, y: number, size: number): SVGObject {
  const segs = squareSegments(x, y, size);
  return {
    id, color: { r: 0, g: 0, b: 0 },
    segments: segs, localSegments: segs,
    cellX: x, cellY: y, cellWidth: size, cellHeight: size,
    groupId, isMask: true,
  } as unknown as SVGObject;
}

function maskMapFor(svgObjects: SVGObject[], groups: GroupNode[], figIds: string[] = []) {
  return buildActiveMaskMap({
    groups,
    svgObjects,
    sceneOrder: [...svgObjects.map(s => s.id), ...figIds],
  });
}

describe('groupBounds — nested-mask clipping', () => {
  // gOuter (no mask) contains gInner (parentGroupId gOuter) which has a mask.
  //   inner mask:     (0,0)-(4,4)
  //   figInside:      (1,1)-(3,3)   inside the inner mask
  //   figOutside:     (10,10)-(14,14)  fully outside the inner mask
  //   figOuter:       (5,0)-(7,2)   direct member of gOuter (unmasked)
  const gOuter = makeGroup('gOuter');
  const gInner = makeGroup('gInner', 'gOuter');
  const groups = [gOuter, gInner];
  const mask = makeMask('mask', 'gInner', 0, 0, 4);
  const svgObjects = [mask];
  const figInside = makeFig('figInside', 'gInner', 1, 1, 2, 2);
  const figOutside = makeFig('figOutside', 'gInner', 10, 10, 4, 4);
  const figOuter = makeFig('figOuter', 'gOuter', 5, 0, 2, 2);
  const figures = [figInside, figOutside, figOuter];

  test('without maskMap, masked-out member still pads the union (legacy behavior)', () => {
    const b = groupBounds(figures, 'gOuter', svgObjects, svgObjects, undefined, groups);
    expect(b.minX).toBe(0);
    expect(b.minY).toBe(0);
    expect(b.maxX).toBe(14); // figOutside reaches 14
    expect(b.maxY).toBe(14);
  });

  test('with maskMap, the nested-masked-out member is clipped away', () => {
    const maskMap = maskMapFor(svgObjects, groups, figures.map(f => f.id));
    const b = groupBounds(figures, 'gOuter', svgObjects, svgObjects, undefined, groups, maskMap);
    // figOutside excluded; figOuter (unmasked outer member) retained → x→7;
    // mask + figInside cap y at 4.
    expect(b.minX).toBe(0);
    expect(b.minY).toBe(0);
    expect(b.maxX).toBe(7);
    expect(b.maxY).toBe(4);
  });

  test('all-clipped subgroup falls back to the unclipped union (never Infinities)', () => {
    // gMasked has the mask; gChild (its child, no mask) has one member that
    // lies fully outside the ancestor mask. Querying gChild clips that member
    // to null, so the fallback returns its unclipped bbox.
    const gMasked = makeGroup('gMasked');
    const gChild = makeGroup('gChild', 'gMasked');
    const gs = [gMasked, gChild];
    const m = makeMask('m2', 'gMasked', 0, 0, 4);
    const figFar = makeFig('figFar', 'gChild', 10, 10, 4, 4);
    const maskMap = maskMapFor([m], gs, ['figFar']);
    const b = groupBounds([figFar], 'gChild', [m], [m], undefined, gs, maskMap);
    expect(b.minX).toBe(10);
    expect(b.minY).toBe(10);
    expect(b.maxX).toBe(14);
    expect(b.maxY).toBe(14);
  });

  test('tiled SVG contributes its cell bbox, not its base-tile segments', () => {
    const g = makeGroup('gT');
    const tiled = {
      id: 'tiled', color: { r: 0, g: 0, b: 0 },
      segments: squareSegments(0, 0, 4), // base tile is small
      cellX: 0, cellY: 0, cellWidth: 20, cellHeight: 6, // visible tiled extent
      groupId: 'gT', tileMode: 'repeat',
    } as unknown as SVGObject;
    const b = groupBounds([], 'gT', [tiled], [tiled], undefined, [g]);
    expect(b.maxX).toBe(20);
    expect(b.maxY).toBe(6);
  });
});

describe('groupSelectionBounds — mask-mode object hugs its mask', () => {
  // gMask is a masked group: a mask at (2,2)-(6,6) plus a sibling figure that
  // extends well beyond the mask. The selection box (and therefore the move/
  // scale anchor) must track the mask only — the sibling must not affect it.
  const gMask = makeGroup('gMask');
  const groups = [gMask];
  const mask = makeMask('m', 'gMask', 2, 2, 4); // bbox (2,2)-(6,6)
  const sibling = makeFig('sibling', 'gMask', 9, 9, 4, 4); // (9,9)-(13,13), clipped away
  const svgObjects = [mask];
  const figures = [sibling];

  test('masked group returns exactly the mask bbox, ignoring the sibling', () => {
    const maskMap = maskMapFor(svgObjects, groups, figures.map(f => f.id));
    const b = groupSelectionBounds(figures, 'gMask', svgObjects, [], groups, maskMap);
    expect(b).toEqual({ minX: 2, minY: 2, maxX: 6, maxY: 6 });
  });

  test('mask bbox is independent of how far the sibling extends', () => {
    const maskMap = maskMapFor(svgObjects, groups, figures.map(f => f.id));
    const farSibling = makeFig('sibling', 'gMask', 100, 100, 50, 50);
    const b = groupSelectionBounds([farSibling], 'gMask', svgObjects, [], groups, maskMap);
    expect(b).toEqual({ minX: 2, minY: 2, maxX: 6, maxY: 6 });
  });

  test('unmasked group falls back to the mask-aware member union', () => {
    // No mask on this group → union of members (here just the sibling).
    const b = groupSelectionBounds(figures, 'gMask', [], [], groups, undefined);
    expect(b).toEqual({ minX: 9, minY: 9, maxX: 13, maxY: 13 });
  });
});

describe('groupLocalUnionBounds — nested-mask clipping (identity transforms)', () => {
  const gOuter = makeGroup('gOuter');
  const gInner = makeGroup('gInner', 'gOuter');
  const groups = [gOuter, gInner];
  const mask = makeMask('mask', 'gInner', 0, 0, 4);
  const figInside = makeFig('figInside', 'gInner', 1, 1, 2, 2);
  const figOutside = makeFig('figOutside', 'gInner', 10, 10, 4, 4);
  const figOuter = makeFig('figOuter', 'gOuter', 5, 0, 2, 2);
  const state = { figures: [figInside, figOutside, figOuter], svgObjects: [mask], images: [], groups };

  test('no maskMap → plain local union matches plain world union', () => {
    const lub = groupLocalUnionBounds(state, 'gOuter');
    expect(lub.hasMembers).toBe(true);
    expect(lub.minX).toBe(0);
    expect(lub.minY).toBe(0);
    expect(lub.maxX).toBe(14);
    expect(lub.maxY).toBe(14);
  });

  test('with maskMap → nested-masked-out member is clipped, matching world bounds', () => {
    const maskMap = maskMapFor(state.svgObjects, groups, state.figures.map(f => f.id));
    const lub = groupLocalUnionBounds(state, 'gOuter', maskMap);
    const world = groupBounds(state.figures, 'gOuter', state.svgObjects, state.svgObjects, undefined, groups, maskMap);
    // Identity transforms ⇒ local union equals world union exactly. This is the
    // invariant that keeps sX/sY uniform during a group scale.
    expect(lub.minX).toBe(world.minX);
    expect(lub.minY).toBe(world.minY);
    expect(lub.maxX).toBe(world.maxX);
    expect(lub.maxY).toBe(world.maxY);
    expect(lub.maxX).toBe(7);
    expect(lub.maxY).toBe(4);
  });
});
