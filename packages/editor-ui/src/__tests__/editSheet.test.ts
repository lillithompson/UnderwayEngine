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
    const order = ['<EditTabs tabs={tabs} />', '<View style={styles.well}>{content}</View>']
      .map((s) => SHEET.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // No well at all when no tab has a page showing (every tab an action).
    expect(SHEET).toContain("{content != null ? <View style={styles.well}>{content}</View> : null}");
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

  it('a colour-bearing page keeps its swatch in an aside column to the left of its rows', () => {
    expect(BAR).toContain('export function ColorAside(');
    expect(BAR).toContain('export function BarBody(');
    for (const [file, label] of [
      ['BorderBar.tsx', '{`${title} color`}'],
      ['TintBar.tsx', '{`${title} color`}'],
      ['TextBar.tsx', '"Text color"'],
      ['ShadowBar.tsx', '"Drop shadow color"'],
    ]) {
      const src = SRC('components', file);
      expect([file, src.includes('<ColorAside')]).toEqual([file, true]);
      expect([file, src.includes(`label=${label}`)]).toEqual([file, true]);
    }
    // The Shadow page: the offset pad over the swatch, its sliders spread to
    // the column's height beside them.
    const shadow = SRC('components', 'ShadowBar.tsx');
    expect(shadow).toMatch(/<BarBody\s+spread\s+aside=\{\(\s*<>\s*<XYPad/);
    // Pages with nothing coloured have no aside.
    for (const file of ['OpacityBar.tsx', 'CropBar.tsx', 'EndpointsBar.tsx', 'LayoutBar.tsx', 'TransformBar.tsx', 'RigPoseBar.tsx']) {
      expect([file, SRC('components', file).includes('aside=')]).toEqual([file, false]);
    }
  });

  it('the Crop page: no Mode label, no Replace, no resolution line', () => {
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
    // …and neither the model nor the height context carries what they fed.
    expect(SRC('adapter.ts')).not.toContain('onReplaceImage');
    expect(SRC('adapter.ts')).not.toContain('imagePixelSize');
    expect(SRC('logic', 'submenuHeight.ts')).not.toContain('cropCanReplace');
    expect(SRC('logic', 'submenuHeight.ts')).not.toContain('cropHasResolution');
  });
});

describe('the panel drives the sheet', () => {
  it('pops it over the panel, rounded, sized to its page', () => {
    // The rise: sized first, then slid up from below the screen edge.
    const open = PANEL.slice(PANEL.indexOf('if (sheetOpen && !prevSheetOpen.current) {'), PANEL.indexOf('if (!sheetOpen && prevSheetOpen.current) {'));
    expect(open).toContain('sheetH.setValue(sheetHeight);');
    expect(open).toContain('sheetY.setValue(sheetHeight);');
    expect(open).toContain('Animated.timing(sheetY, { toValue: 0, duration: PANEL_ANIM_MS, useNativeDriver: false })');
    // The sheet's height is what the arithmetic says for the showing page.
    expect(PANEL).toContain('const sheetHeight = editSheetHeight(contentHeight, { removable: !!removeAction, safeBottom });');
    expect(PANEL).toContain('{ height: sheetH, transform: [{ translateY: sheetY }] },');
  });

  it('animates the height when a tab is chosen — a shorter page pushes the top edge down', () => {
    const resize = PANEL.slice(PANEL.indexOf('if (sheetOpen) {\n      // A tab change'), PANEL.indexOf('}, [sheetOpen, sheetHeight, sheetH, sheetY]);'));
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
    expect(PANEL).toContain('const displaySub: SubmenuKey | null = activeSub ?? (sheetOpen ? null : lastSubRef.current);');
  });

  it('the Type page carries no Font or Weight label — the pill and the segments name themselves', () => {
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
    expect(PANEL).not.toContain('model.onEdit');
    expect(SRC('adapter.ts')).not.toContain('showEdit');
    expect(SRC('adapter.ts')).not.toContain('onEdit(): void;');
  });

  it('a word sticker offers Color (its Invert toggle) and Opacity (whole-magnet, no Soften)', () => {
    expect(PANEL).toContain("{ key: 'color', label: 'Color', sub: 'color', onPress: () => openSubmenu('color') },");
    expect(PANEL).toContain("{ key: 'opacity', label: 'Opacity', sub: 'opacity', onPress: () => openSubmenu('opacity') },");
    expect(PANEL).toContain(": model.showInvert ? ['color', 'opacity']");
    // Invert is no longer a tab of its own.
    expect(PANEL).not.toContain("label: 'Invert', toggled: model.inverted");
    // The Color page lists the Invert toggle as its one row…
    expect(PANEL).toContain("[{ key: 'invert', kind: 'toggle', label: 'Invert', on: !!model.inverted, onToggle: () => model.onInvert?.() }]");
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

  it('the Endpoints page drops its Caps row on a freehand curve, and its height with it', () => {
    const ends = SRC('components', 'EndpointsBar.tsx');
    expect(ends).toContain('{showCaps ? (');
    expect(PANEL).toContain("showCaps={svgHasEndCaps(model.svgSubtype ?? 'stroke')}");
    expect(PANEL).toContain("endpointCaps: svgHasEndCaps(model.svgSubtype ?? 'stroke'),");
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
    const stroke = PANEL.slice(PANEL.indexOf('title="Stroke"'), PANEL.indexOf("} else if (displaySub && rigPartOfSubmenu(displaySub)) {"));
    expect(stroke).toContain('showRadius={false}');
    expect(stroke).toContain('labelPosition={false}');
    const border = SRC('components', 'BorderBar.tsx');
    expect(border).toContain("label={labelPosition ? 'Position' : undefined}");
    // The image's Border page keeps both, untouched.
    const imageBorder = PANEL.slice(PANEL.indexOf("} else if (displaySub === 'border') {"), PANEL.indexOf('title="Stroke"'));
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
