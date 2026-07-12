import { Camera, Viewport, viewportInsets } from './types';
import { computeBaseCamera } from './state';

export type ResizeCorner = 'tl' | 'tr' | 'bl' | 'br';

const MIN_L0 = 4;
const MAX_L0 = 32;

/**
 * Convert layer-UV coords to screen pixel coords. UV is expressed in the full
 * 32-L0 layer coordinate space (u=originL0X/32 = canvas left, u=(originL0X+
 * widthL0)/32 = canvas right). computeBaseCamera bakes the origin into its
 * offset so the same transform is used across shader / input / resize.
 *
 * Inverts the shader camera transform (see LAYER_FRAG / input.ts):
 *   uvX = (screenX/vw - 0.5) / zoom - offsetU + 0.5
 *   uvY = ((screenY/vh - 0.5) * vh/vw) / zoom - offsetV + 0.5
 */
export function fileUVToScreen(
  u: number,
  v: number,
  viewport: Viewport,
  camera: Camera,
  widthL0: number,
  heightL0: number,
  originL0X: number = 0,
  originL0Y: number = 0,
): { x: number; y: number } {
  const vw = viewport.width || 1;
  const vh = viewport.height || 1;
  const { baseZoom, baseOffsetU, baseOffsetV } = computeBaseCamera(
    widthL0, heightL0, vw, vh, viewportInsets(viewport), originL0X, originL0Y,
  );
  const effectiveZoom = baseZoom * camera.zoom;
  const effectiveOffsetU = camera.offsetX / vw + baseOffsetU;
  const effectiveOffsetV = camera.offsetY / vw + baseOffsetV;

  const sx = ((u - 0.5 + effectiveOffsetU) * effectiveZoom + 0.5) * vw;
  const sy = ((v - 0.5 + effectiveOffsetV) * effectiveZoom * vw / vh + 0.5) * vh;

  return { x: sx, y: sy };
}

/** Screen → layer UV (see fileUVToScreen). */
export function screenToFileUV(
  screenX: number,
  screenY: number,
  viewport: Viewport,
  camera: Camera,
  widthL0: number,
  heightL0: number,
  originL0X: number = 0,
  originL0Y: number = 0,
): { u: number; v: number } {
  const vw = viewport.width || 1;
  const vh = viewport.height || 1;
  const { baseZoom, baseOffsetU, baseOffsetV } = computeBaseCamera(
    widthL0, heightL0, vw, vh, viewportInsets(viewport), originL0X, originL0Y,
  );
  const effectiveZoom = baseZoom * camera.zoom;
  const effectiveOffsetU = camera.offsetX / vw + baseOffsetU;
  const effectiveOffsetV = camera.offsetY / vw + baseOffsetV;

  const u = (screenX / vw - 0.5) / effectiveZoom - effectiveOffsetU + 0.5;
  const v = ((screenY / vh - 0.5) * vh / vw) / effectiveZoom - effectiveOffsetV + 0.5;
  return { u, v };
}

/** Snap an L0 dimension value to grid increments, clamped to [MIN_L0, MAX_L0] */
export function snapDimension(rawL0: number, snapSize: number): number {
  const snapped = Math.round(rawL0 / snapSize) * snapSize;
  return Math.max(MIN_L0, Math.min(MAX_L0, snapped));
}

export interface ResizeResult {
  newWidthL0: number;
  newHeightL0: number;
  newOriginL0X: number;
  newOriginL0Y: number;
}

/**
 * Compute a new canvas window from a corner drag delta expressed in LAYER UV
 * space (1.0 spans the full 32 L0 layer axis). The canvas is a rectangular
 * window [originL0, originL0+dim) onto the fixed 32 L0 layer coordinate
 * space — no layer data moves during resize.
 *
 * TL/TR/BL corners translate the origin on their edge; BR changes dimension
 * only. Deltas snap to `snapSize` L0 cells. Origin is clamped to ≥ 0 and
 * origin + dim ≤ 32 so the canvas always fits inside the layer buffer.
 */
export function computeResizeFromDrag(
  corner: ResizeCorner,
  startWidthL0: number,
  startHeightL0: number,
  startOriginL0X: number,
  startOriginL0Y: number,
  deltaU: number,
  deltaV: number,
  snapSize: number,
): ResizeResult {
  // Delta is in layer UV (1.0 = 32 L0). Rescale to L0.
  const deltaL0X = deltaU * 32;
  const deltaL0Y = deltaV * 32;

  const movesLeft = corner === 'tl' || corner === 'bl';
  const movesTop = corner === 'tl' || corner === 'tr';

  const snapDelta = (d: number) => Math.round(d / snapSize) * snapSize;

  let newOriginL0X = startOriginL0X;
  let newOriginL0Y = startOriginL0Y;
  let newWidthL0 = startWidthL0;
  let newHeightL0 = startHeightL0;

  if (movesLeft) {
    const snapped = snapDelta(deltaL0X);
    const proposedOrigin = startOriginL0X + snapped;
    const maxOrigin = startOriginL0X + startWidthL0 - MIN_L0;
    newOriginL0X = Math.max(0, Math.min(maxOrigin, proposedOrigin));
    newWidthL0 = startOriginL0X + startWidthL0 - newOriginL0X;
  } else {
    const snapped = snapDelta(deltaL0X);
    const proposedWidth = startWidthL0 + snapped;
    const maxWidth = MAX_L0 - startOriginL0X;
    newWidthL0 = Math.max(MIN_L0, Math.min(maxWidth, proposedWidth));
  }

  if (movesTop) {
    const snapped = snapDelta(deltaL0Y);
    const proposedOrigin = startOriginL0Y + snapped;
    const maxOrigin = startOriginL0Y + startHeightL0 - MIN_L0;
    newOriginL0Y = Math.max(0, Math.min(maxOrigin, proposedOrigin));
    newHeightL0 = startOriginL0Y + startHeightL0 - newOriginL0Y;
  } else {
    const snapped = snapDelta(deltaL0Y);
    const proposedHeight = startHeightL0 + snapped;
    const maxHeight = MAX_L0 - startOriginL0Y;
    newHeightL0 = Math.max(MIN_L0, Math.min(maxHeight, proposedHeight));
  }

  return { newWidthL0, newHeightL0, newOriginL0X, newOriginL0Y };
}
