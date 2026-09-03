/**
 * The absent-effect Add bar. Opening a properties menu must never edit the
 * object: an effect the selection does not carry opens as EmptyEffectBar —
 * the standard chrome over one "Add …" button — and only that press
 * materializes the effect (host-side, one undo step). These pin the shared
 * component and the panel's swap-in wiring, the way the other panel
 * behaviours are pinned (panelTheme.test.ts).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

describe('EmptyEffectBar (effectBar.tsx)', () => {
  const bar = read(join('components', 'effectBar.tsx'));

  it('is the standard bar chrome over ONE Add button — no swatch, no trash', () => {
    expect(bar).toContain('export function EmptyEffectBar');
    // Header carries only title + back (nothing to recolor or remove yet).
    expect(bar).toContain('<EffectBarHeader title={title} chevron onBack={onBack} />');
    // The one control: a full-width accessible Add button.
    expect(bar).toContain('accessibilityLabel={addLabel}');
    expect(bar).toContain('onPress={onAdd}');
    // It wears the control accent — pressing it is what SETS a value.
    expect(bar).toContain('backgroundColor: CONTROL_ACCENT,');
  });
});

describe('the panel swaps the Add bar in for an absent effect', () => {
  const panel = read(join('components', 'ObjectPropertiesPanel.tsx'));

  it.each([
    ['tint', 'TINT', 'Add Tint'],
    ['svgFill', 'FILL', 'Add Fill'],
    ['shadow', 'DROP SHADOW', 'Add Drop Shadow'],
    ['border', 'BORDER', 'Add Border'],
  ])('%s: absent + onAdd renders EmptyEffectBar titled %s', (key, title, label) => {
    expect(panel).toContain(
      `displaySub === '${key}' && model.${key}Present === false && model.onAdd`,
    );
    expect(panel).toContain(`title="${title}" addLabel="${label}"`);
  });

  it('presence omitted means present — hosts that always materialize keep their controls', () => {
    // The guard is an explicit `=== false`, never falsy: an old host that
    // passes nothing gets the full bar exactly as before.
    expect(panel).toContain("model.tintPresent === false");
    expect(panel).not.toContain('!model.tintPresent &&');
  });

  it('the model carries the presence flags and Add callbacks', () => {
    const adapter = read('adapter.ts');
    for (const k of ['svgFill', 'tint', 'shadow', 'border']) {
      expect(adapter).toContain(`${k}Present?: boolean;`);
      expect(adapter).toContain(`onAdd${k[0].toUpperCase()}${k.slice(1)}?(): void;`);
    }
  });
});
