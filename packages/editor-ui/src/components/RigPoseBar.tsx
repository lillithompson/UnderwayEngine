import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { RigPart, RigSliderKey } from '../logic/rigEdit';
import { rigPartSliders, rigPartTitle } from '../logic/rigEdit';
import {
  BAR_BORDER, BAR_CONTROLS_TOP, BAR_PAD_BOTTOM, BAR_PAD_HORIZONTAL, BAR_PAD_TOP, ROW_GAP,
} from '../logic/submenuHeight';
import { BAR_BG, EffectBarHeader, HAIRLINE, SliderRow } from './effectBar';

// The rig's pose bar: one part per page (RIG · HANDS · FEET · SPINE · HEAD)
// and a slider per control. The whole figure turns on three axes, the hands
// close into fists and roll at the wrist, the feet point or flatten and
// swivel at the ankle, the spine bends / twists / leans from a centered
// rest, and the head nods and shakes on its own.
//
// No hint line under the controls, unlike the other bars. These pages carry
// the most rows in the editor, they stand over the figure being posed, and
// a slider named 'Bend' running between two labelled ends has already said
// what a sentence underneath would repeat. Dropping it takes a row off
// every one of them.
//
// No IK switch either. Reaching with a whole chain — the elbow bending so
// the hand lands where the finger is — is not offered any more: a drag
// swings the one bone under the finger, which is what makes posing this
// feel like posing a mannequin. The flag itself is still there in the host
// (rigIkStore, off), so the behaviour can be handed back without rebuilding
// it; nothing in the UI turns it on.
//
// The sliders do NOT read the figure's current pose — a hand posed finger
// by finger has no single "fistness" — so they sit at their rest positions
// until touched, and the host only shapes the pose once one moves.
//
// And NO TRASH in the header, unlike the effect bars. On those it removes
// something that was ADDED — a shadow, a border, a tint — and the object is
// itself again without it. A rig has no such layer: every slider here is a
// posture the figure is always in, so a trash could only mean "back to
// rest", which is a pose like any other and one the sliders already reach.
// It also reset the WHOLE page, the sliders nobody had touched included, so
// one tap flattened a pair of hands that had been posed finger by finger.
// Undoing a pose is what undo is for.

export function RigPoseBar({ part, values, onChange, onCommit, onBack }: {
  part: RigPart;
  values: Record<RigSliderKey, number>;
  onChange: (key: RigSliderKey, value: number) => void;
  onCommit: (key: RigSliderKey, value: number) => void;
  onBack: () => void;
}) {
  return (
    <View style={styles.bar}>
      <EffectBarHeader title={rigPartTitle(part)} chevron onBack={onBack} />
      <View style={styles.controls}>
        {rigPartSliders(part).map((spec) => (
          <SliderRow
            key={spec.key}
            label={spec.label}
            value={values[spec.key]}
            apply={(t, committed) => (committed ? onCommit : onChange)(spec.key, t)}
          />
        ))}
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
