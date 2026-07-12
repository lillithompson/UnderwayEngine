/**
 * Conversion functions: legacy dual-coordinate types → Transform2D-based
 * scene nodes. The legacy arrays remain the authoritative store; these
 * converters run on every nodeMap rebuild (see stateConversion.ts, called
 * after each reducer action), not as a one-time migration. Produced nodes'
 * world bboxes (via WorldTransformCache) match the legacy world
 * coordinates exactly.
 *
 * Conversion strategy:
 *
 * - **Figures**: localBbox = (0, 0, resolutionX, resolutionY). Transform
 *   is derived so that applyToBbox(transform, localBbox) = worldBbox.
 *
 * - **SVGs**: segments stay as-is (position baked into coordinates).
 *   Transform is IDENTITY. For grouped SVGs, localSegments become the
 *   canonical segments.
 *
 * - **Images**: localBbox = (0, 0, w, h) where w/h are pre-transform
 *   cell dims. Transform is derived to match the world bbox.
 *
 * - **Groups**: GroupNode → GroupNode2 is a direct field mapping via
 *   fromGroupNode().
 */

import {
  CompositionFigure, SVGObject, ImageObject, GroupNode,
  FigureNode, SVGNode, ImageNode, GroupNode2,
  PathSegment,
} from './types';
import { Transform2D, Bbox, IDENTITY, fromGroupNode } from './transform2d';

// ── Transform derivation helper ────────────────────────────────────────

/**
 * Apply only the mirror + rotation portion of a transform to a bbox
 * (no scale, no translate). Returns the intermediate bbox that would
 * exist after mirror+rotate but before scale+translate in applyToBbox.
 */
function mirrorRotateBbox(
  bbox: Bbox,
  rotation: 0 | 90 | 180 | 270,
  mirrorH: boolean,
  mirrorV: boolean,
): Bbox {
  let x = bbox.x, y = bbox.y, w = bbox.width, h = bbox.height;
  if (mirrorH) x = -(x + w);
  if (mirrorV) y = -(y + h);
  if (rotation === 90) {
    const nx = -(y + h), ny = x, nw = h, nh = w;
    x = nx; y = ny; w = nw; h = nh;
  } else if (rotation === 180) {
    x = -(x + w); y = -(y + h);
  } else if (rotation === 270) {
    const nx = y, ny = -(x + w), nw = h, nh = w;
    x = nx; y = ny; w = nw; h = nh;
  }
  return { x, y, width: w, height: h };
}

/**
 * Derive a Transform2D such that applyToBbox(result, localBbox) matches
 * the given worldBbox exactly, with the given orientation.
 *
 * From applyToBbox: after mirror+rotate, the bbox is (rx, ry, rw, rh).
 * Then scale gives: worldW = rw * sx, worldH = rh * sy.
 * Then translate gives: worldX = tx + rx * sx, worldY = ty + ry * sy.
 *
 * Solving: sx = worldW / rw, sy = worldH / rh,
 *          tx = worldX - rx * sx, ty = worldY - ry * sy.
 */
function deriveTransform(
  localBbox: Bbox,
  worldX: number, worldY: number, worldW: number, worldH: number,
  rotation: 0 | 90 | 180 | 270,
  mirrorH: boolean,
  mirrorV: boolean,
): Transform2D {
  const rotated = mirrorRotateBbox(localBbox, rotation, mirrorH, mirrorV);
  const sx = rotated.width > 0 ? worldW / rotated.width : 1;
  const sy = rotated.height > 0 ? worldH / rotated.height : 1;
  const tx = worldX - rotated.x * sx;
  const ty = worldY - rotated.y * sy;
  return { tx, ty, sx, sy, rotation, mirrorH, mirrorV };
}

// ── Figure conversion ──────────────────────────────────────────────────

/**
 * Convert a legacy CompositionFigure to a FigureNode.
 *
 * For ungrouped figures: the transform is derived so that
 * applyToBbox(transform, localBbox) = (cellX, cellY, cellWidth, cellHeight).
 *
 * For grouped figures: the transform is derived from local cell coords
 * and local orientation. The parent group's transform is separate.
 */
export function figureToNode(fig: CompositionFigure): FigureNode {
  const isGrouped = fig.groupId !== undefined;
  const localBbox: Bbox = { x: 0, y: 0, width: fig.resolutionX, height: fig.resolutionY };

  let transform: Transform2D;

  if (isGrouped && fig.localCellX !== undefined && fig.localCellY !== undefined
      && fig.localCellWidth !== undefined && fig.localCellHeight !== undefined) {
    const rotation = fig.localRotation ?? 0;
    const mirrorH = fig.localMirrorH ?? false;
    const mirrorV = fig.localMirrorV ?? false;
    transform = deriveTransform(
      localBbox,
      fig.localCellX, fig.localCellY, fig.localCellWidth, fig.localCellHeight,
      rotation, mirrorH, mirrorV,
    );
  } else {
    const rotation = fig.rotation ?? 0;
    const mirrorH = fig.mirrorH ?? false;
    const mirrorV = fig.mirrorV ?? false;
    transform = deriveTransform(
      localBbox,
      fig.cellX, fig.cellY, fig.cellWidth, fig.cellHeight,
      rotation, mirrorH, mirrorV,
    );
  }

  const localQuads = isGrouped ? (fig.localQuads ?? fig.quads) : fig.quads;

  return {
    kind: 'figure',
    id: fig.id,
    name: fig.name,
    parentId: fig.groupId,
    locked: fig.locked,
    transform,
    figureKey: fig.figureKey,
    fileId: fig.fileId,
    placementLevel: fig.placementLevel,
    resolutionX: fig.resolutionX,
    resolutionY: fig.resolutionY,
    localBbox,
    quads: localQuads,
    tileMode: fig.tileMode,
    tileWidthL0: isGrouped ? (fig.localTileWidthL0 ?? fig.tileWidthL0) : fig.tileWidthL0,
    tileHeightL0: isGrouped ? (fig.localTileHeightL0 ?? fig.tileHeightL0) : fig.tileHeightL0,
    tileOffsetXL0: isGrouped ? (fig.localTileOffsetXL0 ?? fig.tileOffsetXL0) : fig.tileOffsetXL0,
    tileOffsetYL0: isGrouped ? (fig.localTileOffsetYL0 ?? fig.tileOffsetYL0) : fig.tileOffsetYL0,
  };
}

// ── SVG conversion ─────────────────────────────────────────────────────

/**
 * Convert a legacy SVGObject to an SVGNode.
 *
 * SVG segments include absolute coordinates, so position is baked into
 * segment data. The transform is IDENTITY. For grouped SVGs,
 * localSegments become the canonical segments.
 */
export function svgToNode(svg: SVGObject): SVGNode {
  const isGrouped = svg.groupId !== undefined;

  let segments: readonly PathSegment[];

  if (isGrouped && svg.localSegments) {
    segments = svg.localSegments;
  } else {
    segments = svg.segments;
  }

  return {
    kind: 'svg',
    id: svg.id,
    name: svg.name,
    parentId: svg.groupId,
    locked: svg.locked,
    transform: IDENTITY,
    color: svg.color,
    segments,
    subpaths: svg.subpaths,
    lineDirection: svg.lineDirection,
    creationBox: svg.creationBox,
    tileMode: svg.tileMode,
    tileWidthL0: svg.tileWidthL0,
    tileHeightL0: svg.tileHeightL0,
    tileOffsetXL0: svg.tileOffsetXL0,
    tileOffsetYL0: svg.tileOffsetYL0,
  };
}

// ── Image conversion ───────────────────────────────────────────────────

/**
 * Convert a legacy ImageObject to an ImageNode.
 *
 * Like figures: localBbox = (0, 0, w, h) with pre-transform dims, and
 * the transform is derived to match the world bbox.
 */
export function imageToNode(img: ImageObject): ImageNode {
  const isGrouped = img.groupId !== undefined;

  let transform: Transform2D;
  let localW: number, localH: number;

  if (isGrouped && img.localCellX !== undefined && img.localCellY !== undefined
      && img.localCellWidth !== undefined && img.localCellHeight !== undefined) {
    // Grouped images don't have per-member rotation/mirror in the
    // current model, so orientation is identity.
    localW = img.localCellWidth;
    localH = img.localCellHeight;
    transform = {
      tx: img.localCellX,
      ty: img.localCellY,
      sx: 1,
      sy: 1,
      rotation: 0,
      mirrorH: false,
      mirrorV: false,
    };
  } else {
    const rotation = img.rotation ?? 0;
    const mirrorH = img.mirrorH ?? false;
    const mirrorV = img.mirrorV ?? false;
    const swapped = rotation === 90 || rotation === 270;
    localW = swapped ? img.cellHeight : img.cellWidth;
    localH = swapped ? img.cellWidth : img.cellHeight;
    const localBbox: Bbox = { x: 0, y: 0, width: localW, height: localH };
    transform = deriveTransform(
      localBbox,
      img.cellX, img.cellY, img.cellWidth, img.cellHeight,
      rotation, mirrorH, mirrorV,
    );
  }

  return {
    kind: 'image',
    id: img.id,
    name: img.name,
    parentId: img.groupId,
    locked: img.locked,
    transform,
    imageId: img.imageId,
    mimeType: img.mimeType,
    pixelWidth: img.pixelWidth,
    pixelHeight: img.pixelHeight,
    localBbox: { x: 0, y: 0, width: localW, height: localH },
    opacity: img.opacity,
  };
}

// ── Group conversion ───────────────────────────────────────────────────

/**
 * Convert a legacy GroupNode to a GroupNode2.
 */
export function groupToNode2(g: GroupNode): GroupNode2 {
  return {
    kind: 'group',
    id: g.id,
    name: g.name,
    parentId: g.parentGroupId,
    transform: fromGroupNode(g),
  };
}
