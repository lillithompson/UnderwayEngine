import { readFileSync } from 'fs';
import { resolve } from 'path';

// Every slider row wears a tap-to-type value box on its right (the Opacity
// slider's design, adopted by every property page). The Stroke / Border
// Width row speaks design pt in it; a row with no unit of its own shows the
// 0–1 value as a percent. The components are react-native and never render
// in node, so the wiring is pinned by source.

const read = (f: string) =>
  readFileSync(resolve(__dirname, '..', 'components', f), 'utf8');

describe('the slider value box', () => {
  const bar = read('effectBar.tsx');
  const border = read('BorderBar.tsx');
  const panel = read('ObjectPropertiesPanel.tsx');

  it('every SliderRow renders a readout that arms a numeric field on tap', () => {
    expect(bar).toContain('function SliderReadout');
    // Unconditional: a row without its own unit falls back to a percent.
    expect(bar).toContain('const text = readout ? readout.text : percentText(value);');
    expect(bar).toContain('const commit = readout ? readout.commit : (n: number) => apply(percentToValue(n), true);');
    expect(bar).toContain('<SliderReadout text={text} commit={commit} />');
    // Tap → edit; a draft that parses commits, an unfinished edit is
    // abandoned (the hex field's rule).
    expect(bar).toContain('onPress={() => { setDraft(text); setSeeded(text); finished.current = false; setEditing(true); }}');
    expect(bar).toContain('if (Number.isFinite(n)) commit(n);');
    // …and the row hands the box a percent, or the unit the caller spelled
    // out. (Both halves of a DUAL slider row used to carry the same pair;
    // that row went when its last pair became a RowGroup of two full-width
    // rows, each of which is this one.)
    expect(bar).toContain('const text = readout ? readout.text : percentText(value);');
    expect(bar).toContain('const commit = readout ? readout.commit : (n: number) => apply(percentToValue(n), true);');
    expect(bar).not.toContain('DualSliderRow');
  });

  it('an armed field carries a Done chip, and Enter does what it does', () => {
    // iOS's number pad has no return key, and the WebView suppresses the
    // system accessory bar that would carry a Done (the text-edit bar's
    // doing), so the row supplies one: without it a typed value could only
    // be finished by tapping away. The field keeps the number pad — typing
    // a count on a QWERTY keyboard is the wrong trade.
    // The DECIMAL pad, not the plain number pad: every value behind this
    // box is a real number and the field already parses one, but the plain
    // pad has no separator on it — so 9.5 could not be typed at all. The
    // decimal pad is that pad with the separator added.
    expect(bar).toContain('keyboardType="decimal-pad"');
    expect(bar).not.toContain('keyboardType="numeric"');
    expect(bar).toContain('accessibilityLabel="Done"');
    expect(bar).toContain('onPress={submit}');
    // Enter, where a keyboard has one, is the same act.
    expect(bar).toContain('onSubmitEditing={submit}');
    // Both blur the field FIRST: unmounting a focused field is not reliably
    // enough to take the iOS keyboard down.
    expect(bar).toContain('const submit = () => { inputRef.current?.blur(); finish(); };');
    expect(bar).toContain('const inputRef = useRef<TextInput>(null);');
    expect(bar).toContain('ref={inputRef}');
    // …and that blur runs `finish` in its own right, so the guard is what
    // keeps one edit from committing twice — two undo steps for one number.
    expect(bar).toContain('onBlur={finish}');
    expect(bar).toMatch(/const finish = \(\) => \{\n\s*if \(finished\.current\) return;\n\s*finished\.current = true;/);
    expect(bar).toContain('finished.current = false; setEditing(true);');
    // The chip is the accent as a fill — the one thing on the row that ENDS
    // the edit rather than adjusting a value — and stands only while armed.
    expect(bar).toMatch(/readoutDone: \{\s*height: SLIDER_TRACK,[^}]*backgroundColor: ACCENT/);
    expect(bar).toMatch(/readoutDoneText: \{ color: '#fff'/);
  });

  it('is the white value box, one track tall, in full-strength ink', () => {
    expect(bar).toMatch(/readout:\s*\{\s*height:\s*SLIDER_TRACK,[^}]*backgroundColor:\s*PANEL_CONTROL/);
    expect(bar).toMatch(/readoutText:\s*\{\s*color:\s*PANEL_INK,\s*fontSize:\s*14,\s*fontWeight:\s*'600'/);
  });

  it('the Width row speaks design pt on both the BORDER and STROKE bars', () => {
    expect(border).toContain('text: widthPtText(border.width)');
    expect(border).toContain('Math.min(Math.max(n, 0), MAX_WIDTH * PT_PER_CELL) / PT_PER_CELL');
    // No longer gated: with a box on every row, a percent of the track would
    // be the odd one out.
    expect(border).not.toContain('showWidthValue');
    expect(panel).not.toContain('showWidthValue');
  });

  it('the Dash row counts steps, not percent', () => {
    expect(border).toContain('text: String(Math.round(border.dash))');
    expect(border).toContain('Math.round(Math.min(Math.max(n, 0), MAX_DASH))');
  });
});
