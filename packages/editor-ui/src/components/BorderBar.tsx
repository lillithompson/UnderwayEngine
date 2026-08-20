import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { BorderModel, BorderPosition } from '../adapter';
import {
  BAR_BORDER, BAR_CONTROLS_TOP, BAR_PAD_BOTTOM, BAR_PAD_HORIZONTAL, BAR_PAD_TOP, ROW_GAP,
} from '../logic/submenuHeight';
import { BAR_BG, EffectBarHeader, HAIRLINE, SegmentedRow, SliderRow } from './effectBar';

// The Border (stroke) editing bar (design "3a"): a full-width light bar with a
// header (chevron · BORDER · color swatch · trash) and four rows — Width,
// Radius, Position, Dash. It's a sibling of the Drop Shadow bar and shares its
// chrome (see effectBar.tsx). The Radius row rounds the object itself (folding
// in the former standalone Round control), so it rides the app's cornerRadius
// fields rather than the border model.
//
// A vector selection reuses this bar as its STROKE menu — same rows, same
// ranges, same chrome — pointed at the path's own stroke instead of a rect
// around a bbox. It overrides the title and drops the rows its subtype has no
// answer for (Position needs a closed path; Radius is a rectangle control),
// which is why this is a `title` + two row toggles rather than a copy of the
// component. Width and Dash are universal and always render.

// ── Ranges (world cells; design pt ÷ 16) ─────────────────────────────
const MAX_WIDTH = 1.5; // 0…24pt
const MAX_DASH = 10; // 0 = solid … 10 = dots
/** Design pt per world cell — the unit the ranges above are stated in, and
 *  the one the Width readout speaks. */
const PT_PER_CELL = 16;

/** The Width readout's text: the stroke width in design pt, to one decimal,
 *  trailing zero dropped (5, not 5.0). */
function widthPtText(widthCells: number): string {
  return String(Math.round(widthCells * PT_PER_CELL * 10) / 10);
}
// Corner radius is a 0–0.5 fraction of the shorter side (0 = sharp, 0.5 =
// circle for a square) — mirrors the app's MAX_CORNER_RADIUS.
const MAX_CORNER_RADIUS = 0.5;

const POSITIONS: readonly { value: BorderPosition; label: string }[] = [
  { value: 'inside', label: 'Inside' },
  { value: 'center', label: 'Center' },
  { value: 'outside', label: 'Outside' },
];

export function BorderBar({ border, cornerRadius, title = 'BORDER', showRadius = true, showPosition = true, showWidthValue = false, onChange, onCommit, onCornerRadius, onBack, onRemove, onPickColor }: {
  border: BorderModel;
  /** Object corner rounding, a 0–0.5 fraction of the shorter side. */
  cornerRadius: number;
  /** Header title. Defaults to BORDER; a vector selection passes STROKE. */
  title?: string;
  /** Render the Radius row. Off for a selection whose corners aren't roundable
   *  (every vector subtype except a rectangle). */
  showRadius?: boolean;
  /** Render the Position row. Off for a selection with no inside to align a
   *  stroke to (an open path: line, arc, freehand stroke). */
  showPosition?: boolean;
  /** Render the Width slider's tap-to-type readout (design pt). On for the
   *  STROKE variant — every type with a Stroke option gets the number. */
  showWidthValue?: boolean;
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
        title={title}
        color={border.color}
        chevron
        onBack={onBack}
        onRemove={onRemove}
        onPickColor={onPickColor}
      />
      <View style={styles.controls}>
        <SliderRow
          label="Width"
          value={border.width / MAX_WIDTH}
          apply={(t, c) => set({ width: t * MAX_WIDTH }, c)}
          readout={showWidthValue ? {
            text: widthPtText(border.width),
            // A typed number is pt; clamp to the slider's own range so the
            // field can never author a width the slider can't show.
            commit: (n) => set({
              width: Math.min(Math.max(n, 0), MAX_WIDTH * PT_PER_CELL) / PT_PER_CELL,
            }, true),
          } : undefined}
        />
        {showRadius ? (
          <SliderRow
            label="Radius"
            value={cornerRadius / MAX_CORNER_RADIUS}
            apply={(t, c) => onCornerRadius(t * MAX_CORNER_RADIUS, c)}
          />
        ) : null}
        {showPosition ? (
          <SegmentedRow
            label="Position"
            options={POSITIONS}
            value={border.position}
            onChange={(position) => set({ position }, true)}
          />
        ) : null}
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
    borderTopWidth: BAR_BORDER,
    borderTopColor: HAIRLINE,
    paddingTop: BAR_PAD_TOP,
    paddingHorizontal: BAR_PAD_HORIZONTAL,
    paddingBottom: BAR_PAD_BOTTOM,
  },
  // 10pt header→controls gap; rows self-space (32/36pt tall) with a 2pt gap.
  controls: { marginTop: BAR_CONTROLS_TOP, gap: ROW_GAP },
});
