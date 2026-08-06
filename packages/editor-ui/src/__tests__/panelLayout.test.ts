import { OBJECT_DOTS_BOTTOM, OBJECT_DOTS_ROW_HEIGHT, objectPanelLayout, optionRowSidePad, submenuDotsBottom } from '../logic/panelLayout';
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

describe('optionRowSidePad', () => {
  test('a full row needs no padding', () => {
    expect(optionRowSidePad(6, 6)).toBe(0);
  });

  test('an even pad splits into whole cells per side', () => {
    expect(optionRowSidePad(6, 4)).toBe(1);
    expect(optionRowSidePad(6, 2)).toBe(2);
  });

  test('an odd pad splits in half rather than rounding', () => {
    // The bug this replaced floored the left side and gave the remainder to
    // the right, leaving the group half a column left of centre. Both real
    // cases are odd: 3 text options and 5 image options against 6 columns.
    expect(optionRowSidePad(6, 5)).toBe(0.5);
    expect(optionRowSidePad(6, 3)).toBe(1.5);
  });

  test('the two sides are equal by construction, so the row is centred', () => {
    for (let buttons = 0; buttons <= 8; buttons++) {
      const pad = optionRowSidePad(8, buttons);
      // Total flex still adds up to the column count, so cell width holds
      // steady across a swap between the two pages.
      expect(pad * 2 + buttons).toBe(Math.max(8, buttons));
    }
  });

  test('never goes negative when a set outruns the column count', () => {
    expect(optionRowSidePad(4, 6)).toBe(0);
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
