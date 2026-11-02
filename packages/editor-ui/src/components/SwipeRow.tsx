import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, PanResponder, Platform, Pressable, StyleSheet, Text, View,
  type ViewStyle,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { cancelCrossTouchMoves, claims, landing, peekReveal, rowBleed } from '../logic/swipeRow';

/**
 * A list line you can drag LEFT to uncover its actions, the way every
 * messaging app's chat list works. Lifted from CozyJournal's
 * components/SwipeRow.tsx (its group lines: leave or delete a group, stop
 * sharing with a friend, without opening either), so every Underway app
 * swipes a line the same way; DrawBots' Pen Motion step uncovers a ✕
 * that deletes a pen motion. The line itself is untouched: it slides, and
 * the buttons come in behind its trailing edge.
 *
 * Built on PanResponder and Animated rather than a gesture library,
 * because the apps have no native gesture dependency and one row's
 * translation is not worth a prebuild. The drag is therefore JS-driven —
 * but the events it follows arrive on the JS thread anyway, only one row
 * is ever moving, and nothing above it re-renders: the list is not told
 * that a row is open, so no cell is rebuilt by the gesture.
 *
 * Four things the responder negotiation has to get right, each of which
 * was wrong once:
 *
 *  · The line's own Pressable takes the responder the moment a finger
 *    lands, so the row has to TAKE IT BACK on the capture pass. Without
 *    that the drag reached the row only by accident.
 *  · The list is a scroll view, and a scroll view asks for the responder
 *    the moment it sees movement. Granting it aborted the drag mid-swipe,
 *    which read as the row snapping shut under the finger — so the
 *    request is refused for the length of the gesture.
 *  · A termination that does happen anyway settles on the DRAG, exactly
 *    as a release does, rather than throwing it away.
 *  · Refusing to hand the responder back is still not enough to hold the
 *    list still: a native scroll view recognises its pan OUTSIDE the JS
 *    responder system, so it went on following the finger's vertical
 *    component through the whole swipe. On a phone only
 *    `scrollEnabled={false}` stops it, so the row reports the grab and
 *    the release through `onGrab` and its list locks its own scrolling
 *    for exactly that span (`useSwipeScrollLock`). In a BROWSER (a web
 *    build, or DrawBots' WebView) the row needs no help: a touch whose
 *    first move goes mostly across (`swipeAxis`) has its moves cancelled,
 *    so the page does not scroll under the swipe; one whose first move
 *    goes up or down scrolls as ever.
 *
 * Only ONE row stands open at a time, like the chat lists this borrows
 * from: opening a second closes the first, through a module-level handle
 * on whichever is out.
 *
 * A row INSET BY A MARGIN — the chat lists this came from run the screen's
 * full width, but DrawBots' pen motion cards sit in a page's side padding
 * — is clipped at its own box, so the line's end was cut a margin short of
 * the screen and the buttons arrived a margin in from it, with a strip of
 * page beyond each (DrawBots, report 66c56514). {@link bleed} is that
 * margin, handed down by the screen that knows it: the row then reaches
 * over it (a negative margin, the padding given back inside so the line
 * stays where it was), the line slides off the PAGE's edge and the buttons
 * come in from the page's edge. They stay ONE shape doing it: the line
 * travels a bleed LESS than the buttons' block, which starts that bleed
 * further out, so open, the line's trailing edge and the block's leading
 * edge meet exactly — the block slides by its own whole width over the
 * line's `travel`, which is the one thing here that moves at its own rate.
 * The drag area grows with the row: the pan handlers sit on the view the
 * bleed's padding is on, so the margin either side of the line is the
 * row's to swipe too, which is what it now is.
 *
 * A row can PEEK over its bleed instead ({@link peek}; DrawBots' pen
 * motion cards, where an empty margin beside a square edge read as a
 * gap): the block then starts at the line's own end and rides the line
 * exactly, so at rest its first button's colour runs from the line to
 * the page's edge, its icon hidden until the line slides
 * (`peekReveal`). Open, the two still meet, and the block still ends on
 * the page's edge.
 *
 * The buttons are a GROUP WITH THE LINE, not a block bolted to it:
 * `endCorner` rounds the outer edge of the last one the way the line's own
 * corners are rounded, and `onOpen` tells the owner the once that the
 * buttons are showing, so the line can square the edge they come out of
 * (DrawBots' pen motion cards, report e93f7e2c). One call an opening and
 * one a closing — never per move, so the list the note above is about is
 * still not rebuilt by the gesture.
 *
 * And the row has to argue with the way OUT OF THE PAGE as well as with
 * the list. On the WEB a sideways drag that reaches the end of a scroller
 * chains into the browser's own history gesture, so a row dragged back to
 * the right navigated away; {@link SWIPE_ROW_SURFACE} tells the browser
 * the sideways axis is the row's and that the overscroll stops here. On a
 * PHONE it is iOS 26's full-screen back gesture, which is UIKit's and
 * outside the JS responder system altogether — a page carrying these rows
 * keeps the edge gesture alone (CozyJournal: `SWIPE_BACK_FROM_EDGE`).
 */

/**
 * What the row's own surface says to the BROWSER: it may pan this
 * element vertically and nothing else, so a sideways drag is left for the
 * row's responder to take; a horizontal overscroll stops here rather than
 * chaining up into the back gesture; and a drag across a line of words
 * selects nothing on the way, which on a mouse is what it otherwise does.
 *
 * Not a React Native style, so it is web-only and null on a phone — where
 * the same argument is had with UIKit instead (see the note above).
 */
const SWIPE_ROW_SURFACE: ViewStyle | null = Platform.OS === 'web'
  ? ({ touchAction: 'pan-y', overscrollBehaviorX: 'contain', userSelect: 'none' } as unknown as ViewStyle)
  : null;

/** One action's width, by default. The buttons sit flush, filling the
 *  line's height, so the row's travel is exactly the sum of them and
 *  nothing peeps out at rest. */
export const SWIPE_ACTION_WIDTH = 84;

export interface SwipeAction {
  key: string;
  /** Under the icon, and what the button is read out as. */
  label: string;
  /** MaterialCommunityIcons name. */
  icon: string;
  /** The button's own fill. */
  color: string;
  onPress: () => void;
}

/** Whichever row is open, so opening another closes it. */
let openRow: (() => void) | null = null;

/**
 * The list's half of the scroll-lock bargain on a phone, in one place:
 * `onGrab` for every row on the list, and `scrollEnabled` for the list
 * itself. True for exactly as long as a finger is dragging one line
 * sideways, which is when the list must hold still.
 */
export function useSwipeScrollLock(): { onGrab: (held: boolean) => void; scrollEnabled: boolean } {
  const [swiping, setSwiping] = useState(false);
  return { onGrab: setSwiping, scrollEnabled: !swiping };
}

export function SwipeRow({ actions, children, onGrab, onOpen, actionWidth = SWIPE_ACTION_WIDTH, labelFont, iconOnly = false, endCorner, bleed = 0, peek = false }: {
  /** Left to right as they come in, so the LAST is the one at the screen's
   *  edge — the first thing the thumb reaches, and by that convention the
   *  heaviest. Empty means the line does not move. */
  actions: readonly SwipeAction[];
  children: React.ReactNode;
  /** Called with true the moment this row takes the finger and false when
   *  it lets go (or the gesture is taken away, or the row goes off the
   *  list mid-drag) — the owning list stops scrolling in between, or its
   *  own pan slides the whole list under the swipe. */
  onGrab?: (held: boolean) => void;
  /** Each button's width (`SWIPE_ACTION_WIDTH` by default). */
  actionWidth?: number;
  /** The labels' font family: the app's own. */
  labelFont?: string;
  /** The buttons show their icon alone, the label read out only. */
  iconOnly?: boolean;
  /** Called with true the moment the buttons START SHOWING — the drag
   *  that claims the row, or another row's opening — and false as the row
   *  settles shut again. ONE call an opening, one a closing: never per
   *  move, so a line that wants to change shape while its buttons are out
   *  (DrawBots' pen motion cards square their right corners against them)
   *  costs a render a gesture, not a render a frame. */
  onOpen?: (open: boolean) => void;
  /** The right corners of the LAST button — the one at the row's edge —
   *  so an open row reads as one shape with the line it came out of
   *  rather than a square block bolted to it. Square with none. */
  endCorner?: { top: number; bottom: number };
  /** The margin the page sets this row in from its own edge (the note
   *  above): the row reaches over it, so the line slides off the page's
   *  edge instead of being cut at its margin and the buttons come in
   *  from the page's edge. None (the default) for a row that already
   *  runs the page's full width, which has nothing to reach over. */
  bleed?: number;
  /** Over a bleed, the first button's colour fills it at rest, from the
   *  line's end to the page's edge, its icon hidden until the line
   *  slides (the note above). Nothing without a bleed to fill. */
  peek?: boolean;
}) {
  const width = actions.length * actionWidth;
  /** The bleed actually taken (`rowBleed`): none where the buttons are
   *  no wider than it, which would leave the line nowhere to travel. */
  const side = rowBleed(width, bleed);
  /** What the LINE travels, which is what the gesture and `at` are in:
   *  the buttons' block less the bleed, so its trailing edge comes to
   *  rest exactly on the block's leading edge (which began a bleed
   *  further out, off the page's edge). */
  const travel = width - side;
  const x = useRef(new Animated.Value(0)).current;
  /** Where the line is RESTING — 0 shut, -travel open. The live drag is
   *  this plus the gesture's dx, which is what every decision reads. */
  const at = useRef(0);
  const travelRef = useRef(travel);
  travelRef.current = travel;
  // Read through a ref because the responder below is built once and would
  // otherwise hold the first render's callback for ever. `held` keeps the
  // two edges paired: one true per gesture, one false to close it, however
  // the gesture ends.
  const onGrabRef = useRef(onGrab);
  onGrabRef.current = onGrab;
  const held = useRef(false);
  const grab = useCallback((now: boolean) => {
    if (held.current === now) return;
    held.current = now;
    onGrabRef.current?.(now);
  }, []);
  // Whether the buttons are showing at all, told to the owner the once
  // either way (`onOpen`): the same idempotent pair as `grab`, so a drag
  // that wanders reports nothing twice.
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const out = useRef(false);
  const show = useCallback((now: boolean) => {
    if (out.current === now) return;
    out.current = now;
    onOpenRef.current?.(now);
  }, []);

  const settle = useCallback((to: number) => {
    // The list scrolls again from the moment the finger is off it: the
    // spring that follows is the row's own and moves nothing else.
    grab(false);
    show(to !== 0);
    at.current = to;
    if (to === 0 && openRow !== null) openRow = null;
    Animated.spring(x, {
      toValue: to,
      useNativeDriver: Platform.OS !== 'web',
      bounciness: 0,
      speed: 18,
    }).start();
  }, [x, grab, show]);

  const close = useCallback(() => settle(0), [settle]);

  // A row scrolled away, or a line that left the list under an open
  // swipe, must not leave the module's handle pointing at a gone row.
  // …and must not leave the list locked either, if the row goes while a
  // finger is still on it.
  useEffect(() => () => {
    if (openRow !== null && at.current !== 0) openRow = null;
    if (held.current) { held.current = false; onGrabRef.current?.(false); }
    // Nothing is told a gone row's shape: the owner's state goes with it.
    out.current = false;
  }, []);

  // In a browser, a touch whose first move goes mostly across is the
  // row's to its end: its moves are cancelled so the page does not scroll
  // under the swipe (`cancelCrossTouchMoves`). And the click a browser
  // sends as a swipe (or the tap that shuts an open row) lets go is
  // swallowed before it reaches the line: react-native-web presses on
  // the click, so the line's own Pressable would otherwise open whatever
  // it leads to under the swipe (DrawBots, report 71cfc245: a mouse drag
  // opened the card's sheet). `swiped` is set as the row takes the
  // gesture and cleared as the next pointer goes down.
  const wrapRef = useRef<View | null>(null);
  const swiped = useRef(false);
  useEffect(() => {
    const el = wrapRef.current as unknown as HTMLElement | null;
    if (Platform.OS !== 'web' || !el || typeof el.addEventListener !== 'function' || width === 0) return undefined;
    const uncancel = cancelCrossTouchMoves(el);
    const down = () => { swiped.current = false; };
    const click = (e: Event) => {
      if (!swiped.current) return;
      swiped.current = false;
      e.stopPropagation();
      e.preventDefault();
    };
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('click', click, true);
    return () => {
      uncancel();
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('click', click, true);
    };
  }, [width]);

  // The BUTTONS' own slide: their whole block's width over the line's
  // travel, so over a bleed they come in from the page's edge a touch
  // ahead of the line and land flush against it (the note at the top).
  // With no bleed the two are the same value and the block rides the
  // line's translation exactly, as it always did.
  // A peeking row's block starts at the line's end instead, so it rides
  // the line exactly too, its first `side` showing at rest (`peek`).
  const peeking = peek && side > 0;
  const slide = useMemo(
    () => (side === 0 || peeking ? x : x.interpolate({ inputRange: [-travel, 0], outputRange: [-width, 0] })),
    [x, side, peeking, travel, width],
  );
  // …and its first icon fades in as the line uncovers the rest of it.
  const peekIcon = useMemo(
    () => (peeking ? x.interpolate({ inputRange: [-peekReveal(actionWidth, side), 0], outputRange: [1, 0], extrapolate: 'clamp' }) : null),
    [x, peeking, actionWidth, side],
  );

  const pan = useRef(PanResponder.create({
    // A finger landing on an OPEN row is closing it, not opening whatever
    // the line leads to — so that one touch is taken at the start, and
    // every other is left to the line underneath.
    onStartShouldSetPanResponderCapture: () => at.current !== 0,
    onStartShouldSetPanResponder: () => false,
    // Both passes, and the CAPTURE one is the load-bearing half: the
    // line's own Pressable is already the responder by the time a finger
    // moves, and a bubbling handler never gets asked.
    onMoveShouldSetPanResponderCapture: (_e, g) => claims(g.dx, g.dy, at.current, travelRef.current),
    onMoveShouldSetPanResponder: (_e, g) => claims(g.dx, g.dy, at.current, travelRef.current),
    // The list would otherwise take the gesture back the moment it saw it
    // move, which aborted the swipe halfway and sprang the row shut.
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: () => {
      swiped.current = true;
      if (openRow !== null && at.current === 0) openRow();
      openRow = () => settle(0);
    },
    onPanResponderMove: (_e, g) => {
      // The list holds still from the first movement that is actually
      // this row's — the same test that claims the gesture, asked again
      // because an OPEN row is granted the responder on touch-down, and a
      // finger that lands on one and then drags UP is still scrolling the
      // list. `grab` is idempotent, so a drag that wanders back towards
      // vertical does not let go of the lock mid-swipe.
      if (claims(g.dx, g.dy, at.current, travelRef.current)) { grab(true); show(true); }
      // Clamped at both ends: the line never pulls past its buttons, and
      // never swings right of where it started.
      x.setValue(Math.max(-travelRef.current, Math.min(0, at.current + g.dx)));
    },
    onPanResponderRelease: (_e, g) => settle(landing(g.dx, g.vx, at.current, travelRef.current)),
    // Settled on the drag, not thrown away: a termination we could not
    // refuse still happened at a place the finger chose.
    onPanResponderTerminate: (_e, g) => settle(landing(g.dx, g.vx, at.current, travelRef.current)),
  })).current;

  return (
    // Over the page's margin either side, where the page gives it one
    // (`bleed`): the clip is the PAGE's edges, so the line slides off
    // them rather than being cut short of them, and the buttons wait
    // off the page's own right edge. The padding inside puts the line
    // back exactly where it was.
    <View ref={wrapRef} style={[styles.wrap, SWIPE_ROW_SURFACE, side ? { marginHorizontal: -side } : null]}>
      {/* The buttons sit just OFF the right edge and ride in behind the
          line, rather than waiting underneath it: a line opaque enough to
          hide them would be a flat band over the ground behind it. Their
          block is exactly as wide as the line's travel and the bleed
          together, and `wrap` clips it, so at rest they are nowhere at
          all. Drawn BEFORE the line so that a shadow or a press state on
          the line stays over them. */}
      {actions.length > 0 && (
        <Animated.View
          style={[styles.actions, { width, right: peeking ? -travel : -width, transform: [{ translateX: slide }] }]}
        >
          {actions.map((action) => (
            <Pressable
              key={action.key}
              onPress={() => { close(); action.onPress(); }}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              style={({ pressed }) => [
                styles.action,
                { width: actionWidth, backgroundColor: action.color },
                // The row's outer edge, rounded as the line it came out
                // of is, so the group is one shape (`endCorner`).
                endCorner && action === actions[actions.length - 1]
                  ? { borderTopRightRadius: endCorner.top, borderBottomRightRadius: endCorner.bottom }
                  : null,
                pressed && styles.actionPressed,
              ]}
            >
              <Animated.View style={[styles.actionFace, peekIcon && action === actions[0] ? { opacity: peekIcon } : null]}>
                <MaterialCommunityIcons name={action.icon as never} size={iconOnly ? 26 : 20} color="#FFFFFF" />
                {iconOnly ? null : (
                  <Text style={[styles.actionLabel, labelFont ? { fontFamily: labelFont } : null]} numberOfLines={2}>{action.label}</Text>
                )}
              </Animated.View>
            </Pressable>
          ))}
        </Animated.View>
      )}
      <Animated.View
        style={[side ? { paddingHorizontal: side } : null, { transform: [{ translateX: x }] }]}
        {...pan.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    // Clips the buttons while they are still off the right edge, and the
    // line's left end once it has been dragged past it — at the PAGE's
    // edges where the row is given its margin to reach over (`bleed`).
    overflow: 'hidden',
  },
  actions: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    flexDirection: 'row',
  },
  // Flush and full-height, with NO margin or gap: the block has to measure
  // exactly `actions.length * actionWidth`, or the difference overflows
  // its left edge and shows as a sliver of colour on every line at rest.
  action: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 6,
  },
  // The icon and its label, one piece so a peeking row fades both.
  actionFace: {
    alignItems: 'center',
    gap: 4,
  },
  actionPressed: {
    opacity: 0.8,
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
  },
});
