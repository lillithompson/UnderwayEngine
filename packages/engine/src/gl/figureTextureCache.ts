/**
 * GPU-side figure texture cache for the composition canvas's tiled-figure
 * pass. Each cache entry is a POT-on-each-axis mipmapped RGBA texture
 * containing one tile of the figure's pattern, rasterized from its
 * cached SVG. Texture dimensions are picked to match the tile aspect
 * ratio so px-per-SVG-unit is uniform on both axes — critical for
 * non-square figures (e.g. test_data/Figure_4.facet at 4:1) where a
 * forced-square texture squashes one axis to 1/4 resolution and turns
 * thin strokes into a near-invisible smear after AA + mipmapping.
 *
 * Invalidation: an entry is rebuilt when the GL context changes (loss/
 * restore) or when its CachedFigureSVG reference changes (figure was
 * edited and its SVG cache entry rotated). Both checks happen on every
 * sync lookup, so callers don't need to subscribe.
 */

import { CompositionFigure } from '../types';
import { CachedFigureSVG, getFigureSVGSync, getFigureSVG } from '../svgFigureCache';
import { rasterizeSvgToPixels } from '../svgRasterize';
import { SVG_UNITS_PER_L0_CELL, multiplyStrokeWidths } from '../svgExport';

interface CacheEntry {
  texture: WebGLTexture;
  /** POT texture dimensions (per-axis). Always a power of two on each
   *  axis so REPEAT wrap and `generateMipmap` stay valid. */
  widthPx: number;
  heightPx: number;
  /** Reference identity of the SVG entry this texture was built from. */
  cachedRef: CachedFigureSVG;
  /** strokeScale this texture was rasterized with. Texture must rebuild
   *  when the user changes the global stroke scale. */
  strokeScale: number;
  /** GL context that owns this texture; entry is invalid if gl differs. */
  gl: WebGLRenderingContext;
  /** Monotonically incremented on every access; used for LRU eviction. */
  lastUsedTick: number;
  /** Bytes attributable to this entry (RGBA + 33% mipmap overhead). */
  byteCost: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Set<string>();
let tick = 0;
let totalBytes = 0;

/** 96 MB. Sized so a 12-pattern composition at max-aspect POT 1024x1024
 *  (~67 MB working set) sits at ~70% of budget — below the 85% degrade
 *  threshold, so the figures render at full quality without triggering
 *  pressure-aware downsizing. Larger working sets degrade their newest
 *  entries to 512x512 (¼ the bytes) via `updatePressureLimit`, so the
 *  cache can grow well beyond budget without GPU memory exhaustion.
 *  The earlier 64 MB capped at 11 entries, exactly 8 bytes too few
 *  for a 12-pattern scene; the frame-pin defense in evictToFit kept
 *  that case from flickering but pressure-aware degradation would
 *  still kick in around the 10th figure, softening thin strokes. */
const BUDGET_BYTES = 96 * 1024 * 1024;

/** Frame-pin floor. Entries with `lastUsedTick >= currentFrameTick`
 *  are considered "in use this frame" and skipped during eviction so
 *  the renderer can never lose a texture between its sync lookup and
 *  its next draw call. Bumped by `beginFigureTextureFrame` at the
 *  start of each render pass. If eviction can't free enough non-pinned
 *  bytes, the cache overshoots `BUDGET_BYTES` for that frame rather
 *  than producing a flicker — overshoot is bounded by working-set
 *  size, and the next frame settles once anything goes unpinned. */
let currentFrameTick = 0;

/** rasterizeSvgToPixels uses a single pooled canvas — serialize so concurrent
 *  rasterizations don't fight over it. */
let rasterizeQueue: Promise<unknown> = Promise.resolve();

/** Pending debounced rebuilds, keyed by cache key. Holds the latest gl /
 *  fig / strokeScale parameters seen during the debounce window. Drained
 *  by `flushDebouncedRebuilds` when the timer fires. */
interface PendingRebuild {
  gl: WebGLRenderingContext;
  fig: CompositionFigure;
  strokeScale: number;
}
const pendingDebounced = new Map<string, PendingRebuild>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
/** Slider drags fire `strokeScale` changes faster than the rasterizer can
 *  rebuild even one figure. 150 ms is short enough that the post-drag
 *  catch-up feels prompt and long enough to coalesce a typical drag. */
const STROKE_SCALE_DEBOUNCE_MS = 150;

let onReadyCallback: (() => void) | null = null;

export function setOnFigureTextureReady(cb: () => void): void {
  onReadyCallback = cb;
}

/** Cache key — file/figureKey identity plus the tile geometry that
 *  affects rasterization. Two placements of the same figure with
 *  different tileWidthL0/tileHeightL0 must not share a texture, because
 *  the stroke compensation depends on the tile-vs-figure scale. */
function cacheKey(fig: CompositionFigure): string {
  const base = fig.fileId ? `file_${fig.fileId}` : `key_${fig.figureKey}`;
  const tileW = fig.tileWidthL0 ?? fig.cellWidth;
  const tileH = fig.tileHeightL0 ?? fig.cellHeight;
  return `${base}_t${tileW}x${tileH}`;
}

function nextPOT(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

const PX_PER_L0_CELL = 128;
const MIN_AXIS_PX = 64;
/** Total pixel budget for a single texture. Using total pixels instead
 *  of a per-axis max lets non-square tiles (e.g. 15×4) allocate a wider
 *  texture (2048×512) that has roughly uniform px-per-cell on both axes,
 *  without using more memory than a square 1024×1024 texture would.
 *  The per-axis cap was causing the wide axis to be clamped to 1024,
 *  halving its resolution and producing blurry strokes. */
const MAX_TOTAL_PX_FULL = 1024 * 1024;
const MAX_TOTAL_PX_DEGRADED = 512 * 512;

/** Pressure-aware quality. When `totalBytes` exceeds DEGRADE_RATIO of
 *  the budget, future rasterizations cap at the degraded total-pixel
 *  budget so the cache can hold ~4× more entries (¼ the total pixels
 *  → ¼ the bytes) before WebGL context-loss becomes a real risk. Quality
 *  recovers when pressure falls below RECOVER_RATIO. Hysteresis avoids
 *  oscillation during slider drags / pans near the threshold.
 *
 *  Degradation is gradual at the cache level: existing entries keep
 *  their original size, only newly-built (or rebuilt) entries drop
 *  to the degraded budget. As old entries evict, average byte cost
 *  falls toward the degraded ceiling. */
const DEGRADE_RATIO = 0.85;
const RECOVER_RATIO = 0.50;
let currentMaxTotalPx = MAX_TOTAL_PX_FULL;

function updatePressureLimit(): void {
  const ratio = totalBytes / BUDGET_BYTES;
  if (currentMaxTotalPx === MAX_TOTAL_PX_FULL && ratio >= DEGRADE_RATIO) {
    currentMaxTotalPx = MAX_TOTAL_PX_DEGRADED;
  } else if (currentMaxTotalPx === MAX_TOTAL_PX_DEGRADED && ratio <= RECOVER_RATIO) {
    currentMaxTotalPx = MAX_TOTAL_PX_FULL;
  }
}

/** Per-axis POT raster size matched to the tile's aspect ratio. Each
 *  axis targets ~PX_PER_L0_CELL pixels per L0 cell, rounded to POT.
 *  When the ideal texture exceeds the total-pixel budget, we compute a
 *  reduced per-cell target proportional to the tile aspect ratio so the
 *  resulting texture stays aspect-matched. A naive "halve the larger
 *  axis" loop converges toward square — disastrous for a 64×16 tile
 *  (produces 1024×1024 → 16 px/cell on X vs 64 on Y). The proportional
 *  approach gives 2048×512 (32 px/cell, uniform) for the same budget.
 *  POT-on-each-axis is maintained for WebGL 1.0 mipmap + REPEAT-wrap.
 *  The budget follows `currentMaxTotalPx`, which drops under memory
 *  pressure (see updatePressureLimit). */
function pickRasterSize(fig: CompositionFigure): { widthPx: number; heightPx: number } {
  const tileW = fig.tileWidthL0 ?? fig.cellWidth;
  const tileH = fig.tileHeightL0 ?? fig.cellHeight;
  const maxTotalPx = currentMaxTotalPx;

  // Start with ideal resolution (PX_PER_L0_CELL per cell).
  let widthPx  = Math.max(MIN_AXIS_PX, nextPOT(tileW * PX_PER_L0_CELL));
  let heightPx = Math.max(MIN_AXIS_PX, nextPOT(tileH * PX_PER_L0_CELL));

  if (widthPx * heightPx <= maxTotalPx) {
    return { widthPx, heightPx };
  }

  // Ideal exceeds budget. Compute a reduced per-cell target that
  // distributes pixels proportionally to the tile aspect, keeping
  // px-per-cell roughly uniform on both axes.
  const pxPerCell = Math.sqrt(maxTotalPx / (tileW * tileH));
  widthPx  = Math.max(MIN_AXIS_PX, nextPOT(tileW * pxPerCell));
  heightPx = Math.max(MIN_AXIS_PX, nextPOT(tileH * pxPerCell));

  // POT rounding may overshoot; halve the axis with higher per-cell
  // density until it fits. Comparing per-cell density (px/cell) instead
  // of absolute px prevents a 5×15 tile from collapsing to 1024×1024
  // (204 vs 68 px/cell) when 512×2048 (102 vs 137 px/cell) fits the
  // same budget with far more uniform resolution.
  while (widthPx * heightPx > maxTotalPx) {
    if (widthPx / tileW >= heightPx / tileH) widthPx /= 2;
    else heightPx /= 2;
  }
  widthPx  = Math.max(MIN_AXIS_PX, widthPx);
  heightPx = Math.max(MIN_AXIS_PX, heightPx);
  return { widthPx, heightPx };
}

/** @internal Exported for unit testing only. */
export function __pickRasterSizeForTest(
  tileW: number,
  tileH: number,
  maxTotalPx?: number,
): { widthPx: number; heightPx: number } {
  const saved = currentMaxTotalPx;
  if (maxTotalPx !== undefined) currentMaxTotalPx = maxTotalPx;
  try {
    const fig = { tileWidthL0: tileW, cellWidth: tileW, tileHeightL0: tileH, cellHeight: tileH } as CompositionFigure;
    return pickRasterSize(fig);
  } finally {
    currentMaxTotalPx = saved;
  }
}

/** RGBA bytes + 33% mipmap chain overhead (sum of 1/4^n is 4/3). */
function estimateBytes(widthPx: number, heightPx: number): number {
  return Math.ceil(widthPx * heightPx * 4 * 4 / 3);
}

/** Drop entries until total bytes fit in budget. Skips the protected
 *  key AND any entry already accessed during the current render frame
 *  — those are about to be drawn, so evicting them would produce a
 *  one-frame flicker. If too many entries are frame-pinned to free
 *  enough bytes, the caller's `cache.set` is allowed to push totalBytes
 *  past the budget for that frame; a transient overshoot is preferable
 *  to flicker, and the next frame evicts whatever the renderer skipped. */
function evictToFit(neededBytes: number, protectedKey: string | null): void {
  if (totalBytes + neededBytes <= BUDGET_BYTES) return;

  const entries = Array.from(cache.entries())
    .filter(([k, e]) => k !== protectedKey && e.lastUsedTick < currentFrameTick)
    .sort((a, b) => a[1].lastUsedTick - b[1].lastUsedTick);

  for (const [key, entry] of entries) {
    if (totalBytes + neededBytes <= BUDGET_BYTES) break;
    entry.gl.deleteTexture(entry.texture);
    cache.delete(key);
    totalBytes -= entry.byteCost;
  }
}

/** Build the SVG document we'll feed to the rasterizer.
 *
 *  Mirrors engine/svgFigureCache.ts:buildBlockSVGContent so the texture
 *  represents one tile of the pattern with stroke widths matched to the
 *  rest of the composition. Without this, the rasterized stroke is
 *  fixed at the figure's source SVG width and shows up too thin or too
 *  thick relative to non-tiled figures with the same `strokeScale`.
 *
 *  - viewBox covers exactly one tile (tileW × tileH user-space units).
 *  - Figure content is uniformly scaled by `scaleVal` (min of x/y) and
 *    drawn at (0,0); same as the SVG <pattern> path.
 *  - Stroke widths are multiplied by `strokeScale / scaleVal` so the
 *    visual stroke after the scale transform is `5 * strokeScale` units,
 *    independent of figure size.
 *  - The texture's POT dimensions are picked to match the tile aspect
 *    (see pickRasterSize). preserveAspectRatio="none" then performs at
 *    most a small near-uniform stretch from viewBox to texture pixels,
 *    so px-per-SVG-unit stays roughly isotropic and thin strokes don't
 *    smear out under AA + mipmap (Figure_4.facet bug).
 */
function buildRasterSVG(
  cached: CachedFigureSVG,
  fig: CompositionFigure,
  widthPx: number,
  heightPx: number,
  strokeScale: number,
): { svg: string; scaleVal: number } {
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
  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
      `width="${widthPx}" height="${heightPx}" ` +
      `viewBox="0 0 ${tileW} ${tileH}" ` +
      `preserveAspectRatio="none" fill="none" stroke="white">`,
    `<g${scaleAttr}>`,
    ...styledElements,
    `</g>`,
    `</svg>`,
  ].join('\n');
  return { svg, scaleVal };
}

/**
 * Sync lookup. Returns the cached texture if it is current for the given
 * gl context, CachedFigureSVG reference, and strokeScale. Otherwise
 * queues an async rebuild and returns null; the consumer should skip
 * drawing this figure for this frame and rely on the onReady callback
 * to schedule another.
 */
export function getFigureTextureSync(
  gl: WebGLRenderingContext,
  fig: CompositionFigure,
  strokeScale: number,
): { texture: WebGLTexture; widthPx: number; heightPx: number } | null {
  const key = cacheKey(fig);
  const cached = getFigureSVGSync(fig);

  let entry = cache.get(key);

  // Hard-invalid: the prior entry was built on a different GL context
  // (context lost/restored). Drop without deleteTexture — the prior
  // context owns it and is gone.
  if (entry && entry.gl !== gl) {
    cache.delete(key);
    totalBytes -= entry.byteCost;
    entry = undefined;
  }

  // Fresh hit.
  if (entry && cached && entry.cachedRef === cached && entry.strokeScale === strokeScale) {
    entry.lastUsedTick = ++tick;
    return { texture: entry.texture, widthPx: entry.widthPx, heightPx: entry.heightPx };
  }

  // Soft mismatch. Two flavors with different urgency:
  //   - cachedRef changed (figure was edited): the user finished an edit;
  //     rebuild promptly.
  //   - cachedRef matches, only strokeScale changed: the slider may still
  //     be moving. Debounce so we don't burn rebuilds on intermediate
  //     values — for a composition with N tile figures, every slider
  //     tick would otherwise queue N sequential rasterizations.
  // Either way, keep the stale texture visible during the wait.
  if (entry && cached && entry.cachedRef === cached) {
    scheduleDebouncedRebuild(gl, key, fig, strokeScale);
  } else {
    queueRebuild(gl, key, fig, strokeScale);
  }

  if (entry) {
    entry.lastUsedTick = ++tick;
    return { texture: entry.texture, widthPx: entry.widthPx, heightPx: entry.heightPx };
  }
  return null;
}

function queueRebuild(
  gl: WebGLRenderingContext,
  key: string,
  fig: CompositionFigure,
  strokeScale: number,
): void {
  // A direct (immediate) rebuild supersedes any pending debounced one
  // for the same key — we'd otherwise rebuild twice when the timer
  // eventually fires.
  pendingDebounced.delete(key);
  if (inFlight.has(key)) return;
  inFlight.add(key);
  rasterizeQueue = rasterizeQueue
    .then(() => buildEntry(gl, key, fig, strokeScale))
    .catch(err => {
      // eslint-disable-next-line no-console
      console.warn('[figureTextureCache] build failed:', err);
    })
    .finally(() => {
      inFlight.delete(key);
    });
}

function scheduleDebouncedRebuild(
  gl: WebGLRenderingContext,
  key: string,
  fig: CompositionFigure,
  strokeScale: number,
): void {
  // Always overwrite — we want the LATEST strokeScale to land, not the
  // one that arrived first. fig is also re-stored so transient figure
  // refs don't go stale by the time the timer fires.
  pendingDebounced.set(key, { gl, fig, strokeScale });
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flushDebouncedRebuilds, STROKE_SCALE_DEBOUNCE_MS);
}

function flushDebouncedRebuilds(): void {
  debounceTimer = null;
  // Snapshot and clear before queueing so re-entrant calls during
  // queueRebuild can repopulate without us re-processing them here.
  const snapshot = Array.from(pendingDebounced.entries());
  pendingDebounced.clear();
  for (const [key, w] of snapshot) {
    queueRebuild(w.gl, key, w.fig, w.strokeScale);
  }
}

async function buildEntry(
  gl: WebGLRenderingContext,
  key: string,
  fig: CompositionFigure,
  strokeScale: number,
): Promise<void> {
  // Resolve the SVG content (loads from storage if not yet cached).
  const cached = await getFigureSVG(fig);
  if (!cached) return;

  // Pick raster size *now*, after any earlier rebuilds in this queue
  // have updated totalBytes — that lets pressure-aware degradation
  // kick in mid-batch on a cold-open with too many figures to fit at
  // full quality. Picking at queue time would lock in full quality
  // for all N rebuilds before the first one even ran.
  updatePressureLimit();
  const { widthPx, heightPx } = pickRasterSize(fig);

  if (gl.isContextLost()) return;

  const { svg } = buildRasterSVG(cached, fig, widthPx, heightPx, strokeScale);
  const pixels = await rasterizeSvgToPixels(svg, widthPx, heightPx);
  if (!pixels) return;
  if (gl.isContextLost()) return;

  // Premultiply alpha before upload. Canvas2D produces non-premultiplied
  // RGBA, but bilinear filtering and mipmap generation interpolate RGB
  // independently of A — without premultiplication, anti-aliased edges
  // average toward 50% grey instead of staying at the stroke color
  // (e.g. test_data/Figure_4.facet, which is almost entirely AA edges).
  // Paired with the ONE / ONE_MINUS_SRC_ALPHA blend in the tiled-figure
  // pass (see compositionRenderer.drawTiledFigures).
  premultiplyAlphaInPlace(pixels);

  // The figure's SVG may have been evicted and reloaded while we were
  // rasterizing. If so, the cached ref we built from is stale; let the
  // next sync lookup queue a fresh build.
  if (getFigureSVGSync(fig) !== cached) return;

  const byteCost = estimateBytes(widthPx, heightPx);
  evictToFit(byteCost, key);

  const texture = gl.createTexture();
  if (!texture) return;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  // REPEAT wrap is what does the per-tile modulo for the shader: the
  // shader passes through smooth (un-modded) uv that runs from 0 up to
  // tilesPerRegion across the figure, and the GPU wraps at sample time.
  // dFdx/dFdy on the smooth uv are continuous, so mipmap LOD selection
  // is correct across tile boundaries. (Doing the modulo with fract()
  // in the shader instead spikes the derivative at every boundary and
  // makes the GPU pick the lowest mipmap level there — a faint outline
  // around every tile that scales with stroke density.)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA,
    widthPx, heightPx, 0,
    gl.RGBA, gl.UNSIGNED_BYTE,
    pixels,
  );
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.bindTexture(gl.TEXTURE_2D, null);

  // Free the prior texture (if any) — getFigureTextureSync now leaves
  // stale entries in place during rebuilds so dragging strokeScale
  // doesn't flicker, so this is the only point where the old GPU
  // texture is released.
  const prior = cache.get(key);
  if (prior) {
    if (prior.gl === gl && !gl.isContextLost()) gl.deleteTexture(prior.texture);
    totalBytes -= prior.byteCost;
  }

  cache.set(key, {
    texture,
    widthPx,
    heightPx,
    cachedRef: cached,
    strokeScale,
    gl,
    lastUsedTick: ++tick,
    byteCost,
  });
  totalBytes += byteCost;

  onReadyCallback?.();
}

/** Multiply RGB by A in place (Uint8 fixed-point). Standard formula:
 *  `c' = round(c * a / 255)` which we approximate via `(c * a + 127) >> 8`
 *  — accurate within ±1, fast in JS. Skips fully opaque (a=255) and
 *  fully transparent (a=0) pixels. */
function premultiplyAlphaInPlace(pixels: Uint8Array): void {
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a === 255) continue;
    if (a === 0) {
      pixels[i] = 0;
      pixels[i + 1] = 0;
      pixels[i + 2] = 0;
      continue;
    }
    pixels[i]     = (pixels[i]     * a + 127) >> 8;
    pixels[i + 1] = (pixels[i + 1] * a + 127) >> 8;
    pixels[i + 2] = (pixels[i + 2] * a + 127) >> 8;
  }
}

/** Drop every entry. Call when the GL context is lost; the textures are
 *  already invalid at that point so we don't deleteTexture. */
export function clearFigureTextureCache(): void {
  cache.clear();
  inFlight.clear();
  totalBytes = 0;
  pendingDebounced.clear();
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

/** Drop every cache entry for a given file id. There may be more than one
 *  (the cache keys in `${base}_t${W}x${H}`, so a single fileId can have
 *  several entries — one per distinct tile geometry the user has placed,
 *  including group-rotated copies that swap the tile dims). Call alongside
 *  `evictFigureSVGByFileId` when the figure was edited so rotated /
 *  mirrored placements rebuild from the fresh content instead of holding
 *  a stale GPU texture whose `cachedRef` happens to still satisfy the
 *  identity check on the next render. Safe to call when nothing matches.
 *
 *  Iterate over a snapshot (`Array.from`) so mid-loop `cache.delete` does
 *  not break iteration. The `_t` suffix anchors the prefix match — a
 *  fileId can never contain `_t` immediately after itself in a different
 *  fileId's key, so we won't match unrelated entries (e.g. `abc` vs
 *  `abcd`). */
export function evictFigureTextureByFileId(fileId: string): void {
  const prefix = `file_${fileId}_t`;
  for (const [key, entry] of Array.from(cache.entries())) {
    if (!key.startsWith(prefix)) continue;
    if (!entry.gl.isContextLost()) entry.gl.deleteTexture(entry.texture);
    cache.delete(key);
    totalBytes -= entry.byteCost;
  }
}
