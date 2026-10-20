import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { isPatternTileDoubleTap, PATTERN_TILE_DOUBLE_TAP_MS } from '../logic/patternEdit';
import { secondTapWithin } from '../logic/secondTap';

// The "tap the same thing twice" rule, once. Controls arm on the first
// tap and act on the second — a pattern tile (400 ms, rotates), an outline
// row (opens) — and each had its own three-line copy. The WINDOW stays
// each caller's; the rule does not.

const SRC = resolve(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8');
/** Source with its comments stripped, so prose cannot trip a pin (the
 *  kernel's sourcePin suite does the same). */
const code = (...p: string[]) => read(...p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('secondTapWithin', () => {
  const last = { id: 'a', time: 1000 };

  it('needs the SAME thing tapped', () => {
    expect(secondTapWithin(last, 'a', 1100, 400)).toBe(true);
    expect(secondTapWithin(last, 'b', 1100, 400)).toBe(false);
  });

  it('needs a first tap at all', () => {
    expect(secondTapWithin(null, 'a', 1100, 400)).toBe(false);
    expect(secondTapWithin(undefined, 'a', 1100, 400)).toBe(false);
  });

  it('is inclusive at the window and false past it', () => {
    expect(secondTapWithin(last, 'a', 1400, 400)).toBe(true);
    expect(secondTapWithin(last, 'a', 1401, 400)).toBe(false);
    // The same tap, under the other caller's window.
    expect(secondTapWithin(last, 'a', 1401, 2000)).toBe(true);
    expect(secondTapWithin(last, 'a', 3001, 2000)).toBe(false);
  });

  it('reads only the difference, so the caller owns the clock (and a zero one works)', () => {
    expect(secondTapWithin({ id: 'a', time: 0 }, 'a', 0, 400)).toBe(true);
    expect(secondTapWithin({ id: 'a', time: 1e12 }, 'a', 1e12 + 399, 400)).toBe(true);
  });

  it('never reads a clock of its own', () => {
    const src = code('logic', 'secondTap.ts');
    expect(src).not.toContain('Date.now');
    expect(src).not.toContain('performance.now');
  });
});

describe('both callers are the one rule with their own window', () => {
  it('the pattern tile passes its 400 ms', () => {
    expect(PATTERN_TILE_DOUBLE_TAP_MS).toBe(400);
    const last = { id: 'tile_1', time: 50 };
    expect(isPatternTileDoubleTap(last, 'tile_1', 50 + 400)).toBe(
      secondTapWithin(last, 'tile_1', 50 + 400, PATTERN_TILE_DOUBLE_TAP_MS),
    );
    expect(isPatternTileDoubleTap(last, 'tile_1', 50 + 401)).toBe(false);
    const pattern = read('logic', 'patternEdit.ts');
    expect(pattern).toContain('return secondTapWithin(last, id, now, PATTERN_TILE_DOUBLE_TAP_MS);');
  });

  it('the outline row passes its own window', () => {
    const panel = read('components', 'SceneOutlinePanel.tsx');
    expect(panel).toContain("import { secondTapWithin } from '../logic/secondTap';");
    expect(panel).toContain('if (secondTapWithin(lastTapRef.current, row.id, now, DOUBLE_TAP_MS)) {');
    expect(code('components', 'SceneOutlinePanel.tsx')).not.toMatch(/now - last\.time/);
  });
});
