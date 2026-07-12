import { CompositionFigure, SVGObject } from './types';
import { CachedFigureSVG, getFigureSVGSync, getFigureSVG } from './svgFigureCache';
import { wrapWithColorOverride } from './svgFigureBuilders';
import { rasterizeSvgToObjectURL } from './svgRasterize';
import { SVG_UNITS_PER_L0_CELL, multiplyStrokeWidths } from './svgExport';
import { buildSVGObjectTileContent } from './svgPathBuilder';

interface CacheEntry {
  objectURL: string;
  widthPx: number;
  heightPx: number;
  cachedRef: CachedFigureSVG | null;
  objRef: SVGObject | null;
  /** For SVG-object entries: the exact rasterizable SVG string this bitmap
   *  was built from. Lets us recognize an identity-only change (a drag
   *  produces a new SVGObject every frame) whose content is unchanged, so
   *  the existing bitmap/objectURL is reused instead of re-rasterized. */
  svgSig: string | null;
  strokeScale: number;
  lastUsedTick: number;
  byteCost: number;
}

interface PrecomputedSVG {
  svg: string;
  widthPx: number;
  heightPx: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Set<string>();
let tick = 0;
let totalBytes = 0;

const BUDGET_BYTES = 96 * 1024 * 1024;

let currentFrameTick = 0;

let rasterizeQueue: Promise<unknown> = Promise.resolve();

interface PendingFigureRebuild {
  kind: 'figure';
  fig: CompositionFigure;
  strokeScale: number;
}
interface PendingSVGRebuild {
  kind: 'svg';
  obj: SVGObject;
  strokeScale: number;
}
type PendingRebuild = PendingFigureRebuild | PendingSVGRebuild;

const pendingDebounced = new Map<string, PendingRebuild>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const STROKE_SCALE_DEBOUNCE_MS = 150;

let onReadyCallback: (() => void) | null = null;

export function setOnTileBitmapReady(cb: () => void): void {
  onReadyCallback = cb;
}

function figureCacheKey(fig: CompositionFigure): string {
  const base = fig.fileId ? `file_${fig.fileId}` : `key_${fig.figureKey}`;
  const tileW = fig.tileWidthL0 ?? fig.cellWidth;
  const tileH = fig.tileHeightL0 ?? fig.cellHeight;
  const ov = fig.colorOverride;
  const bm = fig.colorOverrideBlendMode;
  const colorSuffix = ov ? `_c${ov.r}_${ov.g}_${ov.b}${bm ? `_${bm}` : ''}` : '';
  return `fig_${base}_t${tileW}x${tileH}${colorSuffix}`;
}

function svgObjectCacheKey(obj: SVGObject): string {
  return `svgobj_${obj.id}`;
}

function nextPOT(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

const PX_PER_L0_CELL = 128;
const MIN_AXIS_PX = 64;
const MAX_AXIS_PX_FULL = 1024;
const MAX_AXIS_PX_DEGRADED = 512;

const DEGRADE_RATIO = 0.85;
const RECOVER_RATIO = 0.50;
let currentMaxAxisPx = MAX_AXIS_PX_FULL;

function updatePressureLimit(): void {
  const ratio = totalBytes / BUDGET_BYTES;
  if (currentMaxAxisPx === MAX_AXIS_PX_FULL && ratio >= DEGRADE_RATIO) {
    currentMaxAxisPx = MAX_AXIS_PX_DEGRADED;
  } else if (currentMaxAxisPx === MAX_AXIS_PX_DEGRADED && ratio <= RECOVER_RATIO) {
    currentMaxAxisPx = MAX_AXIS_PX_FULL;
  }
}

function pickFigureRasterSize(fig: CompositionFigure): { widthPx: number; heightPx: number } {
  const tileW = fig.tileWidthL0 ?? fig.cellWidth;
  const tileH = fig.tileHeightL0 ?? fig.cellHeight;
  const max = currentMaxAxisPx;
  const widthPx  = Math.min(max, Math.max(MIN_AXIS_PX, nextPOT(tileW * PX_PER_L0_CELL)));
  const heightPx = Math.min(max, Math.max(MIN_AXIS_PX, nextPOT(tileH * PX_PER_L0_CELL)));
  return { widthPx, heightPx };
}

function pickSVGObjectRasterSize(obj: SVGObject): { widthPx: number; heightPx: number } {
  const tileW = obj.tileWidthL0 ?? obj.cellWidth;
  const tileH = obj.tileHeightL0 ?? obj.cellHeight;
  const max = currentMaxAxisPx;
  const widthPx  = Math.min(max, Math.max(MIN_AXIS_PX, nextPOT(tileW * PX_PER_L0_CELL)));
  const heightPx = Math.min(max, Math.max(MIN_AXIS_PX, nextPOT(tileH * PX_PER_L0_CELL)));
  return { widthPx, heightPx };
}

function estimateBytes(widthPx: number, heightPx: number): number {
  return Math.ceil(widthPx * heightPx * 4 * 4 / 3);
}

function evictToFit(neededBytes: number, protectedKey: string | null): void {
  if (totalBytes + neededBytes <= BUDGET_BYTES) return;

  const entries = Array.from(cache.entries())
    .filter(([k, e]) => k !== protectedKey && e.lastUsedTick < currentFrameTick)
    .sort((a, b) => a[1].lastUsedTick - b[1].lastUsedTick);

  for (const [key, entry] of entries) {
    if (totalBytes + neededBytes <= BUDGET_BYTES) break;
    URL.revokeObjectURL(entry.objectURL);
    cache.delete(key);
    totalBytes -= entry.byteCost;
  }
}

export function beginTileBitmapFrame(): void {
  currentFrameTick = tick + 1;
}

// ── Figure tile bitmaps ─────────────────────────────────────────────

function buildFigureRasterSVG(
  cached: CachedFigureSVG,
  fig: CompositionFigure,
  widthPx: number,
  heightPx: number,
  strokeScale: number,
): string {
  const U = SVG_UNITS_PER_L0_CELL;
  const tileW = (fig.tileWidthL0 ?? fig.cellWidth) * U;
  const tileH = (fig.tileHeightL0 ?? fig.cellHeight) * U;

  const scaleX = tileW / cached.svgWidth;
  const scaleY = tileH / cached.svgHeight;
  const EPSILON = 1e-9;
  const uniformNeeded = Math.abs(scaleX - scaleY) > EPSILON;
  const scaleVal = uniformNeeded ? Math.min(scaleX, scaleY) : scaleX;

  const strokeFactor = (scaleVal !== 1 && scaleVal > 0)
    ? strokeScale / scaleVal
    : strokeScale;
  const styledElements = strokeFactor !== 1
    ? cached.elements.map(el => multiplyStrokeWidths(el, strokeFactor))
    : cached.elements;

  const scaleAttr = scaleVal === 1 ? '' : ` transform="scale(${scaleVal})"`;

  const inner = `<g${scaleAttr}>\n${styledElements.join('\n')}\n</g>`;
  const colored = wrapWithColorOverride(inner, fig);

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
      `width="${widthPx}" height="${heightPx}" ` +
      `viewBox="0 0 ${tileW} ${tileH}" ` +
      `preserveAspectRatio="none" fill="none" stroke="white">`,
    colored,
    `</svg>`,
  ].join('\n');
}

export function getFigureTileBitmapSync(
  fig: CompositionFigure,
  strokeScale: number,
): { objectURL: string; widthPx: number; heightPx: number } | null {
  const key = figureCacheKey(fig);
  const cached = getFigureSVGSync(fig);

  let entry = cache.get(key);

  if (entry && cached && entry.cachedRef === cached && entry.strokeScale === strokeScale) {
    entry.lastUsedTick = ++tick;
    return { objectURL: entry.objectURL, widthPx: entry.widthPx, heightPx: entry.heightPx };
  }

  if (entry && cached && entry.cachedRef === cached) {
    scheduleDebouncedFigureRebuild(key, fig, strokeScale);
  } else {
    queueFigureRebuild(key, fig, strokeScale);
  }

  if (entry) {
    entry.lastUsedTick = ++tick;
    return { objectURL: entry.objectURL, widthPx: entry.widthPx, heightPx: entry.heightPx };
  }
  return null;
}

function queueFigureRebuild(
  key: string,
  fig: CompositionFigure,
  strokeScale: number,
): void {
  pendingDebounced.delete(key);
  if (inFlight.has(key)) return;
  inFlight.add(key);
  rasterizeQueue = rasterizeQueue
    .then(() => buildFigureEntry(key, fig, strokeScale))
    .catch(err => {
      console.warn('[tileBitmapCache] figure build failed:', err);
    })
    .finally(() => {
      inFlight.delete(key);
      onReadyCallback?.();
    });
}

function scheduleDebouncedFigureRebuild(
  key: string,
  fig: CompositionFigure,
  strokeScale: number,
): void {
  pendingDebounced.set(key, { kind: 'figure', fig, strokeScale });
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flushDebouncedRebuilds, STROKE_SCALE_DEBOUNCE_MS);
}

async function buildFigureEntry(
  key: string,
  fig: CompositionFigure,
  strokeScale: number,
): Promise<void> {
  const cached = await getFigureSVG(fig);
  if (!cached) return;

  updatePressureLimit();
  const { widthPx, heightPx } = pickFigureRasterSize(fig);

  const svg = buildFigureRasterSVG(cached, fig, widthPx, heightPx, strokeScale);
  const objectURL = await rasterizeSvgToObjectURL(svg, widthPx, heightPx);
  if (!objectURL) return;

  if (getFigureSVGSync(fig) !== cached) {
    URL.revokeObjectURL(objectURL);
    return;
  }

  const byteCost = estimateBytes(widthPx, heightPx);
  evictToFit(byteCost, key);

  const prior = cache.get(key);
  if (prior) {
    URL.revokeObjectURL(prior.objectURL);
    totalBytes -= prior.byteCost;
  }

  cache.set(key, {
    objectURL,
    widthPx,
    heightPx,
    cachedRef: cached,
    objRef: null,
    svgSig: null,
    strokeScale,
    lastUsedTick: ++tick,
    byteCost,
  });
  totalBytes += byteCost;
}

// ── SVG object tile bitmaps ─────────────────────────────────────────

function buildSVGObjectRasterSVG(
  obj: SVGObject,
  widthPx: number,
  heightPx: number,
  strokeScale: number,
): string {
  const U = SVG_UNITS_PER_L0_CELL;
  const tileW = (obj.tileWidthL0 ?? obj.cellWidth) * U;
  const tileH = (obj.tileHeightL0 ?? obj.cellHeight) * U;
  const tileContent = buildSVGObjectTileContent(obj, strokeScale);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
      `width="${widthPx}" height="${heightPx}" ` +
      `viewBox="0 0 ${tileW} ${tileH}" ` +
      `preserveAspectRatio="none" fill="none">`,
    tileContent,
    `</svg>`,
  ].join('\n');
}

export function getSVGObjectTileBitmapSync(
  obj: SVGObject,
  strokeScale: number,
): { objectURL: string; widthPx: number; heightPx: number } | null {
  const key = svgObjectCacheKey(obj);

  let entry = cache.get(key);

  // Fast path: same object identity + same stroke scale.
  if (entry && entry.objRef === obj && entry.strokeScale === strokeScale) {
    entry.lastUsedTick = ++tick;
    return { objectURL: entry.objectURL, widthPx: entry.widthPx, heightPx: entry.heightPx };
  }

  // Same object, only the stroke scale changed (e.g. zoom): debounce the
  // rebuild so a continuous zoom doesn't re-rasterize on every tick.
  if (entry && entry.objRef === obj) {
    scheduleDebouncedSVGRebuild(key, obj, strokeScale);
    entry.lastUsedTick = ++tick;
    return { objectURL: entry.objectURL, widthPx: entry.widthPx, heightPx: entry.heightPx };
  }

  // Different object identity. A resize drag in repeat mode produces a new
  // SVGObject every frame, but tileOffset compensates for cellX/cellY so the
  // rasterizable tile content is byte-identical across frames. Compare the
  // SVG string we'd rasterize: if it matches the cached entry, adopt the new
  // identity and reuse the existing bitmap — re-rasterizing would swap the
  // div's background-image (revoke old objectURL, set new) every frame and
  // flicker. Only a genuine content change falls through to a rebuild.
  const { widthPx, heightPx } = pickSVGObjectRasterSize(obj);
  const svg = buildSVGObjectRasterSVG(obj, widthPx, heightPx, strokeScale);

  if (entry && entry.svgSig === svg) {
    entry.objRef = obj;
    entry.strokeScale = strokeScale;
    entry.lastUsedTick = ++tick;
    return { objectURL: entry.objectURL, widthPx: entry.widthPx, heightPx: entry.heightPx };
  }

  queueSVGRebuild(key, obj, strokeScale, { svg, widthPx, heightPx });

  if (entry) {
    entry.lastUsedTick = ++tick;
    return { objectURL: entry.objectURL, widthPx: entry.widthPx, heightPx: entry.heightPx };
  }
  return null;
}

function queueSVGRebuild(
  key: string,
  obj: SVGObject,
  strokeScale: number,
  precomputed?: PrecomputedSVG,
): void {
  pendingDebounced.delete(key);
  if (inFlight.has(key)) return;
  inFlight.add(key);
  rasterizeQueue = rasterizeQueue
    .then(() => buildSVGObjectEntry(key, obj, strokeScale, precomputed))
    .catch(err => {
      console.warn('[tileBitmapCache] svgObject build failed:', err);
    })
    .finally(() => {
      inFlight.delete(key);
      onReadyCallback?.();
    });
}

function scheduleDebouncedSVGRebuild(
  key: string,
  obj: SVGObject,
  strokeScale: number,
): void {
  pendingDebounced.set(key, { kind: 'svg', obj, strokeScale });
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flushDebouncedRebuilds, STROKE_SCALE_DEBOUNCE_MS);
}

async function buildSVGObjectEntry(
  key: string,
  obj: SVGObject,
  strokeScale: number,
  precomputed?: PrecomputedSVG,
): Promise<void> {
  let widthPx: number;
  let heightPx: number;
  let svg: string;
  if (precomputed) {
    // The sync getter already computed the SVG string (and used it for the
    // signature compare); reuse it so the stored svgSig matches exactly.
    ({ svg, widthPx, heightPx } = precomputed);
  } else {
    updatePressureLimit();
    ({ widthPx, heightPx } = pickSVGObjectRasterSize(obj));
    svg = buildSVGObjectRasterSVG(obj, widthPx, heightPx, strokeScale);
  }

  const objectURL = await rasterizeSvgToObjectURL(svg, widthPx, heightPx);
  if (!objectURL) return;

  const byteCost = estimateBytes(widthPx, heightPx);
  evictToFit(byteCost, key);

  const prior = cache.get(key);
  if (prior) {
    URL.revokeObjectURL(prior.objectURL);
    totalBytes -= prior.byteCost;
  }

  cache.set(key, {
    objectURL,
    widthPx,
    heightPx,
    cachedRef: null,
    objRef: obj,
    svgSig: svg,
    strokeScale,
    lastUsedTick: ++tick,
    byteCost,
  });
  totalBytes += byteCost;
}

// ── Shared ──────────────────────────────────────────────────────────

function flushDebouncedRebuilds(): void {
  debounceTimer = null;
  const snapshot = Array.from(pendingDebounced.entries());
  pendingDebounced.clear();
  for (const [key, w] of snapshot) {
    if (w.kind === 'figure') {
      queueFigureRebuild(key, w.fig, w.strokeScale);
    } else {
      queueSVGRebuild(key, w.obj, w.strokeScale);
    }
  }
}

export function clearTileBitmapCache(): void {
  for (const entry of cache.values()) {
    URL.revokeObjectURL(entry.objectURL);
  }
  cache.clear();
  inFlight.clear();
  totalBytes = 0;
  pendingDebounced.clear();
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

export function evictFigureTileBitmapByFileId(fileId: string): void {
  const prefix = `fig_file_${fileId}_t`;
  for (const [key, entry] of Array.from(cache.entries())) {
    if (!key.startsWith(prefix)) continue;
    URL.revokeObjectURL(entry.objectURL);
    cache.delete(key);
    totalBytes -= entry.byteCost;
  }
}

export function evictSVGObjectTileBitmap(id: string): void {
  const key = `svgobj_${id}`;
  const entry = cache.get(key);
  if (!entry) return;
  URL.revokeObjectURL(entry.objectURL);
  cache.delete(key);
  totalBytes -= entry.byteCost;
}
