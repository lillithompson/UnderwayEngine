import { createRasterLruCache } from './rasterLruCache';
import { MAX_EDGE_PX } from './compositionImageImport';

/**
 * The pyramid level the canvas actually draws: a photo re-encoded to about
 * the size it is drawn at, cached under `<assetId>@<edge>` and budgeted in
 * DECODED bytes.
 *
 * There have only ever been two levels — the display copy at
 * {@link MAX_EDGE_PX} and the export master at ORIGINAL_MAX_EDGE_PX — and
 * the display cap is sized for a photo that FILLS a page. A photo in a 4x3
 * collage cell is drawn at roughly a quarter of the page's width, where a
 * 1024 px source is indistinguishable from a 256 px one and costs sixteen
 * times the decode: 1024² × 4 is 4 MB of bitmap against 256 KB. Twenty of
 * those on one page is the difference between 80 MB and 5 MB of decoded
 * pixels, which on iOS is the difference between a page that runs at 90 fps
 * and a WebContent process that gets killed.
 *
 * Every level here is DERIVED data — the display copy is the source of
 * truth and is never touched — so a level can be dropped at any moment and
 * simply regenerated, and nothing needs invalidating: an asset id is a hash
 * of its bytes, so a level of a given id at a given edge can only ever be
 * the same pixels.
 */

/**
 * Levels are powers of two, so panning and pinching settle onto a handful of
 * sizes rather than minting a fresh bitmap for every zoom. Below the floor
 * the saving stops being worth a re-encode.
 */
const MIN_LEVEL_EDGE_PX = 128;

/** Decoded bytes held across every level: width × height × 4, which is what
 *  the compositor actually allocates. Roughly a 20-cell collage's worth of
 *  cell-sized levels, and about two full-page photos' worth. */
const DECODE_BUDGET_BYTES = 24 * 1024 * 1024;

/**
 * The level to draw a node from, given how large it is drawn and how large
 * its source actually is.
 *
 * Rounds the drawn edge UP to a power of two so a level is shared across a
 * range of zooms, and returns `sourceEdge` itself — "no level, use the
 * display copy" — whenever a derived one would be no smaller. That covers
 * the page-filling photo the display cap was sized for, and every image
 * small enough that re-encoding it would be pure cost.
 */
export function decodeLevelEdge(drawnPx: number, sourceEdge: number = MAX_EDGE_PX): number {
  if (!(drawnPx > 0) || !(sourceEdge > 0)) return sourceEdge;
  const wanted = Math.max(MIN_LEVEL_EDGE_PX, 2 ** Math.ceil(Math.log2(drawnPx)));
  return wanted >= sourceEdge ? sourceEdge : wanted;
}

/** Cache key: the asset and the level. An id is a hash of its bytes, so the
 *  pair names exactly one set of pixels for all time. */
export function decodeLevelKey(assetId: string, edge: number): string {
  return `${assetId}@${edge}`;
}

/** One cached level: the bytes, and an object URL over them for the DOM. */
interface DecodeLevel {
  bytes: Uint8Array;
  url: string | null;
  mimeType: string;
}

/** Every level's object URL is revoked the moment the level leaves the
 *  cache, however it leaves — eviction under the budget included, which is
 *  otherwise a silent leak of one URL per photo per zoom level visited. */
const levels = createRasterLruCache<DecodeLevel>(DECODE_BUDGET_BYTES, (_key, level) => {
  if (!level.url) return;
  try {
    (globalThis as { URL?: { revokeObjectURL(u: string): void } }).URL?.revokeObjectURL(level.url);
  } catch { /* non-browser environment */ }
});
/** Keys whose generation is in flight, so N nodes drawing one photo at one
 *  size cause one re-encode. */
const inFlight = new Map<string, Promise<DecodeLevel | null>>();

/** The level if it is already made, else null — the synchronous question
 *  the render path asks, so it can draw the display copy this frame and
 *  swap when the level lands. */
export function peekDecodeLevel(assetId: string, edge: number): DecodeLevel | null {
  return levels.get(decodeLevelKey(assetId, edge)) ?? null;
}

/**
 * Make (or fetch) the level, from the display copy's bytes.
 *
 * Null when the environment cannot re-encode (no `createImageBitmap` /
 * `OffscreenCanvas`) or the source will not decode — the caller then draws
 * the display copy, which is what it was doing anyway.
 *
 * SVG sources are never levelled: the markup IS full resolution at every
 * size, and rasterizing it to a bitmap would be a downgrade.
 */
export function ensureDecodeLevel(
  assetId: string,
  edge: number,
  sourceBytes: Uint8Array,
  mimeType: string,
): Promise<DecodeLevel | null> {
  const key = decodeLevelKey(assetId, edge);
  const made = levels.get(key);
  if (made) return Promise.resolve(made);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const job = generateLevel(sourceBytes, edge, mimeType)
    .then((level) => {
      if (level) levels.set(key, assetId, decodedBytes(edge), level);
      return level;
    })
    .catch(() => null)
    .finally(() => { inFlight.delete(key); });
  inFlight.set(key, job);
  return job;
}

/** What a square-bounded level costs the compositor once decoded. The cache
 *  budgets on this, not on the encoded size, because the encoded size is
 *  what a JPEG happens to compress to and the bitmap is what is actually
 *  held. */
function decodedBytes(edge: number): number {
  return edge * edge * 4;
}

async function generateLevel(
  sourceBytes: Uint8Array,
  edge: number,
  mimeType: string,
): Promise<DecodeLevel | null> {
  if (mimeType === 'image/svg+xml') return null;
  const g = globalThis as {
    createImageBitmap?: typeof createImageBitmap;
    OffscreenCanvas?: typeof OffscreenCanvas;
    URL?: { createObjectURL(b: Blob): string };
  };
  if (!g.createImageBitmap || !g.OffscreenCanvas) return null;
  const blob = new Blob([sourceBytes as unknown as BlobPart], { type: mimeType });
  const probe = await g.createImageBitmap(blob);
  const longest = Math.max(probe.width, probe.height);
  if (longest <= edge) { probe.close?.(); return null; } // already at or under the level
  const scale = edge / longest;
  const w = Math.max(1, Math.round(probe.width * scale));
  const h = Math.max(1, Math.round(probe.height * scale));
  const canvas = new g.OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d') as (OffscreenCanvasRenderingContext2D | null);
  if (!ctx) { probe.close?.(); return null; }
  ctx.drawImage(probe, 0, 0, w, h);
  probe.close?.();
  // PNG keeps a source's alpha; a JPEG source has none and stays far
  // smaller as one. The mime is recorded so the object URL declares it.
  const outMime = mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const out = await canvas.convertToBlob(
    outMime === 'image/jpeg' ? { type: outMime, quality: 0.9 } : { type: outMime },
  );
  const bytes = new Uint8Array(await out.arrayBuffer());
  let url: string | null = null;
  try {
    url = g.URL?.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: outMime })) ?? null;
  } catch {
    url = null;
  }
  return { bytes, url, mimeType: outMime };
}

/**
 * Drop every level, revoking the object URLs with them — for a memory
 * warning, a teardown, or a page closing.
 *
 * Safe at any moment: levels are derived, and the display copy they come
 * from is untouched.
 */
export function purgeDecodeLevels(): void {
  levels.clear();
}

/** Drop every level of ONE asset — for a photo replaced or deleted, where
 *  the levels are now pixels nothing draws. */
export function dropDecodeLevels(assetId: string): number {
  return levels.invalidateOwner(assetId);
}

/** Decoded bytes currently held, for tests and instrumentation. */
export function decodeLevelBytes(): number {
  return levels.totalBytes();
}
