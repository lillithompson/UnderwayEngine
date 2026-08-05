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
 *  - `stroke` opens the Stroke bar — the Border bar's four rows (Width /
 *    Radius / Position / Dash) plus its color swatch, pointed at the path's
 *    own stroke.
 *  - `fill` opens the Fill bar — the image Tint bar's rows (Type / Stops /
 *    Angle / Opacity / Blend) plus its gradient swatch, pointed at the closed
 *    path's interior.
 *  - `endpoints` opens the Endpoints bar — a marker (none / circle / arrow) and
 *    a cap (round / square) for each of an open path's two loose ends. */
export type SVGEditAction = 'stroke' | 'fill' | 'endpoints';

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
  shape: 'vector-polygon',
  stroke: 'vector-polyline',
};

/**
 * Whether a subtype offers the Fill bar.
 *
 * A fill needs an enclosed interior to paint, so it is closed-path only — and
 * of the closed subtypes only the two the shape tools author (`rectangle`, from
 * the line tool's rectangle mode, and `circle`, from the arc tool's) take it
 * today. `shape` is closed too and is the obvious next candidate, but it also
 * covers join / union results and the preset library, whose fills are authored
 * elsewhere; it stays out until that is reconciled rather than being given a
 * second, competing source of fill.
 */
export function svgHasFill(subtype: SVGSubtypeKind): boolean {
  return subtype === 'rectangle' || subtype === 'circle';
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

/** The option menu for one vector subtype, in display order. Stroke leads — it
 *  is the one action every subtype has — then the subtype's own second action:
 *  Fill on the shapes that enclose an area, Endpoints on the paths that don't
 *  close. */
export function svgEditOptions(subtype: SVGSubtypeKind): readonly SVGEditOption[] {
  const options: SVGEditOption[] = [
    { action: 'stroke', label: 'Stroke', icon: STROKE_ICON[subtype] ?? STROKE_ICON.stroke },
  ];
  if (svgHasFill(subtype)) options.push({ action: 'fill', label: 'Fill', icon: 'format-color-fill' });
  if (svgHasEndpoints(subtype)) options.push({ action: 'endpoints', label: 'Ends', icon: 'ray-start-end' });
  return options;
}

/** Which of the Stroke bar's optional rows a subtype offers. Width and Dash
 *  are universal (every stroke has a weight and can be dashed) and so aren't
 *  listed; these two are the ones a subtype can have no answer for.
 *
 *  - `position` (inside / center / outside) needs an enclosed area to align
 *    against, so it is closed-path only: a line, an arc and a freehand stroke
 *    have no inside and the row is dropped rather than shown inert.
 *  - `radius` rounds the path's own corners, which is a rectangle control.
 *    A circle has no corners, and the other subtypes either have none or
 *    aren't offered the control. */
export function svgStrokeRows(subtype: SVGSubtypeKind): { radius: boolean; position: boolean } {
  return {
    radius: subtype === 'rectangle',
    position: subtype === 'rectangle' || subtype === 'circle' || subtype === 'shape',
  };
}

/** Every subtype's menu, for tests and for callers that want the whole table
 *  rather than one lookup. */
export const SVG_EDIT_OPTIONS: Readonly<Record<SVGSubtypeKind, readonly SVGEditOption[]>> = {
  line: svgEditOptions('line'),
  arc: svgEditOptions('arc'),
  rectangle: svgEditOptions('rectangle'),
  circle: svgEditOptions('circle'),
  shape: svgEditOptions('shape'),
  stroke: svgEditOptions('stroke'),
};
