import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { TransformCopiesSpec, TransformModel } from '../adapter';
import {
  BAR_BORDER, BAR_CONTROLS_TOP, BAR_PAD_BOTTOM, BAR_PAD_HORIZONTAL, BAR_PAD_TOP, ROW_GAP,
} from '../logic/submenuHeight';
import { ActionRow, BAR_BG, EffectBarHeader, HAIRLINE, SliderRow } from './effectBar';
import { COPIES_MAX, COPIES_MIN, DEFAULT_COPIES, OFFSET_MAX, ROTATE_MAX, ROTATE_MIN } from '../logic/transform';

// The Transform bar, on every vector shape and line: a Rotation slider for the
// object itself (degrees clockwise, the same free rotation the two-finger
// twist sets), then Create copies — how many, how far each sits from the one
// before (X and Y, in cells), how much further each is turned — and the
// button that lays them down. The copy settings are the BAR's own draft (a
// request, not a property of the object), so they survive between presses:
// set 6 copies 2 cells apart at 15°, press, undo, press again.
//
// Ranges are stated in the object's own units so the readouts mean
// something: a typed 90 is a quarter turn, a typed 4 is four cells
// (logic/transform.ts).

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** A value in [lo, hi] as the slider's 0–1, and back. */
const toT = (v: number, lo: number, hi: number) => (v - lo) / (hi - lo);
const fromT = (t: number, lo: number, hi: number) => lo + t * (hi - lo);
const degText = (deg: number) => `${Math.round(deg)}°`;
const cellText = (cells: number) => String(Math.round(cells * 10) / 10);

const CREATE_OPTION = [{ value: 'create' as const, label: 'Create copies' }];

export function TransformBar({ transform, onRotate, onCopies, onBack }: {
  transform: TransformModel;
  /** The Rotation slider: live while dragging, committed on release. */
  onRotate: (angleDeg: number, committed: boolean) => void;
  onCopies: (spec: TransformCopiesSpec) => void;
  onBack: () => void;
}) {
  const [copies, setCopies] = useState<TransformCopiesSpec>(DEFAULT_COPIES);
  const set = (patch: Partial<TransformCopiesSpec>) => setCopies((c) => ({ ...c, ...patch }));
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
        <SliderRow
          label="Copies"
          value={toT(copies.count, COPIES_MIN, COPIES_MAX)}
          apply={(t) => set({ count: Math.round(fromT(t, COPIES_MIN, COPIES_MAX)) })}
          readout={{
            text: String(copies.count),
            commit: (n) => set({ count: Math.round(clamp(n, COPIES_MIN, COPIES_MAX)) }),
          }}
        />
        <SliderRow
          label="Offset X"
          value={toT(copies.dx, -OFFSET_MAX, OFFSET_MAX)}
          apply={(t) => set({ dx: Math.round(fromT(t, -OFFSET_MAX, OFFSET_MAX) * 10) / 10 })}
          readout={{ text: cellText(copies.dx), commit: (n) => set({ dx: clamp(n, -OFFSET_MAX, OFFSET_MAX) }) }}
        />
        <SliderRow
          label="Offset Y"
          value={toT(copies.dy, -OFFSET_MAX, OFFSET_MAX)}
          apply={(t) => set({ dy: Math.round(fromT(t, -OFFSET_MAX, OFFSET_MAX) * 10) / 10 })}
          readout={{ text: cellText(copies.dy), commit: (n) => set({ dy: clamp(n, -OFFSET_MAX, OFFSET_MAX) }) }}
        />
        <SliderRow
          label="Rotation offset"
          value={toT(copies.dAngleDeg, ROTATE_MIN, ROTATE_MAX)}
          apply={(t) => set({ dAngleDeg: Math.round(fromT(t, ROTATE_MIN, ROTATE_MAX)) })}
          readout={{
            text: degText(copies.dAngleDeg),
            commit: (n) => set({ dAngleDeg: Math.round(clamp(n, ROTATE_MIN, ROTATE_MAX)) }),
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
