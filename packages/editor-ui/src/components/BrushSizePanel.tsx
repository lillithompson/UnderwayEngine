import React, { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import type { BrushSizeModel } from '../adapter';
import { CAPSULE_SIZE, PANEL_ANIM_MS, WHITE_25 } from '../theme';
import { brushDotSize, brushSliderValueFromX } from '../logic/slider';

// Floating brush-size control (Procreate Pocket's size slider as the model):
// a single round handle riding a bottom-center track. The handle is a capsule
// button's twin — CAPSULE_SIZE round, dark outline — but with a translucent
// grey fill and a white dot inside whose diameter IS the value readout: it
// grows as the handle moves right. At rest only the handle shows; grabbing it
// fades the track's pill ground in behind it, and release fades it back out,
// so the control stays out of the artwork's way while idle.
//
// It swaps places with the object-properties panel (the host hides that panel
// whenever this one is up), so it enters the way panels leave: sliding up
// from below — but on a spring, for the small arrival bounce that says "new
// control", not "same panel back".

const HANDLE = CAPSULE_SIZE;
const TRACK_W = 260;
/** Dot diameter range: pinprick → flush with the handle's inner edge
 *  (HANDLE minus the 2px outline each side, minus a hair of breathing room). */
const DOT_MIN = 6;
const DOT_MAX = HANDLE - 10;
const BOTTOM_MARGIN = 20;
/** Fully clears bottom margin + handle + any home-indicator inset. */
const HIDDEN_Y = HANDLE + BOTTOM_MARGIN + 80;

export function BrushSizePanel({ model, safeBottom = 0 }: {
  model: BrushSizeModel;
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

  // The pill ground behind the handle: in while held, out on release.
  const groundFade = useRef(new Animated.Value(0)).current;
  const fadeGround = (toValue: number) => {
    Animated.timing(groundFade, { toValue, duration: PANEL_ANIM_MS, useNativeDriver: true }).start();
  };

  // The gesture keeps its own value (not the prop) for the same two
  // react-native-web reasons as the Slider — see its dragRef comment.
  const dragRef = useRef(model.value);
  const draggingRef = useRef(false);
  if (!draggingRef.current) dragRef.current = model.value;
  const cbRef = useRef(model.onChange);
  cbRef.current = model.onChange;

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
        fadeGround(1);
        cbRef.current(track(e.nativeEvent.locationX));
      },
      onPanResponderMove: (e) => cbRef.current(track(e.nativeEvent.locationX)),
      onPanResponderRelease: () => {
        draggingRef.current = false;
        fadeGround(0);
        cbRef.current(dragRef.current);
      },
      onPanResponderTerminate: () => {
        draggingRef.current = false;
        fadeGround(0);
        cbRef.current(dragRef.current);
      },
    }),
  ).current;

  if (!mounted) return null;
  const value = Math.max(0, Math.min(1, model.value));
  const dot = brushDotSize(value, DOT_MIN, DOT_MAX);
  return (
    <View style={[styles.wrap, { bottom: safeBottom + BOTTOM_MARGIN }]} pointerEvents="box-none">
      <Animated.View
        style={[styles.row, { transform: [{ translateY: rise }] }]}
        {...pan.panHandlers}
      >
        <Animated.View style={[styles.ground, { opacity: groundFade }]} />
        <View
          accessibilityRole="adjustable"
          accessibilityLabel="Brush size"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
          style={[styles.handle, { left: value * (TRACK_W - HANDLE) }]}
        >
          <View style={[styles.dot, { width: dot, height: dot, borderRadius: dot / 2 }]} />
        </View>
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
