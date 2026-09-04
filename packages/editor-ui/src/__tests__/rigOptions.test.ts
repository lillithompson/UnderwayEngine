// The poseable rig's type options: Rig · Hands · Feet · Spine · Head in
// place of a vector's Stroke / Fill / Opacity.
//
// The panel is RN with no test renderer here, so what it does with them is
// pinned at the source — the same approach panelLayout.test.ts uses.
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  RIG_PART_OPTIONS, RIG_PART_PAGES, RIG_SLIDER_REST, restRigSliders, rigPartOfSubmenu,
  rigPartSliders, rigPartSubmenu, rigSliderPart,
} from '../logic/rigEdit';
import { ROW_GAP, ROW_SEGMENTED, ROW_SLIDER, submenuHeight } from '../logic/submenuHeight';
import type { SubmenuKey } from '../logic/submenuHeight';

const SRC = readFileSync(
  join(__dirname, '..', 'components', 'ObjectPropertiesPanel.tsx'),
  'utf8',
);

describe('the rig option set', () => {
  it('the pairing TABLE knows the figure and its four parts', () => {
    // The full table stays — it is the part↔bar/slider pairing the hosts'
    // floating slider modes look joints up through — even though most of
    // its rows no longer open a page.
    expect(RIG_PART_OPTIONS.map((o) => o.label))
      .toEqual(['Rig', 'Hands', 'Feet', 'Spine', 'Head']);
    expect(RIG_PART_OPTIONS.map((o) => o.sub))
      .toEqual(['rigRoot', 'rigHands', 'rigFeet', 'rigSpine', 'rigHead']);
  });

  it('the panel offers ONE page: the whole figure', () => {
    // The part pages (Hands / Feet / Spine / Head) came off the options
    // row; their sliders live on as the floating slider modes. Both panel
    // sites — the options row and the submenu list — read RIG_PART_PAGES,
    // never the full table.
    expect(RIG_PART_PAGES.map((o) => o.label)).toEqual(['Rig']);
    expect(RIG_PART_PAGES.map((o) => o.sub)).toEqual(['rigRoot']);
    expect(SRC).toContain('RIG_PART_PAGES.map((o) => o.sub)');
    expect(SRC).toContain('RIG_PART_PAGES.map((opt) => ({');
    expect(SRC).not.toContain('RIG_PART_OPTIONS');
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
    // Left and Right plus a Twist each for the hands and feet — and a
    // Spread and a Bend each for the hands, which is why their bar stands
    // taller than the feet's now; three sliders apiece for the spine, the
    // whole figure's three axes, and the head's (Nod, Shake, Tilt).
    expect(submenuHeight('rigHands')).toBeGreaterThan(submenuHeight('rigFeet'));
    expect(submenuHeight('rigRoot')).toBe(submenuHeight('rigSpine'));
    expect(submenuHeight('rigFeet')).toBeGreaterThan(submenuHeight('rigSpine'));
    expect(submenuHeight('rigHead')).toBe(submenuHeight('rigSpine'));
    expect(rigPartSliders('rig')).toHaveLength(3);
    expect(rigPartSliders('spine')).toHaveLength(3);
    expect(rigPartSliders('hands')).toHaveLength(8);
    expect(rigPartSliders('feet')).toHaveLength(6);
    expect(rigPartSliders('head')).toHaveLength(3);
    // Every part's bar is exactly its own rows — no page borrows another's.
    for (const opt of RIG_PART_OPTIONS) {
      const rows = rigPartSliders(opt.part).length;
      expect(submenuHeight(opt.sub))
        .toBe(submenuHeight('rigHead') + (rows - 3) * (ROW_SLIDER + ROW_GAP));
    }
  });

  it('gives the head its own three sliders, centred, and nothing else', () => {
    // The Spine bar cannot do this: its bend curves the WHOLE column and
    // takes the head along at the end of it, so there was no way to tip a
    // face without stooping the body to do it. Tilt is the roll the other
    // two leave over: ear to shoulder, about the gaze.
    const specs = rigPartSliders('head');
    expect(specs.map((s) => s.label)).toEqual(['Nod', 'Shake', 'Tilt']);
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
      .toBe(submenuHeight('rigSpine') + 5 * (ROW_SLIDER + ROW_GAP));
  });

  it('has no trash in its header, on any of the pages', () => {
    // On an effect bar the trash removes something that was ADDED — a
    // shadow, a border — and the object is itself again. A rig has no such
    // layer: every slider is a posture the figure is always in, so a trash
    // could only mean "this part back to rest" — and it reset the whole
    // page, untouched sliders included, so one tap flattened a pair of
    // hands posed finger by finger. Resetting is offered over the WHOLE
    // figure instead, from the options row (see below).
    const BAR = readFileSync(join(__dirname, '..', 'components', 'RigPoseBar.tsx'), 'utf8');
    expect(BAR).not.toContain('onRemove');
    // The RIG page's Reset is not a trash and is not per-part: it is a
    // labelled row saying "whole figure" (see below), and no other page has
    // one.
    expect(BAR).not.toContain('removeLabel');
    // The header still carries the title and the way back out.
    expect(BAR).toContain('<EffectBarHeader title={rigPartTitle(part)} chevron onBack={onBack} />');
    // …and the panel hands the bar nothing to reset with.
    expect(SRC).not.toContain('onResetRigPart');
    const ADAPTER = readFileSync(join(__dirname, '..', 'adapter.ts'), 'utf8');
    expect(ADAPTER).not.toContain('onResetRigPart');
  });

  it('is the parts and nothing else — Reset is not one of them', () => {
    // The row is a row of PAGES: every option opens a bar and lights as the
    // carousel's position. Reset opened nothing and lit nothing, so it sat in
    // that row as a button that behaved like no other; it lives at the foot of
    // the RIG bar now, the page already about the whole figure.
    expect(SRC).toContain('typeSpecs = RIG_PART_PAGES.map');
    expect(SRC).not.toContain("key: 'resetRig'");
    expect(RIG_PART_OPTIONS.some((o) => o.sub === ('resetRig' as SubmenuKey))).toBe(false);
    // The bar takes it instead, and only when the host wires it — a locked
    // rig offers no reset.
    expect(SRC).toContain('onReset={model.onResetRig}');
    const BAR = readFileSync(join(__dirname, '..', 'components', 'RigPoseBar.tsx'), 'utf8');
    expect(BAR).toContain("{part === 'rig' && onReset ? (");
    // It says whose reset it is: under three sliders, an unlabelled button
    // would read as resetting those three.
    expect(BAR).toContain('<ActionRow label="Whole figure" options={RESET_OPTION} onPress={onReset} />');
  });

  it('makes room for that row on the RIG page, and only there', () => {
    // The bar's height is counted from what it will render, like the Layout
    // bar's Arrange row: no Reset wired, no row, no room reserved.
    const withReset = submenuHeight('rigRoot', { rigCanReset: true });
    expect(withReset).toBe(submenuHeight('rigRoot') + ROW_SEGMENTED + ROW_GAP);
    expect(submenuHeight('rigRoot')).toBe(submenuHeight('rigSpine'));
    // The other pages are untouched by the flag — the reset is not theirs.
    for (const sub of ['rigHands', 'rigFeet', 'rigSpine', 'rigHead'] as const) {
      expect(submenuHeight(sub, { rigCanReset: true })).toBe(submenuHeight(sub));
    }
  });

  it('gives each hand and foot a centred Twist beside its own slider, and the hands a Spread and a Bend', () => {
    // The curl / flex slider runs one way from rest; the twist, the spread
    // and the bend run BOTH ways from the middle, since a joint rolls (and
    // a fan opens, and a wrist folds) either direction.
    expect(rigPartSliders('hands').map((s) => s.key)).toEqual([
      'handL', 'handR', 'wristTwistL', 'wristTwistR', 'spreadL', 'spreadR',
      'wristBendL', 'wristBendR',
    ]);
    expect(rigPartSliders('feet').map((s) => s.key)).toEqual([
      'footL', 'footR', 'ankleTwistL', 'ankleTwistR', 'ballBendL', 'ballBendR',
    ]);
    for (const part of ['hands', 'feet'] as const) {
      for (const spec of rigPartSliders(part).slice(2, 4)) {
        expect(spec.centered).toBe(true);
        expect(RIG_SLIDER_REST[spec.key]).toBe(0.5);
      }
    }
    // The ball's bend runs ONE way — flat to tiptoe, the forefoot folding
    // down through the arch — so it is not centred and rests flat.
    for (const spec of rigPartSliders('feet').slice(4)) {
      expect(spec.label).toContain('Bend');
      expect(spec.ends).toEqual(['flat', 'tiptoe']);
      expect(spec.centered).toBeUndefined();
      expect(RIG_SLIDER_REST[spec.key]).toBe(0);
    }
    for (const spec of rigPartSliders('hands').slice(4, 6)) {
      expect(spec.label).toContain('Spread');
      expect(spec.ends).toEqual(['together', 'wide']);
    }
    // The wrist hinge: the hand laid back or folded forward, off straight.
    for (const spec of rigPartSliders('hands').slice(6)) {
      expect(spec.label).toContain('Bend');
      expect(spec.ends).toEqual(['back', 'forward']);
    }
  });

  it('rests every slider where the figure rests', () => {
    const rest = restRigSliders();
    expect(rest).toEqual({
      spinX: 0.5, spinY: 0.5, spinZ: 0.5,
      handL: 0.1, handR: 0.1, wristTwistL: 0.5, wristTwistR: 0.5,
      spreadL: 0.5, spreadR: 0.5, wristBendL: 0.5, wristBendR: 0.5,
      footL: 1, footR: 1, ankleTwistL: 0.5, ankleTwistR: 0.5,
      ballBendL: 0, ballBendR: 0,
      bend: 0.5, twist: 0.5, lean: 0.5,
      nod: 0.5, shake: 0.5, tilt: 0.5,
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
    expect(SRC).toContain('model.showRigOptions ? RIG_PART_PAGES.map((o) => o.sub)');
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
