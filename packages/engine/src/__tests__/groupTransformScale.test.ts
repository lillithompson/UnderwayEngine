import {
  applyGroupTransform,
  computeSVGBbox,
  materializeGroupMembers,
  applyCompOps,
  revertCompOps,
  SCENE_ADAPTERS,
} from '../compositionOps';
import { arcRadius } from '../compositionArcMath';
import { getActiveMaskForGroup } from '../compositionMask';
import { SVGObject, PathSegment, CompositionFigure, CompositionState, CompUndoEntry, GroupNode, makeViewport } from '../types';

function makeFigure(overrides: Partial<CompositionFigure> & { id: string }): CompositionFigure {
  return {
    figureKey: 'test',
    cellX: 0,
    cellY: 0,
    resolutionX: 2,
    resolutionY: 2,
    cellWidth: 2,
    cellHeight: 2,
    rotation: 0,
    ...overrides,
  };
}

function makeState(figures: CompositionFigure[], groups: GroupNode[]): CompositionState {
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
    groups,
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

function setGroupTransform(state: CompositionState, groupId: string, t: Partial<GroupNode>): CompositionState {
  const groups = state.groups.map(g => g.id === groupId ? { ...g, ...t } : g);
  return materializeGroupMembers({ ...state, groups }, groupId);
}

describe('hierarchy-based group scale', () => {
  test('uniform 3×3 grid: scale 12→16 keeps every column / row equally spaced', () => {
    // 9 figures in a 3×3 grid; each is 4 cells. Identity bbox 12×12.
    const figs: CompositionFigure[] = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const x = col * 4, y = row * 4;
        figs.push(makeFigure({
          id: `r${row}c${col}`,
          cellX: x, cellY: y, cellWidth: 4, cellHeight: 4,
          groupId: 'g1',
          localCellX: x, localCellY: y, localCellWidth: 4, localCellHeight: 4,
        }));
      }
    }
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    const state = makeState(figs, [group]);
    // Scale to 16×16 — same as the user's failing scenario.
    const scaled = setGroupTransform(state, 'g1', { scaleX: 16/12, scaleY: 16/12 });
    // Group members by column (idLocalX) and row (idLocalY).
    const cols = [0, 4, 8].map(idX => scaled.figures.filter(f => f.localCellX === idX));
    const rows = [0, 4, 8].map(idY => scaled.figures.filter(f => f.localCellY === idY));
    // Within each column, every figure has the same world cellX.
    for (const col of cols) {
      const xs = new Set(col.map(f => f.cellX));
      expect(xs.size).toBe(1);
    }
    // Within each row, every figure has the same world cellY.
    for (const row of rows) {
      const ys = new Set(row.map(f => f.cellY));
      expect(ys.size).toBe(1);
    }
    // Column-to-column gap is identical for every adjacent pair.
    const colXs = cols.map(c => c[0].cellX);
    const colGaps = colXs.slice(1).map((x, i) => x - colXs[i]);
    expect(new Set(colGaps).size).toBe(1);
    const rowYs = rows.map(r => r[0].cellY);
    const rowGaps = rowYs.slice(1).map((y, i) => y - rowYs[i]);
    expect(new Set(rowGaps).size).toBe(1);
    // All figures rendered the same width/height (no per-member distortion).
    expect(new Set(scaled.figures.map(f => f.cellWidth)).size).toBe(1);
    expect(new Set(scaled.figures.map(f => f.cellHeight)).size).toBe(1);
  });

  test('heterogeneous group: mixed-size members preserve every relative gap exactly at any scale', () => {
    // 3 figures of width 2 followed by 2 figures of width 6, with a 1-cell
    // gap between every pair. Identity layout: 2 — gap 1 — 2 — gap 1 — 2 — gap 1 — 6 — gap 1 — 6.
    const figs: CompositionFigure[] = [
      makeFigure({ id: 'a', cellX: 0,  cellY: 0, cellWidth: 2, cellHeight: 4, groupId: 'g1', localCellX: 0,  localCellY: 0, localCellWidth: 2, localCellHeight: 4 }),
      makeFigure({ id: 'b', cellX: 3,  cellY: 0, cellWidth: 2, cellHeight: 4, groupId: 'g1', localCellX: 3,  localCellY: 0, localCellWidth: 2, localCellHeight: 4 }),
      makeFigure({ id: 'c', cellX: 6,  cellY: 0, cellWidth: 2, cellHeight: 4, groupId: 'g1', localCellX: 6,  localCellY: 0, localCellWidth: 2, localCellHeight: 4 }),
      makeFigure({ id: 'd', cellX: 9,  cellY: 0, cellWidth: 6, cellHeight: 4, groupId: 'g1', localCellX: 9,  localCellY: 0, localCellWidth: 6, localCellHeight: 4 }),
      makeFigure({ id: 'e', cellX: 16, cellY: 0, cellWidth: 6, cellHeight: 4, groupId: 'g1', localCellX: 16, localCellY: 0, localCellWidth: 6, localCellHeight: 4 }),
    ];
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    const state = makeState(figs, [group]);
    // Float-precise: the relative gap ratios are exactly preserved at any
    // float scale. Test a fractional scale that previously caused drift.
    for (const sx of [0.25, 0.5, 0.7, 1.0, 1.333, 1.5, 1.75, 2.5, 25]) {
      const scaled = setGroupTransform(state, 'g1', { scaleX: sx, scaleY: sx });
      // For each adjacent pair (a→b, b→c, c→d, d→e), the world gap
      // between them equals identity gap * scale exactly.
      const a = scaled.figures.find(f => f.id === 'a')!;
      const b = scaled.figures.find(f => f.id === 'b')!;
      const c = scaled.figures.find(f => f.id === 'c')!;
      const d = scaled.figures.find(f => f.id === 'd')!;
      const e = scaled.figures.find(f => f.id === 'e')!;
      // Identity gaps were all 1 cell.
      expect(b.cellX - (a.cellX + a.cellWidth)).toBeCloseTo(1 * sx);
      expect(c.cellX - (b.cellX + b.cellWidth)).toBeCloseTo(1 * sx);
      expect(d.cellX - (c.cellX + c.cellWidth)).toBeCloseTo(1 * sx);
      expect(e.cellX - (d.cellX + d.cellWidth)).toBeCloseTo(1 * sx);
      // All figures of original width 2 are the same scaled width.
      expect(a.cellWidth).toBeCloseTo(2 * sx);
      expect(b.cellWidth).toBeCloseTo(2 * sx);
      expect(c.cellWidth).toBeCloseTo(2 * sx);
      // All figures of original width 6 are the same scaled width.
      expect(d.cellWidth).toBeCloseTo(6 * sx);
      expect(e.cellWidth).toBeCloseTo(6 * sx);
      // Width ratio preserved: 6 / 2 = 3 exactly.
      expect(d.cellWidth / a.cellWidth).toBeCloseTo(3);
    }
  });

  test('round-trip: scale 0.25 then 25 lands at the same world coords as a direct 25× scale', () => {
    const figs: CompositionFigure[] = [
      makeFigure({ id: 'a', cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2, groupId: 'g1', localCellX: 0, localCellY: 0, localCellWidth: 2, localCellHeight: 2 }),
      makeFigure({ id: 'b', cellX: 3, cellY: 0, cellWidth: 2, cellHeight: 2, groupId: 'g1', localCellX: 3, localCellY: 0, localCellWidth: 2, localCellHeight: 2 }),
      makeFigure({ id: 'c', cellX: 6, cellY: 0, cellWidth: 2, cellHeight: 2, groupId: 'g1', localCellX: 6, localCellY: 0, localCellWidth: 2, localCellHeight: 2 }),
    ];
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    const initial = makeState(figs, [group]);
    // Scale down to 0.25, then up to 25.
    const tiny = setGroupTransform(initial, 'g1', { scaleX: 0.25, scaleY: 0.25 });
    const big  = setGroupTransform(tiny,    'g1', { scaleX: 25,   scaleY: 25 });
    // Compare to a direct 25× from initial.
    const direct = setGroupTransform(initial, 'g1', { scaleX: 25, scaleY: 25 });
    for (const id of ['a', 'b', 'c']) {
      const r = big.figures.find(f => f.id === id)!;
      const d = direct.figures.find(f => f.id === id)!;
      expect(r.cellX).toBeCloseTo(d.cellX);
      expect(r.cellY).toBeCloseTo(d.cellY);
      expect(r.cellWidth).toBeCloseTo(d.cellWidth);
      expect(r.cellHeight).toBeCloseTo(d.cellHeight);
    }
  });

  test('scaling preserves member local coords (locals never mutate)', () => {
    const figs: CompositionFigure[] = [
      makeFigure({ id: 'a', cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4, groupId: 'g1', localCellX: 0, localCellY: 0, localCellWidth: 4, localCellHeight: 4 }),
      makeFigure({ id: 'b', cellX: 5, cellY: 0, cellWidth: 4, cellHeight: 4, groupId: 'g1', localCellX: 5, localCellY: 0, localCellWidth: 4, localCellHeight: 4 }),
    ];
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    const initial = makeState(figs, [group]);
    const after = setGroupTransform(initial, 'g1', { scaleX: 3.7, scaleY: 0.6 });
    for (const f of after.figures) {
      const orig = initial.figures.find(o => o.id === f.id)!;
      expect(f.localCellX).toBe(orig.localCellX);
      expect(f.localCellY).toBe(orig.localCellY);
      expect(f.localCellWidth).toBe(orig.localCellWidth);
      expect(f.localCellHeight).toBe(orig.localCellHeight);
    }
  });

  test('svg object join round-trip preserves aspect when canvas sources from identity dims', () => {
    // Regression for the user-visible bug: a joined line+arc with a 4×2
    // identity bbox is scaled way down, then back up. The canvas's
    // aspect-source must read from `scaleIdentityDimsRef` (the frozen
    // identity bbox) rather than the rounded visible bbox — at extreme
    // scale-downs the rounded visible bbox collapses to 1×1 (or 0×0)
    // and locks aspect to 1:1, distorting the group on subsequent drags.
    const lineSegs: PathSegment[] = [{ kind: 'line', start: [0, 0], end: [4, 0] }];
    const svgLine: SVGObject = {
      id: 'L', segments: lineSegs.map(s => ({ ...s })) as PathSegment[],
      localSegments: lineSegs.map(s => ({ ...s })) as PathSegment[],
      color: { r: 255, g: 255, b: 255 },
      groupId: 'g1',
      ...computeSVGBbox(lineSegs),
      localCellX: 0, localCellY: 0, localCellWidth: 4, localCellHeight: 0,
    };
    // Quarter-circle: center (2,0), radius 2 — arms to start (4,0) and end (2,2).
    const arcSegs: PathSegment[] = [{ kind: 'arc', start: [4, 0], end: [2, 2], center: [2, 0] }];
    const svgArc: SVGObject = {
      id: 'A', segments: arcSegs.map(s => ({ ...s })) as PathSegment[],
      localSegments: arcSegs.map(s => ({ ...s })) as PathSegment[],
      color: { r: 255, g: 255, b: 255 },
      groupId: 'g1',
      ...computeSVGBbox(arcSegs),
      localCellX: 2, localCellY: 0, localCellWidth: 2, localCellHeight: 2,
    };
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    const initial: CompositionState = { ...makeState([], [group]), svgObjects: [svgLine, svgArc] };

    // Identity bbox the canvas captures into `scaleIdentityDimsRef` from
    // local geometry. Stable across all drags.
    const identityW = 4, identityH = 2;

    // Scale the joined object way down — sX = sY = 0.3 produces a visible bbox
    // of ~1.2 × 0.6, which rounds to 1×1 (canvas's `Math.round` on group
    // bounds in CompositionCanvas.tsx lines 614–617).
    const tiny = setGroupTransform(initial, 'g1', { scaleX: 0.3, scaleY: 0.3 });
    const tinySVGLine = tiny.svgObjects.find(s => s.id === 'L')!;
    const allXs = [
      ...tiny.svgObjects.flatMap(s => s.segments.flatMap(seg => seg.kind === 'arc' ? [seg.start[0], seg.end[0], seg.center[0]] : [seg.start[0], seg.end[0]])),
    ];
    const allYs = [
      ...tiny.svgObjects.flatMap(s => s.segments.flatMap(seg => seg.kind === 'arc' ? [seg.start[1], seg.end[1], seg.center[1]] : [seg.start[1], seg.end[1]])),
    ];
    const visibleW = Math.round(Math.max(...allXs)) - Math.round(Math.min(...allXs));
    const visibleH = Math.round(Math.max(...allYs)) - Math.round(Math.min(...allYs));

    // Precondition for the bug: rounded visible bbox has lost its 2:1
    // aspect (collapsed to 1:1) even though the geometry itself hasn't.
    const visibleAspect = visibleW > 0 && visibleH > 0 ? visibleW / visibleH : 1;
    expect(visibleAspect).toBe(1);
    // Sanity: line geometry is still stretched 2:1 in float space.
    const lineSeg = tinySVGLine.segments[0];
    expect(lineSeg.end[0] - lineSeg.start[0]).toBeGreaterThan(0);

    // Simulate the canvas's per-tick aspect-snap on the way back up.
    // Snap axis = W, user has dragged width back to 4 cells.
    const snappedW = identityW;

    // Buggy source (pre-fix): rounded visible bbox → 1:1 aspect.
    const buggyAspect = visibleAspect;
    const buggyH = snappedW / buggyAspect;

    // Fixed source (post-fix): scaleIdentityDimsRef → 2:1 aspect.
    const fixedAspect = identityW / identityH;
    const fixedH = snappedW / fixedAspect;

    expect(buggyAspect).not.toBe(fixedAspect);

    // Apply the canvas-emitted (snappedW, snappedH) by computing the group
    // scale the editor would derive: sX = snappedW / identityW, sY =
    // snappedH / identityH. Locals never mutate (verified above), so the
    // editor's local bbox dims equal identity dims.
    const buggyState = setGroupTransform(tiny, 'g1', {
      scaleX: snappedW / identityW,
      scaleY: buggyH / identityH,
    });
    const fixedState = setGroupTransform(tiny, 'g1', {
      scaleX: snappedW / identityW,
      scaleY: fixedH / identityH,
    });

    // Helper to read the world bbox of the joined object.
    const worldBbox = (s: CompositionState) => {
      const xs = [
        ...s.svgObjects.flatMap(obj => obj.segments.flatMap(seg => seg.kind === 'arc' ? [seg.start[0], seg.end[0], seg.center[0]] : [seg.start[0], seg.end[0]])),
      ];
      const ys = [
        ...s.svgObjects.flatMap(obj => obj.segments.flatMap(seg => seg.kind === 'arc' ? [seg.start[1], seg.end[1], seg.center[1]] : [seg.start[1], seg.end[1]])),
      ];
      return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    };

    // Buggy: round-trip lands square (4×4) instead of 4×2.
    const buggyBox = worldBbox(buggyState);
    expect(buggyBox.width).toBeCloseTo(identityW);
    expect(buggyBox.height).toBeCloseTo(identityW); // distorted — should be identityH

    // Fixed: round-trip lands at the original 4×2 aspect.
    const fixedBox = worldBbox(fixedState);
    expect(fixedBox.width).toBeCloseTo(identityW);
    expect(fixedBox.height).toBeCloseTo(identityH);

    // Arc round-ness invariant survives the round-trip via the fixed path:
    // dist(start, center) == dist(end, center) (sX == sY ⇒ uniform scale).
    const fixedArc = fixedState.svgObjects.find(s => s.id === 'A')!.segments[0];
    if (fixedArc.kind === 'arc') {
      const r1 = Math.hypot(fixedArc.start[0] - fixedArc.center[0], fixedArc.start[1] - fixedArc.center[1]);
      const r2 = Math.hypot(fixedArc.end[0]   - fixedArc.center[0], fixedArc.end[1]   - fixedArc.center[1]);
      expect(Math.abs(r1 - r2)).toBeLessThan(1e-9);
    }
  });
});

describe('transformGroup undo op', () => {
  test('apply replaces transform and re-materializes; revert restores both', () => {
    const figs: CompositionFigure[] = [
      makeFigure({ id: 'a', cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2, groupId: 'g1', localCellX: 0, localCellY: 0, localCellWidth: 2, localCellHeight: 2 }),
      makeFigure({ id: 'b', cellX: 3, cellY: 0, cellWidth: 2, cellHeight: 2, groupId: 'g1', localCellX: 3, localCellY: 0, localCellWidth: 2, localCellHeight: 2 }),
    ];
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    const state = makeState(figs, [group]);
    const entry: CompUndoEntry = [{
      op: 'transformGroup', groupId: 'g1',
      oldTranslateX: 0, oldTranslateY: 0, oldScaleX: 1, oldScaleY: 1,
      oldRotation: 0, oldMirrorH: false, oldMirrorV: false,
      newTranslateX: 5, newTranslateY: -3, newScaleX: 2, newScaleY: 1.5,
      newRotation: 0, newMirrorH: false, newMirrorV: false,
    }];
    const after = applyCompOps(state, entry);
    const groupAfter = after.groups.find(g => g.id === 'g1')!;
    expect(groupAfter).toMatchObject({ translateX: 5, translateY: -3, scaleX: 2, scaleY: 1.5 });
    // Member 'a' world: tx + 0*sx = 5; ty + 0*sy = -3; w = 4; h = 3.
    const aAfter = after.figures.find(f => f.id === 'a')!;
    expect(aAfter.cellX).toBe(5);
    expect(aAfter.cellY).toBe(-3);
    expect(aAfter.cellWidth).toBe(4);
    expect(aAfter.cellHeight).toBe(3);
    // Member 'b' world: 5 + 3*2 = 11.
    const bAfter = after.figures.find(f => f.id === 'b')!;
    expect(bAfter.cellX).toBe(11);
    // Revert restores everything.
    const reverted = revertCompOps(after, entry);
    const groupRev = reverted.groups.find(g => g.id === 'g1')!;
    expect(groupRev).toMatchObject({ translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 });
    expect(reverted.figures.find(f => f.id === 'a')!.cellX).toBe(0);
    expect(reverted.figures.find(f => f.id === 'b')!.cellX).toBe(3);
  });
});

describe('release-snap to scale 1 leaves locals exact', () => {
  test('snapping a 1.07× scale to 1.0× recovers the identity layout exactly', () => {
    const figs: CompositionFigure[] = [
      makeFigure({ id: 'a', cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2, groupId: 'g1', localCellX: 0, localCellY: 0, localCellWidth: 2, localCellHeight: 2 }),
      makeFigure({ id: 'b', cellX: 3, cellY: 0, cellWidth: 2, cellHeight: 2, groupId: 'g1', localCellX: 3, localCellY: 0, localCellWidth: 2, localCellHeight: 2 }),
    ];
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    let state = makeState(figs, [group]);
    // User scales to 1.07 (within the 15% snap tolerance).
    state = setGroupTransform(state, 'g1', { scaleX: 1.07, scaleY: 1.07 });
    // Simulating the editor's release-snap.
    state = setGroupTransform(state, 'g1', { scaleX: 1, scaleY: 1 });
    // World coords now equal local coords exactly.
    for (const f of state.figures) {
      expect(f.cellX).toBe(f.localCellX);
      expect(f.cellY).toBe(f.localCellY);
      expect(f.cellWidth).toBe(f.localCellWidth);
      expect(f.cellHeight).toBe(f.localCellHeight);
    }
  });

  test('snap preserves visible TL when lb.minX is non-zero (BR drag of negative-coord group)', () => {
    // Members at world (-24, 0), (-20, 0), (-16, 0) — like ScalingTest.tile.
    // After locals seed at create, group.translate=0, group.scale=1.
    // User drags to scale=0.917 (within 15% snap tolerance). Per the
    // editor's gesture math, translate gets set to a value that maintains
    // the BR-drag anchor TL at -24 during the scaled state. When the snap
    // fires, both scale → 1 AND translate must adjust so visible TL stays
    // at -24 (not drift to -22 or somewhere else).
    const figs: CompositionFigure[] = [
      makeFigure({ id: 'a', cellX: -24, cellY: 0, cellWidth: 4, cellHeight: 4, groupId: 'g1', localCellX: -24, localCellY: 0, localCellWidth: 4, localCellHeight: 4 }),
      makeFigure({ id: 'b', cellX: -20, cellY: 0, cellWidth: 4, cellHeight: 4, groupId: 'g1', localCellX: -20, localCellY: 0, localCellWidth: 4, localCellHeight: 4 }),
      makeFigure({ id: 'c', cellX: -16, cellY: 0, cellWidth: 4, cellHeight: 4, groupId: 'g1', localCellX: -16, localCellY: 0, localCellWidth: 4, localCellHeight: 4 }),
    ];
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    let state = makeState(figs, [group]);
    // Editor's per-tick math for BR drag with anchor at (-24, 0):
    //   sX = newW/lb.W; tx = newCellX - lb.minX*sX
    // For sX = 0.917 from lb.W=12 (newW=11) and lb.minX=-24:
    //   tx = -24 - (-24)*0.917 = -24 + 22 = -2
    state = setGroupTransform(state, 'g1', { translateX: -24 - (-24) * 0.917, translateY: 0, scaleX: 0.917, scaleY: 0.917 });
    // Sanity: visible TL is preserved by the per-tick math.
    const aMid = state.figures.find(f => f.id === 'a')!;
    expect(aMid.cellX).toBeCloseTo(-24);
    // Snap fires: editor adjusts translate so visible TL stays at -24
    // when scale → 1. The formula is: newTranslate = oldTranslate +
    // lb.minX * (oldScale - 1) = -2 + (-24) * (0.917 - 1) = 0.
    const cur = state.groups[0];
    const lbMinX = -24;
    const newTx = cur.translateX + lbMinX * (cur.scaleX - 1);
    state = setGroupTransform(state, 'g1', { translateX: newTx, translateY: 0, scaleX: 1, scaleY: 1 });
    const aAfter = state.figures.find(f => f.id === 'a')!;
    const bAfter = state.figures.find(f => f.id === 'b')!;
    const cAfter = state.figures.find(f => f.id === 'c')!;
    expect(aAfter.cellX).toBeCloseTo(-24);
    expect(bAfter.cellX).toBeCloseTo(-20);
    expect(cAfter.cellX).toBeCloseTo(-16);
  });
});

describe('group move via GroupNode.translate', () => {
  test('translate update shifts every member identically — no per-member rounding', () => {
    // Three members at different starting positions and sizes inside a
    // group. Update group.translate by (10, -3); every member's world
    // position must shift by exactly (10, -3); nothing else changes.
    const figs: CompositionFigure[] = [
      makeFigure({ id: 'a', cellX: 0,  cellY: 0,  cellWidth: 4, cellHeight: 4,
        groupId: 'g1', localCellX: 0,  localCellY: 0,  localCellWidth: 4, localCellHeight: 4 }),
      makeFigure({ id: 'b', cellX: 5,  cellY: 0,  cellWidth: 6, cellHeight: 4,
        groupId: 'g1', localCellX: 5,  localCellY: 0,  localCellWidth: 6, localCellHeight: 4 }),
      makeFigure({ id: 'c', cellX: 0,  cellY: 5,  cellWidth: 3, cellHeight: 3,
        groupId: 'g1', localCellX: 0,  localCellY: 5,  localCellWidth: 3, localCellHeight: 3 }),
    ];
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    const initial = makeState(figs, [group]);
    const moved = setGroupTransform(initial, 'g1', { translateX: 10, translateY: -3 });
    for (const idx of [0, 1, 2]) {
      const before = initial.figures[idx];
      const after = moved.figures[idx];
      expect(after.cellX).toBe(before.cellX + 10);
      expect(after.cellY).toBe(before.cellY - 3);
      expect(after.cellWidth).toBe(before.cellWidth);
      expect(after.cellHeight).toBe(before.cellHeight);
      // Locals never change on a translate update.
      expect(after.localCellX).toBe(before.localCellX);
      expect(after.localCellY).toBe(before.localCellY);
    }
  });

  test('repeated translate updates accumulate exactly — no drift over 1000 moves', () => {
    const figs: CompositionFigure[] = [
      makeFigure({ id: 'a', cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
        groupId: 'g1', localCellX: 0, localCellY: 0, localCellWidth: 4, localCellHeight: 4 }),
    ];
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    let state = makeState(figs, [group]);
    // Apply 1000 micro-moves of (0.7, -0.3). Total = (700, -300).
    for (let i = 0; i < 1000; i++) {
      const cur = state.groups[0];
      state = setGroupTransform(state, 'g1', { translateX: cur.translateX + 0.7, translateY: cur.translateY - 0.3 });
    }
    const finalFig = state.figures[0];
    // Float arithmetic accumulates a tiny ULP-scale error over 1000 adds;
    // the drift is far below half a cell.
    expect(finalFig.cellX).toBeCloseTo(700, 6);
    expect(finalFig.cellY).toBeCloseTo(-300, 6);
  });

  test('translate combines with non-trivial scale cleanly', () => {
    const figs: CompositionFigure[] = [
      makeFigure({ id: 'a', cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2,
        groupId: 'g1', localCellX: 0, localCellY: 0, localCellWidth: 2, localCellHeight: 2 }),
    ];
    // Group already at scale 1.5, rotation 0. Translate by (5, 5).
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1.5, scaleY: 1.5, rotation: 0, mirrorH: false, mirrorV: false };
    let state = makeState(figs, [group]);
    state = materializeGroupMembers(state, 'g1');
    const beforeTranslate = state.figures[0];
    state = setGroupTransform(state, 'g1', { translateX: 5, translateY: 5 });
    const after = state.figures[0];
    expect(after.cellX).toBeCloseTo(beforeTranslate.cellX + 5);
    expect(after.cellY).toBeCloseTo(beforeTranslate.cellY + 5);
    expect(after.cellWidth).toBe(beforeTranslate.cellWidth);
    expect(after.cellHeight).toBe(beforeTranslate.cellHeight);
  });

  test('transformGroup undo op for a group move restores both translate and member world coords', () => {
    const figs: CompositionFigure[] = [
      makeFigure({ id: 'a', cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2,
        groupId: 'g1', localCellX: 0, localCellY: 0, localCellWidth: 2, localCellHeight: 2 }),
    ];
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    const state = makeState(figs, [group]);
    const entry: CompUndoEntry = [{
      op: 'transformGroup', groupId: 'g1',
      oldTranslateX: 0, oldTranslateY: 0, oldScaleX: 1, oldScaleY: 1,
      oldRotation: 0, oldMirrorH: false, oldMirrorV: false,
      newTranslateX: 7, newTranslateY: -4, newScaleX: 1, newScaleY: 1,
      newRotation: 0, newMirrorH: false, newMirrorV: false,
    }];
    const after = applyCompOps(state, entry);
    expect(after.groups[0]).toMatchObject({ translateX: 7, translateY: -4 });
    expect(after.figures[0]).toMatchObject({ cellX: 7, cellY: -4 });
    const reverted = revertCompOps(after, entry);
    expect(reverted.groups[0]).toMatchObject({ translateX: 0, translateY: 0 });
    expect(reverted.figures[0]).toMatchObject({ cellX: 0, cellY: 0 });
  });
});

describe('tile-mode members scale with the group transform', () => {
  test('uniform group scale doubles tile dim', () => {
    const figs: CompositionFigure[] = [
      makeFigure({
        id: 'a', cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8,
        groupId: 'g1',
        localCellX: 0, localCellY: 0, localCellWidth: 8, localCellHeight: 8,
        tileMode: 'repeat',
        tileWidthL0: 2, tileHeightL0: 2,
        localTileWidthL0: 2, localTileHeightL0: 2,
      }),
    ];
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    const state = makeState(figs, [group]);
    const after = setGroupTransform(state, 'g1', { scaleX: 2, scaleY: 2 });
    const fig = after.figures[0];
    expect(fig.cellWidth).toBe(16);
    expect(fig.tileWidthL0).toBe(4);
    expect(fig.tileHeightL0).toBe(4);
  });

  test('non-uniform scale scales tile dim independently per axis', () => {
    const figs: CompositionFigure[] = [
      makeFigure({
        id: 'a', cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 4,
        groupId: 'g1',
        localCellX: 0, localCellY: 0, localCellWidth: 8, localCellHeight: 4,
        tileMode: 'repeat',
        tileWidthL0: 2, tileHeightL0: 1,
        localTileWidthL0: 2, localTileHeightL0: 1,
      }),
    ];
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    const state = makeState(figs, [group]);
    const after = setGroupTransform(state, 'g1', { scaleX: 1.5, scaleY: 3 });
    const fig = after.figures[0];
    expect(fig.tileWidthL0).toBeCloseTo(3);
    expect(fig.tileHeightL0).toBeCloseTo(3);
  });

  test('scale back to 1.0× restores original tile dim', () => {
    const figs: CompositionFigure[] = [
      makeFigure({
        id: 'a', cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8,
        groupId: 'g1',
        localCellX: 0, localCellY: 0, localCellWidth: 8, localCellHeight: 8,
        tileMode: 'repeat',
        tileWidthL0: 2, tileHeightL0: 2,
        localTileWidthL0: 2, localTileHeightL0: 2,
      }),
    ];
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    let state = makeState(figs, [group]);
    state = setGroupTransform(state, 'g1', { scaleX: 2.5, scaleY: 2.5 });
    state = setGroupTransform(state, 'g1', { scaleX: 1, scaleY: 1 });
    const fig = state.figures[0];
    expect(fig.tileWidthL0).toBe(2);
    expect(fig.tileHeightL0).toBe(2);
  });

  test('tile-grid offset scales with the group so the pattern stays locked to the figure', () => {
    // Mirrors the repeatBug.tile case: a tile-mode figure with a non-zero
    // tileOffsetXL0 inside a group whose scale changes. Repetition count
    // must stay constant (tile dim scales) AND the offset-in-tiles must
    // stay constant (offset scales by the same factor), so the pattern
    // appears locked to the figure's local bounds as the group resizes.
    const figs: CompositionFigure[] = [
      makeFigure({
        id: 'a', cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8,
        groupId: 'g1',
        localCellX: 0, localCellY: 0, localCellWidth: 8, localCellHeight: 8,
        tileMode: 'repeat',
        tileWidthL0: 2, tileHeightL0: 2,
        tileOffsetXL0: 3, tileOffsetYL0: -1,
        localTileWidthL0: 2, localTileHeightL0: 2,
        localTileOffsetXL0: 3, localTileOffsetYL0: -1,
      }),
    ];
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    const state = makeState(figs, [group]);
    const after = setGroupTransform(state, 'g1', { scaleX: 2, scaleY: 2 });
    const fig = after.figures[0];
    expect(fig.cellWidth).toBe(16);
    expect(fig.tileWidthL0).toBe(4);
    expect(fig.tileHeightL0).toBe(4);
    expect(fig.tileOffsetXL0).toBe(6);
    expect(fig.tileOffsetYL0).toBe(-2);
    // Offset-in-tiles invariant: world offset / world tile dim equals
    // local offset / local tile dim, so the pattern phase is unchanged
    // relative to the figure.
    expect((fig.tileOffsetXL0 ?? 0) / (fig.tileWidthL0 ?? 1)).toBeCloseTo(3 / 2);
    expect((fig.tileOffsetYL0 ?? 0) / (fig.tileHeightL0 ?? 1)).toBeCloseTo(-1 / 2);
  });
});

describe('arc members in group scale uniformly', () => {
  // A quarter-circle arc with center at (0, 0), going from (1, 0) to (0, 1).
  // Local radius = 1.
  function makeArcQuarter(id: string, groupId: string): SVGObject {
    const fresh = (): PathSegment => ({ kind: 'arc', start: [1, 0], end: [0, 1], center: [0, 0] });
    return {
      id,
      segments: [fresh()],
      localSegments: [fresh()],
      color: { r: 0, g: 0, b: 0 },
      groupId,
      // bbox of the quarter-arc {start:[1,0], end:[0,1], center:[0,0]} is
      // x:[0,1], y:[0,1] (center counts in the AABB).
      cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1,
      localCellX: 0, localCellY: 0, localCellWidth: 1, localCellHeight: 1,
    };
  }

  function stateWith(figs: CompositionFigure[], svgObjects: SVGObject[], group: GroupNode): CompositionState {
    const s: CompositionState = {
      id: 'test', name: 'test',
      figures: figs, svgObjects,
      lineDraft: null, arcDraft: null,
      editingLineId: null, selectedVertexIndex: null,
      lastChosenColor: { r: 255, g: 255, b: 255 },
      customColors: [],
      groups: [group],
      sceneOrder: [...figs.map((f) => f.id), ...svgObjects.map((s) => s.id)],
      gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      viewport: makeViewport(800, 600),
      selectedFigureIds: new Set(),
      activeFigureKey: null,
      compTool: 'select',
      createRegion: null,
      renderGeneration: 0,
    };
    return s;
  }

  test('uniform 2× scale doubles arc radius (radius invariant preserved)', () => {
    // Group contains a 2×2 figure and a quarter-circle arc; uniform scale.
    const figs: CompositionFigure[] = [
      {
        figureKey: 'f', id: 'f1', cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2,
        resolutionX: 2, resolutionY: 2, rotation: 0,
        groupId: 'g1',
        localCellX: 0, localCellY: 0, localCellWidth: 2, localCellHeight: 2,
      },
    ];
    const svgObjects = [makeArcQuarter('a1', 'g1')];
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 2, scaleY: 2, rotation: 0, mirrorH: false, mirrorV: false };
    const state = stateWith(figs, svgObjects, group);
    const after = materializeGroupMembers(state, 'g1');

    const svgObj = after.svgObjects.find(s => s.id === 'a1')!;
    const seg = svgObj.segments[0];
    expect(seg.kind).toBe('arc');
    if (seg.kind !== 'arc') throw new Error('expected arc segment');
    // World points: scale 2, no translate. (1,0)->(2,0); (0,1)->(0,2); center (0,0).
    expect(seg.start).toEqual([2, 0]);
    expect(seg.end).toEqual([0, 2]);
    expect(seg.center).toEqual([0, 0]);
    // Radius doubled, and dist(start, center) === dist(end, center).
    expect(arcRadius(seg)).toBeCloseTo(2);
    const distEnd = Math.hypot(seg.end[0] - seg.center[0], seg.end[1] - seg.center[1]);
    expect(distEnd).toBeCloseTo(arcRadius(seg));
  });

  test('arc-only group scales (no longer no-ops without figures)', () => {
    // Group contains only an arc. Pre-fix the editor's group bbox loop
    // skipped this case because it iterated only s.figures, leaving
    // lb.width <= 0 → silent no-op. The reducer side has always handled
    // arc-only groups correctly; this regression test pins the behavior.
    const svgObjects = [makeArcQuarter('a1', 'g1')];
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 5, translateY: -2, scaleX: 3, scaleY: 3, rotation: 0, mirrorH: false, mirrorV: false };
    const state = stateWith([], svgObjects, group);
    const after = materializeGroupMembers(state, 'g1');

    const svgObj = after.svgObjects.find(s => s.id === 'a1')!;
    const seg = svgObj.segments[0];
    if (seg.kind !== 'arc') throw new Error('expected arc segment');
    // (1, 0) -> (5 + 1*3, -2 + 0*3) = (8, -2)
    expect(seg.start).toEqual([8, -2]);
    expect(seg.end).toEqual([5, 1]);
    expect(seg.center).toEqual([5, -2]);
    // Radius preserved (no distortion).
    const distStart = Math.hypot(seg.start[0] - seg.center[0], seg.start[1] - seg.center[1]);
    const distEnd = Math.hypot(seg.end[0] - seg.center[0], seg.end[1] - seg.center[1]);
    expect(distStart).toBeCloseTo(distEnd);
    expect(distStart).toBeCloseTo(3);
  });

  test('local segments never mutate during group transform', () => {
    const svgObjects = [makeArcQuarter('a1', 'g1')];
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    let state = stateWith([], svgObjects, group);
    const before = state.svgObjects[0].localSegments;
    state = materializeGroupMembers({
      ...state,
      groups: [{ ...group, scaleX: 7.3, scaleY: 7.3, translateX: 11, translateY: -4 }],
    }, 'g1');
    expect(state.svgObjects[0].localSegments).toEqual(before);
  });
});

describe('ungroup after group scale clears stale fields', () => {
  function makeSVGLineState(svgObj: SVGObject, group: GroupNode): CompositionState {
    return {
      id: 'test', name: 'test',
      figures: [], svgObjects: [svgObj],
      lineDraft: null, arcDraft: null,
      editingLineId: null, selectedVertexIndex: null,
      lastChosenColor: { r: 255, g: 255, b: 255 },
      customColors: [],
      groups: [group],
      sceneOrder: [svgObj.id],
      gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      viewport: makeViewport(800, 600),
      selectedFigureIds: new Set(),
      activeFigureKey: null,
      compTool: 'select',
      createRegion: null,
      renderGeneration: 0,
    };
  }

  test('creationBox is derived from world segments on ungroup for H/V lines', () => {
    // A horizontal line: segments at y=1 (after 2× scale from y=0.5).
    // The creation box should be one grid step tall, centered on the line.
    const svgObj: SVGObject = {
      id: 'l1',
      segments: [{ kind: 'line', start: [0, 0.5], end: [4, 0.5] }],
      localSegments: [{ kind: 'line', start: [0, 0.5], end: [4, 0.5] }],
      color: { r: 0, g: 0, b: 0 },
      groupId: 'g1',
      cellX: 0, cellY: 0.5, cellWidth: 4, cellHeight: 0,
      localCellX: 0, localCellY: 0.5, localCellWidth: 4, localCellHeight: 0,
      creationBox: { minX: 0, minY: 0, width: 4, height: 1 },
      lineDirection: 'horizontal',
    };
    const group: GroupNode = {
      id: 'g1', name: 'G',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const state = makeSVGLineState(svgObj, group);
    // Scale group 2×.
    const scaled = setGroupTransform(state, 'g1', { scaleX: 2, scaleY: 2 });

    // Ungroup.
    const ungrouped = applyCompOps(scaled, [{
      op: 'ungroupFigures', figureIds: ['l1'], groupId: 'g1', groupName: 'G',
    }]);
    const result = ungrouped.svgObjects[0];
    expect(result.groupId).toBeUndefined();
    // Width spans the materialized segments (8). Height = one grid step
    // (gridLevel 0 → step 1), centered on the line at y=1.
    expect(result.creationBox!.width).toBe(8);
    expect(result.creationBox!.height).toBe(1);
    expect(result.creationBox!.minY).toBe(0.5); // centered on y=1: 1 - 0.5 = 0.5
    expect(result.identitySegments).toBeUndefined();
    expect(result.rotation).toBeUndefined();
  });

  test('creationBox is unchanged when group transform is identity', () => {
    // Group then immediately ungroup — creationBox must not change.
    const svgObj: SVGObject = {
      id: 'l1',
      segments: [{ kind: 'line', start: [0, 0.5], end: [4, 0.5] }],
      localSegments: [{ kind: 'line', start: [0, 0.5], end: [4, 0.5] }],
      color: { r: 0, g: 0, b: 0 },
      groupId: 'g1',
      cellX: 0, cellY: 0.5, cellWidth: 4, cellHeight: 0,
      localCellX: 0, localCellY: 0.5, localCellWidth: 4, localCellHeight: 0,
      creationBox: { minX: 0, minY: 0, width: 4, height: 1 },
      lineDirection: 'horizontal',
    };
    const group: GroupNode = {
      id: 'g1', name: 'G',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const state = makeSVGLineState(svgObj, group);
    const ungrouped = applyCompOps(state, [{
      op: 'ungroupFigures', figureIds: ['l1'], groupId: 'g1', groupName: 'G',
    }]);
    const result = ungrouped.svgObjects[0];
    // Identity transform: creationBox stays the same.
    expect(result.creationBox).toEqual({ minX: 0, minY: 0, width: 4, height: 1 });
  });

  test('horizontal line after Y-scale gets one-step-tall creationBox centered on line', () => {
    // 2× Y-scale: local line at y=0.5 → world line at y=1.
    // The creationBox should be one grid step tall, centered on y=1.
    const svgObj: SVGObject = {
      id: 'l1',
      segments: [{ kind: 'line', start: [0, 0.5], end: [4, 0.5] }],
      localSegments: [{ kind: 'line', start: [0, 0.5], end: [4, 0.5] }],
      color: { r: 0, g: 0, b: 0 },
      groupId: 'g1',
      cellX: 0, cellY: 0.5, cellWidth: 4, cellHeight: 0,
      localCellX: 0, localCellY: 0.5, localCellWidth: 4, localCellHeight: 0,
      creationBox: { minX: 0, minY: 0, width: 4, height: 1 },
      lineDirection: 'horizontal',
    };
    const group: GroupNode = {
      id: 'g1', name: 'G',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const state = makeSVGLineState(svgObj, group);
    const scaled = setGroupTransform(state, 'g1', { scaleX: 1, scaleY: 2 });
    const ungrouped = applyCompOps(scaled, [{
      op: 'ungroupFigures', figureIds: ['l1'], groupId: 'g1', groupName: 'G',
    }]);
    const result = ungrouped.svgObjects[0];
    // Width spans the full materialized segment extent, height is one
    // grid step (step=1 at gridLevel 0), centered on the line.
    expect(result.creationBox!.width).toBe(4);
    expect(result.creationBox!.height).toBe(1);
    expect(result.creationBox!.minY).toBe(0.5); // centered on y=1
  });

  test('horizontal line after 1.5× Y-scale still gets one-step-tall creationBox', () => {
    const svgObj: SVGObject = {
      id: 'l1',
      segments: [{ kind: 'line', start: [0, 0.5], end: [4, 0.5] }],
      localSegments: [{ kind: 'line', start: [0, 0.5], end: [4, 0.5] }],
      color: { r: 0, g: 0, b: 0 },
      groupId: 'g1',
      cellX: 0, cellY: 0.5, cellWidth: 4, cellHeight: 0,
      localCellX: 0, localCellY: 0.5, localCellWidth: 4, localCellHeight: 0,
      creationBox: { minX: 0, minY: 0, width: 4, height: 1 },
      lineDirection: 'horizontal',
    };
    const group: GroupNode = {
      id: 'g1', name: 'G',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const state = makeSVGLineState(svgObj, group);
    const scaled = setGroupTransform(state, 'g1', { scaleX: 1, scaleY: 1.5 });
    const ungrouped = applyCompOps(scaled, [{
      op: 'ungroupFigures', figureIds: ['l1'], groupId: 'g1', groupName: 'G',
    }]);
    const result = ungrouped.svgObjects[0];
    // One grid step tall, centered on the line at y=0.75.
    expect(result.creationBox!.width).toBe(4);
    expect(result.creationBox!.height).toBe(1);
    expect(result.creationBox!.minY).toBe(0.25);
  });

  test('vertical line after X-scale gets one-step-wide creationBox centered on line', () => {
    const svgObj: SVGObject = {
      id: 'l1',
      segments: [{ kind: 'line', start: [0.5, 0], end: [0.5, 4] }],
      localSegments: [{ kind: 'line', start: [0.5, 0], end: [0.5, 4] }],
      color: { r: 0, g: 0, b: 0 },
      groupId: 'g1',
      cellX: 0.5, cellY: 0, cellWidth: 0, cellHeight: 4,
      localCellX: 0.5, localCellY: 0, localCellWidth: 0, localCellHeight: 4,
      creationBox: { minX: 0, minY: 0, width: 1, height: 4 },
      lineDirection: 'vertical',
    };
    const group: GroupNode = {
      id: 'g1', name: 'G',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const state = makeSVGLineState(svgObj, group);
    const scaled = setGroupTransform(state, 'g1', { scaleX: 2, scaleY: 1 });
    const ungrouped = applyCompOps(scaled, [{
      op: 'ungroupFigures', figureIds: ['l1'], groupId: 'g1', groupName: 'G',
    }]);
    const result = ungrouped.svgObjects[0];
    // One grid step wide, centered on the line at x=1.
    expect(result.creationBox!.height).toBe(4);
    expect(result.creationBox!.width).toBe(1);
    expect(result.creationBox!.minX).toBe(0.5); // centered on x=1
  });

  test('vertical line after 1.5× X-scale still gets one-step-wide creationBox', () => {
    const svgObj: SVGObject = {
      id: 'l1',
      segments: [{ kind: 'line', start: [0.5, 0], end: [0.5, 4] }],
      localSegments: [{ kind: 'line', start: [0.5, 0], end: [0.5, 4] }],
      color: { r: 0, g: 0, b: 0 },
      groupId: 'g1',
      cellX: 0.5, cellY: 0, cellWidth: 0, cellHeight: 4,
      localCellX: 0.5, localCellY: 0, localCellWidth: 0, localCellHeight: 4,
      creationBox: { minX: 0, minY: 0, width: 1, height: 4 },
      lineDirection: 'vertical',
    };
    const group: GroupNode = {
      id: 'g1', name: 'G',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const state = makeSVGLineState(svgObj, group);
    const scaled = setGroupTransform(state, 'g1', { scaleX: 1.5, scaleY: 1 });
    const ungrouped = applyCompOps(scaled, [{
      op: 'ungroupFigures', figureIds: ['l1'], groupId: 'g1', groupName: 'G',
    }]);
    const result = ungrouped.svgObjects[0];
    // One grid step wide, centered on the line at x=0.75.
    expect(result.creationBox!.height).toBe(4);
    expect(result.creationBox!.width).toBe(1);
    expect(result.creationBox!.minX).toBe(0.25);
  });

  test('svg objects without creationBox remain without one after ungroup', () => {
    const svgObj: SVGObject = {
      id: 'l1',
      segments: [{ kind: 'line', start: [0, 0], end: [3, 4] }, { kind: 'line', start: [3, 4], end: [6, 0] }],
      localSegments: [{ kind: 'line', start: [0, 0], end: [3, 4] }, { kind: 'line', start: [3, 4], end: [6, 0] }],
      color: { r: 0, g: 0, b: 0 },
      groupId: 'g1',
      cellX: 0, cellY: 0, cellWidth: 6, cellHeight: 4,
      localCellX: 0, localCellY: 0, localCellWidth: 6, localCellHeight: 4,
    };
    const group: GroupNode = {
      id: 'g1', name: 'G',
      translateX: 0, translateY: 0, scaleX: 2, scaleY: 2,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const state = makeSVGLineState(svgObj, group);
    const scaled = materializeGroupMembers(state, 'g1');
    const ungrouped = applyCompOps(scaled, [{
      op: 'ungroupFigures', figureIds: ['l1'], groupId: 'g1', groupName: 'G',
    }]);
    expect(ungrouped.svgObjects[0].creationBox).toBeUndefined();
  });

  test('identitySegments on svg objects is cleared after ungroup', () => {
    const fresh = (): PathSegment => ({ kind: 'arc', start: [1, 0], end: [0, 1], center: [0, 0] });
    const svgObj: SVGObject = {
      id: 'a1',
      segments: [fresh()],
      localSegments: [fresh()],
      color: { r: 0, g: 0, b: 0 },
      groupId: 'g1',
      cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1,
      localCellX: 0, localCellY: 0, localCellWidth: 1, localCellHeight: 1,
      identitySegments: [fresh()],
      rotation: 90,
    };
    const group: GroupNode = {
      id: 'g1', name: 'G',
      translateX: 0, translateY: 0, scaleX: 2, scaleY: 2,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const state: CompositionState = {
      id: 'test', name: 'test',
      figures: [], svgObjects: [svgObj],
      lineDraft: null, arcDraft: null,
      editingLineId: null, selectedVertexIndex: null,
      lastChosenColor: { r: 255, g: 255, b: 255 },
      customColors: [],
      groups: [group],
      sceneOrder: [svgObj.id],
      gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      viewport: makeViewport(800, 600),
      selectedFigureIds: new Set(),
      activeFigureKey: null,
      compTool: 'select',
      createRegion: null,
      renderGeneration: 0,
    };
    const scaled = materializeGroupMembers(state, 'g1');
    const ungrouped = applyCompOps(scaled, [{
      op: 'ungroupFigures', figureIds: ['a1'], groupId: 'g1', groupName: 'G',
    }]);
    const result = ungrouped.svgObjects[0];
    expect(result.groupId).toBeUndefined();
    expect(result.identitySegments).toBeUndefined();
    expect(result.rotation).toBeUndefined();
    expect(result.mirrorH).toBeUndefined();
    expect(result.mirrorV).toBeUndefined();
  });

  test('horizontal line in rotated group gets minimum-width creationBox on ungroup', () => {
    // A horizontal line in a group with rotation=270. After rotation,
    // the line is visually vertical so width becomes the thin axis.
    // The creationBox must have at least one grid step on both axes.
    const svgObj: SVGObject = {
      id: 'l1',
      segments: [{ kind: 'line', start: [0, 0.5], end: [4, 0.5] }],
      localSegments: [{ kind: 'line', start: [0, 0.5], end: [4, 0.5] }],
      color: { r: 0, g: 0, b: 0 },
      groupId: 'g1',
      cellX: 0, cellY: 0.5, cellWidth: 4, cellHeight: 0,
      localCellX: 0, localCellY: 0.5, localCellWidth: 4, localCellHeight: 0,
      creationBox: { minX: 0, minY: 0, width: 4, height: 1 },
      lineDirection: 'horizontal',
    };
    const group: GroupNode = {
      id: 'g1', name: 'G',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 270, mirrorH: false, mirrorV: false,
    };
    const state = makeSVGLineState(svgObj, group);
    const materialized = materializeGroupMembers(state, 'g1');
    const ungrouped = applyCompOps(materialized, [{
      op: 'ungroupFigures', figureIds: ['l1'], groupId: 'g1', groupName: 'G',
    }]);
    const result = ungrouped.svgObjects[0];
    expect(result.creationBox).toBeDefined();
    // After rotation, the original height (1) is now the width.
    // The original width (4) is now the height.
    // Both axes must be at least one grid step (step = 1 at gridLevel 0).
    expect(result.creationBox!.width).toBeGreaterThanOrEqual(1);
    expect(result.creationBox!.height).toBeGreaterThanOrEqual(1);
    // After 270° rotation the horizontal line is visually vertical.
    expect(result.lineDirection).toBe('vertical');
  });

  test('lineDirection updated to horizontal when vertical line is in 90°-rotated group', () => {
    const svgObj: SVGObject = {
      id: 'l1',
      segments: [{ kind: 'line', start: [0.5, 0], end: [0.5, 4] }],
      localSegments: [{ kind: 'line', start: [0.5, 0], end: [0.5, 4] }],
      color: { r: 0, g: 0, b: 0 },
      groupId: 'g1',
      cellX: 0.5, cellY: 0, cellWidth: 0, cellHeight: 4,
      localCellX: 0.5, localCellY: 0, localCellWidth: 0, localCellHeight: 4,
      creationBox: { minX: 0, minY: 0, width: 1, height: 4 },
      lineDirection: 'vertical',
    };
    const group: GroupNode = {
      id: 'g1', name: 'G',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 90, mirrorH: false, mirrorV: false,
    };
    const state = makeSVGLineState(svgObj, group);
    const materialized = materializeGroupMembers(state, 'g1');
    const ungrouped = applyCompOps(materialized, [{
      op: 'ungroupFigures', figureIds: ['l1'], groupId: 'g1', groupName: 'G',
    }]);
    const result = ungrouped.svgObjects[0];
    expect(result.lineDirection).toBe('horizontal');
  });

  test('lineDirection stays horizontal after 180° rotation', () => {
    const svgObj: SVGObject = {
      id: 'l1',
      segments: [{ kind: 'line', start: [0, 0.5], end: [4, 0.5] }],
      localSegments: [{ kind: 'line', start: [0, 0.5], end: [4, 0.5] }],
      color: { r: 0, g: 0, b: 0 },
      groupId: 'g1',
      cellX: 0, cellY: 0.5, cellWidth: 4, cellHeight: 0,
      localCellX: 0, localCellY: 0.5, localCellWidth: 4, localCellHeight: 0,
      creationBox: { minX: 0, minY: 0, width: 4, height: 1 },
      lineDirection: 'horizontal',
    };
    const group: GroupNode = {
      id: 'g1', name: 'G',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 180, mirrorH: false, mirrorV: false,
    };
    const state = makeSVGLineState(svgObj, group);
    const materialized = materializeGroupMembers(state, 'g1');
    const ungrouped = applyCompOps(materialized, [{
      op: 'ungroupFigures', figureIds: ['l1'], groupId: 'g1', groupName: 'G',
    }]);
    const result = ungrouped.svgObjects[0];
    expect(result.lineDirection).toBe('horizontal');
  });

  test('diagonal lineDirection unchanged after rotation', () => {
    const svgObj: SVGObject = {
      id: 'l1',
      segments: [{ kind: 'line', start: [0, 0], end: [4, 4] }],
      localSegments: [{ kind: 'line', start: [0, 0], end: [4, 4] }],
      color: { r: 0, g: 0, b: 0 },
      groupId: 'g1',
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
      localCellX: 0, localCellY: 0, localCellWidth: 4, localCellHeight: 4,
      creationBox: { minX: 0, minY: 0, width: 4, height: 4 },
      lineDirection: 'diagonal',
    };
    const group: GroupNode = {
      id: 'g1', name: 'G',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 90, mirrorH: false, mirrorV: false,
    };
    const state = makeSVGLineState(svgObj, group);
    const materialized = materializeGroupMembers(state, 'g1');
    const ungrouped = applyCompOps(materialized, [{
      op: 'ungroupFigures', figureIds: ['l1'], groupId: 'g1', groupName: 'G',
    }]);
    const result = ungrouped.svgObjects[0];
    expect(result.lineDirection).toBe('diagonal');
  });

  test('diagonal creationBox updated correctly after nested ungroup with scale', () => {
    // A diagonal line in inner group G1, nested inside outer group G2.
    // Scale G2 by 2×, ungroup G2, then ungroup G1.
    // The creationBox should match the scaled segment AABB.
    const svgObj: SVGObject = {
      id: 'l1',
      segments: [{ kind: 'line', start: [0, 0], end: [4, 4] }],
      localSegments: [{ kind: 'line', start: [0, 0], end: [4, 4] }],
      color: { r: 0, g: 0, b: 0 },
      groupId: 'g1',
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
      localCellX: 0, localCellY: 0, localCellWidth: 4, localCellHeight: 4,
      creationBox: { minX: 0, minY: 0, width: 4, height: 4 },
      lineDirection: 'diagonal',
    };
    const innerGroup: GroupNode = {
      id: 'g1', name: 'Inner',
      parentGroupId: 'g2',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const outerGroup: GroupNode = {
      id: 'g2', name: 'Outer',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const state: CompositionState = {
      id: 'test', name: 'test',
      figures: [], svgObjects: [svgObj],
      lineDraft: null, arcDraft: null,
      editingLineId: null, selectedVertexIndex: null,
      lastChosenColor: { r: 255, g: 255, b: 255 },
      customColors: [],
      groups: [innerGroup, outerGroup],
      sceneOrder: ['l1'],
      gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      viewport: makeViewport(800, 600),
      selectedFigureIds: new Set(),
      activeFigureKey: null,
      compTool: 'select',
      createRegion: null,
      renderGeneration: 0,
    };
    // Scale the outer group by 2× — materialize world coords.
    const scaled = setGroupTransform(state, 'g2', { scaleX: 2, scaleY: 2 });
    // After scale, world segments should be doubled: (0,0)→(8,8).
    expect(scaled.svgObjects[0].segments[0]).toEqual(
      { kind: 'line', start: [0, 0], end: [8, 8] },
    );
    // Ungroup the outer group — child group g1 is detached.
    const afterOuterUngroup = applyCompOps(scaled, [{
      op: 'ungroupFigures', figureIds: [], groupId: 'g2', groupName: 'Outer',
      childGroupIds: ['g1'],
    }]);
    // g1 should now be top-level, world segments unchanged.
    const svgAfterOuter = afterOuterUngroup.svgObjects[0];
    expect(svgAfterOuter.groupId).toBe('g1');
    expect(svgAfterOuter.segments[0]).toEqual(
      { kind: 'line', start: [0, 0], end: [8, 8] },
    );
    // Ungroup the inner group — line is freed.
    const afterInnerUngroup = applyCompOps(afterOuterUngroup, [{
      op: 'ungroupFigures', figureIds: ['l1'], groupId: 'g1', groupName: 'Inner',
    }]);
    const result = afterInnerUngroup.svgObjects[0];
    expect(result.groupId).toBeUndefined();
    expect(result.lineDirection).toBe('diagonal');
    // The creationBox should contain the segment AABB.
    const aabb = computeSVGBbox(result.segments);
    expect(result.creationBox).toBeDefined();
    // creationBox center should match segment AABB center.
    const cbCx = result.creationBox!.minX + result.creationBox!.width / 2;
    const cbCy = result.creationBox!.minY + result.creationBox!.height / 2;
    const aabbCx = aabb.cellX + aabb.cellWidth / 2;
    const aabbCy = aabb.cellY + aabb.cellHeight / 2;
    expect(cbCx).toBeCloseTo(aabbCx, 5);
    expect(cbCy).toBeCloseTo(aabbCy, 5);
    // creationBox should be 8×8 (original 4×4 scaled by 2×).
    expect(result.creationBox!.width).toBeCloseTo(8, 5);
    expect(result.creationBox!.height).toBeCloseTo(8, 5);
  });

  test('identity fields on figures are cleared after ungroup', () => {
    const fig = makeFigure({
      id: 'f1', cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
      groupId: 'g1',
      localCellX: 0, localCellY: 0, localCellWidth: 4, localCellHeight: 4,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
      identityCellX: 1, identityCellY: 2, transformCycleStep: 3,
    });
    const group: GroupNode = {
      id: 'g1', name: 'G',
      translateX: 0, translateY: 0, scaleX: 2, scaleY: 2,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const state = makeState([fig], [group]);
    const scaled = materializeGroupMembers(state, 'g1');
    const ungrouped = applyCompOps(scaled, [{
      op: 'ungroupFigures', figureIds: ['f1'], groupId: 'g1', groupName: 'G',
    }]);
    const result = ungrouped.figures[0];
    expect(result.groupId).toBeUndefined();
    expect(result.identityCellX).toBeUndefined();
    expect(result.identityCellY).toBeUndefined();
    expect(result.transformCycleStep).toBeUndefined();
    // World bbox reflects the 2× scale.
    expect(result.cellWidth).toBe(8);
    expect(result.cellHeight).toBe(8);
  });
});

describe('cloneWithOffset drops creationBox when group changes', () => {
  const svgAdapter = SCENE_ADAPTERS.find(a => a.kind === 'svg')!;

  test('creationBox is dropped when duplicating into a different group', () => {
    const svg: SVGObject = {
      id: 'svg_1', groupId: 'g1',
      segments: [{ kind: 'line', start: [0, 0.5], end: [4, 0.5] }],
      localSegments: [{ kind: 'line', start: [0, 0.5], end: [4, 0.5] }],
      color: { r: 0, g: 0, b: 0 },
      cellX: 0, cellY: 0.5, cellWidth: 4, cellHeight: 0,
      creationBox: { minX: 0, minY: 0, width: 4, height: 1 },
      lineDirection: 'horizontal',
    };
    const clone = svgAdapter.cloneWithOffset(svg as any, 1, 1, 'svg_2', 'g2');
    // Different group → creationBox must be dropped.
    expect((clone as SVGObject).creationBox).toBeUndefined();
  });

  test('creationBox is kept when duplicating within the same group', () => {
    const svg: SVGObject = {
      id: 'svg_1', groupId: 'g1',
      segments: [{ kind: 'line', start: [0, 0.5], end: [4, 0.5] }],
      localSegments: [{ kind: 'line', start: [0, 0.5], end: [4, 0.5] }],
      color: { r: 0, g: 0, b: 0 },
      cellX: 0, cellY: 0.5, cellWidth: 4, cellHeight: 0,
      creationBox: { minX: 0, minY: 0, width: 4, height: 1 },
      lineDirection: 'horizontal',
    };
    const clone = svgAdapter.cloneWithOffset(svg as any, 1, 1, 'svg_2', 'g1');
    // Same group → creationBox offset by (1, 1).
    expect((clone as SVGObject).creationBox).toEqual({ minX: 1, minY: 1, width: 4, height: 1 });
  });

  test('creationBox is dropped when duplicating to no group', () => {
    const svg: SVGObject = {
      id: 'svg_1', groupId: 'g1',
      segments: [{ kind: 'line', start: [0, 0.5], end: [4, 0.5] }],
      color: { r: 0, g: 0, b: 0 },
      cellX: 0, cellY: 0.5, cellWidth: 4, cellHeight: 0,
      creationBox: { minX: 0, minY: 0, width: 4, height: 1 },
    };
    const clone = svgAdapter.cloneWithOffset(svg as any, 1, 1, 'svg_2', undefined);
    // Going from grouped to ungrouped → creationBox dropped.
    expect((clone as SVGObject).creationBox).toBeUndefined();
  });
});

describe('masked group scales against the mask bbox', () => {
  // The UI lives in CompositionCanvas/CompositionEditor, but those derive a
  // group's scale from a reference bbox. For a masked group the fix makes that
  // reference the MASK's bbox (world for the drag anchor, local for sX/sY)
  // instead of the member union. These tests replicate the exact editor math
  // (mirror of handleScaleFigure) and assert: the handle stays on the mask
  // corner with no jump-on-grab, sX === sY, and every member — including a
  // member that overflows the mask — scales by the same factor.
  function closedSquare(x: number, y: number, size: number): PathSegment[] {
    return [
      { kind: 'line', start: [x, y], end: [x + size, y] },
      { kind: 'line', start: [x + size, y], end: [x + size, y + size] },
      { kind: 'line', start: [x + size, y + size], end: [x, y + size] },
      { kind: 'line', start: [x, y + size], end: [x, y] },
    ];
  }

  function maskGroupState(rotation: 0 | 90 | 180 | 270): CompositionState {
    // Mask: closed 4×4 square at local (2,2). Bigger 20×20 figure overflows it.
    const maskSegs = closedSquare(2, 2, 4);
    const mask: SVGObject = {
      id: 'mask', groupId: 'g1', isMask: true,
      segments: maskSegs.map(s => ({ ...s })) as PathSegment[],
      localSegments: maskSegs.map(s => ({ ...s })) as PathSegment[],
      color: { r: 0, g: 0, b: 0 },
      ...computeSVGBbox(maskSegs),
      localCellX: 2, localCellY: 2, localCellWidth: 4, localCellHeight: 4,
    };
    const bg = makeFigure({
      id: 'bg', cellX: 0, cellY: 0, cellWidth: 20, cellHeight: 20,
      groupId: 'g1', localCellX: 0, localCellY: 0, localCellWidth: 20, localCellHeight: 20,
    });
    const group: GroupNode = { id: 'g1', name: 'G', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation, mirrorH: false, mirrorV: false };
    const base = makeState([bg], [group]);
    return materializeGroupMembers({ ...base, svgObjects: [mask], sceneOrder: ['bg', 'mask'] }, 'g1');
  }

  const maskWorldBbox = (s: CompositionState) => computeSVGBbox(s.svgObjects.find(o => o.id === 'mask')!.segments);

  // Replicates handleScaleFigure: given the mask's LOCAL bbox as the scale
  // reference and a target visible rect, derive the group transform.
  function deriveTransform(rotation: 0 | 90 | 180 | 270, target: { x: number; y: number; w: number; h: number }) {
    const lb = { minX: 2, minY: 2, width: 4, height: 4 }; // mask local bbox
    const swap = rotation === 90 || rotation === 270;
    const sX = swap ? target.w / lb.height : target.w / lb.width;
    const sY = swap ? target.h / lb.width : target.h / lb.height;
    const probe = applyGroupTransform(
      { translateX: 0, translateY: 0, scaleX: sX, scaleY: sY, rotation, mirrorH: false, mirrorV: false },
      { cellX: lb.minX, cellY: lb.minY, cellWidth: lb.width, cellHeight: lb.height },
    );
    return { scaleX: sX, scaleY: sY, translateX: target.x - probe.cellX, translateY: target.y - probe.cellY };
  }

  test('rotation 0: dragging the mask corner to 2× lands the mask box on target and scales the whole group uniformly', () => {
    const state = maskGroupState(0);
    const cur = maskWorldBbox(state); // (2,2,4,4) at identity
    // BR drag with TL anchored: keep TL, double size.
    const target = { x: cur.cellX, y: cur.cellY, w: cur.cellWidth * 2, h: cur.cellHeight * 2 };
    const t = deriveTransform(0, target);
    expect(t.scaleX).toBeCloseTo(t.scaleY); // uniform
    const after = setGroupTransform(state, 'g1', t);
    // Handle-consistency: mask world bbox lands exactly on the dragged target.
    const mb = maskWorldBbox(after);
    expect(mb.cellX).toBeCloseTo(target.x);
    expect(mb.cellY).toBeCloseTo(target.y);
    expect(mb.cellWidth).toBeCloseTo(target.w);
    expect(mb.cellHeight).toBeCloseTo(target.h);
    // The overflowing member scaled by the same factor (2×), as if no mask.
    const bg = after.figures.find(f => f.id === 'bg')!;
    expect(bg.cellWidth).toBeCloseTo(40);
    expect(bg.cellHeight).toBeCloseTo(40);
  });

  test('rotation 90: same drag stays consistent under the rotation swap', () => {
    const state = maskGroupState(90);
    const cur = maskWorldBbox(state);
    const target = { x: cur.cellX, y: cur.cellY, w: cur.cellWidth * 2, h: cur.cellHeight * 2 };
    const t = deriveTransform(90, target);
    expect(t.scaleX).toBeCloseTo(t.scaleY);
    const after = setGroupTransform(state, 'g1', { ...t, rotation: 90 });
    const mb = maskWorldBbox(after);
    expect(mb.cellX).toBeCloseTo(target.x);
    expect(mb.cellY).toBeCloseTo(target.y);
    expect(mb.cellWidth).toBeCloseTo(target.w);
    expect(mb.cellHeight).toBeCloseTo(target.h);
    const bg = after.figures.find(f => f.id === 'bg')!;
    expect(bg.cellWidth).toBeCloseTo(40);
    expect(bg.cellHeight).toBeCloseTo(40);
  });

  test('the mask is recognized as the active mask for the group', () => {
    const state = maskGroupState(0);
    const mask = getActiveMaskForGroup(state, 'g1');
    expect(mask?.id).toBe('mask');
  });
});
