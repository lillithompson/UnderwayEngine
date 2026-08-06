// The object-properties chrome (the bottom panel and every submenu bar) is
// deliberately the SAME scheme as the toolbar: a light #e5e5e5 surface with
// dark ink. It used to be Facet's dark sheet, and the components are the sort
// that get colors pasted back into them one bar at a time — so this pins the
// contract two ways: the tokens themselves, and the source of every file that
// draws a properties menu.
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  HEADER_BG,
  HEADER_INK,
  PANEL_BG,
  PANEL_BORDER,
  PANEL_CONTROL,
  PANEL_DOT,
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

// Every file that paints a properties menu or one of its submenus. The modal
// surfaces (ColorPickerModal, RenameModal) are NOT here — they float over the
// whole editor rather than sitting alongside the toolbar, so they stay dark.
const MENU_FILES = [
  'ObjectPropertiesPanel.tsx',
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
      PANEL_DOT, PANEL_INK_HAIRLINE, PANEL_BORDER, PANEL_TRACK,
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
  });

  it('fills its value controls in selection blue', () => {
    // effectBar.tsx can't be imported here (it pulls in @expo/vector-icons,
    // which has no node shim), so the contract is checked at the source: the
    // token is STATE_ACTIVE, and no Slider is still wired to the text-weight
    // ACCENT it used to default to.
    const bar = read('effectBar.tsx');
    expect(/^export const CONTROL_ACCENT = STATE_ACTIVE;/m.test(bar)).toBe(true);
    expect(/accent=\{ACCENT\}/.test(bar)).toBe(false);
    // Three sliders live here: SliderRow, plus both halves of DualSliderRow.
    expect(bar.match(/accent=\{CONTROL_ACCENT\}/g)).toHaveLength(3);
    // The Shadow bar's XY pad is the same control on two axes.
    expect(/backgroundColor: CONTROL_ACCENT/.test(read('ShadowBar.tsx'))).toBe(true);
  });

  it('dresses the type-specific options as the toolbar pushdown does', () => {
    const panel = read('ObjectPropertiesPanel.tsx');
    expect(/function OptionPill\(/.test(panel)).toBe(true);
    // Every type-specific option is a pill; the common-actions row keeps its
    // icon buttons, so both components must still be in play.
    expect((panel.match(/<OptionPill/g) ?? []).length).toBeGreaterThanOrEqual(10);
    expect(/<GridButton/.test(panel)).toBe(true);
    // The three things that make it the pushdown's capsule rather than a new
    // look: fully-round, the pushdown's inactive grey, selection blue when lit.
    expect(/optionPill: \{[^}]*borderRadius: 999/s.test(panel)).toBe(true);
    expect(/optionLabel: \{[^}]*color: PUSHDOWN_INACTIVE/s.test(panel)).toBe(true);
    expect(/backgroundColor: tint \?\? STATE_ACTIVE/.test(panel)).toBe(true);
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
