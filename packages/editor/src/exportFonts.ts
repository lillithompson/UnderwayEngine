// Font bytes for SVG export. The editor renders text with page-registered
// @font-face rules (loadPackFonts), but every rasterizing export path draws
// its SVG through a detached <img>, which cannot reach them: without the
// face embedded as a data URI the raster silently falls back to the
// platform default, and the exported image's text no longer matches the page
// the user composed. So the exporter re-reads the same woff2 faces as bytes
// and inlines them.
//
// Registered once as the engine's default resolver (setDefaultSVGFontResolver),
// which covers every export path — entry images, page thumbnails and file
// export — instead of each one remembering to pass it.
//
// Memory: faces are fetched lazily per fontId (the resolver is allowed to be
// async) and cached for the session, so a page that uses two fonts holds two
// faces (~50 KB each), not all twelve.
//
// What is the APP's is the FETCH — reading its own FACE require table through
// its bundler (`Asset.fromModule`, expo-asset) — which it installs here from
// its own web/fonts/exportFonts.ts. The cache, the concurrent-export dedupe
// and the engine wiring are this module's, so the three apps share one
// answer to "has this face already been read?". Nothing here imports expo.

import { setDefaultSVGFontResolver, type SVGFontResolver } from '@/engine/compositionExport';

/** What an app answers for a fontId: that face's woff2 as base64, or null
 *  when there is nothing bundled to embed. */
export type FaceFetch = (fontId: string) => Promise<string | null>;

let fetchFace: FaceFetch | null = null;

/** Install the app's face reader (its web/fonts/exportFonts, over its own
 *  FACE table). Clears the cache, so a second install cannot serve the
 *  first's bytes. */
export function registerFaceFetch(fn: FaceFetch | null): void {
  fetchFace = fn;
  faces.clear();
}

/** fontId → base64 woff2, or null when the face isn't bundled / failed to
 *  load. Holds the in-flight promise so concurrent exports (an app writing
 *  a thumb and a view image back to back) fetch each face once. */
const faces = new Map<string, Promise<string | null>>();

async function readFace(fontId: string): Promise<string | null> {
  // No app installed: the SVG references the family by name and falls
  // through to the system stack, exactly as the editor does.
  if (!fetchFace) return null;
  try {
    return await fetchFace(fontId);
  } catch {
    return null; // export proceeds with the fallback stack rather than failing
  }
}

/**
 * Engine font-embedding hook: WOFF2 bytes for a `TextStyle.fontId`, or null
 * when there's nothing bundled to embed (the SVG then references the family
 * by name and falls through to the system stack, exactly as the editor does).
 */
export const exportFontResolver: SVGFontResolver = async (fontId: string) => {
  let pending = faces.get(fontId);
  if (!pending) {
    pending = readFace(fontId);
    faces.set(fontId, pending);
  }
  const woff2Base64 = await pending;
  return woff2Base64 ? { woff2Base64 } : null;
};

let registered = false;

/** Make every SVG export embed its fonts. Idempotent — call from any entry
 *  point that can reach an export (editor mount, entry rasterization). */
export function registerExportFonts(): void {
  if (registered) return;
  registered = true;
  setDefaultSVGFontResolver(exportFontResolver);
}

/** Test seam: forget cached faces and the registration flag. Leaves the
 *  installed fetcher alone — an app installs it at module scope, which a
 *  suite does not re-run between cases. */
export function resetExportFontsForTest(): void {
  faces.clear();
  registered = false;
  setDefaultSVGFontResolver(undefined);
}
