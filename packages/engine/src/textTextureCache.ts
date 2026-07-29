/**
 * CPU-side raster cache for text nodes. Mirrors the keying / invalidation /
 * LRU discipline of gl/figureTextureCache.ts, but with an injectable
 * rasterizer so it is node-testable and host-agnostic (the shell provides
 * a canvas-backed rasterizer; tests provide a stub).
 *
 * 90 fps rule: the key contains the node's content + full style + a
 * power-of-two bucket of the on-screen pixel size — NOT position,
 * rotation, or mirror — so move/rotate/zoom never re-rasterize. Zoom only
 * re-rasters when it crosses a bucket double, and the renderer scales the
 * cached bitmap in between.
 */

import { TextObject } from './types';
import { createRasterLruCache } from './rasterLruCache';

export interface TextRasterEntry {
  width: number;
  height: number;
  /** Host-specific pixel payload (ImageData, Uint8Array, GL handle box…). */
  data: unknown;
}

export interface TextRasterizer {
  /** Rasterize `text` at `bucketPx` pixels per em (the bucketed value of
   *  `style.size * pxPerCell`). */
  rasterize(text: TextObject, bucketPx: number): TextRasterEntry;
}

/** Default budget: 32 MB of estimated RGBA bytes. */
const DEFAULT_BUDGET_BYTES = 32 * 1024 * 1024;

/** Power-of-two bucket for an on-screen glyph size in pixels. Doubling
 *  buckets absorb zoom: any zoom within [bucket/2, bucket] hits the same
 *  raster. Minimum 1. */
export function textSizeBucket(sizePx: number): number {
  let bucket = 1;
  while (bucket < sizePx) bucket *= 2;
  return bucket;
}

/** Stable serialization of everything that affects the raster. Optional
 *  style fields are normalized so `undefined` and their defaults collide
 *  intentionally (absent bold ≡ bold:false, etc. would still re-raster —
 *  keys only need to be stable, not minimal). */
function styleKey(text: TextObject): string {
  const s = text.style;
  const stroke = s.stroke ? `${s.stroke.width}:${s.stroke.color.r},${s.stroke.color.g},${s.stroke.color.b}` : '-';
  return [
    s.fontId,
    s.size,
    s.bold ? 1 : 0,
    s.italic ? 1 : 0,
    `${s.color.r},${s.color.g},${s.color.b}`,
    s.letterSpacing ?? 0,
    s.lineHeight ?? 0,
    s.align ?? 'left',
    stroke,
    text.sticker ? 'stk' : '-',
  ].join('|');
}

/**
 * Cache key for a text node at a given zoom. Content + full style + POT
 * pixel-size bucket; deliberately excludes position/rotation/mirror so
 * pure transforms are cache hits.
 */
export function textRasterKey(text: TextObject, pxPerCell: number): string {
  const bucket = textSizeBucket(text.style.size * pxPerCell);
  return `txt|${bucket}|${styleKey(text)}|${text.content}`;
}

export interface TextRasterCache {
  /** Cached entry for this node at this zoom; rasterizes on miss. */
  get(text: TextObject, pxPerCell: number): TextRasterEntry;
  /** Entry by exact key, without rasterizing or bumping recency. */
  peek(key: string): TextRasterEntry | undefined;
  /** Drop every entry last produced for this node id. Keying already
   *  invalidates on content/style change; this is for node deletion. */
  invalidateNode(id: string): void;
  clear(): void;
  /** Estimated total bytes held. */
  size(): number;
  entryCount(): number;
}

export function createTextRasterCache(
  rasterizer: TextRasterizer,
  budgetBytes: number = DEFAULT_BUDGET_BYTES,
): TextRasterCache {
  const lru = createRasterLruCache<TextRasterEntry>(budgetBytes);

  return {
    get(text, pxPerCell) {
      const key = textRasterKey(text, pxPerCell);
      const hit = lru.get(key);
      if (hit) return hit;
      const bucket = textSizeBucket(text.style.size * pxPerCell);
      const entry = rasterizer.rasterize(text, bucket);
      lru.set(key, text.id, entry.width * entry.height * 4, entry);
      return entry;
    },
    peek: key => lru.peek(key),
    invalidateNode(id) {
      lru.invalidateOwner(id);
    },
    clear: () => lru.clear(),
    size: () => lru.totalBytes(),
    entryCount: () => lru.entryCount(),
  };
}
