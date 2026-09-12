import React, { useRef } from 'react';
import { GestureResponderEvent, PanResponder, StyleSheet, View } from 'react-native';
import type { RGBLike, ShadowModel } from '../adapter';
import { ROW_GAP, SHADOW_PAD_SIZE } from '../logic/submenuHeight';
import { BarBody, ColorSliderRow, CONTROL_ACCENT, SliderRow } from './effectBar';
import { beginValueDrag, endValueDrag, padOffsetFromTouch, VALUE_DRAG_SURFACE } from '../logic/slider';
import { rgbCss, withAlpha } from '../logic/hsv';

// The Drop Shadow page (design "2a"): the XY offset pad on the left and
// Blur / Spread / Opacity beside it, the sliders spread to the pad's height
// so the two columns square off against each other. The pad is exactly as
// tall as those three rows (SHADOW_PAD_SIZE) and exactly as wide — a
// direction chooser has to read the same distance on both axes, and a
// smaller square parked in a taller column read as squat.
//
// Values are the app's world-cell units (see the ranges below, mapped from
// the design's iOS-point ranges at 16px/cell). The slider rows and the body
// layout come from the shared page grammar (see effectBar.tsx); the sheet
// around the page — its Shadow tab and the Remove line — is the Edit
// sheet's.
//
// The shadow's own colour reads UNDER both columns, full width. It is the
// one setting on the page that belongs to neither the direction nor the
// amount, and standing it between Spread and Opacity broke the run of
// "how much" sliders in half and squeezed the column it sat in against
// the pad.
//
// ONE page, shared: an image, a frame and a TEXT all open this, so the
// layout is the same wherever a shadow is cast.

// ── Ranges (world cells; design pt ÷ 16) ─────────────────────────────
const MAX_OFFSET = 1.5; // ±  (≈ ±24pt)
const MAX_BLUR = 3.75; // 0…60pt
const MIN_SPREAD = -0.75; // −12pt
const MAX_SPREAD = 1.5; // 24pt

// The pad is a recessed well on the light page: a faint dark wash with a
// slightly stronger edge, its guides darker still so they stay readable.
const PAD_FILL = 'rgba(42,42,42,0.08)';
const PAD_BORDER = 'rgba(42,42,42,0.16)';
const CROSSHAIR = 'rgba(42,42,42,0.16)';
const CENTER_DOT = 'rgba(42,42,42,0.34)';

const PAD_SIZE = SHADOW_PAD_SIZE;
const PAD_HANDLE = 26;

/** The XY offset pad: drag (or tap) anywhere to set the shadow offset; the
 *  handle jumps to the touch and tracks. X→dx (right positive), Y→dy (down
 *  positive), each mapped linearly to ±MAX_OFFSET. */
function XYPad({ dx, dy, onChange, onCommit }: {
  dx: number;
  dy: number;
  onChange: (dx: number, dy: number) => void;
  onCommit: (dx: number, dy: number) => void;
}) {
  const cbRef = useRef({ onChange, onCommit });
  cbRef.current = { onChange, onCommit };
  // Where this gesture has dragged the offset to, and what the release
  // commits — see the Slider's dragRef for the whole story: an un-locatable
  // release event plus a props value that is one React batch behind is what
  // made a released handle spring back to the angle it started at.
  const dragRef = useRef<[number, number]>([dx, dy]);
  const draggingRef = useRef(false);
  if (!draggingRef.current) dragRef.current = [dx, dy];
  const track = (e: GestureResponderEvent): [number, number] => {
    dragRef.current = padOffsetFromTouch(
      e.nativeEvent.locationX, e.nativeEvent.locationY, PAD_SIZE, MAX_OFFSET, dragRef.current,
    );
    return dragRef.current;
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Keep the touch once the pad is grabbed so the sheet's swipe-to-dismiss
      // can't steal it mid-drag (see Slider for the same guard).
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => { draggingRef.current = true; beginValueDrag(); const [x, y] = track(e); cbRef.current.onChange(x, y); },
      onPanResponderMove: (e) => { const [x, y] = track(e); cbRef.current.onChange(x, y); },
      onPanResponderRelease: () => { draggingRef.current = false; endValueDrag(); cbRef.current.onCommit(...dragRef.current); },
      onPanResponderTerminate: () => { draggingRef.current = false; endValueDrag(); cbRef.current.onCommit(...dragRef.current); },
    }),
  ).current;
  const clampN = (v: number) => Math.max(-1, Math.min(1, v / MAX_OFFSET));
  const hx = (clampN(dx) + 1) / 2 * PAD_SIZE;
  const hy = (clampN(dy) + 1) / 2 * PAD_SIZE;
  return (
    <View style={styles.pad} {...pan.panHandlers}>
      <View style={styles.padCrossV} />
      <View style={styles.padCrossH} />
      <View style={styles.padCenter} />
      <View style={[styles.padHandle, { left: hx - PAD_HANDLE / 2, top: hy - PAD_HANDLE / 2 }]} />
    </View>
  );
}

export function ShadowBar({ shadow, color, onColor, onOpenColorPicker, onChange, onCommit }: {
  shadow: ShadowModel;
  /** The shadow's own ink, shown as a hue row above Opacity. Given with
   *  `onColor` and `onOpenColorPicker` — omit all three and the row is absent
   *  (a page whose host has no colour to write).
   *
   *  Read off `shadow.color`, i.e. the MODEL, not the panel's draft: the full
   *  picker changes it externally, and a row fed by its own writes would stand
   *  still while the shadow recoloured. */
  color?: RGBLike;
  onColor?: (color: RGBLike, committed: boolean) => void;
  onOpenColorPicker?: () => void;
  onChange: (s: ShadowModel) => void;
  onCommit: (s: ShadowModel) => void;
}) {
  const set = (patch: Partial<ShadowModel>, committed: boolean) =>
    (committed ? onCommit : onChange)({ ...shadow, ...patch });
  return (
    <View style={styles.page}>
      <BarBody
        spread
        aside={(
          <XYPad
            dx={shadow.dx}
            dy={shadow.dy}
            onChange={(dx, dy) => set({ dx, dy }, false)}
            onCommit={(dx, dy) => set({ dx, dy }, true)}
          />
        )}
      >
        {/* How much of a shadow there is, in one run: how far it softens,
            how far it is dilated, and how much of it shows. */}
        <SliderRow label="Blur" value={shadow.blur / MAX_BLUR} apply={(t, c) => set({ blur: t * MAX_BLUR }, c)} />
        <SliderRow
          label="Spread"
          value={(shadow.spread - MIN_SPREAD) / (MAX_SPREAD - MIN_SPREAD)}
          apply={(t, c) => set({ spread: MIN_SPREAD + t * (MAX_SPREAD - MIN_SPREAD) }, c)}
        />
        {/* The shadow's own color ramping up over the alpha checker — "how
            much of THIS shadow", as the color picker's Opacity reads. */}
        <SliderRow
          label="Opacity"
          value={shadow.opacity}
          accent={rgbCss(withAlpha(shadow.color, 1))}
          checker
          apply={(t, c) => set({ opacity: t }, c)}
        />
      </BarBody>
      {/* …and what colour it is, across the foot of the page — under the
          pad and the sliders alike: the hue wheel along the track, the
          colour under the thumb, and the circle at the end opening the
          full picker for saturation and brightness. */}
      {color && onColor && onOpenColorPicker ? (
        <ColorSliderRow
          label="Color"
          color={color}
          onColor={onColor}
          onOpenPicker={onOpenColorPicker}
        />
      ) : null}
    </View>
  );
}


const styles = StyleSheet.create({
  // The two-column block, then the colour row beneath it — the same gap the
  // rows inside the block keep, so the page reads as one stack.
  page: { gap: ROW_GAP },
  pad: {
    width: PAD_SIZE, height: PAD_SIZE, borderRadius: 12, backgroundColor: PAD_FILL,
    borderWidth: 1, borderColor: PAD_BORDER,
    ...VALUE_DRAG_SURFACE,
  },
  padCrossV: { position: 'absolute', left: PAD_SIZE / 2, top: 0, bottom: 0, width: 1, backgroundColor: CROSSHAIR },
  padCrossH: { position: 'absolute', top: PAD_SIZE / 2, left: 0, right: 0, height: 1, backgroundColor: CROSSHAIR },
  padCenter: {
    position: 'absolute', left: PAD_SIZE / 2 - 2.5, top: PAD_SIZE / 2 - 2.5,
    width: 5, height: 5, borderRadius: 2.5, backgroundColor: CENTER_DOT,
  },
  padHandle: {
    position: 'absolute', width: PAD_HANDLE, height: PAD_HANDLE, borderRadius: PAD_HANDLE / 2,
    // Selection blue, same as the Blur / Spread / Opacity sliders beside it —
    // the pad is those sliders on two axes.
    backgroundColor: CONTROL_ACCENT, borderWidth: 2, borderColor: '#ffffff',
    // Softer than the dark scheme's: the handle only needs enough lift to
    // separate from the pale well behind it.
    shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
});
