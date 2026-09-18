/**
 * A group chain, applied to a rectangle, a point or a free vector.
 *
 * The LEGACY spelling of a group transform: translate, non-uniform scale, a
 * quarter turn and two mirror flags, composed innermost-first up the
 * ancestor chain. The scene graph does the same job with one matrix per
 * node (`sceneTransform`), and that is what the editor runs on; this is
 * what the per-kind ARRAYS are still spelled in, so the readers and ops
 * that work in cell coordinates go through here.
 *
 * Note what the spelling cannot say: a shear, or a turn that is not a
 * multiple of 90 degrees composed with a non-uniform scale. That is why the
 * graph exists (docs/transform-refactor.md §2.2), and why nothing here is
 * the source of truth for a pose any more.
 *
 * Split out of `compositionOps` in P7, unchanged. `compositionOps`
 * re-exports all of it, so existing importers are unaffected.
 */

import { GroupNode, SVGObject } from './types';
import { Orientation, composeOrientation } from './transform2d';
import { computeSVGBbox } from './sceneGraph';


/** Apply a chain of group transforms (innermost first, root last) to a local bbox, returning world coords. */
export function applyChainedGroupTransform(
  chain: readonly GroupNode[],
  local: { cellX: number; cellY: number; cellWidth: number; cellHeight: number },
): { cellX: number; cellY: number; cellWidth: number; cellHeight: number } {
  let result = local;
  for (const group of chain) {
    result = applyGroupTransform(group, result);
  }
  return result;
}

/** Compose orientations through a chain of groups (innermost first, root last). */
export function composeChainedOrientations(
  chain: readonly GroupNode[],
  local: Orientation,
): Orientation {
  let result = local;
  for (const group of chain) {
    result = composeOrientation(
      { rotation: group.rotation, mirrorH: group.mirrorH, mirrorV: group.mirrorV },
      result,
    );
  }
  return result;
}

/** Apply a chain of group transforms (innermost first, root last) to a single 2D point. */
export function applyChainedGroupTransformPoint(
  chain: readonly GroupNode[],
  x: number, y: number,
): [number, number] {
  let px = x, py = y;
  for (const group of chain) {
    [px, py] = applyGroupTransformPoint(group, px, py);
  }
  return [px, py];
}

/** Apply a chain of group transforms to a 2D delta (a free vector, not a
 *  point). Same composition order as `applyChainedGroupTransformPoint` â€”
 *  mirror, rotate, scale â€” but translate is skipped because a delta is
 *  origin-invariant. Used for tile-grid offset / pattern phase, which is
 *  the displacement of the tile grid from the figure's origin and must
 *  scale with the chain so the pattern stays locked to the figure as the
 *  group resizes. */
export function applyChainedGroupTransformDelta(
  chain: readonly GroupNode[],
  dx: number, dy: number,
): [number, number] {
  let x = dx, y = dy;
  for (const group of chain) {
    if (group.mirrorH) x = -x;
    if (group.mirrorV) y = -y;
    if (group.rotation === 90) { const nx = -y, ny = x; x = nx; y = ny; }
    else if (group.rotation === 180) { x = -x; y = -y; }
    else if (group.rotation === 270) { const nx = y, ny = -x; x = nx; y = ny; }
    x *= group.scaleX;
    y *= group.scaleY;
  }
  return [x, y];
}

/** Inverse of `applyChainedGroupTransformDelta` â€” undoes scale, rotation,
 *  mirror (in that order) walking the chain outermost-first. */
export function inverseChainedGroupTransformDelta(
  chain: readonly GroupNode[],
  dx: number, dy: number,
): [number, number] {
  let x = dx, y = dy;
  for (let i = chain.length - 1; i >= 0; i--) {
    const group = chain[i];
    x /= group.scaleX;
    y /= group.scaleY;
    if (group.rotation === 90) { const nx = y, ny = -x; x = nx; y = ny; }
    else if (group.rotation === 180) { x = -x; y = -y; }
    else if (group.rotation === 270) { const nx = -y, ny = x; x = nx; y = ny; }
    if (group.mirrorV) y = -y;
    if (group.mirrorH) x = -x;
  }
  return [x, y];
}

// â”€â”€ Scene-graph transform helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Apply a `GroupNode` transform to a member's local-space rect, returning
 * the world-space rect. Mirror flips first, then 90Â° rotation, then
 * uniform-per-axis scale, then translate. Pure float math â€” no rounding.
 */
export function applyGroupTransform(
  group: { translateX: number; translateY: number; scaleX: number; scaleY: number; rotation: 0 | 90 | 180 | 270; mirrorH: boolean; mirrorV: boolean },
  local: { cellX: number; cellY: number; cellWidth: number; cellHeight: number },
): { cellX: number; cellY: number; cellWidth: number; cellHeight: number } {
  let { cellX: x, cellY: y, cellWidth: w, cellHeight: h } = local;
  if (group.mirrorH) x = -(x + w);
  if (group.mirrorV) y = -(y + h);
  if (group.rotation === 90) {
    const nx = -(y + h), ny = x, nw = h, nh = w;
    x = nx; y = ny; w = nw; h = nh;
  } else if (group.rotation === 180) {
    const nx = -(x + w), ny = -(y + h);
    x = nx; y = ny;
  } else if (group.rotation === 270) {
    const nx = y, ny = -(x + w), nw = h, nh = w;
    x = nx; y = ny; w = nw; h = nh;
  }
  return {
    cellX: group.translateX + x * group.scaleX,
    cellY: group.translateY + y * group.scaleY,
    cellWidth:  w * group.scaleX,
    cellHeight: h * group.scaleY,
  };
}

/**
 * Apply a `GroupNode` transform to a single 2D point. Mirror flips first,
 * then 90Â° rotation, then per-axis scale, then translate. Used to
 * materialize line vertices through their group.
 */
export function applyGroupTransformPoint(
  group: { translateX: number; translateY: number; scaleX: number; scaleY: number; rotation: 0 | 90 | 180 | 270; mirrorH: boolean; mirrorV: boolean },
  pointX: number, pointY: number,
): [number, number] {
  let x = pointX, y = pointY;
  if (group.mirrorH) x = -x;
  if (group.mirrorV) y = -y;
  if (group.rotation === 90) { const nx = -y, ny = x; x = nx; y = ny; }
  else if (group.rotation === 180) { x = -x; y = -y; }
  else if (group.rotation === 270) { const nx = y, ny = -x; x = nx; y = ny; }
  return [group.translateX + x * group.scaleX, group.translateY + y * group.scaleY];
}

/**
 * Transform a line's `creationBox` through the group, then snap the
 * perpendicular (non-scaling) dimension to the composition grid so
 * H/V lines land on clean grid edges after ungrouping.  Snapping is
 * skipped when the snapped box would not keep the line centered â€” the
 * vertex sits at the midpoint of the creation box, so if snapping
 * shifts that midpoint the line would be off-center.
 */
export function ungroupCreationBox(
  line: SVGObject,
  group: GroupNode,
  gridLevel: number,
): { minX: number; minY: number; width: number; height: number } | undefined {
  const step = Math.pow(2, gridLevel);

  // For H/V lines, derive the creation box from the world segments so the
  // result is always correct regardless of how the group was rotated or
  // mirrored â€” and even when creationBox was dropped during duplication
  // into a different group.  The thin axis gets exactly one grid cell,
  // centered on the line; the long axis spans the full segment extent.
  if (line.lineDirection === 'horizontal' || line.lineDirection === 'vertical') {
    const bb = computeSVGBbox(line.segments);
    if (bb.cellWidth < bb.cellHeight) {
      // Visually vertical â€” thin axis is X.
      const cx = bb.cellX + bb.cellWidth / 2;
      return { minX: cx - step / 2, minY: bb.cellY, width: step, height: bb.cellHeight };
    } else {
      // Visually horizontal â€” thin axis is Y.
      const cy = bb.cellY + bb.cellHeight / 2;
      return { minX: bb.cellX, minY: cy - step / 2, width: bb.cellWidth, height: step };
    }
  }

  // Non-H/V SVGs: transform the stored creation box through the group.
  if (!line.creationBox) return undefined;
  const t = applyGroupTransform(group, {
    cellX: line.creationBox.minX, cellY: line.creationBox.minY,
    cellWidth: line.creationBox.width, cellHeight: line.creationBox.height,
  });
  return { minX: t.cellX, minY: t.cellY, width: t.cellWidth, height: t.cellHeight };
}

/** Recalculate lineDirection from world-space segment geometry.
 *  Called during ungroup so a group rotation that swapped the visual
 *  axis of an H/V line is reflected in the metadata. Returns the
 *  original value unchanged for null, diagonal, or equal-extent cases. */
export function recalcLineDirection(
  s: SVGObject,
): 'horizontal' | 'vertical' | 'diagonal' | undefined {
  if (s.lineDirection == null || s.lineDirection === 'diagonal') return s.lineDirection;
  const bb = computeSVGBbox(s.segments);
  if (bb.cellWidth < bb.cellHeight) return 'vertical';
  if (bb.cellHeight < bb.cellWidth) return 'horizontal';
  return s.lineDirection;
}

/**
 * Invert a single group transform on a 2D point.
 */
function inverseGroupTransformPoint(
  group: { translateX: number; translateY: number; scaleX: number; scaleY: number; rotation: 0 | 90 | 180 | 270; mirrorH: boolean; mirrorV: boolean },
  worldX: number, worldY: number,
): [number, number] {
  let x = (worldX - group.translateX) / group.scaleX;
  let y = (worldY - group.translateY) / group.scaleY;
  if (group.rotation === 90) { const nx = y, ny = -x; x = nx; y = ny; }
  else if (group.rotation === 180) { x = -x; y = -y; }
  else if (group.rotation === 270) { const nx = -y, ny = x; x = nx; y = ny; }
  if (group.mirrorV) y = -y;
  if (group.mirrorH) x = -x;
  return [x, y];
}

export function inverseChainedGroupTransformPoint(
  chain: readonly GroupNode[],
  worldX: number, worldY: number,
): [number, number] {
  let x = worldX, y = worldY;
  for (let i = chain.length - 1; i >= 0; i--) {
    [x, y] = inverseGroupTransformPoint(chain[i], x, y);
  }
  return [x, y];
}
