import {
  MASK_CLIP_ID_PREFIX,
  maskClipIdForNode,
  buildMaskClipDefs,
  wrapWithMaskClip,
} from '../compositionMaskSVG';
import { buildActiveMaskMap, MaskScene } from '../compositionMask';
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

function scene(svgObjects: SVGObject[], groups: GroupNode[]): MaskScene {
  return { groups, svgObjects, sceneOrder: svgObjects.map(s => s.id) };
}

describe('maskClipIdForNode', () => {
  test('plain member resolves to its group mask', () => {
    const mask = makeSvg('svg_mask', { groupId: 'g1', isMask: true });
    const member = makeSvg('svg_member', { groupId: 'g1' });
    const groups = [makeGroup('g1')];
    const map = buildActiveMaskMap(scene([mask, member], groups));
    expect(maskClipIdForNode(map, groups, member)).toBe(`${MASK_CLIP_ID_PREFIX}g1`);
  });

  test('the mask object is exempt from its own group mask', () => {
    const mask = makeSvg('svg_mask', { groupId: 'g1', isMask: true });
    const groups = [makeGroup('g1')];
    const map = buildActiveMaskMap(scene([mask], groups));
    expect(maskClipIdForNode(map, groups, mask)).toBeUndefined();
  });

  test('mask object still clipped by an ancestor group mask', () => {
    const outerMask = makeSvg('svg_outer', { groupId: 'gOuter', isMask: true });
    const innerMask = makeSvg('svg_inner', { groupId: 'gInner', isMask: true });
    const groups = [makeGroup('gOuter'), makeGroup('gInner', 'gOuter')];
    const map = buildActiveMaskMap(scene([outerMask, innerMask], groups));
    // inner mask exempt from gInner, but still inside gOuter
    expect(maskClipIdForNode(map, groups, innerMask)).toBe(`${MASK_CLIP_ID_PREFIX}gOuter`);
    // a plain member of gInner resolves to gInner (which chains to gOuter)
    const member = makeSvg('svg_m', { groupId: 'gInner' });
    expect(maskClipIdForNode(map, groups, member)).toBe(`${MASK_CLIP_ID_PREFIX}gInner`);
  });

  test('ungrouped / unmasked node is unclipped', () => {
    const map = buildActiveMaskMap(scene([makeSvg('svg_a')], [makeGroup('g1')]));
    expect(maskClipIdForNode(map, [makeGroup('g1')], makeSvg('svg_a'))).toBeUndefined();
  });

  test('resolves the group mask from a bare {id, groupId} node (paint-snapshot shape)', () => {
    // The paint-preview overlay resolves an expanded figure's clip from the
    // snapshot's groupId, before its committed render entry exists. A node
    // carrying only id + groupId must still resolve to the active group mask.
    const mask = makeSvg('svg_mask', { groupId: 'g1', isMask: true });
    const expanded = makeSvg('svg_expanded', { groupId: 'g1' });
    const groups = [makeGroup('g1')];
    const map = buildActiveMaskMap(scene([mask, expanded], groups));
    const snapshotNode = { id: 'svg_expanded', groupId: 'g1' };
    expect(maskClipIdForNode(map, groups, snapshotNode)).toBe(`${MASK_CLIP_ID_PREFIX}g1`);
  });
});

describe('buildMaskClipDefs', () => {
  test('empty map produces no defs', () => {
    expect(buildMaskClipDefs(new Map(), [])).toBe('');
  });

  test('one clipPath per masked group, userSpaceOnUse, with fill path', () => {
    const mask = makeSvg('svg_mask', { groupId: 'g1', isMask: true });
    const groups = [makeGroup('g1')];
    const map = buildActiveMaskMap(scene([mask], groups));
    const defs = buildMaskClipDefs(map, groups);
    expect(defs).toContain(`<clipPath id="${MASK_CLIP_ID_PREFIX}g1" clipPathUnits="userSpaceOnUse">`);
    expect(defs).toContain('<path d="');
    expect(defs.startsWith('<defs>')).toBe(true);
    expect(defs.endsWith('</defs>')).toBe(true);
  });

  test('nested mask chains to its ancestor mask', () => {
    const outerMask = makeSvg('svg_outer', { groupId: 'gOuter', isMask: true });
    const innerMask = makeSvg('svg_inner', { groupId: 'gInner', isMask: true });
    const groups = [makeGroup('gOuter'), makeGroup('gInner', 'gOuter')];
    const map = buildActiveMaskMap(scene([outerMask, innerMask], groups));
    const defs = buildMaskClipDefs(map, groups);
    // inner clipPath references the outer clipPath to intersect
    expect(defs).toContain(
      `<clipPath id="${MASK_CLIP_ID_PREFIX}gInner" clipPathUnits="userSpaceOnUse" clip-path="url(#${MASK_CLIP_ID_PREFIX}gOuter)">`,
    );
  });
});

describe('wrapWithMaskClip', () => {
  test('wraps a clipped member', () => {
    const mask = makeSvg('svg_mask', { groupId: 'g1', isMask: true });
    const member = makeSvg('svg_member', { groupId: 'g1' });
    const groups = [makeGroup('g1')];
    const map = buildActiveMaskMap(scene([mask, member], groups));
    expect(wrapWithMaskClip('<path/>', map, groups, member))
      .toBe(`<g clip-path="url(#${MASK_CLIP_ID_PREFIX}g1)"><path/></g>`);
  });

  test('leaves an unclipped node untouched', () => {
    expect(wrapWithMaskClip('<path/>', new Map(), [], makeSvg('svg_a'))).toBe('<path/>');
  });
});
