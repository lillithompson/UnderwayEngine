import { readFileSync } from 'fs';
import { resolve } from 'path';

// The slider's dress — the color picker's Opacity slider, adopted by every
// property page: a pill track carrying a ramp of the control's color, a
// ringed round thumb, the caption OVER the track and the value box beside
// it. The components are react-native and never render in node, so the
// look is pinned at the source, the way the other panel suites do it.

const read = (f: string) =>
  readFileSync(resolve(__dirname, '..', 'components', f), 'utf8');

describe('the shared Slider', () => {
  const SRC = read('Slider.tsx');

  it('is a pill track carrying a clear→full ramp of its color', () => {
    expect(SRC).toContain("import { LinearGradient } from 'expo-linear-gradient';");
    expect(SRC).toContain('const ramp = useMemo(() => sliderRampColors(accent), [accent]);');
    expect(SRC).toContain('colors={ramp}');
    expect(SRC).toContain("end={{ x: 1, y: 0 }}");
    expect(SRC).toMatch(/track:\s*\{\s*height:\s*SLIDER_TRACK,\s*borderRadius:\s*SLIDER_TRACK \/ 2,\s*overflow:\s*'hidden'/);
    // The ramp is the whole track, not a fill that resizes per move: the
    // only per-drag style change is the thumb's `left`.
    expect(SRC).not.toMatch(/width:\s*thumbLeft/);
  });

  it('shows the alpha checker under the ramp only when asked (an opacity slider)', () => {
    expect(SRC).toContain('{checker ? <CheckerboardFill /> : null}');
  });

  it('marks the value with the color inside a white ring, kept inside the track', () => {
    expect(SRC).toContain('backgroundColor: accent');
    expect(SRC).toMatch(/borderWidth:\s*THUMB_RING,\s*borderColor:\s*'#ffffff'/);
    // The thumb's center runs over trackW − thumb (the brush slider's
    // mapping), so at 100% it sits flush with the track's end.
    expect(SRC).toContain('brushSliderValueFromX(x, trackWRef.current, SLIDER_THUMB, dragRef.current)');
    expect(SRC).toContain('const thumbLeft = clamped * Math.max(0, trackW - SLIDER_THUMB);');
    expect(SRC).toContain('export const SLIDER_THUMB = SLIDER_TRACK');
  });

  it('stands exactly the control line submenuHeight budgets for it', () => {
    expect(SRC).toContain("import { SLIDER_CONTROL } from '../logic/submenuHeight';");
    expect(SRC).toMatch(/hit:\s*\{\s*height:\s*SLIDER_CONTROL/);
  });
});

describe('the slider row', () => {
  const bar = read('effectBar.tsx');

  it('puts the caption over a full-width track, the value box on the right', () => {
    // A column: caption, gap, control line — not the old label-beside-track row.
    expect(bar).toMatch(/row:\s*\{\s*height:\s*ROW_SLIDER,\s*gap:\s*SLIDER_LABEL_GAP\s*\}/);
    expect(bar).toMatch(/rowControl:\s*\{\s*flexDirection:\s*'row',[^}]*height:\s*SLIDER_CONTROL/);
    expect(bar).toMatch(/rowLabel:\s*\{[^}]*lineHeight:\s*SLIDER_LABEL,[^}]*textTransform:\s*'uppercase'/);
  });

  it('lets a color picker pass its color, the checker, and a dark caption', () => {
    expect(bar).toContain('checker={checker}');
    expect(bar).toContain('accent={accent ?? CONTROL_ACCENT}');
    expect(bar).toContain('onDark ? styles.rowLabelDark : null');
  });

  it('keeps the 50pt label column for the segmented rows only', () => {
    expect(bar).toMatch(/segLabel:\s*\{\s*width:\s*50/);
    expect(bar).not.toMatch(/rowLabel:\s*\{\s*width:\s*50/);
  });
});

describe('the color pickers', () => {
  it('both draw their Opacity as the shared row: the color over the checker, dark caption', () => {
    const ui = read('ColorPickerModal.tsx');
    const row = ui.slice(ui.indexOf('<SliderRow'), ui.indexOf('/>', ui.indexOf('<SliderRow')));
    expect(row).toContain('label="Opacity"');
    expect(row).toContain('accent={rgbCss(withAlpha(model.color, 1))}');
    expect(row).toContain('checker');
    expect(row).toContain('onDark');
    expect(ui).not.toContain("from './Slider'");
  });
});
