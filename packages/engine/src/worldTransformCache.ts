/**
 * Generation-stamped cache for world transforms.
 *
 * Instead of storing world coordinates on each node (the old dual-
 * coordinate model), this cache lazily computes the world transform by
 * walking the parent chain and composing Transform2Ds. The result is
 * cached per node and invalidated on any transform change via a global
 * generation counter.
 *
 * Steady-state rendering hits the cache 100% — transforms only change
 * during user gestures. During a drag the generation bumps once and all
 * affected nodes recompute lazily on next read. This is strictly cheaper
 * than the old eager `materializeGroupMembers` approach.
 */

import { Transform2D, Bbox, IDENTITY, applyToBbox, compose } from './transform2d';

// ── Types ──────────────────────────────────────────────────────────────

export interface NodeTransformInfo {
  readonly id: string;
  readonly parentId?: string | undefined;
  readonly transform: Transform2D;
}

interface CacheEntry {
  worldTransform: Transform2D;
  generation: number;
}

// ── Cache ──────────────────────────────────────────────────────────────

export class WorldTransformCache {
  private cache = new Map<string, CacheEntry>();
  private generation = 0;

  /** Bump the generation so all cached entries become stale.
   *  Call when any node's transform or parentId changes. */
  invalidate(): void {
    this.generation++;
  }

  /** Remove a specific node from the cache (e.g. on delete). */
  evict(nodeId: string): void {
    this.cache.delete(nodeId);
  }

  /** Clear all cached entries. */
  clear(): void {
    this.cache.clear();
    this.generation++;
  }

  /** Current generation number (exposed for testing). */
  get gen(): number {
    return this.generation;
  }

  /**
   * Get the world transform for a node, computing and caching if stale.
   *
   * `getNode` is the lookup function that returns a node's parentId and
   * transform given its id. This avoids coupling the cache to a specific
   * state shape.
   */
  getWorldTransform(
    nodeId: string,
    getNode: (id: string) => NodeTransformInfo | undefined,
  ): Transform2D {
    const entry = this.cache.get(nodeId);
    if (entry && entry.generation === this.generation) {
      return entry.worldTransform;
    }

    // Walk up the parent chain, collecting transforms leaf→root.
    const chain: Transform2D[] = [];
    let cur = getNode(nodeId);
    while (cur) {
      chain.push(cur.transform);
      if (!cur.parentId) break;
      cur = getNode(cur.parentId);
    }

    // Compose root→leaf (chain is leaf→root, so iterate in reverse).
    let wt = IDENTITY;
    for (let i = chain.length - 1; i >= 0; i--) {
      wt = compose(wt, chain[i]);
    }

    this.cache.set(nodeId, { worldTransform: wt, generation: this.generation });
    return wt;
  }

  /**
   * Get the world-space bounding box for a node given its local bbox.
   */
  getWorldBbox(
    nodeId: string,
    localBbox: Bbox,
    getNode: (id: string) => NodeTransformInfo | undefined,
  ): Bbox {
    const wt = this.getWorldTransform(nodeId, getNode);
    return applyToBbox(wt, localBbox);
  }
}
