// Loads an app's bundled pack fonts so text nodes and the Text bar's font
// picker render real families. The @fontsource CSS-side-effect approach
// emitted @font-face rules whose relative `url(*.woff2)` never got copied
// into the bundle (Expo's default Metro treats woff2 as neither source nor
// asset), so the faces 404'd and every font fell back to the system stack.
// Each app's faces are static require()s instead (its web/fonts/faces.ts),
// which rides Metro's asset pipeline — the same proven path an app's UI
// fonts use — so it works on web and in the native WebView.
//
// The @font-face rules are written and injected HERE, not by expo-font's web
// loader. That loader waits on a `fontfaceobserver` with a 12 000 ms timeout
// unless the user agent says iPhone, iPad or Safari — and an iPad's WKWebView
// says "Macintosh" by default (desktop content mode), so on an iPad every
// family's observer ran, never fired (WebKit breaks it, which is exactly why
// the loader skips it for phones), and every editor open waited the full
// twelve seconds before the canvas could appear. Measured on the iPad
// 10th gen: 12.8 s to GL, 12.2 s of it inside that await. The rule itself is
// three properties; the loader was only ever a way to write it.
//
// What is the APP's, and rides in as the {@link FontPack}: which fonts it
// offers, where this build serves each face's woff2, and the resolver from a
// `TextStyle.fontId` to a CSS family. A face's URI is the one piece that
// needs the app's bundler (`Asset.fromModule`, expo-asset) — which is why it
// is asked for as a string rather than resolved here, and why nothing in
// this package imports expo.

import { registerTextMeasurer } from '@/engine/textLayout';
import { domTextMeasurer } from './domTextMeasurer';
import { domGlyphInk } from './glyphInk';
import { registerGlyphInk } from './paintBrush';
import { registerFontFamily, type FontFamilyFn } from './fontFamily';
import { bumpFontsEpoch } from './fontsEpoch';
import { settleFaces } from './settleFaces';

/** One pack face as the page registers it: the CSS family name text nodes
 *  are styled with (the app's registerFonts `cssFamily`) and where its woff2
 *  is served. */
export interface PackFace {
  cssFamily: string;
  uri: string;
}

/** One font an app's pack offers. */
export interface PackFont {
  fontId: string;
  cssFamily: string;
}

/**
 * An app's bundled font pack, as it reaches this module.
 *
 * `faceUri` is where this build serves that fontId's woff2, or null for a
 * face it cannot place (a CMS-added family with no bundled file), which then
 * has no rule and stays on the system fallback.
 */
export interface FontPack {
  fonts: readonly PackFont[];
  faceUri(fontId: string): string | null;
  fontFamilyFor: FontFamilyFn;
}

/** The id of the one <style> element the rules live in. Looked up before
 *  injecting, so a second module instance (a reload that kept the DOM) adds
 *  no second copy. One id, not one per app: there is one app per page, and
 *  nothing outside this module names it. */
export const PACK_FONTS_STYLE_ID = 'underway-pack-fonts';

/**
 * The @font-face rules for the pack faces, one per family. `font-display:
 * auto` (the browser's default) rather than `swap`: the editor never draws
 * text until settleFaces says the face is in, so the swap period would
 * only ever show a fallback that is about to be re-laid-out anyway.
 * Pure — a list in, CSS out — so the exact text is pinned by test.
 */
export function packFontFaceCss(faces: readonly PackFace[]): string {
  return faces
    .map((f) => `@font-face{font-family:${JSON.stringify(f.cssFamily)};src:url(${JSON.stringify(f.uri)});font-display:auto}`)
    .join('\n');
}

/** The pack's faces that this build can place, with their URLs resolved. */
export function bundledFaces(pack: FontPack): PackFace[] {
  const out: PackFace[] = [];
  for (const f of pack.fonts) {
    const uri = pack.faceUri(f.fontId);
    if (uri !== null && uri !== '') out.push({ cssFamily: f.cssFamily, uri });
  }
  return out;
}

/** Put the rules on the page, once. Best-effort: off-DOM (tests, SSR) or a
 *  head that cannot take a style element, there is nothing to register
 *  and the faces stay on the fallback. */
function injectFontFaces(css: string): void {
  if (typeof document === 'undefined') return;
  const head = document.head;
  if (!head || typeof head.appendChild !== 'function') return;
  if (document.getElementById(PACK_FONTS_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PACK_FONTS_STYLE_ID;
  style.appendChild(document.createTextNode(css));
  head.appendChild(style);
}

let promise: Promise<void> | null = null;

/** Register an app's pack fonts (idempotent — safe to call on every editor
 *  mount). Each face is keyed by its `cssFamily`, the name the pack's
 *  `fontFamilyFor` resolves a TextStyle.fontId to. Best-effort: a face that
 *  cannot be registered or loaded leaves its text on the system fallback
 *  rather than breaking the editor. */
export function loadPackFonts(pack: FontPack): Promise<void> {
  if (promise) return promise;
  // Real font metrics ride along with the faces: from here on, text layout
  // (bbox measurement, node render, SVG export) measures with the actual
  // families instead of the engine's font-blind approximation. Registered
  // before the faces finish loading — the measurer itself falls back per
  // call until each face is ready.
  registerTextMeasurer(domTextMeasurer);
  // …and where each glyph's ink sits in its box, so a brush hits a
  // character where it is drawn rather than anywhere on its line.
  registerGlyphInk(domGlyphInk);
  // …and which family each fontId resolves to, which is this app's PACK
  // answering a question the shared node layer asks. Installed before
  // anything the measurer above is asked to measure (nothing lays text out
  // between these lines), and before the faces load: the family name is what
  // the rules below declare, so it is right from the first render.
  registerFontFamily(pack.fontFamilyFor);
  // The rules go in synchronously: a face is loadable the moment this
  // returns, and nothing is awaited before the loads below are asked for.
  let families: string[] = [];
  try {
    const faces = bundledFaces(pack);
    families = faces.map((f) => f.cssFamily);
    if (faces.length > 0) injectFontFaces(packFontFaceCss(faces));
  } catch { /* text stays on the system fallback */ }
  // A @font-face rule is inert until something uses the family, and
  // `document.fonts.ready` resolves at once while nothing does — so
  // neither is the signal that the faces are IN. settleFaces asks the CSS
  // Font Loading API to load each one for real, and that is the moment to
  // bump the fonts epoch: already-rendered text then re-lays-out with real
  // metrics (domTextMeasurer only kicks in once document.fonts.check
  // passes) — otherwise center/right-aligned text keeps the position
  // measured against the fallback font.
  promise = settleFaces(families, globalFontFaceSet())
    .then(() => { bumpFontsEpoch(); });
  watchLazyFaceLoads();
  return promise;
}

/** `document.fonts`, or null off-DOM / on an engine without the API. */
function globalFontFaceSet(): FontFaceSet | null {
  return typeof document !== 'undefined' && document.fonts ? document.fonts : null;
}

/** Catch-all for faces this module didn't settle: a CMS pack can add a font
 *  outside the pack's own list (see an app's registerFonts), which the
 *  browser then loads lazily the first time text renders in it.
 *  'loadingdone' fires per batch, so the extra re-layouts are few. */
function watchLazyFaceLoads(): void {
  const fonts = globalFontFaceSet();
  if (typeof fonts?.addEventListener !== 'function') return;
  fonts.addEventListener('loadingdone', () => { bumpFontsEpoch(); });
}

/** Test seam: forget the memoized load so the next call runs again. */
export function resetPackFontsForTest(): void {
  promise = null;
}
