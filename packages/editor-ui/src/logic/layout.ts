// The Layout submenu the ObjectPropertiesPanel offers a MULTI-selection: the
// six alignment actions that push every selected object to one edge (or the
// centre line) of the selection's combined box. Kept pure (no react-native)
// so the option order and the axis split are unit-tested in node; the bar
// component only owns the chrome.
//
// Layout is the one type-option that needs nothing of its members but their
// boxes, so unlike Tint / Stroke / Type it is offered whatever the selection
// is made of — a mixed image + shape + text multi-selection still aligns.

import type { AlignEdge } from '../adapter';

export interface AlignOption {
  edge: AlignEdge;
  /** Accessibility name (the bar labels these with icons only). */
  label: string;
  /** MaterialCommunityIcons glyph name. */
  icon: string;
}

/** The horizontal row, in display order: left → center → right. */
export const HORIZONTAL_ALIGN_OPTIONS: readonly AlignOption[] = [
  { edge: 'left', label: 'Align left', icon: 'align-horizontal-left' },
  { edge: 'center', label: 'Align center', icon: 'align-horizontal-center' },
  { edge: 'right', label: 'Align right', icon: 'align-horizontal-right' },
];

/** The vertical row, in display order: top → middle → bottom. */
export const VERTICAL_ALIGN_OPTIONS: readonly AlignOption[] = [
  { edge: 'top', label: 'Align top', icon: 'align-vertical-top' },
  { edge: 'middle', label: 'Align middle', icon: 'align-vertical-center' },
  { edge: 'bottom', label: 'Align bottom', icon: 'align-vertical-bottom' },
];

/** Which axis an edge moves things along — 'h' for the left/center/right
 *  three, 'v' for top/middle/bottom. The host reads this to know which of a
 *  member's two deltas is non-zero (an align never moves both axes). */
export function alignAxis(edge: AlignEdge): 'h' | 'v' {
  return edge === 'left' || edge === 'center' || edge === 'right' ? 'h' : 'v';
}

/**
 * Where a member of `span` length lands inside a combined box of `boxSpan`
 * length starting at `boxStart`, for one axis. Returns the member's new start
 * coordinate: flush to the low edge, centred, or flush to the high edge.
 * `position` is 0 = low edge (left / top), 0.5 = centre, 1 = high edge
 * (right / bottom) — the same number for both axes, which is why the six
 * actions need only this one function.
 */
export function alignedStart(
  boxStart: number,
  boxSpan: number,
  span: number,
  position: number,
): number {
  return boxStart + (boxSpan - span) * position;
}

/** The 0 / 0.5 / 1 position an edge aligns to along its axis. */
export function alignPosition(edge: AlignEdge): number {
  switch (edge) {
    case 'left':
    case 'top':
      return 0;
    case 'center':
    case 'middle':
      return 0.5;
    default:
      return 1;
  }
}
