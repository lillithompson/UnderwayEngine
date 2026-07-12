/**
 * Visibility-scoped thumbnail prefetch for dynamic samples.
 *
 * The composition list collapses each section to its first 5 cards, so
 * eagerly decoding every manifest thumbnail wastes bytes (and on iPad,
 * bitmap-cache memory) for cards the user has to expand a section to see.
 * `prefetchThumbnailsForUrls` takes an explicit URL list — the caller
 * (the app's compositions-list screen) supplies the union of cards that will render in the
 * collapsed view, and `<img>`-mount-time fetch handles anything farther
 * down or behind an expansion.
 *
 * The actual decode-warming + HTTP-cache primer lives in
 * `engine/dynamicSamples/imagePrefetch.ts`; this module is just a thin
 * scope wrapper so call sites don't import the lower layer directly.
 */

import { resolveDynamicSampleUrl } from './config';
import { prefetchThumbnails } from './imagePrefetch';
import type { DynamicSampleManifestEntry } from './manifestSchema';

export function prefetchThumbnailsForEntries(
  entries: readonly DynamicSampleManifestEntry[],
): void {
  if (entries.length === 0) return;
  const urls = entries.map((e) => resolveDynamicSampleUrl(e.thumbPath));
  void prefetchThumbnails(urls);
}
