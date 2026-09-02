/**
 * Module-level cache of `imageId → "data:{mime};base64,..."` strings.
 *
 * Exists for two reasons:
 *
 *  1. WebKit decodes one bitmap per unique `<image href>` value. Reusing
 *     the same string instance across renders lets the compositor reuse
 *     the decoded bitmap rather than re-decoding on every selection or
 *     drag tick — critical for 90 fps on iOS, where each fresh decode
 *     allocates an IOSurface backing.
 *
 *  2. Building a base64 data URI is O(byteLen) and allocates a new
 *     string each time. With 1024² images at ~150 KB compressed,
 *     that's a few hundred KB of work per render — fine for a
 *     thumbnail flow but unacceptable in the surgical-diff hot path.
 *
 * There is no invalidation: entries live for the module lifetime and the
 * cache never evicts. That's safe because `imageId` is stable per-blob —
 * bytes never change for a given id (new bytes always mean a new id).
 *
 * Keep this file tiny and dependency-free so it can be imported from
 * the SVG layer without dragging the engine bundle.
 */

const dataUriCache = new Map<string, string>();

/**
 * Encode a `Uint8Array` as a base64 string. We avoid the
 * `Buffer`-shim path (RN polyfills add ~30 KB to the bundle) and use
 * the chunked-`String.fromCharCode` trick — `apply` blows the call
 * stack past ~120 KB on JSC.
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000; // 32 KB
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(slice) as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * Get or build the data URI for an image, keyed by `imageId`. Returns
 * `null` when the blob isn't registered (loading race / corrupted
 * state) so the renderer can skip the wrapper rather than insert a
 * broken `<image>` element.
 */
export function getImageDataUri(
  imageId: string,
  mimeType: 'image/png' | 'image/jpeg' | 'image/svg+xml',
  blobs: Record<string, Uint8Array>,
): string | null {
  const cached = dataUriCache.get(imageId);
  if (cached) return cached;
  const bytes = blobs[imageId];
  if (!bytes) return null;
  const uri = `data:${mimeType};base64,${bytesToBase64(bytes)}`;
  dataUriCache.set(imageId, uri);
  return uri;
}
