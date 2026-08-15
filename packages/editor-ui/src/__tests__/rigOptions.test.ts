// The poseable rig's type options: Hands · Feet · Spine (plus the IK
// toggle) in place of a vector's Stroke / Fill / Opacity.
//
// The panel is RN with no test renderer here, so what it does with them is
// pinned at the source — the same approach panelLayout.test.ts uses.
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  RIG_PART_OPTIONS, RIG_SLIDER_REST, restRigSliders, rigPartHasIk, rigPartSliders, rigSliderPart,
} from '../logic/rigEdit';
import { ROW_GAP, ROW_SEGMENTED, ROW_SLIDER, submenuHeight } from '../logic/submenuHeight';

const SRC = readFileSync(
  join(__dirname, '..', 'components', 'ObjectPropertiesPanel.tsx'),
  'utf8',
);

describe('the rig option set', () => {
  it('is the whole figure and its three parts, each opening its own bar', () => {
    expect(RIG_PART_OPTIONS.map((o) => o.label)).toEqual(['Rig', 'Hands', 'Feet', 'Spine']);
    expect(RIG_PART_OPTIONS.map((o) => o.sub))
      .toEqual(['rigRoot', 'rigHands', 'rigFeet', 'rigSpine']);
  });

  it('sizes each bar to the rows it renders', () => {
    // Left and Right plus a Twist each for the hands and feet, three sliders
    // for the spine, and the RIG bar adds the IK switch on top of its three.
    expect(submenuHeight('rigHands')).toBe(submenuHeight('rigFeet'));
    expect(submenuHeight('rigHands')).toBeGreaterThan(submenuHeight('rigSpine'));
    expect(rigPartSliders('rig')).toHaveLength(3);
    expect(rigPartSliders('spine')).toHaveLength(3);
    expect(rigPartSliders('hands')).toHaveLength(4);
    expect(rigPartSliders('feet')).toHaveLength(4);
  });

  it('runs no hint line under any of the four, and is shorter for it', () => {
    // These are the tallest pages in the editor, they stand over the figure
    // being posed, and a slider named 'Bend' between two labelled ends has
    // already said what a sentence underneath would repeat.
    const BAR = readFileSync(join(__dirname, '..', 'components', 'RigPoseBar.tsx'), 'utf8');
    expect(BAR).not.toContain('Hint');
    // Height follows: each page is its control rows and the bar's chrome,
    // with no line of prose reserved below them.
    expect(submenuHeight('rigSpine'))
      .toBe(submenuHeight('rigRoot') - ROW_SEGMENTED - ROW_GAP);
    expect(submenuHeight('rigHands'))
      .toBe(submenuHeight('rigSpine') + ROW_SLIDER + ROW_GAP);
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
    expect(SRC.indexOf('model.showRigOptions ? [')).toBeLessThan(SRC.indexOf('model.showSvgOptions\n'));
    expect(SRC).toContain("['rigRoot', 'rigHands', 'rigFeet', 'rigSpine']");
  });

  it('carries the IK switch INSIDE the Rig bar, not as an option of its own', () => {
    // What it changes is what a joint drag does — posing behaviour, so it
    // belongs with the posing controls rather than beside them.
    expect(rigPartHasIk('rig')).toBe(true);
    expect(rigPartHasIk('hands')).toBe(false);
    expect(SRC).toContain('ik={model.rigIk}');
    expect(SRC).toContain('onToggleIk={model.onToggleRigIk}');
    expect(SRC).not.toContain('toggled: !!model.rigIk,');
    const BAR = readFileSync(join(__dirname, '..', 'components', 'RigPoseBar.tsx'), 'utf8');
    expect(BAR).toContain('rigPartHasIk(part) && onToggleIk');
  });

  it('opens and dismisses the part bars through the host’s flag', () => {
    expect(SRC).toContain("model.onRigPartOpenChange?.('rig')");
    expect(SRC).toContain("model.onRigPartOpenChange?.('hands')");
    expect(SRC).toContain("model.rigPartOpen === 'spine' ? 'rigSpine'");
    expect(SRC).toContain('model.onRigPartOpenChange?.(null);');
  });
});
