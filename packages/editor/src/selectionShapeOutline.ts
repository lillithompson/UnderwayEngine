import { getNode, worldMatrix } from '@/engine/sceneGraph';
import { graphOf, localHitObject } from '@/engine/sceneHitFrame';
import { buildPathD } from '@/engine/svgPathBuilder';
import { SVG_UNITS_PER_L0_CELL } from '@/engine/svgExport';
import { svgSubtype } from '@/engine/svgStroke';
import { svgHasFill } from '@/editor-ui/logic/svgEdit';
import { type Bbox, decomposeMatrix } from '@/engine/sceneTransform';
import type { CompositionState, SVGObject } from '@/engine/types';
import { MIN_OUTLINE_CELLS } from './selectionOutline';
import { canvasHost } from './components/canvasHooks';

// The selection ring as the OBJECT'S OWN BORDER rather than a rectangle
// around it — what Move and Rotate draw (arrangeModeNoScale), where a box
// says nothing a corner grab could use and everything it says about a
// triangle or a curve is wrong.
//
// It is drawn INSIDE the selection outline element rather than beside it,
// which is the whole trick: that element is the image of the node's own
// content box (editorSession.nodeSelectionBaseBox — `bbox`/`angleDeg` are
// what the world matrix makes of `local`), so an `<svg>` filling it with
// `local` for a viewBox maps the node's own-space path onto exactly the
// pixels the box covered. Every live preview then moves the border for
// free: a drag re-anchors that element (setOutlineBox), a twist rewrites
// its transform (outlineGestureTransform), and a child goes along with
// both — no second imperative channel, and nothing extra per frame.

/** The node's outline, ready to draw over its selection box. */
export interface SelectionShapePath {
  /** The `d` of the object's own path, in the node's own space. */
  d: string;
  /** The box that space is mapped BY: `local`, in the same SVG units `d` is
   *  written in, floored to a drawable extent. The ring's <svg> carries it
   *  as a viewBox (shapeOutlineViewBox) and the paint veil maps it onto
   *  screen px (paintDimVeilShapeTransform) — one rect, two readers, so the
   *  border and the veil's lit hole can never land in different places. */
  units: { x: number; y: number; width: number; height: number };
  /** The path's own transform inside that viewBox, when the node is
   *  MIRRORED. The box drops the signs of its scale (transformGestures
   *  drawnBox takes `Math.abs`), so the viewBox mapping alone would draw an
   *  asymmetric shape's border the right way round on a flipped object.
   *  Undefined for the usual case. */
  transform?: string;
}

/**
 * The border to draw for `selectedId`, or null to keep the rectangle.
 *
 * Only a VECTOR object has a border a box isn't: an image, a text, a paint
 * island and a pattern grid are all rectangles already, and their box IS
 * their outline. And only a CLOSED vector: several keep the box as well:
 *
 *  - an OPEN path — a freehand stroke, a line, an arc, a polyline. Its
 *    "border" is the stroke itself, so tracing it just redraws the ink in
 *    blue on top of itself and never says where the thing's reach is. It
 *    keeps the rectangle, handle-free as ever under Move and Rotate
 *    (arrangeModeNoScale). Closed is the same split the fill bar makes
 *    (`svgHasFill`: rectangle, circle, polygon, shape);
 *  - a REPEAT-mode shape, whose path is one tile of a region — tracing it
 *    would ring a single tile in the corner of the grid it stands for;
 *  - a simple H/V LINE, whose box is its wider straddle box
 *    (lineSelectionBox) — the reach a grab actually has, which is the one
 *    thing a bare line most needs drawn for it;
 *  - a FIGURE (a posed rig, which is an SVG object of baked subpaths):
 *    tracing it rings the mannequin limb by limb, a ragged silhouette
 *    that reads as part of the drawing rather than as a selection — and
 *    it is the one object whose outline moves under you, since posing a
 *    joint reshapes it. Its box is what every grab on it acts on, and
 *    what says "this figure is selected" at a glance.
 *
 * `local` is the box the caller resolved (SelectionBox.local); null for a
 * frame group or a legacy item, neither of which has a path either.
 */
export function selectionShapePath(
  state: CompositionState,
  selectedId: string | null,
  local: Bbox | null,
  freeAxis: 'x' | 'y' | null,
): SelectionShapePath | null {
  if (!selectedId || !local || freeAxis) return null;
  // A node the HOST keeps a record beside has no shape outline of its own
  // (canvasHooks.ts `CanvasRecords`): CozyJournal's rig figure is an svg
  // object whose subpaths are a BAKE of a pose, and hugging that bake
  // would draw the outline on a silhouette the live sketch has already
  // moved away from. The box is what such a selection wears.
  if (canvasHost().records?.(state)?.has(selectedId)) return null;
  const node = getNode(graphOf(state), selectedId);
  if (!node || node.kind !== 'svg') return null;
  const object = localHitObject(node) as SVGObject;
  if (!object || object.tileMode === 'repeat' || object.segments.length === 0) return null;
  if (!svgHasFill(svgSubtype(object))) return null;
  const d = buildPathD(object.segments);
  if (!d) return null;
  const u = SVG_UNITS_PER_L0_CELL;
  // A flip is canonically a negative `sy` (sceneTransform decomposeMatrix),
  // so the mirror to put back is always about the box's horizontal midline.
  const flipped = decomposeMatrix(worldMatrix(graphOf(state), selectedId)).sy < 0;
  const midY = (local.y + local.height / 2) * u;
  return {
    d,
    units: {
      x: local.x * u,
      y: local.y * u,
      // The same floor the selection rectangle keeps (MIN_OUTLINE_CELLS): a
      // flat box maps every path point onto one line, and a 0-extent viewBox
      // draws nothing at all.
      width: Math.max(local.width, MIN_OUTLINE_CELLS) * u,
      height: Math.max(local.height, MIN_OUTLINE_CELLS) * u,
    },
    ...(flipped ? { transform: `matrix(1 0 0 -1 0 ${midY * 2})` } : null),
  };
}

/** `units` as an SVG `viewBox` attribute — what stretches the path over the
 *  selection box element. */
export function shapeOutlineViewBox(units: SelectionShapePath['units']): string {
  return `${units.x} ${units.y} ${units.width} ${units.height}`;
}
