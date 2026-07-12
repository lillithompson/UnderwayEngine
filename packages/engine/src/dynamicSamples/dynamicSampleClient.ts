/**
 * Network layer for dynamic samples. Two operations:
 *  - refreshManifest: fetch the manifest with `If-None-Match`, validate, persist.
 *  - downloadSampleBlob: fetch a single `.tile` payload, enforce size cap,
 *    verify sha256, return raw bytes for `importCompositionBundle`.
 *
 * Errors are swallowed and logged via `logToNative`. The list UI never
 * surfaces a network error for a background manifest refresh — it just
 * shows whatever cached state we already have.
 */

import {
  parseManifest,
  type DynamicSampleManifest,
  type DynamicSampleManifestEntry,
  MAX_SAMPLE_BYTES,
} from './manifestSchema';
import {
  resolveDynamicSampleUrl,
  DYNAMIC_SAMPLES_MANIFEST_PATH,
} from './config';
import {
  ensureHydrated,
  getCachedEtag,
  getCachedManifest,
  setManifest,
} from './dynamicSampleStore';
import { logToNative } from '@/native-shell/bridge/webBridge';

export interface RefreshOptions {
  signal?: AbortSignal;
}

/**
 * Fetch the manifest. On 304 keeps the cached version; on 200 validates
 * and persists. Returns the resulting manifest (cached or refreshed) or
 * null if both the network and cache are empty.
 *
 * Fire-and-forget at the call site; the UI listens to the store.
 */
export async function refreshManifest(
  options: RefreshOptions = {},
): Promise<DynamicSampleManifest | null> {
  await ensureHydrated();
  const url = resolveDynamicSampleUrl(DYNAMIC_SAMPLES_MANIFEST_PATH);
  const headers: Record<string, string> = {};
  const etag = getCachedEtag();
  if (etag) headers['If-None-Match'] = etag;

  try {
    const resp = await fetch(url, { signal: options.signal, headers });
    if (resp.status === 304) {
      return getCachedManifest();
    }
    if (!resp.ok) {
      logToNative('warn', 'dynamicSamples.refreshManifest',
        `unexpected status ${resp.status} for ${url}`);
      return getCachedManifest();
    }
    const text = await resp.text();
    const parsed = parseManifest(text);
    if (!parsed) {
      logToNative('warn', 'dynamicSamples.refreshManifest',
        `manifest at ${url} failed validation; keeping cache`);
      return getCachedManifest();
    }
    await setManifest(parsed, resp.headers.get('ETag'));
    return parsed;
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') return getCachedManifest();
    const msg = e instanceof Error ? e.message : String(e);
    logToNative('warn', 'dynamicSamples.refreshManifest', `fetch failed: ${msg}`);
    return getCachedManifest();
  }
}

function bytesToHex(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let out = '';
  for (let i = 0; i < view.length; i++) {
    const b = view[i];
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // crypto.subtle is available in both browsers and WKWebView contexts.
  // Casting through ArrayBufferView avoids a SAB-vs-ArrayBuffer TS mismatch
  // on some lib.dom versions without changing runtime behavior.
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return bytesToHex(digest);
}

export interface DownloadOptions {
  signal?: AbortSignal;
}

/**
 * Download the `.tile` payload for a manifest entry. Throws on:
 *  - network error
 *  - non-2xx response
 *  - downloaded size mismatching `compSize`
 *  - downloaded sha256 mismatching `compSha256`
 *
 * Callers wrap this in a try/catch to show an inline error and leave the
 * placeholder card tappable for retry.
 */
export async function downloadSampleBlob(
  entry: DynamicSampleManifestEntry,
  options: DownloadOptions = {},
): Promise<Uint8Array> {
  if (entry.compSize > MAX_SAMPLE_BYTES) {
    throw new Error(`compSize ${entry.compSize} exceeds MAX_SAMPLE_BYTES`);
  }
  const url = resolveDynamicSampleUrl(entry.compPath);
  const resp = await fetch(url, { signal: options.signal });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} for ${url}`);
  }
  const buf = await resp.arrayBuffer();
  if (buf.byteLength !== entry.compSize) {
    throw new Error(
      `size mismatch: expected ${entry.compSize}, got ${buf.byteLength}`,
    );
  }
  const data = new Uint8Array(buf);
  const actualSha = await sha256Hex(data);
  if (actualSha !== entry.compSha256) {
    throw new Error(
      `sha256 mismatch: expected ${entry.compSha256}, got ${actualSha}`,
    );
  }
  return data;
}

/** Optional activity-sidecar fetch. Returns the parsed JSON object or null. */
export async function fetchActivitySidecar(
  entry: DynamicSampleManifestEntry,
  options: DownloadOptions = {},
): Promise<Record<string, unknown> | null> {
  if (!entry.activityPath) return null;
  try {
    const resp = await fetch(resolveDynamicSampleUrl(entry.activityPath), {
      signal: options.signal,
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (json && typeof json === 'object') return json as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}
