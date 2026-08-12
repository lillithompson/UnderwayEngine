/**
 * The paint-island option row (logic/paintEdit.ts): a paint island is baked
 * raster brushwork, so its type menu is exactly one action — Opacity — and
 * deliberately offers no Stroke or Fill. Pinned the way svgEdit / imageEdit
 * pin their option sets, so a menu change is a conscious edit here.
 */

import { PAINT_EDIT_OPTIONS } from '../logic/paintEdit';

describe('paint island edit options', () => {
  test('the option set is exactly Opacity — no Stroke, no Fill', () => {
    expect(PAINT_EDIT_OPTIONS.map((o) => o.action)).toEqual(['opacity']);
  });

  test('the Opacity option wears the shared opacity glyph and label', () => {
    const [opacity] = PAINT_EDIT_OPTIONS;
    expect(opacity.label).toBe('Opacity');
    expect(opacity.icon).toBe('opacity');
  });
});
