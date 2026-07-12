import { GroupNode, SVGObject } from './types';
import { buildClosedFillPathD } from './svgPathBuilder';

/**
 * SVG clip-path construction for "Use as mask" shapes — shared by the app's
 * live DOM layer and SVG export (`compositionSVGCore.ts`) so the def-ids
 * and path-d construction never fork. Logic-only (string-producing); the active-mask resolution itself
 * lives in `compositionMask.ts`.
 *
 * Nesting is expressed by chaining one `<clipPath>` to its nearest
 * ancestor-group mask via the clipPath element's own `clip-path`
 * attribute, which SVG intersects. So a single `clip-path="url(#…)"` on a
 * node wrapper picks up the full ancestor intersection.
 */

export const MASK_CLIP_ID_PREFIX = 'groupmask-';

function findGroup(groups: readonly GroupNode[], gid: string): GroupNode | undefined {
  for (const g of groups) if (g.id === gid) return g;
  return undefined;
}

/**
 * Nearest ancestor-or-self group (walking `parentGroupId` from
 * `startGroupId`) that has an active mask, or undefined.
 */
function nearestMaskGroupId(
  maskMap: ReadonlyMap<string, SVGObject>,
  groups: readonly GroupNode[],
  startGroupId: string | undefined,
): string | undefined {
  let gid: string | undefined = startGroupId;
  let hops = 0;
  while (gid && hops < 100) {
    if (maskMap.has(gid)) return gid;
    gid = findGroup(groups, gid)?.parentGroupId;
    hops++;
  }
  return undefined;
}

/**
 * The clip-path id a node's markup should reference, or undefined when the
 * node is unclipped. A mask object is exempt from its own group's mask but
 * still subject to ancestor masks (so it resolves to the parent chain).
 */
export function maskClipIdForNode(
  maskMap: ReadonlyMap<string, SVGObject>,
  groups: readonly GroupNode[],
  node: { id: string; groupId?: string },
): string | undefined {
  if (maskMap.size === 0) return undefined;
  let gid = nearestMaskGroupId(maskMap, groups, node.groupId);
  if (gid && maskMap.get(gid)!.id === node.id) {
    // This node *is* its group's mask — skip its own clip, keep ancestors.
    gid = nearestMaskGroupId(maskMap, groups, findGroup(groups, gid)?.parentGroupId);
  }
  return gid ? MASK_CLIP_ID_PREFIX + gid : undefined;
}

/**
 * Build a `<defs>` block with one `<clipPath>` per masked group, each
 * chained to its nearest ancestor-group mask so nested masks intersect.
 * Returns '' when there are no masks (or none produced usable geometry).
 */
export function buildMaskClipDefs(
  maskMap: ReadonlyMap<string, SVGObject>,
  groups: readonly GroupNode[],
): string {
  if (maskMap.size === 0) return '';
  let body = '';
  for (const [gid, mask] of maskMap) {
    const d = buildClosedFillPathD(mask.segments);
    if (!d) continue;
    const parentMaskGid = nearestMaskGroupId(
      maskMap, groups, findGroup(groups, gid)?.parentGroupId,
    );
    const chain = parentMaskGid
      ? ` clip-path="url(#${MASK_CLIP_ID_PREFIX}${parentMaskGid})"`
      : '';
    body += `<clipPath id="${MASK_CLIP_ID_PREFIX}${gid}" clipPathUnits="userSpaceOnUse"${chain}>`
      + `<path d="${d}" />`
      + `</clipPath>`;
  }
  return body ? `<defs>${body}</defs>` : '';
}

/**
 * Wrap a node's SVG markup in a `<g clip-path>` when it falls inside a
 * masked group; returns `content` unchanged otherwise.
 */
export function wrapWithMaskClip(
  content: string,
  maskMap: ReadonlyMap<string, SVGObject>,
  groups: readonly GroupNode[],
  node: { id: string; groupId?: string },
): string {
  const clipId = maskClipIdForNode(maskMap, groups, node);
  return clipId ? `<g clip-path="url(#${clipId})">${content}</g>` : content;
}
