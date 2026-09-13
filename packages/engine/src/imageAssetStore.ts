import storage from './storage';
import { createRasterLruCache } from './rasterLruCache';

/**
 * The pixel bytes of every reference image, addressed by asset id, with a
 * byte-budgeted cache in front of the store.
 *
 * The point of the module is what a loaded composition no longer holds. A
 * photo keeps TWO copies — a display copy capped at MAX_EDGE_PX (~340 KB for
 * a phone photo) and an export master capped at ORIGINAL_MAX_EDGE_PX
 * (~3.4 MB) — and `loadCompositionState` used to hydrate both, for every
 * image, into `CompositionState.imageBlobs`, which the editor then held for
 * the whole session. That is ~3.79 MB pinned per photo of which 91 % is a
 * master the canvas never draws: it renders the display copy. A ten-photo
 * collage pinned ~38 MB of JPEG in the WebView's JS heap, ~34 MB of it idle,
 * before a single pixel was decoded.
 *
 * So: the document hydrates DISPLAY copies, and masters load on demand, on
 * the export path alone, and are dropped as soon as the raster is encoded
 * ({@link purgeImageAssets}). `imageBlobs` keeps its `Record<id, bytes>`
 * shape — the binary format, the geometry helpers and the renderer all read
 * it unchanged; what moved is when the bytes arrive.
 *
 * The cache in front is the other half. The composition JSON was already
 * served from a write-through cache while every blob was re-read from
 * IndexedDB across the structured-clone boundary on each load — free for the
 * kilobytes, full price for the megabytes, precisely backwards.
 */

/** Storage key for an image asset's raw bytes. Keyed by asset id alone (not
 *  by composition) so duplicates and cross-composition uses share one blob. */
export function imageAssetKey(assetId: string): string {
  return `imgblob_${assetId}`;
}

/**
 * How many base64url characters of the SHA-256 the id keeps. 22 of them is
 * 132 bits — far past any birthday bound a journal could reach — while
 * keeping the id short enough to sit in the binary format's string table
 * and in a URL path without comment.
 */
const ASSET_ID_CHARS = 22;

/** base64url (RFC 4648 §5): base64's alphabet with `-` and `_`, unpadded, so
 *  the id is safe in a storage key, a filename and a URL path alike. */
function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The id these bytes ARE: `imgblob_` plus the head of their SHA-256.
 *
 * Content addressing, which is how every photo app identifies an asset, and
 * the point is the questions it stops having to ask. The same photo picked
 * twice, a duplicated node, a duplicated page, and a page imported from a
 * friend who happens to have the same photo all converge on one blob and one
 * upload. "Do I already have this?" and "has this changed?" are one string
 * compare. And nothing is ever invalidated, because nothing is ever mutated:
 * new bytes are a new id by construction, which is the property the save
 * path's presence cache and the sync manifest were already relying on by
 * convention.
 *
 * The `imgblob_` prefix is kept from the random ids this replaced so the two
 * read alike; old ids keep working untouched — this changes what new imports
 * MINT, not what stored pages reference.
 *
 * Falls back to a random id where SubtleCrypto is missing (an insecure
 * context, an old runtime). That loses the dedup for those bytes and nothing
 * else: an id is only ever compared, never re-derived from bytes in hand.
 */
export async function contentImageId(bytes: Uint8Array): Promise<string> {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!subtle) return randomImageId();
  try {
    // Copy into a fresh buffer: a Uint8Array that is a VIEW into a larger
    // ArrayBuffer would otherwise be digested whole on some runtimes.
    const copy = new Uint8Array(bytes);
    const digest = await subtle.digest('SHA-256', copy.buffer as ArrayBuffer);
    return `imgblob_${base64url(new Uint8Array(digest)).slice(0, ASSET_ID_CHARS)}`;
  } catch {
    return randomImageId();
  }
}

/** The pre-content-addressing id: time plus randomness. Kept as the fallback
 *  above, and nowhere else. */
function randomImageId(): string {
  return 'imgblob_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

/**
 * Which copy an asset is, for the caller that asked for it. The two have
 * different lifetimes and so get separate budgets: a display copy is wanted
 * for as long as its page is open, a master only for the length of one
 * export.
 */
export type ImageAssetKind = 'display' | 'original';

/** Roughly a Haiku page's worth of display copies, or a 20-cell collage at
 *  the cell-sized level — enough that reopening a page is free, small enough
 *  that a journal's worth of pages cannot accumulate in the heap. */
const DISPLAY_BUDGET_BYTES = 8 * 1024 * 1024;
/** Four or five masters: an export holds every photo on one page at once,
 *  and the page is the unit that has to fit. */
const ORIGINAL_BUDGET_BYTES = 16 * 1024 * 1024;

// Byte-budgeted, recency-ordered (rasterLruCache). `ownerId` is the asset id
// itself: these entries belong to no scene node — the same photo is drawn by
// every node that references it.
const caches: Record<ImageAssetKind, ReturnType<typeof createRasterLruCache<Uint8Array>>> = {
  display: createRasterLruCache<Uint8Array>(DISPLAY_BUDGET_BYTES),
  original: createRasterLruCache<Uint8Array>(ORIGINAL_BUDGET_BYTES),
};

/** In-flight reads, so N nodes referencing one asset cause one read. */
const inFlight = new Map<string, Promise<Uint8Array | null>>();

/** The bytes if they are already in memory, else null — "do I have this?"
 *  without committing to a read. */
export function peekImageAsset(assetId: string, kind: ImageAssetKind = 'display'): Uint8Array | null {
  return caches[kind].get(assetId) ?? null;
}

/** The asset's bytes, from the cache or the store. Null when nothing is
 *  stored under the id — corrupt storage, a partial copy, or the photo
 *  placeholder, which deliberately has no blob. */
export function loadImageAsset(assetId: string, kind: ImageAssetKind = 'display'): Promise<Uint8Array | null> {
  const cached = caches[kind].get(assetId);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(assetId);
  if (pending) return pending;
  const read = storage.getBinary(imageAssetKey(assetId))
    .then((bytes) => {
      if (bytes) caches[kind].set(assetId, assetId, bytes.byteLength, bytes);
      return bytes;
    })
    .catch(() => null)
    .finally(() => { inFlight.delete(assetId); });
  inFlight.set(assetId, read);
  return read;
}

/**
 * Load several assets at once into the `Record<id, bytes>` shape
 * `CompositionState.imageBlobs` takes. Ids are de-duplicated and read
 * concurrently; ones with nothing stored are simply absent from the result,
 * which is the tolerance the renderer already has (it skips a wrapper whose
 * blob is missing rather than throwing during open).
 */
export async function loadImageAssets(
  assetIds: Iterable<string | undefined | null>,
  kind: ImageAssetKind = 'display',
): Promise<Record<string, Uint8Array>> {
  const unique = new Set<string>();
  for (const id of assetIds) if (id != null) unique.add(id);
  const out: Record<string, Uint8Array> = {};
  await Promise.all(Array.from(unique, async (id) => {
    const bytes = await loadImageAsset(id, kind);
    if (bytes) out[id] = bytes;
  }));
  return out;
}

/** Put bytes a caller already holds into the cache, so the read they would
 *  otherwise cause is skipped — the import and the save paths know the bytes
 *  before the store does. */
export function rememberImageAsset(assetId: string, bytes: Uint8Array, kind: ImageAssetKind = 'display'): void {
  caches[kind].set(assetId, assetId, bytes.byteLength, bytes);
}

/**
 * Drop cached bytes. With no argument both budgets are emptied — for
 * `pagehide` and a memory warning, where holding megabytes of JPEG to save a
 * re-read is the wrong trade. With `'original'` it is the routine one: an
 * export has finished with its masters and there is no reason to keep
 * megabytes per photo alive until the budget happens to push them out.
 */
export function purgeImageAssets(kind?: ImageAssetKind): void {
  if (kind) caches[kind].clear();
  else { caches.display.clear(); caches.original.clear(); }
}

/** Bytes currently held, for tests and instrumentation. */
export function imageAssetBytes(kind?: ImageAssetKind): number {
  return kind ? caches[kind].totalBytes() : caches.display.totalBytes() + caches.original.totalBytes();
}
