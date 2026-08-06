import { OBJECT_DOTS_ROW_HEIGHT, objectPanelLayout, optionCapsuleLayout, optionRowSidePad } from '../logic/panelLayout';
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


describe('optionCapsuleLayout', () => {
  test('one width for every option, so the slide never resizes it', () => {
    const { width, lefts } = optionCapsuleLayout(600, 6, 6);
    expect(lefts).toHaveLength(6);
    // A single width is the whole point — nothing per-option about it.
    expect(width).toBeGreaterThan(0);
  });

  test('a full row lays cells out end to end, first flush left', () => {
    // 6 cells + 5 gaps of 8 = 40 of gap; (340 - 40) / 6 = 50 per cell.
    const { width, lefts } = optionCapsuleLayout(340, 6, 6);
    expect(width).toBe(50); // under the 88 cap, so the capsule takes the cell
    expect(lefts[0]).toBe(0);
    expect(lefts[1]).toBe(58); // 50 + 8
    expect(lefts[5]).toBe(5 * 58);
  });

  test('caps at the pushdown width and re-centres what it trims', () => {
    // 3 cells + 2 gaps = 16; (616 - 16) / 3 = 200 per cell, capped to 88.
    const { width, lefts } = optionCapsuleLayout(616, 3, 3);
    expect(width).toBe(88);
    expect(lefts[0]).toBe((200 - 88) / 2); // centred in its cell, not flush
    expect(lefts[1] - lefts[0]).toBe(208); // still one cell + gap apart
  });

  test('a padded row offsets by the pad and its gap', () => {
    // 3 buttons in 6 columns: pad 1.5 units per side, 5 children → 4 gaps = 32.
    // (332 - 32) / 6 = 50 per cell. Start = 1.5*50 + 8 = 83.
    const { width, lefts } = optionCapsuleLayout(332, 6, 3);
    expect(width).toBe(50);
    expect(lefts[0]).toBe(83);
    expect(lefts[2]).toBe(83 + 2 * 58);
  });

  test('the padded row stays centred — both ends leave the same margin', () => {
    const rowWidth = 332;
    const { width, lefts } = optionCapsuleLayout(rowWidth, 6, 3);
    const leftMargin = lefts[0];
    const rightMargin = rowWidth - (lefts[2] + width);
    expect(rightMargin).toBeCloseTo(leftMargin, 6);
  });

  test('yields nothing before the row has been measured', () => {
    expect(optionCapsuleLayout(0, 6, 3)).toEqual({ width: 0, lefts: [] });
  });

  test('an empty set yields nothing rather than dividing by zero', () => {
    expect(optionCapsuleLayout(340, 0, 0)).toEqual({ width: 0, lefts: [] });
    expect(optionCapsuleLayout(340, 6, 0)).toEqual({ width: 0, lefts: [] });
  });
});
