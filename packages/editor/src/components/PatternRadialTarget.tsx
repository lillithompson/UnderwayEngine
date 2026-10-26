import React from 'react';
import type { PatternSubTool } from '@/engine/patternObject';
import type { SliderModeOption } from '../sliderModeMenu';
import {
  tileChooseKeyOf, type PatternFillValueMode, type TileChoosePick,
} from '../patternToolSwitch';
import { floatingSlotAnchor } from './PatternActionsCapsule';
import { FloatingTargetStrip, SliderModeTarget } from './SliderModeTarget';

// …and the pattern tool's brush picker: Random | Erase | Close as the
// lower-right RADIAL (SliderModeTarget — the same control the raster paint
// sliders wear), what a touch on the OPEN grid does. It rides edit mode, not
// the tool (patternRadialUp), so it arrives and leaves with the grid actions
// rather than standing in the corner from the moment the tool is picked; the
// arrival reset seats it on Random, the radial's default.
//
// ONE control serves two radials — the tile tool's and a shape fill's — and
// `patternEditIsShapeFill` picks between them at every point: the options, the
// active key and the commit. A second component would be the same tree twice.
export function PatternRadialTarget({
  patternRadialUp, panelOccludedPx, insets,
  patternEditIsShapeFill, patternFillRadialOptions, tileRadialOptions, tileRadialRingArt,
  patternFillValueMode, patternSubTool, tileRadialPicks,
  onPatternFillRadialPick, onTileRadialPick, openRadialCapsule,
}: {
  patternRadialUp: boolean;
  panelOccludedPx: number;
  insets: { bottom: number };
  patternEditIsShapeFill: boolean;
  patternFillRadialOptions: SliderModeOption[];
  tileRadialOptions: SliderModeOption[];
  tileRadialRingArt?: { uri: string; rotate?: number } | null;
  patternFillValueMode: PatternFillValueMode | null;
  patternSubTool: PatternSubTool;
  tileRadialPicks: readonly TileChoosePick[];
  onPatternFillRadialPick: (key: string) => void;
  onTileRadialPick: (key: string) => void;
  openRadialCapsule: (which: 'pattern-symmetry' | 'tile-choose') => void;
}) {
  return (
    <>
      {patternRadialUp ? (
        // The shared floating-slot seat: the strip rides above the
        // object-properties panel exactly as the Flood/Close/Clear
        // capsule does — floatingSlotAnchor is the ONE formula every
        // occupant of that slot stands on, so the radial target
        // stays level with the capsule wherever the panel pushes them,
        // at the capsule's own pace.
        <FloatingTargetStrip bottom={floatingSlotAnchor(panelOccludedPx, insets.bottom)} animated>
          <SliderModeTarget
            options={patternEditIsShapeFill ? patternFillRadialOptions : tileRadialOptions}
            ringArt={tileRadialRingArt}
            // What the ring names: the value the slider is pointed at
            // where one is armed (a fill's Size or Resolution), else the
            // tile in hand, else the brush — the same reading in both
            // radials, each naming whatever its own last pick was.
            activeKey={patternEditIsShapeFill && patternFillValueMode
              ? patternFillValueMode
              : patternSubTool.kind === 'tile'
                ? tileChooseKeyOf(
                    tileRadialPicks, patternSubTool.spriteId, patternSubTool.transform,
                  ) ?? 'tile'
                : patternEditIsShapeFill ? 'choose' : patternSubTool.kind}
            onSelect={patternEditIsShapeFill ? onPatternFillRadialPick : onTileRadialPick}
            onOpenChildren={(key) => openRadialCapsule(
              key === 'symmetry' ? 'pattern-symmetry' : 'tile-choose',
            )}
          />
        </FloatingTargetStrip>
      ) : null}
    </>
  );
}
