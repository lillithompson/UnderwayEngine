import React, { useCallback, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { EyedropperOverlay } from '@/editor-ui';
import type { CompositionState, RGBColor } from '@/engine/types';
import { screenToWorld } from '../cameraMath';
import { sampleEditorColor, type CanvasSnapshot } from '@/editor/eyedropperSample';

// Facet's eyedropper loupe over CozyJournal's canvas: a draggable ring painted
// in the color under its crosshair, dismissed by a press outside it — which
// commits that color, exactly as in Facet (CompositionEditor's
// handleEyedropperDismiss feeds the sample straight to the color confirm).
//
// It owns the sampled color as LOCAL state on purpose. The ring re-renders on
// every pointer move of the drag; EditorShell must not. Keeping the state here
// means a drag re-renders this component and the ring, and nothing else.

export interface EyedropperLayerProps {
  /** Live composition state — the camera to project through, and the scene the
   *  fallback sampler hit-tests. */
  state: CompositionState;
  /** The rasterized canvas, filled in asynchronously after arming. A ref, not a
   *  prop value, so its arrival doesn't re-render (the next drag move picks it
   *  up; the ring is already showing the scene-graph color until then). */
  snapshotRef: MutableRefObject<CanvasSnapshot | null>;
  /** Color the ring opens on — the one the picker was already editing, so the
   *  loupe never flashes a color that was never in play. */
  initialColor: RGBColor;
  /** A press outside the ring: commit the last sampled color. */
  onCommit: (color: RGBColor) => void;
}

export function EyedropperLayer({ state, snapshotRef, initialColor, onCommit }: EyedropperLayerProps) {
  const [color, setColor] = useState<RGBColor>(initialColor);
  const colorRef = useRef(color);
  colorRef.current = color;

  const onPositionChange = useCallback((localX: number, localY: number) => {
    const { cellX, cellY } = screenToWorld(localX, localY, state.camera, state.viewport);
    const sampled = sampleEditorColor(state, snapshotRef.current, cellX, cellY);
    // Null = nothing drawn there and no page background: keep the last real
    // color rather than committing to empty space.
    if (sampled) setColor(sampled);
  }, [state, snapshotRef]);

  const onDismiss = useCallback(() => onCommit(colorRef.current), [onCommit]);

  return (
    <EyedropperOverlay
      sampledColor={color}
      canvasWidth={state.viewport.width}
      canvasHeight={state.viewport.height}
      onPositionChange={onPositionChange}
      onDismiss={onDismiss}
    />
  );
}
