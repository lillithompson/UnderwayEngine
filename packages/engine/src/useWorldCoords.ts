/**
 * Hook and utilities for accessing world coordinates from the new
 * Transform2D-based scene graph. Components can use this instead of
 * reading legacy cellX/Y fields directly.
 *
 * During the transition, both old and new coordinate paths coexist.
 * The nodeMap is synced from old arrays on every reducer action, so
 * both are always consistent. Once all consumers migrate to this
 * module, the old fields can be removed.
 */

import { CompositionState, AnySceneNode, FigureNode, SVGNode, ImageNode } from './types';
import { WorldTransformCache, NodeTransformInfo } from './worldTransformCache';
import { Transform2D } from './transform2d';
import {
  worldFigureCoords, worldSVGCoords, worldImageCoords,
  WorldFigureCoords, WorldSVGCoords, WorldImageCoords,
} from './worldCoords';

// ── Singleton cache per render frame ───────────────────────────────────

// The cache is invalidated when nodeMap changes (via syncNodeMap rebuild).
// Within a single render frame, all reads hit the cache. Between frames,
// the reducer produces a new nodeMap → cache entries auto-stale via
// generation stamp.

let _cache: WorldTransformCache | null = null;
let _nodeMap: Map<string, AnySceneNode> | null = null;

function getCache(nodeMap: Map<string, AnySceneNode>): WorldTransformCache {
  if (_nodeMap !== nodeMap) {
    // NodeMap changed (new reducer output) — invalidate cache.
    if (!_cache) _cache = new WorldTransformCache();
    else _cache.invalidate();
    _nodeMap = nodeMap;
  }
  return _cache!;
}

function getNodeFn(nodeMap: Map<string, AnySceneNode>) {
  return (id: string) => nodeMap.get(id) as NodeTransformInfo | undefined;
}

// ── Public accessors ───────────────────────────────────────────────────

/**
 * Get world coordinates for a figure, given the current state.
 * Returns the same fields that renderers currently read from
 * CompositionFigure (cellX/Y/Width/Height, rotation, mirrorH/V, quads).
 */
export function getWorldFigure(state: CompositionState, figureId: string): WorldFigureCoords | null {
  const nodeMap = state.nodeMap;
  if (!nodeMap) return null;
  const node = nodeMap.get(figureId);
  if (!node || node.kind !== 'figure') return null;
  const cache = getCache(nodeMap);
  return worldFigureCoords(node as FigureNode, cache, getNodeFn(nodeMap));
}

/**
 * Get world coordinates for an SVG object.
 */
export function getWorldSVG(state: CompositionState, svgId: string): WorldSVGCoords | null {
  const nodeMap = state.nodeMap;
  if (!nodeMap) return null;
  const node = nodeMap.get(svgId);
  if (!node || node.kind !== 'svg') return null;
  const cache = getCache(nodeMap);
  return worldSVGCoords(node as SVGNode, cache, getNodeFn(nodeMap));
}

/**
 * Get world coordinates for an image.
 */
export function getWorldImage(state: CompositionState, imageId: string): WorldImageCoords | null {
  const nodeMap = state.nodeMap;
  if (!nodeMap) return null;
  const node = nodeMap.get(imageId);
  if (!node || node.kind !== 'image') return null;
  const cache = getCache(nodeMap);
  return worldImageCoords(node as ImageNode, cache, getNodeFn(nodeMap));
}

/**
 * Get the world bounding box for any scene node by ID.
 * Works for figures, SVGs, images, and groups.
 */
export function getWorldBbox(
  state: CompositionState,
  nodeId: string,
): { cellX: number; cellY: number; cellWidth: number; cellHeight: number } | null {
  const nodeMap = state.nodeMap;
  if (!nodeMap) return null;
  const node = nodeMap.get(nodeId);
  if (!node) return null;

  const cache = getCache(nodeMap);
  const getNode = getNodeFn(nodeMap);

  switch (node.kind) {
    case 'figure': {
      const n = node as FigureNode;
      const wb = cache.getWorldBbox(n.id, n.localBbox, getNode);
      return { cellX: wb.x, cellY: wb.y, cellWidth: wb.width, cellHeight: wb.height };
    }
    case 'svg': {
      const wc = worldSVGCoords(node as SVGNode, cache, getNode);
      return { cellX: wc.cellX, cellY: wc.cellY, cellWidth: wc.cellWidth, cellHeight: wc.cellHeight };
    }
    case 'image': {
      const n = node as ImageNode;
      const wb = cache.getWorldBbox(n.id, n.localBbox, getNode);
      return { cellX: wb.x, cellY: wb.y, cellWidth: wb.width, cellHeight: wb.height };
    }
    case 'group': {
      // Groups have no intrinsic geometry. Return null.
      return null;
    }
  }
}

/**
 * Get the world transform for any node by ID.
 */
export function getWorldTransform(state: CompositionState, nodeId: string): Transform2D | null {
  const nodeMap = state.nodeMap;
  if (!nodeMap) return null;
  const node = nodeMap.get(nodeId);
  if (!node) return null;
  const cache = getCache(nodeMap);
  return cache.getWorldTransform(nodeId, getNodeFn(nodeMap));
}
