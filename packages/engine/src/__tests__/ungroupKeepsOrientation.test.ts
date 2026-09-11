/**
 * Ungrouping keeps a bbox kind's pose.
 *
 * For images, texts, paint islands and pattern objects the `rotation` /
 * `mirrorH` / `mirrorV` fields ARE the world orientation the renderer
 * draws (materializeBboxMember writes them). The ungroup op cleared them
 * along with the group-local caches — right for an svg, whose segments
 * carry its orientation, wrong for everything drawn from a box: four
 * patterns turned and flipped differently came out of a group as four
 * identical, upright tilings.
 */

import { applyCompOps, revertCompOps } from '../compositionOps';
import {
  CompUndoEntry, CompositionState, GroupNode, ImageObject, PatternObject, SVGObject, TextObject,
  makeViewport,
} from '../types';

function group(overrides: Partial<GroupNode> = {}): GroupNode {
  return {
    id: 'g1', name: 'Group 1',
    translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
    rotation: 0, mirrorH: false, mirrorV: false,
    ...overrides,
  };
}

function pattern(overrides: Partial<PatternObject> = {}): PatternObject {
  return {
    id: 'pat', cellX: 2, cellY: 2, cellWidth: 4, cellHeight: 4, cols: 2, rows: 2,
    cells: [null, null, null, null],
    tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2,
    ...overrides,
  };
}

function image(overrides: Partial<ImageObject> = {}): ImageObject {
  return {
    id: 'img', imageId: 'blob', mimeType: 'image/png', pixelWidth: 10, pixelHeight: 10,
    cellX: 8, cellY: 2, cellWidth: 4, cellHeight: 4,
    ...overrides,
  };
}

function text(overrides: Partial<TextObject> = {}): TextObject {
  return {
    id: 'txt', content: 'hi', style: { fontId: 'system', size: 2, color: { r: 0, g: 0, b: 0 } },
    cellX: 14, cellY: 2, cellWidth: 4, cellHeight: 2,
    ...overrides,
  };
}

function svg(overrides: Partial<SVGObject> = {}): SVGObject {
  return {
    id: 'svg', segments: [{ kind: 'line', start: [20, 2], end: [24, 2] }],
    color: { r: 0, g: 0, b: 0 }, cellX: 20, cellY: 2, cellWidth: 4, cellHeight: 0,
    ...overrides,
  };
}

function state(parts: {
  groups?: GroupNode[]; patterns?: PatternObject[]; images?: ImageObject[];
  texts?: TextObject[]; svgs?: SVGObject[];
}): CompositionState {
  const ids = [
    ...(parts.patterns ?? []), ...(parts.images ?? []), ...(parts.texts ?? []), ...(parts.svgs ?? []),
  ].map((o) => o.id);
  return {
    id: 'test', name: 'test',
    figures: [], svgObjects: parts.svgs ?? [], images: parts.images ?? [], texts: parts.texts ?? [],
    patternObjects: parts.patterns ?? [],
    lineDraft: null, arcDraft: null, editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 }, customColors: [],
    groups: parts.groups ?? [], sceneOrder: ids,
    gridLevel: 0, strokeScale: 1, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 }, viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(), activeFigureKey: null, compTool: 'select', createRegion: null,
    renderGeneration: 0,
  };
}

const IN_G1 = {
  groupId: 'g1', preGroupName: undefined,
  localCellX: 0, localCellY: 0, localCellWidth: 1, localCellHeight: 1,
};

function ungroup(ids: string[]): CompUndoEntry {
  return [{ op: 'ungroupFigures', figureIds: ids, groupId: 'g1', groupName: 'Group 1' }];
}

describe('ungroupFigures keeps the bbox kinds’ world orientation', () => {
  test('a pattern turned a quarter and flipped comes out turned and flipped', () => {
    const s = state({
      groups: [group()],
      patterns: [pattern({ ...IN_G1, rotation: 90, mirrorH: true, tileOffsetXL0: 1, localTileWidthL0: 2, localTileHeightL0: 2 })],
    });
    const out = applyCompOps(s, ungroup(['pat'])).patternObjects![0];
    expect(out.groupId).toBeUndefined();
    expect(out.rotation).toBe(90);
    expect(out.mirrorH).toBe(true);
    expect(out.mirrorV).toBeUndefined();
    // The tiling itself is untouched; only the group-local caches go.
    expect(out.tileMode).toBe('repeat');
    expect(out.tileWidthL0).toBe(2);
    expect(out.tileOffsetXL0).toBe(1);
    expect(out.localCellX).toBeUndefined();
    expect(out.localTileWidthL0).toBeUndefined();
    expect(out.localTileHeightL0).toBeUndefined();
    expect(out.identityCellX).toBeUndefined();
  });

  test('undoing a GROUPING keeps the poses as well — the group op’s revert had the same wipe', () => {
    const s = state({
      groups: [group()],
      patterns: [pattern({ ...IN_G1, rotation: 90, mirrorH: true, localTileWidthL0: 2, localTileHeightL0: 2 })],
      images: [image({ ...IN_G1, mirrorV: true })],
    });
    const back = revertCompOps(s, [{
      op: 'groupFigures', figureIds: ['pat', 'img'], groupId: 'g1', groupName: 'Group 1',
    }]);
    const pat = back.patternObjects![0];
    expect(pat.groupId).toBeUndefined();
    expect(pat.rotation).toBe(90);
    expect(pat.mirrorH).toBe(true);
    expect(pat.localTileWidthL0).toBeUndefined();
    expect(back.images![0].mirrorV).toBe(true);
    expect(back.groups).toHaveLength(0);
  });

  test('images and texts keep theirs too; an svg still drops its flags (its segments carry them)', () => {
    const s = state({
      groups: [group()],
      images: [image({ ...IN_G1, mirrorV: true })],
      texts: [text({ ...IN_G1, rotation: 180 })],
      svgs: [svg({ ...IN_G1, rotation: 90, localSegments: [{ kind: 'line', start: [0, 0], end: [1, 0] }] })],
    });
    const out = applyCompOps(s, ungroup(['img', 'txt', 'svg']));
    expect(out.images![0].mirrorV).toBe(true);
    expect(out.images![0].groupId).toBeUndefined();
    expect(out.texts![0].rotation).toBe(180);
    expect(out.svgObjects[0].rotation).toBeUndefined();
    expect(out.svgObjects[0].groupId).toBeUndefined();
  });

  test('a pose the group gave the member is kept as well — what was drawn is what stays', () => {
    // A pattern upright in its locals (its orientation snapshot says so),
    // inside a group flipped horizontally: the flip materializes into the
    // member's world flags…
    const s = state({
      groups: [group({ mirrorH: true })],
      patterns: [pattern({ ...IN_G1, localRotation: 0, localMirrorH: false, localMirrorV: false })],
    });
    const flipped = applyCompOps(s, [{
      op: 'transformGroup', groupId: 'g1',
      oldTranslateX: 0, oldTranslateY: 0, oldScaleX: 1, oldScaleY: 1, oldRotation: 0, oldMirrorH: false, oldMirrorV: false,
      newTranslateX: 0, newTranslateY: 0, newScaleX: 1, newScaleY: 1, newRotation: 0, newMirrorH: true, newMirrorV: false,
    }]);
    expect(flipped.patternObjects![0].mirrorH).toBe(true);
    // …and ungrouping leaves the loose pattern drawn the same way.
    const out = applyCompOps(flipped, ungroup(['pat'])).patternObjects![0];
    expect(out.mirrorH).toBe(true);
    expect(out.groupId).toBeUndefined();
  });

  test('undoing the ungroup regroups the members with their poses intact', () => {
    const s = state({
      groups: [group()],
      patterns: [pattern({ ...IN_G1, rotation: 270, mirrorV: true })],
    });
    const entry = ungroup(['pat']);
    const loose = applyCompOps(s, entry);
    const back = revertCompOps(loose, entry);
    expect(back.patternObjects![0].groupId).toBe('g1');
    expect(back.patternObjects![0].rotation).toBe(270);
    expect(back.patternObjects![0].mirrorV).toBe(true);
  });
});
