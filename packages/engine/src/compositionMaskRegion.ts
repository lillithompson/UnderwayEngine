import { CompositionState, PathSegment } from './types';
import {
  getFlattenedClosedPath,
  pointInClosedPath,
  flattenSegmentsToEdges,
  segmentsIntersect,
} from './compositionPathHitTest';
import { arcBoundingBox } from './compositionArcHitTest';
import { isItemLocked, getItemGroupId, findRootGroupId } from './compositionOps';
import { adapterForId, Bbox } from './sceneNodeGeometry';

/**
 * The set of scene objects that overlap a mask shape's interior, partitioned
 * the way `groupFigures` consumes them:
 *  - `figureIds`  — loose (ungrouped) objects to fold directly into the group.
 *  - `childGroupIds` — root groups (deduped) to nest whole, for any overlapping
 *    object that already belongs to a different group.
 *
 * Computed by the interactive "set mask" mode on confirm.
 */
export interface MaskMembership {
  figureIds: string[];
  childGroupIds: string[];
}

/**
 * True when an object's world bbox overlaps the closed region described by
 * `maskSegments` at all ("any overlap" rule). Tests both directions so it
 * catches: object inside the mask, the mask inside the object, and edge
 * straddles where a corner of one lands in the other. Known limitation: it
 * does not detect a pure edge-cross with no vertex containment (rare for
 * these shapes). `maskSegments` is passed straight through to
 * `pointInClosedPath`, which caches its flattened polygon by reference.
 */
export function bboxOverlapsMask(
  maskSegments: readonly PathSegment[],
  bbox: Bbox,
): boolean {
  const x0 = bbox.cellX;
  const y0 = bbox.cellY;
  const x1 = bbox.cellX + bbox.cellWidth;
  const y1 = bbox.cellY + bbox.cellHeight;
  // Any bbox corner or its center inside the mask → overlap.
  const probes: [number, number][] = [
    [x0, y0], [x1, y0], [x0, y1], [x1, y1], [(x0 + x1) / 2, (y0 + y1) / 2],
  ];
  for (const [px, py] of probes) {
    if (pointInClosedPath(maskSegments, px, py)) return true;
  }
  // Any mask-polygon vertex inside the bbox → overlap (mask smaller than /
  // contained by the object).
  const poly = getFlattenedClosedPath(maskSegments);
  if (poly) {
    for (let i = 0; i < poly.length; i += 2) {
      const vx = poly[i];
      const vy = poly[i + 1];
      if (vx >= x0 && vx <= x1 && vy >= y0 && vy <= y1) return true;
    }
  }
  return false;
}

/**
 * True when any part of `shapeSegments`' stroke lies within the closed region
 * described by `maskSegments` — either a stroke point falls inside the mask
 * interior, or a stroke edge crosses the mask boundary. This is the inclusion
 * rule for UNFILLED shapes, whose only mask-visible content is their outline:
 * a shape that merely surrounds the mask (e.g. a concentric outer circle)
 * contributes no visible stroke and is excluded, where `bboxOverlapsMask`
 * would wrongly pull it in via the mask-vertex-in-bbox clause.
 *
 * Returns false for an open/unchainable mask (matching `bboxOverlapsMask`).
 */
export function strokeIntersectsMaskRegion(
  maskSegments: readonly PathSegment[],
  shapeSegments: readonly PathSegment[],
): boolean {
  const maskPoly = getFlattenedClosedPath(maskSegments);
  if (!maskPoly || shapeSegments.length === 0) return false;

  // Cheap AABB reject before the O(edges²) crossing test.
  const sb = arcBoundingBox(shapeSegments);
  if (!sb) return false;
  let mMinX = Infinity, mMinY = Infinity, mMaxX = -Infinity, mMaxY = -Infinity;
  for (let i = 0; i < maskPoly.length; i += 2) {
    const x = maskPoly[i], y = maskPoly[i + 1];
    if (x < mMinX) mMinX = x;
    if (y < mMinY) mMinY = y;
    if (x > mMaxX) mMaxX = x;
    if (y > mMaxY) mMaxY = y;
  }
  if (sb.maxX < mMinX || sb.minX > mMaxX || sb.maxY < mMinY || sb.minY > mMaxY) {
    return false;
  }

  const edges = flattenSegmentsToEdges(shapeSegments);
  const n = maskPoly.length / 2;
  for (let e = 0; e < edges.length; e += 4) {
    const ax = edges[e], ay = edges[e + 1], bx = edges[e + 2], by = edges[e + 3];
    // (1) either endpoint inside the mask interior.
    if (pointInClosedPath(maskSegments, ax, ay)) return true;
    if (pointInClosedPath(maskSegments, bx, by)) return true;
    // (2) the stroke edge crosses any mask-polygon edge.
    for (let i = 0, j = n - 1; i < n; j = i++) {
      if (segmentsIntersect(
        ax, ay, bx, by,
        maskPoly[2 * j], maskPoly[2 * j + 1], maskPoly[2 * i], maskPoly[2 * i + 1],
      )) return true;
    }
  }
  return false;
}

/**
 * Determine which scene objects overlap the mask object's interior and how
 * they should be folded into the mask group. Excludes the mask itself and
 * locked objects. An overlapping object that belongs to a group contributes
 * its root group to `childGroupIds` (nest whole, never split); a loose
 * overlapping object contributes its id to `figureIds`.
 *
 * Intended for the loose-mask flow: the mask is not yet grouped, so it has no
 * own root group to skip. If the mask is already grouped, its root group is
 * excluded so the caller can't accidentally nest it into itself.
 */
export function computeMaskMembership(
  state: CompositionState,
  maskId: string,
): MaskMembership {
  const mask = state.svgObjects.find((s) => s.id === maskId);
  if (!mask || !getFlattenedClosedPath(mask.segments)) {
    return { figureIds: [], childGroupIds: [] };
  }
  const maskGid = getItemGroupId(state, maskId);
  const maskRoot = maskGid ? findRootGroupId(state.groups, maskGid) : undefined;

  const figureIds: string[] = [];
  const childGroupIds = new Set<string>();

  const consider = (id: string) => {
    if (id === maskId) return;
    if (isItemLocked(state, id)) return;
    const obj = findObject(state, id);
    if (!obj) return;
    const svg = state.svgObjects.find((s) => s.id === id);
    // Unfilled, non-tiled stroke shapes: include only if a stroke actually
    // enters the mask region. Filled SVGs, tiled SVGs, figures, and images
    // show area/raster content, so the bbox-interior rule still applies.
    if (svg && svg.fillColor == null && svg.tileMode !== 'repeat') {
      const allSegments = svg.subpaths && svg.subpaths.length > 0
        ? [...svg.segments, ...svg.subpaths.flatMap((sub) => sub.segments)]
        : svg.segments;
      if (!strokeIntersectsMaskRegion(mask.segments, allSegments)) return;
    } else {
      const bbox = adapterForId(id).computeBbox(obj);
      if (!bboxOverlapsMask(mask.segments, bbox)) return;
    }
    const gid = getItemGroupId(state, id);
    if (gid) {
      const root = findRootGroupId(state.groups, gid);
      if (root !== maskRoot) childGroupIds.add(root);
    } else {
      figureIds.push(id);
    }
  };

  for (const f of state.figures) consider(f.id);
  for (const s of state.svgObjects) consider(s.id);
  for (const i of state.images ?? []) consider(i.id);

  return { figureIds, childGroupIds: [...childGroupIds] };
}

function findObject(state: CompositionState, id: string) {
  return (
    state.figures.find((f) => f.id === id) ??
    state.svgObjects.find((s) => s.id === id) ??
    (state.images ?? []).find((i) => i.id === id)
  );
}
