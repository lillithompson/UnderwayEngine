import { applyCompOps, revertCompOps } from '@/engine/compositionOps';
import { CompositionState, PATTERN_SYMMETRY_OFF, PatternObject, RGBColor } from '@/engine/types';
import { getRenderedSignature, mirrorCellState } from '@/engine/connectivity';
import { patternCellTint, PATTERN_BASE_INK } from '@/engine/patternObject';
import { makeBlankComposition } from '../blankComposition';
import { buildPlaceLineShape, buildPlacePolyline, buildRotateSelected } from '../editorSession';
import {
  buildPlaceTile, filledPatternCellCount,
  gatherTileConstraints, MAX_TILE_CELLS_TOTAL, mergeTileStrokeOps, TILE_ENDPOINT_TOL_FRAC,
  tileGridLevelOf, tileTapJoinsPattern,
} from '../tileTool';
import { paintStampPoints } from '../paintBrush';

// The Tile tool: a tap fills the grid cell under it with ONE Pattern tile
// picked to connect with what already touches the cell's 8 border
// connection points — neighbouring tiles' own connection points, and the
// loose endpoints of drawn lines. These pin the placement builder the tap
// commits through and the toolbar/gesture wiring around it.
//
// Editing is OPT-IN. The tool creates: a dragged region mints a fresh
// Pattern object and joins nothing. The one object it may rework is the
// one the user opened for editing by hand (the Edit capsule, the double
// border), which every builder here takes as its `editableId` — omit it
// and nothing already on the page is touched.
//
// The sprite registry is the jest mock (engine __mocks__/loadTile.ts):
// twelve test sprites whose ids carry their 8-bit signatures, so what a
// constraint can pick is known exactly.

const INK: RGBColor = { r: 10, g: 20, b: 30 };

// The target grid cell throughout: gridLevel 1 → step 2; a tap anywhere in
// [4,6)×[2,4) fills the cell at (4, 2). Border points, signature order:
// N(5,2) NE(6,2) E(6,3) SE(6,4) S(5,4) SW(4,4) W(4,3) NW(4,2).
const LEVEL = 1;
const TAP: [number, number] = [5.3, 3.7];

function blank(): CompositionState {
  return makeBlankComposition('c', 'Test');
}

function withPolyline(state: CompositionState, points: [number, number][]): CompositionState {
  const se = buildPlacePolyline(points, INK)!;
  return applyCompOps(state, se.entry);
}

function spriteCell(spriteId: string) {
  return {
    type: 'sprite' as const,
    spriteId,
    transform: { rotation: 0 as const, mirrorH: false, mirrorV: false },
  };
}

function withTileObject(
  state: CompositionState,
  box: { cellX: number; cellY: number; cellWidth: number; cellHeight: number },
  spriteId: string,
): CompositionState {
  const item: PatternObject = {
    id: `pat_test_${box.cellX}_${box.cellY}`,
    ...box,
    cols: 1,
    rows: 1,
    cells: [spriteCell(spriteId)],
  };
  return applyCompOps(state, [{ op: 'placeObject', kind: 'pattern', item }]);
}

function placedItem(state: CompositionState, tap = TAP): PatternObject {
  const se = buildPlaceTile(state, tap[0], tap[1], LEVEL, INK)!;
  expect(se).not.toBeNull();
  const op = se.entry[0];
  if (op.op !== 'placeObject') throw new Error(`expected placeObject, got ${op.op}`);
  return op.item as PatternObject;
}

// Every pick's rendered signature must agree with the constraint at its
// NON-NULL slots (null = free; a mock sprite without a signature is skipped,
// as the engine's own pick tests do).
function expectPicksToRender(state: CompositionState, expected: (boolean | null)[]) {
  for (let i = 0; i < 20; i++) {
    const sig = getRenderedSignature(placedItem(state).cells[0]);
    if (!sig) continue;
    for (let k = 0; k < 8; k++) {
      if (expected[k] !== null) expect(sig[k]).toBe(expected[k]);
    }
  }
}

const ALL_FREE: (boolean | null)[] = [null, null, null, null, null, null, null, null];

describe('buildPlaceTile', () => {
  test('a tap places a 1×1 pattern object snapped to the grid cell, in the active ink', () => {
    const se = buildPlaceTile(blank(), TAP[0], TAP[1], LEVEL, INK)!;
    expect(se.id!.startsWith('pat_')).toBe(true);
    const item = placedItem(blank());
    expect(item).toMatchObject({ cellX: 4, cellY: 2, cellWidth: 2, cellHeight: 2, cols: 1, rows: 1 });
    expect(item.cells).toHaveLength(1);
    expect(item.cells[0]).not.toBeNull();
    expect(patternCellTint(item.cells[0])).toEqual(INK);
    const state = applyCompOps(blank(), se.entry);
    expect(state.sceneOrder).toContain(se.id!);
  });

  test('the base ink lays an untinted tile, like the pattern brush', () => {
    const se = buildPlaceTile(blank(), TAP[0], TAP[1], LEVEL, PATTERN_BASE_INK)!;
    const op = se.entry[0];
    if (op.op !== 'placeObject') throw new Error('expected placeObject');
    expect(patternCellTint((op.item as PatternObject).cells[0])).toBeNull();
  });

  test('an empty cell is unconstrained — free to pick ANY tile, like the pattern brush', () => {
    expect(gatherTileConstraints(blank(), 4, 2, 2)).toEqual(ALL_FREE);
    // Freedom is observable: an all-false constraint could only ever yield
    // the blank tile, so seeing a CONNECTING tile land proves the empty
    // cell was not constrained to nothing.
    let sawConnecting = false;
    for (let i = 0; i < 40 && !sawConnecting; i++) {
      const sig = getRenderedSignature(placedItem(blank()).cells[0]);
      if (sig?.some(Boolean)) sawConnecting = true;
    }
    expect(sawConnecting).toBe(true);
  });

  test('a Choose pick lays THAT sprite in its pose — no roll, partners mirrored', () => {
    // The armed tile stamps as-is, whatever borders the cell…
    const pick = {
      spriteId: 'test/tile_10001000',
      transform: { rotation: 90 as const, mirrorH: false, mirrorV: false },
    };
    const se = buildPlaceTile(
      blank(), TAP[0], TAP[1], LEVEL, INK, undefined, undefined, undefined, pick,
    )!;
    const op = se.entry[0];
    if (op.op !== 'placeObject') throw new Error('expected placeObject');
    expect((op.item as PatternObject).cells[0]).toMatchObject({
      spriteId: 'test/tile_10001000', transform: { rotation: 90 },
    });
    // …its symmetry partner is the SAME pick mirrored, never a roll…
    const frame = { cellX: 0, cellY: 0, cellWidth: 12, cellHeight: 8 };
    const seSym = buildPlaceTile(
      blank(), TAP[0], TAP[1], LEVEL, INK, undefined, undefined,
      { flags: { ...PATTERN_SYMMETRY_OFF, mirrorH: true }, frame }, pick,
    )!;
    const placed = seSym.entry.filter((o) => o.op === 'placeObject');
    expect(placed).toHaveLength(2);
    const primaryCell = (placed[0] as { item: PatternObject }).item.cells[0]!;
    const partnerCell = (placed[1] as { item: PatternObject }).item.cells[0];
    expect(partnerCell).toMatchObject({ spriteId: 'test/tile_10001000' });
    expect(getRenderedSignature(partnerCell))
      .toEqual(getRenderedSignature(mirrorCellState(primaryCell, true, false, 0)));
    // …and a cell already holding a tile takes the pick IN PLACE.
    const seeded = withTileObject(
      blank(), { cellX: 4, cellY: 2, cellWidth: 2, cellHeight: 2 }, 'test/tile_00000000');
    const seEdit = buildPlaceTile(
      seeded, TAP[0], TAP[1], LEVEL, INK, undefined, undefined, undefined, pick, 'pat_test_4_2',
    )!;
    expect(seEdit.entry[0].op).toBe('editPatternCells');
    // …but only because that grid is OPEN: with nothing editable the same
    // pick lays its own object over it and leaves the cell alone.
    const seOver = buildPlaceTile(
      seeded, TAP[0], TAP[1], LEVEL, INK, undefined, undefined, undefined, pick,
    )!;
    expect(seOver.entry[0].op).toBe('placeObject');
  });

  test('open-path endpoints on the border points constrain the tile to meet them', () => {
    // One stroke ends on the cell's N point, another on its S point; both
    // run far away from every other border point (which stay free).
    let state = withPolyline(blank(), [[5, 2], [8, 0]]);
    state = withPolyline(state, [[5, 4], [8, 7]]);
    expect(gatherTileConstraints(state, 4, 2, 2)).toEqual(
      [true, null, null, null, true, null, null, null],
    );
    expectPicksToRender(state, [true, null, null, null, true, null, null, null]);
  });

  test('an endpoint only counts within the tolerance', () => {
    const step = 2;
    const tol = step * TILE_ENDPOINT_TOL_FRAC;
    // Just inside, just outside — measured from the N point (5, 2).
    const near = withPolyline(blank(), [[5, 2 + tol * 0.9], [9, 0]]);
    expect(gatherTileConstraints(near, 4, 2, step)[0]).toBe(true);
    const far = withPolyline(blank(), [[5, 2 + tol * 1.5], [9, 0]]);
    expect(gatherTileConstraints(far, 4, 2, step)).toEqual(ALL_FREE);
  });

  test('a closed shape has no loose end and constrains nothing', () => {
    // A rectangle drawn exactly around the target cell: every border point
    // lies ON it, but nothing ENDS there.
    const se = buildPlaceLineShape([4, 2], [6, 4], INK, 'rectangle', LEVEL)!;
    const state = applyCompOps(blank(), se.entry);
    expect(gatherTileConstraints(state, 4, 2, 2)).toEqual(ALL_FREE);
  });

  test('free rotation is applied to an endpoint before it is tested', () => {
    // A horizontal stroke (4,1)→(6,1) ends nowhere near the cell's N point —
    // until angleDeg turns it upright about its center (5,1), landing its
    // ends on (5,0) and (5,2), the second being the N point exactly.
    const base = withPolyline(blank(), [[4, 1], [6, 1]]);
    expect(gatherTileConstraints(base, 4, 2, 2)[0]).toBeNull();
    const rotated = {
      ...base,
      svgObjects: base.svgObjects.map((o) => ({ ...o, angleDeg: 90 })),
    };
    expect(gatherTileConstraints(rotated, 4, 2, 2)[0]).toBe(true);
  });

  test("a neighbouring tile's border carries tri-state constraints across", () => {
    // A tile with a N/S-connecting sprite in the cell ABOVE: its S point is
    // the target cell's N point (must connect); its SE/SW corners are the
    // target's NE/NW, occupied but NOT connecting (must stay clear); the
    // five points its border never touches stay free.
    const state = withTileObject(
      blank(), { cellX: 4, cellY: 0, cellWidth: 2, cellHeight: 2 }, 'test/tile_10001000',
    );
    expect(gatherTileConstraints(state, 4, 2, 2)).toEqual(
      [true, false, null, null, null, null, null, false],
    );
    expectPicksToRender(state, [true, false, null, null, null, null, null, false]);
  });

  test("a coarser neighbour's edge is a wall between its connection points", () => {
    // A big tile (stamped at a coarser grid level: one cell, step 4) with
    // only E/W connections, and a small target cell against its E edge.
    // The small cell's NW lands ON the big tile's E connection point
    // (must meet it); its W lands on the edge BETWEEN the big tile's
    // points — a solid wall, mandatory non-connection; its SW is the big
    // tile's non-connecting SE corner; everything facing away stays free.
    const state = withTileObject(
      blank(), { cellX: 4, cellY: 0, cellWidth: 4, cellHeight: 4 }, 'test/tile_00100010',
    );
    // Target cell (8,2)-(10,4): N(9,2) NE(10,2) E(10,3) SE(10,4) S(9,4)
    // SW(8,4) W(8,3) NW(8,2).
    const expected = [null, null, null, null, null, false, false, true];
    expect(gatherTileConstraints(state, 8, 2, 2)).toEqual(expected);
    for (let i = 0; i < 20; i++) {
      const sig = getRenderedSignature(placedItem(state, [9, 3.5]).cells[0]);
      if (!sig) continue;
      for (let k = 0; k < 8; k++) {
        if (expected[k] !== null) expect(sig[k]).toBe(expected[k]);
      }
    }
  });

  test('a finer neighbour constrains a coarser cell through its own points', () => {
    // The other direction needs no wall rule: a coarse border point on a
    // finer occupied cell's edge always coincides with one of the finer
    // grid's own connection points (the grids nest), so the value comes
    // from the small tile's signature — here its non-connecting corners.
    const state = withTileObject(
      blank(), { cellX: 4, cellY: 0, cellWidth: 2, cellHeight: 2 }, 'test/tile_10001000',
    );
    // Coarser target cell (4,2)-(8,6), step 4: its N(6,2) and NW(4,2) are
    // the small tile's SE/SW corners (non-connecting); all else is free.
    expect(gatherTileConstraints(blank(), 4, 2, 4)).toEqual(ALL_FREE);
    expect(gatherTileConstraints(state, 4, 2, 4)).toEqual(
      [false, null, null, null, null, null, null, false],
    );
  });

  test('lines never wall a border — only tiles do', () => {
    // A stroke running straight along the target cell's N edge, THROUGH
    // three of its border points, with both endpoints far away: it is not
    // a tile, so it neither fills nor forbids anything.
    const state = withPolyline(blank(), [[2, 2], [10, 2]]);
    expect(gatherTileConstraints(state, 4, 2, 2)).toEqual(ALL_FREE);
  });

  test('a hidden neighbour reads as empty', () => {
    const state = withTileObject(
      blank(), { cellX: 4, cellY: 0, cellWidth: 2, cellHeight: 2 }, 'test/tile_10001000',
    );
    const hidden = {
      ...state,
      patternObjects: state.patternObjects!.map((p) => ({ ...p, hidden: true })),
    };
    expect(gatherTileConstraints(hidden, 4, 2, 2)).toEqual(ALL_FREE);
  });

  test('a re-tap re-rolls the tile in place rather than stacking a second one', () => {
    const first = buildPlaceTile(blank(), TAP[0], TAP[1], LEVEL, INK)!;
    const state = applyCompOps(blank(), first.entry);
    let rerolled = 0;
    for (let i = 0; i < 30; i++) {
      const se = buildPlaceTile(
        state, TAP[0], TAP[1], LEVEL, INK, undefined, undefined, undefined, undefined, first.id);
      // Null = the re-roll happened to pick the very tile already there.
      if (!se) continue;
      rerolled++;
      expect(se.entry.map((o) => o.op)).toEqual(['editPatternCells']);
      expect(se.id).toBe(first.id);
      const next = applyCompOps(state, se.entry);
      expect(next.patternObjects).toHaveLength(1);
    }
    // Two distinct all-false-compatible mock sprites exist, so 30 rolls
    // failing to change the tile even once would be astronomically unlucky.
    expect(rerolled).toBeGreaterThan(0);
  });

  test('a locked tile refuses the re-roll, and nothing stacks over it', () => {
    const first = buildPlaceTile(blank(), TAP[0], TAP[1], LEVEL, INK)!;
    const state = applyCompOps(blank(), first.entry);
    const locked = {
      ...state,
      patternObjects: state.patternObjects!.map((p) => ({ ...p, locked: true })),
    };
    for (let i = 0; i < 10; i++) {
      expect(buildPlaceTile(
        locked, TAP[0], TAP[1], LEVEL, INK, undefined, undefined, undefined, undefined, first.id,
      )).toBeNull();
    }
  });

  test('a pattern that is NOT open for editing is never reworked — the tile lands over it', () => {
    // The whole rule, at the builder: the same tap that re-rolls an open
    // grid's cell mints its own object beside a closed one, which keeps
    // every cell it had.
    const first = buildPlaceTile(blank(), TAP[0], TAP[1], LEVEL, INK)!;
    const state = applyCompOps(blank(), first.entry);
    for (let i = 0; i < 10; i++) {
      const se = buildPlaceTile(state, TAP[0], TAP[1], LEVEL, INK)!;
      expect(se.entry.map((o) => o.op)).toEqual(['placeObject']);
      expect(se.id).not.toBe(first.id);
      const after = applyCompOps(state, se.entry);
      expect(after.patternObjects).toHaveLength(2);
      expect(after.patternObjects![0]).toEqual(state.patternObjects![0]);
    }
    // A DIFFERENT pattern being open is no licence either.
    const other = buildPlaceTile(
      state, TAP[0], TAP[1], LEVEL, INK, undefined, undefined, undefined, undefined, 'pat_elsewhere',
    )!;
    expect(other.entry.map((o) => o.op)).toEqual(['placeObject']);
  });

  test('a run of stamps connects sequentially — each pick meets the one before', () => {
    // The drag gesture stamps against a WORKING state exactly like this
    // loop, so this pins the semantics the stroke rides on: neighbouring
    // stamps agree at every shared border point, and the whole run reverts
    // as one undo step.
    for (let round = 0; round < 10; round++) {
      let working = blank();
      const ops = [];
      for (const [x, y] of [[5, 3], [7, 3], [9, 3]] as [number, number][]) {
        const se = buildPlaceTile(working, x, y, LEVEL, INK)!;
        expect(se).not.toBeNull();
        working = applyCompOps(working, se.entry);
        ops.push(...se.entry);
      }
      expect(working.patternObjects).toHaveLength(3);
      for (let i = 0; i < 2; i++) {
        const a = getRenderedSignature(working.patternObjects![i].cells[0]);
        const b = getRenderedSignature(working.patternObjects![i + 1].cells[0]);
        if (!a || !b) continue; // an unconstrained mock sprite pins nothing
        // A's NE/E/SE border points are B's NW/W/SW.
        expect(b[7]).toBe(a[1]);
        expect(b[6]).toBe(a[2]);
        expect(b[5]).toBe(a[3]);
      }
      const reverted = revertCompOps(working, ops);
      expect(reverted.patternObjects ?? []).toHaveLength(0);
    }
  });

  test('canvas symmetry stamps the mirror partner as the SAME tile, flipped', () => {
    // H symmetry about a frame centered at x=4: the tap's cell (4,2) and
    // its partner (2,2) land in ONE entry, the partner carrying the same
    // sprite mirrored — never an independent pick — so the image is exact.
    const symmetry = {
      flags: { ...PATTERN_SYMMETRY_OFF, mirrorH: true },
      frame: { cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8 },
    };
    const se = buildPlaceTile(blank(), TAP[0], TAP[1], LEVEL, INK, undefined, undefined, symmetry)!;
    expect(se).not.toBeNull();
    const items = se.entry.map((op) => {
      if (op.op !== 'placeObject') throw new Error(`expected placeObject, got ${op.op}`);
      return op.item as PatternObject;
    });
    expect(items.map((i) => ({ x: i.cellX, y: i.cellY }))).toEqual([
      { x: 4, y: 2 }, { x: 2, y: 2 },
    ]);
    expect(items[1].cells[0]).toEqual(mirrorCellState(items[0].cells[0], true, false, 0));
    // Both revert in the one undo step.
    const state = applyCompOps(blank(), se.entry);
    expect(state.patternObjects).toHaveLength(2);
    expect(revertCompOps(state, se.entry).patternObjects ?? []).toHaveLength(0);
  });

  test('a partner cell already holding a tile is re-rolled to the mirrored copy', () => {
    const symmetry = {
      flags: { ...PATTERN_SYMMETRY_OFF, mirrorH: true },
      frame: { cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8 },
    };
    const seeded = withTileObject(
      blank(), { cellX: 2, cellY: 2, cellWidth: 2, cellHeight: 2 }, 'test/tile_10001000',
    );
    for (let i = 0; i < 10; i++) {
      const se = buildPlaceTile(
        seeded, TAP[0], TAP[1], LEVEL, INK, undefined, undefined, symmetry, undefined,
        'pat_test_2_2',
      );
      if (!se) continue;
      expect(se.entry.map((op) => op.op).sort()).toEqual(['editPatternCells', 'placeObject']);
      const next = applyCompOps(seeded, se.entry);
      expect(next.patternObjects).toHaveLength(2);
    }
  });

  test('a stamp ON the symmetry axis picks a self-symmetric tile, no partner', () => {
    // Frame 10 cells wide at step 2 → 5 steps: the middle step is the
    // axis. The tap's cell (4,2) IS that middle cell, so no partner lands
    // and the pick must be H-self-symmetric (Facet's axis-cell rule).
    const symmetry = {
      flags: { ...PATTERN_SYMMETRY_OFF, mirrorH: true },
      frame: { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 },
    };
    for (let i = 0; i < 20; i++) {
      const se = buildPlaceTile(blank(), TAP[0], TAP[1], LEVEL, INK, undefined, undefined, symmetry)!;
      expect(se.entry).toHaveLength(1);
      const op = se.entry[0];
      if (op.op !== 'placeObject') throw new Error('expected placeObject');
      const sig = getRenderedSignature((op.item as PatternObject).cells[0]);
      if (!sig) continue;
      expect(sig[1]).toBe(sig[7]);
      expect(sig[2]).toBe(sig[6]);
      expect(sig[3]).toBe(sig[5]);
    }
  });

  test('the seeded stroke width rides the new tile object', () => {
    const se = buildPlaceTile(blank(), TAP[0], TAP[1], LEVEL, INK, undefined, { width: 0.125 })!;
    const op = se.entry[0];
    if (op.op !== 'placeObject') throw new Error('expected placeObject');
    expect((op.item as PatternObject).stroke).toEqual({ width: 0.125 });
  });
});

// A drawing already holding `count` filled cells, parked far from the tap
// cell so the budget is the ONLY thing the seeded objects contribute.
function withFilledCells(state: CompositionState, count: number): CompositionState {
  let s = state;
  for (let i = 0, left = count; left > 0; i++, left -= 256) {
    const n = Math.min(left, 256);
    const item: PatternObject = {
      id: `pat_budget_${i}`,
      cellX: 1000 + i * 20,
      cellY: 1000,
      cellWidth: 16,
      cellHeight: 16,
      cols: 16,
      rows: 16,
      cells: Array.from({ length: 256 }, (_, k) => (k < n ? spriteCell('test/tile_10001000') : null)),
    };
    s = applyCompOps(s, [{ op: 'placeObject', kind: 'pattern', item }]);
  }
  return s;
}

describe('the tile cell budget (MAX_TILE_CELLS_TOTAL)', () => {
  // Every filled cell is live SVG plus per-stamp constraint work; unbounded
  // filling grew the document until iOS WKWebView reloaded the page under
  // memory pressure. The budget stops NEW fills at the cap while re-rolls
  // of what's already there keep working.

  test('filledPatternCellCount counts filled cells across every pattern object', () => {
    expect(filledPatternCellCount(blank())).toBe(0);
    expect(filledPatternCellCount(withFilledCells(blank(), 300))).toBe(300);
  });

  test('the budget clears a full default-grid page with room to spare', () => {
    // A 3:4 page is 32×~43 cells at grid step 1 (~1.4k cells): the cap must
    // never interrupt tiling a whole page at the default grid.
    expect(MAX_TILE_CELLS_TOTAL).toBeGreaterThanOrEqual(2 * 32 * 43);
  });

  test('at the cap, a fresh stamp is refused', () => {
    const full = withFilledCells(blank(), MAX_TILE_CELLS_TOTAL);
    expect(buildPlaceTile(full, TAP[0], TAP[1], LEVEL, INK)).toBeNull();
  });

  test('at the cap, a re-roll of a filled cell still works — it adds nothing', () => {
    const full = withTileObject(
      withFilledCells(blank(), MAX_TILE_CELLS_TOTAL - 1),
      { cellX: 4, cellY: 2, cellWidth: 2, cellHeight: 2 },
      'test/tile_10001000',
    );
    expect(filledPatternCellCount(full)).toBe(MAX_TILE_CELLS_TOTAL);
    let edited = false;
    for (let i = 0; i < 20 && !edited; i++) {
      const se = buildPlaceTile(
        full, TAP[0], TAP[1], LEVEL, INK, undefined, undefined, undefined, undefined,
        'pat_test_4_2');
      if (!se) continue; // the roll may land the very tile already there
      expect(se.entry.every((op) => op.op === 'editPatternCells')).toBe(true);
      edited = true;
    }
    expect(edited).toBe(true);
  });

  test('at the cap, filling an EMPTY slot of an existing grid is refused too', () => {
    // The tap cell (4,2) is the empty slot of a step-2 grid: filling it
    // would add a cell to the drawing, so at the cap it must refuse.
    const grid: PatternObject = {
      id: 'pat_gap',
      cellX: 4, cellY: 2, cellWidth: 4, cellHeight: 2,
      cols: 2, rows: 1,
      cells: [null, spriteCell('test/tile_10001000')],
    };
    const full = applyCompOps(
      withFilledCells(blank(), MAX_TILE_CELLS_TOTAL - 1),
      [{ op: 'placeObject', kind: 'pattern', item: grid }],
    );
    expect(filledPatternCellCount(full)).toBe(MAX_TILE_CELLS_TOTAL);
    expect(buildPlaceTile(
      full, TAP[0], TAP[1], LEVEL, INK, undefined, undefined, undefined, undefined, 'pat_gap',
    )).toBeNull();
  });

  test('one slot left: the primary lands, the symmetry partner is skipped', () => {
    const symmetry = {
      flags: { ...PATTERN_SYMMETRY_OFF, mirrorH: true },
      frame: { cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8 },
    };
    const nearly = withFilledCells(blank(), MAX_TILE_CELLS_TOTAL - 1);
    const se = buildPlaceTile(nearly, TAP[0], TAP[1], LEVEL, INK, undefined, undefined, symmetry)!;
    expect(se).not.toBeNull();
    expect(se.entry).toHaveLength(1);
    const op = se.entry[0];
    if (op.op !== 'placeObject') throw new Error('expected placeObject');
    expect({ x: (op.item as PatternObject).cellX, y: (op.item as PatternObject).cellY })
      .toEqual({ x: 4, y: 2 });
  });
});

describe('the tile stroke walks the trail between events (paintStampPoints at the grid step)', () => {
  // The stroke reuses the paint brushes' interpolation with the grid step
  // as the "radius": half-STEP spacing, so consecutive samples land in the
  // same or a touching grid cell and a fast drag leaves a continuous run,
  // not islands scattered where the sparse pointer events happened to fall.

  test('half-step spacing keeps consecutive samples in touching cells — no islands', () => {
    const step = 2;
    const pts = paintStampPoints([0.3, 0.7], [13.1, 7.9], step);
    expect(pts[pts.length - 1]).toEqual([13.1, 7.9]);
    let prev: [number, number] = [Math.floor(0.3 / step), Math.floor(0.7 / step)];
    for (const [x, y] of pts) {
      const cell: [number, number] = [Math.floor(x / step), Math.floor(y / step)];
      expect(Math.abs(cell[0] - prev[0])).toBeLessThanOrEqual(1);
      expect(Math.abs(cell[1] - prev[1])).toBeLessThanOrEqual(1);
      prev = cell;
    }
  });

  test('the first event of a stroke is a single stamp', () => {
    expect(paintStampPoints(null, [5.3, 3.7], 2)).toEqual([[5.3, 3.7]]);
  });
});

describe('mergeTileStrokeOps — one drag, one object', () => {
  // Run the drag loop the gesture runs, then merge as the release does.
  function strokeOps(points: [number, number][], state = blank(), editableId?: string) {
    let working = state;
    const ops = [];
    for (const [x, y] of points) {
      const se = buildPlaceTile(
        working, x, y, LEVEL, INK, undefined, undefined, undefined, undefined, editableId)!;
      working = applyCompOps(working, se.entry);
      ops.push(...se.entry);
    }
    return ops;
  }

  test('a run of stamps merges into a single sparse pattern grid', () => {
    // Three cells in a horizontal line, then one below the first: bbox
    // 3×2 cells, four filled slots, two null.
    const ops = strokeOps([[5, 3], [7, 3], [9, 3], [5, 5]]);
    const merged = mergeTileStrokeOps(blank(), { entry: ops }).entry;
    expect(merged).toHaveLength(1);
    const op = merged[0];
    if (op.op !== 'placeObject') throw new Error('expected placeObject');
    const item = op.item as PatternObject;
    expect(item).toMatchObject({
      cellX: 4, cellY: 2, cellWidth: 6, cellHeight: 4, cols: 3, rows: 2,
    });
    expect(item.cells.filter(Boolean)).toHaveLength(4);
    // Each stamp landed in its own slot: row-major (col, row) of the four
    // origins (4,2) (6,2) (8,2) (4,4).
    expect(item.cells[0]).not.toBeNull();
    expect(item.cells[1]).not.toBeNull();
    expect(item.cells[2]).not.toBeNull();
    expect(item.cells[3]).not.toBeNull();
    expect(item.cells[4]).toBeNull();
    expect(item.cells[5]).toBeNull();
    // The merged object is committable and reverts as one step.
    const state = applyCompOps(blank(), merged);
    expect(state.patternObjects).toHaveLength(1);
    expect(revertCompOps(state, merged).patternObjects ?? []).toHaveLength(0);
  });

  test('a single stamp beside nothing passes through untouched', () => {
    const ops = strokeOps([[5, 3]]);
    const se = { entry: ops };
    expect(mergeTileStrokeOps(blank(), se)).toBe(se);
  });

  test('re-rolls of an object the stroke could NOT absorb ride along unmerged', () => {
    // The crossed object is grouped, so the stroke may re-roll its cell but
    // never absorb it — the fresh stamps still merge into their own object
    // and the edits pass through.
    const seeded0 = withTileObject(
      blank(), { cellX: 8, cellY: 2, cellWidth: 2, cellHeight: 2 }, 'test/tile_00000000',
    );
    const seeded = {
      ...seeded0,
      patternObjects: seeded0.patternObjects!.map((p) => ({ ...p, groupId: 'grp_x' })),
    };
    for (let i = 0; i < 10; i++) {
      const ops = strokeOps([[5, 3], [7, 3], [9, 3]], seeded, 'pat_test_8_2');
      const edits = ops.filter((o) => o.op === 'editPatternCells');
      if (edits.length === 0) continue; // the crossed tile re-rolled to itself
      const merged = mergeTileStrokeOps(seeded, { entry: ops }, 'pat_test_8_2').entry;
      expect(merged.filter((o) => o.op === 'editPatternCells')).toEqual(edits);
      expect(merged.filter((o) => o.op === 'placeObject')).toHaveLength(1);
      expect(merged.some((o) => o.op === 'removeObject')).toBe(false);
      return;
    }
    throw new Error('the crossed tile never re-rolled to a different sprite');
  });

  test('a stroke past the 16-cell pattern cap splits at the cap, not before', () => {
    // 20 cells in a row at step 2: the pattern kind cannot hold more than
    // 16 per axis, so the drag leaves two objects — 16 + 4.
    const points: [number, number][] = [];
    for (let i = 0; i < 20; i++) points.push([4 + i * 2 + 1, 3]);
    const merged = mergeTileStrokeOps(blank(), { entry: strokeOps(points) }).entry;
    expect(merged).toHaveLength(2);
    const sizes = merged.map((o) => {
      if (o.op !== 'placeObject') throw new Error('expected placeObject');
      return (o.item as PatternObject).cols;
    });
    expect(sizes).toEqual([16, 4]);
  });

  test('a mirrored drag leaves one object per orbit region', () => {
    // H symmetry about x=32 (a wide frame): primary stamps run at x 4..10,
    // partners land mirrored at 54..60 — a 56-cell span no 16-cell pattern
    // box can hold, so the stroke leaves exactly two objects, one per side.
    // (Orbits CLOSE enough to share a box merge into one, which is fine —
    // the object count is bounded by the cap, not inflated by the mirror.)
    const symmetry = {
      flags: { ...PATTERN_SYMMETRY_OFF, mirrorH: true },
      frame: { cellX: 0, cellY: 0, cellWidth: 64, cellHeight: 64 },
    };
    let working = blank();
    const ops = [];
    for (const [x, y] of [[5, 3], [7, 3], [9, 3]] as [number, number][]) {
      const se = buildPlaceTile(working, x, y, LEVEL, INK, undefined, undefined, symmetry)!;
      working = applyCompOps(working, se.entry);
      ops.push(...se.entry);
    }
    const merged = mergeTileStrokeOps(blank(), { entry: ops }).entry;
    expect(merged).toHaveLength(2);
    const items = merged.map((o) => {
      if (o.op !== 'placeObject') throw new Error('expected placeObject');
      return o.item as PatternObject;
    });
    expect(items[0]).toMatchObject({ cellX: 4, cols: 3, rows: 1 });
    expect(items[1]).toMatchObject({ cellX: 54, cols: 3, rows: 1 });
    expect(items[0].cells.every(Boolean)).toBe(true);
    expect(items[1].cells.every(Boolean)).toBe(true);
  });

  test('a later tap re-rolls a cell of the merged object instead of stacking', () => {
    const state = applyCompOps(
      blank(), mergeTileStrokeOps(blank(), { entry: strokeOps([[5, 3], [7, 3]]) }).entry);
    expect(state.patternObjects).toHaveLength(1);
    const mergedId = state.patternObjects![0].id;
    let rerolled = 0;
    for (let i = 0; i < 30; i++) {
      const se = buildPlaceTile(
        state, 7, 3, LEVEL, INK, undefined, undefined, undefined, undefined, mergedId);
      if (!se) continue;
      rerolled++;
      expect(se.entry.map((o) => o.op)).toEqual(['editPatternCells']);
      const next = applyCompOps(state, se.entry);
      expect(next.patternObjects).toHaveLength(1);
    }
    expect(rerolled).toBeGreaterThan(0);
  });
});

describe('mergeTileStrokeOps — a stroke beside the OPEN tile object EDITS it', () => {
  const SEED_BOX = { cellX: 6, cellY: 2, cellWidth: 2, cellHeight: 2 };
  const SEED_ID = 'pat_test_6_2';

  function tapEntry(state: CompositionState, x: number, y: number, editableId?: string) {
    const se = buildPlaceTile(
      state, x, y, LEVEL, INK, undefined, undefined, undefined, undefined, editableId);
    expect(se).not.toBeNull();
    return se!;
  }

  test('a tap in the next cell grows the OPEN neighbour in place — same id, same z-order', () => {
    const seeded = withTileObject(blank(), SEED_BOX, 'test/tile_00000000');
    const existing = seeded.patternObjects![0];
    const se = tapEntry(seeded, 5, 3, SEED_ID); // cell (4,2), edge-adjacent at x = 6
    const merged = mergeTileStrokeOps(seeded, se, SEED_ID);
    expect(merged.id).toBe(existing.id); // the tap now selects the grown object
    expect(merged.entry.map((o) => o.op)).toEqual(['removeObject', 'placeObject']);
    const placeOp = merged.entry[1];
    if (placeOp.op !== 'placeObject') throw new Error('expected placeObject');
    expect(placeOp.sceneOrderIndex).toBe(seeded.sceneOrder.indexOf(existing.id));
    const item = placeOp.item as PatternObject;
    expect(item.id).toBe(existing.id);
    expect(item).toMatchObject({
      cellX: 4, cellY: 2, cellWidth: 4, cellHeight: 2, cols: 2, rows: 1,
    });
    expect(item.cells[1]).toEqual(existing.cells[0]); // the old cell kept its slot
    expect(item.cells[0]).not.toBeNull(); // the tap's pick beside it
    // One object after, and one undo step restores the original exactly.
    const after = applyCompOps(seeded, merged.entry);
    expect(after.patternObjects).toHaveLength(1);
    const undone = revertCompOps(after, merged.entry);
    expect(undone.patternObjects).toEqual(seeded.patternObjects);
  });

  test('a ROTATED pattern still joins: the quarter turn is baked, so the grid keeps answering', () => {
    // A square 2×2-cell tile object at step 2, one N-only tile in its
    // top-left. Rotating it bakes the pose into the grid (bakePatternPose
    // via the pattern geometry adapter) — no rotation flag — so the tile
    // tool goes on reading its connection points and joining it, instead
    // of treating it as empty and stacking a fresh object over the scene.
    const seeded = withTileObject(
      blank(), { cellX: 6, cellY: 2, cellWidth: 4, cellHeight: 4 }, 'test/tile_10000000');
    const grid = {
      ...seeded.patternObjects![0],
      cols: 2, rows: 2,
      cells: [spriteCell('test/tile_10000000'), null, null, null] as (ReturnType<typeof spriteCell> | null)[],
    };
    const withGrid = applyCompOps(seeded, [
      { op: 'removeObject', kind: 'pattern', item: seeded.patternObjects![0] },
      { op: 'placeObject', kind: 'pattern', item: grid },
    ]);
    const turned = applyCompOps(withGrid, buildRotateSelected(withGrid, grid.id)!.entry);
    const p = turned.patternObjects![0];
    // Identity pose, same square box; the N-only cell turned to the
    // top-RIGHT, now rendering E-only at world cell (8,2)–(10,4).
    expect(p.rotation).toBeUndefined();
    expect(p).toMatchObject({ cellX: 6, cellY: 2, cellWidth: 4, cellHeight: 4 });
    expect(getRenderedSignature(p.cells[1] ?? null))
      .toEqual([false, false, true, false, false, false, false, false]);
    // The cell just past its right edge sees the turn: the rotated cell's
    // E point at (10,3) is that cell's W point, a mandatory connection —
    // and the cell's other borders on the turned object read as walls. A
    // flag-posed pattern read as EMPTY here (all-null constraints).
    const cs = gatherTileConstraints(turned, 10, 2, 2);
    expect(cs[6]).toBe(true); // W meets the turned tile's E
    // Tap it…
    const se = tapEntry(turned, 11, 3, grid.id); // cell (10, 2)
    // …and the merge grows the rotated object in place — same id.
    const merged = mergeTileStrokeOps(turned, se, grid.id);
    expect(merged.id).toBe(grid.id);
    expect(merged.entry.map((o) => o.op)).toEqual(['removeObject', 'placeObject']);
    const grown = merged.entry[1];
    if (grown.op !== 'placeObject') throw new Error('expected placeObject');
    expect(grown.item as PatternObject).toMatchObject({
      id: grid.id, cellX: 6, cellY: 2, cellWidth: 6, cellHeight: 4, cols: 3, rows: 2,
    });
  });

  test('a drag that starts ON the object and runs off it folds its re-roll into the growth', () => {
    const seeded = withTileObject(
      blank(), { cellX: 8, cellY: 2, cellWidth: 2, cellHeight: 2 }, 'test/tile_00000000',
    );
    const existing = seeded.patternObjects![0];
    for (let i = 0; i < 10; i++) {
      // (8,2) is the object's own cell → a re-roll; (6,2) and (4,2) are fresh.
      let working = seeded;
      const ops = [];
      for (const [x, y] of [[9, 3], [7, 3], [5, 3]] as [number, number][]) {
        const se = buildPlaceTile(
          working, x, y, LEVEL, INK, undefined, undefined, undefined, undefined, existing.id);
        if (!se) continue;
        working = applyCompOps(working, se.entry);
        ops.push(...se.entry);
      }
      if (!ops.some((o) => o.op === 'editPatternCells')) continue; // re-rolled to itself
      const merged = mergeTileStrokeOps(seeded, { entry: ops }, existing.id).entry;
      // The edit dissolved into the swap: no editPatternCells survives.
      expect(merged.map((o) => o.op)).toEqual(['removeObject', 'placeObject']);
      const placeOp = merged[1];
      if (placeOp.op !== 'placeObject') throw new Error('expected placeObject');
      const item = placeOp.item as PatternObject;
      expect(item).toMatchObject({ id: existing.id, cellX: 4, cols: 3, rows: 1 });
      expect(item.cells.every(Boolean)).toBe(true);
      // The re-rolled slot carries the NEW pick, not the seeded sprite.
      expect(item.cells[2]).not.toEqual(existing.cells[0]);
      return;
    }
    throw new Error('the crossed tile never re-rolled to a different sprite');
  });

  test('a CORNER touch is not touching — a corner is not an edge', () => {
    // Merging is written in cells sharing an EDGE, which is also what the
    // tile connectivity the whole tool rests on joins across. A diagonal
    // neighbour used to be absorbed on the strength of the boxes abutting.
    const seeded = withTileObject(blank(), SEED_BOX, 'test/tile_00000000');
    const se = tapEntry(seeded, 5, 1, SEED_ID); // cell (4,0): corner touch at (6,2)
    expect(mergeTileStrokeOps(seeded, se, SEED_ID)).toBe(se);
  });

  test('a pattern across a gap keeps to itself — TOUCHING is the whole test', () => {
    // Every compatible pattern VISIBLE on screen used to be in reach: the
    // gesture handed its rect down and a pattern showing in it was grown
    // across the gap. A page could therefore hold only one pattern per
    // grid resolution — a second one started across the canvas was
    // swallowed by the first the moment it was drawn.
    const seeded = withTileObject(
      blank(), { cellX: 10, cellY: 2, cellWidth: 2, cellHeight: 2 }, 'test/tile_00000000',
    );
    const se = tapEntry(seeded, 5, 3, 'pat_test_10_2'); // cell (4,2): a 2-cell gap to x = 10
    expect(mergeTileStrokeOps(seeded, se, 'pat_test_10_2')).toBe(se);
    const after = applyCompOps(seeded, se.entry);
    expect(after.patternObjects).toHaveLength(2);
  });

  test('a stamp laid BETWEEN two patterns takes only the OPEN one', () => {
    // A bridging stamp used to weld both neighbours into one object, which
    // rewrote a grid the user had not opened. Now the open grid grows to
    // meet the stamp and the closed one is left exactly where it stands —
    // two objects, not one.
    const left = withTileObject(
      blank(), { cellX: 2, cellY: 2, cellWidth: 2, cellHeight: 2 }, 'test/tile_00000000',
    );
    const both = withTileObject(
      left, { cellX: 6, cellY: 2, cellWidth: 2, cellHeight: 2 }, 'test/tile_00000000',
    );
    expect(both.patternObjects).toHaveLength(2);
    // The cell between them touches each on an edge; only the right-hand
    // object is open for editing.
    const se = tapEntry(both, 5, 3, 'pat_test_6_2');
    const merged = mergeTileStrokeOps(both, se, 'pat_test_6_2');
    expect(merged.entry.map((o) => o.op)).toEqual(['removeObject', 'placeObject']);
    const after = applyCompOps(both, merged.entry);
    expect(after.patternObjects).toHaveLength(2);
    const grown = after.patternObjects!.find((p) => p.id === 'pat_test_6_2')!;
    // Two cells wide: the open neighbour and the bridge beside it.
    expect(grown).toMatchObject({ cellX: 4, cellY: 2, cols: 2, rows: 1 });
    expect(grown.cells.every(Boolean)).toBe(true);
    expect(merged.id).toBe('pat_test_6_2');
    // The closed one is untouched, cell for cell.
    expect(after.patternObjects!.find((p) => p.id === 'pat_test_2_2'))
      .toEqual(both.patternObjects!.find((p) => p.id === 'pat_test_2_2'));
  });

  test('with NOTHING open, a stamp against a pattern leaves it alone', () => {
    const seeded = withTileObject(blank(), SEED_BOX, 'test/tile_00000000');
    const se = tapEntry(seeded, 5, 3); // cell (4,2), edge-adjacent at x = 6
    expect(mergeTileStrokeOps(seeded, se)).toBe(se);
    const after = applyCompOps(seeded, se.entry);
    expect(after.patternObjects).toHaveLength(2);
    expect(after.patternObjects![0]).toEqual(seeded.patternObjects![0]);
  });

  test('a HIDDEN neighbour is left alone even when the stamp lands against it', () => {
    const seeded = withTileObject(blank(), SEED_BOX, 'test/tile_00000000');
    const hidden = {
      ...seeded,
      patternObjects: seeded.patternObjects!.map((p) => ({ ...p, hidden: true })),
    };
    const seHidden = tapEntry(hidden, 5, 3, SEED_ID);
    expect(mergeTileStrokeOps(hidden, seHidden, SEED_ID)).toBe(seHidden);
  });

  test('no absorb past the 16-cell cap, across a gap, at another step, or into a locked object', () => {
    // Past the cap: a 16-wide object cannot grow another column.
    const wide = applyCompOps(blank(), [{
      op: 'placeObject',
      kind: 'pattern',
      item: {
        id: 'pat_wide', cellX: 6, cellY: 2, cellWidth: 32, cellHeight: 2,
        cols: 16, rows: 1, cells: new Array(16).fill(spriteCell('test/tile_00000000')),
      } as PatternObject,
    }]);
    const seCap = tapEntry(wide, 5, 3, 'pat_wide');
    expect(mergeTileStrokeOps(wide, seCap, 'pat_wide')).toBe(seCap);
    // A gap: one empty cell between them is not adjacency.
    const seeded = withTileObject(blank(), SEED_BOX, 'test/tile_00000000');
    const seGap = tapEntry(seeded, 3, 3, SEED_ID); // cell (2,2): one cell short of touching
    expect(mergeTileStrokeOps(seeded, seGap, SEED_ID)).toBe(seGap);
    // Another resolution: the neighbour's grid is twice as coarse.
    const coarse = withTileObject(
      blank(), { cellX: 6, cellY: 2, cellWidth: 4, cellHeight: 4 }, 'test/tile_00000000',
    );
    const seCoarse = tapEntry(coarse, 5, 3, 'pat_test_6_2');
    expect(mergeTileStrokeOps(coarse, seCoarse, 'pat_test_6_2')).toBe(seCoarse);
    // Locked: what the user pinned down stays exactly as pinned.
    const locked = {
      ...seeded,
      patternObjects: seeded.patternObjects!.map((p) => ({ ...p, locked: true })),
    };
    const seLocked = tapEntry(locked, 5, 3, SEED_ID);
    expect(mergeTileStrokeOps(locked, seLocked, SEED_ID)).toBe(seLocked);
  });
});

// Whether a tap has an OPEN grid to place into — the question the tile
// tool asks before it does anything at all. A yes places; a no clears the
// selection (the tap) or drags out a region (the press).
describe('tileTapJoinsPattern', () => {
  const LVL = 1; // step 2
  const SEED = { cellX: 6, cellY: 2, cellWidth: 2, cellHeight: 2 };
  const SEED_ID = 'pat_test_6_2';

  test('with NOTHING open, every tap answers no — the tool only creates', () => {
    // The headline rule. A pattern sits right under the finger and beside
    // it, and neither reads as somewhere to place: the press drags out a
    // fresh region instead, and the tap clears the selection.
    const seeded = withTileObject(blank(), SEED, 'test/tile_00000000');
    expect(tileTapJoinsPattern(seeded, 7, 3, LVL)).toBe(false);
    expect(tileTapJoinsPattern(seeded, 5, 3, LVL)).toBe(false);
    // Nor does some OTHER pattern being open license a stamp here.
    expect(tileTapJoinsPattern(seeded, 7, 3, LVL, 'pat_elsewhere')).toBe(false);
  });

  test('inside the OPEN grid it lands in — a filled cell or an empty slot of one', () => {
    const seeded = withTileObject(blank(), SEED, 'test/tile_00000000');
    expect(tileTapJoinsPattern(seeded, 7, 3, LVL, SEED_ID)).toBe(true);
    // A wider grid with the landing cell empty still counts: the tap fills it.
    const sparse = applyCompOps(blank(), [{
      op: 'placeObject', kind: 'pattern',
      item: {
        id: 'pat_sparse', cellX: 6, cellY: 2, cellWidth: 4, cellHeight: 2,
        cols: 2, rows: 1, cells: [spriteCell('test/tile_00000000'), null],
      } as PatternObject,
    }]);
    expect(tileTapJoinsPattern(sparse, 9, 3, LVL, 'pat_sparse')).toBe(true);
  });

  test('edge-adjacent to a filled cell of the open grid', () => {
    const seeded = withTileObject(blank(), SEED, 'test/tile_00000000');
    expect(tileTapJoinsPattern(seeded, 5, 3, LVL, SEED_ID)).toBe(true);  // left
    expect(tileTapJoinsPattern(seeded, 9, 3, LVL, SEED_ID)).toBe(true);  // right
    expect(tileTapJoinsPattern(seeded, 7, 1, LVL, SEED_ID)).toBe(true);  // above
    expect(tileTapJoinsPattern(seeded, 7, 5, LVL, SEED_ID)).toBe(true);  // below
  });

  test('but NOT diagonally, across a gap, or on empty canvas', () => {
    const seeded = withTileObject(blank(), SEED, 'test/tile_00000000');
    expect(tileTapJoinsPattern(seeded, 5, 1, LVL, SEED_ID)).toBe(false);  // corner
    expect(tileTapJoinsPattern(seeded, 3, 3, LVL, SEED_ID)).toBe(false);  // one cell short
    expect(tileTapJoinsPattern(blank(), 5, 3, LVL, SEED_ID)).toBe(false);
  });

  test('at another composition level the open grid takes the tap in its OWN space', () => {
    // Level 2 is step 4; the open grid is step 2. There is no cell of the
    // page's lattice to stamp, but an open grid is worked in its own
    // coordinates wherever the composition grid stands (tileTargetPattern
    // → buildPlaceTileInPattern), so the tap still lands in it.
    const seeded = withTileObject(blank(), SEED, 'test/tile_00000000');
    expect(tileTapJoinsPattern(seeded, 5, 3, 2, SEED_ID)).toBe(true);
    expect(tileTapJoinsPattern(seeded, 5, 3, 2)).toBe(false);
  });

  test('a hidden or locked grid cannot be open — it offers nothing to join', () => {
    const seeded = withTileObject(blank(), SEED, 'test/tile_00000000');
    for (const flag of ['hidden', 'locked'] as const) {
      const off = {
        ...seeded,
        patternObjects: seeded.patternObjects!.map((p) => ({ ...p, [flag]: true })),
      };
      expect(tileTapJoinsPattern(off, 5, 3, LVL, SEED_ID)).toBe(false);
    }
  });

  test('an OPEN pattern takes the tap in its own space — within a square of its edge', () => {
    // Its grid is its own (off the composition lattice), so the tap goes
    // into that pattern's space rather than onto the page's grid — and
    // must not read as "nothing to place against". One cell, spanning
    // world x 7..9 and y 3..5, its own step 2.
    const held = applyCompOps(blank(), [{
      op: 'placeObject', kind: 'pattern',
      item: {
        id: 'pat_held', cellX: 7, cellY: 3, cellWidth: 2, cellHeight: 2,
        cols: 1, rows: 1, cells: [spriteCell('test/tile_00000000')],
      } as PatternObject,
    }]);
    // In the cell itself, and in the squares against its four edges: the
    // grid grows to meet the stamp.
    expect(tileTapJoinsPattern(held, 8, 4, LVL, 'pat_held')).toBe(true);
    expect(tileTapJoinsPattern(held, 10, 4, LVL, 'pat_held')).toBe(true);
    expect(tileTapJoinsPattern(held, 6, 4, LVL, 'pat_held')).toBe(true);
    expect(tileTapJoinsPattern(held, 8, 2, LVL, 'pat_held')).toBe(true);
    expect(tileTapJoinsPattern(held, 8, 6, LVL, 'pat_held')).toBe(true);
    // Further out it is not the pattern's tap at all: it used to grow the
    // grid to reach WHEREVER it fell — a tap across the page turned a
    // 2×2 into a grid the width of the drawing — and now reads as
    // "nothing to place against", which clears the selection.
    expect(tileTapJoinsPattern(held, 12, 4, LVL, 'pat_held')).toBe(false);
    expect(tileTapJoinsPattern(held, 4, 4, LVL, 'pat_held')).toBe(false);
    expect(tileTapJoinsPattern(held, 8, 8, LVL, 'pat_held')).toBe(false);
    expect(tileTapJoinsPattern(held, 40, 40, LVL, 'pat_held')).toBe(false);
    expect(tileTapJoinsPattern(held, 40, 40, LVL)).toBe(false);
  });

  test('the same square of reach holds for a grid ON the composition lattice', () => {
    // The aligned path reads it more strictly still — a stamp joins where
    // it shares an EDGE with a filled cell (stampTouchesPattern) — so a
    // tap two cells out is no more its than the off-lattice one above.
    const seeded = withTileObject(blank(), SEED, 'test/tile_00000000');
    expect(tileTapJoinsPattern(seeded, 9, 3, LVL, SEED_ID)).toBe(true);
    expect(tileTapJoinsPattern(seeded, 11, 3, LVL, SEED_ID)).toBe(false);
    expect(tileTapJoinsPattern(seeded, 3, 3, LVL, SEED_ID)).toBe(false);
  });
});

// The press asks the same question: with nothing to place against, the
// drag drags out a REGION instead of laying a stroke of tiles.
describe('tileGridLevelOf', () => {
  const pane = (over: Partial<PatternObject>): PatternObject => ({
    id: 'pat_x', cellX: 16, cellY: -24, cellWidth: 48, cellHeight: 64, cols: 6, rows: 8,
    cells: new Array(48).fill(null), ...over,
  });

  it('is the level whose step is the pattern’s cell step — Window’s Center pane at 8 cells is level 3', () => {
    expect(tileGridLevelOf(pane({}))).toBe(3);
    expect(tileGridLevelOf(pane({ cellWidth: 4, cellHeight: 4, cols: 2, rows: 2 }))).toBe(1);
    expect(tileGridLevelOf(pane({ cellWidth: 3, cellHeight: 3, cols: 6, rows: 6 }))).toBe(-1);
    expect(tileGridLevelOf(pane({ cellWidth: 1, cellHeight: 1, cols: 1, rows: 1 }))).toBe(0);
  });

  it('is null when no level fits: an uneven or off-power step, or a grid the tool never joins', () => {
    expect(tileGridLevelOf(pane({ cellWidth: 48, cellHeight: 48, cols: 6, rows: 8 }))).toBeNull();
    expect(tileGridLevelOf(pane({ cellWidth: 18, cellHeight: 24, cols: 6, rows: 8 }))).toBeNull();
    expect(tileGridLevelOf(pane({ cellWidth: 0, cellHeight: 0 }))).toBeNull();
    // Posed and repeating grids never take a tap in place (findTileCellAt).
    expect(tileGridLevelOf(pane({ tileMode: 'repeat' }))).toBeNull();
    expect(tileGridLevelOf(pane({ rotation: 90 }))).toBeNull();
    expect(tileGridLevelOf(pane({ angleDeg: 15 }))).toBeNull();
    expect(tileGridLevelOf(pane({ mirrorV: true }))).toBeNull();
  });
});
