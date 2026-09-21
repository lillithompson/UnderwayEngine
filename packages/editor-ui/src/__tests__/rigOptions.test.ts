// The poseable rig's type options: Rig · Hands · Feet · Spine · Head in
// place of a vector's Stroke / Fill / Opacity.
//
// The panel is RN with no test renderer here, so what it does with them is
// pinned at the source — the same approach panelLayout.test.ts uses.
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  RIG_JOINT_SECTIONS, RIG_PAGES, RIG_PART_OPTIONS, RIG_SLIDER_REST,
  restRigSliders, rigJointSliders,
  rigPartOfSubmenu, rigPartSliders, rigPartSubmenu, rigSliderPart,
} from '../logic/rigEdit';
import {
  BAR_CUSHION, ROW_GAP, ROW_SEGMENTED, ROW_SLIDER, pageIsWelled, rowGroupHeight, submenuHeight,
} from '../logic/submenuHeight';
import type { SubmenuKey } from '../logic/submenuHeight';

const SRC = readFileSync(
  join(__dirname, '..', 'components', 'ObjectPropertiesPanel.tsx'),
  'utf8',
);

describe('the rig option set', () => {
  it('the pairing TABLE knows the figure and its five parts', () => {
    // The full table stays — it is the part↔bar/slider pairing the hosts'
    // floating slider modes look joints up through — even though most of
    // its rows no longer open a page.
    // The whole figure's page is named for what its sliders do (turn it
    // on three axes), not for the object.
    expect(RIG_PART_OPTIONS.map((o) => o.label))
      .toEqual(['Transform', 'Hands', 'Feet', 'Spine', 'Head', 'Joints']);
    expect(RIG_PART_OPTIONS.map((o) => o.sub))
      .toEqual(['rigRoot', 'rigHands', 'rigFeet', 'rigSpine', 'rigHead', 'rigJoints']);
  });

  it('offers Figure, Joints, Color, Transform — and not Opacity', () => {
    // The part pages (Hands / Feet / Spine / Head) came off the options
    // row; their sliders live on as the floating slider modes. What is left
    // of the parts is the JOINTS page and the whole figure's three axes —
    // and the row wraps them in the two pages that are not postures at all:
    // FIGURE, the rig as an object (its one act, Reset), and COLOR, the two
    // colours the sketch is drawn in.
    //
    // The order runs from what the figure IS to how it is turned, so the
    // page you reach for to start over leads and the fine adjustment
    // trails. Both panel sites — the tab row and the page list — read
    // RIG_PAGES, never the part table, so a tab can never be offered with
    // no page behind it.
    expect(RIG_PAGES.map((o) => o.label)).toEqual(['Figure', 'Joints', 'Color', 'Transform']);
    expect(RIG_PAGES.map((o) => o.sub))
      .toEqual(['rigFigure', 'rigJoints', 'rigColor', 'rigRoot']);
    expect(RIG_PAGES.map((o) => o.key)).toEqual(['figure', 'joints', 'color', 'rig']);
    expect(SRC).toContain('model.showRigOptions ? RIG_PAGES.map((o) => o.sub)');
    expect(SRC).toContain('RIG_PAGES.map((opt) => ({');
    // Opacity stood beside Transform and is gone: a figure is a POSE, and
    // fading one is not a thing anybody reached this panel to do — it
    // left a two-tab row whose second tab was a slider nobody asked for.
    // The plumbing stands for every other kind that offers the page.
    // Scoped to the rig's own branch: the kinds that DO offer the page
    // push exactly this spec (a pattern's, next door), so the guard reads
    // the branch rather than the file.
    const rig = SRC.slice(SRC.indexOf('} else if (model.showRigOptions) {'),
      SRC.indexOf('} else if (model.showSvgOptions) {'));
    expect(rig).not.toContain("key: 'opacity'");
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
    expect(rigPartOfSubmenu('effects')).toBeNull();
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
    // Four pole sliders — a left and a right for the elbows and the knees
    // — of which the page shows TWO at a time, behind its own tabs.
    expect(rigPartSliders('joints')).toHaveLength(4);
    // Every LIST page's bar is exactly its own rows — no page borrows
    // another's. Joints is not one: it is a tabbed box showing two of its
    // four at a time, so its height is the box's, not its slider count's
    // (see the Joints page test below).
    for (const opt of RIG_PART_OPTIONS) {
      if (opt.part === 'joints') continue;
      const rows = rigPartSliders(opt.part).length;
      expect(submenuHeight(opt.sub))
        .toBe(submenuHeight('rigHead') + (rows - 3) * (ROW_SLIDER + ROW_GAP));
    }
  });

  it('the Joints page is ONE tabbed box, the same height on either face', () => {
    // The Copies page's shape, for the same reason: Left and Right are one
    // setting asked twice, and elbows and knees are the same question
    // about a different pair of chains. Both faces are a tab row and two
    // sliders, so the sheet never resizes under a tab press…
    expect(submenuHeight('rigJoints')).toBe(
      rowGroupHeight([ROW_SEGMENTED, ROW_SLIDER, ROW_SLIDER]) + BAR_CUSHION,
    );
    // …and the box IS the page, so no well is drawn around it.
    expect(pageIsWelled('rigJoints')).toBe(false);
    expect(pageIsWelled('rigRoot')).toBe(true);
    // Its two faces, and the pair each shows.
    expect(RIG_JOINT_SECTIONS.map((s) => s.label)).toEqual(['Elbows', 'Knees']);
    expect(rigJointSliders('elbows')).toEqual(['poleElbowL', 'poleElbowR']);
    expect(rigJointSliders('knees')).toEqual(['poleKneeL', 'poleKneeR']);
    // Both are CENTRED, and their two ends are the same place: a pole
    // angle goes all the way round, which is what lets one bar reach every
    // position the joint can take.
    for (const spec of rigPartSliders('joints')) {
      expect(spec.centered).toBe(true);
      expect(spec.ends[0]).toBe(spec.ends[1]);
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

  it('has no Remove line under it, on any of the pages', () => {
    // On an effect page Remove takes away something that was ADDED — a
    // shadow, a border — and the object is itself again. A rig has no such
    // layer: every slider is a posture the figure is always in, so a Remove
    // could only mean "this part back to rest" — and it reset the whole
    // page, untouched sliders included, so one tap flattened a pair of
    // hands posed finger by finger. Resetting is offered over the WHOLE
    // figure instead, from the FIGURE page (see below).
    const BAR = readFileSync(join(__dirname, '..', 'components', 'RigPoseBar.tsx'), 'utf8');
    expect(BAR).not.toContain('onRemove');
    // The Figure page's Reset is not a Remove and is not per-part: it is
    // that page's one act (see below), and no other page has one.
    expect(BAR).not.toContain('removeLabel');
    // The panel gives the rig pages no Remove line — only the effect pages
    // set one.
    const rigBranch = SRC.slice(SRC.indexOf('<RigPoseBar'), SRC.indexOf("} else if (displaySub === 'rigColor') {"));
    expect(rigBranch).not.toContain('removeAction =');
    // …and the panel hands the page nothing to reset with.
    expect(SRC).not.toContain('onResetRigPart');
    const ADAPTER = readFileSync(join(__dirname, '..', 'adapter.ts'), 'utf8');
    expect(ADAPTER).not.toContain('onResetRigPart');
  });

  it("the FIGURE page's one act, in the filled button an Add wears", () => {
    // The row is a row of PAGES: every option opens a bar and lights as the
    // carousel's position. Reset opened nothing and lit nothing, so it sat
    // in that row as a button that behaved like no other. It is the FIGURE
    // page's content now — the page about the rig as an object rather than
    // about any posture — and it wears the same filled button "Add Fill"
    // wears, because it is the same kind of thing: a page whose whole
    // content is one act. It stood as a one-cell ActionRow, which is the
    // shape the pages use for CHOOSING between states.
    expect(SRC).toContain('typeSpecs = RIG_PAGES.map');
    expect(SRC).not.toContain("key: 'resetRig'");
    expect(RIG_PART_OPTIONS.some((o) => o.sub === ('resetRig' as SubmenuKey))).toBe(false);
    const figure = SRC.slice(
      SRC.indexOf("} else if (displaySub === 'rigFigure') {"),
      SRC.indexOf('} else if (displaySub && rigPartOfSubmenu(displaySub)) {'),
    );
    // Only when the host wires it — a locked rig offers no reset.
    expect(figure).toContain('{model.onResetRig ? (');
    expect(figure).toContain('<EffectButton label="Reset" icon="restore"');
    // …and the pose pages have nothing to reset with any more.
    const BAR = readFileSync(join(__dirname, '..', 'components', 'RigPoseBar.tsx'), 'utf8');
    expect(BAR).not.toContain('onReset');
    expect(BAR).not.toContain('ActionRow');
  });

  it('makes room for that act on the FIGURE page, and only there', () => {
    // The page's height is counted from what it will render, like the
    // Layout bar's Arrange row: no Reset wired, no button, no room
    // reserved — and the Transform page is three sliders either way now.
    expect(submenuHeight('rigFigure', { rigCanReset: true }))
      .toBe(submenuHeight('rigFigure') + ROW_SEGMENTED);
    expect(submenuHeight('rigRoot')).toBe(submenuHeight('rigSpine'));
    // Every other page is untouched by the flag — the reset is not theirs.
    for (const sub of ['rigRoot', 'rigHands', 'rigFeet', 'rigSpine', 'rigHead'] as const) {
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
    // The ball's bend is centred: below the middle the toes peel BACK up
    // off the ground (a quarter turn at the far end), above it they fold
    // under toward tiptoe — so it rests flat at the centre.
    for (const spec of rigPartSliders('feet').slice(4)) {
      expect(spec.label).toContain('Bend');
      expect(spec.ends).toEqual(['back', 'tiptoe']);
      expect(spec.centered).toBe(true);
      expect(RIG_SLIDER_REST[spec.key]).toBe(0.5);
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
      footL: 0, footR: 0, ankleTwistL: 0.5, ankleTwistR: 0.5,
      ballBendL: 0.5, ballBendR: 0.5,
      bend: 0.5, twist: 0.5, lean: 0.5,
      nod: 0.5, shake: 0.5, tilt: 0.5,
      // The chain as the drags left it.
      poleElbowL: 0.5, poleElbowR: 0.5, poleKneeL: 0.5, poleKneeR: 0.5,
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
    // The BRANCH in the page-order chain, named by its leading `:` — the
    // flag itself is read in a few other places (what encloses an area,
    // what repeats), and any of those would otherwise answer this.
    expect(SRC.indexOf('model.showRigOptions ? ')).toBeLessThan(SRC.indexOf(': model.showSvgOptions'));
    // …and the carousel's order IS the options row's, not a second copy of it.
    expect(SRC).toContain('model.showRigOptions ? RIG_PAGES.map((o) => o.sub)');
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
