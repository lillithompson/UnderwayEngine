import { computeCloneMappedIndex } from '../clone';

describe('computeCloneMappedIndex', () => {
  // 10x10 grid, source at (2,3)=23, anchor at (5,5)=55
  const rows = 10;
  const cols = 10;
  const source = 2 * 10 + 3; // index 23

  it('returns source when dest equals anchor (identity)', () => {
    const anchor = 55;
    expect(computeCloneMappedIndex(source, anchor, anchor, rows, cols)).toBe(source);
  });

  it('positive offset: dest (8,7) maps to (5,5)', () => {
    const anchor = 55;
    const dest = 8 * 10 + 7; // 87
    // rowOff=3, colOff=2 → mapped (5,5)=55
    expect(computeCloneMappedIndex(source, anchor, dest, rows, cols)).toBe(55);
  });

  it('negative offset with wrapping: dest (1,1) maps to (8,9)', () => {
    const anchor = 55;
    const dest = 1 * 10 + 1; // 11
    // rowOff=-4, colOff=-4 → mapped (8,9)=89
    expect(computeCloneMappedIndex(source, anchor, dest, rows, cols)).toBe(89);
  });

  it('anchor at index 0', () => {
    const anchor = 0;
    // dest at (0,0) same as anchor → should return source
    expect(computeCloneMappedIndex(source, anchor, 0, rows, cols)).toBe(source);
    // dest at (1,1)=11 → offset (1,1) → mapped (3,4)=34
    expect(computeCloneMappedIndex(source, anchor, 11, rows, cols)).toBe(34);
  });

  it('works on small grid (2x2)', () => {
    // source=0 (0,0), anchor=0, dest=3 (1,1) → mapped (1,1)=3
    expect(computeCloneMappedIndex(0, 0, 3, 2, 2)).toBe(3);
    // source=0, anchor=3 (1,1), dest=0 → offset (-1,-1) → mapped ((-1+2)%2, (-1+2)%2) = (1,1) = 3
    expect(computeCloneMappedIndex(0, 3, 0, 2, 2)).toBe(3);
  });

  it('wraps at the edges of a 1-row grid', () => {
    // 1x5 grid: row always 0
    // source=2, anchor=3, dest=0 → colOff=-3 → mapped col = (2-3+5)%5=4
    expect(computeCloneMappedIndex(2, 3, 0, 1, 5)).toBe(4);
  });

  it('wraps at the edges of a 1-column grid', () => {
    // 5x1 grid: col always 0
    // source=2, anchor=3, dest=0 → rowOff=-3 → mapped row = (2-3+5)%5=4
    expect(computeCloneMappedIndex(2, 3, 0, 5, 1)).toBe(4);
  });
});
