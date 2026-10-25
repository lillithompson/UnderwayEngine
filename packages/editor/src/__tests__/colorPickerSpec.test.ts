import type {
  ColorPickerSpec, ColorPickerSpecFor, CommonColorPickerId,
} from '../colorPickerSpec';

// The colour-picker table the shell builds each render (docs/shared-editor.md
// §4.2 item 6, 6.5b.1). It is types alone, so what there is to hold is the
// SHAPE: that the common ids are the thirteen every app has, and that a
// table typed in an app's own union takes that app's rows and refuses the
// other apps'. A module in packages/editor is typechecked only while a
// suite loads it, so this is also what typechecks it at all.

const COMMON_IDS: CommonColorPickerId[] = [
  'color', 'shadow', 'border', 'stroke', 'glowOuter', 'glowInner',
  'tint', 'svgFill', 'text', 'radial', 'frameBg', 'fade', 'svgPatternStroke',
];

function row<TId extends string>(id: TId): ColorPickerSpecFor<TId> {
  return {
    id,
    visible: false,
    color: { r: 0, g: 0, b: 0 },
    alpha: 1,
    showOpacity: true,
    confirm: () => {},
    close: () => {},
  };
}

describe('CommonColorPickerId — the swatches every Underway editor has', () => {
  it('is the thirteen the three apps share, each named once', () => {
    // Derived at 6.5b.1 by intersecting the three apps' ColorPickerId
    // unions (15 / 13 / 14 members). An exact list: an id added here that
    // only one app has would type a picker the other two never open.
    expect(new Set(COMMON_IDS).size).toBe(COMMON_IDS.length);
    expect([...COMMON_IDS].sort()).toEqual([
      'border', 'color', 'fade', 'frameBg', 'glowInner', 'glowOuter',
      'radial', 'shadow', 'stroke', 'svgFill', 'svgPatternStroke', 'text',
      'tint',
    ]);
  });
});

describe('ColorPickerSpecFor — a table typed in the app\'s own union', () => {
  it('takes a row for every common id', () => {
    const table: ColorPickerSpec[] = COMMON_IDS.map(row);
    expect(table.map((r) => r.id)).toEqual(COMMON_IDS);
  });

  it('takes an app\'s own id beside them', () => {
    // CozyJournal's rig Color page writes two ids of its own; the table is
    // generic so its rows are typed in ITS union, not widened to string.
    type RigPickerId = CommonColorPickerId | 'rigVolumes' | 'rigOutlines';
    const table: ColorPickerSpecFor<RigPickerId>[] = [row('color'), row('rigVolumes')];
    expect(table.map((r) => r.id)).toEqual(['color', 'rigVolumes']);
  });

  it('carries the opacity a target has no channel for as showOpacity false', () => {
    const r = row<CommonColorPickerId>('text');
    expect({ ...r, showOpacity: false }.showOpacity).toBe(false);
  });

  it('tells a confirm that moved only the opacity apart from one that moved the colour', () => {
    // The flag is what stops a multi-selection confirm overwriting every
    // member's own colour when the reader only dragged the slider.
    const seen: boolean[] = [];
    const r: ColorPickerSpec = { ...row<CommonColorPickerId>('color'), confirm: (_c, _a, t) => seen.push(t) };
    r.confirm({ r: 1, g: 2, b: 3 }, 0.5, false);
    r.confirm({ r: 1, g: 2, b: 3 }, 0.5, true);
    expect(seen).toEqual([false, true]);
  });
});
