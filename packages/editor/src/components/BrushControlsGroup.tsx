import React from 'react';
import { compSnapStep } from '@/engine/compositionCellMath';
import { BrushControlsPanel, FLOATING_SLIDER_BOTTOM } from '@/editor-ui/components/BrushControlsPanel';
import type { EditorSession } from '../editorSession';
import { brushRadiusScale } from '../paintBrush';
import { pxPerCell } from '../cameraMath';
import type { SliderModeOption } from '../sliderModeMenu';
import { FloatingTargetStrip, SliderModeTarget } from './SliderModeTarget';

type Badge = React.ComponentProps<typeof SliderModeTarget>['badge'];

// Brush controls: while any colours-group brush is armed — the recolour brush
// as much as the raster four — the size + strength sliders stand where the
// properties panel does: the panel slides out (the shell suppresses it for an
// armed brush) and these bounce in. Suppressed by the same overlays that
// suppress the panel, so the bottom-center strip has exactly one occupant.
//
// Strength IS the color picker's Opacity — one brush setting with two ways in,
// so the slider and the picker can never disagree about how much paint the
// next stroke lays down. Every brush shows ONE row, switched by the mode
// target beside it (paintSliderMode): Size, or — for the brushes that have a
// per-stroke opacity — the Strength row that edits that same shared value.
// Erase and blur used to stack a second Strength slider under Size; they reach
// it through the Opacity mode now, exactly as paint does. COLOR reads both:
// its pass blends at the same strength and spans the same radius, so the one
// row means to it what it means to paint.
//
// PUSH stays on Size alone: how hard it pushes is an app setting
// (rigPushStrength — a developer slider in Settings), one knob for every kind
// of thing it moves. Its Size is the same Size, because it is the same brush.
//
// `brushChromeUp` is the one thing the three apps do NOT agree on, and it is
// why this is a prop rather than the expression it replaced: CozyJournal and
// Sol raise this chrome on `brushToolActive && !editingTextId`, DrawBots on
// its own `brushSliderUp`. The panel and the mode target share the single
// condition because they are one piece of chrome in two parts — a target
// standing beside an absent slider names nothing.
export function BrushControlsGroup({
  brushChromeUp, brushSize, colorBrushOpacity, paintOpacityMode,
  setBrushSize, setColorBrushOpacity, session, insets,
  paintMenuOptions, brushBlendBadge, paintMenuLitKeys, onPaintRadialPick, openRadialCapsule,
}: {
  brushChromeUp: boolean;
  brushSize: number;
  colorBrushOpacity: number;
  paintOpacityMode: boolean;
  setBrushSize: (size: number) => void;
  setColorBrushOpacity: (opacity: number) => void;
  session: EditorSession | null;
  insets: { bottom: number };
  paintMenuOptions: SliderModeOption[];
  brushBlendBadge: Badge;
  paintMenuLitKeys?: readonly string[];
  onPaintRadialPick: (key: string) => void;
  openRadialCapsule: (fan: 'paint-blend' | 'paint-color') => void;
}) {
  return (
    <>
      <BrushControlsPanel
        model={{
          visible: brushChromeUp,
          size: brushSize,
          strength: colorBrushOpacity,
          // The one row: Strength while the mode target stands on Opacity
          // (paint / erase / blur), Size otherwise. It keeps the row's
          // own word, Strength: with blend modes damping how hard a dab
          // lands, "strength" is what the value FEELS like, and "Opacity"
          // promised a transparency the blends don't deliver.
          showStrength: paintOpacityMode,
          showSize: !paintOpacityMode,
          onSize: setBrushSize,
          onStrength: setColorBrushOpacity,
          // The preview disc's radius, in screen px, for the value the
          // handle is at — the same radius the stroke itself will use
          // (CanvasSurface: one grid step, scaled, and the colour brush
          // ignoring the scale), carried through the live camera so what
          // stands over the slider is the mark as it will land on THIS page
          // at THIS zoom.
          sizePreviewRadiusPx: session
            ? (v: number) => compSnapStep(session.state.gridLevel)
              * brushRadiusScale(v)
              * pxPerCell(session.state.camera, session.state.viewport)
            : undefined,
        }}
        safeBottom={insets.bottom}
      />
      {/* The brush slider's mode target: the empty circle in the lower
          right — on the undo/redo column's vertical line, level with the
          one slider row — whose radial menu picks what that slider means.
          EVERY brush in the group raises it (erase / blur / push used to
          hide it), each fanning its own menu (brushSliderModes): color's
          Opacity, Size and Blend; the raster brushes' Opacity and Size
          (push: Size) plus the paintbrush that calls their capsule up. The strip
          mirrors BrushControlsPanel's own seat (bottom margin + one row
          height) so the circle and the slider handle stand on one line. Rig
          pages grow the same target inside RigControlsPanel. */}
      {brushChromeUp ? (
        <FloatingTargetStrip bottom={insets.bottom + FLOATING_SLIDER_BOTTOM}>
          <SliderModeTarget
            options={paintMenuOptions}
            // Clamped through paintOpacityMode: a stale Opacity pick from
            // another brush reads as Size on push, whose menu has no
            // Opacity to light (brushHasOpacity).
            activeKey={paintOpacityMode ? 'opacity' : 'size'}
            // The blend mode, worn on the ring's edge as a disc of the
            // colour in hand. The ring's glyph says what the SLIDER drives
            // and nothing says what a dab will do to the paint already
            // under it — and the mode is armed from inside this very menu
            // (the Blend capsule) or the picker's grid, so the corner used
            // to look identical whichever mode was on. Only the brushes
            // that HAVE a blend carry it: erase, blur and push do not
            // blend, and a badge there would name a setting their strokes
            // ignore. Normal wears nothing — that is how "no mode" reads.
            badge={brushBlendBadge}
            litKeys={paintMenuLitKeys}
            onSelect={onPaintRadialPick}
            onOpenChildren={(parent) => openRadialCapsule(
              parent === 'blend' ? 'paint-blend' : 'paint-color',
            )}
          />
        </FloatingTargetStrip>
      ) : null}
    </>
  );
}
