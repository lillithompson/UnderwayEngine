/**
 * How bright a colour LOOKS — Rec. 601 weights, 0 (black) to 255 (white).
 *
 * The one answer to "is this darker than that" every Underway app asks —
 * byte-identical in all three apps' `components/perceivedLuma.ts` until
 * stage 6.4a of docs/shared-editor.md moved it here.
 *
 * In the ENGINE rather than beside the palette that reads it, for
 * `seededRandom`'s reason (6.3d): it is arithmetic with no editor concept in
 * it, and the layers above reach for it from places the editor's chrome may
 * not be imported — DrawBots' `web/simRender/` is held to engine imports
 * only, and its source pin caught this one being put in editor-ui. It is not WCAG's
 * relative luminance (which linearizes each channel first and weights
 * them 0.2126/0.7152/0.0722); it is the cheap perceptual grey, taken
 * straight off the sRGB bytes, and it is what every place in this
 * codebase that ranks colours by brightness already used.
 *
 * Here because three of them had written the triple out: the Today
 * cutout's paint whitening (web/formats/todayThumb.whitenPaintTexel), the
 * card thumb's top-band measurement (web/editor/thumbTopLuma) and the
 * Shared feed's WIP wash (app/shared/[peer].tsx). The last two are
 * compared against each other — a measured picture seen through a wash —
 * so a drifted weight there would not be a rounding difference, it would
 * ink a label the wrong colour.
 *
 * Deliberately dependency-free: it rides the native bundle and the
 * WebView one alike, and web/formats/todayThumb.ts pulls the engine in,
 * so the shared piece could not live there.
 */
export function perceivedLuma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
