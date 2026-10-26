import React from 'react';
import type { PatternGridAction } from '@/editor-ui/logic/patternEdit';
import { PatternActionsCapsule } from './PatternActionsCapsule';

// The whole-grid actions — Flood, Close, Clear, and Flood and Clear alone over
// a SHAPE's pattern fill (patternGridActionsFor) — as a floating capsule in
// the shared bottom slot (floatingSlotAnchor, the one formula every occupant
// of that slot stands on), wearing the floating capsule's chrome.
//
// Up wherever the actions have a target (patternGridActionTarget — the
// selected pattern first, else the one open for editing): while the tile or
// pattern TOOL is in hand over an open grid, and while the pattern OBJECT that
// is open is selected under any tool. With nothing open there is no grid to
// flood, so the capsule stays down rather than standing as dead chrome — and a
// pattern that is merely SELECTED, never opened for editing (or locked out of
// it altogether), is not a target either: its contents are closed to the
// brushes and closed to these actions alike, and the Edit pill in the radial's
// seat is the whole offer until it is opened (gridActionsTargetOpen). Each
// press commits one undo entry (onPatternGridAction). The brush RADIAL that
// sits beneath it on screen (PatternRadialTarget) stays tool-gated instead:
// brushes describe what a canvas touch does, and under Arrange a touch
// selects. "Beneath" is the screen, not this file — the two are siblings in
// the shell's tree and neither contains the other.
//
// The slot is shared, so the two occupants that outrank this one are passed in
// rather than inferred: `rotateSliderUp` and `patternFillSliderUp` each take
// the seat, and the capsule stands down under either.
export function PatternGridActions({
  gridActionsTargetOpen, patternOverlaysUp, selectedPattern, propertiesPanelVisible,
  multiCapsuleUp, rotateSliderUp, patternFillSliderUp,
  insets, panelOccludedPx, patternEditIsShapeFill, onPatternGridAction, patternEditBounce,
}: {
  gridActionsTargetOpen: boolean;
  patternOverlaysUp: boolean;
  /** Only its PRESENCE is read — whether a pattern object is selected. */
  selectedPattern: unknown;
  propertiesPanelVisible: boolean;
  multiCapsuleUp: boolean;
  rotateSliderUp: boolean;
  patternFillSliderUp: boolean;
  insets: { bottom: number };
  panelOccludedPx: number;
  patternEditIsShapeFill: boolean;
  onPatternGridAction: (action: PatternGridAction) => void;
  patternEditBounce?: number;
}) {
  return (
    <>
      {gridActionsTargetOpen
        && (patternOverlaysUp
          || (!!selectedPattern && propertiesPanelVisible && !multiCapsuleUp))
        && !rotateSliderUp && !patternFillSliderUp ? (
        <PatternActionsCapsule
          safeBottom={insets.bottom}
          panelPx={panelOccludedPx}
          shapeFill={patternEditIsShapeFill}
          onAction={onPatternGridAction}
          // …and the capsule bounces as it arrives: a double tap on a
          // pattern opens the grid these actions work on, and this is
          // where the answer to that tap belongs.
          bounceKey={patternEditBounce}
        />
      ) : null}
    </>
  );
}
