import React from 'react';
import { StyleSheet, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { AlignEdge } from '../adapter';
import type { AlignOption } from '../logic/layout';
import { HORIZONTAL_ALIGN_OPTIONS, VERTICAL_ALIGN_OPTIONS } from '../logic/layout';
import {
  BAR_BORDER, BAR_CONTROLS_TOP, BAR_PAD_BOTTOM, BAR_PAD_HORIZONTAL, BAR_PAD_TOP, ROW_GAP,
} from '../logic/submenuHeight';
import { ActionRow, BAR_BG, EffectBarHeader, HAIRLINE } from './effectBar';

// The Layout bar: where a MULTI-selection's members sit relative to each
// other. A sibling of the Stroke / Fill / Endpoints bars sharing their chrome
// (see effectBar.tsx), with two rows — Horizontal pushes every member to the
// left edge, the centre line, or the right edge of the selection's combined
// box; Vertical does the same top / middle / bottom.
//
// No color swatch in the header (nothing here is colored) and no trash: an
// align has no state to remove — undo is the way back, the same as any other
// move. Every control is an action rather than a pick, so the cells light only
// while held (ActionRow) and each tap is one finished edit, i.e. one undo
// step — which is why `onAlign` takes no `committed` flag.

type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** An align option as a row cell: the edge is the value, the glyph is the
 *  whole label (the written name stays on for accessibility). The tables keep
 *  `icon` a plain string so they stay pure of react-native, so the widening
 *  happens here — once, at module load, rather than on every render. */
const toCell = (o: AlignOption) => ({ value: o.edge, label: o.label, icon: o.icon as MCIName });
const H_CELLS = HORIZONTAL_ALIGN_OPTIONS.map(toCell);
const V_CELLS = VERTICAL_ALIGN_OPTIONS.map(toCell);

export function LayoutBar({ onAlign, onBack }: {
  /** Fires once per tap — an align is always a finished edit. */
  onAlign: (edge: AlignEdge) => void;
  onBack: () => void;
}) {
  return (
    <View style={styles.bar}>
      <EffectBarHeader title="LAYOUT" chevron onBack={onBack} />
      <View style={styles.controls}>
        <ActionRow label="Horizontal" options={H_CELLS} onPress={onAlign} />
        <ActionRow label="Vertical" options={V_CELLS} onPress={onAlign} />
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
  // Matches the Endpoints / Border bars: 10pt header→controls gap, rows
  // self-space.
  controls: { marginTop: BAR_CONTROLS_TOP, gap: ROW_GAP },
});
