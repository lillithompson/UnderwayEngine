import { readFileSync } from 'fs';
import { resolve } from 'path';
import { submenuHeight } from '../logic/submenuHeight';

// The Crop bar's Replace action. Until it existed the replace flow could only
// be entered by tapping an UNFILLED photo placeholder, so a photo already in
// place could be framed and cropped but never swapped — changing it meant
// deleting the node and placing a new one, losing its box and its framing.
//
// There is no test renderer for these components (the same constraint the
// panel suites work under), so the wiring is pinned by source.

const SRC = (...p: string[]) => readFileSync(resolve(__dirname, '..', ...p), 'utf8');

describe('the Crop bar offers Replace', () => {
  const BAR = SRC('components', 'CropBar.tsx');

  it('renders it as an ACTION, not a state to be in', () => {
    // Replacing is something you do; an ActionRow's cells fire and stay
    // unlit, where a SegmentedRow would light one and claim the image is
    // "in" replace mode.
    expect(BAR).toContain('<ActionRow');
    const row = BAR.slice(BAR.indexOf('{onReplace ? ('), BAR.indexOf(') : null}\n      </View>'));
    expect(row).toContain('onPress={onReplace}');
    expect(row).toContain("label: 'Replace'");
  });

  it('offers it in every framing mode', () => {
    // The rows above it are about the FRAME; this one is about what is in it,
    // so it must not be nested inside a mode branch.
    const modeBranches = BAR.indexOf("{framing.mode === 'tile' ?");
    expect(BAR.indexOf('{onReplace ? (')).toBeGreaterThan(modeBranches);
  });

  it('hides the row when the host wires nothing up', () => {
    expect(BAR).toContain('onReplace ? (');
    // …and reserves no room for it either.
    expect(submenuHeight('crop', { cropMode: 'fill' }))
      .toBeLessThan(submenuHeight('crop', { cropMode: 'fill', cropCanReplace: true }));
  });

  it('is fired straight out of the press, with nothing awaited first', () => {
    // The host opens a file picker in this callback and WebKit only shows the
    // dialog while the press's activation is live, so the bar must not wrap
    // it in anything that defers.
    expect(BAR).not.toMatch(/onPress=\{\s*async/);
    expect(BAR).toContain('onPress={onReplace}');
  });
});

describe('the panel hands the bar its Replace callback', () => {
  const PANEL = SRC('components', 'ObjectPropertiesPanel.tsx');

  it('passes the model’s callback through', () => {
    expect(PANEL).toContain('onReplace={model.onReplaceImage}');
  });

  it('counts the row into the bar’s reserved height', () => {
    // Or the bar would render a row taller than the layer holding it.
    expect(PANEL).toContain('cropCanReplace: !!model.onReplaceImage');
  });
});
