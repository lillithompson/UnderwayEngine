/**
 * The live-stroke preview canvas for a color-tool paint overlay, redrawn in
 * place per stamp (`drawOverlayToCanvas`) rather than an `<img>`/`<image>`
 * handed a fresh PNG data URL per pointer move — WebKit retains every
 * distinct data URL a document loads for the document's lifetime, and at
 * pointer-event rate that grew the WebContent process by ~25 MB/s until iOS
 * jetsammed it (see engine/overlayCanvas.ts).
 *
 * ONE carrier for both hosts: a plain HTML `<canvas>` inside the node's own
 * paint host, CSS-stretched over its frame, blended with the overlay's mode.
 *  - an image's sits beside its committed layer in the image's clip div;
 *  - a solid shape's sits between the shape's fill svg and its strokes svg
 *    (shapePaintDom.ts), cut to the outline by the fill half's own clip —
 *    `clip-path: url(#…)`, never a `<foreignObject>` in the svg, which is a
 *    composited layer WebKit places on its own terms (engine
 *    imagePaintOverlay.ts, shapePaintClipMarkup).
 *
 * The styling is the committed layer's exactly ({@link paintCanvasStyle} is
 * what NodeLayer mounts too), so hiding one and showing the other reads
 * seamless.
 *
 * `doc` is the element factory — the real `document` in the editor, a fake
 * under node — which is what keeps this module testable.
 */

import type { ImagePaintOverlay } from '@/engine/types';
import { paintBlendCss } from '@/engine/imagePaintOverlay';
import { drawOverlayToCanvas } from '@/engine/overlayCanvas';

/** The document surface these builders need (a subset of `Document`). */
export interface ElementFactory {
  createElement(tagName: 'canvas'): HTMLCanvasElement;
}

/** The inline style a paint canvas wears, committed or previewed: filling
 *  its host, composited with the overlay's blend, and — for a shape — cut
 *  with the outline clip `clipId` names. A plain object so React can wear
 *  it as `style` and an imperative builder can `Object.assign` it. */
export interface PaintCanvasStyle {
  position: 'absolute';
  inset: string;
  width: string;
  height: string;
  pointerEvents: 'none';
  userSelect: 'none';
  mixBlendMode: string;
  clipPath?: string;
}

export function paintCanvasStyle(
  overlay: Pick<ImagePaintOverlay, 'blend'>,
  clipId: string | null = null,
): PaintCanvasStyle {
  return {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    pointerEvents: 'none', userSelect: 'none',
    mixBlendMode: paintBlendCss(overlay.blend) ?? 'normal',
    ...(clipId ? { clipPath: `url(#${clipId})` } : {}),
  };
}

/**
 * A working-overlay canvas, drawn once with `overlay`, at the overlay's
 * texel size (width/height attrs) and styled by {@link paintCanvasStyle} —
 * clipped when `clipId` names the shape's outline clip, unclipped (an
 * image, or a shape with no closed outline) otherwise.
 */
export function createPaintPreviewCanvas(
  doc: ElementFactory,
  overlay: ImagePaintOverlay,
  clipId: string | null = null,
): HTMLCanvasElement {
  const el = doc.createElement('canvas');
  el.width = overlay.cols;
  el.height = overlay.rows;
  Object.assign(el.style, paintCanvasStyle(overlay, clipId));
  drawOverlayToCanvas(el, overlay);
  return el;
}
