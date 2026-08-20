import React, { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, StyleSheet, View } from 'react-native';
import type { BrushControlsModel } from '../adapter';
import { CAPSULE_SIZE, MODAL_TEXT, PANEL_ANIM_MS, WHITE_25 } from '../theme';
import {
  brushDotSize, brushSliderGrabsHandle, brushSliderValueFromX, isSingleTouchGesture,
} from '../logic/slider';

// Floating brush controls (Procreate Pocket's size slider as the model): a
// stack of two sliders — STRENGTH over SIZE — each a single round handle
// riding a bottom-center track. The handle is a capsule button's twin
// (CAPSULE_SIZE round, dark outline) with a translucent grey fill, and what
// sits INSIDE it is the value readout, each row showing the thing it
// actually controls:
//
//   STRENGTH  a soft white wash whose OPACITY grows toward the right, clear
//             at the left end and solid at the right — how much paint a dab
//             lays down. A dot that merely grew would say nothing about
//             opacity; this shows the value in the same currency.
//   SIZE      a white dot whose DIAMETER grows toward the right — the width
//             of the mark the brush will make.
//
// The whole stack stands clear of the home-indicator strip: the LOWER row
// takes the spot the properties panel's own controls hold (safeBottom +
// BOTTOM_MARGIN), and the upper one rides a row above it. Both are inside
// the safe area, so neither handle competes with the system's swipe strip —
// on native iOS a handle down there is a gesture fight every time.
//
// Strength keeps the UPPER row: it is the one reached for mid-painting, and
// the further from the screen edge the easier it is to grab in a hurry. It
// is also the row a host can DROP (BrushControlsModel.showStrength) for a
// brush that carries its strength somewhere else — the stack stands on the
// bottom edge, so Size stays exactly where it is and the panel is simply
// one row shorter.
//
// At rest only the handles show; grabbing one fades in that row's track pill
// AND its name, so the control stays out of the artwork's way while idle and
// says what it is the moment you touch it.
//
// A row moves ONLY by its handle being picked up and dragged. Tapping the
// track does nothing — see brushSliderGrabsHandle. The touch is still eaten
// (these rows float over the artwork; letting a miss through would paint a
// dab under the control), it just doesn't move anything.
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
/**
 * How far the BOTTOM slider stands off the safe area — the seat of the
 * whole floating-slider look, exported because it is shared: the Poser
 * stage's own column (Turn, Push) stands on the same line, so switching
 * between the paint brush and a rig leaves the slider under the thumb
 * exactly where it was.
 */
export const FLOATING_SLIDER_BOTTOM = 20;
const BOTTOM_MARGIN = FLOATING_SLIDER_BOTTOM;
/** Inset of a row's name from the left end of its track. */
const LABEL_INSET = 16;
/** The strength wash: solid at the centre, feathering out to nothing at the
 *  rim, so the handle reads as a soft dab of paint rather than a flat disc.
 *  Its whole opacity is the value (see {@link FloatingSliderRow}). */
const STRENGTH_WASH =
  'radial-gradient(circle at 50% 50%, #ffffff 0%, rgba(255,255,255,0.9) 45%, rgba(255,255,255,0) 100%)';
/** The size preview's disc: the brush's own gaussian falloff, solid at the
 *  centre and gone at the rim, so what stands above the slider is the shape
 *  of the mark rather than a hard circle the brush never makes. */
const BRUSH_WASH =
  'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.55) 45%, rgba(255,255,255,0) 100%)';
/** How long the preview takes to go once the handle is let go. Short: it is
 *  a readout for the drag, and lingering over the artwork afterwards would
 *  make it a thing to wait out. */
const PREVIEW_FADE_MS = 160;
/** Clear air between the preview disc and the top of the slider stack —
 *  kept tight so the disc reads as the Size handle's own readout, not a
 *  thing floating off in the page. */
const PREVIEW_GAP = 8;
/** Fully clears bottom margin + both rows + any home-indicator inset. */
const HIDDEN_Y = HANDLE * 2 + ROW_GAP + BOTTOM_MARGIN + 80;

/** One slider: ground pill, name, and the handle whose readout shows the
 *  value. Exported as the package's one floating-slider look — any control
 *  that should "mirror the brush slider" (the Poser stage's turn slider)
 *  uses THIS row rather than growing a lookalike that drifts. */
export function FloatingSliderRow({ label, value, onChange, readout, onPreview }: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  /** What the handle's interior shows — see the module header. */
  readout: 'diameter' | 'opacity';
  /** Live value while the handle is HELD, and null the moment it is let go
   *  (or the touch turns out to have missed the handle). Drives the size
   *  preview above the stack; rows without one are unaffected. */
  onPreview?: (value: number | null) => void;
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
  const previewRef = useRef(onPreview);
  previewRef.current = onPreview;

  // THE HANDLE IS THE CONTROL. A touch anywhere else in the row is swallowed
  // and ignored — see brushSliderGrabsHandle for why tapping to a value was
  // wrong here, and why the answer can be "not yet known" on the first grant.
  // `null` = undecided; the first locatable event settles it.
  const grabsRef = useRef<boolean | null>(null);
  // Where the finger sat on the handle when it was picked up, in px from the
  // handle's centre. Held for the whole drag so the value never jumps: grab
  // the handle's left rim and it stays under that rim.
  const grabOffsetRef = useRef(0);
  /** Decide (once) whether this gesture picked the handle up, and if so from
   *  where. Returns whether the gesture is live. */
  const takeHold = (x: number) => {
    if (grabsRef.current === null) {
      const hit = brushSliderGrabsHandle(x, TRACK_W, HANDLE, dragRef.current);
      if (hit === null) return false; // un-locatable touch: ask again next event
      grabsRef.current = hit;
      if (!hit) {
        // Not the handle. Let the row go quiet again — it lit up on contact,
        // before there was anything to measure the touch against.
        draggingRef.current = false;
        fadeHeld(0);
        previewRef.current?.(null);
        return false;
      }
      previewRef.current?.(dragRef.current);
      grabOffsetRef.current = x - (dragRef.current * (TRACK_W - HANDLE) + HANDLE / 2);
    }
    return grabsRef.current;
  };
  const track = (x: number) => {
    dragRef.current = brushSliderValueFromX(
      x - grabOffsetRef.current, TRACK_W, HANDLE, dragRef.current,
    );
    return dragRef.current;
  };
  // Where the value stood when this gesture began, and whether the gesture
  // has been given up on: a second finger means the canvas's undo tap, and
  // the row hands back what it took rather than keeping the jump.
  const grabbedRef = useRef(value);
  const abandonedRef = useRef(false);
  const letGo = () => {
    previewRef.current?.(null);
    draggingRef.current = false;
    abandonedRef.current = false;
    grabsRef.current = null;
    grabOffsetRef.current = 0;
    fadeHeld(0);
  };
  const pan = useRef(
    PanResponder.create({
      // Only ever a one-finger control — see isSingleTouchGesture.
      onStartShouldSetPanResponder: (_e, g) => isSingleTouchGesture(g.numberActiveTouches),
      onMoveShouldSetPanResponder: (_e, g) => isSingleTouchGesture(g.numberActiveTouches),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        draggingRef.current = true;
        abandonedRef.current = false;
        grabsRef.current = null;
        grabbedRef.current = dragRef.current;
        // Lit on contact, dropped again by takeHold if the touch turns out to
        // have missed the handle — the row is what says "you have hold of me",
        // and it can only be honest once the touch has been located.
        fadeHeld(1);
        // Picking the handle up is NOT a change: the value stays exactly where
        // it was until the finger travels.
        takeHold(e.nativeEvent.locationX);
      },
      onPanResponderMove: (e, g) => {
        if (abandonedRef.current) return;
        if (!isSingleTouchGesture(g.numberActiveTouches)) {
          // A second finger arrived after we took the first: put the value
          // back where it was and sit the rest of the gesture out.
          abandonedRef.current = true;
          draggingRef.current = false;
          dragRef.current = grabbedRef.current;
          fadeHeld(0);
          previewRef.current?.(null);
          if (grabsRef.current) cbRef.current(grabbedRef.current);
          return;
        }
        if (!takeHold(e.nativeEvent.locationX)) return;
        const next = track(e.nativeEvent.locationX);
        previewRef.current?.(next);
        cbRef.current(next);
      },
      onPanResponderRelease: () => {
        const gave = abandonedRef.current || !grabsRef.current;
        letGo();
        if (!gave) cbRef.current(dragRef.current);
      },
      onPanResponderTerminate: () => {
        const gave = abandonedRef.current || !grabsRef.current;
        letGo();
        if (!gave) cbRef.current(dragRef.current);
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
        {readout === 'diameter' ? (
          <View style={[styles.dot, { width: dot, height: dot, borderRadius: dot / 2 }]} />
        ) : (
          // Full-size disc, always: only its opacity moves, so the left end
          // is genuinely empty and the right end genuinely solid.
          <View style={[styles.wash, { opacity: v }]} />
        )}
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
  // The size preview: a disc of the brush's real on-canvas radius, standing
  // over the stack while the Size handle is held. Its RADIUS is state (it
  // has to redraw as the handle moves) but its presence is animated, so the
  // release fades rather than blinks. The last radius is kept through that
  // fade — dropping it to zero on release would make the disc collapse
  // instead of dissolve.
  const [previewRadius, setPreviewRadius] = useState(0);
  const previewFade = useRef(new Animated.Value(0)).current;
  const onSizePreview = (value: number | null) => {
    if (value == null) {
      Animated.timing(previewFade, {
        toValue: 0, duration: PREVIEW_FADE_MS, useNativeDriver: true,
      }).start();
      return;
    }
    setPreviewRadius(Math.max(0, model.sizePreviewRadiusPx?.(value) ?? 0));
    previewFade.setValue(1);
  };
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
      style={[styles.wrap, { bottom: safeBottom + BOTTOM_MARGIN }]}
      pointerEvents="box-none"
    >
      {model.sizePreviewRadiusPx && previewRadius > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.preview,
            {
              width: previewRadius * 2,
              height: previewRadius * 2,
              borderRadius: previewRadius,
              opacity: previewFade,
              // Sat on the stack's top edge and pushed up by its own height,
              // so the disc grows UPWARD into the page rather than down
              // through the sliders it is describing. The stack is ONE row
              // when the host drops Strength (the Paint brush does), so the
              // offset follows the rows actually on screen — a fixed two-row
              // offset left the disc floating a row above the Size slider.
              bottom: (model.showStrength === false ? HANDLE : HANDLE * 2 + ROW_GAP)
                + PREVIEW_GAP,
            },
          ]}
        />
      ) : null}
      <Animated.View style={{ transform: [{ translateY: rise }] }}>
        {/* A host can drop STRENGTH (showStrength) when that brush carries
            it elsewhere. The stack stands on the bottom edge, so Size holds
            its place and the empty row above it simply isn't there. */}
        {model.showStrength === false ? null : (
          <>
            <FloatingSliderRow
              label="Strength" readout="opacity" value={model.strength} onChange={model.onStrength}
            />
            <View style={{ height: ROW_GAP }} />
          </>
        )}
        <FloatingSliderRow
          label="Size" readout="diameter" value={model.size} onChange={model.onSize}
          onPreview={model.sizePreviewRadiusPx ? onSizePreview : undefined}
        />
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
  preview: {
    position: 'absolute',
    // The disc is the mark, so it is not clipped or boxed: it simply stands
    // over the page at the size the brush will paint.
    ...(Platform.OS === 'web'
      ? ({ backgroundImage: BRUSH_WASH } as object)
      : { backgroundColor: 'rgba(255,255,255,0.75)' }),
  },
  wash: {
    width: DOT_MAX,
    height: DOT_MAX,
    borderRadius: DOT_MAX / 2,
    // The editor runs on react-native-web, so the gradient is plain CSS —
    // cast like SceneOutlinePanel's touchAction. A native renderer has no
    // gradient primitive here, so it falls back to the flat disc, which
    // still carries the value in its opacity.
    ...(Platform.OS === 'web'
      ? ({ backgroundImage: STRENGTH_WASH } as object)
      : { backgroundColor: '#ffffff' }),
  },
});
