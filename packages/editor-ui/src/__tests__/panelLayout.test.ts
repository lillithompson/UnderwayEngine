import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  COMMON_TIP_BOX_PX,
  COMMON_TIP_GAP_PX,
  FINE_POINTER_BUTTON_PX,
  PANEL_ROW_INSET_PX,
  commonTipBox,
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
    expect(landingSubmenu(['crop', 'effects', 'border', 'opacity'], null)).toBe('crop');
    expect(landingSubmenu(['stroke', 'svgFill'], null)).toBe('stroke');
  });

  test('keeps the page the last selection was on, when this one has it', () => {
    // Working through a drawing's shadows, the next shape should open on the
    // Effects tab too — re-landing every selection on the first tab makes the
    // sheet something to re-navigate rather than a place to be.
    expect(landingSubmenu(['crop', 'effects', 'border', 'opacity'], 'effects')).toBe('effects');
    expect(landingSubmenu(['font', 'align', 'effects'], 'effects')).toBe('effects');
  });

  test('cannot keep a page the new selection does not have', () => {
    // The last selection was on Crop; a text has no Crop — its first page.
    expect(landingSubmenu(['font', 'align', 'effects'], 'crop')).toBe('font');
  });

  test('a selection whose tabs are all actions has no page to land on', () => {
    // A word sticker's one tab is Invert, a toggle: the sheet shows its tab
    // row alone, with no well.
    expect(landingSubmenu([], null)).toBeNull();
    expect(landingSubmenu([], 'effects')).toBeNull();
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
    expect(PANEL).toContain(': landingSubmenu(submenuOrder, last);');
    // …with one exception the shared rule can't know about: an EFFECT page
    // whose tab has gone (its effect was removed, or this selection doesn't
    // wear it) lands on Effects, the page that makes those tabs, rather
    // than on the row's first.
    expect(PANEL).toContain("const target = last && (EFFECT_OF_PAGE[last] || last === 'svgPattern')");
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

// DrawBot's report f651fb58: on a 1440 laptop the common row's seven bare
// icons stood ~200 px apart along the window's foot, each a seventh of its
// width (flex: 1), with nothing to say what each was. Under a fine pointer
// the row gathers and each button names itself; a touch screen's row is
// exactly as it was.
describe('the common row under a mouse or trackpad', () => {
  const PANEL = readFileSync(
    resolve(__dirname, '..', 'components', 'ObjectPropertiesPanel.tsx'), 'utf8',
  );
  const between = (a: string, b: string) => {
    const i = PANEL.indexOf(a);
    expect(i).toBeGreaterThan(-1);
    const j = PANEL.indexOf(b, i);
    expect(j).toBeGreaterThan(i);
    return PANEL.slice(i, j);
  };

  test('is off unless the host says so: every other host keeps the row it had', () => {
    expect(PANEL).toContain('model, safeBottom = 0, keyboardInset = 0, onOccludedHeight, finePointer = false, commonShortcuts,');
    // No fine pointer, no tips: a button is the one flex cell it always was,
    // with no hover handlers and no layout reads.
    expect(PANEL).toContain('const tips = useMemo<CommonTips | null>(() => (finePointer ? {');
    const button = between('function GridButton(', '\n}\n');
    expect(button).toContain('style={tips ? [styles.gridButton, styles.gridButtonFine, hovered && styles.gridButtonHovered] : styles.gridButton}');
    expect(button).toContain('onHoverIn={tips ? () => setHovered(true) : undefined}');
    expect(button).toContain('onHoverOut={tips ? () => setHovered(false) : undefined}');
    expect(button).toContain('onLayout={tips ? (e) => {');
    expect(PANEL).toContain("gridButton: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center' },");
  });

  test('gathers: each button a square at most, the row centred', () => {
    // flex: 1 still shares a narrow window's width; the cap is what keeps a
    // wide one from spreading the buttons apart, and the row's centring
    // gathers them in the middle.
    expect(FINE_POINTER_BUTTON_PX).toBe(48);
    expect(PANEL).toContain('gridButtonFine: { maxWidth: FINE_POINTER_BUTTON_PX, borderRadius: 8 },');
    const row = between('  gridRow: {', '},');
    expect(row).toContain("justifyContent: 'center',");
    expect(row).toContain('gap: 8,');
    // Seven buttons on a 1440 laptop: some 400 px together, where they
    // spanned the window's width.
    expect(7 * FINE_POINTER_BUTTON_PX + 6 * 8).toBeLessThan(420);
  });

  test('the hovered button puts its label up, and takes it down as it leaves, unmounts or changes', () => {
    const button = between('function GridButton(', '\n}\n');
    expect(button).toContain('if (!tips || !hovered || !box) return undefined;');
    expect(button).toContain('const tip: CommonTip = { label, shortcut, centerX: box.x + box.width / 2 };');
    expect(button).toContain('return () => tips.hide(tip);');
    expect(button).toContain('}, [tips, hovered, box, label, shortcut]);');
    // A button's leaving never takes down a label a neighbour put up after.
    expect(PANEL).toContain('hide: (t) => setTip((cur) => (cur === t ? null : cur)),');
  });

  test('the label stands outside the clip, over the panel and under the sheet, only over a row in sight', () => {
    expect(PANEL).toContain('const tipBox = tip && model.visible && !sheetOpen');
    expect(PANEL).toContain('? commonTipBox(tip.centerX, panelBox.height, panelWidth)');
    const render = between('    <CommonTipsContext.Provider value={tips}>', '    </CommonTipsContext.Provider>');
    const clipEnd = render.indexOf('        </Animated.View>\n      </View>\n');
    const label = render.indexOf('{tip && tipBox ? (');
    const sheet = render.indexOf('{sheetMounted ? (');
    expect(clipEnd).toBeGreaterThan(-1);
    expect(label).toBeGreaterThan(clipEnd);
    expect(sheet).toBeGreaterThan(label);
    expect(render).toContain('<View pointerEvents="none" style={[styles.tipWrap, tipBox]}>');
    // z: the clip 200 < the label 205 < the sheet 210.
    expect(PANEL).toContain("tipWrap: { position: 'absolute', zIndex: 205, alignItems: 'center' },");
    expect(between('  clip: {', '},')).toContain('zIndex: 200,');
    expect(between('  sheetWrap: {', '},')).toContain('zIndex: 210,');
    // The panel's width is read as it lays out, and only for the label.
    expect(render).toContain('onLayout={tips ? (e) => setPanelWidth(e.nativeEvent.layout.width) : undefined}');
  });

  test('says the key the host binds, and binds none itself', () => {
    const row = between('const row1: React.ReactNode[] = [', "// The sheet's type tabs");
    for (const action of ['rotate', 'mirrorH', 'mirrorV', 'duplicate', 'lock', 'delete']) {
      expect(row).toContain(`shortcut={commonShortcuts?.${action}}`);
    }
    expect(PANEL).toContain('{tip.shortcut ? <Text style={[styles.tipText, styles.tipKey]} numberOfLines={1}>{tip.shortcut}</Text> : null}');
    expect(PANEL).not.toMatch(/addEventListener\(\s*'keydown'/);
  });

  test('the row is inset as the label reckons it', () => {
    expect(PANEL).toContain('paddingHorizontal: PANEL_ROW_INSET_PX,');
  });
});

describe('commonTipBox (where a hovered button’s label stands)', () => {
  const H = 61;

  test('centred on its button, over the panel’s top edge', () => {
    // A button whose middle is 400 px into the row stands 416 px into the
    // panel (the row's inset).
    const box = commonTipBox(400, H, 1440);
    expect(box.left + box.width / 2).toBe(PANEL_ROW_INSET_PX + 400);
    expect(box.width).toBe(COMMON_TIP_BOX_PX);
    expect(box.bottom).toBe(H + COMMON_TIP_GAP_PX);
  });

  test('rides the panel’s height, the device inset included', () => {
    expect(commonTipBox(400, H + 34, 1440).bottom).toBe(H + 34 + COMMON_TIP_GAP_PX);
  });

  test('narrows toward an edge rather than leave its button or the screen', () => {
    const left = commonTipBox(24, H, 400);
    expect(left.left).toBe(0);
    expect(left.left + left.width / 2).toBe(PANEL_ROW_INSET_PX + 24);
    const right = commonTipBox(400 - 2 * PANEL_ROW_INSET_PX - 24, H, 400);
    expect(right.left + right.width).toBe(400);
    expect(right.left + right.width / 2).toBe(400 - PANEL_ROW_INSET_PX - 24);
  });

  test('before the panel has a width, no box at all', () => {
    expect(commonTipBox(24, H, 0).width).toBe(0);
  });
});
