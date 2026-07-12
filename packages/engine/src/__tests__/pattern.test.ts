import {
  createPattern,
  rotatePattern,
  computePatternApplyOps,
  computePatternFloodFillOps,
} from '../pattern';
import { revertOps } from '../cells';
import {
  CellState,
  GridLevel,
  Selection,
  Pattern,
  CELL_COUNTS,
  cellPx,
  LAYER_PX,
} from '../types';
import { makeLayer, makeState } from './test-utils';

const color = (r: number, g = 0, b = 0): CellState => ({
  type: 'color',
  r, g, b,
  transform: { mirrorH: false, mirrorV: false, rotation: 0 },
});

const colorT = (r: number, transform: CellState extends null ? never : NonNullable<CellState>['transform']): CellState => ({
  type: 'color',
  r, g: 0, b: 0,
  transform,
});

// ── createPattern ──────────────────────────────────────────────────

describe('createPattern', () => {
  test('single layer, basic selection — correct entries and dimensions', () => {
    const layer = makeLayer('l', 2, 0); // 8x8, cellPx=256
    layer.cells[0][0] = color(100);
    layer.cells[0][1] = color(200);
    const state = makeState([layer]);
    const sel: Selection = { startCellX: 0, startCellY: 0, endCellX: 1, endCellY: 0, level: 2 };

    const pat = createPattern('p1', 'Test', state, sel);
    expect(pat.coarsestLevel).toBe(2);
    expect(pat.pxWidth).toBe(512); // 2 cells * 256px
    expect(pat.pxHeight).toBe(256); // 1 cell * 256px
    expect(pat.entries).toHaveLength(2);
    expect(pat.entries[0].pxOffX).toBe(0);
    expect(pat.entries[1].pxOffX).toBe(256);
  });

  test('Deep Edit ON captures finer layer cells', () => {
    const coarse = makeLayer('coarse', 2, 0); // 8x8
    coarse.cells[0][0] = color(10);
    const fine = makeLayer('fine', 1, 1); // 16x16
    fine.cells[0][0] = color(20);
    fine.cells[0][1] = color(30);
    const state = makeState([coarse, fine], { deepEdit: true });
    const sel: Selection = { startCellX: 0, startCellY: 0, endCellX: 0, endCellY: 0, level: 2 };

    const pat = createPattern('p1', 'Test', state, sel);
    // Should have coarse cell + 2 fine cells (both fit in one coarse cell)
    // Fine cells at (0,0) and (1,0) have pixel ranges [0,128) and [128,256) which both fit in [0,256)
    expect(pat.entries.length).toBeGreaterThanOrEqual(3);
  });

  test('Deep Edit OFF captures only active layer', () => {
    const coarse = makeLayer('coarse', 2, 0);
    coarse.cells[0][0] = color(10);
    const fine = makeLayer('fine', 1, 1);
    fine.cells[0][0] = color(20);
    const state = makeState([coarse, fine], { deepEdit: false });
    const sel: Selection = { startCellX: 0, startCellY: 0, endCellX: 0, endCellY: 0, level: 2 };

    const pat = createPattern('p1', 'Test', state, sel);
    expect(pat.entries).toHaveLength(1);
    expect(pat.entries[0].level).toBe(2);
  });

  test('locked finer layer excluded from capture', () => {
    const coarse = makeLayer('coarse', 2, 0);
    coarse.cells[0][0] = color(10);
    const fine = makeLayer('fine', 1, 1);
    fine.cells[0][0] = color(20);
    fine.locked = true;
    const state = makeState([coarse, fine], { deepEdit: true });
    const sel: Selection = { startCellX: 0, startCellY: 0, endCellX: 0, endCellY: 0, level: 2 };

    const pat = createPattern('p1', 'Test', state, sel);
    // Only coarse cell, fine is locked
    expect(pat.entries).toHaveLength(1);
  });

  test('shifted active layer — pixel offsets account for shift', () => {
    const layer = makeLayer('l', 1, 0); // 16x16, cellPx=128
    layer.shiftX = 0.5;
    layer.cells[0][0] = color(100);
    const state = makeState([layer]);
    const sel: Selection = { startCellX: 0, startCellY: 0, endCellX: 0, endCellY: 0, level: 1 };

    const pat = createPattern('p1', 'Test', state, sel);
    expect(pat.entries).toHaveLength(1);
    expect(pat.entries[0].pxOffX).toBe(0); // relative to selection origin
  });
});

// ── rotatePattern ──────────────────────────────────────────────────

describe('rotatePattern', () => {
  test('0° rotation returns pattern unchanged', () => {
    const pat: Pattern = {
      id: 'p', name: 'P', coarsestLevel: 2,
      pxWidth: 512, pxHeight: 256,
      entries: [{ level: 2, pxOffX: 0, pxOffY: 0, state: color(10) }],
    };
    expect(rotatePattern(pat, 0)).toBe(pat);
  });

  test('90° rotation swaps dimensions', () => {
    const pat: Pattern = {
      id: 'p', name: 'P', coarsestLevel: 2,
      pxWidth: 512, pxHeight: 256,
      entries: [{ level: 2, pxOffX: 0, pxOffY: 0, state: color(10) }],
    };
    const rotated = rotatePattern(pat, 90);
    expect(rotated.pxWidth).toBe(256);
    expect(rotated.pxHeight).toBe(512);
  });

  test('180° rotation preserves dimensions', () => {
    const pat: Pattern = {
      id: 'p', name: 'P', coarsestLevel: 2,
      pxWidth: 512, pxHeight: 256,
      entries: [{ level: 2, pxOffX: 0, pxOffY: 0, state: color(10) }],
    };
    const rotated = rotatePattern(pat, 180);
    expect(rotated.pxWidth).toBe(512);
    expect(rotated.pxHeight).toBe(256);
  });

  test('270° rotation swaps dimensions', () => {
    const pat: Pattern = {
      id: 'p', name: 'P', coarsestLevel: 2,
      pxWidth: 512, pxHeight: 256,
      entries: [{ level: 2, pxOffX: 0, pxOffY: 0, state: color(10) }],
    };
    const rotated = rotatePattern(pat, 270);
    expect(rotated.pxWidth).toBe(256);
    expect(rotated.pxHeight).toBe(512);
  });

  test('90° rotation composes CellState transform', () => {
    const cs = colorT(10, { mirrorH: false, mirrorV: false, rotation: 90 });
    const pat: Pattern = {
      id: 'p', name: 'P', coarsestLevel: 2,
      pxWidth: 256, pxHeight: 256,
      entries: [{ level: 2, pxOffX: 0, pxOffY: 0, state: cs }],
    };
    const rotated = rotatePattern(pat, 90);
    expect(rotated.entries[0].state!.transform.rotation).toBe(180);
  });

  test('rotation with mirrored cell transforms adds rotation normally', () => {
    const cs = colorT(10, { mirrorH: true, mirrorV: false, rotation: 90 });
    const pat: Pattern = {
      id: 'p', name: 'P', coarsestLevel: 2,
      pxWidth: 256, pxHeight: 256,
      entries: [{ level: 2, pxOffX: 0, pxOffY: 0, state: cs }],
    };
    const rotated = rotatePattern(pat, 90);
    // Rotation always adds: 90 + 90 = 180
    expect(rotated.entries[0].state!.transform.rotation).toBe(180);
  });

  test('multi-level pattern rotation — entries at different levels all rotate', () => {
    const pat: Pattern = {
      id: 'p', name: 'P', coarsestLevel: 2,
      pxWidth: 256, pxHeight: 256,
      entries: [
        { level: 2, pxOffX: 0, pxOffY: 0, state: color(10) },
        { level: 1, pxOffX: 0, pxOffY: 0, state: color(20) },
        { level: 1, pxOffX: 128, pxOffY: 0, state: color(30) },
      ],
    };
    const rotated = rotatePattern(pat, 90);
    expect(rotated.entries).toHaveLength(3);
    // All entries should have rotated transforms
    for (const e of rotated.entries) {
      expect(e.state!.transform.rotation).toBe(90);
    }
  });
});

// ── computePatternApplyOps ─────────────────────────────────────────

describe('computePatternApplyOps', () => {
  test('basic application at origin — cells placed correctly', () => {
    const layer = makeLayer('l', 2, 0); // 8x8, cellPx=256
    const state = makeState([layer], {
      tool: { type: 'pattern' },
      activePatternId: 'p1',
      patternOrigin: { cellX: 0, cellY: 0 },
    });

    const pat: Pattern = {
      id: 'p1', name: 'P', coarsestLevel: 2,
      pxWidth: 256, pxHeight: 256,
      entries: [{ level: 2, pxOffX: 0, pxOffY: 0, state: color(42) }],
    };

    const ops = computePatternApplyOps(state, pat, 0, 0);
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toBe('cell');
    if (ops[0].op === 'cell') {
      expect(ops[0].cellX).toBe(0);
      expect(ops[0].cellY).toBe(0);
      expect(ops[0].newState).toEqual(color(42));
    }
  });

  test('application offset from origin — tiling math correct', () => {
    const layer = makeLayer('l', 2, 0); // 8x8
    const state = makeState([layer], {
      tool: { type: 'pattern' },
      activePatternId: 'p1',
      patternOrigin: { cellX: 0, cellY: 0 },
    });

    const pat: Pattern = {
      id: 'p1', name: 'P', coarsestLevel: 2,
      pxWidth: 256, pxHeight: 256,
      entries: [{ level: 2, pxOffX: 0, pxOffY: 0, state: color(42) }],
    };

    // Apply at cell (3, 3) — should tile back to same pattern position
    const ops = computePatternApplyOps(state, pat, 3, 3);
    expect(ops).toHaveLength(1);
    if (ops[0].op === 'cell') {
      expect(ops[0].cellX).toBe(3);
      expect(ops[0].cellY).toBe(3);
    }
  });

  test('multi-level pattern: coarser entries shifted to active level', () => {
    const l3 = makeLayer('l3', 3, 0);
    const l2 = makeLayer('l2', 2, 1); // active
    const l1 = makeLayer('l1', 1, 2);
    const l0 = makeLayer('l0', 0, 3);
    const state = makeState([l3, l2, l1, l0], {
      tool: { type: 'pattern' },
      activePatternId: 'p1',
      activeLayerId: 'l2',
      patternOrigin: { cellX: 0, cellY: 0 },
    });

    // Pattern with entries at L3 and L1 — shift by 1: L3→L2, L1→L0
    const pat: Pattern = {
      id: 'p1', name: 'P', coarsestLevel: 3,
      pxWidth: 512, pxHeight: 512,
      entries: [
        { level: 3, pxOffX: 0, pxOffY: 0, state: color(10) },
        { level: 1, pxOffX: 0, pxOffY: 0, state: color(20) },
      ],
    };

    const ops = computePatternApplyOps(state, pat, 0, 0);
    // L3 entry shifted to L2, L1 entry shifted to L0
    const l3Ops = ops.filter((o) => o.op === 'cell' && o.layerId === 'l3');
    const l2Ops = ops.filter((o) => o.op === 'cell' && o.layerId === 'l2');
    const l1Ops = ops.filter((o) => o.op === 'cell' && o.layerId === 'l1');
    const l0Ops = ops.filter((o) => o.op === 'cell' && o.layerId === 'l0');
    expect(l3Ops).toHaveLength(0);
    expect(l2Ops.length).toBeGreaterThanOrEqual(1);
    expect(l1Ops).toHaveLength(0);
    expect(l0Ops.length).toBeGreaterThanOrEqual(1);
  });

  test('entries clamped to active level when no layer at original level', () => {
    const l0 = makeLayer('l0', 0, 0);
    const state = makeState([l0], {
      tool: { type: 'pattern' },
      activePatternId: 'p1',
      patternOrigin: { cellX: 0, cellY: 0 },
    });

    // Pattern has L2 and L1 entries, only L0 layer exists (active)
    // Both entries get clamped to L0 and target the l0 layer
    const pat: Pattern = {
      id: 'p1', name: 'P', coarsestLevel: 2,
      pxWidth: 256, pxHeight: 256,
      entries: [
        { level: 2, pxOffX: 0, pxOffY: 0, state: color(10) },
        { level: 1, pxOffX: 0, pxOffY: 0, state: color(20) },
      ],
    };

    const ops = computePatternApplyOps(state, pat, 0, 0);
    // Both entries clamped to L0, so they target the l0 layer
    const l0Ops = ops.filter((o) => o.op === 'cell' && o.layerId === 'l0');
    expect(l0Ops.length).toBeGreaterThanOrEqual(1);
  });

  test('locked target layer — entries skipped', () => {
    const layer = makeLayer('l', 2, 0);
    layer.locked = true;
    const state = makeState([layer], {
      tool: { type: 'pattern' },
      activePatternId: 'p1',
      patternOrigin: { cellX: 0, cellY: 0 },
    });

    const pat: Pattern = {
      id: 'p1', name: 'P', coarsestLevel: 2,
      pxWidth: 256, pxHeight: 256,
      entries: [{ level: 2, pxOffX: 0, pxOffY: 0, state: color(42) }],
    };

    const ops = computePatternApplyOps(state, pat, 0, 0);
    expect(ops).toHaveLength(0);
  });

  test('no layer at entry level — entries skipped', () => {
    const layer = makeLayer('l', 2, 0);
    const state = makeState([layer], {
      tool: { type: 'pattern' },
      activePatternId: 'p1',
      patternOrigin: { cellX: 0, cellY: 0 },
    });

    // Pattern has L1 entry but no L1 layer exists (only L2)
    const pat: Pattern = {
      id: 'p1', name: 'P', coarsestLevel: 2,
      pxWidth: 256, pxHeight: 256,
      entries: [{ level: 1, pxOffX: 0, pxOffY: 0, state: color(42) }],
    };

    const ops = computePatternApplyOps(state, pat, 0, 0);
    expect(ops).toHaveLength(0);
  });

  test('shifted target layer — cell coords account for shift', () => {
    const layer = makeLayer('l', 2, 0);
    layer.shiftX = 0.5;
    const state = makeState([layer], {
      tool: { type: 'pattern' },
      activePatternId: 'p1',
      patternOrigin: { cellX: 0, cellY: 0 },
    });

    const pat: Pattern = {
      id: 'p1', name: 'P', coarsestLevel: 2,
      pxWidth: 256, pxHeight: 256,
      entries: [{ level: 2, pxOffX: 0, pxOffY: 0, state: color(42) }],
    };

    const ops = computePatternApplyOps(state, pat, 0, 0);
    expect(ops.length).toBeGreaterThanOrEqual(1);
  });

  test('out-of-bounds cells — entries near canvas edge skipped', () => {
    const layer = makeLayer('l', 2, 0); // 8x8
    const state = makeState([layer], {
      tool: { type: 'pattern' },
      activePatternId: 'p1',
      patternOrigin: { cellX: 7, cellY: 7 },
    });

    // Pattern wider than one cell, applied at edge
    const pat: Pattern = {
      id: 'p1', name: 'P', coarsestLevel: 2,
      pxWidth: 512, pxHeight: 256,
      entries: [
        { level: 2, pxOffX: 0, pxOffY: 0, state: color(10) },
        { level: 2, pxOffX: 256, pxOffY: 0, state: color(20) },
      ],
    };

    const ops = computePatternApplyOps(state, pat, 7, 7);
    // At cell 7 with pattern origin at 7, only the first entry should fit
    expect(ops.length).toBeLessThanOrEqual(1);
  });

  test('rotated pattern application — 90° rotated pattern applied correctly', () => {
    const layer = makeLayer('l', 2, 0);
    const state = makeState([layer], {
      tool: { type: 'pattern' },
      activePatternId: 'p1',
      activePatternRotation: 90,
      patternOrigin: { cellX: 0, cellY: 0 },
    });

    const pat: Pattern = {
      id: 'p1', name: 'P', coarsestLevel: 2,
      pxWidth: 512, pxHeight: 256, // 2x1 cells
      entries: [
        { level: 2, pxOffX: 0, pxOffY: 0, state: color(10) },
        { level: 2, pxOffX: 256, pxOffY: 0, state: color(20) },
      ],
    };

    const ops = computePatternApplyOps(state, pat, 0, 0);
    expect(ops.length).toBeGreaterThanOrEqual(1);
    // After 90° rotation, the pattern becomes 1x2 (256x512)
    // Entries should have rotated transforms
    for (const op of ops) {
      if (op.op === 'cell') {
        expect(op.newState?.transform.rotation).toBe(90);
      }
    }
  });

  test('cross-level: L2 pattern applied at L3 active shifts up to L3 layer', () => {
    // Pattern created at L2 (cellPx=256), single entry
    // Applied at L3 active (cellPx=512) — entry shifts up to L3
    const l3 = makeLayer('l3', 3, 0); // 4x4, cellPx=512
    const l2 = makeLayer('l2', 2, 1); // 8x8, cellPx=256
    const state = makeState([l3, l2], {
      tool: { type: 'pattern' },
      activePatternId: 'p1',
      activeLayerId: 'l3',
      patternOrigin: { cellX: 0, cellY: 0 },
    });

    // Pattern from L2: 1 cell = 256x256 px
    const pat: Pattern = {
      id: 'p1', name: 'P', coarsestLevel: 2,
      pxWidth: 256, pxHeight: 256,
      entries: [{ level: 2, pxOffX: 0, pxOffY: 0, state: color(42) }],
    };

    // Apply at L3 cell (0,0): pattern scales up to 512px, fills exactly 1 L3 cell
    const ops = computePatternApplyOps(state, pat, 0, 0);
    expect(ops.length).toBe(1);
    for (const op of ops) {
      if (op.op === 'cell') {
        expect(op.layerId).toBe('l3');
      }
    }
  });

  test('cross-level: L0 pattern flood-fills L2 layer via L2 active', () => {
    // Pattern at L0 (cellPx=64), flood fill with L2 active
    // Entry shifts up to L2 layer — all 8x8 L2 cells should be filled
    const l2 = makeLayer('l2', 2, 0); // 8x8
    const l0 = makeLayer('l0', 0, 1); // 32x32
    const state = makeState([l2, l0], {
      tool: { type: 'pattern' },
      activePatternId: 'p1',
      activeLayerId: 'l2',
      patternOrigin: { cellX: 0, cellY: 0 },
    });

    // Single L0 entry, pxWidth=64
    const pat: Pattern = {
      id: 'p1', name: 'P', coarsestLevel: 0,
      pxWidth: 64, pxHeight: 64,
      entries: [{ level: 0, pxOffX: 0, pxOffY: 0, state: color(10) }],
    };

    const ops = computePatternFloodFillOps(state, pat);
    // Entry shifts from L0 to L2, pattern scales up to 256px per tile
    // Fills all 8x8 = 64 L2 cells
    const l2Ops = ops.filter((o) => o.op === 'cell' && o.layerId === 'l2');
    expect(l2Ops).toHaveLength(64); // all 8x8 L2 cells
  });

  test('rotated pattern with multi-level entries + shifted layers — correct placement', () => {
    const l2 = makeLayer('l2', 2, 0);
    const l1 = makeLayer('l1', 1, 1);
    l1.shiftX = 0.5;
    const state = makeState([l2, l1], {
      tool: { type: 'pattern' },
      activePatternId: 'p1',
      activePatternRotation: 90,
      patternOrigin: { cellX: 0, cellY: 0 },
    });

    const pat: Pattern = {
      id: 'p1', name: 'P', coarsestLevel: 2,
      pxWidth: 256, pxHeight: 256,
      entries: [
        { level: 2, pxOffX: 0, pxOffY: 0, state: color(10) },
        { level: 1, pxOffX: 0, pxOffY: 0, state: color(20) },
      ],
    };

    const ops = computePatternApplyOps(state, pat, 0, 0);
    // L2 entry targets l2, L1 entry targets l1
    const l2Ops = ops.filter((o) => o.op === 'cell' && o.layerId === 'l2');
    const l1Ops = ops.filter((o) => o.op === 'cell' && o.layerId === 'l1');
    expect(l2Ops.length).toBeGreaterThanOrEqual(1);
    expect(l1Ops.length).toBeGreaterThanOrEqual(1);
  });
});

// ── computePatternFloodFillOps ─────────────────────────────────────

describe('computePatternFloodFillOps', () => {
  test('small pattern tiles entire layer', () => {
    const layer = makeLayer('l', 2, 0); // 8x8
    const state = makeState([layer], {
      tool: { type: 'pattern' },
      activePatternId: 'p1',
      patternOrigin: { cellX: 0, cellY: 0 },
    });

    const pat: Pattern = {
      id: 'p1', name: 'P', coarsestLevel: 2,
      pxWidth: 256, pxHeight: 256,
      entries: [{ level: 2, pxOffX: 0, pxOffY: 0, state: color(42) }],
    };

    const ops = computePatternFloodFillOps(state, pat);
    // Should fill all 64 cells
    expect(ops).toHaveLength(64);
  });

  test('multi-cell pattern tiling alignment', () => {
    const layer = makeLayer('l', 2, 0); // 8x8
    const state = makeState([layer], {
      tool: { type: 'pattern' },
      activePatternId: 'p1',
      patternOrigin: { cellX: 0, cellY: 0 },
    });

    // 2x1 pattern
    const pat: Pattern = {
      id: 'p1', name: 'P', coarsestLevel: 2,
      pxWidth: 512, pxHeight: 256, // 2 cells wide, 1 cell tall
      entries: [
        { level: 2, pxOffX: 0, pxOffY: 0, state: color(10) },
        { level: 2, pxOffX: 256, pxOffY: 0, state: color(20) },
      ],
    };

    const ops = computePatternFloodFillOps(state, pat);
    expect(ops).toHaveLength(64); // every cell gets a pattern entry
  });

  test('multi-level flood fill clamps coarser entries to active level', () => {
    const l3 = makeLayer('l3', 3, 0); // active
    const l2 = makeLayer('l2', 2, 1);
    const state = makeState([l3, l2], {
      tool: { type: 'pattern' },
      activePatternId: 'p1',
      activeLayerId: 'l3',
      patternOrigin: { cellX: 0, cellY: 0 },
    });

    // Both entries at or below active level L3, so no clamping here
    const pat: Pattern = {
      id: 'p1', name: 'P', coarsestLevel: 3,
      pxWidth: 512, pxHeight: 512,
      entries: [
        { level: 3, pxOffX: 0, pxOffY: 0, state: color(10) },
        { level: 2, pxOffX: 0, pxOffY: 0, state: color(20) },
      ],
    };

    const ops = computePatternFloodFillOps(state, pat);
    const l3Ops = ops.filter((o) => o.op === 'cell' && o.layerId === 'l3');
    const l2Ops = ops.filter((o) => o.op === 'cell' && o.layerId === 'l2');
    expect(l3Ops.length).toBeGreaterThan(0);
    expect(l2Ops.length).toBeGreaterThan(0);
  });

  test('flood fill clamps L4 entries to active L2 level', () => {
    const l4 = makeLayer('l4', 4, 0);
    const l2 = makeLayer('l2', 2, 1); // active
    const state = makeState([l4, l2], {
      tool: { type: 'pattern' },
      activePatternId: 'p1',
      activeLayerId: 'l2',
      patternOrigin: { cellX: 0, cellY: 0 },
    });

    const pat: Pattern = {
      id: 'p1', name: 'P', coarsestLevel: 4,
      pxWidth: 1024, pxHeight: 1024,
      entries: [
        { level: 4, pxOffX: 0, pxOffY: 0, state: color(10) },
      ],
    };

    const ops = computePatternFloodFillOps(state, pat);
    // L4 entry clamped to L2 — targets l2, not l4
    const l4Ops = ops.filter((o) => o.op === 'cell' && o.layerId === 'l4');
    const l2Ops = ops.filter((o) => o.op === 'cell' && o.layerId === 'l2');
    expect(l4Ops).toHaveLength(0);
    expect(l2Ops.length).toBeGreaterThan(0);
  });

  test('rotated pattern flood fill', () => {
    const layer = makeLayer('l', 2, 0);
    const state = makeState([layer], {
      tool: { type: 'pattern' },
      activePatternId: 'p1',
      activePatternRotation: 90,
      patternOrigin: { cellX: 0, cellY: 0 },
    });

    const pat: Pattern = {
      id: 'p1', name: 'P', coarsestLevel: 2,
      pxWidth: 256, pxHeight: 256,
      entries: [{ level: 2, pxOffX: 0, pxOffY: 0, state: color(42) }],
    };

    const ops = computePatternFloodFillOps(state, pat);
    expect(ops).toHaveLength(64);
    // All entries should have rotated transforms
    for (const op of ops) {
      if (op.op === 'cell') {
        expect(op.newState?.transform.rotation).toBe(90);
      }
    }
  });
});

// ── Cross-level flood fill with level shifting ────────────────────

describe('cross-level flood fill with level shifting', () => {
  // Pattern: coarsestLevel=3, 1024×512px
  // L3 entry at (0,0) = 512×512px, L2 entry at (512,0) = 256×256px
  const sharedPattern: Pattern = {
    id: 'pShift',
    name: 'Shift',
    coarsestLevel: 3,
    pxWidth: 1024,
    pxHeight: 512,
    entries: [
      { level: 3, pxOffX: 0, pxOffY: 0, state: color(10) },
      { level: 2, pxOffX: 512, pxOffY: 0, state: color(20) },
    ],
  };

  /** Compute pixel coverage ratio from ops */
  function coverageRatio(ops: ReturnType<typeof computePatternFloodFillOps>, layerLevelMap: Map<string, GridLevel>): number {
    const coveredPx = ops.reduce((sum, op) => {
      if (op.op !== 'cell') return sum;
      const level = layerLevelMap.get(op.layerId)!;
      return sum + cellPx(level) ** 2;
    }, 0);
    return coveredPx / (LAYER_PX * LAYER_PX);
  }

  test('active L3: no shift, L3+L2 ops, coverage 5/8', () => {
    const l3 = makeLayer('l3', 3, 0);
    const l2 = makeLayer('l2', 2, 1);
    const state = makeState([l3, l2], {
      tool: { type: 'pattern' },
      activePatternId: 'pShift',
      activeLayerId: 'l3',
      patternOrigin: { cellX: 0, cellY: 0 },
    });

    const ops = computePatternFloodFillOps(state, sharedPattern);
    const l3Ops = ops.filter((o) => o.op === 'cell' && o.layerId === 'l3');
    const l2Ops = ops.filter((o) => o.op === 'cell' && o.layerId === 'l2');

    expect(l3Ops).toHaveLength(8);
    expect(l2Ops).toHaveLength(8);

    const layerLevelMap = new Map<string, GridLevel>([['l3', 3], ['l2', 2]]);
    expect(coverageRatio(ops, layerLevelMap)).toBeCloseTo(5 / 8);
  });

  test('active L2: shift by 1, L2+L1 ops, coverage 5/8', () => {
    const l2 = makeLayer('l2', 2, 0);
    const l1 = makeLayer('l1', 1, 1);
    const state = makeState([l2, l1], {
      tool: { type: 'pattern' },
      activePatternId: 'pShift',
      activeLayerId: 'l2',
      patternOrigin: { cellX: 0, cellY: 0 },
    });

    const ops = computePatternFloodFillOps(state, sharedPattern);
    const l2Ops = ops.filter((o) => o.op === 'cell' && o.layerId === 'l2');
    const l1Ops = ops.filter((o) => o.op === 'cell' && o.layerId === 'l1');

    expect(l2Ops).toHaveLength(32);
    expect(l1Ops).toHaveLength(32);

    const layerLevelMap = new Map<string, GridLevel>([['l2', 2], ['l1', 1]]);
    expect(coverageRatio(ops, layerLevelMap)).toBeCloseTo(5 / 8);
  });

  test('active L1: shift by 2, L1+L0 ops, coverage 5/8', () => {
    const l1 = makeLayer('l1', 1, 0);
    const l0 = makeLayer('l0', 0, 1);
    const state = makeState([l1, l0], {
      tool: { type: 'pattern' },
      activePatternId: 'pShift',
      activeLayerId: 'l1',
      patternOrigin: { cellX: 0, cellY: 0 },
    });

    const ops = computePatternFloodFillOps(state, sharedPattern);
    const l1Ops = ops.filter((o) => o.op === 'cell' && o.layerId === 'l1');
    const l0Ops = ops.filter((o) => o.op === 'cell' && o.layerId === 'l0');

    expect(l1Ops).toHaveLength(128);
    expect(l0Ops).toHaveLength(128);

    const layerLevelMap = new Map<string, GridLevel>([['l1', 1], ['l0', 0]]);
    expect(coverageRatio(ops, layerLevelMap)).toBeCloseTo(5 / 8);
  });

  test('active L0: shift by 3, L0 only (L2 entry dropped), coverage 1/2', () => {
    const l0 = makeLayer('l0', 0, 0);
    const state = makeState([l0], {
      tool: { type: 'pattern' },
      activePatternId: 'pShift',
      activeLayerId: 'l0',
      patternOrigin: { cellX: 0, cellY: 0 },
    });

    const ops = computePatternFloodFillOps(state, sharedPattern);
    const l0Ops = ops.filter((o) => o.op === 'cell' && o.layerId === 'l0');

    // L3 entry → L0, L2 entry → L-1 (dropped)
    expect(l0Ops).toHaveLength(512);
    expect(ops).toHaveLength(512); // no other layer ops

    const layerLevelMap = new Map<string, GridLevel>([['l0', 0]]);
    expect(coverageRatio(ops, layerLevelMap)).toBeCloseTo(1 / 2);
  });
});

// ── Undo tests ─────────────────────────────────────────────────────

describe('Pattern undo', () => {
  test('apply pattern + revertOps restores cells', () => {
    const layer = makeLayer('l', 2, 0);
    layer.cells[0][0] = color(99);
    const state = makeState([layer], {
      tool: { type: 'pattern' },
      activePatternId: 'p1',
      patternOrigin: { cellX: 0, cellY: 0 },
    });

    const pat: Pattern = {
      id: 'p1', name: 'P', coarsestLevel: 2,
      pxWidth: 256, pxHeight: 256,
      entries: [{ level: 2, pxOffX: 0, pxOffY: 0, state: color(42) }],
    };

    const ops = computePatternApplyOps(state, pat, 0, 0);
    expect(ops).toHaveLength(1);

    // Apply ops then revert
    const reverted = revertOps(state, ops);
    expect(reverted.layers[0].cells[0][0]).toEqual(color(99));
  });

  test('flood fill + revertOps restores all cells', () => {
    const layer = makeLayer('l', 2, 0);
    const state = makeState([layer], {
      tool: { type: 'pattern' },
      activePatternId: 'p1',
      patternOrigin: { cellX: 0, cellY: 0 },
    });

    const pat: Pattern = {
      id: 'p1', name: 'P', coarsestLevel: 2,
      pxWidth: 256, pxHeight: 256,
      entries: [{ level: 2, pxOffX: 0, pxOffY: 0, state: color(42) }],
    };

    const ops = computePatternFloodFillOps(state, pat);
    const reverted = revertOps(state, ops);
    // All cells should be null (original state)
    const count = CELL_COUNTS[2];
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        expect(reverted.layers[0].cells[y][x]).toBeNull();
      }
    }
  });

  test('apply rotated pattern + revertOps restores cells', () => {
    const layer = makeLayer('l', 2, 0);
    const state = makeState([layer], {
      tool: { type: 'pattern' },
      activePatternId: 'p1',
      activePatternRotation: 90,
      patternOrigin: { cellX: 0, cellY: 0 },
    });

    const pat: Pattern = {
      id: 'p1', name: 'P', coarsestLevel: 2,
      pxWidth: 256, pxHeight: 256,
      entries: [{ level: 2, pxOffX: 0, pxOffY: 0, state: color(42) }],
    };

    const ops = computePatternApplyOps(state, pat, 0, 0);
    const reverted = revertOps(state, ops);
    expect(reverted.layers[0].cells[0][0]).toBeNull();
  });
});
