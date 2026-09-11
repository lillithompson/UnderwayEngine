import React, { useRef } from 'react';
import { GestureResponderEvent, PanResponder, StyleSheet, View } from 'react-native';
import type { ShadowModel } from '../adapter';
import { SHADOW_PAD_SIZE } from '../logic/submenuHeight';
import { BarBody, ColorAside, CONTROL_ACCENT, SliderRow } from './effectBar';
import { beginValueDrag, endValueDrag, padOffsetFromTouch, VALUE_DRAG_SURFACE } from '../logic/slider';
import { rgbCss, withAlpha } from '../logic/hsv';

// The Drop Shadow page (design "2a"): an aside column holding the XY offset
// pad over the colour swatch, and Blur / Spread / Opacity sliders beside it,
// spread to the column's height. Values are the app's world-cell units (see
// the ranges below, mapped from the design's iOS-point ranges at 16px/cell).
// The slider rows and the body layout come from the shared page grammar
// (see effectBar.tsx); the sheet around the page — its Shadow tab and the
// Remove line — is the Edit sheet's.

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

export function ShadowBar({ shadow, onChange, onCommit, onPickColor }: {
  shadow: ShadowModel;
  onChange: (s: ShadowModel) => void;
  onCommit: (s: ShadowModel) => void;
  onPickColor: () => void;
}) {
  const set = (patch: Partial<ShadowModel>, committed: boolean) =>
    (committed ? onCommit : onChange)({ ...shadow, ...patch });
  return (
    <BarBody
      spread
      aside={(
        <>
          <XYPad
            dx={shadow.dx}
            dy={shadow.dy}
            onChange={(dx, dy) => set({ dx, dy }, false)}
            onCommit={(dx, dy) => set({ dx, dy }, true)}
          />
          <ColorAside color={shadow.color} label="Drop shadow color" onPickColor={onPickColor} />
        </>
      )}
    >
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
  );
}

const styles = StyleSheet.create({
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
