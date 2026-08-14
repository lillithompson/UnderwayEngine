import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { RigPart, RigSliderKey } from '../logic/rigEdit';
import { rigPartHasIk, rigPartHint, rigPartSliders, rigPartTitle } from '../logic/rigEdit';
import {
  BAR_BORDER, BAR_CONTROLS_TOP, BAR_PAD_BOTTOM, BAR_PAD_HORIZONTAL, BAR_PAD_TOP, ROW_GAP,
} from '../logic/submenuHeight';
import { BAR_BG, EffectBarHeader, HAIRLINE, Hint, SegmentedRow, SliderRow } from './effectBar';

// The rig's pose bar: one part per page (RIG · HANDS · FEET · SPINE), a
// slider per control, and a line saying which way the track runs. The
// whole figure turns on three axes, the hands close into fists, the feet
// point or flatten, the spine bends / twists / leans from a centered rest.
//
// The RIG page also carries the IK switch: what it changes is what a drag
// on a wrist or an ankle does, which belongs with the posing controls
// rather than beside them.
//
// The sliders do NOT read the figure's current pose — a hand posed finger
// by finger has no single "fistness" — so they sit at their rest positions
// until touched, and the host only shapes the pose once one moves. The
// trash returns this part's sliders to rest (one undo step), the same
// reset-rather-than-delete the Opacity and Stroke bars use.

export function RigPoseBar({ part, values, onChange, onCommit, onBack, onReset, ik, onToggleIk }: {
  part: RigPart;
  values: Record<RigSliderKey, number>;
  onChange: (key: RigSliderKey, value: number) => void;
  onCommit: (key: RigSliderKey, value: number) => void;
  onBack: () => void;
  /** Return this part to its rest posture. */
  onReset: () => void;
  /** Whether a chain-end drag REACHES (2-bone IK) or swings the one bone
   *  it holds. Shown on the RIG bar — it is a property of the whole
   *  figure, not of a part — and only when the host offers it. */
  ik?: boolean;
  onToggleIk?: () => void;
}) {
  return (
    <View style={styles.bar}>
      <EffectBarHeader
        title={rigPartTitle(part)}
        chevron
        removeLabel={`Reset ${part}`}
        onBack={onBack}
        onRemove={onReset}
      />
      <View style={styles.controls}>
        {rigPartSliders(part).map((spec) => (
          <SliderRow
            key={spec.key}
            label={spec.label}
            value={values[spec.key]}
            apply={(t, committed) => (committed ? onCommit : onChange)(spec.key, t)}
          />
        ))}
        {rigPartHasIk(part) && onToggleIk ? (
          <SegmentedRow
            label="IK"
            options={IK_OPTIONS}
            value={ik ? 'on' : 'off'}
            onChange={(v) => { if ((v === 'on') !== !!ik) onToggleIk(); }}
          />
        ) : null}
        <Hint>{rigPartHint(part)}</Hint>
      </View>
    </View>
  );
}

/** Off first, so the row reads left-to-right as the two things a drag can
 *  do: swing the bone it holds, or reach with the chain. */
const IK_OPTIONS = [
  { value: 'off' as const, label: 'Off' },
  { value: 'on' as const, label: 'On' },
];

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
