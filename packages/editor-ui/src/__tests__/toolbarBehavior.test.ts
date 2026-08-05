import { nextToolOnPress } from '../logic/toolbarBehavior';

describe('nextToolOnPress', () => {
  test('pressing an inactive tool selects it', () => {
    expect(nextToolOnPress('arrange', 'draw')).toBe('draw');
  });
  test('pressing the active tool untoggles it — no tool left active', () => {
    expect(nextToolOnPress('draw', 'draw')).toBeNull();
  });
  test('the first tool untoggles like any other', () => {
    expect(nextToolOnPress('arrange', 'arrange')).toBeNull();
  });
  test('pressing any tool while none is active selects it', () => {
    expect(nextToolOnPress(null, 'arrange')).toBe('arrange');
    expect(nextToolOnPress(null, 'color')).toBe('color');
  });
});
