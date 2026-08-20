import { readFileSync } from 'fs';
import { resolve } from 'path';

// One full-screen chrome for the whole editor: every takeover renders
// through AppModal (Facet's compact AppModal, on the panel scheme). The
// components are react-native and never render in node, so the contract is
// pinned by source — the shell's chrome itself, and each takeover's use of
// it. The floating CARD modals (rename, tile transform) are a different
// species and deliberately not held to this.

const read = (f: string) =>
  readFileSync(resolve(__dirname, '..', 'components', f), 'utf8');

describe('the unified takeover chrome (AppModal)', () => {
  const shell = read('AppModal.tsx');

  it("is Facet's compact chrome: 18/700 title left, close X right, fade", () => {
    expect(shell).toContain('animationType="fade"');
    expect(shell).toMatch(/title:\s*\{\s*fontSize:\s*18,\s*fontWeight:\s*'700'/);
    expect(shell).toContain("accessibilityLabel=\"Close\"");
    // The color picker's hooks: a painted header band with luma-picked ink.
    expect(shell).toContain('headerBackground');
    expect(shell).toContain('headerForeground');
  });

  it('every full-screen takeover renders through it, none roll their own', () => {
    for (const f of ['PatternTileModal.tsx', 'PatternSetsModal.tsx']) {
      const src = read(f);
      expect(src).toContain('<AppModal');
      // No bespoke <Modal> chrome of its own. (Nested card modals like the
      // tile-transform popover are fine — they are not takeover chrome.)
      expect(src).not.toContain('<Modal ');
    }
  });
});
