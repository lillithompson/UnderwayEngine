import { RGBColor } from './types';
import { rasterizeSvgToPixels } from './svgRasterize';

/**
 * Snapshot of the composition's SVG layer, rasterized to RGBA pixel data
 * for eyedropper color sampling. Created once when the eyedropper activates
 * and discarded when it deactivates.
 */
export interface EyedropperSnapshot {
  pixels: Uint8Array;
  width: number;
  height: number;
}

/**
 * Capture the composition's SVG layer as a viewport-sized RGBA pixel buffer.
 *
 * The SVG layer's root <div> has a CSS transform applied for camera/zoom.
 * We XML-serialize all live non-draft <svg> roots, wrap the concatenated
 * markup in a <g> carrying the camera transform inside a new standalone
 * <svg>, rasterize via the existing SVG→canvas pipeline, and return the
 * raw pixel data for direct sampling.
 */
export async function captureEyedropperSnapshot(
  svgLayerDiv: HTMLDivElement,
  viewportWidth: number,
  viewportHeight: number,
): Promise<EyedropperSnapshot | null> {
  // The SVG layer uses multiple <svg> roots interleaved with tile <div>s.
  // Serialize all SVG roots (except the draft root) into one composite.
  const svgElements = svgLayerDiv.querySelectorAll(':scope > svg:not([data-draft])');
  if (svgElements.length === 0) return null;

  // Read the CSS transform that the SVG layer applies for camera/zoom.
  const transform = svgLayerDiv.style.transform || 'none';

  // Serialize all live SVG roots into a single content blob.
  const serializer = new XMLSerializer();
  const svgContent = Array.from(svgElements)
    .map(el => serializer.serializeToString(el))
    .join('\n');

  // Build a standalone SVG document at viewport size.
  // The camera transform is applied as a <g transform="..."> wrapping the
  // cloned content so the rasterized image matches what's on screen exactly.
  const wrappedSvg = [
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    `  width="${viewportWidth}" height="${viewportHeight}"`,
    `  viewBox="0 0 ${viewportWidth} ${viewportHeight}">`,
    `<g transform="${cssTransformToSvg(transform)}">`,
    svgContent,
    `</g>`,
    `</svg>`,
  ].join('\n');

  const pixels = await rasterizeSvgToPixels(wrappedSvg, viewportWidth, viewportHeight);
  if (!pixels) return null;

  return { pixels, width: viewportWidth, height: viewportHeight };
}

/**
 * Sample a color from the snapshot at the given viewport-local coordinates.
 * Returns the pixel color, or null if the pixel is fully transparent
 * (indicating empty space where the GL background shows through).
 */
export function sampleSnapshot(
  snapshot: EyedropperSnapshot,
  x: number,
  y: number,
): RGBColor | null {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || ix >= snapshot.width || iy < 0 || iy >= snapshot.height) return null;

  const offset = (iy * snapshot.width + ix) * 4;
  const a = snapshot.pixels[offset + 3];
  // Transparent pixel → nothing drawn here, fall through to GL.
  if (a === 0) return null;

  return {
    r: snapshot.pixels[offset],
    g: snapshot.pixels[offset + 1],
    b: snapshot.pixels[offset + 2],
  };
}

/**
 * Convert a CSS `translate(Xpx, Ypx) scale(S)` to an SVG `matrix(...)`.
 * The SVG layer only uses translate + scale, so we parse just those.
 */
function cssTransformToSvg(css: string): string {
  if (css === 'none' || !css) return '';

  let tx = 0, ty = 0, s = 1;

  const translateMatch = css.match(/translate\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px\s*\)/);
  if (translateMatch) {
    tx = parseFloat(translateMatch[1]);
    ty = parseFloat(translateMatch[2]);
  }

  const scaleMatch = css.match(/scale\(\s*([-\d.]+)\s*\)/);
  if (scaleMatch) {
    s = parseFloat(scaleMatch[1]);
  }

  // SVG matrix: matrix(a, b, c, d, e, f) = [scaleX, 0, 0, scaleY, translateX, translateY]
  return `matrix(${s}, 0, 0, ${s}, ${tx}, ${ty})`;
}
