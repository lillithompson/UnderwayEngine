import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { triggerHaptic } from '@/native-shell/bridge/webBridge';
import { CAPSULE_BG, CAPSULE_EDGE_MARGIN, STATE_ACTIVE } from '@/editor-ui/theme';
import { FLOATING_SLIDER_BOTTOM } from '@/editor-ui';
import { PatternGridAction, patternGridActionsFor } from '@/editor-ui/logic/patternEdit';
import { FLOATING_SEGMENT_GLYPH_WIDTH, FLOATING_SEGMENT_WIDTH } from '../floatingCapsuleSize';
import {
  FLOATING_CAPSULE_BG,
  FLOATING_CAPSULE_DIVIDER,
  FLOATING_CAPSULE_FONT_SIZE,
  FLOATING_CAPSULE_GLYPH_SIZE,
  FLOATING_CAPSULE_HEIGHT,
  FLOATING_CAPSULE_INK,
  FLOATING_CAPSULE_INK_MUTED,
  FLOATING_CAPSULE_MUTED_BG,
} from './floatingCapsuleStyle';

// The selected pattern's whole-grid actions — Flood, Close, Clear (a
// SHAPE's pattern fill offers Flood and Clear alone — patternGridActionsFor)
// — as a floating capsule in the slot the rig's Turn slider (and the
// brush's size row) floats in: above the properties panel, riding its height. Drawn in
// the rig sides capsule's exact chrome (shared constants — the canvas-ground
// background, the 60% ink rim, hairline dividers), so the floating pills read as one
// family; the difference is semantics — these are MOMENTARY actions, so a
// segment fills only while pressed and each press commits one undo entry
// through the shell's onPatternGridAction. Close is one of them again: one
// press reconciles the WHOLE grid. The per-cell brushes — Random, Erase,
// and the tap-sized Close — live in the lower-right RADIAL menu now
// (SliderModeTarget over TILE_RADIAL_MODES), so the brushes stand together
// in the corner and the whole-grid actions stand alone here.
//
// The segment list and labels come from the shared PATTERN_GRID_ACTIONS —
// the same list the pattern pushdown's Tools bar renders — so the capsule
// can never offer an action the pushdown doesn't, or name one differently.

/** Clearance between the capsule and whatever it floats above — the rig
 *  slider's own gap (RigControlsPanel.TURN_GAP). */
const GAP = 12;

/** Matches PANEL_ANIM_MS — the ride up and down keeps pace with the panel
 *  it stands on. Exported so everything sharing the slot rides at the
 *  same speed. */
export const FLOATING_SLOT_ANIM_MS = 180;

/** The floating slot's seat: above whatever the object-properties panel
 *  claims (`panelPx`, its onOccludedHeight report), never below the
 *  slider row's own bottom line. ONE formula for everything standing in
 *  the slot — this capsule, the rig's slider row, and the lower-right
 *  radial target — so they rise together and stay aligned when the panel
 *  pushes up. */
export function floatingSlotAnchor(panelPx: number, safeBottom: number): number {
  return Math.max(panelPx + GAP, safeBottom + FLOATING_SLIDER_BOTTOM);
}

/** A hugging segment's side margin around its word (hugLabel). */
const HUG_PAD = 14;

/** Which of the three widths a segment takes. A GLYPH-faced one takes
 *  FLOATING_SEGMENT_GLYPH_WIDTH (DrawBot's playback controls — play/stop,
 *  clear, reset — whose shapes need no word's room); a `hugLabels` one
 *  sizes to its own word; everything else shares the fixed word width so
 *  the multi-word capsules line up. */
function segmentWidthStyle(icon: boolean, hug: boolean) {
  if (icon) return styles.segmentGlyph;
  return hug ? styles.segmentHug : styles.segmentFixed;
}

/** The overshoot spring every bounce in this chrome wears — shrink to
 *  `from`, spring back past 1 and settle. The toolbar swatch and the mode
 *  capsules use the same numbers (friction 4, tension 220), so a press
 *  answered here and a capsule swapped up there move alike. */
function bounceSpring(scale: Animated.Value, from: number): Animated.CompositeAnimation {
  scale.setValue(from);
  return Animated.spring(scale, {
    toValue: 1,
    // Low friction = a visible overshoot past 1 and back — the bounce.
    friction: 4,
    tension: 220,
    useNativeDriver: true,
  });
}

/** One momentary segment. With `feedback`, a press is ANSWERED where the
 *  finger is: a tap of light haptic, and the word bounces (bounceSpring),
 *  so the whole-grid actions, which change the drawing a grid at a time
 *  with nothing lighting up to say so, are felt to land.
 *  The word bounces, not the segment: the pill clips its segments, so a
 *  scaled segment would tear at the dividers. */
function ActionSegment({ label, icon, muted, feedback, hug, onPress }: {
  label: string;
  /** A MaterialCommunityIcons name: the segment wears the GLYPH and keeps
   *  `label` as its accessibility name alone. DrawBot's transport pill is
   *  the one that asks — its controls are media-player shapes everywhere
   *  else on a phone, and a word there would be slower to read mid-run
   *  than the triangle. */
  icon?: string;
  /** Greyed, and the press refused: the segment holds its seat in the row
   *  but cannot be used right now (DrawBot's transport, bug 0504993e —
   *  the row keeps one layout in every state). */
  muted: boolean;
  feedback: boolean;
  /** Size the segment to its word plus a margin instead of the shared
   *  fixed width — the lone Edit pill, which has no siblings to line up
   *  with and would otherwise float a wide blank around one short word. */
  hug: boolean;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const anim = useRef<Animated.CompositeAnimation | null>(null);
  useEffect(() => () => anim.current?.stop(), []);
  const press = () => {
    if (feedback) {
      triggerHaptic('light');
      anim.current?.stop();
      anim.current = bounceSpring(scale, 0.6);
      anim.current.start();
    }
    onPress();
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: muted }}
      disabled={muted}
      onPress={press}
      style={({ pressed }) => [
        styles.segment,
        segmentWidthStyle(!!icon, hug),
        muted && styles.segmentMuted,
        pressed && styles.segmentPressed,
      ]}
    >
      {({ pressed }) => (
        // The glyph bounces exactly as the word does — same Animated
        // transform, so a press lands the same way whichever face the
        // segment wears.
        <Animated.View style={{ transform: [{ scale }] }}>
          {icon ? (
            <MaterialCommunityIcons
              name={icon as never}
              size={FLOATING_CAPSULE_GLYPH_SIZE}
              color={pressed ? CAPSULE_BG : muted ? FLOATING_CAPSULE_INK_MUTED : FLOATING_CAPSULE_INK}
            />
          ) : (
            <Animated.Text style={[styles.label, muted && styles.labelMuted, pressed && styles.labelPressed]}>
              {label}
            </Animated.Text>
          )}
        </Animated.View>
      )}
    </Pressable>
  );
}

/** One segment of a floating capsule: its action, its word, optionally a
 *  glyph to wear instead, and whether it is muted (greyed, press refused). */
export interface FloatingCapsuleAction<A extends string> {
  action: A;
  label: string;
  icon?: string;
  muted?: boolean;
}

/** The floating capsule itself, action list supplied — the one chrome every
 *  capsule of momentary actions in the floating slot wears. The tile tool's
 *  Flood | Close | Clear and the multi-selection's Group | Merge | Layout are
 *  both this component; only the words and the handler differ. */
export function FloatingActionsCapsule<A extends string>({
  safeBottom, panelPx, actions, onAction, visible = true, pressFeedback = false, align = 'center',
  hugLabels = false, bounceKey,
}: {
  safeBottom: number;
  /** Bottom-edge px the object-properties panel claims right now (its own
   *  onOccludedHeight report) — the capsule rides above it, exactly as the
   *  rig's Turn slider does. */
  panelPx: number;
  /** Each segment's face: its `label` as a word, or — with `icon`, a
   *  MaterialCommunityIcons name — that glyph, the word staying on as the
   *  accessibility name (DrawBot's transport). */
  actions: readonly FloatingCapsuleAction<A>[];
  onAction: (action: A) => void;
   /** False fades the capsule out (and back in), untouchable meanwhile —
   *  the selection Edit capsule's rule while the Edit sheet stands: it
   *  DISAPPEARS rather than riding the sheet's height, so the lift freezes
   *  where it was while hidden. Default true: the always-on capsules
   *  (pattern grid actions, multi Layout) never pass it. */
  visible?: boolean;
  /** Answer each press with a light haptic and a bounce of the pressed
   *  word (ActionSegment) — the tile tool's Flood / Close / Clear, whose
   *  whole-grid edits land with nothing else lighting up to say so. */
  pressFeedback?: boolean;
  /** Where in the slot the pill stands: centered (the default — the grid
   *  actions, the multi-selection's, Replace), or at the RIGHT edge, in
   *  the lower-right radial target's seat (the Edit capsule, which stands
   *  in for that target). */
  align?: 'center' | 'right';
  /** Segments hug their words (ActionSegment.hug) instead of sharing the
   *  fixed width the multi-word capsules line up on. */
  hugLabels?: boolean;
  /** Bounce the WHOLE pill — on arrival, and again on every new value
   *  while it stands. It marks a capsule that is the answer to a gesture
   *  made somewhere else on the screen: a double tap on a pattern opens
   *  its grid, and these actions are what the next touch reaches for, so
   *  the bounce belongs down here rather than on the toolbar the finger
   *  never went near. Left off, the capsule arrives still. */
  bounceKey?: number;
}) {
  const anchor = floatingSlotAnchor(panelPx, safeBottom);
  const lift = useRef(new Animated.Value(-anchor)).current;
  useEffect(() => {
    // Hidden, the capsule holds its seat: fading out while sliding up
    // would be the very push-up the visibility rule exists to avoid.
    if (!visible) return undefined;
    const anim = Animated.timing(lift, {
      toValue: -anchor,
      duration: FLOATING_SLOT_ANIM_MS,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [anchor, lift, visible]);
  // The pill's own bounce (bounceSpring, the pressed word's spring). The
  // last-key ref starts EMPTY rather than at the current key, so a capsule
  // that mounts already carrying one bounces as it arrives — which is the
  // usual case: the gesture that asks for the bounce is the same one that
  // brings the capsule up.
  const pop = useRef(new Animated.Value(1)).current;
  const popAnim = useRef<Animated.CompositeAnimation | null>(null);
  const poppedKey = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (bounceKey === undefined || bounceKey === poppedKey.current) return undefined;
    poppedKey.current = bounceKey;
    popAnim.current?.stop();
    popAnim.current = bounceSpring(pop, 0.6);
    popAnim.current.start();
    return () => popAnim.current?.stop();
  }, [bounceKey, pop]);

  const fade = useRef(new Animated.Value(visible ? 1 : 0)).current;
  useEffect(() => {
    const anim = Animated.timing(fade, {
      toValue: visible ? 1 : 0,
      duration: FLOATING_SLOT_ANIM_MS,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [visible, fade]);

  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[
        styles.wrap,
        align === 'right' ? styles.wrapRight : null,
        { opacity: fade, transform: [{ translateY: lift }] },
      ]}
    >
      <Animated.View style={[styles.pill, { transform: [{ scale: pop }] }]}>
        {actions.map(({ action, label, icon, muted }, i) => (
          <React.Fragment key={action}>
            {i > 0 ? <View style={styles.divider} /> : null}
            <ActionSegment
              label={label}
              icon={icon}
              muted={!!muted}
              feedback={pressFeedback}
              hug={hugLabels}
              onPress={() => onAction(action)}
            />
          </React.Fragment>
        ))}
      </Animated.View>
    </Animated.View>
  );
}

/** The tile tool's whole-grid capsule: the shared PATTERN_GRID_ACTIONS on the
 *  generic pill, so the capsule can never offer an action the pattern
 *  pushdown's Tools bar doesn't, or name one differently. Every press is
 *  answered with a haptic and a bounce (pressFeedback): Flood, Close and
 *  Clear rewrite a whole grid at once, with no lit state to show it. */
export function PatternActionsCapsule({ safeBottom, panelPx, shapeFill, onAction, bounceKey }: {
  safeBottom: number;
  panelPx: number;
  /** The open grid is a SHAPE's pattern fill rather than a pattern object
   *  — which drops Close from the row (patternGridActionsFor). */
  shapeFill?: boolean;
  onAction: (action: PatternGridAction) => void;
  /** Bumped by the shell each time a grid opens for editing — the double
   *  tap that puts a pattern into edit mode bounces THESE, the actions
   *  that mode is for, and leaves the top of the screen still. */
  bounceKey?: number;
}) {
  return (
    <FloatingActionsCapsule
      safeBottom={safeBottom}
      panelPx={panelPx}
      actions={patternGridActionsFor(!!shapeFill)}
      onAction={onAction}
      pressFeedback
      bounceKey={bounceKey}
    />
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    // Seated on the bottom edge and lifted by a transform, like the rig
    // slider row — the ride runs on the compositor, not in layout.
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    // Above the object-properties panel it floats over (200), level with
    // the rig slider row that shares this slot.
    zIndex: 205,
  },
  // The radial target's own seat: flush to the right edge at its margin.
  wrapRight: { alignItems: 'flex-end', paddingRight: CAPSULE_EDGE_MARGIN },
  pill: {
    flexDirection: 'row',
    borderRadius: FLOATING_CAPSULE_HEIGHT / 2,
    overflow: 'hidden',
    backgroundColor: FLOATING_CAPSULE_BG,
    borderWidth: 2,
    borderColor: FLOATING_CAPSULE_INK,
  },
  segment: {
    height: FLOATING_CAPSULE_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  segmentFixed: { width: FLOATING_SEGMENT_WIDTH },
  segmentGlyph: { width: FLOATING_SEGMENT_GLYPH_WIDTH },
  segmentHug: { paddingHorizontal: HUG_PAD },
  segmentPressed: { backgroundColor: STATE_ACTIVE },
  // The ToolModeCapsule's greying (floatingCapsuleStyle's muted pair):
  // a wash over the ground, the ink faded to the divider's weight.
  segmentMuted: { backgroundColor: FLOATING_CAPSULE_MUTED_BG },
  divider: { width: 1, backgroundColor: FLOATING_CAPSULE_DIVIDER },
  label: {
    color: FLOATING_CAPSULE_INK,
    fontSize: FLOATING_CAPSULE_FONT_SIZE,
    fontWeight: '600',
  },
  labelMuted: { color: FLOATING_CAPSULE_INK_MUTED },
  labelPressed: { color: CAPSULE_BG },
});
