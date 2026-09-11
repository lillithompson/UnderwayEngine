// The subtype-specific option menus a vector (SVG) selection gets, mirroring
// `imageEdit.ts` for images: an ordered list of actions per subtype, kept pure
// (no react-native) so the tables are unit-tested in node while the component
// owns only the animation.
//
// Every vector subtype offers Stroke — a path IS its stroke, so there is no
// vector object the control doesn't apply to. The table is keyed by subtype
// rather than being one flat list so a subtype can diverge, which is exactly
// what the second action does: it is Fill on the shapes the tools draw CLOSED
// (a rectangle, a circle), which alone have an interior to paint, and Endpoints
// on the OPEN ones (a line, an arc, a freehand stroke), which alone have loose
// ends to decorate. The two are complements — no subtype offers both, and none
// of the drawing subtypes offers neither.

import type { SVGSubtypeKind } from '../adapter';

/** The vector-specific editing actions.
 *
 *  - `stroke` opens the Stroke page — the Border page's rows (Width /
 *    Position / Dash) plus its color swatch, pointed at the path's own
 *    stroke.
 *  - `shape` opens the Shape page — the Radius slider that rounds the
 *    path's own corners, on the subtypes whose corners are LINE→LINE joins
 *    (the rectangle and the polygon; see {@link svgHasShape}).
 *  - `fill` opens the Fill bar — the image Tint bar's rows (Type / Stops /
 *    Angle / Opacity / Blend) plus its gradient swatch, pointed at the closed
 *    path's interior.
 *  - `endpoints` opens the Endpoints bar — a marker (none / circle / arrow) and
 *    a cap (round / square) for each of an open path's two loose ends.
 *  - `opacity` opens the Opacity bar — the whole object's render opacity plus
 *    an edge soften (0 = hard edges, 1 = transparent toward the edges).
 *  - `transform` opens the Copies page — Create copies: a count, a position
 *    offset, a scale and a rotation offset, each copy laid the offsets past
 *    the one before. Every subtype has it; a line repeats as readily as a
 *    shape. (The key predates the page's rename; the object's own rotation
 *    is the two-finger twist and the selection tool's Rotate slider.) */
export type SVGEditAction = 'stroke' | 'shape' | 'fill' | 'endpoints' | 'opacity' | 'transform';

export interface SVGEditOption {
  action: SVGEditAction;
  /** Short caption under the icon. */
  label: string;
  /** MaterialCommunityIcons glyph name. */
  icon: string;
}

/** Per-subtype glyphs for the Stroke button, so the option row reads as
 *  belonging to the selected shape. */
const STROKE_ICON: Record<SVGSubtypeKind, string> = {
  line: 'vector-line',
  arc: 'vector-radius',
  rectangle: 'vector-rectangle',
  circle: 'vector-circle',
  polygon: 'vector-polygon',
  shape: 'shape-outline',
  stroke: 'vector-polyline',
};

/**
 * Whether a subtype offers the Fill bar.
 *
 * A fill needs an enclosed interior to paint, so it is CLOSED-PATH ONLY — and
 * every closed subtype takes it: the three the shape tools author
 * (`rectangle`, from the line tool's rectangle mode, `circle`, from the arc
 * tool's, and `polygon`, from the polygon tool) and `shape`, the closed
 * freeform — a merged pair of strokes that met end to end, a join, a union
 * result, a preset. What closes is what fills; nothing about how the outline
 * came to be changes that.
 */
export function svgHasFill(subtype: SVGSubtypeKind): boolean {
  return subtype === 'rectangle' || subtype === 'circle'
    || subtype === 'polygon' || subtype === 'shape';
}

/**
 * Whether a subtype offers the Endpoints bar.
 *
 * A decorated end needs a LOOSE end to sit on, so it is open-path only — the
 * exact complement of {@link svgHasFill}, minus `shape`: a line, an arc and the
 * freehand draw tool's polyline. (`shape` is closed, so it is excluded here for
 * the same reason `circle` is; a preset shape has no loose end either.)
 */
export function svgHasEndpoints(subtype: SVGSubtypeKind): boolean {
  return subtype === 'line' || subtype === 'arc' || subtype === 'stroke';
}

/**
 * Whether a subtype's Endpoints page offers the Caps row (round / square per
 * end) beside its markers. A line and an arc do; the freehand stroke does
 * not — its ends are wherever the pen lifted, and a cap on a hand-drawn
 * curve reads as noise rather than a choice. Markers stay on all three.
 */
export function svgHasEndCaps(subtype: SVGSubtypeKind): boolean {
  return svgHasEndpoints(subtype) && subtype !== 'stroke';
}

/**
 * Whether a subtype offers the Opacity bar (whole-object opacity + edge
 * soften).
 *
 * The same closed shapes the Fill bar takes — softening an edge into
 * transparency needs an enclosed silhouette to fade, and the open paths
 * already read as weightless lines. Kept a separate predicate from
 * {@link svgHasFill} rather than an alias because the two menus answer
 * different questions and are free to diverge again.
 */
export function svgHasOpacity(subtype: SVGSubtypeKind): boolean {
  return svgHasFill(subtype);
}

/**
 * Whether a subtype's stroke can be REMOVED — the Stroke page's Remove line,
 * which clears the object's stroke overrides back to the composition-wide
 * default.
 *
 * Only a CLOSED shape: it has an interior that goes on being a shape without
 * an outline. An OPEN path is nothing but its stroke — a line with no stroke
 * is not a fainter line, it is an invisible object you can still select and
 * drag — so the line is not offered, rather than offered and misleading.
 */
export function svgStrokeRemovable(subtype: SVGSubtypeKind): boolean {
  return !svgHasEndpoints(subtype);
}

/**
 * Whether a subtype offers the Shape page — the Radius slider that rounds the
 * path's own corners. A control for the subtypes whose corners are LINE→LINE
 * joins (`roundPathCorners` only rounds those): the rectangle and the
 * polygon. A circle has no corners, and the other subtypes either have none
 * or aren't offered the control.
 */
export function svgHasShape(subtype: SVGSubtypeKind): boolean {
  return subtype === 'rectangle' || subtype === 'polygon';
}

/** The option menu for one vector subtype, in display order. Stroke leads — it
 *  is the one action every subtype has — then Shape on the polygonal ones,
 *  then the subtype's own next action: Fill on the shapes that enclose an
 *  area, Endpoints on the paths that don't close — then Opacity on the
 *  closed shapes, and Copies last. */
export function svgEditOptions(subtype: SVGSubtypeKind): readonly SVGEditOption[] {
  const options: SVGEditOption[] = [
    { action: 'stroke', label: 'Stroke', icon: STROKE_ICON[subtype] ?? STROKE_ICON.stroke },
  ];
  if (svgHasShape(subtype)) options.push({ action: 'shape', label: 'Shape', icon: 'rounded-corner' });
  if (svgHasFill(subtype)) options.push({ action: 'fill', label: 'Fill', icon: 'format-color-fill' });
  if (svgHasEndpoints(subtype)) options.push({ action: 'endpoints', label: 'Ends', icon: 'ray-start-end' });
  if (svgHasOpacity(subtype)) options.push({ action: 'opacity', label: 'Opacity', icon: 'opacity' });
  options.push({ action: 'transform', label: 'Copies', icon: 'content-copy' });
  return options;
}

/** Which of the Stroke page's optional rows a subtype offers. Width and Dash
 *  are universal (every stroke has a weight and can be dashed) and so aren't
 *  listed; this is the one a subtype can have no answer for.
 *
 *  - `position` (inside / center / outside) needs an enclosed area to align
 *    against, so it is closed-path only: a line, an arc and a freehand stroke
 *    have no inside and the row is dropped rather than shown inert.
 *
 *  (Radius used to be a Stroke row too; it is the Shape page now — see
 *  {@link svgHasShape}.) */
export function svgStrokeRows(subtype: SVGSubtypeKind): { position: boolean } {
  return {
    position: subtype === 'rectangle' || subtype === 'circle' || subtype === 'polygon'
      || subtype === 'shape',
  };
}

/** Every subtype's menu, for tests and for callers that want the whole table
 *  rather than one lookup. */
export const SVG_EDIT_OPTIONS: Readonly<Record<SVGSubtypeKind, readonly SVGEditOption[]>> = {
  line: svgEditOptions('line'),
  arc: svgEditOptions('arc'),
  rectangle: svgEditOptions('rectangle'),
  circle: svgEditOptions('circle'),
  polygon: svgEditOptions('polygon'),
  shape: svgEditOptions('shape'),
  stroke: svgEditOptions('stroke'),
};
