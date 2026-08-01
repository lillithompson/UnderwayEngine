import {
  IMAGE_EDIT_OPTIONS,
  IMAGE_EDIT_SWIPE_DISMISS_PX,
  swipeDismissDirection,
} from '../logic/imageEdit';

describe('IMAGE_EDIT_OPTIONS', () => {
  test('lists replace, tint, crop, shadow, glow, border in order', () => {
    expect(IMAGE_EDIT_OPTIONS.map((o) => o.action)).toEqual([
      'replace', 'tint', 'crop', 'shadow', 'glow', 'border',
    ]);
  });
  test('every option carries a label and a glyph', () => {
    for (const opt of IMAGE_EDIT_OPTIONS) {
      expect(opt.label.length).toBeGreaterThan(0);
      expect(opt.icon.length).toBeGreaterThan(0);
    }
  });
});

describe('swipeDismissDirection', () => {
  const T = IMAGE_EDIT_SWIPE_DISMISS_PX;

  test('a short drag either way snaps back (0)', () => {
    expect(swipeDismissDirection(0)).toBe(0);
    expect(swipeDismissDirection(T - 1)).toBe(0);
    expect(swipeDismissDirection(-(T - 1))).toBe(0);
  });
  test('past the threshold to the right dismisses off the right (+1)', () => {
    expect(swipeDismissDirection(T)).toBe(1);
    expect(swipeDismissDirection(T + 200)).toBe(1);
  });
  test('past the threshold to the left dismisses off the left (-1)', () => {
    expect(swipeDismissDirection(-T)).toBe(-1);
    expect(swipeDismissDirection(-(T + 200))).toBe(-1);
  });
  test('honors a custom threshold', () => {
    expect(swipeDismissDirection(30, 20)).toBe(1);
    expect(swipeDismissDirection(30, 40)).toBe(0);
  });
});
