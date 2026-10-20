import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { DimensionValue } from 'react-native';
import { PANEL_BG, PANEL_BORDER, PANEL_INK } from '@/editor-ui/theme';

// A toolbar submenu that POPS UP from the bottom, as high as its contents
// need and no higher — the shape the type-specific property pages take
// (editor-ui's EditSheet), for the choosers that used to take the whole
// screen.
//
// Shapes, Symmetry, Blend and the COLOUR picker are all chosen WHILE
// looking at the canvas: you reach for a triangle — or for a red — because
// of what is on the page, and a full-screen takeover answers that by
// hiding the page. A sheet that rises over the bottom of it leaves the
// drawing in view and puts the choice on the hand's own side of the
// screen.
//
// Two ways out, and neither is a button. Tapping anywhere off the sheet
// dismisses it — a menu goes away when you look elsewhere — and so does
// SWIPING IT DOWN, which is the gesture the grabber at its top has been
// promising all along. There is no Done: nothing here is being confirmed.
// (Where a sheet's dismissal does land something — the colour picker
// commits the colour it was showing — that is the sheet's own business;
// this chrome only says the reader is finished with it.)
//
// The swipe follows the finger and springs back if it was not far or fast
// enough, so a half-swipe reads as "not yet" rather than as nothing
// happening. What it must NOT do is steal a drag that belongs to the
// contents: the colour picker's wheel is dragged in every direction,
// downwards included. Two rules keep them apart — the swipe only claims a
// gesture that is more vertical than horizontal AND starts with the body
// scrolled to its top, and a control that owns a drag refuses to hand it
// over (`onResponderTerminationRequest`, which the wheel does).
//
// A DOM-free component: RN primitives only, because the editor renders
// this one through the RN-web renderer with the rest of the chrome.
//
// `background` / `headerForeground` / `headerBackground` exist for the
// colour picker, whose header IS the current colour: a background node
// (checkerboard + colour wash) painted behind the grabber and title, with
// the ink flipped black/white by luma. They are the same override hooks,
// under the same names, that the takeover chrome (editor-ui's AppModal)
// grew for the same customer — a sheet and a takeover styling one header
// two different ways is how the two drift.

/** The sheet's rounded top corners — the property pages' own radius, so
 *  the two read as the same kind of thing arriving. */
const RADIUS = 18;
/** How much of the screen a sheet may take before its body scrolls. It
 *  rises as high as it needs; past this the canvas has stopped being
 *  visible, which is the thing this shape exists to avoid. */
const MAX_HEIGHT = '72%';
/** How far down a drag must go before it is a DISMISS rather than the
 *  contents being touched. Under this the sheet springs back. */
const SWIPE_CLAIM = 12;
/** …and how far it must travel to let go at release. A shorter flick still
 *  counts if it was fast (SWIPE_VELOCITY) — the two together are what make
 *  both a long drag and a quick flick work. */
const SWIPE_DISMISS = 64;
const SWIPE_VELOCITY = 0.5;

export function ToolPopover({
  visible,
  title,
  onDismiss,
  bottomInset = 0,
  maxHeight = MAX_HEIGHT,
  background,
  headerForeground = PANEL_INK,
  headerBackground,
  children,
}: {
  visible: boolean;
  /** A heading over the contents, for a sheet that needs one: the colour
   *  picker, whose title IS the colour's hex. The grid menus (Blend,
   *  Shapes, Symmetry, Layout — ToolGridSheet) pass none: the capsule
   *  that opened them names them, and every cell is labelled, so the
   *  heading only spent canvas height. With none, the header is the
   *  grabber alone. */
  title?: string;
  onDismiss: () => void;
  /** Home-indicator clearance under the content; the host knows it. */
  bottomInset?: number;
  /** A taller ceiling than the menus' default, for a sheet whose content
   *  is a single block that cannot usefully scroll in halves (the colour
   *  wheel). Still a fraction of the screen: the canvas stays in view. */
  maxHeight?: DimensionValue;
  /** Sheet surface behind the body. Default is the light panel colour;
   *  the colour picker passes the dark modal grey, which its wheel and
   *  swatches read against. */
  background?: string;
  /** Ink for the title (e.g. luma-picked over a colour). The grabber
   *  takes it too, at a fraction, so it stays visible on a painted
   *  header. */
  headerForeground?: string;
  /** Node painted absolutely behind the grabber and title (e.g. a
   *  checkerboard under a translucent colour wash). Clipped to the
   *  sheet's rounded top corners. */
  headerBackground?: React.ReactNode;
  children: React.ReactNode;
}) {
  // How far the finger has carried the sheet down, and the spring that
  // takes it back when the swipe did not earn a dismiss.
  const dragY = useRef(new Animated.Value(0)).current;
  // The swipe only claims a gesture that starts with the body at its top;
  // below that a downward drag is the reader scrolling the menu back up.
  const atTopRef = useRef(true);
  // Read by the responder, which is built once — a prop captured in the
  // closure would be the one from the render that opened the sheet.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  // Back to rest on the way OPEN, before the frame is painted: the sheet
  // that was swiped away is still carrying the offset that dismissed it,
  // and re-opening in that position would show it half-gone for a frame.
  useEffect(() => {
    if (visible) { dragY.setValue(0); atTopRef.current = true; }
  }, [visible, dragY]);

  const springBack = useMemo(() => () => {
    Animated.spring(dragY, {
      toValue: 0,
      useNativeDriver: false,
      bounciness: 0,
      speed: 18,
    }).start();
  }, [dragY]);

  const pan = useMemo(() => PanResponder.create({
    // MOVE, never start: a tap on the sheet belongs to whatever was
    // tapped. More vertical than horizontal, so a slider's drag is never
    // read as a swipe, and only from the top of the scroll.
    onMoveShouldSetPanResponder: (_e, g) => (
      atTopRef.current && g.dy > SWIPE_CLAIM && g.dy > Math.abs(g.dx)
    ),
    onPanResponderMove: (_e, g) => { dragY.setValue(Math.max(0, g.dy)); },
    onPanResponderRelease: (_e, g) => {
      if (g.dy > SWIPE_DISMISS || g.vy > SWIPE_VELOCITY) dismissRef.current();
      else springBack();
    },
    onPanResponderTerminate: springBack,
  }), [dragY, springBack]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    atTopRef.current = e.nativeEvent.contentOffset.y <= 0;
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <View style={styles.root}>
        {/* Everything above the sheet dismisses it. Transparent rather
            than dimmed: the canvas underneath is the reason this is a
            sheet and not a takeover, so nothing is laid over it. */}
        <Pressable
          style={styles.backdrop}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        {/* The sheet follows the finger on a downward swipe. The transform
            is always present — never swapped in and out — so the node keeps
            one animated style for its whole life. */}
        <Animated.View
          style={[
            styles.sheet,
            { maxHeight },
            background ? { backgroundColor: background } : null,
            { transform: [{ translateY: dragY }] },
          ]}
          {...pan.panHandlers}
        >
          {/* The header block: its own row so `headerBackground` can be
              painted behind the grabber and title and nothing else. The
              sheet clips it to the rounded corners (overflow: hidden). */}
          <View style={styles.header}>
            {headerBackground}
            <View
              style={[
                styles.grabber,
                headerBackground ? { backgroundColor: headerForeground, opacity: 0.4 } : null,
              ]}
            />
            {title ? (
              <Text
                style={[styles.title, { color: headerForeground }]}
                accessibilityRole="header"
                numberOfLines={1}
              >
                {title}
              </Text>
            ) : null}
          </View>
          {/* Scrolls only when the contents outgrow `maxHeight`; a short
              menu sits at its own height with nothing to scroll. */}
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={16}
            contentContainerStyle={[styles.body, { paddingBottom: bottomInset + 16 }]}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    maxHeight: MAX_HEIGHT,
    backgroundColor: PANEL_BG,
    borderTopLeftRadius: RADIUS,
    borderTopRightRadius: RADIUS,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: PANEL_BORDER,
    // Clips a painted header to the rounded top corners.
    overflow: 'hidden',
  },
  header: {
    paddingTop: 8,
    paddingHorizontal: 12,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: PANEL_BORDER,
    marginBottom: 10,
  },
  title: {
    color: PANEL_INK,
    fontSize: 15,
    fontWeight: '700',
    paddingHorizontal: 4,
    paddingBottom: 10,
  },
  body: {
    alignItems: 'center',
    paddingHorizontal: 12,
  },
});
