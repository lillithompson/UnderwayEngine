import storage from './storage';
import { Layer, cellPx, CELL_COUNTS, GridLevel, FileConfig, ClipBox } from './types';
import { exportToSVG } from './svgExport';
import { canvasMirrorBounds } from './canvas-bounds';
import { logToNative } from '@/native-shell/bridge/webBridge';
// svgToThumbnailDataUri is loaded lazily to avoid pulling in thumbnail.ts's
// transitive react-native dependency (via compositionExport) at import time.
let _svgToThumbnailDataUri: typeof import('./thumbnail').svgToThumbnailDataUri | null = null;
async function getSvgToThumbnailDataUri() {
  if (!_svgToThumbnailDataUri) {
    const mod = await import('./thumbnail');
    _svgToThumbnailDataUri = mod.svgToThumbnailDataUri;
  }
  return _svgToThumbnailDataUri;
}

const BAKED_INDEX_KEY = 'baked_fig_index';
const FIG_PALETTE_THUMB_SIZE = 96;

// Inline clip box loading to avoid circular import with persistence.ts.
async function loadClipBoxForBake(fileId: string): Promise<ClipBox | undefined> {
  const raw = await storage.getItem(`clip_box_${fileId}`);
  if (!raw) return undefined;
  return JSON.parse(raw);
}

// ── Baked thumbnail event listeners ────────────────────────────────

type BakedThumbListener = (fileId: string, dataUri: string) => void;
const bakedThumbListeners = new Set<BakedThumbListener>();

export function onBakedThumbReady(cb: BakedThumbListener): void {
  bakedThumbListeners.add(cb);
}

export function offBakedThumbReady(cb: BakedThumbListener): void {
  bakedThumbListeners.delete(cb);
}

function notifyBakedThumbListeners(fileId: string, dataUri: string): void {
  for (const cb of bakedThumbListeners) cb(fileId, dataUri);
}

export interface BakedFigureInfo {
  fileId: string;
  resolutionX: number;
  resolutionY: number;
  contentHash: string;
  pxWidth: number;
  pxHeight: number;
}

// ── Generation counters for cancellation ────────────────────────────

const bakeGenMap = new Map<string, number>();

function yieldTick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 8));
}

function isCurrent(fileId: string, gen: number): boolean {
  return bakeGenMap.get(fileId) === gen;
}

// ── Content hashing ─────────────────────────────────────────────────

export function hashFileContent(
  layers: Layer[],
  widthL0?: number,
  heightL0?: number,
  originL0X: number = 0,
  originL0Y: number = 0,
  clipBox?: ClipBox,
): string {
  const visible = layers
    .filter(l => l.visible)
    .sort((a, b) => a.order - b.order);

  let hash = 5381;
  if (widthL0 != null) hash = ((hash << 5) + hash + widthL0) | 0;
  if (heightL0 != null) hash = ((hash << 5) + hash + heightL0) | 0;
  // Fold origin into the hash so an origin-only move (with no cell edits)
  // still invalidates a cached bake — the visible crop changes.
  hash = ((hash << 5) + hash + originL0X) | 0;
  hash = ((hash << 5) + hash + originL0Y) | 0;
  // Fold clip box into the hash so clip-only changes invalidate the cache.
  if (clipBox) {
    hash = ((hash << 5) + hash + clipBox.clipL0X) | 0;
    hash = ((hash << 5) + hash + clipBox.clipL0Y) | 0;
    hash = ((hash << 5) + hash + clipBox.clipL0W) | 0;
    hash = ((hash << 5) + hash + clipBox.clipL0H) | 0;
  }
  for (let li = 0; li < visible.length; li++) {
    const layer = visible[li];
    hash = ((hash << 5) + hash + layer.level) | 0;
    // Encode shiftX/shiftY as integers (0 or 5 for 0.5)
    hash = ((hash << 5) + hash + (layer.shiftX * 10)) | 0;
    hash = ((hash << 5) + hash + (layer.shiftY * 10)) | 0;

    const count = CELL_COUNTS[layer.level];
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        const cell = layer.cells[y]?.[x];
        if (cell === null || cell === undefined) {
          hash = ((hash << 5) + hash) | 0;
        } else if (cell.type === 'color') {
          hash = ((hash << 5) + hash + 1) | 0;
          hash = ((hash << 5) + hash + cell.r) | 0;
          hash = ((hash << 5) + hash + cell.g) | 0;
          hash = ((hash << 5) + hash + cell.b) | 0;
          hash = ((hash << 5) + hash + (cell.transform.mirrorH ? 1 : 0)) | 0;
          hash = ((hash << 5) + hash + (cell.transform.mirrorV ? 1 : 0)) | 0;
          hash = ((hash << 5) + hash + cell.transform.rotation) | 0;
        } else if (cell.type === 'sprite') {
          hash = ((hash << 5) + hash + 2) | 0;
          for (let i = 0; i < cell.spriteId.length; i++) {
            hash = ((hash << 5) + hash + cell.spriteId.charCodeAt(i)) | 0;
          }
          hash = ((hash << 5) + hash + (cell.transform.mirrorH ? 1 : 0)) | 0;
          hash = ((hash << 5) + hash + (cell.transform.mirrorV ? 1 : 0)) | 0;
          hash = ((hash << 5) + hash + cell.transform.rotation) | 0;
          hash = ((hash << 5) + hash + (cell.tintR ?? -1)) | 0;
          hash = ((hash << 5) + hash + (cell.tintG ?? -1)) | 0;
          hash = ((hash << 5) + hash + (cell.tintB ?? -1)) | 0;
        }
      }
    }
  }

  return (hash >>> 0).toString(36);
}

// ── Bounding box ────────────────────────────────────────────────────

export interface BoundingBox {
  pxMinX: number;
  pxMinY: number;
  pxMaxX: number;
  pxMaxY: number;
  resolutionX: number;
  resolutionY: number;
}

export function computeBoundingBox(
  layers: Layer[],
  widthL0?: number,
  heightL0?: number,
  originL0X: number = 0,
  originL0Y: number = 0,
  clipBox?: ClipBox,
): BoundingBox | null {
  const visible = layers.filter(l => l.visible);
  if (visible.length === 0 && !(widthL0 && heightL0)) return null;

  const l0cpx = cellPx(0);  // 64px

  // When a clip box is set, use it as the bounding box.
  if (clipBox) {
    const pxMinX = clipBox.clipL0X * l0cpx;
    const pxMinY = clipBox.clipL0Y * l0cpx;
    const pxMaxX = (clipBox.clipL0X + clipBox.clipL0W) * l0cpx;
    const pxMaxY = (clipBox.clipL0Y + clipBox.clipL0H) * l0cpx;
    const resolutionX = clipBox.clipL0W / 4;
    const resolutionY = clipBox.clipL0H / 4;
    return { pxMinX, pxMinY, pxMaxX, pxMaxY, resolutionX, resolutionY };
  }

  // When file dimensions are provided, use them as the fixed bounding box
  // so the baked figure always matches the canvas window (origin offset
  // included). Layer data outside the window is cropped away.
  if (widthL0 && heightL0) {
    const { pxMinX, pxMinY, pxMaxX, pxMaxY } = canvasMirrorBounds({
      widthL0, heightL0, originL0X, originL0Y,
    });
    const resolutionX = widthL0 / 4;
    const resolutionY = heightL0 / 4;
    return { pxMinX, pxMinY, pxMaxX, pxMaxY, resolutionX, resolutionY };
  }

  let globalMinX = Infinity;
  let globalMinY = Infinity;
  let globalMaxX = -Infinity;
  let globalMaxY = -Infinity;
  let hasContent = false;

  for (let li = 0; li < visible.length; li++) {
    const layer = visible[li];
    const count = CELL_COUNTS[layer.level];
    const cpx = cellPx(layer.level);
    const shiftPxX = layer.shiftX * cpx;
    const shiftPxY = layer.shiftY * cpx;
    let layerHasContent = false;

    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        const cell = layer.cells[y]?.[x];
        if (cell === null || cell === undefined) continue;

        layerHasContent = true;
        const px0 = x * cpx + shiftPxX;
        const py0 = y * cpx + shiftPxY;
        const px1 = px0 + cpx;
        const py1 = py0 + cpx;

        if (px0 < globalMinX) globalMinX = px0;
        if (py0 < globalMinY) globalMinY = py0;
        if (px1 > globalMaxX) globalMaxX = px1;
        if (py1 > globalMaxY) globalMaxY = py1;
      }
    }

    if (layerHasContent) {
      hasContent = true;
    }
  }

  if (!hasContent) return null;

  // Snap bounds outward to L0 cell boundaries
  const pxMinX = Math.floor(globalMinX / l0cpx) * l0cpx;
  const pxMinY = Math.floor(globalMinY / l0cpx) * l0cpx;
  const pxMaxX = Math.ceil(globalMaxX / l0cpx) * l0cpx;
  const pxMaxY = Math.ceil(globalMaxY / l0cpx) * l0cpx;

  const l0W = (pxMaxX - pxMinX) / l0cpx;
  const l0H = (pxMaxY - pxMinY) / l0cpx;
  const resolutionX = l0W / 4;
  const resolutionY = l0H / 4;

  return { pxMinX, pxMinY, pxMaxX, pxMaxY, resolutionX, resolutionY };
}

// ── Content check ───────────────────────────────────────────────────

export function fileHasContent(layers: Layer[]): boolean {
  const visible = layers.filter(l => l.visible);
  for (const layer of visible) {
    const count = CELL_COUNTS[layer.level];
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        if (layer.cells[y]?.[x] != null) return true;
      }
    }
  }
  return false;
}

// ── Index Mutex ─────────────────────────────────────────────────────
// Serialize all baked-index read-modify-write operations so concurrent
// bakes for different files don't clobber each other's entries.

let _indexMutex: Promise<void> = Promise.resolve();

async function withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = _indexMutex;
  let release: () => void;
  _indexMutex = new Promise<void>(r => { release = r; });
  await prev;
  try {
    return await fn();
  } finally {
    release!();
  }
}

// ── Persistence ─────────────────────────────────────────────────────

export async function loadAllBakedFigures(): Promise<BakedFigureInfo[]> {
  const raw = await storage.getItem(BAKED_INDEX_KEY);
  if (!raw) return [];
  return JSON.parse(raw);
}

async function saveBakedIndex(index: BakedFigureInfo[]): Promise<void> {
  await storage.setItem(BAKED_INDEX_KEY, JSON.stringify(index));
}

/**
 * Legacy: nothing writes baked_fig_png_* keys anymore; returns null for data
 * created by current versions.
 */
export async function loadBakedFigurePng(fileId: string): Promise<string | null> {
  return storage.getItem(`baked_fig_png_${fileId}`);
}

export async function loadFigurePaletteThumb(fileId: string): Promise<string | null> {
  return storage.getItem(`fig_thumb_${fileId}`);
}

export async function removeBakedFigure(fileId: string): Promise<void> {
  await withIndexLock(async () => {
    const index = await loadAllBakedFigures();
    const updated = index.filter(f => f.fileId !== fileId);
    await saveBakedIndex(updated);
  });
  await storage.removeItem(`baked_fig_png_${fileId}`);
  await storage.removeItem(`fig_thumb_${fileId}`);
  // Legacy cleanup: remove PNG level-variant keys written by old app versions
  // (nothing writes these anymore).
  const REMOVE_LEVELS: GridLevel[] = [0, 1, 2, 3];
  for (let i = 0; i < REMOVE_LEVELS.length; i++) {
    await storage.removeItem(`baked_fig_png_${fileId}_L${REMOVE_LEVELS[i]}`);
  }
}

// Duplicate the source file's baked-index entry and palette thumbnail under a
// new fileId. Lets the duplicate flow skip the (slow) re-rasterization since
// the content is byte-identical to the source. Returns false when the source
// has no baked entry — caller should fall back to a real bake.
export async function copyBakedArtifacts(srcFileId: string, dstFileId: string): Promise<boolean> {
  let copied = false;
  await withIndexLock(async () => {
    const index = await loadAllBakedFigures();
    const srcEntry = index.find(f => f.fileId === srcFileId);
    if (!srcEntry) return;
    const dstEntry: BakedFigureInfo = { ...srcEntry, fileId: dstFileId };
    const updatedIndex = index.filter(f => f.fileId !== dstFileId);
    updatedIndex.push(dstEntry);
    await saveBakedIndex(updatedIndex);
    copied = true;
  });
  if (!copied) return false;
  const srcThumb = await storage.getItem(`fig_thumb_${srcFileId}`);
  if (srcThumb) {
    await storage.setItem(`fig_thumb_${dstFileId}`, srcThumb);
    notifyBakedThumbListeners(dstFileId, srcThumb);
  }
  return true;
}

// ── Main bake function ──────────────────────────────────────────────

import { isPaintingActive, onPaintingEnd } from './loadTile';

const pendingBakeRetry = new Set<string>();

function scheduleBakeRetry(
  fileId: string, layers: Layer[],
  widthL0: number | undefined, heightL0: number | undefined,
  originL0X: number, originL0Y: number,
): void {
  if (pendingBakeRetry.has(fileId)) return;
  pendingBakeRetry.add(fileId);
  onPaintingEnd(() => {
    pendingBakeRetry.delete(fileId);
    bakeFile(fileId, layers, widthL0, heightL0, originL0X, originL0Y);
  });
}

export function bakeFile(
  fileId: string,
  layers: Layer[],
  widthL0?: number,
  heightL0?: number,
  originL0X: number = 0,
  originL0Y: number = 0,
): Promise<void> {
  const gen = (bakeGenMap.get(fileId) ?? 0) + 1;
  bakeGenMap.set(fileId, gen);

  const visibleLayers = layers.filter(l => l.visible);

  if (visibleLayers.length === 0 && !(widthL0 && heightL0)) {
    // No visible layers and no file dims — remove baked figure
    return removeBakedFigure(fileId).catch(() => {});
  }

  // Defer if a paint stroke is active — retry automatically when stroke ends
  if (isPaintingActive()) {
    scheduleBakeRetry(fileId, layers, widthL0, heightL0, originL0X, originL0Y);
    return Promise.resolve();
  }

  let abortedByPainting = false;

  return (async () => {
    // Load clip box from persistence so baking respects it.
    const clipBox = await loadClipBoxForBake(fileId);

    // Phase 1: Compute content hash (origin included so origin-only moves
    // still re-bake — the visible crop changes even if cell data doesn't).
    if (!isCurrent(fileId, gen)) return;
    const contentHash = hashFileContent(layers, widthL0, heightL0, originL0X, originL0Y, clipBox);
    await yieldTick();
    if (!isCurrent(fileId, gen)) return;
    if (isPaintingActive()) { abortedByPainting = true; return; }

    // Phase 2: Compute bounding box
    if (!isCurrent(fileId, gen)) return;
    const bounds = computeBoundingBox(layers, widthL0, heightL0, originL0X, originL0Y, clipBox);
    if (!bounds) {
      await removeBakedFigure(fileId);
      return;
    }
    await yieldTick();
    if (!isCurrent(fileId, gen)) return;
    if (isPaintingActive()) { abortedByPainting = true; return; }

    // Phase 3: Atomic index update — lock prevents concurrent bakes for
    // different files from clobbering each other's entries.
    if (!isCurrent(fileId, gen)) return;
    const indexChanged = await withIndexLock(async () => {
      const currentIndex = await loadAllBakedFigures();
      const existing = currentIndex.find(f => f.fileId === fileId);
      if (existing && existing.contentHash === contentHash) return false;

      const info: BakedFigureInfo = {
        fileId,
        resolutionX: bounds.resolutionX,
        resolutionY: bounds.resolutionY,
        contentHash,
        pxWidth: bounds.pxMaxX - bounds.pxMinX,
        pxHeight: bounds.pxMaxY - bounds.pxMinY,
      };
      const updatedIndex = currentIndex.filter(f => f.fileId !== fileId);
      updatedIndex.push(info);
      await saveBakedIndex(updatedIndex);
      return true;
    });
    if (!indexChanged) {
      // The index already has an entry with a matching hash. Still check
      // whether the palette thumbnail actually exists — a previous bake
      // may have updated the index but failed to rasterize the thumbnail
      // (e.g. transient Image-load timeout). If it's missing, fall
      // through to Phase 4 to regenerate it.
      const thumbExists = await storage.getItem(`fig_thumb_${fileId}`);
      if (thumbExists) return;
    }

    // Phase 4: Generate SVG-based palette thumbnail
    await yieldTick();
    if (!isCurrent(fileId, gen)) return;
    if (isPaintingActive()) { abortedByPainting = true; return; }
    const fw = widthL0 ?? 32;
    const fh = heightL0 ?? 32;
    const fileConfig: FileConfig = {
      id: fileId, name: fileId,
      widthL0: fw, heightL0: fh,
      originL0X, originL0Y,
      clipBox,
    };
    const svg = exportToSVG(layers, fileConfig);
    const thumbW = clipBox ? clipBox.clipL0W : fw;
    const thumbH = clipBox ? clipBox.clipL0H : fh;
    const toThumb = await getSvgToThumbnailDataUri();
    const thumbUri = await toThumb(
      svg, thumbW, thumbH, FIG_PALETTE_THUMB_SIZE,
      () => {
        if (!isCurrent(fileId, gen)) return true;
        if (isPaintingActive()) { abortedByPainting = true; return true; }
        return false;
      },
    );
    if (thumbUri && isCurrent(fileId, gen)) {
      await storage.setItem(`fig_thumb_${fileId}`, thumbUri);
      notifyBakedThumbListeners(fileId, thumbUri);
    }
  })().catch(e => logToNative('error', 'bake', `bakeFile failed for ${fileId}: ${String(e)}`))
    .finally(() => {
      if (abortedByPainting && isCurrent(fileId, gen)) {
        scheduleBakeRetry(fileId, layers, widthL0, heightL0, originL0X, originL0Y);
      }
    });
}
