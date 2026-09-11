/**
 * The absent-effect Add page. Opening a properties menu must never edit the
 * object: an effect the selection does not carry opens as EmptyEffectBar —
 * one "Add …" button in the Edit sheet's well — and only that press
 * materializes the effect (host-side, one undo step). These pin the shared
 * component and the panel's swap-in wiring, the way the other panel
 * behaviours are pinned (panelTheme.test.ts).
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BAR_CUSHION, CONTENT_PAD, ROW_SEGMENTED, emptyEffectHeight, submenuHeight,
} from '../logic/submenuHeight';

const SRC = join(__dirname, '..');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

describe('EmptyEffectBar (effectBar.tsx)', () => {
  const bar = read(join('components', 'effectBar.tsx'));

  it('is ONE Add button — no swatch, no Remove, no header of its own', () => {
    expect(bar).toContain('export function EmptyEffectBar({ addLabel, onAdd }');
    // The one control: a full-width accessible Add button.
    expect(bar).toContain('accessibilityLabel={addLabel}');
    expect(bar).toContain('onPress={onAdd}');
    // It wears the control accent — pressing it is what SETS a value.
    expect(bar).toContain('backgroundColor: CONTROL_ACCENT,');
    // The per-page header is gone from every page: the Edit sheet's title
    // and tabs are the chrome now.
    expect(bar).not.toContain('EffectBarHeader');
  });
});

describe('the panel swaps the Add page in for an absent effect', () => {
  const panel = read(join('components', 'ObjectPropertiesPanel.tsx'));

  it.each([
    ['svgFill', 'Add Fill'],
    ['shadow', 'Add Drop Shadow'],
    ['border', 'Add Border'],
  ])('%s: absent + onAdd renders EmptyEffectBar labelled %s', (key, label) => {
    expect(panel).toContain(
      `displaySub === '${key}' && model.${key}Present === false && model.onAdd`,
    );
    expect(panel).toContain(`addLabel="${label}"`);
  });

  it('sizes the sheet to the one Add button, not to the controls it stands in for', () => {
    // A shadowless image's Shadow tab used to stand as tall as the pad and
    // three sliders it wasn't showing.
    expect(emptyEffectHeight()).toBe(CONTENT_PAD * 2 + ROW_SEGMENTED + BAR_CUSHION);
    expect(emptyEffectHeight()).toBeLessThan(submenuHeight('shadow'));
    expect(emptyEffectHeight()).toBeLessThan(submenuHeight('border'));
    expect(emptyEffectHeight()).toBeLessThan(submenuHeight('svgFill'));
    // Every Add branch flags the page, and the height reads the flag.
    expect(panel.match(/addPage = true;/g)).toHaveLength(4);
    expect(panel).toContain('addPage ? emptyEffectHeight() : submenuHeight(displaySub, {');
  });

  it('offers nothing to remove while the effect is absent', () => {
    // The Remove line is set only in the branches that render the real
    // controls; the Add branches leave it undefined, so the sheet draws
    // no Remove under an Add button.
    const addBranches = panel.slice(
      panel.indexOf("if (displaySub === 'stroke' && model.strokePresent === false"),
      panel.indexOf("} else if (displaySub === 'svgFill') {"),
    );
    expect(addBranches).not.toContain('removeAction =');
    expect(panel).toContain("removeAction = { label: 'Remove fill', onPress: removeSvgFill };");
    expect(panel).toContain("removeAction = { label: 'Remove drop shadow', onPress: removeShadow };");
    expect(panel).toContain("removeAction = { label: 'Remove border', onPress: removeBorder };");
    expect(panel).toContain("removeAction = { label: 'Remove stroke', onPress: removeStroke };");
  });

  it('stroke: an outline-less closed shape opens on Add Stroke', () => {
    // strokePresent is a closed-shape question: open paths ARE their stroke
    // and patterns always draw their tiles' lines, so those hosts answer
    // undefined and keep the controls.
    expect(panel).toContain(
      "displaySub === 'stroke' && model.strokePresent === false && model.onAddStroke",
    );
    expect(panel).toContain('addLabel="Add Stroke"');
    // The draft seeded on open holds the ABSENT stroke (width 0); the Add
    // press drops it so the controls that swap in read the freshly created
    // stroke off the model.
    expect(panel).toContain('onAdd={() => { setStrokeDraft(null); model.onAddStroke?.(); }}');
    const adapter = read('adapter.ts');
    expect(adapter).toContain('strokePresent?: boolean;');
    expect(adapter).toContain('onAddStroke?(): void;');
  });

  it('presence omitted means present — hosts that always materialize keep their controls', () => {
    // The guard is an explicit `=== false`, never falsy: an old host that
    // passes nothing gets the full page exactly as before.
    expect(panel).toContain("model.svgFillPresent === false");
    expect(panel).not.toContain('!model.svgFillPresent &&');
  });

  it('the model carries the presence flags and Add callbacks', () => {
    const adapter = read('adapter.ts');
    for (const k of ['svgFill', 'shadow', 'border']) {
      expect(adapter).toContain(`${k}Present?: boolean;`);
      expect(adapter).toContain(`onAdd${k[0].toUpperCase()}${k.slice(1)}?(): void;`);
    }
  });
});
