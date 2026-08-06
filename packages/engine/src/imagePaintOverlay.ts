/**
 * The color tool's paint overlay for images ({@link ImagePaintOverlay}): a
 * hidden low-resolution RGBA layer the brush stamps into, composited over
 * the image with one blend mode. This module owns everything both renderers
 * and the brush must agree on — the texel grid sizing, the stamp math, the
 * PNG the layer renders from, and the BlendMode → CSS mapping — so the DOM
 * preview, the SVG export, and the brush hit the same texels and produce
 * the same picture.
 *
 * The overlay lives in the image's INNER content frame (the box the bitmap
 * fills — dims swapped for 90°/270°), so it rotates/mirrors with the pixels
 * and stretches with the bbox. Coordinates given to `stampImagePaintOverlay`
 * are in that frame, world cell units.
 */

import { BlendMode, ImagePaintOverlay, RGBColor } from './types';
import { gaussianFalloff } from './colorBlend';
import { encodePNG, toBase64 } from './pngcodec';

/** Overlay texel density. At the brush's one-grid-step radius this puts a
 *  few texels under the falloff so a dab reads as a soft dot, while a full
 *  64×64 layer stays a 16 KB bitmap (the "low resolution" contract — the
 *  smooth upscale at render is what makes it read as a wash). */
export const OVERLAY_TEXELS_PER_CELL = 4;
const OVERLAY_MIN_SIDE = 4;
const OVERLAY_MAX_SIDE = 64;

function overlaySide(cells: number): number {
  const n = Math.round(cells * OVERLAY_TEXELS_PER_CELL);
  return Math.max(OVERLAY_MIN_SIDE, Math.min(OVERLAY_MAX_SIDE, n));
}

/** A fresh transparent overlay sized for an inner content frame of
 *  `iwCells × ihCells`, in the stroke's blend mode. */
export function createImagePaintOverlay(
  iwCells: number,
  ihCells: number,
  blend: BlendMode,
): ImagePaintOverlay {
  const cols = overlaySide(iwCells);
  const rows = overlaySide(ihCells);
  return { cols, rows, rgba: new Uint8Array(cols * rows * 4), blend };
}

/** Deep copy, for stroke working state — committed overlays are immutable
 *  (undo entries hold references into past scenes). */
export function clonePaintOverlay(overlay: ImagePaintOverlay): ImagePaintOverlay {
  return { ...overlay, rgba: new Uint8Array(overlay.rgba) };
}

/**
 * Stamp one brush dab into the overlay: every texel whose center lies within
 * `radiusCells` of `(lx, ly)` (inner-frame world cells) takes the brush color
 * source-over at `alpha × gaussianFalloff` — the same falloff curve the
 * segment brush uses, so a dab fades identically on vectors and images.
 * Repeat stamps accumulate toward the brush color at full alpha, which is
 * what makes a slow drag deposit more paint. Returns true when any texel
 * byte actually changed, so callers can skip preview refreshes.
 */
export function stampImagePaintOverlay(
  overlay: ImagePaintOverlay,
  iwCells: number,
  ihCells: number,
  lx: number,
  ly: number,
  radiusCells: number,
  color: RGBColor,
  alpha: number,
): boolean {
  if (iwCells <= 0 || ihCells <= 0 || radiusCells <= 0 || alpha <= 0) return false;
  const { cols, rows, rgba } = overlay;
  const texW = iwCells / cols;
  const texH = ihCells / rows;
  const radiusSq = radiusCells * radiusCells;
  // Only the texel range the brush disc can reach.
  const cMin = Math.max(0, Math.floor((lx - radiusCells) / texW));
  const cMax = Math.min(cols - 1, Math.ceil((lx + radiusCells) / texW));
  const rMin = Math.max(0, Math.floor((ly - radiusCells) / texH));
  const rMax = Math.min(rows - 1, Math.ceil((ly + radiusCells) / texH));
  let changed = false;
  for (let r = rMin; r <= rMax; r++) {
    const cy = (r + 0.5) * texH;
    for (let c = cMin; c <= cMax; c++) {
      const cx = (c + 0.5) * texW;
      const distSq = (cx - lx) * (cx - lx) + (cy - ly) * (cy - ly);
      if (distSq > radiusSq) continue;
      const srcA = alpha * gaussianFalloff(distSq / radiusSq);
      if (srcA <= 0) continue;
      const i = (r * cols + c) * 4;
      // Straight-alpha source-over: the dab composites onto what the stroke
      // (and earlier strokes) already deposited in this texel.
      const dstA = rgba[i + 3] / 255;
      const outA = srcA + dstA * (1 - srcA);
      const write = (off: number, srcC: number) => {
        const dstC = rgba[i + off];
        const v = Math.round((srcC * srcA + dstC * dstA * (1 - srcA)) / outA);
        if (rgba[i + off] !== v) { rgba[i + off] = v; changed = true; }
      };
      write(0, color.r);
      write(1, color.g);
      write(2, color.b);
      const a = Math.round(outA * 255);
      if (rgba[i + 3] !== a) { rgba[i + 3] = a; changed = true; }
    }
  }
  return changed;
}

/** Whether the overlay holds any paint at all (any non-zero alpha). */
export function paintOverlayHasInk(overlay: ImagePaintOverlay): boolean {
  const { rgba } = overlay;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 0) return true;
  return false;
}

/** The PNG data URI both renderers draw the layer from — the engine's own
 *  encoder (pngcodec), so node tests and exports need no canvas. */
export function overlayPngDataUri(overlay: ImagePaintOverlay): string {
  return `data:image/png;base64,${toBase64(encodePNG(overlay.rgba, overlay.cols, overlay.rows))}`;
}

/**
 * A solid shape's paint layer as SVG markup: the overlay <image> stretched
 * over the bbox and clipped to the shape's own closed outline (`fillD`, in
 * the caller's geometry units — the same `d` its fill paints with, so paint
 * can't bleed past the fill). Both SVGObject markup builders — the DOM node
 * layer's buildSVGObjectContent and the exporter — emit the overlay through
 * here, the same single-source rule as svgFillPresentation. The caller wraps
 * this together with its fill element in `<g style="isolation:isolate">` so
 * the blend is confined to the shape.
 */
export function shapePaintOverlaySVG(
  overlay: ImagePaintOverlay,
  id: string,
  fillD: string,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  const clipId = `paintclip_${id}`;
  return `<clipPath id="${clipId}"><path d="${fillD}" fill-rule="nonzero"/></clipPath>` +
    `<image x="${x}" y="${y}" width="${width}" height="${height}"` +
    ` href="${overlayPngDataUri(overlay)}" preserveAspectRatio="none"` +
    ` style="mix-blend-mode:${paintBlendCss(overlay.blend) ?? 'normal'}" clip-path="url(#${clipId})"/>`;
}

/**
 * CSS `mix-blend-mode` for a brush BlendMode, or null for the unary modes
 * (invert / rotate / randomize), which rewrite a base color in place and
 * have no compositing equivalent — the brush skips images entirely for
 * those, the same way it leaves gradient fills alone.
 */
export function paintBlendCss(mode: BlendMode): string | null {
  switch (mode) {
    case 'normal': return 'normal';
    case 'multiply': return 'multiply';
    case 'dodge': return 'color-dodge';
    case 'lighten': return 'lighten';
    case 'darken': return 'darken';
    case 'burn': return 'color-burn';
    case 'hue': return 'hue';
    case 'color': return 'color';
    default: return null;
  }
}
