import { bboxOverlapsMask, computeMaskMembership, strokeIntersectsMaskRegion } from '../compositionMaskRegion';
import { CompositionState, GroupNode, PathSegment, SVGObject, CompositionFigure, CompUndoEntry, makeViewport } from '../types';
import { Bbox } from '../sceneNodeGeometry';
import { applyCompOps, revertCompOps } from '../compositionOps';
import { buildActiveMaskMap } from '../compositionMask';

function squareSegments(x: number, y: number, size: number): PathSegment[] {
  return [
    { kind: 'line', start: [x, y], end: [x + size, y] },
    { kind: 'line', start: [x + size, y], end: [x + size, y + size] },
    { kind: 'line', start: [x + size, y + size], end: [x, y + size] },
    { kind: 'line', start: [x, y + size], end: [x, y] },
  ];
}

const MASK = squareSegments(0, 0, 10);

function bbox(cellX: number, cellY: number, cellWidth: number, cellHeight: number): Bbox {
  return { cellX, cellY, cellWidth, cellHeight };
}

function makeSvg(id: string, overrides: Partial<SVGObject> = {}): SVGObject {
  const segs = overrides.segments ?? squareSegments(0, 0, 4);
  return {
    id,
    color: { r: 0, g: 0, b: 0 },
    segments: segs,
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
    ...overrides,
  };
}

function makeFigure(id: string, x: number, y: number, w: number, h: number, overrides: Partial<CompositionFigure> = {}): CompositionFigure {
  return {
    id,
    figureKey: 'k',
    cellX: x, cellY: y, cellWidth: w, cellHeight: h,
    resolutionX: 8, resolutionY: 8,
    ...overrides,
  } as CompositionFigure;
}

function makeGroup(id: string, parentGroupId?: string): GroupNode {
  return {
    id, name: id, parentGroupId,
    translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
    rotation: 0, mirrorH: false, mirrorV: false,
  };
}

function makeState(parts: Partial<CompositionState>): CompositionState {
  return {
    figures: [], svgObjects: [], images: [], groups: [],
    ...parts,
  } as unknown as CompositionState;
}

describe('bboxOverlapsMask', () => {
  test('bbox fully inside the mask overlaps', () => {
    expect(bboxOverlapsMask(MASK, bbox(2, 2, 2, 2))).toBe(true);
  });

  test('bbox straddling an edge (corner inside) overlaps', () => {
    expect(bboxOverlapsMask(MASK, bbox(8, 8, 6, 6))).toBe(true);
  });

  test('bbox fully outside does not overlap', () => {
    expect(bboxOverlapsMask(MASK, bbox(20, 20, 2, 2))).toBe(false);
  });

  test('bbox engulfing the mask overlaps (mask vertex inside bbox)', () => {
    expect(bboxOverlapsMask(MASK, bbox(-5, -5, 30, 30))).toBe(true);
  });

  test('bbox touching only beyond the edge does not overlap', () => {
    expect(bboxOverlapsMask(MASK, bbox(10.5, 10.5, 2, 2))).toBe(false);
  });

  test('open / unchainable path never overlaps', () => {
    const open: PathSegment[] = [
      { kind: 'line', start: [0, 0], end: [4, 0] },
      { kind: 'line', start: [4, 0], end: [4, 4] },
    ];
    expect(bboxOverlapsMask(open, bbox(1, 1, 1, 1))).toBe(false);
  });
});

describe('strokeIntersectsMaskRegion', () => {
  // Outer ring fully surrounding the mask (mask occupies 0..10): no stroke
  // enters the mask interior — the concentric-circle bug.
  const OUTER_RING = squareSegments(-5, -5, 20); // -5..15

  test('shape surrounding the mask (no stroke inside) does not intersect', () => {
    expect(strokeIntersectsMaskRegion(MASK, OUTER_RING)).toBe(false);
  });

  test('shape fully inside the mask intersects (its strokes are visible)', () => {
    expect(strokeIntersectsMaskRegion(MASK, squareSegments(2, 2, 4))).toBe(true);
  });

  test('open stroke crossing the mask boundary intersects', () => {
    const crossing: PathSegment[] = [{ kind: 'line', start: [-5, 5], end: [15, 5] }];
    expect(strokeIntersectsMaskRegion(MASK, crossing)).toBe(true);
  });

  test('open stroke entirely outside the mask does not intersect', () => {
    const outside: PathSegment[] = [{ kind: 'line', start: [20, 20], end: [30, 30] }];
    expect(strokeIntersectsMaskRegion(MASK, outside)).toBe(false);
  });

  test('open/unchainable mask never intersects', () => {
    const openMask: PathSegment[] = [
      { kind: 'line', start: [0, 0], end: [10, 0] },
      { kind: 'line', start: [10, 0], end: [10, 10] },
    ];
    expect(strokeIntersectsMaskRegion(openMask, squareSegments(2, 2, 4))).toBe(false);
  });
});

describe('computeMaskMembership', () => {
  test('unfilled shape surrounding the mask is excluded; a crossing stroke is included', () => {
    const mask = makeSvg('svg_mask', { segments: MASK, cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const ring = makeSvg('svg_ring', { segments: squareSegments(-5, -5, 20) });
    const crossing = makeSvg('svg_cross', {
      segments: [{ kind: 'line', start: [-5, 5], end: [15, 5] }],
    });
    const state = makeState({ svgObjects: [mask, ring, crossing] });
    expect(computeMaskMembership(state, 'svg_mask').figureIds).toEqual(['svg_cross']);
  });

  test('a FILLED shape surrounding the mask is still included (area is visible)', () => {
    const mask = makeSvg('svg_mask', { segments: MASK, cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const filledRing = makeSvg('svg_ring', {
      segments: squareSegments(-5, -5, 20), fillColor: { r: 1, g: 2, b: 3 },
    });
    const state = makeState({ svgObjects: [mask, filledRing] });
    expect(computeMaskMembership(state, 'svg_mask').figureIds).toEqual(['svg_ring']);
  });

  test('a TILED shape overlapping the mask bbox is still included', () => {
    const mask = makeSvg('svg_mask', { segments: MASK, cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const tiled = makeSvg('svg_tiled', {
      segments: squareSegments(-5, -5, 20), tileMode: 'repeat',
    });
    const state = makeState({ svgObjects: [mask, tiled] });
    expect(computeMaskMembership(state, 'svg_mask').figureIds).toEqual(['svg_tiled']);
  });

  test('collects loose overlapping objects, excludes the mask itself and outsiders', () => {
    const mask = makeSvg('svg_mask', { segments: MASK, cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const state = makeState({
      svgObjects: [mask],
      figures: [
        makeFigure('figInside', 2, 2, 2, 2),
        makeFigure('figPartial', 8, 8, 6, 6),
        makeFigure('figOutside', 50, 50, 2, 2),
      ],
    });
    const { figureIds, childGroupIds } = computeMaskMembership(state, 'svg_mask');
    expect(figureIds.sort()).toEqual(['figInside', 'figPartial']);
    expect(childGroupIds).toEqual([]);
    expect(figureIds).not.toContain('svg_mask');
  });

  test('locked overlapping objects are excluded', () => {
    const mask = makeSvg('svg_mask', { segments: MASK, cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const state = makeState({
      svgObjects: [mask],
      figures: [makeFigure('figLocked', 3, 3, 2, 2, { locked: true })],
    });
    expect(computeMaskMembership(state, 'svg_mask').figureIds).toEqual([]);
  });

  test('overlapping object in another group nests the whole root group, not the member', () => {
    const mask = makeSvg('svg_mask', { segments: MASK, cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const state = makeState({
      svgObjects: [mask],
      figures: [makeFigure('figGrouped', 3, 3, 2, 2, { groupId: 'grpChild' })],
      groups: [makeGroup('grpRoot'), makeGroup('grpChild', 'grpRoot')],
    });
    const { figureIds, childGroupIds } = computeMaskMembership(state, 'svg_mask');
    expect(figureIds).toEqual([]);
    expect(childGroupIds).toEqual(['grpRoot']);
  });

  test('arc-based closed mask captures objects inside the arc region', () => {
    // Closed shape: a square whose top edge bows out as a quarter arc — still
    // a chainable closed loop, so getFlattenedClosedPath resolves it.
    const arcMask: PathSegment[] = [
      { kind: 'line', start: [0, 0], end: [10, 0] },
      { kind: 'line', start: [10, 0], end: [10, 10] },
      { kind: 'arc', start: [10, 10], end: [0, 10], center: [5, 10] },
      { kind: 'line', start: [0, 10], end: [0, 0] },
    ];
    const mask = makeSvg('svg_mask', { segments: arcMask, cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const state = makeState({
      svgObjects: [mask],
      figures: [makeFigure('figInside', 4, 4, 2, 2)],
    });
    expect(computeMaskMembership(state, 'svg_mask').figureIds).toEqual(['figInside']);
  });

  test('missing or open mask yields empty membership (sanity)', () => {
    const open = makeSvg('svg_open', {
      segments: [
        { kind: 'line', start: [0, 0], end: [10, 0] },
        { kind: 'line', start: [10, 0], end: [10, 10] },
      ],
    });
    const state = makeState({ svgObjects: [open], figures: [makeFigure('figInside', 2, 2, 2, 2)] });
    expect(computeMaskMembership(state, 'svg_open')).toEqual({ figureIds: [], childGroupIds: [] });
    expect(computeMaskMembership(state, 'nonexistent')).toEqual({ figureIds: [], childGroupIds: [] });
  });
});

function fullState(svgObjects: SVGObject[], figures: CompositionFigure[]): CompositionState {
  return {
    id: 'test', name: 'test',
    figures, svgObjects, images: [], imageBlobs: {},
    lineDraft: null, arcDraft: null, editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 }, customColors: [],
    groups: [], sceneOrder: [...figures.map(f => f.id), ...svgObjects.map(s => s.id)],
    gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 }, viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(), activeFigureKey: null, compTool: 'select',
    createRegion: null, renderGeneration: 0,
  };
}

describe('set-mask confirm op sequence (groupFigures + setMaskMode)', () => {
  // Mirrors what CompositionEditor.handleSetMaskConfirm emits for a loose mask:
  // a fresh identity group containing the mask + overlapping objects, plus the
  // isMask flag — all in one undo entry.
  test('groups mask + overlap, flags isMask, derives active mask, and round-trips undo', () => {
    const mask = makeSvg('svg_mask', { segments: MASK, cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const figA = makeFigure('figA', 2, 2, 2, 2);
    const state = fullState([mask], [figA]);

    const entry: CompUndoEntry = [
      { op: 'groupFigures', figureIds: ['svg_mask', 'figA'], groupId: 'g1', groupName: 'Group 1', oldNames: [undefined, undefined] },
      { op: 'setMaskMode', svgId: 'svg_mask', oldValue: undefined, newValue: true },
    ];

    const next = applyCompOps(state, entry);
    const maskAfter = next.svgObjects.find(s => s.id === 'svg_mask')!;
    expect(maskAfter.groupId).toBe('g1');
    expect(maskAfter.isMask).toBe(true);
    expect(next.figures.find(f => f.id === 'figA')!.groupId).toBe('g1');
    expect(next.groups.some(g => g.id === 'g1')).toBe(true);

    // The active-mask derivation now resolves the mask for the new group.
    const maskMap = buildActiveMaskMap({ groups: next.groups, svgObjects: next.svgObjects, sceneOrder: next.sceneOrder });
    expect(maskMap.get('g1')?.id).toBe('svg_mask');

    // Undo restores the ungrouped, unflagged state.
    const reverted = revertCompOps(next, entry);
    const maskReverted = reverted.svgObjects.find(s => s.id === 'svg_mask')!;
    expect(maskReverted.groupId).toBeUndefined();
    expect(maskReverted.isMask).toBeUndefined();
    expect(reverted.figures.find(f => f.id === 'figA')!.groupId).toBeUndefined();
  });
});

describe('edit-mask confirm op sequence (full re-pick: ungroup + move + regroup)', () => {
  // Mirrors CompositionEditor.handleSetMaskConfirm for an *existing* mask group:
  // one undo entry [ungroupFigures, moveNode, groupFigures, setMaskMode] built
  // against the pre-edit snapshot. Dragging the mask off figA/figB and onto figC
  // must drop the no-longer-overlapping members and add the newly-overlapping one.
  test('re-picks membership after moving the mask, and undo restores the original group', () => {
    const mask = makeSvg('svg_mask', { segments: MASK, cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const figA = makeFigure('figA', 2, 2, 2, 2);   // inside mask at 0..10
    const figB = makeFigure('figB', 6, 6, 2, 2);   // inside mask at 0..10
    const figC = makeFigure('figC', 22, 22, 2, 2); // inside mask only after +20 move
    const base = fullState([mask], [figA, figB, figC]);

    // Existing mask group g1 = { mask, figA, figB }.
    const snapshot = applyCompOps(base, [
      { op: 'groupFigures', figureIds: ['svg_mask', 'figA', 'figB'], groupId: 'g1', groupName: 'Group 1', oldNames: [undefined, undefined, undefined] },
      { op: 'setMaskMode', svgId: 'svg_mask', oldValue: undefined, newValue: true },
    ]);

    // Build the confirm entry the way the handler does: ungroup g1, move the
    // mask +20,+20, then regroup the mask with whatever overlaps now.
    const ungroupOp: CompUndoEntry[number] = {
      op: 'ungroupFigures', figureIds: ['svg_mask', 'figA', 'figB'], groupId: 'g1', groupName: 'Group 1',
    };
    const moveOp: CompUndoEntry[number] = { op: 'moveNode', nodeId: 'svg_mask', dx: 20, dy: 20 };
    const afterMove = applyCompOps(snapshot, [ungroupOp, moveOp]);

    // Membership re-picked at the new position.
    const { figureIds: overlapIds, childGroupIds } = computeMaskMembership(afterMove, 'svg_mask');
    expect(overlapIds.sort()).toEqual(['figC']);
    expect(childGroupIds).toEqual([]);

    const entry: CompUndoEntry = [
      ungroupOp,
      moveOp,
      { op: 'groupFigures', figureIds: ['svg_mask', ...overlapIds], groupId: 'g2', groupName: 'Group 2', oldNames: [undefined, undefined] },
      { op: 'setMaskMode', svgId: 'svg_mask', oldValue: true, newValue: true },
    ];
    const final = applyCompOps(snapshot, entry);

    // New group has the mask + figC; figA/figB dropped to loose; mask moved.
    const fMask = final.svgObjects.find(s => s.id === 'svg_mask')!;
    expect(fMask.groupId).toBe('g2');
    expect(fMask.isMask).toBe(true);
    expect(fMask.cellX).toBe(20);
    expect(final.figures.find(f => f.id === 'figC')!.groupId).toBe('g2');
    expect(final.figures.find(f => f.id === 'figA')!.groupId).toBeUndefined();
    expect(final.figures.find(f => f.id === 'figB')!.groupId).toBeUndefined();
    expect(buildActiveMaskMap({ groups: final.groups, svgObjects: final.svgObjects, sceneOrder: final.sceneOrder }).get('g2')?.id).toBe('svg_mask');

    // Undo restores the original group g1 (mask + figA + figB) at the original position.
    const reverted = revertCompOps(final, entry);
    const rMask = reverted.svgObjects.find(s => s.id === 'svg_mask')!;
    expect(rMask.cellX).toBe(0);
    expect(rMask.groupId).toBe('g1');
    expect(reverted.figures.find(f => f.id === 'figA')!.groupId).toBe('g1');
    expect(reverted.figures.find(f => f.id === 'figB')!.groupId).toBe('g1');
    expect(reverted.figures.find(f => f.id === 'figC')!.groupId).toBeUndefined();
  });
});
