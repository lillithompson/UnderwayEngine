import { BlendMode, CompositionState, CompositionFigure, CompUndoEntry, CompUndoOp, FigureQuad, GroupNode, PaintStrokeDraft, RGBColor, SVGObject, SVGSubpath, PathSegment, ImageObject, TextObject, CompItemKind } from './types';
import { lineHitsCell as svgHitsCell } from './compositionLineHitTest';
import { arcBoundingBox } from './compositionArcHitTest';
import { GEOMETRY_ADAPTERS } from './sceneNodeGeometry';
import { nextGroupName } from './sceneOutlineHelpers';
import { svgPathHitsPoint, computeHitToleranceCells } from './compositionPathHitTest';
import { buildActiveMaskMap, getAncestorMasks, getGroupMaskChain, pointPassesMasks, clipRectToNodeMasks, getNodeClipMasks } from './compositionMask';
import { arcAllPoints } from './compositionArcMath';
import { colorsEqual } from './colorBlend';
import { SegmentOverrides, remapOverrides } from './tileSegmentOverrides';

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

export type CompItemRef =
  | { kind: 'figure'; item: CompositionFigure }
  | { kind: 'svg';    item: SVGObject }
  | { kind: 'image';  item: ImageObject }
  | { kind: 'text';   item: TextObject };

/**
 * Single canonical lookup across figures, svgObjects, images, and texts.
 * Selection ids share a namespace (svg ids start with `svg_`, image ids
 * with `img_`, text ids with `txt_`, figures use bare timestamps), so
 * any id resolves to exactly one item.
 */
export function findItem(state: CompositionState, id: string): CompItemRef | null {
  const fig = state.figures.find(f => f.id === id);
  if (fig) return { kind: 'figure', item: fig };
  const svg = state.svgObjects.find(s => s.id === id);
  if (svg) return { kind: 'svg', item: svg };
  const img = (state.images ?? []).find(i => i.id === id);
  if (img) return { kind: 'image', item: img };
  const txt = (state.texts ?? []).find(t => t.id === id);
  if (txt) return { kind: 'text', item: txt };
  return null;
}

/** A group's OWN lock flag (does not consider ancestors). */
export function isGroupLocked(state: CompositionState, groupId: string): boolean {
  return !!state.groups.find((g) => g.id === groupId)?.locked;
}

/** True when `groupId` OR any of its ancestor groups is locked. Passing a
 *  leaf's `groupId` answers "is this leaf inside a locked group subtree?";
 *  passing a frame's own id answers "is this frame effectively locked?"
 *  (groupAncestorChain includes the group itself). */
export function isGroupChainLocked(state: CompositionState, groupId: string | undefined): boolean {
  if (!groupId) return false;
  for (const g of groupAncestorChain(state.groups, groupId)) {
    if (g.locked) return true;
  }
  return false;
}

/** A leaf's EFFECTIVE lock: its own `locked` flag OR the lock of any group in
 *  its ancestor chain. Locking a group therefore makes every member act as
 *  locked without mutating the members' own flags — an inherited lock. Every
 *  interaction guard (hit-test, move, edit, delete) reads this so children of
 *  a locked frame are inert while their individual lock settings are
 *  preserved. */
export function isItemLocked(state: CompositionState, id: string): boolean {
  const ref = findItem(state, id);
  if (!ref) return false;
  return (ref.item.locked ?? false) || isGroupChainLocked(state, ref.item.groupId);
}

/** A group's OWN hidden flag (does not consider ancestors). */
export function isGroupHidden(state: CompositionState, groupId: string): boolean {
  return !!state.groups.find((g) => g.id === groupId)?.hidden;
}

/**
 * THE definition of "hidden" for groups: every group id that is hidden, either
 * by its own `hidden` flag or inherited from an ancestor. One O(groups) pass —
 * each chain is walked at most once, since a walk stops at the first
 * already-classified group.
 *
 * Call this ONCE per pass (render, hit-test, export) and test membership in
 * O(1); {@link isGroupChainHidden} wraps it for one-off queries.
 */
export function hiddenGroupIds(groups: readonly GroupNode[]): Set<string> {
  const hidden = new Set<string>();
  const byId = new Map(groups.map((g) => [g.id, g]));
  for (const g of groups) {
    // Walk to the root, remembering the path so every group on it can be
    // marked in one pass.
    const path: GroupNode[] = [];
    const onPath = new Set<string>(); // cycle guard for a malformed parent chain
    let cur: GroupNode | undefined = g;
    let inherited = false;
    while (cur && !onPath.has(cur.id)) {
      if (hidden.has(cur.id)) { inherited = true; break; }
      path.push(cur);
      onPath.add(cur.id);
      if (cur.hidden) { inherited = true; break; }
      cur = cur.parentGroupId ? byId.get(cur.parentGroupId) : undefined;
    }
    if (inherited) for (const p of path) hidden.add(p.id);
  }
  return hidden;
}

/** True when `groupId` OR any of its ancestor groups is hidden. Passing a
 *  leaf's `groupId` answers "is this leaf inside a hidden group subtree?";
 *  passing a frame's own id answers "is this frame effectively hidden?"
 *  Mirror of {@link isGroupChainLocked}. Delegates to {@link hiddenGroupIds}
 *  so there is one implementation of the inheritance rule; prefer that set
 *  directly in any loop over nodes. */
export function isGroupChainHidden(state: CompositionState, groupId: string | undefined): boolean {
  if (!groupId) return false;
  return hiddenGroupIds(state.groups).has(groupId);
}

/** A leaf's EFFECTIVE visibility: its own `hidden` flag OR the hidden flag of
 *  any group in its ancestor chain. Hiding a group therefore makes every
 *  member invisible without mutating the members' own flags — an inherited
 *  hide, exactly like {@link isItemLocked}. Un-hiding the group restores each
 *  member's individual visibility setting. */
export function isItemHidden(state: CompositionState, id: string): boolean {
  const ref = findItem(state, id);
  if (!ref) return false;
  return ((ref.item as { hidden?: boolean }).hidden ?? false)
    || isGroupChainHidden(state, ref.item.groupId);
}

export function getItemGroupId(state: CompositionState, id: string): string | undefined {
  return findItem(state, id)?.item.groupId;
}

export interface GroupHiddenToggle {
  ids: string[];
  newHidden: boolean;
  undoOps: CompUndoEntry;
}

/**
 * Compute the visibility (hidden) toggle for a group/leaf anchor — the single
 * authority behind the Scene Outline's eye toggle.
 *
 * Visibility works exactly like lock (see the `lockGroup` op): it does NOT fan
 * out. A GROUP anchor flips the group's own `hidden` flag, which every member
 * inherits (isItemHidden's ancestor walk) while their individual `hidden`
 * settings stay untouched — so un-hiding the frame restores each child's own
 * visibility rather than revealing everything. A LEAF anchor flips only that
 * leaf, even when it belongs to a group. Null when the anchor resolves to
 * nothing.
 */
export function computeGroupHiddenToggle(
  state: CompositionState,
  anchorId: string,
): GroupHiddenToggle | null {
  const group = state.groups.find((g) => g.id === anchorId);
  if (group) {
    const oldValue = group.hidden ?? false;
    return {
      ids: [anchorId],
      newHidden: !oldValue,
      undoOps: [{ op: 'hideGroup', id: anchorId, oldValue, newValue: !oldValue }],
    };
  }
  const anchor = findItem(state, anchorId);
  if (!anchor) return null;
  const oldValue = (anchor.item as { hidden?: boolean }).hidden ?? false;
  return {
    ids: [anchorId],
    newHidden: !oldValue,
    undoOps: [{ op: 'setObjectHidden', id: anchorId, oldValue, newValue: !oldValue }],
  };
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
  entries: ReadonlyArray<{ segment: PathSegment; color: RGBColor }>,
): { color: RGBColor; segments: PathSegment[]; subpaths?: SVGSubpath[] } {
  if (entries.length === 0) {
    return { color: { r: 0, g: 0, b: 0 }, segments: [], subpaths: undefined };
  }
  const groups: Array<{ color: RGBColor; segments: PathSegment[] }> = [];
  let cur: { color: RGBColor; segments: PathSegment[] } | null = null;
  for (const { segment, color } of entries) {
    if (cur && cur.color.r === color.r && cur.color.g === color.g && cur.color.b === color.b) {
      cur.segments.push(segment);
    } else {
      cur = { color, segments: [segment] };
      groups.push(cur);
    }
  }
  const primary = groups[0];
  if (groups.length === 1) {
    return { color: primary.color, segments: primary.segments, subpaths: undefined };
  }
  return {
    color: primary.color,
    segments: entries.map(e => e.segment),
    subpaths: groups.map(g => ({ color: g.color, segments: g.segments })),
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
export function buildPaintStrokeOps(state: CompositionState, draft: PaintStrokeDraft): CompUndoOp[] {
  const ops: CompUndoOp[] = [];

  for (const [svgId, painted] of draft.paintedSegments) {
    const snap = draft.svgSnapshots.get(svgId);
    if (!snap) continue;
    const svg = state.svgObjects.find(s => s.id === svgId);
    if (!svg) continue;
    if (svg.locked) continue;

    const flat = flattenSVGSegmentsWithColor({
      ...svg,
      color: snap.color,
      segments: snap.segments,
      subpaths: snap.subpaths,
    });

    // Substitute painted colors at their stable flat indices.
    const entries = flat.map(({ segment, color }, idx) => {
      const painedColor = painted.get(idx);
      return { segment, color: painedColor ?? color };
    });

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
      // list. Follow the same "subpaths win when present" invariant
      // `flattenSVGSegmentsWithColor` and `brushHitsSegments` use â€”
      // walk localSubpaths-only when present, localSegments otherwise.
      // Iterating BOTH would double-count under the regroup invariant
      // (segments and subpaths describe the same geometry), causing
      // localSegments / localSubpaths to double on every paint stroke
      // until u16 counts overflow on save and corrupt the file.
      const localFlatEntries: Array<{ segment: PathSegment; color: RGBColor }> = [];
      const localSubpathsHas = Array.isArray(snap.localSubpaths) && snap.localSubpaths.length > 0;
      if (localSubpathsHas) {
        for (const sub of snap.localSubpaths!) {
          for (const seg of sub.segments) localFlatEntries.push({ segment: seg, color: sub.color });
        }
      } else {
        for (const seg of snap.localSegments) localFlatEntries.push({ segment: seg, color: snap.color });
      }
      // Substitute painted colors at the SAME flat indices used for the
      // world regroup so the two outputs are structurally parallel
      // (same group count, same per-group lengths, same color order).
      const localEntries = localFlatEntries.map(({ segment, color }, idx) => ({
        segment,
        color: painted.get(idx) ?? color,
      }));
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
  }
  return true;
}


// â”€â”€ Scene object adapter registry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Every scene-object kind (figure, svg, image, text) registers an adapter
// here so that ordering / locking / deleting / undo loop uniformly over
// all kinds. Adding a new kind = adding one entry here plus the field on
// CompositionState.

export interface SceneObjectBase { id: string; locked?: boolean; hidden?: boolean; groupId?: string; name?: string; }

export interface SceneObjectAdapter<T extends SceneObjectBase = SceneObjectBase> {
  kind: CompItemKind;
  matchesId(id: string): boolean;
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

export function offsetPathSegment(seg: PathSegment, dx: number, dy: number): PathSegment {
  return seg.kind === 'arc'
    ? { kind: 'arc', start: [seg.start[0] + dx, seg.start[1] + dy], end: [seg.end[0] + dx, seg.end[1] + dy], center: [seg.center[0] + dx, seg.center[1] + dy] }
    : { kind: 'line', start: [seg.start[0] + dx, seg.start[1] + dy], end: [seg.end[0] + dx, seg.end[1] + dy] };
}

export const SCENE_ADAPTERS: SceneObjectAdapter[] = [
  {
    kind: 'figure',
    matchesId: (id) => !id.startsWith('svg_') && !id.startsWith('img_') && !id.startsWith('txt_'),
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
        name: fig.name ? fig.name + ' copy' : undefined,
        groupId: newGroupId,
        locked: false,
        quads: fig.quads ? fig.quads.map((q) => ({ ...q })) : fig.quads,
      } as SceneObjectBase;
    },
  },
  {
    kind: 'svg',
    matchesId: (id) => id.startsWith('svg_'),
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
      // Tiled SVGs: preserve the region bbox (offset by dx/dy).
      const bbox = svg.tileMode === 'repeat'
        ? { cellX: svg.cellX + dx, cellY: svg.cellY + dy, cellWidth: svg.cellWidth, cellHeight: svg.cellHeight }
        : computeSVGBbox(segs);
      // When duplicating into a different group the original creationBox
      // is in the source group's local space and cannot be offset into the
      // new group's space with a simple translate â€” attempting to do so
      // leaves the selection box rotated/mirrored relative to the actual
      // segments after the new group is transformed then ungrouped.  Drop
      // it so that selectedNodeBBox falls back to the segment AABB, which
      // is always correct.  Keep it only when staying in the same group
      // (same coordinate space).
      const keepCreationBox = newGroupId === svg.groupId;
      return {
        ...svg,
        id: newId,
        segments: segs,
        localSegments: localSegs,
        subpaths: safeMapSubpaths(svg.subpaths, offset),
        creationBox: keepCreationBox && svg.creationBox
          ? { minX: svg.creationBox.minX + dx, minY: svg.creationBox.minY + dy, width: svg.creationBox.width, height: svg.creationBox.height }
          : undefined,
        name: svg.name ? svg.name + ' copy' : undefined,
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
    matchesId: (id) => id.startsWith('img_'),
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
        localCellX: img.localCellX !== undefined ? img.localCellX + dx : undefined,
        localCellY: img.localCellY !== undefined ? img.localCellY + dy : undefined,
        identityCellX: img.identityCellX !== undefined ? img.identityCellX + dx : undefined,
        identityCellY: img.identityCellY !== undefined ? img.identityCellY + dy : undefined,
        name: img.name ? img.name + ' copy' : undefined,
        groupId: newGroupId,
        locked: false,
      } as SceneObjectBase;
    },
  },
  {
    kind: 'text',
    matchesId: (id) => id.startsWith('txt_'),
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
        localCellX: txt.localCellX !== undefined ? txt.localCellX + dx : undefined,
        localCellY: txt.localCellY !== undefined ? txt.localCellY + dy : undefined,
        identityCellX: txt.identityCellX !== undefined ? txt.identityCellX + dx : undefined,
        identityCellY: txt.identityCellY !== undefined ? txt.identityCellY + dy : undefined,
        name: txt.name ? txt.name + ' copy' : undefined,
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
export function buildDuplicateOps(
  state: CompositionState,
  selectedIds: Iterable<string>,
  options?: BuildDuplicateOpsOptions,
): BuildDuplicateOpsResult {
  const ops: CompUndoEntry = [];
  const newIds: string[] = [];
  // original groupId â†’ new groupId. Multiple selected members of the
  // same source group land in one new group rather than each spawning
  // its own.
  const groupIdMap = new Map<string, string>();
  // Per-new-group: ordered duplicated member ids (first is the leader
  // that carries the group display name) and their original .name values.
  const newGroupMembers = new Map<string, string[]>();
  const newGroupOldNames = new Map<string, (string | undefined)[]>();
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
        newGroupOldNames.set(newGroupId, []);
      }
    }
    const newItemId = options?.mintItemId
      ? options.mintItemId(ref.kind, ref.item.id)
      : adapter.mintId();
    const dup = adapter.cloneWithOffset(ref.item, dupOffset, dupOffset, newItemId, newGroupId);
    ops.push({
      op: 'placeObject',
      kind: ref.kind,
      item: adapter.cloneItem(dup) as CompositionFigure | SVGObject | ImageObject | TextObject,
    });
    newIds.push(dup.id);
    if (newGroupId) {
      newGroupMembers.get(newGroupId)!.push(dup.id);
      newGroupOldNames.get(newGroupId)!.push(dup.name);
    }
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
      newGroupOldNames.set(newAncestorId, []);
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
        oldNames: newGroupOldNames.get(newGroupId)!,
        ...(children.length > 0 ? { childGroupIds: children } : null),
        // Preserve Figma-style frame-ness so a duplicated frame stays a frame
        // (clips + fixed export region), not a plain group.
        ...(origGroup?.isFrame ? { isFrame: true as const } : null),
      });
      emitted.add(newGroupId);
      progress = true;
    }
    if (!progress) break; // cycle guard
  }

  return { ops, newIds, groupIdMap };
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
): { op: 'removeObject'; kind: CompItemKind; item: CompositionFigure | SVGObject | ImageObject | TextObject;
     sceneOrderIndex?: number } | null {
  for (const adapter of SCENE_ADAPTERS) {
    const item = adapter.getArray(state).find((x) => x.id === id);
    if (item) {
      const sceneOrderIndex = state.sceneOrder.indexOf(id);
      return {
        op: 'removeObject',
        kind: adapter.kind,
        item: adapter.cloneItem(item) as CompositionFigure | SVGObject | ImageObject | TextObject,
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

/** Clear group-local coordinate fields from a scene object in-place.
 *  Mirrors the per-kind field clearing in the `ungroupFigures` apply path.
 *  Does NOT clear `creationBox` for SVGs â€” callers that need the
 *  `ungroupCreationBox` snap should handle that separately. */
export function clearGroupLocals(item: any, kind: CompItemKind): void {
  item.groupId = undefined;
  // Restore the original name that was saved before grouping.
  if (item.preGroupName !== undefined) {
    item.name = item.preGroupName;
  }
  item.preGroupName = undefined;
  item.localCellX = undefined;
  item.localCellY = undefined;
  item.localCellWidth = undefined;
  item.localCellHeight = undefined;
  if (kind === 'figure') {
    item.localTileWidthL0 = undefined;
    item.localTileHeightL0 = undefined;
    item.localRotation = undefined;
    item.localMirrorH = undefined;
    item.localMirrorV = undefined;
    item.localQuads = undefined;
    item.identityCellX = undefined;
    item.identityCellY = undefined;
    item.transformCycleStep = undefined;
  } else if (kind === 'svg') {
    item.localSegments = undefined;
    item.identitySegments = undefined;
    item.rotation = undefined;
    item.mirrorH = undefined;
    item.mirrorV = undefined;
  } else if (kind === 'image' || kind === 'text') {
    item.identityCellX = undefined;
    item.identityCellY = undefined;
    item.identityCellWidth = undefined;
    item.identityCellHeight = undefined;
    item.rotation = undefined;
    item.mirrorH = undefined;
    item.mirrorV = undefined;
  }
}

// â”€â”€ Scene order (unified backâ†’front paint order) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// `state.sceneOrder` is the single source of truth for paint and hit-test
// across every scene-object kind. The three kind arrays still hold the
// items, but their internal order does not affect what you see â€” that's
// driven entirely by sceneOrder.

/** Build a sceneOrder list from the kind arrays in their legacy fixed
 *  paint order: images (back) â†’ figures â†’ svgObjects â†’ texts (front).
 *  Used to initialize sceneOrder for new state and to migrate older
 *  saves that predate the field. */
export function deriveSceneOrderFromKindArrays(state: {
  figures: readonly { id: string; groupId?: string }[];
  svgObjects: readonly { id: string; groupId?: string }[];
  images?: readonly { id: string; groupId?: string }[];
  texts?: readonly { id: string; groupId?: string }[];
}): string[] {
  const order: string[] = [];
  for (const i of state.images ?? []) order.push(i.id);
  for (const f of state.figures) order.push(f.id);
  for (const s of state.svgObjects) order.push(s.id);
  for (const t of state.texts ?? []) order.push(t.id);
  return enforceGroupContiguity(order, gatherGroupMemberIds(state));
}

/** Heal a sceneOrder that may be partially out of sync with the kind
 *  arrays: append any kind-array id that is missing, then re-flow so any
 *  group's members stay contiguous. Used at load time to repair files
 *  saved with bugged ops that mutated kind arrays without updating
 *  sceneOrder (e.g. joinLines/joinItems prior to the sceneOrder fix). */
export function repairSceneOrder(state: {
  figures: readonly { id: string; groupId?: string }[];
  svgObjects: readonly { id: string; groupId?: string }[];
  images?: readonly { id: string; groupId?: string }[];
  texts?: readonly { id: string; groupId?: string }[];
  sceneOrder: readonly string[];
}): string[] {
  const present = new Set(state.sceneOrder);
  const repaired = state.sceneOrder.slice();
  const append = (items: readonly { id: string }[] | undefined) => {
    if (!items) return;
    for (const x of items) if (!present.has(x.id)) { repaired.push(x.id); present.add(x.id); }
  };
  append(state.images);
  append(state.figures);
  append(state.svgObjects);
  append(state.texts);
  return enforceGroupContiguity(repaired, gatherGroupMemberIds(state));
}

/** Build a Map<rootGroupId, member-ids[]> from scene-object kind arrays.
 *  Members are mapped to their ROOT group so all descendants of a nested
 *  hierarchy cluster together in sceneOrder. */
function gatherGroupMemberIds(state: {
  figures: readonly { id: string; groupId?: string }[];
  svgObjects: readonly { id: string; groupId?: string }[];
  images?: readonly { id: string; groupId?: string }[];
  texts?: readonly { id: string; groupId?: string }[];
  groups?: readonly GroupNode[];
}): Map<string, string[]> {
  // Pre-compute root for each group.
  const groupNodes: readonly GroupNode[] = (state as { groups?: readonly GroupNode[] }).groups ?? [];
  const rootOf = new Map<string, string>();
  for (const g of groupNodes) {
    rootOf.set(g.id, findRootGroupId(groupNodes, g.id));
  }
  const result = new Map<string, string[]>();
  const collect = (items: readonly { id: string; groupId?: string }[]) => {
    for (const x of items) {
      if (!x.groupId) continue;
      const rootGid = rootOf.get(x.groupId) ?? x.groupId;
      const list = result.get(rootGid) ?? [];
      list.push(x.id);
      result.set(rootGid, list);
    }
  };
  collect(state.figures);
  collect(state.svgObjects);
  if (state.images) collect(state.images);
  if (state.texts) collect(state.texts);
  return result;
}

/** Re-flow `order` so every group's members are contiguous. Members keep
 *  their relative order within the group. The group as a whole lands at
 *  the position of its earliest member in the input order. */
function enforceGroupContiguity(order: string[], groupMembers: Map<string, string[]>): string[] {
  if (groupMembers.size === 0) return order.slice();
  // For each group, mark every member-id with the index of its earliest
  // appearance in `order`. We then sort by (anchorIndex, originalIndex) so
  // members of the same group cluster around the earliest position while
  // non-grouped items keep their relative order to each other.
  const idToGroup = new Map<string, string>();
  for (const [gid, ids] of groupMembers) for (const id of ids) idToGroup.set(id, gid);
  const groupAnchor = new Map<string, number>();
  for (let i = 0; i < order.length; i++) {
    const gid = idToGroup.get(order[i]);
    if (gid === undefined) continue;
    if (!groupAnchor.has(gid)) groupAnchor.set(gid, i);
  }
  // Stable sort: anchorIndex (or own index for ungrouped), then own index.
  const decorated = order.map((id, i) => {
    const gid = idToGroup.get(id);
    const anchor = gid !== undefined ? groupAnchor.get(gid)! : i;
    return { id, gid, anchor, i };
  });
  decorated.sort((a, b) => {
    if (a.anchor !== b.anchor) return a.anchor - b.anchor;
    // Same anchor â†’ either same group (keep input order) or one item is
    // the group's anchor and the other a stray with the same index (can't
    // happen since indices are unique).
    return a.i - b.i;
  });
  return decorated.map((d) => d.id);
}

/** Iterate scene objects in paint order (backâ†’front). Returns null entries
 *  for any sceneOrder id that no longer resolves â€” caller can filter. */
export function iterateSceneOrder(state: CompositionState): CompItemRef[] {
  const byId = new Map<string, CompItemRef>();
  for (const f of state.figures) byId.set(f.id, { kind: 'figure', item: f });
  for (const s of state.svgObjects) byId.set(s.id, { kind: 'svg', item: s });
  for (const i of state.images ?? []) byId.set(i.id, { kind: 'image', item: i });
  for (const t of state.texts ?? []) byId.set(t.id, { kind: 'text', item: t });
  const out: CompItemRef[] = [];
  for (const id of state.sceneOrder) {
    const ref = byId.get(id);
    if (ref) out.push(ref);
  }
  return out;
}

/** Dev-only invariant: every scene object has exactly one entry in
 *  sceneOrder, sceneOrder has no orphans, and group members are contiguous.
 *  Throws on violation. Cheap enough to run in test paths. */
export function assertSceneOrderInvariant(state: CompositionState): void {
  const live = new Set<string>();
  for (const f of state.figures) live.add(f.id);
  for (const s of state.svgObjects) live.add(s.id);
  for (const i of state.images ?? []) live.add(i.id);
  for (const t of state.texts ?? []) live.add(t.id);
  const seen = new Set<string>();
  for (const id of state.sceneOrder) {
    if (!live.has(id)) throw new Error(`sceneOrder contains orphan id: ${id}`);
    if (seen.has(id)) throw new Error(`sceneOrder has duplicate id: ${id}`);
    seen.add(id);
  }
  for (const id of live) {
    if (!seen.has(id)) throw new Error(`scene object missing from sceneOrder: ${id}`);
  }
  // Group contiguity: walk sceneOrder and ensure each groupId run is
  // unbroken (no two non-adjacent runs of the same groupId).
  const seenGroups = new Set<string>();
  let prevGroup: string | undefined;
  for (const id of state.sceneOrder) {
    const ref = findItem(state, id);
    const gid = ref?.item.groupId;
    if (gid !== prevGroup) {
      if (gid !== undefined) {
        if (seenGroups.has(gid)) throw new Error(`group ${gid} is not contiguous in sceneOrder`);
        seenGroups.add(gid);
      }
      prevGroup = gid;
    }
  }
}

/** Parent group of an OUTLINE node: a group's own `parentGroupId`, or a
 *  leaf's `groupId`. Undefined for a top-level node (or an unknown id). */
function parentGroupOfNode(state: CompositionState, id: string): string | undefined {
  const g = (state.groups ?? []).find((x) => x.id === id);
  if (g) return g.parentGroupId;
  return getItemGroupId(state, id);
}

/** True when `id` names a GroupNode rather than a leaf scene object. */
function isGroupId(state: CompositionState, id: string): boolean {
  return (state.groups ?? []).some((g) => g.id === id);
}

/**
 * Reorder selected scene objects to the back or front, moving whole subtrees
 * so groups stay contiguous in `sceneOrder`. Bumps renderGeneration. `ids` may
 * name leaves OR groups (a scene-outline group / frame row).
 *
 * `scope` picks what "back" and "front" mean:
 *
 * - `'scene'` (default, the canvas selection's meaning): the extremes of the
 *   whole scene. Each id resolves to its ROOT group, so a nested hierarchy
 *   travels as one block.
 * - `'siblings'` (the scene outline's meaning): the extremes of the id's own
 *   parent container. Send-to-back on a node inside a frame drops it to the
 *   bottom of that frame instead of hauling the entire frame to the back of
 *   the page. The scope is the nearest common ancestor group of every id
 *   (undefined = top level, which is the scene and so behaves like `'scene'`),
 *   and each id travels as the ancestor-or-self that is a direct child of that
 *   scope — a node never leaves its parent.
 *
 * Sending to back within a group keeps the group's active mask pinned
 * back-most: for a frame that mask is its boundary rect, which carries the
 * frame's background fill, so a node dropped behind it would vanish under the
 * background. Pinning also keeps mask resolution (back-most `isMask` wins)
 * from silently switching masks.
 */
export function reorderSceneObjects(
  state: CompositionState,
  ids: ReadonlySet<string>,
  position: 'back' | 'front',
  scope: 'scene' | 'siblings' = 'scene',
): CompositionState {
  if (ids.size === 0) return state;

  // Container the move happens inside: undefined = the scene itself.
  let scopeGroupId: string | undefined;
  if (scope === 'siblings') {
    // Longest common root→…→parent prefix over every id's ancestor chain.
    let common: string[] | null = null;
    for (const id of ids) {
      const parent = parentGroupOfNode(state, id);
      const chain = parent
        ? groupAncestorChain(state.groups ?? [], parent).map((g) => g.id).reverse()
        : [];
      if (common === null) { common = chain; continue; }
      let i = 0;
      while (i < common.length && i < chain.length && common[i] === chain[i]) i++;
      common = common.slice(0, i);
    }
    scopeGroupId = common && common.length > 0 ? common[common.length - 1] : undefined;
  }

  // Each id travels as the whole subtree of its ancestor-or-self that sits
  // directly inside the scope (for scene scope that's its ROOT group, which
  // is what keeps a nested hierarchy contiguous when one branch is picked).
  const moved = new Set<string>();
  for (const id of ids) {
    let node = id;
    for (let hops = 0; hops < 100; hops++) {
      const parent = parentGroupOfNode(state, node);
      if (parent === scopeGroupId || parent === undefined) break;
      node = parent;
    }
    if (isGroupId(state, node)) for (const m of allDescendantMemberIds(state, node)) moved.add(m);
    else moved.add(node);
  }
  if (moved.size === 0) return state;

  // Slots this move may rewrite: the scope's leaves (all of sceneOrder at
  // scene scope). Everything outside keeps its exact index.
  const scopeLeaves = scopeGroupId ? new Set(allDescendantMemberIds(state, scopeGroupId)) : null;
  const slots: number[] = [];
  const seq: string[] = [];
  state.sceneOrder.forEach((id, i) => {
    if (scopeLeaves && !scopeLeaves.has(id)) return;
    slots.push(i);
    seq.push(id);
  });

  const movedSeq = seq.filter((id) => moved.has(id));
  if (movedSeq.length === 0) return state;
  const rest = seq.filter((id) => !moved.has(id));

  let pinnedId: string | undefined;
  if (position === 'back' && scopeGroupId) {
    const mask = buildActiveMaskMap(state).get(scopeGroupId);
    if (mask && !moved.has(mask.id)) pinnedId = mask.id;
  }

  const reordered = position === 'back'
    ? [...rest.filter((id) => id === pinnedId), ...movedSeq, ...rest.filter((id) => id !== pinnedId)]
    : [...rest, ...movedSeq];

  const next = state.sceneOrder.slice();
  let changed = false;
  slots.forEach((slot, i) => {
    if (next[slot] !== reordered[i]) changed = true;
    next[slot] = reordered[i];
  });
  if (!changed) return state;
  return { ...state, sceneOrder: next, renderGeneration: state.renderGeneration + 1 };
}

/** Append a freshly-created scene object's id to sceneOrder (front of paint).
 *  No-op if the id is already present. */
export function appendToSceneOrder(state: CompositionState, id: string): CompositionState {
  if (state.sceneOrder.includes(id)) return state;
  return { ...state, sceneOrder: [...state.sceneOrder, id] };
}

/** Splice an id into sceneOrder at the given index (clamped to
 *  [0, sceneOrder.length]). Used by undo-of-delete to restore the
 *  original z-position rather than dropping the item at the back.
 *  No-op if the id is already present. */
export function insertIntoSceneOrder(state: CompositionState, id: string, index: number): CompositionState {
  if (state.sceneOrder.includes(id)) return state;
  const clamped = Math.max(0, Math.min(index, state.sceneOrder.length));
  const next = state.sceneOrder.slice();
  next.splice(clamped, 0, id);
  return { ...state, sceneOrder: next };
}

/** Strip a deleted scene object's id from sceneOrder. */
export function removeFromSceneOrder(state: CompositionState, id: string): CompositionState {
  if (!state.sceneOrder.includes(id)) return state;
  return { ...state, sceneOrder: state.sceneOrder.filter((x) => x !== id) };
}

/** Strip multiple ids in one pass. */
export function removeManyFromSceneOrder(state: CompositionState, ids: ReadonlySet<string>): CompositionState {
  if (ids.size === 0) return state;
  const filtered = state.sceneOrder.filter((x) => !ids.has(x));
  if (filtered.length === state.sceneOrder.length) return state;
  return { ...state, sceneOrder: filtered };
}

/** Collapse a set of source ids in `order` down to a single `resultId` at
 *  the position of the earliest source. Used by join ops. If no source id
 *  is present, append the result at the end (front of paint). */
export function mergeIdsIntoSceneOrder(
  order: readonly string[],
  sourceIds: ReadonlySet<string>,
  resultId: string,
): string[] {
  let anchor = -1;
  for (let i = 0; i < order.length; i++) {
    if (sourceIds.has(order[i])) { anchor = i; break; }
  }
  const filtered = order.filter((id) => !sourceIds.has(id));
  if (anchor < 0) return [...filtered, resultId];
  // `anchor` is the source's position in the original order; after
  // filtering, every preceding non-source id keeps its position, so the
  // anchor index still names the right insertion point.
  return [...filtered.slice(0, anchor), resultId, ...filtered.slice(anchor)];
}

/** After mutating member groupId fields (group / ungroup), re-flow sceneOrder
 *  so every group's members stay contiguous. Cheap: O(n log n) sort over ids. */
export function reflowSceneOrderForGroups(state: CompositionState): CompositionState {
  const reflowed = enforceGroupContiguity(state.sceneOrder, gatherGroupMemberIds(state));
  // Bail if the order didn't change (avoids extra renders on no-op group ops).
  let same = reflowed.length === state.sceneOrder.length;
  if (same) {
    for (let i = 0; i < reflowed.length; i++) {
      if (reflowed[i] !== state.sceneOrder[i]) { same = false; break; }
    }
  }
  if (same) return state;
  return { ...state, sceneOrder: reflowed };
}

/** Snapshot sceneOrder for undo. */
export function captureSceneOrder(state: CompositionState): string[] {
  return state.sceneOrder.slice();
}

/** Restore a previously captured sceneOrder. Bumps renderGeneration. */
export function applySceneOrder(state: CompositionState, order: string[]): CompositionState {
  return { ...state, sceneOrder: order.slice(), renderGeneration: state.renderGeneration + 1 };
}

/** World bbox of an SVGObject, derived from its segments. Computes the
 *  AABB of all segment endpoints (and arc centers). */
export function computeSVGBbox(
  segments: ReadonlyArray<PathSegment>,
): { cellX: number; cellY: number; cellWidth: number; cellHeight: number } {
  const bb = arcBoundingBox(segments);
  if (!bb) return { cellX: 0, cellY: 0, cellWidth: 0, cellHeight: 0 };
  return { cellX: bb.minX, cellY: bb.minY, cellWidth: bb.maxX - bb.minX, cellHeight: bb.maxY - bb.minY };
}

/** Rescale segments to fit within newBbox. Each segment point is mapped
 *  proportionally: `new = newMin + (old - oldMin) * (newSize / oldSize)`.
 *  Degenerate axes (oldSize === 0) translate by the bbox shift instead of
 *  scaling. Pure float math; the bbox is the source of truth. */
export function rescaleSVGToBbox(
  segments: ReadonlyArray<PathSegment>,
  oldBbox: { cellX: number; cellY: number; cellWidth: number; cellHeight: number },
  newBbox: { cellX: number; cellY: number; cellWidth: number; cellHeight: number },
): PathSegment[] {
  const sx = oldBbox.cellWidth  > 0 ? newBbox.cellWidth  / oldBbox.cellWidth  : 1;
  const sy = oldBbox.cellHeight > 0 ? newBbox.cellHeight / oldBbox.cellHeight : 1;
  const mapPt = (pt: [number, number]): [number, number] => [
    newBbox.cellX + (pt[0] - oldBbox.cellX) * sx,
    newBbox.cellY + (pt[1] - oldBbox.cellY) * sy,
  ];
  return segments.map(seg => seg.kind === 'arc'
    ? { kind: 'arc', start: mapPt(seg.start), end: mapPt(seg.end), center: mapPt(seg.center) }
    : { kind: 'line', start: mapPt(seg.start), end: mapPt(seg.end) }
  );
}

/** Local-bbox accessor variant â€” returns the same data under the
 *  `localCell*` key names so it can be spread into a reducer update
 *  alongside `localSegments`. */
function localBboxFromSegments(
  segments: ReadonlyArray<PathSegment>,
): { localCellX: number; localCellY: number; localCellWidth: number; localCellHeight: number } {
  const bb = computeSVGBbox(segments);
  return { localCellX: bb.cellX, localCellY: bb.cellY, localCellWidth: bb.cellWidth, localCellHeight: bb.cellHeight };
}

/** Shift one node (figure, svg, or image) by `(dx, dy)` and clear its
 *  identity / rotation / mirror state. Used by the unified `moveNode`
 *  apply / revert. Delegates to the geometry adapter for per-kind logic. */
export function translateNodeByDelta(
  state: CompositionState, nodeId: string, dx: number, dy: number,
): CompositionState {
  if (dx === 0 && dy === 0) return state;
  // Find which array contains the node and use the matching adapter.
  for (const sceneAdapter of SCENE_ADAPTERS) {
    const arr = sceneAdapter.getArray(state);
    if (!arr.some((x: any) => x.id === nodeId)) continue;
    const geoAdapter = GEOMETRY_ADAPTERS[sceneAdapter.kind];
    const updated = arr.map((item: any) => item.id === nodeId ? geoAdapter.translate(item, dx, dy) : item);
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
 *  svgs get `identitySegments` + `rotation` + `mirror*`; images and texts
 *  get `identityCell*` bbox + `rotation` + `mirror*`. Called immediately
 *  after the inverse-translate in `revertOp`'s `moveNode` case. */
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
  const img = (state.images ?? []).find(i => i.id === nodeId);
  if (img) {
    const images = (state.images ?? []).map((i) => i.id === nodeId ? {
      ...i,
      identityCellX: op.oldIdentityCellX,
      identityCellY: op.oldIdentityCellY,
      identityCellWidth: op.oldIdentityCellWidth,
      identityCellHeight: op.oldIdentityCellHeight,
      rotation: op.oldRotation,
      mirrorH: op.oldMirrorH,
      mirrorV: op.oldMirrorV,
    } : i);
    return { ...state, images };
  }
  const txt = (state.texts ?? []).find(t => t.id === nodeId);
  if (txt) {
    const texts = (state.texts ?? []).map((t) => t.id === nodeId ? {
      ...t,
      identityCellX: op.oldIdentityCellX,
      identityCellY: op.oldIdentityCellY,
      identityCellWidth: op.oldIdentityCellWidth,
      identityCellHeight: op.oldIdentityCellHeight,
      rotation: op.oldRotation,
      mirrorH: op.oldMirrorH,
      mirrorV: op.oldMirrorV,
    } : t);
    return { ...state, texts };
  }
  return state;
}


/**
 * Deep-clone a path segment, preserving its `kind` discriminator. Used at
 * grouping boundaries where world segments are snapshotted into
 * `localSegments`.
 */
export function clonePathSegment(seg: PathSegment): PathSegment {
  if (seg.kind === 'arc') {
    return {
      kind: 'arc',
      start: [seg.start[0], seg.start[1]],
      end: [seg.end[0], seg.end[1]],
      center: [seg.center[0], seg.center[1]],
    };
  }
  return {
    kind: 'line',
    start: [seg.start[0], seg.start[1]],
    end: [seg.end[0], seg.end[1]],
  };
}

/** Map a PathSegment array, tolerating undefined and (defensively) any
 *  non-array shape that a corrupt save or partial deserialize might
 *  surface here. Real arrays go through `.map(fn)` exactly as before;
 *  any other defined-but-non-array value coerces to `[]` and emits a
 *  one-shot warn so we have a breadcrumb the next time it surfaces.
 *  Returns undefined when input is undefined so optional fields
 *  (`localSegments`, `identitySegments`) stay optional. */
export function safeMapSegments(
  segs: ReadonlyArray<PathSegment> | undefined,
  fn: (seg: PathSegment) => PathSegment,
): PathSegment[] | undefined {
  if (segs === undefined) return undefined;
  if (!Array.isArray(segs)) {
    if (typeof console !== 'undefined') console.warn('[compositionOps] expected PathSegment[], got', segs);
    return [];
  }
  return segs.map(fn);
}

/** Map an SVGSubpath array, applying `fn` to each subpath's segments via
 *  `safeMapSegments`. Same defensive contract: undefined in â†’ undefined
 *  out; non-array in â†’ undefined out (the SVG had a bad subpaths shape;
 *  drop it rather than synthesize one). */
export function safeMapSubpaths(
  subs: SVGSubpath[] | undefined,
  fn: (seg: PathSegment) => PathSegment,
): SVGSubpath[] | undefined {
  if (subs === undefined) return undefined;
  if (!Array.isArray(subs)) {
    if (typeof console !== 'undefined') console.warn('[compositionOps] expected SVGSubpath[], got', subs);
    return undefined;
  }
  return subs.map(sub => ({ ...sub, segments: safeMapSegments(sub.segments, fn) ?? [] }));
}

// â”€â”€ Group membership helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Find the groupId for a node (figure, svg, or image) by its ID.
 * Returns undefined if the node is ungrouped or not found.
 */
export function findGroupId(state: CompositionState, nodeId: string): string | undefined {
  return getItemGroupId(state, nodeId);
}

/**
 * Split a set of moved ids into the groups they touch and the loose
 * (ungrouped) ids. Used by MOVE_FIGURES_DELTA and its commit phase to
 * route grouped ids through the group's translate (so mirror/rotation
 * baked into the GroupNode is honored) and ungrouped ids through a
 * direct world-coord shift. Without this split, shifting a grouped
 * member's local fields by (dx, dy) silently desyncs from world when
 * the group has a non-identity transform.
 */
export function bucketMovedIds(
  state: CompositionState, ids: Iterable<string>,
): { groupIds: Set<string>; ungrouped: string[] } {
  const groupIds = new Set<string>();
  const ungrouped: string[] = [];
  for (const id of ids) {
    const gid = getItemGroupId(state, id);
    if (gid) groupIds.add(gid);
    else ungrouped.push(id);
  }
  return { groupIds, ungrouped };
}

/**
 * Find the topmost SVG stroke at `(cellX, cellY)`, walking `sceneOrder`
 * front-to-back. Skips locked nodes. Figures and images are excluded â€”
 * they live in their own passes in the canvas pointer-down chain.
 */
export function findStrokeAtCell(
  state: CompositionState, cellX: number, cellY: number,
): { kind: 'svg'; id: string } | null {
  const maskMap = buildActiveMaskMap(state);
  const svgMap = new Map<string, SVGObject>();
  for (const s of state.svgObjects) svgMap.set(s.id, s);
  for (let i = state.sceneOrder.length - 1; i >= 0; i--) {
    const id = state.sceneOrder[i];
    const svg = svgMap.get(id);
    if (svg) {
      if (svgHitsCell(svg, cellX, cellY)) {
        if (maskMap.size > 0
          && !pointPassesMasks(getAncestorMasks(maskMap, state.groups, svg.groupId), id, cellX, cellY)) {
          continue; // clipped away â€” fall through to objects behind
        }
        return { kind: 'svg', id: svg.id };
      }
      continue;
    }
  }
  return null;
}

/** Bounding rectangle (in L0 cells) of every figure, svg, image, and text
 *  belonging to `groupId` (and its descendant groups when `groups` is provided).
 *  Returns Infinities if the group is empty.
 *
 *  When a non-empty `maskMap` is provided, each member's world rect is clipped
 *  to its ancestor-mask chain (via `clipRectToNodeMasks`) before being unioned,
 *  so members hidden by a mask on a nested group don't pad the bounds. The
 *  unclipped union is kept as a fallback for the degenerate case where every
 *  member is clipped away (e.g. a hidden mask leaves no visible content), so
 *  this never returns a fully-collapsed box when members exist. With no
 *  `maskMap` (or an empty one) this reduces to the plain member union â€” the
 *  behaviour the hit-test callers rely on. */
export function groupBounds(
  figures: readonly CompositionFigure[],
  groupId: string,
  svgObjects?: readonly SVGObject[],
  _arcsLegacy?: unknown,
  images?: readonly ImageObject[],
  groups?: readonly GroupNode[],
  maskMap?: ReadonlyMap<string, SVGObject>,
  texts?: readonly TextObject[],
): { minX: number; minY: number; maxX: number; maxY: number } {
  // Build the set of group IDs to include (self + descendants).
  const groupSet = groups
    ? new Set([groupId, ...descendantGroupIds(groups, groupId)])
    : new Set([groupId]);
  const clip = !!maskMap && maskMap.size > 0 && !!groups;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  // Unclipped union fallback for the all-clipped degenerate case.
  let uMinX = Infinity, uMinY = Infinity, uMaxX = -Infinity, uMaxY = -Infinity;

  const accept = (
    node: { id: string; groupId?: string },
    rMinX: number, rMinY: number, rMaxX: number, rMaxY: number,
  ) => {
    if (rMinX < uMinX) uMinX = rMinX;
    if (rMinY < uMinY) uMinY = rMinY;
    if (rMaxX > uMaxX) uMaxX = rMaxX;
    if (rMaxY > uMaxY) uMaxY = rMaxY;
    if (clip) {
      const r = clipRectToNodeMasks(maskMap!, groups!, node, rMinX, rMinY, rMaxX, rMaxY);
      if (!r) return;
      rMinX = r.minX; rMinY = r.minY; rMaxX = r.maxX; rMaxY = r.maxY;
    }
    if (rMinX < minX) minX = rMinX;
    if (rMinY < minY) minY = rMinY;
    if (rMaxX > maxX) maxX = rMaxX;
    if (rMaxY > maxY) maxY = rMaxY;
  };

  for (const f of figures) {
    if (!f.groupId || !groupSet.has(f.groupId)) continue;
    accept(f, f.cellX, f.cellY, f.cellX + f.cellWidth, f.cellY + f.cellHeight);
  }
  if (svgObjects) {
    for (const s of svgObjects) {
      if (!s.groupId || !groupSet.has(s.groupId)) continue;
      if (s.tileMode === 'repeat') {
        // A repeat-tiled object's visible extent is its cell region, not its
        // base-tile segments.
        accept(s, s.cellX, s.cellY, s.cellX + s.cellWidth, s.cellY + s.cellHeight);
      } else {
        const bb = arcBoundingBox(s.segments);
        if (bb) accept(s, bb.minX, bb.minY, bb.maxX, bb.maxY);
      }
    }
  }
  if (images) {
    for (const i of images) {
      if (!i.groupId || !groupSet.has(i.groupId)) continue;
      accept(i, i.cellX, i.cellY, i.cellX + i.cellWidth, i.cellY + i.cellHeight);
    }
  }
  if (texts) {
    for (const t of texts) {
      if (!t.groupId || !groupSet.has(t.groupId)) continue;
      accept(t, t.cellX, t.cellY, t.cellX + t.cellWidth, t.cellY + t.cellHeight);
    }
  }
  // Everything clipped away but members existed â†’ fall back to the union.
  if (minX === Infinity && uMinX !== Infinity) {
    return { minX: uMinX, minY: uMinY, maxX: uMaxX, maxY: uMaxY };
  }
  return { minX, minY, maxX, maxY };
}

/** World-space selection bounds for a group. When the group has an active mask
 *  (`maskMap` has an entry for `groupId`), the selection box hugs the mask, so
 *  the bounds are the mask's own bbox and no other member affects them.
 *  Otherwise it's the mask-aware union of members (a mask on a *nested* group
 *  still clips its siblings). Single source of truth for the selection box
 *  overlay, the scale anchor, the corner-handle hit-test, and the move anchor â€”
 *  keeping all four in agreement so there's no jump between rendering and
 *  interaction. */
export function groupSelectionBounds(
  figures: readonly CompositionFigure[],
  groupId: string,
  svgObjects: readonly SVGObject[],
  images: readonly ImageObject[] | undefined,
  groups: readonly GroupNode[],
  maskMap: ReadonlyMap<string, SVGObject> | undefined,
  texts?: readonly TextObject[],
): { minX: number; minY: number; maxX: number; maxY: number } {
  const mask = maskMap?.get(groupId);
  if (mask) {
    const bb = computeSVGBbox(mask.segments);
    return { minX: bb.cellX, minY: bb.cellY, maxX: bb.cellX + bb.cellWidth, maxY: bb.cellY + bb.cellHeight };
  }
  return groupBounds(figures, groupId, svgObjects, svgObjects, images, groups, maskMap, texts);
}

/** Root-local bounding box (in the local space of `groupId`) of every figure,
 *  svg, and image in the group and its descendants â€” each transformed up the
 *  chain from its own group to (but excluding) `groupId`. This is the
 *  local-space twin of `groupBounds`, and its width/height are the denominator
 *  the group-scale gesture divides into the new world size to get a uniform
 *  sX/sY.
 *
 *  With a non-empty `maskMap`, each member's root-local rect is clipped to the
 *  root-local bbox of every mask in its ancestor chain (the node's own mask
 *  exempted), so the local extent tracks the same visible (mask-clipped) region
 *  the world bounds do â€” this is what keeps scaling uniform (no jump / no
 *  distortion) when a nested group is masked. Unclipped-union fallback for the
 *  all-clipped degenerate case, as in `groupBounds`.
 *
 *  Consolidates the previously-duplicated local-union loops in
 *  `CompositionCanvas` (scale capture) and `CompositionEditor` (scale apply);
 *  callers keep their own rotation-swap of the returned dims. */
export function groupLocalUnionBounds(
  state: {
    figures: readonly CompositionFigure[];
    svgObjects: readonly SVGObject[];
    images?: readonly ImageObject[];
    texts?: readonly TextObject[];
    groups: readonly GroupNode[];
  },
  groupId: string,
  maskMap?: ReadonlyMap<string, SVGObject>,
): { minX: number; minY: number; maxX: number; maxY: number; hasMembers: boolean } {
  const groups = state.groups;
  const allGids = new Set([groupId, ...descendantGroupIds(groups, groupId)]);
  const clip = !!maskMap && maskMap.size > 0;

  // Chain from a member's group up to (but excluding) groupId. Applying it to
  // the member's local coords yields its position in groupId's local space.
  const chainCache = new Map<string, readonly GroupNode[]>();
  const iChain = (mgid: string): readonly GroupNode[] => {
    let c = chainCache.get(mgid);
    if (c) return c;
    if (mgid === groupId) { c = []; }
    else {
      const full = groupAncestorChain(groups, mgid);
      const idx = full.findIndex(g => g.id === groupId);
      c = idx >= 0 ? full.slice(0, idx) : full;
    }
    chainCache.set(mgid, c);
    return c;
  };
  const toLocalRect = (
    mgid: string,
    r: { cellX: number; cellY: number; cellWidth: number; cellHeight: number },
  ) => {
    const chain = iChain(mgid);
    return chain.length > 0 ? applyChainedGroupTransform(chain, r) : r;
  };

  // Root-local bbox of each mask shape, cached by mask id.
  const maskRectCache = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
  const maskRootLocalRect = (m: SVGObject) => {
    let r = maskRectCache.get(m.id);
    if (r) return r;
    const lbb = computeSVGBbox(m.localSegments ?? m.segments);
    const lr = toLocalRect(m.groupId!, { cellX: lbb.cellX, cellY: lbb.cellY, cellWidth: lbb.cellWidth, cellHeight: lbb.cellHeight });
    r = { minX: lr.cellX, minY: lr.cellY, maxX: lr.cellX + lr.cellWidth, maxY: lr.cellY + lr.cellHeight };
    maskRectCache.set(m.id, r);
    return r;
  };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let uMinX = Infinity, uMinY = Infinity, uMaxX = -Infinity, uMaxY = -Infinity;
  let hasMembers = false;

  const accept = (
    node: { id: string; groupId?: string },
    rMinX: number, rMinY: number, rMaxX: number, rMaxY: number,
  ) => {
    hasMembers = true;
    if (rMinX < uMinX) uMinX = rMinX;
    if (rMinY < uMinY) uMinY = rMinY;
    if (rMaxX > uMaxX) uMaxX = rMaxX;
    if (rMaxY > uMaxY) uMaxY = rMaxY;
    if (clip) {
      const masks = getNodeClipMasks(maskMap!, groups, node);
      for (const m of masks) {
        const mr = maskRootLocalRect(m);
        if (mr.minX > rMinX) rMinX = mr.minX;
        if (mr.minY > rMinY) rMinY = mr.minY;
        if (mr.maxX < rMaxX) rMaxX = mr.maxX;
        if (mr.maxY < rMaxY) rMaxY = mr.maxY;
      }
      if (rMaxX <= rMinX || rMaxY <= rMinY) return; // fully clipped away
    }
    if (rMinX < minX) minX = rMinX;
    if (rMinY < minY) minY = rMinY;
    if (rMaxX > maxX) maxX = rMaxX;
    if (rMaxY > maxY) maxY = rMaxY;
  };

  for (const m of state.figures) {
    if (!m.groupId || !allGids.has(m.groupId)) continue;
    const lr = toLocalRect(m.groupId, {
      cellX: m.localCellX ?? m.cellX, cellY: m.localCellY ?? m.cellY,
      cellWidth: m.localCellWidth ?? m.cellWidth, cellHeight: m.localCellHeight ?? m.cellHeight,
    });
    accept(m, lr.cellX, lr.cellY, lr.cellX + lr.cellWidth, lr.cellY + lr.cellHeight);
  }
  for (const s of state.svgObjects) {
    if (!s.groupId || !allGids.has(s.groupId)) continue;
    if (s.tileMode === 'repeat') {
      const lr = toLocalRect(s.groupId, {
        cellX: s.localCellX ?? s.cellX, cellY: s.localCellY ?? s.cellY,
        cellWidth: s.localCellWidth ?? s.cellWidth, cellHeight: s.localCellHeight ?? s.cellHeight,
      });
      accept(s, lr.cellX, lr.cellY, lr.cellX + lr.cellWidth, lr.cellY + lr.cellHeight);
    } else {
      const localSegs = s.localSegments ?? s.segments;
      const chain = iChain(s.groupId);
      let sMinX = Infinity, sMinY = Infinity, sMaxX = -Infinity, sMaxY = -Infinity;
      for (const [x, y] of arcAllPoints(localSegs)) {
        const [tx, ty] = chain.length > 0 ? applyChainedGroupTransformPoint(chain, x, y) : [x, y];
        if (tx < sMinX) sMinX = tx;
        if (ty < sMinY) sMinY = ty;
        if (tx > sMaxX) sMaxX = tx;
        if (ty > sMaxY) sMaxY = ty;
      }
      if (sMinX <= sMaxX && sMinY <= sMaxY) accept(s, sMinX, sMinY, sMaxX, sMaxY);
    }
  }
  for (const m of (state.images ?? [])) {
    if (!m.groupId || !allGids.has(m.groupId)) continue;
    const lr = toLocalRect(m.groupId, {
      cellX: m.localCellX ?? m.cellX, cellY: m.localCellY ?? m.cellY,
      cellWidth: m.localCellWidth ?? m.cellWidth, cellHeight: m.localCellHeight ?? m.cellHeight,
    });
    accept(m, lr.cellX, lr.cellY, lr.cellX + lr.cellWidth, lr.cellY + lr.cellHeight);
  }
  for (const m of (state.texts ?? [])) {
    if (!m.groupId || !allGids.has(m.groupId)) continue;
    const lr = toLocalRect(m.groupId, {
      cellX: m.localCellX ?? m.cellX, cellY: m.localCellY ?? m.cellY,
      cellWidth: m.localCellWidth ?? m.cellWidth, cellHeight: m.localCellHeight ?? m.cellHeight,
    });
    accept(m, lr.cellX, lr.cellY, lr.cellX + lr.cellWidth, lr.cellY + lr.cellHeight);
  }

  if (minX === Infinity && uMinX !== Infinity) {
    return { minX: uMinX, minY: uMinY, maxX: uMaxX, maxY: uMaxY, hasMembers };
  }
  return { minX, minY, maxX, maxY, hasMembers };
}

/**
 * Find the topmost figure (or figure-anchored / line-only group) at
 * `(cellX, cellY)`, walking `state.sceneOrder` front-to-back so figure z-order
 * matches what the user sees in the Scene Outline panel.
 *
 * Returns the id of the figure, or â€” when the front-most member of a group
 * is encountered â€” the id of that member as a stand-in for the whole group;
 * the caller expands the id to its group via `expandIdsToGroups`.
 *
 * `state.figures` array order is NOT consulted: the source of truth for
 * z-order is `sceneOrder`, which is the only structure that drag-to-reorder
 * in the Scene Outline mutates (`applySceneOrder`).
 */
export function findFigureAtCell(
  cellX: number, cellY: number, state: CompositionState,
): string | null {
  const maskMap = buildActiveMaskMap(state);
  const hiddenGroups = hiddenGroupIds(state.groups);
  const figMap = new Map<string, CompositionFigure>();
  for (const f of state.figures) figMap.set(f.id, f);

  // Pass 1: figures and figure-anchored groups, walked front-to-back via sceneOrder.
  const checkedGroups = new Set<string>();
  for (let i = state.sceneOrder.length - 1; i >= 0; i--) {
    const f = figMap.get(state.sceneOrder[i]);
    if (!f) continue;
    if (f.groupId) {
      if (checkedGroups.has(f.groupId)) continue;
      checkedGroups.add(f.groupId);
      if (hiddenGroups.has(f.groupId)) continue; // inherited hide
      const members = state.figures.filter(m => m.groupId === f.groupId);
      if (members.some(m => m.locked)) continue;
      if (state.svgObjects.some(s => s.groupId === f.groupId && s.locked)) continue;
      if (members.some(m => m.hidden)) continue;
      if (state.svgObjects.some(s => s.groupId === f.groupId && s.hidden)) continue;
      if ((state.images ?? []).some(i => i.groupId === f.groupId && i.hidden)) continue;
      if ((state.texts ?? []).some(t => t.groupId === f.groupId && t.hidden)) continue;
      const b = groupBounds(state.figures, f.groupId, state.svgObjects, undefined, state.images, state.groups, undefined, state.texts);
      if (cellX >= b.minX && cellX < b.maxX && cellY >= b.minY && cellY < b.maxY) {
        if (maskMap.size > 0
          && !pointPassesMasks(getGroupMaskChain(maskMap, state.groups, f.groupId), undefined, cellX, cellY)) {
          continue; // group hit clipped by its mask chain
        }
        return f.id;
      }
      continue;
    }
    if (f.locked) continue;
    if (f.hidden) continue;
    if (f.quads) {
      for (const q of f.quads) {
        const qx = f.cellX + q.offsetX;
        const qy = f.cellY + q.offsetY;
        if (cellX >= qx && cellX < qx + q.cellWidth && cellY >= qy && cellY < qy + q.cellHeight) {
          return f.id;
        }
      }
    } else if (cellX >= f.cellX && cellX < f.cellX + f.cellWidth
      && cellY >= f.cellY && cellY < f.cellY + f.cellHeight) {
      return f.id;
    }
  }

  // Pass 2: svg-only groups (groups with no figure member). Same z-order
  // walk as pass 1, kept as a fallback so an svg-only group never beats an
  // ungrouped figure that's z-above it.
  const svgMap = new Map<string, SVGObject>();
  for (const s of state.svgObjects) svgMap.set(s.id, s);
  for (let i = state.sceneOrder.length - 1; i >= 0; i--) {
    const s = svgMap.get(state.sceneOrder[i]);
    if (!s || !s.groupId || checkedGroups.has(s.groupId)) continue;
    checkedGroups.add(s.groupId);
    if (hiddenGroups.has(s.groupId)) continue; // inherited hide
    if (state.svgObjects.some(m => m.groupId === s.groupId && m.locked)) continue;
    if (state.svgObjects.some(m => m.groupId === s.groupId && m.hidden)) continue;
    const b = groupBounds(state.figures, s.groupId, state.svgObjects, undefined, state.images, state.groups, undefined, state.texts);
    if (cellX >= b.minX && cellX < b.maxX && cellY >= b.minY && cellY < b.maxY) {
      if (maskMap.size > 0
        && !pointPassesMasks(getGroupMaskChain(maskMap, state.groups, s.groupId), undefined, cellX, cellY)) {
        continue; // group hit clipped by its mask chain
      }
      return s.id;
    }
  }
  return null;
}

/**
 * Image-only bbox hit-test. Lives in a separate pass from `findFigureAtCell`
 * so the pointer-down hit sequence can run line/arc stroke proximity
 * (`findStrokeAtCell`) *before* it â€” that way a thin line painted on top of
 * an image still wins the hit, matching the visual z-order (images render
 * at the back). Without the split, the image's large bbox would always
 * swallow clicks on overlapping line strokes.
 *
 * Walks `state.sceneOrder` front-to-back â€” same z-order rule as the figure
 * and stroke passes.
 */
export function findImageAtCell(
  cellX: number, cellY: number, state: CompositionState,
): string | null {
  const stateImages = state.images ?? [];
  if (stateImages.length === 0) return null;
  const maskMap = buildActiveMaskMap(state);
  const hiddenGroups = hiddenGroupIds(state.groups);
  const imgMap = new Map<string, ImageObject>();
  for (const img of stateImages) imgMap.set(img.id, img);

  const checkedGroups = new Set<string>();
  for (let i = state.sceneOrder.length - 1; i >= 0; i--) {
    const id = state.sceneOrder[i];
    const img = imgMap.get(id);
    if (!img) continue;
    if (img.groupId) {
      if (checkedGroups.has(img.groupId)) continue;
      checkedGroups.add(img.groupId);
      if (hiddenGroups.has(img.groupId)) continue; // inherited hide
      if (stateImages.some(m => m.groupId === img.groupId && m.locked)) continue;
      if (stateImages.some(m => m.groupId === img.groupId && m.hidden)) continue;
      if (state.figures.some(f => f.groupId === img.groupId && f.hidden)) continue;
      if (state.svgObjects.some(s => s.groupId === img.groupId && s.hidden)) continue;
      if ((state.texts ?? []).some(t => t.groupId === img.groupId && t.hidden)) continue;
      const b = groupBounds(state.figures, img.groupId, state.svgObjects, undefined, state.images, state.groups, undefined, state.texts);
      if (cellX >= b.minX && cellX < b.maxX && cellY >= b.minY && cellY < b.maxY) {
        if (maskMap.size > 0
          && !pointPassesMasks(getGroupMaskChain(maskMap, state.groups, img.groupId), undefined, cellX, cellY)) {
          continue; // group hit clipped by its mask chain
        }
        return img.id;
      }
      continue;
    }
    if (img.locked) continue;
    if (img.hidden) continue;
    if (cellX >= img.cellX && cellX < img.cellX + img.cellWidth
      && cellY >= img.cellY && cellY < img.cellY + img.cellHeight) {
      return img.id;
    }
  }
  return null;
}

/**
 * Text-only bbox hit-test. Mirrors `findImageAtCell`: a separate pass so
 * the pointer-down chain can order stroke proximity ahead of the text
 * bbox, and walks `state.sceneOrder` front-to-back for z-order.
 */
export function findTextAtCell(
  cellX: number, cellY: number, state: CompositionState,
): string | null {
  const stateTexts = state.texts ?? [];
  if (stateTexts.length === 0) return null;
  const maskMap = buildActiveMaskMap(state);
  const hiddenGroups = hiddenGroupIds(state.groups);
  const txtMap = new Map<string, TextObject>();
  for (const txt of stateTexts) txtMap.set(txt.id, txt);

  const checkedGroups = new Set<string>();
  for (let i = state.sceneOrder.length - 1; i >= 0; i--) {
    const id = state.sceneOrder[i];
    const txt = txtMap.get(id);
    if (!txt) continue;
    if (txt.groupId) {
      if (checkedGroups.has(txt.groupId)) continue;
      checkedGroups.add(txt.groupId);
      if (hiddenGroups.has(txt.groupId)) continue; // inherited hide
      if (stateTexts.some(m => m.groupId === txt.groupId && m.locked)) continue;
      if (stateTexts.some(m => m.groupId === txt.groupId && m.hidden)) continue;
      if (state.figures.some(f => f.groupId === txt.groupId && f.hidden)) continue;
      if (state.svgObjects.some(s => s.groupId === txt.groupId && s.hidden)) continue;
      if ((state.images ?? []).some(m => m.groupId === txt.groupId && m.hidden)) continue;
      const b = groupBounds(state.figures, txt.groupId, state.svgObjects, undefined, state.images, state.groups, undefined, state.texts);
      if (cellX >= b.minX && cellX < b.maxX && cellY >= b.minY && cellY < b.maxY) {
        if (maskMap.size > 0
          && !pointPassesMasks(getGroupMaskChain(maskMap, state.groups, txt.groupId), undefined, cellX, cellY)) {
          continue; // group hit clipped by its mask chain
        }
        return txt.id;
      }
      continue;
    }
    if (txt.locked) continue;
    if (txt.hidden) continue;
    if (cellX >= txt.cellX && cellX < txt.cellX + txt.cellWidth
      && cellY >= txt.cellY && cellY < txt.cellY + txt.cellHeight) {
      return txt.id;
    }
  }
  return null;
}

/** Topmost scene object at the given cell across every kind, walking
 *  `sceneOrder` from front to back. Locked items and items inside a group
 *  whose dominant member is locked are skipped â€” the existing per-kind
 *  helpers (`lineHitsCell`, `arcHitsCell`) check `locked` themselves;
 *  figures/images do their own check below.
 *
 *  Figures use AABB or quad-list testing (matches the legacy figure
 *  hit-test in handleTap). Images use bbox-only. Returns the kind so
 *  callers can run kind-specific post-processing (e.g. group expansion). */
/** Rotate a world query point back into a node's UNROTATED local frame by
 *  `-node.angleDeg` about the node's bbox center. The forward render applies
 *  a clockwise `rotate(angleDeg)` (CSS/SVG, y-down) about that center, so the
 *  inverse un-rotates before the axis-aligned adapter tests. Returns the
 *  point unchanged when the node has no free rotation. */
export function unrotatePointForNode(
  node: { cellX: number; cellY: number; cellWidth: number; cellHeight: number; angleDeg?: number },
  x: number, y: number,
): [number, number] {
  const deg = node.angleDeg;
  if (!deg) return [x, y];
  const cx = node.cellX + node.cellWidth / 2;
  const cy = node.cellY + node.cellHeight / 2;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = x - cx;
  const dy = y - cy;
  // Inverse of the y-down clockwise rotation matrix R(deg).
  return [cx + dx * cos + dy * sin, cy - dx * sin + dy * cos];
}

export function findSceneObjectAtCell(
  state: CompositionState, cellX: number, cellY: number,
  options?: { ignoreLock?: boolean },
): { kind: CompItemKind; id: string } | null {
  // Build idâ†’node+kind lookup for efficient sceneOrder walk.
  const lookup = new Map<string, { kind: CompItemKind; node: any }>();
  for (const f of state.figures) lookup.set(f.id, { kind: 'figure', node: f });
  for (const s of state.svgObjects) lookup.set(s.id, { kind: 'svg', node: s });
  for (const i of state.images ?? []) lookup.set(i.id, { kind: 'image', node: i });
  for (const t of state.texts ?? []) lookup.set(t.id, { kind: 'text', node: t });

  // Zoom-dependent tolerance for SVG path hit testing (squared).
  const toleranceCells = computeHitToleranceCells(state.viewport, state.camera);
  const toleranceSq = toleranceCells * toleranceCells;

  const maskMap = buildActiveMaskMap(state);

  // Inherited hide: a member of a hidden group (frame) draws nothing, so it
  // must not be hit-testable either. Resolved once for the whole walk (O(1)
  // membership below) instead of re-walking each node's ancestor chain.
  const hiddenGroups = hiddenGroupIds(state.groups);

  // Track the first SVG whose bbox passes but whose path misses â€”
  // returned as a fallback when nothing else is behind it.
  let svgBboxFallback: { kind: CompItemKind; id: string } | null = null;

  // Per-node gate shared by the selected-preference pre-pass and the main
  // front-to-back walk, so the two can never disagree about a node's
  // eligibility. Returns the query point rotated into the node's UNROTATED
  // local frame when the node passes every guard and its bbox contains the
  // point, else null.
  const nodeHitAt = (
    id: string, kind: CompItemKind, node: any,
  ): [number, number] | null => {
    // Inherited lock: a member of a locked group (frame) acts as locked even
    // though its own `locked` flag is untouched. The per-node hitTest below
    // only checks the node's OWN flag, so skip ancestor-group-locked members
    // here. `ignoreLock` (eyedropper) bypasses this like the per-node check.
    if (!options?.ignoreLock && isGroupChainLocked(state, node.groupId)) return null;
    // Inherited hide (mirror of the lock skip above): the per-node hitTest
    // only checks the node's OWN `hidden` flag. Unlike lock, `ignoreLock`
    // does not bypass this — an invisible pixel has no color to sample.
    if (node.groupId && hiddenGroups.has(node.groupId)) return null;
    // Free (continuous) rotation is layered on top of the axis-aligned bbox:
    // the geometry adapters test the UNROTATED shape, so rotate the query
    // point back into the node's local frame (by -angleDeg about the bbox
    // center) before every per-node test below. No-op when angleDeg is 0.
    const [hx, hy] = unrotatePointForNode(node, cellX, cellY);
    if (!GEOMETRY_ADAPTERS[kind].hitTest(node, hx, hy, options?.ignoreLock)) return null;
    // Mask gate: a member of a masked group is hit-testable only inside
    // its mask chain (the mask itself is exempt from its own clip). Sits
    // before every kind-specific accept so figures/images/tiled/selected
    // SVGs are all covered AND the svgBboxFallback stays mask-clean.
    // Returning null (not a hit) lets the caller fall through to visible
    // objects behind the clipped-away area.
    if (maskMap.size > 0
      && !pointPassesMasks(getAncestorMasks(maskMap, state.groups, node.groupId), id, cellX, cellY)) {
      return null;
    }
    return [hx, hy];
  };

  // Sticky selection: once an object is selected, a tap or drag anywhere
  // inside its bounding box re-grabs THAT object, even when another object
  // sits above it in z-order or has opaque pixels under the point. Without
  // this, nudging a selected object by dragging from a spot that overlaps a
  // neighbor silently switches the selection to the neighbor. Walk
  // front-to-back so the topmost selected object wins when several overlap.
  // Skipped for the eyedropper / long-press sampler (ignoreLock), which
  // sample the literal stack and must not honor the current selection.
  if (!options?.ignoreLock && state.selectedFigureIds.size > 0) {
    for (let i = state.sceneOrder.length - 1; i >= 0; i--) {
      const id = state.sceneOrder[i];
      if (!state.selectedFigureIds.has(id)) continue;
      const entry = lookup.get(id);
      if (!entry) continue;
      if (nodeHitAt(id, entry.kind, entry.node)) return { kind: entry.kind, id };
    }
  }

  // Walk sceneOrder front-to-back (last index = front).
  for (let i = state.sceneOrder.length - 1; i >= 0; i--) {
    const id = state.sceneOrder[i];
    const entry = lookup.get(id);
    if (!entry) continue;
    const { kind, node } = entry;
    const hit = nodeHitAt(id, kind, node);
    if (!hit) continue;
    const [hx, hy] = hit;

    // Bbox hit confirmed.
    if (kind !== 'svg') return { kind, id };  // figure/image: bbox is definitive

    // SVG: tiled objects fill their region, so bbox is definitive.
    if (node.tileMode === 'repeat') return { kind, id };

    // Selected SVGs are bbox-definitive: the user has expressed intent
    // to interact with this object, so its bbox claims hits even where
    // path-distance would otherwise fall through. The sticky-selection
    // pre-pass above already covers this for normal selection; this branch
    // now only fires on the ignoreLock (eyedropper/long-press) path, where
    // the pre-pass is skipped but a selected SVG should still win its bbox.
    if (state.selectedFigureIds.has(id)) return { kind, id };

    // SVG: precise path-distance test (in the node's unrotated frame).
    if (svgPathHitsPoint(node, hx, hy, toleranceSq)) return { kind, id };

    // Bbox hit but path miss â€” record as fallback (first/topmost only).
    if (!svgBboxFallback) svgBboxFallback = { kind, id };
  }

  return svgBboxFallback;
}

/**
 * Return all member IDs (figures + svgObjects + images + texts) of a group.
 * If groupId is undefined, returns an empty array.
 */
export function groupMemberIds(state: CompositionState, groupId: string | undefined): string[] {
  if (!groupId) return [];
  return [
    ...state.figures.filter(f => f.groupId === groupId).map(f => f.id),
    ...state.svgObjects.filter(s => s.groupId === groupId).map(s => s.id),
    ...(state.images ?? []).filter(i => i.groupId === groupId).map(i => i.id),
    ...(state.texts ?? []).filter(t => t.groupId === groupId).map(t => t.id),
  ];
}

/**
 * Expand a single node ID to include all members of its root group
 * (including members of nested child groups).
 * If the node is ungrouped, returns `[nodeId]`.
 */
export function expandToGroup(state: CompositionState, nodeId: string): string[] {
  const gid = findGroupId(state, nodeId);
  if (!gid) return [nodeId];
  const rootGid = findRootGroupId(state.groups, gid);
  return allDescendantMemberIds(state, rootGid);
}

/**
 * Set-based expansion: for every id in `ids`, replace it with the full
 * leaf membership of its root group (including nested sub-groups). Ids
 * without a group are kept as themselves. Returns a deduplicated array.
 *
 * Use this anywhere a selection of leaf ids needs to be expanded to "every
 * member of any group at least one id belongs to" â€” marquee selection,
 * drag-id assembly, etc. Resolving each id to its ROOT before walking
 * descendants is what makes this safe for nested-group hierarchies.
 */
export function expandIdsToGroups(state: CompositionState, ids: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    const gid = findGroupId(state, id);
    if (gid) {
      const rootGid = findRootGroupId(state.groups, gid);
      for (const m of allDescendantMemberIds(state, rootGid)) out.add(m);
    } else {
      out.add(id);
    }
  }
  return [...out];
}

/**
 * Compute the center of a group's local bounding box (the bbox of all
 * direct members' local coords plus child groups' bboxes in this group's
 * local space). Used to pivot rotation/mirror around the group's visual center.
 *
 * When the group has an active mask, the mask defines the visible window:
 * sibling content outside it is clipped away, so the *visible* center is the
 * mask's own bbox center, not the union of all (mostly-hidden) members. We
 * pivot there so a masked group rotates/mirrors around what the user sees.
 */
export function groupLocalCenter(state: CompositionState, groupId: string): [number, number] {
  const mask = buildActiveMaskMap(state).get(groupId);
  if (mask) {
    // The mask is a direct member of `groupId`, so its local segments are
    // already in this group's local space.
    const segs = mask.localSegments ?? mask.segments;
    const bb = arcBoundingBox(segs);
    if (bb) return [(bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2];
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const expand = (lx: number, ly: number, lw: number, lh: number) => {
    if (lx < minX) minX = lx;
    if (ly < minY) minY = ly;
    if (lx + lw > maxX) maxX = lx + lw;
    if (ly + lh > maxY) maxY = ly + lh;
  };
  // Direct figure members
  for (const f of state.figures) {
    if (f.groupId !== groupId) continue;
    expand(f.localCellX ?? f.cellX, f.localCellY ?? f.cellY,
           f.localCellWidth ?? f.cellWidth, f.localCellHeight ?? f.cellHeight);
  }
  // Direct SVG members
  for (const s of state.svgObjects) {
    if (s.groupId !== groupId) continue;
    const segs = s.localSegments ?? s.segments;
    const bb = arcBoundingBox(segs);
    if (bb) expand(bb.minX, bb.minY, bb.maxX - bb.minX, bb.maxY - bb.minY);
  }
  // Direct image members
  for (const i of (state.images ?? [])) {
    if (i.groupId !== groupId) continue;
    expand(i.localCellX ?? i.cellX, i.localCellY ?? i.cellY,
           i.localCellWidth ?? i.cellWidth, i.localCellHeight ?? i.cellHeight);
  }
  // Direct text members
  for (const t of (state.texts ?? [])) {
    if (t.groupId !== groupId) continue;
    expand(t.localCellX ?? t.cellX, t.localCellY ?? t.cellY,
           t.localCellWidth ?? t.cellWidth, t.localCellHeight ?? t.cellHeight);
  }
  // Child groups: inverse-transform each descendant member's world coords
  // through this group's ancestor chain to recover its position in this
  // group's local space. Direct members already store localCellX/Y in
  // this group's space, but child members' world coords include this
  // group's transform â€” inverting the chain strips it off, leaving the
  // child-transform-applied coords we need for a stable pivot.
  const chain = groupAncestorChain(state.groups, groupId);
  for (const child of state.groups) {
    if (child.parentGroupId !== groupId) continue;
    const childIds = allDescendantMemberIds(state, child.id);
    for (const mid of childIds) {
      const fig = state.figures.find(f => f.id === mid);
      if (fig) {
        const lc = inverseChainedGroupTransform(chain, { cellX: fig.cellX, cellY: fig.cellY, cellWidth: fig.cellWidth, cellHeight: fig.cellHeight });
        expand(lc.cellX, lc.cellY, lc.cellWidth, lc.cellHeight);
        continue;
      }
      const svg = state.svgObjects.find(sv => sv.id === mid);
      if (svg) {
        // Transform each segment into this group's local space, then take the
        // arc-aware bbox (so swept extremes are included after the transform).
        const tp = (p: readonly [number, number]): [number, number] =>
          inverseChainedGroupTransformPoint(chain, p[0], p[1]);
        const tSegs = svg.segments.map((seg): PathSegment => seg.kind === 'arc'
          ? { kind: 'arc', start: tp(seg.start), end: tp(seg.end), center: tp(seg.center) }
          : { kind: 'line', start: tp(seg.start), end: tp(seg.end) });
        const bb = arcBoundingBox(tSegs);
        if (bb) expand(bb.minX, bb.minY, bb.maxX - bb.minX, bb.maxY - bb.minY);
        continue;
      }
      const img = (state.images ?? []).find(im => im.id === mid);
      if (img) {
        const lc = inverseChainedGroupTransform(chain, { cellX: img.cellX, cellY: img.cellY, cellWidth: img.cellWidth, cellHeight: img.cellHeight });
        expand(lc.cellX, lc.cellY, lc.cellWidth, lc.cellHeight);
        continue;
      }
      const txt = (state.texts ?? []).find(tx => tx.id === mid);
      if (txt) {
        const lc = inverseChainedGroupTransform(chain, { cellX: txt.cellX, cellY: txt.cellY, cellWidth: txt.cellWidth, cellHeight: txt.cellHeight });
        expand(lc.cellX, lc.cellY, lc.cellWidth, lc.cellHeight);
      }
    }
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

// â”€â”€ Nested-group hierarchy helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Walk parentGroupId from `groupId` up to the root. Returns the root group's id. */
export function findRootGroupId(groups: readonly GroupNode[], groupId: string): string {
  const byId = new Map(groups.map(g => [g.id, g]));
  let cur = groupId;
  for (;;) {
    const node = byId.get(cur);
    if (!node || !node.parentGroupId) return cur;
    cur = node.parentGroupId;
  }
}

/** Return the ancestor chain from `groupId` to the root: [self, parent, ..., root]. */
export function groupAncestorChain(groups: readonly GroupNode[], groupId: string): GroupNode[] {
  const byId = new Map(groups.map(g => [g.id, g]));
  const chain: GroupNode[] = [];
  let cur = byId.get(groupId);
  while (cur) {
    chain.push(cur);
    if (!cur.parentGroupId) break;
    cur = byId.get(cur.parentGroupId);
  }
  return chain;
}

/** Return all descendant group IDs (children, grandchildren, ...) of `groupId`. Does NOT include `groupId` itself. */
export function descendantGroupIds(groups: readonly GroupNode[], groupId: string): string[] {
  const children: string[] = [];
  for (const g of groups) {
    if (g.parentGroupId === groupId) {
      children.push(g.id);
      children.push(...descendantGroupIds(groups, g.id));
    }
  }
  return children;
}

/** Return all leaf member IDs (figures + svgs + images + texts) that belong to `groupId` or any of its descendant groups. */
export function allDescendantMemberIds(state: CompositionState, groupId: string): string[] {
  const groupSet = new Set([groupId, ...descendantGroupIds(state.groups, groupId)]);
  return [
    ...state.figures.filter(f => f.groupId && groupSet.has(f.groupId)).map(f => f.id),
    ...state.svgObjects.filter(s => s.groupId && groupSet.has(s.groupId)).map(s => s.id),
    ...(state.images ?? []).filter(i => i.groupId && groupSet.has(i.groupId)).map(i => i.id),
    ...(state.texts ?? []).filter(t => t.groupId && groupSet.has(t.groupId)).map(t => t.id),
  ];
}

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
    result = composeOrientations(
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

/** Apply a chain of group transforms (innermost first, root last) to quads. */
function transformQuadsByGroupChain(
  localQuads: ReadonlyArray<FigureQuad>,
  localBbox: { cellWidth: number; cellHeight: number },
  chain: readonly GroupNode[],
): FigureQuad[] {
  let quads: FigureQuad[] = localQuads.map(q => ({ ...q }));
  let w = localBbox.cellWidth;
  let h = localBbox.cellHeight;
  for (const group of chain) {
    quads = transformQuadsByGroup(quads, { cellWidth: w, cellHeight: h }, group);
    // After this group's transform, compute the new bbox dimensions
    const swapped = group.rotation === 90 || group.rotation === 270;
    const nw = (swapped ? h : w) * group.scaleX;
    const nh = (swapped ? w : h) * group.scaleY;
    w = nw;
    h = nh;
  }
  return quads;
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
 * Recompute world cell coords for every member of `groupId` from the
 * current GroupNode transform composed with each member's `localCell*`.
 * No rounding â€” float `cellX/Y/Width/Height` propagate to read sites,
 * which already operate in float (renderer uses zoom multiplier; SVG
 * accepts float; bbox uses Math.min/max). Returns a new state with the
 * affected figures updated in place; other state is untouched.
 *
 * If a member is missing local coords (legacy data not yet materialized),
 * its current world coords are kept as-is.
 */
export function materializeGroupMembers(state: CompositionState, groupId: string): CompositionState {
  const group = state.groups.find(g => g.id === groupId);
  if (!group) return state;
  // Compute the ancestor chain [self, parent, ..., root] for transform composition.
  const chain = groupAncestorChain(state.groups, groupId);
  // Short passes â€” one per node array â€” calling the per-type materialize
  // helper. The helper returns `null` when the member is unchanged.
  let changed = false;
  const figures = state.figures.map((f) => {
    const next = materializeFigureMember(f, chain, groupId);
    if (next === null) return f;
    changed = true;
    return next;
  });
  const svgObjects = state.svgObjects.map((s) => {
    const next = materializeSVGMember(s, chain, groupId);
    if (next === null) return s;
    changed = true;
    return next;
  });
  const stateImages: ImageObject[] = state.images ?? [];
  const images = stateImages.map((i) => {
    const next = materializeImageMember(i, chain, groupId);
    if (next === null) return i;
    changed = true;
    return next;
  });
  const stateTexts: TextObject[] = state.texts ?? [];
  const texts = stateTexts.map((t) => {
    const next = materializeTextMember(t, chain, groupId);
    if (next === null) return t;
    changed = true;
    return next;
  });
  let next = changed ? { ...state, figures, svgObjects, images, texts } : state;
  // Recurse into child groups so their members' world coords also reflect
  // any ancestor transform change.
  for (const child of next.groups) {
    if (child.parentGroupId === groupId) {
      next = materializeGroupMembers(next, child.id);
    }
  }
  return next;
}

/**
 * Invert a single group transform on a bounding rect.
 * Undoes translate â†’ scale â†’ rotation â†’ mirror (reverse of forward order).
 */
function inverseGroupTransform(
  group: { translateX: number; translateY: number; scaleX: number; scaleY: number; rotation: 0 | 90 | 180 | 270; mirrorH: boolean; mirrorV: boolean },
  world: { cellX: number; cellY: number; cellWidth: number; cellHeight: number },
): { cellX: number; cellY: number; cellWidth: number; cellHeight: number } {
  // 1. Inverse translate + scale
  let x = (world.cellX - group.translateX) / group.scaleX;
  let y = (world.cellY - group.translateY) / group.scaleY;
  let w = world.cellWidth / group.scaleX;
  let h = world.cellHeight / group.scaleY;
  // 2. Inverse rotation (90â†’270, 180â†’180, 270â†’90)
  if (group.rotation === 90) {
    const nx = y, ny = -(x + w), nw = h, nh = w;
    x = nx; y = ny; w = nw; h = nh;
  } else if (group.rotation === 180) {
    x = -(x + w); y = -(y + h);
  } else if (group.rotation === 270) {
    const nx = -(y + h), ny = x, nw = h, nh = w;
    x = nx; y = ny; w = nw; h = nh;
  }
  // 3. Inverse mirror (mirror is self-inverse)
  if (group.mirrorV) y = -(y + h);
  if (group.mirrorH) x = -(x + w);
  return { cellX: x, cellY: y, cellWidth: w, cellHeight: h };
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

/**
 * Invert a chained group transform. The forward chain applies transforms
 * innermost-first (chain[0], chain[1], ...). The inverse applies inverse
 * transforms outermost-first (reverse order).
 */
function inverseChainedGroupTransform(
  chain: readonly GroupNode[],
  world: { cellX: number; cellY: number; cellWidth: number; cellHeight: number },
): { cellX: number; cellY: number; cellWidth: number; cellHeight: number } {
  let result = world;
  for (let i = chain.length - 1; i >= 0; i--) {
    result = inverseGroupTransform(chain[i], result);
  }
  return result;
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

/**
 * Inverse of `composeChainedOrientations`: given a world orientation and
 * an ancestor chain, compute the local orientation such that
 * `composeChainedOrientations(chain, local) === world`.
 *
 * The chain's cumulative orientation matrix is orthogonal (D4 group), so
 * its inverse equals its transpose.
 */
function inverseChainedOrientation(
  chain: readonly GroupNode[],
  world: Orientation,
): Orientation {
  const chainOrient = composeChainedOrientations(
    chain, { rotation: 0, mirrorH: false, mirrorV: false },
  );
  const cm = orientationToMatrix(chainOrient);
  // Transpose of an orthogonal matrix is its inverse.
  const inv: [number, number, number, number] = [cm[0], cm[2], cm[1], cm[3]];
  const inverseChain = matrixToOrientation(inv);
  return composeOrientations(inverseChain, world);
}

/**
 * Inverse of `transformQuadsByGroupChain`: given world quads in a world
 * bbox, inverse-transform through the chain to produce local quads.
 * Walks the chain from root to innermost (reverse of forward), undoing
 * scale â†’ rotation â†’ mirror at each step.
 */
function inverseTransformQuadsByGroupChain(
  worldQuads: ReadonlyArray<FigureQuad>,
  worldBbox: { cellWidth: number; cellHeight: number },
  chain: readonly GroupNode[],
): FigureQuad[] {
  let quads: FigureQuad[] = worldQuads.map(q => ({ ...q }));
  let w = worldBbox.cellWidth;
  let h = worldBbox.cellHeight;
  for (let i = chain.length - 1; i >= 0; i--) {
    const group = chain[i];
    // Undo scale on bbox dimensions (quads are unscaled offsets within bbox).
    w /= group.scaleX;
    h /= group.scaleY;
    // Undo rotation: forward did N steps CW, inverse does (4-N)%4 steps CW.
    const inverseSteps = ((4 - group.rotation / 90) % 4);
    for (let j = 0; j < inverseSteps; j++) {
      quads = quads.map(q => rotateQuad90CW(q, h));
      const swap = w; w = h; h = swap;
    }
    // Undo mirrors (mirror is self-inverse).
    if (group.mirrorV) quads = quads.map(q => mirrorQuadV(q, h));
    if (group.mirrorH) quads = quads.map(q => mirrorQuadH(q, w));
  }
  return quads;
}

/** Compare two quad arrays for structural equality. */
function sameQuads(a: FigureQuad[] | undefined, b: FigureQuad[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].offsetX !== b[i].offsetX || a[i].offsetY !== b[i].offsetY
      || a[i].cellWidth !== b[i].cellWidth || a[i].cellHeight !== b[i].cellHeight) return false;
  }
  return true;
}

/**
 * Reconcile group member local coordinates from their world coordinates.
 * Preserves visual positions (world coords unchanged) while ensuring
 * `localCell*` are consistent with the current group transform chain.
 *
 * Use after loading/merging data where locals may be stale relative to
 * the current group transforms. This is the inverse of
 * `materializeGroupMembers` â€” instead of deriving world from local, it
 * derives local from world.
 */
export function reconcileGroupLocals(state: CompositionState): CompositionState {
  return reconcileGroupLocalsForGroups(state, null);
}

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
    groupId: undefined, localCellX: undefined, localCellY: undefined,
    localCellWidth: undefined, localCellHeight: undefined,
    localTileWidthL0: undefined, localTileHeightL0: undefined,
    localTileOffsetXL0: undefined, localTileOffsetYL0: undefined,
    localRotation: undefined, localMirrorH: undefined, localMirrorV: undefined,
    localQuads: undefined,
  } as const;
  const clearBbox = {
    groupId: undefined, localCellX: undefined, localCellY: undefined,
    localCellWidth: undefined, localCellHeight: undefined,
  } as const;
  const clearSvg = { ...clearBbox, localSegments: undefined, localSubpaths: undefined } as const;
  const toTop = groupId === undefined;
  return {
    ...state,
    figures: state.figures.map((f) => (f.id !== id ? f : toTop ? { ...f, ...clearFig } : { ...f, groupId })),
    svgObjects: state.svgObjects.map((s) => (s.id !== id ? s : toTop ? { ...s, ...clearSvg } : { ...s, groupId })),
    images: (state.images ?? []).map((i) => (i.id !== id ? i : toTop ? { ...i, ...clearBbox } : { ...i, groupId })),
    texts: (state.texts ?? []).map((t) => (t.id !== id ? t : toTop ? { ...t, ...clearBbox } : { ...t, groupId })),
  };
}

/**
 * Like `reconcileGroupLocals`, but only recomputes locals for items whose
 * `groupId` is in `targetGroupIds`.  Pass `null` to reconcile all groups.
 * Used after detaching child groups during ungroup to avoid perturbing
 * unrelated items (whose bounding boxes may intentionally differ from the
 * segment AABB, e.g. inflated creationBox-based selection rects for lines).
 */
function reconcileGroupLocalsForGroups(
  state: CompositionState, targetGroupIds: ReadonlySet<string> | null,
  removedAncestor?: GroupNode,
): CompositionState {
  let changed = false;
  const figures = state.figures.map((f) => {
    if (!f.groupId) return f;
    if (targetGroupIds && !targetGroupIds.has(f.groupId)) return f;
    const chain = groupAncestorChain(state.groups, f.groupId);
    if (chain.length === 0) return f;

    // Inverse bbox.
    const local = inverseChainedGroupTransform(chain, {
      cellX: f.cellX, cellY: f.cellY, cellWidth: f.cellWidth, cellHeight: f.cellHeight,
    });

    // Inverse orientation.
    const worldOrient: Orientation = {
      rotation: f.rotation ?? 0, mirrorH: f.mirrorH ?? false, mirrorV: f.mirrorV ?? false,
    };
    const localOrient = inverseChainedOrientation(chain, worldOrient);

    // Inverse tile dimensions.
    let localTileW = f.localTileWidthL0;
    let localTileH = f.localTileHeightL0;
    let localTileOffX = f.localTileOffsetXL0;
    let localTileOffY = f.localTileOffsetYL0;
    if (f.tileMode === 'repeat') {
      if (f.tileWidthL0 !== undefined && f.tileHeightL0 !== undefined) {
        const invTile = inverseChainedGroupTransform(chain, {
          cellX: 0, cellY: 0, cellWidth: f.tileWidthL0, cellHeight: f.tileHeightL0,
        });
        localTileW = invTile.cellWidth;
        localTileH = invTile.cellHeight;
      }
      const worldOffX = f.tileOffsetXL0 ?? 0;
      const worldOffY = f.tileOffsetYL0 ?? 0;
      // Tile-grid offset is a free vector, not a point â€” invert through
      // the chain's scale/rotation/mirror only, matching the forward
      // delta-transform used in materializeFigureMember.
      const [invOffX, invOffY] = inverseChainedGroupTransformDelta(chain, worldOffX, worldOffY);
      localTileOffX = invOffX === 0 ? undefined : invOffX;
      localTileOffY = invOffY === 0 ? undefined : invOffY;
    }

    // Inverse quads.
    const localQuads = f.quads
      ? inverseTransformQuadsByGroupChain(
          f.quads, { cellWidth: f.cellWidth, cellHeight: f.cellHeight }, chain)
      : undefined;

    // Short-circuit if nothing changed.
    if (f.localCellX === local.cellX && f.localCellY === local.cellY &&
        f.localCellWidth === local.cellWidth && f.localCellHeight === local.cellHeight &&
        (f.localRotation ?? 0) === localOrient.rotation &&
        (f.localMirrorH ?? false) === localOrient.mirrorH &&
        (f.localMirrorV ?? false) === localOrient.mirrorV &&
        f.localTileWidthL0 === localTileW && f.localTileHeightL0 === localTileH &&
        f.localTileOffsetXL0 === localTileOffX && f.localTileOffsetYL0 === localTileOffY &&
        sameQuads(f.localQuads, localQuads)) return f;

    changed = true;
    return { ...f,
      localCellX: local.cellX, localCellY: local.cellY,
      localCellWidth: local.cellWidth, localCellHeight: local.cellHeight,
      localRotation: localOrient.rotation,
      localMirrorH: localOrient.mirrorH,
      localMirrorV: localOrient.mirrorV,
      localTileWidthL0: localTileW,
      localTileHeightL0: localTileH,
      localTileOffsetXL0: localTileOffX,
      localTileOffsetYL0: localTileOffY,
      localQuads,
    };
  });
  const svgObjects = state.svgObjects.map((s) => {
    if (!s.groupId) return s;
    if (targetGroupIds && !targetGroupIds.has(s.groupId)) return s;
    const chain = groupAncestorChain(state.groups, s.groupId);
    if (chain.length === 0) return s;
    const local = inverseChainedGroupTransform(chain, {
      cellX: s.cellX, cellY: s.cellY, cellWidth: s.cellWidth, cellHeight: s.cellHeight,
    });
    const inverseSeg = (seg: PathSegment): PathSegment => seg.kind === 'arc' ? {
      kind: 'arc' as const,
      start: inverseChainedGroupTransformPoint(chain, seg.start[0], seg.start[1]),
      end: inverseChainedGroupTransformPoint(chain, seg.end[0], seg.end[1]),
      center: inverseChainedGroupTransformPoint(chain, seg.center[0], seg.center[1]),
    } : {
      kind: 'line' as const,
      start: inverseChainedGroupTransformPoint(chain, seg.start[0], seg.start[1]),
      end: inverseChainedGroupTransformPoint(chain, seg.end[0], seg.end[1]),
    };
    const localSegments = s.segments.map(inverseSeg);
    // Mirror the inverse-transform for subpaths so a painted SVG that gets
    // (re-)reconciled into a group keeps its per-color geometry survivable
    // through subsequent materializeSVGMember passes.
    const localSubpaths = safeMapSubpaths(s.subpaths, inverseSeg);
    // Reconcile creationBox: the stored value is in the old local space
    // (relative to the chain that included the removed ancestor). Transform
    // it to world via the old chain, then inverse through the new chain.
    let newCreationBox = s.creationBox;
    if (s.creationBox && removedAncestor) {
      const cbRect = {
        cellX: s.creationBox.minX, cellY: s.creationBox.minY,
        cellWidth: s.creationBox.width, cellHeight: s.creationBox.height,
      };
      const throughNewChain = applyChainedGroupTransform(chain, cbRect);
      const worldCB = applyGroupTransform(removedAncestor, throughNewChain);
      const newLocal = inverseChainedGroupTransform(chain, worldCB);
      newCreationBox = {
        minX: newLocal.cellX, minY: newLocal.cellY,
        width: newLocal.cellWidth, height: newLocal.cellHeight,
      };
    }
    changed = true;
    return { ...s,
      localCellX: local.cellX, localCellY: local.cellY,
      localCellWidth: local.cellWidth, localCellHeight: local.cellHeight,
      localSegments,
      localSubpaths,
      creationBox: newCreationBox,
    };
  });
  const stateImages: ImageObject[] = state.images ?? [];
  const images = stateImages.map((i) => {
    if (!i.groupId) return i;
    if (targetGroupIds && !targetGroupIds.has(i.groupId)) return i;
    const chain = groupAncestorChain(state.groups, i.groupId);
    if (chain.length === 0) return i;
    const local = inverseChainedGroupTransform(chain, {
      cellX: i.cellX, cellY: i.cellY, cellWidth: i.cellWidth, cellHeight: i.cellHeight,
    });
    if (i.localCellX === local.cellX && i.localCellY === local.cellY &&
        i.localCellWidth === local.cellWidth && i.localCellHeight === local.cellHeight) return i;
    changed = true;
    return { ...i,
      localCellX: local.cellX, localCellY: local.cellY,
      localCellWidth: local.cellWidth, localCellHeight: local.cellHeight,
    };
  });
  const stateTexts: TextObject[] = state.texts ?? [];
  const texts = stateTexts.map((t) => {
    if (!t.groupId) return t;
    if (targetGroupIds && !targetGroupIds.has(t.groupId)) return t;
    const chain = groupAncestorChain(state.groups, t.groupId);
    if (chain.length === 0) return t;
    const local = inverseChainedGroupTransform(chain, {
      cellX: t.cellX, cellY: t.cellY, cellWidth: t.cellWidth, cellHeight: t.cellHeight,
    });
    if (t.localCellX === local.cellX && t.localCellY === local.cellY &&
        t.localCellWidth === local.cellWidth && t.localCellHeight === local.cellHeight) return t;
    changed = true;
    return { ...t,
      localCellX: local.cellX, localCellY: local.cellY,
      localCellWidth: local.cellWidth, localCellHeight: local.cellHeight,
    };
  });
  return changed ? { ...state, figures, svgObjects, images, texts } : state;
}

/** Re-derive a figure member's world `cell*` (and tile dim if it tiles)
 *  from its `localCell*` composed with the group transform. Also derives
 *  world `rotation` / `mirrorH` / `mirrorV` / `quads` from the figure's
 *  intrinsic `localRotation` / `localMirror*` / `localQuads` composed
 *  with the group's transform â€” without this, a figure in a rotated
 *  group would have its bbox rotated (via `applyGroupTransform`) but its
 *  sprite would render un-rotated. Returns `null` only when the figure
 *  isn't in the group or has no local rect. */
function materializeFigureMember(
  f: CompositionFigure, chain: readonly GroupNode[], groupId: string,
): CompositionFigure | null {
  if (f.groupId !== groupId) return null;
  if (f.localCellX === undefined || f.localCellY === undefined
    || f.localCellWidth === undefined || f.localCellHeight === undefined) return null;
  const w = applyChainedGroupTransform(chain, {
    cellX: f.localCellX, cellY: f.localCellY,
    cellWidth: f.localCellWidth, cellHeight: f.localCellHeight,
  });
  // Tile-mode members scale their tile dim AND tile-grid offset with the
  // chained group transform, so a pattern inside a 2Ã— group renders at 2Ã—
  // the tile pitch and 2Ã— the offset â€” the repetition count stays
  // constant and the pattern stays locked to the figure's local bounds
  // as the group resizes (offset doesn't slide relative to the figure).
  let nextTileW: number | undefined = f.tileWidthL0;
  let nextTileH: number | undefined = f.tileHeightL0;
  let nextTileOffX: number | undefined = f.tileOffsetXL0;
  let nextTileOffY: number | undefined = f.tileOffsetYL0;
  if (f.tileMode === 'repeat' && f.localTileWidthL0 !== undefined && f.localTileHeightL0 !== undefined) {
    const tileBbox = applyChainedGroupTransform(chain, {
      cellX: 0, cellY: 0,
      cellWidth: f.localTileWidthL0, cellHeight: f.localTileHeightL0,
    });
    nextTileW = tileBbox.cellWidth;
    nextTileH = tileBbox.cellHeight;
  }
  if (f.tileMode === 'repeat' && (f.localTileOffsetXL0 !== undefined || f.localTileOffsetYL0 !== undefined)) {
    const [woffX, woffY] = applyChainedGroupTransformDelta(
      chain, f.localTileOffsetXL0 ?? 0, f.localTileOffsetYL0 ?? 0,
    );
    nextTileOffX = woffX === 0 ? undefined : woffX;
    nextTileOffY = woffY === 0 ? undefined : woffY;
  }
  // Compose world orientation through the chain of group transforms.
  const local: Orientation = {
    rotation: f.localRotation ?? 0,
    mirrorH: f.localMirrorH ?? false,
    mirrorV: f.localMirrorV ?? false,
  };
  const world = composeChainedOrientations(chain, local);
  // Quads follow the world bbox the same way: apply the group chain's
  // mirrors then rotations to the figure's `localQuads`.
  const localQuads = f.localQuads ?? f.quads;
  const newQuads = localQuads
    ? transformQuadsByGroupChain(localQuads, { cellWidth: f.localCellWidth, cellHeight: f.localCellHeight }, chain)
    : undefined;
  if (
    f.cellX === w.cellX && f.cellY === w.cellY &&
    f.cellWidth === w.cellWidth && f.cellHeight === w.cellHeight &&
    f.tileWidthL0 === nextTileW && f.tileHeightL0 === nextTileH &&
    f.tileOffsetXL0 === nextTileOffX && f.tileOffsetYL0 === nextTileOffY &&
    (f.rotation ?? 0) === world.rotation &&
    (f.mirrorH ?? false) === world.mirrorH &&
    (f.mirrorV ?? false) === world.mirrorV &&
    sameQuads(f.quads, newQuads)
  ) return null;
  return {
    ...f,
    cellX: w.cellX, cellY: w.cellY, cellWidth: w.cellWidth, cellHeight: w.cellHeight,
    tileWidthL0: nextTileW, tileHeightL0: nextTileH,
    tileOffsetXL0: nextTileOffX, tileOffsetYL0: nextTileOffY,
    rotation: world.rotation,
    mirrorH: world.mirrorH,
    mirrorV: world.mirrorV,
    quads: newQuads,
  };
}

/** Re-derive an SVG member's world segments and bbox from its
 *  `localSegments` composed with the group transform. Each segment's
 *  start / end (and arc-curve center) are transformed individually.
 *  Returns `null` when the svg isn't in the group or has no local
 *  snapshot. */
function materializeSVGMember(
  s: SVGObject, chain: readonly GroupNode[], groupId: string,
): SVGObject | null {
  if (s.groupId !== groupId) return null;
  if (!s.localSegments) return null;
  const transform = (seg: PathSegment): PathSegment => seg.kind === 'arc' ? {
    kind: 'arc' as const,
    start: applyChainedGroupTransformPoint(chain, seg.start[0], seg.start[1]),
    end: applyChainedGroupTransformPoint(chain, seg.end[0], seg.end[1]),
    center: applyChainedGroupTransformPoint(chain, seg.center[0], seg.center[1]),
  } : {
    kind: 'line' as const,
    start: applyChainedGroupTransformPoint(chain, seg.start[0], seg.start[1]),
    end: applyChainedGroupTransformPoint(chain, seg.end[0], seg.end[1]),
  };
  const newSegs = safeMapSegments(s.localSegments, transform) ?? [];
  // Also re-derive world subpaths from localSubpaths through the same
  // chain. Without this, paint-stroke / join per-color subpaths get
  // frozen in pre-transform world coords and the SVG visually falls
  // behind when the group moves / scales / rotates.
  const newSubs = safeMapSubpaths(s.localSubpaths, transform);
  const bb = computeSVGBbox(newSegs);
  return { ...s, segments: newSegs, subpaths: newSubs, ...bb };
}

/** Re-derive an image member's world bbox + orientation from its
 *  `localCell*` composed with the group transform. Bbox-only â€” no
 *  vertex/segment list to materialize. World rotation/mirror is the
 *  composition of the group's orientation with the image's intrinsic
 *  orientation, mirroring `materializeFigureMember` minus the
 *  quad-transform pass. Returns `null` when the image isn't in the
 *  group, has no local rect, or already matches the derived state. */
function materializeImageMember(
  i: ImageObject, chain: readonly GroupNode[], groupId: string,
): ImageObject | null {
  if (i.groupId !== groupId) return null;
  if (i.localCellX === undefined || i.localCellY === undefined
    || i.localCellWidth === undefined || i.localCellHeight === undefined) return null;
  const w = applyChainedGroupTransform(chain, {
    cellX: i.localCellX, cellY: i.localCellY,
    cellWidth: i.localCellWidth, cellHeight: i.localCellHeight,
  });
  const local: Orientation = {
    rotation: i.rotation ?? 0,
    mirrorH: i.mirrorH ?? false,
    mirrorV: i.mirrorV ?? false,
  };
  const world = composeChainedOrientations(chain, local);
  if (
    i.cellX === w.cellX && i.cellY === w.cellY &&
    i.cellWidth === w.cellWidth && i.cellHeight === w.cellHeight &&
    (i.rotation ?? 0) === world.rotation &&
    (i.mirrorH ?? false) === world.mirrorH &&
    (i.mirrorV ?? false) === world.mirrorV
  ) return null;
  return {
    ...i,
    cellX: w.cellX, cellY: w.cellY,
    cellWidth: w.cellWidth, cellHeight: w.cellHeight,
    rotation: world.rotation,
    mirrorH: world.mirrorH,
    mirrorV: world.mirrorV,
  };
}

/** Re-derive a text member's world bbox + orientation from its
 *  `localCell*` composed with the group transform. Bbox-only, exactly
 *  the image member's model â€” text carries no vertex geometry. */
function materializeTextMember(
  t: TextObject, chain: readonly GroupNode[], groupId: string,
): TextObject | null {
  if (t.groupId !== groupId) return null;
  if (t.localCellX === undefined || t.localCellY === undefined
    || t.localCellWidth === undefined || t.localCellHeight === undefined) return null;
  const w = applyChainedGroupTransform(chain, {
    cellX: t.localCellX, cellY: t.localCellY,
    cellWidth: t.localCellWidth, cellHeight: t.localCellHeight,
  });
  const local: Orientation = {
    rotation: t.rotation ?? 0,
    mirrorH: t.mirrorH ?? false,
    mirrorV: t.mirrorV ?? false,
  };
  const world = composeChainedOrientations(chain, local);
  if (
    t.cellX === w.cellX && t.cellY === w.cellY &&
    t.cellWidth === w.cellWidth && t.cellHeight === w.cellHeight &&
    (t.rotation ?? 0) === world.rotation &&
    (t.mirrorH ?? false) === world.mirrorH &&
    (t.mirrorV ?? false) === world.mirrorV
  ) return null;
  return {
    ...t,
    cellX: w.cellX, cellY: w.cellY,
    cellWidth: w.cellWidth, cellHeight: w.cellHeight,
    rotation: world.rotation,
    mirrorH: world.mirrorH,
    mirrorV: world.mirrorV,
  };
}

/**
 * Populate missing `local*` fields on grouped figures and SVGs from their
 * world values.  Called during initial load (via `materializeGroupHierarchy`)
 * and during .tile merge so that both paths produce identical local state.
 */
export function backfillMissingLocals(
  figures: CompositionFigure[],
  svgObjects: SVGObject[],
): { figures: CompositionFigure[]; svgObjects: SVGObject[] } {
  const newFigures = figures.map((f) => {
    if (!f.groupId) return f;
    const needsLocalCell = f.localCellX === undefined || f.localCellY === undefined || f.localCellWidth === undefined || f.localCellHeight === undefined;
    const needsLocalTile = f.tileMode === 'repeat' && f.tileWidthL0 !== undefined && f.tileHeightL0 !== undefined && (f.localTileWidthL0 === undefined || f.localTileHeightL0 === undefined || f.localTileOffsetXL0 === undefined);
    const needsLocalOrient = f.localRotation === undefined;
    if (!needsLocalCell && !needsLocalTile && !needsLocalOrient) return f;
    return {
      ...f,
      ...(needsLocalCell ? {
        localCellX: f.cellX,
        localCellY: f.cellY,
        localCellWidth: f.cellWidth,
        localCellHeight: f.cellHeight,
      } : null),
      ...(needsLocalTile ? {
        localTileWidthL0: f.tileWidthL0,
        localTileHeightL0: f.tileHeightL0,
        localTileOffsetXL0: f.tileOffsetXL0,
        localTileOffsetYL0: f.tileOffsetYL0,
      } : null),
      ...(needsLocalOrient ? {
        localRotation: f.rotation ?? 0,
        localMirrorH: f.mirrorH ?? false,
        localMirrorV: f.mirrorV ?? false,
        localQuads: f.quads?.map(q => ({ ...q })),
      } : null),
    };
  });

  // SVGObjects: seed `localSegments` from world `segments` for any grouped
  // svg that's missing the local snapshot, and seed missing bbox fields.
  const newSVGObjects = svgObjects.map((s) => {
    const partial = s as Partial<SVGObject>;
    const needsBbox = partial.cellX === undefined;
    const needsLocalSegs = !!s.groupId && !s.localSegments;
    const localSegs = needsLocalSegs ? s.segments.map(clonePathSegment) : s.localSegments;
    const needsLocalBbox = !!s.groupId && (s.localCellX === undefined || s.localCellY === undefined || s.localCellWidth === undefined || s.localCellHeight === undefined);
    if (!needsBbox && !needsLocalSegs && !needsLocalBbox) return s;
    const out: SVGObject = { ...s };
    if (needsLocalSegs && localSegs) out.localSegments = localSegs;
    if (needsBbox) {
      const bb = computeSVGBbox(s.segments);
      out.cellX = bb.cellX; out.cellY = bb.cellY;
      out.cellWidth = bb.cellWidth; out.cellHeight = bb.cellHeight;
    }
    if (needsLocalBbox && localSegs) {
      const lb = computeSVGBbox(localSegs);
      out.localCellX = lb.cellX; out.localCellY = lb.cellY;
      out.localCellWidth = lb.cellWidth; out.localCellHeight = lb.cellHeight;
    }
    return out;
  });

  return { figures: newFigures, svgObjects: newSVGObjects };
}

/**
 * One-time migration: for every figure whose `groupId` references a group
 * that doesn't exist in `state.groups` yet, create an identity-transform
 * `GroupNode` and seed each member's `localCell*` with its current world
 * coords. Idempotent â€” figures that already have `localCell*` and groups
 * that already exist are left alone.
 *
 * Run on composition load (from binary format) so older saves get the
 * hierarchy without changing visible state.
 */
export function materializeGroupHierarchy(state: CompositionState): CompositionState {
  const existingGroupIds = new Set(state.groups.map(g => g.id));
  const referencedGroupIds = new Set<string>();
  for (const f of state.figures) {
    if (f.groupId) referencedGroupIds.add(f.groupId);
  }
  for (const s of state.svgObjects) {
    if (s.groupId) referencedGroupIds.add(s.groupId);
  }
  const missingGroupIds: string[] = [];
  for (const gid of referencedGroupIds) {
    if (!existingGroupIds.has(gid)) missingGroupIds.push(gid);
  }
  const figuresNeedLocal = state.figures.some(f => f.groupId && (f.localCellX === undefined || f.localCellY === undefined || f.localCellWidth === undefined || f.localCellHeight === undefined));
  const svgsNeedLocal = state.svgObjects.some(s => s.groupId && !s.localSegments);
  const figuresNeedLocalOrient = state.figures.some(f => f.groupId && f.localRotation === undefined);
  const svgsNeedBbox = state.svgObjects.some(s => (s as Partial<SVGObject>).cellX === undefined
    || (s.groupId && (s.localCellX === undefined || s.localCellY === undefined || s.localCellWidth === undefined || s.localCellHeight === undefined)));
  if (missingGroupIds.length === 0 && !figuresNeedLocal && !figuresNeedLocalOrient && !svgsNeedLocal && !svgsNeedBbox) {
    return state.sceneOrder ? reflowSceneOrderForGroups(state) : state;
  }

  // Find a name for each missing group: use the first member's `name` if
  // present, otherwise a generic label. (For the legacy data model the
  // first member of a group typically holds the group's display name.)
  const newGroups: GroupNode[] = [...state.groups];
  for (const gid of missingGroupIds) {
    const namedFigure = state.figures.find(f => f.groupId === gid && f.name);
    const namedSVG = !namedFigure ? state.svgObjects.find(s => s.groupId === gid && s.name) : undefined;
    newGroups.push({
      id: gid,
      name: namedFigure?.name ?? namedSVG?.name ?? 'Group',
      translateX: 0,
      translateY: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      mirrorH: false,
      mirrorV: false,
    });
  }

  const backfilled = backfillMissingLocals(state.figures, state.svgObjects);

  const migrated = { ...state, groups: newGroups, figures: backfilled.figures, svgObjects: backfilled.svgObjects };
  return migrated.sceneOrder ? reflowSceneOrderForGroups(migrated) : migrated;
}

// â”€â”€ Transform Cycle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface TransformStep {
  rotation: 0 | 90 | 180 | 270;
  mirrorH: boolean;
  mirrorV: boolean;
}

export const TRANSFORM_CYCLE: readonly TransformStep[] = [
  { rotation: 0,   mirrorH: false, mirrorV: false }, // 0: identity
  { rotation: 90,  mirrorH: false, mirrorV: false }, // 1
  { rotation: 180, mirrorH: false, mirrorV: false }, // 2
  { rotation: 270, mirrorH: false, mirrorV: false }, // 3
  { rotation: 0,   mirrorH: false, mirrorV: false }, // 4: identity again
  { rotation: 0,   mirrorH: true,  mirrorV: false }, // 5
  { rotation: 0,   mirrorH: false, mirrorV: true  }, // 6
];

/** Map a screen-space flip axis to the figure's local axis, accounting for rotation. */
export function screenToLocalFlipAxis(
  rotation: 0 | 90 | 180 | 270,
  screenAxis: 'h' | 'v',
): 'h' | 'v' {
  if (rotation === 90 || rotation === 270) {
    return screenAxis === 'h' ? 'v' : 'h';
  }
  return screenAxis;
}

/** Rotate a single quad 90Â° CW within a bounding box of given width/height. */
function rotateQuad90CW(q: FigureQuad, boundH: number): FigureQuad {
  return {
    offsetX: boundH - q.offsetY - q.cellHeight,
    offsetY: q.offsetX,
    cellWidth: q.cellHeight,
    cellHeight: q.cellWidth,
  };
}

/** Mirror a single quad horizontally within a bounding box of given width. */
function mirrorQuadH(q: FigureQuad, boundW: number): FigureQuad {
  return { ...q, offsetX: boundW - q.offsetX - q.cellWidth };
}

/** Mirror a single quad vertically within a bounding box of given height. */
function mirrorQuadV(q: FigureQuad, boundH: number): FigureQuad {
  return { ...q, offsetY: boundH - q.offsetY - q.cellHeight };
}

/**
 * Rotate a single group-member figure 90Â° CW around a group center (gcx, gcy).
 * Swaps bbox dimensions, moves position around the group center, and rotates
 * quad offsets. Mirror flags are preserved; identity anchors and transform-
 * cycle step are cleared â€” the figure is no longer at its cycle identity
 * position after a group rotation.
 */
export function rotateGroupMemberFigure90CW(
  fig: CompositionFigure,
  gcx: number,
  gcy: number,
): CompositionFigure {
  const oldRot = fig.rotation ?? 0;
  const newRot = ((oldRot + 90) % 360) as 0 | 90 | 180 | 270;
  const newW = fig.cellHeight;
  const newH = fig.cellWidth;

  const fcx = fig.cellX + fig.cellWidth / 2;
  const fcy = fig.cellY + fig.cellHeight / 2;
  const relX = fcx - gcx;
  const relY = fcy - gcy;
  // 90Â° CW in screen (y-down) coords: (x, y) -> (-y, x)
  const rotCx = gcx - relY;
  const rotCy = gcy + relX;
  const newCellX = Math.round(rotCx - newW / 2);
  const newCellY = Math.round(rotCy - newH / 2);

  const quads = fig.quads?.map(q => rotateQuad90CW(q, fig.cellHeight));

  return {
    ...fig,
    rotation: newRot,
    cellWidth: newW,
    cellHeight: newH,
    cellX: newCellX,
    cellY: newCellY,
    quads,
    identityCellX: undefined,
    identityCellY: undefined,
    transformCycleStep: undefined,
  };
}

/**
 * Rotate a single figure 90Â° CW around its identity center.
 * Mirrors what the live ROTATE_FIGURE reducer does â€” extracted so the editor
 * can compute and capture old/new quad and identity fields for the undo entry
 * without duplicating the math (and risking divergence between what the
 * reducer applies and what the undo entry records).
 */
export function rotateFigureIndividual90CW(fig: CompositionFigure): CompositionFigure {
  const cur = fig.rotation ?? 0;
  const next = ((cur + 90) % 360) as 0 | 90 | 180 | 270;
  const identityW = (cur === 90 || cur === 270) ? fig.cellHeight : fig.cellWidth;
  const identityH = (cur === 90 || cur === 270) ? fig.cellWidth : fig.cellHeight;
  const cx = fig.cellX + fig.cellWidth / 2;
  const cy = fig.cellY + fig.cellHeight / 2;
  const identityX = fig.identityCellX ?? Math.round(cx - identityW / 2);
  const identityY = fig.identityCellY ?? Math.round(cy - identityH / 2);
  const newW = fig.cellHeight;
  const newH = fig.cellWidth;
  const idCx = identityX + identityW / 2;
  const idCy = identityY + identityH / 2;
  const newCellX = Math.round(idCx - newW / 2);
  const newCellY = Math.round(idCy - newH / 2);
  const quads = fig.quads?.map(q => rotateQuad90CW(q, fig.cellHeight));
  return {
    ...fig,
    rotation: next,
    cellWidth: newW,
    cellHeight: newH,
    cellX: newCellX,
    cellY: newCellY,
    quads,
    identityCellX: identityX,
    identityCellY: identityY,
  };
}

/**
 * Mirror a single figure on one axis. Toggles the mirror flag and flips
 * any quad offsets within the figure's bbox. Used by both the reducer and
 * the editor (the editor calls it to capture old/new quads for undo).
 */
export function mirrorFigureIndividual(fig: CompositionFigure, axis: 'h' | 'v'): CompositionFigure {
  if (axis === 'h') {
    const quads = fig.quads?.map(q => mirrorQuadH(q, fig.cellWidth));
    return { ...fig, mirrorH: !(fig.mirrorH ?? false), quads };
  }
  const quads = fig.quads?.map(q => mirrorQuadV(q, fig.cellHeight));
  return { ...fig, mirrorV: !(fig.mirrorV ?? false), quads };
}

// â”€â”€ Orientation composition (figure rotation/mirror inside a group) â”€

type Orientation = { rotation: 0 | 90 | 180 | 270; mirrorH: boolean; mirrorV: boolean };

/** Convert an `(rotation, mirrorH, mirrorV)` triple to its 2x2 matrix.
 *  Convention: apply mirror flips first (about the local origin), then
 *  rotation, then translate (translate is handled separately by
 *  applyGroupTransform). 90Â° CW in screen y-down coords is `(x, y) â†’
 *  (-y, x)`; this corresponds to `[[cos, -sin], [sin, cos]]` evaluated
 *  with `(cos, sin) = (0, 1)`. */
function orientationToMatrix(o: Orientation): [number, number, number, number] {
  const mh = o.mirrorH ? -1 : 1;
  const mv = o.mirrorV ? -1 : 1;
  const cos = o.rotation === 0 ? 1 : o.rotation === 180 ? -1 : 0;
  const sin = o.rotation === 90 ? 1 : o.rotation === 270 ? -1 : 0;
  // R * Diag(mh, mv) â€” mirror then rotate, applied to a column vector.
  return [cos * mh, -sin * mv, sin * mh, cos * mv];
}

/** Decompose a 2x2 dihedral-group matrix back into `(rotation, mirrorH,
 *  mirrorV)`. The 16 input triples produce only 8 distinct matrices
 *  (e.g. `mirrorH && mirrorV && rotation=0` and `rotation=180` both give
 *  the negation matrix). The lookup order â€” fewer mirrors first, then
 *  smaller rotation â€” picks the most compact canonical form: a 180Â°
 *  flip decomposes as `(rotation: 180)` rather than the equivalent
 *  `(mirrorH: true, mirrorV: true)`, and a single horizontal flip stays
 *  `(rotation: 0, mirrorH: true)` rather than `(rotation: 180,
 *  mirrorV: true)`. Compact forms keep successive composes from drifting
 *  between equivalent representations. */
function matrixToOrientation(m: readonly [number, number, number, number]): Orientation {
  for (const [mh, mv] of [[false, false], [true, false], [false, true], [true, true]] as const) {
    for (const r of [0, 90, 180, 270] as const) {
      const c = orientationToMatrix({ rotation: r, mirrorH: mh, mirrorV: mv });
      if (c[0] === m[0] && c[1] === m[1] && c[2] === m[2] && c[3] === m[3]) {
        return { rotation: r, mirrorH: mh, mirrorV: mv };
      }
    }
  }
  // Unreachable for any valid dihedral matrix; shape it like rotation 0
  // to keep callers honest if a degenerate matrix ever leaks through.
  return { rotation: 0, mirrorH: false, mirrorV: false };
}

/** Compose the `outer` orientation onto an `inner` orientation, returning
 *  the world equivalent: `world = outer âˆ˜ inner` (apply inner first, then
 *  outer). Used to derive a grouped figure's world rotation/mirror from
 *  its `localRotation`/`localMirror*` composed with the group's own
 *  `rotation`/`mirror*`. */
export function composeOrientations(outer: Orientation, inner: Orientation): Orientation {
  const O = orientationToMatrix(outer);
  const I = orientationToMatrix(inner);
  const M: [number, number, number, number] = [
    O[0] * I[0] + O[1] * I[2], O[0] * I[1] + O[1] * I[3],
    O[2] * I[0] + O[3] * I[2], O[2] * I[1] + O[3] * I[3],
  ];
  return matrixToOrientation(M);
}

/** Apply the group's mirror + rotation to a figure's `localQuads`,
 *  walking through the same axis swaps `applyGroupTransform` does on the
 *  bbox. Each step uses the existing `mirrorQuadH/V` and `rotateQuad90CW`
 *  primitives; the bbox dimensions evolve as we go (rotation swaps W/H)
 *  so subsequent steps see the correct bound. Returns the new world
 *  quads laid out in the world bbox. */
export function transformQuadsByGroup(
  localQuads: ReadonlyArray<FigureQuad>,
  localBbox: { cellWidth: number; cellHeight: number },
  group: { rotation: 0 | 90 | 180 | 270; mirrorH: boolean; mirrorV: boolean },
): FigureQuad[] {
  let quads: FigureQuad[] = localQuads.map(q => ({ ...q }));
  let w = localBbox.cellWidth;
  let h = localBbox.cellHeight;
  if (group.mirrorH) quads = quads.map(q => mirrorQuadH(q, w));
  if (group.mirrorV) quads = quads.map(q => mirrorQuadV(q, h));
  const steps = group.rotation / 90;
  for (let i = 0; i < steps; i++) {
    quads = quads.map(q => rotateQuad90CW(q, h));
    const swap = w; w = h; h = swap;
  }
  return quads;
}

// â”€â”€ SVG rotate + mirror geometry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Center of a segment-derived bbox. Used as the rotation pivot for SVG
 *  rotates so 0Â° â†’ 90Â° â†’ 180Â° â†’ 270Â° â†’ 0Â° lands on the exact original
 *  position regardless of bbox parity. */
function bboxCenter(bb: { cellX: number; cellY: number; cellWidth: number; cellHeight: number }): [number, number] {
  return [bb.cellX + bb.cellWidth / 2, bb.cellY + bb.cellHeight / 2];
}

/** Rotate a 2D point 90Â° CW around `(cx, cy)` in screen-y-down coords. */
function rotatePointCW(x: number, y: number, cx: number, cy: number): [number, number] {
  const rx = x - cx, ry = y - cy;
  return [cx - ry, cy + rx];
}

/** Mirror a 2D point across the horizontal-axis (axis='h' flips x) or
 *  vertical-axis (axis='v' flips y) line through `(cx, cy)`. */
function mirrorPoint(x: number, y: number, axis: 'h' | 'v', cx: number, cy: number): [number, number] {
  return axis === 'h' ? [2 * cx - x, y] : [x, 2 * cy - y];
}

function rotateSegmentsCW(segments: ReadonlyArray<PathSegment>, cx: number, cy: number): PathSegment[] {
  return segments.map(seg => seg.kind === 'arc'
    ? { kind: 'arc', start: rotatePointCW(seg.start[0], seg.start[1], cx, cy), end: rotatePointCW(seg.end[0], seg.end[1], cx, cy), center: rotatePointCW(seg.center[0], seg.center[1], cx, cy) }
    : { kind: 'line', start: rotatePointCW(seg.start[0], seg.start[1], cx, cy), end: rotatePointCW(seg.end[0], seg.end[1], cx, cy) });
}

function mirrorSegments(segments: ReadonlyArray<PathSegment>, axis: 'h' | 'v', cx: number, cy: number): PathSegment[] {
  return segments.map(seg => seg.kind === 'arc'
    ? { kind: 'arc', start: mirrorPoint(seg.start[0], seg.start[1], axis, cx, cy), end: mirrorPoint(seg.end[0], seg.end[1], axis, cx, cy), center: mirrorPoint(seg.center[0], seg.center[1], axis, cx, cy) }
    : { kind: 'line', start: mirrorPoint(seg.start[0], seg.start[1], axis, cx, cy), end: mirrorPoint(seg.end[0], seg.end[1], axis, cx, cy) });
}

/** Rotate a single SVGObject 90Â° CW around its identity-segment bbox center.
 *  Uses the identity-stash stabilization pattern: stashes segments on first
 *  rotation, then always rebuilds from `identity + cumulative rotation` so
 *  0Â° â†’ 90Â° â†’ 180Â° â†’ 270Â° â†’ 0Â° lands exactly on the original. */
export function rotateSVG90CW(svg: SVGObject): SVGObject {
  const idSegs = svg.identitySegments ?? safeMapSegments(svg.segments, clonePathSegment) ?? [];
  const [cx, cy] = bboxCenter(computeSVGBbox(idSegs));
  const curRot = svg.rotation ?? 0;
  const curMH = svg.mirrorH ?? false;
  const curMV = svg.mirrorV ?? false;
  const newRot = ((curRot + 90) % 360) as 0 | 90 | 180 | 270;
  // Rebuild segments from identity following `mirrorSVG`'s recipe:
  // mirror H, mirror V, then rotate. Previously only rotation was applied,
  // which silently dropped the active mirror state from the segment data
  // â€” the mirrorH/V flag stayed set but the geometry no longer reflected
  // it, so rotating an imported SVG that arrived in a mirrored state
  // misaligned the contents on the very first rotation.
  let newSegs = safeMapSegments(idSegs, clonePathSegment) ?? [];
  if (curMH) newSegs = mirrorSegments(newSegs, 'h', cx, cy);
  if (curMV) newSegs = mirrorSegments(newSegs, 'v', cx, cy);
  const steps = newRot / 90;
  for (let i = 0; i < steps; i++) newSegs = rotateSegmentsCW(newSegs, cx, cy);
  // Identity is rotation=0 AND no mirrors â€” matches `mirrorSVG`'s
  // atIdentity check. A pure-rotation cycle through a mirrored SVG must
  // keep `identitySegments` stashed so subsequent rotations still pivot
  // around the original (un-mirrored, un-rotated) bbox center.
  const atIdentity = newRot === 0 && !curMH && !curMV;
  const newIdSegs = atIdentity ? undefined : idSegs;
  // Transform subpaths by the SINGLE-STEP delta from current state. The
  // main path rebuilds from `identitySegments`, but subpaths aren't
  // stashed â€” applying `steps` rotations from the already-rotated
  // current state would over-rotate by `steps - 1` per call (rotation
  // #2 ends up at 270Â° instead of 180Â°, and so on), which is what
  // misaligned the pieces of a joined design on cumulative rotates.
  // 90Â° rotation is exact integer arithmetic, so a 4Ã— cycle around the
  // same pivot lands exactly on the original. Non-array shapes (corrupt
  // loads, imports that bypassed migration) coerce to undefined so a
  // poisoned shape can never reach a `for...of` consumer and throw
  // "object is not iterable".
  const newSubpaths = Array.isArray(svg.subpaths) ? svg.subpaths.map(sub => {
    const segs = rotateSegmentsCW(safeMapSegments(sub.segments, clonePathSegment) ?? [], cx, cy);
    return { ...sub, segments: segs };
  }) : undefined;
  // Tile-mode region preservation. For tile-mode SVGs the segments only
  // carry one pattern unit, so `computeSVGBbox(newSegs)` would collapse
  // `cellX/Y/Width/Height` down to that unit. Instead, swap region W/H
  // around the current center using the same identity-stash pattern as
  // `rotateFigureIndividual90CW` so 4Ã—90Â° lands exactly on the original.
  if (svg.tileMode === 'repeat') {
    const identityW = (curRot === 90 || curRot === 270) ? svg.cellHeight : svg.cellWidth;
    const identityH = (curRot === 90 || curRot === 270) ? svg.cellWidth  : svg.cellHeight;
    const rcx = svg.cellX + svg.cellWidth / 2;
    const rcy = svg.cellY + svg.cellHeight / 2;
    const identityX = svg.identityCellX ?? Math.round(rcx - identityW / 2);
    const identityY = svg.identityCellY ?? Math.round(rcy - identityH / 2);
    const newW = svg.cellHeight;
    const newH = svg.cellWidth;
    const idCx = identityX + identityW / 2;
    const idCy = identityY + identityH / 2;
    const newCellX = Math.round(idCx - newW / 2);
    const newCellY = Math.round(idCy - newH / 2);
    // Tile cell dimensions swap to track the rotated design â€” the
    // renderer (CompositionSVGLayer.applyTiledSVGObject) packs segments
    // into a `tileWidthL0 Ã— tileHeightL0` cell, so if the tile dims
    // don't swap, a rotated 40Ã—32 design gets crammed into the original
    // 32Ã—40 cell and the pattern visibly misaligns.
    const newTileW = svg.tileHeightL0;
    const newTileH = svg.tileWidthL0;
    // Rotate the tile-grid world origin (cellX + ox, cellY + oy) around
    // the region center; subtracting the new region origin yields the
    // new in-region offset. Derivation collapses to a clean swap+flip:
    //   newOx = oldCellHeight - oldOy ; newOy = oldOx.
    // 4 rotations return both back to the originals (verified by the
    // 4Ã—-cycle test in rotateMirrorNode.test.ts).
    const oldOx = svg.tileOffsetXL0 ?? 0;
    const oldOy = svg.tileOffsetYL0 ?? 0;
    const newOx = svg.cellHeight - oldOy;
    const newOy = oldOx;
    const rotated: SVGObject = { ...svg, segments: newSegs, subpaths: newSubpaths, rotation: newRot, identitySegments: newIdSegs,
      cellX: newCellX, cellY: newCellY, cellWidth: newW, cellHeight: newH,
      tileWidthL0: newTileW, tileHeightL0: newTileH,
      tileOffsetXL0: newOx === 0 ? undefined : newOx,
      tileOffsetYL0: newOy === 0 ? undefined : newOy,
      identityCellX: atIdentity ? undefined : identityX,
      identityCellY: atIdentity ? undefined : identityY,
      localSegments: undefined, localCellX: undefined, localCellY: undefined, localCellWidth: undefined, localCellHeight: undefined };
    // Re-key per-copy paint: the whole pattern block rotates rigidly about the
    // region center (invariant under 90Â° rotation), so map each painted copy's
    // tile-center through that rotation onto the post-rotation grid.
    if (svg.segmentOverrides && svg.segmentOverrides.size > 0) {
      const rcx = svg.cellX + svg.cellWidth / 2;
      const rcy = svg.cellY + svg.cellHeight / 2;
      rotated.segmentOverrides = remapOverrides(svg.segmentOverrides, svg, rotated,
        (x, y) => { const [nx, ny] = rotatePointCW(x, y, rcx, rcy); return { x: nx, y: ny }; });
    }
    return rotated;
  }
  // H/V line metadata follows the geometry. The rotation pivot is the
  // identity bbox center, which for a creation-tool line is the line's own
  // midpoint — also the creationBox's center (the box straddles the line) —
  // so the rotated box is the same box with width/height swapped about its
  // center. Direction swaps H ↔ V; diagonal is invariant.
  let rotatedCreationBox = svg.creationBox;
  if (svg.creationBox) {
    const cb = svg.creationBox;
    const bcx = cb.minX + cb.width / 2;
    const bcy = cb.minY + cb.height / 2;
    rotatedCreationBox = { minX: bcx - cb.height / 2, minY: bcy - cb.width / 2, width: cb.height, height: cb.width };
  }
  const rotatedLineDirection = svg.lineDirection === 'horizontal' ? 'vertical' as const
    : svg.lineDirection === 'vertical' ? 'horizontal' as const
    : svg.lineDirection;
  return { ...svg, segments: newSegs, subpaths: newSubpaths, rotation: newRot, identitySegments: newIdSegs, ...computeSVGBbox(newSegs),
    creationBox: rotatedCreationBox, lineDirection: rotatedLineDirection,
    localSegments: undefined, localCellX: undefined, localCellY: undefined, localCellWidth: undefined, localCellHeight: undefined };
}

/** Mirror a single SVGObject on a screen axis. Uses the identity-stash
 *  stabilization pattern and screenâ†’local axis remapping. */
export function mirrorSVG(svg: SVGObject, screenAxis: 'h' | 'v'): SVGObject {
  const idSegs = svg.identitySegments ?? safeMapSegments(svg.segments, clonePathSegment) ?? [];
  const [cx, cy] = bboxCenter(computeSVGBbox(idSegs));
  const curRot = svg.rotation ?? 0;
  const curMH = svg.mirrorH ?? false;
  const curMV = svg.mirrorV ?? false;
  const localAxis = screenToLocalFlipAxis(curRot, screenAxis);
  const newMH = localAxis === 'h' ? !curMH : curMH;
  const newMV = localAxis === 'v' ? !curMV : curMV;
  let newSegs = safeMapSegments(idSegs, clonePathSegment) ?? [];
  if (newMH) newSegs = mirrorSegments(newSegs, 'h', cx, cy);
  if (newMV) newSegs = mirrorSegments(newSegs, 'v', cx, cy);
  const steps = curRot / 90;
  for (let i = 0; i < steps; i++) newSegs = rotateSegmentsCW(newSegs, cx, cy);
  const atIdentity = curRot === 0 && !newMH && !newMV;
  const newIdSegs = atIdentity ? undefined : idSegs;
  // Transform subpaths by the SINGLE-STEP delta from current state. The
  // main path rebuilds from `identitySegments` and re-applies the full
  // (newMH, newMV, curRot) recipe; applying the same recipe on top of
  // the already-transformed subpath state would compose toggles instead
  // of replacing them (e.g. two H-mirrors return main to identity but
  // leave subpaths still mirrored). Applying ONE mirror across the
  // *screen* axis around the same pivot is equivalent â€” the conjugation
  // identity `R âˆ˜ M_local âˆ˜ Râ»Â¹ = M_screen` means a screen-axis mirror
  // applied to the rotated subpath state lands at the same place as
  // local-axis-mirror-then-rotate from identity. Mirror is exact integer
  // arithmetic, so two mirrors on the same axis return exactly to
  // identity. Non-array subpaths coerce to undefined (see rotateSVG90CW).
  const newSubpaths = Array.isArray(svg.subpaths) ? svg.subpaths.map(sub => {
    const segs = mirrorSegments(safeMapSegments(sub.segments, clonePathSegment) ?? [], screenAxis, cx, cy);
    return { ...sub, segments: segs };
  }) : undefined;
  // Tile-mode: region must NOT change on mirror (matches mirrorFigureIndividual,
  // which leaves cellX/Y/Width/Height untouched). The default branch's
  // `computeSVGBbox(newSegs)` would collapse the region to the AABB of one
  // tile, so skip it here.
  if (svg.tileMode === 'repeat') {
    // Tile-grid origin mirrors across the screen axis through the
    // region center, so the rendered pattern flips together with the
    // segments. Screen 'h' mirrors X around (cellX + cellW/2); screen
    // 'v' mirrors Y around (cellY + cellH/2). Tile dimensions don't
    // change on mirror.
    const oldOx = svg.tileOffsetXL0 ?? 0;
    const oldOy = svg.tileOffsetYL0 ?? 0;
    const newOx = screenAxis === 'h' ? svg.cellWidth  - oldOx : oldOx;
    const newOy = screenAxis === 'v' ? svg.cellHeight - oldOy : oldOy;
    const mirrored: SVGObject = { ...svg, segments: newSegs, subpaths: newSubpaths, mirrorH: newMH, mirrorV: newMV, identitySegments: newIdSegs,
      tileOffsetXL0: newOx === 0 ? undefined : newOx,
      tileOffsetYL0: newOy === 0 ? undefined : newOy,
      localSegments: undefined, localCellX: undefined, localCellY: undefined, localCellWidth: undefined, localCellHeight: undefined };
    // Re-key per-copy paint: the pattern block flips about the region center
    // across the screen axis; map each painted copy's tile-center accordingly.
    if (svg.segmentOverrides && svg.segmentOverrides.size > 0) {
      const rcx = svg.cellX + svg.cellWidth / 2;
      const rcy = svg.cellY + svg.cellHeight / 2;
      mirrored.segmentOverrides = remapOverrides(svg.segmentOverrides, svg, mirrored,
        (x, y) => screenAxis === 'h' ? { x: 2 * rcx - x, y } : { x, y: 2 * rcy - y });
    }
    return mirrored;
  }
  return { ...svg, segments: newSegs, subpaths: newSubpaths, mirrorH: newMH, mirrorV: newMV, identitySegments: newIdSegs, ...computeSVGBbox(newSegs),
    localSegments: undefined, localCellX: undefined, localCellY: undefined, localCellWidth: undefined, localCellHeight: undefined };
}

/**
 * Apply a target transform cycle step to a figure, starting from identity.
 * Returns a new figure with the correct rotation, mirror, dimensions, position, and quads.
 */
export function cycleTransformForFigure(fig: CompositionFigure, targetStep: number): CompositionFigure {
  const step = TRANSFORM_CYCLE[targetStep];

  // Recover identity dimensions from current rotation state
  const curRot = fig.rotation ?? 0;
  const identityW = (curRot === 90 || curRot === 270) ? fig.cellHeight : fig.cellWidth;
  const identityH = (curRot === 90 || curRot === 270) ? fig.cellWidth : fig.cellHeight;

  // Use stored identity position if available; otherwise recover it from the
  // current center so we always compute new positions from a stable reference.
  // This prevents rounding drift when rotating figures with mixed odd/even
  // dimensions (e.g. 3x4) where the center falls on x.5.
  const cx = fig.cellX + fig.cellWidth / 2;
  const cy = fig.cellY + fig.cellHeight / 2;
  const identityX = fig.identityCellX ?? Math.round(cx - identityW / 2);
  const identityY = fig.identityCellY ?? Math.round(cy - identityH / 2);

  // Recover identity quads: reverse current transforms to get back to identity
  let baseQuads = fig.quads;
  if (baseQuads) {
    // Undo current mirror first (mirrors are self-inverse)
    if (fig.mirrorV) baseQuads = baseQuads.map(q => mirrorQuadV(q, fig.cellHeight));
    if (fig.mirrorH) baseQuads = baseQuads.map(q => mirrorQuadH(q, fig.cellWidth));
    // Undo current rotation (rotate back by curRot)
    // Rotate 90 CW (360-curRot)/90 times to undo
    const undoSteps = curRot === 0 ? 0 : (360 - curRot) / 90;
    let bw = fig.cellWidth;
    let bh = fig.cellHeight;
    for (let i = 0; i < undoSteps; i++) {
      baseQuads = baseQuads.map(q => rotateQuad90CW(q, bh));
      const tmp = bw; bw = bh; bh = tmp;
    }
  }

  // Now apply the target transform from identity
  let newW = identityW;
  let newH = identityH;
  let quads = baseQuads;

  // Apply rotation
  const rotSteps = step.rotation / 90;
  for (let i = 0; i < rotSteps; i++) {
    if (quads) quads = quads.map(q => rotateQuad90CW(q, newH));
    const tmp = newW; newW = newH; newH = tmp;
  }

  // Apply mirrors
  if (step.mirrorH && quads) quads = quads.map(q => mirrorQuadH(q, newW));
  if (step.mirrorV && quads) quads = quads.map(q => mirrorQuadV(q, newH));

  // Re-center around the stable identity center
  const idCx = identityX + identityW / 2;
  const idCy = identityY + identityH / 2;
  const newCellX = Math.round(idCx - newW / 2);
  const newCellY = Math.round(idCy - newH / 2);

  return {
    ...fig,
    rotation: step.rotation,
    mirrorH: step.mirrorH,
    mirrorV: step.mirrorV,
    cellWidth: newW,
    cellHeight: newH,
    cellX: newCellX,
    cellY: newCellY,
    quads,
    transformCycleStep: targetStep,
    identityCellX: identityX,
    identityCellY: identityY,
  };
}

function applyOp(state: CompositionState, op: CompUndoOp): CompositionState {
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
      return state;
    }
    case 'groupFigures': {
      const childGroupSet = new Set(op.childGroupIds ?? []);
      // Items in child groups are NOT modified â€” only their GroupNode gets
      // a parentGroupId. figureIds contains only loose items (not in any
      // child group).
      const looseIdSet = new Set(op.figureIds);
      // The first loose item carries the group display name.
      const namedNodeId = op.figureIds[0];
      const figures = state.figures.map((f) => {
        if (!looseIdSet.has(f.id)) return f;
        return {
          ...f,
          groupId: op.groupId,
          preGroupName: f.name,
          name: f.id === namedNodeId ? op.groupName : undefined,
          localCellX: f.cellX,
          localCellY: f.cellY,
          localCellWidth: f.cellWidth,
          localCellHeight: f.cellHeight,
          localTileWidthL0: f.tileMode === 'repeat' ? f.tileWidthL0 : undefined,
          localTileHeightL0: f.tileMode === 'repeat' ? f.tileHeightL0 : undefined,
          localTileOffsetXL0: f.tileMode === 'repeat' ? f.tileOffsetXL0 : undefined,
          localTileOffsetYL0: f.tileMode === 'repeat' ? f.tileOffsetYL0 : undefined,
          localRotation: f.rotation ?? 0,
          localMirrorH: f.mirrorH ?? false,
          localMirrorV: f.mirrorV ?? false,
          localQuads: f.quads?.map(q => ({ ...q })),
        };
      });
      const svgObjects = state.svgObjects.map((s) => {
        if (!looseIdSet.has(s.id)) return s;
        return {
          ...s,
          groupId: op.groupId,
          preGroupName: s.name,
          name: s.id === namedNodeId ? op.groupName : undefined,
          localSegments: safeMapSegments(s.segments, clonePathSegment) ?? [],
          // At identity-transform group creation, world == local. Cloning
          // the subpaths into localSubpaths keeps both forms in sync so
          // future group transforms can re-derive subpaths from locals.
          localSubpaths: safeMapSubpaths(s.subpaths, clonePathSegment),
          localCellX: s.cellX,
          localCellY: s.cellY,
          localCellWidth: s.cellWidth,
          localCellHeight: s.cellHeight,
        };
      });
      const images = (state.images ?? []).map((i) => {
        if (!looseIdSet.has(i.id)) return i;
        return {
          ...i,
          groupId: op.groupId,
          preGroupName: i.name,
          name: i.id === namedNodeId ? op.groupName : undefined,
          localCellX: i.cellX,
          localCellY: i.cellY,
          localCellWidth: i.cellWidth,
          localCellHeight: i.cellHeight,
        };
      });
      const texts = (state.texts ?? []).map((t) => {
        if (!looseIdSet.has(t.id)) return t;
        return {
          ...t,
          groupId: op.groupId,
          preGroupName: t.name,
          name: t.id === namedNodeId ? op.groupName : undefined,
          localCellX: t.cellX,
          localCellY: t.cellY,
          localCellWidth: t.cellWidth,
          localCellHeight: t.cellHeight,
        };
      });
      // Nest child groups by setting parentGroupId, saving their name.
      let groups: GroupNode[] = state.groups.map((g) => {
        if (!childGroupSet.has(g.id)) return g;
        return { ...g, parentGroupId: op.groupId, preGroupName: g.name };
      });
      // Add the new GroupNode unless it already exists.
      const existing = groups.some(g => g.id === op.groupId);
      if (!existing) {
        groups = [
          ...groups,
          { id: op.groupId, name: op.groupName, translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false, ...(op.isFrame ? { isFrame: true as const } : null) },
        ];
      }
      // Re-cluster members in sceneOrder so the new group is contiguous.
      return reflowSceneOrderForGroups({ ...state, figures, svgObjects, images, texts, groups });
    }
    case 'ungroupFigures': {
      const ungroupNode = state.groups.find(g => g.id === op.groupId);
      const childGroupSet = new Set(op.childGroupIds ?? []);
      // Only ungroup loose members (directly in this group, not in a child group).
      const figures = state.figures.map((f) =>
        f.groupId === op.groupId ? {
          ...f,
          groupId: undefined,
          name: f.preGroupName,
          preGroupName: undefined,
          localCellX: undefined,
          localCellY: undefined,
          localCellWidth: undefined,
          localCellHeight: undefined,
          localTileWidthL0: undefined,
          localTileHeightL0: undefined,
          localTileOffsetXL0: undefined,
          localTileOffsetYL0: undefined,
          localRotation: undefined,
          localMirrorH: undefined,
          localMirrorV: undefined,
          localQuads: undefined,
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
          name: s.preGroupName,
          preGroupName: undefined,
          localSegments: undefined,
          localSubpaths: undefined,
          localCellX: undefined,
          localCellY: undefined,
          localCellWidth: undefined,
          localCellHeight: undefined,
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
      const images = (state.images ?? []).map((i) =>
        i.groupId === op.groupId ? {
          ...i,
          groupId: undefined,
          name: i.preGroupName,
          preGroupName: undefined,
          localCellX: undefined,
          localCellY: undefined,
          localCellWidth: undefined,
          localCellHeight: undefined,
          identityCellX: undefined,
          identityCellY: undefined,
          identityCellWidth: undefined,
          identityCellHeight: undefined,
          rotation: undefined,
          mirrorH: undefined,
          mirrorV: undefined,
        } : i
      );
      const texts = (state.texts ?? []).map((t) =>
        t.groupId === op.groupId ? {
          ...t,
          groupId: undefined,
          name: t.preGroupName,
          preGroupName: undefined,
          localCellX: undefined,
          localCellY: undefined,
          localCellWidth: undefined,
          localCellHeight: undefined,
          identityCellX: undefined,
          identityCellY: undefined,
          identityCellWidth: undefined,
          identityCellHeight: undefined,
          rotation: undefined,
          mirrorH: undefined,
          mirrorV: undefined,
        } : t
      );
      // Detach child groups from the parent and restore their names.
      let groups = state.groups.map((g) => {
        if (!childGroupSet.has(g.id)) return g;
        return { ...g, parentGroupId: undefined, name: g.preGroupName ?? g.name, preGroupName: undefined };
      });
      // Remove the outer GroupNode itself.
      groups = groups.filter(g => g.id !== op.groupId);
      // Reconcile locals ONLY for members of detached child groups: their
      // local coords were relative to the old chain (child + removed
      // parent). Without this, the first materializeGroupMembers call
      // (e.g. on move) recomputes world from stale locals through the
      // shortened chain, producing wrong positions. We target only the
      // affected groups to avoid perturbing unrelated items.
      const result: CompositionState = { ...state, figures, svgObjects, images, texts, groups };
      if (childGroupSet.size === 0) return result;
      // Collect all group IDs that descend from the detached children.
      const affectedGroupIds = new Set<string>();
      for (const cid of childGroupSet) {
        affectedGroupIds.add(cid);
        for (const d of descendantGroupIds(groups, cid)) affectedGroupIds.add(d);
      }
      return reconcileGroupLocalsForGroups(result, affectedGroupIds, ungroupNode);
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
        // Reconcile the moved group + all its descendants against the new chain.
        const affected = new Set<string>([op.nodeId, ...descendantGroupIds(groups, op.nodeId)]);
        next = reconcileGroupLocalsForGroups(next, affected);
      } else if (newParent) {
        // Leaf into a group: set groupId, then reconcile that group's members
        // so the moved leaf's local coords match the new chain (world kept).
        next = setLeafGroupId(state, op.nodeId, newParent);
        next = reconcileGroupLocalsForGroups(next, new Set([newParent]));
      } else {
        // Leaf out to top level: clear membership + local coords.
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
    case 'transformGroup': {
      // Set the GroupNode's transform to the new* values, then materialize
      // every member's world coords from the updated transform composed
      // with the unchanged local coords.
      const groups = state.groups.map((g) =>
        g.id === op.groupId ? {
          ...g,
          translateX: op.newTranslateX, translateY: op.newTranslateY,
          scaleX: op.newScaleX, scaleY: op.newScaleY,
          rotation: op.newRotation,
          mirrorH: op.newMirrorH, mirrorV: op.newMirrorV,
        } : g
      );
      return materializeGroupMembers({ ...state, groups }, op.groupId);
    }
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
            ...(op.newLocalSegments !== undefined
              ? (op.newLocalSegments === null
                ? { localSegments: undefined, localCellX: undefined, localCellY: undefined, localCellWidth: undefined, localCellHeight: undefined }
                : { localSegments: op.newLocalSegments, ...localBboxFromSegments(op.newLocalSegments) })
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
              ? { tileOffsetYL0: op.newTileOffsetYL0 === 0 ? undefined : op.newTileOffsetYL0 } : null) }
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
        opacity: op.newOpacity,
        identityCellX: op.newIdentityCellX,
        identityCellY: op.newIdentityCellY,
        identityCellWidth: op.newIdentityCellWidth,
        identityCellHeight: op.newIdentityCellHeight,
        localCellX: op.newLocalCellX,
        localCellY: op.newLocalCellY,
        localCellWidth: op.newLocalCellWidth,
        localCellHeight: op.newLocalCellHeight,
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
      // When the result inherits a groupId (Expand-figure case), back-fill
      // localCell* / localSegments from world coords so the group
      // materialization pipeline can re-derive world coords correctly on
      // subsequent group transforms.
      return op.result.groupId ? reconcileGroupLocals(next) : next;
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
      return reconcileGroupLocals(merged);
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
    case 'setCanvasPaint':
      return { ...state, canvasPaint: op.newLayer };
    case 'cleanupLibrary':
      return state;
    default:
      return state;
  }
}

function revertOp(state: CompositionState, op: CompUndoOp): CompositionState {
  switch (op.op) {
    case 'placeFigure':
      return applyOp(state, { op: 'removeObject', kind: 'figure', item: op.figure });
    case 'placeObject':
      return applyOp(state, { op: 'removeObject', kind: op.kind, item: op.item });
    case 'removeObject':
      // Re-insert the deleted item at the end of its kind's array (array
      // order is not user-visible â€” only sceneOrder is), and splice the id
      // back into sceneOrder at its captured pre-delete index so the scene
      // outline / z-position is restored.
      return applyOp(state, {
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
      return applyOp(state, { op: 'mirrorFigure', figureId: op.figureId, axis: op.axis,
        oldValue: op.newValue, newValue: op.oldValue, oldQuads: op.newQuads, newQuads: op.oldQuads });
    case 'lockObject':
      return applyOp(state, { op: 'lockObject', id: op.id, oldValue: op.newValue, newValue: op.oldValue });
    case 'lockGroup':
      return applyOp(state, { op: 'lockGroup', id: op.id, oldValue: op.newValue, newValue: op.oldValue });
    case 'setObjectHidden':
      return applyOp(state, { op: 'setObjectHidden', id: op.id, oldValue: op.newValue, newValue: op.oldValue });
    case 'hideGroup':
      return applyOp(state, { op: 'hideGroup', id: op.id, oldValue: op.newValue, newValue: op.oldValue });
    case 'setNodeRotation':
      return setNodeAngleDeg(state, op.id, op.oldAngleDeg);
    case 'reorderObjects':
      return applySceneOrder(state, op.oldOrder);
    case 'renameFigure':
      return applyOp(state, {
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
      return applyOp(state, {
        op: 'syncDimensions', figureId: op.figureId,
        oldResolutionX: op.newResolutionX, oldResolutionY: op.newResolutionY,
        newResolutionX: op.oldResolutionX, newResolutionY: op.oldResolutionY,
        oldCellWidth: op.newCellWidth, oldCellHeight: op.newCellHeight,
        newCellWidth: op.oldCellWidth, newCellHeight: op.oldCellHeight,
      });
    case 'toggleRepeat':
      return applyOp(state, {
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
    case 'groupFigures': {
      // Undo group: clear groupId, identity, locals, and restore original
      // names. Also remove the GroupNode and detach any child groups.
      const revertGroup = state.groups.find(g => g.id === op.groupId);
      const childGroupSet = new Set(op.childGroupIds ?? []);
      const idSet = new Set(op.figureIds);
      const figures = state.figures.map((f) => {
        if (!idSet.has(f.id)) return f;
        const idx = op.figureIds.indexOf(f.id);
        return {
          ...f,
          groupId: undefined,
          name: op.oldNames[idx],
          preGroupName: undefined,
          localCellX: undefined,
          localCellY: undefined,
          localCellWidth: undefined,
          localCellHeight: undefined,
          localTileWidthL0: undefined,
          localTileHeightL0: undefined,
          localTileOffsetXL0: undefined,
          localTileOffsetYL0: undefined,
          localRotation: undefined,
          localMirrorH: undefined,
          localMirrorV: undefined,
          localQuads: undefined,
          identityCellX: undefined,
          identityCellY: undefined,
          transformCycleStep: undefined,
        };
      });
      const svgObjects = state.svgObjects.map((s) => {
        if (!idSet.has(s.id)) return s;
        const idx = op.figureIds.indexOf(s.id);
        return {
          ...s,
          groupId: undefined,
          name: op.oldNames[idx],
          preGroupName: undefined,
          localSegments: undefined,
          localCellX: undefined,
          localCellY: undefined,
          localCellWidth: undefined,
          localCellHeight: undefined,
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
      // exists. `preGroupName` is the same original name `oldNames` carries;
      // it backs the entry up when a caller built the op without those slots.
      const images = (state.images ?? []).map((i) => {
        if (!idSet.has(i.id)) return i;
        return {
          ...i,
          groupId: undefined,
          name: op.oldNames[op.figureIds.indexOf(i.id)] ?? i.preGroupName,
          preGroupName: undefined,
          localCellX: undefined,
          localCellY: undefined,
          localCellWidth: undefined,
          localCellHeight: undefined,
          identityCellX: undefined,
          identityCellY: undefined,
          identityCellWidth: undefined,
          identityCellHeight: undefined,
          rotation: undefined,
          mirrorH: undefined,
          mirrorV: undefined,
        };
      });
      const texts = (state.texts ?? []).map((t) => {
        if (!idSet.has(t.id)) return t;
        return {
          ...t,
          groupId: undefined,
          name: op.oldNames[op.figureIds.indexOf(t.id)] ?? t.preGroupName,
          preGroupName: undefined,
          localCellX: undefined,
          localCellY: undefined,
          localCellWidth: undefined,
          localCellHeight: undefined,
          identityCellX: undefined,
          identityCellY: undefined,
          identityCellWidth: undefined,
          identityCellHeight: undefined,
          rotation: undefined,
          mirrorH: undefined,
          mirrorV: undefined,
        };
      });
      // Detach child groups (restore name from preGroupName, clear parentGroupId).
      let groups = state.groups.map((g) => {
        if (!childGroupSet.has(g.id)) return g;
        return { ...g, parentGroupId: undefined, name: g.preGroupName ?? g.name, preGroupName: undefined };
      });
      groups = groups.filter(g => g.id !== op.groupId);
      const ungroupResult: CompositionState = { ...state, figures, svgObjects, images, texts, groups };
      if (childGroupSet.size === 0) return ungroupResult;
      const affectedGroupIds = new Set<string>();
      for (const cid of childGroupSet) {
        affectedGroupIds.add(cid);
        for (const d of descendantGroupIds(groups, cid)) affectedGroupIds.add(d);
      }
      return reconcileGroupLocalsForGroups(ungroupResult, affectedGroupIds, revertGroup);
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
        oldNames: op.figureIds.map(id => {
          const fig = state.figures.find(f => f.id === id);
          if (fig) return fig.name;
          return state.svgObjects.find(s => s.id === id)?.name;
        }),
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
      // groupFigures sets local = world (identity assumption). When the
      // restored group has a non-identity transform, reconcile locals so
      // they're correct for the restored chain. Target only the re-grouped
      // items and any child groups to avoid perturbing unrelated items.
      if (op.savedTranslateX === undefined) return restoreMasks(regrouped);
      const affected = new Set<string>([op.groupId]);
      for (const cid of op.childGroupIds ?? []) {
        affected.add(cid);
        for (const d of descendantGroupIds(regrouped.groups, cid)) affected.add(d);
      }
      return restoreMasks(reconcileGroupLocalsForGroups(regrouped, affected));
    }
    case 'reparentNode': {
      // Restore the exact prior records (membership + local caches) and order.
      // The snapshots carry correct world coords, so no re-materialization.
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
        groups: byId(state.groups, op.prevGroups),
        sceneOrder: [...op.oldSceneOrder],
      };
    }
    case 'renameGroup':
      return applyOp(state, { op: 'renameGroup', groupId: op.groupId, oldName: op.newName, newName: op.oldName });
    case 'removeGroup': {
      // Skip if a re-add already happened (e.g., a regroup op earlier in
      // the entry restored the same id) to avoid duplicate GroupNodes.
      if (state.groups.some((g) => g.id === op.group.id)) return state;
      return { ...state, groups: [...state.groups, op.group] };
    }
    case 'transformGroup': {
      const groups = state.groups.map((g) =>
        g.id === op.groupId ? {
          ...g,
          translateX: op.oldTranslateX, translateY: op.oldTranslateY,
          scaleX: op.oldScaleX, scaleY: op.oldScaleY,
          rotation: op.oldRotation,
          mirrorH: op.oldMirrorH, mirrorV: op.oldMirrorV,
        } : g
      );
      return materializeGroupMembers({ ...state, groups }, op.groupId);
    }
    case 'createSVG':
      return applyOp(state, { op: 'removeObject', kind: 'svg', item: op.svg });
    case 'editSVGSegments':
      return applyOp(state, { op: 'editSVGSegments', svgId: op.svgId,
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
        oldTileOffsetYL0: op.newTileOffsetYL0, newTileOffsetYL0: op.oldTileOffsetYL0 });
    case 'renameSVG':
      return applyOp(state, { op: 'renameSVG', svgId: op.svgId, oldName: op.newName, newName: op.oldName });
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
      return applyOp(state, { op: 'setFillColor', svgId: op.svgId,
        oldFillColor: op.newFillColor, newFillColor: op.oldFillColor,
        oldFillOpacity: op.newFillOpacity, newFillOpacity: op.oldFillOpacity });
    case 'setMaskMode':
      return applyOp(state, { op: 'setMaskMode', svgId: op.svgId,
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
      return applyOp(state, { op: 'editImage', imageId: op.imageId,
        oldCellX: op.newCellX, oldCellY: op.newCellY, oldCellWidth: op.newCellWidth, oldCellHeight: op.newCellHeight,
        newCellX: op.oldCellX, newCellY: op.oldCellY, newCellWidth: op.oldCellWidth, newCellHeight: op.oldCellHeight,
        oldRotation: op.newRotation, newRotation: op.oldRotation,
        oldMirrorH: op.newMirrorH, newMirrorH: op.oldMirrorH,
        oldMirrorV: op.newMirrorV, newMirrorV: op.oldMirrorV,
        oldOpacity: op.newOpacity, newOpacity: op.oldOpacity,
        oldIdentityCellX: op.newIdentityCellX, newIdentityCellX: op.oldIdentityCellX,
        oldIdentityCellY: op.newIdentityCellY, newIdentityCellY: op.oldIdentityCellY,
        oldIdentityCellWidth: op.newIdentityCellWidth, newIdentityCellWidth: op.oldIdentityCellWidth,
        oldIdentityCellHeight: op.newIdentityCellHeight, newIdentityCellHeight: op.oldIdentityCellHeight,
        oldLocalCellX: op.newLocalCellX, newLocalCellX: op.oldLocalCellX,
        oldLocalCellY: op.newLocalCellY, newLocalCellY: op.oldLocalCellY,
        oldLocalCellWidth: op.newLocalCellWidth, newLocalCellWidth: op.oldLocalCellWidth,
        oldLocalCellHeight: op.newLocalCellHeight, newLocalCellHeight: op.oldLocalCellHeight,
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
      return applyOp(state, { op: 'replaceScene',
        oldFigures: op.newFigures, newFigures: op.oldFigures,
        oldSVGObjects: op.newSVGObjects, newSVGObjects: op.oldSVGObjects,
        oldImages: op.newImages, newImages: op.oldImages,
        oldGroups: op.newGroups, newGroups: op.oldGroups,
        oldSceneOrder: op.newSceneOrder, newSceneOrder: op.oldSceneOrder,
        oldTexts: op.newTexts, newTexts: op.oldTexts });
    case 'setText':
      return applyOp(state, { ...op,
        oldContent: op.newContent, newContent: op.oldContent,
        oldCellWidth: op.newCellWidth, newCellWidth: op.oldCellWidth,
        oldCellHeight: op.newCellHeight, newCellHeight: op.oldCellHeight,
        oldCellX: op.newCellX, newCellX: op.oldCellX,
        oldCellY: op.newCellY, newCellY: op.oldCellY });
    case 'setTextStyle':
      return applyOp(state, { ...op,
        oldStyle: op.newStyle, newStyle: op.oldStyle,
        oldCellWidth: op.newCellWidth, newCellWidth: op.oldCellWidth,
        oldCellHeight: op.newCellHeight, newCellHeight: op.oldCellHeight,
        oldCellX: op.newCellX, newCellX: op.oldCellX,
        oldCellY: op.newCellY, newCellY: op.oldCellY });
    case 'setNodeEffects':
      return applyOp(state, { ...op, oldEffects: op.newEffects, newEffects: op.oldEffects });
    case 'setFillPaint':
      return applyOp(state, { ...op, oldPaint: op.newPaint, newPaint: op.oldPaint });
    case 'setImageTint':
      return applyOp(state, { ...op, oldTint: op.newTint, newTint: op.oldTint });
    case 'setBackground':
      return applyOp(state, { ...op, oldPaint: op.newPaint, newPaint: op.oldPaint });
    case 'setCanvasPaint':
      return applyOp(state, { ...op, oldLayer: op.newLayer, newLayer: op.oldLayer });
    case 'cleanupLibrary':
      return state;
    default:
      return state;
  }
}

/** Apply a composition undo entry forward (for redo) */
export function applyCompOps(state: CompositionState, entry: CompUndoEntry): CompositionState {
  let result = state;
  for (const op of entry) {
    result = applyOp(result, op);
  }
  return result;
}

/** Revert a composition undo entry (for undo) */
export function revertCompOps(state: CompositionState, entry: CompUndoEntry): CompositionState {
  let result = state;
  // Revert in reverse order
  for (let i = entry.length - 1; i >= 0; i--) {
    result = revertOp(result, entry[i]);
  }
  return result;
}
