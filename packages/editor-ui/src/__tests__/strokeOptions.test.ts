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
