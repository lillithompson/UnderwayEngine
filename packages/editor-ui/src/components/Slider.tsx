import React, { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { MODAL_TEXT, PANEL_HAIRLINE } from '../theme';
import { sliderValueFromX } from '../logic/slider';

// A minimal draggable slider (0–1). Tapping or dragging the track moves the
// thumb to the touch; `onChange` fires live and `onCommit` on release. Built
// on PanResponder (as the sub-panel swipe is) so it needs no slider dep.
const THUMB = 22;
const DEFAULT_ACCENT = '#e5e5e5';

export function Slider({ value, onChange, onCommit, accent = DEFAULT_ACCENT, trackColor }: {
  value: number;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
  /** Filled-portion color (defaults to a light neutral). */
  accent?: string;
  /** Empty-track color (defaults to the panel hairline). */
  trackColor?: string;
}) {
  const [trackW, setTrackW] = useState(0);
  const trackWRef = useRef(0);
  trackWRef.current = trackW;
  // The value THIS GESTURE has reached — not the `value` prop.
  //
  // Two things conspire otherwise. A release event's `locationX` is sometimes
  // un-locatable (the same react-native-web quirk that made the first grab
  // read NaN — see sliderValueFromX), which sends the release down the
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
    dragRef.current = sliderValueFromX(x, trackWRef.current, dragRef.current);
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
        cbRef.current.onChange(track(e.nativeEvent.locationX));
      },
      onPanResponderMove: (e) => cbRef.current.onChange(track(e.nativeEvent.locationX)),
      // The release position is where the last move already put it, so the
      // gesture's own value is both correct and always available.
      onPanResponderRelease: () => {
        draggingRef.current = false;
        cbRef.current.onCommit(dragRef.current);
      },
      onPanResponderTerminate: () => {
        draggingRef.current = false;
        cbRef.current.onCommit(dragRef.current);
      },
    }),
  ).current;

  const clamped = Math.max(0, Math.min(1, value));
  const thumbLeft = clamped * trackW;
  return (
    <View
      style={styles.hit}
      onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
      {...pan.panHandlers}
    >
      <View style={[styles.track, trackColor ? { backgroundColor: trackColor } : null]} />
      <View style={[styles.fill, { width: thumbLeft, backgroundColor: accent }]} />
      <View style={[styles.thumb, { left: thumbLeft - THUMB / 2 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { height: THUMB + 12, justifyContent: 'center' },
  track: { height: 5, borderRadius: 2.5, backgroundColor: PANEL_HAIRLINE },
  fill: { position: 'absolute', left: 0, height: 5, borderRadius: 2.5 },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    // White thumb in both schemes — on the light properties bars it's the
    // raised cell over a recessed track, on the dark color picker it's the one
    // bright thing on the row. The shadow is dialled back from the dark-only
    // 0.55 so it lifts the thumb on a pale surface without haloing it.
    backgroundColor: MODAL_TEXT,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
});
