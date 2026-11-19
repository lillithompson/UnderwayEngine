/**
 * Draw the canvas's GL layer (the grid) again whenever its own canvas is
 * resized.
 *
 * Setting a canvas's `width` or `height` clears its drawing buffer, and
 * expo-gl's web canvas takes its new size in an effect of its own — AFTER
 * the surface has already drawn the grid for the new viewport, into the
 * buffer at its old size. So every resize (an iPad turned, a window
 * resized) left the canvas its plain base grey, gridless, until the next
 * change happened to draw it again (DrawBots report c25db872: "Stop drew
 * it again"). Watching the canvas element itself — the one whose buffer
 * was cleared — draws once more as soon as it stands at its new size, in
 * the same frame, before it is painted.
 *
 * Once per resize (and once as it starts watching), never per frame.
 * Where there is no ResizeObserver, or the context's canvas is not an
 * element (an OffscreenCanvas has no box to watch), it watches nothing.
 * Returns what stops it watching.
 */
export function redrawOnCanvasResize(canvas: unknown, draw: () => void): () => void {
  if (typeof ResizeObserver === 'undefined' || !isElement(canvas)) return stopNothing;
  const ro = new ResizeObserver(() => draw());
  ro.observe(canvas);
  return () => ro.disconnect();
}

function stopNothing(): void {}

function isElement(canvas: unknown): canvas is Element {
  return typeof canvas === 'object' && canvas !== null && (canvas as Node).nodeType === 1;
}
