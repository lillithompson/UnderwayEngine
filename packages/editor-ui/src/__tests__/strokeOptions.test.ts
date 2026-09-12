import { readFileSync } from 'fs';
import { resolve } from 'path';

// A selection mixing vectors and pattern objects offers Stroke alone —
// the one option every member has. No renderer for the panel here, so
// the flag's enumeration sites are pinned by source, the same way
// showPatternOptions is (patternEdit.test.ts): the bug that suite guards
// (a typeSpecs branch missing from hasTypeOptions) is exactly the one a
// new flag can reintroduce.
describe('the panel offers a Stroke-only type row for a mixed vector + pattern selection', () => {
  const SRC = readFileSync(
    resolve(__dirname, '..', 'components', 'ObjectPropertiesPanel.tsx'), 'utf8',
  );
  const ADAPTER = readFileSync(resolve(__dirname, '..', 'adapter.ts'), 'utf8');

  it('is a model flag', () => {
    expect(ADAPTER).toContain('showStrokeOptions?: boolean;');
  });

  it('counts showStrokeOptions into hasTypeOptions and the type signature', () => {
    const hasTypeOptions = SRC.slice(
      SRC.indexOf('const hasTypeOptions ='),
      SRC.indexOf('const hasMultiOptions ='),
    );
    expect(hasTypeOptions).toContain('model.showStrokeOptions');
    const typeSig = SRC.slice(SRC.indexOf('const typeSig ='), SRC.indexOf('const prevTypeSig'));
    expect(typeSig).toContain("model.showStrokeOptions ? 'S' : ''");
  });

  it('keeps the Stroke bar open for the mixed selection', () => {
    const guard = SRC.slice(
      SRC.indexOf('const strokeable ='),
      SRC.indexOf('if ((!model.visible || !svgFillable)'),
    );
    expect(guard).toContain('model.showStrokeOptions');
  });

  it('builds a Stroke-only typeSpecs branch from the spec the pattern row shares, and a one-bar carousel', () => {
    expect(SRC).toContain('} else if (model.showStrokeOptions) {');
    const branch = SRC.slice(
      SRC.indexOf('} else if (model.showStrokeOptions) {'),
      SRC.indexOf('} else if (model.showTextStyle) {'),
    );
    expect(branch).toContain('typeSpecs = [strokeSpec()];');
    // One definition of the Stroke option: the pattern row lists it too.
    expect(SRC.match(/const strokeSpec = \(\) =>/g)).toHaveLength(1);
    expect(SRC).toContain('typeSpecs.push(strokeSpec());');
    expect(SRC).not.toContain("typeSpecs.push({ key: 'stroke', label: 'Stroke'");
    const order = SRC.slice(
      SRC.indexOf('const typeSubmenuOrder'),
      SRC.indexOf('const submenuOrder'),
    );
    expect(order).toContain("model.showStrokeOptions ? ['stroke']");
  });
});

describe('a line\'s colour reads on its Stroke page, under Dash', () => {
  const { readFileSync } = require('fs');
  const { resolve } = require('path');
  const READ = (...p: string[]) => readFileSync(resolve(__dirname, '..', ...p), 'utf8');
  const BAR = READ('components', 'BorderBar.tsx');
  const PANEL = READ('components', 'ObjectPropertiesPanel.tsx');
  const EFFECT = READ('components', 'effectBar.tsx');

  it('is a hue row on the slider\'s own proportions, ending in a circle that opens the picker', () => {
    const row = EFFECT.slice(EFFECT.indexOf('export function ColorSliderRow('), EFFECT.indexOf('/** One segmented row:'));
    // The same label column, track and thumb every slider row uses.
    expect(row).toContain('<View style={styles.row}>');
    expect(row).toContain('<Text style={styles.rowLabel}>{label}</Text>');
    expect(row).toContain('<View style={styles.rowSlider}>');
    // Left-to-right IS the wheel, and the thumb wears the colour itself.
    expect(row).toContain('ramp={ramp}');
    expect(row).toContain('accent={rgbCss(color)}');
    expect(row).toContain('value={hue / 360}');
    expect(row).toContain('onColor(withHue(color, Math.max(0, Math.min(360, t * 360))), committed)');
    // …and the circle at the end shows the colour and opens the picker.
    expect(row).toContain('onPress={onOpenPicker}');
    expect(row).toContain('<ColorSwatchFill color={color} />');
    expect(EFFECT).toMatch(/colorEnd: \{\s*width: SLIDER_TRACK,\s*height: SLIDER_TRACK/);
  });

  it('sits under Dash on the Stroke page, and commits down the stroke\'s own path', () => {
    expect(BAR.indexOf('label="Dash"')).toBeLessThan(BAR.indexOf('<ColorSliderRow'));
    expect(BAR.indexOf('<ColorSliderRow')).toBeLessThan(BAR.indexOf('options={POSITIONS}'));
    expect(PANEL).toContain('color={strokeForBar.color}');
    expect(PANEL).toContain('onColor={(color, committed) => applyStroke({ ...strokeForBar, color }, committed)}');
    expect(PANEL).toContain('onOpenColorPicker={() => model.onPickStrokeColor?.()}');
  });

  it('came OFF the shared Color page for a vector — a pattern keeps its row', () => {
    expect(PANEL).toContain("if (strokeable && !model.showSvgOptions && model.strokePresent !== false && model.onPickStrokeColor) {");
    // …and the page reserves the row exactly when the bar renders it.
    expect(PANEL).toContain('color: !!model.showSvgOptions && !!model.onPickStrokeColor,');
  });
});
