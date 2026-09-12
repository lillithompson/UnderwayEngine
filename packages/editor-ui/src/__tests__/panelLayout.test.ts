import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  landingSubmenu,
  objectPanelLayout,
  objectPanelPages,
} from '../logic/panelLayout';
import { OBJECT_PANEL_HEIGHT } from '../theme';

describe('objectPanelLayout', () => {
  // The panel is its button row and the device's inset under it, the same
  // height everywhere. The carousel dots are gone, and with them the rule
  // that dropped them into the home-indicator strip on a notched phone so
  // the panel could reclaim their height.
  test('the inset is plain bottom padding, whatever the device', () => {
    expect(objectPanelLayout(0)).toEqual({ height: OBJECT_PANEL_HEIGHT, paddingBottom: 0 });
    expect(objectPanelLayout(34)).toEqual({ height: OBJECT_PANEL_HEIGHT + 34, paddingBottom: 34 });
    expect(objectPanelLayout(8)).toEqual({ height: OBJECT_PANEL_HEIGHT + 8, paddingBottom: 8 });
  });

  test('the row alone: no dot row is reserved', () => {
    // 1 border + 60 row. The 34pt of dots it used to end in are gone.
    expect(OBJECT_PANEL_HEIGHT).toBe(61);
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

  test('the host can own the sheet’s open state, and hears every gesture either way', () => {
    // Controlled when `editOpen` is passed (a floating Edit button raising
    // the same sheet), the panel's own when it isn't — and onEditOpenChange
    // fires for the swipe and the dots regardless, so the host's button can
    // read as lit while the sheet stands.
    expect(PANEL).toContain('const sheetWanted = model.editOpen ?? localSheetWanted;');
    expect(PANEL).toContain('setLocalSheetWanted(open);');
    expect(PANEL).toContain('onEditOpenChange?.(open);');
    const adapter = readFileSync(resolve(__dirname, '..', 'adapter.ts'), 'utf8');
    expect(adapter).toContain('editOpen?: boolean;');
    expect(adapter).toContain('onEditOpenChange?(open: boolean): void;');
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

  // The dots said which of two pages was showing — 34pt of chrome for a
  // fact the sheet itself tells, by standing up. The swipe that raised the
  // page (and the host's floating Edit capsule) is the whole affordance now.
  test('no carousel dots: the sheet says which page is up by being up', () => {
    expect(PANEL).not.toMatch(/dotsRow|dotActive/);
    expect(PANEL).not.toContain('shownPage');
    expect(PANEL).not.toContain('PANEL_DOT');
    // The two pages are still counted — that is what says whether there is
    // anything to swipe TO.
    expect(PANEL).toContain('const pages = objectPanelPages(allOptionSpecs.length > 0);');
    expect(PANEL).toContain('const canSwap = pages.length > 1;');
  });

  test('a sideways swipe on the row pops the sheet, either direction, and the row does not move at all', () => {
    const pan = PANEL.slice(PANEL.indexOf('const swapPan = useRef('), PANEL.indexOf('// Multi-selection mode'));
    expect(pan).toContain('if (swipeDismissDirection(g.dx) !== 0 && canSwapRef.current) openSheetRef.current();');
    // No travel: the row neither follows the finger nor slides off an edge.
    // The sheet coming up is the whole answer to the gesture, so there is
    // nothing to animate sideways and nothing to spring back.
    expect(pan).not.toContain('onPanResponderMove');
    expect(PANEL).not.toContain('swapX');
    expect(PANEL).not.toContain('SWIPE_FOLLOW_PX');
    expect(PANEL).not.toContain('stepPanelPage');
    expect(PANEL).not.toContain('animateSwap');
    // …and the row renders as a plain View, not an Animated one.
    expect(PANEL).toContain('<View style={styles.swapArea} {...(canSwap ? swapPan.panHandlers : {})}>\n          <View style={styles.gridRow}>');
  });
});
