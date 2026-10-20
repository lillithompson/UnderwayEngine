/**
 * Where a painted shape's SIDE previews draw, and with what.
 *
 * The Color brush previews each side it has recoloured as a `<path>` of
 * its own, so a re-touch costs one attribute and a stroke is O(delta) per
 * stamp (CanvasSurface updatePaintPreview). A side is stored in the shape's
 * LOCAL space, and the node draws it through its world matrix — the free
 * turn (`angleDeg`), a group's pose — with the stroke presentation the
 * object's own `stroke` block asks for: the width in the node's units, and
 * an inside / outside alignment drawn at double width and clipped or
 * masked against the filled outline (engine svgStrokePresentation).
 *
 * The preview used to draw the local segment in WORLD px with no matrix
 * and as a plain centred stroke. On a shape with a turn, every side the
 * brush crossed was drawn unturned — somewhere else on the page — and on
 * an inside-stroked one it came out twice as wide as the line under it,
 * and both snapped back on the drop (bug report 85dc9b13: a page of turned,
 * inside-stroked triangles). Here the sides are drawn as the node draws
 * them: in local units, inside a `<g>` whose transform is the node's matrix
 * composed with the world layer's px scale, wearing the shape's own stroke
 * presentation. Kept free of the DOM so the geometry is node-testable.
 */

import type { PathSegment, RGBColor } from '@/engine/types';
import { buildPathD, svgStrokePresentation } from '@/engine/svgPathBuilder';
import { strokeScaleForUnits } from '@/engine/svgStroke';
import { SVG_UNITS_PER_L0_CELL } from '@/engine/svgExport';
import { flattenSVGSegmentsWithColor } from '@/engine/compositionOps';
import { type DrawnLeaf, svgDrawnGeometry } from './drawnPose';

export interface ShapeStrokePreviewFrame {
  /** SVG `transform` for the `<g>` that holds the side previews: the
   *  shape's local units through the node's matrix, into world px. */
  transform: string;
  /** The stroke presentation's `<defs>` markup — the inside clip or the
   *  outside mask, under ids of the preview's own — or ''. */
  defs: string;
  /** The `<path>` attributes every side preview wears (`fill`,
   *  `stroke-width`, caps, dash, the clip / mask reference). */
  attrs: ReadonlyArray<readonly [string, string]>;
  /** The shape's flat (segment, colour) list in the local units
   *  `transform` takes — the flat indices the paint draft accumulates on. */
  flat: ReadonlyArray<{ segment: PathSegment; color: RGBColor }>;
}

/** The preview's own def ids, so they cannot shadow the node's. */
export const PREVIEW_ID_SUFFIX = '__paintPreview';

/**
 * The frame for one painted shape, from its drawn leaf (the committed
 * node, as the stroke found it) and the composition's strokeScale.
 * `pxPerCell` is the world layer's own scale (BASE_CELL_PX).
 */
export function shapeStrokePreviewFrame(
  d: DrawnLeaf, strokeScale: number, pxPerCell: number,
): ShapeStrokePreviewFrame {
  const u = SVG_UNITS_PER_L0_CELL;
  // The object as the node's markup is built from it: everything but the
  // turn folded into its vertices, the matrix left wearing the turn and the
  // world position (drawnPose.svgDrawnGeometry) — so the width a side is
  // drawn at here is the width the node draws it at.
  const geo = svgDrawnGeometry(d);
  const object = { ...geo.object, id: `${geo.object.id}${PREVIEW_ID_SUFFIX}` };
  const { defs, attrs } = svgStrokePresentation(
    object, strokeScaleForUnits(strokeScale, u), u, { nonScaling: false },
  );
  // Local units → cells (÷u) → world cells (the matrix) → world px (×px).
  const m = geo.matrix;
  const k = pxPerCell / u;
  const transform = `matrix(${m.a * k} ${m.b * k} ${m.c * k} ${m.d * k} ${m.e * pxPerCell} ${m.f * pxPerCell})`;
  return {
    transform,
    defs,
    attrs: parseAttrs(attrs),
    flat: flattenSVGSegmentsWithColor(geo.object),
  };
}

/** Path `d` for one side, in the local units the frame's transform takes
 *  — the engine's own walk, so the preview cannot disagree with the node's
 *  markup about how a segment is emitted. */
export function sideD(segment: PathSegment): string {
  return buildPathD([segment]);
}

/** `name="value"` pairs out of an attribute string the engine's markup
 *  builders emit (no quotes inside a value). */
function parseAttrs(attrs: string): Array<readonly [string, string]> {
  const out: Array<readonly [string, string]> = [];
  const re = /([\w-]+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrs)) !== null) out.push([m[1], m[2]]);
  return out;
}
