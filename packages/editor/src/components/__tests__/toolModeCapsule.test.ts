/**
 * The under-toolbar MODE capsule (ToolModeCapsule.tsx) — the pill every
 * tool group's modes float in: the content group's Image | Text | …, the
 * line group's Freehand | Line | Arc, the colour group's Paint | Erase |
 * Blur | Push, the shape tool's Circle | Triangle | Rectangle | More, and
 * a host's own rows. Source pins — there is no renderer here; what the
 * shell does with the capsule is pinned in each app's tree.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { TOOL_MODE_ARROW_SPAN } from '../../floatingCapsuleSize';

const CAPSULE = readFileSync(resolve(__dirname, '..', 'ToolModeCapsule.tsx'), 'utf8');

describe('ToolModeCapsule wears the floating-capsule chrome', () => {
  test('shares floatingCapsuleStyle’s constants so the pills cannot drift', () => {
    expect(CAPSULE).toContain("} from './floatingCapsuleStyle';");
    expect(CAPSULE).toContain('backgroundColor: FLOATING_CAPSULE_BG,');
    expect(CAPSULE).toContain('borderColor: FLOATING_CAPSULE_INK,');
    expect(CAPSULE).toContain('borderRadius: FLOATING_CAPSULE_HEIGHT / 2,');
    // Radio semantics: the current segment fills with the selection accent —
    // except a mutedKey segment (a symmetry capsule's None), which fills
    // grey: lit blue would claim a feature is on when the pick turned it off.
    expect(CAPSULE).toContain("? (key === mutedKey ? PUSHDOWN_INACTIVE : STATE_ACTIVE)");
    expect(CAPSULE).toContain(": 'transparent',");
  });

  test('imports nothing of any app: the engine, editor-ui and this package alone', () => {
    const imports = [...CAPSULE.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    for (const from of imports) {
      expect(from).toMatch(/^(react|react-native|@expo\/|@\/engine\/|@\/editor-ui|\.\.?\/)/);
    }
    // A swatch segment's flood is the engine's own hex conversion.
    expect(CAPSULE).toContain("import { rgbToHex } from '@/engine/colorConvert';");
    expect(CAPSULE).toContain('? rgbToHex(color.r, color.g, color.b)');
  });
});

describe('a segment’s face: a word, a colour, a tile’s art, a drawn element — or a glyph', () => {
  test('a glyph segment draws its mark in the word’s ink, at the art’s size', () => {
    expect(CAPSULE).toContain("import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';");
    expect(CAPSULE).toContain('name={icon as never}');
    expect(CAPSULE).toContain('size={SEGMENT_ART_SIZE}');
    // The word's ink is a value — the lit ink, the muted one, or the
    // chrome's — and the glyph and the word read the same one.
    expect(CAPSULE).toContain(
      'const ink = on ? CAPSULE_BG : muted ? FLOATING_CAPSULE_INK_MUTED : FLOATING_CAPSULE_INK;',
    );
    expect(CAPSULE).toContain('color={ink}');
  });

  test('a colour, then art, then a drawn element, then a glyph outrank the word', () => {
    // The order in the segment's ternary IS the precedence. From the
    // segment's face to the close of the segment's OWN Pressable (the
    // cycle arrows are Pressables too, and they are declared above).
    const faceAt = CAPSULE.indexOf('{color ? (');
    const face = CAPSULE.slice(faceAt, CAPSULE.indexOf('</Pressable>', faceAt));
    expect(face.indexOf(') : art ? (')).toBeLessThan(face.indexOf('<Image'));
    expect(face.indexOf('<Image')).toBeLessThan(face.indexOf('<MaterialCommunityIcons'));
    expect(face.indexOf('<MaterialCommunityIcons')).toBeLessThan(face.indexOf('<Text'));
    // The label rides on regardless — it is what a screen reader says.
    expect(CAPSULE).toContain('accessibilityLabel={label}');
    expect(CAPSULE).toContain('art?: React.ReactNode;');
  });
});

describe('a muted segment is greyed and still tappable', () => {
  test('its ink and its ground both grey, and the lit segment keeps its own', () => {
    // The ground's ternary: a colour segment, then the lit one, then a
    // muted wash, then nothing. So a segment that is BOTH current and
    // muted keeps its lit ground — it is the mode in force.
    expect(CAPSULE).toContain('? FLOATING_CAPSULE_MUTED_BG');
    const groundAt = CAPSULE.indexOf('backgroundColor: color');
    const ground = CAPSULE.slice(groundAt, CAPSULE.indexOf("'transparent',", groundAt));
    expect(ground.indexOf('PUSHDOWN_INACTIVE : STATE_ACTIVE'))
      .toBeLessThan(ground.indexOf('FLOATING_CAPSULE_MUTED_BG'));
  });

  test('nothing makes it inert: no disabled, and the press still goes to onPick', () => {
    expect(CAPSULE).toContain('onPress={() => press(key)}');
    // `busy`, not `disabled`: a reader must not be told the segment will
    // not answer, because it does.
    expect(CAPSULE).toContain("accessibilityState={{ selected: on, ...(muted ? { busy: true } : {}) }}");
    expect(CAPSULE).not.toContain('disabled={muted}');
    expect(CAPSULE).not.toContain("pointerEvents={muted ? 'none'");
  });

  test('a LOCKED muted segment wears a padlock over its own glyph, pointer-inert', () => {
    expect(CAPSULE).toContain('{muted && locked ? (');
    expect(CAPSULE).toContain("name={'lock' as never}");
    expect(CAPSULE).toContain('size={LOCK_BADGE_SIZE}');
    expect(CAPSULE).toContain('pointerEvents="none"');
    // In the chrome's full ink, not the muted one: the greying says "not
    // now" and the padlock says why.
    const lockAt = CAPSULE.indexOf('{muted && locked ? (');
    expect(CAPSULE.slice(lockAt, lockAt + 400)).toContain('color={FLOATING_CAPSULE_INK}');
    // A badge, not a replacement: the segment's own glyph still says
    // which thing the segment is.
    expect(lockAt).toBeGreaterThan(CAPSULE.indexOf('name={icon as never}'));
  });

  test('both flags are the option’s', () => {
    expect(CAPSULE).toContain('muted?: boolean;');
    expect(CAPSULE).toContain('locked?: boolean;');
    expect(CAPSULE).toContain('{ key, label, color, uri, activeUri, rotate, icon, art, muted, locked }: ToolModeCapsuleOption<K>,');
  });
});

describe('a row that would not fit tightens, then wraps', () => {
  test('measures against the window and splits its options into rows', () => {
    expect(CAPSULE).toContain('const { width: windowW } = useWindowDimensions();');
    expect(CAPSULE).toContain('const { padH: segmentPadH, rowCounts } = useMemo(() => toolModeCapsuleLayout(');
    expect(CAPSULE).toContain('toolModeCapsuleAvailablePx(windowW, withArrows)');
    expect(CAPSULE).toContain('paddingHorizontal: segmentPadH,');
    expect(CAPSULE).toContain("flexDirection: wrapped ? 'column' : 'row',");
    // Wrapped, a shorter row stretches to the widest, under a hairline.
    expect(CAPSULE).toContain('...(wrapped ? { flexGrow: 1 } : {}),');
    expect(CAPSULE).toContain("{r > 0 ? <View style={{ height: 1, backgroundColor: FLOATING_CAPSULE_DIVIDER }} /> : null}");
  });

  test('the layout is estimated once per change of the row, not per render', () => {
    // The shell re-renders on every session change; the estimate is a
    // pass over the options, so it is memoized on what it reads.
    expect(CAPSULE).toContain('const { padH: segmentPadH, rowCounts } = useMemo(() => toolModeCapsuleLayout(');
    expect(CAPSULE).toContain('), [options, windowW, withArrows]);');
  });

  test('shares the segment metrics the split estimates with', () => {
    expect(CAPSULE).toContain('const SEGMENT_PAD_H = TOOL_MODE_SEGMENT_PAD_H;');
    expect(CAPSULE).toContain('const SEGMENT_ART_SIZE = TOOL_MODE_SEGMENT_ART_SIZE;');
  });

  test('the arrows the split makes room for are the arrows it draws', () => {
    const hit = Number(/const ARROW_HIT = (\d+);/.exec(CAPSULE)![1]);
    const gap = Number(/const ARROW_GAP = (\d+);/.exec(CAPSULE)![1]);
    expect(hit + gap).toBe(TOOL_MODE_ARROW_SPAN);
  });
});

describe('a companion control beside the capsule', () => {
  test('`leading` hangs off the left edge without widening the centred row; `leadingInline` seats it in the row', () => {
    // The capsule stays exactly centred with a companion hung off its edge
    // (the colour group's picker disc); a companion too wide for that
    // (CozyJournal's rig sides pill) rides inline, so the PAIR is centred.
    expect(CAPSULE).toContain('leading?: React.ReactNode;');
    expect(CAPSULE).toContain('leadingInline?: boolean;');
    expect(CAPSULE).toContain("leadingInline ? { flexDirection: 'row', alignItems: 'center' } : null,");
    expect(CAPSULE).toContain("style={leadingInline ? { marginRight: 10 } : {");
    expect(CAPSULE).toContain("right: '100%',");
  });
});

describe('a swipe across the row asks for the next menu in the slot', () => {
  test('the row is flanked by arrows that step the cycle without a swipe', () => {
    expect(CAPSULE).toContain('function CycleArrow({ dir, onPress }: { dir: 1 | -1; onPress: () => void }) {');
    // One handler for both: the arrows call the swipe with the direction
    // they point — › is the swipe left (the next menu comes in from the
    // right), ‹ its opposite — so there is no second way to cycle that
    // could answer differently from the first.
    expect(CAPSULE).toContain('{cycler ? <CycleArrow dir={-1} onPress={() => cycler(-1)} /> : null}');
    expect(CAPSULE).toContain('{cycler ? <CycleArrow dir={1} onPress={() => cycler(1)} /> : null}');
    expect(CAPSULE).toContain('const cycler = canCycle && onSwipe ? onSwipe : null;');
    // A SOLID triangle in the capsule's own ground under its own grey rim,
    // so the pair reads as the same floating chrome and not as two new
    // controls. An inline <svg>, the toolbar glyphs' own idiom.
    expect(CAPSULE).toContain('fill={FLOATING_CAPSULE_BG}');
    expect(CAPSULE).toContain('stroke={FLOATING_CAPSULE_INK}');
    expect(CAPSULE).toContain('strokeWidth={ARROW_STROKE}');
    expect(CAPSULE).toContain(
      'd={`M${back} ${half} L${tip} ${ARROW_H / 2} L${back} ${ARROW_H - half} Z`}',
    );
    // Both arrows are the same width, so the capsule stays exactly where
    // it was centred with them up and with them gone.
    expect(CAPSULE).toContain(
      "<View pointerEvents=\"box-none\" style={{ flexDirection: 'row', alignItems: 'center' }}>",
    );
    expect(CAPSULE).toContain('cycler ? { marginHorizontal: ARROW_GAP } : null,');
    expect(CAPSULE).toContain('width: ARROW_HIT,');
    expect(CAPSULE).toContain("accessibilityLabel={dir === 1 ? 'Next menu' : 'Previous menu'}");
    // …and none when there is nowhere to cycle to.
    expect(CAPSULE).toContain('canCycle?: boolean;');
  });

  test('the capsule reads the swipe on MOVE, sideways, and springs back', () => {
    // Claimed on move so a press is still a pick; more horizontal than
    // vertical; the row follows the finger damped, and the release
    // decides by the shared threshold (capsuleSwipe.ts).
    expect(CAPSULE).toContain("import { CAPSULE_SWIPE_CLAIM_PX, capsuleSwipeDirection } from '../capsuleSwipe';");
    expect(CAPSULE).toContain(
      'onMoveShouldSetPanResponder: (_e, g) => (\n'
      + '        Math.abs(g.dx) > CAPSULE_SWIPE_CLAIM_PX && Math.abs(g.dx) > Math.abs(g.dy)\n'
      + '      ),',
    );
    expect(CAPSULE).toContain('onPanResponderMove: (_e, g) => { dragX.setValue(g.dx * SWIPE_FOLLOW); },');
    expect(CAPSULE).toContain('const dir = capsuleSwipeDirection(g.dx, g.vx);');
    expect(CAPSULE).toContain('if (dir !== null) onSwipeRef.current?.(dir);');
    expect(CAPSULE).toContain('onPanResponderTerminate: settle,');
    // Only a swipeable row is its own touch target and carries the
    // handlers; a capsule without onSwipe is exactly as it was.
    expect(CAPSULE).toContain("pointerEvents={swipeable ? 'auto' : 'box-none'}");
    expect(CAPSULE).toContain('{...(pan ? pan.panHandlers : {})}');
    expect(CAPSULE).toContain('if (!swipeable) return null;');
  });

  test('a swiped-in capsule settles subtly; a raised one bounces', () => {
    expect(CAPSULE).toContain("bounce?: boolean | 'subtle';");
    expect(CAPSULE).toContain("bounce === 'subtle' ? SUBTLE_BOUNCE_FROM : bounce ? 0.5 : 1,");
    expect(CAPSULE).toContain("friction: bounce === 'subtle' ? 9 : 4,");
  });
});

describe('a segment answers a double tap and a long press', () => {
  test('the first tap picks, the second within the window is routed away, and a hold has its own handler', () => {
    expect(CAPSULE).toContain("import { isPatternTileDoubleTap } from '@/editor-ui/logic/patternEdit';");
    expect(CAPSULE).toContain('if (isPatternTileDoubleTap(lastTapRef.current, key, now)) {');
    expect(CAPSULE).toContain('onDoubleTap(key);');
    expect(CAPSULE).toContain('onLongPress={onLongPress ? () => onLongPress(key) : undefined}');
    // A capsule without the handlers picks on every press.
    expect(CAPSULE).toContain('if (!onDoubleTap) {\n      onPick(key);\n      return;\n    }');
  });
});
