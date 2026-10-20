import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Image, PanResponder, Pressable, Text, View, useWindowDimensions } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { RGBColor } from '@/engine/types';
import { isPatternTileDoubleTap } from '@/editor-ui/logic/patternEdit';
import { CAPSULE_BG, PUSHDOWN_INACTIVE, STATE_ACTIVE } from '@/editor-ui/theme';
import { rgbToHex } from '@/engine/colorConvert';
import { CAPSULE_SWIPE_CLAIM_PX, capsuleSwipeDirection } from '../capsuleSwipe';
import {
  TOOL_MODE_SEGMENT_ART_SIZE,
  TOOL_MODE_SEGMENT_PAD_H,
  toolModeCapsuleAvailablePx,
  toolModeCapsuleLayout,
} from '../floatingCapsuleSize';
import {
  FLOATING_CAPSULE_BG,
  FLOATING_CAPSULE_DIVIDER,
  FLOATING_CAPSULE_FONT_SIZE,
  FLOATING_CAPSULE_HEIGHT,
  FLOATING_CAPSULE_INK,
  FLOATING_CAPSULE_INK_MUTED,
  FLOATING_CAPSULE_MUTED_BG,
} from './floatingCapsuleStyle';

// A tool group's MODE picker as a floating capsule under the toolbar — the
// rig sides pill's exact chrome (shared constants, so the floating capsules
// cannot drift apart), replacing the old pushdown strip that slid out of
// the toolbar's bottom edge. RADIO semantics: the current mode fills, a tap
// picks (re-tapping the current one is a no-op — a mode is a state, not an
// action). Segments size to their words: the content group's five ride
// beside the shape tool's four, and a fixed half-width would truncate
// "Rectangle" while padding "Arc".
//
// A segment can carry a COLOR (the paint radial's swatch capsule: the
// color floods the whole segment, and the armed one wears a heavy black
// outline drawn INSIDE its edges so the capsule's silhouette never moves),
// a data-URI (the tile Choose capsule: the tile's own art, posed by
// `rotate`) or a GLYPH (that same capsule's Random arm, which stands
// first in a row of tiles: a word there was the only segment that had to
// be read rather than seen) instead of its word — the label then serves
// accessibility alone. And a capsule that REPLACES another in the same
// slot (a radial menu's second level taking the tool group's place) mounts
// with `bounce`: a small overshoot spring that draws the eye to where the
// choices just landed.
//
// A segment can also answer a DOUBLE TAP and a LONG PRESS (`onDoubleTap`,
// `onLongPress`), the pose gestures the Tiles takeover's grid carries: on
// the tile Choose capsule a second tap inside the double-tap window turns
// the tile a quarter clockwise and a long press opens its transform card,
// exactly as in the full-screen tile chooser. The first tap of a double
// still picks (the capsule's own rule — a tap is a selection); only the
// second is routed away, and the same timing window the chooser's grid
// reads (isPatternTileDoubleTap) decides which it is. A capsule without
// the handlers picks on every press as before.
//
// A capsule can also be SWIPED sideways (`onSwipe`): the under-toolbar
// slot holds one menu at a time and several are often eligible (the armed
// tool's, an open radial's second level, a host's own — each app's
// topCapsuleSlot is the arbitration; capsuleSwipe.ts the reading of the
// drag), so a horizontal drag across the row asks for the next one in
// line without touching the toolbar. `canCycle` says there IS
// another to go to, and flanks the row with a ‹ and a › that step it
// without a swipe — the gesture was the only way to reach a menu that had
// been kicked out of the slot, and nothing on screen said it was there.
// They are drawn only while a second menu is eligible: a pair of arrows
// pointing at the capsule they already stand in would be chrome that does
// nothing. The row follows the finger,
// damped, and on release either the shell swaps the menu in (the incoming
// capsule mounts with `bounce`) or the row springs back where it was. The
// gesture is claimed on MOVE, never on a press's start, so a tap on a
// segment is still a pick; a drag more vertical than horizontal is left
// to whatever is under it.
//
// A segment can be MUTED (`muted`, its ink and wash floatingCapsuleStyle's):
// drawn greyed and still tappable, so a tap can say why rather than do
// nothing (DrawBot's Inklings row, where a bot not on offer says so;
// DrawBot's design_system.md §4). A greyed segment that REFUSES the press
// is PatternActionsCapsule's, the momentary pill's rule.
// A muted segment that is also the CURRENT one keeps the lit ground — it
// is the mode in force whatever its availability — and only its content
// greys.
//
// `leading` floats a companion control just OFF the capsule's left edge
// (the colour group's picker disc) without joining its layout: the capsule
// stays exactly centered — the companion hangs from its edge rather than
// widening the row it is centered in. `leadingInline` seats the companion
// IN the row instead (the rig's Left | Right pill): the pair centers as
// one group, pill's left edge to capsule's right — hanging that wide a
// control off a centered capsule's edge pushed it off narrow screens.
//
// A capsule too wide for the window first TIGHTENS (DrawBot bug 2f925f36:
// the owner wants the Inklings on one line): its segments' side padding
// comes down until the one row fits, as far as a floor. Only past that
// floor does it WRAP (DrawBot bug d2307b58: a row of nine glyphs ran off
// both edges of a phone held upright): its segments split into the fewest
// balanced rows that fit, stacked in the same pill under a hairline, each
// row stretched to the widest so the pill stays a clean rounded block.
// Both decisions are floatingCapsuleSize's toolModeCapsuleLayout.

/** The full side padding — what the swatch width below is reckoned from;
 *  a tightened row wears less (toolModeCapsuleLayout's padH). */
const SEGMENT_PAD_H = TOOL_MODE_SEGMENT_PAD_H;
/** The swatch disc / tile art inside a non-word segment. */
const SEGMENT_ART_SIZE = TOOL_MODE_SEGMENT_ART_SIZE;
/** The padlock on a LOCKED muted segment, and how far its box is inset
 *  from the segment's top-right corner. Small — it is a badge on the
 *  segment's own glyph, which has to stay the thing that says WHICH thing
 *  the segment is (a padlock in place of the glyph hid that; DrawBot
 *  Phase 10b). */
const LOCK_BADGE_SIZE = 12;
const LOCK_BADGE_INSET = 2;
/** A color-flooded segment has no content to size it. Six swatches (plus
 *  their extra divider) stand exactly where five disc-in-padding segments
 *  stood — purple joined the row, and the capsule keeps its width by
 *  narrowing every swatch rather than growing; the More segment beside
 *  them is a word and keeps its own size. */
const SWATCH_SEGMENT_WIDTH = (5 * (SEGMENT_PAD_H * 2 + SEGMENT_ART_SIZE) - 1) / 6;
/** How much of the finger's sideways travel the row follows mid-swipe: a
 *  hint that the drag is being read, not a carry — the row is not going
 *  anywhere, its replacement is coming in. */
const SWIPE_FOLLOW = 0.4;
/** Where a swiped-in capsule starts its settle: a hair under full size. */
const SUBTLE_BOUNCE_FROM = 0.94;

// ── The cycle arrows ───────────────────────────────────────

/** The triangle itself, drawn at the capsule's own scale: tall enough to
 *  read beside the row, narrow enough that the pair does not crowd it. */
const ARROW_W = 12;
const ARROW_H = 17;
/** The press target around it — a bare triangle is a thumb-width short of
 *  one, and these sit at the edge of the row where a thumb arrives. */
const ARROW_HIT = 34;
/** Between the triangle's box and the capsule's edge. */
const ARROW_GAP = 6;
/** The outline's weight, in the triangle's own viewBox units. */
const ARROW_STROKE = 2;

/**
 * One cycle arrow: a SOLID triangle in the capsule's own ground under a
 * grey rim — the capsule's rim, so the pair reads as the same piece of
 * floating chrome rather than as two new controls.
 *
 * An inline `<svg>`, like the toolbar's own shape glyphs (ToolIcons): a
 * triangle with an outline is what a path does in one line and what the
 * bordered-View trick cannot do at all, and the editor is a DOM tree —
 * the native app hosts it in a WebView, so no React Native renderer ever
 * sees this.
 */
function CycleArrow({ dir, onPress }: { dir: 1 | -1; onPress: () => void }) {
  const half = ARROW_STROKE / 2;
  const tip = dir === 1 ? ARROW_W - half : half;
  const back = dir === 1 ? half : ARROW_W - half;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={dir === 1 ? 'Next menu' : 'Previous menu'}
      onPress={onPress}
      style={{
        width: ARROW_HIT,
        height: ARROW_HIT,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width={ARROW_W} height={ARROW_H} viewBox={`0 0 ${ARROW_W} ${ARROW_H}`}>
        <path
          d={`M${back} ${half} L${tip} ${ARROW_H / 2} L${back} ${ARROW_H - half} Z`}
          fill={FLOATING_CAPSULE_BG}
          stroke={FLOATING_CAPSULE_INK}
          strokeWidth={ARROW_STROKE}
          strokeLinejoin="round"
        />
      </svg>
    </Pressable>
  );
}

/** The under-toolbar capsule slot's layer — shared by everything that
 *  stands in it (the selected pattern's Tile | Repeat pill, EditorShell). */
export const TOOL_MODE_CAPSULE_Z = 120;

export interface ToolModeCapsuleOption<K extends string> {
  key: K;
  label: string;
  /** A swatch segment: the disc filled with this color stands in for the
   *  word. */
  color?: RGBColor;
  /** An image segment: this art (a tile's own thumbnail) stands in for the
   *  word, turned by `rotate` degrees. */
  uri?: string;
  /** What the segment draws while LIT instead of `uri`: the lit ground is
   *  the accent blue, so art inked for the capsule's light ground (the
   *  tile capsule's active-color bake) gets a white bake there. */
  activeUri?: string;
  rotate?: number;
  /** A GLYPH segment: this MaterialCommunityIcons mark stands in for the
   *  word, in the same ink the word would have worn. Outranked by `color`
   *  and `uri`, which are the segment's whole face. */
  icon?: string;
  /** A DRAWN segment: this element (DrawBot's Inklings row — a bot's own
   *  look, in its pen colour) stands in for the word, at the art's size.
   *  Outranks `uri` and `icon`; `color` outranks it. */
  art?: React.ReactNode;
  /** GREYED, and still tappable. The segment is offered but a pick will
   *  be refused with a notice (DrawBot: a bot not on offer right now) —
   *  see the module header. Not to be confused with the capsule-wide
   *  `mutedKey`, which is the LIT segment that means "off". */
  muted?: boolean;
  /** This muted segment is greyed because it is LOCKED, not because it is
   *  busy — it wears a small padlock (DrawBot, owner decision G). Ignored
   *  unless `muted`. */
  locked?: boolean;
}

export function ToolModeCapsule<K extends string>({
  top, options, current, onPick, onDoubleTap, onLongPress, mutedKey, bounce, leading, leadingInline,
  onSwipe, canCycle,
}: {
  /** Screen px the capsule's top edge sits at — under the toolbar. */
  top: number;
  options: readonly ToolModeCapsuleOption<K>[];
  /** The lit segment; null lights none (no mode in force). */
  current: K | null;
  onPick: (key: K) => void;
  /** A second tap on the same segment within the double-tap window lands
   *  here INSTEAD of a second pick (the tile capsule's quarter turn). */
  onDoubleTap?: (key: K) => void;
  /** A long press on a segment (the tile capsule's transform card). */
  onLongPress?: (key: K) => void;
  /** The segment that means "off" (the symmetry capsule's None): lit, it
   *  wears grey rather than the selection blue — a lit-blue segment would
   *  claim a feature is ON when the pick turned it off. */
  mutedKey?: K;
  /** Bounce on mount — set on a capsule that replaces another in its slot,
   *  so the swap is seen. Re-key the element to bounce again. `subtle` is
   *  the swipe's version: the finger just dragged the row over, so the
   *  swap is already seen, and the incoming capsule only settles — a
   *  small scale-up with no overshoot to speak of. */
  bounce?: boolean | 'subtle';
  /** A control floated just off the capsule's LEFT edge, outside its
   *  layout, so the capsule itself stays centered. */
  leading?: React.ReactNode;
  /** Seat `leading` IN the centered row instead: the pair centers as one
   *  group, its left edge to the capsule's right. For a leading control
   *  wide enough that hanging it off the edge would leave the screen. */
  leadingInline?: boolean;
  /** A sideways swipe across the row: 1 for a swipe left (the next menu in
   *  the slot's cycle), -1 for a swipe right (the previous). Absent, the
   *  row takes no drag. */
  onSwipe?: (dir: 1 | -1) => void;
  /** Is there a SECOND menu eligible for the slot — somewhere for a swipe
   *  to go? True flanks the row with the two arrows, which call `onSwipe`
   *  with the direction they point. False draws neither: the swipe would
   *  spring back, and an arrow that does nothing is worse than none. */
  canCycle?: boolean;
}) {
  const scale = useRef(new Animated.Value(
    bounce === 'subtle' ? SUBTLE_BOUNCE_FROM : bounce ? 0.5 : 1,
  )).current;
  // How far the row is dragged sideways mid-swipe — the finger's travel,
  // damped — sprung back to 0 on release.
  const dragX = useRef(new Animated.Value(0)).current;
  // The latest handler, so the responder (built once) never calls a stale
  // closure's onSwipe.
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;
  const swipeable = !!onSwipe;
  /** The arrows' handler — the swipe's, with somewhere to go. Null draws
   *  neither arrow: the slot holds the only menu that is eligible. */
  const cycler = canCycle && onSwipe ? onSwipe : null;
  const pan = useMemo(() => {
    if (!swipeable) return null;
    const settle = () => {
      Animated.spring(dragX, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 18 }).start();
    };
    return PanResponder.create({
      // MOVE, never start: a press on a segment belongs to the segment.
      // More horizontal than vertical, so a vertical drag that began on
      // the row is not read as a swipe.
      onMoveShouldSetPanResponder: (_e, g) => (
        Math.abs(g.dx) > CAPSULE_SWIPE_CLAIM_PX && Math.abs(g.dx) > Math.abs(g.dy)
      ),
      onPanResponderMove: (_e, g) => { dragX.setValue(g.dx * SWIPE_FOLLOW); },
      onPanResponderRelease: (_e, g) => {
        const dir = capsuleSwipeDirection(g.dx, g.vx);
        if (dir !== null) onSwipeRef.current?.(dir);
        // Spring back either way: a committed swipe unmounts this capsule
        // as its replacement comes in, and one with nothing to swipe to
        // (the shell's neighbour lookup finding no one) settles in place.
        settle();
      },
      onPanResponderTerminate: settle,
    });
  }, [swipeable, dragX]);
  // The last segment tapped and when — the double-tap arm, the Tiles
  // takeover's own (lastTapRef there).
  const lastTapRef = useRef<{ id: string; time: number }>({ id: '', time: 0 });
  const press = (key: K) => {
    if (!onDoubleTap) {
      onPick(key);
      return;
    }
    const now = Date.now();
    if (isPatternTileDoubleTap(lastTapRef.current, key, now)) {
      onDoubleTap(key);
      lastTapRef.current = { id: '', time: 0 };
    } else {
      onPick(key);
      lastTapRef.current = { id: key, time: now };
    }
  };
  // How the segments lay out: one row, tightened if it must be, unless
  // even tight the row would leave the window — then rows. Estimated from
  // the options, so it is settled before layout — and once per change of
  // the options, the window or the arrows, not per render: the shell
  // re-renders on every session change, and the estimate is a pass over
  // the row each time.
  const { width: windowW } = useWindowDimensions();
  const withArrows = !!cycler;
  const { padH: segmentPadH, rowCounts } = useMemo(() => toolModeCapsuleLayout(
    options.map((o) => ({
      label: o.label,
      art: !!(o.uri || o.icon || o.art),
      fixedWidth: o.color ? SWATCH_SEGMENT_WIDTH : undefined,
    })),
    FLOATING_CAPSULE_FONT_SIZE,
    toolModeCapsuleAvailablePx(windowW, withArrows),
  ), [options, windowW, withArrows]);
  const wrapped = rowCounts.length > 1;
  useEffect(() => {
    if (!bounce) return undefined;
    const anim = Animated.spring(scale, {
      toValue: 1,
      // Low friction = a visible overshoot past 1 and back — the bounce.
      // The subtle one is damped nearly critically: it eases up to size
      // and stops there.
      friction: bounce === 'subtle' ? 9 : 4,
      tension: 220,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [bounce, scale]);
  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, right: 0, top, alignItems: 'center', zIndex: TOOL_MODE_CAPSULE_Z }}
    >
      {/* The arrows flank the centred content, one each side, and are the
          same width — so the capsule stays exactly where it was centred
          with them up and with them gone. */}
      <View pointerEvents="box-none" style={{ flexDirection: 'row', alignItems: 'center' }}>
        {cycler ? <CycleArrow dir={-1} onPress={() => cycler(-1)} /> : null}
        {/* This wrapper is what the outer view centers. By default it is
            exactly the capsule's size and `leading` hangs off its left edge
            as an absolute child (right: '100%'), never widening the centered
            content; leadingInline seats the companion in the wrapper's own
            row, so the PAIR is what gets centered. */}
        <Animated.View
          // A swipeable row is its own touch target so the responder can
          // claim a drag that started on any of it (the gap beside an inline
          // companion included); it is exactly the capsule's size otherwise,
          // so nothing under it is covered either way.
          pointerEvents={swipeable ? 'auto' : 'box-none'}
          {...(pan ? pan.panHandlers : {})}
          style={[
            leadingInline ? { flexDirection: 'row', alignItems: 'center' } : null,
            cycler ? { marginHorizontal: ARROW_GAP } : null,
            swipeable ? { transform: [{ translateX: dragX }] } : null,
          ]}
        >
          {leading ? (
            <View
              pointerEvents="box-none"
              style={leadingInline ? { marginRight: 10 } : {
                position: 'absolute',
                right: '100%',
                marginRight: 10,
                top: 0,
                bottom: 0,
                justifyContent: 'center',
              }}
            >
              {leading}
            </View>
          ) : null}
          <Animated.View
            style={{
              flexDirection: wrapped ? 'column' : 'row',
              borderRadius: FLOATING_CAPSULE_HEIGHT / 2,
              overflow: 'hidden',
              backgroundColor: FLOATING_CAPSULE_BG,
              borderWidth: 2,
              borderColor: FLOATING_CAPSULE_INK,
              transform: [{ scale }],
            }}
          >
          {(() => {
          const segment = (
            { key, label, color, uri, activeUri, rotate, icon, art, muted, locked }: ToolModeCapsuleOption<K>,
            i: number,
          ) => {
            const on = key === current;
            // A muted segment's content greys, and its ground takes a
            // wash — unless it is the segment in force, which
            // keeps its lit ground (the mode IS this one). The ink is
            // what both the word and the glyph read.
            const ink = on ? CAPSULE_BG : muted ? FLOATING_CAPSULE_INK_MUTED : FLOATING_CAPSULE_INK;
            return (
              <React.Fragment key={key}>
                {i > 0 ? <View style={{ width: 1, backgroundColor: FLOATING_CAPSULE_DIVIDER }} /> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  // A muted segment is offered, not disabled: it still
                  // takes the tap that raises the notice. `busy` says so
                  // to a reader without telling it the button is inert.
                  accessibilityState={{ selected: on, ...(muted ? { busy: true } : {}) }}
                  onPress={() => press(key)}
                  onLongPress={onLongPress ? () => onLongPress(key) : undefined}
                  style={{
                    paddingHorizontal: segmentPadH,
                    ...(color ? { width: SWATCH_SEGMENT_WIDTH } : {}),
                    // Wrapped, a shorter row stretches to the widest.
                    ...(wrapped ? { flexGrow: 1 } : {}),
                    height: FLOATING_CAPSULE_HEIGHT,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: color
                      ? rgbToHex(color.r, color.g, color.b)
                      : on
                        ? (key === mutedKey ? PUSHDOWN_INACTIVE : STATE_ACTIVE)
                        : muted
                          ? FLOATING_CAPSULE_MUTED_BG
                          : 'transparent',
                  }}
                >
                  {color ? (
                    // The color floods the segment and IS the whole button —
                    // no armed marker on top (the old inside outline read as
                    // a bug when the auto-picked default lit a swatch the
                    // user never chose). accessibilityState still carries
                    // the selection for readers.
                    null
                  ) : art ? (
                    // The host's own art, painted once by its own element.
                    <View style={{ width: SEGMENT_ART_SIZE, height: SEGMENT_ART_SIZE }}>{art}</View>
                  ) : uri ? (
                    // A tile's own art, posed by its rotation — the lit
                    // segment's bake when it has one.
                    <Image
                      source={{ uri: on && activeUri ? activeUri : uri }}
                      style={{
                        width: SEGMENT_ART_SIZE,
                        height: SEGMENT_ART_SIZE,
                        ...(rotate ? { transform: [{ rotate: `${rotate}deg` }] } : {}),
                      }}
                    />
                  ) : icon ? (
                    // The word's own ink and the art's own size: the glyph
                    // takes the place of the word without taking a size of
                    // its own, so a row of tiles and a glyph stand level.
                    <MaterialCommunityIcons
                      name={icon as never}
                      size={SEGMENT_ART_SIZE}
                      color={ink}
                    />
                  ) : (
                    <Text
                      style={{
                        color: ink,
                        fontSize: FLOATING_CAPSULE_FONT_SIZE,
                        fontWeight: '600',
                      }}
                    >
                      {label}
                    </Text>
                  )}
                  {/* The padlock on a segment greyed because it is LOCKED
                      (DrawBot decision G). A badge in the corner over the
                      segment's own glyph, pointer-inert so the tap
                      it sits on still reaches the segment, and in the
                      chrome's FULL ink — the greying says "not now", the
                      padlock says why, and a padlock as pale as what it
                      is explaining would say neither. */}
                  {muted && locked ? (
                    <MaterialCommunityIcons
                      name={'lock' as never}
                      size={LOCK_BADGE_SIZE}
                      color={FLOATING_CAPSULE_INK}
                      pointerEvents="none"
                      style={{
                        position: 'absolute',
                        top: LOCK_BADGE_INSET,
                        right: LOCK_BADGE_INSET,
                      }}
                    />
                  ) : null}
                </Pressable>
              </React.Fragment>
            );
          };
          if (!wrapped) return options.map((o, i) => segment(o, i));
          let at = 0;
          return rowCounts.map((count, r) => {
            const row = options.slice(at, at + count);
            at += count;
            return (
              <React.Fragment key={`row-${r}`}>
                {r > 0 ? <View style={{ height: 1, backgroundColor: FLOATING_CAPSULE_DIVIDER }} /> : null}
                <View style={{ flexDirection: 'row' }}>
                  {row.map((o, i) => segment(o, i))}
                </View>
              </React.Fragment>
            );
          });
          })()}
          </Animated.View>
        </Animated.View>
        {cycler ? <CycleArrow dir={1} onPress={() => cycler(1)} /> : null}
      </View>
    </View>
  );
}
