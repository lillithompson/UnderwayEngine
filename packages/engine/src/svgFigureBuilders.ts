/**
 * Pure SVG-element-string builders for composition figures.
 *
 * Split out of `svgFigureCache.ts` (which contains the storage-backed
 * SVG cache + invalidation machinery) so the build-time composition
 * thumbnail script can import these without dragging in the IndexedDB
 * runtime that the cache depends on.
 *
 * All functions here are pure: they take already-decoded figure data
 * plus a pre-rendered SVG element list and emit SVG markup.
 */

import { BlendMode, CompositionFigure, RGBColor } from './types';
import { SVG_UNITS_PER_L0_CELL, SVG_STROKE_WIDTH, multiplyStrokeWidths, maxStrokeWidth } from './svgExport';
import { blendColor, recolorPixel } from './colorBlend';

export interface CachedFigureSVG {
  /** Raw SVG element strings (no document wrapper) */
  elements: string[];
  /** Figure content width in SVG units */
  svgWidth: number;
  /** Figure content height in SVG units */
  svgHeight: number;
}

/**
 * Build SVG element markup for a figure, positioned in SVG-unit space.
 * Applies quad layout, scale, rotation, and mirror transforms.
 */
export function buildFigureSVGContent(fig: CompositionFigure, cached: CachedFigureSVG, strokeScale: number = 1): string {
  const U = SVG_UNITS_PER_L0_CELL;
  const rotation = fig.rotation ?? 0;
  const mirrorH = fig.mirrorH ?? false;
  const mirrorV = fig.mirrorV ?? false;

  // When rotation is 90° or 270°, the reducer swaps cellWidth/cellHeight
  // for bounding-box positioning. The cached SVG content is always in its
  // original (unrotated) orientation, so we un-swap to get the content size.
  const rotSwapped = rotation === 90 || rotation === 270;

  const quadList = fig.quads
    ? fig.quads.map(q => ({
        cellX: fig.cellX + q.offsetX,
        cellY: fig.cellY + q.offsetY,
        cellWidth: q.cellWidth,
        cellHeight: q.cellHeight,
      }))
    : [{ cellX: fig.cellX, cellY: fig.cellY, cellWidth: fig.cellWidth, cellHeight: fig.cellHeight }];

  const allParts: string[] = [];

  for (let qi = 0; qi < quadList.length; qi++) {
    const quad = quadList[qi];
    // Center of the quad's bounding box (in rotated cell space)
    const qCx = (quad.cellX + quad.cellWidth / 2) * U;
    const qCy = (quad.cellY + quad.cellHeight / 2) * U;

    // Content dimensions: un-swap for 90°/270° to get original orientation
    const contentW = (rotSwapped ? quad.cellHeight : quad.cellWidth) * U;
    const contentH = (rotSwapped ? quad.cellWidth : quad.cellHeight) * U;

    // Scale from cached SVG source to content size.
    // Use uniform scaling to prevent skewing when the figure's aspect
    // ratio doesn't match the cell bounds (e.g. a 5×3 figure in a 2×1 cell).
    const rawScaleX = contentW / cached.svgWidth;
    const rawScaleY = contentH / cached.svgHeight;

    const EPSILON = 1e-9;
    const uniformNeeded = Math.abs(rawScaleX - rawScaleY) > EPSILON;
    const scaleVal = uniformNeeded ? Math.min(rawScaleX, rawScaleY) : rawScaleX;

    const scaledW = cached.svgWidth * scaleVal;
    const scaledH = cached.svgHeight * scaleVal;

    // Center content within the content frame.
    const posX = qCx - scaledW / 2;
    const posY = qCy - scaledH / 2;

    const scaleAttr = scaleVal === 1 ? '' : ` scale(${scaleVal})`;
    const posTransform = `translate(${posX},${posY})${scaleAttr}`;

    // Compensate stroke widths so they stay constant regardless of
    // placement scale (figures placed at L1/L2 are geometrically
    // larger but should have the same visual line weight as L0).
    // Also applies strokeScale so the clip rect can account for it.
    const geomScale = scaleVal;
    const strokeFactor = (geomScale !== 1 && geomScale > 0)
      ? strokeScale / geomScale
      : strokeScale;
    let styledElements: string[];
    if (strokeFactor !== 1) {
      styledElements = cached.elements.map(el => multiplyStrokeWidths(el, strokeFactor));
    } else {
      styledElements = cached.elements;
    }
    // Build combined transform: rotation/mirror then position/scale
    let combinedTransform = posTransform;
    if (rotation !== 0 || mirrorH || mirrorV) {
      const parts: string[] = [];
      parts.push(`translate(${qCx},${qCy})`);
      if (rotation !== 0) parts.push(`rotate(${rotation})`);
      if (mirrorH) parts.push('scale(-1,1)');
      if (mirrorV) parts.push('scale(1,-1)');
      parts.push(`translate(${-qCx},${-qCy})`);
      combinedTransform = `${parts.join(' ')} ${posTransform}`;
    }

    // Apply transform to each element directly — no nested groups
    for (const el of styledElements) {
      allParts.push(insertOrPrependTransform(el, combinedTransform));
    }
  }

  // Wrap in a nested <svg> viewport for bounding-box clipping.
  // Coarse-level cells (L3/L4) can extend well beyond the figure's
  // placement bounds when a clip box crops part of the cell. The
  // viewport clips any overflow, matching buildBlockSVGContent's
  // approach and avoiding clip-path url(#id) which fails in WebKit
  // after DOMParser + adoptNode injection.
  // Use the first (usually only) quad's bounding box for the clip rect.
  const q0 = quadList[0];
  const q0pad = maxStrokeWidth(cached.elements) > 0 ? SVG_STROKE_WIDTH * strokeScale / 2 : 0;
  const cx0 = q0.cellX * U - q0pad;
  const cy0 = q0.cellY * U - q0pad;
  const cw0 = q0.cellWidth * U + 2 * q0pad;
  const ch0 = q0.cellHeight * U + 2 * q0pad;

  const inner = allParts.join('\n');
  const wrapped = `<svg x="${cx0}" y="${cy0}" width="${cw0}" height="${ch0}" overflow="hidden" viewBox="${cx0} ${cy0} ${cw0} ${ch0}">\n${inner}\n</svg>`;
  return wrapWithColorOverride(wrapped, fig);
}

/**
 * If `fig.colorOverride` is set, bake a luminance-weighted recolor into
 * every `fill="…"` and `stroke="…"` attribute in the SVG fragment:
 * `out = base · (1 − lum(base)) + tint · lum(base)`. White pixels become
 * exactly the override color, black stays black, mid-tones shift toward the
 * tint without the per-channel darkening a plain multiply produces.
 *
 * Why bake instead of using an SVG `<filter>`: the same recolor expressed as
 * a filter requires `feComposite operator="arithmetic"`, which Figma and a
 * number of other SVG tools silently drop, leaving the figure untinted on
 * import. Baking colors directly into the element attributes works in every
 * SVG renderer.
 *
 * The PNG-fallback path in `compositionSVGCore` calls this with an
 * `<image>`-only fragment (rasterized figures). There are no fill/stroke
 * attributes to rewrite there, and we can't recolor an embedded PNG without
 * canvas access, so that case falls through to an `feColorMatrix` luminance
 * filter — a best-effort that browsers honor; some import tools won't.
 *
 * Returns the input unchanged when no override is set.
 */
export function wrapWithColorOverride(svg: string, fig: CompositionFigure): string {
  if (!fig.colorOverride) return svg;
  const baked = recolorSvgColorAttrs(svg, fig.colorOverride, fig.colorOverrideBlendMode);
  if (baked !== svg) return baked;
  return wrapImageWithRecolorFilter(svg, fig);
}

/**
 * Rewrites every `fill="…"` / `stroke="…"` attribute in `svg` by blending
 * the parsed base color with `tint` under the given `mode`. When `mode` is
 * undefined, falls back to the legacy luminance-weighted `recolorPixel`.
 *
 * Recognises `rgb(r,g,b)`, `#rrggbb`, `#rgb`, and the named colors that
 * actually appear in this codebase's generated content (`white`, `black`).
 * Leaves `none`, `transparent`, `currentColor`, `url(...)` references, and
 * unknown formats untouched.
 *
 * Returns the input string by reference when no attribute was rewritten, so
 * `wrapWithColorOverride` can detect "nothing to bake" and fall through.
 */
function recolorSvgColorAttrs(svg: string, tint: RGBColor, mode?: BlendMode): string {
  let changed = false;
  const out = svg.replace(/(fill|stroke)="([^"]+)"/g, (match, attr, value) => {
    const base = parseSvgColor(value);
    if (!base) return match;
    const c = mode != null ? blendColor(base, tint, mode, 1) : recolorPixel(base, tint);
    changed = true;
    return `${attr}="rgb(${c.r},${c.g},${c.b})"`;
  });
  return changed ? out : svg;
}

// HTML4 named colors — covers everything the codebase's generated SVG uses
// (white) plus the standard set figures might reference. Extended named
// colors (CSS3 X11 set) are not included; if a figure happens to use one,
// it will pass through unrecolored rather than crash.
const NAMED_COLORS: Record<string, RGBColor> = {
  aqua:    { r: 0,   g: 255, b: 255 },
  black:   { r: 0,   g: 0,   b: 0   },
  blue:    { r: 0,   g: 0,   b: 255 },
  fuchsia: { r: 255, g: 0,   b: 255 },
  gray:    { r: 128, g: 128, b: 128 },
  grey:    { r: 128, g: 128, b: 128 },
  green:   { r: 0,   g: 128, b: 0   },
  lime:    { r: 0,   g: 255, b: 0   },
  maroon:  { r: 128, g: 0,   b: 0   },
  navy:    { r: 0,   g: 0,   b: 128 },
  olive:   { r: 128, g: 128, b: 0   },
  purple:  { r: 128, g: 0,   b: 128 },
  red:     { r: 255, g: 0,   b: 0   },
  silver:  { r: 192, g: 192, b: 192 },
  teal:    { r: 0,   g: 128, b: 128 },
  white:   { r: 255, g: 255, b: 255 },
  yellow:  { r: 255, g: 255, b: 0   },
};

function parseSvgColor(value: string): RGBColor | null {
  const v = value.trim();
  if (v === 'none' || v === 'transparent' || v === 'currentColor' || v.startsWith('url(')) {
    return null;
  }
  const rgbMatch = v.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgbMatch) return { r: +rgbMatch[1], g: +rgbMatch[2], b: +rgbMatch[3] };
  const hex6 = v.match(/^#([0-9a-fA-F]{6})$/);
  if (hex6) {
    const n = parseInt(hex6[1], 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
  }
  const hex3 = v.match(/^#([0-9a-fA-F]{3})$/);
  if (hex3) {
    const r = parseInt(hex3[1][0], 16);
    const g = parseInt(hex3[1][1], 16);
    const b = parseInt(hex3[1][2], 16);
    return { r: r * 17, g: g * 17, b: b * 17 };
  }
  return NAMED_COLORS[v.toLowerCase()] ?? null;
}

/**
 * Fallback for SVG fragments that contain no recolorable attributes (i.e.
 * the baked-PNG `<image>` path). Uses a luminance-projection `feColorMatrix`
 * — that primitive alone is widely supported, but the resulting tint is
 * weaker than the bake-into-attrs path (it lacks the second term that lifts
 * mid-tones toward the tint). Acceptable for the rare raster-fallback case.
 */
function wrapImageWithRecolorFilter(svg: string, fig: CompositionFigure): string {
  if (!fig.colorOverride) return svg;
  const r = fig.colorOverride.r / 255;
  const g = fig.colorOverride.g / 255;
  const b = fig.colorOverride.b / 255;
  const filterId = `recolor-${fig.id}`;
  return (
    `<defs><filter id="${filterId}" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">` +
      `<feColorMatrix type="matrix" values="` +
        `${0.2126 * r} ${0.7152 * r} ${0.0722 * r} 0 0 ` +
        `${0.2126 * g} ${0.7152 * g} ${0.0722 * g} 0 0 ` +
        `${0.2126 * b} ${0.7152 * b} ${0.0722 * b} 0 0 ` +
        `0 0 0 1 0"/>` +
    `</filter></defs>` +
    `<g filter="url(#${filterId})">${svg}</g>`
  );
}

/**
 * Insert or prepend a transform attribute on an SVG element string.
 * If the element already has a transform, the new transform is prepended.
 * Otherwise a transform attribute is inserted after the tag name.
 */
function insertOrPrependTransform(el: string, transform: string): string {
  if (/\stransform="/.test(el)) {
    return el.replace(/transform="([^"]*)"/, (_m, ex) => `transform="${transform} ${ex}"`);
  }
  return el.replace(/^(<\w+)\s/, `$1 transform="${transform}" `);
}

/**
 * Build SVG element markup for a block (tiled) figure, positioned in SVG-unit space.
 * Uses an SVG <pattern> element to tile the figure content within the region.
 * Applies rotation and mirror transforms to the entire tiled rectangle.
 */
export function buildBlockSVGContent(
  fig: CompositionFigure,
  cached: CachedFigureSVG,
  strokeScale: number = 1,
  expandTiles: boolean = false,
): string {
  const U = SVG_UNITS_PER_L0_CELL;
  const rotation = fig.rotation ?? 0;
  const mirrorH = fig.mirrorH ?? false;
  const mirrorV = fig.mirrorV ?? false;

  // When rotation is 90°/270°, the reducer swaps cellWidth/cellHeight for bounding-box
  // positioning. Un-swap to get the original content dimensions before applying SVG rotation.
  const rotSwapped = rotation === 90 || rotation === 270;

  const tileW = (fig.tileWidthL0 ?? fig.cellWidth) * U;
  const tileH = (fig.tileHeightL0 ?? fig.cellHeight) * U;
  const regionW = (rotSwapped ? fig.cellHeight : fig.cellWidth) * U;
  const regionH = (rotSwapped ? fig.cellWidth : fig.cellHeight) * U;

  // Scale from cached SVG source to tile size
  const scaleX = tileW / cached.svgWidth;
  const scaleY = tileH / cached.svgHeight;
  const EPSILON = 1e-9;
  const uniformNeeded = Math.abs(scaleX - scaleY) > EPSILON;
  const scaleVal = uniformNeeded ? Math.min(scaleX, scaleY) : scaleX;

  // Stroke compensation (same logic as buildFigureSVGContent)
  const strokeFactor = (scaleVal !== 1 && scaleVal > 0)
    ? strokeScale / scaleVal
    : strokeScale;
  let styledElements: string[];
  if (strokeFactor !== 1) {
    styledElements = cached.elements.map(el => multiplyStrokeWidths(el, strokeFactor));
  } else {
    styledElements = cached.elements;
  }
  // Expand clip rect by half the visual stroke width (same logic as regular figures)
  const hasStroke = maxStrokeWidth(styledElements) > 0;
  const pad = hasStroke ? SVG_STROKE_WIDTH * strokeScale / 2 : 0;

  const scaleAttr = scaleVal === 1 ? '' : ` scale(${scaleVal})`;

  // Bounding-box position and size (post-swap for 90°/270°, expanded by pad)
  const rx = fig.cellX * U - pad;
  const ry = fig.cellY * U - pad;
  const bboxW = fig.cellWidth * U + 2 * pad;
  const bboxH = fig.cellHeight * U + 2 * pad;

  // Center the pre-rotation rect within the bounding box so rotation
  // maps it exactly onto the bounding-box bounds
  const cx = rx + bboxW / 2;
  const cy = ry + bboxH / 2;
  const rectX = cx - regionW / 2;
  const rectY = cy - regionH / 2;

  // Keep <defs> separate from renderable content so that clip-path
  // definitions are never nested inside a rotation/mirror <g> transform.
  let defs: string;
  let content: string;

  // Tile offset: compensate for origin-side resize so the pattern grid
  // stays fixed in world space. In SVG units.
  const offX = (fig.tileOffsetXL0 ?? 0) * U;
  const offY = (fig.tileOffsetYL0 ?? 0) * U;
  // Pattern grid origin (may differ from rectX/Y when offset is non-zero)
  const patOrgX = rectX + offX;
  const patOrgY = rectY + offY;

  if (expandTiles) {
    // Flat expansion: replicate elements per tile with per-element transforms.
    // No clip paths, no nested groups, no SVG viewport wrapper.
    // Normalize offset into [0, tileW) to find starting tile position.
    const normX = ((offX % tileW) + tileW) % tileW;
    const normY = ((offY % tileH) + tileH) % tileH;
    const startX = normX > 0 ? normX - tileW : 0;
    const startY = normY > 0 ? normY - tileH : 0;
    const cols = Math.ceil((regionW - startX) / tileW);
    const rows = Math.ceil((regionH - startY) / tileH);
    const flatElements: string[] = [];

    // Build rotation/mirror prefix (applied before tile positioning)
    let rotPrefix = '';
    if (rotation !== 0 || mirrorH || mirrorV) {
      const parts: string[] = [];
      parts.push(`translate(${cx},${cy})`);
      if (rotation !== 0) parts.push(`rotate(${rotation})`);
      if (mirrorH) parts.push('scale(-1,1)');
      if (mirrorV) parts.push('scale(1,-1)');
      parts.push(`translate(${-cx},${-cy})`);
      rotPrefix = parts.join(' ') + ' ';
    }

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tx = rectX + startX + col * tileW;
        const ty = rectY + startY + row * tileH;
        const tileTransform = `${rotPrefix}translate(${tx},${ty})${scaleAttr}`.trim();
        for (const el of styledElements) {
          flatElements.push(insertOrPrependTransform(el, tileTransform));
        }
      }
    }

    // Wrap in an <svg> viewport to clip tiles at the region boundary.
    const flatSvg = `<svg x="${rx}" y="${ry}" width="${bboxW}" height="${bboxH}" overflow="hidden" viewBox="${rx} ${ry} ${bboxW} ${bboxH}">\n${flatElements.join('\n')}\n</svg>`;
    return wrapWithColorOverride(flatSvg, fig);
  } else {
    // Use SVG <pattern> for efficient on-screen rendering.
    // The <pattern> element's width/height naturally clip tile content
    // at tile boundaries, so no inner <clipPath> is needed.
    const tileContent = `<g transform="translate(0,0)${scaleAttr}">\n${styledElements.join('\n')}\n</g>`;
    const patternId = `pat_${fig.id}`;
    const pattern = `<pattern id="${patternId}" patternUnits="userSpaceOnUse" x="${patOrgX}" y="${patOrgY}" width="${tileW}" height="${tileH}">\n${tileContent}\n</pattern>`;
    defs = `<defs>${pattern}</defs>`;
    content = `<rect x="${rectX}" y="${rectY}" width="${regionW}" height="${regionH}" fill="url(#${patternId})" stroke="none"/>`;
  }

  // Apply rotation/mirror transforms around bounding-box center
  if (rotation !== 0 || mirrorH || mirrorV) {
    const transforms: string[] = [];
    transforms.push(`translate(${cx},${cy})`);
    if (rotation !== 0) transforms.push(`rotate(${rotation})`);
    if (mirrorH) transforms.push('scale(-1,1)');
    if (mirrorV) transforms.push('scale(1,-1)');
    transforms.push(`translate(${-cx},${-cy})`);
    content = `<g transform="${transforms.join(' ')}">${content}</g>`;
  }

  // Wrap in a nested <svg> viewport for bounding-box clipping.
  // SVG clip-path url(#id) references fail in WebKit after DOMParser +
  // adoptNode injection, so the viewport is the primary clip mechanism.
  // The viewBox preserves the original coordinate system 1:1.
  const patternSvg = `<svg x="${rx}" y="${ry}" width="${bboxW}" height="${bboxH}" overflow="hidden" viewBox="${rx} ${ry} ${bboxW} ${bboxH}">\n${defs}\n${content}\n</svg>`;
  return wrapWithColorOverride(patternSvg, fig);
}
