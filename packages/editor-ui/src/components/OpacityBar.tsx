import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { OpacityModel } from '../adapter';
import {
  BAR_BORDER, BAR_CONTROLS_TOP, BAR_PAD_BOTTOM, BAR_PAD_HORIZONTAL, BAR_PAD_TOP, ROW_GAP,
} from '../logic/submenuHeight';
import { BAR_BG, EffectBarHeader, HAIRLINE, SliderRow } from './effectBar';

// The Opacity editing bar: a full-width light bar with a header (chevron ·
// OPACITY · trash) and two rows — Opacity (the whole object's render opacity)
// and Soften (how far the edges fade to transparent: 0 = hard edges, 1 = the
// object is transparent toward its edges). Shared by images and the closed
// vector shapes (rectangle / circle); there is no color, so no swatch. The
// trash resets both rows to their defaults (fully opaque, hard edges) rather
// than deleting anything — like the Stroke bar's reset-to-default trash.
//
// Both sliders map 0–1 directly, so unlike the Border bar there are no range
// constants to keep in sync with the app.

export function OpacityBar({ opacity, onChange, onCommit, onBack, onRemove }: {
  opacity: OpacityModel;
  onChange: (o: OpacityModel) => void;
  onCommit: (o: OpacityModel) => void;
  onBack: () => void;
  /** Reset to fully opaque, hard edges (one undo step). */
  onRemove: () => void;
}) {
  const set = (patch: Partial<OpacityModel>, committed: boolean) =>
    (committed ? onCommit : onChange)({ ...opacity, ...patch });
  return (
    <View style={styles.bar}>
      <EffectBarHeader
        title="OPACITY"
        chevron
        removeLabel="Reset opacity"
        onBack={onBack}
        onRemove={onRemove}
      />
      <View style={styles.controls}>
        <SliderRow label="Opacity" value={opacity.opacity} apply={(t, c) => set({ opacity: t }, c)} />
        <SliderRow label="Soften" value={opacity.edgeSoften} apply={(t, c) => set({ edgeSoften: t }, c)} />
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
  // 10pt header→controls gap; rows self-space (32pt tall) with a 2pt gap.
  controls: { marginTop: BAR_CONTROLS_TOP, gap: ROW_GAP },
});
