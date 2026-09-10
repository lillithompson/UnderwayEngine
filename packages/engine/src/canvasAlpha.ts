/**
 * Whether any pixel of a drawn canvas is short of fully opaque.
 *
 * Exact, not sampled: the answer picks the encoder — PNG keeps the alpha,
 * JPEG has none — and a probe that steps past a transparent sliver (the
 * breathing margin a journal export leaves around a page, the soft edge of
 * a brush stroke) would flatten it onto JPEG's white where the viewer's
 * ground was meant to show through. Read in horizontal bands so the peak
 * copy is one band rather than the frame (a 2160² frame is 18.7 MB of RGBA;
 * a 64-row band of it is 550 KB), stopping at the first translucent pixel —
 * a page with a transparent margin answers on its first band.
 */
export const ALPHA_SCAN_BAND_ROWS = 64;

/** The one method the probe needs, shared by the on-screen and offscreen
 *  2D contexts alike. */
export interface AlphaReadable {
  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData;
}

export function canvasHasTransparency(ctx: AlphaReadable, width: number, height: number): boolean {
  for (let y = 0; y < height; y += ALPHA_SCAN_BAND_ROWS) {
    const rows = Math.min(ALPHA_SCAN_BAND_ROWS, height - y);
    const data = ctx.getImageData(0, y, width, rows).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
  }
  return false;
}
