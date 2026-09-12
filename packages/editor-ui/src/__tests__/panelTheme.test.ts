// The object-properties chrome (the bottom panel, the Edit sheet and every
// property page) is deliberately the SAME scheme as the toolbar: a light
// #e5e5e5 surface with dark ink. It used to be Facet's dark sheet, and the
// components are the sort that get colors pasted back into them one page at a
// time — so this pins the contract two ways: the tokens themselves, and the
// source of every file that draws a properties menu.
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  HEADER_BG,
  HEADER_INK,
  PANEL_BG,
  PANEL_BG_CLEAR,
  PANEL_BORDER,
  PANEL_CONTENT_WELL,
  PANEL_CONTROL,
  PANEL_ICON,
  PANEL_INK,
  PANEL_INK_DIM,
  PANEL_INK_HAIRLINE,
  PANEL_INK_LABEL,
  PANEL_INK_MUTED,
  PANEL_SHEET_BORDER,
  PANEL_SHEET_ROW_ACTIVE,
  PANEL_SWATCH_BORDER,
  PANEL_TRACK,
  STATE_INACTIVE,
} from '@/editor-ui/theme';

const COMPONENTS = join(__dirname, '..', 'components');

// Every file that paints a properties menu or one of its pages. The modal
// surfaces (ColorPickerModal, RenameModal) are NOT here — they float over the
// whole editor rather than sitting alongside the toolbar, so they stay dark.
const MENU_FILES = [
  'ObjectPropertiesPanel.tsx',
  'EditSheet.tsx',
  'effectBar.tsx',
  'BorderBar.tsx',
  'CropBar.tsx',
  'EndpointsBar.tsx',
  'LayoutBar.tsx',
  'OpacityBar.tsx',
  'ShadowBar.tsx',
  'TextBar.tsx',
  'TintBar.tsx',
];

const read = (file: string) => readFileSync(join(COMPONENTS, file), 'utf8');

describe('object-properties chrome matches the toolbar', () => {
  it('draws on the toolbar surface, in the toolbar ink', () => {
    expect(PANEL_BG).toBe(HEADER_BG);
    expect(PANEL_INK).toBe(HEADER_INK);
    // The fade's far end is the same surface at zero alpha — not
    // 'transparent', which iOS blends as black.
    expect(PANEL_BG_CLEAR).toBe('rgba(229, 229, 229, 0)');
  });

  it('weights its buttons like the toolbar weights an unselected tool', () => {
    // Not full ink: #2a2a2a at 100% against #e5e5e5 reads harder than the tools
    // it sits opposite, which is what a solid PANEL_INK here looked like.
    expect(PANEL_ICON).toBe(STATE_INACTIVE);
    expect(PANEL_ICON).not.toBe(PANEL_INK);
  });

  it('renders every ink token as dark ink, never as white-on-dark', () => {
    const inks = {
      PANEL_INK, PANEL_ICON, PANEL_INK_LABEL, PANEL_INK_DIM, PANEL_INK_MUTED,
      PANEL_INK_HAIRLINE, PANEL_BORDER, PANEL_TRACK, PANEL_CONTENT_WELL,
      PANEL_SWATCH_BORDER, PANEL_SHEET_BORDER, PANEL_SHEET_ROW_ACTIVE,
    };
    for (const [name, value] of Object.entries(inks)) {
      // #2a2a2a or an rgba struck from it — anything rgba(255,…) would be a
      // token that drifted back to the dark scheme.
      expect([name, /^(#2a2a2a|rgba\(42, 42, 42, [\d.]+\))$/.test(value)]).toEqual([name, true]);
    }
    // The one deliberately light token: the raised/selected cell, which on a
    // light track has to be lighter still.
    expect(PANEL_CONTROL).toBe('#ffffff');
    // The sheet's content well darkens the surface a shade past the track,
    // so a track inside it still reads as recessed.
    const alpha = (v: string) => Number(/rgba\(42, 42, 42, ([\d.]+)\)/.exec(v)?.[1]);
    expect(alpha(PANEL_CONTENT_WELL)).toBeGreaterThan(alpha(PANEL_TRACK));
  });

  it('fills its value controls in selection blue', () => {
    // effectBar.tsx can't be imported here (it pulls in @expo/vector-icons,
    // which has no node shim), so the contract is checked at the source: the
    // token is STATE_ACTIVE, and no Slider is still wired to the text-weight
    // ACCENT it used to default to.
    const bar = read('effectBar.tsx');
    expect(/^export const CONTROL_ACCENT = STATE_ACTIVE;/m.test(bar)).toBe(true);
    expect(/accent=\{ACCENT\}/.test(bar)).toBe(false);
    // One slider lives here now — SliderRow, whose accent a color picker
    // may override — on the token. (The dual slider row that shared it went
    // when its last pair became a RowGroup.)
    expect(bar.match(/accent=\{(accent \?\? )?CONTROL_ACCENT\}/g)).toHaveLength(1);
    // The Shadow page's XY pad is the same control on two axes.
    expect(/backgroundColor: CONTROL_ACCENT/.test(read('ShadowBar.tsx'))).toBe(true);
  });

  it('keeps the common actions as icon buttons and hands the options to the sheet', () => {
    const panel = read('ObjectPropertiesPanel.tsx');
    // The common-actions row keeps its icon buttons…
    expect(/<GridButton/.test(panel)).toBe(true);
    // …and the type-specific options are described (OptionSpec) and become
    // the Edit sheet's tabs, the lit one being whichever page is showing.
    expect(/interface OptionSpec extends Omit<EditTabSpec, 'selected'>/.test(panel)).toBe(true);
    expect(panel).toContain("selected: sub !== undefined ? subOpen(sub) : undefined,");
    expect(panel).toContain('<EditSheet');
    expect(panel).toContain('content={activeBarEl}');
    expect(panel).toContain('remove={removeAction}');
    // The row of word pills that used to sit in the panel is gone with the
    // sliding capsule that lit them.
    expect(/function OptionPill\(/.test(panel)).toBe(false);
    expect(/function OptionCapsule\(/.test(panel)).toBe(false);
    expect(/PUSHDOWN_INACTIVE/.test(panel)).toBe(false);
  });

  it('dresses the sheet on the panel surface: rounded, over the panel, tabs lit in selection blue', () => {
    const panel = read('ObjectPropertiesPanel.tsx');
    const sheet = read('EditSheet.tsx');
    // Bottom-anchored OVER the panel: its z sits above the panel's clip (200)
    // and the floating capsules (100), on the panel's own surface with the
    // rounded top corners the design has.
    expect(/sheetWrap: \{[^}]*bottom: 0/s.test(panel)).toBe(true);
    expect(/sheetWrap: \{[^}]*zIndex: 210/s.test(panel)).toBe(true);
    expect(/clip: \{[^}]*zIndex: 200/s.test(panel)).toBe(true);
    expect(/sheetWrap: \{[^}]*backgroundColor: PANEL_BG/s.test(panel)).toBe(true);
    expect(/sheetWrap: \{[^}]*borderTopLeftRadius: SHEET_RADIUS/s.test(panel)).toBe(true);
    // The lit tab: selection blue under white; the others are plain ink.
    expect(/tabPillSelected: \{ backgroundColor: STATE_ACTIVE \}/.test(sheet)).toBe(true);
    expect(/tabLabel: \{[^}]*color: PANEL_INK/s.test(sheet)).toBe(true);
    expect(/tabLabelLit: \{[^}]*color: '#ffffff'/s.test(sheet)).toBe(true);
    // The well the controls sit in is the darkened token, rounded.
    expect(/well: \{[^}]*backgroundColor: PANEL_CONTENT_WELL/s.test(sheet)).toBe(true);
    expect(/well: \{[^}]*borderRadius: 16/s.test(sheet)).toBe(true);
    // Neither surface has carousel dots any more: the sheet standing up is
    // what says which page is showing.
    expect(/dot/i.test(sheet)).toBe(false);
    expect(/dotsRow/.test(panel)).toBe(false);
  });

  it('keeps the dark modal surface out of every menu file', () => {
    for (const file of MENU_FILES) {
      const src = read(file);
      // MODAL_BG / MODAL_TEXT are the color picker's + rename modal's dark
      // surface. A properties menu reaching for either is the regression.
      expect([file, /\bMODAL_(BG|TEXT|HEADER_BG|RAISED)\b/.test(src)]).toEqual([file, false]);
    }
  });

  it('leaves the sheet tokens defined once, in the shared chrome', () => {
    // TextBar's font sheet and TintBar's blend sheet each used to carry a
    // private copy of the same six constants. They import them now.
    for (const file of ['TextBar.tsx', 'TintBar.tsx']) {
      expect([file, /^const (SHEET_BG|SHEET_BORDER|SHEET_LABEL|SHEET_ROW_ACTIVE|PILL_TRACK|PILL_CHEVRON)\b/m.test(read(file))])
        .toEqual([file, false]);
    }
    expect(/^export const SHEET_BG\b/m.test(read('effectBar.tsx'))).toBe(true);
  });
});
