import { GroupNode, SVGObject } from './types';
import { isClosedPath } from './compositionArcMath';
import { pointInClosedPath } from './compositionPathHitTest';

/**
 * Mask resolution for "Use as mask" shapes.
 *
 * A closed SVGObject with `isMask` that is a direct member of a group clips
 * its group siblings. The active mask is always DERIVED, never stored, so
 * delete/reorder/un-close edge cases self-heal.
 *
 * Mask geometry is the object's main `segments` only — `subpaths` are
 * ignored, matching `buildClosedFillPathD`'s fill geometry. Multi-loop
 * (donut) shapes are inert as masks via the `isClosedPath` gate.
 *
 * Logic-only module: also consumed by the GL renderer for v2 stencil
 * clipping of tile-mode objects.
 */

/** The minimal scene shape mask resolution reads. */
export interface MaskScene {
  groups: readonly GroupNode[];
  svgObjects: readonly SVGObject[];
  sceneOrder: readonly string[];
}

const EMPTY_MASK_MAP: ReadonlyMap<string, SVGObject> = new Map();

/** Closedness cache keyed by segments-array reference (segments are
 *  replaced immutably on every edit/rematerialization). */
const closedCache = new WeakMap<readonly object[], boolean>();

function isClosedCached(svg: SVGObject): boolean {
  let closed = closedCache.get(svg.segments);
  if (closed === undefined) {
    closed = isClosedPath(svg.segments);
    closedCache.set(svg.segments, closed);
  }
  return closed;
}

/**
 * Resolve the active mask for every group: groupId → the direct SVGObject
 * member with `isMask` whose path is closed and whose sceneOrder index is
 * lowest (back-most; first-wins). Hidden masks are included — a hidden
 * mask still clips. Returns a shared empty map when no object is flagged.
 */
export function buildActiveMaskMap(scene: MaskScene): ReadonlyMap<string, SVGObject> {
  // Tiled objects cannot be masks: a repeating fill has no single boundary
  // to clip siblings to (and the mask shape is meant to render normally).
  let any = false;
  for (const svg of scene.svgObjects) {
    if (svg.isMask && svg.groupId && svg.tileMode !== 'repeat') { any = true; break; }
  }
  if (!any) return EMPTY_MASK_MAP;

  const orderIndex = new Map<string, number>();
  scene.sceneOrder.forEach((id, i) => orderIndex.set(id, i));

  const map = new Map<string, SVGObject>();
  for (const svg of scene.svgObjects) {
    if (!svg.isMask || !svg.groupId || svg.tileMode === 'repeat') continue;
    if (!isClosedCached(svg)) continue;
    const current = map.get(svg.groupId);
    if (!current) {
      map.set(svg.groupId, svg);
      continue;
    }
    const a = orderIndex.get(svg.id) ?? Infinity;
    const b = orderIndex.get(current.id) ?? Infinity;
    if (a < b) map.set(svg.groupId, svg);
  }
  return map.size > 0 ? map : EMPTY_MASK_MAP;
}

/** The active mask for one group, or undefined. For UI captions — builds
 *  the full map; use `buildActiveMaskMap` directly when querying many. */
export function getActiveMaskForGroup(scene: MaskScene, groupId: string): SVGObject | undefined {
  return buildActiveMaskMap(scene).get(groupId);
}

function findGroup(groups: readonly GroupNode[], groupId: string): GroupNode | undefined {
  for (const g of groups) if (g.id === groupId) return g;
  return undefined;
}

/**
 * Active masks for a node's ancestor chain, outermost group first. Walks
 * `groupId` → `parentGroupId` → …; the starting group's own mask is
 * included (it clips the node — use the `selfId` exemption in
 * `pointPassesMasks` for the mask object itself).
 */
export function getAncestorMasks(
  maskMap: ReadonlyMap<string, SVGObject>,
  groups: readonly GroupNode[],
  groupId: string | undefined,
): SVGObject[] {
  if (!groupId || maskMap.size === 0) return [];
  const masks: SVGObject[] = [];
  let gid: string | undefined = groupId;
  let hops = 0;
  while (gid && hops < 100) {
    const mask = maskMap.get(gid);
    if (mask) masks.unshift(mask);
    gid = findGroup(groups, gid)?.parentGroupId;
    hops++;
  }
  return masks;
}

/**
 * Mask chain for hit tests against a group's own bbox: identical to
 * `getAncestorMasks` (the starting group's mask is part of the chain).
 * Kept as a named alias so call sites read unambiguously.
 */
export const getGroupMaskChain = getAncestorMasks;

/**
 * Ordered (outermost-first) ancestor-mask chain that clips `node`,
 * excluding any mask whose id equals `node.id` — a mask is not clipped by
 * itself but is by its ancestors. Same self-exemption as
 * `maskClipIdForNode`, but returns the full chain: the CSS tile path needs
 * one clip wrapper per level (CSS can't intersect multiple clip-paths on
 * one element), whereas the SVG path gets the same intersection via
 * `<clipPath>` def-chaining.
 */
export function getNodeClipMasks(
  maskMap: ReadonlyMap<string, SVGObject>,
  groups: readonly GroupNode[],
  node: { id: string; groupId?: string },
): SVGObject[] {
  if (maskMap.size === 0) return [];
  return getAncestorMasks(maskMap, groups, node.groupId).filter((m) => m.id !== node.id);
}

/**
 * Clip a candidate rect (in L0 cells) to the visible region defined by a
 * node's ancestor-mask chain, intersecting with each mask's bbox. Returns
 * null when the node is fully clipped away (no visible overlap). When the
 * node is in no masked group, returns the rect unchanged.
 *
 * Mask-bbox-as-clip is the same approximation `regionIntersectsGroupMasks`
 * uses: a mask's bbox tightly bounds its visible region, so this yields the
 * correct visible extent for framing. Used by the thumbnail/SVG-export core
 * to frame only the visible (masked) content.
 */
export function clipRectToNodeMasks(
  maskMap: ReadonlyMap<string, SVGObject>,
  groups: readonly GroupNode[],
  node: { id: string; groupId?: string },
  minX: number, minY: number, maxX: number, maxY: number,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const masks = getNodeClipMasks(maskMap, groups, node);
  for (const m of masks) {
    minX = Math.max(minX, m.cellX);
    minY = Math.max(minY, m.cellY);
    maxX = Math.min(maxX, m.cellX + m.cellWidth);
    maxY = Math.min(maxY, m.cellY + m.cellHeight);
  }
  if (maxX <= minX || maxY <= minY) return null; // fully clipped away
  return { minX, minY, maxX, maxY };
}

/**
 * True when (x, y) lies inside every mask in `masks`, skipping a mask
 * whose id equals `selfId` (a mask is exempt from its own clip).
 */
export function pointPassesMasks(
  masks: readonly SVGObject[],
  selfId: string | undefined,
  x: number,
  y: number,
): boolean {
  for (const mask of masks) {
    if (mask.id === selfId) continue;
    if (!pointInClosedPath(mask.segments, x, y)) return false;
  }
  return true;
}

/**
 * True when world point (x, y) lies in `node`'s visible (un-clipped) region —
 * i.e. inside every mask in its ancestor chain (the node's own mask exempted).
 * Convenience wrapper over `getAncestorMasks` + `pointPassesMasks`; returns
 * true immediately when there are no masks. The same inline composition is
 * repeated by the click hit-tests in `compositionOps.ts`, which could adopt
 * this helper in a later cleanup.
 */
export function pointVisibleThroughMasks(
  maskMap: ReadonlyMap<string, SVGObject>,
  groups: readonly GroupNode[],
  node: { id: string; groupId?: string },
  x: number,
  y: number,
): boolean {
  if (maskMap.size === 0) return true;
  return pointPassesMasks(getAncestorMasks(maskMap, groups, node.groupId), node.id, x, y);
}

/**
 * Marquee approximation: true when the rectangular region intersects the
 * bbox of every mask in the group's chain. (Exact clipped-geometry
 * intersection is overkill for selection feel.)
 */
export function regionIntersectsGroupMasks(
  maskMap: ReadonlyMap<string, SVGObject>,
  groups: readonly GroupNode[],
  groupId: string | undefined,
  rMinX: number, rMinY: number, rMaxX: number, rMaxY: number,
): boolean {
  const masks = getAncestorMasks(maskMap, groups, groupId);
  for (const mask of masks) {
    if (rMaxX < mask.cellX || rMinX > mask.cellX + mask.cellWidth
      || rMaxY < mask.cellY || rMinY > mask.cellY + mask.cellHeight) {
      return false;
    }
  }
  return true;
}
