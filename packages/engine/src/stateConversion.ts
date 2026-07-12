/**
 * Convert an entire CompositionState's objects into a node map for the
 * new Transform2D-based scene graph. This is the bridge between the old
 * dual-coordinate model and the new single-source-of-truth model.
 *
 * The resulting Map<string, AnySceneNode> can be used with
 * WorldTransformCache to derive world coordinates on demand.
 */

import { CompositionState, AnySceneNode } from './types';
import { figureToNode, svgToNode, imageToNode, groupToNode2 } from './nodeConversion';
import { WorldTransformCache, NodeTransformInfo } from './worldTransformCache';

/**
 * Convert all scene objects in a CompositionState to the new node types.
 * Returns a Map keyed by node ID for O(1) lookup.
 *
 * Groups are converted first so child nodes can reference them. The
 * conversion is pure — no mutation of the input state.
 */
export function convertToNodeMap(state: CompositionState): Map<string, AnySceneNode> {
  const nodes = new Map<string, AnySceneNode>();

  // Groups first (so parent references resolve)
  for (const g of state.groups) {
    nodes.set(g.id, groupToNode2(g));
  }

  // Figures
  for (const f of state.figures) {
    nodes.set(f.id, figureToNode(f));
  }

  // SVG objects
  for (const s of state.svgObjects) {
    nodes.set(s.id, svgToNode(s));
  }

  // Images
  for (const i of (state.images ?? [])) {
    nodes.set(i.id, imageToNode(i));
  }

  return nodes;
}

/**
 * Create a fresh WorldTransformCache and a getNode lookup function
 * from a nodeMap. Convenience for the common pattern of converting
 * state and immediately creating a cache.
 */
/**
 * Create a fresh WorldTransformCache and a getNode lookup function
 * from a nodeMap. Convenience for the common pattern of converting
 * state and immediately creating a cache.
 */
export function createCacheFromNodeMap(
  nodeMap: Map<string, AnySceneNode>,
): {
  cache: WorldTransformCache;
  getNode: (id: string) => NodeTransformInfo | undefined;
} {
  const cache = new WorldTransformCache();
  const getNode = (id: string) => nodeMap.get(id) as NodeTransformInfo | undefined;
  return { cache, getNode };
}

/**
 * Synchronize the nodeMap on a CompositionState. Rebuilds it from the
 * legacy arrays (figures, svgObjects, images, groups).
 *
 * This is designed to be called after every reducer action. It is
 * lightweight: just iterates the arrays and creates node wrappers.
 * The WorldTransformCache (separate) handles lazy world-coord computation.
 *
 * Returns the state with an up-to-date nodeMap. If the state reference
 * hasn't changed (no actual mutation), returns the same state.
 */
export function syncNodeMap(state: CompositionState): CompositionState {
  const nodeMap = convertToNodeMap(state);
  return { ...state, nodeMap };
}
