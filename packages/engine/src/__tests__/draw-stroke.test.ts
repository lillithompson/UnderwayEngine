import {
  getDirectionFromTo,
  oppositeDirection,
  getLineCells,
  getStrokeNeighborDirections,
} from '../draw-stroke';

describe('getDirectionFromTo', () => {
  const columns = 8;

  test('returns correct cardinal directions', () => {
    // N: from (3,3) to (3,2) → cell 3*8+3=27 to 2*8+3=19
    expect(getDirectionFromTo(27, 19, columns)).toBe(0); // N
    // E: from (3,3) to (4,3) → 27 to 28
    expect(getDirectionFromTo(27, 28, columns)).toBe(2); // E
    // S: from (3,3) to (3,4) → 27 to 35
    expect(getDirectionFromTo(27, 35, columns)).toBe(4); // S
    // W: from (3,3) to (2,3) → 27 to 26
    expect(getDirectionFromTo(27, 26, columns)).toBe(6); // W
  });

  test('returns correct diagonal directions', () => {
    // NE: from (3,3) to (4,2) → 27 to 20
    expect(getDirectionFromTo(27, 20, columns)).toBe(1); // NE
    // SE: from (3,3) to (4,4) → 27 to 36
    expect(getDirectionFromTo(27, 36, columns)).toBe(3); // SE
    // SW: from (3,3) to (2,4) → 27 to 34
    expect(getDirectionFromTo(27, 34, columns)).toBe(5); // SW
    // NW: from (3,3) to (2,2) → 27 to 18
    expect(getDirectionFromTo(27, 18, columns)).toBe(7); // NW
  });

  test('returns -1 for non-adjacent cells', () => {
    expect(getDirectionFromTo(0, 16, columns)).toBe(-1); // 2 rows apart
    expect(getDirectionFromTo(0, 2, columns)).toBe(-1);  // 2 cols apart
  });

  test('returns -1 for same cell', () => {
    expect(getDirectionFromTo(10, 10, columns)).toBe(-1);
  });
});

describe('oppositeDirection', () => {
  test('N↔S', () => {
    expect(oppositeDirection(0)).toBe(4);
    expect(oppositeDirection(4)).toBe(0);
  });

  test('NE↔SW', () => {
    expect(oppositeDirection(1)).toBe(5);
    expect(oppositeDirection(5)).toBe(1);
  });

  test('E↔W', () => {
    expect(oppositeDirection(2)).toBe(6);
    expect(oppositeDirection(6)).toBe(2);
  });
});

describe('getLineCells', () => {
  const columns = 8;

  test('horizontal line', () => {
    // From (1,0) to (4,0) → cells 1,2,3,4
    const cells = getLineCells(1, 4, columns);
    expect(cells).toEqual([1, 2, 3, 4]);
  });

  test('vertical line', () => {
    // From (0,0) to (0,3) → cells 0,8,16,24
    const cells = getLineCells(0, 24, columns);
    expect(cells).toEqual([0, 8, 16, 24]);
  });

  test('diagonal line', () => {
    // From (0,0) to (2,2) → cells 0,9,18
    const cells = getLineCells(0, 18, columns);
    expect(cells).toEqual([0, 9, 18]);
  });

  test('single cell (same start and end)', () => {
    const cells = getLineCells(5, 5, columns);
    expect(cells).toEqual([5]);
  });

  test('consecutive pairs are 8-adjacent', () => {
    const cells = getLineCells(0, 23, columns); // (0,0) to (7,2)
    for (let i = 0; i < cells.length - 1; i++) {
      const dir = getDirectionFromTo(cells[i], cells[i + 1], columns);
      expect(dir).toBeGreaterThanOrEqual(0);
      expect(dir).toBeLessThan(8);
    }
  });
});

describe('getStrokeNeighborDirections', () => {
  const columns = 8;

  test('single-cell stroke returns empty', () => {
    expect(getStrokeNeighborDirections([10], 0, columns)).toEqual([]);
  });

  test('first cell of multi-cell stroke returns direction to next', () => {
    // Stroke: cells 0, 1 (horizontal). At index 0, direction to next is E(2)
    const dirs = getStrokeNeighborDirections([0, 1], 0, columns);
    expect(dirs).toEqual([2]); // E
  });

  test('last cell returns direction to prev', () => {
    const dirs = getStrokeNeighborDirections([0, 1], 1, columns);
    expect(dirs).toEqual([6]); // W (back to prev)
  });

  test('intermediate cell returns directions to prev and next', () => {
    // Stroke: 0, 1, 2. At index 1: prev is W(6), next is E(2)
    const dirs = getStrokeNeighborDirections([0, 1, 2], 1, columns);
    expect(dirs).toEqual([6, 2]); // W, E
  });
});
