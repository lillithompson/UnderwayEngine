import { Asset } from 'expo-asset';
import { GLView } from 'expo-gl';
import { GridLevel, LayerGridLevel, MAX_LAYER_LEVEL, cellPx } from './types';
import { ATLAS_ASSETS } from './atlasRegistry';
import manifest from '../assets/images/atlases/manifest.json';
import { mark } from './debug/ring'; // TEMP diagnostic

// Sprite registry has moved to ./spriteRegistry so binaryFormat and the
// build-time thumbnail script can use it without dragging in expo-gl.
// Re-exported here for back-compat with existing callers.
export type { SpriteEntry } from './spriteRegistry';
export { SPRITE_ENTRIES } from './spriteRegistry';

// ── Types ────────────────────────────────────────────────────────────

interface RawAtlas {
  data: Uint8Array;
  width: number;
  height: number;
}

interface ManifestEntry {
  spriteId: string;
  family: string;
  connectionCount: number;
  atlases: Record<string, { file: string; col: number; row: number }>;
}

// ── Manifest ─────────────────────────────────────────────────────────

const MANIFEST = manifest as Record<string, ManifestEntry>;

const LEVEL_NAMES: Record<LayerGridLevel, string> = {
  0: 'L0',
  1: 'L1',
  2: 'L2',
  3: 'L3',
  4: 'L4',
};

const LEVEL_CELL_PX: Record<string, number> = {
  L0: 64,
  L1: 128,
  L2: 256,
  L3: 256,
  L4: 256,
};

// ── Atlas Cache ──────────────────────────────────────────────────────

const atlasCache = new Map<string, RawAtlas>();
const atlasLoadPromises = new Map<string, Promise<RawAtlas>>();

// LRU tracking for atlas eviction — 17 registered atlases total ~2 MB
// compressed, ~272 MB uncompressed (17 × 2048×2048×4). Keep them all resident.
const MAX_ATLAS_CACHE = 40;

// Map-based LRU: keys ordered by insertion (Map iteration order). O(1) touch;
// evict scans for the oldest L4 atlas — non-L4 atlases are never evicted
// regardless of the cap.
const atlasLRU = new Map<string, true>();

function isL4Atlas(key: string): boolean {
  return key.includes('_L4_') || key.endsWith('_L4.png');
}

function touchAtlasLRU(key: string): void {
  atlasLRU.delete(key);
  atlasLRU.set(key, true);
  while (atlasLRU.size > MAX_ATLAS_CACHE) {
    let evicted = false;
    for (const candidate of atlasLRU.keys()) {
      if (isL4Atlas(candidate)) {
        atlasLRU.delete(candidate);
        atlasCache.delete(candidate);
        requestedL4Atlases.delete(candidate);
        evicted = true;
        break;
      }
    }
    if (!evicted) break;
  }
}

// ── Scaled Sprite Cache (per-level maps, insertion-order FIFO eviction, max 32 entries total) ──

// Per-level maps keyed by spriteId — avoids string concatenation for cache keys.
// Index 0 is null: L0 grids are never created so no scaled sprites are needed.
const scaledCaches: (Map<string, Uint8Array> | null)[] = [
  null, new Map(), new Map(), new Map(), new Map(), // levels 0-4
];

// Insertion-order eviction for scaled cache. On cache *hit*, skip LRU
// bookkeeping entirely — the O(n) findIndex+splice was a hot-path bottleneck.
// Only track insertion order; evict oldest when cache is full.
const scaledInsertOrder: { spriteId: string; level: number }[] = [];
const MAX_SCALED_CACHE = 32;

function trackScaledInsert(spriteId: string, level: number): void {
  scaledInsertOrder.push({ spriteId, level });
  while (scaledInsertOrder.length > MAX_SCALED_CACHE) {
    const evict = scaledInsertOrder.shift()!;
    scaledCaches[evict.level]?.delete(evict.spriteId);
  }
}

// ── Atlas Upgrade Callbacks ──────────────────────────────────────────

const upgradeCallbacks: (() => void)[] = [];

/** Register a callback to be notified when a higher-res atlas loads */
export function onAtlasUpgrade(cb: () => void): () => void {
  upgradeCallbacks.push(cb);
  return () => {
    const idx = upgradeCallbacks.indexOf(cb);
    if (idx >= 0) upgradeCallbacks.splice(idx, 1);
  };
}

function notifyUpgrade(): void {
  for (const cb of upgradeCallbacks) cb();
}

// ── Paint-Active Deferral ────────────────────────────────────────────

let paintingActive = false;
const deferredAtlasLoads: string[] = [];
const paintingEndCallbacks: (() => void)[] = [];

/** Check whether a paint stroke is currently active. */
export function isPaintingActive(): boolean {
  return paintingActive;
}

/** Register a callback to run when painting ends. Returns an unsubscribe function. */
export function onPaintingEnd(cb: () => void): () => void {
  paintingEndCallbacks.push(cb);
  return () => {
    const idx = paintingEndCallbacks.indexOf(cb);
    if (idx >= 0) paintingEndCallbacks.splice(idx, 1);
  };
}

/** Defer atlas loads while a paint stroke is active to avoid PNG decode on the main thread. */
export function setPaintingActive(active: boolean): void {
  paintingActive = active;
  if (!active) {
    // Drain deferred atlas loads, then clear stale scaled caches and notify
    if (deferredAtlasLoads.length > 0) {
      const queued = deferredAtlasLoads.splice(0);
      Promise.all(queued.map(file => loadAtlasImage(file).catch(() => null)))
        .then(() => {
          for (let lvl = 1; lvl <= 4; lvl++) {
            const cache = scaledCaches[lvl]!;
            if (cache.size > 0) {
              for (const key of cache.keys()) {
                const idx = scaledInsertOrder.findIndex(e => e.spriteId === key && e.level === lvl);
                if (idx >= 0) scaledInsertOrder.splice(idx, 1);
              }
              cache.clear();
            }
          }
          notifyUpgrade();
        });
    }
    // Notify painting-end subscribers (bake, thumbnail, etc.)
    const cbs = paintingEndCallbacks.splice(0);
    for (const cb of cbs) cb();
  }
}

// ── Shared GL Context ───────────────────────────────────────────────

let sharedGLContext: WebGLRenderingContext | null = null;
let sharedGLRefCount = 0;

async function acquireGLContext(): Promise<WebGLRenderingContext> {
  if (!sharedGLContext) {
    mark('acquireGLContext.createStart'); // TEMP diagnostic
    sharedGLContext = await GLView.createContextAsync();
    mark('acquireGLContext.createDone', { ok: !!sharedGLContext }); // TEMP diagnostic
    if (!sharedGLContext) throw new Error('Failed to create GL context');
  }
  sharedGLRefCount++;
  return sharedGLContext;
}

async function releaseGLContext(): Promise<void> {
  sharedGLRefCount--;
  if (sharedGLRefCount <= 0 && sharedGLContext) {
    await GLView.destroyContextAsync(sharedGLContext as any);
    sharedGLContext = null;
    sharedGLRefCount = 0;
  }
}

// ── Atlas Loading ────────────────────────────────────────────────────

function loadAtlasImage(atlasFile: string): Promise<RawAtlas> {
  const existing = atlasCache.get(atlasFile);
  if (existing) {
    touchAtlasLRU(atlasFile);
    return Promise.resolve(existing);
  }

  // Defer new atlas loads while painting to avoid PNG decode contending with the main thread
  if (paintingActive && !atlasLoadPromises.has(atlasFile)) {
    if (!deferredAtlasLoads.includes(atlasFile)) {
      deferredAtlasLoads.push(atlasFile);
    }
    return Promise.resolve(null as any); // caller handles null gracefully via cache miss
  }

  const pending = atlasLoadPromises.get(atlasFile);
  if (pending) return pending;

  const src = ATLAS_ASSETS[atlasFile];
  if (!src) return Promise.reject(new Error(`Unknown atlas: ${atlasFile}`));

  mark('loadAtlasImage.start', { atlasFile }); // TEMP diagnostic
  const promise = (async (): Promise<RawAtlas> => {
    const asset = Asset.fromModule(src);
    await asset.downloadAsync();

    const width = asset.width!;
    const height = asset.height!;

    const gl = await acquireGLContext();

    try {
      const texture = gl.createTexture();

      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Failed to load atlas: ${atlasFile}`));
        image.src = asset.localUri || asset.uri || '';
      });
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

      // Release the HTMLImageElement's decoded bitmap (IOSurface on iOS)
      // immediately rather than waiting for GC.
      img.onload = null;
      img.onerror = null;
      img.src = '';

      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0,
      );
      gl.flush();

      const fbStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (fbStatus !== gl.FRAMEBUFFER_COMPLETE) {
        gl.deleteFramebuffer(fb);
        gl.deleteTexture(texture);
        throw new Error(`Atlas ${atlasFile}: framebuffer incomplete (status ${fbStatus})`);
      }

      const pixels = new Uint8Array(width * height * 4);
      mark('loadAtlasImage.readPixels.start', { atlasFile }); // TEMP diagnostic
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      mark('loadAtlasImage.readPixels.done', { atlasFile }); // TEMP diagnostic

      // Validate that readPixels returned real data. A silent GL failure
      // leaves the buffer all-zero, which would cache transparent sprites
      // permanently with no recovery path.
      let hasContent = false;
      const totalPixels = width * height;
      // +1 pixel so stride isn't row-aligned — ensures samples hit diverse
      // columns instead of always checking column 0 (which misses sparse atlases).
      const sampleStep = (Math.max(1, (totalPixels >> 8)) + 1) * 4;
      for (let i = 0; i < pixels.length; i += sampleStep) {
        if (pixels[i] !== 0) { hasContent = true; break; }
      }
      // Secondary check: sample center of each potential sprite cell.
      // Sparse atlases (few tiles with narrow strokes) can dodge every
      // sample in the diagonal pass above.
      if (!hasContent) {
        const cellPx = 256;
        const mid = cellPx >> 1;
        for (let cy = mid; cy < height && !hasContent; cy += cellPx) {
          for (let cx = mid; cx < width && !hasContent; cx += cellPx) {
            const idx = (cy * width + cx) * 4;
            if (pixels[idx + 3] !== 0) hasContent = true;
          }
        }
      }
      if (!hasContent) {
        mark('loadAtlasImage.zeroReadback', { atlasFile }); // TEMP diagnostic
        gl.deleteFramebuffer(fb);
        gl.deleteTexture(texture);
        throw new Error(`Atlas ${atlasFile}: readPixels returned all-zero data`);
      }

      gl.deleteFramebuffer(fb);
      gl.deleteTexture(texture);

      const raw: RawAtlas = { data: pixels, width, height };
      atlasCache.set(atlasFile, raw);
      touchAtlasLRU(atlasFile);
      return raw;
    } finally {
      await releaseGLContext();
    }
  })();

  atlasLoadPromises.set(atlasFile, promise);
  promise.catch(() => atlasLoadPromises.delete(atlasFile));
  return promise;
}

// ── Extract Sprite from Atlas ────────────────────────────────────────

function extractSprite(
  atlas: RawAtlas,
  col: number,
  row: number,
  spritePx: number,
): Uint8Array {
  const out = new Uint8Array(spritePx * spritePx * 4);
  const atlasW = atlas.width;
  const startX = col * spritePx;
  const startY = row * spritePx;

  for (let y = 0; y < spritePx; y++) {
    const srcOffset = ((startY + y) * atlasW + startX) * 4;
    const dstOffset = y * spritePx * 4;
    out.set(atlas.data.subarray(srcOffset, srcOffset + spritePx * 4), dstOffset);
  }
  return out;
}

// ── Nearest-Neighbor Scale ───────────────────────────────────────────

function scaleTile(
  srcData: Uint8Array,
  srcW: number,
  srcH: number,
  targetSize: number,
): Uint8Array {
  const out = new Uint8Array(targetSize * targetSize * 4);
  for (let py = 0; py < targetSize; py++) {
    const sy = Math.floor((py / targetSize) * srcH);
    for (let px = 0; px < targetSize; px++) {
      const sx = Math.floor((px / targetSize) * srcW);
      const srcIdx = (sy * srcW + sx) * 4;
      const dstIdx = (py * targetSize + px) * 4;
      out[dstIdx] = srcData[srcIdx];
      out[dstIdx + 1] = srcData[srcIdx + 1];
      out[dstIdx + 2] = srcData[srcIdx + 2];
      out[dstIdx + 3] = srcData[srcIdx + 3];
    }
  }
  return out;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Load every atlas referenced in the manifest, prioritized by level.
 * L0 loads first (essential for immediate painting), then L1, then higher.
 * Yields between tiers so touch events can process if painting starts early.
 */
export async function loadAllAtlases(): Promise<void> {
  // Collect atlas files grouped by level
  const byLevel: Map<string, Set<string>> = new Map();
  for (const entry of Object.values(MANIFEST)) {
    for (const [levelName, info] of Object.entries(entry.atlases)) {
      let group = byLevel.get(levelName);
      if (!group) { group = new Set(); byLevel.set(levelName, group); }
      group.add(info.file);
    }
  }

  // Load in priority order: L0 first, then L1, L2, L3.
  // Atlases are loaded sequentially to reuse a single GL context,
  // avoiding concurrent IOSurface allocation from multiple contexts.
  // Hold a ref on the shared GL context so it stays alive across all loads.
  const levelOrder = ['L0', 'L1', 'L2', 'L3'];
  const loaded = new Set<string>();
  await acquireGLContext();
  try {
    for (const level of levelOrder) {
      const files = byLevel.get(level);
      if (!files) continue;
      const toLoad = [...files].filter(f => !loaded.has(f));
      for (const f of toLoad) loaded.add(f);
      if (toLoad.length === 0) continue;
      // Yield before each level so touch events can process
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      for (let i = 0; i < toLoad.length; i++) {
        if (i > 0 && i % 4 === 0) {
          await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
        try {
          await loadAtlasImage(toLoad[i]);
        } catch {
          // Individual atlas failure — continue loading remaining files so
          // higher-level atlases (L3) aren't blocked by a single bad file.
        }
      }
      // Clear scaled cache for this level so stale fallback entries are evicted
      const levelIdx = levelOrder.indexOf(level);
      if (levelIdx > 0) {
        const cache = scaledCaches[levelIdx]!;
        for (const key of cache.keys()) {
          const idx = scaledInsertOrder.findIndex(e => e.spriteId === key && e.level === levelIdx);
          if (idx >= 0) scaledInsertOrder.splice(idx, 1);
        }
        cache.clear();
      }
      // Notify subscribers so the canvas re-renders with newly available sprites
      notifyUpgrade();
    }
  } finally {
    await releaseGLContext();
  }
  // Skip any remaining files (e.g. L4 atlases) — they are loaded on demand
  // per-tile via requestL4Atlas() when getScaledTile() first needs them.
}

/**
 * Load all sprites. Call once on mount.
 */
export function loadAllSprites(): Promise<void> {
  return loadAllAtlases();
}

const requestedL4Atlases = new Set<string>();

function requestL4Atlas(_spriteId: string, atlasFile: string): void {
  if (requestedL4Atlases.has(atlasFile)) return;
  requestedL4Atlases.add(atlasFile);

  loadAtlasImage(atlasFile)
    .then((result) => {
      if (!result) {
        requestedL4Atlases.delete(atlasFile);
        return;
      }
      const l4Cache = scaledCaches[4]!;
      for (const e of Object.values(MANIFEST)) {
        const l4Info = e.atlases['L4'];
        if (l4Info && l4Info.file === atlasFile) {
          l4Cache.delete(e.spriteId);
          const idx = scaledInsertOrder.findIndex(
            lru => lru.spriteId === e.spriteId && lru.level === 4
          );
          if (idx >= 0) scaledInsertOrder.splice(idx, 1);
        }
      }
      notifyUpgrade();
    })
    .catch(() => {
      requestedL4Atlases.delete(atlasFile);
    });
}

/**
 * Background-load a higher-res atlas for a family/level. On completion,
 * clears affected scaled cache entries and signals re-render.
 */
export async function upgradeAtlas(family: string, level: GridLevel): Promise<void> {
  if (level > MAX_LAYER_LEVEL) return; // snap-only levels have no atlas
  const levelName = LEVEL_NAMES[level as LayerGridLevel];
  // Find a sprite from this family to get the atlas filename
  const entry = Object.values(MANIFEST).find(
    (e) => e.family === family && e.atlases[levelName]
  );
  if (!entry) return;
  const atlasFile = entry.atlases[levelName].file;

  // Defer upgrade loads while painting to avoid PNG decode on the JS thread
  if (paintingActive) {
    if (!deferredAtlasLoads.includes(atlasFile)) {
      deferredAtlasLoads.push(atlasFile);
    }
    return;
  }

  await loadAtlasImage(atlasFile);

  // Clear scaled cache entries for sprites in this family at this level
  const levelCache = scaledCaches[level]!;
  for (const e of Object.values(MANIFEST)) {
    if (e.family === family) {
      levelCache.delete(e.spriteId);
      const idx = scaledInsertOrder.findIndex(lru => lru.spriteId === e.spriteId && lru.level === level);
      if (idx >= 0) scaledInsertOrder.splice(idx, 1);
    }
  }

  notifyUpgrade();
}

/**
 * Given the spriteIds in a file, kick off background atlas upgrades
 * for the families/levels needed.
 */
export function preloadForFile(spriteIds: string[]): void {
  const families = new Set<string>();
  for (const id of spriteIds) {
    const entry = MANIFEST[id];
    if (entry) families.add(entry.family);
  }

  // Upgrade L1 first, then L2, then L3
  for (const family of families) {
    upgradeAtlas(family, 1).catch(() => {});
    upgradeAtlas(family, 2).catch(() => {});
    upgradeAtlas(family, 3).catch(() => {});
  }
}

/**
 * Get a pre-scaled tile for the given sprite ID and grid level.
 * Returns sprite pixels at the requested level. If the native-res atlas is
 * loaded, extracts from it; otherwise falls back to the best loaded atlas
 * (L3 > L2 > L1 > L0), rescaling to the target size. Returns null for
 * level 0 or snap-only levels, unknown sprite IDs, or when no atlas has
 * loaded yet.
 */
export function getScaledTile(spriteId: string, level: GridLevel): Uint8Array | null {
  if (level === 0) return null;
  if (level > MAX_LAYER_LEVEL) return null; // snap-only levels have no scaled cache
  const levelCache = scaledCaches[level]!;
  const cached = levelCache.get(spriteId);
  if (cached) {
    // Skip LRU bookkeeping on cache hit — avoids O(n) overhead per touch event
    return cached;
  }

  const entry = MANIFEST[spriteId];
  if (!entry) return null;

  const targetSize = cellPx(level);

  // Try native-res atlas first (level ≤ MAX_LAYER_LEVEL guaranteed by the entry guard)
  const levelName = LEVEL_NAMES[level as LayerGridLevel];
  const atlasInfo = entry.atlases[levelName];
  if (atlasInfo) {
    const atlas = atlasCache.get(atlasInfo.file);
    if (atlas) {
      const nativePx = LEVEL_CELL_PX[levelName];
      const sprite = extractSprite(atlas, atlasInfo.col, atlasInfo.row, nativePx);
      const result = nativePx === targetSize
        ? sprite
        : scaleTile(sprite, nativePx, nativePx, targetSize);
      levelCache.set(spriteId, result);
      trackScaledInsert(spriteId, level);
      return result;
    }
    if (level === 4) {
      requestL4Atlas(spriteId, atlasInfo.file);
    }
  }

  // Fallback: use the best loaded atlas (L3 > L2 > L1 > L0), rescaling to target.
  // Both L0 and L1 are loaded on startup; L2/L3 load in background.
  // Upscaling from a closer resolution minimises stroke-width distortion.
  const FALLBACK_ORDER = ['L3', 'L2', 'L1', 'L0'] as const;
  for (const fbLevel of FALLBACK_ORDER) {
    const fbInfo = entry.atlases[fbLevel];
    if (!fbInfo) continue;
    const fbAtlas = atlasCache.get(fbInfo.file);
    if (!fbAtlas) continue;
    const fbPx = LEVEL_CELL_PX[fbLevel];
    const fbSprite = extractSprite(fbAtlas, fbInfo.col, fbInfo.row, fbPx);
    const result = fbPx === targetSize
      ? fbSprite
      : scaleTile(fbSprite, fbPx, fbPx, targetSize);
    levelCache.set(spriteId, result);
    trackScaledInsert(spriteId, level);
    return result;
  }

  return null;
}
