import {
  CompositionState,
  CompUndoEntry,
  CompositionFigure,
  GroupNode,
  PathSegment,
  SVGObject,
  RGBColor,
  makeViewport,
} from '../types';
import {
  applyCompOps,
  revertCompOps,
  computeSVGBbox,
  deriveSceneOrderFromKindArrays,
} from '../compositionOps';
import { isClosedPath, computeSignedArea, chainSegmentsLoops, computeCircleSegments, arcAngles } from '../compositionArcMath';
import { arcBoundingBox } from '../compositionArcHitTest';
import { canUnion, buildUnionFromSources, buildUnionEntry, canUnionSelection } from '../compositionGeometricUnion';

const WHITE: RGBColor = { r: 255, g: 255, b: 255 };

function line(start: [number, number], end: [number, number]): PathSegment {
  return { kind: 'line', start, end };
}
/** Closed polyline through the given vertices (last → first implied). */
function poly(...pts: [number, number][]): PathSegment[] {
  return pts.map((p, i) => line(p, pts[(i + 1) % pts.length]));
}
/** A clockwise (positive-area, y-down) axis-aligned square. */
function squareCW(x: number, y: number, s: number): PathSegment[] {
  return poly([x, y], [x + s, y], [x + s, y + s], [x, y + s]);
}

function makeSVG(id: string, segments: PathSegment[], overrides: Partial<SVGObject> = {}): SVGObject {
  return { id, segments, color: WHITE, ...computeSVGBbox(segments), ...overrides };
}

function circleSVG(id: string, cx: number, cy: number, r: number): SVGObject {
  return makeSVG(id, computeCircleSegments(cx - r, cy - r, cx + r, cy + r));
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

describe('canUnion', () => {
  it('needs at least two shapes', () => {
    expect(canUnion([makeSVG('a', squareCW(0, 0, 10))])).toBe(false);
  });
  it('accepts two closed shapes', () => {
    expect(canUnion([makeSVG('a', squareCW(0, 0, 10)), makeSVG('b', squareCW(5, 5, 10))])).toBe(true);
  });
  it('rejects an open path', () => {
    const open = [line([0, 0], [10, 0]), line([10, 0], [10, 10])]; // not closed
    expect(canUnion([makeSVG('a', squareCW(0, 0, 10)), makeSVG('b', open)])).toBe(false);
  });
  it('rejects a tiled (pattern) shape', () => {
    const tiled = makeSVG('b', squareCW(5, 5, 10), { tileMode: 'repeat' });
    expect(canUnion([makeSVG('a', squareCW(0, 0, 10)), tiled])).toBe(false);
  });
});

describe('buildUnionFromSources', () => {
  it('merges two overlapping squares into one closed loop', () => {
    const a = makeSVG('a', squareCW(0, 0, 10));
    const b = makeSVG('b', squareCW(5, 5, 10));
    const state = makeState([a, b], ['a', 'b']);

    const entry = buildUnionFromSources(state, [a, b], [0, 1])!;
    expect(entry).not.toBeNull();
    const op = entry[0] as Extract<typeof entry[0], { op: 'unionObjects' }>;
    expect(op.op).toBe('unionObjects');

    const out = op.result.segments;
    expect(isClosedPath(out)).toBe(true);
    expect(chainSegmentsLoops(out)).toHaveLength(1);
    expect(computeSignedArea(out)).toBeCloseTo(100 + 100 - 25, 6); // overlap [5,10]² = 25
  });

  it('normalizes a counter-clockwise source before merging', () => {
    const accw = makeSVG('a', poly([0, 0], [0, 10], [10, 10], [10, 0])); // CCW
    expect(computeSignedArea(accw.segments)).toBeLessThan(0);
    const b = makeSVG('b', squareCW(5, 5, 10));
    const state = makeState([accw, b], ['a', 'b']);

    const entry = buildUnionFromSources(state, [accw, b], [0, 1])!;
    const out = entry[0].op === 'unionObjects' ? entry[0].result.segments : [];
    expect(isClosedPath(out)).toBe(true);
    expect(chainSegmentsLoops(out)).toHaveLength(1);
    expect(computeSignedArea(out)).toBeGreaterThan(0); // clean CW union
  });

  it('keeps disjoint shapes as a single multi-loop closed result', () => {
    const a = makeSVG('a', squareCW(0, 0, 10));
    const c = makeSVG('c', squareCW(20, 0, 10));
    const state = makeState([a, c], ['a', 'c']);

    const entry = buildUnionFromSources(state, [a, c], [0, 1])!;
    const out = entry[0].op === 'unionObjects' ? entry[0].result.segments : [];
    expect(isClosedPath(out)).toBe(true);
    expect(chainSegmentsLoops(out)).toHaveLength(2);
    expect(computeSignedArea(out)).toBeCloseTo(200, 6);
  });

  it('result bbox spans the full union of two circles (regression: was the middle band)', () => {
    // Repro of test_data/badUnion.tile. After union, mergeCollinear fuses the
    // co-circular quarter-arcs, so the outer arcs span across the circles'
    // top/bottom cardinals with no vertex there. The bbox must still reach
    // those swept extremes, not collapse to the arc endpoints in the middle.
    const cA = circleSVG('a', 10, 12.75, 10);   // center (10,12.75) r10
    const cB = circleSVG('b', 24, 18.75, 12);   // center (24,18.75) r12
    const state = makeState([cA, cB], ['a', 'b']);

    const entry = buildUnionFromSources(state, [cA, cB], [0, 1])!;
    const result = entry[0].op === 'unionObjects' ? entry[0].result : null;
    const r = result!;
    // True union extent: A top y≈2.75, B bottom y≈30.75, A left x≈0, B right x≈36.
    expect(r.cellY).toBeLessThan(3);                       // reaches A's top
    expect(r.cellY + r.cellHeight).toBeGreaterThan(30);    // reaches B's bottom
    expect(r.cellX).toBeLessThan(0.5);                     // reaches A's left
    expect(r.cellX + r.cellWidth).toBeGreaterThan(35.5);   // reaches B's right
    // Height must be the full span (~28), not the endpoint-only band (~14.5).
    expect(r.cellHeight).toBeGreaterThan(25);
  });

  it('inherits stroke + fill from the top-most (front) source', () => {
    const red: RGBColor = { r: 200, g: 0, b: 0 };
    const blue: RGBColor = { r: 0, g: 0, b: 200 };
    const a = makeSVG('a', squareCW(0, 0, 10), { color: red, fillColor: red });
    const b = makeSVG('b', squareCW(5, 5, 10), { color: blue, fillColor: blue, fillOpacity: 0.5 });
    // sceneOrder is back-to-front, so 'b' (later) is the top-most.
    const state = makeState([a, b], ['a', 'b']);

    const entry = buildUnionFromSources(state, [a, b], [0, 1])!;
    const result = entry[0].op === 'unionObjects' ? entry[0].result : null;
    expect(result!.color).toEqual(blue);
    expect(result!.fillColor).toEqual(blue);
    expect(result!.fillOpacity).toBe(0.5);
  });
});

// ── Pattern-fill union ───────────────────────────────────────────────
// A pattern fill is a closed mask (isPatternFill) grouped with a sibling
// tileMode:'repeat' figure. Selecting one selects the whole group, so the raw
// selection holds both ids.

interface PatternFill { mask: SVGObject; figure: CompositionFigure; group: GroupNode }

function makePatternFill(suffix: string, x: number, y: number, s: number, key: string): PatternFill {
  const groupId = `g${suffix}`;
  const mask = makeSVG(`m${suffix}`, squareCW(x, y, s), { isMask: true, isPatternFill: true, groupId });
  const figure: CompositionFigure = {
    id: `f${suffix}`, figureKey: key, name: `Pattern ${suffix}`,
    cellX: x, cellY: y, cellWidth: s, cellHeight: s,
    resolutionX: 2, resolutionY: 2,
    tileMode: 'repeat', tileWidthL0: s, tileHeightL0: s, tileOffsetXL0: 0, tileOffsetYL0: 0,
    groupId,
  };
  const group: GroupNode = {
    id: groupId, name: `Group ${suffix}`,
    translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false,
  };
  return { mask, figure, group };
}

function makeStateFull(
  figures: CompositionFigure[],
  svgObjects: SVGObject[],
  groups: GroupNode[],
  sceneOrder: string[],
  selected: string[],
): CompositionState {
  return {
    ...makeState(svgObjects, selected),
    figures, groups, sceneOrder,
  };
}

describe('canUnionSelection (pattern fills)', () => {
  it('is true for two selected pattern fills (mask + tiled figure each)', () => {
    const p = makePatternFill('1', 0, 0, 10, 'k');
    const q = makePatternFill('2', 5, 5, 10, 'k');
    const state = makeStateFull(
      [p.figure, q.figure], [p.mask, q.mask], [p.group, q.group],
      ['f1', 'm1', 'f2', 'm2'], ['f1', 'm1', 'f2', 'm2'],
    );
    expect(canUnionSelection(state, state.selectedFigureIds)).toBe(true);
  });

  it('is false when a plain (non-tile) figure is also selected', () => {
    const p = makePatternFill('1', 0, 0, 10, 'k');
    const q = makePatternFill('2', 5, 5, 10, 'k');
    const plainFig: CompositionFigure = {
      id: 'fp', figureKey: 'k', cellX: 30, cellY: 0, cellWidth: 4, cellHeight: 4, resolutionX: 2, resolutionY: 2,
    };
    const state = makeStateFull(
      [p.figure, q.figure, plainFig], [p.mask, q.mask], [p.group, q.group],
      ['f1', 'm1', 'f2', 'm2', 'fp'], ['f1', 'm1', 'f2', 'm2', 'fp'],
    );
    expect(canUnionSelection(state, state.selectedFigureIds)).toBe(false);
  });
});

describe('buildUnionEntry (pattern fills)', () => {
  it('all pattern-filled → result is a pattern fill cloned from the top-most shape', () => {
    const p = makePatternFill('1', 0, 0, 10, 'keyA');
    const q = makePatternFill('2', 5, 5, 10, 'keyB'); // q is later → top-most
    const state = makeStateFull(
      [p.figure, q.figure], [p.mask, q.mask], [p.group, q.group],
      ['f1', 'm1', 'f2', 'm2'], ['f1', 'm1', 'f2', 'm2'],
    );

    const built = buildUnionEntry(state, state.selectedFigureIds)!;
    expect(built).not.toBeNull();
    expect(built.entry[0].op).toBe('replaceScene');

    const next = applyCompOps(state, built.entry);
    // Exactly one mask shape remains, flagged as a pattern fill.
    expect(next.svgObjects).toHaveLength(1);
    const resultMask = next.svgObjects[0];
    expect(resultMask.id).toBe(built.resultId);
    expect(resultMask.isPatternFill).toBe(true);
    expect(resultMask.isMask).toBe(true);
    expect(isClosedPath(resultMask.segments)).toBe(true);
    // One tiled figure remains, carrying the top-most shape's pattern key.
    expect(next.figures).toHaveLength(1);
    expect(next.figures[0].tileMode).toBe('repeat');
    expect(next.figures[0].figureKey).toBe('keyB');
    // Mask + figure share one fresh group; the two source groups are gone.
    expect(next.groups).toHaveLength(1);
    expect(next.figures[0].groupId).toBe(next.groups[0].id);
    expect(resultMask.groupId).toBe(next.groups[0].id);
    expect(next.groups.map(g => g.id)).not.toContain('g1');
    expect(next.groups.map(g => g.id)).not.toContain('g2');
    // The merged mask is reported as the result (the handler selects it; the
    // replaceScene op itself leaves selection untouched).
    expect(built.resultId).toBe(resultMask.id);
  });

  it('mixed (one pattern, one plain) → plain union, all fills dissolved', () => {
    const p = makePatternFill('1', 0, 0, 10, 'keyA');
    const plain = makeSVG('plain', squareCW(5, 5, 10));
    const state = makeStateFull(
      [p.figure], [p.mask, plain], [p.group],
      ['f1', 'm1', 'plain'], ['f1', 'm1', 'plain'],
    );

    const built = buildUnionEntry(state, state.selectedFigureIds)!;
    const next = applyCompOps(state, built.entry);
    expect(next.svgObjects).toHaveLength(1);
    expect(next.svgObjects[0].isPatternFill).toBeFalsy();
    expect(next.figures).toHaveLength(0); // tiled figure dropped
    expect(next.groups).toHaveLength(0);  // pattern-fill group dissolved
    expect(isClosedPath(next.svgObjects[0].segments)).toBe(true);
  });

  it('round-trips: revert restores the original pattern fills', () => {
    const p = makePatternFill('1', 0, 0, 10, 'keyA');
    const q = makePatternFill('2', 5, 5, 10, 'keyB');
    const order = ['f1', 'm1', 'f2', 'm2'];
    const state = makeStateFull(
      [p.figure, q.figure], [p.mask, q.mask], [p.group, q.group],
      order.slice(), order.slice(),
    );

    const built = buildUnionEntry(state, state.selectedFigureIds)!;
    const applied = applyCompOps(state, built.entry);
    const reverted = revertCompOps(applied, built.entry);

    expect(reverted.svgObjects.map(s => s.id).sort()).toEqual(['m1', 'm2']);
    expect(reverted.figures.map(f => f.id).sort()).toEqual(['f1', 'f2']);
    expect(reverted.groups.map(g => g.id).sort()).toEqual(['g1', 'g2']);
    expect(reverted.sceneOrder).toEqual(order);
  });
});

describe('unionObjects reducer round-trip', () => {
  it('apply replaces sources with the result; revert restores them', () => {
    const a = makeSVG('a', squareCW(0, 0, 10));
    const b = makeSVG('b', squareCW(5, 5, 10));
    const state = makeState([a, b], ['a', 'b']);
    const entry: CompUndoEntry = buildUnionFromSources(state, [a, b], [0, 1])!;
    const resultId = (entry[0] as Extract<typeof entry[0], { op: 'unionObjects' }>).result.id;

    const applied = applyCompOps(state, entry);
    expect(applied.svgObjects.map(s => s.id)).toEqual([resultId]);
    expect([...applied.selectedFigureIds]).toEqual([resultId]);
    expect(applied.sceneOrder).toContain(resultId);
    expect(applied.sceneOrder).not.toContain('a');
    expect(applied.sceneOrder).not.toContain('b');

    const reverted = revertCompOps(applied, entry);
    expect(reverted.svgObjects.map(s => s.id)).toEqual(['a', 'b']);
    expect(reverted.sceneOrder).toEqual(state.sceneOrder);
    expect([...reverted.selectedFigureIds].sort()).toEqual(['a', 'b']);
  });
});

// Densely sample a segment along its true geometry (arcs by angle).
function sampleSegment(seg: PathSegment, n = 64): [number, number][] {
  if (seg.kind === 'line') return [seg.start, seg.end];
  const { a0, da } = arcAngles(seg);
  const r = Math.hypot(seg.start[0] - seg.center[0], seg.start[1] - seg.center[1]);
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + da * (i / n);
    pts.push([seg.center[0] + r * Math.cos(a), seg.center[1] + r * Math.sin(a)]);
  }
  return pts;
}

describe('union bounding box surrounds every produced edge', () => {
  // The bbox must contain ALL geometry of the union result — including the
  // mid-sweep arc bulges that aren't segment endpoints. Sweep a wide range of
  // two-circle configurations (overlapping, tangent, disjoint; varied radii
  // and offsets) plus a three-circle union.
  const configs: [number, number, number][] = [];
  for (const dx of [3, 6, 9, 12, 16, 20, 24]) {
    for (const dy of [0, 4, 8, 13]) {
      for (const br of [5, 8, 11, 14]) configs.push([dx, dy, br]);
    }
  }

  const EPS = 1e-6;
  function assertBboxContainsAllEdges(segs: PathSegment[]) {
    expect(segs.length).toBeGreaterThan(0);
    const bb = arcBoundingBox(segs)!;          // engine source of truth
    const stored = computeSVGBbox(segs);       // what the result SVGObject stores
    for (const seg of segs) {
      for (const [x, y] of sampleSegment(seg)) {
        expect(x).toBeGreaterThanOrEqual(bb.minX - EPS);
        expect(x).toBeLessThanOrEqual(bb.maxX + EPS);
        expect(y).toBeGreaterThanOrEqual(bb.minY - EPS);
        expect(y).toBeLessThanOrEqual(bb.maxY + EPS);
        expect(x).toBeGreaterThanOrEqual(stored.cellX - EPS);
        expect(x).toBeLessThanOrEqual(stored.cellX + stored.cellWidth + EPS);
        expect(y).toBeGreaterThanOrEqual(stored.cellY - EPS);
        expect(y).toBeLessThanOrEqual(stored.cellY + stored.cellHeight + EPS);
      }
    }
  }

  it.each(configs)('two circles dx=%i dy=%i r2=%i', (dx, dy, br) => {
    const a = circleSVG('a', 0, 0, 10);
    const b = circleSVG('b', dx, dy, br);
    const entry = buildUnionFromSources(makeState([a, b], ['a', 'b']), [a, b], [0, 1]);
    expect(entry).not.toBeNull();
    const segs = entry![0].op === 'unionObjects' ? entry![0].result.segments : [];
    assertBboxContainsAllEdges(segs);
  });

  it('three overlapping circles', () => {
    const a = circleSVG('a', 0, 0, 10);
    const b = circleSVG('b', 14, 3, 9);
    const c = circleSVG('c', 7, 12, 8);
    const entry = buildUnionFromSources(makeState([a, b, c], ['a', 'b', 'c']), [a, b, c], [0, 1, 2]);
    expect(entry).not.toBeNull();
    const segs = entry![0].op === 'unionObjects' ? entry![0].result.segments : [];
    assertBboxContainsAllEdges(segs);
  });
});
