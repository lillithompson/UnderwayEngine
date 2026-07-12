import {
  CompositionFigure,
  CompositionState,
  CompUndoEntry,
  PathSegment,
  SVGObject,
} from './types';
import {
  chainSegmentsLoops,
  computeSignedArea,
  isClosedPath,
  reverseSegment,
} from './compositionArcMath';
import { unionRegionContours } from './outlineUnion';
import {
  applyCompOps,
  buildRemoveObjectOps,
  computeSVGBbox,
  clonePathSegment,
  mergeIdsIntoSceneOrder,
} from './compositionOps';
import { findPatternFillInfo } from './patternFill';
import { nextFigureName, nextGroupName } from './sceneOutlineHelpers';

/**
 * Geometric Union: merge overlapping closed shapes into one closed shape whose
 * outline is the outer boundary of all inputs, with any holes the topology
 * encloses. Distinct from Join (engine/compositionJoin.ts), which only
 * concatenates strokes end-to-end without resolving overlaps.
 *
 * The heavy lifting lives in `unionRegionContours` (engine/outlineUnion.ts):
 * given a bag of consistently-oriented closed loops it returns clean
 * non-self-intersecting contours — outer loops (CW, +area) first, then holes
 * (CCW, −area) — rendered correctly with `fill-rule="nonzero"`. Arcs stay
 * exact.
 *
 * A selection may contain *pattern fills* — a closed mask shape
 * (`isPatternFill`) grouped with a sibling `tileMode:'repeat'` figure (see
 * `engine/patternFill.ts`). The union runs on the mask outlines; the result's
 * fill follows the user's rule: when EVERY shape is pattern-filled the union
 * adopts the top-most shape's pattern (tile params + background fill + paint,
 * kept world-anchored); a mixed selection drops all pattern fills. Solid
 * `fillColor` fills are unaffected — the result always inherits the top-most
 * shape's solid fill, as a plain (non-pattern) union always has.
 */

/** True when every item is a closed, non-tiled path and there are ≥2 of them. */
export function canUnion(items: readonly SVGObject[]): boolean {
  if (items.length < 2) return false;
  for (const it of items) {
    if (it.tileMode === 'repeat') return false; // pattern tiles aren't simple outlines
    if (!isClosedPath(it.segments)) return false;
  }
  return true;
}

/**
 * Normalize one source shape's segments into consistently-oriented closed
 * loops for the union input. A single loop is forced clockwise (CW, +area in
 * screen-y-down) so all sources agree; a shape that already has holes
 * (multiple loops, e.g. a prior union) is left untouched — its outer/hole
 * orientation is already a coherent nonzero region.
 */
function normalizeSourceForUnion(svg: SVGObject): PathSegment[] {
  const loops = chainSegmentsLoops(svg.segments);
  if (!loops) return svg.segments.map(clonePathSegment);
  if (loops.length === 1) {
    const loop = loops[0];
    return computeSignedArea(loop) < 0
      ? loop.slice().reverse().map(reverseSegment)
      : loop.map(clonePathSegment);
  }
  // Multi-loop source: preserve existing outer/hole orientation.
  return loops.flat().map(clonePathSegment);
}

/** The front-most (top of z-order) of the given sources, per sceneOrder. */
function topMostSource(state: CompositionState, sources: readonly SVGObject[]): SVGObject {
  const order = state.sceneOrder;
  let top = sources[0];
  let topRank = order.indexOf(top.id);
  for (let i = 1; i < sources.length; i++) {
    const rank = order.indexOf(sources[i].id);
    if (rank > topRank) { topRank = rank; top = sources[i]; }
  }
  return top;
}

/** Bounding box of the merged segments. */
interface UnionGeometry {
  segments: PathSegment[];
  bbox: { cellX: number; cellY: number; cellWidth: number; cellHeight: number };
  top: SVGObject;
}

/** Shared geometric core: merge the shape outlines and pick the front-most
 *  source. Returns null when the inputs can't be unioned or the result is
 *  empty/open. */
function computeUnionGeometry(
  state: CompositionState,
  shapes: readonly SVGObject[],
): UnionGeometry | null {
  if (!canUnion(shapes)) return null;
  const allSegments: PathSegment[] = [];
  for (const svg of shapes) allSegments.push(...normalizeSourceForUnion(svg));
  const segments = unionRegionContours(allSegments);
  if (segments.length === 0 || !isClosedPath(segments)) return null;
  return { segments, bbox: computeSVGBbox(segments), top: topMostSource(state, shapes) };
}

/** Build the result SVGObject (the merged outline). Inherits stroke color, the
 *  top-most solid fill, and name from the front-most source. */
function buildResultShape(geom: UnionGeometry): SVGObject {
  const { top, segments, bbox } = geom;
  return {
    id: `svg_${Date.now()}_un`,
    segments,
    color: { ...top.color },
    ...(top.fillColor ? { fillColor: { ...top.fillColor } } : {}),
    ...(top.fillOpacity != null ? { fillOpacity: top.fillOpacity } : {}),
    name: top.name,
    cellX: bbox.cellX, cellY: bbox.cellY, cellWidth: bbox.cellWidth, cellHeight: bbox.cellHeight,
  };
}

/**
 * Build the undo entry that replaces `sourceSVGs` with their geometric union.
 * Returns null if the inputs can't be unioned or the result is empty.
 * The result inherits stroke color + fill from the top-most source.
 *
 * SVG-only fast path (no pattern fills): a single `unionObjects` op.
 */
export function buildUnionFromSources(
  state: CompositionState,
  sourceSVGs: SVGObject[],
  sourceSVGIndices: number[],
): CompUndoEntry | null {
  const geom = computeUnionGeometry(state, sourceSVGs);
  if (!geom) return null;
  const result = buildResultShape(geom);
  return [{
    op: 'unionObjects',
    sourceSVGs,
    sourceSVGIndices,
    result,
    resultInsertIndex: sourceSVGIndices[0] ?? 0,
    oldSceneOrder: state.sceneOrder.slice(),
  }];
}

/**
 * The closed shapes a selection resolves to for Union, plus the pattern-fill
 * bookkeeping needed to rebuild/dissolve fills. A pattern fill selects as a
 * group (mask + tiled figure), so the tiled figures are folded into their mask
 * shape rather than counted as separate objects.
 */
interface UnionSelection {
  valid: boolean;
  shapes: SVGObject[];                 // the closed mask/plain shapes to union
  shapeIndices: number[];              // their index in state.svgObjects
  sourceFigureIds: string[];           // tiled figures backing selected pattern fills
  patternFigureByShape: Map<string, string>; // shape id → its tiled figure id
  allPatternFilled: boolean;           // every shape is a pattern fill
  anyPatternFilled: boolean;           // at least one shape is a pattern fill
}

/**
 * Resolve a raw selection into the closed shapes to union. Handles pattern-fill
 * groups: the mask is the shape, its sibling `tileMode:'repeat'` figure is
 * consumed (not a shape). Marks `valid=false` when the selection contains
 * anything that can't participate (a plain figure, image, open path, or an
 * orphan tiled figure whose mask isn't selected).
 */
function resolveUnionSelection(
  state: CompositionState,
  selectedIds: ReadonlySet<string>,
): UnionSelection {
  const invalid: UnionSelection = {
    valid: false, shapes: [], shapeIndices: [], sourceFigureIds: [],
    patternFigureByShape: new Map(), allPatternFilled: false, anyPatternFilled: false,
  };
  const shapes: SVGObject[] = [];
  const shapeIndices: number[] = [];
  const sourceFigureIds: string[] = [];
  const patternFigureByShape = new Map<string, string>();
  // Tiled figures that belong to a selected pattern fill (consumed, not shapes).
  const consumedFigureIds = new Set<string>();
  let patternCount = 0;

  for (let i = 0; i < state.svgObjects.length; i++) {
    const svg = state.svgObjects[i];
    if (!selectedIds.has(svg.id)) continue;
    if (svg.tileMode === 'repeat' || !isClosedPath(svg.segments)) return invalid;
    shapes.push(svg);
    shapeIndices.push(i);
    if (svg.isPatternFill) {
      const info = findPatternFillInfo(state, svg.id);
      if (!info) return invalid; // flagged pattern fill with no tiled sibling
      patternCount++;
      patternFigureByShape.set(svg.id, info.figureId);
      sourceFigureIds.push(info.figureId);
      consumedFigureIds.add(info.figureId);
    }
  }

  // Every selected figure must be a tiled member consumed by a selected mask;
  // any other figure (plain sprite, orphan tile) disqualifies the selection.
  for (const fig of state.figures) {
    if (!selectedIds.has(fig.id)) continue;
    if (!consumedFigureIds.has(fig.id)) return invalid;
  }
  // No images may be selected.
  for (const img of state.images ?? []) {
    if (selectedIds.has(img.id)) return invalid;
  }

  return {
    valid: shapes.length >= 2,
    shapes,
    shapeIndices,
    sourceFigureIds,
    patternFigureByShape,
    allPatternFilled: patternCount === shapes.length && shapes.length >= 2,
    anyPatternFilled: patternCount > 0,
  };
}

/** True when the given selection can be unioned (≥2 closed shapes, possibly
 *  pattern fills; no plain figures/images/open paths). */
export function canUnionSelection(
  state: CompositionState,
  selectedIds: ReadonlySet<string>,
): boolean {
  const sel = resolveUnionSelection(state, selectedIds);
  return sel.valid && canUnion(sel.shapes);
}

/** Clone the top-most pattern fill's tiled figure onto the union result's bbox,
 *  axis-aligned. Tile params (key/file/resolution/tile size) are preserved; the
 *  tile offsets phase-match the source's world tile grid so the pattern doesn't
 *  jump (unless the source is rotated/mirrored, where we centre instead). */
function buildUnionTiledFigure(
  src: CompositionFigure,
  bbox: { cellX: number; cellY: number; cellWidth: number; cellHeight: number },
  figureId: string,
  name: string,
): CompositionFigure {
  const tileWidthL0 = src.tileWidthL0 ?? bbox.cellWidth;
  const tileHeightL0 = src.tileHeightL0 ?? bbox.cellHeight;
  const axisAligned = (src.rotation ?? 0) === 0 && !src.mirrorH && !src.mirrorV;
  const srcOffX = src.tileOffsetXL0 ?? 0;
  const srcOffY = src.tileOffsetYL0 ?? 0;
  const tileOffsetXL0 = axisAligned
    ? srcOffX - (bbox.cellX - src.cellX) // keep world tile lines fixed
    : (bbox.cellWidth - tileWidthL0) / 2;
  const tileOffsetYL0 = axisAligned
    ? srcOffY - (bbox.cellY - src.cellY)
    : (bbox.cellHeight - tileHeightL0) / 2;
  return {
    id: figureId,
    figureKey: src.figureKey,
    name,
    cellX: bbox.cellX,
    cellY: bbox.cellY,
    cellWidth: bbox.cellWidth,
    cellHeight: bbox.cellHeight,
    resolutionX: src.resolutionX,
    resolutionY: src.resolutionY,
    tileMode: 'repeat',
    tileWidthL0,
    tileHeightL0,
    tileOffsetXL0,
    tileOffsetYL0,
    ...(src.fileId ? { fileId: src.fileId } : {}),
    ...(src.placementLevel != null ? { placementLevel: src.placementLevel } : {}),
  };
}

/**
 * Build the undo entry for unioning a selection, handling pattern fills.
 *
 * - No pattern fills involved → the SVG-only `unionObjects` fast path.
 * - Pattern fills involved → a `replaceScene` snapshot that removes every source
 *   mask, tiled figure and pattern-fill group, inserts the merged shape, and —
 *   when EVERY shape was pattern-filled — re-creates a pattern fill on the
 *   result from the top-most shape (tiled figure + group + flags). Returns the
 *   entry plus the merged shape's id (so the caller can
 *   select it — the `replaceScene` op doesn't update selection). Null when the
 *   selection can't be unioned.
 */
export function buildUnionEntry(
  state: CompositionState,
  selectedIds: ReadonlySet<string>,
): { entry: CompUndoEntry; resultId: string } | null {
  const sel = resolveUnionSelection(state, selectedIds);
  if (!sel.valid) return null;
  const geom = computeUnionGeometry(state, sel.shapes);
  if (!geom) return null;

  const result = buildResultShape(geom);

  // No pattern fills: the lean SVG-only `unionObjects` op (selects the result
  // in its reducer, unchanged behavior).
  if (!sel.anyPatternFilled) {
    return {
      entry: [{
        op: 'unionObjects',
        sourceSVGs: sel.shapes,
        sourceSVGIndices: sel.shapeIndices,
        result,
        resultInsertIndex: sel.shapeIndices[0] ?? 0,
        oldSceneOrder: state.sceneOrder.slice(),
      }],
      resultId: result.id,
    };
  }

  // Remove every source mask and every tiled figure; empty pattern-fill groups
  // are pruned by buildRemoveObjectOps (undo restores them).
  const removeIds = [...sel.shapes.map(s => s.id), ...sel.sourceFigureIds];
  const cleaned = applyCompOps(state, buildRemoveObjectOps(state, removeIds));

  // Insert the merged shape at the front-most source's z-slot.
  const allSourceIds = new Set(removeIds);
  let next: CompositionState = {
    ...cleaned,
    svgObjects: [...cleaned.svgObjects, result],
    sceneOrder: mergeIdsIntoSceneOrder(state.sceneOrder, allSourceIds, result.id),
  };

  if (sel.allPatternFilled) {
    // Adopt the top-most shape's pattern fill onto the union result.
    const topFigureId = sel.patternFigureByShape.get(geom.top.id);
    const srcFigure = topFigureId
      ? state.figures.find(f => f.id === topFigureId)
      : undefined;
    if (srcFigure) {
      const figureId = `fig_${Date.now()}_un`;
      const tiled = buildUnionTiledFigure(
        srcFigure, geom.bbox, figureId, nextFigureName(next.figures, 'Pattern'),
      );
      // Figure paints just under the mask outline.
      const maskIdx = next.sceneOrder.indexOf(result.id);
      const order = next.sceneOrder.slice();
      order.splice(maskIdx < 0 ? order.length : maskIdx, 0, figureId);
      const withFigure: CompositionState = {
        ...next,
        figures: [...next.figures, tiled],
        sceneOrder: order,
      };
      const grouped = applyCompOps(withFigure, [{
        op: 'groupFigures',
        figureIds: [figureId, result.id],
        groupId: `grp_${Date.now()}_un`,
        groupName: nextGroupName(withFigure.figures),
        oldNames: [tiled.name, result.name],
      }]);
      // Flag the result as a pattern fill (its solid fillColor — inherited from
      // the top-most shape — is preserved as the tile background).
      next = {
        ...grouped,
        svgObjects: grouped.svgObjects.map(s => s.id === result.id
          ? { ...s, isMask: true as const, isPatternFill: true as const }
          : s),
      };
    }
  }

  return {
    entry: [
      {
        op: 'replaceScene',
        oldFigures: state.figures, newFigures: next.figures,
        oldSVGObjects: state.svgObjects, newSVGObjects: next.svgObjects,
        oldImages: state.images ?? [], newImages: next.images ?? [],
        oldGroups: state.groups, newGroups: next.groups,
        oldSceneOrder: state.sceneOrder, newSceneOrder: next.sceneOrder,
      },
    ],
    resultId: result.id,
  };
}
