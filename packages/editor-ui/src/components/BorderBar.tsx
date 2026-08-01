import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { BorderModel, BorderPosition } from '../adapter';
import { BAR_BG, EffectBarHeader, HAIRLINE, SegmentedRow, SliderRow } from './effectBar';

// The Border (stroke) editing bar (design "3a"): a full-width dark bar with a
// header (chevron · BORDER · color swatch · trash) and four rows — Width,
// Radius, Position, Dash. It's a sibling of the Drop Shadow bar and shares its
// chrome (see effectBar.tsx). The Radius row rounds the object itself (folding
// in the former standalone Round control), so it rides the app's cornerRadius
// fields rather than the border model.

// ── Ranges (world cells; design pt ÷ 16) ─────────────────────────────
const MAX_WIDTH = 1.5; // 0…24pt
const MAX_DASH = 10; // 0 = solid … 10 = dots
// Corner radius is a 0–0.5 fraction of the shorter side (0 = sharp, 0.5 =
// circle for a square) — mirrors the app's MAX_CORNER_RADIUS.
const MAX_CORNER_RADIUS = 0.5;

const POSITIONS: readonly { value: BorderPosition; label: string }[] = [
  { value: 'inside', label: 'Inside' },
  { value: 'center', label: 'Center' },
  { value: 'outside', label: 'Outside' },
];

export function BorderBar({ border, cornerRadius, onChange, onCommit, onCornerRadius, onBack, onRemove, onPickColor }: {
  border: BorderModel;
  /** Object corner rounding, a 0–0.5 fraction of the shorter side. */
  cornerRadius: number;
  onChange: (b: BorderModel) => void;
  onCommit: (b: BorderModel) => void;
  /** Fires the Radius row: `radius` is a 0–0.5 fraction; `committed` marks the
   *  drag release (one undo step) vs. a live preview. */
  onCornerRadius: (radius: number, committed: boolean) => void;
  onBack: () => void;
  onRemove: () => void;
  onPickColor: () => void;
}) {
  const set = (patch: Partial<BorderModel>, committed: boolean) =>
    (committed ? onCommit : onChange)({ ...border, ...patch });
  return (
    <View style={styles.bar}>
      <EffectBarHeader
        title="BORDER"
        color={border.color}
        chevron
        onBack={onBack}
        onRemove={onRemove}
        onPickColor={onPickColor}
      />
      <View style={styles.controls}>
        <SliderRow label="Width" value={border.width / MAX_WIDTH} apply={(t, c) => set({ width: t * MAX_WIDTH }, c)} />
        <SliderRow
          label="Radius"
          value={cornerRadius / MAX_CORNER_RADIUS}
          apply={(t, c) => onCornerRadius(t * MAX_CORNER_RADIUS, c)}
        />
        <SegmentedRow
          label="Position"
          options={POSITIONS}
          value={border.position}
          onChange={(position) => set({ position }, true)}
        />
        <SliderRow
          label="Dash"
          value={border.dash / MAX_DASH}
          apply={(t, c) => set({ dash: Math.round(t * MAX_DASH) }, c)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: BAR_BG,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
    paddingTop: 10,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  // 10pt header→controls gap; rows self-space (32/36pt tall) with a 2pt gap.
  controls: { marginTop: 10, gap: 2 },
});
