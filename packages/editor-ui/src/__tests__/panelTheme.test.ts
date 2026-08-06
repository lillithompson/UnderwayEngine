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
    // The type row is spec-driven (one OptionPill mapped over typeSpecs, so the
    // row can find WHICH option is selected); the common-actions row keeps its
    // icon buttons. Both components must still be in play.
    expect(/function OptionPill\(/.test(panel)).toBe(true);
    expect(/typeSpecs!\.map\(/.test(panel)).toBe(true);
    expect(/<GridButton/.test(panel)).toBe(true);
    // The pushdown's capsule rather than a new look: fully-round, the
    // pushdown's inactive grey, selection blue under the selected one.
    expect(/optionPill: \{[^}]*borderRadius: 999/s.test(panel)).toBe(true);
    expect(/optionLabel: \{[^}]*color: PUSHDOWN_INACTIVE/s.test(panel)).toBe(true);
    expect(/optionCapsule: \{[^}]*backgroundColor: STATE_ACTIVE/s.test(panel)).toBe(true);
    // The pushdown's word is 13/600 at every width. A narrow-screen override
    // that shrank it was the one thing keeping the two from matching.
    expect(/optionLabel: \{[^}]*fontSize: 13, fontWeight: '600'/s.test(panel)).toBe(true);
    expect(/optionLabelCompact/.test(panel)).toBe(false);
  });

  it('gives the row one sliding capsule, not a fill per option', () => {
    const panel = read('ObjectPropertiesPanel.tsx');
    // A single capsule component, rendered once, driven by an offset.
    expect(/function OptionCapsule\(/.test(panel)).toBe(true);
    expect((panel.match(/<OptionCapsule/g) ?? []).length).toBe(1);
    // Constant width: taken from the row's layout, never from the option.
    expect(/width=\{capsule\.width\}/.test(panel)).toBe(true);
    // It moves by transform, so sliding costs no layout.
    expect(/transform: \[\{ translateX: x \}\]/.test(panel)).toBe(true);
    // Only an independent toggle (Repeat / Invert) still paints its own fill —
    // a selected submenu option is covered by the shared capsule.
    expect(/spec\.toggled \? \{ backgroundColor: spec\.tint \?\? STATE_ACTIVE \}/.test(panel)).toBe(true);
  });

  it('stacks the submenu above the panel rather than over it', () => {
    const panel = read('ObjectPropertiesPanel.tsx');
    // Anchored to the panel's top edge, not the screen's bottom. A `bottom: 0`
    // back in effectBarWrap would put the bar over the options row again.
    expect(/effectBarWrap: \{[^}]*bottom: 0/s.test(panel)).toBe(false);
    expect(/bottom: panelBox\.height/.test(panel)).toBe(true);
    // Under the panel in z-order, which is what lets a dismiss slide it down
    // behind that opaque surface instead of across it.
    // (the panel's own z sits on its `clip` wrapper, which is what draws over
    // the bar — so the bar's must be the smaller of the two.)
    expect(/effectBarWrap: \{[^}]*zIndex: 195/s.test(panel)).toBe(true);
    expect(/clip: \{[^}]*zIndex: 200/s.test(panel)).toBe(true);
    // It rides the panel's show/hide slide on top of its own reveal, so the two
    // can't come apart mid-animation.
    expect(/Animated\.add\(layerY, translateY\)/.test(panel)).toBe(true);
    // The lit option replaced the bar's own carousel dots.
    expect(/submenuDots/.test(panel)).toBe(false);
    expect(/const subOpen = \(key: SubmenuKey\) => activeSub === key/.test(panel)).toBe(true);
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
