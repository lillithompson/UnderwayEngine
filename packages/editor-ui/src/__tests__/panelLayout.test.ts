import { OBJECT_DOTS_BOTTOM, OBJECT_DOTS_ROW_HEIGHT, objectPanelLayout, submenuDotsBottom } from '../logic/panelLayout';
import { OBJECT_PANEL_HEIGHT } from '../theme';

describe('objectPanelLayout', () => {
  test('web / non-notched: the inset is plain bottom padding', () => {
    expect(objectPanelLayout(0, false)).toEqual({ height: OBJECT_PANEL_HEIGHT, paddingBottom: 0 });
    expect(objectPanelLayout(34, false)).toEqual({ height: OBJECT_PANEL_HEIGHT + 34, paddingBottom: 34 });
  });

  test('dots in the safe area: the strip replaces the dot row, no padding', () => {
    const { height, paddingBottom } = objectPanelLayout(34, true);
    expect(height).toBe(OBJECT_PANEL_HEIGHT - OBJECT_DOTS_ROW_HEIGHT + 34);
    expect(paddingBottom).toBe(0);
  });

  test('a notched panel is shorter than the padded one by the reclaimed row', () => {
    expect(objectPanelLayout(34, false).height - objectPanelLayout(34, true).height).toBe(OBJECT_DOTS_ROW_HEIGHT);
  });

  test('a strip shorter than the dots never clips them', () => {
    expect(objectPanelLayout(8, true).height).toBe(OBJECT_PANEL_HEIGHT);
  });
});

describe('submenuDotsBottom', () => {
  test('clears the inset when the dots stay above it', () => {
    expect(submenuDotsBottom(34, false)).toBe(34 + OBJECT_DOTS_BOTTOM);
  });
  test('sits inside the inset when the dots take the strip over', () => {
    expect(submenuDotsBottom(34, true)).toBe(OBJECT_DOTS_BOTTOM);
  });
});
