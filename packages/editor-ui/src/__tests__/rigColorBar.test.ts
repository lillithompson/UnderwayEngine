/**
 * The rig's Color page: the one page of a poseable figure that is not a
 * posture — the two colours its sketch is drawn in.
 *
 * The panel is RN with no test renderer here, so what it renders is pinned
 * at the source, the way the other rig behaviours are (rigOptions.test.ts).
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { RIG_OUTLINES_DEFAULT, RIG_PAGES, RIG_VOLUMES_DEFAULT } from '../logic/rigEdit';
import {
  BAR_CUSHION, CONTENT_PAD, ROW_GAP, ROW_SLIDER, submenuHeight,
} from '../logic/submenuHeight';

const SRC = join(__dirname, '..');
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), 'utf8');

const BAR = read('components', 'RigColorBar.tsx');
const PANEL = read('components', 'ObjectPropertiesPanel.tsx');
const ADAPTER = read('adapter.ts');

describe('the Color tab', () => {
  it('stands last in the rig’s option row, after the two that are postures', () => {
    // A rig's tabs are no longer the part table filtered: Color names no
    // part of the figure at all, so the row is its own list and both panel
    // sites read it (rigOptions.test.ts pins those).
    expect(RIG_PAGES.map((o) => o.label)).toEqual(['Transform', 'Joints', 'Color']);
    expect(RIG_PAGES.find((o) => o.key === 'color')!.sub).toBe('rigColor');
  });

  it('stands exactly as tall as its two rows', () => {
    // Two hue rows and nothing else — no hint line, no Remove.
    expect(submenuHeight('rigColor'))
      .toBe(CONTENT_PAD * 2 + ROW_SLIDER * 2 + ROW_GAP + BAR_CUSHION);
    expect(submenuHeight('rigColor')).toBe(submenuHeight('background') + ROW_SLIDER + ROW_GAP);
  });
});

describe('RigColorBar', () => {
  it('is two hue rows: Volumes, then Outlines', () => {
    expect(BAR).toContain('export function RigColorBar({ volumes, outlines, onColor, onOpenPicker }');
    // Volumes first: they are the ground the outlines are drawn ON, and
    // the order the renderer paints them in.
    expect(BAR.indexOf('label="Volumes"')).toBeLessThan(BAR.indexOf('label="Outlines"'));
    expect(BAR.match(/<ColorSliderRow/g)).toHaveLength(2);
    // The ordinary hue row every other page colours through — the wheel
    // along the track, the colour under the thumb, and the circle at the
    // end opening the full picker. Not a private control.
    expect(BAR).toContain("import { BarBody, ColorSliderRow } from './effectBar';");
  });

  it('offers no Remove — there is no layer here that was added', () => {
    // The same reasoning the pose pages carry: a figure is always drawn in
    // SOME pair of colours, so "remove" could only mean "back to the
    // defaults", which the rows themselves reach.
    expect(BAR).not.toContain('onRemove');
    expect(BAR).not.toContain('removeLabel');
  });
});

describe('the panel wires it to the host', () => {
  it('renders the page, falling back to the sketch defaults', () => {
    expect(PANEL).toContain("} else if (displaySub === 'rigColor') {");
    expect(PANEL).toContain('volumes={model.rigVolumesColor ?? RIG_VOLUMES_DEFAULT}');
    expect(PANEL).toContain('outlines={model.rigOutlinesColor ?? RIG_OUTLINES_DEFAULT}');
    // A shade of the page's ground under the masses, a soft charcoal nib
    // over them — Figgie's own defaults, which the host's rigColor test
    // pins these against.
    expect(RIG_VOLUMES_DEFAULT).toEqual({ r: 243, g: 237, b: 228 });
    expect(RIG_OUTLINES_DEFAULT).toEqual({ r: 41, g: 38, b: 36 });
  });

  it('leaves the writing to the host, live and on release', () => {
    expect(PANEL).toContain('onColor={(which, color, committed) => model.onRigColor?.(which, color, committed)}');
    expect(PANEL).toContain('onOpenPicker={(which) => model.onPickRigColor?.(which)}');
    expect(ADAPTER).toContain("onRigColor?(which: 'volumes' | 'outlines', color: RGBLike, committed: boolean): void;");
    expect(ADAPTER).toContain("onPickRigColor?(which: 'volumes' | 'outlines'): void;");
    expect(ADAPTER).toContain('rigVolumesColor?: RGBLike;');
    expect(ADAPTER).toContain('rigOutlinesColor?: RGBLike;');
  });

  it('OPENS when its tab is pressed — a panel-kept page, like Shape', () => {
    // The tab was drawn and pressable and did nothing at all. openSubmenu
    // walks a chain: a panel-kept page, then each host flag, then the rig
    // PART pages — and rigColor names no part of the figure, so it fell
    // off the end and set nothing. The page could never become the open
    // one, so the well never held it and the tab never lit.
    //
    // It belongs on the panel's own list, the way Shape and Image do:
    // nothing about the page is the host's to know is open. Its two rows
    // write through the host as any hue row does, and its circles open
    // the host's picker, neither of which asks whether the page is up.
    expect(PANEL).toContain(
      "type LocalSubmenu = 'background' | 'card' | 'shape' | 'image' | 'rigColor';",
    );
    expect(PANEL).toContain("|| key === 'rigColor';");
    // …and folds away with the selection that offered it, like every
    // other panel-kept page: a rig's page must not linger over the next
    // object's actions.
    // …by the one rule the panel folds every page with: 'rigColor' rides
    // RIG_PAGES, so a selection that is no longer a rig stops listing it
    // and the page goes with the listing. The rig's PART pages are the
    // exception the rule names — the host opens those with its own
    // floating sliders and no tab row ever offered them.
    expect(PANEL).toContain('const isHostOnlyPage = (key: SubmenuKey): boolean =>');
    expect(PANEL).toContain("|| (rigPartOfSubmenu(key) != null && key !== 'rigRoot');");
    expect(PANEL).toContain(': model.showRigOptions ? RIG_PAGES.map((o) => o.sub)');
  });

  it('gives the page no Remove line, like the pose pages', () => {
    const branch = PANEL.slice(
      PANEL.indexOf("} else if (displaySub === 'rigColor') {"),
      PANEL.indexOf("} else if (displaySub === 'opacity') {"),
    );
    expect(branch).not.toContain('removeAction =');
  });
});
