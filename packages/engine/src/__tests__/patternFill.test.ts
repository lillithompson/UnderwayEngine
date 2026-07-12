import { CompositionState, PathSegment, SVGObject } from '../types';
import { PaletteItem } from '../figures';
import { buildPatternFillScene, findPatternFillInfo, isPatternFillGroup, patternFillBackground, resolveFigurePlacement, patternTileSizeL0, patternSizeFromTileL0, PatternFillIds, orderPatternsByUsage } from '../patternFill';
import { applyCompOps, buildRemoveObjectOp, deriveSceneOrderFromKindArrays, findRootGroupId } from '../compositionOps';
import { makeViewport } from '../types';
import type { CompUndoOp } from '../types';
import { compSnapStep } from '../compositionCellMath';

function squareSegments(x: number, y: number, size: number): PathSegment[] {
  return [
    { kind: 'line', start: [x, y], end: [x + size, y] },
    { kind: 'line', start: [x + size, y], end: [x + size, y + size] },
    { kind: 'line', start: [x + size, y + size], end: [x, y + size] },
    { kind: 'line', start: [x, y + size], end: [x, y] },
  ];
}

function makeMask(id: string, overrides: Partial<SVGObject> = {}): SVGObject {
  const segs = overrides.segments ?? squareSegments(4, 6, 10);
  return {
    id,
    color: { r: 0, g: 0, b: 0 },
    segments: segs,
    cellX: 4, cellY: 6, cellWidth: 10, cellHeight: 10,
    ...overrides,
  };
}

function makeState(svgObjects: SVGObject[]): CompositionState {
  return {
    figures: [], svgObjects, images: [], groups: [],
    sceneOrder: deriveSceneOrderFromKindArrays({ figures: [], svgObjects, images: [] }),
  } as unknown as CompositionState;
}

const BAKED_ITEM: PaletteItem = {
  key: 'baked_file9',
  label: 'Brick',
  source: null,
  dataUri: 'data:image/png;base64,xxx',
  resolutionX: 2,
  resolutionY: 2,
  isBaked: true,
  fileId: 'file9',
};

const IDS: PatternFillIds = { figureId: 'fig_pf', groupId: 'grp_pf' };

describe('resolveFigurePlacement', () => {
  test('baked tile-mode figure gets fileId, placementLevel, file_ key', () => {
    const fig: any = { id: 'f', figureKey: BAKED_ITEM.key, tileMode: 'repeat', resolutionX: 2, resolutionY: 3, cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1 };
    resolveFigurePlacement(fig, BAKED_ITEM, 2);
    expect(fig.fileId).toBe('file9');
    expect(fig.placementLevel).toBe(2);
    expect(fig.figureKey).toBe('file_file9_L2');
  });

  test('non-baked item keeps its palette key', () => {
    const fig: any = { id: 'f', figureKey: 'svgdesign_3', tileMode: 'repeat', resolutionX: 2, resolutionY: 2, cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1 };
    resolveFigurePlacement(fig, { ...BAKED_ITEM, isBaked: false, fileId: undefined, key: 'svgdesign_3' }, 2);
    expect(fig.fileId).toBeUndefined();
    expect(fig.figureKey).toBe('svgdesign_3');
  });
});

describe('buildPatternFillScene', () => {
  test('creates a tiled figure covering the mask bbox, grouped with the mask', () => {
    const mask = makeMask('m1', { fillColor: { r: 1, g: 2, b: 3 }, fillOpacity: 0.5 });
    const next = buildPatternFillScene(makeState([mask]), 'm1', BAKED_ITEM, 1, IDS, 1);

    // One tiled figure covering the bbox; tile = 1 cell at gridLevel 1.
    expect(next.figures).toHaveLength(1);
    const fig = next.figures[0];
    expect(fig.id).toBe('fig_pf');
    expect(fig.tileMode).toBe('repeat');
    expect(fig.cellX).toBe(4);
    expect(fig.cellY).toBe(6);
    expect(fig.cellWidth).toBe(10);
    expect(fig.cellHeight).toBe(10);
    expect(fig.tileWidthL0).toBe(compSnapStep(1)); // 1 cell at L1 = 2 L0
    expect(fig.tileHeightL0).toBe(compSnapStep(1));

    // Mask flagged; its solid fill is PRESERVED (rendered as the pattern's
    // background, not the shape's own fill) so the shape shows both.
    const m = next.svgObjects.find(s => s.id === 'm1')!;
    expect(m.isMask).toBe(true);
    expect(m.isPatternFill).toBe(true);
    expect(m.fillColor).toEqual({ r: 1, g: 2, b: 3 });
    expect(m.fillOpacity).toBe(0.5);

    // Both are in the same new group, and the figure paints below the mask.
    expect(m.groupId).toBe('grp_pf');
    expect(fig.groupId).toBe('grp_pf');
    expect(next.groups.some(g => g.id === 'grp_pf')).toBe(true);
    expect(next.sceneOrder.indexOf('fig_pf')).toBeLessThan(next.sceneOrder.indexOf('m1'));
  });

  test('tile size scales with pattern size and grid level', () => {
    // 3 cells at gridLevel 2 → 3 * compSnapStep(2) = 3 * 4 = 12 L0.
    const next = buildPatternFillScene(makeState([makeMask('m1')]), 'm1', BAKED_ITEM, 2, IDS, 3);
    const fig = next.figures[0];
    expect(fig.tileWidthL0).toBe(3 * compSnapStep(2));
    expect(fig.tileHeightL0).toBe(3 * compSnapStep(2));
  });

  test('non-square figure tiles with preserved aspect, fit into the N-cell box', () => {
    const item: PaletteItem = { ...BAKED_ITEM, resolutionX: 2, resolutionY: 4 };
    const next = buildPatternFillScene(makeState([makeMask('m1')]), 'm1', item, 2, IDS, 1);
    const fig = next.figures[0];
    const box = compSnapStep(2); // 1 cell at L2 = 4 L0
    // Longer side (height, res 4) spans the full box; width scales by 2/4.
    expect(fig.tileHeightL0).toBe(box);
    expect(fig.tileWidthL0).toBe(box * 2 / 4);
    // Aspect ratio matches the figure's native resolution (no stretch).
    expect(fig.tileWidthL0! / fig.tileHeightL0!).toBeCloseTo(2 / 4, 6);
  });

  test('tile grid is phased so a tile is centered on the shape bbox', () => {
    // bbox is 10×10 (from makeMask default). At gridLevel 0, size 1 → tile 1 L0.
    const next = buildPatternFillScene(makeState([makeMask('m1')]), 'm1', BAKED_ITEM, 0, IDS, 1);
    const fig = next.figures[0];
    // Offset centers the tile: (region - tile) / 2 on each axis.
    expect(fig.tileOffsetXL0).toBeCloseTo((fig.cellWidth - fig.tileWidthL0!) / 2, 9);
    expect(fig.tileOffsetYL0).toBeCloseTo((fig.cellHeight - fig.tileHeightL0!) / 2, 9);
    // A tile boundary lands at (region center - tile/2), i.e. a tile is centered.
    const patOrigin = fig.cellX + fig.tileOffsetXL0!;
    const center = fig.cellX + fig.cellWidth / 2;
    expect(center - patOrigin).toBeCloseTo(fig.tileWidthL0! / 2, 9);
  });

  test('returns the base unchanged when the mask id is missing', () => {
    const base = makeState([makeMask('m1')]);
    expect(buildPatternFillScene(base, 'nope', BAKED_ITEM, 1, IDS)).toBe(base);
  });
});

describe('pattern size <-> tile size', () => {
  test('patternTileSizeL0 = size * cell size, clamped to 1..4', () => {
    expect(patternTileSizeL0(2, 2)).toBe(2 * compSnapStep(2));
    expect(patternTileSizeL0(0, 0)).toBe(1 * compSnapStep(0)); // clamps up to 1
    expect(patternTileSizeL0(9, 3)).toBe(4 * compSnapStep(3)); // clamps down to 4
  });

  test('patternSizeFromTileL0 inverts patternTileSizeL0', () => {
    for (const size of [1, 2, 3, 4]) {
      for (const level of [0, 1, 2, 3]) {
        expect(patternSizeFromTileL0(patternTileSizeL0(size, level), level)).toBe(size);
      }
    }
    expect(patternSizeFromTileL0(undefined, 2)).toBe(1);
  });
});

describe('orderPatternsByUsage', () => {
  const items = (...keys: string[]) => keys.map(key => ({ key }));

  test('no usage and no selection preserves incoming order', () => {
    const list = items('a', 'b', 'c');
    expect(orderPatternsByUsage(list, [], null).map(i => i.key)).toEqual(['a', 'b', 'c']);
  });

  test('orders by most-recently-used first, unused keep relative order behind', () => {
    // usageOrder is most-recent-first: c then a were used; b never used.
    const out = orderPatternsByUsage(items('a', 'b', 'c'), ['c', 'a'], null);
    expect(out.map(i => i.key)).toEqual(['c', 'a', 'b']);
  });

  test('selected key jumps to the front even ahead of more-recent uses', () => {
    const out = orderPatternsByUsage(items('a', 'b', 'c'), ['c', 'a'], 'b');
    expect(out.map(i => i.key)).toEqual(['b', 'c', 'a']);
  });

  test('does not mutate the input array', () => {
    const list = items('a', 'b', 'c');
    const snapshot = list.map(i => i.key);
    orderPatternsByUsage(list, ['c'], 'b');
    expect(list.map(i => i.key)).toEqual(snapshot);
  });
});

describe('findPatternFillInfo', () => {
  test('round-trips the tiled figure of a pattern-fill mask', () => {
    const mask = makeMask('m1');
    const next = buildPatternFillScene(makeState([mask]), 'm1', BAKED_ITEM, 1, IDS);
    const info = findPatternFillInfo(next, 'm1');
    expect(info).not.toBeNull();
    expect(info!.figureId).toBe('fig_pf');
    expect(info!.fileId).toBe('file9');
    expect(info!.figureKey).toBe('file_file9_L1');
  });

  test('returns null for a plain (non-pattern) mask', () => {
    const mask = makeMask('m1', { isMask: true, groupId: 'g' });
    expect(findPatternFillInfo(makeState([mask]), 'm1')).toBeNull();
  });
});

describe('patternFillBackground', () => {
  test('returns the mask fill for the tiled figure of a pattern fill', () => {
    const mask = makeMask('m1', { fillColor: { r: 1, g: 2, b: 3 }, fillOpacity: 0.5 });
    const next = buildPatternFillScene(makeState([mask]), 'm1', BAKED_ITEM, 1, IDS);
    const fig = next.figures.find(f => f.id === 'fig_pf')!;
    expect(patternFillBackground(fig, next.svgObjects)).toEqual({
      fillColor: { r: 1, g: 2, b: 3 }, fillOpacity: 0.5,
    });
  });

  test('returns null when the mask carries no fill color', () => {
    const next = buildPatternFillScene(makeState([makeMask('m1')]), 'm1', BAKED_ITEM, 1, IDS);
    const fig = next.figures.find(f => f.id === 'fig_pf')!;
    expect(patternFillBackground(fig, next.svgObjects)).toBeNull();
  });

  test('returns null for a non-pattern tiled figure', () => {
    const mask = makeMask('m1', { fillColor: { r: 1, g: 2, b: 3 } });
    const next = buildPatternFillScene(makeState([mask]), 'm1', BAKED_ITEM, 1, IDS);
    const fig = { ...next.figures.find(f => f.id === 'fig_pf')!, groupId: undefined };
    expect(patternFillBackground(fig, next.svgObjects)).toBeNull();
  });
});

describe('isPatternFillGroup', () => {
  test('true for the group built by buildPatternFillScene, false otherwise', () => {
    const next = buildPatternFillScene(makeState([makeMask('m1')]), 'm1', BAKED_ITEM, 1, IDS);
    expect(isPatternFillGroup(next, IDS.groupId)).toBe(true);
    expect(isPatternFillGroup(next, 'some-other-group')).toBe(false);
  });

  test('false for a plain mask group', () => {
    const mask = makeMask('m1', { isMask: true, groupId: 'g' });
    expect(isPatternFillGroup(makeState([mask]), 'g')).toBe(false);
  });
});

describe('remove pattern fill', () => {
  // A fuller state than makeState() above, so the ungroup/remove engine ops have
  // every field they read available.
  function fullState(svgObjects: SVGObject[]): CompositionState {
    return {
      id: 't', name: 't', figures: [], svgObjects, images: [], imageBlobs: {},
      lineDraft: null, arcDraft: null, paintStroke: null, editingLineId: null,
      selectedVertexIndex: null, lastChosenColor: { r: 255, g: 255, b: 255 }, customColors: [],
      groups: [], sceneOrder: svgObjects.map(s => s.id), gridLevel: 1, strokeScale: 1,
      gridIntensity: 0.3, camera: { offsetX: 0, offsetY: 0, zoom: 1 }, viewport: makeViewport(1024, 768),
      selectedFigureIds: new Set(), activeFigureKey: null, compTool: 'color', createRegion: null, renderGeneration: 0,
    } as unknown as CompositionState;
  }

  // Reconstruct CompositionEditor's buildUngroupOpForGroup (component-local).
  function ungroupOp(state: CompositionState, rootGroupId: string): CompUndoOp {
    const figureIds = [
      ...state.figures.filter(f => f.groupId === rootGroupId).map(f => f.id),
      ...state.svgObjects.filter(sv => sv.groupId === rootGroupId).map(sv => sv.id),
    ];
    const maskedSvgIds = state.svgObjects.filter(sv => sv.groupId === rootGroupId && sv.isMask).map(sv => sv.id);
    const rootNode = state.groups.find(g => g.id === rootGroupId);
    return {
      op: 'ungroupFigures', figureIds, groupId: rootGroupId, groupName: rootNode?.name ?? '',
      maskedSvgIds: maskedSvgIds.length > 0 ? maskedSvgIds : undefined,
    } as CompUndoOp;
  }

  // Mirror handleRemovePatternFill's state transformation.
  function removePatternFill(s: CompositionState, maskId: string): CompositionState {
    const mask = s.svgObjects.find(l => l.id === maskId)!;
    const rootGid = findRootGroupId(s.groups, mask.groupId!);
    const info = findPatternFillInfo(s, mask.id);
    let base = s;
    if (base.groups.some(g => g.id === rootGid)) base = applyCompOps(base, [ungroupOp(base, rootGid)]);
    const figId = info?.figureId ?? '';
    if (base.figures.some(f => f.id === figId)) {
      const rm = buildRemoveObjectOp(base, figId);
      if (rm) base = applyCompOps(base, [rm]);
    }
    return {
      ...base,
      svgObjects: base.svgObjects.map(l => l.id === mask.id
        ? { ...l, isMask: undefined, isPatternFill: undefined, fillColor: undefined, fillOpacity: undefined }
        : l),
    };
  }

  test('leaves a single bare shape with no fill or pattern figure', () => {
    const mask = makeMask('m1', { fillColor: { r: 10, g: 20, b: 30 }, fillOpacity: 0.5 });
    const withPattern = buildPatternFillScene(fullState([mask]), 'm1', BAKED_ITEM, 1, IDS, 1);
    // Precondition: the patterned shape kept its fill (as the tile background).
    expect(withPattern.figures).toHaveLength(1);
    expect(withPattern.svgObjects.find(s => s.id === 'm1')!.fillColor).toEqual({ r: 10, g: 20, b: 30 });

    const removed = removePatternFill(withPattern, 'm1');
    expect(removed.figures).toHaveLength(0);
    expect(removed.groups).toHaveLength(0);
    expect(removed.svgObjects).toHaveLength(1);
    const shape = removed.svgObjects[0];
    expect(shape.id).toBe('m1');
    expect(shape.isPatternFill).toBeUndefined();
    expect(shape.isMask).toBeUndefined();
    expect(shape.fillColor).toBeUndefined();
    expect(shape.fillOpacity).toBeUndefined();
    expect(shape.groupId).toBeUndefined();
  });
});
