/**
 * In-memory cache of downloaded .tile bytes keyed by manifest entry id.
 *
 * Lets repeat taps of the same dynamic-sample card in one session reuse
 * the already-downloaded payload instead of re-fetching. Cleared on cold
 * start via process restart — no persistence.
 *
 * Samples are size-capped at MAX_SAMPLE_BYTES (10 MB) so memory growth is
 * bounded by the count of distinct samples opened this session.
 */

const cache = new Map<string, Uint8Array>();

export function getCachedSampleBlob(manifestId: string): Uint8Array | undefined {
  return cache.get(manifestId);
}

export function cacheSampleBlob(manifestId: string, bytes: Uint8Array): void {
  cache.set(manifestId, bytes);
}

export function __resetForTests(): void {
  cache.clear();
}
