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

describe('both rows stand inside the safe area', () => {
  it('rests the LOWER row on the panel margin, so neither hangs off the edge', () => {
    // The stack used to be dropped a row (ROW_DROP), which put the lower
    // handle over the home-indicator strip — a gesture fight on native iOS
    // every time it was grabbed. Both rows now sit above the inset: the
    // lower one takes the spot the upper one used to hold.
    expect(SRC).toContain('bottom: safeBottom + BOTTOM_MARGIN');
    expect(SRC).not.toContain('ROW_DROP');
  });

  it('puts STRENGTH on the upper row', () => {
    // It is the control reached for mid-painting, so it takes the row
    // furthest from the screen edge. Rendered order IS stacking order here
    // (a plain column), so first child = on top.
    const stack = /<Animated\.View style=\{\{ transform[\s\S]*?<\/Animated\.View>/.exec(SRC)?.[0] ?? '';
    expect(stack).toContain('label="Strength"');
    expect(stack.indexOf('label="Strength"')).toBeLessThan(stack.indexOf('label="Size"'));
  });

  it('still clears the screen entirely when it hides', () => {
    // The stack sits a row higher than it did, so the hidden offset has to
    // cover the margin, BOTH rows and the inset — otherwise a handle stays
    // parked at the bottom of the artwork while the panel is "away".
    expect(SRC).toContain('const HIDDEN_Y = HANDLE * 2 + ROW_GAP + BOTTOM_MARGIN + 80;');
  });
});

// Each row shows the value in the currency it controls: SIZE as a width,
// STRENGTH as an opacity. A dot that merely grew would say nothing about how
// much paint a dab lays down.
describe('each handle reads out the thing its row controls', () => {
  it('gives size a diameter and strength an opacity', () => {
    expect(SRC).toContain('label="Size" readout="diameter"');
    expect(SRC).toContain('label="Strength" readout="opacity"');
  });

  it('draws the strength wash at full size, varying only its opacity', () => {
    // Clear at the left end, solid at the right — so the readout has to be
    // the opacity, not the size, of the disc.
    const branch = /\{readout === 'diameter' \? \([\s\S]*?\)\}/.exec(SRC)?.[0] ?? '';
    expect(branch).toContain('width: dot');           // the size row still grows
    expect(branch).toContain('styles.wash, { opacity: v }'); // the strength row fades
    const wash = /wash: \{[\s\S]*?\n  \},/.exec(SRC)?.[0] ?? '';
    expect(wash).toContain('width: DOT_MAX');
    expect(wash).toContain('height: DOT_MAX');
  });

  it('feathers the wash out to nothing at its rim', () => {
    expect(SRC).toContain('radial-gradient(circle at 50% 50%');
    expect(SRC).toContain('rgba(255,255,255,0) 100%');
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

describe('a two-finger tap belongs to the canvas, not to a slider', () => {
  it('refuses a gesture that already has a second finger down', () => {
    // Undo and redo are two- and three-finger taps on the canvas, and they
    // land wherever the hand is — often right on these sliders, which float
    // over the artwork. Taking that gesture both swallowed the undo and
    // jumped the brush size on the way.
    expect(SRC).toContain(
      'onStartShouldSetPanResponder: (_e, g) => isSingleTouchGesture(g.numberActiveTouches)',
    );
    expect(SRC).toContain(
      'onMoveShouldSetPanResponder: (_e, g) => isSingleTouchGesture(g.numberActiveTouches)',
    );
  });

  it('hands back what it took when a second finger joins one in flight', () => {
    // The two fingers rarely land in the same event, so refusing at the
    // start is not enough on its own: the row must also give up a gesture
    // it has already grabbed, and put the value back where it found it.
    expect(SRC).toContain('if (!isSingleTouchGesture(g.numberActiveTouches))');
    expect(SRC).toContain('dragRef.current = grabbedRef.current;');
    expect(SRC).toContain('cbRef.current(grabbedRef.current);');
    // …and an abandoned gesture must not fire the value again on release.
    expect(SRC).toContain('if (!gave) cbRef.current(dragRef.current);');
  });
});
