import { computeGridLayout } from '../libraryGrid';

describe('computeGridLayout', () => {
  it('returns at least 1 column for any positive width', () => {
    expect(computeGridLayout(100).columns).toBeGreaterThanOrEqual(1);
    expect(computeGridLayout(50).columns).toBeGreaterThanOrEqual(1);
    expect(computeGridLayout(1).columns).toBeGreaterThanOrEqual(1);
  });

  it('returns 2 columns for a tablet-like width (400px)', () => {
    const layout = computeGridLayout(400);
    expect(layout.columns).toBe(2);
  });

  it('returns more columns for wider screens', () => {
    const narrow = computeGridLayout(375);
    const wide = computeGridLayout(1024);
    expect(wide.columns).toBeGreaterThan(narrow.columns);
  });

  it('card widths fill the available space', () => {
    const screenWidth = 800;
    const layout = computeGridLayout(screenWidth);
    const availableWidth = screenWidth - layout.sidePadding * 2;
    const totalCardWidth = layout.cardWidth * layout.columns + layout.gap * (layout.columns - 1);
    expect(Math.abs(totalCardWidth - availableWidth)).toBeLessThan(1);
  });

  it('returns consistent gap and sidePadding values', () => {
    const layout = computeGridLayout(500);
    expect(layout.gap).toBe(12);
    expect(layout.sidePadding).toBe(12);
  });
});
