import * as colors from '../colors';

describe('colors', () => {
  const entries = Object.entries(colors);

  it('exports at least 40 color constants', () => {
    expect(entries.length).toBeGreaterThanOrEqual(40);
  });

  it('all string exports are non-empty strings', () => {
    for (const [, value] of entries) {
      if (typeof value === 'string') {
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });

  it('LEVEL_COLORS_SIDE has entries for levels 0-4', () => {
    for (let i = 0; i <= 4; i++) {
      expect(colors.LEVEL_COLORS_SIDE[i]).toBeDefined();
      expect(typeof colors.LEVEL_COLORS_SIDE[i]).toBe('string');
    }
  });

  it('LEVEL_COLORS_PANEL has entries for levels 0-4', () => {
    for (let i = 0; i <= 4; i++) {
      expect(colors.LEVEL_COLORS_PANEL[i]).toBeDefined();
      expect(typeof colors.LEVEL_COLORS_PANEL[i]).toBe('string');
    }
  });
});
