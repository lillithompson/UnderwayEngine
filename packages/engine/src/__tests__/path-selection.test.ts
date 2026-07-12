import { isCellInPathSelection, pathIndicesToL0 } from '../path-selection';

describe('isCellInPathSelection', () => {
  test('empty set returns true (no constraint)', () => {
    const empty = new Set<number>();
    expect(isCellInPathSelection(empty, 0, 0, 5, 5)).toBe(true);
    expect(isCellInPathSelection(empty, 1, 2, 3, 3)).toBe(true);
  });

  test('same level — direct lookup', () => {
    // L0: 32x32 grid, select cell (2,3) => index 3*32+2 = 98
    const indices = new Set([98]);
    expect(isCellInPathSelection(indices, 0, 0, 2, 3)).toBe(true);
    expect(isCellInPathSelection(indices, 0, 0, 3, 3)).toBe(false);
    expect(isCellInPathSelection(indices, 0, 0, 2, 4)).toBe(false);
  });

  test('target finer (lower level) — parent check', () => {
    // Path at L1 (16x16), select cell (1,1) => index 1*16+1 = 17
    // L0 cell (2,2) maps to L1 cell (1,1) since ratio = 32/16 = 2
    // L0 cell (3,3) also maps to L1 cell (1,1)
    // L0 cell (4,2) maps to L1 cell (2,1) — not selected
    const indices = new Set([17]);
    expect(isCellInPathSelection(indices, 1, 0, 2, 2)).toBe(true);
    expect(isCellInPathSelection(indices, 1, 0, 3, 3)).toBe(true);
    expect(isCellInPathSelection(indices, 1, 0, 4, 2)).toBe(false);
  });

  test('target coarser (higher level) — all sub-cells must be selected', () => {
    // Path at L0 (32x32), target L1 (16x16)
    // L1 cell (1,1) requires ALL 4 L0 sub-cells: (2,2),(3,2),(2,3),(3,3)
    // Indices: 2*32+2=66, 2*32+3=67, 3*32+2=98, 3*32+3=99
    const allFour = new Set([66, 67, 98, 99]);
    expect(isCellInPathSelection(allFour, 0, 1, 1, 1)).toBe(true);

    // Missing one sub-cell
    const threeFour = new Set([66, 67, 98]);
    expect(isCellInPathSelection(threeFour, 0, 1, 1, 1)).toBe(false);
  });

  test('target two levels coarser', () => {
    // Path at L0 (32x32), target L2 (8x8)
    // L2 cell (0,0) requires all 16 L0 sub-cells in (0..3, 0..3)
    // ratio = 32/8 = 4
    const all16 = new Set<number>();
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        all16.add(dy * 32 + dx);
      }
    }
    expect(isCellInPathSelection(all16, 0, 2, 0, 0)).toBe(true);

    // Remove one
    all16.delete(0);
    expect(isCellInPathSelection(all16, 0, 2, 0, 0)).toBe(false);
  });
});

describe('pathIndicesToL0', () => {
  test('L0 indices pass through', () => {
    const indices = new Set([0, 5, 100]);
    const result = pathIndicesToL0(indices, 0);
    expect(result).toEqual(indices);
  });

  test('L1 index expands to 4 L0 cells', () => {
    // L1 cell (0,0) => L0 cells (0,0),(1,0),(0,1),(1,1)
    // L1 count=16, ratio=2
    const indices = new Set([0]); // L1 cell (0,0)
    const result = pathIndicesToL0(indices, 1);
    expect(result.size).toBe(4);
    expect(result.has(0 * 32 + 0)).toBe(true); // (0,0)
    expect(result.has(0 * 32 + 1)).toBe(true); // (1,0)
    expect(result.has(1 * 32 + 0)).toBe(true); // (0,1)
    expect(result.has(1 * 32 + 1)).toBe(true); // (1,1)
  });

  test('L1 cell (1,1) expands correctly', () => {
    // L1 cell (1,1) = index 1*16+1 = 17
    // Expands to L0 cells (2,2),(3,2),(2,3),(3,3)
    const indices = new Set([17]);
    const result = pathIndicesToL0(indices, 1);
    expect(result.size).toBe(4);
    expect(result.has(2 * 32 + 2)).toBe(true);
    expect(result.has(2 * 32 + 3)).toBe(true);
    expect(result.has(3 * 32 + 2)).toBe(true);
    expect(result.has(3 * 32 + 3)).toBe(true);
  });

  test('L2 index expands to 16 L0 cells', () => {
    // L2 cell (0,0) => 4x4 = 16 L0 cells
    const indices = new Set([0]);
    const result = pathIndicesToL0(indices, 2);
    expect(result.size).toBe(16);
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        expect(result.has(dy * 32 + dx)).toBe(true);
      }
    }
  });

  test('multiple indices expand correctly', () => {
    // Two L1 cells: (0,0) and (1,0) => 8 L0 cells total
    const indices = new Set([0, 1]);
    const result = pathIndicesToL0(indices, 1);
    expect(result.size).toBe(8);
  });
});
