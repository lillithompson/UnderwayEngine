/**
 * The QUARTER TURN and the transform cycle, for a figure and for an svg.
 *
 * The legacy right-angle vocabulary: rotate 90° CW, mirror on an axis, and
 * the seven-step cycle the transform button walks. It works on the per-kind
 * ARRAYS in cell coordinates — a figure's `rotation`/`mirrorH`/`mirrorV`
 * plus its quads, an svg's rotation flags plus its actual segments — which
 * is why it is separate from the scene graph's free-angle matrix math in
 * `sceneTransform`. A quarter turn is the one pose both spellings agree on.
 *
 * Two things here are load-bearing and easy to break:
 *
 * - `identity*` is NOT a cache. `placeAboutIdentityCentre` recovers the
 *   AUTHORED origin and places every step about that one reference rather
 *   than about the previous step, which is what makes 4×90° (and the full
 *   cycle) land back exactly where it started. Deleting it drifts the shape
 *   on figures with mixed odd/even dimensions, where the centre falls on
 *   x.5. P6-B took every `local*` field around it and deliberately left
 *   these (docs/transform-refactor.md §1.4).
 * - `snapToPhase` is the grid discipline, and it snaps to the LEAF's own
 *   sub-cell phase rather than to the whole-cell lattice. A member of a
 *   scaled group sits on a fractional origin, and `Math.round` moved it up
 *   to half a cell on its first turn and never gave it back
 *   (docs/transform-refactor.md §2.3).
 *
 * Split out of `compositionOps` in P7, unchanged. `compositionOps`
 * re-exports all of it, so existing importers are unaffected.
 */

import { CompositionFigure, FigureQuad, PathSegment, SVGObject } from './types';
import { Orientation, composeOrientation } from './transform2d';
import { computeSVGBbox } from './sceneGraph';
import { mirroredAngleDeg } from './sceneNodeGeometry';
import { remapOverrides } from './tileSegmentOverrides';
import { clonePathSegment, offsetPathSegment, safeMapSegments } from './pathSegmentUtils';

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
 * Snap a cell coordinate to the SAME sub-cell phase `phase` sits on.
 *
 * The identity-stash placement below rounds the new origin so a leaf
 * authored on the cell grid stays on it: a 3x4 box turned about its own
 * centre lands on x.5 otherwise, and the half-cell then drifts on every
 * further turn. But `Math.round` snaps to the WHOLE-cell lattice, and a
 * member of a SCALED group does not live there -- the group's rescale
 * writes the exact mapped box, so the member's origin is fractional
 * (docs/transform-refactor.md 2.3). Rounding that moved the figure by up
 * to half a cell on its first turn and never gave it back.
 *
 * Snapping to the leaf's own phase keeps the grid discipline where the
 * leaf is on the grid and leaves a fractional leaf exactly where it is.
 * For a whole-number `phase` this IS `Math.round(value)`:
 * `floor(v - p + 0.5) + p === floor(v + 0.5)` for integer p.
 */
function snapToPhase(value: number, phase: number): number {
  return Math.round(value - phase) + phase;
}

/** A box that remembers the pose it was authored in. */
interface IdentityAnchoredBox {
  cellX: number;
  cellY: number;
  cellWidth: number;
  cellHeight: number;
  identityCellX?: number;
  identityCellY?: number;
}

/**
 * The identity-stash placement shared by `rotateFigureIndividual90CW`,
 * `cycleTransformForFigure` and tile-mode `rotateSVG90CW`: recover the
 * authored (identity) origin from the stash or from the current centre,
 * then place a new `newW` x `newH` box about the identity CENTRE. Placing
 * every step from one stable reference rather than from the previous step
 * is what makes 4x90 (and the full 7-step cycle) land exactly on the
 * original; `identityW`/`identityH` are the box's dimensions at identity,
 * which is the current pair swapped when the box is already quarter-turned.
 */
function placeAboutIdentityCentre(
  box: IdentityAnchoredBox,
  identityW: number,
  identityH: number,
  newW: number,
  newH: number,
): { identityX: number; identityY: number; cellX: number; cellY: number } {
  const cx = box.cellX + box.cellWidth / 2;
  const cy = box.cellY + box.cellHeight / 2;
  const identityX = box.identityCellX ?? snapToPhase(cx - identityW / 2, box.cellX);
  const identityY = box.identityCellY ?? snapToPhase(cy - identityH / 2, box.cellY);
  return {
    identityX,
    identityY,
    cellX: snapToPhase(identityX + identityW / 2 - newW / 2, identityX),
    cellY: snapToPhase(identityY + identityH / 2 - newH / 2, identityY),
  };
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
  const newW = fig.cellHeight;
  const newH = fig.cellWidth;
  const { identityX, identityY, cellX: newCellX, cellY: newCellY } =
    placeAboutIdentityCentre(fig, identityW, identityH, newW, newH);
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

/**
 * Compose the `outer` orientation onto an `inner` one: `world = outer . inner`
 * (inner applied first). Used to derive a grouped figure's world
 * rotation/mirror from its `localRotation`/`localMirror*` composed with the
 * group's own `rotation`/`mirror*`.
 *
 * The D4 math itself lives in `transform2d`, which is the one place that
 * fixes the conventions (mirror first, then rotation; 90 CW in screen
 * y-down is `(x, y) -> (-y, x)`) and the canonical decomposition (fewer
 * mirrors first, then smaller rotation, so successive composes do not
 * drift between equivalent representations).
 */
export function composeOrientations(outer: Orientation, inner: Orientation): Orientation {
  return composeOrientation(outer, inner);
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
    const newW = svg.cellHeight;
    const newH = svg.cellWidth;
    const { identityX, identityY, cellX: newCellX, cellY: newCellY } =
      placeAboutIdentityCentre(svg, identityW, identityH, newW, newH);
    const idCx = identityX + identityW / 2;
    const idCy = identityY + identityH / 2;
    // Tile cell dimensions swap to track the rotated design â€” the
    // renderer (CompositionSVGLayer.applyTiledSVGObject) packs segments
    // into a `tileWidthL0 Ã— tileHeightL0` cell, so if the tile dims
    // don't swap, a rotated 40Ã—32 design gets crammed into the original
    // 32Ã—40 cell and the pattern visibly misaligns.
    const newTileW = svg.tileHeightL0;
    const newTileH = svg.tileWidthL0;
    // The whole thing turns RIGIDLY about the centre the region box swings
    // around â€” region, tile grid, and artwork keep exactly the same
    // relative position, so the sub-section of the pattern the region clips
    // into view is the same picture, turned. The grid anchor is carried to
    // the image of the old tile box's BOTTOM-left corner (the pattern
    // adapter's derivation): (x, y) â†’ (idCx + (idCy âˆ’ y), idCy + (x âˆ’ idCx)).
    // 4 rotations return it exactly (rotation about a fixed centre).
    const oldOx = svg.tileOffsetXL0 ?? 0;
    const oldOy = svg.tileOffsetYL0 ?? 0;
    const ax = svg.cellX + oldOx;
    const ay = svg.cellY + oldOy;
    const tileH = svg.tileHeightL0 ?? svg.cellHeight;
    const newAx = idCx + (idCy - (ay + tileH));
    const newAy = idCy + (ax - idCx);
    const newOx = newAx - newCellX;
    const newOy = newAy - newCellY;
    // The identity rebuild above turned the segments about their own bbox
    // centre; the rigid turn wants them turned about the region centre. The
    // two differ by a pure translation, so shift segments, subpaths, AND
    // the identity stash by it â€” translating the stash moves the rebuild
    // pivot with it, which keeps `identity + recipe = actual position` true
    // for every later rebuild (including the un-tiled branch after a
    // repeat toggle OFF).
    const curBox = computeSVGBbox(svg.segments);
    const rigidMinX = idCx + (idCy - (curBox.cellY + curBox.cellHeight));
    const rigidMinY = idCy + (curBox.cellX - idCx);
    const recipeBox = computeSVGBbox(newSegs);
    const dx = rigidMinX - recipeBox.cellX;
    const dy = rigidMinY - recipeBox.cellY;
    const shiftedSegs = newSegs.map(s => offsetPathSegment(s, dx, dy));
    const shiftedSubpaths = newSubpaths?.map(sub => ({ ...sub, segments: sub.segments.map(s => offsetPathSegment(s, dx, dy)) }));
    const shiftedIdSegs = newIdSegs?.map(s => offsetPathSegment(s, dx, dy));
    const rotated: SVGObject = { ...svg, segments: shiftedSegs, subpaths: shiftedSubpaths, rotation: newRot, identitySegments: shiftedIdSegs,
      cellX: newCellX, cellY: newCellY, cellWidth: newW, cellHeight: newH,
      tileWidthL0: newTileW, tileHeightL0: newTileH,
      tileOffsetXL0: newOx === 0 ? undefined : newOx,
      tileOffsetYL0: newOy === 0 ? undefined : newOy,
      identityCellX: atIdentity ? undefined : identityX,
      identityCellY: atIdentity ? undefined : identityY,
      localSegments: undefined };
    // Re-key per-copy paint: the whole pattern block rotates rigidly about
    // the SAME centre as everything else, so map each painted copy's
    // tile-center through that rotation onto the post-rotation grid.
    if (svg.segmentOverrides && svg.segmentOverrides.size > 0) {
      rotated.segmentOverrides = remapOverrides(svg.segmentOverrides, svg, rotated,
        (x, y) => { const [nx, ny] = rotatePointCW(x, y, idCx, idCy); return { x: nx, y: ny }; });
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
    localSegments: undefined };
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
    // The tile BOX reflects within the region â€” span âˆ’ (offset + tile),
    // the pattern adapter's rule â€” so the grid flips together with the
    // artwork and the region keeps clipping the same (now mirrored)
    // picture. Tile dimensions don't change on mirror.
    const tw = svg.tileWidthL0 ?? svg.cellWidth;
    const th = svg.tileHeightL0 ?? svg.cellHeight;
    const oldOx = svg.tileOffsetXL0 ?? 0;
    const oldOy = svg.tileOffsetYL0 ?? 0;
    const newOx = screenAxis === 'h' ? svg.cellWidth  - (oldOx + tw) : oldOx;
    const newOy = screenAxis === 'v' ? svg.cellHeight - (oldOy + th) : oldOy;
    // Segments reflect about the REGION centre, not their own bbox centre:
    // shift the identity rebuild (and the stash, so `identity + recipe`
    // keeps reproducing the actual position â€” see rotateSVG90CW's tile
    // branch) by the difference between the two reflections.
    const rcx = svg.cellX + svg.cellWidth / 2;
    const rcy = svg.cellY + svg.cellHeight / 2;
    const curBox = computeSVGBbox(svg.segments);
    const rigidMinX = screenAxis === 'h' ? 2 * rcx - (curBox.cellX + curBox.cellWidth) : curBox.cellX;
    const rigidMinY = screenAxis === 'v' ? 2 * rcy - (curBox.cellY + curBox.cellHeight) : curBox.cellY;
    const recipeBox = computeSVGBbox(newSegs);
    const dx = rigidMinX - recipeBox.cellX;
    const dy = rigidMinY - recipeBox.cellY;
    const shiftedSegs = newSegs.map(s => offsetPathSegment(s, dx, dy));
    const shiftedSubpaths = newSubpaths?.map(sub => ({ ...sub, segments: sub.segments.map(s => offsetPathSegment(s, dx, dy)) }));
    const shiftedIdSegs = newIdSegs?.map(s => offsetPathSegment(s, dx, dy));
    const mirrored: SVGObject = { ...svg, segments: shiftedSegs, subpaths: shiftedSubpaths, mirrorH: newMH, mirrorV: newMV, identitySegments: shiftedIdSegs,
      // The free rotation negates with the flip — see mirroredAngleDeg.
      angleDeg: mirroredAngleDeg(svg.angleDeg),
      tileOffsetXL0: newOx === 0 ? undefined : newOx,
      tileOffsetYL0: newOy === 0 ? undefined : newOy,
      localSegments: undefined };
    // Re-key per-copy paint: the pattern block flips about the region center
    // across the screen axis; map each painted copy's tile-center accordingly.
    if (svg.segmentOverrides && svg.segmentOverrides.size > 0) {
      mirrored.segmentOverrides = remapOverrides(svg.segmentOverrides, svg, mirrored,
        (x, y) => screenAxis === 'h' ? { x: 2 * rcx - x, y } : { x, y: 2 * rcy - y });
    }
    return mirrored;
  }
  return { ...svg, segments: newSegs, subpaths: newSubpaths, mirrorH: newMH, mirrorV: newMV, identitySegments: newIdSegs, ...computeSVGBbox(newSegs),
    // The free rotation negates with the flip — see mirroredAngleDeg.
    angleDeg: mirroredAngleDeg(svg.angleDeg),
    localSegments: undefined };
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

  // Re-center around the stable identity center: the stored identity
  // position when there is one, otherwise recovered from the current
  // centre, so every step is computed from one reference rather than from
  // the last step. That is what stops rounding drift on figures with
  // mixed odd/even dimensions (e.g. 3x4) where the centre falls on x.5.
  const { identityX, identityY, cellX: newCellX, cellY: newCellY } =
    placeAboutIdentityCentre(fig, identityW, identityH, newW, newH);

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
