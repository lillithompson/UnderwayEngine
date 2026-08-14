// The poseable rig's type options: Hands · Feet · Spine (plus the IK
// toggle) in place of a vector's Stroke / Fill / Opacity.
//
// The panel is RN with no test renderer here, so what it does with them is
// pinned at the source — the same approach panelLayout.test.ts uses.
import { readFileSync } from 'fs';
import { join } from 'path';
import { RIG_PART_OPTIONS, restRigSliders, rigPartSliders, rigSliderPart } from '../logic/rigEdit';
import { submenuHeight } from '../logic/submenuHeight';

const SRC = readFileSync(
  join(__dirname, '..', 'components', 'ObjectPropertiesPanel.tsx'),
  'utf8',
);

describe('the rig option set', () => {
  it('is the three parts, each opening its own bar', () => {
    expect(RIG_PART_OPTIONS.map((o) => o.label)).toEqual(['Hands', 'Feet', 'Spine']);
    expect(RIG_PART_OPTIONS.map((o) => o.sub)).toEqual(['rigHands', 'rigFeet', 'rigSpine']);
  });

  it('sizes each bar to the rows it renders', () => {
    // Two sliders + a hint for the hands and feet, three + a hint for the
    // spine — so the spine bar is the taller one.
    expect(submenuHeight('rigHands')).toBe(submenuHeight('rigFeet'));
    expect(submenuHeight('rigSpine')).toBeGreaterThan(submenuHeight('rigHands'));
    expect(rigPartSliders('spine')).toHaveLength(3);
    expect(rigPartSliders('hands')).toHaveLength(2);
  });

  it('rests every slider where the figure rests', () => {
    const rest = restRigSliders();
    expect(rest).toEqual({
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
    expect(SRC).toContain("['rigHands', 'rigFeet', 'rigSpine']");
  });

  it('carries the IK toggle as its own capsule, not a bar', () => {
    expect(SRC).toContain('toggled: !!model.rigIk,');
    expect(SRC).toContain('onPress: model.onToggleRigIk,');
  });

  it('opens and dismisses the part bars through the host’s flag', () => {
    expect(SRC).toContain("model.onRigPartOpenChange?.('hands')");
    expect(SRC).toContain("model.rigPartOpen === 'spine' ? 'rigSpine'");
    expect(SRC).toContain('model.onRigPartOpenChange?.(null);');
  });
});
