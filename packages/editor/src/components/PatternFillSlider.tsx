import React from 'react';
import {
  MAX_SHAPE_PATTERN_SIZE, MAX_SHAPE_PATTERN_SPAN,
  MIN_SHAPE_PATTERN_SIZE, MIN_SHAPE_PATTERN_SPAN,
} from '@/engine/shapePatternFill';
import type { PatternFillValueMode } from '../patternToolSwitch';
import { PatternFillValueSlider } from './PatternFillValueSlider';

// …and the fill radial's VALUE row in that same bottom slot, while Size or
// Resolution is what the corner is pointed at: one floating slider instead of
// the whole-grid capsule, because the slot answers one question at a time and
// this is the question being asked. Picking Symmetry or Choose from the radial
// — or closing the grid — hands the capsule back.
//
// Size and Resolution are ONE row with two readings, not two rows: the mode
// picks the label, the value, the limits and which commit the drag routes to,
// and `key={patternFillValueMode!}` reseats the handle when the mode changes
// so the row never animates between two unrelated scales.
export function PatternFillSlider({
  patternFillSliderUp, patternFillValueMode, patternFillSpan, patternFillResolution,
  insets, panelOccludedPx, applySvgPatternSpan, applySvgPatternSize, patternFillEditIds,
}: {
  patternFillSliderUp: boolean;
  /** Non-null whenever `patternFillSliderUp` — the row is the mode. */
  patternFillValueMode: PatternFillValueMode | null;
  patternFillSpan: number;
  patternFillResolution: number;
  insets: { bottom: number };
  panelOccludedPx: number;
  applySvgPatternSpan: (ids: string[], span: number, committed: boolean) => void;
  applySvgPatternSize: (ids: string[], size: number, committed: boolean) => void;
  patternFillEditIds: () => string[];
}) {
  return (
    <>
      {patternFillSliderUp ? (
        <PatternFillValueSlider
          key={patternFillValueMode!}
          label={patternFillValueMode === 'size' ? 'Size' : 'Resolution'}
          value={patternFillValueMode === 'size' ? patternFillSpan : patternFillResolution}
          min={patternFillValueMode === 'size'
            ? MIN_SHAPE_PATTERN_SPAN : MIN_SHAPE_PATTERN_SIZE}
          max={patternFillValueMode === 'size'
            ? MAX_SHAPE_PATTERN_SPAN : MAX_SHAPE_PATTERN_SIZE}
          safeBottom={insets.bottom}
          panelPx={panelOccludedPx}
          onValue={(next, committed) => (patternFillValueMode === 'size'
            ? applySvgPatternSpan(patternFillEditIds(), next, committed)
            : applySvgPatternSize(patternFillEditIds(), next, committed))}
        />
      ) : null}
    </>
  );
}
