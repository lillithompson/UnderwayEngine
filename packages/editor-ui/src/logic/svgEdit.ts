// The subtype-specific option menus a vector (SVG) selection gets, mirroring
// `imageEdit.ts` for images: an ordered list of actions per subtype, kept pure
// (no react-native) so the tables are unit-tested in node while the component
// owns only the animation.
//
// Every vector subtype offers Stroke — a path IS its stroke, so there is no
// vector object the control doesn't apply to. The table is keyed by subtype
// rather than being one flat list so a subtype can diverge later (a rectangle
// gaining a corner control, a circle a sweep control) without reworking the
// dispatch; today they differ only in the glyph, which names the shape the
// menu belongs to.

import type { SVGSubtypeKind } from '../adapter';

/** The vector-specific editing actions. Stroke opens the Stroke bar — the
 *  Border bar's four rows (Width / Radius / Position / Dash) plus its color
 *  swatch, pointed at the path's own stroke. */
export type SVGEditAction = 'stroke';

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

/** The option menu for one vector subtype, in display order. */
export function svgEditOptions(subtype: SVGSubtypeKind): readonly SVGEditOption[] {
  return [{ action: 'stroke', label: 'Stroke', icon: STROKE_ICON[subtype] ?? STROKE_ICON.stroke }];
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
