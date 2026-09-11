import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  OBJECT_DOTS_ROW_HEIGHT,
  landingSubmenu,
  objectPanelLayout,
  objectPanelPages,
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

describe('objectPanelPages', () => {
  test('a selection with no options is the common actions alone — nothing to swipe to', () => {
    expect(objectPanelPages(false)).toEqual(['common']);
  });

  test('any option at all adds the edit page — one dot, one sheet', () => {
    // The options no longer paginate: however many there are, they are one
    // scrolling tab row in the sheet, so there is never a third page.
    expect(objectPanelPages(true)).toEqual(['common', 'edit']);
  });
});

describe('landingSubmenu (the tab the sheet opens on)', () => {
  test('a fresh sheet opens on the selection’s first page', () => {
    expect(landingSubmenu(['crop', 'shadow', 'border', 'opacity'], null)).toBe('crop');
    expect(landingSubmenu(['stroke', 'svgFill'], null)).toBe('stroke');
  });

  test('keeps the page the last selection was on, when this one has it', () => {
    // Working through a drawing's shadows, the next shape should open on the
    // Shadow tab too — re-landing every selection on the first tab makes the
    // sheet something to re-navigate rather than a place to be.
    expect(landingSubmenu(['crop', 'shadow', 'border', 'opacity'], 'shadow')).toBe('shadow');
    expect(landingSubmenu(['font', 'align', 'shadow'], 'shadow')).toBe('shadow');
  });

  test('cannot keep a page the new selection does not have', () => {
    // The last selection was on Crop; a text has no Crop — its first page.
    expect(landingSubmenu(['font', 'align', 'shadow'], 'crop')).toBe('font');
  });

  test('a selection whose tabs are all actions has no page to land on', () => {
    // A word sticker's one tab is Invert, a toggle: the sheet shows its tab
    // row alone, with no well.
    expect(landingSubmenu([], null)).toBeNull();
    expect(landingSubmenu([], 'shadow')).toBeNull();
  });
});

// The panel itself has no test renderer here, so the half that decides WHEN
// the sheet is up and WHERE it lands is pinned as source.
describe('the panel’s two pages', () => {
  const PANEL = readFileSync(
    resolve(__dirname, '..', 'components', 'ObjectPropertiesPanel.tsx'), 'utf8',
  );

  test('the sheet is up while asked for or while a page is open, and only with tabs to show', () => {
    expect(PANEL).toContain('const sheetOpen = model.visible && hasOptions && (sheetWanted || submenuOpen);');
    // A page a host opened itself (the pattern capsule's Tools) counts as
    // asking, so the sheet stays up when that page later folds.
    expect(PANEL).toContain('if (submenuOpen) setSheetWanted(true);');
  });

  test('lands each new selection on the remembered page, else its first', () => {
    expect(PANEL).toContain('const target = landingSubmenu(submenuOrder, lastSubRef.current);');
    // …both when the sheet is popped and when it is already up with nothing
    // showing (the selection changed under it).
    expect(PANEL).toContain('if (sheetOpen && !submenuOpen) landingRef.current();');
  });

  test('a selection with no options drops the sheet, so the next one starts on the common row', () => {
    expect(PANEL).toContain('if (model.visible && !hasOptions) setSheetWanted(false);');
  });

  test('the dots: the edit dot pops the sheet, the common dot drops it', () => {
    expect(PANEL).toContain("onPress={() => (p === 'edit' ? openSheet() : closeSheet())}");
    expect(PANEL).toContain("const shownPage: PanelPage = sheetOpen ? 'edit' : 'common';");
    expect(PANEL).toContain('const pages = objectPanelPages(allOptionSpecs.length > 0);');
    // The 12px dot gets a hit area a fingertip (and a cursor) can trust.
    expect(PANEL).toContain('hitSlop={10}');
  });

  test('a sideways swipe on the row pops the sheet, either direction, and the row never leaves', () => {
    const pan = PANEL.slice(PANEL.indexOf('const swapPan = useRef('), PANEL.indexOf('// Multi-selection mode'));
    expect(pan).toContain('if (swipeDismissDirection(g.dx) !== 0 && canSwapRef.current) openSheetRef.current();');
    // The row follows the finger a little and springs back — it is not
    // thrown off an edge for another row to replace it.
    expect(pan).toContain('swapX.setValue(Math.max(-SWIPE_FOLLOW_PX, Math.min(SWIPE_FOLLOW_PX, g.dx)));');
    expect(PANEL).not.toContain('stepPanelPage');
    expect(PANEL).not.toContain('animateSwap');
  });
});
