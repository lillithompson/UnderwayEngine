import { multiCapsuleOptions } from '../multiSelectionCapsule';

// The multi-selection's floating capsule: Group · Merge · Layout · Done.
// Byte-identical in all three apps before stage 6.5a of
// docs/shared-editor.md.

const keys = (o: Parameters<typeof multiCapsuleOptions>[0]) =>
  multiCapsuleOptions(o).map((x) => x.action);
const labels = (o: Parameters<typeof multiCapsuleOptions>[0]) =>
  multiCapsuleOptions(o).map((x) => x.label);

describe('multiCapsuleOptions — the segments, and their order', () => {
  it('a loose multi-selection: Group, Merge, Layout, Done', () => {
    expect(keys({ isGroup: false, canMerge: true }))
      .toEqual(['group', 'merge', 'layout', 'deselect']);
    expect(labels({ isGroup: false, canMerge: true }))
      .toEqual(['Group', 'Merge', 'Layout', 'Done']);
  });

  it('Ungroup stands in Group’s place for a selection that already IS one group', () => {
    // Binding a bound selection was a no-op that read as broken, and the
    // way back belongs where the way in was — so it is the same slot.
    expect(keys({ isGroup: true, canMerge: true })[0]).toBe('ungroup');
    expect(labels({ isGroup: true, canMerge: true })[0]).toBe('Ungroup');
    expect(keys({ isGroup: true, canMerge: true }))
      .toHaveLength(keys({ isGroup: false, canMerge: true }).length);
  });

  it('Merge drops out when it cannot fire, rather than graying', () => {
    expect(keys({ isGroup: false, canMerge: false }))
      .toEqual(['group', 'layout', 'deselect']);
    expect(keys({ isGroup: true, canMerge: false }))
      .toEqual(['ungroup', 'layout', 'deselect']);
  });

  it('Done is unconditional, and last', () => {
    for (const isGroup of [false, true]) {
      for (const canMerge of [false, true]) {
        const k = keys({ isGroup, canMerge });
        expect(k[k.length - 1]).toBe('deselect');
        expect(k.filter((x) => x === 'deselect')).toHaveLength(1);
      }
    }
  });

  it('the two that change what the selection IS come before the reversible one', () => {
    const k = keys({ isGroup: false, canMerge: true });
    expect(k.indexOf('group')).toBeLessThan(k.indexOf('merge'));
    expect(k.indexOf('merge')).toBeLessThan(k.indexOf('layout'));
  });

  it('every segment’s label is one word — it is the accessibility name too', () => {
    for (const isGroup of [false, true]) {
      for (const canMerge of [false, true]) {
        for (const label of labels({ isGroup, canMerge })) {
          expect(label).toMatch(/^[A-Z][a-z]+$/);
        }
      }
    }
  });

  it('a fresh array each call: the shell may key off it without aliasing', () => {
    const a = multiCapsuleOptions({ isGroup: false, canMerge: true });
    const b = multiCapsuleOptions({ isGroup: false, canMerge: true });
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});
