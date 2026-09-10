/**
 * Paint overlays drawn into <canvas> elements — the ONE way the live DOM
 * shows an {@link ImagePaintOverlay} (an image's or a solid shape's color-tool
 * layer, and the paint tool's island tiles).
 *
 * Why not an <img src="data:image/png…"> / <image href="…">: WebKit keeps a
 * distinct image resource alive for every distinct data URL a document has
 * ever loaded, and does not release them under memory pressure. Encoding the
 * overlay to a fresh data URL per stroke (or, for the live preview, per
 * pointer move) grew the WebContent process by ~25 MB/s on iOS until jetsam
 * killed it (~1.6 GB), reloading the editor mid-session. A canvas holds one
 * bitmap the size of the overlay and is redrawn in place: `putImageData` of
 * a shared `ImageData` view over the overlay's own bytes — no encode, no
 * allocation per redraw, nothing for the resource cache to retain.
 *
 * Data URLs are still right for the SVG EXPORT (a self-contained file) and
 * the thumbnail rasterizer's transient document — see `overlayPngDataUri`.
 */

import type { ImagePaintOverlay } from './types';

/** Attribute the DOM markup builders put on an overlay's canvas slot, valued
 *  with the node id, so the node layer can find and draw it after mount. */
export const PAINT_OVERLAY_CANVAS_ATTR = 'data-paint-overlay';

/** The slice of a 2D context the overlay draw uses. */
export interface OverlayCanvasContext {
  putImageData(data: ImageData, dx: number, dy: number): void;
}

/** The slice of an HTMLCanvasElement the overlay draw uses — narrow so the
 *  helper can be exercised under node with a fake. */
export interface OverlayCanvasLike {
  width: number;
  height: number;
  getContext(contextId: '2d'): OverlayCanvasContext | null;
}

// One ImageData view per overlay byte-array, shared across redraws: the view
// ALIASES the overlay's rgba buffer (no copy), so a working overlay whose
// bytes mutate under a stable reference reads current on every putImageData,
// and a committed overlay (immutable) is wrapped once for its lifetime. The
// tile bytes are straight-alpha like ImageData, so no conversion pass either.
const imageDataCache = new WeakMap<Uint8Array, ImageData>();

/** The ImageData view over an overlay's bytes (shared buffer, no copy). */
export function overlayImageData(overlay: ImagePaintOverlay): ImageData {
  let img = imageDataCache.get(overlay.rgba);
  if (!img) {
    img = new ImageData(
      new Uint8ClampedArray(
        overlay.rgba.buffer as ArrayBuffer, overlay.rgba.byteOffset, overlay.rgba.length,
      ),
      overlay.cols,
      overlay.rows,
    );
    imageDataCache.set(overlay.rgba, img);
  }
  return img;
}

/**
 * Draw an overlay into a canvas at the overlay's native texel size. The
 * bitmap is resized only when the overlay's dims differ (assigning a canvas
 * dimension resets its bitmap, and putImageData covers every texel anyway,
 * so an equal-size draw touches nothing but pixels). CSS stretches the
 * bitmap into the node's frame — the same smooth-upscale contract the
 * former <img> layer had. Returns false when the canvas has no 2D context.
 */
export function drawOverlayToCanvas(canvas: OverlayCanvasLike, overlay: ImagePaintOverlay): boolean {
  if (canvas.width !== overlay.cols) canvas.width = overlay.cols;
  if (canvas.height !== overlay.rows) canvas.height = overlay.rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  ctx.putImageData(overlayImageData(overlay), 0, 0);
  return true;
}

/** The slice of a DOM subtree root the slot draw walks. */
export interface OverlaySlotRoot {
  querySelectorAll(selectors: string): ArrayLike<OverlayCanvasLike & { getAttribute(name: string): string | null }>;
}

/**
 * Draw every overlay canvas slot under `root` — the `<canvas data-paint-overlay="id">`
 * elements the markup builders emit (see `shapePaintOverlaySVG` with the
 * 'canvas' slot) — from the overlay `overlayFor` resolves for its id. Slots
 * whose id resolves to nothing are left untouched. Returns the number drawn.
 */
export function drawPaintOverlaySlots(
  root: OverlaySlotRoot,
  overlayFor: (id: string) => ImagePaintOverlay | undefined,
): number {
  const slots = root.querySelectorAll(`canvas[${PAINT_OVERLAY_CANVAS_ATTR}]`);
  let drawn = 0;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const id = slot.getAttribute(PAINT_OVERLAY_CANVAS_ATTR);
    const overlay = id != null ? overlayFor(id) : undefined;
    if (overlay && drawOverlayToCanvas(slot, overlay)) drawn++;
  }
  return drawn;
}
