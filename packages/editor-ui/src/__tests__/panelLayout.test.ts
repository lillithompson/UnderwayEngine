import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  OBJECT_DOTS_ROW_HEIGHT,
  OPTION_CAPSULE_MAX_WIDTH,
  OPTION_CHAR_WIDTH,
  OPTION_PILL_PAD,
  OPTION_ROW_GAP,
  estimatedOptionCellWidth,
  landingPanelPage,
  objectPanelLayout,
  objectPanelPages,
  optionCapsuleLefts,
  optionPageFitCount,
  optionRowSidePad,
  stepPanelPage,
} from '../logic/panelLayout';
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

describe('objectPanelPages', () => {
  test('a selection with no options is the common actions alone — nothing to swipe to', () => {
    expect(objectPanelPages({})).toEqual(['common']);
  });

  test('the common icon page always comes first, options second', () => {
    expect(objectPanelPages({ type: true })).toEqual(['common', 'type']);
  });

  test('an OVERFLOW of the combined options row grows a third page on the end', () => {
    expect(objectPanelPages({ type: true, multi: true })).toEqual(['common', 'type', 'multi']);
  });
});

describe('landingPanelPage', () => {
  test('a new selection opens on the panel’s first page — the common icons', () => {
    expect(landingPanelPage(['common', 'type'])).toBe('common');
    expect(landingPanelPage(['common', 'type', 'multi'])).toBe('common');
    expect(landingPanelPage(['common'])).toBe('common');
  });

  test('keeps the page the last selection was on, when this one has it', () => {
    // Working through a drawing's shadows, the next shape should open on the
    // shadow row too — re-landing every selection on the first page makes the
    // carousel something to re-navigate rather than a place to be.
    expect(landingPanelPage(['common', 'type'], 'common')).toBe('common');
    expect(landingPanelPage(['common', 'type', 'multi'], 'multi')).toBe('multi');
    expect(landingPanelPage(['common', 'type'], 'type')).toBe('type');
  });

  test('cannot keep a page the new selection does not have', () => {
    // The last selection overflowed its options; this one doesn't — landing
    // on its 'multi' page would be an empty row.
    expect(landingPanelPage(['common', 'type'], 'multi')).toBe('common');
    expect(landingPanelPage(['common'], 'type')).toBe('common');
  });
});

describe('estimatedOptionCellWidth', () => {
  test('a short word is its characters plus the pill padding', () => {
    expect(estimatedOptionCellWidth('Crop'))
      .toBe(4 * OPTION_CHAR_WIDTH + 2 * OPTION_PILL_PAD);
  });

  test('a long word caps at the capsule ceiling, like a laid-out cell', () => {
    expect(estimatedOptionCellWidth('Background color')).toBe(OPTION_CAPSULE_MAX_WIDTH);
  });
});

describe('optionPageFitCount (how the combined options row paginates)', () => {
  const LABELS = ['Tint', 'Opacity', 'Shadow', 'Border', 'Layout', 'Group', 'Merge'];

  test('everything fits on one page when the row is wide enough', () => {
    expect(optionPageFitCount(LABELS, 2000)).toBe(LABELS.length);
  });

  test('a narrow row stops at the first option that will not fit', () => {
    // Room for exactly the first two estimated cells plus their gap.
    const two = estimatedOptionCellWidth('Tint')
      + OPTION_ROW_GAP + estimatedOptionCellWidth('Opacity');
    expect(optionPageFitCount(LABELS, two)).toBe(2);
    expect(optionPageFitCount(LABELS, two - 1)).toBe(1);
  });

  test('an unmeasured row keeps everything on one page — no overflow flash', () => {
    expect(optionPageFitCount(LABELS, 0)).toBe(LABELS.length);
  });

  test('never returns less than one for a measured row, and zero only for none', () => {
    expect(optionPageFitCount(['Background color'], 10)).toBe(1);
    expect(optionPageFitCount([], 340)).toBe(0);
  });
});

// The panel itself has no test renderer here, so the half that decides WHICH
// page to remember is pinned as source.
describe('the panel\u2019s memory of the last page', () => {
  const PANEL = readFileSync(
    resolve(__dirname, '..', 'components', 'ObjectPropertiesPanel.tsx'), 'utf8',
  );

  test('lands each new selection on the remembered page', () => {
    expect(PANEL).toContain('landingPanelPage(pages, lastPageRef.current)');
  });

  test('records the page only while a selection is showing', () => {
    // The row falls back to 'common' as the panel hides; letting that
    // overwrite the memory would make every selection after a deselect start
    // over.
    expect(PANEL).toContain('if (model.visible) lastPageRef.current = page;');
  });

  test('builds ONE combined options row, selection options after the kind’s', () => {
    expect(PANEL).toContain('[...(typeSpecs ?? []), ...(multiSpecs ?? [])]');
    expect(PANEL).toContain('optionPageFitCount(allOptionSpecs.map((s) => s.label), rowWidth)');
  });
});

describe('stepPanelPage', () => {
  const THREE = ['common', 'type', 'multi'] as const;

  test('a leftward swipe advances, a rightward one goes back', () => {
    expect(stepPanelPage(THREE, 'common', -1)).toBe('type');
    expect(stepPanelPage(THREE, 'type', -1)).toBe('multi');
    expect(stepPanelPage(THREE, 'multi', 1)).toBe('type');
    expect(stepPanelPage(THREE, 'type', 1)).toBe('common');
  });

  test('wraps at both ends', () => {
    expect(stepPanelPage(THREE, 'multi', -1)).toBe('common');
    expect(stepPanelPage(THREE, 'common', 1)).toBe('multi');
  });

  test('two pages stay the straight toggle they were — either direction flips', () => {
    const two = ['common', 'type'] as const;
    expect(stepPanelPage(two, 'common', -1)).toBe('type');
    expect(stepPanelPage(two, 'common', 1)).toBe('type');
    expect(stepPanelPage(two, 'type', -1)).toBe('common');
    expect(stepPanelPage(two, 'type', 1)).toBe('common');
  });

  test('a lone page is its own neighbour, so a stray swipe changes nothing', () => {
    expect(stepPanelPage(['common'], 'common', -1)).toBe('common');
    expect(stepPanelPage(['common'], 'common', 1)).toBe('common');
  });

  test('a page the selection no longer has steps from the start, not off the end', () => {
    // The union collapsed a multi-selection while its page was showing.
    expect(stepPanelPage(['common', 'type'], 'multi', -1)).toBe('type');
    expect(stepPanelPage(['common', 'type'], 'multi', 1)).toBe('type');
  });
});
