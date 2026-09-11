import {
  IMAGE_EDIT_OPTIONS,
  IMAGE_EDIT_SWIPE_DISMISS_PX,
  swipeDismissDirection,
} from '../logic/imageEdit';

describe('IMAGE_EDIT_OPTIONS', () => {
  test('lists crop, shadow, border, opacity in order — Tint was removed', () => {
    // Pages saved with an image tint keep rendering it; only the page is
    // gone from the row.
    expect(IMAGE_EDIT_OPTIONS.map((o) => o.action)).toEqual([
      'crop', 'shadow', 'border', 'opacity',
    ]);
  });
  test('offers no replace action — every option opens a bar', () => {
    expect(IMAGE_EDIT_OPTIONS.some((o) => (o.action as string) === 'replace')).toBe(false);
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
