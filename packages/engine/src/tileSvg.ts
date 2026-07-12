import svgSources from '../assets/images/atlases/svg-sources.json';
import { stripClipPath } from './svgExport';

const SVG_SOURCES = svgSources as Record<string, string>;

const cache = new Map<string, string>();

export function getTileSvgContent(spriteId: string): string | null {
  const cached = cache.get(spriteId);
  if (cached !== undefined) return cached;
  const raw = SVG_SOURCES[spriteId];
  if (!raw) return null;
  const cleaned = stripClipPath(raw);
  cache.set(spriteId, cleaned);
  return cleaned;
}

export function buildTileSvgHtml(svgContent: string, size: number): string {
  return `<svg viewBox="0 0 256 256" width="${size}" height="${size}" fill="none" stroke="white">${svgContent}</svg>`;
}

const dataUriCache = new Map<string, string>();

export function buildTileSvgDataUri(svgContent: string, size: number, strokeColor: string = 'white'): string {
  const key = `${svgContent}:${size}:${strokeColor}`;
  const cached = dataUriCache.get(key);
  if (cached) return cached;
  // Source SVGs hardcode stroke="white" on each path/circle, which overrides
  // any stroke set on the wrapping <svg>. Replace in-content to actually tint.
  const tinted = strokeColor === 'white'
    ? svgContent
    : svgContent.replace(/stroke="white"/g, `stroke="${strokeColor}"`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${size}" height="${size}" fill="none" stroke="${strokeColor}">${tinted}</svg>`;
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  dataUriCache.set(key, uri);
  return uri;
}
