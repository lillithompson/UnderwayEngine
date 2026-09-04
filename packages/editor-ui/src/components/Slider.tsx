import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PANEL_TRACK, STATE_ACTIVE } from '../theme';
import { SLIDER_CONTROL } from '../logic/submenuHeight';
import { beginValueDrag, brushSliderValueFromX, endValueDrag, sliderRampColors } from '../logic/slider';
import { CheckerboardFill } from './ColorSwatch';

// The one draggable 0–1 control every property page uses, in the dress the
// color picker's Opacity slider set: a tall pill track carrying a left→right
// ramp of the control's color — none of it at the left end, all of it at the
// right — and a round thumb, the color inside a white ring, marking the value
// on that ramp. The ramp spans the WHOLE track rather than the part behind
// the thumb: it is the scale the thumb points into, which also means nothing
// but the thumb's `left` changes during a drag (no fill re-layout per move).
// An opacity slider shows the alpha checkerboard under its ramp (`checker`),
// so the ramp's empty end reads as see-through rather than as pale.
//
// The thumb stays fully inside the track (its center runs over `trackW −
// SLIDER_THUMB`, the brush slider's mapping) so at 100% it sits flush with
// the track's right end, as the design has it. Tapping or dragging the track
// moves the thumb to the touch; `onChange` fires live and `onCommit` on
// release. Built on PanResponder (as the sub-panel swipe is) so it needs no
// slider dep.

/** The pill track's height — and the height of the value box beside it. */
export const SLIDER_TRACK = 28;
/** The thumb's diameter: the track's, so it fills the pill top to bottom. */
export const SLIDER_THUMB = SLIDER_TRACK;
const THUMB_RING = 3;

export function Slider({ value, onChange, onCommit, accent = STATE_ACTIVE, trackColor = PANEL_TRACK, checker }: {
  value: number;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
  /** The control's color: the ramp's full end and the thumb's center.
   *  Defaults to selection blue; a color picker's Opacity row passes the
   *  color being picked. `#rgb`, `#rrggbb`, `rgb()` or `rgba()`. */
  accent?: string;
  /** What shows through the ramp's empty end (defaults to the panel track). */
  trackColor?: string;
  /** Draw the alpha checkerboard under the ramp — an opacity slider. */
  checker?: boolean;
}) {
  const [trackW, setTrackW] = useState(0);
  const trackWRef = useRef(0);
  trackWRef.current = trackW;
  // The value THIS GESTURE has reached — not the `value` prop.
  //
  // Two things conspire otherwise. A release event's `locationX` is sometimes
  // un-locatable (the same react-native-web quirk that made the first grab
  // read NaN — see brushSliderValueFromX), which sends the release down the
  // hold-current path; and the prop it would hold is a render behind, because
  // a drag's live onChange and the finger lifting land in the same React
  // batch. Committing the prop there wrote back the value the slider had
  // BEFORE the drag — the release "snapping back" to where it started.
  //
  // So the gesture keeps its own value, and the release commits that.
  const dragRef = useRef(value);
  const draggingRef = useRef(false);
  // Idle: follow the prop, so a tap (or a value changed from elsewhere)
  // starts from where the control actually is.
  if (!draggingRef.current) dragRef.current = value;
  // Latest handlers, so the once-created PanResponder always calls through.
  const cbRef = useRef({ onChange, onCommit });
  cbRef.current = { onChange, onCommit };

  /** Track the touch, remembering where it left the value. */
  const track = (x: number) => {
    dragRef.current = brushSliderValueFromX(x, trackWRef.current, SLIDER_THUMB, dragRef.current);
    return dragRef.current;
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Once the thumb is grabbed, keep the touch: the enclosing effect bar's
      // swipe-to-dismiss PanResponder would otherwise request termination on
      // the first horizontal move and slide the whole panel away instead of
      // moving the slider.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        draggingRef.current = true;
        // Claim the gesture against the enclosing carousel's swipe — a
        // horizontal drag here is not a page fling (see beginValueDrag).
        beginValueDrag();
        cbRef.current.onChange(track(e.nativeEvent.locationX));
      },
      onPanResponderMove: (e) => cbRef.current.onChange(track(e.nativeEvent.locationX)),
      // The release position is where the last move already put it, so the
      // gesture's own value is both correct and always available.
      onPanResponderRelease: () => {
        draggingRef.current = false;
        endValueDrag();
        cbRef.current.onCommit(dragRef.current);
      },
      onPanResponderTerminate: () => {
        draggingRef.current = false;
        endValueDrag();
        cbRef.current.onCommit(dragRef.current);
      },
    }),
  ).current;

  // The ramp is a property of the color, not of the value: computed once per
  // accent, never per move.
  const ramp = useMemo(() => sliderRampColors(accent), [accent]);
  const clamped = Math.max(0, Math.min(1, value));
  const thumbLeft = clamped * Math.max(0, trackW - SLIDER_THUMB);
  return (
    <View
      style={styles.hit}
      onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
      accessibilityRole="adjustable"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      {...pan.panHandlers}
    >
      <View style={[styles.track, { backgroundColor: trackColor }]}>
        {checker ? <CheckerboardFill /> : null}
        <LinearGradient
          colors={ramp}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <View style={[styles.thumb, { left: thumbLeft, backgroundColor: accent }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { height: SLIDER_CONTROL, justifyContent: 'center' },
  // The pill clips the ramp (and the checker under it) to its rounded ends.
  track: { height: SLIDER_TRACK, borderRadius: SLIDER_TRACK / 2, overflow: 'hidden' },
  thumb: {
    position: 'absolute',
    top: (SLIDER_CONTROL - SLIDER_THUMB) / 2,
    width: SLIDER_THUMB,
    height: SLIDER_THUMB,
    borderRadius: SLIDER_THUMB / 2,
    // The color inside a white ring: the ring is what separates the thumb
    // from the ramp's full end, where the two are the same color.
    borderWidth: THUMB_RING,
    borderColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
});
