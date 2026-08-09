import {
  CompositionState,
  CompUndoEntry,
  PathSegment,
  SVGObject,
  SVGSubpath,
} from './types';
import { rotateSegmentsAbout } from './compositionArcMath';
import {
  applyCompOps,
  buildRemoveObjectOps,
  clonePathSegment,
  computeSVGBbox,
  mergeIdsIntoSceneOrder,
} from './compositionOps';

/**
 * Merge (flatten): make ONE svg object out of several. A structural operation
 * — after it the scene outline holds one row where it held five, and that row
 * selects, transforms and moves as a single thing.
 *
 * NOT a boolean shape operation. The boolean family (union / difference /
 * intersect / exclude, of which only union is ported — see
 * `compositionGeometricUnion.ts`) resolves the OVERLAPS of closed regions into
 * a new region, and asks its sources to BE regions. Merge asks nothing of its
 * sources' geometry: every segment survives exactly where it was, open or
 * closed, overlapping or scattered. Two crossing lines merge into one object
 * holding two crossing lines; a boolean union of them is meaningless.
 *
 * What survives: every source's geometry, and its stroke color and solid fill
 * via `subpaths` (the same per-color mechanism join uses). What collapses onto
 * the front-most source's values: the object-level settings a single object
 * can only have one of — stroke width/dash, effects, opacity, name. Gradient
 * fills and paint overlays are object-level too, so a source carrying one
 * keeps its geometry and loses that paint.
 *
 * What cannot merge: pattern tiles and pattern-filled masks (a tiling is not
 * an outline), and — at the selection level — text, images and figures. Those
 * are not svg objects, and a merge that quietly left one behind would read as
 * a bug.
 */

/** A source's segments in the space they are DRAWN in.
 *
 *  Discrete rotation / mirror is already baked into `segments` by the ops that
 *  set it, but free rotation (`angleDeg`) is layered at render time about the
 *  bbox center. The merged object has one geometry and no per-source angle to
 *  layer, so the angle is baked here — otherwise a twisted shape would snap
 *  upright the moment it merged. */
function drawnSegments(svg: SVGObject, segments: readonly PathSegment[]): PathSegment[] {
  const cloned = segments.map(clonePathSegment);
  if (!svg.angleDeg) return cloned;
  return rotateSegmentsAbout(
    cloned,
    svg.cellX + svg.cellWidth / 2,
    svg.cellY + svg.cellHeight / 2,
    svg.angleDeg,
  );
}

/** The colored sub-paths one source contributes. Its solid fill comes first
 *  (fill sub-paths render beneath stroked ones), then its stroke — or its own
 *  sub-paths, when it already carries them (a previous merge, or a join of
 *  different-colored objects). */
function subpathsForSource(svg: SVGObject): SVGSubpath[] {
  const out: SVGSubpath[] = [];
  if (svg.fillColor) {
    out.push({ segments: drawnSegments(svg, svg.segments), color: { ...svg.fillColor }, fill: true });
  }
  if (svg.subpaths && svg.subpaths.length > 0) {
    for (const sub of svg.subpaths) {
      out.push({
        segments: drawnSegments(svg, sub.segments),
        color: { ...sub.color },
        ...(sub.fill ? { fill: true as const } : null),
      });
    }
    return out;
  }
  out.push({ segments: drawnSegments(svg, svg.segments), color: { ...svg.color } });
  return out;
}

/** True when these objects can be flattened into one: ≥2 of them, each with
 *  geometry, none a pattern (a tile or the mask of a pattern fill). Nothing is
 *  asked of the geometry itself — that is the whole point of a merge. */
export function canMergeObjects(items: readonly SVGObject[]): boolean {
  if (items.length < 2) return false;
  for (const it of items) {
    if (it.tileMode === 'repeat' || it.isPatternFill) return false;
    if (it.segments.length === 0) return false;
  }
  return true;
}

/** The one object `sources` (given back-to-front) flatten into.
 *
 *  `groupSurvives` says whether the sources' shared group still has members
 *  once they are spent: merging a group's LAST objects empties it, the removal
 *  prunes it, and the merged object must not be left pointing at a group that
 *  is gone. The caller knows (it holds the post-removal scene); a lone flatten
 *  outside any group doesn't care either way. */
export function mergedSVGObject(
  sources: readonly SVGObject[],
  id: string,
  groupSurvives = true,
): SVGObject {
  const top = sources[sources.length - 1];
  const segments: PathSegment[] = [];
  const subpaths: SVGSubpath[] = [];
  for (const src of sources) {
    segments.push(...drawnSegments(src, src.segments));
    subpaths.push(...subpathsForSource(src));
  }
  // The merged object keeps its group ONLY when every source was in the same
  // one and each has the local geometry that group transforms re-derive from:
  // the locals concatenate in the same order as the world segments, so the two
  // stay parallel. Anything else (mixed groups, a freely-rotated member whose
  // bake has no local equivalent) and the merged object leaves the group
  // rather than carrying a local list that doesn't match what's on screen.
  const groupId = groupSurvives
    && sources.every((s) => s.groupId && s.groupId === top.groupId && s.localSegments && !s.angleDeg)
    ? top.groupId
    : undefined;
  const localSegments = groupId
    ? sources.flatMap((s) => (s.localSegments ?? []).map(clonePathSegment))
    : undefined;
  return {
    id,
    segments,
    subpaths,
    color: { ...top.color },
    ...(top.name ? { name: top.name } : null),
    ...(top.stroke ? { stroke: { ...top.stroke } } : null),
    ...(top.effects ? { effects: { ...top.effects } } : null),
    ...(top.opacity != null ? { opacity: top.opacity } : null),
    ...(groupId ? { groupId, localSegments } : null),
    ...computeSVGBbox(segments),
  };
}

/** What a selection resolves to for Merge: its svg objects in back-to-front
 *  order, or null when the selection holds something that cannot be flattened
 *  into an svg object (text, an image, a figure, a pattern). */
function resolveMergeSelection(
  state: CompositionState,
  selectedIds: ReadonlySet<string>,
): SVGObject[] | null {
  for (const fig of state.figures) if (selectedIds.has(fig.id)) return null;
  for (const img of state.images ?? []) if (selectedIds.has(img.id)) return null;
  for (const text of state.texts ?? []) if (selectedIds.has(text.id)) return null;

  const rank = new Map(state.sceneOrder.map((id, i) => [id, i]));
  const sources = state.svgObjects
    .filter((svg) => selectedIds.has(svg.id))
    .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  return canMergeObjects(sources) ? sources : null;
}

/** True when the given selection can be merged into one svg object. */
export function canMergeSelection(
  state: CompositionState,
  selectedIds: ReadonlySet<string>,
): boolean {
  return resolveMergeSelection(state, selectedIds) !== null;
}

/**
 * Build the undo entry that replaces the selected svg objects with the single
 * object they flatten into, at the front-most source's z-slot. Null when the
 * selection can't merge.
 */
export function buildMergeEntry(
  state: CompositionState,
  selectedIds: ReadonlySet<string>,
): { entry: CompUndoEntry; resultId: string } | null {
  const sources = resolveMergeSelection(state, selectedIds);
  if (!sources) return null;

  const sourceIds = sources.map((s) => s.id);
  // Spend the sources first: the removal prunes any group they emptied, and
  // whether that group is still standing decides if the merged object may
  // claim it.
  const cleaned = applyCompOps(state, buildRemoveObjectOps(state, sourceIds));
  const sharedGroupId = sources[sources.length - 1].groupId;
  const groupSurvives = !sharedGroupId || cleaned.groups.some((g) => g.id === sharedGroupId);
  const result = mergedSVGObject(sources, `svg_${Date.now()}_mg`, groupSurvives);

  const next: CompositionState = {
    ...cleaned,
    svgObjects: [...cleaned.svgObjects, result],
    sceneOrder: mergeIdsIntoSceneOrder(state.sceneOrder, new Set(sourceIds), result.id),
  };

  return {
    entry: [{
      op: 'replaceScene',
      oldFigures: state.figures, newFigures: next.figures,
      oldSVGObjects: state.svgObjects, newSVGObjects: next.svgObjects,
      oldImages: state.images ?? [], newImages: next.images ?? [],
      oldGroups: state.groups, newGroups: next.groups,
      oldSceneOrder: state.sceneOrder, newSceneOrder: next.sceneOrder,
    }],
    resultId: result.id,
  };
}
