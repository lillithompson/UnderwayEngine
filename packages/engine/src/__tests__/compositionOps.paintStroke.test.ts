import { buildPaintStrokeOps, regroupSegmentsByColor, applyCompOps, revertCompOps } from '@/engine/compositionOps';
import { makeViewport } from '@/engine/types';
import type { CompositionState, CompUndoOp, PaintStrokeDraft, PathSegment, RGBColor, SVGObject } from '@/engine/types';
import { packKey } from '@/engine/tileSegmentOverrides';

const rgb = (r: number, g: number, b: number): RGBColor => ({ r, g, b });

function line(start: [number, number], end: [number, number]): PathSegment {
  return { kind: 'line', start, end };
}

function makeSVG(id: string, segments: PathSegment[], color: RGBColor, extras: Partial<SVGObject> = {}): SVGObject {
  return {
    id,
    segments,
    color,
    cellX: 0,
    cellY: 0,
    cellWidth: 10,
    cellHeight: 10,
    ...extras,
  };
}

function makeState(svgs: SVGObject[]): CompositionState {
  return {
    id: 'test',
    name: 'test',
    figures: [],
    svgObjects: svgs,
    images: [],
    imageBlobs: {},
    lineDraft: null,
    arcDraft: null,
    paintStroke: null,
    editingLineId: null,
    selectedVertexIndex: null,
    lastChosenColor: rgb(255, 255, 255),
    customColors: [],
    groups: [],
    sceneOrder: svgs.map(s => s.id),
    gridLevel: 2,
    strokeScale: 1,
    gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(1024, 768),
    selectedFigureIds: new Set(),
    activeFigureKey: null,
    compTool: 'color',
    createRegion: null,
    renderGeneration: 0,
  };
}

function makeDraft(overrides: Partial<PaintStrokeDraft> = {}): PaintStrokeDraft {
  return {
    brushColor: rgb(0, 0, 0),
    blendMode: 'normal',
    opacity: 1,
    paintedSegments: new Map(),
    paintedFigures: new Map(),
    paintedFills: new Map(),
    svgSnapshots: new Map(),
    figureSnapshots: new Map(),
    ...overrides,
  };
}

describe('regroupSegmentsByColor', () => {
  it('collapses single-color input to no subpaths', () => {
    const red = rgb(255, 0, 0);
    const entries = [
      { segment: line([0, 0], [1, 0]), color: red },
      { segment: line([1, 0], [2, 0]), color: red },
    ];
    const result = regroupSegmentsByColor(entries);
    expect(result.color).toEqual(red);
    expect(result.segments).toHaveLength(2);
    expect(result.subpaths).toBeUndefined();
  });

  it('3-color input → all segments in main + every group in subpaths', () => {
    const r = rgb(255, 0, 0), g = rgb(0, 255, 0), b = rgb(0, 0, 255);
    const entries = [
      { segment: line([0, 0], [1, 0]), color: r },
      { segment: line([1, 0], [2, 0]), color: g },
      { segment: line([2, 0], [3, 0]), color: b },
    ];
    const result = regroupSegmentsByColor(entries);
    // Mirrors the existing join producer's invariant: full flat
    // geometry in segments, every color group in subpaths (including
    // the primary). The renderer drops main when subpaths exist, so
    // each segment renders at its true color via its subpath.
    expect(result.color).toEqual(r);
    expect(result.segments).toHaveLength(3);
    expect(result.subpaths).toHaveLength(3);
    expect(result.subpaths![0].color).toEqual(r);
    expect(result.subpaths![1].color).toEqual(g);
    expect(result.subpaths![2].color).toEqual(b);
  });

  it('groups contiguous runs of same color', () => {
    const r = rgb(255, 0, 0), b = rgb(0, 0, 255);
    const entries = [
      { segment: line([0, 0], [1, 0]), color: r },
      { segment: line([1, 0], [2, 0]), color: r },
      { segment: line([2, 0], [3, 0]), color: b },
      { segment: line([3, 0], [4, 0]), color: b },
    ];
    const result = regroupSegmentsByColor(entries);
    expect(result.segments).toHaveLength(4);
    expect(result.subpaths).toHaveLength(2);
    expect(result.subpaths![0].color).toEqual(r);
    expect(result.subpaths![0].segments).toHaveLength(2);
    expect(result.subpaths![1].color).toEqual(b);
    expect(result.subpaths![1].segments).toHaveLength(2);
  });
});

describe('buildPaintStrokeOps', () => {
  it('paints all segments of a single-segment SVG → simple color swap, no subpaths', () => {
    const red = rgb(255, 0, 0), blue = rgb(0, 0, 255);
    const svg = makeSVG('svg_1', [line([0, 0], [1, 0])], red);
    const state = makeState([svg]);
    const draft = makeDraft({
      paintedSegments: new Map([['svg_1', new Map([[0, blue]])]]),
      svgSnapshots: new Map([['svg_1', { color: red, segments: svg.segments }]]),
    });
    const ops = buildPaintStrokeOps(state, draft);
    expect(ops).toHaveLength(1);
    const op = ops[0] as Extract<typeof ops[0], { op: 'recolorSVG' }>;
    expect(op.newColor).toEqual(blue);
    expect(op.newSegments).toEqual(svg.segments);
    expect(op.newSubpaths).toBeUndefined();
    expect(op.oldColor).toEqual(red);
  });

  it('painting only some segments → subpaths split for the painted ones', () => {
    const red = rgb(255, 0, 0), blue = rgb(0, 0, 255);
    const segs = [line([0, 0], [1, 0]), line([1, 0], [2, 0]), line([2, 0], [3, 0])];
    const svg = makeSVG('svg_1', segs, red);
    const state = makeState([svg]);
    // Paint only the middle segment
    const draft = makeDraft({
      paintedSegments: new Map([['svg_1', new Map([[1, blue]])]]),
      svgSnapshots: new Map([['svg_1', { color: red, segments: svg.segments }]]),
    });
    const ops = buildPaintStrokeOps(state, draft);
    expect(ops).toHaveLength(1);
    const op = ops[0] as Extract<typeof ops[0], { op: 'recolorSVG' }>;
    // Result: red (seg 0) | blue (seg 1) | red (seg 2)
    // Full geometry in newSegments, three subpaths covering every group
    // so the renderer (which drops main when subpaths exist) shows all
    // three segments at their correct color.
    expect(op.newColor).toEqual(red);
    expect(op.newSegments).toHaveLength(3);
    expect(op.newSubpaths).toHaveLength(3);
    expect(op.newSubpaths![0].color).toEqual(red);
    expect(op.newSubpaths![1].color).toEqual(blue);
    expect(op.newSubpaths![2].color).toEqual(red);
  });

  it('skips no-op paints (segment already at brush color)', () => {
    const red = rgb(255, 0, 0);
    const svg = makeSVG('svg_1', [line([0, 0], [1, 0])], red);
    const state = makeState([svg]);
    const draft = makeDraft({
      paintedSegments: new Map([['svg_1', new Map([[0, red]])]]),  // same color
      svgSnapshots: new Map([['svg_1', { color: red, segments: svg.segments }]]),
    });
    const ops = buildPaintStrokeOps(state, draft);
    expect(ops).toHaveLength(0);
  });

  it('skips locked SVGs', () => {
    const red = rgb(255, 0, 0), blue = rgb(0, 0, 255);
    const svg = makeSVG('svg_1', [line([0, 0], [1, 0])], red, { locked: true });
    const state = makeState([svg]);
    const draft = makeDraft({
      paintedSegments: new Map([['svg_1', new Map([[0, blue]])]]),
      svgSnapshots: new Map([['svg_1', { color: red, segments: svg.segments }]]),
    });
    const ops = buildPaintStrokeOps(state, draft);
    expect(ops).toHaveLength(0);
  });
});

describe('paint stroke undo round-trip', () => {
  it('apply then revert recolorSVG (paint-stroke shape) restores exactly the snapshot', () => {
    const red = rgb(255, 0, 0), blue = rgb(0, 0, 255);
    const segs = [line([0, 0], [1, 0]), line([1, 0], [2, 0])];
    const svg = makeSVG('svg_1', segs, red);
    const state = makeState([svg]);
    const draft = makeDraft({
      paintedSegments: new Map([['svg_1', new Map([[0, blue]])]]),
      svgSnapshots: new Map([['svg_1', { color: red, segments: svg.segments, subpaths: undefined }]]),
    });
    const ops = buildPaintStrokeOps(state, draft);
    const applied = applyCompOps(state, ops);
    const appliedSvg = applied.svgObjects[0];
    // Full geometry in segments + both groups in subpaths.
    expect(appliedSvg.color).toEqual(blue);
    expect(appliedSvg.segments).toHaveLength(2);
    expect(appliedSvg.subpaths).toHaveLength(2);
    expect(appliedSvg.subpaths![0].color).toEqual(blue);
    expect(appliedSvg.subpaths![1].color).toEqual(red);

    const reverted = revertCompOps(applied, ops);
    expect(reverted.svgObjects[0].color).toEqual(red);
    expect(reverted.svgObjects[0].segments).toEqual(svg.segments);
    expect(reverted.svgObjects[0].subpaths).toBeUndefined();
  });
});

describe('group-member localSegments parity', () => {
  it('paint-stroke op rewrites localSegments alongside world segments', () => {
    const red = rgb(255, 0, 0), blue = rgb(0, 0, 255);
    const segs = [line([5, 5], [6, 5]), line([6, 5], [7, 5])];
    const localSegs = [line([0, 0], [1, 0]), line([1, 0], [2, 0])];
    const svg = makeSVG('svg_1', segs, red, { groupId: 'g_1', localSegments: localSegs });
    const state = makeState([svg]);
    const draft = makeDraft({
      paintedSegments: new Map([['svg_1', new Map([[0, blue]])]]),
      svgSnapshots: new Map([['svg_1', { color: red, segments: svg.segments, subpaths: undefined, localSegments: svg.localSegments }]]),
    });
    const ops = buildPaintStrokeOps(state, draft);
    expect(ops).toHaveLength(1);
    const op = ops[0] as Extract<typeof ops[0], { op: 'recolorSVG' }>;
    expect(op.newLocalSegments).toBeDefined();
    // localSegments is the full flat list (parity with newSegments)
    // so materializeGroupMembers can 1:1-align world and local geometry.
    expect(op.newLocalSegments).toHaveLength(2);
    expect(op.newLocalSegments).toEqual(localSegs);
    const applied = applyCompOps(state, ops);
    expect(applied.svgObjects[0].localSegments).toEqual(op.newLocalSegments);
    const reverted = revertCompOps(applied, ops);
    expect(reverted.svgObjects[0].localSegments).toEqual(localSegs);
  });

  it('paint-stroke op writes localSubpaths parallel to world subpaths so group transforms survive paint', () => {
    const red = rgb(255, 0, 0), blue = rgb(0, 0, 255);
    // 3 world segments, 3 local segments — paint just the middle one.
    const segs = [line([5, 5], [6, 5]), line([6, 5], [7, 5]), line([7, 5], [8, 5])];
    const localSegs = [line([0, 0], [1, 0]), line([1, 0], [2, 0]), line([2, 0], [3, 0])];
    const svg = makeSVG('svg_1', segs, red, { groupId: 'g_1', localSegments: localSegs });
    const state = makeState([svg]);
    const draft = makeDraft({
      paintedSegments: new Map([['svg_1', new Map([[1, blue]])]]),
      svgSnapshots: new Map([['svg_1', {
        color: red, segments: svg.segments, subpaths: undefined,
        localSegments: svg.localSegments, localSubpaths: undefined,
      }]]),
    });
    const ops = buildPaintStrokeOps(state, draft);
    const op = ops[0] as Extract<typeof ops[0], { op: 'recolorSVG' }>;
    // World + local subpaths are structurally parallel (same group
    // count, same per-group lengths, same color order) so a subsequent
    // materializeSVGMember pass can re-derive world from local.
    expect(op.newSubpaths).toHaveLength(3);
    expect(op.newLocalSubpaths).toHaveLength(3);
    expect(op.newSubpaths!.map(s => s.color)).toEqual(op.newLocalSubpaths!.map(s => s.color));
    expect(op.newSubpaths!.map(s => s.segments.length))
      .toEqual(op.newLocalSubpaths!.map(s => s.segments.length));
    const applied = applyCompOps(state, ops);
    expect(applied.svgObjects[0].localSubpaths).toEqual(op.newLocalSubpaths);
    // Revert restores `localSubpaths: undefined` exactly because the snapshot had none.
    const reverted = revertCompOps(applied, ops);
    expect(reverted.svgObjects[0].localSubpaths).toBeUndefined();
    expect(reverted.svgObjects[0].subpaths).toBeUndefined();
  });
});

describe('no-doubling regression (dodge bloat fix)', () => {
  it('second paint on an already-painted SVG does NOT grow segment count', () => {
    // Reproduces the dodge_result.tile bloat: every repaint of an SVG
    // that already has subpaths used to double its segment count, because
    // flattenSVGSegmentsWithColor walked BOTH main and subpaths even
    // though the regroup invariant stores the same geometry in both.
    const red = rgb(255, 0, 0), blue = rgb(0, 0, 255), green = rgb(0, 255, 0);
    const segs = [line([0, 0], [1, 0]), line([1, 0], [2, 0]), line([2, 0], [3, 0]), line([3, 0], [4, 0])];
    const svg = makeSVG('svg_1', segs, red);

    // Paint 1: paint segment 1 blue.
    const state1 = makeState([svg]);
    const draft1 = makeDraft({
      paintedSegments: new Map([['svg_1', new Map([[1, blue]])]]),
      svgSnapshots: new Map([['svg_1', { color: red, segments: svg.segments, subpaths: undefined }]]),
    });
    const ops1 = buildPaintStrokeOps(state1, draft1);
    const afterPaint1 = applyCompOps(state1, ops1);
    const svg1 = afterPaint1.svgObjects[0];
    expect(svg1.segments).toHaveLength(4);
    expect(svg1.subpaths).toBeDefined();

    // Paint 2: paint segment 3 (index in the NEW flat ordering, which is
    // subpaths-only when subpaths are present) green.
    // svg1.subpaths after paint 1 = [{red,[s0]},{blue,[s1]},{red,[s2,s3]}]
    // (3 subpath segments + the final segment at red, totalling 4)
    // Flat order: s0 (red), s1 (blue), s2 (red), s3 (red). Index 3 = s3.
    const state2 = afterPaint1;
    const draft2 = makeDraft({
      paintedSegments: new Map([['svg_1', new Map([[3, green]])]]),
      svgSnapshots: new Map([['svg_1', { color: svg1.color, segments: svg1.segments, subpaths: svg1.subpaths }]]),
    });
    const ops2 = buildPaintStrokeOps(state2, draft2);
    const afterPaint2 = applyCompOps(state2, ops2);
    const svg2 = afterPaint2.svgObjects[0];
    // Before the fix: 4 → 8. After: stays at 4.
    expect(svg2.segments).toHaveLength(4);
    // And subpath segments shouldn't bloat either.
    const totalSubpathSegs = (svg2.subpaths ?? []).reduce((a, s) => a + s.segments.length, 0);
    expect(totalSubpathSegs).toBe(4);
  });

  it('15 successive paints on a GROUPED svg keep LOCAL segment count constant', () => {
    // Regression for the bluetest.tile silent-corruption case:
    // `buildPaintStrokeOps` used to iterate BOTH snap.localSegments AND
    // snap.localSubpaths when building the local flat list, doubling
    // every paint stroke on a grouped SVG until u16 counts overflowed
    // on save and produced an unloadable .tile.
    const segs = [
      line([5, 5], [6, 5]),
      line([6, 5], [7, 5]),
      line([7, 5], [8, 5]),
      line([8, 5], [9, 5]),
    ];
    const localSegs = [
      line([0, 0], [1, 0]),
      line([1, 0], [2, 0]),
      line([2, 0], [3, 0]),
      line([3, 0], [4, 0]),
    ];
    const start = rgb(255, 0, 0);
    let svg = makeSVG('svg_1', segs, start, { groupId: 'g_1', localSegments: localSegs });
    let state = makeState([svg]);
    for (let pass = 0; pass < 15; pass++) {
      const stamp = rgb(pass * 8, pass * 4, 255 - pass * 8);
      const live = state.svgObjects[0];
      const flatLen = (Array.isArray(live.subpaths) && live.subpaths.length > 0)
        ? live.subpaths.reduce((a, s) => a + s.segments.length, 0)
        : live.segments.length;
      const painted = new Map<number, RGBColor>();
      for (let i = 0; i < flatLen; i++) painted.set(i, stamp);
      const draft = makeDraft({
        paintedSegments: new Map([['svg_1', painted]]),
        svgSnapshots: new Map([['svg_1', {
          color: live.color, segments: live.segments, subpaths: live.subpaths,
          localSegments: live.localSegments, localSubpaths: (live as any).localSubpaths,
        }]]),
      });
      const ops = buildPaintStrokeOps(state, draft);
      state = applyCompOps(state, ops);
    }
    const final = state.svgObjects[0];
    expect(final.segments).toHaveLength(4);
    expect(final.localSegments).toHaveLength(4);
    const totalLocalSubpathSegs = ((final as any).localSubpaths ?? []).reduce((a: number, s: any) => a + s.segments.length, 0);
    expect(totalLocalSubpathSegs).toBeLessThanOrEqual(4);
  });

  it('15 successive paints keep segment count constant (dodge stress)', () => {
    // Mirrors the dodge user flow: paint, paint again, paint again, …
    // for many passes. Before the fix this produced 2^N geometry growth
    // (the original dodge_result.tile hit ~16,000x after ~14 passes).
    const segs = [
      line([0, 0], [1, 0]),
      line([1, 0], [2, 0]),
      line([2, 0], [3, 0]),
      line([3, 0], [4, 0]),
    ];
    const start = rgb(255, 0, 0);
    let svg = makeSVG('svg_1', segs, start);
    let state = makeState([svg]);
    for (let pass = 0; pass < 15; pass++) {
      // Paint every flat index with a slightly different color each pass,
      // simulating a dodge brush that updates already-painted segments.
      const stamp = rgb(pass * 8, pass * 4, 255 - pass * 8);
      const live = state.svgObjects[0];
      const flatLen = (Array.isArray(live.subpaths) && live.subpaths.length > 0)
        ? live.subpaths.reduce((a, s) => a + s.segments.length, 0)
        : live.segments.length;
      const painted = new Map<number, RGBColor>();
      for (let i = 0; i < flatLen; i++) painted.set(i, stamp);
      const draft = makeDraft({
        paintedSegments: new Map([['svg_1', painted]]),
        svgSnapshots: new Map([['svg_1', { color: live.color, segments: live.segments, subpaths: live.subpaths }]]),
      });
      const ops = buildPaintStrokeOps(state, draft);
      state = applyCompOps(state, ops);
    }
    const final = state.svgObjects[0];
    // Geometry stays at 4 across all 15 passes — no doubling.
    expect(final.segments).toHaveLength(4);
    const totalSubpathSegs = (final.subpaths ?? []).reduce((a, s) => a + s.segments.length, 0);
    expect(totalSubpathSegs).toBeLessThanOrEqual(4);
  });
});

describe('accumulator monotonicity', () => {
  it('painting the same segment twice in one stroke composes (uses latest accumulator color as base)', () => {
    // This is enforced by the host-side handleColorPaintMove, not by
    // buildPaintStrokeOps directly. We verify by simulating: write color A,
    // then on next move write blend(A, B) — the final accumulator entry
    // should reflect the chained blend, and buildPaintStrokeOps just
    // commits that final color.
    const red = rgb(255, 0, 0);
    const black = rgb(0, 0, 0);
    const svg = makeSVG('svg_1', [line([0, 0], [1, 0])], red);
    const state = makeState([svg]);
    const draft = makeDraft({
      // Simulated final accumulator entry (host already composed).
      paintedSegments: new Map([['svg_1', new Map([[0, black]])]]),
      svgSnapshots: new Map([['svg_1', { color: red, segments: svg.segments }]]),
    });
    const ops = buildPaintStrokeOps(state, draft);
    expect(ops).toHaveLength(1);
    const op = ops[0] as Extract<typeof ops[0], { op: 'recolorSVG' }>;
    expect(op.newColor).toEqual(black);
  });
});

describe('buildPaintStrokeOps fill color', () => {
  it('includes oldFillColor/newFillColor when SVG has fillColor', () => {
    const red = rgb(255, 0, 0);
    const blue = rgb(0, 0, 255);
    const green = rgb(0, 255, 0);
    const svg = makeSVG('svg_1', [line([0, 0], [1, 0]), line([1, 0], [0, 0])], red, { fillColor: green });
    const state = makeState([svg]);
    const draft = makeDraft({
      paintedSegments: new Map([['svg_1', new Map([[0, blue]])]]),
      paintedFills: new Map([['svg_1', blue]]),
      svgSnapshots: new Map([['svg_1', { color: red, segments: svg.segments, fillColor: green }]]),
    });
    const ops = buildPaintStrokeOps(state, draft);
    expect(ops).toHaveLength(1);
    const op = ops[0] as Extract<typeof ops[0], { op: 'recolorSVG' }>;
    expect(op.oldFillColor).toEqual(green);
    expect(op.newFillColor).toEqual(blue);
  });

  it('omits fill fields when SVG has no fillColor', () => {
    const red = rgb(255, 0, 0);
    const blue = rgb(0, 0, 255);
    const svg = makeSVG('svg_1', [line([0, 0], [1, 0])], red);
    const state = makeState([svg]);
    const draft = makeDraft({
      paintedSegments: new Map([['svg_1', new Map([[0, blue]])]]),
      svgSnapshots: new Map([['svg_1', { color: red, segments: svg.segments }]]),
    });
    const ops = buildPaintStrokeOps(state, draft);
    expect(ops).toHaveLength(1);
    const op = ops[0] as Extract<typeof ops[0], { op: 'recolorSVG' }>;
    expect(op.oldFillColor).toBeUndefined();
    expect(op.newFillColor).toBeUndefined();
  });

  it('emits op when only fill changed (segments unchanged)', () => {
    const red = rgb(255, 0, 0);
    const blue = rgb(0, 0, 255);
    const svg = makeSVG('svg_1', [line([0, 0], [1, 0])], red, { fillColor: red });
    const state = makeState([svg]);
    const draft = makeDraft({
      paintedSegments: new Map([['svg_1', new Map()]]),
      paintedFills: new Map([['svg_1', blue]]),
      svgSnapshots: new Map([['svg_1', { color: red, segments: svg.segments, fillColor: red }]]),
    });
    const ops = buildPaintStrokeOps(state, draft);
    expect(ops).toHaveLength(1);
    const op = ops[0] as Extract<typeof ops[0], { op: 'recolorSVG' }>;
    expect(op.oldFillColor).toEqual(red);
    expect(op.newFillColor).toEqual(blue);
  });

  it('emits fill-only op when SVG has no painted segments entry', () => {
    const red = rgb(255, 0, 0);
    const blue = rgb(0, 0, 255);
    const svg = makeSVG('svg_1', [line([0, 0], [1, 0])], red, { fillColor: red });
    const state = makeState([svg]);
    const draft = makeDraft({
      paintedFills: new Map([['svg_1', blue]]),
      svgSnapshots: new Map([['svg_1', { color: red, segments: svg.segments, fillColor: red }]]),
    });
    const ops = buildPaintStrokeOps(state, draft);
    expect(ops).toHaveLength(1);
    const op = ops[0] as Extract<typeof ops[0], { op: 'recolorSVG' }>;
    expect(op.oldFillColor).toEqual(red);
    expect(op.newFillColor).toEqual(blue);
    // Segments unchanged
    expect(op.oldSegments).toEqual(svg.segments);
    expect(op.newSegments).toEqual(svg.segments);
  });

  it('skips fill when painted fill matches snapshot fill', () => {
    const red = rgb(255, 0, 0);
    const svg = makeSVG('svg_1', [line([0, 0], [1, 0])], red, { fillColor: red });
    const state = makeState([svg]);
    const draft = makeDraft({
      paintedSegments: new Map([['svg_1', new Map()]]),
      paintedFills: new Map([['svg_1', red]]),
      svgSnapshots: new Map([['svg_1', { color: red, segments: svg.segments, fillColor: red }]]),
    });
    const ops = buildPaintStrokeOps(state, draft);
    expect(ops).toHaveLength(0);
  });

  it('undo round-trip restores original fillColor', () => {
    const red = rgb(255, 0, 0);
    const blue = rgb(0, 0, 255);
    const green = rgb(0, 255, 0);
    const svg = makeSVG('svg_1', [line([0, 0], [1, 0]), line([1, 0], [0, 0])], red, { fillColor: green });
    const state = makeState([svg]);
    const draft = makeDraft({
      paintedSegments: new Map([['svg_1', new Map([[0, blue]])]]),
      paintedFills: new Map([['svg_1', blue]]),
      svgSnapshots: new Map([['svg_1', { color: red, segments: svg.segments, fillColor: green }]]),
    });
    const ops = buildPaintStrokeOps(state, draft);
    const applied = applyCompOps(state, ops);
    expect(applied.svgObjects[0].fillColor).toEqual(blue);
    const reverted = revertCompOps(applied, ops);
    expect(reverted.svgObjects[0].fillColor).toEqual(green);
  });
});

describe('remove fill clears per-copy paint on tiled shapes', () => {
  const red = rgb(255, 0, 0);
  const green = rgb(0, 255, 0);
  const blue = rgb(0, 0, 255);

  // Mirror handleRemoveFillColor's op construction (CompositionEditor.tsx).
  function removeFillOps(svg: SVGObject): CompUndoOp[] {
    const ops: CompUndoOp[] = [{
      op: 'setFillColor', svgId: svg.id,
      oldFillColor: svg.fillColor, oldFillOpacity: svg.fillOpacity,
      newFillColor: undefined, newFillOpacity: undefined,
    }];
    if (svg.tileMode === 'repeat' && svg.segmentOverrides && svg.segmentOverrides.size > 0) {
      ops.push({
        op: 'paintTileSegments', svgId: svg.id,
        changes: [...svg.segmentOverrides].map(([key, color]) => ({ key, oldColor: color, newColor: undefined })),
      });
    }
    return ops;
  }

  it('drops fillColor and segmentOverrides together; undo/redo restores both', () => {
    const overrides = new Map([[packKey(0, 0, 0)!, blue], [packKey(1, 0, 0)!, red]]);
    const svg = makeSVG('svg_1', [line([0, 0], [1, 0]), line([1, 0], [0, 0])], red, {
      tileMode: 'repeat', fillColor: green, segmentOverrides: overrides,
    });
    const state = makeState([svg]);
    const ops = removeFillOps(svg);
    expect(ops).toHaveLength(2);

    const applied = applyCompOps(state, ops);
    expect(applied.svgObjects[0].fillColor).toBeUndefined();
    expect(applied.svgObjects[0].segmentOverrides).toBeUndefined();

    const reverted = revertCompOps(applied, ops);
    expect(reverted.svgObjects[0].fillColor).toEqual(green);
    expect(reverted.svgObjects[0].segmentOverrides).toEqual(overrides);

    const redone = applyCompOps(reverted, ops);
    expect(redone.svgObjects[0].fillColor).toBeUndefined();
    expect(redone.svgObjects[0].segmentOverrides).toBeUndefined();
  });

  it('emits only setFillColor when a tiled shape has no overrides', () => {
    const svg = makeSVG('svg_1', [line([0, 0], [1, 0]), line([1, 0], [0, 0])], red, {
      tileMode: 'repeat', fillColor: green,
    });
    const ops = removeFillOps(svg);
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toBe('setFillColor');

    const applied = applyCompOps(makeState([svg]), ops);
    expect(applied.svgObjects[0].fillColor).toBeUndefined();
  });
});
