// Forces the bundled pack faces to actually LOAD, and reports when they have.
//
// A @font-face rule (loadPackFonts injects them) is inert until something
// uses the family: the browser only fetches each woff2 lazily, when the first
// text node renders in it. `document.fonts.ready` resolves in that same
// window for the same reason — nothing has used a pack face yet, so no load
// is pending — with every face still unloaded. (expo-font's web loader, which
// used to write the rules, was no better a signal: on iPhone/Safari it skips
// its observer and resolves at injection; on an iPad, whose WKWebView says
// "Macintosh", it ran the observer WebKit breaks and waited 12 s for it to
// time out — which is why the rules are written here now.)
//
// That gap is invisible for left-aligned text (x = 0 either way) but wrong for
// center/right alignment: domTextMeasurer gates on `document.fonts.check`,
// so layout in the gap measures with the engine's font-blind fallback and bakes
// a line `x` computed from an over-wide width. The glyphs then repaint in the
// real face without the position ever being recomputed — which is why the
// daily-haiku / magnetic-poetry date stamp opened mid-frame instead of hugging
// the frame's right edge, and only snapped once an unrelated edit (locking it
// from the scene outline) forced a re-layout.
//
// So we drive the load ourselves through the CSS Font Loading API, which
// resolves only once a matching face is fetched and decoded — after which
// `check` passes and a fonts-epoch bump re-lays-out the text for real.
//
// Dependency-free (the FontFaceSet is a duck-typed parameter) so it stays unit
// testable in the node suite, like fontsEpoch.ts next door.

/** The slice of `document.fonts` (FontFaceSet) this module needs. */
export interface FaceLoader {
  load(font: string): Promise<unknown>;
}

/** Weights the editor renders pack text at. Every family bundles only its
 *  400 face (see faces.ts), so the 700 probe resolves to that same face —
 *  requesting both just makes sure the bold-styled lookup is warmed too. */
const PROBE_WEIGHTS = ['400', '700'];

/** Any size works — a face loads once, for all sizes. */
const PROBE_PX = 16;

/** CSS font shorthands that load every pack face. Quoted family + explicit
 *  size/weight so the shorthand parses; an unparseable one would make
 *  `FontFaceSet.load` reject rather than load anything. */
export function faceProbes(cssFamilies: readonly string[]): string[] {
  const out: string[] = [];
  for (const family of cssFamilies) {
    for (const weight of PROBE_WEIGHTS) out.push(`${weight} ${PROBE_PX}px '${family}'`);
  }
  return out;
}

/**
 * Load every pack face, resolving once they have all settled (loaded or
 * failed). Best-effort throughout: no CSS Font Loading API — or a face that
 * 404s — resolves rather than rejecting, leaving that family on the system
 * fallback exactly as before.
 */
export async function settleFaces(
  cssFamilies: readonly string[],
  fonts: FaceLoader | null | undefined,
): Promise<void> {
  if (!fonts || typeof fonts.load !== 'function') return;
  await Promise.all(
    faceProbes(cssFamilies).map((probe) => {
      try {
        return Promise.resolve(fonts.load(probe)).catch(() => undefined);
      } catch {
        // A synchronous throw (e.g. a shorthand this engine won't parse)
        // is as recoverable as a rejection: fall back for that family.
        return Promise.resolve(undefined);
      }
    }),
  );
}
