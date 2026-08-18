import {
  BAR_BORDER,
  BAR_CONTROLS_TOP,
  BAR_CUSHION,
  BAR_HEADER,
  BAR_PAD_BOTTOM,
  BAR_PAD_TOP,
  CROP_CAPTION_HEIGHT,
  ROW_GAP,
  ROW_PILL,
  ROW_SEGMENTED,
  ROW_SLIDER,
  SHADOW_CONTROLS_TOP,
  SHADOW_PAD_BOTTOM,
  SHADOW_PAD_SIZE,
  SHADOW_PAD_TOP,
  SubmenuKey,
  submenuHeight,
  typeMenuHeight,
} from '../logic/submenuHeight';
import { svgStrokeRows } from '../logic/svgEdit';

/** The chrome every stacked bar carries, independent of its rows. */
const CHROME = BAR_BORDER + BAR_PAD_TOP + BAR_HEADER + BAR_CONTROLS_TOP + BAR_PAD_BOTTOM + BAR_CUSHION;
/** What a bar of `rows` rows of height `h` should measure. */
const barOf = (rows: number[]) =>
  CHROME + rows.reduce((a, b) => a + b, 0) + (rows.length - 1) * ROW_GAP;

// The submenus each selection type can reach, mirroring the panel's
// typeSubmenuOrder. Named here so the per-type expectations below read as the
// product question they are: how tall is a text selection's menu?
const IMAGE: SubmenuKey[] = ['tint', 'crop', 'shadow', 'border', 'opacity'];
const TEXT: SubmenuKey[] = ['font', 'align', 'shadow'];
const FRAME: SubmenuKey[] = ['shadow', 'border'];

describe('submenuHeight', () => {
  test('a bar is its chrome plus its rows and their gaps', () => {
    // Opacity is the plain case: two sliders, nothing conditional.
    expect(submenuHeight('opacity')).toBe(barOf([ROW_SLIDER, ROW_SLIDER]));
  });

  test('both Text pages are three rows, and equal', () => {
    const font = barOf([ROW_PILL, ROW_SEGMENTED, ROW_SLIDER]);
    expect(submenuHeight('font')).toBe(font);
    // Char/Line share a row precisely so Align matches Font.
    expect(submenuHeight('align')).toBe(font);
  });

  test('the Tint bar grows a row per gradient feature', () => {
    const solid = submenuHeight('tint', { tintType: 'solid' });
    const radial = submenuHeight('tint', { tintType: 'radial' });
    const linear = submenuHeight('tint', { tintType: 'linear' });
    // Radial adds the stop editor; linear adds the angle slider on top.
    expect(radial - solid).toBe(ROW_PILL + ROW_GAP);
    expect(linear - radial).toBe(ROW_SLIDER + ROW_GAP);
  });

  test('the Fill bar is the Tint bar, read from the shape fill', () => {
    expect(submenuHeight('svgFill', { svgFillType: 'linear' }))
      .toBe(submenuHeight('tint', { tintType: 'linear' }));
    // …and it reads svgFillType, not tintType.
    expect(submenuHeight('svgFill', { tintType: 'linear' }))
      .toBe(submenuHeight('svgFill', { svgFillType: 'solid' }));
  });

  test('the Stroke bar drops the rows a subtype has no answer for', () => {
    // A line has neither corner radius nor stroke position: Width + Dash only.
    const line = submenuHeight('stroke', { strokeRows: svgStrokeRows('line') });
    expect(line).toBe(barOf([ROW_SLIDER, ROW_SLIDER]));
    // A rectangle has both, so it is the full four rows.
    const rect = submenuHeight('stroke', { strokeRows: svgStrokeRows('rectangle') });
    expect(rect).toBe(barOf([ROW_SLIDER, ROW_SLIDER, ROW_SEGMENTED, ROW_SLIDER]));
    expect(rect).toBeGreaterThan(line);
  });

  test('the Crop bar counts the rows its mode brings, plus the caption', () => {
    const crop = submenuHeight('crop', { cropMode: 'crop', cropHasResolution: true });
    expect(crop).toBe(barOf([ROW_SEGMENTED, ROW_SEGMENTED, ROW_SLIDER]) + CROP_CAPTION_HEIGHT);
    // An image whose pixel size never arrived shows no caption.
    expect(submenuHeight('crop', { cropMode: 'crop', cropHasResolution: false }))
      .toBe(crop - CROP_CAPTION_HEIGHT);
  });

  test('the Crop bar grows a row for Replace, in every mode', () => {
    // Replace is about the image rather than the frame, so it rides every
    // mode — and a host that doesn't wire it up doesn't reserve its room.
    for (const cropMode of ['fill', 'fit', 'crop', 'tile'] as const) {
      const without = submenuHeight('crop', { cropMode });
      const to = submenuHeight('crop', { cropMode, cropCanReplace: true });
      expect(to - without).toBe(ROW_SEGMENTED + ROW_GAP);
    }
  });

  test('the Shadow bar is sized by its XY pad, not by the sliders beside it', () => {
    // Its pad sits alongside three sliders rather than above them, so the
    // taller column wins — and it pads differently from the stacked bars.
    expect(submenuHeight('shadow')).toBe(
      BAR_BORDER + SHADOW_PAD_TOP + BAR_HEADER + SHADOW_CONTROLS_TOP
      + SHADOW_PAD_SIZE + SHADOW_PAD_BOTTOM + BAR_CUSHION,
    );
    // The pad is the taller column; three stacked sliders would be shorter.
    expect(SHADOW_PAD_SIZE).toBeGreaterThan(ROW_SLIDER * 3);
  });

  test('the Layout bar grows the Arrange row only when Grid is wired up', () => {
    const aligns = barOf([ROW_SEGMENTED, ROW_SEGMENTED]);
    expect(submenuHeight('layout')).toBe(aligns);
    expect(submenuHeight('layout', { layoutHasGrid: false })).toBe(aligns);
    expect(submenuHeight('layout', { layoutHasGrid: true }))
      .toBe(aligns + ROW_SEGMENTED + ROW_GAP);
  });

  test('every submenu reports a real height, not a fallback', () => {
    // A key with no case would fall through; each of these is a whole bar, so
    // none may come back as bare chrome.
    const ALL: SubmenuKey[] = [
      'tint', 'crop', 'shadow', 'border', 'opacity',
      'font', 'align', 'stroke', 'svgFill', 'endpoints', 'layout',
    ];
    for (const key of ALL) {
      expect([key, submenuHeight(key) > CHROME + ROW_SLIDER]).toEqual([key, true]);
    }
  });

  test('defaults to the shortest reading when a bar is undescribed', () => {
    // An unopened Tint is solid; an unopened Crop is Fill.
    expect(submenuHeight('tint')).toBe(submenuHeight('tint', { tintType: 'solid' }));
    expect(submenuHeight('crop')).toBe(submenuHeight('crop', { cropMode: 'fill' }));
  });
});

describe('typeMenuHeight', () => {
  test("a type's menu is as tall as its tallest bar, and no taller", () => {
    const ctx = { tintType: 'solid' as const, cropMode: 'fill' as const, cropHasResolution: true };
    const tallest = Math.max(...IMAGE.map((k) => submenuHeight(k, ctx)));
    expect(typeMenuHeight(IMAGE, ctx)).toBe(tallest);
    for (const key of IMAGE) expect(submenuHeight(key, ctx)).toBeLessThanOrEqual(tallest);
  });

  test('text stands three rows tall — not the five an image can need', () => {
    // The reported bug: text's two bars are three rows each, but every bar in
    // the editor reserved room for the tallest bar anywhere (a linear-gradient
    // Tint, five rows).
    expect(typeMenuHeight(TEXT)).toBe(submenuHeight('font'));
    const imageAtWorst = typeMenuHeight(IMAGE, { tintType: 'linear' });
    expect(typeMenuHeight(TEXT)).toBeLessThan(imageAtWorst);
  });

  test("text's Shadow bar fits the height its typography bars already set", () => {
    // Text gained the image's Drop Shadow bar. Its XY pad is shorter than the
    // three-row Font/Align bars, so the menu keeps the height it had — adding
    // the option moves no top edge.
    expect(submenuHeight('shadow')).toBeLessThan(submenuHeight('font'));
    expect(typeMenuHeight(TEXT)).toBe(typeMenuHeight(['font', 'align']));
  });

  test('an image stands four rows tall — the Border bar sets it', () => {
    // The other half of the report: the tallest image bar is Border's four
    // rows, so every image bar should be four, not five.
    const ctx = { tintType: 'solid' as const, cropMode: 'fill' as const, cropHasResolution: true };
    expect(typeMenuHeight(IMAGE, ctx)).toBe(submenuHeight('border', ctx));
    expect(typeMenuHeight(IMAGE, ctx))
      .toBe(barOf([ROW_SLIDER, ROW_SLIDER, ROW_SEGMENTED, ROW_SLIDER]));
  });

  test('a live edit that adds a row grows the menu with it', () => {
    const solid = { tintType: 'solid' as const, cropMode: 'fill' as const };
    const linear = { tintType: 'linear' as const, cropMode: 'fill' as const };
    expect(typeMenuHeight(IMAGE, linear)).toBeGreaterThan(typeMenuHeight(IMAGE, solid));
  });

  test('a frame reaches only Shadow and Border, so it sizes to those', () => {
    expect(typeMenuHeight(FRAME)).toBe(Math.max(submenuHeight('shadow'), submenuHeight('border')));
    // Never the taller Crop / Tint bars an image can open but a frame cannot.
    expect(typeMenuHeight(FRAME)).toBeLessThan(typeMenuHeight(IMAGE, { tintType: 'linear' }));
  });

  test('a selection with no submenus needs no bar layer at all', () => {
    expect(typeMenuHeight([])).toBe(0);
  });

  test('every submenu fits inside the menu height offered for its type', () => {
    // The invariant that matters: nothing clips. Checked across the states the
    // variable bars can be in.
    const states = [
      { tintType: 'solid' as const, cropMode: 'fill' as const, cropHasResolution: true },
      { tintType: 'radial' as const, cropMode: 'crop' as const, cropHasResolution: true },
      { tintType: 'linear' as const, cropMode: 'tile' as const, cropHasResolution: false },
    ];
    for (const ctx of states) {
      for (const order of [IMAGE, TEXT, FRAME]) {
        const height = typeMenuHeight(order, ctx);
        for (const key of order) expect(submenuHeight(key, ctx)).toBeLessThanOrEqual(height);
      }
    }
  });
});
