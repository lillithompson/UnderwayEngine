/**
 * The CSS font-family stack a text node is drawn with — the one piece of
 * the node layer that depends on which fonts an APP bundles.
 *
 * The rule is generic (a pack font resolves to its registered cssFamily,
 * 'system' and the empty id to the warm system stack, an unknown id is
 * quoted verbatim so it works wherever its @font-face exists), but the
 * PACK is each app's own data — `web/fonts/registerFonts.ts`, built from
 * that app's fonts pack. Since 6.1 the app hands that resolver over on its
 * `FontPack` (`loadPackFonts.ts`, this package's) and the load installs it
 * here, beside the brush's glyph-ink probe ({@link registerGlyphInk} in
 * paintBrush.ts) and the engine's text measurer.
 *
 * Nothing is installed in a unit test unless the test installs it, and the
 * fallback is the system stack: a text node measures and draws with the
 * system face rather than throwing, which is also what an app that has not
 * loaded its pack yet shows.
 */

import { SYSTEM_FAMILY_STACK } from '@/engine/fontWeight';

/**
 * Warm system stack — the fallback tail of every family.
 *
 * The engine's, not a second spelling of it: the SVG export appends the same
 * stack (XML-quoted) after a node's own font, and a text node has to look
 * the same in the DOM preview and in what the page exports.
 */
export const SYSTEM_STACK = SYSTEM_FAMILY_STACK;

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
