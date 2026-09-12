import React from 'react';
import type { BorderModel, BorderPosition } from '../adapter';
import { BarBody, SegmentedRow, SliderRow, ColorSliderRow } from './effectBar';
import type { RGBLike } from '../adapter';

// The Border (stroke) page (design "3a"): Width, Dash, Position — the
// line's own two properties together, then where it sits against the edge.
// It's a sibling of the Drop Shadow page and shares its grammar (see
// effectBar.tsx); the border's colour is the Color page's.
//
// It draws no Radius row. Rounding is a property of the OBJECT, not of the
// outline drawn on it, and it lives with the object: an image's on its
// Image page, a polygonal shape's on its Shape page — both through
// RadiusRow below, which is why that row still lives here. It rides the
// app's own cornerRadius fields, never the border model.
//
// A vector selection reuses this page as its STROKE menu — same rows, same
// ranges — pointed at the path's own stroke instead of a rect around a bbox.
// It drops the rows its subtype has no answer for (Position needs a closed
// path), which is why this is a row toggle rather than a copy of the
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

/** The Radius row: corner rounding as a 0–0.5 fraction of the shorter side.
 *  Lives here because the ranges around it do; it is rendered by the pages
 *  that own the rounding — an image's Image page, a shape's Shape page. */
export function RadiusRow({ cornerRadius, onCornerRadius }: {
  cornerRadius: number;
  onCornerRadius: (radius: number, committed: boolean) => void;
}) {
  return (
    <SliderRow
      label="Radius"
      value={cornerRadius / MAX_CORNER_RADIUS}
      apply={(t, c) => onCornerRadius(t * MAX_CORNER_RADIUS, c)}
    />
  );
}

export function BorderBar({
  border, showPosition = true, labelPosition = true, color, onColor, onOpenColorPicker, onChange, onCommit,
}: {
  border: BorderModel;
  /** The line's own colour, shown as a hue row under Dash. Given with
   *  `onColor` and `onOpenColorPicker` — omit all three and the row is
   *  absent (a page whose host has no colour to offer). */
  color?: RGBLike;
  onColor?: (color: RGBLike, committed: boolean) => void;
  onOpenColorPicker?: () => void;
  /** Render the Position row. Off for a selection with no inside to align a
   *  stroke to (an open path: line, arc, freehand stroke). */
  showPosition?: boolean;
  /** Keep the Position row's label column. Off on both pages that draw
   *  the row — a shape's Stroke and an image's Border — since Inside /
   *  Center / Outside name themselves; the label is left as an option
   *  rather than deleted so the row can be labelled where the words ever
   *  stop speaking for themselves. */
  labelPosition?: boolean;
  onChange: (b: BorderModel) => void;
  onCommit: (b: BorderModel) => void;
}) {
  const set = (patch: Partial<BorderModel>, committed: boolean) =>
    (committed ? onCommit : onChange)({ ...border, ...patch });
  return (
    <BarBody>
      <SliderRow
        label="Width"
        value={border.width / MAX_WIDTH}
        apply={(t, c) => set({ width: t * MAX_WIDTH }, c)}
        readout={{
          text: widthPtText(border.width),
          // A typed number is pt; clamp to the slider's own range so the
          // field can never author a width the slider can't show.
          commit: (n) => set({
            width: Math.min(Math.max(n, 0), MAX_WIDTH * PT_PER_CELL) / PT_PER_CELL,
          }, true),
        }}
      />
      <SliderRow
        label="Dash"
        value={border.dash / MAX_DASH}
        apply={(t, c) => set({ dash: Math.round(t * MAX_DASH) }, c)}
        // The dash is a whole step (0 = solid … MAX_DASH = dots), so the box
        // shows the step, not a percent of the track.
        readout={{
          text: String(Math.round(border.dash)),
          commit: (n) => set({ dash: Math.round(Math.min(Math.max(n, 0), MAX_DASH)) }, true),
        }}
      />
      {/* …then its colour, on the slider's own proportions: the hue wheel
          along the track, the colour under the thumb, and the circle at the
          end opening the full picker for saturation, brightness and alpha.
          It sits with Width and Dash because all three describe the line
          ITSELF; it was a row of the shared Color page, a tab away. */}
      {color && onColor && onOpenColorPicker ? (
        <ColorSliderRow
          label="Color"
          color={color}
          onColor={onColor}
          onOpenPicker={onOpenColorPicker}
        />
      ) : null}
      {/* Position last: the rows above describe the line ITSELF — how thick
          it is drawn, whether it is dashed, what colour it is — and this
          says where that line sits against the shape's edge. */}
      {showPosition ? (
        <SegmentedRow
          label={labelPosition ? 'Position' : undefined}
          options={POSITIONS}
          value={border.position}
          onChange={(position) => set({ position }, true)}
        />
      ) : null}
    </BarBody>
  );
}
