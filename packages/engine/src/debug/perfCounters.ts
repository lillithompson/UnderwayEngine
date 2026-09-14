/**
 * Per-tick cost counters for the image pipeline.
 *
 * docs/image_refactor.md §5 writes the refactor's budgets as quantities per
 * debounce tick — bytes read from the store, base64 built, full-resolution
 * decodes. None of them are visible to Instruments. An Allocations trace of
 * a three-photo Haiku page (2026-09-14) could say that 145 MB of multi-MB
 * strings were live on the Hermes side and nothing whatever about which code
 * built them: inside a JS heap an allocations trace sees anonymous malloc
 * blocks, and `responsible-library` bottoms out at the engine that ran the
 * code rather than the code itself.
 *
 * So the budgets are counted here, at the three chokepoints they are written
 * about, and asserted in tests rather than read off a device.
 *
 * Cost: one integer add per event, on paths that are already doing IndexedDB
 * I/O, a decode, or an O(n) encode — unmeasurable beside the work it counts.
 * Nothing is allocated on the counting path, and this module imports nothing,
 * so instrumenting a file cannot drag a dependency into it (which is why the
 * counters do not live in `ring.ts`, whose native-bridge import makes it
 * unusable from `storage.ts` and whose header still marks it temporary).
 */

/** The §5 budget table, one field per row that a test can observe. */
export interface PerfCounters {
  /** `storage.getBinary` calls that returned bytes. */
  storageReadCount: number;
  /** Bytes those reads pulled over the structured-clone boundary. */
  storageReadBytes: number;
  /** `storage.setBinary` calls that completed. */
  storageWriteCount: number;
  /** Bytes those writes sent. */
  storageWriteBytes: number;
  /** `toBase64` calls — the engine's single encoder. */
  base64Count: number;
  /** Input bytes encoded; the string built is 4/3 of this. */
  base64Bytes: number;
  /**
   * `createImageBitmap(blob)` with no resize options — the decode that
   * materializes every pixel of the source. §5 budgets these at 0 per tick.
   */
  decodeFullCount: number;
  /**
   * `createImageBitmap(blob, { resizeWidth, ... })` — decode and downsample
   * in one pass, which never holds the full-resolution raster.
   */
  decodeScaledCount: number;
}

function zero(): PerfCounters {
  return {
    storageReadCount: 0,
    storageReadBytes: 0,
    storageWriteCount: 0,
    storageWriteBytes: 0,
    base64Count: 0,
    base64Bytes: 0,
    decodeFullCount: 0,
    decodeScaledCount: 0,
  };
}

const counters = zero();

/** A read that returned bytes. Callers skip this when the key was absent. */
export function countStorageRead(bytes: number): void {
  counters.storageReadCount++;
  counters.storageReadBytes += bytes;
}

export function countStorageWrite(bytes: number): void {
  counters.storageWriteCount++;
  counters.storageWriteBytes += bytes;
}

export function countBase64(bytes: number): void {
  counters.base64Count++;
  counters.base64Bytes += bytes;
}

/**
 * One `createImageBitmap`. `scaled` is true only when resize options were
 * passed AND honored — a WebKit that ignores them has performed a full
 * decode, and the fallback path counts it as one.
 */
export function countDecode(scaled: boolean): void {
  if (scaled) counters.decodeScaledCount++;
  else counters.decodeFullCount++;
}

/** A copy, so a caller cannot hold a live view of the counters. */
export function readPerfCounters(): PerfCounters {
  return { ...counters };
}

export function resetPerfCounters(): void {
  Object.assign(counters, zero());
}

/**
 * Counters accrued by `fn` alone, as a before/after difference.
 *
 * Difference rather than reset-and-read so that nesting one of these inside
 * another, or running one while an unrelated page is loading, cannot zero a
 * measurement somebody else is in the middle of taking.
 */
export async function perfDelta<T>(
  fn: () => Promise<T> | T,
): Promise<{ result: T; counters: PerfCounters }> {
  const before = readPerfCounters();
  const result = await fn();
  const after = readPerfCounters();
  const delta = zero();
  for (const k of Object.keys(delta) as (keyof PerfCounters)[]) {
    delta[k] = after[k] - before[k];
  }
  return { result, counters: delta };
}
