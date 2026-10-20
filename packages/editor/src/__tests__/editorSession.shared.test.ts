import { PATTERN_SYMMETRY_OFF } from '@/engine/types';
import { defaultOutlineName, patternSymmetryEqual } from '../editorSession';

// The small leaves the session took home at stage 3 (docs/shared-editor.md
// §4.2): the symmetry comparison the apps' canvasSymmetry.ts used to define,
// and the outline's standard label the apps' sceneOutlineModel.ts builds
// its own over.

describe('patternSymmetryEqual compares by VALUE', () => {
  test('undefined and all-off alike are "no mirror"; a flag apart is a change', () => {
    // A reference check called every pick a change (an empty undo step on
    // a re-pick of the standing mode).
    const h = { ...PATTERN_SYMMETRY_OFF, mirrorH: true };
    expect(patternSymmetryEqual(h, { ...h })).toBe(true);
    expect(patternSymmetryEqual(undefined, PATTERN_SYMMETRY_OFF)).toBe(true);
    expect(patternSymmetryEqual(undefined, undefined)).toBe(true);
    expect(patternSymmetryEqual(h, undefined)).toBe(false);
    expect(patternSymmetryEqual(h, { ...h, mirrorV: true })).toBe(false);
  });
});

describe('defaultOutlineName', () => {
  test('an explicit name wins; a text falls back to a snippet; else the kind’s word', () => {
    expect(defaultOutlineName('svg', { name: 'Hat' })).toBe('Hat');
    expect(defaultOutlineName('svg', { name: '  ' })).toBe('Drawing');
    expect(defaultOutlineName('text', { content: 'a short line' })).toBe('a short line');
    expect(defaultOutlineName('text', { content: 'x'.repeat(40) })).toBe(`${'x'.repeat(24)}…`);
    expect(defaultOutlineName('text', {})).toBe('Text');
    expect(defaultOutlineName('image', {})).toBe('Photo');
    expect(defaultOutlineName('figure', {})).toBe('Shape');
    expect(defaultOutlineName('paint', {})).toBe('Paint');
    expect(defaultOutlineName('pattern', {})).toBe('Pattern');
    expect(defaultOutlineName('other', {})).toBe('Object');
  });
});
