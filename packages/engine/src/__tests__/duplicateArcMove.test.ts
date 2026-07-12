/**
 * Regression: a one-shot "object is not iterable" crash from
 * `handlePropsDuplicate` on plain drawn arcs. The duplicate flow goes
 * through SCENE_ADAPTERS.cloneWithOffset → cloneItem → applyCompOps
 * (placeObject); the move flow translates segments + subpaths.
 *
 * These tests cover the happy path and the defensive coercion that
 * keeps the editor alive if a bad-shape `segments` ever reaches the
 * helpers.
 */

import {
  applyCompOps,
  computeSVGBbox,
  SCENE_ADAPTERS,
  offsetPathSegment,
  safeMapSegments,
  safeMapSubpaths,
  mirrorSVG,
  rotateSVG90CW,
} from '../compositionOps';
import {
  SVGObject,
  PathSegment,
  CompositionState,
  CompUndoEntry,
  makeViewport,
} from '../types';

const WHITE = { r: 255, g: 255, b: 255 };
const RED   = { r: 255, g: 0,   b: 0   };

function makeState(over: Partial<CompositionState> = {}): CompositionState {
  const figures = over.figures ?? [];
  const svgObjects = over.svgObjects ?? [];
  const images = over.images ?? [];
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
    ],
    gridLevel: 2, strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null, compTool: 'select',
    createRegion: null, renderGeneration: 0,
    ...over,
  };
}

function makeArc(id: string, segments: PathSegment[], over: Partial<SVGObject> = {}): SVGObject {
  return { id, segments, color: WHITE, ...computeSVGBbox(segments), ...over };
}

const svgAdapter = SCENE_ADAPTERS.find(a => a.kind === 'svg')!;

describe('plain-arc props-panel duplicate flow', () => {
  test('cloneWithOffset → cloneItem → placeObject yields an independent dup at +1,+1', () => {
    const arc = makeArc('svg_src', [{ kind: 'arc', start: [0, 0], end: [4, 0], center: [2, 0] }]);
    let state = makeState({ svgObjects: [arc] });

    const dup = svgAdapter.cloneWithOffset(arc, 1, 1, 'svg_dup', undefined) as SVGObject;
    const cloned = svgAdapter.cloneItem(dup) as SVGObject;
    const ops: CompUndoEntry = [{ op: 'placeObject', kind: 'svg', item: cloned }];
    state = applyCompOps(state, ops);

    expect(state.svgObjects).toHaveLength(2);
    const placed = state.svgObjects.find(s => s.id === 'svg_dup')!;
    expect(placed.segments).toHaveLength(1);
    const seg = placed.segments[0];
    expect(seg.kind).toBe('arc');
    if (seg.kind === 'arc') {
      expect(seg.start).toEqual([1, 1]);
      expect(seg.end).toEqual([5, 1]);
      expect(seg.center).toEqual([3, 1]);
    }
    // Independent arrays — moving the dup must not mutate the source.
    expect(placed.segments).not.toBe(arc.segments);
    expect(placed.segments[0]).not.toBe(arc.segments[0]);
  });

  test('moving the duplicate translates its segments without touching the source', () => {
    const arc = makeArc('svg_src', [{ kind: 'arc', start: [0, 0], end: [4, 0], center: [2, 0] }]);
    let state = makeState({ svgObjects: [arc] });

    const dup = svgAdapter.cloneWithOffset(arc, 1, 1, 'svg_dup', undefined) as SVGObject;
    state = applyCompOps(state, [{ op: 'placeObject', kind: 'svg', item: svgAdapter.cloneItem(dup) as SVGObject }]);

    // Mirror the MOVE_FIGURES_DELTA path: translate segments + bbox in place.
    const dx = 4, dy = 4;
    const offset = (s: PathSegment) => offsetPathSegment(s, dx, dy);
    state = {
      ...state,
      svgObjects: state.svgObjects.map(s => {
        if (s.id !== 'svg_dup') return s;
        const newSegs = safeMapSegments(s.segments, offset)!;
        return { ...s, segments: newSegs, ...computeSVGBbox(newSegs) };
      }),
    };

    const moved = state.svgObjects.find(s => s.id === 'svg_dup')!;
    const src   = state.svgObjects.find(s => s.id === 'svg_src')!;
    expect((moved.segments[0] as any).start).toEqual([5, 5]);
    expect((src.segments[0]   as any).start).toEqual([0, 0]);
  });
});

describe('safe segment helpers tolerate bad shapes', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { warnSpy.mockRestore(); });

  test('safeMapSegments returns [] and warns when given a non-array', () => {
    const result = safeMapSegments({ 0: { kind: 'line', start: [0, 0], end: [1, 1] }, length: 1 } as any, x => x);
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('PathSegment[]'), expect.anything());
  });

  test('safeMapSegments passes undefined through', () => {
    expect(safeMapSegments(undefined, x => x)).toBeUndefined();
  });

  test('safeMapSubpaths drops a non-array subpaths shape', () => {
    expect(safeMapSubpaths({ length: 0 } as any, x => x)).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('SVGSubpath[]'), expect.anything());
  });

  test('safeMapSubpaths coerces a sub.segments that is not an array to []', () => {
    const subs = [{ color: RED, segments: { length: 0 } as any }];
    const out = safeMapSubpaths(subs as any, x => x);
    expect(out).toHaveLength(1);
    expect(out![0].segments).toEqual([]);
  });

  test('cloneWithOffset on a corrupt-segments arc does not throw and yields []', () => {
    const corrupt: SVGObject = {
      id: 'svg_bad',
      // @ts-expect-error — emulating a load-time corruption that survived migration
      segments: { 0: { kind: 'arc', start: [0, 0], end: [1, 1], center: [0, 1] }, length: 1 },
      color: WHITE,
      cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1,
    };
    const dup = svgAdapter.cloneWithOffset(corrupt, 1, 1, 'svg_dup', undefined) as SVGObject;
    expect(Array.isArray(dup.segments)).toBe(true);
    expect(dup.segments).toHaveLength(0);
  });

  // Regression: mirrorSVG / rotateSVG90CW used to pass a non-array
  // `subpaths` straight through. Render-side iteration sites guard with
  // `subpaths && subpaths.length > 0`, which a `{ 0: ..., length: 1 }`
  // shape passes; the subsequent `for (const sub of subpaths)` then
  // throws "object is not iterable". Coerce non-arrays to undefined.
  test('mirrorSVG drops a non-array subpaths shape', () => {
    const arc = makeArc('svg_src', [{ kind: 'arc', start: [0, 0], end: [4, 0], center: [2, 0] }], {
      // @ts-expect-error — emulating a corrupt subpaths shape
      subpaths: { 0: { color: RED, segments: [] }, length: 1 },
    });
    const out = mirrorSVG(arc, 'h');
    expect(out.subpaths).toBeUndefined();
  });

  test('rotateSVG90CW drops a non-array subpaths shape', () => {
    const arc = makeArc('svg_src', [{ kind: 'arc', start: [0, 0], end: [4, 0], center: [2, 0] }], {
      // @ts-expect-error — emulating a corrupt subpaths shape
      subpaths: { 0: { color: RED, segments: [] }, length: 1 },
    });
    const out = rotateSVG90CW(arc);
    expect(out.subpaths).toBeUndefined();
  });

  test('mirrorSVG preserves a healthy subpaths array (mapped, not dropped)', () => {
    const arc = makeArc('svg_src', [{ kind: 'arc', start: [0, 0], end: [4, 0], center: [2, 0] }], {
      subpaths: [{ color: RED, segments: [{ kind: 'arc', start: [0, 0], end: [4, 0], center: [2, 0] }] }],
    });
    const out = mirrorSVG(arc, 'h');
    expect(Array.isArray(out.subpaths)).toBe(true);
    expect(out.subpaths).toHaveLength(1);
  });
});

// The persistence migration is covered separately so the storage mock
// stays scoped to that file (mocking storage globally would interfere
// with the in-memory state tests above).
