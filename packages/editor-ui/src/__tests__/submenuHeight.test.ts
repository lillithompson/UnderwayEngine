import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  ASIDE_GAP,
  ASIDE_SWATCH,
  BAR_CUSHION,
  CONTENT_PAD,
  HINT_HEIGHT,
  ROW_GAP,
  ROW_PILL,
  ROW_SEGMENTED,
  ROW_SLIDER,
  SHADOW_ASIDE,
  SHADOW_PAD_SIZE,
  SHEET_CONTENT_TOP,
  SHEET_PAD_BOTTOM,
  SHEET_PAD_TOP,
  SHEET_REMOVE,
  SHEET_TABS,
  SLIDER_CONTROL,
  SLIDER_LABEL,
  SLIDER_LABEL_GAP,
  SubmenuKey,
  editSheetHeight,
  submenuHeight,
} from '../logic/submenuHeight';
import { svgStrokeRows } from '../logic/svgEdit';

/** The content area's chrome around any page: its padding and the cushion. */
const CHROME = CONTENT_PAD * 2 + BAR_CUSHION;
/** What a page of `rows` should measure, beside an aside `aside` tall (0 for
 *  a page with none): the taller of the two, in the chrome. */
const pageOf = (rows: number[], aside = 0) =>
  CHROME + Math.max(rows.reduce((a, b) => a + b, 0) + (rows.length - 1) * ROW_GAP, aside);

describe('submenuHeight (a page’s content area)', () => {
  test('a page is its chrome plus its rows and their gaps', () => {
    // Opacity is the plain case: two sliders, nothing conditional, no aside.
    expect(submenuHeight('opacity')).toBe(pageOf([ROW_SLIDER, ROW_SLIDER]));
  });

  test('a colour-bearing page stands at least as tall as its swatch', () => {
    // The Fill page is one slider (48) beside a 56 swatch: the swatch wins.
    expect(ROW_SLIDER).toBeLessThan(ASIDE_SWATCH);
    expect(submenuHeight('svgFill')).toBe(pageOf([ROW_SLIDER], ASIDE_SWATCH));
    expect(submenuHeight('svgFill')).toBe(CHROME + ASIDE_SWATCH);
    // A four-row Border outstands its swatch, so the rows set it.
    expect(submenuHeight('border')).toBe(pageOf([ROW_SLIDER, ROW_SLIDER, ROW_SEGMENTED, ROW_SLIDER], ASIDE_SWATCH));
  });

  test('the Text pages: Type is three rows beside the swatch, Align four with none', () => {
    expect(submenuHeight('font')).toBe(pageOf([ROW_PILL, ROW_SEGMENTED, ROW_SLIDER], ASIDE_SWATCH));
    // Char/Line still share a row; the Bend slider stands on its own.
    expect(submenuHeight('align'))
      .toBe(pageOf([ROW_SLIDER, ROW_SLIDER, ROW_SEGMENTED, ROW_SEGMENTED]));
  });

  test('the Tint page grows a row per gradient feature', () => {
    const solid = submenuHeight('tint', { tintType: 'solid' });
    const radial = submenuHeight('tint', { tintType: 'radial' });
    const linear = submenuHeight('tint', { tintType: 'linear' });
    // Radial adds the stop editor; linear adds the angle slider on top.
    expect(radial - solid).toBe(ROW_PILL + ROW_GAP);
    expect(linear - radial).toBe(ROW_SLIDER + ROW_GAP);
  });

  test('the Fill page is solid-only: one fixed row, deaf to any tint type', () => {
    // No context feeds it — a mid-gradient image tint doesn't grow it.
    expect(submenuHeight('svgFill', { tintType: 'linear' }))
      .toBe(submenuHeight('svgFill'));
    // …which keeps it strictly shorter than the full Tint page.
    expect(submenuHeight('svgFill'))
      .toBeLessThan(submenuHeight('tint', { tintType: 'solid' }));
  });

  test('the Stroke page drops the rows a subtype has no answer for', () => {
    // A line has neither corner radius nor stroke position: Width + Dash only.
    const line = submenuHeight('stroke', { strokeRows: svgStrokeRows('line') });
    expect(line).toBe(pageOf([ROW_SLIDER, ROW_SLIDER], ASIDE_SWATCH));
    // A rectangle has both, so it is the full four rows.
    const rect = submenuHeight('stroke', { strokeRows: svgStrokeRows('rectangle') });
    expect(rect).toBe(pageOf([ROW_SLIDER, ROW_SLIDER, ROW_SEGMENTED, ROW_SLIDER], ASIDE_SWATCH));
    expect(rect).toBeGreaterThan(line);
  });

  test('the Crop page counts the rows its mode brings — and nothing else', () => {
    // The mode row, then the mode's own rows. No resolution caption, no
    // Replace row: both came off the page.
    expect(submenuHeight('crop', { cropMode: 'crop' })).toBe(pageOf([ROW_SEGMENTED, ROW_SEGMENTED, ROW_SLIDER]));
    // Fill is the Zoom slider alone: its "drag the artwork" hint came off.
    expect(submenuHeight('crop', { cropMode: 'fill' })).toBe(pageOf([ROW_SEGMENTED, ROW_SLIDER]));
    expect(submenuHeight('crop', { cropMode: 'fit' })).toBe(pageOf([ROW_SEGMENTED, ROW_SLIDER, HINT_HEIGHT]));
    expect(submenuHeight('crop', { cropMode: 'tile' })).toBe(pageOf([ROW_SEGMENTED, ROW_SLIDER, ROW_SLIDER]));
    // A live mode switch resizes the page.
    expect(submenuHeight('crop', { cropMode: 'tile' })).not.toBe(submenuHeight('crop', { cropMode: 'fill' }));
  });

  test('the Shadow page is sized by the taller of its pad-over-swatch column and the sliders beside it', () => {
    expect(SHADOW_ASIDE).toBe(SHADOW_PAD_SIZE + ASIDE_GAP + ASIDE_SWATCH);
    expect(submenuHeight('shadow')).toBe(pageOf([ROW_SLIDER, ROW_SLIDER, ROW_SLIDER], SHADOW_ASIDE));
    // The pad over the swatch outstands three slider rows, so the column
    // sets it (and the sliders spread to fill it).
    expect(SHADOW_ASIDE).toBeGreaterThan(ROW_SLIDER * 3 + ROW_GAP * 2);
  });

  test('a slider row is its caption, the gap under it, and the control line', () => {
    expect(ROW_SLIDER).toBe(SLIDER_LABEL + SLIDER_LABEL_GAP + SLIDER_CONTROL);
    // The control line holds the pill track with a hair to spare for the
    // thumb's ring and shadow — read from the Slider's source, since the
    // component can't be imported here.
    const slider = readFileSync(resolve(__dirname, '..', 'components', 'Slider.tsx'), 'utf8');
    const track = Number(/export const SLIDER_TRACK = (\d+);/.exec(slider)?.[1]);
    expect(track).toBeGreaterThan(0);
    expect(SLIDER_CONTROL).toBeGreaterThanOrEqual(track);
    expect(SLIDER_CONTROL - track).toBeLessThanOrEqual(6);
  });

  test('the Layout page grows the Arrange row only when Grid is wired up', () => {
    const aligns = pageOf([ROW_SEGMENTED, ROW_SEGMENTED]);
    expect(submenuHeight('layout')).toBe(aligns);
    expect(submenuHeight('layout', { layoutHasGrid: false })).toBe(aligns);
    expect(submenuHeight('layout', { layoutHasGrid: true }))
      .toBe(aligns + ROW_SEGMENTED + ROW_GAP);
  });

  test('every page reports a real height, not a fallback', () => {
    // A key with no case would fall through; each of these is a whole page,
    // so none may come back as bare chrome.
    const ALL: SubmenuKey[] = [
      'tint', 'crop', 'shadow', 'border', 'opacity',
      'font', 'align', 'stroke', 'svgFill', 'endpoints', 'transform', 'layout',
      'rigRoot', 'rigHands', 'rigFeet', 'rigSpine', 'rigHead',
      'patternTiles', 'patternTools', 'patternSymmetry',
    ];
    for (const key of ALL) {
      expect([key, submenuHeight(key) >= CHROME + ROW_SLIDER]).toEqual([key, true]);
    }
  });

  test('defaults to the shortest reading when a page is undescribed', () => {
    // An unopened Tint is solid; an unopened Crop is Fill.
    expect(submenuHeight('tint')).toBe(submenuHeight('tint', { tintType: 'solid' }));
    expect(submenuHeight('crop')).toBe(submenuHeight('crop', { cropMode: 'fill' }));
  });

  test('the page metrics are the ones the layouts draw with', () => {
    // The well's padding, the aside column and the swatch are laid out from
    // these same constants (effectBar.tsx / EditSheet.tsx), so the
    // arithmetic can't drift from the layout it predicts.
    const bar = readFileSync(resolve(__dirname, '..', 'components', 'effectBar.tsx'), 'utf8');
    expect(bar).toMatch(/swatch: \{\s*width: ASIDE_SWATCH, height: ASIDE_SWATCH/);
    expect(bar).toMatch(/body: \{[^}]*gap: ASIDE_GAP/);
    expect(bar).toMatch(/rows: \{ gap: ROW_GAP \}/);
    const sheet = readFileSync(resolve(__dirname, '..', 'components', 'EditSheet.tsx'), 'utf8');
    expect(sheet).toMatch(/well: \{[^}]*padding: CONTENT_PAD/s);
    const shadow = readFileSync(resolve(__dirname, '..', 'components', 'ShadowBar.tsx'), 'utf8');
    expect(shadow).toContain('const PAD_SIZE = SHADOW_PAD_SIZE;');
  });
});

describe('editSheetHeight (the sheet around a page)', () => {
  // No title over the tabs: the sheet opens straight on its tab row.
  const HEAD = SHEET_PAD_TOP + SHEET_TABS;

  test('a sheet with a page showing is its tabs, the well, and the bottom padding', () => {
    const content = submenuHeight('opacity');
    expect(editSheetHeight(content)).toBe(HEAD + SHEET_CONTENT_TOP + content + SHEET_PAD_BOTTOM);
  });

  test('each page stands only as tall as it needs — the sheet resizes between tabs', () => {
    // An image's Crop (Fill mode) and Border pages are different heights,
    // and the sheet is different with them: nothing is reserved for the
    // tallest page a selection can reach.
    const crop = editSheetHeight(submenuHeight('crop', { cropMode: 'fill' }));
    const border = editSheetHeight(submenuHeight('border'), { removable: true });
    expect(crop).not.toBe(border);
    expect(border - crop).toBe(submenuHeight('border') - submenuHeight('crop', { cropMode: 'fill' }) + SHEET_REMOVE);
  });

  test('a removable page adds the Remove line; an absent one adds nothing', () => {
    const content = submenuHeight('shadow');
    expect(editSheetHeight(content, { removable: true }) - editSheetHeight(content)).toBe(SHEET_REMOVE);
    expect(editSheetHeight(content, { removable: false })).toBe(editSheetHeight(content));
  });

  test('a sheet with no page (every tab an action) is the tabs alone', () => {
    expect(editSheetHeight(null)).toBe(HEAD + SHEET_PAD_BOTTOM);
    // Remove means nothing without a page under it.
    expect(editSheetHeight(null, { removable: true })).toBe(editSheetHeight(null));
  });

  test('pads the device’s bottom inset under its last line', () => {
    expect(editSheetHeight(null, { safeBottom: 34 })).toBe(editSheetHeight(null) + 34);
    const content = submenuHeight('border');
    expect(editSheetHeight(content, { removable: true, safeBottom: 34 }))
      .toBe(editSheetHeight(content, { removable: true }) + 34);
  });

  test('the sheet metrics are the ones EditSheet lays out with', () => {
    const sheet = readFileSync(resolve(__dirname, '..', 'components', 'EditSheet.tsx'), 'utf8');
    expect(sheet).toMatch(/sheet: \{\s*paddingTop: SHEET_PAD_TOP/);
    expect(sheet).toContain('paddingBottom: SHEET_PAD_BOTTOM + safeBottom');
    expect(sheet).toMatch(/tabs: \{ height: SHEET_TABS \}/);
    expect(sheet).toMatch(/well: \{\s*marginTop: SHEET_CONTENT_TOP/);
    expect(sheet).toMatch(/removeRow: \{ height: SHEET_REMOVE/);
  });
});
