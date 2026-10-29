import { readFileSync } from 'fs';
import { resolve } from 'path';

// Source pins for the card-program chips (a host page's `cards` row): a
// program of any length is a sideways strip of fixed-width chips. Under
// react-native-web a `flex: 0` chip is written as CSS `flex: 0` — a 0%
// basis that ignores its width — so every chip shrank to nothing and the
// glyphs piled on one another. Nothing here can mount a View, so the
// style sheet is read as text.

function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const BARS = code(resolve(__dirname, '..', 'components', 'HostPageBar.tsx'));

function styleBody(name: string): string {
  const m = BARS.match(new RegExp(`\\n  ${name}: \\{([\\s\\S]*?)\\},`));
  if (!m) throw new Error(`no style ${name}`);
  return m[1];
}

describe('card program chips', () => {
  it('a fixed chip holds its width and never shrinks', () => {
    const fixed = styleBody('chipFixed');
    expect(fixed).toMatch(/width: 56/);
    expect(fixed).toMatch(/flexShrink: 0/);
    expect(fixed).not.toMatch(/\bflex:/);
  });

  it('the shared chip style carries no flex, so it cannot override a fixed chip', () => {
    expect(styleBody('chip')).not.toMatch(/\bflex\b/);
  });

  it('every program row is fixed chips that wrap, the + chip included, the current one ringed and the flashed one lit', () => {
    // No row shares a fixed number of chips across the width (`chipEven`).
    expect(BARS).not.toContain('chipEven');
    // No greyed chip: a card is held or it is not in the program.
    expect(BARS).toContain('style={[styles.chip, styles.chipFixed, slot.current && styles.chipCurrent, slot.flash && styles.chipFlash]}');
    expect(BARS).not.toContain('chipGreyed');
    expect(BARS).toContain('style={[styles.chip, styles.chipFixed, styles.chipAdd]}');
  });

  it('no style in the sheet uses flex: 0', () => {
    expect(BARS).not.toMatch(/\bflex: 0\b/);
  });

  it('the picker sheet heads each group where it starts', () => {
    expect(BARS).toContain('const heading = opt.group && opt.group !== list[k - 1]?.group ? opt.group : null;');
    expect(BARS).toContain('{heading && <Text style={styles.pickerHeading}>{heading}</Text>}');
    expect(styleBody('pickerHeading')).toMatch(/color: PANEL_INK_LABEL/);
  });
});

// Every card the picker lists can be picked: no option carries a reason
// it cannot be.
describe('the picker has no greyed option', () => {
  it('lists no reason and disables nothing', () => {
    expect(BARS).not.toMatch(/opt\.reason/);
    expect(BARS).not.toContain('pickerRowOff');
    expect(BARS).not.toContain('pickerReason');
  });
});
