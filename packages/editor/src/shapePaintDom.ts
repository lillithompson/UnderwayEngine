/**
 * A shape node's DOM as the paint tool finds it, and the two forms it takes:
 *
 *  - ONE svg (`data-shape-fill`), the shape's whole markup inside it — every
 *    unpainted shape, which is nearly every shape on a page.
 *  - TWO svgs, the fill half and the strokes half (`data-shape-strokes`),
 *    with the paint layer's HTML `<canvas>` mounted between them — a shape
 *    that carries committed paint (NodeLayer renders it so), or one a paint
 *    stroke is previewing on (this module splits it for the stroke and puts
 *    it back on the drop).
 *
 * The canvas is an HTML element in the node's own box rather than a
 * `<foreignObject>` inside the svg because a foreignObject's canvas is a
 * composited layer WebKit sizes and places on its own terms — enormous and
 * out of place on iOS, scaled unsmoothed everywhere (engine
 * imagePaintOverlay.ts, shapePaintClipMarkup). Between two svgs it still
 * composites over the fill and under the outline, the order the one-svg
 * form and the export draw the paint in.
 *
 * Both forms mount through {@link mountShapeMarkup}, the one place that
 * knows which form a node is in — so the imperative previews (the Color
 * brush re-fill, a tile stroke into a pattern fill) re-mount a painted
 * shape as two halves and an unpainted one whole, and a preview never
 * mounts a form React did not.
 *
 * Kept to the slice of the DOM it touches (the interfaces below), so it is
 * node-testable with fakes, like paintOverlayPreview.ts.
 */

import type { DrawnLeaf, SvgDrawnGeometry, SvgLayerSplit } from './drawnPose';
import { svgLayerMarkup, svgLayerSplitMarkup } from './drawnPose';

/** On the shape's content svg — the only one in the one-svg form, the fill
 *  half in the two-svg form. */
export const SHAPE_FILL_SVG_ATTR = 'data-shape-fill';
/** On the strokes half's svg; its presence is what says a node is split. */
export const SHAPE_STROKES_SVG_ATTR = 'data-shape-strokes';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The slice of an svg element the mount and split touch. */
export interface ShapeSvgLike {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  innerHTML: string;
  style: { cssText: string };
  after(node: ShapeSvgLike): void;
  remove(): void;
}

/** The slice of the shape's paint host (the element holding its svgs). */
export interface ShapeHostLike {
  querySelector(selectors: string): ShapeSvgLike | null;
  style: { opacity: string };
}

/** The slice of `document` the split needs. */
export interface SvgElementFactory {
  createElementNS(ns: string, qualifiedName: 'svg'): ShapeSvgLike;
}

/** The shape's content svg(s): `strokes` is null in the one-svg form. */
export function shapeContentSvgs(host: ShapeHostLike): { fill: ShapeSvgLike | null; strokes: ShapeSvgLike | null } {
  return {
    fill: host.querySelector(`svg[${SHAPE_FILL_SVG_ATTR}]`),
    strokes: host.querySelector(`svg[${SHAPE_STROKES_SVG_ATTR}]`),
  };
}

/**
 * Mount the shape's markup into whichever form its DOM is in — both halves
 * of a split node, the whole of an unsplit one — off the same readers
 * NodeLayer draws from. `geometry` is the caller's reading of
 * svgDrawnGeometry when it has one (a preview of the shape's own content
 * over the committed node's geometry). Returns the split when the node is
 * split, null otherwise (or when it has no svg to mount into).
 */
export function mountShapeMarkup(
  host: ShapeHostLike, d: DrawnLeaf, strokeScale: number, geometry?: SvgDrawnGeometry,
): SvgLayerSplit | null {
  const { fill, strokes } = shapeContentSvgs(host);
  if (!fill) return null;
  if (strokes) {
    const split = svgLayerSplitMarkup(d, strokeScale, geometry);
    fill.setAttribute('viewBox', split.viewBox);
    fill.innerHTML = split.fill;
    strokes.setAttribute('viewBox', split.viewBox);
    strokes.innerHTML = split.strokes;
    return split;
  }
  const { viewBox, html } = svgLayerMarkup(d, strokeScale, geometry);
  fill.setAttribute('viewBox', viewBox);
  fill.innerHTML = html;
  return null;
}

/** What {@link splitShapeDom} made, for {@link unsplitShapeDom} to undo. */
export interface ShapeSplit {
  strokes: ShapeSvgLike;
  /** The host's opacity before the split wore the shape's own. */
  prevOpacity: string;
}

/**
 * Split a one-svg shape into its two halves for a paint stroke's preview:
 * a strokes svg is made in the fill svg's image (same size, aspect and
 * inline style) and placed after it, both halves are mounted, and the
 * host wears the whole-object opacity the halves no longer carry. Null
 * when the node is already split (React's painted form — nothing to do)
 * or has no svg.
 */
export function splitShapeDom(
  doc: SvgElementFactory, host: ShapeHostLike, d: DrawnLeaf, strokeScale: number,
): ShapeSplit | null {
  const { fill, strokes } = shapeContentSvgs(host);
  if (!fill || strokes) return null;
  const el = doc.createElementNS(SVG_NS, 'svg');
  for (const name of ['width', 'height', 'preserveAspectRatio']) {
    const value = fill.getAttribute(name);
    if (value != null) el.setAttribute(name, value);
  }
  el.style.cssText = fill.style.cssText;
  el.setAttribute(SHAPE_STROKES_SVG_ATTR, '');
  fill.after(el);
  const split = mountShapeMarkup(host, d, strokeScale);
  const prevOpacity = host.style.opacity;
  if (split && split.opacity < 1) host.style.opacity = String(split.opacity);
  return { strokes: el, prevOpacity };
}

/**
 * Put a shape {@link splitShapeDom} split back into its one-svg form: the
 * strokes svg comes out, the host's opacity goes back, and the whole
 * markup is re-mounted from `d` — the COMMITTED node, so the drop shows
 * the shape as it was (React re-renders it in the painted form in the same
 * tick when the stroke committed paint). With no `d` (the shape left the
 * scene mid-stroke) the svg is left for React to unmount.
 */
export function unsplitShapeDom(
  host: ShapeHostLike, split: ShapeSplit, d: DrawnLeaf | null, strokeScale: number,
): void {
  split.strokes.remove();
  host.style.opacity = split.prevOpacity;
  if (d) mountShapeMarkup(host, d, strokeScale);
}
