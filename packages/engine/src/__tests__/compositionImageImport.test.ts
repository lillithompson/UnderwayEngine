import { placementBbox } from '../compositionImageImport';

describe('placementBbox', () => {
  it('sizes to 8 L0 cells at grid level 0', () => {
    const result = placementBbox(1024, 512, 16, 16, 0);
    expect(result.cellWidth).toBe(8);
    expect(result.cellHeight).toBe(4);
    expect(result.cellX).toBe(12);
    expect(result.cellY).toBe(14);
  });

  it('sizes to 8 L1 cells (16 L0 cells) at grid level 1', () => {
    const result = placementBbox(1024, 512, 16, 16, 1);
    expect(result.cellWidth).toBe(16);
    expect(result.cellHeight).toBe(8);
  });

  it('sizes to 8 L2 cells (32 L0 cells) at grid level 2', () => {
    const result = placementBbox(1024, 512, 16, 16, 2);
    expect(result.cellWidth).toBe(32);
    expect(result.cellHeight).toBe(16);
  });

  it('sizes to 8 L3 cells (64 L0 cells) at grid level 3', () => {
    const result = placementBbox(1024, 512, 16, 16, 3);
    expect(result.cellWidth).toBe(64);
    expect(result.cellHeight).toBe(32);
  });

  it('handles square images', () => {
    const result = placementBbox(500, 500, 10, 10, 0);
    expect(result.cellWidth).toBe(8);
    expect(result.cellHeight).toBe(8);
  });

  it('handles portrait images', () => {
    const result = placementBbox(512, 1024, 16, 16, 0);
    expect(result.cellWidth).toBe(4);
    expect(result.cellHeight).toBe(8);
  });

  it('centers the bbox on the given cell', () => {
    const result = placementBbox(1024, 512, 20, 10, 1);
    // 16 wide, 8 tall at L1
    expect(result.cellX).toBe(20 - 16 / 2);
    expect(result.cellY).toBe(10 - 8 / 2);
  });

  it('defaults to L0 when gridLevel is omitted', () => {
    const result = placementBbox(1024, 768, 16, 16);
    expect(result.cellWidth).toBe(8);
    expect(result.cellHeight).toBe(6);
  });
});
