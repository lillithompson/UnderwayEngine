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
    expect(bar).toContain('onPress={() => { setDraft(text); setEditing(true); }}');
    expect(bar).toContain('if (Number.isFinite(n)) commit(n);');
    // Both halves of a dual row carry one too.
    expect(bar.match(/<SliderReadout text=\{percentText\(value\)\}/g)).toHaveLength(1);
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
