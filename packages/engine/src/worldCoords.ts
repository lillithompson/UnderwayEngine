/**
 * World-coordinate accessor bridge. Derives world-space rendering data
 * from the new Transform2D-based scene graph. Provides the same fields
 * that renderers currently read from legacy types (cellX/Y/Width/Height,
 * rotation, mirrorH, mirrorV, segments, quads, tileWidthL0/HeightL0).
 *
 * Used during the dual-read transition phase: old code reads legacy
 * fields directly, while this module derives the same values from the
 * new system. Tests assert both match, catching any divergence before
 * the renderers switch over.
 */

import {
  FigureNode, SVGNode, ImageNode,
  PathSegment, FigureQuad,
} from './types';
import {
  Transform2D, Bbox, Orientation,
  applyToBbox, applyToPoint,
} from './transform2d';
import { WorldTransformCache, NodeTransformInfo } from './worldTransformCache';

// ── Result types ───────────────────────────────────────────────────────

export interface WorldFigureCoords {
  cellX: number;
  cellY: number;
  cellWidth: number;
  cellHeight: number;
  rotation: 0 | 90 | 180 | 270;
  mirrorH: boolean;
  mirrorV: boolean;
  quads?: FigureQuad[];
  tileWidthL0?: number;
  tileHeightL0?: number;
}

export interface WorldSVGCoords {
  cellX: number;
  cellY: number;
  cellWidth: number;
  cellHeight: number;
  segments: PathSegment[];
  subpathSegments?: PathSegment[][];
}

export interface WorldImageCoords {
  cellX: number;
  cellY: number;
  cellWidth: number;
  cellHeight: number;
  rotation: 0 | 90 | 180 | 270;
  mirrorH: boolean;
  mirrorV: boolean;
}

// ── World-coordinate derivation ────────────────────────────────────────

/**
 * Derive world orientation from a transform. Extracts the rotation and
 * mirror components. For a composed (chained) world transform, this
 * gives the net orientation that the renderer should apply.
 */
function worldOrientation(wt: Transform2D): Orientation {
  return { rotation: wt.rotation, mirrorH: wt.mirrorH, mirrorV: wt.mirrorV };
}

/**
 * Transform a single PathSegment's points through a world transform.
 */
function transformSegment(seg: PathSegment, wt: Transform2D): PathSegment {
  if (seg.kind === 'arc') {
    return {
      kind: 'arc',
      start: applyToPoint(wt, seg.start[0], seg.start[1]),
      end: applyToPoint(wt, seg.end[0], seg.end[1]),
      center: applyToPoint(wt, seg.center[0], seg.center[1]),
    };
  }
  return {
    kind: 'line',
    start: applyToPoint(wt, seg.start[0], seg.start[1]),
    end: applyToPoint(wt, seg.end[0], seg.end[1]),
  };
}

/**
 * Transform a FigureQuad through the net orientation of the world
 * transform, matching the legacy transformQuadsByGroupChain behavior.
 *
 * Quads are relative to the figure's local bbox. The world transform's
 * mirror+rotation portion is applied to the quad offsets, while scale
 * is applied to both offsets and dimensions.
 */
function transformQuad(
  q: FigureQuad,
  localBbox: Bbox,
  wt: Transform2D,
): FigureQuad {
  // Apply mirror + rotation to the quad's top-left corner (relative to
  // the local bbox), then scale. We convert the quad to a mini-bbox in
  // local space, transform it, and read off the result.
  const qBbox: Bbox = { x: q.offsetX, y: q.offsetY, width: q.cellWidth, height: q.cellHeight };
  const worldQ = applyToBbox(wt, qBbox);
  const worldFig = applyToBbox(wt, localBbox);
  return {
    offsetX: worldQ.x - worldFig.x,
    offsetY: worldQ.y - worldFig.y,
    cellWidth: worldQ.width,
    cellHeight: worldQ.height,
  };
}

/**
 * Derive world rendering data for a FigureNode.
 */
export function worldFigureCoords(
  node: FigureNode,
  cache: WorldTransformCache,
  getNode: (id: string) => NodeTransformInfo | undefined,
): WorldFigureCoords {
  const wt = cache.getWorldTransform(node.id, getNode);
  const wb = applyToBbox(wt, node.localBbox);
  const ori = worldOrientation(wt);

  let quads: FigureQuad[] | undefined;
  if (node.quads && node.quads.length > 0) {
    quads = node.quads.map(q => transformQuad(q, node.localBbox, wt));
  }

  // Tile dimensions scale with the world transform.
  let tileW = node.tileWidthL0;
  let tileH = node.tileHeightL0;
  if (node.tileMode === 'repeat' && tileW !== undefined && tileH !== undefined) {
    const tileBbox = applyToBbox(wt, { x: 0, y: 0, width: tileW, height: tileH });
    tileW = tileBbox.width;
    tileH = tileBbox.height;
  }

  return {
    cellX: wb.x,
    cellY: wb.y,
    cellWidth: wb.width,
    cellHeight: wb.height,
    rotation: ori.rotation,
    mirrorH: ori.mirrorH,
    mirrorV: ori.mirrorV,
    quads,
    tileWidthL0: tileW,
    tileHeightL0: tileH,
  };
}

/**
 * Derive world rendering data for an SVGNode.
 */
export function worldSVGCoords(
  node: SVGNode,
  cache: WorldTransformCache,
  getNode: (id: string) => NodeTransformInfo | undefined,
): WorldSVGCoords {
  const wt = cache.getWorldTransform(node.id, getNode);

  const worldSegments = node.segments.map(seg => transformSegment(seg, wt));

  let subpathSegments: PathSegment[][] | undefined;
  if (node.subpaths && node.subpaths.length > 0) {
    subpathSegments = node.subpaths.map(sub =>
      sub.segments.map(seg => transformSegment(seg, wt))
    );
  }

  // Compute bbox from transformed segments
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const seg of worldSegments) {
    for (const pt of [seg.start, seg.end]) {
      if (pt[0] < minX) minX = pt[0];
      if (pt[1] < minY) minY = pt[1];
      if (pt[0] > maxX) maxX = pt[0];
      if (pt[1] > maxY) maxY = pt[1];
    }
    if (seg.kind === 'arc') {
      if (seg.center[0] < minX) minX = seg.center[0];
      if (seg.center[1] < minY) minY = seg.center[1];
      if (seg.center[0] > maxX) maxX = seg.center[0];
      if (seg.center[1] > maxY) maxY = seg.center[1];
    }
  }
  const cellX = minX === Infinity ? 0 : minX;
  const cellY = minY === Infinity ? 0 : minY;
  const cellWidth = maxX === -Infinity ? 0 : maxX - minX;
  const cellHeight = maxY === -Infinity ? 0 : maxY - minY;

  return { cellX, cellY, cellWidth, cellHeight, segments: worldSegments, subpathSegments };
}

/**
 * Derive world rendering data for an ImageNode.
 */
export function worldImageCoords(
  node: ImageNode,
  cache: WorldTransformCache,
  getNode: (id: string) => NodeTransformInfo | undefined,
): WorldImageCoords {
  const wt = cache.getWorldTransform(node.id, getNode);
  const wb = applyToBbox(wt, node.localBbox);
  const ori = worldOrientation(wt);

  return {
    cellX: wb.x,
    cellY: wb.y,
    cellWidth: wb.width,
    cellHeight: wb.height,
    rotation: ori.rotation,
    mirrorH: ori.mirrorH,
    mirrorV: ori.mirrorV,
  };
}
