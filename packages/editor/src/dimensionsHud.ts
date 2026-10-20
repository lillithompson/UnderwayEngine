import { compSnapStep } from '@/engine/compositionCellMath';
import type { CellBbox } from './resizeMath';

// Dimensions HUD placement math, ported from Facet's CompositionOverlays
// (the "Dimensions" View Settings toggle). Sizes read in *visible grid
// squares*, not engine cells: one square at gridLevel L spans
// compSnapStep(L) = 2^L cells, so a raw cell size is divided by that step
// before it is formatted.
//
// Facet anchors the label by the edge the finger is dragging (it knows the
// grabbed corner). CozyJournal's gestures don't all carry a corner, so the
// rule here is simpler and derived from the box alone: centered inside the
// box, except for a degenerate axis (a pure horizontal / vertical line
// draft), where "N × 0" is noise — those show the one changing dimension,
// nudged clear of the line so the stroke stays visible underneath.

/** Cell extent below which an axis counts as flat (a straight line draft). */
const FLAT_EPS_CELLS = 1e-6;

/** Screen-px gap between a flat draft's line and its label. */
export const DIM_HUD_EDGE_PAD = 10;

export type HAnchor = 'left' | 'center' | 'right';
export type VAnchor = 'top' | 'middle' | 'bottom';

export interface DimensionsHudPlacement {
  /** Screen-space anchor point, in container px. */
  x: number;
  y: number;
  text: string;
  hAnchor: HAnchor;
  vAnchor: VAnchor;
}

/** Whole numbers render without a decimal; a non-integer (sub-square size at
 *  a coarse grid level) renders with one decimal, so a half-square line shows
 *  "0.5". Ported verbatim from Facet's formatGridDim. */
export function formatGridDim(value: number): string {
  if (Math.abs(value - Math.round(value)) < 1e-6) return String(Math.round(value));
  return value.toFixed(1);
}

/**
 * Where and what the Dimensions HUD draws for a live gesture box.
 *
 * `bbox` is the gesture's live box in world cells; `screen` is that same box
 * projected to container px (top-left + size). Returns null when the box has
 * no extent at all — there is nothing to label.
 */
export function dimensionsHudPlacement(
  bbox: CellBbox,
  screen: { left: number; top: number; width: number; height: number },
  gridLevel: number,
): DimensionsHudPlacement | null {
  const step = compSnapStep(gridLevel);
  const flatX = Math.abs(bbox.cellWidth) < FLAT_EPS_CELLS;
  const flatY = Math.abs(bbox.cellHeight) < FLAT_EPS_CELLS;
  if (flatX && flatY) return null;

  const w = formatGridDim(bbox.cellWidth / step);
  const h = formatGridDim(bbox.cellHeight / step);

  if (flatY) {
    // Horizontal line: only the width changes. Sit above the stroke.
    return {
      x: screen.left + screen.width / 2,
      y: screen.top - DIM_HUD_EDGE_PAD,
      text: w,
      hAnchor: 'center',
      vAnchor: 'bottom',
    };
  }
  if (flatX) {
    // Vertical line: only the height changes. Sit to the right of the stroke.
    return {
      x: screen.left + screen.width + DIM_HUD_EDGE_PAD,
      y: screen.top + screen.height / 2,
      text: h,
      hAnchor: 'left',
      vAnchor: 'middle',
    };
  }
  return {
    x: screen.left + screen.width / 2,
    y: screen.top + screen.height / 2,
    text: `${w} × ${h}`,
    hAnchor: 'center',
    vAnchor: 'middle',
  };
}

/** The two-finger twist's readout: the object's live rotation angle to one
 *  decimal place, wearing the degree sign — "23.5°". Normalized to
 *  (−180, 180] so a multi-turn twist reads as the pose the object is IN,
 *  not the path the fingers took to it, and a hair under a full turn reads
 *  "−0.5°" rather than "359.5°". `-0.0` collapses to `0.0` — a twist that
 *  settled home is home. */
export function rotationHudText(deg: number): string {
  let d = ((deg % 360) + 360) % 360;
  if (d > 180) d -= 360;
  const text = d.toFixed(1);
  return `${text === '-0.0' ? '0.0' : text}°`;
}

/** CSS transform that pulls a label of unknown size onto its anchor point —
 *  percentage translates, so the HUD never has to be measured (Facet measures
 *  via onLayout because React Native has no percentage transform). */
export function dimensionsHudTransform(hAnchor: HAnchor, vAnchor: VAnchor): string {
  const tx = hAnchor === 'right' ? -100 : hAnchor === 'center' ? -50 : 0;
  const ty = vAnchor === 'bottom' ? -100 : vAnchor === 'middle' ? -50 : 0;
  return `translate(${tx}%, ${ty}%)`;
}
