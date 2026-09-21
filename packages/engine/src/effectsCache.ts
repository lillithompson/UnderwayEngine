/**
 * Cache keys + invalidation for pre-blurred effect textures (shadow /
 * glow). 90 fps rule: a node's effect raster is re-blurred only when its
 * raster content (contentVersion) or a blur-relevant parameter changes —
 * NEVER on move/scale, and the shadow dx/dy offset is deliberately NOT
 * part of the key: the offset is applied at draw time by translating the
 * cached texture, so dragging the shadow-offset sliders costs zero
 * re-blurs. Borders need no raster pass (stroked rects drawn in the
 * compositor), so border params never appear in the key.
 *
 * Shares the byte-budgeted LRU with textTextureCache via rasterLruCache.
 */

import { GlowEffect, NodeEffects } from './types';
import { createRasterLruCache } from './rasterLruCache';

/** Default budget: 32 MB of estimated RGBA bytes. */
const DEFAULT_BUDGET_BYTES = 32 * 1024 * 1024;

/** One glow's blur-relevant parameters, for the key. `prefix` names which
 *  of the two a node carries, so an outer glow and an inner one with the
 *  same numbers can never collide on one key. */
function glowKeyPart(prefix: string, glow: GlowEffect | undefined): string {
  if (!glow) return `${prefix}-`;
  return `${prefix}${glow.radius}:${glow.spread ?? 0}`
    + `:${glow.color.r},${glow.color.g},${glow.color.b}:${glow.alpha}`;
}

/**
 * Key for a node's pre-blurred effect texture, or null when the node has
 * no shadow and neither glow (nothing to rasterize). Includes blur radii,
 * spreads, colors, and alphas; excludes shadow dx/dy (draw-time offset).
 */
export function effectsRasterKey(
  nodeId: string,
  contentVersion: number | string,
  effects: NodeEffects,
): string | null {
  const sh = effects.shadow;
  const gl = effects.glow;
  const ig = effects.innerGlow;
  if (!sh && !gl && !ig) return null;
  const shPart = sh
    ? `s${sh.blur}:${sh.spread ?? 0}:${sh.color.r},${sh.color.g},${sh.color.b}:${sh.alpha}`
    : 's-';
  return `fx|${nodeId}|v${contentVersion}|${shPart}`
    + `|${glowKeyPart('g', gl)}|${glowKeyPart('i', ig)}`;
}

export interface EffectsRasterEntry {
  width: number;
  height: number;
  /** Host-specific pixel payload. */
  data: unknown;
}

/** Injectable blur pass: rasterizes + blurs the node's content under the
 *  given effects. Host-agnostic so the cache tests under node. */
export type EffectsRenderPass = (
  nodeId: string,
  contentVersion: number | string,
  effects: NodeEffects,
) => EffectsRasterEntry;

export interface EffectsCache {
  /** Cached pre-blurred texture; renders on miss. Null when the node has
   *  no shadow/glow (border-only nodes skip the raster pass). */
  get(nodeId: string, contentVersion: number | string, effects: NodeEffects): EffectsRasterEntry | null;
  /** Entry by exact key, without rendering or bumping recency. */
  peek(key: string): EffectsRasterEntry | undefined;
  /** Drop every cached raster for this node (deletion / content edit). */
  invalidateNode(nodeId: string): void;
  clear(): void;
  /** Estimated total bytes held. */
  size(): number;
  entryCount(): number;
}

export function createEffectsCache(
  renderPass: EffectsRenderPass,
  budgetBytes: number = DEFAULT_BUDGET_BYTES,
): EffectsCache {
  const lru = createRasterLruCache<EffectsRasterEntry>(budgetBytes);

  return {
    get(nodeId, contentVersion, effects) {
      const key = effectsRasterKey(nodeId, contentVersion, effects);
      if (key === null) return null;
      const hit = lru.get(key);
      if (hit) return hit;
      const entry = renderPass(nodeId, contentVersion, effects);
      lru.set(key, nodeId, entry.width * entry.height * 4, entry);
      return entry;
    },
    peek: key => lru.peek(key),
    invalidateNode(nodeId) {
      lru.invalidateOwner(nodeId);
    },
    clear: () => lru.clear(),
    size: () => lru.totalBytes(),
    entryCount: () => lru.entryCount(),
  };
}
