import React from 'react';
import type { FramingModel, ImageCropRatio, ImageFramingMode } from '../adapter';
import { BarBody, Hint, SegmentedRow, SliderRow } from './effectBar';

// The Crop / framing page (design "4a"): the Fill / Fit / Crop / Tile mode
// row — unlabelled, the four words name it — plus the rows that mode needs.
// A sibling of the Drop Shadow / Border pages, sharing their row grammar (see
// effectBar.tsx). No color swatch, and nothing to remove (framing is tuned
// in place). Swapping the image's pixels is not here either: Replace rides
// the host's floating capsule, and the source resolution is no longer
// captioned. On-canvas crop-rect handles + panning are canvas-side
// (deferred); this page sets mode, zoom, margin, ratio, straighten, tile
// size and spacing.

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

export function CropBar({ framing, onChange, onCommit }: {
  framing: FramingModel;
  /** Live preview (slider drag). */
  onChange: (f: FramingModel) => void;
  /** Commit as one undo step (slider release, mode / ratio change). */
  onCommit: (f: FramingModel) => void;
}) {
  const set = (patch: Partial<FramingModel>, committed: boolean) =>
    (committed ? onCommit : onChange)({ ...framing, ...patch });
  return (
    <BarBody>
      <SegmentedRow
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
            readout={{
              text: `${Math.round(framing.zoom * 100)}%`,
              commit: (n) => set({ zoom: Math.min(Math.max(n / 100, ZOOM_MIN), ZOOM_MAX) }, true),
            }}
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
            readout={{
              text: `${Math.round(framing.angle)}°`,
              commit: (n) => set({ angle: Math.round(Math.min(Math.max(n, -ANGLE_MAX), ANGLE_MAX)) }, true),
            }}
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
    </BarBody>
  );
}
