import type { CSSProperties } from 'react';
import { STATE_ACTIVE } from '@/editor-ui/theme';
import { BASE_CELL_PX } from './cameraMath';
import type { CellBbox } from '@/editor/resizeMath';

// Where the selection rectangle sits in the world layer, as a style object.
//
// The invariant this exists to protect: the element IS the node's bbox — its
// box occupies exactly `cellX/cellY/cellWidth/cellHeight` in world px, and the
// ring is painted OUTSIDE that box by `outline`, which takes no layout. So the
// rectangle the user sees is the rectangle the engine stores, the corner
// handles (positioned against this element's padding box) land on the real
// bbox corners, and `transform-origin: center` pivots about the real bbox
// centre.
//
// A `border` cannot do this. CSS lays a border out INSIDE the element box, so
// `left`/`top` place the border's OUTER edge: the content box — the part
// meant to coincide with the bbox — ends up SELECTION_BORDER_PX down and to
// the right, and 2× that too big. That was a visible, systematic down-right
// offset on every selection, and on a word sticker (whose card carries a
// 1px × 2px drop shadow at BASE_CELL_PX) the displaced ring landed on the
// shadow, reading as an outline drawn around the shadow rather than the card.

/** Ring thickness, in SCREEN px — see {@link screenPx}. */
export const SELECTION_BORDER_PX = 2;

/** Floor on the drawn extent, in cells: a simple H/V line's straddle box can
 *  be flat on one axis, and a 0-px element paints no ring at all. Shared
 *  with the object's-own-border ring (selectionShapeOutline), whose viewBox
 *  has to name the SAME extent this box lays out or the two disagree. */
export const MIN_OUTLINE_CELLS = 0.05;

// ── Zoom-invariant chrome ─────────────────────────────────────────────
//
// Selection chrome is an affordance, not content: the ring and the corner
// handles must read at the same size whether the camera is at 0.2× or 24×,
// exactly as they do in Figma. But the chrome lives INSIDE the world layer
// (it has to — it hugs world geometry and rotates with it), and that layer
// carries `scale(cameraScale)`. So every chrome length is divided by the
// scales above it, leaving a constant number of screen px.
//
// Two scales stack, and both are live-mutated without a React render, so the
// division is done in CSS against custom properties rather than baked into
// numbers here:
//   ZOOM_INV_VAR — 1 / world-layer scale, set on the world layer by
//     applyLiveCamera (pinch-zoom and wheel-zoom move the camera by direct
//     style mutation, no re-render, so a JS-computed number would lag a
//     gesture and snap on commit).
//   LIVE_INV_VAR — 1 / the two-finger scale factor, set on the selection
//     outline for the duration of a manipulate gesture, which scales the
//     outline element itself. Unset (→ 1) at rest.

/** Custom property on the world layer: 1 / the layer's camera scale. */
export const ZOOM_INV_VAR = '--cj-zoom-inv';

/** Custom property on the selection outline: 1 / a live pinch's scale factor. */
export const LIVE_INV_VAR = '--cj-live-inv-scale';

/** `px` screen pixels, as a length usable inside the scaled world layer. */
export function screenPx(px: number): string {
  return `calc(${px}px * var(${ZOOM_INV_VAR}, 1) * var(${LIVE_INV_VAR}, 1))`;
}

/** The same inversion as a `transform` value, for chrome that should be
 *  counter-scaled whole rather than resized. Two chained `scale()` functions
 *  multiply, so this needs no `calc()` — and with `transform-origin: center`
 *  the element shrinks about its own centre, staying put on whatever point it
 *  is pinned to. */
export const SCREEN_INV_TRANSFORM =
  `scale(var(${ZOOM_INV_VAR}, 1)) scale(var(${LIVE_INV_VAR}, 1))`;

// ── Hairlines: counter-scale the THICKNESS, never shrink the box ──────
//
// A chrome LINE (a symmetry axis, say) cannot use `screenPx` for its thin
// dimension. That would give the element a layout width of 2/scale px —
// 0.04 px once the camera is deep in — and a box that small stops
// rendering: the browser rasterizes the layer's contents at its own capped
// resolution, so a sub-pixel-wide `background-image` washes out to nothing
// (dashed axes vanish outright) while a `background-color` blurs into a
// fat band many screen px thick. Both were live at ordinary zoom levels.
//
// So a hairline keeps a comfortable LAYOUT thickness (HAIRLINE_PX) that
// rasterizes crisply, and counter-scales that one axis by the same
// inversion — the compositor applies the scale exactly, at any zoom.
// Paired with `translateX/Y(-50%)`, which is half the UNSCALED box and so
// still lands the scaled line's centre on the coordinate it is pinned to.

/** Layout thickness of a counter-scaled hairline, in px. Also the screen
 *  px it ends up occupying, since the counter-scale is exact. */
export const HAIRLINE_PX = 2;

/** How long the selection outline's fade takes, ms — the bow-out while a
 *  host's own turn is in flight and the return once it settles
 *  (`turnLive.ts`).
 *  Opacity only: a compositor-side transition, nothing on the layout path. */
export const SELECTION_OUTLINE_FADE_MS = 150;

// ── Paint's selection veil ────────────────────────────────────────────
//
// With a color-group brush armed and a selection in force, the selection is
// the brush's object filter (paintFilterIds): nothing else can be painted.
// The veil makes that legible before the first stroke — everything but the
// paintable object drops behind a dark wash.
//
// The veil is SCREEN-SPACE: one viewport-sized <path> (fill-rule evenodd)
// whose outer subpath is the whole view and whose inner subpath is the
// selection's box mapped through the camera — the single lit hole. It used
// to live in the world layer as a giant spread-only box-shadow, which broke
// at zoom extremes: the browser rasterizes a scaled layer's contents at a
// capped resolution, and a 200,000-world-px shadow through a deep zoom-out
// drifted off its element and thinned to nothing. Plain screen-px geometry
// has no such cliff — the wash covers the visible view exactly, at any
// zoom. The cost is that pan/zoom no longer carry it for free: the camera
// path (applyLiveCamera) re-anchors the hole imperatively, the same way it
// keeps the zoom-invariant chrome in step.
//
// Under Move and Rotate the hole is not the box but the object's own
// border, the one those modes already ring (selectionShapeOutline) — a box
// round a triangle or a letterform lights a wide margin the brush cannot
// touch, and says the wrong thing about what the filter covers. A shape
// cannot be a subpath here (its `d` is written in its own units, and
// transforming a `d` means re-emitting every curve), so that case swaps the
// evenodd path for a full-view rect through a luminance <mask> with the
// shape painted black into it — paintDimVeilShapeTransform is the mapping,
// and it is one attribute the camera path rewrites, as cheap as the `d`.

/** The veil's wash. Translucent, so the dimmed scene stays readable as
 *  context — it is "not paintable", not "gone". */
export const PAINT_DIM_VEIL = 'rgba(30, 27, 24, 0.45)';

/**
 * The veil's path data, in SCREEN px: the whole `view`, minus the selection
 * `box` (world cells) mapped through the world-layer transform `t` and
 * rotated by the selection's `angleDeg` about its own center — the same
 * rotation the outline element carries. Rendered with `fill-rule: evenodd`,
 * so the inner subpath is a hole whatever its winding.
 *
 * The hole is grown by the ring's own thickness: the veil paints OVER the
 * world layer, selection chrome included, and the blue ring sits just
 * outside the bbox — without the outset it would be the first thing washed.
 */
export function paintDimVeilPath(
  view: { width: number; height: number },
  box: CellBbox,
  t: { translateX: number; translateY: number; scale: number },
  angleDeg = 0,
): string {
  const r = selectionOutlineRect(box);
  const w = r.width * t.scale;
  const h = r.height * t.scale;
  const cx = t.translateX + r.left * t.scale + w / 2;
  const cy = t.translateY + r.top * t.scale + h / 2;
  // CSS rotate() is clockwise in the y-down screen frame; so is this matrix.
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corner = (dx: number, dy: number): string =>
    `${cx + dx * cos - dy * sin} ${cy + dx * sin + dy * cos}`;
  // Already screen px — the ring outset needs no zoom inversion here.
  const hw = w / 2 + SELECTION_BORDER_PX;
  const hh = h / 2 + SELECTION_BORDER_PX;
  return `M0 0H${view.width}V${view.height}H0Z`
    + `M${corner(-hw, -hh)}L${corner(hw, -hh)}L${corner(hw, hh)}L${corner(-hw, hh)}Z`;
}

/**
 * The veil's hole when it is the object's OWN BORDER rather than its box —
 * Move and Rotate, the modes whose selection ring is already the border
 * (selectionShapeOutline). The wash is then a plain full-view rect through a
 * <mask>, and the shape is what is painted black into that mask; this is the
 * `transform` that lands it.
 *
 * It maps the shape's own space — the `units` rect its `d` is written
 * against — onto exactly the screen pixels the box hole would have covered:
 * the same `box`, the same camera `t`, the same turn about the same centre.
 * Read right to left, as SVG composes: drop the units origin, stretch the
 * units box onto the box's screen size, put its top-left on the box's
 * top-left, turn about the centre, then move to the centre.
 *
 * The outset the box hole gets from SELECTION_BORDER_PX is not here — a
 * shape has no single outward direction, so the mask's path carries it as a
 * stroke instead (PAINT_VEIL_SHAPE_STROKE_PX, half of it outside the edge).
 */
export function paintDimVeilShapeTransform(
  box: CellBbox,
  t: { translateX: number; translateY: number; scale: number },
  angleDeg: number,
  units: { x: number; y: number; width: number; height: number },
): string {
  const r = selectionOutlineRect(box);
  const w = r.width * t.scale;
  const h = r.height * t.scale;
  const cx = t.translateX + r.left * t.scale + w / 2;
  const cy = t.translateY + r.top * t.scale + h / 2;
  const sx = units.width > 0 ? w / units.width : 0;
  const sy = units.height > 0 ? h / units.height : 0;
  return `translate(${cx} ${cy}) rotate(${angleDeg}) translate(${-w / 2} ${-h / 2})`
    + ` scale(${sx} ${sy}) translate(${-units.x} ${-units.y})`;
}

/** Thickness of the mask path's stroke, in SCREEN px (the path is drawn
 *  with `non-scaling-stroke`, so this is exact at any zoom). Twice the
 *  ring's own width, centred on the edge: half of it falls outside, which
 *  is the same clearance the box hole gets from SELECTION_BORDER_PX, so the
 *  border stays lit instead of being the first thing the wash covers. */
export const PAINT_VEIL_SHAPE_STROKE_PX = SELECTION_BORDER_PX * 2;

// ── Text edit ring ────────────────────────────────────────────────────
//
// While a text node is open for typing, the blue selection ring stays put
// and a second ring frames it a small margin further out — "this box is in
// edit mode", distinct from plain selection at a glance. It is the SAME
// blue as the selection ring (it was black for a while, which read as a
// different kind of chrome — a frame, a lock — rather than "the selection,
// doubled"): two blue rings say the one thing. The ring is a CHILD of the
// selection outline element, offset by negative insets, so every way the
// outline moves — React re-render on keystroke re-wrap, the imperative
// re-anchors during gestures, the rotation transform — carries it along
// for free.

/** Clear space between the blue ring's outer edge and the edit ring's
 *  inner edge, in SCREEN px (zoom-invariant, like the rings). */
export const TEXT_EDIT_RING_GAP_PX = 3;

/** The selection ring's blue — Facet's ACCENT_PRIMARY, the one accent
 *  every piece of selection chrome shares (CanvasSurface draws the ring,
 *  the marquee and the drop highlight in it). */
export const SELECTION_COLOR = STATE_ACTIVE;

/** The edit ring's ink: the selection blue, so the doubled ring reads as
 *  the selection emphasised rather than as some other frame. */
export const TEXT_EDIT_RING_COLOR = SELECTION_COLOR;

/**
 * Style for the edit-mode ring, as a child of the selection outline
 * element. Its box edges sit `SELECTION_BORDER_PX + TEXT_EDIT_RING_GAP_PX`
 * outside the parent's (past the blue ring, then the gap), and its own ring
 * paints outward from there — same `outline`-not-`border` reasoning as the
 * parent (see the module comment). `color` is the ring's ink: the selection
 * blue by default (an open text object); the Tile tool's un-selected
 * editing target wears the same doubled ring in the pattern's own orange.
 */
export function textEditRingStyle(color: string = TEXT_EDIT_RING_COLOR): CSSProperties {
  const inset = screenPx(-(SELECTION_BORDER_PX + TEXT_EDIT_RING_GAP_PX));
  return {
    position: 'absolute',
    left: inset,
    top: inset,
    right: inset,
    bottom: inset,
    outlineWidth: screenPx(SELECTION_BORDER_PX),
    outlineStyle: 'solid',
    outlineColor: color,
    pointerEvents: 'none',
  };
}

/**
 * The world-layer style for the selection rectangle around `box`, drawn in
 * `color`. Rotation, pointer-events and the handle children are the caller's
 * (they change per gesture); this owns only the geometry + the ring.
 */
export function selectionOutlineStyle(
  box: CellBbox,
  color: string,
): CSSProperties {
  return {
    position: 'absolute',
    left: box.cellX * BASE_CELL_PX,
    top: box.cellY * BASE_CELL_PX,
    width: Math.max(box.cellWidth, MIN_OUTLINE_CELLS) * BASE_CELL_PX,
    height: Math.max(box.cellHeight, MIN_OUTLINE_CELLS) * BASE_CELL_PX,
    // Longhands, not the `outline` shorthand: the width carries var()s, and a
    // shorthand is all-or-nothing if one part fails to parse.
    outlineWidth: screenPx(SELECTION_BORDER_PX),
    outlineStyle: 'solid',
    outlineColor: color,
  };
}

/** The same geometry the style above lays out, for the gesture handlers that
 *  re-anchor the outline imperatively (React's reconciler skips DOM writes for
 *  props that didn't change, so a live preview has to move it by hand). */
export function selectionOutlineRect(box: CellBbox): {
  left: number; top: number; width: number; height: number;
} {
  return {
    left: box.cellX * BASE_CELL_PX,
    top: box.cellY * BASE_CELL_PX,
    width: Math.max(box.cellWidth, MIN_OUTLINE_CELLS) * BASE_CELL_PX,
    height: Math.max(box.cellHeight, MIN_OUTLINE_CELLS) * BASE_CELL_PX,
  };
}

/**
 * The outline element's live `transform` during a gesture: the world move
 * the gesture is previewing, composed onto the turn the box is DRAWN at.
 *
 * The element's resting transform is `rotate(angleDeg)` about its own centre
 * — which is the bbox centre — and every gesture overwrites that inline. So a
 * handler that writes only its world move silently UN-TURNS the box for the
 * length of the drag, and the release puts it back. That was the combined box
 * of a bound group turned off the quarters: square while the finger was down,
 * turned again the moment it lifted.
 *
 * Order matters. The turn goes innermost, so it happens about the centre
 * first and the world move is applied to the result; the other way round
 * would rotate the move itself and send the box off at an angle.
 */
export function outlineGestureTransform(world: string, angleDeg: number): string {
  if (!angleDeg) return world;
  const turn = `rotate(${angleDeg}deg)`;
  return world ? `${world} ${turn}` : turn;
}
