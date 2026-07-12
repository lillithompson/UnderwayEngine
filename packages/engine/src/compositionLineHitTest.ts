import { PathSegment, SVGObject } from './types';
import { arcBoundingBox } from './compositionArcHitTest';

/**
 * Bounding box of a line in L0-cell space. Prefers `creationBox` when
 * present and the line is ungrouped; otherwise falls back to the tight
 * AABB of vertices. Returns `null` for an empty vertex list.
 *
 * Grouped lines skip `creationBox` because the group transform updates
 * `vertices` via `materializeGroupMembers` but never touches
 * `creationBox` — so a stale creationBox would put hit-test, snap
 * anchors, and the corner-handle bbox at the line's pre-move
 * position. `ungroupCreationBox` snaps creationBox back to the world
 * at ungroup time; until then, vertex AABB is the source of truth.
 */
export function lineBoundingBox(
  line: { segments?: ReadonlyArray<{ start: readonly [number, number]; end: readonly [number, number]; center?: readonly [number, number] }>; creationBox?: { minX: number; minY: number; width: number; height: number }; groupId?: string },
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (line.creationBox && !line.groupId) {
    const { minX, minY, width, height } = line.creationBox;
    return { minX, minY, maxX: minX + width, maxY: minY + height };
  }
  if (!line.segments || line.segments.length === 0) return null;
  // Single source of truth for the segment AABB (arc-aware: includes the
  // swept axis extremes, not just endpoints + center).
  return arcBoundingBox(line.segments as ReadonlyArray<PathSegment>);
}

/** Single-item hit-test: does this line accept a click at (rawX, rawY)?
 *  Locked lines never hit (unless `ignoreLock` is set). Tiled lines test
 *  against the region bbox; non-tiled lines test against the inflated
 *  vertex AABB (min 0.25 cell).
 *
 *  Single-vertex / horizontal / vertical polylines collapse to a 0-width
 *  or 0-height AABB, which would never accept a hit. Those cases are
 *  inflated to a small minimum size so the user can still select them. */
export function lineHitsCell(line: SVGObject, rawX: number, rawY: number, ignoreLock?: boolean): boolean {
  if (line.hidden) return false;
  if (line.locked && !ignoreLock) return false;
  if (line.tileMode === 'repeat') {
    return rawX >= line.cellX && rawX <= line.cellX + line.cellWidth
      && rawY >= line.cellY && rawY <= line.cellY + line.cellHeight;
  }
  const bb = lineBoundingBox(line);
  if (!bb) return false;
  const minSize = 0.25;
  let { minX, minY, maxX, maxY } = bb;
  if (maxX - minX < minSize) {
    const cx = (minX + maxX) / 2;
    minX = cx - minSize / 2; maxX = cx + minSize / 2;
  }
  if (maxY - minY < minSize) {
    const cy = (minY + maxY) / 2;
    minY = cy - minSize / 2; maxY = cy + minSize / 2;
  }
  return rawX >= minX && rawX <= maxX && rawY >= minY && rawY <= maxY;
}

/**
 * Find the topmost line (last in z-order) whose **bounding box** contains
 * the click point. `rawX/Y` are in L0 cells. Locked lines are skipped.
 * Selection style matches figures, which also use AABB hit-testing.
 */
export function findLineAtCell(
  rawX: number, rawY: number,
  lines: ReadonlyArray<SVGObject>,
): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lineHitsCell(lines[i], rawX, rawY)) return lines[i].id;
  }
  return null;
}
