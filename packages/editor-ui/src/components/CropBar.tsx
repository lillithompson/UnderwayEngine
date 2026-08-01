import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { FramingModel, ImageCropRatio, ImageFramingMode } from '../adapter';
import { BAR_BG, EffectBarHeader, HAIRLINE, Hint, SegmentedRow, SliderRow } from './effectBar';

// The Crop / framing bar (design "4a"): a full-width dark bar with a header
// (chevron · CROP · trash) and a Mode segmented row (Fill / Fit / Crop / Tile)
// plus the rows that mode needs. A sibling of the Drop Shadow / Border bars —
// same container + row grammar (see effectBar.tsx). No color swatch. The trash
// resets framing to its defaults. On-canvas crop-rect handles + panning are
// canvas-side (deferred); this bar sets mode, zoom, margin, ratio, straighten,
// tile size and spacing.

// ── Ranges (world cells for lengths; the design's pt/percent → these) ─
const ZOOM_MIN = 1; // 100%
const ZOOM_MAX = 3; // 300%
const MARGIN_MAX = 2.5; // 40pt ÷ 16
const ANGLE_MAX = 45; // ±45°
const TILE_GAP_MAX = 1.5; // 24pt ÷ 16

const MODES: readonly { value: ImageFramingMode; label: string }[] = [
  { value: 'fill', label: 'Fill' },
  { value: 'fit', label: 'Fit' },
  { value: 'crop', label: 'Crop' },
  { value: 'tile', label: 'Tile' },
];

const RATIOS: readonly { value: ImageCropRatio; label: string }[] = [
  { value: 'free', label: 'Free' },
  { value: 'square', label: '1:1' },
  { value: 'fourFive', label: '4:5' },
  { value: 'sixteenNine', label: '16:9' },
];

export function CropBar({ framing, onChange, onCommit, onBack, onReset }: {
  framing: FramingModel;
  /** Live preview (slider drag). */
  onChange: (f: FramingModel) => void;
  /** Commit as one undo step (slider release, mode / ratio change). */
  onCommit: (f: FramingModel) => void;
  onBack: () => void;
  /** Reset framing to defaults (trash); the bar stays open. */
  onReset: () => void;
}) {
  const set = (patch: Partial<FramingModel>, committed: boolean) =>
    (committed ? onCommit : onChange)({ ...framing, ...patch });
  return (
    <View style={styles.bar}>
      <EffectBarHeader
        title="CROP"
        chevron
        removeLabel="Reset framing"
        onBack={onBack}
        onRemove={onReset}
      />
      <View style={styles.controls}>
        <SegmentedRow
          label="Mode"
          options={MODES}
          value={framing.mode}
          onChange={(mode) => set({ mode }, true)}
        />
        {framing.mode === 'fill' ? (
          <>
            <SliderRow
              label="Zoom"
              value={(framing.zoom - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)}
              apply={(t, c) => set({ zoom: ZOOM_MIN + t * (ZOOM_MAX - ZOOM_MIN) }, c)}
            />
            <Hint>Drag the artwork on the canvas to reposition it inside the frame.</Hint>
          </>
        ) : null}
        {framing.mode === 'fit' ? (
          <>
            <SliderRow
              label="Margin"
              value={framing.margin / MARGIN_MAX}
              apply={(t, c) => set({ margin: t * MARGIN_MAX }, c)}
            />
            <Hint>Whole artwork stays visible; margin pads it inside the frame.</Hint>
          </>
        ) : null}
        {framing.mode === 'crop' ? (
          <>
            <SegmentedRow
              label="Ratio"
              options={RATIOS}
              value={framing.ratio}
              onChange={(ratio) => set({ ratio }, true)}
            />
            <SliderRow
              label="Straighten"
              value={(framing.angle + ANGLE_MAX) / (2 * ANGLE_MAX)}
              apply={(t, c) => set({ angle: Math.round(-ANGLE_MAX + t * 2 * ANGLE_MAX) }, c)}
            />
          </>
        ) : null}
        {framing.mode === 'tile' ? (
          <>
            <SliderRow
              label="Size"
              value={framing.tileScale}
              apply={(t, c) => set({ tileScale: t }, c)}
            />
            <SliderRow
              label="Spacing"
              value={framing.tileGap / TILE_GAP_MAX}
              apply={(t, c) => set({ tileGap: t * TILE_GAP_MAX }, c)}
            />
          </>
        ) : null}
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
