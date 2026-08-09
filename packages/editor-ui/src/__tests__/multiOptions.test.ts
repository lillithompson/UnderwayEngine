/**
 * The selection-level option set — what the ObjectPropertiesPanel's type row
 * offers a multi-selection on top of its members' shared kind, mirroring
 * `svgEdit.test.ts` for vectors.
 */

import { multiSelectionOptions } from '../logic/multiOptions';

describe('multiSelectionOptions', () => {
  it('offers Layout, Group and Merge in that order when all three are wired', () => {
    expect(multiSelectionOptions({ align: true, group: true, merge: true })).toEqual([
      { action: 'layout', label: 'Layout' },
      { action: 'group', label: 'Group' },
      { action: 'merge', label: 'Merge' },
    ]);
  });

  it('offers only what the host supplied — an unmergeable selection gets no Merge', () => {
    expect(multiSelectionOptions({ align: true, group: true }).map((o) => o.action))
      .toEqual(['layout', 'group']);
    expect(multiSelectionOptions({ group: true, merge: true }).map((o) => o.action))
      .toEqual(['group', 'merge']);
    expect(multiSelectionOptions({ merge: true }).map((o) => o.action)).toEqual(['merge']);
  });

  it('is empty when the host wires none of them, so the row stays off', () => {
    expect(multiSelectionOptions({})).toEqual([]);
    expect(multiSelectionOptions({ align: false, group: false, merge: false })).toEqual([]);
  });

  it('keeps the order stable whichever subset shows — Layout never follows Group', () => {
    const order = ['layout', 'group', 'merge'];
    for (const align of [false, true]) {
      for (const group of [false, true]) {
        for (const merge of [false, true]) {
          const actions = multiSelectionOptions({ align, group, merge }).map((o) => o.action);
          const ranks = actions.map((a) => order.indexOf(a));
          expect(ranks).toEqual([...ranks].sort((x, y) => x - y));
          expect(actions.length).toBe([align, group, merge].filter(Boolean).length);
        }
      }
    }
  });

  it('labels each option with the single word the pill shows', () => {
    for (const opt of multiSelectionOptions({ align: true, group: true, merge: true })) {
      expect(opt.label).toMatch(/^[A-Z][a-z]+$/);
    }
  });
});
