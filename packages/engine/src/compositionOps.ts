import { BlendMode, CompositionState, CompositionFigure, CompUndoEntry, CompUndoOp, GroupNode, PaintObject, PatternObject, PaintStrokeDraft, RGBColor, SVGObject, SVGSubpath, PathSegment, ImageObject, TextObject, CompItemKind } from './types';
import { mintPaintObjectId } from './paintObject';
import { mintPatternObjectId, applyPatternCellEdits } from './patternObject';
import {
  mapShapePatternGrid, shapeHoldingPatternGrid, withShapePatternFill,
} from './shapePatternFill';
import { GEOMETRY_ADAPTERS, rescaleSegs } from './sceneNodeGeometry';
import { nextGroupName } from './sceneOutlineHelpers';
import { colorsEqual } from './colorBlend';
import { SegmentOverrides } from './tileSegmentOverrides';
import { SceneGraph, computeSVGBbox, fromLegacy, regraphChangedLeaves, toLegacyView } from './sceneGraph';
import { invertOnGraph, legacyOpToSceneOps } from './legacyOpBridge';
import { SceneEntry, applySceneOps, revertSceneOps } from './sceneGraphOps';
import {
  CompItemRef, GroupHiddenToggle, allDescendantMemberIds, computeGroupHiddenToggle,
  descendantGroupIds, findItem, findRootGroupId, getItemGroupId, groupAncestorChain,
  hiddenGroupIds, isGroupChainHidden, isGroupChainLocked, isGroupHidden, isGroupLocked,
  isItemHidden, isItemLocked, lockedGroupIds,
} from './compositionNodeLookup';
import {
  clonePathSegment, offsetPathSegment, safeMapSegments, safeMapSubpaths,
} from './pathSegmentUtils';
import {
  appendToSceneOrder, applySceneOrder, assertSceneOrderInvariant, captureSceneOrder,
  deriveSceneOrderFromKindArrays, insertIntoSceneOrder, iterateSceneOrder,
  mergeIdsIntoSceneOrder, reflowSceneOrderForGroups, removeFromSceneOrder,
  removeManyFromSceneOrder, reorderSceneObjects, repairSceneOrder,
} from './compositionSceneOrder';

// Moved out in P7; re-exported so every existing importer of
// `compositionOps` keeps working unchanged.
export type { CompItemRef, GroupHiddenToggle };
export { computeSVGBbox } from './sceneGraph';
export {
  allDescendantMemberIds, computeGroupHiddenToggle, descendantGroupIds, findItem,
  findRootGroupId, getItemGroupId, groupAncestorChain, hiddenGroupIds,
  isGroupChainHidden, isGroupChainLocked, isGroupHidden, isGroupLocked, isItemHidden,
  isItemLocked, lockedGroupIds,
};
// Clone / offset / the two defensive segment mappers - moved to
// ./pathSegmentUtils in P7 (it has no cycle with anything, which is what
// lets compositionQuarterTurn and sceneNodeGeometry share them);
// re-exported so every existing importer keeps working unchanged.
export { clonePathSegment, offsetPathSegment, safeMapSegments, safeMapSubpaths };
export {
  appendToSceneOrder, applySceneOrder, assertSceneOrderInvariant, captureSceneOrder,
  deriveSceneOrderFromKindArrays, insertIntoSceneOrder, iterateSceneOrder,
  mergeIdsIntoSceneOrder, reflowSceneOrderForGroups, removeFromSceneOrder,
  removeManyFromSceneOrder, reorderSceneObjects, repairSceneOrder,
};

/**
 * Apply a list of paint-tile-segment changes to a sparse override map,
 * returning a NEW map (or undefined when empty). `which` selects the new-color
 * (apply/redo) or old-color (undo) side of each change. A `undefined` color
 * for the chosen side deletes the key (segment falls back to base color).
 */
function applyTileSegmentChanges(
  prev: SegmentOverrides | undefined,
  changes: ReadonlyArray<{ key: number; oldColor?: RGBColor; newColor?: RGBColor }>,
  which: 'old' | 'new',
): SegmentOverrides | undefined {
  const next: SegmentOverrides = new Map(prev ?? []);
  for (const c of changes) {
    const color = which === 'new' ? c.newColor : c.oldColor;
    if (color === undefined) next.delete(c.key);
    else next.set(c.key, color);
  }
  return next.size > 0 ? next : undefined;
}

/** Target on-screen distance between a duplicate and its original,
 *  expressed as a fraction of the viewport width. 1% lands the copy
 *  close enough to be obviously paired without overlapping. */
const SCREEN_DUP_OFFSET_FRAC = 0.01;

/**
 * Convert the target screen-pixel distance (1% of viewport width) into
 * L0-cell units using the same cells-to-screen mapping the rest of the
 * engine uses (`viewport.width * camera.zoom / 32`). Result is a
 * constant on-screen distance: the offset shrinks in cell space as you
 * zoom in and grows as you zoom out, independent of `gridLevel` and
 * (post-normalization) absolute content scale. Falls back to 1 for
 * degenerate viewport/zoom values.
 */
export function computeDuplicateOffset(state: CompositionState): number {
  const screenPx = state.viewport.width * SCREEN_DUP_OFFSET_FRAC;
  const cellsToScreenPx = state.viewport.width * state.camera.zoom / 32;
  if (!Number.isFinite(cellsToScreenPx) || cellsToScreenPx <= 0) return 1;
  return screenPx / cellsToScreenPx;
}

// â”€â”€ Generic item helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// `CompItemKind` is now defined in `./types` (so undo op shapes can use
// it without circular imports). Re-export for any consumer that imports
// it from this module today.
export type { CompItemKind };

/**
 * Compute the tile-offset delta that keeps a tiled pattern fixed in world
 * space when the figure's bbox changes. For non-rotated figures the offset
 * simply compensates for cellX/cellY movement. For rotated/mirrored figures
 * the rotation center also shifts, which changes how world positions map
 * through the inverse rotation â€” the formula accounts for both effects.
 *
 * Returns [dOffX, dOffY] to ADD to the current offset.
 */
export function tileOffsetDelta(
  rotation: number, mirrorH: boolean, mirrorV: boolean,
  dx: number, dy: number, dw: number, dh: number,
): [number, number] {
  // Inverse rotation matrix entries (matches compositionRenderer's convention)
  let ir00: number, ir01: number, ir10: number, ir11: number;
  switch (rotation) {
    case 90:  ir00 = 0;  ir01 = 1;  ir10 = -1; ir11 = 0;  break;
    case 180: ir00 = -1; ir01 = 0;  ir10 = 0;  ir11 = -1; break;
    case 270: ir00 = 0;  ir01 = -1; ir10 = 1;  ir11 = 0;  break;
    default:  ir00 = 1;  ir01 = 0;  ir10 = 0;  ir11 = 1;  break;
  }
  if (mirrorH) { ir00 = -ir00; ir01 = -ir01; }
  if (mirrorV) { ir10 = -ir10; ir11 = -ir11; }

  // Pre-rotation rect origin change (center-based un-swap for 90/270)
  const rotSwapped = rotation === 90 || rotation === 270;
  const dRectX = rotSwapped ? dx + (dw - dh) / 2 : dx;
  const dRectY = rotSwapped ? dy + (dh - dw) / 2 : dy;

  // Bbox center change
  const dCx = dx + dw / 2;
  const dCy = dy + dh / 2;

  // (I - invRot) * dCenter: accounts for the rotation pivot shift
  const cX = (1 - ir00) * dCx - ir01 * dCy;
  const cY = -ir10 * dCx + (1 - ir11) * dCy;

  return [-dRectX + cX, -dRectY + cY];
}


/**
 * Build the undo ops produced by the composition Color tool when the
 * user picks `newColor`: recolor every selected SVGObject (`color`)
 * and tint every selected CompositionFigure (`colorOverride`), skipping
 * locked items and items already at that color. Group-level selections
 * fan out through `allDescendantMemberIds`. Images have no color field
 * and are silently skipped.
 *
 * Pure: returns the ops; the caller dispatches the matching reducer
 * actions and pushes the array as a single undo entry.
 */
export function buildColorToolOps(state: CompositionState, newColor: RGBColor, blendMode?: BlendMode): CompUndoOp[] {
  const effectiveBlendMode = blendMode && STORED_BLEND_MODES.has(blendMode) ? blendMode : undefined;
  const effective = new Set<string>();
  for (const id of state.selectedFigureIds) {
    if (findItem(state, id)) effective.add(id);
    else for (const leaf of allDescendantMemberIds(state, id)) effective.add(leaf);
  }

  const ops: CompUndoOp[] = [];
  for (const id of effective) {
    if (isItemLocked(state, id)) continue;
    const found = findItem(state, id);
    if (!found) continue;
    if (found.kind === 'svg') {
      const svg = found.item;
      if (svg.color.r === newColor.r && svg.color.g === newColor.g && svg.color.b === newColor.b) continue;
      ops.push({ op: 'recolorSVG', svgId: id, oldColor: svg.color, newColor, oldSubpaths: svg.subpaths });
    } else if (found.kind === 'figure') {
      const fig = found.item;
      const oldOverride = fig.colorOverride;
      if (oldOverride && oldOverride.r === newColor.r && oldOverride.g === newColor.g && oldOverride.b === newColor.b) continue;
      ops.push({ op: 'recolorFigure', figureId: id, oldColor: oldOverride, newColor, oldBlendMode: fig.colorOverrideBlendMode, newBlendMode: effectiveBlendMode });
    }
    // images: no color field; texts recolor via setTextStyle. Both skipped.
  }
  return ops;
}

/**
 * Blend modes whose effect is meaningful at render time â€” i.e. the stored
 * color is applied to each SVG fill/stroke via `blendColor(fill, override,
 * mode, 1)`. Modes NOT in this set (`invert`, `rotate`, `randomize`)
 * pre-bake their result into `colorOverride` at paint time and store no
 * blend mode, so the renderer uses the legacy luminance-weighted recolor.
 */
const STORED_BLEND_MODES: ReadonlySet<BlendMode> = new Set<BlendMode>([
  'normal', 'multiply', 'dodge', 'lighten', 'darken', 'burn', 'hue', 'color',
]);

// â”€â”€ Color-tool drag-paint helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Flatten an SVG's geometry into a single ordered list tagged with the
 * color each segment renders at *today*. Mirrors the renderer's
 * "subpaths win when present" invariant (see
 * `engine/svgPathBuilder.ts::buildSVGObjectContent`):
 *   - If `subpaths` is non-empty, walk only those segments. (Both the
 *     JOIN producer and `regroupSegmentsByColor` write the full
 *     geometry into `segments` AND into `subpaths`; the renderer ignores
 *     `segments` when subpaths exist. Walking both would double-count.)
 *   - Otherwise walk main `segments`.
 *
 * The brush-hit helper `brushHitsSegments` and the paint-time color
 * lookup `subpathColorAt` follow the same rule so all three paths use
 * the same flat ordering.
 */
export function flattenSVGSegmentsWithColor(svg: SVGObject): Array<{ segment: PathSegment; color: RGBColor }> {
  const out: Array<{ segment: PathSegment; color: RGBColor }> = [];
  if (Array.isArray(svg.subpaths) && svg.subpaths.length > 0) {
    for (const sub of svg.subpaths) {
      for (const seg of sub.segments) out.push({ segment: seg, color: sub.color });
    }
  } else {
    for (const seg of svg.segments) out.push({ segment: seg, color: svg.color });
  }
  return out;
}

/**
 * Walk a flat list of (segment, color) entries in order and group contiguous
 * runs of identical color into color groups. When all entries share a
 * color the result has `subpaths: undefined` and the color in `color`/
 * `segments` â€” same canonical shape `buildColorToolOps` uses for
 * single-color objects.
 *
 * Multi-color result mirrors the invariant the existing join producer
 * (`CompositionEditor.tsx`'s join code path) writes: `segments` carries
 * the FULL flat list of geometry, and `subpaths` carries every color
 * group (including the primary). The renderer's "subpaths win when
 * present" rule (`buildSVGObjectContent` in `engine/svgPathBuilder.ts`)
 * then displays each group at its own color â€” if we'd instead split
 * primary into `segments` and the rest into `subpaths`, the renderer
 * would drop the primary group and segments would visibly disappear.
 *
 * Used by paint-stroke finalize to reduce the per-segment paint
 * accumulator back into the SVGObject's two-tier color shape.
 */
export function regroupSegmentsByColor(
  entries: ReadonlyArray<{ segment: PathSegment; color: RGBColor; fill?: boolean; atom?: number }>,
): { color: RGBColor; segments: PathSegment[]; subpaths?: SVGSubpath[] } {
  if (entries.length === 0) {
    return { color: { r: 0, g: 0, b: 0 }, segments: [], subpaths: undefined };
  }
  // A FILL subpath is one closed drawing, not a run of stroke colors: its
  // `fill` flag must survive the regroup, and its segments must stay one
  // group — splitting them (or merging them with a same-colored stroke
  // neighbor) restructures the closed loops the fill is built from. Entries
  // that came from a fill subpath carry `fill` + that subpath's ordinal as
  // `atom`; a group boundary falls wherever color, fill, OR atom changes,
  // which keeps every atom whole and every stroke run grouped as before.
  // (Before this, the regroup dropped `fill` entirely — one brush stroke on
  // a baked figure hollowed all its painted cells into outlines.)
  const groups: Array<{ color: RGBColor; segments: PathSegment[]; fill?: boolean; atom?: number }> = [];
  let cur: { color: RGBColor; segments: PathSegment[]; fill?: boolean; atom?: number } | null = null;
  for (const { segment, color, fill, atom } of entries) {
    if (cur
      && cur.color.r === color.r && cur.color.g === color.g && cur.color.b === color.b
      && (cur.fill ?? false) === (fill ?? false)
      && cur.atom === atom) {
      cur.segments.push(segment);
    } else {
      cur = { color, segments: [segment], fill, atom };
      groups.push(cur);
    }
  }
  const primary = groups[0];
  if (groups.length === 1 && !primary.fill) {
    return { color: primary.color, segments: primary.segments, subpaths: undefined };
  }
  return {
    color: primary.color,
    segments: entries.map(e => e.segment),
    subpaths: groups.map(g => {
      const sub: SVGSubpath = { color: g.color, segments: g.segments };
      if (g.fill) sub.fill = true;
      return sub;
    }),
  };
}

/**
 * Build the undo entry committed when a paint stroke finalizes. Walks the
 * draft's per-segment accumulator, regroups by color into the canonical
 * `{ color, segments, subpaths? }` shape, and emits one `recolorSVG` op
 * per touched SVG + one `recolorFigure` op per touched figure. Pure: the
 * caller dispatches `SET_STATE` with `applyCompOps(state, ops)` and
 * pushes the entry onto the undo stack.
 *
 * SVGs whose paint result is identical to the snapshot (e.g. user dragged
 * the brush over a segment that was already the brush color) are skipped
 * so undo entries don't pile up no-op ops.
 */
/**
 * The flat (segment, color) entries a paint commit regroups, with painted
 * colors substituted at their stable flat indices — and fill subpaths kept
 * honest: a fill subpath's entries all take ONE color (the first painted
 * index wins, else the subpath's own), tagged `fill` + `atom` so
 * {@link regroupSegmentsByColor} preserves the subpath whole. A fill renders
 * as one closed drawing in one color, so per-segment paint variation inside
 * it has nothing to attach to. Shared by the world and group-local halves of
 * the commit, which must stay structurally parallel.
 */
function paintedFlatEntries(
  color: RGBColor,
  segments: readonly PathSegment[],
  subpaths: readonly SVGSubpath[] | undefined,
  painted: ReadonlyMap<number, RGBColor>,
): Array<{ segment: PathSegment; color: RGBColor; fill?: boolean; atom?: number }> {
  const out: Array<{ segment: PathSegment; color: RGBColor; fill?: boolean; atom?: number }> = [];
  if (Array.isArray(subpaths) && subpaths.length > 0) {
    let idx = 0;
    subpaths.forEach((sub, subIdx) => {
      if (sub.fill) {
        let fillColor = sub.color;
        for (let k = 0; k < sub.segments.length; k++) {
          const p = painted.get(idx + k);
          if (p) { fillColor = p; break; }
        }
        for (const seg of sub.segments) {
          out.push({ segment: seg, color: fillColor, fill: true, atom: subIdx });
          idx++;
        }
      } else {
        for (const seg of sub.segments) {
          out.push({ segment: seg, color: painted.get(idx) ?? sub.color });
          idx++;
        }
      }
    });
    return out;
  }
  segments.forEach((seg, idx) => out.push({ segment: seg, color: painted.get(idx) ?? color }));
  return out;
}

export function buildPaintStrokeOps(state: CompositionState, draft: PaintStrokeDraft): CompUndoOp[] {
  const ops: CompUndoOp[] = [];

  for (const [svgId, painted] of draft.paintedSegments) {
    const snap = draft.svgSnapshots.get(svgId);
    if (!snap) continue;
    const svg = state.svgObjects.find(s => s.id === svgId);
    if (!svg) continue;
    if (svg.locked) continue;

    // Substitute painted colors at their stable flat indices, fill-aware.
    const entries = paintedFlatEntries(snap.color, snap.segments, snap.subpaths, painted);

    const regrouped = regroupSegmentsByColor(entries);
    const segmentsChanged = !sameShape(snap, regrouped);

    // Fill color: if the SVG had fillColor and the brush changed it,
    // bundle the fill change into the same recolorSVG op.
    const paintedFill = draft.paintedFills.get(svgId);
    const fillChanged = paintedFill && snap.fillColor && !colorsEqual(snap.fillColor, paintedFill);

    if (!segmentsChanged && !fillChanged) continue;

    const opShape: Extract<CompUndoOp, { op: 'recolorSVG' }> = {
      op: 'recolorSVG',
      svgId,
      oldColor: segmentsChanged ? snap.color : regrouped.color,
      newColor: regrouped.color,
      oldSegments: snap.segments,
      oldSubpaths: snap.subpaths,
      newSegments: regrouped.segments,
      newSubpaths: regrouped.subpaths,
    };

    if (fillChanged) {
      opShape.oldFillColor = snap.fillColor;
      opShape.newFillColor = paintedFill;
    }

    // Grouped SVGs: also rewrite the local-space mirrors of `segments`
    // and `subpaths`. `materializeSVGMember` re-derives world geometry
    // from these locals every group transform; without the mirror,
    // painted color groups freeze in pre-transform world coords and the
    // SVG visually falls behind when the group moves.
    if (svg.groupId && snap.localSegments) {
      // Flat list of LOCAL segments in the same order as the world flat
      // list — the same fill-aware builder, at the SAME flat indices, so
      // the two outputs are structurally parallel (same group count, same
      // per-group lengths, same color order, same fill flags). Walking
      // localSubpaths-only when present (never BOTH lists) is what keeps
      // the regroup from double-counting geometry until u16 counts
      // overflow on save and corrupt the file.
      const localEntries = paintedFlatEntries(
        snap.color, snap.localSegments, snap.localSubpaths, painted,
      );
      const localRegrouped = regroupSegmentsByColor(localEntries);
      opShape.oldLocalSegments = snap.localSegments;
      opShape.newLocalSegments = localRegrouped.segments;
      opShape.oldLocalSubpaths = snap.localSubpaths;
      opShape.newLocalSubpaths = localRegrouped.subpaths;
    }

    ops.push(opShape);
  }

  // Handle SVGs that had fill painted but no segments painted (brush hit
  // the object but every segment was already the brush color).
  for (const [svgId, paintedFill] of draft.paintedFills) {
    if (draft.paintedSegments.has(svgId)) continue; // already handled above
    const snap = draft.svgSnapshots.get(svgId);
    if (!snap || !snap.fillColor) continue;
    if (colorsEqual(snap.fillColor, paintedFill)) continue;
    const svg = state.svgObjects.find(s => s.id === svgId);
    if (!svg || svg.locked) continue;
    ops.push({
      op: 'recolorSVG',
      svgId,
      oldColor: snap.color,
      newColor: snap.color,
      oldSegments: snap.segments,
      oldSubpaths: snap.subpaths,
      newSegments: snap.segments,
      newSubpaths: snap.subpaths,
      oldFillColor: snap.fillColor,
      newFillColor: paintedFill,
    });
  }

  // Sparse per-copy tile paint: one `paintTileSegments` op per touched tiled
  // SVG, carrying only the (copy, segment) keys whose color actually changed.
  // The object isn't mutated mid-stroke, so its current `segmentOverrides` is
  // the pre-stroke ("old") state.
  if (draft.paintedTileSegments) {
    for (const [svgId, painted] of draft.paintedTileSegments) {
      const svg = state.svgObjects.find(s => s.id === svgId);
      if (!svg || svg.locked) continue;
      const prev = svg.segmentOverrides;
      const changes: Array<{ key: number; oldColor?: RGBColor; newColor?: RGBColor }> = [];
      for (const [key, newColor] of painted) {
        const oldColor = prev?.get(key);
        if (oldColor && colorsEqual(oldColor, newColor)) continue;
        changes.push({ key, oldColor, newColor });
      }
      if (changes.length > 0) ops.push({ op: 'paintTileSegments', svgId, changes });
    }
  }

  const effectiveBlendMode = STORED_BLEND_MODES.has(draft.blendMode) ? draft.blendMode : undefined;
  for (const [figureId, newColor] of draft.paintedFigures) {
    const fig = state.figures.find(f => f.id === figureId);
    if (!fig) continue;
    if (fig.locked) continue;
    const oldOverride = draft.figureSnapshots.get(figureId);
    if (oldOverride && oldOverride.r === newColor.r && oldOverride.g === newColor.g && oldOverride.b === newColor.b) continue;
    ops.push({ op: 'recolorFigure', figureId, oldColor: oldOverride, newColor, oldBlendMode: fig.colorOverrideBlendMode, newBlendMode: effectiveBlendMode });
  }

  return ops;
}

function sameShape(
  snap: { color: RGBColor; segments: PathSegment[]; subpaths?: SVGSubpath[] },
  next: { color: RGBColor; segments: PathSegment[]; subpaths?: SVGSubpath[] },
): boolean {
  if (!colorsEqual(snap.color, next.color)) return false;
  if (snap.segments.length !== next.segments.length) return false;
  const aSubs = snap.subpaths ?? [];
  const bSubs = next.subpaths ?? [];
  if (aSubs.length !== bSubs.length) return false;
  for (let i = 0; i < aSubs.length; i++) {
    if (!colorsEqual(aSubs[i].color, bSubs[i].color)) return false;
    if (aSubs[i].segments.length !== bSubs[i].segments.length) return false;
    // A fill flag flipping IS a shape change — without this a repaint that
    // only restored a fill would read as a no-op and never commit.
    if ((aSubs[i].fill ?? false) !== (bSubs[i].fill ?? false)) return false;
  }
  return true;
}


// â”€â”€ Scene object adapter registry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Every scene-object kind (figure, svg, image, text, paint) registers an
// adapter here so that ordering / locking / deleting / undo loop uniformly
// over all kinds. Adding a new kind = adding one entry here plus the field
// on CompositionState.

export interface SceneObjectBase { id: string; locked?: boolean; hidden?: boolean; groupId?: string; name?: string; }

/** A functional tag rather than a display name: `<prefix>:<id>`, the way a
 *  format's scaffold marks its nodes (`slot:squiggle`, `decor:dateStamp`).
 *  A copy keeps a tag verbatim — what the tag marks (the day's seed, the
 *  date stamp) the copy is too, and " copy" would make it another tag. */
export function isTagName(name: string): boolean {
  return /^[a-z][a-zA-Z0-9_-]*:/.test(name);
}

/**
 * The name a duplicate is placed with: a user's name gets " copy"; a tag
 * (the Reimagine seed's `slot:squiggle`) is kept as it is (isTagName); a
 * nameless node stays nameless. A node's name is its own whether or not it
 * is grouped — grouping never touches it (see the `groupFigures` apply).
 */
export function duplicateName(item: { name?: string }): string | undefined {
  const own = item.name;
  if (!own) return undefined;
  return isTagName(own) ? own : own + ' copy';
}

export interface SceneObjectAdapter<T extends SceneObjectBase = SceneObjectBase> {
  /** The one key every caller routes on. An id's namespace does NOT name
   *  a kind: ask `findItem` (or the graph's `node.kind`) which array the
   *  id is in and pick the adapter by that. */
  kind: CompItemKind;
  getArray(state: CompositionState): readonly T[];
  setArray(state: CompositionState, items: T[]): CompositionState;
  /** Deep-clone the item enough that callers can keep a snapshot in
   *  undo entries without aliasing live state. Per-kind because the
   *  geometry payloads differ (figure quads, line vertices, arc
   *  segments). */
  cloneItem(item: T): T;
  /** Mint a fresh id in this kind's namespace. Used by duplicate. */
  mintId(): string;
  /** Deep-clone with a fresh id and a (dx, dy) cell-grid offset
   *  applied to all geometry. Used by duplicate. */
  cloneWithOffset(item: T, dx: number, dy: number, newId: string, newGroupId: string | undefined): T;
}

function freshSuffix(): string {
  return Date.now().toString() + '_' + Math.random().toString(36).slice(2, 6);
}

export const SCENE_ADAPTERS: SceneObjectAdapter[] = [
  {
    kind: 'figure',
    getArray: (s) => s.figures,
    setArray: (s, arr) => ({ ...s, figures: arr as CompositionFigure[] }),
    cloneItem: (item) => {
      const fig = item as CompositionFigure;
      return { ...fig, quads: fig.quads ? fig.quads.map((q) => ({ ...q })) : fig.quads } as SceneObjectBase;
    },
    mintId: () => freshSuffix(),
    cloneWithOffset: (item, dx, dy, newId, newGroupId) => {
      const fig = item as CompositionFigure;
      return {
        ...fig,
        id: newId,
        cellX: fig.cellX + dx,
        cellY: fig.cellY + dy,
        name: duplicateName(fig),
        groupId: newGroupId,
        locked: false,
        quads: fig.quads ? fig.quads.map((q) => ({ ...q })) : fig.quads,
      } as SceneObjectBase;
    },
  },
  {
    kind: 'svg',
    getArray: (s) => s.svgObjects,
    setArray: (s, arr) => ({ ...s, svgObjects: arr as SVGObject[] }),
    cloneItem: (item) => {
      const svg = item as SVGObject;
      const localSegs = safeMapSegments(svg.localSegments, clonePathSegment);
      const idSegs = safeMapSegments(svg.identitySegments, clonePathSegment);
      const subs = safeMapSubpaths(svg.subpaths, clonePathSegment);
      return {
        ...svg,
        segments: safeMapSegments(svg.segments, clonePathSegment) ?? [],
        ...(localSegs ? { localSegments: localSegs } : null),
        ...(idSegs ? { identitySegments: idSegs } : null),
        ...(subs ? { subpaths: subs } : null),
        ...(svg.segmentOverrides ? { segmentOverrides: new Map(svg.segmentOverrides) } : null),
      } as SceneObjectBase;
    },
    mintId: () => 'svg_' + freshSuffix(),
    cloneWithOffset: (item, dx, dy, newId, newGroupId) => {
      const svg = item as SVGObject;
      const offset = (seg: PathSegment) => offsetPathSegment(seg, dx, dy);
      const segs = safeMapSegments(svg.segments, offset) ?? [];
      const localSegs = safeMapSegments(svg.localSegments, offset);
      const localBbox = localSegs ? (() => {
        const lb = computeSVGBbox(localSegs);
        return { localCellX: lb.cellX, localCellY: lb.cellY, localCellWidth: lb.cellWidth, localCellHeight: lb.cellHeight };
      })() : {};
      // A duplicate is a pure TRANSLATION, so the stored box RIDES along;
      // it is never re-measured off the copy. The two are not the same
      // thing, and every other adapter here already knows it — a figure,
      // an image, a text, a paint, a pattern all move `cellX`/`cellY` and
      // leave the size alone. For an svg the box is the pose the renderer
      // turns the path about (`leafNodeFromLegacy` takes its centre as the
      // pivot and applies `angleDeg` there), and a member of a group
      // pulled OFF SQUARE is drawn inside a box its own path need not
      // fill: measuring the copy shrank the box, the pivot moved by half
      // the difference, and the copy came back spun about the wrong point
      // — in the wrong place, by an amount that grew with the member's own
      // angle (§9.11). A tiled path could never be measured either, its
      // box being the REGION it repeats across, and that exception is now
      // simply the rule.
      const bbox = {
        cellX: svg.cellX + dx, cellY: svg.cellY + dy,
        cellWidth: svg.cellWidth, cellHeight: svg.cellHeight,
      };
      // When duplicating into a different group the original creationBox
      // is in the source group's local space and cannot be offset into the
      // new group's space with a simple translate â€” attempting to do so
      // leaves the selection box rotated/mirrored relative to the actual
      // segments after the new group is transformed then ungrouped.  Drop
      // it so that selectedNodeBBox falls back to the segment AABB, which
      // is always correct.  Keep it only when staying in the same group
      // (same coordinate space).
      // The creation box is in the object's own group's LOCAL space, so
      // it cannot be carried into a group with a different frame — the
      // selection box would come out turned or mirrored against the
      // segments. It CAN be carried when the space is unchanged: the same
      // group, or a zero offset into a pose-identical copy of it (group
      // duplication puts the offset on the group, not on each member).
      // Dropping it otherwise falls back to the segment AABB, which for a
      // turned path is bigger than the path — that fallback is the whole
      // reason a duplicated member must not be re-spelled at all.
      const keepCreationBox = newGroupId === svg.groupId || (dx === 0 && dy === 0);
      return {
        ...svg,
        id: newId,
        segments: segs,
        localSegments: localSegs,
        subpaths: safeMapSubpaths(svg.subpaths, offset),
        creationBox: keepCreationBox && svg.creationBox
          ? { minX: svg.creationBox.minX + dx, minY: svg.creationBox.minY + dy, width: svg.creationBox.width, height: svg.creationBox.height }
          : undefined,
        name: duplicateName(svg),
        groupId: newGroupId,
        locked: false,
        ...(svg.segmentOverrides ? { segmentOverrides: new Map(svg.segmentOverrides) } : null),
        ...bbox,
        ...localBbox,
      } as SceneObjectBase;
    },
  },
  {
    kind: 'image',
    getArray: (s) => s.images ?? [],
    setArray: (s, arr) => ({ ...s, images: arr as ImageObject[] }),
    cloneItem: (item) => ({ ...(item as ImageObject) } as SceneObjectBase),
    mintId: () => 'img_' + freshSuffix(),
    cloneWithOffset: (item, dx, dy, newId, newGroupId) => {
      const img = item as ImageObject;
      return {
        ...img,
        id: newId,
        cellX: img.cellX + dx,
        cellY: img.cellY + dy,
        identityCellX: img.identityCellX !== undefined ? img.identityCellX + dx : undefined,
        identityCellY: img.identityCellY !== undefined ? img.identityCellY + dy : undefined,
        name: duplicateName(img),
        groupId: newGroupId,
        locked: false,
      } as SceneObjectBase;
    },
  },
  {
    kind: 'text',
    getArray: (s) => s.texts ?? [],
    setArray: (s, arr) => ({ ...s, texts: arr as TextObject[] }),
    cloneItem: (item) => {
      // Deep-clone the style block (and the stroke inside it) so undo
      // snapshots don't alias live state when the style is later edited.
      const txt = item as TextObject;
      return {
        ...txt,
        style: { ...txt.style, ...(txt.style.stroke ? { stroke: { ...txt.style.stroke } } : null) },
      } as SceneObjectBase;
    },
    mintId: () => 'txt_' + freshSuffix(),
    cloneWithOffset: (item, dx, dy, newId, newGroupId) => {
      const txt = item as TextObject;
      return {
        ...txt,
        id: newId,
        style: { ...txt.style, ...(txt.style.stroke ? { stroke: { ...txt.style.stroke } } : null) },
        cellX: txt.cellX + dx,
        cellY: txt.cellY + dy,
        identityCellX: txt.identityCellX !== undefined ? txt.identityCellX + dx : undefined,
        identityCellY: txt.identityCellY !== undefined ? txt.identityCellY + dy : undefined,
        name: duplicateName(txt),
        groupId: newGroupId,
        locked: false,
      } as SceneObjectBase;
    },
  },
  {
    kind: 'paint',
    getArray: (s) => s.paintObjects ?? [],
    setArray: (s, arr) => ({ ...s, paintObjects: arr as PaintObject[] }),
    // Tiles are immutable-by-convention (strokes clone-on-touch, commits
    // swap the array), so a snapshot only needs its own array — the tile
    // objects themselves can be shared.
    cloneItem: (item) => {
      const p = item as PaintObject;
      return { ...p, tiles: [...p.tiles] } as SceneObjectBase;
    },
    mintId: mintPaintObjectId,
    cloneWithOffset: (item, dx, dy, newId, newGroupId) => {
      const p = item as PaintObject;
      // Tiles and contentRect stay put — the contentRect→bbox mapping
      // carries the pixels, so offsetting the bbox alone translates the
      // copy (it renders identically, one bbox over).
      return {
        ...p,
        id: newId,
        tiles: [...p.tiles],
        cellX: p.cellX + dx,
        cellY: p.cellY + dy,
        identityCellX: p.identityCellX !== undefined ? p.identityCellX + dx : undefined,
        identityCellY: p.identityCellY !== undefined ? p.identityCellY + dy : undefined,
        name: duplicateName(p),
        groupId: newGroupId,
        locked: false,
      } as SceneObjectBase;
    },
  },
  {
    kind: 'pattern',
    getArray: (s) => s.patternObjects ?? [],
    setArray: (s, arr) => ({ ...s, patternObjects: arr as PatternObject[] }),
    // Cells are immutable-by-convention (every edit swaps the array), so a
    // snapshot only needs its own cells array.
    cloneItem: (item) => {
      const p = item as PatternObject;
      return { ...p, cells: [...p.cells], ...(p.symmetry ? { symmetry: { ...p.symmetry } } : null) } as SceneObjectBase;
    },
    mintId: mintPatternObjectId,
    cloneWithOffset: (item, dx, dy, newId, newGroupId) => {
      const p = item as PatternObject;
      return {
        ...p,
        id: newId,
        cells: [...p.cells],
        ...(p.symmetry ? { symmetry: { ...p.symmetry } } : null),
        cellX: p.cellX + dx,
        cellY: p.cellY + dy,
        identityCellX: p.identityCellX !== undefined ? p.identityCellX + dx : undefined,
        identityCellY: p.identityCellY !== undefined ? p.identityCellY + dy : undefined,
        name: duplicateName(p),
        groupId: newGroupId,
        locked: false,
      } as SceneObjectBase;
    },
  },
];

export interface BuildDuplicateOpsOptions {
  /** Override new-group id minting. Default: timestamp + random suffix. */
  mintGroupId?: (origGroupId: string) => string;
  /** Override new-item id minting. Default: per-kind adapter.mintId(). */
  mintItemId?: (kind: CompItemKind, origId: string) => string;
  /** L0-cell offset applied to each duplicate. Default: 1. Production
   *  passes `computeDuplicateOffset(state)` so the visible gap is a
   *  constant on-screen distance regardless of zoom or grid level. */
  offset?: number;
}

export interface BuildDuplicateOpsResult {
  ops: CompUndoEntry;
  /** Ids of newly-placed leaf items, in selection-iteration order. */
  newIds: string[];
  /** original groupId â†’ new groupId. Includes ancestor groups walked in. */
  groupIdMap: Map<string, string>;
}

/**
 * Build the ops needed to duplicate the selected leaf members (figures,
 * svgs, images) plus the group hierarchy that wraps them. Pure: returns
 * ops and an id mapping; the caller dispatches and updates selection.
 *
 * Hierarchy handling: a group is duplicated when (a) it's the immediate
 * parent of a selected leaf, or (b) every leaf descendant of that group
 * is in the selection. (b) covers root groups whose direct contents are
 * only sub-groups â€” without it, child duplicates lose their parent and
 * end up as root nodes.
 */
/** A source group's pose as the `saved*` fields a `groupFigures` op
 *  carries, or `{}` for a group standing at the identity (nothing to say,
 *  and the op stays as small as it was). Reproducing a group means
 *  reproducing every channel — see the op's own doc comment. */
function groupPoseFields(g: GroupNode | undefined): {
  savedTranslateX?: number; savedTranslateY?: number;
  savedScaleX?: number; savedScaleY?: number;
  savedRotation?: 0 | 90 | 180 | 270; savedAngleDeg?: number;
  savedMirrorH?: boolean; savedMirrorV?: boolean;
} {
  if (!g) return {};
  // Always stated, the identity included. Saying the pose is also what
  // marks the op as REPRODUCING a group rather than making one, and that
  // is what gets the group built before its members arrive — so the
  // fields are not an optimisation to skip when they happen to be blank.
  return {
    savedTranslateX: g.translateX ?? 0, savedTranslateY: g.translateY ?? 0,
    savedScaleX: g.scaleX ?? 1, savedScaleY: g.scaleY ?? 1,
    savedRotation: g.rotation ?? 0,
    ...(g.angleDeg !== undefined ? { savedAngleDeg: g.angleDeg } : null),
    savedMirrorH: !!g.mirrorH, savedMirrorV: !!g.mirrorV,
  };
}

export function buildDuplicateOps(
  state: CompositionState,
  selectedIds: Iterable<string>,
  options?: BuildDuplicateOpsOptions,
): BuildDuplicateOpsResult {
  // Group ops are emitted BEFORE member ops (see the return): a member
  // whose group already exists is read into the graph in that group's
  // frame; one that lands at the root first is re-spelled there, and a
  // turned path re-spelled at the root becomes its own bounding box.
  const ops: CompUndoEntry = [];
  const memberOps: CompUndoEntry = [];
  const newIds: string[] = [];
  // original groupId â†’ new groupId. Multiple selected members of the
  // same source group land in one new group rather than each spawning
  // its own.
  const groupIdMap = new Map<string, string>();
  // Per-new-group: ordered duplicated member ids.
  const newGroupMembers = new Map<string, string[]>();
  const mintGroupId = options?.mintGroupId
    ?? ((_orig: string) => Date.now().toString() + '_g' + Math.random().toString(36).slice(2, 6));

  const selectionSet = selectedIds instanceof Set
    ? selectedIds as Set<string>
    : new Set<string>(selectedIds);

  // L0-cell offset applied to each duplicate. Production callers pass
  // computeDuplicateOffset(state) (0.32 / zoom) so the visual gap is a
  // constant on-screen distance regardless of zoom or grid level. Test
  // callers (and any unsupplied caller) get the legacy 1-cell default.
  const dupOffset = options?.offset ?? 1;

  for (const id of selectionSet) {
    const ref = findItem(state, id);
    if (!ref) continue;
    const adapter = SCENE_ADAPTERS.find((a) => a.kind === ref.kind);
    if (!adapter) continue;
    const origGroupId = ref.item.groupId;
    let newGroupId: string | undefined;
    if (origGroupId) {
      newGroupId = groupIdMap.get(origGroupId);
      if (!newGroupId) {
        newGroupId = mintGroupId(origGroupId);
        groupIdMap.set(origGroupId, newGroupId);
        newGroupMembers.set(newGroupId, []);
      }
    }
    const newItemId = options?.mintItemId
      ? options.mintItemId(ref.kind, ref.item.id)
      : adapter.mintId();
    const dup = adapter.cloneWithOffset(ref.item, dupOffset, dupOffset, newItemId, newGroupId);
    memberOps.push({
      op: 'placeObject',
      kind: ref.kind,
      item: adapter.cloneItem(dup) as CompositionFigure | SVGObject | ImageObject | TextObject,
    });
    newIds.push(dup.id);
    if (newGroupId) newGroupMembers.get(newGroupId)!.push(dup.id);
  }

  // Walk up each mapped group's ancestor chain. An ancestor whose every
  // leaf descendant is in the selection also needs a duplicate, even
  // though no leaf has it as an immediate groupId â€” otherwise its child
  // groups can't find a parent in phase 2 and become root nodes.
  const seedGroupKeys = [...groupIdMap.keys()];
  for (const seedGid of seedGroupKeys) {
    let parentId = state.groups.find(g => g.id === seedGid)?.parentGroupId;
    while (parentId && !groupIdMap.has(parentId)) {
      const desc = allDescendantMemberIds(state, parentId);
      if (!desc.every(mid => selectionSet.has(mid))) break;
      const newAncestorId = mintGroupId(parentId);
      groupIdMap.set(parentId, newAncestorId);
      newGroupMembers.set(newAncestorId, []);
      parentId = state.groups.find(g => g.id === parentId)?.parentGroupId;
    }
  }

  // Emit groupFigures ops that replicate the original group hierarchy.
  // Child groups must be created before their parent so the GroupNodes
  // exist when the parent's op nests them via childGroupIds.
  const newChildGroupIds = new Map<string, string[]>(); // newParentId â†’ [newChildIds]
  for (const [origGroupId, newGroupId] of groupIdMap) {
    const origGroup = state.groups.find(g => g.id === origGroupId);
    if (!origGroup?.parentGroupId) continue;
    const newParentId = groupIdMap.get(origGroup.parentGroupId);
    if (!newParentId) continue;
    if (!newChildGroupIds.has(newParentId)) newChildGroupIds.set(newParentId, []);
    newChildGroupIds.get(newParentId)!.push(newGroupId);
  }

  // Topological emit: children before parents. Nesting is typically
  // shallow (â‰¤3 levels), so a simple multi-pass loop suffices.
  const emitted = new Set<string>();
  const allNewGroupIds = [...groupIdMap.values()];
  while (emitted.size < allNewGroupIds.length) {
    let progress = false;
    for (const [origGroupId, newGroupId] of groupIdMap) {
      if (emitted.has(newGroupId)) continue;
      const children = newChildGroupIds.get(newGroupId) ?? [];
      if (!children.every(c => emitted.has(c))) continue;
      const memberIds = newGroupMembers.get(newGroupId)!;
      if (memberIds.length === 0 && children.length === 0) { emitted.add(newGroupId); progress = true; continue; }
      const origGroup = state.groups.find(g => g.id === origGroupId);
      const groupName = origGroup?.name ? origGroup.name + ' copy' : nextGroupName(state.figures);
      ops.push({
        op: 'groupFigures',
        figureIds: memberIds,
        groupId: newGroupId,
        groupName,
        ...(children.length > 0 ? { childGroupIds: children } : null),
        // Preserve Figma-style frame-ness so a duplicated frame stays a frame
        // (clips + fixed export region), not a plain group.
        ...(origGroup?.isFrame ? { isFrame: true as const } : null),
        // …and the group's own POSE. The members above were cloned at
        // their WORLD poses, which are only what they are because of this
        // transform; a copy whose group came back at the identity reads
        // every one of them in a frame that never existed, and draws them
        // turned and resized against the original it was copied from.
        // All SEVEN channels or none: a group's turn lives in `rotation`
        // (the quarter, which swaps the scale axes) AND `angleDeg` (the
        // residual, which does not) since v61, and dropping either one is
        // the same bug at a different angle.
        ...groupPoseFields(origGroup),
      });
      emitted.add(newGroupId);
      progress = true;
    }
    if (!progress) break; // cycle guard
  }

  return { ops: [...ops, ...memberOps], newIds, groupIdMap };
}

/** Build a `removeObject` undo op for the item at `id`. Returns null
 *  when the id doesn't match any scene-object kind in state.
 *
 *  Prefer `buildRemoveObjectOps` for any caller that may delete the last
 *  member of a group â€” this single-id form does not emit the companion
 *  `removeGroup` ops needed to clean up the orphan GroupNode. */
export function buildRemoveObjectOp(
  state: CompositionState,
  id: string,
): { op: 'removeObject'; kind: CompItemKind;
     item: CompositionFigure | SVGObject | ImageObject | TextObject | PaintObject;
     sceneOrderIndex?: number } | null {
  for (const adapter of SCENE_ADAPTERS) {
    const item = adapter.getArray(state).find((x) => x.id === id);
    if (item) {
      const sceneOrderIndex = state.sceneOrder.indexOf(id);
      return {
        op: 'removeObject',
        kind: adapter.kind,
        item: adapter.cloneItem(item) as CompositionFigure | SVGObject | ImageObject | TextObject | PaintObject,
        ...(sceneOrderIndex >= 0 ? { sceneOrderIndex } : {}),
      };
    }
  }
  return null;
}

/** Collect the set of group IDs whose subtree contains at least one
 *  surviving leaf member. Walks each member's ancestor chain so a
 *  grandchild figure keeps its grandparent group alive. */
export function computeAliveGroupIds(
  groups: readonly GroupNode[],
  figures: readonly { groupId?: string }[],
  svgObjects: readonly { groupId?: string }[],
  images: readonly { groupId?: string }[],
  texts: readonly { groupId?: string }[],
  paints: readonly { groupId?: string }[] = [],
  patterns: readonly { groupId?: string }[] = [],
): Set<string> {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const alive = new Set<string>();
  const markChain = (gid: string | undefined) => {
    let cur = gid;
    while (cur && !alive.has(cur)) {
      alive.add(cur);
      cur = byId.get(cur)?.parentGroupId;
    }
  };
  for (const f of figures) markChain(f.groupId);
  for (const s of svgObjects) markChain(s.groupId);
  for (const i of images) markChain(i.groupId);
  for (const t of texts) markChain(t.groupId);
  for (const p of paints) markChain(p.groupId);
  for (const p of patterns) markChain(p.groupId);
  return alive;
}

/** Drop GroupNodes whose subtree has no surviving leaf members. Cheap
 *  no-op when every group is still anchored. Safe to call on any
 *  CompositionState â€” the alive set is computed from the current member
 *  arrays, so orphans from older sessions get cleaned up incidentally. */
export function pruneEmptyGroups(state: CompositionState): CompositionState {
  const alive = computeAliveGroupIds(
    state.groups,
    state.figures,
    state.svgObjects,
    state.images ?? [],
    state.texts ?? [],
    state.paintObjects ?? [],
    state.patternObjects ?? [],
  );
  if (alive.size === state.groups.length) return state;
  return { ...state, groups: state.groups.filter((g) => alive.has(g.id)) };
}

/** Apply `ops` virtually to `state`, then append `removeGroup` ops for
 *  any GroupNode whose subtree is left empty.  Use this at the end of
 *  any op-list builder that may strand a group (delete, extract from
 *  group, etc.) so undo restores the original GroupNode and redo prunes
 *  correctly. Returns `ops` unchanged when no group becomes empty. */
export function withGroupPruning(
  state: CompositionState,
  ops: CompUndoEntry,
): CompUndoEntry {
  if (ops.length === 0) return ops;
  const post = applyCompOps(state, ops);
  const alive = computeAliveGroupIds(
    post.groups,
    post.figures,
    post.svgObjects,
    post.images ?? [],
    post.texts ?? [],
    post.paintObjects ?? [],
    post.patternObjects ?? [],
  );
  const prunes: CompUndoOp[] = [];
  for (const g of post.groups) {
    if (!alive.has(g.id)) prunes.push({ op: 'removeGroup', group: g });
  }
  return prunes.length === 0 ? ops : [...ops, ...prunes];
}

/** Build a CompUndoEntry that removes the given ids and any GroupNodes
 *  whose subtree would be left empty by the removal. The companion
 *  `removeGroup` ops let undo restore the original GroupNode (transform
 *  + parent chain), and let redo prune correctly without re-deriving
 *  state. */
export function buildRemoveObjectOps(
  state: CompositionState,
  ids: readonly string[],
): CompUndoEntry {
  // Capture each sceneOrderIndex against the state *after* prior ops in
  // this entry have applied, so that reverting in reverse order splices
  // each id back into the matching live sceneOrder.
  const entry: CompUndoEntry = [];
  let cur = state;
  for (const id of ids) {
    const op = buildRemoveObjectOp(cur, id);
    if (op) {
      entry.push(op);
      cur = applyCompOps(cur, [op]);
    }
  }
  return withGroupPruning(state, entry);
}

/** Take a scene object out of its group, in place.
 *
 *  Clears `groupId`, the transform cycle's identity stash and the world
 *  orientation flags, mirroring the per-kind clearing in `ungroupFigures`'
 *  apply path. Was `detachFromGroup`, and used to clear the `local*`
 *  caches too; P6-B retired those, and what is left is the membership and
 *  the stash, so the name now says that.
 *
 *  Does NOT clear `creationBox` for SVGs - callers that need the
 *  `ungroupCreationBox` snap should handle that separately. */
export function detachFromGroup(item: any, kind: CompItemKind): void {
  item.groupId = undefined;
  if (kind === 'figure') {
    item.identityCellX = undefined;
    item.identityCellY = undefined;
    item.transformCycleStep = undefined;
  } else if (kind === 'svg') {
    item.localSegments = undefined;
    item.identitySegments = undefined;
    item.rotation = undefined;
    item.mirrorH = undefined;
    item.mirrorV = undefined;
  } else if (kind === 'image' || kind === 'text' || kind === 'paint' || kind === 'pattern') {
    item.identityCellX = undefined;
    item.identityCellY = undefined;
    item.identityCellWidth = undefined;
    item.identityCellHeight = undefined;
    item.rotation = undefined;
    item.mirrorH = undefined;
    item.mirrorV = undefined;
  }
}


/** Rescale segments to fit within newBbox. Each segment point is mapped
 *  proportionally: `new = newMin + (old - oldMin) * (newSize / oldSize)`.
 *  Degenerate axes (oldSize === 0) translate by the bbox shift instead of
 *  scaling. A stretch (sx ≠ sy) sheds arcs into polylines first, since an
 *  arc's three points infer one radius that per-axis mapping would break —
 *  see `rescaleSegs`, which this is the long-standing name for. Kept as one
 *  implementation: the two used to be identical copies, and a fix to either
 *  left the other deforming arcs. */
export const rescaleSVGToBbox = rescaleSegs;

/** Shift one node by `(dx, dy)` — rigid: the rendered orientation is
 *  preserved (bbox kinds keep rotation/mirror; figures/svgs clear only
 *  their transform-cycle stash). Used by the unified `moveNode`
 *  apply / revert. Delegates to the geometry adapter for per-kind logic. */
export function translateNodeByDelta(
  state: CompositionState, nodeId: string, dx: number, dy: number,
): CompositionState {
  if (dx === 0 && dy === 0) return state;
  // Find which array contains the node and use the matching adapter.
  for (const sceneAdapter of SCENE_ADAPTERS) {
    const arr = sceneAdapter.getArray(state);
    const item = arr.find((x: any) => x.id === nodeId) as { groupId?: string } | undefined;
    if (!item) continue;
    const geoAdapter = GEOMETRY_ADAPTERS[sceneAdapter.kind];
    const updated = arr.map((x: any) => x.id === nodeId ? geoAdapter.translate(x, dx, dy) : x);
    return sceneAdapter.setArray(state, updated);
  }
  return state;
}

/** Set a node's free (continuous) rotation `angleDeg` (degrees CW about the
 *  bbox center), resolving the id through SCENE_ADAPTERS so it works for any
 *  bbox/svg kind. `undefined` clears free rotation. Mirror of the
 *  `lockObject` apply pattern; used by the `setNodeRotation` op apply/revert. */
export function setNodeAngleDeg(
  state: CompositionState, nodeId: string, angleDeg: number | undefined,
): CompositionState {
  let next = state;
  for (const adapter of SCENE_ADAPTERS) {
    const arr = adapter.getArray(next);
    let touched = false;
    const updated = arr.map((x) => {
      if (x.id !== nodeId) return x;
      touched = true;
      // Normalize away no-op/near-zero angles so the field stays absent when
      // there is no free rotation (keeps saves/exports clean and identity
      // comparisons stable).
      const a = angleDeg === undefined || angleDeg === 0 ? undefined : angleDeg;
      return { ...x, angleDeg: a };
    });
    if (touched) {
      next = adapter.setArray(next, updated as SceneObjectBase[]);
      break;
    }
  }
  return next;
}

/** Restore the identity / rotation / mirror fields that the forward move
 *  cleared. Per-type: figures get `identityCell*` + `transformCycleStep`;
 *  svgs get `identitySegments` + `rotation` + `mirror*`. Bbox kinds
 *  (image, text, paint, pattern) need nothing here: their translate is
 *  rigid and exactly undone by the inverse translate — restoring captured
 *  fields on top would only re-corrupt (the old image/text branches wrote
 *  `identityCellWidth/Height` from op fields buildMoveNode never captured,
 *  wiping them on every undo). Called immediately after the
 *  inverse-translate in `revertOp`'s `moveNode` case. */
function restoreNodeIdentity(
  state: CompositionState, nodeId: string,
  op: { oldIdentityCellX?: number; oldIdentityCellY?: number; oldTransformCycleStep?: number;
        oldIdentitySegments?: PathSegment[];
        oldIdentityCellWidth?: number; oldIdentityCellHeight?: number;
        oldRotation?: 0 | 90 | 180 | 270; oldMirrorH?: boolean; oldMirrorV?: boolean },
): CompositionState {
  const fig = state.figures.find(f => f.id === nodeId);
  if (fig) {
    const figures = state.figures.map((f) => f.id === nodeId ? {
      ...f,
      identityCellX: op.oldIdentityCellX, identityCellY: op.oldIdentityCellY,
      transformCycleStep: op.oldTransformCycleStep,
    } : f);
    return { ...state, figures };
  }
  const svg = state.svgObjects.find(s => s.id === nodeId);
  if (svg) {
    const svgObjects = state.svgObjects.map((s) => s.id === nodeId ? {
      ...s,
      identitySegments: op.oldIdentitySegments,
      rotation: op.oldRotation,
      mirrorH: op.oldMirrorH,
      mirrorV: op.oldMirrorV,
    } : s);
    return { ...state, svgObjects };
  }
  return state;
}


// Scene picking - "what is at this cell", the selection bounds and the
// group expanders - moved to ./compositionScenePicking in P7; re-exported
// so every existing importer of `compositionOps` keeps working unchanged.
export {
  bucketMovedIds, expandIdsToGroups, expandToGroup, findFigureAtCell,
  findGroupId, findImageAtCell, findSceneObjectAtCell, findStrokeAtCell,
  findTextAtCell, groupBounds, groupMemberIds, groupSelectionBounds,
} from './compositionScenePicking';

// Node lookup, lock/hidden predicates and the nested-group hierarchy
// readers now live in ./compositionNodeLookup, re-exported below.

// The legacy group-chain transform math - a chain applied to a rectangle, a
// point or a free vector - moved to ./compositionGroupTransform in P7;
// re-exported so every existing importer keeps working unchanged.
export {
  applyChainedGroupTransform,
  applyChainedGroupTransformDelta,
  applyChainedGroupTransformPoint,
  applyGroupTransform,
  applyGroupTransformPoint,
  composeChainedOrientations,
  inverseChainedGroupTransformDelta,
  inverseChainedGroupTransformPoint,
  recalcLineDirection,
  ungroupCreationBox,
} from './compositionGroupTransform';
import { recalcLineDirection, ungroupCreationBox } from './compositionGroupTransform';


/**
 * Set a leaf node's group membership for a reparent, preserving its WORLD
 * coords/orientation. Into a group (`groupId` set): only stamps `groupId` — the
 * caller reconciles `local*` from world. To top level (`groupId` undefined):
 * clears `groupId` + all group-relative local caches (world fields, which the
 * loose node renders from directly, are untouched). No-op if `id` isn't a leaf.
 */
function setLeafGroupId(
  state: CompositionState,
  id: string,
  groupId: string | undefined,
): CompositionState {
  const clearFig = {
    groupId: undefined, 
  } as const;
  const clearBbox = {
    groupId: undefined, 
  } as const;
  const clearSvg = { ...clearBbox, localSegments: undefined, localSubpaths: undefined } as const;
  const clearPattern = {
    ...clearBbox,
  } as const;
  const toTop = groupId === undefined;
  return {
    ...state,
    figures: state.figures.map((f) => (f.id !== id ? f : toTop ? { ...f, ...clearFig } : { ...f, groupId })),
    svgObjects: state.svgObjects.map((s) => (s.id !== id ? s : toTop ? { ...s, ...clearSvg } : { ...s, groupId })),
    images: (state.images ?? []).map((i) => (i.id !== id ? i : toTop ? { ...i, ...clearBbox } : { ...i, groupId })),
    texts: (state.texts ?? []).map((t) => (t.id !== id ? t : toTop ? { ...t, ...clearBbox } : { ...t, groupId })),
    paintObjects: (state.paintObjects ?? []).map((p) => (p.id !== id ? p : toTop ? { ...p, ...clearBbox } : { ...p, groupId })),
    patternObjects: (state.patternObjects ?? []).map((p) => (p.id !== id ? p : toTop ? { ...p, ...clearPattern } : { ...p, groupId })),
  };
}

// The QUARTER TURN and the transform cycle - a figure and an svg rotated
// 90 degrees CW, mirrored on an axis, and the seven-step cycle the
// transform button walks - moved to ./compositionQuarterTurn in P7;
// re-exported so every existing importer keeps working unchanged.
export type { TransformStep } from './compositionQuarterTurn';
export {
  TRANSFORM_CYCLE, composeOrientations, cycleTransformForFigure,
  mirrorFigureIndividual, mirrorSVG, rotateFigureIndividual90CW,
  rotateGroupMemberFigure90CW, rotateSVG90CW, screenToLocalFlipAxis,
  transformQuadsByGroup,
} from './compositionQuarterTurn';
/**
 * Run a legacy op through the SCENE GRAPH on a composition that has none.
 *
 * Builds a graph from the arrays, lets the bridge say what the op means on
 * it, and renders the arrays back. `pick` is `legacyOpToSceneOps` going
 * forward and `invertOnGraph` going back — both return ops to apply, since
 * an inverted op is still a forward one.
 *
 * The whole scene is re-rendered, which is what makes this the fallback
 * and not the path: a composition that edits this way asks for a graph
 * (`withSceneGraph`) and keeps it.
 */
function onGraphFallback(
  state: CompositionState,
  op: CompUndoOp,
  pick: (graph: SceneGraph, op: CompUndoOp) => SceneEntry | null,
): CompositionState {
  const graph = fromLegacy(state);
  const ops = pick(graph, op);
  if (!ops || ops.length === 0) return state;
  return { ...state, ...toLegacyView(applySceneOps(graph, ops)) };
}

function applyOpInner(state: CompositionState, op: CompUndoOp): CompositionState {
  switch (op.op) {
    case 'placeFigure': {
      return appendToSceneOrder({ ...state, figures: [...state.figures, op.figure] }, op.figure.id);
    }
    case 'placeObject': {
      const adapter = SCENE_ADAPTERS.find((a) => a.kind === op.kind);
      if (!adapter) return state;
      const arr = [...adapter.getArray(state), op.item as SceneObjectBase];
      const next = adapter.setArray(state, arr);
      return op.sceneOrderIndex !== undefined
        ? insertIntoSceneOrder(next, op.item.id, op.sceneOrderIndex)
        : appendToSceneOrder(next, op.item.id);
    }
    case 'removeObject': {
      // Drop the item from its kind's array, drop it from selection.
      const adapter = SCENE_ADAPTERS.find((a) => a.kind === op.kind);
      if (!adapter) return state;
      const arr = adapter.getArray(state).filter((x) => x.id !== op.item.id);
      let next = adapter.setArray(state, arr as SceneObjectBase[]);
      next = removeFromSceneOrder(next, op.item.id);
      const newSelected = new Set(next.selectedFigureIds);
      newSelected.delete(op.item.id);
      return { ...next, selectedFigureIds: newSelected };
    }
    case 'moveNode': {
      // Translate by (dx, dy). One pass over each node array â€” only the
      // node whose id matches gets the shift. Identity / rotation / mirror
      // are cleared here (matches the live MOVE_FIGURES_DELTA reducer);
      // revert restores them from the captured `old*` fields.
      return translateNodeByDelta(state, op.nodeId, op.dx, op.dy);
    }
    case 'rotateFigure': {
      const figures = state.figures.map((f) => {
        if (f.id !== op.figureId) return f;
        const updated: typeof f = { ...f, rotation: op.newRotation,
          cellX: op.newCellX, cellY: op.newCellY,
          cellWidth: op.newCellWidth, cellHeight: op.newCellHeight };
        if (op.newQuads !== undefined) updated.quads = op.newQuads;
        if (op.newIdentityCellX !== undefined) updated.identityCellX = op.newIdentityCellX;
        if (op.newIdentityCellY !== undefined) updated.identityCellY = op.newIdentityCellY;
        return updated;
      });
      return { ...state, figures };
    }
    case 'mirrorFigure': {
      const figures = state.figures.map((f) => {
        if (f.id !== op.figureId) return f;
        const base = op.axis === 'h' ? { ...f, mirrorH: op.newValue } : { ...f, mirrorV: op.newValue };
        if (op.newQuads !== undefined) base.quads = op.newQuads;
        return base;
      });
      return { ...state, figures };
    }
    case 'lockObject': {
      // Find the item via SCENE_ADAPTERS and toggle its locked field. No
      // need to know the kind up front â€” we walk the adapters and apply
      // to whichever array has the id.
      let next = state;
      for (const adapter of SCENE_ADAPTERS) {
        const arr = adapter.getArray(next);
        let touched = false;
        const updated = arr.map((x) => {
          if (x.id !== op.id) return x;
          touched = true;
          return { ...x, locked: op.newValue };
        });
        if (touched) {
          next = adapter.setArray(next, updated as SceneObjectBase[]);
          break;
        }
      }
      return next;
    }
    case 'lockGroup': {
      // Set the group's OWN locked flag. Members are untouched — they inherit
      // the lock through isItemLocked's ancestor walk.
      return {
        ...state,
        groups: state.groups.map((g) => (g.id === op.id ? { ...g, locked: op.newValue } : g)),
      };
    }
    case 'setObjectHidden': {
      // Mirror of lockObject: find the matching id in whichever adapter
      // array contains it and flip the hidden field.
      let next = state;
      for (const adapter of SCENE_ADAPTERS) {
        const arr = adapter.getArray(next);
        let touched = false;
        const updated = arr.map((x) => {
          if (x.id !== op.id) return x;
          touched = true;
          return { ...x, hidden: op.newValue };
        });
        if (touched) {
          next = adapter.setArray(next, updated as SceneObjectBase[]);
          break;
        }
      }
      return next;
    }
    case 'hideGroup': {
      // Mirror of lockGroup: set the group's OWN hidden flag. Members are
      // untouched — they inherit the hide through isItemHidden's ancestor
      // walk, so un-hiding restores each member's own visibility.
      return {
        ...state,
        groups: state.groups.map((g) => (g.id === op.id ? { ...g, hidden: op.newValue } : g)),
      };
    }
    case 'setNodeRotation':
      // Free (continuous) rotation: mirror of lockObject — resolve the id
      // through SCENE_ADAPTERS and write the new angle. Apply uses
      // newAngleDeg; revert (below) restores oldAngleDeg.
      return setNodeAngleDeg(state, op.id, op.newAngleDeg);
    case 'reorderObjects': {
      return applySceneOrder(state, op.newOrder);
    }
    case 'renameFigure': {
      const figures = state.figures.map((f) =>
        f.id === op.figureId ? { ...f, name: op.newName } : f
      );
      return { ...state, figures };
    }
    case 'scaleFigure': {
      if (state.figures.some(f => f.id === op.figureId)) {
        const figures = state.figures.map((f) => {
          if (f.id !== op.figureId) return f;
          const updated: typeof f = { ...f,
            cellX: op.newCellX, cellY: op.newCellY,
            cellWidth: op.newCellWidth, cellHeight: op.newCellHeight,
            identityCellX: undefined, identityCellY: undefined, transformCycleStep: undefined };
          if (op.newTileWidthL0 !== undefined) updated.tileWidthL0 = op.newTileWidthL0;
          if (op.newTileHeightL0 !== undefined) updated.tileHeightL0 = op.newTileHeightL0;
          if (f.tileMode === 'repeat') {
            const [dOffX, dOffY] = tileOffsetDelta(
              f.rotation ?? 0, f.mirrorH ?? false, f.mirrorV ?? false,
              op.newCellX - f.cellX, op.newCellY - f.cellY,
              op.newCellWidth - f.cellWidth, op.newCellHeight - f.cellHeight);
            if (dOffX !== 0) updated.tileOffsetXL0 = (f.tileOffsetXL0 ?? 0) + dOffX;
            if (dOffY !== 0) updated.tileOffsetYL0 = (f.tileOffsetYL0 ?? 0) + dOffY;
          }
          return updated;
        });
        return { ...state, figures };
      }
      const bboxUpdate: Record<string, number | undefined> = { cellX: op.newCellX, cellY: op.newCellY, cellWidth: op.newCellWidth, cellHeight: op.newCellHeight };
      if (state.svgObjects.some(s => s.id === op.figureId)) {
        const svgObjects = state.svgObjects.map(s => {
          if (s.id !== op.figureId) return s;
          if (s.tileMode === 'repeat') {
            const dx = op.newCellX - s.cellX;
            const dy = op.newCellY - s.cellY;
            if (dx !== 0) bboxUpdate.tileOffsetXL0 = (s.tileOffsetXL0 ?? 0) - dx;
            if (dy !== 0) bboxUpdate.tileOffsetYL0 = (s.tileOffsetYL0 ?? 0) - dy;
          }
          // Resize resets the rotation cycle's identity stash â€” matches the
          // figure scaleFigure branch above so the next rotation pivots
          // around the new center.
          return { ...s, ...bboxUpdate, identityCellX: undefined, identityCellY: undefined };
        });
        return { ...state, svgObjects };
      }
      return state;
    }
    case 'syncDimensions': {
      const figures = state.figures.map(f => {
        if (f.id !== op.figureId) return f;
        const update: Record<string, number> = {
          resolutionX: op.newResolutionX, resolutionY: op.newResolutionY,
        };
        if (op.newCellWidth !== undefined) update.cellWidth = op.newCellWidth;
        if (op.newCellHeight !== undefined) update.cellHeight = op.newCellHeight;
        return { ...f, ...update };
      });
      return { ...state, figures };
    }
    case 'toggleRepeat': {
      const tileUpdate: Record<string, any> = { tileMode: op.newTileMode, tileWidthL0: op.newTileWidthL0,
        tileHeightL0: op.newTileHeightL0, cellX: op.newCellX, cellY: op.newCellY,
        cellWidth: op.newCellWidth, cellHeight: op.newCellHeight,
        tileOffsetXL0: undefined, tileOffsetYL0: undefined,
        // Toggling repeat / changing tile size redefines the grid, so existing
        // per-copy paint keys no longer map to meaningful copies. Drop them.
        segmentOverrides: undefined };
      if (state.figures.some(f => f.id === op.figureId)) {
        const figures = state.figures.map(f => f.id === op.figureId ? { ...f, ...tileUpdate } : f);
        return { ...state, figures };
      }
      if (state.svgObjects.some(s => s.id === op.figureId)) {
        const svgObjects = state.svgObjects.map(s => s.id === op.figureId ? { ...s, ...tileUpdate } : s);
        return { ...state, svgObjects };
      }
      if (state.patternObjects?.some(p => p.id === op.figureId)) {
        const patternObjects = state.patternObjects.map(p => p.id === op.figureId ? { ...p, ...tileUpdate } : p);
        return { ...state, patternObjects };
      }
      return state;
    }
    case 'setShapePatternFill': {
      const svgObjects = state.svgObjects.map(s => (s.id === op.svgId
        ? withShapePatternFill(s, op.newFill)
        : s));
      return { ...state, svgObjects };
    }
    case 'editPatternCells': {
      if (shapeHoldingPatternGrid(state, op.patternId)) {
        return mapShapePatternGrid(state, op.patternId,
          (grid) => applyPatternCellEdits(grid, op.edits, 'apply'));
      }
      const patternObjects = (state.patternObjects ?? []).map(p =>
        p.id === op.patternId ? applyPatternCellEdits(p, op.edits, 'apply') : p);
      return { ...state, patternObjects };
    }
    case 'setPatternSettings': {
      const settings = {
        symmetry: op.newSymmetry, allowBorderConnections: op.newAllowBorderConnections,
        tileSets: op.newTileSets,
      };
      if (shapeHoldingPatternGrid(state, op.patternId)) {
        return mapShapePatternGrid(state, op.patternId, (grid) => ({ ...grid, ...settings }));
      }
      const patternObjects = (state.patternObjects ?? []).map(p =>
        p.id === op.patternId ? { ...p, ...settings } : p);
      return { ...state, patternObjects };
    }
    case 'groupFigures': {
      const childGroupSet = new Set(op.childGroupIds ?? []);
      // Items in child groups are NOT modified — only their GroupNode gets
      // a parentGroupId. figureIds contains only loose items (not in any
      // child group).
      //
      // A member's `name` is never touched: the group's own name lives on
      // its GroupNode. (Grouping used to clear every member's name into
      // `preGroupName` and write the group's name onto the first member —
      // a hold-over from before GroupNode had a name of its own, and what
      // made four renamed patterns read as unnamed the moment they were
      // grouped. Files from then are folded back on load: legacyGroupNames.)
      const looseIdSet = new Set(op.figureIds);
      const figures = state.figures.map((f) => {
        if (!looseIdSet.has(f.id)) return f;
        return {
          ...f,
          groupId: op.groupId,
        };
      });
      const svgObjects = state.svgObjects.map((s) => {
        if (!looseIdSet.has(s.id)) return s;
        return {
          ...s,
          groupId: op.groupId,
          localSegments: safeMapSegments(s.segments, clonePathSegment) ?? [],
          // At identity-transform group creation, world == local. Cloning
          // the subpaths into localSubpaths keeps both forms in sync so
          // future group transforms can re-derive subpaths from locals.
          localSubpaths: safeMapSubpaths(s.subpaths, clonePathSegment),
        };
      });
      // The bbox kinds snapshot their orientation + free rotation too (the
      // group is born at identity, so local == world): materializeBboxMember
      // composes the group's turn onto THESE, never onto the world fields.
      const images = (state.images ?? []).map((i) => {
        if (!looseIdSet.has(i.id)) return i;
        return {
          ...i,
          groupId: op.groupId,
        };
      });
      const texts = (state.texts ?? []).map((t) => {
        if (!looseIdSet.has(t.id)) return t;
        return {
          ...t,
          groupId: op.groupId,
        };
      });
      const paints = (state.paintObjects ?? []).map((p) => {
        if (!looseIdSet.has(p.id)) return p;
        return {
          ...p,
          groupId: op.groupId,
        };
      });
      const patterns = (state.patternObjects ?? []).map((p) => {
        if (!looseIdSet.has(p.id)) return p;
        return {
          ...p,
          groupId: op.groupId,
          // Repeat patterns snapshot their tile pitch + offset like tiled
          // figures do (the group is born at identity, so local == world):
          // transformGroup materializes from locals, and without these the
          // FIRST scale after grouping would leave the tiling fixed.
        };
      });
      // Nest child groups by setting parentGroupId; their names are theirs.
      let groups: GroupNode[] = state.groups.map((g) => {
        if (!childGroupSet.has(g.id)) return g;
        return { ...g, parentGroupId: op.groupId };
      });
      // Add the new GroupNode unless it already exists.
      const existing = groups.some(g => g.id === op.groupId);
      if (!existing) {
        groups = [
          ...groups,
          // A group being REPRODUCED (an ungroup undone, a group
          // duplicated) is born at its saved pose; a group newly made is
          // born at the identity, which is what the member snapshots
          // above assume when they take world for local.
          {
            id: op.groupId, name: op.groupName,
            translateX: op.savedTranslateX ?? 0, translateY: op.savedTranslateY ?? 0,
            scaleX: op.savedScaleX ?? 1, scaleY: op.savedScaleY ?? 1,
            rotation: op.savedRotation ?? 0,
            ...(op.savedAngleDeg !== undefined ? { angleDeg: op.savedAngleDeg } : null),
            mirrorH: op.savedMirrorH ?? false, mirrorV: op.savedMirrorV ?? false,
            ...(op.isFrame ? { isFrame: true as const } : null),
          },
        ];
      }
      // Re-cluster members in sceneOrder so the new group is contiguous.
      return reflowSceneOrderForGroups({ ...state, figures, svgObjects, images, texts, paintObjects: paints, patternObjects: patterns, groups });
    }
    case 'ungroupFigures': {
      const ungroupNode = state.groups.find(g => g.id === op.groupId);
      const childGroupSet = new Set(op.childGroupIds ?? []);
      // Only ungroup loose members (directly in this group, not in a child group).
      const figures = state.figures.map((f) =>
        f.groupId === op.groupId ? {
          ...f,
          groupId: undefined,
          identityCellX: undefined,
          identityCellY: undefined,
          transformCycleStep: undefined,
        } : f
      );
      const svgObjects = state.svgObjects.map((s) => {
        if (s.groupId !== op.groupId) return s;
        return {
          ...s,
          groupId: undefined,
          localSegments: undefined,
          localSubpaths: undefined,
          creationBox: ungroupNode
            ? ungroupCreationBox(s, ungroupNode, state.gridLevel)
            : s.creationBox,
          identitySegments: undefined,
          rotation: undefined,
          mirrorH: undefined,
          mirrorV: undefined,
          lineDirection: recalcLineDirection(s),
          // Mask is only active while grouped; first-level members are now
          // loose, so unset the flag. Nested child-group members (groupId !==
          // op.groupId) are skipped by the guard above, so their masks persist.
          isMask: undefined,
        };
      });
      // The bbox kinds (images, texts, paint islands, patterns) KEEP their
      // rotation / mirror: for them those fields are the world orientation
      // the renderer draws — what materializeBboxMember writes — and a loose
      // object drawn the same way needs the same values. Clearing them (as
      // the svg branch above rightly does, its segments carrying the
      // orientation) turned four patterns flipped and turned differently
      // back into four identical grids the moment they were ungrouped.
      const images = (state.images ?? []).map((i) =>
        i.groupId === op.groupId ? {
          ...i,
          groupId: undefined,
          identityCellX: undefined,
          identityCellY: undefined,
          identityCellWidth: undefined,
          identityCellHeight: undefined,
        } : i
      );
      const texts = (state.texts ?? []).map((t) =>
        t.groupId === op.groupId ? {
          ...t,
          groupId: undefined,
          identityCellX: undefined,
          identityCellY: undefined,
          identityCellWidth: undefined,
          identityCellHeight: undefined,
        } : t
      );
      const paints = (state.paintObjects ?? []).map((p) =>
        p.groupId === op.groupId ? {
          ...p,
          groupId: undefined,
          identityCellX: undefined,
          identityCellY: undefined,
          identityCellWidth: undefined,
          identityCellHeight: undefined,
        } : p
      );
      const patterns = (state.patternObjects ?? []).map((p) =>
        p.groupId === op.groupId ? {
          ...p,
          groupId: undefined,
          identityCellX: undefined,
          identityCellY: undefined,
          identityCellWidth: undefined,
          identityCellHeight: undefined,
        } : p
      );
      // Detach child groups from the parent.
      let groups = state.groups.map((g) => {
        if (!childGroupSet.has(g.id)) return g;
        return { ...g, parentGroupId: undefined };
      });
      // Remove the outer GroupNode itself.
      groups = groups.filter(g => g.id !== op.groupId);
      // Reconcile locals ONLY for members of detached child groups: their
      // local coords were relative to the old chain (child + removed
      // parent). Without this, the first materializeGroupMembers call
      // (e.g. on move) recomputes world from stale locals through the
      // shortened chain, producing wrong positions. We target only the
      // affected groups to avoid perturbing unrelated items.
      const result: CompositionState = { ...state, figures, svgObjects, images, texts, paintObjects: paints, patternObjects: patterns, groups };
      if (childGroupSet.size === 0) return result;
      // Collect all group IDs that descend from the detached children.
      const affectedGroupIds = new Set<string>();
      for (const cid of childGroupSet) {
        affectedGroupIds.add(cid);
        for (const d of descendantGroupIds(groups, cid)) affectedGroupIds.add(d);
      }
      return result;
    }
    case 'reparentNode': {
      const isGroup = state.groups.some((g) => g.id === op.nodeId);
      const newParent = op.newParentGroupId;
      let next: CompositionState;
      if (isGroup) {
        // Move a whole group subtree: repoint its parentGroupId.
        const groups = state.groups.map((g) =>
          g.id === op.nodeId ? { ...g, parentGroupId: newParent } : g,
        );
        next = { ...state, groups };
      } else if (newParent) {
        // Leaf into a group: stamp the membership. The leaf keeps its world
        // pose, which is the only copy of it there is.
        next = setLeafGroupId(state, op.nodeId, newParent);
      } else {
        // Leaf out to top level: clear membership.
        next = setLeafGroupId(state, op.nodeId, undefined);
      }
      // Apply the caller's contiguous order, then reflow as a safety net.
      next = applySceneOrder(next, [...op.newSceneOrder]);
      return reflowSceneOrderForGroups(next);
    }
    case 'renameGroup': {
      const groups = state.groups.map(g =>
        g.id === op.groupId ? { ...g, name: op.newName } : g
      );
      return { ...state, groups };
    }
    case 'removeGroup': {
      return { ...state, groups: state.groups.filter((g) => g.id !== op.group.id) };
    }
    case 'setTransform':
      // A graph op on a composition that has no graph: build one from the
      // arrays, run it, render the arrays back. The whole scene is
      // re-rendered, which is what makes this the fallback and not the
      // path — a composition that edits this way asks for a graph
      // (`withSceneGraph`) and keeps it.
      return {
        ...state,
        ...toLegacyView(applySceneOps(fromLegacy(state), [
          { op: 'setTransform', nodeId: op.nodeId, from: op.from, to: op.to },
        ])),
      };
    case 'transformGroup':
      // A group transform is a transform on the group's NODE. The old
      // implementation set the GroupNode's fields and then materialized
      // every member's world coords from its `local*` caches; those caches
      // are gone (P6-B), and the graph says the same thing without them.
      // Same shape as `setTransform` above: build a graph from the arrays,
      // run the op, render the arrays back.
      return onGraphFallback(state, op, legacyOpToSceneOps);
    case 'createSVG':
      return { ...state, svgObjects: [...state.svgObjects, op.svg] };
    case 'editSVGSegments': {
      // Bbox source: explicit op fields (tile-mode rotate/mirror) or
      // AABB of the new segments (default â€” visible segments define the box).
      const bbox = op.newCellX !== undefined
        ? { cellX: op.newCellX, cellY: op.newCellY as number,
            cellWidth: op.newCellWidth as number, cellHeight: op.newCellHeight as number }
        : computeSVGBbox(op.newSegments);
      // Orientation: preserve when the caller asks (tile-mode rotate/mirror
      // needs the rotation flag and identity stash to round-trip through
      // undo/redo); otherwise clear (default â€” most segment edits create a
      // new identity).
      const orient = op.preserveOrientation
        ? { rotation: op.newRotation, mirrorH: op.newMirrorH, mirrorV: op.newMirrorV,
            identitySegments: op.newIdentitySegments,
            identityCellX: op.newIdentityCellX, identityCellY: op.newIdentityCellY }
        : { rotation: undefined, mirrorH: undefined, mirrorV: undefined,
            identitySegments: undefined,
            identityCellX: undefined, identityCellY: undefined };
      const svgObjects = state.svgObjects.map((s) => s.id === op.svgId
        ? { ...s, segments: op.newSegments, ...bbox, ...orient,
            // Local-space mirror. For a GROUPED svg the caller's value is
            // ignored: `reconcileAfterOp` derives the locals from the new
            // world segments the moment this op returns, and a caller that
            // passed nothing (as the host's orientation builder does) used
            // to leave the old local geometry in place — the stale-locals
            // bug. Off-group the field is still honoured, since nothing
            // derives it there and `null` is how a caller clears it.
            ...(s.groupId === undefined && op.newLocalSegments !== undefined
              ? (op.newLocalSegments === null
                ? { localSegments: undefined }
                : { localSegments: op.newLocalSegments })
              : null),
            ...(op.newSubpaths !== undefined
              ? (op.newSubpaths === null ? { subpaths: undefined } : { subpaths: op.newSubpaths })
              : null),
            ...(op.newCreationBox !== undefined ? { creationBox: op.newCreationBox } : null),
            ...(op.newLineDirection !== undefined ? { lineDirection: op.newLineDirection } : null),
            // Tile-grid metadata (tile-mode rotate/mirror). Offsets normalize
            // 0 → undefined so an untouched pattern stays field-free.
            ...(op.newTileWidthL0 !== undefined ? { tileWidthL0: op.newTileWidthL0 } : null),
            ...(op.newTileHeightL0 !== undefined ? { tileHeightL0: op.newTileHeightL0 } : null),
            ...(op.newTileOffsetXL0 !== undefined
              ? { tileOffsetXL0: op.newTileOffsetXL0 === 0 ? undefined : op.newTileOffsetXL0 } : null),
            ...(op.newTileOffsetYL0 !== undefined
              ? { tileOffsetYL0: op.newTileOffsetYL0 === 0 ? undefined : op.newTileOffsetYL0 } : null),
            ...(op.newAngleDeg !== undefined
              ? { angleDeg: op.newAngleDeg === null ? undefined : op.newAngleDeg } : null) }
        : s);
      return { ...state, svgObjects };
    }
    case 'renameSVG': {
      const svgObjects = state.svgObjects.map((s) => s.id === op.svgId ? { ...s, name: op.newName } : s);
      return { ...state, svgObjects };
    }
    case 'recolorSVG': {
      const svgObjects = state.svgObjects.map((s) => {
        if (s.id !== op.svgId) return s;
        // Paint-stroke shape: segments, subpaths (and the local-space
        // mirrors for grouped SVGs) all change together. Bbox is
        // unchanged because paint never moves vertices.
        if (op.newSegments !== undefined) {
          const next: SVGObject = { ...s, color: op.newColor, segments: op.newSegments, subpaths: op.newSubpaths };
          if (op.newLocalSegments !== undefined) next.localSegments = op.newLocalSegments;
          if (op.newLocalSubpaths !== undefined) next.localSubpaths = op.newLocalSubpaths;
          if (op.newFillColor !== undefined) next.fillColor = op.newFillColor;
          return next;
        }
        // Simple-recolor shape (tap-and-confirm Color tool): only color changes;
        // subpaths (and their local mirror) get wiped to keep multi-color
        // objects from drifting.
        return { ...s, color: op.newColor, subpaths: undefined, localSubpaths: undefined };
      });
      return { ...state, svgObjects };
    }
    case 'setFillColor': {
      const svgObjects = state.svgObjects.map((s) =>
        s.id === op.svgId ? { ...s, fillColor: op.newFillColor, fillOpacity: op.newFillOpacity } : s
      );
      return { ...state, svgObjects };
    }
    case 'setMaskMode': {
      const svgObjects = state.svgObjects.map((s) =>
        s.id === op.svgId ? { ...s, isMask: op.newValue } : s
      );
      return { ...state, svgObjects };
    }
    case 'recolorFigure': {
      const figures = state.figures.map((f) => f.id === op.figureId ? { ...f, colorOverride: op.newColor, colorOverrideBlendMode: op.newBlendMode } : f);
      return { ...state, figures };
    }
    case 'paintTileSegments': {
      const svgObjects = state.svgObjects.map((s) =>
        s.id === op.svgId ? { ...s, segmentOverrides: applyTileSegmentChanges(s.segmentOverrides, op.changes, 'new') } : s
      );
      return { ...state, svgObjects };
    }
    // â”€â”€ Image ops â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    case 'editImage': {
      const images = (state.images ?? []).map((i) => i.id === op.imageId ? {
        ...i,
        cellX: op.newCellX, cellY: op.newCellY,
        cellWidth: op.newCellWidth, cellHeight: op.newCellHeight,
        rotation: op.newRotation,
        mirrorH: op.newMirrorH,
        mirrorV: op.newMirrorV,
        angleDeg: op.newAngleDeg,
        opacity: op.newOpacity,
        identityCellX: op.newIdentityCellX,
        identityCellY: op.newIdentityCellY,
        identityCellWidth: op.newIdentityCellWidth,
        identityCellHeight: op.newIdentityCellHeight,
        // Local-space bbox. For a GROUPED image the caller's value is
        // ignored: `reconcileAfterOp` derives it from the new world bbox
        // the moment this op returns. The host's transform builder carries
        // these across unchanged from the previous state, which is how a
        // resized image inside a group used to snap back to its old size
        // the next time an ancestor moved.
        ...(i.groupId === undefined ? {
        } : null),
      } : i);
      return { ...state, images };
    }
    case 'joinObjects': {
      const sourceSVGIds = new Set(op.sourceSVGs.map(s => s.id));
      const sourceFigIds = new Set((op.sourceFigures ?? []).map(f => f.id));
      const svgObjects = state.svgObjects.filter(s => !sourceSVGIds.has(s.id));
      const figures = state.figures.filter(f => !sourceFigIds.has(f.id));
      const insertIdx = Math.min(op.resultInsertIndex, svgObjects.length);
      const newSVGs = [
        ...svgObjects.slice(0, insertIdx),
        op.result,
        ...svgObjects.slice(insertIdx),
      ];
      const newSelected = new Set(state.selectedFigureIds);
      let anySourceSelected = false;
      for (const id of sourceSVGIds) { if (newSelected.delete(id)) anySourceSelected = true; }
      for (const id of sourceFigIds) { if (newSelected.delete(id)) anySourceSelected = true; }
      // Only carry the selection to the result when a source was actually
      // selected. Explicit Join/Expand operates on selected objects (result
      // stays selected); mid-stroke paint expansion joins unselected
      // figures/tiles, where selecting the result would flash a phantom
      // selection box.
      if (anySourceSelected) newSelected.add(op.result.id);
      const allSourceIds = new Set<string>();
      for (const id of sourceSVGIds) allSourceIds.add(id);
      for (const id of sourceFigIds) allSourceIds.add(id);
      const sceneOrder = mergeIdsIntoSceneOrder(state.sceneOrder, allSourceIds, op.result.id);
      const next: CompositionState = {
        ...state,
        figures,
        svgObjects: newSVGs,
        sceneOrder,
        selectedFigureIds: newSelected,
        editingLineId: state.editingLineId && allSourceIds.has(state.editingLineId) ? null : state.editingLineId,
      };
      return next;
    }
    case 'unionObjects': {
      // Geometric union: replace the source SVG objects with their single
      // merged closed shape. SVG-only (closed shapes), so no figure handling.
      const sourceSVGIds = new Set(op.sourceSVGs.map(s => s.id));
      const svgObjects = state.svgObjects.filter(s => !sourceSVGIds.has(s.id));
      const insertIdx = Math.min(op.resultInsertIndex, svgObjects.length);
      const newSVGs = [
        ...svgObjects.slice(0, insertIdx),
        op.result,
        ...svgObjects.slice(insertIdx),
      ];
      const newSelected = new Set(state.selectedFigureIds);
      for (const id of sourceSVGIds) newSelected.delete(id);
      newSelected.add(op.result.id);
      const sceneOrder = mergeIdsIntoSceneOrder(state.sceneOrder, sourceSVGIds, op.result.id);
      return {
        ...state,
        svgObjects: newSVGs,
        sceneOrder,
        selectedFigureIds: newSelected,
        editingLineId: state.editingLineId && sourceSVGIds.has(state.editingLineId) ? null : state.editingLineId,
      };
    }
    case 'mergeTile': {
      const merged = {
        ...state,
        figures: [...state.figures, ...op.addedFigures],
        svgObjects: [...state.svgObjects, ...op.addedSVGs],
        images: [...(state.images ?? []), ...op.addedImages],
        groups: [...state.groups, ...op.addedGroups],
        sceneOrder: [...state.sceneOrder, ...op.addedSceneOrder],
        renderGeneration: state.renderGeneration + 1,
      };
      return merged;
    }
    case 'replaceScene':
      return {
        ...state,
        figures: op.newFigures,
        svgObjects: op.newSVGObjects,
        images: op.newImages,
        groups: op.newGroups,
        sceneOrder: op.newSceneOrder,
        // Absent = pre-text entry; leave texts untouched so old undo
        // entries replay without wiping v29 content.
        ...(op.newTexts !== undefined ? { texts: op.newTexts } : {}),
        // Same contract for paint islands (v52+).
        ...(op.newPaints !== undefined ? { paintObjects: op.newPaints } : {}),
        // …and for patterns (v54+).
        ...(op.newPatterns !== undefined ? { patternObjects: op.newPatterns } : {}),
        renderGeneration: state.renderGeneration + 1,
      };
    case 'setText': {
      const texts = (state.texts ?? []).map((t) => t.id === op.textId ? {
        ...t, content: op.newContent,
        cellWidth: op.newCellWidth, cellHeight: op.newCellHeight,
        // Anchored auto-size re-measures move the origin too; entries
        // without the optional fields leave cellX/Y untouched.
        ...(op.newCellX !== undefined ? { cellX: op.newCellX } : {}),
        ...(op.newCellY !== undefined ? { cellY: op.newCellY } : {}),
      } : t);
      return { ...state, texts };
    }
    case 'setTextStyle': {
      const texts = (state.texts ?? []).map((t) => t.id === op.textId ? {
        ...t, style: op.newStyle,
        cellWidth: op.newCellWidth, cellHeight: op.newCellHeight,
        ...(op.newCellX !== undefined ? { cellX: op.newCellX } : {}),
        ...(op.newCellY !== undefined ? { cellY: op.newCellY } : {}),
      } : t);
      return { ...state, texts };
    }
    case 'setNodeEffects': {
      // Mirror of lockObject: resolve the id through SCENE_ADAPTERS and
      // swap the effects block on whichever kind carries it.
      let next = state;
      for (const adapter of SCENE_ADAPTERS) {
        const arr = adapter.getArray(next);
        let touched = false;
        const updated = arr.map((x) => {
          if (x.id !== op.id) return x;
          touched = true;
          return { ...x, effects: op.newEffects };
        });
        if (touched) {
          next = adapter.setArray(next, updated as SceneObjectBase[]);
          break;
        }
      }
      return next;
    }
    case 'setFillPaint': {
      const svgObjects = state.svgObjects.map((s) =>
        s.id === op.svgId ? { ...s, fillPaint: op.newPaint } : s
      );
      return { ...state, svgObjects };
    }
    case 'setImageTint': {
      const images = (state.images ?? []).map((i) =>
        i.id === op.nodeId ? { ...i, tint: op.newTint } : i
      );
      return { ...state, images };
    }
    case 'setBackground':
      return { ...state, background: op.newPaint };
    case 'cleanupLibrary':
      return state;
    default:
      return state;
  }
}

/**
 * Undo one op, without the local-cache reconcile.
 *
 * Most reverts are "apply the inverse", and they say so by calling
 * `applyOpInner` — the INNER one, never `applyOp`. Two reasons. On the
 * legacy path `revertOp` already wraps this in `reconcileAfterOp`, so a
 * reconcile in here is a second pass over the same leaves. And the graph
 * path (`runOnGraph`) calls this directly, precisely so that a content op
 * does not stamp local caches onto grouped leaves: the graph holds the
 * pose, the caches are the legacy spelling of it, and a leaf that comes
 * back carrying `local*` fields the view does not write is a leaf
 * `regraphChangedLeaves` must read in again — which loses the shear a
 * member of a group pulled off-square carries. That is how undoing a
 * stroke width moved a whole group.
 *
 * `ungroupFigures` is the exception and keeps its own reconcile: it
 * restores a group at a saved transform and has to settle the members
 * under it before it returns.
 */
function revertOpInner(state: CompositionState, op: CompUndoOp): CompositionState {
  switch (op.op) {
    case 'placeFigure':
      return applyOpInner(state, { op: 'removeObject', kind: 'figure', item: op.figure });
    case 'placeObject':
      return applyOpInner(state, { op: 'removeObject', kind: op.kind, item: op.item });
    case 'removeObject':
      // Re-insert the deleted item at the end of its kind's array (array
      // order is not user-visible â€” only sceneOrder is), and splice the id
      // back into sceneOrder at its captured pre-delete index so the scene
      // outline / z-position is restored.
      return applyOpInner(state, {
        op: 'placeObject', kind: op.kind, item: op.item,
        sceneOrderIndex: op.sceneOrderIndex,
      });
    case 'moveNode': {
      // Inverse translate, then restore identity / rotation / mirror that
      // the forward apply cleared. Identity-restoration is essential for
      // figure rotation pivots and for line/arc 360Â°-cycle stability.
      const reverted = translateNodeByDelta(state, op.nodeId, -op.dx, -op.dy);
      return restoreNodeIdentity(reverted, op.nodeId, op);
    }
    case 'rotateFigure': {
      const figures = state.figures.map((f) => {
        if (f.id !== op.figureId) return f;
        const updated: typeof f = { ...f, rotation: op.oldRotation,
          cellX: op.oldCellX, cellY: op.oldCellY,
          cellWidth: op.oldCellWidth, cellHeight: op.oldCellHeight,
          identityCellX: op.oldIdentityCellX, identityCellY: op.oldIdentityCellY,
          transformCycleStep: op.oldTransformCycleStep };
        if (op.oldQuads !== undefined) updated.quads = op.oldQuads;
        return updated;
      });
      return { ...state, figures };
    }
    case 'mirrorFigure':
      return applyOpInner(state, { op: 'mirrorFigure', figureId: op.figureId, axis: op.axis,
        oldValue: op.newValue, newValue: op.oldValue, oldQuads: op.newQuads, newQuads: op.oldQuads });
    case 'lockObject':
      return applyOpInner(state, { op: 'lockObject', id: op.id, oldValue: op.newValue, newValue: op.oldValue });
    case 'lockGroup':
      return applyOpInner(state, { op: 'lockGroup', id: op.id, oldValue: op.newValue, newValue: op.oldValue });
    case 'setObjectHidden':
      return applyOpInner(state, { op: 'setObjectHidden', id: op.id, oldValue: op.newValue, newValue: op.oldValue });
    case 'hideGroup':
      return applyOpInner(state, { op: 'hideGroup', id: op.id, oldValue: op.newValue, newValue: op.oldValue });
    case 'setNodeRotation':
      return setNodeAngleDeg(state, op.id, op.oldAngleDeg);
    case 'reorderObjects':
      return applySceneOrder(state, op.oldOrder);
    case 'renameFigure':
      return applyOpInner(state, {
        op: 'renameFigure',
        figureId: op.figureId,
        oldName: op.newName,
        newName: op.oldName,
      });
    case 'scaleFigure': {
      // Restore bounds, tile dims, AND identity/cycle anchors. The forward
      // SCALE_FIGURE clears identity to undefined; revert restores whatever
      // was captured pre-scale (also possibly undefined, which is fine).
      if (state.figures.some(f => f.id === op.figureId)) {
        const figures = state.figures.map((f) => {
          if (f.id !== op.figureId) return f;
          const updated: typeof f = { ...f,
            cellX: op.oldCellX, cellY: op.oldCellY,
            cellWidth: op.oldCellWidth, cellHeight: op.oldCellHeight,
            identityCellX: op.oldIdentityCellX, identityCellY: op.oldIdentityCellY,
            transformCycleStep: op.oldTransformCycleStep };
          if (op.oldTileWidthL0 !== undefined) updated.tileWidthL0 = op.oldTileWidthL0;
          if (op.oldTileHeightL0 !== undefined) updated.tileHeightL0 = op.oldTileHeightL0;
          if (f.tileMode === 'repeat') {
            const [dOffX, dOffY] = tileOffsetDelta(
              f.rotation ?? 0, f.mirrorH ?? false, f.mirrorV ?? false,
              op.oldCellX - f.cellX, op.oldCellY - f.cellY,
              op.oldCellWidth - f.cellWidth, op.oldCellHeight - f.cellHeight);
            if (dOffX !== 0) updated.tileOffsetXL0 = (f.tileOffsetXL0 ?? 0) + dOffX;
            if (dOffY !== 0) updated.tileOffsetYL0 = (f.tileOffsetYL0 ?? 0) + dOffY;
          }
          return updated;
        });
        return { ...state, figures };
      }
      const bboxRevert: Record<string, number> = { cellX: op.oldCellX, cellY: op.oldCellY, cellWidth: op.oldCellWidth, cellHeight: op.oldCellHeight };
      if (state.svgObjects.some(s => s.id === op.figureId)) {
        const svgObjects = state.svgObjects.map(s => {
          if (s.id !== op.figureId) return s;
          if (s.tileMode === 'repeat') {
            const dx = op.oldCellX - s.cellX;
            const dy = op.oldCellY - s.cellY;
            if (dx !== 0) bboxRevert.tileOffsetXL0 = (s.tileOffsetXL0 ?? 0) - dx;
            if (dy !== 0) bboxRevert.tileOffsetYL0 = (s.tileOffsetYL0 ?? 0) - dy;
          }
          return { ...s, ...bboxRevert };
        });
        return { ...state, svgObjects };
      }
      return state;
    }
    case 'syncDimensions':
      return applyOpInner(state, {
        op: 'syncDimensions', figureId: op.figureId,
        oldResolutionX: op.newResolutionX, oldResolutionY: op.newResolutionY,
        newResolutionX: op.oldResolutionX, newResolutionY: op.oldResolutionY,
        oldCellWidth: op.newCellWidth, oldCellHeight: op.newCellHeight,
        newCellWidth: op.oldCellWidth, newCellHeight: op.oldCellHeight,
      });
    case 'toggleRepeat':
      return applyOpInner(state, {
        op: 'toggleRepeat',
        figureId: op.figureId,
        oldTileMode: op.newTileMode,
        oldTileWidthL0: op.newTileWidthL0,
        oldTileHeightL0: op.newTileHeightL0,
        oldCellX: op.newCellX, oldCellY: op.newCellY,
        oldCellWidth: op.newCellWidth, oldCellHeight: op.newCellHeight,
        newTileMode: op.oldTileMode,
        newTileWidthL0: op.oldTileWidthL0,
        newTileHeightL0: op.oldTileHeightL0,
        newCellX: op.oldCellX, newCellY: op.oldCellY,
        newCellWidth: op.oldCellWidth, newCellHeight: op.oldCellHeight,
      });
    case 'setShapePatternFill':
      return applyOpInner(state, {
        op: 'setShapePatternFill', svgId: op.svgId,
        oldFill: op.newFill, newFill: op.oldFill,
      });
    case 'editPatternCells': {
      if (shapeHoldingPatternGrid(state, op.patternId)) {
        return mapShapePatternGrid(state, op.patternId,
          (grid) => applyPatternCellEdits(grid, op.edits, 'revert'));
      }
      const patternObjects = (state.patternObjects ?? []).map(p =>
        p.id === op.patternId ? applyPatternCellEdits(p, op.edits, 'revert') : p);
      return { ...state, patternObjects };
    }
    case 'setPatternSettings':
      return applyOpInner(state, {
        op: 'setPatternSettings', patternId: op.patternId,
        oldSymmetry: op.newSymmetry, newSymmetry: op.oldSymmetry,
        oldAllowBorderConnections: op.newAllowBorderConnections,
        newAllowBorderConnections: op.oldAllowBorderConnections,
        oldTileSets: op.newTileSets, newTileSets: op.oldTileSets,
      });
    case 'groupFigures': {
      // Undo group: clear groupId, identity and locals (names were never
      // changed). Also remove the GroupNode and detach any child groups.
      const revertGroup = state.groups.find(g => g.id === op.groupId);
      const childGroupSet = new Set(op.childGroupIds ?? []);
      const idSet = new Set(op.figureIds);
      const figures = state.figures.map((f) => {
        if (!idSet.has(f.id)) return f;
        return {
          ...f,
          groupId: undefined,
          identityCellX: undefined,
          identityCellY: undefined,
          transformCycleStep: undefined,
        };
      });
      const svgObjects = state.svgObjects.map((s) => {
        if (!idSet.has(s.id)) return s;
        return {
          ...s,
          groupId: undefined,
          localSegments: undefined,
          creationBox: revertGroup
            ? ungroupCreationBox(s, revertGroup, state.gridLevel)
            : s.creationBox,
          identitySegments: undefined,
          rotation: undefined,
          mirrorH: undefined,
          mirrorV: undefined,
          lineDirection: recalcLineDirection(s),
        };
      });
      // Images and texts group exactly as figures and svgs do (see the apply
      // handler), so they must detach here too — left behind they keep a
      // `groupId` pointing at the GroupNode this undo is about to delete, and
      // every later group walk resolves them through a group that no longer
      // exists. The bbox kinds keep their rotation / mirror here exactly as the
      // ungroup apply does: those fields are their world orientation, not a
      // group-local cache. Undoing a grouping used to leave four turned and
      // flipped patterns upright and identical.
      const images = (state.images ?? []).map((i) => {
        if (!idSet.has(i.id)) return i;
        return {
          ...i,
          groupId: undefined,
          identityCellX: undefined,
          identityCellY: undefined,
          identityCellWidth: undefined,
          identityCellHeight: undefined,
        };
      });
      const texts = (state.texts ?? []).map((t) => {
        if (!idSet.has(t.id)) return t;
        return {
          ...t,
          groupId: undefined,
          identityCellX: undefined,
          identityCellY: undefined,
          identityCellWidth: undefined,
          identityCellHeight: undefined,
        };
      });
      const paints = (state.paintObjects ?? []).map((p) => {
        if (!idSet.has(p.id)) return p;
        return {
          ...p,
          groupId: undefined,
          identityCellX: undefined,
          identityCellY: undefined,
          identityCellWidth: undefined,
          identityCellHeight: undefined,
        };
      });
      const patterns = (state.patternObjects ?? []).map((p) => {
        if (!idSet.has(p.id)) return p;
        return {
          ...p,
          groupId: undefined,
          identityCellX: undefined,
          identityCellY: undefined,
          identityCellWidth: undefined,
          identityCellHeight: undefined,
        };
      });
      // Detach child groups (clear parentGroupId).
      let groups = state.groups.map((g) => {
        if (!childGroupSet.has(g.id)) return g;
        return { ...g, parentGroupId: undefined };
      });
      groups = groups.filter(g => g.id !== op.groupId);
      const ungroupResult: CompositionState = { ...state, figures, svgObjects, images, texts, paintObjects: paints, patternObjects: patterns, groups };
      if (childGroupSet.size === 0) return ungroupResult;
      const affectedGroupIds = new Set<string>();
      for (const cid of childGroupSet) {
        affectedGroupIds.add(cid);
        for (const d of descendantGroupIds(groups, cid)) affectedGroupIds.add(d);
      }
      return ungroupResult;
    }
    case 'ungroupFigures': {
      // Undo ungroup: re-apply groupId and group name, re-nest child
      // groups.  If the op saved the group's transform, pre-insert the
      // GroupNode at that transform so `groupFigures` (which skips
      // creation when the node already exists) preserves the non-identity
      // state.  Without this, undoing an ungroup after mirror/move/scale
      // recreates the group at identity and subsequent undos desync.
      let base = state;
      if (op.savedTranslateX !== undefined) {
        const restoredGroup: GroupNode = {
          id: op.groupId,
          name: op.groupName,
          translateX: op.savedTranslateX,
          translateY: op.savedTranslateY!,
          scaleX: op.savedScaleX!,
          scaleY: op.savedScaleY!,
          rotation: op.savedRotation!,
          ...(op.savedAngleDeg ? { angleDeg: op.savedAngleDeg } : null),
          mirrorH: op.savedMirrorH!,
          mirrorV: op.savedMirrorV!,
          parentGroupId: op.savedParentGroupId,
          ...(op.savedIsFrame ? { isFrame: true as const } : null),
        };
        base = { ...state, groups: [...state.groups, restoredGroup] };
      }
      const regrouped = applyOp(base, {
        op: 'groupFigures',
        figureIds: op.figureIds,
        groupId: op.groupId,
        groupName: op.groupName,
        childGroupIds: op.childGroupIds,
        ...(op.savedIsFrame ? { isFrame: true } : null),
      });
      // Apply restored the group; re-set isMask on members that were masks
      // before the original ungroup cleared the flag (see apply handler).
      const restoreMasks = (st: CompositionState): CompositionState => {
        if (!op.maskedSvgIds?.length) return st;
        const ids = new Set(op.maskedSvgIds);
        return {
          ...st,
          svgObjects: st.svgObjects.map(s => ids.has(s.id) ? { ...s, isMask: true } : s),
        };
      };
      return restoreMasks(regrouped);
    }
    case 'reparentNode': {
      // Restore the exact prior records (membership) and order. The
      // snapshots carry correct world coords, which is the whole pose.
      const byId = <T extends { id: string }>(arr: readonly T[], prev: readonly T[] | undefined): T[] => {
        if (!prev || prev.length === 0) return arr as T[];
        const m = new Map(prev.map((p) => [p.id, p]));
        return arr.map((x) => m.get(x.id) ?? x);
      };
      return {
        ...state,
        figures: byId(state.figures, op.prevFigures),
        svgObjects: byId(state.svgObjects, op.prevSVGs),
        images: byId(state.images ?? [], op.prevImages),
        texts: byId(state.texts ?? [], op.prevTexts),
        paintObjects: byId(state.paintObjects ?? [], op.prevPaints),
        patternObjects: byId(state.patternObjects ?? [], op.prevPatterns),
        groups: byId(state.groups, op.prevGroups),
        sceneOrder: [...op.oldSceneOrder],
      };
    }
    case 'renameGroup':
      return applyOpInner(state, { op: 'renameGroup', groupId: op.groupId, oldName: op.newName, newName: op.oldName });
    case 'removeGroup': {
      // Skip if a re-add already happened (e.g., a regroup op earlier in
      // the entry restored the same id) to avoid duplicate GroupNodes.
      if (state.groups.some((g) => g.id === op.group.id)) return state;
      return { ...state, groups: [...state.groups, op.group] };
    }
    case 'setTransform':
      return {
        ...state,
        ...toLegacyView(revertSceneOps(fromLegacy(state), [
          { op: 'setTransform', nodeId: op.nodeId, from: op.from, to: op.to },
        ])),
      };
    case 'transformGroup':
      return onGraphFallback(state, op, invertOnGraph);
    case 'createSVG':
      return applyOpInner(state, { op: 'removeObject', kind: 'svg', item: op.svg });
    case 'editSVGSegments':
      return applyOpInner(state, { op: 'editSVGSegments', svgId: op.svgId,
        oldSegments: op.newSegments, newSegments: op.oldSegments,
        oldLocalSegments: op.newLocalSegments, newLocalSegments: op.oldLocalSegments,
        oldSubpaths: op.newSubpaths, newSubpaths: op.oldSubpaths,
        oldCreationBox: op.newCreationBox, newCreationBox: op.oldCreationBox,
        oldLineDirection: op.newLineDirection, newLineDirection: op.oldLineDirection,
        oldCellX: op.newCellX, oldCellY: op.newCellY,
        oldCellWidth: op.newCellWidth, oldCellHeight: op.newCellHeight,
        newCellX: op.oldCellX, newCellY: op.oldCellY,
        newCellWidth: op.oldCellWidth, newCellHeight: op.oldCellHeight,
        preserveOrientation: op.preserveOrientation,
        oldRotation: op.newRotation, newRotation: op.oldRotation,
        oldMirrorH: op.newMirrorH, newMirrorH: op.oldMirrorH,
        oldMirrorV: op.newMirrorV, newMirrorV: op.oldMirrorV,
        oldIdentitySegments: op.newIdentitySegments, newIdentitySegments: op.oldIdentitySegments,
        oldIdentityCellX: op.newIdentityCellX, newIdentityCellX: op.oldIdentityCellX,
        oldIdentityCellY: op.newIdentityCellY, newIdentityCellY: op.oldIdentityCellY,
        oldTileWidthL0: op.newTileWidthL0, newTileWidthL0: op.oldTileWidthL0,
        oldTileHeightL0: op.newTileHeightL0, newTileHeightL0: op.oldTileHeightL0,
        oldTileOffsetXL0: op.newTileOffsetXL0, newTileOffsetXL0: op.oldTileOffsetXL0,
        oldTileOffsetYL0: op.newTileOffsetYL0, newTileOffsetYL0: op.oldTileOffsetYL0,
        oldAngleDeg: op.newAngleDeg, newAngleDeg: op.oldAngleDeg });
    case 'renameSVG':
      return applyOpInner(state, { op: 'renameSVG', svgId: op.svgId, oldName: op.newName, newName: op.oldName });
    case 'recolorSVG': {
      const svgObjects = state.svgObjects.map((s) => {
        if (s.id !== op.svgId) return s;
        const next: SVGObject = { ...s, color: op.oldColor, subpaths: op.oldSubpaths };
        // Paint-stroke shape restores segments (and the local mirrors
        // for grouped SVGs) too.
        if (op.oldSegments !== undefined) next.segments = op.oldSegments;
        if (op.oldLocalSegments !== undefined) next.localSegments = op.oldLocalSegments;
        // `oldLocalSubpaths === undefined` for a snapshot that had no
        // local mirror (typical first paint on a grouped SVG that
        // didn't yet have subpaths). Restoring `undefined` is the
        // correct revert here.
        next.localSubpaths = op.oldLocalSubpaths;
        if (op.oldFillColor !== undefined) next.fillColor = op.oldFillColor;
        return next;
      });
      return { ...state, svgObjects };
    }
    case 'setFillColor':
      return applyOpInner(state, { op: 'setFillColor', svgId: op.svgId,
        oldFillColor: op.newFillColor, newFillColor: op.oldFillColor,
        oldFillOpacity: op.newFillOpacity, newFillOpacity: op.oldFillOpacity });
    case 'setMaskMode':
      return applyOpInner(state, { op: 'setMaskMode', svgId: op.svgId,
        oldValue: op.newValue, newValue: op.oldValue });
    case 'recolorFigure': {
      const figures = state.figures.map((f) => f.id === op.figureId ? { ...f, colorOverride: op.oldColor, colorOverrideBlendMode: op.oldBlendMode } : f);
      return { ...state, figures };
    }
    case 'paintTileSegments': {
      const svgObjects = state.svgObjects.map((s) =>
        s.id === op.svgId ? { ...s, segmentOverrides: applyTileSegmentChanges(s.segmentOverrides, op.changes, 'old') } : s
      );
      return { ...state, svgObjects };
    }
    // â”€â”€ Image revert ops â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    case 'editImage':
      return applyOpInner(state, { op: 'editImage', imageId: op.imageId,
        oldCellX: op.newCellX, oldCellY: op.newCellY, oldCellWidth: op.newCellWidth, oldCellHeight: op.newCellHeight,
        newCellX: op.oldCellX, newCellY: op.oldCellY, newCellWidth: op.oldCellWidth, newCellHeight: op.oldCellHeight,
        oldAngleDeg: op.newAngleDeg, newAngleDeg: op.oldAngleDeg,
        oldRotation: op.newRotation, newRotation: op.oldRotation,
        oldMirrorH: op.newMirrorH, newMirrorH: op.oldMirrorH,
        oldMirrorV: op.newMirrorV, newMirrorV: op.oldMirrorV,
        oldOpacity: op.newOpacity, newOpacity: op.oldOpacity,
        oldIdentityCellX: op.newIdentityCellX, newIdentityCellX: op.oldIdentityCellX,
        oldIdentityCellY: op.newIdentityCellY, newIdentityCellY: op.oldIdentityCellY,
        oldIdentityCellWidth: op.newIdentityCellWidth, newIdentityCellWidth: op.oldIdentityCellWidth,
        oldIdentityCellHeight: op.newIdentityCellHeight, newIdentityCellHeight: op.oldIdentityCellHeight,
      });
    case 'joinObjects': {
      // Remove result, restore source SVGs and figures
      const svgObjects = state.svgObjects.filter(s => s.id !== op.result.id);
      const svgOrder = op.sourceSVGIndices
        .map((idx, i) => ({ idx, svg: op.sourceSVGs[i] }))
        .sort((a, b) => a.idx - b.idx);
      for (const { idx, svg } of svgOrder) svgObjects.splice(idx, 0, svg);
      let figures = state.figures;
      if (op.sourceFigures && op.sourceFigureIndices) {
        figures = [...state.figures];
        const figOrder = op.sourceFigureIndices
          .map((idx, i) => ({ idx, fig: op.sourceFigures![i] }))
          .sort((a, b) => a.idx - b.idx);
        for (const { idx, fig } of figOrder) (figures as CompositionFigure[]).splice(idx, 0, fig);
      }
      const newSelected = new Set(state.selectedFigureIds);
      newSelected.delete(op.result.id);
      for (const s of op.sourceSVGs) newSelected.add(s.id);
      for (const f of op.sourceFigures ?? []) newSelected.add(f.id);
      return {
        ...state,
        figures,
        svgObjects,
        sceneOrder: op.oldSceneOrder.slice(),
        selectedFigureIds: newSelected,
        editingLineId: state.editingLineId === op.result.id ? null : state.editingLineId,
      };
    }
    case 'unionObjects': {
      // Remove the merged result, restore the source SVG objects at their
      // original array indices and the captured sceneOrder/selection.
      const svgObjects = state.svgObjects.filter(s => s.id !== op.result.id);
      const svgOrder = op.sourceSVGIndices
        .map((idx, i) => ({ idx, svg: op.sourceSVGs[i] }))
        .sort((a, b) => a.idx - b.idx);
      for (const { idx, svg } of svgOrder) svgObjects.splice(idx, 0, svg);
      const newSelected = new Set(state.selectedFigureIds);
      newSelected.delete(op.result.id);
      for (const s of op.sourceSVGs) newSelected.add(s.id);
      return {
        ...state,
        svgObjects,
        sceneOrder: op.oldSceneOrder.slice(),
        selectedFigureIds: newSelected,
        editingLineId: state.editingLineId === op.result.id ? null : state.editingLineId,
      };
    }
    case 'mergeTile': {
      const addedFigIds = new Set(op.addedFigures.map(f => f.id));
      const addedSVGIds = new Set(op.addedSVGs.map(s => s.id));
      const addedImgIds = new Set(op.addedImages.map(i => i.id));
      const addedGrpIds = new Set(op.addedGroups.map(g => g.id));
      return {
        ...state,
        figures: state.figures.filter(f => !addedFigIds.has(f.id)),
        svgObjects: state.svgObjects.filter(s => !addedSVGIds.has(s.id)),
        images: (state.images ?? []).filter(i => !addedImgIds.has(i.id)),
        groups: state.groups.filter(g => !addedGrpIds.has(g.id)),
        sceneOrder: op.oldSceneOrder.slice(),
        selectedFigureIds: new Set(),
        renderGeneration: state.renderGeneration + 1,
      };
    }
    case 'replaceScene':
      return applyOpInner(state, { op: 'replaceScene',
        oldFigures: op.newFigures, newFigures: op.oldFigures,
        oldSVGObjects: op.newSVGObjects, newSVGObjects: op.oldSVGObjects,
        oldImages: op.newImages, newImages: op.oldImages,
        oldGroups: op.newGroups, newGroups: op.oldGroups,
        oldSceneOrder: op.newSceneOrder, newSceneOrder: op.oldSceneOrder,
        oldTexts: op.newTexts, newTexts: op.oldTexts,
        oldPaints: op.newPaints, newPaints: op.oldPaints,
        oldPatterns: op.newPatterns, newPatterns: op.oldPatterns });
    case 'setText':
      return applyOpInner(state, { ...op,
        oldContent: op.newContent, newContent: op.oldContent,
        oldCellWidth: op.newCellWidth, newCellWidth: op.oldCellWidth,
        oldCellHeight: op.newCellHeight, newCellHeight: op.oldCellHeight,
        oldCellX: op.newCellX, newCellX: op.oldCellX,
        oldCellY: op.newCellY, newCellY: op.oldCellY });
    case 'setTextStyle':
      return applyOpInner(state, { ...op,
        oldStyle: op.newStyle, newStyle: op.oldStyle,
        oldCellWidth: op.newCellWidth, newCellWidth: op.oldCellWidth,
        oldCellHeight: op.newCellHeight, newCellHeight: op.oldCellHeight,
        oldCellX: op.newCellX, newCellX: op.oldCellX,
        oldCellY: op.newCellY, newCellY: op.oldCellY });
    case 'setNodeEffects':
      return applyOpInner(state, { ...op, oldEffects: op.newEffects, newEffects: op.oldEffects });
    case 'setFillPaint':
      return applyOpInner(state, { ...op, oldPaint: op.newPaint, newPaint: op.oldPaint });
    case 'setImageTint':
      return applyOpInner(state, { ...op, oldTint: op.newTint, newTint: op.oldTint });
    case 'setBackground':
      return applyOpInner(state, { ...op, oldPaint: op.newPaint, newPaint: op.oldPaint });
    case 'cleanupLibrary':
      return state;
    default:
      return state;
  }
}

// ── Unconditional local-cache reconciliation ────────────────────────

function applyOp(state: CompositionState, op: CompUndoOp): CompositionState {
  return applyOpInner(state, op);
}

function revertOp(state: CompositionState, op: CompUndoOp): CompositionState {
  return revertOpInner(state, op);
}

/**
 * Give a composition a scene graph, and keep it from then on.
 *
 * Opt-in: a state without one pays nothing, which is what lets the graph
 * land before any reader depends on it. Once present, `applyCompOps` and
 * `revertCompOps` rebuild it after every entry, so it always describes
 * the same scene the per-kind arrays do.
 */
export function withSceneGraph(state: CompositionState): CompositionState {
  return { ...state, graph: fromLegacy(state) };
}

/** Apply a composition undo entry forward (for redo) */
export function applyCompOps(state: CompositionState, entry: CompUndoEntry): CompositionState {
  if (state.graph) return runOnGraph(state, entry, true);
  let result = state;
  for (const op of entry) {
    result = applyOp(result, op);
  }
  return result;
}

/** Revert a composition undo entry (for undo) */
export function revertCompOps(state: CompositionState, entry: CompUndoEntry): CompositionState {
  if (state.graph) return runOnGraph(state, entry, false);
  let result = state;
  // Revert in reverse order
  for (let i = entry.length - 1; i >= 0; i--) {
    result = revertOp(result, entry[i]);
  }
  return result;
}

/**
 * Run an entry with the SCENE GRAPH as the source of truth.
 *
 * The per-kind arrays become what `toLegacyView` renders out of the
 * graph, rather than the place a pose lives. This is the turn the whole
 * refactor is for: a group drag is one transform on one node instead of
 * one op per member plus a reconcile pass, and a grouped leaf has one
 * copy of its pose instead of two that have to be talked into agreeing.
 *
 * Only a composition that asked for a graph takes this path
 * (`withSceneGraph`), so the change lands one caller at a time rather
 * than all at once.
 *
 * Ops the bridge does not translate are content — colour, text, cells,
 * placement — and still run the legacy way over the arrays, after which
 * the graph is rebuilt from them. The view is materialised lazily so a
 * run of pose ops (a drag commits one per selected node) costs one
 * render of the arrays rather than one each.
 */
function runOnGraph(
  state: CompositionState, entry: CompUndoEntry, forward: boolean,
): CompositionState {
  let graph = state.graph!;
  let result = state;
  let viewStale = false;

  const materialize = () => {
    if (!viewStale) return;
    result = { ...result, ...toLegacyView(graph) };
    viewStale = false;
  };

  const order = forward ? entry : [...entry].reverse();
  for (const op of order) {
    const ops = forward
      ? legacyOpToSceneOps(graph, op)
      : invertOnGraph(graph, op);
    if (ops) {
      graph = applySceneOps(graph, ops);
      viewStale = true;
      continue;
    }
    // A content op reads the arrays, so they have to be current first.
    // Reading the result back in is a re-read of the leaves it wrote, not
    // a rebuild: the arrays cannot spell a group's free turn, so rebuilding
    // from them would flatten every twisted group in the scene for an op
    // that touched one leaf.
    materialize();
    result = forward ? applyOpInner(result, op) : revertOpInner(result, op);
    graph = regraphChangedLeaves(graph, result);
  }
  materialize();
  return { ...result, graph };
}
