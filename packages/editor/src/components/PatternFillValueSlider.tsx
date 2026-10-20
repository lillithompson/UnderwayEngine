import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { FloatingSliderRow } from '@/editor-ui';
import { PANEL_ANIM_MS } from '@/editor-ui/theme';
import { triggerHaptic } from '@/native-shell/bridge/webBridge';
import { floatingSlotAnchor } from '@/editor/components/PatternActionsCapsule';

// The pattern-fill radial's VALUE row: Size or Resolution on the floating
// slider, standing in the slot the Flood / Clear capsule holds — the
// capsule stands down for it, the way the brush's hue row stands in for
// the top capsule, because both answer the same corner and only one
// question is being asked at a time.
//
// The same FloatingSliderRow the rig's Turn and the selection's Rotate
// stand on, seated by the one floating-slot formula (floatingSlotAnchor),
// so the handle a hand reaches for is in the same place whatever it is
// driving.
//
// The row moves in WHOLE STEPS and draws the pattern at each one it
// crosses — a value you set blind and only see on release is a value you
// set twice — bumping the finger as it passes (the steps are integers, so
// a bump per step is a bump per integer boundary). The host coalesces the
// whole sweep into ONE undo entry, previewing each step from the state the
// drag began in (EditorShell's applyColorRow), so Resolution re-rolling
// its cells costs one entry for the drag rather than one per step.

export function PatternFillValueSlider({
  label, value, min, max, safeBottom, panelPx, onValue,
}: {
  /** The row's name — 'Size' or 'Resolution'. */
  label: string;
  /** Where the handle seats: the fill's committed value, in the row's own
   *  units (not 0…1 — this row owns the mapping so the steps are whole). */
  value: number;
  min: number;
  max: number;
  safeBottom: number;
  /** Bottom-edge px the object-properties panel claims — the row rides
   *  above it, level with the capsule it replaces. */
  panelPx: number;
  /**
   * The step the handle is on: as it MOVES, once per whole step it crosses
   * (`committed` false), and once more on release with the value that
   * stands (`committed` true).
   */
  onValue(value: number, committed: boolean): void;
}) {
  const toSlider = (v: number) => (max > min ? (v - min) / (max - min) : 0);
  const fromSlider = (t: number) => Math.round(min + t * (max - min));
  const [slider, setSlider] = useState(() => toSlider(value));
  const heldRef = useRef(false);
  const draggingRef = useRef(false);
  const valueRef = useRef(slider);
  /** The whole step last handed to the host, so a drag redraws once per
   *  step crossed rather than once per frame. Seeded with the value the
   *  handle sits on, so the first step it reaches is the first redraw. */
  const stepAppliedRef = useRef(value);
  const cbRef = useRef(onValue);
  cbRef.current = onValue;
  const stepRef = useRef(fromSlider);
  stepRef.current = fromSlider;
  // Reseat on outside changes (an undo, the other row's edit, a different
  // shape opened) — but never mid-drag, which would fight the thumb.
  useEffect(() => {
    if (!draggingRef.current) {
      setSlider(toSlider(value));
      stepAppliedRef.current = value;
    }
    // toSlider closes over min/max, which move only with the row itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, min, max]);

  const anchor = floatingSlotAnchor(panelPx, safeBottom);
  const lift = useRef(new Animated.Value(-anchor)).current;
  useEffect(() => {
    const anim = Animated.timing(
      lift, { toValue: -anchor, duration: PANEL_ANIM_MS, useNativeDriver: true },
    );
    anim.start();
    return () => anim.stop();
  }, [anchor, lift]);

  return (
    <Animated.View style={[styles.wrap, { transform: [{ translateY: lift }] }]} pointerEvents="box-none">
      <FloatingSliderRow
        label={label}
        readout="diameter"
        value={slider}
        onChange={(t) => {
          if (!heldRef.current) return;
          draggingRef.current = true;
          valueRef.current = t;
          setSlider(t);
          // Every whole step the handle crosses: the pattern is redrawn at
          // it, and the finger is told it crossed one.
          const step = stepRef.current(t);
          if (step === stepAppliedRef.current) return;
          stepAppliedRef.current = step;
          triggerHaptic('light');
          cbRef.current(step, false);
        }}
        onPreview={(held) => {
          if (held !== null) { heldRef.current = true; return; }
          // Let go (or the touch missed the handle): the value it landed
          // on is the edit, and the whole sweep lands as one undo entry.
          heldRef.current = false;
          if (!draggingRef.current) return;
          draggingRef.current = false;
          cbRef.current(stepRef.current(valueRef.current), true);
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
    // Above the object-properties panel it floats over (200), level with
    // the capsule whose slot it takes.
    zIndex: 205,
  },
});
