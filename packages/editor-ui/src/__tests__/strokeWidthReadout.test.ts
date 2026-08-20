import { readFileSync } from 'fs';
import { resolve } from 'path';

// The Stroke bar's Width slider wears a tap-to-type readout on its right:
// the width in design pt, dressed exactly like the toolbar hex field (no
// box, the pushdown's dim 13/600 ink). The components are react-native and
// never render in node, so the wiring is pinned by source.

const read = (f: string) =>
  readFileSync(resolve(__dirname, '..', 'components', f), 'utf8');

describe('the Stroke Width readout', () => {
  const bar = read('effectBar.tsx');
  const border = read('BorderBar.tsx');
  const panel = read('ObjectPropertiesPanel.tsx');

  it('SliderRow renders a readout that arms a numeric field on tap', () => {
    expect(bar).toContain('function SliderReadout');
    expect(bar).toContain('{readout ? <SliderReadout text={readout.text} commit={readout.commit} /> : null}');
    // Tap → edit; a draft that parses commits, an unfinished edit is
    // abandoned (the hex field's rule).
    expect(bar).toContain('onPress={() => { setDraft(text); setEditing(true); }}');
    expect(bar).toContain('if (Number.isFinite(n)) commit(n);');
  });

  it("wears the toolbar hex field's dress", () => {
    // ToolbarColorField's field: PUSHDOWN_INACTIVE ink, 13/600, no box.
    expect(bar).toMatch(/readout:\s*\{\s*color:\s*PUSHDOWN_INACTIVE,\s*fontSize:\s*13,\s*fontWeight:\s*'600'/);
  });

  it('the STROKE bar shows it for every type with a Stroke option', () => {
    // BorderBar gates the readout on showWidthValue…
    expect(border).toContain('readout={showWidthValue ? {');
    // …speaks design pt, clamped to the slider range…
    expect(border).toContain('text: widthPtText(border.width)');
    expect(border).toContain('Math.min(Math.max(n, 0), MAX_WIDTH * PT_PER_CELL) / PT_PER_CELL');
    // …and the panel's shared STROKE instance (vectors AND patterns route
    // through the one `stroke` submenu) turns it on.
    const stroke = panel.slice(panel.indexOf('title="STROKE"'), panel.indexOf('onPickColor={() => model.onPickStrokeColor?.()}'));
    expect(stroke).toContain('showWidthValue');
  });
});
