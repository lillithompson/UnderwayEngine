import { GroupNode, PathSegment, SVGObject } from '../types';
import { buildFrameRectMap, frameGroupIdForNode } from '../compositionFrame';
import { generateCompositionSVGCore, CompositionSVGInputs } from '../compositionSVGCore';

function rectSegments(x: number, y: number, w: number, h: number): PathSegment[] {
  return [
    { kind: 'line', start: [x, y], end: [x + w, y] },
    { kind: 'line', start: [x + w, y], end: [x + w, y + h] },
    { kind: 'line', start: [x + w, y + h], end: [x, y + h] },
    { kind: 'line', start: [x, y + h], end: [x, y] },
  ];
}

function group(id: string, opts?: { parentGroupId?: string; isFrame?: boolean }): GroupNode {
  return {
    id, name: id, parentGroupId: opts?.parentGroupId,
    translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
    rotation: 0, mirrorH: false, mirrorV: false,
    ...(opts?.isFrame ? { isFrame: true } : null),
  };
}

function rectMask(id: string, groupId: string, x: number, y: number, w: number, h: number): SVGObject {
  return {
    id, groupId, isMask: true, color: { r: 0, g: 0, b: 0 },
    segments: rectSegments(x, y, w, h),
    cellX: x, cellY: y, cellWidth: w, cellHeight: h,
  };
}

describe('frameGroupIdForNode', () => {
  const gFrame = group('gFrame', { isFrame: true });
  const gChild = group('gChild', { parentGroupId: 'gFrame' });
  const gPlain = group('gPlain');
  const groups = [gFrame, gChild, gPlain];

  test('a direct member resolves to its frame group', () => {
    expect(frameGroupIdForNode(groups, 'gFrame')).toBe('gFrame');
  });

  test('a nested-group member walks up to the frame ancestor', () => {
    expect(frameGroupIdForNode(groups, 'gChild')).toBe('gFrame');
  });

  test('a node in a non-frame group has no frame', () => {
    expect(frameGroupIdForNode(groups, 'gPlain')).toBeUndefined();
  });

  test('a loose (ungrouped) node has no frame', () => {
    expect(frameGroupIdForNode(groups, undefined)).toBeUndefined();
  });

  test('a dangling groupId resolves to no frame (no crash)', () => {
    expect(frameGroupIdForNode(groups, 'nonexistent')).toBeUndefined();
  });
});

describe('buildFrameRectMap', () => {
  test('maps each frame group to its active rect mask', () => {
    const gFrame = group('gFrame', { isFrame: true });
    const mask = rectMask('svg_boundary', 'gFrame', 0, 0, 32, 42);
    const map = buildFrameRectMap({
      groups: [gFrame],
      svgObjects: [mask],
      sceneOrder: ['svg_boundary'],
    });
    expect(map.get('gFrame')).toBe(mask);
    expect(map.get('gFrame')?.cellWidth).toBe(32);
    expect(map.get('gFrame')?.cellHeight).toBe(42);
  });

  test('resolves a hidden boundary (a hidden mask still clips)', () => {
    const gFrame = group('gFrame', { isFrame: true });
    const mask = { ...rectMask('svg_boundary', 'gFrame', 0, 0, 10, 10), hidden: true };
    const map = buildFrameRectMap({
      groups: [gFrame],
      svgObjects: [mask],
      sceneOrder: ['svg_boundary'],
    });
    expect(map.get('gFrame')).toBe(mask);
  });

  test('ignores non-frame groups and returns empty when there are none', () => {
    const gPlain = group('gPlain');
    const mask = rectMask('svg_mask', 'gPlain', 0, 0, 8, 8);
    const map = buildFrameRectMap({
      groups: [gPlain],
      svgObjects: [mask],
      sceneOrder: ['svg_mask'],
    });
    expect(map.size).toBe(0);
  });

  test('omits a frame whose boundary is not a resolvable mask', () => {
    const gFrame = group('gFrame', { isFrame: true });
    // Not flagged isMask ⇒ no clip boundary resolves for the frame.
    const notMask = { ...rectMask('svg_x', 'gFrame', 0, 0, 8, 8), isMask: undefined };
    const map = buildFrameRectMap({
      groups: [gFrame],
      svgObjects: [notMask],
      sceneOrder: ['svg_x'],
    });
    expect(map.has('gFrame')).toBe(false);
  });
});

describe('generateCompositionSVGCore — frame export bounds', () => {
  const baseInput = (svgObjects: SVGObject[], groups: GroupNode[]): CompositionSVGInputs => ({
    name: 'Frame',
    figures: [],
    svgObjects,
    images: [],
    imageBlobs: {},
    groups,
    sceneOrder: svgObjects.map((s) => s.id),
    strokeScale: 0,
    loadFigure: async () => null,
  });

  const U = 256; // SVG_UNITS_PER_L0_CELL

  test('pins the viewBox to the full frame rect, even when content is smaller', async () => {
    const gFrame = group('gFrame', { isFrame: true });
    const boundary = { ...rectMask('svg_boundary', 'gFrame', 0, 0, 32, 42), hidden: true };
    // A tiny member well inside the frame — must NOT shrink the viewBox.
    const member = rectMask('svg_member', 'gFrame', 2, 2, 4, 4);
    member.isMask = undefined;
    member.color = { r: 200, g: 100, b: 50 };

    const svg = await generateCompositionSVGCore(baseInput([boundary, member], [gFrame]));
    expect(svg).not.toBeNull();
    // Full 32×42 frame, not the 4×4 member's bounds.
    expect(svg).toMatch(new RegExp(`viewBox="0 0 ${32 * U} ${42 * U}"`));
  });

  test('a plain (non-frame) group falls back to content-clipped bounds', async () => {
    const gPlain = group('gPlain');
    const mask = rectMask('svg_mask', 'gPlain', 0, 0, 32, 42);
    mask.hidden = true;
    const member = rectMask('svg_member', 'gPlain', 2, 2, 4, 4);
    member.isMask = undefined;
    member.color = { r: 200, g: 100, b: 50 };

    const svg = await generateCompositionSVGCore(baseInput([mask, member], [gPlain]));
    expect(svg).not.toBeNull();
    // Without isFrame the viewBox tracks the visible member (2..6), NOT 0..32.
    expect(svg).toMatch(new RegExp(`viewBox="${2 * U} ${2 * U} ${4 * U} ${4 * U}"`));
  });
});
