import { OBJECT_DOTS_ROW_HEIGHT, OPTION_ROW_GAP, objectPanelLayout, optionCapsuleLefts, optionRowSidePad } from '../logic/panelLayout';
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
    // the right, leaving the group half a column left of centre. An odd pad is
    // the common case: 5 icons against a 6-option set.
    expect(optionRowSidePad(6, 5)).toBe(0.5);
    expect(optionRowSidePad(6, 3)).toBe(1.5);
  });

  test('the two sides are equal by construction, so the row is centred', () => {
    for (let buttons = 0; buttons <= 8; buttons++) {
      const pad = optionRowSidePad(8, buttons);
      // Total flex still adds up to the column count, so the icons keep one
      // size whatever the option set beside them costs.
      expect(pad * 2 + buttons).toBe(Math.max(8, buttons));
    }
  });

  test('never goes negative when a set outruns the column count', () => {
    expect(optionRowSidePad(4, 6)).toBe(0);
  });
});

describe('optionCapsuleLefts', () => {
  const G = OPTION_ROW_GAP;

  test('lays the cells out in order, one gap apart', () => {
    // 60 + 8 + 40 + 8 + 100 = 216 in a 216-wide row: no slack, flush left.
    expect(optionCapsuleLefts(216, [60, 40, 100])).toEqual([0, 68, 116]);
  });

  test('each offset lands on its own cell, whatever the widths', () => {
    const widths = [30, 88, 52, 71];
    const lefts = optionCapsuleLefts(400, widths);
    // Neighbours are exactly one cell + one gap apart — the capsule can't drift
    // off the word it is meant to sit under.
    for (let i = 1; i < widths.length; i++) {
      expect(lefts[i] - lefts[i - 1]).toBeCloseTo(widths[i - 1] + G, 6);
    }
  });

  test('centres the group in a row it does not fill (every cell capped)', () => {
    // 3 × 88 + 2 gaps = 280 in a 600 row: 160 of slack, half either side.
    const widths = [88, 88, 88];
    const lefts = optionCapsuleLefts(600, widths);
    expect(lefts[0]).toBeCloseTo((600 - 280) / 2, 6);
    const rightMargin = 600 - (lefts[2] + 88);
    expect(rightMargin).toBeCloseTo(lefts[0], 6);
  });

  test('an overfull row starts flush left rather than off the edge', () => {
    // Shrunk cells that still overrun: never a negative first offset.
    expect(optionCapsuleLefts(100, [60, 60, 60])[0]).toBe(0);
  });

  test('yields nothing before the row or its cells have been measured', () => {
    expect(optionCapsuleLefts(0, [40, 40])).toEqual([]);
    expect(optionCapsuleLefts(340, [])).toEqual([]);
  });
});
