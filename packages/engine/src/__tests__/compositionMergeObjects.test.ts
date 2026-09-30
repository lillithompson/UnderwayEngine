import {
  CellState,
  CompositionState,
  DEFAULT_TRANSFORM,
  GroupNode,
  PathSegment,
  PatternObject,
  RGBColor,
  SVGObject,
  makeViewport,
} from '../types';
import { patternSVGView } from '../patternObjectRender';
import {
  applyCompOps,
  revertCompOps,
  computeSVGBbox,
  deriveSceneOrderFromKindArrays,
} from '../compositionOps';
import { canMergeObjects, canMergeSelection, buildMergeEntry, mergedSVGObject } from '../compositionMergeObjects';
import { buildSVGObjectContent, svgIsFilled, svgIsStroked } from '../svgPathBuilder';
import { closedSegmentLoops, computeSignedArea } from '../compositionArcMath';

const WHITE: RGBColor = { r: 255, g: 255, b: 255 };
const RED: RGBColor = { r: 200, g: 0, b: 0 };
const BLUE: RGBColor = { r: 0, g: 0, b: 200 };

/** A group that transforms nothing — enough to hold members. */
const IDENTITY_GROUP: GroupNode = {
  id: 'g1', name: 'Group 1',
  translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false,
};

function line(start: [number, number], end: [number, number]): PathSegment {
  return { kind: 'line', start, end };
}
/** Closed polyline through the given vertices (last → first implied). */
function poly(...pts: [number, number][]): PathSegment[] {
  return pts.map((p, i) => line(p, pts[(i + 1) % pts.length]));
}
function square(x: number, y: number, s: number): PathSegment[] {
  return poly([x, y], [x + s, y], [x + s, y + s], [x, y + s]);
}

function makeSVG(id: string, segments: PathSegment[], overrides: Partial<SVGObject> = {}): SVGObject {
  return { id, segments, color: WHITE, ...computeSVGBbox(segments), ...overrides };
}

function makeState(svgObjects: SVGObject[], selected: string[]): CompositionState {
  return {
    id: 'test', name: 'test',
    figures: [], svgObjects, images: [], imageBlobs: {},
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: WHITE, customColors: [],
    groups: [],
    sceneOrder: deriveSceneOrderFromKindArrays({ figures: [], svgObjects, images: [] }),
    gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(selected),
    activeFigureKey: null,
    compTool: 'select',
    createRegion: null,
    renderGeneration: 0,
  };
}

describe('canMergeObjects', () => {
  it('needs at least two objects', () => {
    expect(canMergeObjects([makeSVG('a', square(0, 0, 10))])).toBe(false);
  });

  it('asks nothing of the geometry — the point of a flatten', () => {
    // Two straight lines that neither touch nor enclose anything. A boolean
    // union has nothing to say about them; a merge simply makes them one
    // object.
    const p = makeSVG('a', [line([0, 0], [10, 0])]);
    const q = makeSVG('b', [line([0, 5], [10, 5])]);
    expect(canMergeObjects([p, q])).toBe(true);
    // As do an open stroke and a closed shape, and two closed shapes.
    expect(canMergeObjects([makeSVG('c', square(0, 0, 10)), p])).toBe(true);
    expect(canMergeObjects([makeSVG('c', square(0, 0, 10)), makeSVG('d', square(4, 4, 10))])).toBe(true);
  });

  it('rejects patterns — a tiling is not an outline', () => {
    const base = makeSVG('a', square(0, 0, 10));
    expect(canMergeObjects([base, makeSVG('b', square(5, 5, 10), { tileMode: 'repeat' })])).toBe(false);
    expect(canMergeObjects([base, makeSVG('b', square(5, 5, 10), { isPatternFill: true })])).toBe(false);
  });

  it('rejects an object with no geometry to contribute', () => {
    expect(canMergeObjects([makeSVG('a', square(0, 0, 10)), makeSVG('b', [])])).toBe(false);
  });
});

describe('mergedSVGObject', () => {
  it('keeps every source segment, in back-to-front order', () => {
    const a = makeSVG('a', [line([0, 0], [10, 0])]);
    const b = makeSVG('b', [line([0, 5], [10, 5]), line([10, 5], [10, 9])]);
    const merged = mergedSVGObject([a, b], 'm');
    expect(merged.segments).toHaveLength(3);
    expect(merged.segments[0]).toEqual(a.segments[0]);
    expect(merged.segments[1]).toEqual(b.segments[0]);
    // Deep-cloned, so editing the merged object can't reach back into a source.
    expect(merged.segments[0]).not.toBe(a.segments[0]);
  });

  it('spans every source in its bbox — one box to drag them all by', () => {
    const a = makeSVG('a', square(0, 0, 10));
    const b = makeSVG('b', square(20, 6, 4));
    const merged = mergedSVGObject([a, b], 'm');
    expect(merged.cellX).toBeCloseTo(0);
    expect(merged.cellY).toBeCloseTo(0);
    expect(merged.cellWidth).toBeCloseTo(24);
    expect(merged.cellHeight).toBeCloseTo(10);
  });

  it('keeps the front-most source s PATTERN fill, as it keeps its stroke', () => {
    // A merged object IS the front-most source wearing more outline; its
    // pattern goes with it (and repeats across the bigger box), rather
    // than being dropped without a word.
    const cells: CellState[] = [
      { type: 'sprite', spriteId: 'test/tile_00000000', transform: { ...DEFAULT_TRANSFORM } },
      null, null, null,
    ];
    const patternFill = { size: 2, cells, tileL0: 2 };
    const a = makeSVG('a', square(0, 0, 10));
    const b = makeSVG('b', square(5, 5, 10), { patternFill });
    expect(mergedSVGObject([a, b], 'm').patternFill).toEqual(patternFill);
    // …and nothing is invented for sources that carry none.
    expect(mergedSVGObject([b, a], 'm2').patternFill).toBeUndefined();
  });

  it('wears the front-most source\'s stroke color, not one per source', () => {
    const a = makeSVG('a', square(0, 0, 10), { color: RED });
    const b = makeSVG('b', square(5, 5, 10), { color: BLUE });
    const merged = mergedSVGObject([a, b], 'm');
    // One style: the front-most source's — the first row of the Scene
    // Outline, which lists front to back.
    expect(merged.color).toEqual(BLUE);
    expect(merged.subpaths).toBeUndefined();
  });

  it('keeps a Fill-bar fill with no outline — two such shapes merge into one, still visible', () => {
    // The report: two filled, outline-less shapes merged into a shape with
    // neither, i.e. nothing on screen.
    const fill = {
      type: 'solid' as const, solid: RED, stops: [{ offset: 0, color: RED }, { offset: 1, color: BLUE }],
      angle: 90, opacity: 1, blend: 'normal' as const,
    };
    const a = makeSVG('a', square(0, 0, 10), { fill, stroke: { width: 0 } });
    const b = makeSVG('b', square(5, 5, 10), { fill: { ...fill, solid: BLUE }, stroke: { width: 0 } });
    const merged = mergedSVGObject([a, b], 'm');
    expect(svgIsFilled(merged)).toBe(true);
    expect(svgIsStroked(merged)).toBe(false);
    expect(merged.fill?.solid).toEqual(BLUE);
    // Every source's loop is filled by that one fill.
    expect(closedSegmentLoops(merged.segments)).toHaveLength(2);
    // …and the markup actually paints it.
    expect(buildSVGObjectContent(merged, 8, 16)).toContain('fill="#0000C8"');
  });

  it('two filled shapes with no outline merge into one filled shape with no outline, in the front-most fill', () => {
    // The rule in one line: the result is never a shape with neither fill nor
    // stroke, and its style is the first row of the Scene Outline's (the
    // front-most source, last in the back-to-front `sources`).
    const solid = (c: RGBColor) => ({
      type: 'solid' as const, solid: c, stops: [], angle: 90, opacity: 1, blend: 'normal' as const,
    });
    const back = makeSVG('a', square(0, 0, 10), { fill: solid(RED), stroke: { width: 0 } });
    const front = makeSVG('b', square(20, 0, 10), { fill: solid(BLUE), stroke: { width: 0 } });
    const merged = mergedSVGObject([back, front], 'm');
    expect(svgIsFilled(merged)).toBe(true);
    expect(svgIsStroked(merged)).toBe(false);
    expect(merged.fill?.type).toBe('solid');
    expect(merged.fill?.solid).toEqual(BLUE);
    expect(merged.stroke).toEqual({ width: 0 });
    expect(merged.subpaths).toBeUndefined();
    // The other way round, the other fill.
    expect(mergedSVGObject([front, back], 'm2').fill?.solid).toEqual(RED);

    // The same through the legacy `fillColor`, which older saves still carry.
    const oldBack = makeSVG('c', square(0, 0, 10), { fillColor: RED, stroke: { width: 0 } });
    const oldFront = makeSVG('d', square(20, 0, 10), { fillColor: BLUE, stroke: { width: 0 } });
    const oldMerged = mergedSVGObject([oldBack, oldFront], 'm3');
    expect(svgIsFilled(oldMerged)).toBe(true);
    expect(svgIsStroked(oldMerged)).toBe(false);
    expect(oldMerged.fillColor).toEqual(BLUE);
  });

  it('takes its fill (or its lack of one) from the front-most source alone', () => {
    const filled = makeSVG('a', square(0, 0, 10), { color: RED, fillColor: BLUE });
    const outline = makeSVG('b', square(5, 5, 10), { color: RED });
    const onTop = mergedSVGObject([outline, filled], 'm');
    expect(onTop.fillColor).toEqual(BLUE);
    expect(svgIsStroked(onTop)).toBe(true);
    const underneath = mergedSVGObject([filled, outline], 'm2');
    expect(svgIsFilled(underneath)).toBe(false);
    expect(underneath.color).toEqual(RED);
  });

  it('winds every source the same way, so an overlap fills rather than cancelling', () => {
    const cw = makeSVG('a', square(0, 0, 10), { fillColor: RED, stroke: { width: 0 } });
    // The same square traced the other way round (a mirrored copy).
    const ccw = makeSVG('b', square(5, 5, 10).map((sg) => ({ ...sg, start: sg.end, end: sg.start })).reverse(),
      { fillColor: RED, stroke: { width: 0 } });
    const merged = mergedSVGObject([cw, ccw], 'm');
    const areas = closedSegmentLoops(merged.segments).map(computeSignedArea);
    expect(areas).toHaveLength(2);
    expect(Math.sign(areas[0])).toBe(Math.sign(areas[1]));
  });

  it('keeps per-source colors when the front-most source already draws in several', () => {
    const multi = makeSVG('b', square(5, 5, 10), {
      color: RED,
      subpaths: [
        { segments: [line([0, 0], [1, 0])], color: RED },
        { segments: [line([1, 0], [2, 0])], color: BLUE },
      ],
    });
    const plain = makeSVG('a', square(0, 0, 10), { color: BLUE, fillColor: RED });
    const merged = mergedSVGObject([plain, multi], 'm');
    // plain's fill + stroke, then multi's two sub-paths — not its own segments a second time.
    expect(merged.subpaths!.map((s) => [s.color, !!s.fill])).toEqual([
      [RED, true], [BLUE, false], [RED, false], [BLUE, false],
    ]);
  });

  it('per-source colors carry a Fill-bar fill and honor "no outline"', () => {
    const multi = makeSVG('b', square(5, 5, 10), {
      subpaths: [{ segments: [line([0, 0], [1, 0])], color: RED }],
    });
    const fillOnly = makeSVG('a', square(0, 0, 10), {
      fill: { type: 'solid', solid: BLUE, stops: [], angle: 90, opacity: 1, blend: 'normal' },
      stroke: { width: 0 },
    });
    const merged = mergedSVGObject([fillOnly, multi], 'm');
    expect(merged.subpaths!.map((s) => [s.color, !!s.fill])).toEqual([[BLUE, true], [RED, false]]);
  });

  it('bakes a free rotation, so a twisted source stays twisted', () => {
    // A 90° twist about the box center takes (0,0)→(10,0) to (5,-5)→(5,5).
    const twisted = makeSVG('a', [line([0, 0], [10, 0])], { angleDeg: 90 });
    // Its bbox is the flat line's: center (5, 0).
    const b = makeSVG('b', [line([0, 5], [10, 5])]);
    const merged = mergedSVGObject([twisted, b], 'm');
    const [sx, sy] = merged.segments[0].start;
    const [ex, ey] = merged.segments[0].end;
    expect(sx).toBeCloseTo(5, 6);
    expect(sy).toBeCloseTo(-5, 6);
    expect(ex).toBeCloseTo(5, 6);
    expect(ey).toBeCloseTo(5, 6);
    // And the merged object carries no angle of its own to re-apply.
    expect(merged.angleDeg).toBeUndefined();
  });

  it('keeps the group when every source shared one, and leaves it otherwise', () => {
    const inG = (id: string, x: number) => makeSVG(id, square(x, 0, 4), {
      groupId: 'g1', localSegments: square(x, 0, 4),
    });
    expect(mergedSVGObject([inG('a', 0), inG('b', 8)], 'm').groupId).toBe('g1');
    // Locals concatenate in the same order as the world segments, so a later
    // group transform re-derives geometry that still matches.
    expect(mergedSVGObject([inG('a', 0), inG('b', 8)], 'm').localSegments).toHaveLength(8);
    // Mixed groups have no one group to keep.
    expect(mergedSVGObject([inG('a', 0), makeSVG('b', square(8, 0, 4))], 'm').groupId).toBeUndefined();
  });
});

describe('buildMergeEntry', () => {
  it('replaces the sources with one object and undoes cleanly', () => {
    const a = makeSVG('a', square(0, 0, 10));
    const b = makeSVG('b', [line([20, 0], [30, 0])]); // an open stroke, merged all the same
    const state = makeState([a, b], ['a', 'b']);

    const built = buildMergeEntry(state, state.selectedFigureIds)!;
    expect(built).not.toBeNull();
    const next = applyCompOps(state, built.entry);
    expect(next.svgObjects).toHaveLength(1);
    expect(next.svgObjects[0].id).toBe(built.resultId);
    expect(next.svgObjects[0].segments).toHaveLength(5);
    expect(next.sceneOrder).toEqual([built.resultId]);

    const back = revertCompOps(next, built.entry);
    expect(back.svgObjects.map((s) => s.id)).toEqual(['a', 'b']);
    expect(back.sceneOrder).toEqual(['a', 'b']);
  });

  it('lands at the front-most source\'s z-slot, under what was above it', () => {
    const a = makeSVG('a', square(0, 0, 4));
    const b = makeSVG('b', square(6, 0, 4));
    const top = makeSVG('top', square(12, 0, 4));
    const state = makeState([a, b, top], ['a', 'b']);

    const built = buildMergeEntry(state, state.selectedFigureIds)!;
    const next = applyCompOps(state, built.entry);
    expect(next.sceneOrder).toEqual([built.resultId, 'top']);
  });

  it('refuses a selection holding text, an image, or a figure', () => {
    const a = makeSVG('a', square(0, 0, 10));
    const b = makeSVG('b', square(5, 5, 10));

    const withText: CompositionState = {
      ...makeState([a, b], ['a', 'b', 't1']),
      texts: [{
        id: 't1', content: 'hi',
        style: { fontId: 'CozySans', size: 2, color: WHITE },
        cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2,
      }],
    };
    expect(canMergeSelection(withText, withText.selectedFigureIds)).toBe(false);
    expect(buildMergeEntry(withText, withText.selectedFigureIds)).toBeNull();

    const withImage: CompositionState = {
      ...makeState([a, b], ['a', 'b', 'i1']),
      images: [{
        id: 'i1', imageId: 'blob1', mimeType: 'image/png', pixelWidth: 4, pixelHeight: 4,
        cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8,
      }],
    };
    expect(canMergeSelection(withImage, withImage.selectedFigureIds)).toBe(false);

    const withFigure: CompositionState = {
      ...makeState([a, b], ['a', 'b', 'f1']),
      figures: [{
        id: 'f1', figureKey: 'k', cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
        resolutionX: 2, resolutionY: 2,
      }],
    };
    expect(canMergeSelection(withFigure, withFigure.selectedFigureIds)).toBe(false);
  });

  it('never points the result at a group its own merge emptied', () => {
    // Merging a group's LAST members empties the group, and the removal prunes
    // it. The merged object must not keep that id — it would name a group the
    // scene no longer has.
    const inG = (id: string, x: number) => makeSVG(id, square(x, 0, 4), {
      groupId: 'g1', localSegments: square(x, 0, 4),
    });
    const base = makeState([inG('a', 0), inG('b', 8)], ['a', 'b']);
    const state: CompositionState = {
      ...base,
      groups: [IDENTITY_GROUP],
    };

    const built = buildMergeEntry(state, state.selectedFigureIds)!;
    const next = applyCompOps(state, built.entry);
    const merged = next.svgObjects.find((s) => s.id === built.resultId)!;
    const groupIds = next.groups.map((g) => g.id);
    expect(merged.groupId === undefined || groupIds.includes(merged.groupId)).toBe(true);
    // And with no group to belong to, it carries no group-local geometry.
    if (merged.groupId === undefined) expect(merged.localSegments).toBeUndefined();
  });

  it('stays in a group that outlives the merge', () => {
    const inG = (id: string, x: number) => makeSVG(id, square(x, 0, 4), {
      groupId: 'g1', localSegments: square(x, 0, 4),
    });
    // A third member keeps the group standing, so the merged object stays in it.
    const base = makeState([inG('a', 0), inG('b', 8), inG('c', 16)], ['a', 'b']);
    const state: CompositionState = {
      ...base,
      groups: [IDENTITY_GROUP],
    };

    const built = buildMergeEntry(state, state.selectedFigureIds)!;
    const next = applyCompOps(state, built.entry);
    const merged = next.svgObjects.find((s) => s.id === built.resultId)!;
    expect(next.groups.map((g) => g.id)).toContain('g1');
    expect(merged.groupId).toBe('g1');
    expect(merged.localSegments).toHaveLength(8);
  });

  it('refuses one object on its own', () => {
    const state = makeState([makeSVG('a', square(0, 0, 10))], ['a']);
    expect(canMergeSelection(state, state.selectedFigureIds)).toBe(false);
    expect(buildMergeEntry(state, state.selectedFigureIds)).toBeNull();
  });
});

// A pattern object joins a merge as the svg view it already bakes to, so a
// flattened pattern is exactly the picture that was on screen. Colour cells
// throughout: a SPRITE cell bakes to nothing in this environment (no tile
// vector sources), which is why every bake-dependent test here uses colours.
describe('merging a pattern with a vector', () => {
  function colorCell(): CellState {
    return { type: 'color', r: 200, g: 30, b: 30, transform: { ...DEFAULT_TRANSFORM } };
  }

  function makePattern(id: string, over: Partial<PatternObject> = {}): PatternObject {
    return {
      id, cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2, cols: 2, rows: 2,
      cells: new Array(4).fill(null).map(colorCell),
      ...over,
    };
  }

  function stateWith(
    svgObjects: SVGObject[],
    patternObjects: PatternObject[],
    selected: string[],
  ): CompositionState {
    const base = makeState(svgObjects, selected);
    return {
      ...base,
      patternObjects,
      sceneOrder: [...svgObjects.map((s) => s.id), ...patternObjects.map((p) => p.id)],
    };
  }

  const LINE = makeSVG('svg_a', [line([0, 0], [10, 0])]);

  it('merges, and the result is ONE svg object — the pattern is spent', () => {
    const pat = makePattern('pat_1');
    const state = stateWith([LINE], [pat], []);
    const ids = new Set(['svg_a', 'pat_1']);
    expect(canMergeSelection(state, ids)).toBe(true);

    const built = buildMergeEntry(state, ids)!;
    const after = applyCompOps(state, built.entry);
    expect(after.patternObjects ?? []).toHaveLength(0);
    expect(after.svgObjects.map((s) => s.id)).toEqual([built.resultId]);
    expect(after.sceneOrder).toEqual([built.resultId]);

    // The pattern's baked geometry came along: the merged object holds the
    // line's segments AND the pattern view's.
    const patSegs = patternSVGView(pat)!.segments.length;
    const merged = after.svgObjects[0];
    expect(patSegs).toBeGreaterThan(0);
    expect(merged.segments.length).toBe(LINE.segments.length + patSegs);

    // …and undo puts the pattern back as a pattern, not as a vector.
    const back = revertCompOps(after, built.entry);
    expect((back.patternObjects ?? []).map((p) => p.id)).toEqual(['pat_1']);
    expect(back.svgObjects.map((s) => s.id)).toEqual(['svg_a']);
  });

  it('two patterns merge with each other', () => {
    const state = stateWith(
      [], [makePattern('pat_1'), makePattern('pat_2', { cellX: 4 })], [],
    );
    const built = buildMergeEntry(state, new Set(['pat_1', 'pat_2']))!;
    const after = applyCompOps(state, built.entry);
    expect(after.patternObjects ?? []).toHaveLength(0);
    expect(after.svgObjects).toHaveLength(1);
  });

  it('refuses a REPEATING pattern — a tiling is not an outline', () => {
    // Flattening one would collapse the whole repeat down to a single tile,
    // silently changing the picture.
    const state = stateWith([LINE], [makePattern('pat_1', {
      tileMode: 'repeat', tileWidthL0: 1, tileHeightL0: 1,
    })], []);
    expect(canMergeSelection(state, new Set(['svg_a', 'pat_1']))).toBe(false);
    expect(buildMergeEntry(state, new Set(['svg_a', 'pat_1']))).toBeNull();
  });

  it('refuses an EMPTY pattern rather than quietly spending it', () => {
    // It bakes to nothing, so merging would consume an object and get no
    // geometry back — the selection would come out one object short.
    const state = stateWith([LINE], [makePattern('pat_1', {
      cells: new Array(4).fill(null),
    })], []);
    expect(canMergeSelection(state, new Set(['svg_a', 'pat_1']))).toBe(false);
  });

  it('still refuses a selection holding a text, image or figure', () => {
    const state = stateWith([LINE], [makePattern('pat_1')], []);
    const withText: CompositionState = {
      ...state,
      texts: [{ id: 'txt_1', cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1 } as never],
    };
    expect(canMergeSelection(withText, new Set(['pat_1', 'txt_1']))).toBe(false);
  });
});
