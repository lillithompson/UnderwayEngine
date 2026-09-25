/**
 * The exported file's `<g>`s are the user's groups and nothing else.
 *
 * Every stroke used to leave as `<g transform><path/></g>`, faded ones as
 * `<g transform><g opacity><path/></g></g>`, masked ones under one more
 * `<g clip-path>` — a nest of groups with one path at the bottom of each —
 * while the groups the user had actually made in the scene outline were
 * flattened away. Now a stroke is one `<path>` in page coordinates (its
 * rigid pose folded into its vertices, `worldPosedSVGObject`), a lone
 * element wears its own opacity / clip / filter (`wearOrWrap`), and each
 * scene-outline group is a `<g id="name">` round its members
 * (`groupEmitter`).
 */

import { generateCompositionSVGCore } from '../compositionSVGCore';
import type { CompositionSVGInputs } from '../compositionSVGCore';
import type { GroupNode, SVGObject } from '../types';
import { SVG_UNITS_PER_L0_CELL as U } from '../svgExport';
import { wearOrWrap } from '../svgPathBuilder';
import { expectQuadsClose, legacyQuad, transformsIn } from './exportPose.test-utils';

jest.mock('@/native-shell/bridge/webBridge', () => ({ logToNative: jest.fn() }));

function stroke(id: string, x: number, over: Partial<SVGObject> = {}): SVGObject {
  return {
    id, color: { r: 10, g: 20, b: 30 },
    segments: [
      { kind: 'line', start: [x, 0], end: [x + 4, 0] },
      { kind: 'line', start: [x + 4, 0], end: [x + 4, 4] },
    ],
    cellX: x, cellY: 0, cellWidth: 4, cellHeight: 4,
    ...over,
  } as SVGObject;
}

function square(id: string, x: number, over: Partial<SVGObject> = {}): SVGObject {
  return stroke(id, x, {
    shapeKind: 'rectangle',
    segments: [
      { kind: 'line', start: [x, 0], end: [x + 4, 0] },
      { kind: 'line', start: [x + 4, 0], end: [x + 4, 4] },
      { kind: 'line', start: [x + 4, 4], end: [x, 4] },
      { kind: 'line', start: [x, 4], end: [x, 0] },
    ],
    ...over,
  });
}

function group(id: string, name: string, parentGroupId?: string): GroupNode {
  return {
    id, name, parentGroupId,
    translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
    rotation: 0, mirrorH: false, mirrorV: false,
  };
}

async function exported(
  svgObjects: SVGObject[], groups: GroupNode[] = [], extra: Partial<CompositionSVGInputs> = {},
): Promise<string> {
  const out = await generateCompositionSVGCore({
    name: 'page', figures: [], svgObjects, images: [], imageBlobs: {}, texts: [],
    paintObjects: [], patternObjects: [], groups,
    sceneOrder: svgObjects.map((s) => s.id), strokeScale: 0.04,
    loadFigure: async () => null,
    ...extra,
  });
  expect(out).not.toBeNull();
  return out!;
}

/** The drawn path elements in the file (a clip def's path is not one),
 *  each with the `<g>` ids open round it. */
function pathsWithGroups(svg: string): { path: string; groups: string[] }[] {
  const out: { path: string; groups: string[] }[] = [];
  const open: string[] = [];
  const drawn = svg.replace(/<defs>[\s\S]*?<\/defs>/g, '');
  for (const [tag] of drawn.matchAll(/<g id="([^"]*)">|<\/g>|<path[^>]*\/>/g)) {
    if (tag.startsWith('<g ')) open.push(tag.slice(7, -2));
    else if (tag === '</g>') open.pop();
    else out.push({ path: tag, groups: [...open] });
  }
  return out;
}

describe('a stroke is one path in page coordinates', () => {
  test('no group round a plain stroke, and none round a faded, masked or turned one', async () => {
    const svg = await exported([
      stroke('A', 0),
      stroke('B', 6, { opacity: 0.5 }),
      stroke('C', 12, { angleDeg: 30 }),
    ]);
    expect(svg).not.toContain('<g');
    expect(transformsIn(svg)).toHaveLength(0);
    // Its move is folded into the vertices…
    expect(svg).toContain('<path d="M 0,0 L 1024,0 L 1024,1024"');
    // …a lone path wears its own opacity…
    expect(svg).toContain('<path opacity="0.5" d="M 1536,0 L 2560,0 L 2560,1024"');
    // …and a turn is folded in too, about the box centre, leaving the
    // stroke its authored width.
    const turned = pathsWithGroups(svg)[2].path;
    const pts = [...turned.match(/ d="([^"]*)"/)![1].matchAll(/([-\d.]+),([-\d.]+)/g)]
      .map(([, x, y]) => [Number(x), Number(y)] as [number, number]);
    const [c0, c1, c2] = legacyQuad({ x: 12, y: 0, width: 4, height: 4, angleDeg: 30 });
    expectQuadsClose(pts, [c0, c1, c2]);
    expect(turned).toContain('stroke-width="3.2"');
  });

  test('a masked member wears the clip itself, in world space, whatever its turn', async () => {
    const svg = await exported([
      square('MASK', 0, { groupId: 'M', isMask: true }),
      stroke('D', 2, { groupId: 'M', angleDeg: 45 }),
    ], [group('M', 'Masked')]);
    const [mask, member] = pathsWithGroups(svg);
    expect(mask.path).not.toContain('clip-path');
    expect(member.path).toMatch(/^<path clip-path="url\(#groupmask-M\)" d="/);
    expect(transformsIn(svg)).toHaveLength(0);
    const pts = [...member.path.match(/ d="([^"]*)"/)![1].matchAll(/([-\d.]+),([-\d.]+)/g)]
      .map(([, x, y]) => [Number(x), Number(y)] as [number, number]);
    const [c0, c1, c2] = legacyQuad({ x: 2, y: 0, width: 4, height: 4, angleDeg: 45 });
    expectQuadsClose(pts, [c0, c1, c2]);
  });

  test('a turned shape whose paint is laid out on its box keeps its transform', async () => {
    // A border rect is drawn round the box, and a turned box is not a box:
    // the object stays in its own space and wears the turn — on the one
    // `<g>` its several elements need anyway.
    const svg = await exported([square('E', 0, {
      angleDeg: 30, effects: { border: { width: 0.5, color: { r: 0, g: 255, b: 0 }, radius: 0 } },
    })]);
    const [m] = transformsIn(svg);
    expect(Math.atan2(m.b, m.a) * 180 / Math.PI).toBeCloseTo(30);
    expect(svg).toMatch(/<g transform="[^"]*"><path d="[^"]*"[^>]*\/><rect /);
    // …but upright, the same shape is said in world space outright.
    const flat = await exported([square('E', 3, {
      effects: { border: { width: 0.5, color: { r: 0, g: 255, b: 0 }, radius: 0 } },
    })]);
    expect(transformsIn(flat)).toHaveLength(0);
    // The border rect sits on the WORLD box — inset from its corner at
    // (3, 0) cells by the same amount on both axes, within the stroke.
    const [, rx, ry] = flat.match(/<rect x="([-\d.]+)" y="([-\d.]+)"/)!;
    expect(Number(rx) - 3 * U).toBeCloseTo(Number(ry), 6);
    expect(Number(ry)).toBeGreaterThanOrEqual(0);
    expect(Number(ry)).toBeLessThanOrEqual(0.5 * U);
  });
});

describe('wearOrWrap', () => {
  test('a lone element wears the attribute; several share a group', () => {
    expect(wearOrWrap('<path d="M 0,0"/>', 'opacity="0.5"')).toBe('<path opacity="0.5" d="M 0,0"/>');
    expect(wearOrWrap('<image x="0" href="a"/>', 'transform="matrix(1, 0, 0, 1, 2, 3)"'))
      .toBe('<image transform="matrix(1, 0, 0, 1, 2, 3)" x="0" href="a"/>');
    expect(wearOrWrap('<path/><path/>', 'opacity="0.5"')).toBe('<g opacity="0.5"><path/><path/></g>');
    expect(wearOrWrap('<defs></defs><path/>', 'filter="url(#f)"'))
      .toBe('<g filter="url(#f)"><defs></defs><path/></g>');
  });

  test('an element already wearing the attribute, or a pose, is wrapped instead', () => {
    // Two opacities cannot sit on one element…
    expect(wearOrWrap('<path opacity="0.5"/>', 'opacity="0.5"'))
      .toBe('<g opacity="0.5"><path opacity="0.5"/></g>');
    // …and a posed element takes nothing more: its transform is the space
    // its other attributes are read in, so a world-space clip put on it
    // would clip against a posed copy of the mask. The clip wraps — the
    // one wrapper a lone element still gets, and only when it wears a pose.
    expect(wearOrWrap('<image transform="matrix(1, 0, 0, 1, 2, 3)" x="0"/>', 'clip-path="url(#m)"'))
      .toBe('<g clip-path="url(#m)"><image transform="matrix(1, 0, 0, 1, 2, 3)" x="0"/></g>');
  });
});

describe('the scene outline\'s groups are the file\'s groups', () => {
  test('each group is a <g id="name"> round its members, nested as the outline nests', async () => {
    const svg = await exported([
      stroke('A', 0),
      stroke('B', 6, { groupId: 'G' }),
      stroke('C', 12, { groupId: 'G' }),
      stroke('F', 18, { groupId: 'G2' }),
      stroke('H', 24),
    ], [group('G', 'Outer'), group('G2', 'Inner', 'G')]);
    expect(pathsWithGroups(svg).map((p) => p.groups)).toEqual([
      [], ['Outer'], ['Outer'], ['Outer', 'Inner'], [],
    ]);
    // The group is structure, not pose: no transform on it.
    expect(svg).toContain('<g id="Outer">');
    expect(svg).toContain('<g id="Inner">');
    expect(svg.match(/<g\b/g)).toHaveLength(2);
    expect(svg.match(/<\/g>/g)).toHaveLength(2);
  });

  test('a group whose members a legacy order scattered opens again, still well nested', async () => {
    const svg = await exported([
      stroke('A', 0, { groupId: 'G' }),
      stroke('B', 6),
      stroke('C', 12, { groupId: 'G' }),
    ], [group('G', 'Twice')]);
    expect(pathsWithGroups(svg).map((p) => p.groups)).toEqual([['Twice'], [], ['Twice']]);
    expect(svg.match(/<g\b/g)).toHaveLength(2);
    expect(svg.match(/<\/g>/g)).toHaveLength(2);
  });

  test('names become XML ids: cleaned, unique, never empty or leading with a digit', async () => {
    const svg = await exported([
      stroke('A', 0, { groupId: 'g1' }),
      stroke('B', 6, { groupId: 'g2' }),
      stroke('C', 12, { groupId: 'g3' }),
      stroke('D', 18, { groupId: 'g4' }),
      stroke('E', 24, { groupId: 'g5' }),
      stroke('F', 30, { groupId: 'g6' }),
    ], [
      group('g1', 'My Group!'), group('g2', 'Layer'), group('g3', 'Layer'),
      group('g4', ''), group('g5', '1st'), group('g6', 'page'),
    ]);
    expect(pathsWithGroups(svg).map((p) => p.groups)).toEqual([
      ['My_Group_'], ['Layer'], ['Layer_2'], ['group'], ['group_1st'], ['page_2'],
    ]);
  });

  test('a hidden group leaves nothing behind, and the fallback order groups too', async () => {
    const svg = await exported([
      stroke('A', 0, { groupId: 'G' }),
      stroke('B', 6, { groupId: 'H' }),
    ], [group('G', 'Shown'), { ...group('H', 'Hidden'), hidden: true } as GroupNode], {
      sceneOrder: undefined,
    });
    expect(pathsWithGroups(svg).map((p) => p.groups)).toEqual([['Shown']]);
    expect(svg).not.toContain('Hidden');
  });
});
