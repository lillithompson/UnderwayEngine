import { GroupNode, SVGObject } from './types';
import { buildActiveMaskMap, MaskScene } from './compositionMask';

/**
 * Figma-style frames. A frame is a `GroupNode` with `isFrame` whose boundary
 * is its active rect mask member (see `compositionMask.ts`). The mask does the
 * actual clipping — this module only answers the two frame-specific questions
 * the app needs on top of the existing mask pipeline:
 *
 *   1. which frame (if any) owns a given node, and
 *   2. what rect each frame clips to.
 *
 * Reuses `buildActiveMaskMap` for mask resolution; it does NOT re-derive
 * clip geometry.
 */

function findGroup(groups: readonly GroupNode[], gid: string): GroupNode | undefined {
  for (const g of groups) if (g.id === gid) return g;
  return undefined;
}

/**
 * Nearest ancestor-or-self group flagged `isFrame`, walking
 * `groupId` → `parentGroupId`. Undefined when the node is in no frame.
 */
export function frameGroupIdForNode(
  groups: readonly GroupNode[],
  groupId: string | undefined,
): string | undefined {
  let gid = groupId;
  let hops = 0;
  while (gid && hops < 100) {
    const g = findGroup(groups, gid);
    if (!g) return undefined;
    if (g.isFrame) return gid;
    gid = g.parentGroupId;
    hops++;
  }
  return undefined;
}

/**
 * frameGroupId → the frame's active rect mask (its clipping boundary), for
 * every `isFrame` group that has one. A frame without a resolvable mask
 * (e.g. its boundary shape isn't closed) is omitted. Returns an empty map
 * when the scene has no frames.
 */
export function buildFrameRectMap(scene: MaskScene): ReadonlyMap<string, SVGObject> {
  const out = new Map<string, SVGObject>();
  let anyFrame = false;
  for (const g of scene.groups) if (g.isFrame) { anyFrame = true; break; }
  if (!anyFrame) return out;
  const maskMap = buildActiveMaskMap(scene);
  for (const g of scene.groups) {
    if (!g.isFrame) continue;
    const mask = maskMap.get(g.id);
    if (mask) out.set(g.id, mask);
  }
  return out;
}
