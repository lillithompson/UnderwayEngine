// Pure model + math for the image Tint bar (design 6a): the Type / Blend option
// lists, the design defaults, and the gradient-stop editing that the bar's
// interactive stop bar drives (move / select / add / delete). Kept free of
// react-native and the engine so it's unit-tested in node; the TintBar
// component only owns rendering + gesture wiring.

import type { TintBlend, TintModel, TintStop, TintType } from '../adapter';
import { rgbCss } from './hsv';

// ── Option lists ─────────────────────────────────────────────────────

/** Type segmented control, in display order. Default Linear. */
export const TINT_TYPES: readonly { value: TintType; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'linear', label: 'Linear' },
  { value: 'radial', label: 'Radial' },
];

/** Blend modes for the blend sheet, in the design's fixed order. The list is a
 *  sheet (not a segmented control) so modes can be added later without a
 *  redesign. Default Multiply. */
export const TINT_BLENDS: readonly { value: TintBlend; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'soft-light', label: 'Soft Light' },
  { value: 'color', label: 'Color' },
  { value: 'hue', label: 'Hue' },
  { value: 'saturation', label: 'Saturation' },
];

/** Human label for a blend mode (the pill value + sheet rows). */
export const tintBlendLabel = (blend: TintBlend): string =>
  TINT_BLENDS.find((m) => m.value === blend)?.label ?? blend;

/** Angle slider range (degrees). */
export const TINT_ANGLE_MAX = 360;

// ── Defaults ─────────────────────────────────────────────────────────
// type linear · solid #123047 · stops [#2E1A3D@0, #FF9F0A@100] · angle 90 ·
// opacity 50% · blend normal (opacity + blend overriding the design's 70% /
// multiply per the app's preference).
export const DEFAULT_TINT_MODEL: TintModel = {
  type: 'linear',
  solid: { r: 0x12, g: 0x30, b: 0x47 },
  stops: [
    { position: 0, color: { r: 0x2e, g: 0x1a, b: 0x3d } },
    { position: 1, color: { r: 0xff, g: 0x9f, b: 0x0a } },
  ],
  selectedStop: 0,
  angle: 90,
  opacity: 0.5,
  blend: 'normal',
};

// ── Stop editing ─────────────────────────────────────────────────────

const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));

/** Clamp to 0…1 and quantize to the design's whole-percent granularity. */
export const roundStopPosition = (p: number): number =>
  clamp01(Math.round(clamp01(p) * 100) / 100);

/** Stops ordered by position (a copy). The stop bar always paints a left→right
 *  ramp of the stops — in both Linear and Radial modes — because it is a
 *  positional editor, so callers sort for rendering while the model keeps its
 *  original array order (so `selectedStop` indices stay stable across drags). */
export const sortedStops = (stops: readonly TintStop[]): TintStop[] =>
  [...stops].sort((a, b) => a.position - b.position);

/** Index of the stop nearest `position` (0…1) — touch-down selects it. */
export function nearestStopIndex(tint: TintModel, position: number): number {
  let best = 0;
  let bestDist = Infinity;
  tint.stops.forEach((s, i) => {
    const d = Math.abs(s.position - position);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

/** Move stop `index` to `position` (clamped + quantized) and select it. Array
 *  order is preserved so the index stays valid mid-drag. */
export function moveStop(tint: TintModel, index: number, position: number): TintModel {
  const pos = roundStopPosition(position);
  const stops = tint.stops.map((s, i) => (i === index ? { ...s, position: pos } : s));
  return { ...tint, stops, selectedStop: index };
}

/** Whether the trash is enabled — two stops is the minimum. */
export const canRemoveStop = (tint: TintModel): boolean => tint.stops.length > 2;

/** Add a stop midway between the outermost stops, inheriting the first stop's
 *  color, and select it (the caller follows with the color picker). */
export function addStop(tint: TintModel): TintModel {
  const positions = tint.stops.map((s) => s.position);
  const mid = (Math.min(...positions) + Math.max(...positions)) / 2;
  const color = tint.stops[0]?.color ?? { r: 255, g: 255, b: 255 };
  const stops = [...tint.stops, { position: roundStopPosition(mid), color }];
  return { ...tint, stops, selectedStop: stops.length - 1 };
}

/** Delete the selected stop (no-op below the 2-stop minimum); the selection
 *  clamps back into range. */
export function removeStop(tint: TintModel): TintModel {
  if (!canRemoveStop(tint)) return tint;
  const stops = tint.stops.filter((_, i) => i !== tint.selectedStop);
  return { ...tint, stops, selectedStop: Math.min(tint.selectedStop, stops.length - 1) };
}

// ── Rendering helpers ────────────────────────────────────────────────

/** Colors + locations for an `expo-linear-gradient` rendering the stop ramp,
 *  ascending. Drives the stop bar's fill and the linear header-swatch preview.
 *  `locations` are the sorted stop positions (0…1); both arrays share length
 *  (≥ 2, matching the stop minimum). */
export function rampGradient(stops: readonly TintStop[]): { colors: string[]; locations: number[] } {
  const sorted = sortedStops(stops);
  return {
    colors: sorted.map((s) => rgbCss(s.color)),
    locations: sorted.map((s) => clamp01(s.position)),
  };
}
