// Where the floating brush controls sit, and where each row's name is drawn.
//
// BrushControlsPanel can't be imported here (react-native's Animated /
// PanResponder have no node shim), so the layout decisions are pinned at the
// source — the same approach outlineFrameAll.test.ts and panelTheme.test.ts
// use for the other components in this package.
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(
  join(__dirname, '..', 'components', 'BrushControlsPanel.tsx'),
  'utf8',
);

describe('the stack sits one row lower than the panel it replaced', () => {
  it('drops by exactly a row plus its gap', () => {
    // "The top one should be where the bottom one currently is": the whole
    // stack moves down by one row, so the SIZE slider lands on the spot the
    // single slider used to hold.
    expect(SRC).toContain('const ROW_DROP = HANDLE + ROW_GAP;');
    expect(SRC).toContain('safeBottom + BOTTOM_MARGIN - ROW_DROP');
  });

  it('accepts the home-indicator strip but not the window edge', () => {
    // Overlapping the unsafe area is deliberate; sliding off-screen on a
    // device with no bottom inset is not.
    expect(SRC).toContain('Math.max(0, safeBottom + BOTTOM_MARGIN - ROW_DROP)');
  });
});

describe('a row names itself inside its own track', () => {
  it('is left-justified within the pill, not floated off to its side', () => {
    const label = /label: \{[\s\S]*?\n  \},/.exec(SRC)?.[0] ?? '';
    expect(label).toContain('left: LABEL_INSET');
    // The old placement anchored it by its right edge OUTSIDE the track.
    expect(label).not.toContain('right: TRACK_W');
  });

  it('appears with the dark ground it is drawn over', () => {
    // One driver for both, so the name can never show without its backing.
    expect(SRC).toContain('<Animated.View style={[styles.ground, { opacity: heldFade }]} />');
    expect(SRC).toContain('<Animated.Text style={[styles.label, { opacity: heldFade }]}');
  });

  it('never eats a touch meant for the track under it', () => {
    expect(SRC).toContain('pointerEvents="none"');
  });
});
