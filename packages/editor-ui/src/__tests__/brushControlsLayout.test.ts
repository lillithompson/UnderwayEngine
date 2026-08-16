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

  it('drops the STRENGTH row on request, leaving Size where it was', () => {
    // A host whose brush carries its strength elsewhere (the paint brush's
    // is its color's own Opacity) asks for one slider instead of two. The
    // stack stands on the bottom edge, so the row that goes is the one
    // ABOVE Size — and Size, the row a finger reaches for by position, does
    // not move.
    expect(SRC).toContain('model.showStrength === false ? null : (');
    const stack = /<Animated\.View style=\{\{ transform[\s\S]*?<\/Animated\.View>/.exec(SRC)?.[0] ?? '';
    // Strength and the gap under it are inside the conditional; Size is not.
    const conditional = /\{model\.showStrength === false \? null : \([\s\S]*?\)\}/.exec(stack)?.[0] ?? '';
    expect(conditional).toContain('label="Strength"');
    expect(conditional).toContain('height: ROW_GAP');
    expect(conditional).not.toContain('label="Size"');
    // The wrap still stands on the bottom margin, which is what keeps Size
    // in place when the row above it disappears.
    expect(SRC).toContain('bottom: safeBottom + BOTTOM_MARGIN');
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

/**
 * A row moves only by its handle being picked up. These sliders float over
 * the artwork with invisible tracks, so "tap anywhere to jump there" turned
 * every stray touch near the bottom of the screen into a silent change of
 * brush size, brush strength or rig turn.
 */
describe('only the handle moves a row', () => {
  const grant = /onPanResponderGrant: \(e\) => \{[\s\S]*?\n      \},/.exec(SRC)?.[0] ?? '';
  const move = /onPanResponderMove: \(e, g\) => \{[\s\S]*?\n      \},/.exec(SRC)?.[0] ?? '';

  it('decides on contact whether the handle was grabbed', () => {
    expect(SRC).toContain('brushSliderGrabsHandle');
    expect(grant).toContain('takeHold(e.nativeEvent.locationX)');
  });

  it('does not change the value just for being touched', () => {
    // Picking a handle up is not an edit — the value stays where it was
    // until the finger travels. (It lights the row up, and nothing else.)
    expect(grant).toContain('fadeHeld(1)');
    expect(grant).not.toContain('cbRef.current(');
  });

  it('ignores every move of a gesture that missed the handle', () => {
    expect(move).toContain('if (!takeHold(e.nativeEvent.locationX)) return;');
    // …and the miss is only decided once, so a drag that started ON the
    // handle keeps it however far off the track it wanders.
    expect(SRC).toContain('if (grabsRef.current === null) {');
  });

  it('fires nothing on release when nothing was grabbed', () => {
    expect(SRC).toContain('const gave = abandonedRef.current || !grabsRef.current;');
  });

  it('drags from where the handle was held, so the value never jumps', () => {
    // Grab the handle's left rim and it stays under that rim: the touch's
    // offset from the handle's centre is kept for the whole gesture.
    expect(SRC).toContain('grabOffsetRef.current = x - (dragRef.current * (TRACK_W - HANDLE) + HANDLE / 2)');
    expect(SRC).toContain('x - grabOffsetRef.current, TRACK_W, HANDLE, dragRef.current');
  });

  it('still eats the touch it ignores', () => {
    // The rows sit over the artwork: letting a miss fall through would put a
    // brush dab under the control the finger was reaching for.
    expect(SRC).toContain(
      'onStartShouldSetPanResponder: (_e, g) => isSingleTouchGesture(g.numberActiveTouches)',
    );
  });

  it('starts every gesture undecided', () => {
    // Left over from the last drag, a stale `true` would let a tap move the
    // value again — the exact bug this rule exists to kill.
    expect(grant).toContain('grabsRef.current = null;');
    expect(SRC).toMatch(/const letGo = \(\) => \{[\s\S]*?grabsRef\.current = null;/);
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
