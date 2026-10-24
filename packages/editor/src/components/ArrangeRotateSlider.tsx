import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { FLOATING_SLIDER_BOTTOM, FloatingSliderRow } from '@/editor-ui';
import { PANEL_ANIM_MS } from '@/editor-ui/theme';
import { angleFromSlider, seatAfterCommit, sliderFromAngle } from '../arrangeRotate';

// The selection tool's Rotate slider (arrangeRotate.ts): the rig Turn
// slider's own row and seat — the same FloatingSliderRow, lifted clear of
// the properties panel the same way — turning the selection instead. Live
// while the handle moves (onRotate(…, false): the shell previews from a
// snapshot), one commit as it is let go (onRotate(…, true): one undo step
// for the whole drag), then the row reseats on `seatDeg` — the object's
// committed angle, or zero for a group's delta.

/** Clear air between the panel's top edge and the row (the Turn slider's). */
const ROW_GAP = 12;

export function ArrangeRotateSlider({ mode, seatDeg, safeBottom, panelPx, onRotate }: {
  /** How the row reads: `absolute` (one object turns TO the angle it shows)
   *  or `delta` (a group turns BY it, and the row goes back to its seat once
   *  the turn has landed). */
  mode: 'absolute' | 'delta';
  /** Where the row seats between drags: one object's committed free
   *  rotation, or 0 for a group (whose slider reads as a delta). */
  seatDeg: number;
  safeBottom: number;
  /** Bottom-edge px the object-properties panel claims (its own
   *  onOccludedHeight report) — the row rides above it. */
  panelPx: number;
  /** The slider's angle, live (committed=false) on every move and once as
   *  the handle is let go (committed=true). */
  onRotate(angleDeg: number, committed: boolean): void;
}) {
  const [slider, setSlider] = useState(sliderFromAngle(seatDeg));
  // Whether the handle is HELD (the row's onPreview: a value on pick-up
  // and every move, null on let-go) and whether it has moved. The row
  // reports its let-go BEFORE one trailing onChange with the final value;
  // counted as a move, that tick re-announced the angle after the commit
  // had cleared it, and the readout stayed up. So a change counts only
  // while the handle is held, and the let-go is the commit.
  const heldRef = useRef(false);
  const draggingRef = useRef(false);
  const valueRef = useRef(slider);
  const cbRef = useRef(onRotate);
  cbRef.current = onRotate;
  // The let-go handler runs from the render the row was mounted on, so it
  // reads these rather than the closed-over props.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const seatDegRef = useRef(seatDeg);
  seatDegRef.current = seatDeg;
  // Reseat on outside changes (undo, another object selected) unless mid-drag.
  useEffect(() => {
    if (!draggingRef.current) setSlider(sliderFromAngle(seatDeg));
  }, [seatDeg]);

  const anchor = Math.max(panelPx + ROW_GAP, safeBottom + FLOATING_SLIDER_BOTTOM);
  const lift = useRef(new Animated.Value(-anchor)).current;
  useEffect(() => {
    const anim = Animated.timing(lift, { toValue: -anchor, duration: PANEL_ANIM_MS, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [anchor, lift]);

  return (
    <Animated.View style={[styles.wrap, { transform: [{ translateY: lift }] }]} pointerEvents="box-none">
      <FloatingSliderRow
        label="Rotate"
        readout="diameter"
        value={slider}
        onChange={(t) => {
          if (!heldRef.current) return;
          draggingRef.current = true;
          valueRef.current = t;
          setSlider(t);
          cbRef.current(angleFromSlider(t), false);
        }}
        onPreview={(held) => {
          if (held !== null) { heldRef.current = true; return; }
          // The handle was let go (or the touch missed it): the drag's
          // angle lands as one commit, and the row reseats.
          heldRef.current = false;
          if (!draggingRef.current) return;
          draggingRef.current = false;
          const committed = angleFromSlider(valueRef.current);
          cbRef.current(committed, true);
          // Reseat by hand: a group's `seatDeg` is the constant 0, so the
          // effect above never fires after the row's own commit, and a handle
          // left standing off-centre is read as a fresh delta the next time it
          // is touched (seatAfterCommit).
          const next = sliderFromAngle(seatAfterCommit(modeRef.current, seatDegRef.current, committed));
          valueRef.current = next;
          setSlider(next);
        }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    // Above the object-properties panel it floats over (200), like the Turn slider.
    zIndex: 205,
  },
});
