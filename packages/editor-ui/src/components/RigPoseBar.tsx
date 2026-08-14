import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { RigPart, RigSliderKey } from '../logic/rigEdit';
import { rigPartHint, rigPartSliders, rigPartTitle } from '../logic/rigEdit';
import {
  BAR_BORDER, BAR_CONTROLS_TOP, BAR_PAD_BOTTOM, BAR_PAD_HORIZONTAL, BAR_PAD_TOP, ROW_GAP,
} from '../logic/submenuHeight';
import { BAR_BG, EffectBarHeader, HAIRLINE, Hint, SliderRow } from './effectBar';

// The rig's pose bar: one part per page (HANDS · FEET · SPINE), a slider
// per control, and a line saying which way the track runs. The hands close
// into fists, the feet point or flatten, the spine bends / twists / leans
// from a centered rest.
//
// The sliders do NOT read the figure's current pose — a hand posed finger
// by finger has no single "fistness" — so they sit at their rest positions
// until touched, and the host only shapes the pose once one moves. The
// trash returns this part's sliders to rest (one undo step), the same
// reset-rather-than-delete the Opacity and Stroke bars use.

export function RigPoseBar({ part, values, onChange, onCommit, onBack, onReset }: {
  part: RigPart;
  values: Record<RigSliderKey, number>;
  onChange: (key: RigSliderKey, value: number) => void;
  onCommit: (key: RigSliderKey, value: number) => void;
  onBack: () => void;
  /** Return this part to its rest posture. */
  onReset: () => void;
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
        <Hint>{rigPartHint(part)}</Hint>
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
