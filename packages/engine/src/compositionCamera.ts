import { CompositionFigure, SVGObject } from './types';
import { arcBoundingBox } from './compositionArcHitTest';

type Camera = { offsetX: number; offsetY: number; zoom: number };

/** Composition camera zoom clamps. Range chosen to support arbitrary grid
 *  subdivision: at the finest levels (gridLevel = -10 → step = 1/1024 L0)
 *  the viewport needs to span sub-cell distances, which requires very high
 *  zoom. At the coarsest, the viewport needs to fit very large authoring
 *  areas, which requires very low zoom. Picked symmetrically so + and -
 *  buttons can each run for many presses. */
export const MIN_ZOOM = 0.001;
export const MAX_ZOOM = 10000;

function computeFrameCamera(
  figures: CompositionFigure[],
  svgObjects: SVGObject[],
  viewportWidth: number,
  viewportHeight: number,
): Camera | null {
  if (figures.length === 0 && svgObjects.length === 0) return null;

  let minCX = Infinity, minCY = Infinity, maxCX = -Infinity, maxCY = -Infinity;
  for (const f of figures) {
    minCX = Math.min(minCX, f.cellX);
    minCY = Math.min(minCY, f.cellY);
    maxCX = Math.max(maxCX, f.cellX + f.cellWidth);
    maxCY = Math.max(maxCY, f.cellY + f.cellHeight);
  }
  for (const s of svgObjects) {
    if (s.tileMode === 'repeat') {
      // A repeat-tiled object's `segments` hold only the base tile; its
      // visible extent is the full cell region (like a figure). Using the
      // single-tile segment bbox would frame just one repetition. Mirrors
      // the tiled branch in `groupBounds` (compositionOps.ts).
      if (s.cellX < minCX) minCX = s.cellX;
      if (s.cellY < minCY) minCY = s.cellY;
      if (s.cellX + s.cellWidth > maxCX) maxCX = s.cellX + s.cellWidth;
      if (s.cellY + s.cellHeight > maxCY) maxCY = s.cellY + s.cellHeight;
      continue;
    }
    const bb = arcBoundingBox(s.segments);
    if (bb) {
      if (bb.minX < minCX) minCX = bb.minX;
      if (bb.minY < minCY) minCY = bb.minY;
      if (bb.maxX > maxCX) maxCX = bb.maxX;
      if (bb.maxY > maxCY) maxCY = bb.maxY;
    }
  }
  if (!isFinite(minCX) || !isFinite(minCY) || !isFinite(maxCX) || !isFinite(maxCY)) return null;

  const uvMinX = minCX / 32;
  const uvMinY = minCY / 32;
  const uvMaxX = maxCX / 32;
  const uvMaxY = maxCY / 32;
  const uvW = uvMaxX - uvMinX;
  const uvH = uvMaxY - uvMinY;
  if (uvW === 0 && uvH === 0) return null;

  const vw = viewportWidth;
  const vh = viewportHeight;
  const padding = 0.9;
  const visUvW = 1;
  const visUvH = vh / vw;
  const zoomToFitW = uvW > 0 ? visUvW / uvW * padding : Infinity;
  const zoomToFitH = uvH > 0 ? visUvH / uvH * padding : Infinity;
  // Wide zoom range so the Frame action can fit very tiny or very large
  // content. Matches the SET_CAMERA / pinch clamps used elsewhere.
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(zoomToFitW, zoomToFitH)));

  const centerU = (uvMinX + uvMaxX) / 2;
  const centerV = (uvMinY + uvMaxY) / 2;
  const offsetU = 0.5 - centerU;
  const offsetV = 0.5 - centerV;
  const offsetX = offsetU * vw;
  const offsetY = offsetV * vw;

  return { offsetX, offsetY, zoom };
}

/**
 * Compute a camera that frames every figure and line in view. Lines
 * contribute their vertex AABB to the overall bounding box so a Frame
 * with only lines on the canvas still zooms to fit. Returns null if
 * nothing is on the canvas or the bounding box is degenerate.
 */
export function computeFrameAllCamera(
  figures: CompositionFigure[],
  viewportWidth: number,
  viewportHeight: number,
  svgObjects: SVGObject[] = [],
): Camera | null {
  return computeFrameCamera(figures, svgObjects, viewportWidth, viewportHeight);
}

/**
 * Compute a camera that frames only the selected nodes.
 * `selectedIds` may contain mixed figure and svg ids. Returns null if
 * the selection is empty or the bounding box is degenerate.
 */
export function computeFrameSelectionCamera(
  figures: CompositionFigure[],
  selectedIds: Set<string>,
  viewportWidth: number,
  viewportHeight: number,
  svgObjects: SVGObject[] = [],
): Camera | null {
  if (selectedIds.size === 0) return null;
  const selectedFigs = figures.filter((f) => selectedIds.has(f.id));
  const selectedSVGs = svgObjects.filter((s) => selectedIds.has(s.id));
  return computeFrameCamera(selectedFigs, selectedSVGs, viewportWidth, viewportHeight);
}
