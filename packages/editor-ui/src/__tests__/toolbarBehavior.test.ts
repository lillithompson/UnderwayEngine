import { nextToolOnPress } from '../logic/toolbarBehavior';

describe('nextToolOnPress', () => {
  const tools = ['arrange', 'draw', 'text', 'color'];

  test('pressing an inactive tool selects it', () => {
    expect(nextToolOnPress(tools, 'arrange', 'draw')).toBe('draw');
  });
  test('pressing the active tool drops back to the default (first) tool', () => {
    expect(nextToolOnPress(tools, 'draw', 'draw')).toBe('arrange');
  });
  test('pressing the default tool while active is a no-op', () => {
    expect(nextToolOnPress(tools, 'arrange', 'arrange')).toBe('arrange');
  });
  test('falls back to the pressed id when the tool list is empty', () => {
    expect(nextToolOnPress([], 'x', 'x')).toBe('x');
  });
});
