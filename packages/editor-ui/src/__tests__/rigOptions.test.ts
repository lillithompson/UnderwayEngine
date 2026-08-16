// The poseable rig's type options: Rig · Hands · Feet · Spine · Head in
// place of a vector's Stroke / Fill / Opacity.
//
// The panel is RN with no test renderer here, so what it does with them is
// pinned at the source — the same approach panelLayout.test.ts uses.
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  RIG_PART_OPTIONS, RIG_SLIDER_REST, restRigSliders, rigPartOfSubmenu, rigPartSliders,
  rigPartSubmenu, rigSliderPart,
} from '../logic/rigEdit';
import { ROW_GAP, ROW_SLIDER, submenuHeight } from '../logic/submenuHeight';

const SRC = readFileSync(
  join(__dirname, '..', 'components', 'ObjectPropertiesPanel.tsx'),
  'utf8',
);

describe('the rig option set', () => {
  it('is the whole figure and its four parts, each opening its own bar', () => {
    expect(RIG_PART_OPTIONS.map((o) => o.label))
      .toEqual(['Rig', 'Hands', 'Feet', 'Spine', 'Head']);
    expect(RIG_PART_OPTIONS.map((o) => o.sub))
      .toEqual(['rigRoot', 'rigHands', 'rigFeet', 'rigSpine', 'rigHead']);
  });

  it('reads the part↔bar pairing both ways off the one table', () => {
    // The panel needs both directions and used to spell each out as its own
    // chain of ifs — three lists of parts to keep in step, and a part added
    // to one and forgotten in another opened nothing.
    for (const opt of RIG_PART_OPTIONS) {
      expect(rigPartSubmenu(opt.part)).toBe(opt.sub);
      expect(rigPartOfSubmenu(opt.sub)).toBe(opt.part);
    }
    // A bar that is not a rig page belongs to no part.
    expect(rigPartOfSubmenu('shadow')).toBeNull();
  });

  it('sizes each bar to the rows it renders', () => {
    // Left and Right plus a Twist each for the hands and feet; three sliders
    // apiece for the spine and for the whole figure's three axes; Nod and
    // Shake for the head.
    expect(submenuHeight('rigHands')).toBe(submenuHeight('rigFeet'));
    expect(submenuHeight('rigRoot')).toBe(submenuHeight('rigSpine'));
    expect(submenuHeight('rigHands')).toBeGreaterThan(submenuHeight('rigSpine'));
    expect(submenuHeight('rigHead')).toBeLessThan(submenuHeight('rigSpine'));
    expect(rigPartSliders('rig')).toHaveLength(3);
    expect(rigPartSliders('spine')).toHaveLength(3);
    expect(rigPartSliders('hands')).toHaveLength(4);
    expect(rigPartSliders('feet')).toHaveLength(4);
    expect(rigPartSliders('head')).toHaveLength(2);
    // Every part's bar is exactly its own rows — no page borrows another's.
    for (const opt of RIG_PART_OPTIONS) {
      const rows = rigPartSliders(opt.part).length;
      expect(submenuHeight(opt.sub))
        .toBe(submenuHeight('rigHead') + (rows - 2) * (ROW_SLIDER + ROW_GAP));
    }
  });

  it('gives the head its own two sliders, centred, and nothing else', () => {
    // The Spine bar cannot do this: its bend curves the WHOLE column and
    // takes the head along at the end of it, so there was no way to tip a
    // face without stooping the body to do it.
    const specs = rigPartSliders('head');
    expect(specs.map((s) => s.label)).toEqual(['Nod', 'Shake']);
    for (const spec of specs) {
      expect(spec.centered).toBe(true);
      expect(RIG_SLIDER_REST[spec.key]).toBe(0.5); // facing level
    }
  });

  it('is sliders and nothing else — no hint line, no IK switch', () => {
    // These pages are the tallest in the editor and they stand over the very
    // figure being posed, so everything that is not a control has come off
    // them: the line of prose under the sliders, and the reach-vs-swing
    // switch that used to sit on the RIG page.
    const BAR = readFileSync(join(__dirname, '..', 'components', 'RigPoseBar.tsx'), 'utf8');
    expect(BAR).not.toContain('<Hint>');
    expect(BAR).not.toContain('SegmentedRow');
    expect(BAR).not.toContain('onToggleIk');
    // Height follows: every page is exactly its slider rows plus the bar's
    // own chrome, with nothing reserved below them.
    expect(submenuHeight('rigHands'))
      .toBe(submenuHeight('rigSpine') + ROW_SLIDER + ROW_GAP);
  });

  it('has no trash in its header, on any of the pages', () => {
    // On an effect bar the trash removes something that was ADDED — a
    // shadow, a border — and the object is itself again. A rig has no such
    // layer: every slider is a posture the figure is always in, so a trash
    // could only mean "back to rest", which the sliders already reach. It
    // also reset the whole page, untouched sliders included, so one tap
    // flattened a pair of hands posed finger by finger.
    const BAR = readFileSync(join(__dirname, '..', 'components', 'RigPoseBar.tsx'), 'utf8');
    expect(BAR).not.toContain('onRemove');
    expect(BAR).not.toContain('onReset');
    // The header still carries the title and the way back out.
    expect(BAR).toContain('<EffectBarHeader title={rigPartTitle(part)} chevron onBack={onBack} />');
    // …and the panel hands the bar nothing to reset with.
    expect(SRC).not.toContain('onResetRigPart');
    const ADAPTER = readFileSync(join(__dirname, '..', 'adapter.ts'), 'utf8');
    expect(ADAPTER).not.toContain('onResetRigPart');
  });

  it('gives each hand and foot a centred Twist beside its own slider', () => {
    // The curl / flex slider runs one way from rest; the twist runs BOTH
    // ways from the middle, since a joint rolls either direction.
    for (const [part, first] of [['hands', 'handL'], ['feet', 'footL']] as const) {
      const specs = rigPartSliders(part);
      expect(specs.map((s) => s.key)).toEqual([
        first, first.replace('L', 'R'),
        part === 'hands' ? 'wristTwistL' : 'ankleTwistL',
        part === 'hands' ? 'wristTwistR' : 'ankleTwistR',
      ]);
      for (const spec of specs.slice(2)) {
        expect(spec.centered).toBe(true);
        expect(spec.label).toContain('Twist');
        expect(RIG_SLIDER_REST[spec.key]).toBe(0.5);
      }
    }
  });

  it('rests every slider where the figure rests', () => {
    const rest = restRigSliders();
    expect(rest).toEqual({
      spinX: 0.5, spinY: 0.5, spinZ: 0.5,
      handL: 0, handR: 0, wristTwistL: 0.5, wristTwistR: 0.5,
      footL: 1, footR: 1, ankleTwistL: 0.5, ankleTwistR: 0.5,
      bend: 0.5, twist: 0.5, lean: 0.5,
      nod: 0.5, shake: 0.5,
    });
    for (const key of Object.keys(rest) as (keyof typeof rest)[]) {
      expect(rigPartSliders(rigSliderPart(key)).some((s) => s.key === key)).toBe(true);
    }
  });
});

describe('the panel', () => {
  it('counts a rig as HAVING type options — else the page never appears', () => {
    // The bug this pins: `hasTypeOptions` is a hand-kept roster of the
    // type flags, and a kind missing from it renders no carousel and no
    // options at all, however complete the rest of its wiring is.
    const line = /const hasTypeOptions = [^;]+;/.exec(SRC)?.[0] ?? '';
    expect(line).toContain('model.showRigOptions');
    // Every type-option flag the panel dispatches on must be in that roster.
    for (const flag of [
      'showImageEdit', 'showTextStyle', 'showFrameOptions',
      'showSvgOptions', 'showPaintOptions', 'showRigOptions',
    ]) {
      expect(line).toContain(flag);
    }
  });

  it('offers the parts BEFORE the vector options a rig would otherwise get', () => {
    // A rig's figure IS an svg object; the rig branch has to win.
    expect(SRC.indexOf('model.showRigOptions ? ')).toBeLessThan(SRC.indexOf('model.showSvgOptions\n'));
    // …and the carousel's order IS the options row's, not a second copy of it.
    expect(SRC).toContain('model.showRigOptions ? RIG_PART_OPTIONS.map((o) => o.sub)');
  });

  it('offers no IK switch anywhere — not on a bar, not as an option', () => {
    // Reaching with a whole chain is not offered: a drag swings the one bone
    // under the finger. The host's flag survives (rigIkStore, off) so the
    // behaviour can be handed back without rebuilding it, but nothing in the
    // panel reaches it, and the model carries no field for it.
    expect(SRC).not.toContain('model.rigIk');
    expect(SRC).not.toContain('onToggleRigIk');
    const ADAPTER = readFileSync(join(__dirname, '..', 'adapter.ts'), 'utf8');
    expect(ADAPTER).not.toContain('rigIk');
  });

  it('opens and dismisses the part bars through the host’s flag', () => {
    expect(SRC).toContain('model.onRigPartOpenChange?.(rigPartOfSubmenu(key))');
    expect(SRC).toContain('model.rigPartOpen ? rigPartSubmenu(model.rigPartOpen)');
    expect(SRC).toContain('part={rigPartOfSubmenu(displaySub)!}');
    expect(SRC).toContain('model.onRigPartOpenChange?.(null);');
  });
});
