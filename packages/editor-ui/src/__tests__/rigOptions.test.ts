// The poseable rig's type options: Hands · Feet · Spine (plus the IK
// toggle) in place of a vector's Stroke / Fill / Opacity.
//
// The panel is RN with no test renderer here, so what it does with them is
// pinned at the source — the same approach panelLayout.test.ts uses.
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  RIG_PART_OPTIONS, restRigSliders, rigPartHasIk, rigPartSliders, rigSliderPart,
} from '../logic/rigEdit';
import { submenuHeight } from '../logic/submenuHeight';

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
    // Two sliders + a hint for the hands and feet, three + a hint for the
    // spine, and the RIG bar adds the IK switch on top of its three — so
    // the bars grow in that order.
    expect(submenuHeight('rigHands')).toBe(submenuHeight('rigFeet'));
    expect(submenuHeight('rigSpine')).toBeGreaterThan(submenuHeight('rigHands'));
    expect(submenuHeight('rigRoot')).toBeGreaterThan(submenuHeight('rigSpine'));
    expect(rigPartSliders('rig')).toHaveLength(3);
    expect(rigPartSliders('spine')).toHaveLength(3);
    expect(rigPartSliders('hands')).toHaveLength(2);
  });

  it('rests every slider where the figure rests', () => {
    const rest = restRigSliders();
    expect(rest).toEqual({
      spinX: 0.5, spinY: 0.5, spinZ: 0.5,
      handL: 0, handR: 0, footL: 1, footR: 1, bend: 0.5, twist: 0.5, lean: 0.5,
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
