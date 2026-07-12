/**
 * Resolves the base URL the runtime uses to fetch dynamic-samples assets.
 *
 * - On web, the bundle is served by the same origin that hosts the manifest,
 *   so an empty base URL works (paths are origin-relative).
 * - In the native WebView, the bundle is served by a local GCDWebServer
 *   instance — to fetch from Amplify we need an absolute base URL. The user
 *   sets this via `expo.extra.dynamicSamplesBaseUrl` in app.json.
 *
 * If the manifest base URL is empty in the native shell, the manifest fetch
 * will hit the local server (which doesn't serve `/dynamic-samples/`) and
 * silently fail. That's the same behavior as a network outage — the list
 * just won't have remote placeholders. We log it once on first failure.
 */

import Constants from 'expo-constants';

const DYNAMIC_SAMPLES_PATH_PREFIX = '/dynamic-samples';

function trimTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

function readConfiguredBaseUrl(): string {
  const extra = (Constants?.expoConfig as { extra?: Record<string, unknown> } | undefined)?.extra;
  const v = extra?.dynamicSamplesBaseUrl;
  if (typeof v === 'string' && v.length > 0) return trimTrailingSlash(v);
  return '';
}

let _cached: string | null = null;

export function getDynamicSamplesBaseUrl(): string {
  if (_cached !== null) return _cached;
  _cached = readConfiguredBaseUrl();
  return _cached;
}

/**
 * Resolves an origin-relative path from the manifest into an absolute URL
 * the current runtime can fetch. Same-origin paths stay as-is on web.
 */
export function resolveDynamicSampleUrl(originRelativePath: string): string {
  const base = getDynamicSamplesBaseUrl();
  if (base.length === 0) return originRelativePath;
  return base + originRelativePath;
}

export const DYNAMIC_SAMPLES_MANIFEST_PATH = `${DYNAMIC_SAMPLES_PATH_PREFIX}/manifest.json`;
