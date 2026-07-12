import { SVGDesignTemplate } from './types';
import { SVG_UNITS_PER_L0_CELL, SVG_STROKE_WIDTH } from './svgExport';
import { buildPathD } from './svgPathBuilder';
import { svgToThumbnailDataUri } from './thumbnail';

const DESIGN_THUMB_SIZE = 256;

/**
 * Generate a PNG thumbnail data URI for a saved SVG design.
 * Builds an SVG document from the design's segments and rasterizes it.
 */
export async function generateSVGDesignThumbnail(
  design: SVGDesignTemplate,
): Promise<string | null> {
  if (design.segments.length === 0 && (!Array.isArray(design.subpaths) || design.subpaths.length === 0)) {
    return null;
  }

  const u = SVG_UNITS_PER_L0_CELL;
  const sw = SVG_STROKE_WIDTH;
  const pad = sw * 2;
  const vbW = design.width * u + pad * 2;
  const vbH = design.height * u + pad * 2;
  const attrs = `fill="none" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;

  let paths = '';
  if (Array.isArray(design.subpaths) && design.subpaths.length > 0) {
    for (const sub of design.subpaths) {
      const d = buildPathD(sub.segments);
      if (d) {
        const { r, g, b } = sub.color;
        paths += `<path d="${d}" ${attrs} stroke="rgb(${r},${g},${b})" />`;
      }
    }
  } else {
    const d = buildPathD(design.segments);
    if (d) {
      const { r: cr, g: cg, b: cb } = design.color;
      paths += `<path d="${d}" ${attrs} stroke="rgb(${cr},${cg},${cb})" />`;
    }
  }

  if (!paths) return null;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${vbW}" height="${vbH}" ` +
    `viewBox="${-pad} ${-pad} ${vbW} ${vbH}">${paths}</svg>`;

  return svgToThumbnailDataUri(
    svg, vbW, vbH, DESIGN_THUMB_SIZE,
    () => false,
  );
}
