import { Camera, CellCoord, Layer, Viewport, viewportInsets, LAYER_PX, CELL_COUNTS } from './types';
import { computeBaseCamera } from './state';

/**
 * Convert screen coordinates to cell coordinates on the given layer.
 * Returns null if the point is outside the canvas window.
 *
 * The shader transform maps screen → LAYER UV (0..1 spans the full 32-L0
 * layer coordinate space); computeBaseCamera bakes the canvas origin into
 * its offset so the canvas window [origin/32, (origin+dim)/32] lines up
 * with the viewport frame, and the same transform is used here to recover
 * the touched cell.
 */
export function screenToCell(
  screenX: number,
  screenY: number,
  viewport: Viewport,
  camera: Camera,
  layer: Layer,
  fileWidthL0?: number,
  fileHeightL0?: number,
  originL0X: number = 0,
  originL0Y: number = 0,
): CellCoord | null {
  if (viewport.width === 0 || viewport.height === 0) return null;

  const vw = viewport.width;
  const vh = viewport.height;
  const fw = fileWidthL0 ?? 32;
  const fh = fileHeightL0 ?? 32;
  const { baseZoom, baseOffsetU, baseOffsetV } = computeBaseCamera(
    fw, fh, vw, vh, viewportInsets(viewport), originL0X, originL0Y,
  );
  const effectiveZoom = camera.zoom * baseZoom;
  const effectiveOffsetU = camera.offsetX / vw + baseOffsetU;
  const effectiveOffsetV = camera.offsetY / vw + baseOffsetV;

  // Screen → layer UV (0..1 = layer texture)
  const layerU = (screenX / vw - 0.5) / effectiveZoom - effectiveOffsetU + 0.5;
  const layerV = ((screenY / vh - 0.5) * vh / vw) / effectiveZoom - effectiveOffsetV + 0.5;

  // Layer UV → layer pixel position
  const px = layerU * LAYER_PX;
  const py = layerV * LAYER_PX;

  // Convert to cell coordinates (accounting for layer shift)
  const cellCount = CELL_COUNTS[layer.level];
  const cellSize = LAYER_PX / cellCount;
  const shiftPxX = layer.shiftX * cellSize;
  const shiftPxY = layer.shiftY * cellSize;
  const cellX = Math.floor((px - shiftPxX) / cellSize);
  const cellY = Math.floor((py - shiftPxY) / cellSize);

  // Bounds check (allow -1 for shifted axes — half-cell at top/left edge)
  const minX = layer.shiftX === 0.5 ? -1 : 0;
  const minY = layer.shiftY === 0.5 ? -1 : 0;
  if (cellX < minX || cellX >= cellCount || cellY < minY || cellY >= cellCount) {
    return null;
  }

  // Reject cells whose L0 span does not overlap the canvas window.
  const cellsPerL0 = 32 / cellCount;
  const sL0X = layer.shiftX * cellsPerL0;
  const sL0Y = layer.shiftY * cellsPerL0;
  const cellL0StartX = cellX * cellsPerL0 + sL0X;
  const cellL0EndX = cellL0StartX + cellsPerL0;
  const cellL0StartY = cellY * cellsPerL0 + sL0Y;
  const cellL0EndY = cellL0StartY + cellsPerL0;
  if (cellL0EndX <= originL0X || cellL0StartX >= originL0X + fw) return null;
  if (cellL0EndY <= originL0Y || cellL0StartY >= originL0Y + fh) return null;

  return { cellX, cellY };
}
