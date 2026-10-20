// Pure geometry for the DRAWN RECTANGLE — an axis-aligned box in L0 cells
// (cellX/Y/Width/Height) rendered at a free `angleDeg` about its own centre.
// That pair is the host's one spelling of "where a thing is drawn": the
// graph answers in it (`transformGestures.drawnBox`), the selection outline
// is it, the corner handles sit on it, and the marquee compares against it.
//
// Two readings of the rectangle — {@link bboxCornerCell} and the
// {@link rotatedAabb} built on it — plus the corner-handle drag that
// produces a new one ({@link computeCornerResize}, CanvasSurface's `resize`
// gesture): grabbing a corner resizes the box with the OPPOSITE corner
// pinned in world space, projecting the cursor delta into the node's rotated
// LOCAL axes so the drag feels natural at any angle — and a corner pulled
// past the pinned one turns the box over rather than stopping.
//
// The readers belong HERE, beside the rectangle, rather than next to
// `drawnBox` in transformGestures: this module has no imports at all, and
// moving them would make the pure leaf depend on the scene graph — backwards,
// and it would drag the graph into `gridSnap` behind them. transformGestures
// takes the type off this file instead; the dependency runs heavy → pure.
// For the same reason the cell rectangle is DECLARED here rather than imported
// from the engine's `transform2d`, which also declares it: importing would
// give this leaf its first import, and structural typing already makes the two
// interchangeable at every call site that crosses.
// Everything is pure so the gesture handler can feed results straight into
// style mutations (90 fps rule) and commit the final bbox once on release via
// buildResizeNode.

export interface CellBbox {
  cellX: number;
  cellY: number;
  cellWidth: number;
  cellHeight: number;
}

/** Smallest allowed edge, in L0 cells. Matches MIN_SCALE_CELLS in
 *  editorSession so a corner-resize and a pinch-scale bottom out identically. */
export const MIN_RESIZE_CELLS = 0.1;

/** Smallest allowed edge for a CURVE the arc tool draws — the quarter arc, and
 *  the oval its other mode inscribes in the same box — in L0 cells. A WHOLE
 *  CELL, where every other shape may be pulled down to the sliver above.
 *
 *  A quarter curve with no height IS the straight line between its own ends,
 *  and a flat oval is nothing at all: collapsing one does not make a small
 *  curve, it destroys the curve and leaves a mark that cannot be told from a
 *  line — and cannot be pulled back into a curve either, since the stretch has
 *  already shed the arc into a polyline. So the floor is a cell the reader can
 *  see, both ways an arc's box is set: the corner drag that shrinks one
 *  ({@link computeResizedBbox}'s `minCells`) and the drag that draws one
 *  (editorSession's `unflattenedArcBox`), which is what keeps the thinnest arc
 *  that can be DRAWN the same as the thinnest one that can be pulled to.
 *
 *  One L0 cell flat, not one cell of the composition's own grid: on a format
 *  whose snap step is finer than a cell this is the coarser of the two, so the
 *  smallest arc there is a cell rather than a step. */
export const MIN_ARC_CELLS = 1;

/** Do two boxes occupy exactly the same cells? Exact equality on purpose:
 *  both callers use it to skip work on an unchanged box (the live preview
 *  skips a rescale, {@link buildResizeNode} skips a no-op undo entry), and a
 *  tolerance there would silently swallow sub-tolerance drags. */
export function sameBbox(a: CellBbox, b: CellBbox): boolean {
  return a.cellX === b.cellX && a.cellY === b.cellY
    && a.cellWidth === b.cellWidth && a.cellHeight === b.cellHeight;
}

/** Did two readings of a drag turn over the same axes? `undefined` is a
 *  drag not yet read, which matches nothing. The live preview's skip asks
 *  this beside {@link sameBbox}: the box alone almost always tells a flip
 *  apart, but "almost" is not what a skipped re-render should rest on. */
export function sameFlip(a: ResizeFlip | undefined, b: ResizeFlip): boolean {
  return !!a && a.x === b.x && a.y === b.y;
}

/** The grabbed corner as local-axis signs: -1 = left/top edge, +1 =
 *  right/bottom edge. The opposite corner (the anchor) is the negation. */
export interface CornerSign {
  sx: -1 | 1;
  sy: -1 | 1;
}

/** The four selectable corners, keyed by the CSS edges the handle pins to
 *  (matches SELECTION_CORNERS in CanvasSurface), with their local-axis signs. */
export const RESIZE_CORNERS: ReadonlyArray<{ h: 'left' | 'right'; v: 'top' | 'bottom'; sign: CornerSign }> = [
  { h: 'left', v: 'top', sign: { sx: -1, sy: -1 } },
  { h: 'right', v: 'top', sign: { sx: 1, sy: -1 } },
  { h: 'left', v: 'bottom', sign: { sx: -1, sy: 1 } },
  { h: 'right', v: 'bottom', sign: { sx: 1, sy: 1 } },
];

/** A bbox corner in world/cell space, honouring the node's free rotation about
 *  its centre. `sign` selects the corner (local-axis signs). Shared by the
 *  corner hit-test, the resize math, and their tests so the projection can't
 *  drift. Local axes are u=(cos,sin), v=(-sin,cos) (y-down). */
export function bboxCornerCell(
  b: CellBbox,
  angleDeg: number,
  sign: CornerSign,
): { x: number; y: number } {
  const th = (angleDeg * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const cx = b.cellX + b.cellWidth / 2;
  const cy = b.cellY + b.cellHeight / 2;
  const hw = b.cellWidth / 2;
  const hh = b.cellHeight / 2;
  return {
    x: cx + sign.sx * hw * c - sign.sy * hh * s,
    y: cy + sign.sx * hw * s + sign.sy * hh * c,
  };
}

/** World axis-aligned bounds of a bbox rendered at a free rotation about its
 *  centre — what marquee overlap tests and the multi-select combined box
 *  compare against. Identity (`angleDeg` 0) passes the box through. */
export function rotatedAabb(b: CellBbox, angleDeg: number): CellBbox {
  if (!angleDeg) return b;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const corner of RESIZE_CORNERS) {
    const p = bboxCornerCell(b, angleDeg, corner.sign);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { cellX: minX, cellY: minY, cellWidth: maxX - minX, cellHeight: maxY - minY };
}

/** Which of the box's own axes a corner drag turned over: `x` when the
 *  grabbed corner was pulled past the pinned one along the box's width,
 *  `y` along its height. The content is mirrored on each axis named, so the
 *  corner under the finger is still the corner that was grabbed. */
export interface ResizeFlip {
  x: boolean;
  y: boolean;
}

/** No axis turned over — an ordinary resize. */
export const NO_RESIZE_FLIP: ResizeFlip = Object.freeze({ x: false, y: false });

/** What a corner drag asks for: the box it lands on, and the axes it
 *  turned over on the way there. */
export interface CornerResize {
  bbox: CellBbox;
  flip: ResizeFlip;
}

/**
 * The resize a drag of the corner `sign` of `old` (rotated by `angleDeg`) to
 * the world-cell point (`cursorX`, `cursorY`) asks for, holding the opposite
 * corner fixed. The cursor offset from the anchor is projected onto the
 * node's local axes (u = along local-x, v = along local-y), giving the new
 * width/height; each edge is clamped to {@link MIN_RESIZE_CELLS}. The
 * returned bbox is the axis-aligned rect AT IDENTITY — the same `angleDeg`
 * still applies about the new centre.
 *
 * A corner pulled PAST the pinned one does not stop there: the box comes
 * out the other side of the anchor, as wide as the cursor is now far from
 * it, and `flip` names the axis that turned over so the caller can mirror
 * the content (a negative width has no other meaning — the thing is drawn
 * back to front). Each axis turns over on its own, so a drag through the
 * anchor's corner flips both. It used to clamp at the anchor, which left
 * the Mirror buttons as the only way to turn a shape over and a drag that
 * simply stopped following the finger.
 *
 * `opts.noFlip` keeps that clamp: the box bottoms out at the minimum on
 * its own side and no axis is ever reported. For a FRAME — a page of
 * members, where a corner dragged a little too far turning every one of
 * them over is an accident rather than an edit.
 *
 * `opts.minCells` raises that floor (never lowers it: the effective minimum is
 * `max(MIN_RESIZE_CELLS, minCells)`). Grid snap passes the snap step, so a
 * drag that pulls the grabbed corner onto the anchor's own gridline bottoms
 * out at one visible cell instead of the 0.1-cell sliver — which reads as a
 * collapsed, invisible box, and is off-grid besides. Most visible on a simple
 * H/V line, whose whole box IS its length. The floor holds on BOTH sides of
 * the anchor: a cursor on the anchor's gridline is the smallest box on the
 * near side, one step past it the smallest box on the far side.
 *
 * `opts.uniform` forbids non-uniform scaling: the box keeps its ORIGINAL
 * aspect ratio and follows whichever axis the cursor pushed further (in
 * aspect-normalized terms). Rig figures, word stickers, baked pattern tiles
 * and Reimagine's seeded squiggle resize this way — see
 * `requiresUniformScale`. Curves do NOT: an arc stretches into an elliptical
 * arc (its segments flattened to a polyline first), as a circle has long
 * stretched into an oval. A flip is not a change of aspect, so a uniform
 * box turns over like any other — only its size is held to the ratio.
 *
 * `opts.freeAxis` (a simple H/V line's box — see SelectionBox.freeAxis)
 * instead freezes the PERPENDICULAR local extent at its old value: the drag
 * only lengthens/shortens the box along the named local axis, and because
 * the extents are local, that axis is exactly the line's own stroke
 * direction at any `angleDeg`. Mutually exclusive with `uniform` (a line is
 * never circular); `freeAxis` wins if both are passed. The frozen axis is
 * not the drag's to change, so it never flips either; the stroke axis does
 * (the line runs out the other side of its pinned end).
 */
export function computeCornerResize(
  old: CellBbox,
  angleDeg: number,
  sign: CornerSign,
  cursorX: number,
  cursorY: number,
  opts?: { uniform?: boolean; freeAxis?: 'x' | 'y'; minCells?: number; noFlip?: boolean },
): CornerResize {
  const th = (angleDeg * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  // Local axes in world/cell space (y-down, so v is the 90°-CW rotation of u).
  const ux = c;
  const uy = s;
  const vx = -s;
  const vy = c;
  // Anchor = the opposite corner (signs negated), held fixed in world space.
  const anchor = bboxCornerCell(old, angleDeg, { sx: (-sign.sx) as -1 | 1, sy: (-sign.sy) as -1 | 1 });
  const ax = anchor.x;
  const ay = anchor.y;
  // Project the anchor→cursor vector onto the local axes → new extents,
  // signed by the grabbed corner: positive while the cursor is still on the
  // grabbed corner's own side of the anchor, negative once it has crossed.
  const dx = cursorX - ax;
  const dy = cursorY - ay;
  const localW = (dx * ux + dy * uy) * sign.sx;
  const localH = (dx * vx + dy * vy) * sign.sy;
  // An axis turns over when its extent goes negative — unless the caller
  // forbids it, or the axis is frozen and so not the drag's to change.
  const flipX = !opts?.noFlip && opts?.freeAxis !== 'y' && localW < 0;
  const flipY = !opts?.noFlip && opts?.freeAxis !== 'x' && localH < 0;
  // The floor applies only to the extents the drag actually sets — a frozen
  // `freeAxis` perpendicular keeps its old thickness below, whatever it is.
  const min = Math.max(MIN_RESIZE_CELLS, opts?.minCells ?? 0);
  let newW = Math.max(flipX ? -localW : localW, min);
  let newH = Math.max(flipY ? -localH : localH, min);
  if (opts?.freeAxis) {
    // Axis-locked line stretch: the thin (perpendicular) extent is not the
    // drag's to change — hold it, and let only the stroke axis follow the
    // cursor. The anchor corner stays pinned like every other resize, so
    // the far endpoint tracks the finger and the near one doesn't move.
    if (opts.freeAxis === 'x') newH = old.cellHeight;
    else newW = old.cellWidth;
  } else if (opts?.uniform) {
    // Aspect of the box being resized (1 for a circle). Compare the two
    // candidate sizes on the same footing and take the larger, so the drag
    // tracks whichever axis the cursor pushed further.
    const aspect = old.cellWidth > 0 && old.cellHeight > 0 ? old.cellWidth / old.cellHeight : 1;
    if (newW / aspect >= newH) newH = newW / aspect;
    else newW = newH * aspect;
  }
  // New centre keeps the anchor fixed: step half the new size away from it
  // along the local axes — toward the grabbed corner's side, or the far
  // side on an axis that turned over.
  const dirX = flipX ? -sign.sx : sign.sx;
  const dirY = flipY ? -sign.sy : sign.sy;
  const ncx = ax + dirX * (newW / 2) * ux + dirY * (newH / 2) * vx;
  const ncy = ay + dirX * (newW / 2) * uy + dirY * (newH / 2) * vy;
  return {
    bbox: {
      cellX: ncx - newW / 2,
      cellY: ncy - newH / 2,
      cellWidth: newW,
      cellHeight: newH,
    },
    flip: flipX || flipY ? { x: flipX, y: flipY } : NO_RESIZE_FLIP,
  };
}

/** The box alone of {@link computeCornerResize} — for a caller that only
 *  measures where a drag lands (the snap and geometry tests) and has no
 *  content to turn over. */
export function computeResizedBbox(
  old: CellBbox,
  angleDeg: number,
  sign: CornerSign,
  cursorX: number,
  cursorY: number,
  opts?: { uniform?: boolean; freeAxis?: 'x' | 'y'; minCells?: number; noFlip?: boolean },
): CellBbox {
  return computeCornerResize(old, angleDeg, sign, cursorX, cursorY, opts).bbox;
}
