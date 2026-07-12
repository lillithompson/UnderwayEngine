import { applyCompOps, revertCompOps, cycleTransformForFigure, TRANSFORM_CYCLE, rotateGroupMemberFigure90CW, rotateFigureIndividual90CW, mirrorFigureIndividual, screenToLocalFlipAxis, pruneEmptyGroups, buildRemoveObjectOps, withGroupPruning, computeAliveGroupIds, SCENE_ADAPTERS, computeSVGBbox } from '../compositionOps';
import { CompositionState, CompositionFigure, CompUndoEntry, GroupNode, SVGObject, PathSegment, makeViewport } from '../types';

function makeFigure(overrides: Partial<CompositionFigure> = {}): CompositionFigure {
  return {
    id: 'fig1',
    figureKey: 'test',
    cellX: 10,
    cellY: 10,
    resolutionX: 2,
    resolutionY: 2,
    cellWidth: 2,
    cellHeight: 2,
    rotation: 0,
    ...overrides,
  };
}

function makeState(figures: CompositionFigure[]): CompositionState {
  return {
    id: 'test',
    name: 'test',
    figures,
    svgObjects: [],
    lineDraft: null,
    arcDraft: null,
    editingLineId: null,
    selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups: [],
    sceneOrder: figures.map((f) => f.id),
    gridLevel: 0,
    strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null,
    compTool: 'select',
    createRegion: null,
    renderGeneration: 0,
  };
}

/** Build a rotateFigure undo op from a figure (90° clockwise). */
function buildRotateOp(fig: CompositionFigure): CompUndoEntry {
  const oldRot = fig.rotation ?? 0;
  const newRot = ((oldRot + 90) % 360) as 0 | 90 | 180 | 270;
  const cx = fig.cellX + fig.cellWidth / 2;
  const cy = fig.cellY + fig.cellHeight / 2;
  const newW = fig.cellHeight;
  const newH = fig.cellWidth;
  return [{
    op: 'rotateFigure',
    figureId: fig.id,
    oldRotation: oldRot,
    newRotation: newRot,
    oldCellX: fig.cellX, oldCellY: fig.cellY,
    newCellX: Math.round(cx - newW / 2), newCellY: Math.round(cy - newH / 2),
    oldCellWidth: fig.cellWidth, oldCellHeight: fig.cellHeight,
    newCellWidth: newW, newCellHeight: newH,
  }];
}

describe('compositionOps rotateFigure', () => {
  test('square figure (2x2) stays same size and position', () => {
    const fig = makeFigure({ cellWidth: 2, cellHeight: 2, cellX: 10, cellY: 10 });
    const state = makeState([fig]);
    const entry = buildRotateOp(fig);
    const result = applyCompOps(state, entry);
    const r = result.figures[0];
    expect(r.rotation).toBe(90);
    expect(r.cellWidth).toBe(2);
    expect(r.cellHeight).toBe(2);
    expect(r.cellX).toBe(10);
    expect(r.cellY).toBe(10);
  });

  test('non-square (4x2) swaps dimensions and re-centers', () => {
    const fig = makeFigure({ cellWidth: 4, cellHeight: 2, cellX: 10, cellY: 10 });
    const state = makeState([fig]);
    const entry = buildRotateOp(fig);
    const result = applyCompOps(state, entry);
    const r = result.figures[0];
    expect(r.rotation).toBe(90);
    expect(r.cellWidth).toBe(2);
    expect(r.cellHeight).toBe(4);
    // center was (12, 11), new pos = (12-1, 11-2) = (11, 9)
    expect(r.cellX).toBe(11);
    expect(r.cellY).toBe(9);
  });

  test('odd parity (3x2) rounds to grid', () => {
    const fig = makeFigure({ cellWidth: 3, cellHeight: 2, cellX: 10, cellY: 10 });
    const state = makeState([fig]);
    const entry = buildRotateOp(fig);
    const result = applyCompOps(state, entry);
    const r = result.figures[0];
    expect(r.cellWidth).toBe(2);
    expect(r.cellHeight).toBe(3);
    // center was (11.5, 11), new pos = round(11.5-1, 11-1.5) = round(10.5, 9.5) = (11, 10)
    expect(r.cellX).toBe(11);
    expect(r.cellY).toBe(10);
  });

  test('four rotations return to original dimensions and position', () => {
    const fig = makeFigure({ cellWidth: 4, cellHeight: 2, cellX: 10, cellY: 10 });
    let state = makeState([fig]);
    let current = fig;
    for (let i = 0; i < 4; i++) {
      const entry = buildRotateOp(current);
      state = applyCompOps(state, entry);
      current = state.figures[0];
    }
    expect(current.rotation).toBe(0);
    expect(current.cellWidth).toBe(4);
    expect(current.cellHeight).toBe(2);
    expect(current.cellX).toBe(10);
    expect(current.cellY).toBe(10);
  });

  test('undo restores original state', () => {
    const fig = makeFigure({ cellWidth: 4, cellHeight: 2, cellX: 10, cellY: 10 });
    const state = makeState([fig]);
    const entry = buildRotateOp(fig);
    const rotated = applyCompOps(state, entry);
    const undone = revertCompOps(rotated, entry);
    const r = undone.figures[0];
    expect(r.rotation).toBe(0);
    expect(r.cellWidth).toBe(4);
    expect(r.cellHeight).toBe(2);
    expect(r.cellX).toBe(10);
    expect(r.cellY).toBe(10);
  });

  test('redo re-applies rotation', () => {
    const fig = makeFigure({ cellWidth: 4, cellHeight: 2, cellX: 10, cellY: 10 });
    const state = makeState([fig]);
    const entry = buildRotateOp(fig);
    const rotated = applyCompOps(state, entry);
    const undone = revertCompOps(rotated, entry);
    const redone = applyCompOps(undone, entry);
    const r = redone.figures[0];
    expect(r.rotation).toBe(90);
    expect(r.cellWidth).toBe(2);
    expect(r.cellHeight).toBe(4);
    expect(r.cellX).toBe(11);
    expect(r.cellY).toBe(9);
  });
});

describe('multi-quad mesh figures', () => {
  function makeMeshFigure(): CompositionFigure {
    // Two quads side by side: (0,0)→2x2 and (2,0)→2x2
    // Bounding box: cellX=5, cellY=5, cellWidth=4, cellHeight=2
    return makeFigure({
      id: 'mesh1',
      cellX: 5,
      cellY: 5,
      cellWidth: 4,
      cellHeight: 2,
      quads: [
        { offsetX: 0, offsetY: 0, cellWidth: 2, cellHeight: 2 },
        { offsetX: 2, offsetY: 0, cellWidth: 2, cellHeight: 2 },
      ],
    });
  }

  test('place and remove multi-quad figure', () => {
    const fig = makeMeshFigure();
    const state = makeState([]);
    const placeEntry: CompUndoEntry = [{ op: 'placeFigure', figure: fig }];
    const placed = applyCompOps(state, placeEntry);
    expect(placed.figures).toHaveLength(1);
    expect(placed.figures[0].quads).toHaveLength(2);

    const removeEntry: CompUndoEntry = [{ op: 'removeObject', kind: 'figure', item: fig }];
    const removed = applyCompOps(placed, removeEntry);
    expect(removed.figures).toHaveLength(0);
  });

  test('undo place removes the mesh figure', () => {
    const fig = makeMeshFigure();
    const state = makeState([]);
    const entry: CompUndoEntry = [{ op: 'placeFigure', figure: fig }];
    const placed = applyCompOps(state, entry);
    const undone = revertCompOps(placed, entry);
    expect(undone.figures).toHaveLength(0);
  });

  test('undo remove restores the mesh figure with quads', () => {
    const fig = makeMeshFigure();
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{ op: 'removeObject', kind: 'figure', item: fig }];
    const removed = applyCompOps(state, entry);
    expect(removed.figures).toHaveLength(0);
    const undone = revertCompOps(removed, entry);
    expect(undone.figures).toHaveLength(1);
    expect(undone.figures[0].quads).toHaveLength(2);
  });

  test('move preserves quads (offsets follow automatically)', () => {
    const fig = makeMeshFigure();
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'moveNode', nodeId: 'mesh1', dx: 5, dy: 10,
    }];
    const moved = applyCompOps(state, entry);
    const r = moved.figures[0];
    expect(r.cellX).toBe(10);
    expect(r.cellY).toBe(15);
    // Quads unchanged — relative offsets stay the same
    expect(r.quads).toEqual(fig.quads);
  });

  test('undo move restores position, quads unchanged', () => {
    const fig = makeMeshFigure();
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'moveNode', nodeId: 'mesh1', dx: 5, dy: 10,
    }];
    const moved = applyCompOps(state, entry);
    const undone = revertCompOps(moved, entry);
    expect(undone.figures[0].cellX).toBe(5);
    expect(undone.figures[0].cellY).toBe(5);
    expect(undone.figures[0].quads).toEqual(fig.quads);
  });
});

describe('cycleTransformForFigure', () => {
  test('each step produces correct rotation/mirror values', () => {
    let fig = makeFigure({ cellWidth: 2, cellHeight: 2, cellX: 10, cellY: 10, transformCycleStep: 0 });
    for (let step = 1; step < TRANSFORM_CYCLE.length; step++) {
      fig = cycleTransformForFigure(fig, step);
      const expected = TRANSFORM_CYCLE[step];
      expect(fig.rotation).toBe(expected.rotation);
      expect(fig.mirrorH ?? false).toBe(expected.mirrorH);
      expect(fig.mirrorV ?? false).toBe(expected.mirrorV);
      expect(fig.transformCycleStep).toBe(step);
    }
  });

  test('7 double-taps return to identity (square figure)', () => {
    const orig = makeFigure({ cellWidth: 2, cellHeight: 2, cellX: 10, cellY: 10, transformCycleStep: 0 });
    let fig = orig;
    for (let i = 0; i < TRANSFORM_CYCLE.length; i++) {
      const nextStep = (i + 1) % TRANSFORM_CYCLE.length;
      fig = cycleTransformForFigure(fig, nextStep);
    }
    // Step 0 after full cycle
    expect(fig.rotation).toBe(0);
    expect(fig.mirrorH ?? false).toBe(false);
    expect(fig.mirrorV ?? false).toBe(false);
    expect(fig.cellWidth).toBe(orig.cellWidth);
    expect(fig.cellHeight).toBe(orig.cellHeight);
    expect(fig.cellX).toBe(orig.cellX);
    expect(fig.cellY).toBe(orig.cellY);
  });

  test('dimension swap through rotation steps (non-square)', () => {
    let fig = makeFigure({ cellWidth: 4, cellHeight: 2, cellX: 10, cellY: 10, transformCycleStep: 0 });
    // Step 1: 90° rotation swaps dimensions
    fig = cycleTransformForFigure(fig, 1);
    expect(fig.cellWidth).toBe(2);
    expect(fig.cellHeight).toBe(4);
    expect(fig.rotation).toBe(90);
    // Step 2: 180° rotation — back to original dimensions
    fig = cycleTransformForFigure(fig, 2);
    expect(fig.cellWidth).toBe(4);
    expect(fig.cellHeight).toBe(2);
    expect(fig.rotation).toBe(180);
    // Step 3: 270° rotation swaps again
    fig = cycleTransformForFigure(fig, 3);
    expect(fig.cellWidth).toBe(2);
    expect(fig.cellHeight).toBe(4);
    expect(fig.rotation).toBe(270);
    // Step 4: back to identity
    fig = cycleTransformForFigure(fig, 4);
    expect(fig.cellWidth).toBe(4);
    expect(fig.cellHeight).toBe(2);
    expect(fig.rotation).toBe(0);
  });

  test('7 double-taps return to identity (non-square)', () => {
    const orig = makeFigure({ cellWidth: 4, cellHeight: 2, cellX: 10, cellY: 10, transformCycleStep: 0 });
    let fig = orig;
    for (let i = 0; i < TRANSFORM_CYCLE.length; i++) {
      const nextStep = (i + 1) % TRANSFORM_CYCLE.length;
      fig = cycleTransformForFigure(fig, nextStep);
    }
    expect(fig.rotation).toBe(0);
    expect(fig.mirrorH ?? false).toBe(false);
    expect(fig.mirrorV ?? false).toBe(false);
    expect(fig.cellWidth).toBe(orig.cellWidth);
    expect(fig.cellHeight).toBe(orig.cellHeight);
    expect(fig.cellX).toBe(orig.cellX);
    expect(fig.cellY).toBe(orig.cellY);
  });

  test('4 rotations return to same position (odd-dimension 3x4)', () => {
    const orig = makeFigure({ cellWidth: 3, cellHeight: 4, cellX: 5, cellY: 5, transformCycleStep: 0 });
    let fig = orig;
    // Rotate through steps 1-4 (90° → 180° → 270° → 0°)
    for (let step = 1; step <= 4; step++) {
      fig = cycleTransformForFigure(fig, step % TRANSFORM_CYCLE.length);
    }
    expect(fig.cellX).toBe(orig.cellX);
    expect(fig.cellY).toBe(orig.cellY);
    expect(fig.cellWidth).toBe(orig.cellWidth);
    expect(fig.cellHeight).toBe(orig.cellHeight);
  });

  test('7 double-taps return to identity (odd-dimension 3x4)', () => {
    const orig = makeFigure({ cellWidth: 3, cellHeight: 4, cellX: 5, cellY: 5, transformCycleStep: 0 });
    let fig = orig;
    for (let i = 0; i < TRANSFORM_CYCLE.length; i++) {
      const nextStep = (i + 1) % TRANSFORM_CYCLE.length;
      fig = cycleTransformForFigure(fig, nextStep);
    }
    expect(fig.rotation).toBe(0);
    expect(fig.mirrorH ?? false).toBe(false);
    expect(fig.mirrorV ?? false).toBe(false);
    expect(fig.cellWidth).toBe(orig.cellWidth);
    expect(fig.cellHeight).toBe(orig.cellHeight);
    expect(fig.cellX).toBe(orig.cellX);
    expect(fig.cellY).toBe(orig.cellY);
  });

  test('repeated full rotation cycles stay stable (odd-dimension 5x2)', () => {
    const orig = makeFigure({ cellWidth: 5, cellHeight: 2, cellX: 7, cellY: 3, transformCycleStep: 0 });
    let fig = orig;
    // 3 full cycles = 21 double-taps
    for (let cycle = 0; cycle < 3; cycle++) {
      for (let i = 0; i < TRANSFORM_CYCLE.length; i++) {
        const nextStep = (i + 1) % TRANSFORM_CYCLE.length;
        fig = cycleTransformForFigure(fig, nextStep);
      }
    }
    expect(fig.cellX).toBe(orig.cellX);
    expect(fig.cellY).toBe(orig.cellY);
    expect(fig.cellWidth).toBe(orig.cellWidth);
    expect(fig.cellHeight).toBe(orig.cellHeight);
  });

  test('mirror steps preserve dimensions', () => {
    let fig = makeFigure({ cellWidth: 4, cellHeight: 2, cellX: 10, cellY: 10, transformCycleStep: 0 });
    // Step 5: mirrorH
    fig = cycleTransformForFigure(fig, 5);
    expect(fig.cellWidth).toBe(4);
    expect(fig.cellHeight).toBe(2);
    expect(fig.mirrorH).toBe(true);
    expect(fig.mirrorV ?? false).toBe(false);
    expect(fig.rotation).toBe(0);
    // Step 6: mirrorV
    fig = cycleTransformForFigure(fig, 6);
    expect(fig.cellWidth).toBe(4);
    expect(fig.cellHeight).toBe(2);
    expect(fig.mirrorH ?? false).toBe(false);
    expect(fig.mirrorV).toBe(true);
    expect(fig.rotation).toBe(0);
  });

  test('rotation after move uses new position, not stale identity', () => {
    // Simulate: rotate, then move, then rotate again.
    // After moving, identityCellX/Y should be cleared so the next rotation
    // uses the new position instead of snapping back to the old one.
    let fig = makeFigure({ cellWidth: 4, cellHeight: 2, cellX: 10, cellY: 10, transformCycleStep: 0 });

    // First rotation (step 1: 90°)
    fig = cycleTransformForFigure(fig, 1);
    expect(fig.identityCellX).toBe(10);
    expect(fig.identityCellY).toBe(10);

    // Simulate a move by changing position and clearing identity (as the reducer does)
    fig = { ...fig, cellX: 20, cellY: 20, identityCellX: undefined, identityCellY: undefined, transformCycleStep: undefined };

    // Next rotation should use the NEW position (20,20), not snap back to (10,10)
    fig = cycleTransformForFigure(fig, 1);
    const cx = fig.cellX + fig.cellWidth / 2;
    const cy = fig.cellY + fig.cellHeight / 2;
    // The center should be near (20 + 2/2, 20 + 4/2) = (21, 22) — the moved position's center
    expect(cx).toBe(21);
    expect(cy).toBe(22);
    // And NOT near the old center (11, 11)
    expect(fig.cellX).not.toBe(10);
    expect(fig.cellY).not.toBe(10);
  });

  test('quad transformation through the cycle', () => {
    const quads = [
      { offsetX: 0, offsetY: 0, cellWidth: 2, cellHeight: 2 },
      { offsetX: 2, offsetY: 0, cellWidth: 2, cellHeight: 2 },
    ];
    const orig = makeFigure({
      cellWidth: 4, cellHeight: 2, cellX: 5, cellY: 5,
      transformCycleStep: 0, quads,
    });
    let fig = orig;
    // Full cycle should restore quads
    for (let i = 0; i < TRANSFORM_CYCLE.length; i++) {
      const nextStep = (i + 1) % TRANSFORM_CYCLE.length;
      fig = cycleTransformForFigure(fig, nextStep);
    }
    expect(fig.quads).toEqual(quads);

    // Step 1 (90° rotation): quads should be rotated
    fig = cycleTransformForFigure(orig, 1);
    expect(fig.quads).toBeDefined();
    expect(fig.quads!.length).toBe(2);
    // After 90° CW on 4x2 bounding box:
    // Quad (0,0,2,2) → (0,0,2,2)
    // Quad (2,0,2,2) → (0,2,2,2)
    expect(fig.quads![0]).toEqual({ offsetX: 0, offsetY: 0, cellWidth: 2, cellHeight: 2 });
    expect(fig.quads![1]).toEqual({ offsetX: 0, offsetY: 2, cellWidth: 2, cellHeight: 2 });
  });
});

describe('rotateGroupMemberFigure90CW', () => {
  // Codebase convention (see cells.test.ts:683-703): 90° CW in screen coords
  // sends TL → TR, TR → BR, BR → BL, BL → TL.

  test('2x2 unit grid: positions rotate CW around group center', () => {
    const tl = makeFigure({ id: 'tl', cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1 });
    const tr = makeFigure({ id: 'tr', cellX: 1, cellY: 0, cellWidth: 1, cellHeight: 1 });
    const br = makeFigure({ id: 'br', cellX: 1, cellY: 1, cellWidth: 1, cellHeight: 1 });
    const bl = makeFigure({ id: 'bl', cellX: 0, cellY: 1, cellWidth: 1, cellHeight: 1 });

    // Group bbox (0,0)-(2,2) → center (1,1)
    const gcx = 1, gcy = 1;
    const rTL = rotateGroupMemberFigure90CW(tl, gcx, gcy);
    const rTR = rotateGroupMemberFigure90CW(tr, gcx, gcy);
    const rBR = rotateGroupMemberFigure90CW(br, gcx, gcy);
    const rBL = rotateGroupMemberFigure90CW(bl, gcx, gcy);

    // TL (0,0) → TR slot (1,0)
    expect(rTL.cellX).toBe(1);
    expect(rTL.cellY).toBe(0);
    // TR (1,0) → BR slot (1,1)
    expect(rTR.cellX).toBe(1);
    expect(rTR.cellY).toBe(1);
    // BR (1,1) → BL slot (0,1)
    expect(rBR.cellX).toBe(0);
    expect(rBR.cellY).toBe(1);
    // BL (0,1) → TL slot (0,0)
    expect(rBL.cellX).toBe(0);
    expect(rBL.cellY).toBe(0);
  });

  test('rotation field advances by 90°', () => {
    const f0 = makeFigure({ rotation: 0, cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 });
    expect(rotateGroupMemberFigure90CW(f0, 1, 1).rotation).toBe(90);
    const f90 = makeFigure({ rotation: 90, cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 });
    expect(rotateGroupMemberFigure90CW(f90, 1, 1).rotation).toBe(180);
    const f180 = makeFigure({ rotation: 180, cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 });
    expect(rotateGroupMemberFigure90CW(f180, 1, 1).rotation).toBe(270);
    const f270 = makeFigure({ rotation: 270, cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 });
    expect(rotateGroupMemberFigure90CW(f270, 1, 1).rotation).toBe(0);
  });

  test('non-square pair: side-by-side 2x1 figures become a vertical stack', () => {
    // A at (0,0) 2x1, B at (2,0) 2x1. Group bbox (0,0)-(4,1) → center (2, 0.5)
    const a = makeFigure({ id: 'a', cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 1 });
    const b = makeFigure({ id: 'b', cellX: 2, cellY: 0, cellWidth: 2, cellHeight: 1 });
    const gcx = 2, gcy = 0.5;
    const ra = rotateGroupMemberFigure90CW(a, gcx, gcy);
    const rb = rotateGroupMemberFigure90CW(b, gcx, gcy);

    // Dimensions swap: each figure becomes 1x2
    expect(ra.cellWidth).toBe(1);
    expect(ra.cellHeight).toBe(2);
    expect(rb.cellWidth).toBe(1);
    expect(rb.cellHeight).toBe(2);
    // A was on the left → after CW goes to the top. B was on the right → bottom.
    // A center was (1, 0.5), rel (-1, 0), CW → (0, -1), new center (2, -0.5)
    //   → cellX = 2 - 0.5 = 1.5 → round 2, cellY = -0.5 - 1 = -1.5 → round -1
    expect(ra.cellX).toBe(2);
    expect(ra.cellY).toBe(-1);
    // B center was (3, 0.5), rel (1, 0), CW → (0, 1), new center (2, 1.5)
    //   → cellX = 1.5 → 2, cellY = 0.5 → 1 (0.5 rounds to 1 via Math.round bankers-ish; JS Math.round(0.5)=1)
    expect(rb.cellX).toBe(2);
    expect(rb.cellY).toBe(1);
  });

  test('four applications return to original position and dimensions', () => {
    const orig = makeFigure({ cellX: 3, cellY: 5, cellWidth: 4, cellHeight: 2, rotation: 0 });
    const gcx = 10, gcy = 10;
    let fig = orig;
    for (let i = 0; i < 4; i++) {
      fig = rotateGroupMemberFigure90CW(fig, gcx, gcy);
    }
    expect(fig.cellX).toBe(orig.cellX);
    expect(fig.cellY).toBe(orig.cellY);
    expect(fig.cellWidth).toBe(orig.cellWidth);
    expect(fig.cellHeight).toBe(orig.cellHeight);
    expect(fig.rotation).toBe(0);
  });

  test('quads rotate CW within the figure bbox', () => {
    // 4x2 bbox with two 2x2 quads side by side at (0,0) and (2,0)
    const fig = makeFigure({
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2,
      quads: [
        { offsetX: 0, offsetY: 0, cellWidth: 2, cellHeight: 2 },
        { offsetX: 2, offsetY: 0, cellWidth: 2, cellHeight: 2 },
      ],
    });
    const rotated = rotateGroupMemberFigure90CW(fig, 2, 1); // rotate around its own center
    // After 90° CW on 4x2 bbox → 2x4:
    // Quad (0,0,2,2) → (0, 0, 2, 2)
    // Quad (2,0,2,2) → (0, 2, 2, 2)
    expect(rotated.quads).toEqual([
      { offsetX: 0, offsetY: 0, cellWidth: 2, cellHeight: 2 },
      { offsetX: 0, offsetY: 2, cellWidth: 2, cellHeight: 2 },
    ]);
  });

  test('mirror flags are preserved', () => {
    const fig = makeFigure({
      cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2,
      mirrorH: true, mirrorV: false,
    });
    const rotated = rotateGroupMemberFigure90CW(fig, 5, 5);
    expect(rotated.mirrorH).toBe(true);
    expect(rotated.mirrorV ?? false).toBe(false);
  });

  test('identity anchors and transform-cycle step are cleared', () => {
    const fig = makeFigure({
      cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2,
      identityCellX: 10, identityCellY: 10, transformCycleStep: 2,
    });
    const rotated = rotateGroupMemberFigure90CW(fig, 1, 1);
    expect(rotated.identityCellX).toBeUndefined();
    expect(rotated.identityCellY).toBeUndefined();
    expect(rotated.transformCycleStep).toBeUndefined();
  });
});

describe('compositionOps scaleFigure', () => {
  test('apply scales figure to new dimensions and position', () => {
    const fig = makeFigure({ cellWidth: 4, cellHeight: 2, cellX: 10, cellY: 10 });
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'scaleFigure',
      figureId: 'fig1',
      oldCellX: 10, oldCellY: 10, oldCellWidth: 4, oldCellHeight: 2,
      newCellX: 10, newCellY: 10, newCellWidth: 8, newCellHeight: 4,
    }];
    const result = applyCompOps(state, entry);
    const r = result.figures[0];
    expect(r.cellX).toBe(10);
    expect(r.cellY).toBe(10);
    expect(r.cellWidth).toBe(8);
    expect(r.cellHeight).toBe(4);
  });

  test('apply clears identity and transform cycle step', () => {
    const fig = makeFigure({
      cellWidth: 4, cellHeight: 2, cellX: 10, cellY: 10,
      identityCellX: 5, identityCellY: 5, transformCycleStep: 2,
    });
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'scaleFigure',
      figureId: 'fig1',
      oldCellX: 10, oldCellY: 10, oldCellWidth: 4, oldCellHeight: 2,
      newCellX: 8, newCellY: 8, newCellWidth: 6, newCellHeight: 3,
    }];
    const result = applyCompOps(state, entry);
    const r = result.figures[0];
    expect(r.identityCellX).toBeUndefined();
    expect(r.identityCellY).toBeUndefined();
    expect(r.transformCycleStep).toBeUndefined();
  });

  test('undo restores original dimensions and position', () => {
    const fig = makeFigure({ cellWidth: 4, cellHeight: 2, cellX: 10, cellY: 10 });
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'scaleFigure',
      figureId: 'fig1',
      oldCellX: 10, oldCellY: 10, oldCellWidth: 4, oldCellHeight: 2,
      newCellX: 10, newCellY: 10, newCellWidth: 8, newCellHeight: 4,
    }];
    const scaled = applyCompOps(state, entry);
    const undone = revertCompOps(scaled, entry);
    const r = undone.figures[0];
    expect(r.cellX).toBe(10);
    expect(r.cellY).toBe(10);
    expect(r.cellWidth).toBe(4);
    expect(r.cellHeight).toBe(2);
  });

  test('redo re-applies scale', () => {
    const fig = makeFigure({ cellWidth: 4, cellHeight: 2, cellX: 10, cellY: 10 });
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'scaleFigure',
      figureId: 'fig1',
      oldCellX: 10, oldCellY: 10, oldCellWidth: 4, oldCellHeight: 2,
      newCellX: 10, newCellY: 10, newCellWidth: 8, newCellHeight: 4,
    }];
    const scaled = applyCompOps(state, entry);
    const undone = revertCompOps(scaled, entry);
    const redone = applyCompOps(undone, entry);
    const r = redone.figures[0];
    expect(r.cellWidth).toBe(8);
    expect(r.cellHeight).toBe(4);
  });

  test('scale with position change (anchor at opposite corner)', () => {
    const fig = makeFigure({ cellWidth: 4, cellHeight: 2, cellX: 10, cellY: 10 });
    const state = makeState([fig]);
    // Dragging top-left corner: anchor is bottom-right (14, 12), new TL at (6, 4)
    const entry: CompUndoEntry = [{
      op: 'scaleFigure',
      figureId: 'fig1',
      oldCellX: 10, oldCellY: 10, oldCellWidth: 4, oldCellHeight: 2,
      newCellX: 6, newCellY: 4, newCellWidth: 8, newCellHeight: 8,
    }];
    const result = applyCompOps(state, entry);
    const r = result.figures[0];
    expect(r.cellX).toBe(6);
    expect(r.cellY).toBe(4);
    expect(r.cellWidth).toBe(8);
    expect(r.cellHeight).toBe(8);
    // Undo restores
    const undone = revertCompOps(result, entry);
    expect(undone.figures[0].cellX).toBe(10);
    expect(undone.figures[0].cellY).toBe(10);
    expect(undone.figures[0].cellWidth).toBe(4);
    expect(undone.figures[0].cellHeight).toBe(2);
  });
});

describe('compositionOps scaleFigure — pattern tile dims', () => {
  test('applies new tile dims when provided', () => {
    const fig = makeFigure({
      cellWidth: 10, cellHeight: 10, cellX: 0, cellY: 0,
      tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2,
    });
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'scaleFigure', figureId: 'fig1',
      oldCellX: 0, oldCellY: 0, oldCellWidth: 10, oldCellHeight: 10,
      newCellX: 0, newCellY: 0, newCellWidth: 15, newCellHeight: 15,
      oldTileWidthL0: 2, oldTileHeightL0: 2,
      newTileWidthL0: 3, newTileHeightL0: 3,
    }];
    const result = applyCompOps(state, entry);
    const r = result.figures[0];
    expect(r.cellWidth).toBe(15);
    expect(r.tileWidthL0).toBe(3);
    expect(r.tileHeightL0).toBe(3);
    // Repetition count preserved: 10/2 == 15/3 == 5
    expect(r.cellWidth / (r.tileWidthL0 ?? 1)).toBe(5);
    expect(r.cellHeight / (r.tileHeightL0 ?? 1)).toBe(5);
  });

  test('leaves existing tile dims untouched when not provided', () => {
    const fig = makeFigure({
      cellWidth: 10, cellHeight: 10,
      tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2,
    });
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'scaleFigure', figureId: 'fig1',
      oldCellX: 10, oldCellY: 10, oldCellWidth: 10, oldCellHeight: 10,
      newCellX: 10, newCellY: 10, newCellWidth: 20, newCellHeight: 20,
    }];
    const result = applyCompOps(state, entry);
    const r = result.figures[0];
    expect(r.cellWidth).toBe(20);
    expect(r.tileWidthL0).toBe(2);
    expect(r.tileHeightL0).toBe(2);
  });

  test('undo restores original tile dims', () => {
    const fig = makeFigure({
      cellWidth: 10, cellHeight: 10,
      tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2,
    });
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'scaleFigure', figureId: 'fig1',
      oldCellX: 10, oldCellY: 10, oldCellWidth: 10, oldCellHeight: 10,
      newCellX: 10, newCellY: 10, newCellWidth: 15, newCellHeight: 15,
      oldTileWidthL0: 2, oldTileHeightL0: 2,
      newTileWidthL0: 3, newTileHeightL0: 3,
    }];
    const scaled = applyCompOps(state, entry);
    const undone = revertCompOps(scaled, entry);
    const r = undone.figures[0];
    expect(r.cellWidth).toBe(10);
    expect(r.tileWidthL0).toBe(2);
    expect(r.tileHeightL0).toBe(2);
  });

  test('redo re-applies scaled tile dims', () => {
    const fig = makeFigure({
      cellWidth: 10, cellHeight: 10,
      tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2,
    });
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'scaleFigure', figureId: 'fig1',
      oldCellX: 10, oldCellY: 10, oldCellWidth: 10, oldCellHeight: 10,
      newCellX: 10, newCellY: 10, newCellWidth: 15, newCellHeight: 15,
      oldTileWidthL0: 2, oldTileHeightL0: 2,
      newTileWidthL0: 3, newTileHeightL0: 3,
    }];
    const scaled = applyCompOps(state, entry);
    const undone = revertCompOps(scaled, entry);
    const redone = applyCompOps(undone, entry);
    const r = redone.figures[0];
    expect(r.cellWidth).toBe(15);
    expect(r.tileWidthL0).toBe(3);
    expect(r.tileHeightL0).toBe(3);
  });
});

describe('compositionOps scaleFigure — tile offset', () => {
  test('origin-side resize updates tileOffset to keep pattern fixed', () => {
    const fig = makeFigure({
      cellX: 10, cellY: 10, cellWidth: 8, cellHeight: 8,
      tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2,
    });
    const state = makeState([fig]);
    // Resize from left: cellX moves from 10 to 8 (2 cells left)
    const entry: CompUndoEntry = [{
      op: 'scaleFigure', figureId: 'fig1',
      oldCellX: 10, oldCellY: 10, oldCellWidth: 8, oldCellHeight: 8,
      newCellX: 8, newCellY: 10, newCellWidth: 10, newCellHeight: 8,
    }];
    const result = applyCompOps(state, entry);
    const r = result.figures[0];
    expect(r.cellX).toBe(8);
    expect(r.cellWidth).toBe(10);
    // Offset compensates: cellX moved by -2, so offset should be +2
    expect(r.tileOffsetXL0).toBe(2);
    // Y didn't change, no offset
    expect(r.tileOffsetYL0).toBeUndefined();
  });

  test('right-side resize does not change tileOffset', () => {
    const fig = makeFigure({
      cellX: 10, cellY: 10, cellWidth: 8, cellHeight: 8,
      tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2,
    });
    const state = makeState([fig]);
    // Resize from right: cellX stays at 10
    const entry: CompUndoEntry = [{
      op: 'scaleFigure', figureId: 'fig1',
      oldCellX: 10, oldCellY: 10, oldCellWidth: 8, oldCellHeight: 8,
      newCellX: 10, newCellY: 10, newCellWidth: 12, newCellHeight: 8,
    }];
    const result = applyCompOps(state, entry);
    const r = result.figures[0];
    expect(r.cellX).toBe(10);
    expect(r.cellWidth).toBe(12);
    expect(r.tileOffsetXL0).toBeUndefined();
  });

  test('undo/redo round-trip restores tile offset', () => {
    const fig = makeFigure({
      cellX: 10, cellY: 10, cellWidth: 8, cellHeight: 8,
      tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2,
    });
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'scaleFigure', figureId: 'fig1',
      oldCellX: 10, oldCellY: 10, oldCellWidth: 8, oldCellHeight: 8,
      newCellX: 6, newCellY: 8, newCellWidth: 12, newCellHeight: 10,
    }];
    const scaled = applyCompOps(state, entry);
    expect(scaled.figures[0].tileOffsetXL0).toBe(4);
    expect(scaled.figures[0].tileOffsetYL0).toBe(2);

    const undone = revertCompOps(scaled, entry);
    expect(undone.figures[0].cellX).toBe(10);
    // Offset reverts to 0 (functionally equivalent to undefined)
    expect(undone.figures[0].tileOffsetXL0 ?? 0).toBe(0);
    expect(undone.figures[0].tileOffsetYL0 ?? 0).toBe(0);

    const redone = applyCompOps(undone, entry);
    expect(redone.figures[0].tileOffsetXL0).toBe(4);
    expect(redone.figures[0].tileOffsetYL0).toBe(2);
  });

  test('non-tiled figure does not get tileOffset', () => {
    const fig = makeFigure({ cellX: 10, cellY: 10, cellWidth: 8, cellHeight: 8 });
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'scaleFigure', figureId: 'fig1',
      oldCellX: 10, oldCellY: 10, oldCellWidth: 8, oldCellHeight: 8,
      newCellX: 8, newCellY: 8, newCellWidth: 10, newCellHeight: 10,
    }];
    const result = applyCompOps(state, entry);
    expect(result.figures[0].tileOffsetXL0).toBeUndefined();
    expect(result.figures[0].tileOffsetYL0).toBeUndefined();
  });

  test('scaleFigure updates tile offset on tiled SVG object', () => {
    const fig = makeFigure({ id: 'other' });
    const state = makeState([fig]);
    const svg: SVGObject = {
      id: 'svg1', name: undefined, color: { r: 0, g: 0, b: 0 },
      segments: [{ kind: 'line', start: [0, 0], end: [4, 0] }],
      cellX: 10, cellY: 10, cellWidth: 8, cellHeight: 8,
      tileMode: 'repeat', tileWidthL0: 4, tileHeightL0: 4,
    };
    const stateWithSvg = { ...state, svgObjects: [svg] };
    const entry: CompUndoEntry = [{
      op: 'scaleFigure', figureId: 'svg1',
      oldCellX: 10, oldCellY: 10, oldCellWidth: 8, oldCellHeight: 8,
      newCellX: 6, newCellY: 10, newCellWidth: 12, newCellHeight: 8,
    }];
    const result = applyCompOps(stateWithSvg, entry);
    expect(result.svgObjects[0].tileOffsetXL0).toBe(4);
    expect(result.svgObjects[0].tileOffsetYL0).toBeUndefined();
  });

  test('rotated (90°) figure: visual-left resize needs no offset (rotation compensates)', () => {
    // Intrinsic 6W × 4H rotated 90° → stored as cellWidth=4, cellHeight=6
    const fig = makeFigure({
      cellX: 2, cellY: 3, cellWidth: 4, cellHeight: 6,
      rotation: 90,
      tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2,
    });
    const state = makeState([fig]);
    // Resize from visual left: cellX decreases by 2, cellWidth increases by 2
    const entry: CompUndoEntry = [{
      op: 'scaleFigure', figureId: 'fig1',
      oldCellX: 2, oldCellY: 3, oldCellWidth: 4, oldCellHeight: 6,
      newCellX: 0, newCellY: 3, newCellWidth: 6, newCellHeight: 6,
    }];
    const result = applyCompOps(state, entry);
    const r = result.figures[0];
    // For 90° rotation, the invRot center-shift exactly cancels the rect shift
    // for a visual-left resize, so no offset compensation is needed.
    expect(r.tileOffsetXL0 ?? 0).toBe(0);
    expect(r.tileOffsetYL0 ?? 0).toBe(0);
  });

  test('rotated (90°) figure: visual-bottom resize updates X offset', () => {
    const fig = makeFigure({
      cellX: 2, cellY: 3, cellWidth: 4, cellHeight: 6,
      rotation: 90,
      tileMode: 'repeat', tileWidthL0: 6, tileHeightL0: 4,
    });
    const state = makeState([fig]);
    // Resize from visual bottom: cellY decreases by 2, cellHeight increases by 2
    const entry: CompUndoEntry = [{
      op: 'scaleFigure', figureId: 'fig1',
      oldCellX: 2, oldCellY: 3, oldCellWidth: 4, oldCellHeight: 6,
      newCellX: 2, newCellY: 1, newCellWidth: 4, newCellHeight: 8,
    }];
    const result = applyCompOps(state, entry);
    // dy=-2, dh=2 → dOffset = (dy+dh, -dx) = (0, 0)... let me compute:
    // invRot 90°: ir00=0, ir01=1, ir10=-1, ir11=0
    // dx=0, dy=-2, dw=0, dh=2, dCx=0, dCy=-1
    // dRectX = 0 + (0-2)/2 = -1, dRectY = -2 + (2-0)/2 = -1
    // cX = 1*0 - 1*(-1) = 1, cY = 1*0 + 1*(-1) = -1
    // dOffX = 1 + 1 = 2, dOffY = 1 + (-1) = 0
    expect(result.figures[0].tileOffsetXL0).toBe(2);
    expect(result.figures[0].tileOffsetYL0 ?? 0).toBe(0);
  });

  test('rotated (90°) figure: undo/redo round-trip', () => {
    const fig = makeFigure({
      cellX: 2, cellY: 3, cellWidth: 4, cellHeight: 6,
      rotation: 90,
      tileMode: 'repeat', tileWidthL0: 6, tileHeightL0: 4,
    });
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'scaleFigure', figureId: 'fig1',
      oldCellX: 2, oldCellY: 3, oldCellWidth: 4, oldCellHeight: 6,
      newCellX: 2, newCellY: 1, newCellWidth: 4, newCellHeight: 8,
    }];
    const scaled = applyCompOps(state, entry);
    expect(scaled.figures[0].tileOffsetXL0).toBe(2);

    const undone = revertCompOps(scaled, entry);
    expect(undone.figures[0].tileOffsetXL0 ?? 0).toBe(0);
    expect(undone.figures[0].tileOffsetYL0 ?? 0).toBe(0);
  });

  test('180° figure: visual-right resize needs X offset', () => {
    const fig = makeFigure({
      cellX: 10, cellY: 10, cellWidth: 8, cellHeight: 8,
      rotation: 180,
      tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2,
    });
    const state = makeState([fig]);
    // Visual right for 180° is intrinsic left, needs compensation
    const entry: CompUndoEntry = [{
      op: 'scaleFigure', figureId: 'fig1',
      oldCellX: 10, oldCellY: 10, oldCellWidth: 8, oldCellHeight: 8,
      newCellX: 10, newCellY: 10, newCellWidth: 10, newCellHeight: 8,
    }];
    const result = applyCompOps(state, entry);
    // dx=0, dw=2 → for 180°: dOffset = (dx+dw, dy+dh) = (2, 0)
    expect(result.figures[0].tileOffsetXL0).toBe(2);
    expect(result.figures[0].tileOffsetYL0).toBeUndefined();
  });

  test('non-rotated figure: only cellX axis gets offset', () => {
    const fig = makeFigure({
      cellX: 10, cellY: 10, cellWidth: 8, cellHeight: 8,
      rotation: 0,
      tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2,
    });
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'scaleFigure', figureId: 'fig1',
      oldCellX: 10, oldCellY: 10, oldCellWidth: 8, oldCellHeight: 8,
      newCellX: 8, newCellY: 10, newCellWidth: 10, newCellHeight: 8,
    }];
    const result = applyCompOps(state, entry);
    // dOffset = (-dx, -dy) = (2, 0) for non-rotated
    expect(result.figures[0].tileOffsetXL0).toBe(2);
    expect(result.figures[0].tileOffsetYL0).toBeUndefined();
  });
});

describe('compositionOps toggleRepeat clears tile offset', () => {
  test('toggleRepeat resets tileOffset to undefined', () => {
    const fig = makeFigure({
      cellX: 8, cellY: 10, cellWidth: 10, cellHeight: 8,
      tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2,
      tileOffsetXL0: 4, tileOffsetYL0: 0,
    });
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'toggleRepeat', figureId: 'fig1',
      oldTileMode: 'repeat', oldTileWidthL0: 2, oldTileHeightL0: 2,
      oldCellX: 8, oldCellY: 10, oldCellWidth: 10, oldCellHeight: 8,
      newTileMode: undefined, newTileWidthL0: undefined, newTileHeightL0: undefined,
      newCellX: 8, newCellY: 10, newCellWidth: 2, newCellHeight: 2,
    }];
    const result = applyCompOps(state, entry);
    expect(result.figures[0].tileOffsetXL0).toBeUndefined();
    expect(result.figures[0].tileOffsetYL0).toBeUndefined();
  });
});

describe('compositionOps groupFigures', () => {
  test('apply sets groupId, group name, and preGroupName', () => {
    const fig1 = makeFigure({ id: 'a', name: 'Figure 1' });
    const fig2 = makeFigure({ id: 'b', name: 'Figure 2' });
    const state = makeState([fig1, fig2]);
    const entry: CompUndoEntry = [{
      op: 'groupFigures',
      figureIds: ['a', 'b'],
      groupId: 'g1',
      groupName: 'Group 1',
      oldNames: ['Figure 1', 'Figure 2'],
    }];
    const result = applyCompOps(state, entry);
    expect(result.figures[0].groupId).toBe('g1');
    expect(result.figures[0].name).toBe('Group 1');
    expect(result.figures[0].preGroupName).toBe('Figure 1');
    expect(result.figures[1].groupId).toBe('g1');
    expect(result.figures[1].name).toBeUndefined();
    expect(result.figures[1].preGroupName).toBe('Figure 2');
  });

  test('apply seeds localCell* from current cell bounds', () => {
    const fig1 = makeFigure({ id: 'a', cellX: 5, cellY: 7, cellWidth: 2, cellHeight: 3 });
    const fig2 = makeFigure({ id: 'b', cellX: 8, cellY: 7, cellWidth: 4, cellHeight: 3 });
    const state = makeState([fig1, fig2]);
    const entry: CompUndoEntry = [{
      op: 'groupFigures', figureIds: ['a', 'b'], groupId: 'g1',
      groupName: 'Group 1', oldNames: [undefined, undefined],
    }];
    const result = applyCompOps(state, entry);
    expect(result.figures[0].localCellX).toBe(5);
    expect(result.figures[0].localCellY).toBe(7);
    expect(result.figures[0].localCellWidth).toBe(2);
    expect(result.figures[0].localCellHeight).toBe(3);
    expect(result.figures[1].localCellX).toBe(8);
    expect(result.figures[1].localCellWidth).toBe(4);
  });

  test('revert clears localCell* along with groupId', () => {
    const fig1 = makeFigure({ id: 'a', name: 'Group 1', groupId: 'g1', preGroupName: 'Figure 1',
      localCellX: 5, localCellY: 7, localCellWidth: 2, localCellHeight: 3 });
    const state = makeState([fig1]);
    const entry: CompUndoEntry = [{
      op: 'groupFigures', figureIds: ['a'], groupId: 'g1',
      groupName: 'Group 1', oldNames: ['Figure 1'],
    }];
    const result = revertCompOps(state, entry);
    expect(result.figures[0].localCellX).toBeUndefined();
    expect(result.figures[0].localCellY).toBeUndefined();
    expect(result.figures[0].localCellWidth).toBeUndefined();
    expect(result.figures[0].localCellHeight).toBeUndefined();
  });

  test('revert clears groupId, preGroupName and restores old names', () => {
    const fig1 = makeFigure({ id: 'a', name: 'Group 1', groupId: 'g1', preGroupName: 'Figure 1' });
    const fig2 = makeFigure({ id: 'b', name: undefined, groupId: 'g1', preGroupName: 'Figure 2' });
    const state = makeState([fig1, fig2]);
    const entry: CompUndoEntry = [{
      op: 'groupFigures',
      figureIds: ['a', 'b'],
      groupId: 'g1',
      groupName: 'Group 1',
      oldNames: ['Figure 1', 'Figure 2'],
    }];
    const result = revertCompOps(state, entry);
    expect(result.figures[0].groupId).toBeUndefined();
    expect(result.figures[0].name).toBe('Figure 1');
    expect(result.figures[0].preGroupName).toBeUndefined();
    expect(result.figures[1].groupId).toBeUndefined();
    expect(result.figures[1].name).toBe('Figure 2');
    expect(result.figures[1].preGroupName).toBeUndefined();
  });
});

describe('compositionOps ungroupFigures', () => {
  test('apply clears groupId and restores original names', () => {
    const fig1 = makeFigure({ id: 'a', name: 'Group 1', groupId: 'g1', preGroupName: 'Figure 1' });
    const fig2 = makeFigure({ id: 'b', name: undefined, groupId: 'g1', preGroupName: 'Figure 2' });
    const state = makeState([fig1, fig2]);
    const entry: CompUndoEntry = [{
      op: 'ungroupFigures',
      figureIds: ['a', 'b'],
      groupId: 'g1',
      groupName: 'Group 1',
    }];
    const result = applyCompOps(state, entry);
    expect(result.figures[0].groupId).toBeUndefined();
    expect(result.figures[0].name).toBe('Figure 1');
    expect(result.figures[0].preGroupName).toBeUndefined();
    expect(result.figures[1].groupId).toBeUndefined();
    expect(result.figures[1].name).toBe('Figure 2');
    expect(result.figures[1].preGroupName).toBeUndefined();
  });

  test('revert re-applies groupId and sets preGroupName', () => {
    const fig1 = makeFigure({ id: 'a', name: 'Figure 1' });
    const fig2 = makeFigure({ id: 'b', name: 'Figure 2' });
    const state = makeState([fig1, fig2]);
    const entry: CompUndoEntry = [{
      op: 'ungroupFigures',
      figureIds: ['a', 'b'],
      groupId: 'g1',
      groupName: 'Group 1',
    }];
    const result = revertCompOps(state, entry);
    expect(result.figures[0].groupId).toBe('g1');
    expect(result.figures[0].name).toBe('Group 1');
    expect(result.figures[0].preGroupName).toBe('Figure 1');
    expect(result.figures[1].groupId).toBe('g1');
    expect(result.figures[1].preGroupName).toBe('Figure 2');
  });

  test('full group/ungroup/undo round-trip preserves names', () => {
    const fig1 = makeFigure({ id: 'a', name: 'Figure 1' });
    const fig2 = makeFigure({ id: 'b', name: 'Figure 2' });
    const state = makeState([fig1, fig2]);

    const groupEntry: CompUndoEntry = [{
      op: 'groupFigures', figureIds: ['a', 'b'], groupId: 'g1',
      groupName: 'Group 1', oldNames: ['Figure 1', 'Figure 2'],
    }];
    const grouped = applyCompOps(state, groupEntry);
    expect(grouped.figures[0].name).toBe('Group 1');
    expect(grouped.figures[1].name).toBeUndefined();

    const ungroupEntry: CompUndoEntry = [{
      op: 'ungroupFigures', figureIds: ['a', 'b'], groupId: 'g1', groupName: 'Group 1',
    }];
    const ungrouped = applyCompOps(grouped, ungroupEntry);
    expect(ungrouped.figures[0].name).toBe('Figure 1');
    expect(ungrouped.figures[1].name).toBe('Figure 2');

    const reGrouped = revertCompOps(ungrouped, ungroupEntry);
    expect(reGrouped.figures[0].name).toBe('Group 1');
    expect(reGrouped.figures[0].groupId).toBe('g1');

    const fullyRestored = revertCompOps(reGrouped, groupEntry);
    expect(fullyRestored.figures[0].name).toBe('Figure 1');
    expect(fullyRestored.figures[1].name).toBe('Figure 2');
    expect(fullyRestored.figures[0].groupId).toBeUndefined();
    expect(fullyRestored.figures[1].groupId).toBeUndefined();
  });
});

describe('compositionOps ungroupFigures clears mask mode', () => {
  function closedSquare(x: number, y: number, size: number): PathSegment[] {
    return [
      { kind: 'line', start: [x, y], end: [x + size, y] },
      { kind: 'line', start: [x + size, y], end: [x + size, y + size] },
      { kind: 'line', start: [x + size, y + size], end: [x, y + size] },
      { kind: 'line', start: [x, y + size], end: [x, y] },
    ];
  }
  function makeMaskSVG(id: string, overrides: Partial<SVGObject> = {}): SVGObject {
    const segs = overrides.segments ?? closedSquare(0, 0, 4);
    return {
      id,
      segments: segs,
      color: { r: 0, g: 0, b: 0 },
      ...computeSVGBbox(segs),
      ...overrides,
    };
  }
  function makeGroup(id: string, parentGroupId?: string): GroupNode {
    return {
      id, name: id, parentGroupId,
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
  }
  function stateWith(svgObjects: SVGObject[], groups: GroupNode[]): CompositionState {
    return { ...makeState([]), svgObjects, groups, sceneOrder: svgObjects.map(s => s.id) };
  }

  test('clears isMask on a first-level svg member', () => {
    const mask = makeMaskSVG('svg_mask', { groupId: 'g1', isMask: true });
    const sibling = makeMaskSVG('svg_b', { groupId: 'g1' });
    const state = stateWith([mask, sibling], [makeGroup('g1')]);
    const entry: CompUndoEntry = [{
      op: 'ungroupFigures', figureIds: ['svg_mask', 'svg_b'], groupId: 'g1', groupName: 'g1',
    }];
    const result = applyCompOps(state, entry);
    const m = result.svgObjects.find(s => s.id === 'svg_mask')!;
    expect(m.groupId).toBeUndefined();
    expect(m.isMask).toBeUndefined();
  });

  test('does not recurse into nested child-group masks', () => {
    // Outer group g_outer holds its own mask + a child group g_child whose
    // member is also a mask. Ungrouping g_outer must leave the nested mask.
    const outerMask = makeMaskSVG('svg_outer', { groupId: 'g_outer', isMask: true });
    const childMask = makeMaskSVG('svg_child', { groupId: 'g_child', isMask: true });
    const state = stateWith(
      [outerMask, childMask],
      [makeGroup('g_outer'), makeGroup('g_child', 'g_outer')],
    );
    const entry: CompUndoEntry = [{
      op: 'ungroupFigures', figureIds: ['svg_outer'], groupId: 'g_outer', groupName: 'g_outer',
      childGroupIds: ['g_child'],
    }];
    const result = applyCompOps(state, entry);
    const outer = result.svgObjects.find(s => s.id === 'svg_outer')!;
    const child = result.svgObjects.find(s => s.id === 'svg_child')!;
    expect(outer.groupId).toBeUndefined();
    expect(outer.isMask).toBeUndefined();
    // Child group is detached to top level but still a group; its mask persists.
    expect(child.groupId).toBe('g_child');
    expect(child.isMask).toBe(true);
  });

  test('undo restores isMask via maskedSvgIds', () => {
    const mask = makeMaskSVG('svg_mask', { groupId: 'g1', isMask: true });
    const sibling = makeMaskSVG('svg_b', { groupId: 'g1' });
    const grouped = stateWith([mask, sibling], [makeGroup('g1')]);
    const entry: CompUndoEntry = [{
      op: 'ungroupFigures', figureIds: ['svg_mask', 'svg_b'], groupId: 'g1', groupName: 'g1',
      maskedSvgIds: ['svg_mask'],
    }];
    const ungrouped = applyCompOps(grouped, entry);
    expect(ungrouped.svgObjects.find(s => s.id === 'svg_mask')!.isMask).toBeUndefined();
    const reGrouped = revertCompOps(ungrouped, entry);
    const m = reGrouped.svgObjects.find(s => s.id === 'svg_mask')!;
    expect(m.groupId).toBe('g1');
    expect(m.isMask).toBe(true);
  });
});

describe('compositionOps syncDimensions', () => {
  test('apply updates only resolution, leaves cellWidth/cellHeight untouched', () => {
    const fig = makeFigure({ resolutionX: 2, resolutionY: 2, cellWidth: 1, cellHeight: 1.8 });
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'syncDimensions', figureId: 'fig1',
      oldResolutionX: 2, oldResolutionY: 2,
      newResolutionX: 4, newResolutionY: 4,
    }];
    const result = applyCompOps(state, entry);
    const r = result.figures[0];
    expect(r.cellWidth).toBe(1);
    expect(r.cellHeight).toBe(1.8);
    expect(r.resolutionX).toBe(4);
    expect(r.resolutionY).toBe(4);
  });

  test('undo restores original resolution, still does not touch cellWidth/cellHeight', () => {
    const fig = makeFigure({ resolutionX: 4, resolutionY: 4, cellWidth: 1, cellHeight: 1.8 });
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'syncDimensions', figureId: 'fig1',
      oldResolutionX: 2, oldResolutionY: 2,
      newResolutionX: 4, newResolutionY: 4,
    }];
    const undone = revertCompOps(state, entry);
    const r = undone.figures[0];
    expect(r.cellWidth).toBe(1);
    expect(r.cellHeight).toBe(1.8);
    expect(r.resolutionX).toBe(2);
    expect(r.resolutionY).toBe(2);
  });

  test('does not modify tileWidthL0/tileHeightL0 for repeat-mode figures', () => {
    const fig = makeFigure({
      resolutionX: 2, resolutionY: 2,
      cellWidth: 4, cellHeight: 4,
      tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2,
    });
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'syncDimensions', figureId: 'fig1',
      oldResolutionX: 2, oldResolutionY: 2,
      newResolutionX: 4, newResolutionY: 4,
    }];
    const result = applyCompOps(state, entry);
    const r = result.figures[0];
    expect(r.cellWidth).toBe(4);
    expect(r.cellHeight).toBe(4);
    expect(r.tileWidthL0).toBe(2);
    expect(r.tileHeightL0).toBe(2);
  });

  test('leaves tile dimensions undefined for non-repeat figures', () => {
    const fig = makeFigure({ resolutionX: 2, resolutionY: 2, cellWidth: 4, cellHeight: 4 });
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'syncDimensions', figureId: 'fig1',
      oldResolutionX: 2, oldResolutionY: 2,
      newResolutionX: 4, newResolutionY: 4,
    }];
    const result = applyCompOps(state, entry);
    expect(result.figures[0].tileWidthL0).toBeUndefined();
    expect(result.figures[0].tileHeightL0).toBeUndefined();
  });

  test('multiple figures sync independently, regions preserved', () => {
    const fig1 = makeFigure({ id: 'a', resolutionX: 2, resolutionY: 2, cellWidth: 1, cellHeight: 1 });
    const fig2 = makeFigure({ id: 'b', resolutionX: 2, resolutionY: 2, cellWidth: 3, cellHeight: 3 });
    const state = makeState([fig1, fig2]);
    const entry: CompUndoEntry = [
      {
        op: 'syncDimensions', figureId: 'a',
        oldResolutionX: 2, oldResolutionY: 2,
        newResolutionX: 4, newResolutionY: 4,
      },
      {
        op: 'syncDimensions', figureId: 'b',
        oldResolutionX: 2, oldResolutionY: 2,
        newResolutionX: 4, newResolutionY: 4,
      },
    ];
    const result = applyCompOps(state, entry);
    expect(result.figures[0].cellWidth).toBe(1);
    expect(result.figures[0].resolutionX).toBe(4);
    expect(result.figures[1].cellWidth).toBe(3);
    expect(result.figures[1].resolutionX).toBe(4);
  });

  // Regression: resizing a source pattern file must not change the region
  // geometry of figures that reference it. Previously syncDimensions scaled
  // cellWidth/cellHeight by the resolution ratio, growing/shrinking every
  // placement of the pattern on focus-return.
  test('preserves region geometry across pattern resize (regression)', () => {
    const fig1 = makeFigure({ id: 'a', fileId: 'src',
      cellWidth: 5, cellHeight: 5, resolutionX: 2, resolutionY: 2 });
    const fig2 = makeFigure({ id: 'b', fileId: 'src',
      cellWidth: 3, cellHeight: 7, resolutionX: 2, resolutionY: 2 });
    const state = makeState([fig1, fig2]);
    // Source file scaled 4× (e.g. 8×8 L0 → 32×32 L0, so resolution 2 → 8).
    const entry: CompUndoEntry = [
      {
        op: 'syncDimensions', figureId: 'a',
        oldResolutionX: 2, oldResolutionY: 2,
        newResolutionX: 8, newResolutionY: 8,
      },
      {
        op: 'syncDimensions', figureId: 'b',
        oldResolutionX: 2, oldResolutionY: 2,
        newResolutionX: 8, newResolutionY: 8,
      },
    ];
    const result = applyCompOps(state, entry);
    const [a, b] = result.figures;
    expect(a.cellWidth).toBe(5);
    expect(a.cellHeight).toBe(5);
    expect(a.resolutionX).toBe(8);
    expect(a.resolutionY).toBe(8);
    expect(b.cellWidth).toBe(3);
    expect(b.cellHeight).toBe(7);
    expect(b.resolutionX).toBe(8);
    expect(b.resolutionY).toBe(8);
  });

  test('updates cellWidth/cellHeight when op includes cell dimension fields', () => {
    // resolutionX=4 → native cellWidth = 4*4 = 16
    const fig = makeFigure({ resolutionX: 4, resolutionY: 4, cellWidth: 16, cellHeight: 16 });
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'syncDimensions', figureId: 'fig1',
      oldResolutionX: 4, oldResolutionY: 4,
      newResolutionX: 1, newResolutionY: 2,
      oldCellWidth: 16, oldCellHeight: 16,
      newCellWidth: 4, newCellHeight: 8,
    }];
    const result = applyCompOps(state, entry);
    const r = result.figures[0];
    expect(r.resolutionX).toBe(1);
    expect(r.resolutionY).toBe(2);
    expect(r.cellWidth).toBe(4);
    expect(r.cellHeight).toBe(8);
  });

  test('undo restores cellWidth/cellHeight for native-sized figure', () => {
    const fig = makeFigure({ resolutionX: 1, resolutionY: 2, cellWidth: 4, cellHeight: 8 });
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'syncDimensions', figureId: 'fig1',
      oldResolutionX: 4, oldResolutionY: 4,
      newResolutionX: 1, newResolutionY: 2,
      oldCellWidth: 16, oldCellHeight: 16,
      newCellWidth: 4, newCellHeight: 8,
    }];
    const undone = revertCompOps(state, entry);
    const r = undone.figures[0];
    expect(r.resolutionX).toBe(4);
    expect(r.resolutionY).toBe(4);
    expect(r.cellWidth).toBe(16);
    expect(r.cellHeight).toBe(16);
  });

  test('redo round-trip for native-sized figure', () => {
    const fig = makeFigure({ resolutionX: 4, resolutionY: 4, cellWidth: 16, cellHeight: 16 });
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'syncDimensions', figureId: 'fig1',
      oldResolutionX: 4, oldResolutionY: 4,
      newResolutionX: 1, newResolutionY: 2,
      oldCellWidth: 16, oldCellHeight: 16,
      newCellWidth: 4, newCellHeight: 8,
    }];
    const applied = applyCompOps(state, entry);
    const undone = revertCompOps(applied, entry);
    const redone = applyCompOps(undone, entry);
    expect(redone.figures[0].resolutionX).toBe(1);
    expect(redone.figures[0].cellWidth).toBe(4);
    expect(redone.figures[0].cellHeight).toBe(8);
  });

  test('omitting cell fields leaves cellWidth/cellHeight untouched (manually resized)', () => {
    const fig = makeFigure({ resolutionX: 4, resolutionY: 4, cellWidth: 10, cellHeight: 10 });
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'syncDimensions', figureId: 'fig1',
      oldResolutionX: 4, oldResolutionY: 4,
      newResolutionX: 1, newResolutionY: 2,
    }];
    const result = applyCompOps(state, entry);
    expect(result.figures[0].cellWidth).toBe(10);
    expect(result.figures[0].cellHeight).toBe(10);
    expect(result.figures[0].resolutionX).toBe(1);
  });
});

describe('compositionOps toggleRepeat', () => {
  test('toggle on preserves position and size', () => {
    const fig = makeFigure({ cellX: 10, cellY: 10, cellWidth: 8, cellHeight: 8, resolutionX: 2, resolutionY: 2 });
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'toggleRepeat', figureId: 'fig1',
      oldTileMode: undefined, oldTileWidthL0: undefined, oldTileHeightL0: undefined,
      oldCellX: 10, oldCellY: 10, oldCellWidth: 8, oldCellHeight: 8,
      newTileMode: 'repeat', newTileWidthL0: 8, newTileHeightL0: 8,
      newCellX: 10, newCellY: 10, newCellWidth: 8, newCellHeight: 8,
    }];
    const result = applyCompOps(state, entry);
    const r = result.figures[0];
    expect(r.tileMode).toBe('repeat');
    expect(r.tileWidthL0).toBe(8);
    expect(r.tileHeightL0).toBe(8);
    expect(r.cellX).toBe(10);
    expect(r.cellY).toBe(10);
    expect(r.cellWidth).toBe(8);
    expect(r.cellHeight).toBe(8);
  });

  test('toggle off resets boundary to native size and recenters', () => {
    // Figure with res 2x2, native size = 8x8. Currently stretched to 20x6 in pattern mode.
    const fig = makeFigure({
      cellX: 5, cellY: 10, cellWidth: 20, cellHeight: 6,
      resolutionX: 2, resolutionY: 2,
      tileMode: 'repeat', tileWidthL0: 8, tileHeightL0: 8,
    });
    const state = makeState([fig]);
    // Center: (5 + 20/2, 10 + 6/2) = (15, 13)
    // Native size: 8x8. New position: (15 - 4, 13 - 4) = (11, 9)
    const entry: CompUndoEntry = [{
      op: 'toggleRepeat', figureId: 'fig1',
      oldTileMode: 'repeat', oldTileWidthL0: 8, oldTileHeightL0: 8,
      oldCellX: 5, oldCellY: 10, oldCellWidth: 20, oldCellHeight: 6,
      newTileMode: undefined, newTileWidthL0: undefined, newTileHeightL0: undefined,
      newCellX: 11, newCellY: 9, newCellWidth: 8, newCellHeight: 8,
    }];
    const result = applyCompOps(state, entry);
    const r = result.figures[0];
    expect(r.tileMode).toBeUndefined();
    expect(r.tileWidthL0).toBeUndefined();
    expect(r.tileHeightL0).toBeUndefined();
    expect(r.cellWidth).toBe(8);
    expect(r.cellHeight).toBe(8);
    expect(r.cellX).toBe(11);
    expect(r.cellY).toBe(9);
  });

  test('undo restores stretched boundary and pattern mode', () => {
    const fig = makeFigure({
      cellX: 11, cellY: 9, cellWidth: 8, cellHeight: 8,
      resolutionX: 2, resolutionY: 2,
    });
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'toggleRepeat', figureId: 'fig1',
      oldTileMode: 'repeat', oldTileWidthL0: 8, oldTileHeightL0: 8,
      oldCellX: 5, oldCellY: 10, oldCellWidth: 20, oldCellHeight: 6,
      newTileMode: undefined, newTileWidthL0: undefined, newTileHeightL0: undefined,
      newCellX: 11, newCellY: 9, newCellWidth: 8, newCellHeight: 8,
    }];
    const undone = revertCompOps(state, entry);
    const r = undone.figures[0];
    expect(r.tileMode).toBe('repeat');
    expect(r.tileWidthL0).toBe(8);
    expect(r.tileHeightL0).toBe(8);
    expect(r.cellX).toBe(5);
    expect(r.cellY).toBe(10);
    expect(r.cellWidth).toBe(20);
    expect(r.cellHeight).toBe(6);
  });

  test('toggle off with 90-degree rotation swaps native dimensions', () => {
    // Figure with res 2x3, native size = 8x12.
    // Rotated 90°, so native boundary becomes 12x8.
    // Currently stretched to 24x4 in pattern mode.
    const fig = makeFigure({
      cellX: 0, cellY: 0, cellWidth: 24, cellHeight: 4,
      resolutionX: 2, resolutionY: 3, rotation: 90,
      tileMode: 'repeat', tileWidthL0: 12, tileHeightL0: 8,
    });
    const state = makeState([fig]);
    // Center: (0 + 24/2, 0 + 4/2) = (12, 2)
    // Rotated native: 12x8. New position: (12 - 6, 2 - 4) = (6, -2)
    const entry: CompUndoEntry = [{
      op: 'toggleRepeat', figureId: 'fig1',
      oldTileMode: 'repeat', oldTileWidthL0: 12, oldTileHeightL0: 8,
      oldCellX: 0, oldCellY: 0, oldCellWidth: 24, oldCellHeight: 4,
      newTileMode: undefined, newTileWidthL0: undefined, newTileHeightL0: undefined,
      newCellX: 6, newCellY: -2, newCellWidth: 12, newCellHeight: 8,
    }];
    const result = applyCompOps(state, entry);
    const r = result.figures[0];
    expect(r.cellWidth).toBe(12);
    expect(r.cellHeight).toBe(8);
    expect(r.cellX).toBe(6);
    expect(r.cellY).toBe(-2);
  });

  test('toggle on applies to svg object (not figure)', () => {
    const state: CompositionState = {
      ...makeState([]),
      svgObjects: [{
        id: 'svg_1', segments: [{kind:'line', start:[0,0], end:[4,4]}], color: { r: 255, g: 255, b: 255 },
        cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
      }],
    };
    const entry: CompUndoEntry = [{
      op: 'toggleRepeat', figureId: 'svg_1',
      oldTileMode: undefined, oldTileWidthL0: undefined, oldTileHeightL0: undefined,
      oldCellX: 0, oldCellY: 0, oldCellWidth: 4, oldCellHeight: 4,
      newTileMode: 'repeat', newTileWidthL0: 4, newTileHeightL0: 4,
      newCellX: 0, newCellY: 0, newCellWidth: 4, newCellHeight: 4,
    }];
    const result = applyCompOps(state, entry);
    expect(result.svgObjects[0].tileMode).toBe('repeat');
    expect(result.svgObjects[0].tileWidthL0).toBe(4);
    expect(result.svgObjects[0].tileHeightL0).toBe(4);
  });

  test('toggle off reverts svg object tile state', () => {
    const state: CompositionState = {
      ...makeState([]),
      svgObjects: [{
        id: 'svg_1', segments: [{kind:'line', start:[0,0], end:[4,4]}], color: { r: 255, g: 255, b: 255 },
        cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8,
        tileMode: 'repeat', tileWidthL0: 4, tileHeightL0: 4,
      }],
    };
    const entry: CompUndoEntry = [{
      op: 'toggleRepeat', figureId: 'svg_1',
      oldTileMode: 'repeat', oldTileWidthL0: 4, oldTileHeightL0: 4,
      oldCellX: 0, oldCellY: 0, oldCellWidth: 8, oldCellHeight: 8,
      newTileMode: undefined, newTileWidthL0: undefined, newTileHeightL0: undefined,
      newCellX: 2, newCellY: 2, newCellWidth: 4, newCellHeight: 4,
    }];
    const result = applyCompOps(state, entry);
    expect(result.svgObjects[0].tileMode).toBeUndefined();
    expect(result.svgObjects[0].cellWidth).toBe(4);
    // Revert restores the repeat state
    const reverted = revertCompOps(result, entry);
    expect(reverted.svgObjects[0].tileMode).toBe('repeat');
    expect(reverted.svgObjects[0].cellWidth).toBe(8);
  });

  test('toggle on applies to svg object (arc-like)', () => {
    const state: CompositionState = {
      ...makeState([]),
      svgObjects: [{
        id: 'svg_2', segments: [{ kind: 'arc', start: [0, 2], end: [2, 0], center: [0, 0] }],
        color: { r: 255, g: 255, b: 255 },
        cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2,
      }],
    };
    const entry: CompUndoEntry = [{
      op: 'toggleRepeat', figureId: 'svg_2',
      oldTileMode: undefined, oldTileWidthL0: undefined, oldTileHeightL0: undefined,
      oldCellX: 0, oldCellY: 0, oldCellWidth: 2, oldCellHeight: 2,
      newTileMode: 'repeat', newTileWidthL0: 2, newTileHeightL0: 2,
      newCellX: 0, newCellY: 0, newCellWidth: 2, newCellHeight: 2,
    }];
    const result = applyCompOps(state, entry);
    expect(result.svgObjects[0].tileMode).toBe('repeat');
  });

  test('scaleFigure op applies to tiled svg object bbox', () => {
    const state: CompositionState = {
      ...makeState([]),
      svgObjects: [{
        id: 'svg_1', segments: [{kind:'line', start:[0,0], end:[4,4]}], color: { r: 255, g: 255, b: 255 },
        cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
        tileMode: 'repeat', tileWidthL0: 4, tileHeightL0: 4,
      }],
    };
    const entry: CompUndoEntry = [{
      op: 'scaleFigure', figureId: 'svg_1',
      oldCellX: 0, oldCellY: 0, oldCellWidth: 4, oldCellHeight: 4,
      newCellX: 0, newCellY: 0, newCellWidth: 12, newCellHeight: 12,
    }];
    const result = applyCompOps(state, entry);
    expect(result.svgObjects[0].cellWidth).toBe(12);
    expect(result.svgObjects[0].cellHeight).toBe(12);
    // Segments unchanged — tile content is fixed
    expect(result.svgObjects[0].segments).toEqual([{kind:'line', start:[0,0], end:[4,4]}]);
    // Revert
    const reverted = revertCompOps(result, entry);
    expect(reverted.svgObjects[0].cellWidth).toBe(4);
  });
});

describe('rotateFigureIndividual90CW', () => {
  test('square figure: 4 rotations return to original (apply path matches reducer)', () => {
    let fig = makeFigure({ cellX: 5, cellY: 5, cellWidth: 2, cellHeight: 2, rotation: 0 });
    for (let i = 0; i < 4; i++) fig = rotateFigureIndividual90CW(fig);
    expect(fig.rotation).toBe(0);
    expect(fig.cellX).toBe(5);
    expect(fig.cellY).toBe(5);
    expect(fig.cellWidth).toBe(2);
    expect(fig.cellHeight).toBe(2);
  });

  test('preserves identity anchor across rotations', () => {
    const fig = makeFigure({ cellX: 5, cellY: 5, cellWidth: 4, cellHeight: 2, rotation: 0 });
    const r1 = rotateFigureIndividual90CW(fig);
    expect(r1.identityCellX).toBe(5);
    expect(r1.identityCellY).toBe(5);
    // Identity persists into next rotation
    const r2 = rotateFigureIndividual90CW(r1);
    expect(r2.identityCellX).toBe(5);
    expect(r2.identityCellY).toBe(5);
  });

  test('rotates quads 90° CW', () => {
    const fig = makeFigure({
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2,
      quads: [
        { offsetX: 0, offsetY: 0, cellWidth: 2, cellHeight: 2 },
        { offsetX: 2, offsetY: 0, cellWidth: 2, cellHeight: 2 },
      ],
    });
    const r = rotateFigureIndividual90CW(fig);
    expect(r.cellWidth).toBe(2);
    expect(r.cellHeight).toBe(4);
    expect(r.quads).toEqual([
      { offsetX: 0, offsetY: 0, cellWidth: 2, cellHeight: 2 },
      { offsetX: 0, offsetY: 2, cellWidth: 2, cellHeight: 2 },
    ]);
  });
});

describe('mirrorFigureIndividual', () => {
  test('toggles mirrorH and flips quad offsetX', () => {
    const fig = makeFigure({
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2,
      quads: [
        { offsetX: 0, offsetY: 0, cellWidth: 2, cellHeight: 2 },
        { offsetX: 2, offsetY: 0, cellWidth: 2, cellHeight: 2 },
      ],
    });
    const r = mirrorFigureIndividual(fig, 'h');
    expect(r.mirrorH).toBe(true);
    expect(r.quads).toEqual([
      { offsetX: 2, offsetY: 0, cellWidth: 2, cellHeight: 2 },
      { offsetX: 0, offsetY: 0, cellWidth: 2, cellHeight: 2 },
    ]);
  });

  test('two mirrors on same axis return to original', () => {
    const fig = makeFigure({
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2,
      quads: [
        { offsetX: 0, offsetY: 0, cellWidth: 2, cellHeight: 2 },
        { offsetX: 2, offsetY: 0, cellWidth: 2, cellHeight: 2 },
      ],
    });
    const r = mirrorFigureIndividual(mirrorFigureIndividual(fig, 'v'), 'v');
    expect(r.mirrorV ?? false).toBe(false);
    expect(r.quads).toEqual(fig.quads);
  });
});

describe('screenToLocalFlipAxis', () => {
  test('no swap at 0 degrees', () => {
    expect(screenToLocalFlipAxis(0, 'h')).toBe('h');
    expect(screenToLocalFlipAxis(0, 'v')).toBe('v');
  });

  test('swaps axes at 90 degrees', () => {
    expect(screenToLocalFlipAxis(90, 'h')).toBe('v');
    expect(screenToLocalFlipAxis(90, 'v')).toBe('h');
  });

  test('no swap at 180 degrees', () => {
    expect(screenToLocalFlipAxis(180, 'h')).toBe('h');
    expect(screenToLocalFlipAxis(180, 'v')).toBe('v');
  });

  test('swaps axes at 270 degrees', () => {
    expect(screenToLocalFlipAxis(270, 'h')).toBe('v');
    expect(screenToLocalFlipAxis(270, 'v')).toBe('h');
  });

  test('screen H flip after 90 rotation toggles mirrorV', () => {
    const fig = makeFigure({ rotation: 90, cellWidth: 2, cellHeight: 4 });
    const localAxis = screenToLocalFlipAxis(fig.rotation!, 'h');
    const mirrored = mirrorFigureIndividual(fig, localAxis);
    expect(mirrored.mirrorV).toBe(true);
    expect(mirrored.mirrorH ?? false).toBe(false);
  });

  test('screen V flip after 270 rotation toggles mirrorH', () => {
    const fig = makeFigure({ rotation: 270, cellWidth: 2, cellHeight: 4 });
    const localAxis = screenToLocalFlipAxis(fig.rotation!, 'v');
    const mirrored = mirrorFigureIndividual(fig, localAxis);
    expect(mirrored.mirrorH).toBe(true);
    expect(mirrored.mirrorV ?? false).toBe(false);
  });
});

describe('undo restores full state — moveFigure', () => {
  test('revert restores cellX/Y AND identity anchors set by a prior rotation', () => {
    // Simulate the buggy sequence: rotate (sets identity), then move
    // (clears identity), then undo move — expect identity restored.
    const fig = makeFigure({
      cellX: 5, cellY: 5, cellWidth: 4, cellHeight: 2,
      identityCellX: 5, identityCellY: 5, transformCycleStep: 1,
    });
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'moveNode', nodeId: 'fig1', dx: 7, dy: 3,
      oldIdentityCellX: 5, oldIdentityCellY: 5, oldTransformCycleStep: 1,
    }];
    const moved = applyCompOps(state, entry);
    expect(moved.figures[0].cellX).toBe(12);
    expect(moved.figures[0].identityCellX).toBeUndefined();
    expect(moved.figures[0].transformCycleStep).toBeUndefined();
    const undone = revertCompOps(moved, entry);
    expect(undone.figures[0].cellX).toBe(5);
    expect(undone.figures[0].cellY).toBe(5);
    expect(undone.figures[0].identityCellX).toBe(5);
    expect(undone.figures[0].identityCellY).toBe(5);
    expect(undone.figures[0].transformCycleStep).toBe(1);
  });

  test('revert with no captured identity leaves figure with undefined identity', () => {
    const fig = makeFigure({ cellX: 5, cellY: 5, cellWidth: 2, cellHeight: 2 });
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'moveNode', nodeId: 'fig1', dx: 5, dy: 5,
    }];
    const undone = revertCompOps(applyCompOps(state, entry), entry);
    expect(undone.figures[0].identityCellX).toBeUndefined();
  });
});

describe('undo restores full state — scaleFigure', () => {
  test('revert restores identity anchors set by a prior rotation', () => {
    const fig = makeFigure({
      cellX: 5, cellY: 5, cellWidth: 4, cellHeight: 2,
      identityCellX: 5, identityCellY: 5, transformCycleStep: 2,
    });
    const state = makeState([fig]);
    const entry: CompUndoEntry = [{
      op: 'scaleFigure', figureId: 'fig1',
      oldCellX: 5, oldCellY: 5, oldCellWidth: 4, oldCellHeight: 2,
      newCellX: 5, newCellY: 5, newCellWidth: 8, newCellHeight: 4,
      oldIdentityCellX: 5, oldIdentityCellY: 5, oldTransformCycleStep: 2,
    }];
    const scaled = applyCompOps(state, entry);
    expect(scaled.figures[0].identityCellX).toBeUndefined();
    const undone = revertCompOps(scaled, entry);
    expect(undone.figures[0].cellWidth).toBe(4);
    expect(undone.figures[0].identityCellX).toBe(5);
    expect(undone.figures[0].identityCellY).toBe(5);
    expect(undone.figures[0].transformCycleStep).toBe(2);
  });
});

describe('undo restores full state — rotateFigure with quads', () => {
  test('revert restores original quads and identity', () => {
    const origQuads = [
      { offsetX: 0, offsetY: 0, cellWidth: 2, cellHeight: 2 },
      { offsetX: 2, offsetY: 0, cellWidth: 2, cellHeight: 2 },
    ];
    const fig = makeFigure({
      cellX: 5, cellY: 5, cellWidth: 4, cellHeight: 2, rotation: 0,
      quads: origQuads,
    });
    const state = makeState([fig]);
    const rotated = rotateFigureIndividual90CW(fig);
    const entry: CompUndoEntry = [{
      op: 'rotateFigure', figureId: 'fig1',
      oldRotation: 0, newRotation: 90,
      oldCellX: fig.cellX, oldCellY: fig.cellY,
      oldCellWidth: fig.cellWidth, oldCellHeight: fig.cellHeight,
      newCellX: rotated.cellX, newCellY: rotated.cellY,
      newCellWidth: rotated.cellWidth, newCellHeight: rotated.cellHeight,
      oldQuads: origQuads, newQuads: rotated.quads,
      oldIdentityCellX: undefined, oldIdentityCellY: undefined,
      newIdentityCellX: rotated.identityCellX, newIdentityCellY: rotated.identityCellY,
    }];
    const applied = applyCompOps(state, entry);
    expect(applied.figures[0].quads).toEqual(rotated.quads);
    expect(applied.figures[0].identityCellX).toBe(rotated.identityCellX);
    const undone = revertCompOps(applied, entry);
    expect(undone.figures[0].quads).toEqual(origQuads);
    expect(undone.figures[0].rotation).toBe(0);
    expect(undone.figures[0].cellWidth).toBe(4);
    expect(undone.figures[0].cellHeight).toBe(2);
    expect(undone.figures[0].identityCellX).toBeUndefined();
  });

  test('round-trip rotate→undo→redo→undo preserves quads exactly', () => {
    const origQuads = [
      { offsetX: 0, offsetY: 0, cellWidth: 2, cellHeight: 2 },
      { offsetX: 2, offsetY: 0, cellWidth: 2, cellHeight: 2 },
    ];
    const fig = makeFigure({ cellX: 5, cellY: 5, cellWidth: 4, cellHeight: 2, quads: origQuads });
    const state = makeState([fig]);
    const rotated = rotateFigureIndividual90CW(fig);
    const entry: CompUndoEntry = [{
      op: 'rotateFigure', figureId: 'fig1',
      oldRotation: 0, newRotation: 90,
      oldCellX: 5, oldCellY: 5, oldCellWidth: 4, oldCellHeight: 2,
      newCellX: rotated.cellX, newCellY: rotated.cellY,
      newCellWidth: rotated.cellWidth, newCellHeight: rotated.cellHeight,
      oldQuads: origQuads, newQuads: rotated.quads,
      newIdentityCellX: rotated.identityCellX, newIdentityCellY: rotated.identityCellY,
    }];
    const a = applyCompOps(state, entry);
    const u = revertCompOps(a, entry);
    expect(u.figures[0].quads).toEqual(origQuads);
    const r = applyCompOps(u, entry);
    expect(r.figures[0].quads).toEqual(rotated.quads);
    const u2 = revertCompOps(r, entry);
    expect(u2.figures[0].quads).toEqual(origQuads);
  });
});

describe('undo restores full state — mirrorFigure with quads', () => {
  test('revert restores original quads after horizontal mirror', () => {
    const origQuads = [
      { offsetX: 0, offsetY: 0, cellWidth: 2, cellHeight: 2 },
      { offsetX: 2, offsetY: 0, cellWidth: 2, cellHeight: 2 },
    ];
    const fig = makeFigure({ cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2, quads: origQuads });
    const state = makeState([fig]);
    const mirrored = mirrorFigureIndividual(fig, 'h');
    const entry: CompUndoEntry = [{
      op: 'mirrorFigure', figureId: 'fig1', axis: 'h',
      oldValue: false, newValue: true,
      oldQuads: origQuads, newQuads: mirrored.quads,
    }];
    const applied = applyCompOps(state, entry);
    expect(applied.figures[0].mirrorH).toBe(true);
    expect(applied.figures[0].quads).toEqual(mirrored.quads);
    const undone = revertCompOps(applied, entry);
    expect(undone.figures[0].mirrorH).toBe(false);
    expect(undone.figures[0].quads).toEqual(origQuads);
  });

  test('revert restores original quads after vertical mirror', () => {
    const origQuads = [
      { offsetX: 0, offsetY: 0, cellWidth: 2, cellHeight: 1 },
      { offsetX: 0, offsetY: 1, cellWidth: 2, cellHeight: 1 },
    ];
    const fig = makeFigure({ cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2, quads: origQuads });
    const state = makeState([fig]);
    const mirrored = mirrorFigureIndividual(fig, 'v');
    const entry: CompUndoEntry = [{
      op: 'mirrorFigure', figureId: 'fig1', axis: 'v',
      oldValue: false, newValue: true,
      oldQuads: origQuads, newQuads: mirrored.quads,
    }];
    const undone = revertCompOps(applyCompOps(state, entry), entry);
    expect(undone.figures[0].mirrorV).toBe(false);
    expect(undone.figures[0].quads).toEqual(origQuads);
  });
});

describe('empty group pruning', () => {
  function makeGroup(id: string, name: string, parentGroupId?: string): GroupNode {
    return {
      id, name, parentGroupId,
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
  }

  test('pruneEmptyGroups drops a group with no members', () => {
    const state: CompositionState = {
      ...makeState([]),
      groups: [makeGroup('orphan', 'Group 1')],
    };
    expect(pruneEmptyGroups(state).groups).toEqual([]);
  });

  test('pruneEmptyGroups keeps a parent whose grandchild has a leaf', () => {
    const gp = makeGroup('gp', 'GP');
    const child = makeGroup('child', 'C', 'gp');
    const fig = makeFigure({ id: 'f1', groupId: 'child' });
    const state: CompositionState = {
      ...makeState([fig]),
      groups: [gp, child],
    };
    expect(pruneEmptyGroups(state).groups.map((g) => g.id).sort()).toEqual(['child', 'gp']);
  });

  test('buildRemoveObjectOps emits a removeGroup for the now-empty group', () => {
    const fig = makeFigure({ id: 'f1', groupId: 'g' });
    const state: CompositionState = {
      ...makeState([fig]),
      groups: [makeGroup('g', 'Group 1')],
    };
    const entry = buildRemoveObjectOps(state, ['f1']);
    expect(entry.map((op) => op.op)).toEqual(['removeObject', 'removeGroup']);
    const after = applyCompOps(state, entry);
    expect(after.figures).toEqual([]);
    expect(after.groups).toEqual([]);
  });

  test('undo restores the GroupNode along with its member', () => {
    const fig = makeFigure({ id: 'f1', groupId: 'g' });
    const state: CompositionState = {
      ...makeState([fig]),
      groups: [makeGroup('g', 'Group 1')],
    };
    const entry = buildRemoveObjectOps(state, ['f1']);
    const after = applyCompOps(state, entry);
    const undone = revertCompOps(after, entry);
    expect(undone.figures).toHaveLength(1);
    expect(undone.figures[0].groupId).toBe('g');
    expect(undone.groups.map((g) => g.id)).toEqual(['g']);
  });

  test('buildRemoveObjectOps prunes the parent when the only child group becomes empty', () => {
    const parent = makeGroup('p', 'Parent');
    const child = makeGroup('c', 'Child', 'p');
    const fig = makeFigure({ id: 'f1', groupId: 'c' });
    const state: CompositionState = {
      ...makeState([fig]),
      groups: [parent, child],
    };
    const entry = buildRemoveObjectOps(state, ['f1']);
    const removeGroupIds = entry
      .filter((op): op is { op: 'removeGroup'; group: GroupNode } => op.op === 'removeGroup')
      .map((op) => op.group.id)
      .sort();
    expect(removeGroupIds).toEqual(['c', 'p']);
  });

  test('buildRemoveObjectOps leaves the group alone when other members survive', () => {
    const fig1 = makeFigure({ id: 'f1', groupId: 'g' });
    const fig2 = { ...makeFigure({ id: 'f2', groupId: 'g' }), figureKey: 'k2' };
    const state: CompositionState = {
      ...makeState([fig1, fig2]),
      groups: [makeGroup('g', 'Group 1')],
    };
    const entry = buildRemoveObjectOps(state, ['f1']);
    expect(entry.some((op) => op.op === 'removeGroup')).toBe(false);
  });

  test('withGroupPruning is a no-op when no group becomes empty', () => {
    const fig = makeFigure({ id: 'f1', groupId: 'g' });
    const state: CompositionState = {
      ...makeState([fig]),
      groups: [makeGroup('g', 'Group 1')],
    };
    const noopEntry: CompUndoEntry = [{ op: 'renameGroup', groupId: 'g', oldName: 'Group 1', newName: 'Renamed' }];
    expect(withGroupPruning(state, noopEntry)).toBe(noopEntry);
  });

  test('computeAliveGroupIds walks the ancestor chain', () => {
    const gp = makeGroup('gp', 'GP');
    const parent = makeGroup('p', 'P', 'gp');
    const child = makeGroup('c', 'C', 'p');
    const fig = makeFigure({ id: 'f1', groupId: 'c' });
    const alive = computeAliveGroupIds([gp, parent, child], [fig], [], []);
    expect([...alive].sort()).toEqual(['c', 'gp', 'p']);
  });
});

describe('joinObjects → reconcileGroupLocals (Expand figure path)', () => {
  function makeGroup(id: string, name: string, translateX = 0, translateY = 0): GroupNode {
    return {
      id, name,
      translateX, translateY, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
  }

  test('result inheriting groupId gets localCell* and localSegments back-filled', () => {
    // Group translated by (5, 7). Figure at world (10, 10), so its position
    // inside the group is local (5, 3). Expand replaces the figure with an
    // SVGObject in the same group — that SVGObject's world coords should be
    // those of the figure, with localCell* derived via the inverse group transform.
    const fig = makeFigure({ id: 'f1', groupId: 'g', cellX: 10, cellY: 10, cellWidth: 4, cellHeight: 4 });
    const state: CompositionState = {
      ...makeState([fig]),
      groups: [makeGroup('g', 'G', 5, 7)],
      svgObjects: [],
    };

    const result: SVGObject = {
      id: 'svg_1_u',
      color: { r: 255, g: 255, b: 255 },
      segments: [{ kind: 'line', start: [10, 10], end: [14, 10] }],
      cellX: 10, cellY: 10, cellWidth: 4, cellHeight: 4,
      groupId: 'g',
    };

    const entry: CompUndoEntry = [{
      op: 'joinObjects',
      sourceSVGs: [], sourceSVGIndices: [],
      sourceFigures: [fig], sourceFigureIndices: [0],
      result, resultInsertIndex: 0,
      oldSceneOrder: ['f1'],
    }];

    const next = applyCompOps(state, entry);

    expect(next.svgObjects).toHaveLength(1);
    expect(next.figures).toHaveLength(0);
    const sv = next.svgObjects[0];
    expect(sv.groupId).toBe('g');
    // World coords preserved
    expect(sv.cellX).toBe(10); expect(sv.cellY).toBe(10);
    // Locals back-filled by reconcileGroupLocals: inverse of translate(5,7)
    expect(sv.localCellX).toBe(5);
    expect(sv.localCellY).toBe(3);
    expect(sv.localCellWidth).toBe(4);
    expect(sv.localCellHeight).toBe(4);
    // localSegments derived from inverse-transformed world segments
    expect(sv.localSegments).toBeDefined();
    expect(sv.localSegments!.length).toBe(1);
    const local = sv.localSegments![0];
    expect(local.kind).toBe('line');
    if (local.kind === 'line') {
      expect(local.start[0]).toBeCloseTo(5);
      expect(local.start[1]).toBeCloseTo(3);
      expect(local.end[0]).toBeCloseTo(9);
      expect(local.end[1]).toBeCloseTo(3);
    }
  });

  test('result without groupId skips reconciliation (no locals added)', () => {
    const fig1 = makeFigure({ id: 'f1', cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 });
    const fig2 = { ...makeFigure({ id: 'f2', cellX: 4, cellY: 0, cellWidth: 2, cellHeight: 2 }), figureKey: 'k2' };
    const state = makeState([fig1, fig2]);
    const result: SVGObject = {
      id: 'svg_1_u',
      color: { r: 0, g: 0, b: 0 },
      segments: [{ kind: 'line', start: [0, 0], end: [4, 0] }],
      cellX: 0, cellY: 0, cellWidth: 6, cellHeight: 2,
    };
    const entry: CompUndoEntry = [{
      op: 'joinObjects',
      sourceSVGs: [], sourceSVGIndices: [],
      sourceFigures: [fig1, fig2], sourceFigureIndices: [0, 1],
      result, resultInsertIndex: 0,
      oldSceneOrder: ['f1', 'f2'],
    }];
    const next = applyCompOps(state, entry);
    const sv = next.svgObjects[0];
    expect(sv.groupId).toBeUndefined();
    expect(sv.localCellX).toBeUndefined();
    expect(sv.localSegments).toBeUndefined();
  });
});

describe('setMaskMode op', () => {
  function makeSvg(overrides: Partial<SVGObject> = {}): SVGObject {
    return {
      id: 'svg_1',
      color: { r: 0, g: 0, b: 0 },
      segments: [
        { kind: 'line', start: [0, 0], end: [4, 0] },
        { kind: 'line', start: [4, 0], end: [4, 4] },
        { kind: 'line', start: [4, 4], end: [0, 4] },
        { kind: 'line', start: [0, 4], end: [0, 0] },
      ],
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
      ...overrides,
    };
  }

  test('apply sets isMask, revert restores undefined', () => {
    const state = { ...makeState([]), svgObjects: [makeSvg()] };
    const entry: CompUndoEntry = [{ op: 'setMaskMode', svgId: 'svg_1', oldValue: undefined, newValue: true }];
    const on = applyCompOps(state, entry);
    expect(on.svgObjects[0].isMask).toBe(true);
    const off = revertCompOps(on, entry);
    expect(off.svgObjects[0].isMask).toBeUndefined();
  });

  test('apply clears isMask back to undefined (never false)', () => {
    const state = { ...makeState([]), svgObjects: [makeSvg({ isMask: true })] };
    const entry: CompUndoEntry = [{ op: 'setMaskMode', svgId: 'svg_1', oldValue: true, newValue: undefined }];
    const off = applyCompOps(state, entry);
    expect(off.svgObjects[0].isMask).toBeUndefined();
    expect('isMask' in off.svgObjects[0]).toBe(true); // spread keeps key; value undefined is fine
    const on = revertCompOps(off, entry);
    expect(on.svgObjects[0].isMask).toBe(true);
  });

  test('only targets the matching svgId', () => {
    const state = { ...makeState([]), svgObjects: [makeSvg(), makeSvg({ id: 'svg_2' })] };
    const entry: CompUndoEntry = [{ op: 'setMaskMode', svgId: 'svg_2', newValue: true }];
    const next = applyCompOps(state, entry);
    expect(next.svgObjects[0].isMask).toBeUndefined();
    expect(next.svgObjects[1].isMask).toBe(true);
  });

  test('SCENE_ADAPTERS svg clone preserves isMask', () => {
    const adapter = SCENE_ADAPTERS.find((a) => a.kind === 'svg')!;
    const svg = makeSvg({ isMask: true });
    const cloned = adapter.cloneItem(svg) as SVGObject;
    expect(cloned.isMask).toBe(true);
    const offset = adapter.cloneWithOffset(svg, 2, 2, 'svg_9', undefined) as SVGObject;
    expect(offset.isMask).toBe(true);
  });
});

describe('editSVGSegments scale round-trip', () => {
  // editSVGSegments captures a scaled SVG's geometry (old → new) and round-trips
  // through undo/redo. Used by the normal scale-commit path.
  function makeMaskSvg(overrides: Partial<SVGObject> = {}): SVGObject {
    return {
      id: 'mask_1',
      color: { r: 0, g: 0, b: 0 },
      segments: [
        { kind: 'line', start: [0, 0], end: [4, 0] },
        { kind: 'line', start: [4, 0], end: [4, 4] },
        { kind: 'line', start: [4, 4], end: [0, 4] },
        { kind: 'line', start: [0, 4], end: [0, 0] },
      ],
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
      ...overrides,
    };
  }
  // The 2× scaled geometry the live state would hold after a corner drag.
  const scaledSegments: PathSegment[] = [
    { kind: 'line', start: [0, 0], end: [8, 0] },
    { kind: 'line', start: [8, 0], end: [8, 8] },
    { kind: 'line', start: [8, 8], end: [0, 8] },
    { kind: 'line', start: [0, 8], end: [0, 0] },
  ];

  test('scale-only: apply yields scaled geometry, revert restores original', () => {
    const mask = makeMaskSvg();
    const state = { ...makeState([]), svgObjects: [mask] };
    const entry: CompUndoEntry = [{
      op: 'editSVGSegments', svgId: 'mask_1',
      oldSegments: mask.segments, newSegments: scaledSegments,
      oldCellX: 0, oldCellY: 0, oldCellWidth: 4, oldCellHeight: 4,
      newCellX: 0, newCellY: 0, newCellWidth: 8, newCellHeight: 8,
    }];
    const scaled = applyCompOps(state, entry);
    expect(scaled.svgObjects[0].segments).toEqual(scaledSegments);
    expect(scaled.svgObjects[0].cellWidth).toBe(8);
    expect(scaled.svgObjects[0].cellHeight).toBe(8);

    const undone = revertCompOps(scaled, entry);
    expect(undone.svgObjects[0].segments).toEqual(mask.segments);
    expect(undone.svgObjects[0].cellWidth).toBe(4);
    expect(undone.svgObjects[0].cellHeight).toBe(4);
  });

  test('scale + preserved orientation: rotation/mirror round-trip', () => {
    const mask = makeMaskSvg({
      rotation: 90, mirrorH: true,
      identitySegments: makeMaskSvg().segments,
      identityCellX: 0, identityCellY: 0,
    });
    const state = { ...makeState([]), svgObjects: [mask] };
    const entry: CompUndoEntry = [{
      op: 'editSVGSegments', svgId: 'mask_1',
      oldSegments: mask.segments, newSegments: scaledSegments,
      oldCellX: 0, oldCellY: 0, oldCellWidth: 4, oldCellHeight: 4,
      newCellX: 0, newCellY: 0, newCellWidth: 8, newCellHeight: 8,
      preserveOrientation: true,
      oldRotation: 90, newRotation: 90,
      oldMirrorH: true, newMirrorH: true,
      oldMirrorV: undefined, newMirrorV: undefined,
      oldIdentitySegments: mask.identitySegments, newIdentitySegments: scaledSegments,
      oldIdentityCellX: 0, newIdentityCellX: 0,
      oldIdentityCellY: 0, newIdentityCellY: 0,
    }];
    const scaled = applyCompOps(state, entry);
    expect(scaled.svgObjects[0].rotation).toBe(90);
    expect(scaled.svgObjects[0].mirrorH).toBe(true);
    expect(scaled.svgObjects[0].segments).toEqual(scaledSegments);

    const undone = revertCompOps(scaled, entry);
    expect(undone.svgObjects[0].rotation).toBe(90);
    expect(undone.svgObjects[0].mirrorH).toBe(true);
    expect(undone.svgObjects[0].segments).toEqual(mask.segments);
    expect(undone.svgObjects[0].identitySegments).toEqual(mask.identitySegments);
  });

  test('scale with creationBox: both boxes round-trip', () => {
    const mask = makeMaskSvg({ creationBox: { minX: 0, minY: 0, width: 4, height: 4 } });
    const state = { ...makeState([]), svgObjects: [mask] };
    const newBox = { minX: 0, minY: 0, width: 8, height: 8 };
    const entry: CompUndoEntry = [{
      op: 'editSVGSegments', svgId: 'mask_1',
      oldSegments: mask.segments, newSegments: scaledSegments,
      oldCellX: 0, oldCellY: 0, oldCellWidth: 4, oldCellHeight: 4,
      newCellX: 0, newCellY: 0, newCellWidth: 8, newCellHeight: 8,
      oldCreationBox: mask.creationBox, newCreationBox: newBox,
    }];
    const scaled = applyCompOps(state, entry);
    expect(scaled.svgObjects[0].creationBox).toEqual(newBox);

    const undone = revertCompOps(scaled, entry);
    expect(undone.svgObjects[0].creationBox).toEqual(mask.creationBox);
  });

});

describe('mask-confirm replaceScene round-trip', () => {
  // handleSetMaskConfirm folds the whole interaction (mask + any other object
  // transforms, the grouping, and the mask flag) into ONE replaceScene op that
  // swaps the scene collections snapshot ↔ final. This mirrors that op and
  // proves transforms of NON-mask objects survive confirm and revert.
  function maskSvg(overrides: Partial<SVGObject> = {}): SVGObject {
    return {
      id: 'mask_1', color: { r: 0, g: 0, b: 0 },
      segments: [
        { kind: 'line', start: [0, 0], end: [4, 0] },
        { kind: 'line', start: [4, 0], end: [4, 4] },
        { kind: 'line', start: [4, 4], end: [0, 4] },
        { kind: 'line', start: [0, 4], end: [0, 0] },
      ],
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4, ...overrides,
    };
  }

  test('preserves a non-mask object transform AND the grouping; revert restores snapshot', () => {
    const mask = maskSvg();
    // A second loose object that the user MOVED during mask mode (cellX 20 → 25).
    const other = makeFigure({ id: 'other', cellX: 20, cellY: 20 });
    const snapshot = { ...makeState([other]), svgObjects: [mask], sceneOrder: ['other', 'mask_1'] };

    // Live state after mask mode: `other` moved, then group + setMask applied.
    const movedOther = { ...other, cellX: 25 };
    const live = { ...snapshot, figures: [movedOther] };
    let finalScene = applyCompOps(live, [{ op: 'groupFigures', figureIds: ['mask_1', 'other'], groupId: 'g1', groupName: 'Group 1', oldNames: [mask.name, other.name] }]);
    finalScene = applyCompOps(finalScene, [{ op: 'setMaskMode', svgId: 'mask_1', oldValue: undefined, newValue: true }]);

    const entry: CompUndoEntry = [{
      op: 'replaceScene',
      oldFigures: snapshot.figures, newFigures: finalScene.figures,
      oldSVGObjects: snapshot.svgObjects, newSVGObjects: finalScene.svgObjects,
      oldImages: snapshot.images ?? [], newImages: finalScene.images ?? [],
      oldGroups: snapshot.groups, newGroups: finalScene.groups,
      oldSceneOrder: snapshot.sceneOrder, newSceneOrder: finalScene.sceneOrder,
    }];

    // Apply (redo from snapshot) → final: moved object preserved, mask grouped + flagged.
    const applied = applyCompOps(snapshot, entry);
    expect(applied.figures.find(f => f.id === 'other')!.cellX).toBe(25);
    expect(applied.svgObjects.find(s => s.id === 'mask_1')!.isMask).toBe(true);
    expect(applied.svgObjects.find(s => s.id === 'mask_1')!.groupId).toBe('g1');
    expect(applied.groups.some(g => g.id === 'g1')).toBe(true);

    // Revert → exact pre-mode snapshot (object back at 20, no group, no mask).
    const reverted = revertCompOps(applied, entry);
    expect(reverted.figures.find(f => f.id === 'other')!.cellX).toBe(20);
    expect(reverted.svgObjects.find(s => s.id === 'mask_1')!.isMask).toBeUndefined();
    expect(reverted.svgObjects.find(s => s.id === 'mask_1')!.groupId).toBeUndefined();
    expect(reverted.groups).toEqual(snapshot.groups);
    expect(reverted.sceneOrder).toEqual(snapshot.sceneOrder);
  });

  test('replaceScene swaps all collections and is its own inverse', () => {
    const mask = maskSvg();
    const snapshot = { ...makeState([]), svgObjects: [mask], sceneOrder: ['mask_1'] };
    const newFig = makeFigure({ id: 'f_new', cellX: 1, cellY: 1 });
    const final = { ...snapshot, figures: [newFig], sceneOrder: ['mask_1', 'f_new'] };
    const entry: CompUndoEntry = [{
      op: 'replaceScene',
      oldFigures: snapshot.figures, newFigures: final.figures,
      oldSVGObjects: snapshot.svgObjects, newSVGObjects: final.svgObjects,
      oldImages: [], newImages: [],
      oldGroups: snapshot.groups, newGroups: final.groups,
      oldSceneOrder: snapshot.sceneOrder, newSceneOrder: final.sceneOrder,
    }];
    const applied = applyCompOps(snapshot, entry);
    expect(applied.figures).toEqual(final.figures);
    expect(applied.sceneOrder).toEqual(final.sceneOrder);
    const reverted = revertCompOps(applied, entry);
    expect(reverted.figures).toEqual(snapshot.figures);
    expect(reverted.sceneOrder).toEqual(snapshot.sceneOrder);
  });
});
