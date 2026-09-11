/**
 * The Edit sheet: the type-specific half of the object-properties panel,
 * popped up over the common-actions row as an "Edit" title, a row of tabs
 * and a darkened well holding the lit tab's controls. There is no test
 * renderer for these components (the same constraint the other panel suites
 * work under), so the structure is pinned by source, and the arithmetic the
 * sheet animates to is covered in submenuHeight.test.ts.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = (...p: string[]) => readFileSync(resolve(__dirname, '..', ...p), 'utf8');
const PANEL = SRC('components', 'ObjectPropertiesPanel.tsx');
const SHEET = SRC('components', 'EditSheet.tsx');
const BAR = SRC('components', 'effectBar.tsx');

const PAGE_FILES = [
  'BorderBar.tsx', 'CropBar.tsx', 'EndpointsBar.tsx', 'LayoutBar.tsx', 'OpacityBar.tsx',
  'ShadowBar.tsx', 'TextBar.tsx', 'TintBar.tsx', 'TransformBar.tsx', 'RigPoseBar.tsx',
  'PatternBars.tsx',
];

describe('the sheet: a tab row over the well', () => {
  it('opens straight on its tabs — no title — with the well under them', () => {
    expect(SHEET).not.toContain('accessibilityRole="header"');
    expect(SHEET).not.toContain('>Edit<');
    expect(SHEET).not.toContain('SHEET_TITLE');
    const order = ['<EditTabs tabs={tabs} />', 'styles.well : styles.bare']
      .map((s) => SHEET.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // No well at all when no tab has a page showing (every tab an action).
    expect(SHEET).toContain('{content != null ? (');
  });

  it('runs the tabs from the left edge one gap apart, and scrolls them with a fade when they overflow', () => {
    // A horizontal ScrollView: the tabs start at the left and never spread
    // to fill the row, so two tabs and six start the same way.
    expect(SHEET).toContain('horizontal');
    expect(SHEET).toContain('showsHorizontalScrollIndicator={false}');
    expect(SHEET).toMatch(/tabsContent: \{[^}]*justifyContent: 'flex-start'/s);
    expect(SHEET).toMatch(/tabsContent: \{[^}]*gap: TAB_GAP/s);
    expect(SHEET).not.toContain("'space-evenly'");
    expect(SHEET).not.toContain('flexGrow');
    // The fades are worked out from the measured row, its content and the
    // scroll offset: only an overflowing row fades, and only at the end
    // that has more.
    expect(SHEET).toContain('const overflow = contentW > viewW + 1;');
    expect(SHEET).toContain('const fadeRight = overflow && scrollX < contentW - viewW - 1;');
    expect(SHEET).toContain('const fadeLeft = overflow && scrollX > 1;');
    // A fade INTO the surface — the same colour at zero alpha, never
    // 'transparent'.
    expect(SHEET).toContain('colors={[PANEL_BG_CLEAR, PANEL_BG]}');
    expect(SHEET).not.toContain("'transparent'");
    // The fade overlays are not tappable, so they can't swallow a tab press.
    expect(SHEET.match(/pointerEvents="none"/g)).toHaveLength(2);
  });

  it('re-renders the tab row on scroll only when a fade appears or goes', () => {
    // scrollX is stored only when it changes which edges fade — a scroll
    // through the middle of an overflowing row is not a render.
    expect(SHEET).toContain('return was.l === now.l && was.r === now.r ? prev : x;');
  });

  it('lights the showing tab and leaves action tabs unlit', () => {
    expect(SHEET).toContain('const lit = !!tab.selected || !!tab.toggled;');
    expect(SHEET).toContain('tab.selected ? styles.tabPillSelected : null,');
    // A toggle keeps its own colour (Repeat's pattern orange), whatever page
    // is showing.
    expect(SHEET).toContain('tab.toggled ? { backgroundColor: tab.tint ?? STATE_ACTIVE } : null,');
  });

  it('puts Remove under the well, lower right, in place of the old trash', () => {
    expect(SHEET).toContain('<Text style={styles.removeLabel}>Remove</Text>');
    expect(SHEET).toContain('accessibilityLabel={remove.label}');
    expect(SHEET).toMatch(/removeRow: \{[^}]*justifyContent: 'flex-end'/s);
    // Only under a page — never under a bare tab row.
    expect(SHEET).toContain('{content != null && remove ? (');
    // …and the panel names it per page: the pages that can be removed or
    // reset, and no others.
    for (const label of ['Remove fill', 'Remove drop shadow', 'Remove border', 'Remove stroke', 'Remove endpoints']) {
      expect(PANEL).toContain(`removeAction = { label: '${label}'`);
    }
    // …and the stroke's is gated: an open path IS its stroke, so a line
    // cannot remove one (svgStrokeRemovable).
    expect(PANEL).toContain("if (svgStrokeRemovable(model.svgSubtype ?? 'stroke')) {");
    // Opacity is not a layer an object can be without, so it has no Remove.
    for (const key of ['opacity', 'transform', 'layout', 'crop', 'patternTiles', 'patternTools', 'patternSymmetry', 'font']) {
      const branch = PANEL.slice(PANEL.indexOf(`displaySub === '${key}'`), PANEL.indexOf('} else if', PANEL.indexOf(`displaySub === '${key}'`) + 1));
      expect([key, branch.includes('removeAction =')]).toEqual([key, false]);
    }
  });
});

describe('the pages have no chrome of their own', () => {
  it('no page carries a header, a back chevron or a trash any more', () => {
    expect(BAR).not.toContain('EffectBarHeader');
    for (const file of PAGE_FILES) {
      const src = SRC('components', file);
      expect([file, src.includes('EffectBarHeader')]).toEqual([file, false]);
      expect([file, src.includes('onBack')]).toEqual([file, false]);
      expect([file, src.includes('chevron-down" size={19}')]).toEqual([file, false]);
      // The old bar container (top hairline, bar padding) is gone: the well
      // is the container now.
      expect([file, /borderTopWidth: BAR_BORDER/.test(src)]).toEqual([file, false]);
    }
    // The only trash left is the Tint page's per-stop delete, a control
    // inside the page rather than a way to remove the page's effect.
    expect(SRC('components', 'TintBar.tsx')).toContain('accessibilityLabel="Delete stop"');
    for (const file of PAGE_FILES.filter((f) => f !== 'TintBar.tsx')) {
      expect([file, SRC('components', file).includes('trash-can-outline')]).toEqual([file, false]);
    }
  });

  it('no page carries a colour swatch any more — a colour is a Color row', () => {
    expect(BAR).toContain('export function BarBody(');
    expect(BAR).not.toContain('ColorAside');
    // Not one page opens the picker itself: the Color page's rows do (the
    // Tint page's onPickColor is the gradient STOP editor's, a control
    // inside the page).
    for (const file of PAGE_FILES) {
      expect([file, SRC('components', file).includes('<ColorAside')]).toEqual([file, false]);
    }
    for (const file of PAGE_FILES.filter((f) => f !== 'TintBar.tsx')) {
      expect([file, SRC('components', file).includes('onPickColor')]).toEqual([file, false]);
    }
    // The one aside left is the Shadow page's offset pad, with its sliders
    // spread beside it.
    const shadow = SRC('components', 'ShadowBar.tsx');
    expect(shadow).toMatch(/<BarBody\s+spread\s+aside=\{\(\s*<XYPad/);
    for (const file of PAGE_FILES.filter((f) => f !== 'ShadowBar.tsx')) {
      expect([file, SRC('components', file).includes('aside=')]).toEqual([file, false]);
    }
  });

  it('the Color page lists every colour the selection can pick, labelled, in one place', () => {
    const color = SRC('components', 'ColorBar.tsx');
    // A row is a swatch that opens the host's picker, or a toggle (a word
    // sticker's Invert, its one colour setting).
    expect(color).toContain("kind: 'swatch'");
    expect(color).toContain("kind: 'toggle'");
    expect(color).toContain('<ColorSwatchFill color={row.color} />');
    expect(color).toContain('accessibilityLabel={`${row.label} color`}');
    expect(color).toContain('<Text style={styles.swatchLabel}>{row.label}</Text>');
    // The panel builds the rows off the MODEL (the host's picker changes the
    // colours; nothing here drafts them), one per colour the selection has.
    for (const [label, pick] of [
      ['Background', 'model.onPickFrameBackground'],
      ['Text', 'model.onPickTextColor'],
      ['Fill', 'model.onPickSvgFillColor'],
      ['Stroke', 'model.onPickStrokeColor'],
      ['Shadow', 'model.onPickShadowColor'],
      ['Border', 'model.onPickBorderColor'],
    ]) {
      const row = PANEL.slice(PANEL.indexOf(`label: '${label}'`), PANEL.indexOf(`label: '${label}'`) + 220);
      expect([label, row.includes(pick)]).toEqual([label, true]);
    }
    // An effect with no colour yet (its Add page is where it starts) lists
    // no row.
    expect(PANEL).toContain("model.shadowPresent !== false && model.onPickShadowColor");
    expect(PANEL).toContain("model.borderPresent !== false && model.onPickBorderColor");
    expect(PANEL).toContain("model.svgFillPresent !== false && model.onPickSvgFillColor");
    expect(PANEL).toContain("model.strokePresent !== false && model.onPickStrokeColor");
    // A selection with no colour at all (a rig, a paint island) gets no tab.
    expect(PANEL).toContain('const colorable = colorRows.length > 0;');
    // The tab leads for a selection whose colour IS the thing, trails
    // otherwise — the tab row and the page order agree on which.
    expect(PANEL).toContain('const colorFirst = !!model.showFrameOptions || !!model.showInvert;');
    expect(PANEL).toContain("? ['color', ...typeSubmenuOrder] : [...typeSubmenuOrder, 'color']");
    expect(PANEL).toContain('typeSpecs = colorFirst ? [colorTab, ...(typeSpecs ?? [])] : [...(typeSpecs ?? []), colorTab];');
  });

  it('the Crop page: no Mode label, no Replace, no resolution line — those are the Image page’s', () => {
    const crop = SRC('components', 'CropBar.tsx');
    // The Fill / Fit / Crop / Tile row names itself.
    expect(crop).toMatch(/<SegmentedRow\s+options=\{MODES\}/);
    expect(crop).not.toContain('label="Mode"');
    expect(crop).not.toContain("label: 'Replace'");
    expect(crop).not.toContain('<ActionRow');
    expect(crop).not.toContain('onReplace');
    expect(crop).not.toContain('Drag the artwork');
    expect(crop).not.toContain('pixelSize');
    expect(crop).not.toContain('formatPixelSize');
    // An unlabelled segmented row spans the whole line.
    expect(BAR).toContain('{label ? <Text style={styles.segLabel}>{label}</Text> : null}');
    // …and the height context no longer grows the Crop page for either.
    expect(SRC('logic', 'submenuHeight.ts')).not.toContain('cropCanReplace');
    expect(SRC('logic', 'submenuHeight.ts')).not.toContain('cropHasResolution');
  });

  it('the Image page holds the photo’s own two facts: Replace, and the resolution', () => {
    const image = SRC('components', 'ImageBar.tsx');
    // Replace is an ACTION (it is something you do, not a state the image
    // is in) and fires straight out of the press — the host opens a file
    // picker, which WebKit only shows while the gesture's activation lives.
    expect(image).toContain('<ActionRow options={REPLACE_OPTION} onPress={onReplace} />');
    expect(image).toContain("label: 'Replace'");
    expect(image).not.toMatch(/onPress=\{\s*async/);
    // The resolution reads under it, and is omitted when unknown.
    expect(image).toContain('const resolution = formatPixelSize(pixelSize);');
    expect(image).toContain('{resolution ? (');
    expect(image).toContain('accessibilityLabel={`Image resolution ${resolution}`}');
    // The page leads an image's tabs, and exists only where the host wired
    // Replace up.
    expect(PANEL).toContain("[...(model.onReplaceImage ? (['image'] as const) : []), 'crop', 'shadow', 'border', 'opacity'])");
    expect(PANEL).toContain(".filter((opt) => opt.action !== 'image' || !!model.onReplaceImage)");
    // A multi-selection drops it with Crop: one photo, one frame.
    expect(PANEL).toContain('.filter((opt) => !multi || !isSingleImageAction(opt.action))');
    // Its height counts the resolution line only when there is one.
    expect(PANEL).toContain('imageHasResolution: formatPixelSize(model.imagePixelSize) !== null,');
    expect(SRC('adapter.ts')).toContain('onReplaceImage?(): void;');
    expect(SRC('adapter.ts')).toContain('imagePixelSize?: { width: number; height: number };');
  });
});

// Every page the sheet can land on must actually OPEN, and having opened,
// must be the one the sheet shows. A page is opened either by the panel
// itself (a LocalSubmenu, for a page holding nothing the host must track)
// or by a host flag openSubmenu sets — and a key that is neither falls
// through every branch, silently. That is what left the Image page dead:
// pressing its tab did nothing, and since it LEADS an image's tabs the
// sheet landed on it and came up as a bare tab row with nothing lit.
describe('every page can be opened and shown', () => {
  /** The SubmenuKey union, read from its own source so a page added there
   *  is a page this suite demands the panel can open. */
  const ALL_KEYS: string[] = (() => {
    const src = SRC('logic', 'submenuHeight.ts');
    const union = src.slice(
      src.indexOf('export type SubmenuKey ='),
      src.indexOf(';', src.indexOf('export type SubmenuKey =')),
    );
    return [...union.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]);
  })();
  const openBody = PANEL.slice(
    PANEL.indexOf('const openSubmenu = (key: SubmenuKey) => {'),
    PANEL.indexOf('const dismissHostSubmenus = () => {'),
  );
  const localList = PANEL.slice(
    PANEL.indexOf('const isLocalSubmenu ='),
    PANEL.indexOf('interface OptionSpec'),
  );
  const activeSubChain = PANEL.slice(
    PANEL.indexOf('const activeSub: SubmenuKey | null ='),
    PANEL.indexOf('const submenuOpen = activeSub != null;'),
  );
  /** The two families openSubmenu dispatches through a lookup rather than
   *  by name — their keys are covered by that call, not by a branch. */
  const viaLookup = (key: string) => key.startsWith('rig') || key.startsWith('pattern');
  /** RETIRED pages: keys still in the union with nothing left to offer
   *  them. `tint` is the image Tint page, which came off the options row
   *  (images no longer tint) while its key and its height stayed for
   *  TintBar, which lives on as the shape Fill page. Listed by name so a
   *  page that is merely BROKEN can't hide here — anything else unopenable
   *  fails these tests, which is how the dead Image tab was found. */
  const RETIRED = ['tint'];

  test('the union really was read (a parse failure must not pass this suite)', () => {
    expect(ALL_KEYS).toContain('image');
    expect(ALL_KEYS).toContain('crop');
    expect(ALL_KEYS.length).toBeGreaterThanOrEqual(20);
  });

  test.each(ALL_KEYS)('openSubmenu(%s) reaches something', (key) => {
    const handled = RETIRED.includes(key)
      || localList.includes(`'${key}'`)
      || openBody.includes(`key === '${key}'`)
      || viaLookup(key);
    expect([key, handled]).toEqual([key, true]);
  });

  test.each(ALL_KEYS)('activeSub can report %s', (key) => {
    // A page the panel opens but activeSub can never name would open and
    // then show nothing — the same empty sheet by the other route.
    const shown = RETIRED.includes(key)
      || localList.includes(`'${key}'`)
      || activeSubChain.includes(`'${key}'`)
      || viaLookup(key)
      // The text pages ride one host flag; `textPage` names which shows.
      || (['font', 'spacing', 'align'].includes(key) && activeSubChain.includes('textPage'));
    expect([key, shown]).toEqual([key, true]);
  });

  test.each(ALL_KEYS)('the sheet has a body to put in the well for %s', (key) => {
    // …and one that renders: a key with no branch here would open, be
    // named, and still leave the well empty.
    const rendered = RETIRED.includes(key)
      || PANEL.includes(`displaySub === '${key}'`)
      || (viaLookup(key) && PANEL.includes('rigPartOfSubmenu(displaySub)'));
    expect([key, rendered]).toEqual([key, true]);
  });
});

describe('the panel drives the sheet', () => {
  it('pops it over the panel, rounded, sized to its page', () => {
    // The rise: sized first, then slid up from below the screen edge.
    const open = PANEL.slice(PANEL.indexOf('if (sheetOpen && !prevSheetOpen.current) {'), PANEL.indexOf('if (!sheetOpen && prevSheetOpen.current) {'));
    expect(open).toContain('sheetH.setValue(sheetHeightRef.current);');
    expect(open).toContain('sheetY.setValue(sheetHeightRef.current);');
    expect(open).toContain('Animated.timing(sheetY, { toValue: 0, duration: PANEL_ANIM_MS, useNativeDriver: false })');
    // The sheet's height is what the arithmetic says for the showing page.
    expect(PANEL).toContain('const sheetHeight = editSheetHeight(contentHeight, { removable: !!removeAction, safeBottom });');
    expect(PANEL).toContain('{ height: sheetH, transform: [{ translateY: sheetY }] },');
  });

  it('a height change can never cancel the rise — they are separate effects', () => {
    // They shared one effect with `sheetHeight` in its deps, so a height
    // change re-ran it, React ran the previous cleanup first, and the
    // cleanup stopped the rise MID-FLIGHT: sheetY froze partway and the
    // sheet sat pushed past the screen edge with only its tabs showing.
    // A height change is guaranteed the moment the sheet opens (the page
    // lands a render after the flag), so this was the common case.
    expect(PANEL).toContain('}, [sheetOpen, sheetH, sheetY]);');
    expect(PANEL).toContain('}, [sheetOpen, sheetHeight, sheetH]);');
    // The rise reads the height through a ref, which is what keeps it out
    // of those deps.
    expect(PANEL).toContain('const sheetHeightRef = useRef(sheetHeight);');
    expect(PANEL).toContain('sheetHeightRef.current = sheetHeight;');
    // No effect drives BOTH values: one would be able to stop the other.
    const rise = PANEL.slice(PANEL.indexOf('if (sheetOpen && !prevSheetOpen.current) {'), PANEL.indexOf('}, [sheetOpen, sheetH, sheetY]);'));
    expect(rise).not.toContain('Animated.timing(sheetH');
    const resize = PANEL.slice(PANEL.indexOf('if (!sheetOpen) return undefined;'), PANEL.indexOf('}, [sheetOpen, sheetHeight, sheetH]);'));
    expect(resize).not.toContain('sheetY');
  });

  it('rises at the height of the page it is ABOUT to land on, not the bare tab row', () => {
    // For the frame between asking for the sheet and the page arriving,
    // `activeSub` is null — and measuring the sheet at its tab-row height
    // there made it rise short and grow in a second motion.
    expect(PANEL).toContain("?? (sheetOpen ? landingSubmenu(submenuOrder, lastSubRef.current) : lastSubRef.current);");
  });

  it('animates the height when a tab is chosen — a shorter page pushes the top edge down', () => {
    const resize = PANEL.slice(PANEL.indexOf('if (!sheetOpen) return undefined;'), PANEL.indexOf('}, [sheetOpen, sheetHeight, sheetH]);'));
    expect(resize).toContain('Animated.timing(sheetH, { toValue: sheetHeight, duration: PANEL_ANIM_MS, useNativeDriver: false })');
    // The height rides the page: the Crop mode from the live draft, the
    // stroke rows from the subtype.
    expect(PANEL).toContain('const contentHeight = !displaySub ? null : addPage ? emptyEffectHeight() : submenuHeight(displaySub, {');
    expect(PANEL).toContain('cropMode: framingForBar.mode,');
    // Nothing reserves the tallest page a selection can reach any more.
    expect(PANEL).not.toContain('typeMenuHeight');
  });

  it('a downward swipe on the sheet drops it; sideways swipes are left to the tab row', () => {
    const pan = PANEL.slice(PANEL.indexOf('const sheetPan = useRef('), PANEL.indexOf('// Fold the effect pages away'));
    // Claims only a clearly-downward drag…
    expect(pan).toContain('g.dy > 10 && g.dy > Math.abs(g.dx) * 1.5,');
    // …never while a slider is taking a value or a popover list is open…
    expect(pan).toContain('!fontSheetOpenRef.current && !isValueDragging() &&');
    // …follows the finger down and drops past the threshold, else springs back.
    expect(pan).toContain('sheetY.setValue(Math.max(0, g.dy));');
    expect(pan).toContain('if (swipeDismissDirection(g.dy) === 1) closeSheetRef.current();');
    // No page carousel: a sideways fling changes nothing.
    expect(pan).not.toContain('g.dx) > 10');
    expect(PANEL).not.toContain('runNavRef');
    expect(PANEL).not.toContain('navX');
  });

  it('dropping the sheet closes every page and forgets the ask; the panel hiding does the same', () => {
    expect(PANEL).toContain('const closeSheet = () => {\n    setSheetWanted(false);\n    dismissSubmenu();\n  };');
    expect(PANEL).toContain('if (!model.visible) closeSheetRef.current();');
  });

  it('reports the sheet’s height as the occlusion while it is up — it covers the panel', () => {
    expect(PANEL).toContain('const occludedPx = !model.visible ? 0 : sheetOpen ? sheetHeight : panelBox.height;');
  });

  it('keeps showing the last page through the slide down', () => {
    // Closed, the well keeps what it last showed so it doesn't empty as the
    // sheet drops; open with nothing yet, it shows what it is landing on.
    expect(PANEL).toContain('const displaySub: SubmenuKey | null = activeSub');
    expect(PANEL).toContain(': lastSubRef.current);');
  });

  it('the text tabs are named for their pages: Font, not the component’s "Type"', () => {
    expect(PANEL).toContain("{ key: 'font', label: 'Font', sub: 'font', onPress: () => openSubmenu('font') },");
    expect(PANEL).not.toContain("label: 'Type'");
  });

  it('the Font page carries no Font or Weight label — the pill and the segments name themselves', () => {
    const text = SRC('components', 'TextBar.tsx');
    expect(text).not.toContain('>Font</Text>');
    expect(text).not.toContain('label="Weight"');
    expect(text).toContain('accessibilityLabel={`Font: ${label}`}');
  });

  it('the Spacing page is Char, Line and Bend on separate lines; Align is the two unlabelled alignment rows', () => {
    const text = SRC('components', 'TextBar.tsx');
    const spacing = text.slice(text.indexOf("page === 'spacing' ? ("), text.indexOf(') : (', text.indexOf("page === 'spacing' ? (")));
    for (const label of ['Char', 'Line', 'Bend']) expect(spacing).toContain(`label="${label}"`);
    expect(text).not.toContain('DualSliderRow');
    const align = text.slice(text.lastIndexOf(') : (\n          <>'), text.indexOf('</BarBody>'));
    expect(align).toContain('options={ALIGNS}');
    expect(align).toContain('options={VALIGNS}');
    expect(align).not.toContain('label="Align"');
    expect(align).not.toContain('label="Vertical"');
    expect(align).not.toContain('Bend');
    // …and the panel offers them as two tabs.
    expect(PANEL).toContain("{ key: 'spacing', label: 'Spacing', sub: 'spacing', onPress: () => openSubmenu('spacing') },");
    expect(PANEL).toContain("model.showTextStyle ? ['font', 'spacing', 'align', 'shadow']");
  });

  it('text offers Type · Spacing · Align · Shadow — no Edit tab; a tap on the text edits its content', () => {
    expect(PANEL).not.toContain("key: 'edit'");
    expect(PANEL).not.toContain('showEdit');
    // No tab fires an edit-the-content callback. (model.onEditOpenChange is
    // a different thing entirely: the sheet's own open state.)
    expect(PANEL).not.toContain('model.onEdit}');
    expect(PANEL).not.toContain('model.onEdit(');
    expect(SRC('adapter.ts')).not.toContain('showEdit');
    expect(SRC('adapter.ts')).not.toContain('onEdit(): void;');
  });

  it('a word sticker offers Color (its Invert toggle) first, then Opacity (whole-magnet, no Soften)', () => {
    expect(PANEL).toContain("const colorTab: OptionSpec = { key: 'color', label: 'Color', sub: 'color', onPress: () => openSubmenu('color') };");
    expect(PANEL).toContain("{ key: 'opacity', label: 'Opacity', sub: 'opacity', onPress: () => openSubmenu('opacity') },");
    expect(PANEL).toContain(": model.showInvert ? ['opacity']");
    // Its card scheme IS its colour, so the Color tab leads.
    expect(PANEL).toContain('model.showFrameOptions || !!model.showInvert;');
    // Invert is no longer a tab of its own.
    expect(PANEL).not.toContain("label: 'Invert', toggled: model.inverted");
    // The Color page lists the Invert toggle as its row…
    expect(PANEL).toContain("colorRows.push({ key: 'invert', kind: 'toggle', label: 'Invert', on: !!model.inverted, onToggle: () => model.onInvert?.() });");
    expect(PANEL).toContain("if (displaySub === 'color') {\n    activeBarEl = <ColorBar rows={colorRows} />;");
    const color = SRC('components', 'ColorBar.tsx');
    expect(color).toContain('<MultiToggleRow');
    expect(color).toContain("options={[{ value: 'on' as const, label: row.label, active: row.on }]}");
    // …and its open state is the panel's own, closed as any host page opens
    // and folded when the selection stops offering it.
    expect(PANEL).toContain('setLocalSub(isLocalSubmenu(key) ? key : null);');
    expect(PANEL).toContain('if (isLocalSubmenu(key)) { dismissHostSubmenus(); return; }');
    expect(PANEL).toContain("(localSub === 'color' && !colorable)");
    // Opacity: the page an image opens, kept open for a sticker, its Soften
    // row dropped and its height counted without it.
    expect(PANEL).toContain('svgOpacityable || model.showRigOptions || model.showInvert;');
    expect(PANEL).toContain('showSoften={!model.showInvert}');
    expect(PANEL).toContain('opacitySoften: !model.showInvert,');
    const opacity = SRC('components', 'OpacityBar.tsx');
    expect(opacity).toContain('{showSoften ? (');
  });

  it('the Endpoints page carries markers alone — no Caps row, and no plumbing left for one', () => {
    const ends = SRC('components', 'EndpointsBar.tsx');
    expect(ends).toContain('label="Start"');
    expect(ends).toContain('label="End"');
    // No Caps CONTROL (the comment explaining its removal may say the word).
    expect(ends).not.toContain('label="Caps"');
    expect(ends).not.toContain('showCaps');
    expect(ends).not.toContain('EndCapKind');
    expect(ends).not.toContain('DualSegmentedRow');
    expect(PANEL).not.toContain('svgHasEndCaps');
    expect(SRC('logic', 'submenuHeight.ts')).not.toContain('endpointCaps');
  });

  it('a polygonal shape rounds its corners on a Shape page; its Stroke page has no Radius row and an unlabelled Position row', () => {
    expect(PANEL).toContain("...(svgShapeable ? (['shape'] as const) : []),");
    expect(PANEL).toContain("const svgShapeable = !!model.showSvgOptions && svgHasShape(model.svgSubtype ?? 'stroke');");
    expect(PANEL).toContain(": action === 'shape' ? 'shape'");
    // The Shape page is the panel's own (like Color) and folds when the
    // subtype stops offering it.
    expect(PANEL).toContain("(localSub === 'shape' && !svgShapeable)");
    expect(PANEL).toContain('<ShapeBar');
    expect(PANEL).toContain('cornerRadius={model.strokeRadius ?? 0}');
    expect(PANEL).toContain('onCornerRadius={(r, committed) => model.onStrokeRadius?.(r, committed)}');
    const shape = SRC('components', 'ShapeBar.tsx');
    expect(shape).toContain('<RadiusRow cornerRadius={cornerRadius} onCornerRadius={onCornerRadius} />');
    // The Stroke page: no Radius, and Position's cells name themselves.
    const stroke = PANEL.slice(PANEL.indexOf("} else if (displaySub === 'stroke') {"), PANEL.indexOf("} else if (displaySub && rigPartOfSubmenu(displaySub)) {"));
    expect(stroke).toContain('showRadius={false}');
    expect(stroke).toContain('labelPosition={false}');
    const border = SRC('components', 'BorderBar.tsx');
    expect(border).toContain("label={labelPosition ? 'Position' : undefined}");
    // Width, Dash, then Position: the line's own two properties together,
    // then where it sits against the edge (Position used to divide them).
    expect(border.indexOf('label="Dash"')).toBeLessThan(border.indexOf("'Position'"));
    expect(border.indexOf('label="Width"')).toBeLessThan(border.indexOf('label="Dash"'));
    // The image's Border page keeps both, untouched.
    const imageBorder = PANEL.slice(PANEL.indexOf("} else if (displaySub === 'border') {"), PANEL.indexOf("} else if (displaySub === 'stroke') {"));
    expect(imageBorder).not.toContain('showRadius');
    expect(imageBorder).not.toContain('labelPosition');
  });

  it('a tab that opens a page opens it — it never toggles the page closed', () => {
    // The old options toggled their bar; a lit tab pressed again stays lit.
    expect(PANEL).not.toContain('toggleShadow');
    expect(PANEL).not.toContain('toggleCrop');
    expect(PANEL).toContain("{ key: 'shadow', label: 'Shadow', sub: 'shadow', onPress: () => openSubmenu('shadow') },");
    expect(PANEL).toContain("onPress: () => openSubmenu(opt.action as SubmenuKey),");
  });
});
