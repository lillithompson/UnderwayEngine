/**
 * The CSS font-family stack a text node is drawn with — the one piece of
 * the node layer that depends on which fonts an APP bundles.
 *
 * The rule is generic (a pack font resolves to its registered cssFamily,
 * 'system' and the empty id to the warm system stack, an unknown id is
 * quoted verbatim so it works wherever its @font-face exists), but the
 * PACK is each app's own data — `web/fonts/registerFonts.ts`, built from
 * that app's fonts pack. So the app installs its resolver here, the way it
 * installs the brush's glyph-ink probe ({@link registerGlyphInk} in
 * paintBrush.ts), from the same `web/fonts/loadPackFonts.ts`.
 *
 * Nothing is installed in a unit test unless the test installs it, and the
 * fallback is the system stack: a text node measures and draws with the
 * system face rather than throwing, which is also what an app that has not
 * loaded its pack yet shows.
 */

/** Warm system stack — the cozy fallback tail of every family. */
export const SYSTEM_STACK = "system-ui, -apple-system, 'Segoe UI', sans-serif";

/** What an app's font pack answers for a `TextStyle.fontId`. */
export type FontFamilyFn = (fontId: string) => string;

let fontFamily: FontFamilyFn | null = null;

/** Install the app's resolver (its web/fonts/registerFonts `fontFamilyFor`). */
export function registerFontFamily(fn: FontFamilyFn | null): void {
  fontFamily = fn;
}

/**
 * CSS font-family stack for a `TextStyle.fontId`, through the app's pack
 * when one is installed and the system stack when none is.
 */
export function fontFamilyFor(fontId: string): string {
  return fontFamily?.(fontId) ?? SYSTEM_STACK;
}
