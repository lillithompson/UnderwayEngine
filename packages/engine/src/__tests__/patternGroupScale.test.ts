/**
 * Scaling a group scales a repeat pattern's TILING with it. The pattern
 * member used to materialize through the plain bbox path: its region
 * scaled but its tile pitch (tileWidthL0/tileHeightL0) and tile-grid
 * offset stayed at their absolute values, so a scaled group re-flowed a
 * fixed-size tiling into the resized region — the pattern visibly
 * re-aligned. Repeat patterns now carry local tile fields and scale them
 * through the chain exactly as tiled FIGURES always did
 * (materializeTileLocals): the repetition count stays constant, and a
 * pattern grouped with non-pattern neighbours scales as one tableau.
 */

import {
  backfillPatternTileLocals,
  materializeGroupMembers,
  reconcileGroupLocals,
} from '../compositionOps';
import {
  CompositionState,
  GroupNode,
  PatternObject,
  makeViewport,
} from '../types';

const WHITE = { r: 255, g: 255, b: 255 };

function makeState(over: Partial<CompositionState> = {}): CompositionState {
  const figures = over.figures ?? [];
  const svgObjects = over.svgObjects ?? [];
  const images = over.images ?? [];
  const patternObjects = over.patternObjects ?? [];
  const groups = over.groups ?? [];
  return {
    id: 't', name: 't',
    figures, svgObjects, images,
    imageBlobs: {},
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: WHITE,
    customColors: [],
    groups,
    sceneOrder: [
      ...images.map(i => i.id),
      ...figures.map(f => f.id),
      ...svgObjects.map(s => s.id),
      ...patternObjects.map(p => p.id),
    ],
    gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null, compTool: 'select',
    createRegion: null, renderGeneration: 0,
    patternObjects,
    ...over,
  };
}

function identityGroup(id: string): GroupNode {
  return {
    id, name: id,
    translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
    rotation: 0, mirrorH: false, mirrorV: false,
  };
}

function repeatPattern(over: Partial<PatternObject> = {}): PatternObject {
  return {
    id: 'pat_1',
    cellX: 4, cellY: 4, cellWidth: 8, cellHeight: 8,
    cols: 2, rows: 2,
    cells: [null, null, null, null],
    tileMode: 'repeat',
    tileWidthL0: 4, tileHeightL0: 4,
    tileOffsetXL0: 1, tileOffsetYL0: 2,
    groupId: 'grp_1',
    ...over,
  };
}

describe('a repeat pattern in a scaled group', () => {
  function scaledByTwo(p: PatternObject): PatternObject {
    let state = makeState({
      groups: [identityGroup('grp_1')],
      patternObjects: [p],
    });
    // Seed the locals the way the app does after grouping / loading…
    state = reconcileGroupLocals(state);
    // …then scale the group 2× and re-materialize its members.
    state = {
      ...state,
      groups: state.groups.map((g) => ({ ...g, scaleX: 2, scaleY: 2 })),
    };
    state = materializeGroupMembers(state, 'grp_1');
    return state.patternObjects![0];
  }

  test('scales the tile pitch AND the tile-grid offset with the region', () => {
    const p = scaledByTwo(repeatPattern());
    expect(p.cellWidth).toBe(16);
    expect(p.cellHeight).toBe(16);
    expect(p.tileWidthL0).toBe(8);
    expect(p.tileHeightL0).toBe(8);
    expect(p.tileOffsetXL0).toBe(2);
    expect(p.tileOffsetYL0).toBe(4);
  });

  test('the repetition count is constant — the drawing scales, it does not re-flow', () => {
    const before = repeatPattern();
    const p = scaledByTwo(before);
    expect(p.cellWidth / p.tileWidthL0!).toBeCloseTo(before.cellWidth / before.tileWidthL0!, 9);
    expect(p.cellHeight / p.tileHeightL0!).toBeCloseTo(before.cellHeight / before.tileHeightL0!, 9);
  });

  test('a non-repeat pattern is untouched beyond its bbox', () => {
    const p = scaledByTwo(repeatPattern({
      tileMode: undefined,
      tileWidthL0: undefined, tileHeightL0: undefined,
      tileOffsetXL0: undefined, tileOffsetYL0: undefined,
    }));
    expect(p.cellWidth).toBe(16);
    expect(p.tileWidthL0).toBeUndefined();
    expect(p.tileOffsetXL0).toBeUndefined();
  });

  test('scaling back down returns the tiling exactly', () => {
    let state = makeState({
      groups: [identityGroup('grp_1')],
      patternObjects: [repeatPattern()],
    });
    state = reconcileGroupLocals(state);
    state = { ...state, groups: state.groups.map((g) => ({ ...g, scaleX: 2, scaleY: 2 })) };
    state = materializeGroupMembers(state, 'grp_1');
    state = { ...state, groups: state.groups.map((g) => ({ ...g, scaleX: 1, scaleY: 1 })) };
    state = materializeGroupMembers(state, 'grp_1');
    const p = state.patternObjects![0];
    expect(p.cellWidth).toBe(8);
    expect(p.tileWidthL0).toBe(4);
    expect(p.tileHeightL0).toBe(4);
    expect(p.tileOffsetXL0).toBe(1);
    expect(p.tileOffsetYL0).toBe(2);
  });

  test('a pattern grouped with a non-pattern neighbour scales as one tableau', () => {
    // The image scales by the same ratio as the pattern's region AND its
    // tile — nothing about the composition changes but its size.
    let state = makeState({
      groups: [identityGroup('grp_1')],
      patternObjects: [repeatPattern()],
      images: [{
        id: 'img_1', imageId: 'blob_1', mimeType: 'image/png',
        pixelWidth: 10, pixelHeight: 10,
        cellX: 12, cellY: 4, cellWidth: 4, cellHeight: 4, groupId: 'grp_1',
      }],
    });
    state = reconcileGroupLocals(state);
    state = { ...state, groups: state.groups.map((g) => ({ ...g, scaleX: 0.5, scaleY: 0.5 })) };
    state = materializeGroupMembers(state, 'grp_1');
    const p = state.patternObjects![0];
    const img = state.images![0];
    expect(p.cellWidth).toBe(4);
    expect(p.tileWidthL0).toBe(2);
    expect(p.tileOffsetXL0).toBe(0.5);
    expect(img.cellWidth).toBe(2);
    // Relative placement holds: the gap between them halves with the rest.
    expect(img.cellX - (p.cellX + p.cellWidth)).toBeCloseTo(0, 9);
  });
});

describe('reloaded pages rebuild the tile locals', () => {
  // The binary format never writes the tile locals (derived caches): the
  // read backfills them through the group chain, so the FIRST group scale
  // after a reload still scales the tiling.
  test('backfillPatternTileLocals inverts the world tile through the chain', () => {
    const scaled = {
      ...repeatPattern(),
      tileWidthL0: 8, tileHeightL0: 8, tileOffsetXL0: 2, tileOffsetYL0: 4,
    };
    const groups = [{ ...identityGroup('grp_1'), scaleX: 2, scaleY: 2 }];
    const [p] = backfillPatternTileLocals([scaled], groups);
    expect(p.localTileWidthL0).toBe(4);
    expect(p.localTileHeightL0).toBe(4);
    expect(p.localTileOffsetXL0).toBe(1);
    expect(p.localTileOffsetYL0).toBe(2);
    // Ungrouped and non-repeat patterns pass through untouched…
    const loose = { ...scaled, groupId: undefined };
    expect(backfillPatternTileLocals([loose], groups)[0]).toBe(loose);
    const flat = { ...scaled, tileMode: undefined };
    expect(backfillPatternTileLocals([flat], groups)[0]).toBe(flat);
    // …and so does one that already carries its locals.
    const carrying = { ...scaled, localTileWidthL0: 4, localTileHeightL0: 4 };
    expect(backfillPatternTileLocals([carrying], groups)[0]).toBe(carrying);
  });
});
