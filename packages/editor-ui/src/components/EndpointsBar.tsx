import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { EndCapKind, EndMarkerKind, EndpointsModel } from '../adapter';
import {
  BAR_BORDER, BAR_CONTROLS_TOP, BAR_PAD_BOTTOM, BAR_PAD_HORIZONTAL, BAR_PAD_TOP, ROW_GAP,
} from '../logic/submenuHeight';
import { BAR_BG, DualSegmentedRow, EffectBarHeader, HAIRLINE, SegmentedRow } from './effectBar';

// The Endpoints bar: what an OPEN path's two loose ends carry. A sibling of the
// Stroke / Fill bars sharing their chrome (see effectBar.tsx), with three rows —
// Start and End pick that end's marker, and Caps picks both ends' caps side by
// side.
//
// No color swatch in the header: a decorated end is drawn in the path's own
// color, so there is nothing here for a picker to change (the Stroke bar's
// swatch already owns that color). The trash returns both ends to bare and
// round — the default every path is drawn with — rather than deleting anything.
//
// Every control is a segmented pick, so unlike the slider bars there is no
// live-preview / commit split: each tap is one finished edit, i.e. one undo
// step. That is why `onChange` here takes no `committed` flag.

const MARKERS: readonly { value: EndMarkerKind; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'circle', label: 'Circle' },
  { value: 'arrow', label: 'Arrow' },
];

const CAPS: readonly { value: EndCapKind; label: string }[] = [
  { value: 'round', label: 'Round' },
  { value: 'square', label: 'Square' },
];

export function EndpointsBar({ endpoints, onChange, onBack, onRemove }: {
  endpoints: EndpointsModel;
  /** Fires once per tap — a segmented pick is always a finished edit. */
  onChange: (e: EndpointsModel) => void;
  onBack: () => void;
  /** Resets both ends to bare + round. */
  onRemove: () => void;
}) {
  const set = (patch: Partial<EndpointsModel>) => onChange({ ...endpoints, ...patch });
  return (
    <View style={styles.bar}>
      <EffectBarHeader
        title="ENDPOINTS"
        chevron
        removeLabel="Remove endpoints"
        onBack={onBack}
        onRemove={onRemove}
      />
      <View style={styles.controls}>
        <SegmentedRow
          label="Start"
          options={MARKERS}
          value={endpoints.startMarker}
          onChange={(startMarker) => set({ startMarker })}
        />
        <SegmentedRow
          label="End"
          options={MARKERS}
          value={endpoints.endMarker}
          onChange={(endMarker) => set({ endMarker })}
        />
        <DualSegmentedRow
          label="Caps"
          options={CAPS}
          leftLabel="Start"
          leftValue={endpoints.startCap}
          onLeftChange={(startCap) => set({ startCap })}
          rightLabel="End"
          rightValue={endpoints.endCap}
          onRightChange={(endCap) => set({ endCap })}
        />
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
  // Matches the Border / Stroke bar: 10pt header→controls gap, rows self-space.
  controls: { marginTop: BAR_CONTROLS_TOP, gap: ROW_GAP },
});
