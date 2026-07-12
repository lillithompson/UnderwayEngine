import { CompositionFigure, FileConfig } from './types';
import { exportLayersToSVGInner, SVG_UNITS_PER_L0_CELL } from './svgExport';
import { loadFileStateLite, loadClipBox } from './persistence';
import { simplifySVG } from './simplifySVG';

// Pure SVG builders live in `./svgFigureBuilders` so the build-time
// composition-thumbnail script can use them without dragging in
// IndexedDB. Re-exported here so existing callers keep working.
export { buildFigureSVGContent, buildBlockSVGContent, wrapWithColorOverride } from './svgFigureBuilders';
export type { CachedFigureSVG } from './svgFigureBuilders';
import type { CachedFigureSVG } from './svgFigureBuilders';

const cache = new Map<string, CachedFigureSVG>();
const pendingLoads = new Map<string, Promise<CachedFigureSVG | null>>();

// File IDs whose cached SVG is stale and needs re-loading the next time the
// composition regains focus. The figure editor marks a file dirty on save so
// the composition only re-rasterizes figures that actually changed, instead
// of evicting and rebuilding the entire figure list on every focus return.
const dirtyFileIds = new Set<string>();

export function markFigureDirty(fileId: string): void {
  dirtyFileIds.add(fileId);
}

/** Return (and clear) the set of file ids marked dirty since the last drain. */
export function drainDirtyFigureIds(): Set<string> {
  if (dirtyFileIds.size === 0) return dirtyFileIds; // empty set — reused
  const out = new Set(dirtyFileIds);
  dirtyFileIds.clear();
  return out;
}

function cacheKey(fig: CompositionFigure): string {
  if (fig.fileId) {
    return `file_${fig.fileId}`;
  }
  return `key_${fig.figureKey}`;
}

/** Synchronous cache lookup — returns null if not yet loaded. */
export function getFigureSVGSync(fig: CompositionFigure): CachedFigureSVG | null {
  return cache.get(cacheKey(fig)) ?? null;
}

/** Async cache lookup — loads and caches if missing. */
export async function getFigureSVG(fig: CompositionFigure): Promise<CachedFigureSVG | null> {
  const key = cacheKey(fig);
  const cached = cache.get(key);
  if (cached) return cached;

  const pending = pendingLoads.get(key);
  if (pending) return pending;

  const promise = loadFigureSVG(fig, key);
  pendingLoads.set(key, promise);
  try {
    return await promise;
  } finally {
    pendingLoads.delete(key);
  }
}

async function loadFigureSVG(fig: CompositionFigure, key: string): Promise<CachedFigureSVG | null> {
  const U = SVG_UNITS_PER_L0_CELL;

  if (fig.fileId) {
    const [fileState, clipBox] = await Promise.all([
      loadFileStateLite(fig.fileId),
      loadClipBox(fig.fileId),
    ]);
    if (!fileState) return null;

    const fileConfig: FileConfig = {
      id: fig.fileId,
      name: '',
      widthL0: fileState.widthL0,
      heightL0: fileState.heightL0,
      originL0X: fileState.originL0X,
      originL0Y: fileState.originL0Y,
      clipBox: clipBox ?? undefined,
    };
    // exportLayersToSVGInner handles clip box internally — when clipBox
    // is set on fileConfig, it skips cells outside the clip region and
    // returns clip-relative coordinates and clip dimensions.
    const result = exportLayersToSVGInner(fileState.layers, fileConfig);
    const entry: CachedFigureSVG = {
      elements: simplifySVG(result.elements),
      svgWidth: result.widthL0 * U,
      svgHeight: result.heightL0 * U,
    };
    cache.set(key, entry);
    return entry;
  }

  return null;
}

/** Evict all cache entries for a given file. Also clears any in-flight
 *  load promise so a subsequent getFigureSVG starts a fresh read from
 *  storage rather than reusing a stale pending result. */
export function evictFigureSVGByFileId(fileId: string): void {
  const key = `file_${fileId}`;
  cache.delete(key);
  pendingLoads.delete(key);
}

/** Preload SVG data for all figures. */
export async function preloadFigureSVGs(figures: CompositionFigure[]): Promise<void> {
  await Promise.all(figures.map(fig => getFigureSVG(fig)));
}
