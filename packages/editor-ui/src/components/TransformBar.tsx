import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { TransformCopiesSpec, TransformModel } from '../adapter';
import {
  BAR_BORDER, BAR_CONTROLS_TOP, BAR_PAD_BOTTOM, BAR_PAD_HORIZONTAL, BAR_PAD_TOP, ROW_GAP,
} from '../logic/submenuHeight';
import { ActionRow, BAR_BG, DualSliderRow, EffectBarHeader, HAIRLINE, SliderRow } from './effectBar';
import {
  COPIES_MAX, COPIES_MIN, DEFAULT_COPIES, OFFSET_MAX, ROTATE_MAX, ROTATE_MIN, SCALE_MAX, SCALE_MIN,
} from '../logic/transform';

// The Transform bar, on every vector shape and line: a Rotation slider for the
// object itself (degrees clockwise, the same free rotation the two-finger
// twist sets), then Create copies — how far each sits from the one before
// (X and Y, in cells), how much each is scaled (X and Y, a factor that
// compounds copy over copy), how much further each is turned and how many
// — and the button that lays them down. The copy settings are the BAR's own
// draft (a request, not a property of the object), so they survive between
// presses: set 6 copies 2 cells apart at 15°, press, undo, press again.
//
// The settings pair up two to a row — the offsets, the scales, then the
// turn beside the count — so the bar stands no taller for the scales.
//
// Ranges are stated in the object's own units so the readouts mean
// something: a typed 90 is a quarter turn, a typed 4 is four cells, a
// typed 120 is a fifth larger each copy (logic/transform.ts).
//
// The draft is also REPORTED live (onCopiesPreview): once when the bar
// mounts, again on every change, and null as it unmounts — the host ghosts
// the copies a press would lay down, updating as the sliders move, and
// clears them when the bar is dismissed or another bar takes its place.

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** A value in [lo, hi] as the slider's 0–1, and back. */
const toT = (v: number, lo: number, hi: number) => (v - lo) / (hi - lo);
const fromT = (t: number, lo: number, hi: number) => lo + t * (hi - lo);
const degText = (deg: number) => `${Math.round(deg)}°`;
const cellText = (cells: number) => String(Math.round(cells * 10) / 10);
const factorText = (f: number) => `${Math.round(f * 100)}%`;

const CREATE_OPTION = [{ value: 'create' as const, label: 'Create copies' }];

export function TransformBar({ transform, onRotate, onCopies, onCopiesPreview, onBack }: {
  transform: TransformModel;
  /** The Rotation slider: live while dragging, committed on release. */
  onRotate: (angleDeg: number, committed: boolean) => void;
  onCopies: (spec: TransformCopiesSpec) => void;
  /** The live draft: every change while the bar is up, null on the way out. */
  onCopiesPreview?: (spec: TransformCopiesSpec | null) => void;
  onBack: () => void;
}) {
  const [copies, setCopies] = useState<TransformCopiesSpec>(DEFAULT_COPIES);
  const set = (patch: Partial<TransformCopiesSpec>) => setCopies((c) => ({ ...c, ...patch }));
  // Read through a ref so a host passing a fresh closure each render doesn't
  // re-announce an unchanged draft — the effects key on the draft alone.
  const previewRef = useRef(onCopiesPreview);
  previewRef.current = onCopiesPreview;
  useEffect(() => { previewRef.current?.(copies); }, [copies]);
  useEffect(() => () => { previewRef.current?.(null); }, []);
  return (
    <View style={styles.bar}>
      <EffectBarHeader title="TRANSFORM" chevron onBack={onBack} />
      <View style={styles.controls}>
        <SliderRow
          label="Rotation"
          value={toT(transform.angleDeg, ROTATE_MIN, ROTATE_MAX)}
          apply={(t, c) => onRotate(fromT(t, ROTATE_MIN, ROTATE_MAX), c)}
          readout={{
            text: degText(transform.angleDeg),
            commit: (n) => onRotate(clamp(n, ROTATE_MIN, ROTATE_MAX), true),
          }}
        />
        <DualSliderRow
          leftLabel="Offset X"
          leftValue={toT(copies.dx, -OFFSET_MAX, OFFSET_MAX)}
          leftApply={(t) => set({ dx: Math.round(fromT(t, -OFFSET_MAX, OFFSET_MAX) * 10) / 10 })}
          leftReadout={{ text: cellText(copies.dx), commit: (n) => set({ dx: clamp(n, -OFFSET_MAX, OFFSET_MAX) }) }}
          rightLabel="Offset Y"
          rightValue={toT(copies.dy, -OFFSET_MAX, OFFSET_MAX)}
          rightApply={(t) => set({ dy: Math.round(fromT(t, -OFFSET_MAX, OFFSET_MAX) * 10) / 10 })}
          rightReadout={{ text: cellText(copies.dy), commit: (n) => set({ dy: clamp(n, -OFFSET_MAX, OFFSET_MAX) }) }}
        />
        <DualSliderRow
          leftLabel="Scale X"
          leftValue={toT(copies.sx, SCALE_MIN, SCALE_MAX)}
          leftApply={(t) => set({ sx: Math.round(fromT(t, SCALE_MIN, SCALE_MAX) * 100) / 100 })}
          leftReadout={{ text: factorText(copies.sx), commit: (n) => set({ sx: clamp(n / 100, SCALE_MIN, SCALE_MAX) }) }}
          rightLabel="Scale Y"
          rightValue={toT(copies.sy, SCALE_MIN, SCALE_MAX)}
          rightApply={(t) => set({ sy: Math.round(fromT(t, SCALE_MIN, SCALE_MAX) * 100) / 100 })}
          rightReadout={{ text: factorText(copies.sy), commit: (n) => set({ sy: clamp(n / 100, SCALE_MIN, SCALE_MAX) }) }}
        />
        <DualSliderRow
          leftLabel="Rotation offset"
          leftValue={toT(copies.dAngleDeg, ROTATE_MIN, ROTATE_MAX)}
          leftApply={(t) => set({ dAngleDeg: Math.round(fromT(t, ROTATE_MIN, ROTATE_MAX)) })}
          leftReadout={{
            text: degText(copies.dAngleDeg),
            commit: (n) => set({ dAngleDeg: Math.round(clamp(n, ROTATE_MIN, ROTATE_MAX)) }),
          }}
          rightLabel="Copies"
          rightValue={toT(copies.count, COPIES_MIN, COPIES_MAX)}
          rightApply={(t) => set({ count: Math.round(fromT(t, COPIES_MIN, COPIES_MAX)) })}
          rightReadout={{
            text: String(copies.count),
            commit: (n) => set({ count: Math.round(clamp(n, COPIES_MIN, COPIES_MAX)) }),
          }}
        />
        <ActionRow label="Copies" options={CREATE_OPTION} onPress={() => onCopies(copies)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: BAR_BG,
    borderTopWidth: BAR_BORDER,
    borderTopColor: HAIRLINE,
    paddingTop: BAR_PAD_TOP,
    paddingHorizontal: BAR_PAD_HORIZONTAL,
    paddingBottom: BAR_PAD_BOTTOM,
  },
  controls: { marginTop: BAR_CONTROLS_TOP, gap: ROW_GAP },
});
