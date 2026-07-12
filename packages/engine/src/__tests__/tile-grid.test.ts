import {
  getSpiralCellOrder,
  getSpiralCellOrderInRect,
} from '../tile-grid';

describe('getSpiralCellOrder', () => {
  test('covers all cells in a 4x4 grid', () => {
    const cells = getSpiralCellOrder(4, 4);
    expect(cells.length).toBe(16);
    // All cells 0-15 should appear exactly once
    const sorted = [...cells].sort((a, b) => a - b);
    expect(sorted).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  test('covers all cells in a 3x3 grid', () => {
    const cells = getSpiralCellOrder(3, 3);
    expect(cells.length).toBe(9);
    const sorted = [...cells].sort((a, b) => a - b);
    expect(sorted).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test('1x1 grid', () => {
    expect(getSpiralCellOrder(1, 1)).toEqual([0]);
  });

  test('covers all cells in a 2x3 grid', () => {
    const cells = getSpiralCellOrder(2, 3);
    expect(cells.length).toBe(6);
    const sorted = [...cells].sort((a, b) => a - b);
    expect(sorted).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('getSpiralCellOrderInRect', () => {
  test('subrect of a larger grid', () => {
    // 8-wide grid, rect from row 1 col 1 to row 3 col 3
    const cells = getSpiralCellOrderInRect(1, 1, 3, 3, 8);
    expect(cells.length).toBe(9);
    // All cells should be in the rect
    for (const c of cells) {
      const col = c % 8;
      const row = Math.floor(c / 8);
      expect(col).toBeGreaterThanOrEqual(1);
      expect(col).toBeLessThanOrEqual(3);
      expect(row).toBeGreaterThanOrEqual(1);
      expect(row).toBeLessThanOrEqual(3);
    }
    // No duplicates
    expect(new Set(cells).size).toBe(cells.length);
  });

  test('single-cell rect', () => {
    const cells = getSpiralCellOrderInRect(2, 3, 2, 3, 8);
    expect(cells).toEqual([2 * 8 + 3]); // cell at (3,2)
  });
});
