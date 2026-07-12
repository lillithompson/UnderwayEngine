import { Layer, CELL_COUNTS, cellPx, FileConfig } from './types';
import { getCell } from './cellEdge';
import svgSources from '../assets/images/atlases/svg-sources.json';
import { simplifySVG } from './simplifySVG';

const SVG_SOURCES = svgSources as Record<string, string>;

// SVG units: L0 cells = 256 SVG units (matching source SVG native 256x256 viewBox)
export const SVG_UNITS_PER_L0_CELL = 256;

/** Visual stroke width in SVG units. adjustStrokeWidth compensates per-layer
 *  scaling so the rendered stroke is always this value regardless of grid level. */
export const SVG_STROKE_WIDTH = 5;

/**
 * Strip clip-path infrastructure from sprite SVG content:
 * removes <defs>...</defs> blocks (containing the 256x256 clip rect)
 * and unwraps <g clip-path="...">...</g> wrappers, keeping inner paths.
 */
export function stripClipPath(content: string): string {
  let result = content.replace(/<defs>[\s\S]*?<\/defs>/g, '');
  result = result.replace(/<g\s+clip-path="[^"]*">([\s\S]*?)<\/g>/g, '$1');
  return result.trim();
}

/**
 * Apply id, transform, and optional opacity to each top-level SVG element.
 * Returns an array of individual element strings (one per vector element).
 */
function applyToElements(
  content: string,
  name: string,
  transform: string,
  opacity?: number,
): string[] {
  const elements: string[] = [];
  let idx = 0;

  // Split content into individual elements by finding each opening tag
  // and its corresponding close (self-closing or paired)
  const elementRe = /<(path|circle|ellipse|line|polyline|polygon|rect)\s[^>]*(?:\/>|>[\s\S]*?<\/\1>)/g;
  let elemMatch: RegExpExecArray | null;

  while ((elemMatch = elementRe.exec(content)) !== null) {
    let elemStr = elemMatch[0];
    const tag = elemMatch[1];
    const suffix = idx === 0 ? '' : `_${idx}`;
    idx++;

    // Extract and remove any existing transform to merge with ours
    const existingTransform = elemStr.match(/\stransform="([^"]*)"/);
    if (existingTransform) {
      elemStr = elemStr.replace(/\stransform="[^"]*"/, '');
    }
    const mergedTransform = existingTransform
      ? `${transform} ${existingTransform[1]}`
      : transform;

    const opacityAttr = (opacity != null && opacity < 1) ? ` opacity="${opacity}"` : '';
    // Insert id and transform after the opening tag name
    const modified = elemStr.replace(
      new RegExp(`^<${tag}\\s`),
      `<${tag} id="${name}${suffix}" transform="${mergedTransform}"${opacityAttr} `,
    );
    elements.push(modified);
  }

  return elements;
}

/**
 * Adjust stroke-width values in SVG content so that after the
 * scale transform (256 → cellSizeSVG), the visual stroke stays constant.
 */
function adjustStrokeWidth(content: string, cellSizeSVG: number): string {
  const adjusted = SVG_STROKE_WIDTH * 256 / cellSizeSVG;
  return content.replace(/stroke-width="[^"]*"/g, `stroke-width="${adjusted}"`);
}

/**
 * Multiply all stroke-width values in an SVG string by a factor.
 * Used to thicken lines for thumbnail rendering at small sizes.
 */
export function multiplyStrokeWidths(svg: string, factor: number): string {
  return svg.replace(/stroke-width="([^"]*)"/g, (_match, val) => {
    const num = parseFloat(val);
    if (isNaN(num)) return _match;
    return `stroke-width="${num * factor}"`;
  });
}

/**
 * Find the maximum stroke-width value across all SVG element strings.
 * Returns 0 if no stroke-width attributes are found.
 */
export function maxStrokeWidth(elements: string[]): number {
  let max = 0;
  const re = /stroke-width="([^"]*)"/g;
  for (const el of elements) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(el)) !== null) {
      const num = parseFloat(m[1]);
      if (!isNaN(num) && num > max) max = num;
    }
    re.lastIndex = 0;
  }
  return max;
}

/**
 * Prepend a transform string to each element's existing transform attribute.
 * Used by composition export to add figure-positioning transforms.
 */
export function prependTransform(elements: string[], transform: string): string[] {
  return elements.map(el =>
    el.replace(/transform="([^"]*)"/, (_match, existing) =>
      `transform="${transform} ${existing}"`,
    ),
  );
}

/**
 * Returns a flat array of SVG element strings (no document wrapper, no <g> groups).
 * Used by both single-figure export and composition export.
 */
export function exportLayersToSVGInner(
  layers: Layer[],
  fileConfig: FileConfig,
): { elements: string[]; widthL0: number; heightL0: number; originL0X: number; originL0Y: number } {
  const widthL0 = fileConfig.widthL0 ?? 32;
  const heightL0 = fileConfig.heightL0 ?? 32;
  const originL0X = fileConfig.originL0X ?? 0;
  const originL0Y = fileConfig.originL0Y ?? 0;

  // When a clip box is active, use its origin as the SVG coordinate
  // origin and its dimensions as the output size. Cells that fall
  // entirely outside the clip region are skipped.
  const clip = fileConfig.clipBox;
  const effectiveOriginL0X = clip ? clip.clipL0X : originL0X;
  const effectiveOriginL0Y = clip ? clip.clipL0Y : originL0Y;
  const effectiveWidthL0 = clip ? clip.clipL0W : widthL0;
  const effectiveHeightL0 = clip ? clip.clipL0H : heightL0;

  const sortedLayers = layers
    .filter((l) => l.visible)
    .sort((a, b) => a.order - b.order);

  const allElements: string[] = [];

  for (let li = 0; li < sortedLayers.length; li++) {
    const layer = sortedLayers[li];
    const count = CELL_COUNTS[layer.level];
    const levelCellPx = cellPx(layer.level);
    const cellSizeSVG = SVG_UNITS_PER_L0_CELL * (levelCellPx / 64);
    const scale = cellSizeSVG / 256;
    const shiftXSVG = layer.shiftX * cellSizeSVG;
    const shiftYSVG = layer.shiftY * cellSizeSVG;
    const originSVGX = effectiveOriginL0X * SVG_UNITS_PER_L0_CELL;
    const originSVGY = effectiveOriginL0Y * SVG_UNITS_PER_L0_CELL;
    const canvasWSVG = effectiveWidthL0 * SVG_UNITS_PER_L0_CELL;
    const canvasHSVG = effectiveHeightL0 * SVG_UNITS_PER_L0_CELL;
    const layerOpacity = layer.opacity < 1 ? layer.opacity : undefined;

    const startY = layer.shiftY === 0.5 ? -1 : 0;
    const startX = layer.shiftX === 0.5 ? -1 : 0;
    for (let y = startY; y < count; y++) {
      for (let x = startX; x < count; x++) {
        const cell = (x === -1 || y === -1) ? getCell(layer, x, y) : layer.cells[y][x];
        if (!cell) continue;

        const px = x * cellSizeSVG + shiftXSVG - originSVGX;
        const py = y * cellSizeSVG + shiftYSVG - originSVGY;

        // Skip cells entirely outside the effective viewport
        if (clip) {
          if (px + cellSizeSVG <= 0 || px >= canvasWSVG) continue;
          if (py + cellSizeSVG <= 0 || py >= canvasHSVG) continue;
        }

        if (cell.type === 'color') {
          // When a clip box is active, clamp the rect to the viewport so
          // coarse-level cells at the clip boundary don't extend beyond it.
          // Without this, the join path bakes overflow geometry that was
          // invisible (the rendering path clips via <svg overflow="hidden">
          // but baked segments have no such viewport).
          let rx = px, ry = py, rw = cellSizeSVG, rh = cellSizeSVG;
          if (clip) {
            const right = Math.min(rx + rw, canvasWSVG);
            const bottom = Math.min(ry + rh, canvasHSVG);
            rx = Math.max(rx, 0);
            ry = Math.max(ry, 0);
            rw = right - rx;
            rh = bottom - ry;
            if (rw <= 0 || rh <= 0) continue;
          }
          let rect = `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="rgb(${cell.r},${cell.g},${cell.b})"`;
          if (layerOpacity != null) rect += ` opacity="${layerOpacity}"`;
          rect += '/>';
          allElements.push(rect);
        } else if (cell.type === 'sprite') {
          const raw = SVG_SOURCES[cell.spriteId];
          if (!raw) continue;

          const tileId = `tile_${x}_${y}`;
          let content = stripClipPath(raw);
          content = adjustStrokeWidth(content, cellSizeSVG);
          if (cell.tintR !== undefined) {
            content = content.replace(/stroke="white"/g, `stroke="rgb(${cell.tintR},${cell.tintG},${cell.tintB})"`);
          }

          // Build a single combined transform: position, scale, then rotation/mirror
          const transforms: string[] = [];
          transforms.push(`translate(${px},${py})`);
          if (scale !== 1) transforms.push(`scale(${scale})`);

          const { rotation, mirrorH, mirrorV } = cell.transform;
          if (rotation !== 0 || mirrorH || mirrorV) {
            transforms.push('translate(128,128)');
            if (rotation !== 0) transforms.push(`rotate(${rotation})`);
            if (mirrorH) transforms.push('scale(-1,1)');
            if (mirrorV) transforms.push('scale(1,-1)');
            transforms.push('translate(-128,-128)');
          }

          const transformStr = transforms.join(' ');
          const elems = applyToElements(content, tileId, transformStr, layerOpacity);
          allElements.push(...elems);
        }
      }
    }
  }

  return {
    elements: allElements,
    widthL0: effectiveWidthL0,
    heightL0: effectiveHeightL0,
    originL0X: effectiveOriginL0X,
    originL0Y: effectiveOriginL0Y,
  };
}

/**
 * Sanitize a name for use as an SVG id attribute.
 */
function sanitizeId(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// One-entry cache: when generateThumbnail and bakeFile both call exportToSVG
// with the same layers in the same persist cycle, the second call is free.
// Uses cellsGeneration sums instead of reference equality so in-place cell
// mutations (painting) correctly invalidate the cache.
let _svgCacheFingerprint: number | null = null;
let _svgCacheFileId: string | null = null;
let _svgCacheResult: string | null = null;

/** Compute a lightweight fingerprint that changes when any layer content or structure changes. */
function layerFingerprint(layers: Layer[]): number {
  let fp = layers.length;
  for (const l of layers) {
    fp += l.cellsGeneration;
    // Include structural properties: simple hash via char codes of id
    for (let i = 0; i < l.id.length; i++) fp += l.id.charCodeAt(i);
    fp += l.visible ? 1000003 : 0;
    fp += l.order * 997;
    fp += l.opacity * 991;
    fp += l.shiftX * 983;
    fp += l.shiftY * 977;
  }
  return fp;
}

/**
 * Export layers as an SVG document string.
 */
export function exportToSVG(
  layers: Layer[],
  fileConfig: FileConfig,
): string {
  // Fold dimensions + origin + clip box into the cache fingerprint — an
  // origin-only move doesn't bump layer generation but must still re-emit.
  let fp = layerFingerprint(layers)
    + (fileConfig.widthL0 ?? 32) * 19
    + (fileConfig.heightL0 ?? 32) * 23
    + (fileConfig.originL0X ?? 0) * 29
    + (fileConfig.originL0Y ?? 0) * 31;
  if (fileConfig.clipBox) {
    fp += fileConfig.clipBox.clipL0X * 37
      + fileConfig.clipBox.clipL0Y * 41
      + fileConfig.clipBox.clipL0W * 43
      + fileConfig.clipBox.clipL0H * 47;
  }
  if (_svgCacheFingerprint === fp && _svgCacheFileId === fileConfig.id && _svgCacheResult !== null) {
    return _svgCacheResult;
  }

  // exportLayersToSVGInner handles clip box internally — it returns
  // clip-region dimensions and clip-origin-relative coordinates when
  // a clip box is active, so no additional viewport adjustment is needed.
  const { elements: rawElements, widthL0: outW, heightL0: outH } = exportLayersToSVGInner(layers, fileConfig);
  const elements = simplifySVG(rawElements);
  const svgId = sanitizeId(fileConfig.name || 'figure');

  const canvasW = outW * SVG_UNITS_PER_L0_CELL;
  const canvasH = outH * SVG_UNITS_PER_L0_CELL;

  const result = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg id="${svgId}" xmlns="http://www.w3.org/2000/svg" ` +
    `width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}" ` +
    `fill="none" stroke="white">`,
    ...elements,
    `</svg>`,
  ].join('\n');

  _svgCacheFingerprint = fp;
  _svgCacheFileId = fileConfig.id;
  _svgCacheResult = result;

  return result;
}

/** Count control vertices across an array of SVG element strings. */
export function countSVGCVs(elements: string[]): number {
  let total = 0;
  for (const el of elements) {
    const dMatch = el.match(/\bd="([^"]*)"/);
    if (!dMatch) continue;
    const d = dMatch[1];
    const commands = d.match(/[MmLlHhVvCcSsQqTtAaZz]/g);
    if (!commands) continue;
    for (const cmd of commands) {
      switch (cmd) {
        case 'M': case 'm': case 'L': case 'l':
        case 'H': case 'h': case 'V': case 'v':
        case 'T': case 't': case 'A': case 'a':
          total += 1; break;
        case 'S': case 's': case 'Q': case 'q':
          total += 2; break;
        case 'C': case 'c':
          total += 3; break;
      }
    }
  }
  return total;
}
