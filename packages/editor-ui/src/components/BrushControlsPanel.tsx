import React, { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import type { BrushControlsModel } from '../adapter';
import { CAPSULE_SIZE, MODAL_TEXT, PANEL_ANIM_MS, WHITE_25 } from '../theme';
import { brushDotSize, brushSliderValueFromX } from '../logic/slider';

// Floating brush controls (Procreate Pocket's size slider as the model): a
// stack of two identical sliders — SIZE over STRENGTH — each a single round
// handle riding a bottom-center track. The handle is a capsule button's twin
// (CAPSULE_SIZE round, dark outline) but with a translucent grey fill and a
// white dot inside whose diameter IS the value readout: it grows as the
// handle moves right. At rest only the handles show; grabbing one fades in
// that row's track pill AND its name, so the control stays out of the
// artwork's way while idle and says what it is the moment you touch it.
//
// The panel swaps places with the object-properties panel (the host hides
// that panel whenever this one is up), so it enters the way panels leave:
// sliding up from below — but on a spring, for the small arrival bounce that
// says "new control", not "same panel back".

const HANDLE = CAPSULE_SIZE;
const TRACK_W = 260;
/** Dot diameter range: pinprick → flush with the handle's inner edge
 *  (HANDLE minus the 2px outline each side, minus a hair of breathing room). */
const DOT_MIN = 6;
const DOT_MAX = HANDLE - 10;
const ROW_GAP = 8;
const BOTTOM_MARGIN = 20;
/**
 * How far the whole stack sits BELOW the panel margin: exactly one row, so
 * the top slider takes the spot the single slider used to hold and the
 * bottom one drops past it. On a phone that puts the lower handle over the
 * home-indicator strip, which is deliberate — the controls are meant to sit
 * at the very bottom edge, out of the artwork's way. Floored at the window
 * edge below, so a device with no bottom inset can't push it off-screen.
 */
const ROW_DROP = HANDLE + ROW_GAP;
/** Inset of a row's name from the left end of its track. */
const LABEL_INSET = 16;
/** Fully clears bottom margin + both rows + any home-indicator inset. */
const HIDDEN_Y = HANDLE * 2 + ROW_GAP + BOTTOM_MARGIN + 80;

/** One slider: ground pill, name, and the handle whose dot reads the value.
 *  Both rows are the same control — only the label and the value it carries
 *  differ. */
function BrushSliderRow({ label, value, onChange }: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  // The ground pill and the row's name: in while held, out on release. One
  // driver for both — the name is part of "you are adjusting THIS".
  const heldFade = useRef(new Animated.Value(0)).current;
  const fadeHeld = (toValue: number) => {
    Animated.timing(heldFade, { toValue, duration: PANEL_ANIM_MS, useNativeDriver: true }).start();
  };

  // The gesture keeps its own value (not the prop) for the same two
  // react-native-web reasons as the Slider — see its dragRef comment.
  const dragRef = useRef(value);
  const draggingRef = useRef(false);
  if (!draggingRef.current) dragRef.current = value;
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  const track = (x: number) => {
    dragRef.current = brushSliderValueFromX(x, TRACK_W, HANDLE, dragRef.current);
    return dragRef.current;
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        draggingRef.current = true;
        fadeHeld(1);
        cbRef.current(track(e.nativeEvent.locationX));
      },
      onPanResponderMove: (e) => cbRef.current(track(e.nativeEvent.locationX)),
      onPanResponderRelease: () => {
        draggingRef.current = false;
        fadeHeld(0);
        cbRef.current(dragRef.current);
      },
      onPanResponderTerminate: () => {
        draggingRef.current = false;
        fadeHeld(0);
        cbRef.current(dragRef.current);
      },
    }),
  ).current;

  const v = Math.max(0, Math.min(1, value));
  const dot = brushDotSize(v, DOT_MIN, DOT_MAX);
  return (
    <View style={styles.row} {...pan.panHandlers}>
      <Animated.View style={[styles.ground, { opacity: heldFade }]} />
      {/* Inside the track, left-justified over its dark ground — it appears
          with that ground and reads as part of the control rather than as a
          caption floating on the artwork beside it. The handle passes over
          it at the low end of the range, which is the cost of putting it
          where the pill is. */}
      <Animated.Text style={[styles.label, { opacity: heldFade }]} pointerEvents="none">
        {label}
      </Animated.Text>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={`Brush ${label.toLowerCase()}`}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}
        style={[styles.handle, { left: v * (TRACK_W - HANDLE) }]}
      >
        <View style={[styles.dot, { width: dot, height: dot, borderRadius: dot / 2 }]} />
      </View>
    </View>
  );
}

export function BrushControlsPanel({ model, safeBottom = 0 }: {
  model: BrushControlsModel;
  /** Bottom safe-area inset (home indicator), same contract as the
   *  object-properties panel it stands in for. */
  safeBottom?: number;
}) {
  const [mounted, setMounted] = useState(model.visible);
  const rise = useRef(new Animated.Value(model.visible ? 0 : HIDDEN_Y)).current;
  useEffect(() => {
    let anim: Animated.CompositeAnimation;
    if (model.visible) {
      setMounted(true);
      // Spring in with a small overshoot; plain timing out (a dismissal
      // bouncing on its way off would read as reluctance).
      anim = Animated.spring(rise, {
        toValue: 0, bounciness: 9, speed: 16, useNativeDriver: true,
      });
      anim.start();
    } else {
      anim = Animated.timing(rise, {
        toValue: HIDDEN_Y, duration: PANEL_ANIM_MS, useNativeDriver: true,
      });
      anim.start(({ finished }) => { if (finished) setMounted(false); });
    }
    return () => anim.stop();
  }, [model.visible, rise]);

  if (!mounted) return null;
  return (
    <View
      style={[styles.wrap, { bottom: Math.max(0, safeBottom + BOTTOM_MARGIN - ROW_DROP) }]}
      pointerEvents="box-none"
    >
      <Animated.View style={{ transform: [{ translateY: rise }] }}>
        <BrushSliderRow label="Size" value={model.size} onChange={model.onSize} />
        <View style={{ height: ROW_GAP }} />
        <BrushSliderRow label="Strength" value={model.strength} onChange={model.onStrength} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    // Over the object-properties panel (200): the two cross during the swap
    // animation, and the incoming control rides above the outgoing one.
    zIndex: 205,
  },
  row: {
    width: TRACK_W,
    height: HANDLE,
    justifyContent: 'center',
  },
  ground: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: HANDLE / 2,
    backgroundColor: 'rgba(17, 17, 17, 0.45)',
    borderWidth: 1,
    borderColor: WHITE_25,
  },
  label: {
    position: 'absolute',
    left: LABEL_INSET,
    color: MODAL_TEXT,
    fontSize: 13,
    fontWeight: '600',
    // The ground behind it is translucent, so the name keeps a little
    // contrast of its own for the times it lands over bright artwork.
    textShadowColor: 'rgba(0, 0, 0, 0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  handle: {
    position: 'absolute',
    width: HANDLE,
    height: HANDLE,
    borderRadius: HANDLE / 2,
    borderWidth: 2,
    borderColor: 'rgba(0, 0, 0, 0.6)',
    backgroundColor: 'rgba(128, 128, 128, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    backgroundColor: '#ffffff',
  },
});
