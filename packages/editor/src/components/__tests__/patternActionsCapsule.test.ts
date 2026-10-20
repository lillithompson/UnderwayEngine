/**
 * The floating ACTIONS pill (PatternActionsCapsule.tsx): the pattern grid's
 * Flood | Close | Clear, the multi-selection's Group | Merge | Layout |
 * Done, a host's own rows of momentary actions. Source pins — there is no
 * renderer here; what the shell mounts and when is pinned in each app.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PATTERN_GRID_ACTIONS, patternGridActionsFor } from '@/editor-ui/logic/patternEdit';

const CAPSULE = readFileSync(resolve(__dirname, '..', 'PatternActionsCapsule.tsx'), 'utf8');

describe('the pattern actions capsule', () => {
  test('holds a pattern OBJECT’s whole-grid actions — Flood, Close, Clear — off the shared list', () => {
    // The capsule takes the shared list through patternGridActionsFor and
    // hands it to the generic pill, so it can never offer an action the
    // pattern pushdown's Tools bar doesn't, or name one differently.
    expect(PATTERN_GRID_ACTIONS.map((a) => a.action)).toEqual(['flood', 'reconcile', 'clear']);
    expect(patternGridActionsFor(false)).toBe(PATTERN_GRID_ACTIONS);
    expect(patternGridActionsFor(true).map((a) => a.action)).toEqual(['flood', 'clear']);
    expect(CAPSULE).toContain('{actions.map(({ action, label, icon, muted }, i) => (');
    expect(CAPSULE).toContain('actions={patternGridActionsFor(!!shapeFill)}');
    expect(CAPSULE).not.toContain('onToggleReconcile');
  });

  test('wears the floating capsule chrome; the actions stay momentary', () => {
    expect(CAPSULE).toContain("} from './floatingCapsuleStyle';");
    expect(CAPSULE).toContain('FLOATING_CAPSULE_INK');
    expect(CAPSULE).toContain('FLOATING_CAPSULE_DIVIDER');
    expect(CAPSULE).toContain('backgroundColor: FLOATING_CAPSULE_BG');
    expect(CAPSULE).toContain('borderRadius: FLOATING_CAPSULE_HEIGHT / 2');
    expect(CAPSULE).toContain('pressed && styles.segmentPressed');
  });

  test('imports nothing of any app', () => {
    const imports = [...CAPSULE.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    for (const from of imports) {
      expect(from).toMatch(/^(react|react-native|@expo\/|@\/engine\/|@\/editor-ui|@\/native-shell\/|\.\.?\/)/);
    }
  });

  test('every press of Flood / Close / Clear is felt: a light haptic and a bounce of the face', () => {
    // The press is answered where the finger is: a tap of haptic through
    // the bridge, and the pressed face springs with the same overshoot the
    // toolbar swatch and the mode capsules share. The face, not the
    // segment — the pill clips its segments at the dividers. Opt-in per
    // capsule (pressFeedback). The spring rides the wrapper around the
    // face, so a GLYPH segment bounces by the same transform.
    expect(CAPSULE).toContain("import { triggerHaptic } from '@/native-shell/bridge/webBridge';");
    expect(CAPSULE).toContain('pressFeedback?: boolean;');
    expect(CAPSULE).toMatch(
      /if \(feedback\) \{\n\s*triggerHaptic\('light'\);\n\s*anim\.current\?\.stop\(\);\n\s*anim\.current = bounceSpring\(scale, 0\.6\);/,
    );
    // One spring for every bounce this chrome makes.
    expect(CAPSULE).toContain(
      'function bounceSpring(scale: Animated.Value, from: number): Animated.CompositeAnimation {',
    );
    expect(CAPSULE.match(/friction: 4,/g)).toHaveLength(1);
    expect(CAPSULE).toContain('tension: 220,');
    expect(CAPSULE).toContain('useNativeDriver: true,');
    expect(CAPSULE).toContain('<Animated.View style={{ transform: [{ scale }] }}>');
    expect(CAPSULE).toContain('<Animated.Text style={[styles.label, muted && styles.labelMuted, pressed && styles.labelPressed]}>');
    const tileCapsule = CAPSULE.slice(CAPSULE.indexOf('export function PatternActionsCapsule'));
    expect(tileCapsule).toContain('pressFeedback\n      bounceKey={bounceKey}\n    />');
    expect(CAPSULE).toContain('pressFeedback = false,');
  });

  test('a bounce key bounces the WHOLE pill, on arrival and on every new value', () => {
    expect(CAPSULE).toContain('bounceKey?: number;');
    expect(CAPSULE).toContain(
      '<Animated.View style={[styles.pill, { transform: [{ scale: pop }] }]}>',
    );
    expect(CAPSULE).toContain('popAnim.current = bounceSpring(pop, 0.6);');
    // The last-bounced key starts EMPTY, so a capsule that mounts already
    // carrying a key bounces as it arrives.
    expect(CAPSULE).toContain('const poppedKey = useRef<number | undefined>(undefined);');
    expect(CAPSULE).toContain(
      'if (bounceKey === undefined || bounceKey === poppedKey.current) return undefined;',
    );
  });

  test('floats in the bottom slot, riding the properties panel', () => {
    // Above whatever the panel claims, never below the brush's own bottom
    // line, lifted on the compositor. The formula is EXPORTED
    // (floatingSlotAnchor) so the radial target shares it exactly.
    expect(CAPSULE).toContain(
      'export function floatingSlotAnchor(panelPx: number, safeBottom: number): number {',
    );
    expect(CAPSULE).toContain(
      'return Math.max(panelPx + GAP, safeBottom + FLOATING_SLIDER_BOTTOM);',
    );
    expect(CAPSULE).toContain('const anchor = floatingSlotAnchor(panelPx, safeBottom);');
    expect(CAPSULE).toContain('duration: FLOATING_SLOT_ANIM_MS,');
    expect(CAPSULE).toContain('zIndex: 205,');
  });

  test('the generic pill: fixed or hugging words, centred or at the right edge, and a fade', () => {
    expect(CAPSULE).toContain('export function FloatingActionsCapsule<A extends string>(');
    expect(CAPSULE).toContain('segmentWidthStyle(!!icon, hug),');
    expect(CAPSULE).toContain('return hug ? styles.segmentHug : styles.segmentFixed;');
    expect(CAPSULE).toContain('segmentFixed: { width: FLOATING_SEGMENT_WIDTH },');
    expect(CAPSULE).toContain('segmentHug: { paddingHorizontal: HUG_PAD },');
    expect(CAPSULE).toContain("align === 'right' ? styles.wrapRight : null,");
    expect(CAPSULE).toContain("wrapRight: { alignItems: 'flex-end', paddingRight: CAPSULE_EDGE_MARGIN },");
    // `visible` fades the capsule out and back, untouchable meanwhile, and
    // holds its seat while hidden.
    expect(CAPSULE).toContain('toValue: visible ? 1 : 0,');
    expect(CAPSULE).toContain("pointerEvents={visible ? 'box-none' : 'none'}");
    expect(CAPSULE).toContain('if (!visible) return undefined;');
  });

  test('the width helper describes the pill the styles actually build', () => {
    // words + a hairline divider between each pair + the pill's 2pt border
    // (floatingCapsuleSize.floatingCapsuleWidthPx).
    expect(CAPSULE).toContain("import { FLOATING_SEGMENT_GLYPH_WIDTH, FLOATING_SEGMENT_WIDTH } from '../floatingCapsuleSize';");
    expect(CAPSULE).toContain("divider: { width: 1, backgroundColor: FLOATING_CAPSULE_DIVIDER },");
    expect(CAPSULE).toContain('borderWidth: 2,');
  });
});

describe('a segment can wear a glyph instead of its word', () => {
  test('the glyph is drawn when the action carries one, the word otherwise', () => {
    expect(CAPSULE).toContain('icon?: string;');
    expect(CAPSULE).toContain('{icon ? (');
    expect(CAPSULE).toContain('<MaterialCommunityIcons');
    expect(CAPSULE).toContain('name={icon as never}');
    // One glyph size for the whole floating chrome, not a copy per pill.
    expect(CAPSULE).toContain('size={FLOATING_CAPSULE_GLYPH_SIZE}');
  });

  test('the word stays on as the accessibility name', () => {
    expect(CAPSULE).toContain('accessibilityLabel={label}');
  });

  test('a glyph segment answers a press like a word one, at the glyph width', () => {
    expect(CAPSULE).toContain('color={pressed ? CAPSULE_BG : muted ? FLOATING_CAPSULE_INK_MUTED : FLOATING_CAPSULE_INK}');
    expect(CAPSULE).toContain('segmentGlyph: { width: FLOATING_SEGMENT_GLYPH_WIDTH },');
    expect(CAPSULE).toContain('function segmentWidthStyle(icon: boolean, hug: boolean) {');
    expect(CAPSULE).toContain('if (icon) return styles.segmentGlyph;');
    expect(CAPSULE).toContain('icon={icon}');
  });
});

describe('a muted segment holds its seat, greyed, and refuses the press', () => {
  test('the action carries `muted` down to its segment, which is disabled and says so', () => {
    expect(CAPSULE).toContain('muted?: boolean;');
    expect(CAPSULE).toContain('muted={!!muted}');
    expect(CAPSULE).toContain('disabled={muted}');
    expect(CAPSULE).toContain('accessibilityState={{ disabled: muted }}');
  });

  test('it wears the chrome’s one greying: the muted wash and the faded ink', () => {
    expect(CAPSULE).toContain('segmentMuted: { backgroundColor: FLOATING_CAPSULE_MUTED_BG },');
    expect(CAPSULE).toContain('labelMuted: { color: FLOATING_CAPSULE_INK_MUTED },');
    expect(CAPSULE).toContain('muted && styles.segmentMuted,');
  });
});
