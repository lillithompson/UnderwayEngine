import { CompositionFigure, CompositionState, Paint, RGBColor, SVGObject } from './types';
import type { PaintInk } from './imagePaintOverlay';
import { loadCompositionState, loadFileStateLite, loadClipBox } from './persistence';
import { loadImageAssets, purgeImageAssets } from './imageAssetStore';
import { loadBakedFigurePng } from './bake';
import { rasterizeSvgToImageDataUri, rasterizeSvgToJpegDataUri, rasterizeSvgToPngDataUri } from './svgRasterize';
import {
  generateCompositionSVGCore,
  type CompositionFigureLoadResult,
  type CompositionSubsetScene,
  type CompositionSubsetSelector,
  type CompositionSVGInputs,
  type ExportFrameCrop,
  type SVGFontResolver,
} from './compositionSVGCore';

// Re-export the pure core + its public types so existing callers that
// `import { generateCompositionSVGCore } from './compositionExport'`
// keep working. The actual implementation lives in compositionSVGCore.ts,
// kept pure so Node-side tooling can call it without dragging in
// IndexedDB / WebGL / react-native.
export { generateCompositionSVGCore };
export type {
  CompositionFigureLoadResult,
  CompositionSubsetScene,
  CompositionSubsetSelector,
  CompositionSVGInputs,
  ExportFrameCrop,
  SVGFontResolver,
};

/** Host-registered fallback resolver — see {@link setDefaultSVGFontResolver}. */
let defaultFontResolver: SVGFontResolver | undefined;

/**
 * Register the resolver every storage-backed export uses when the caller
 * doesn't pass one of its own.
 *
 * Fonts are a host concern (the engine has no idea where an app keeps its
 * face files), but *every* rasterizing export path needs them — journal
 * entry images, page thumbnails, file export — and each one silently
 * rendering fallback glyphs is exactly the drift this avoids. Registering
 * once at app start fixes them all; `options.fontResolver` still wins.
 */
export function setDefaultSVGFontResolver(resolver: SVGFontResolver | undefined): void {
  defaultFontResolver = resolver;
}

/**
 * The resolver {@link setDefaultSVGFontResolver} registered, for a caller that
 * drives {@link generateCompositionSVGCore} directly instead of going through
 * the storage-backed wrappers below (which apply it themselves).
 *
 * Reading it is how such a caller inherits the host's fonts without importing
 * the host's font module — the engine has no idea where an app keeps its faces,
 * and a caller that guessed would be a second registration to keep in sync.
 */
export function getDefaultSVGFontResolver(): SVGFontResolver | undefined {
  return defaultFontResolver;
}

/** A rewrite of the loaded scene, applied just before it becomes markup —
 *  see {@link setExportSceneTransform}. */
export type ExportSceneTransform =
  (scene: Partial<CompositionState>) => Partial<CompositionState>;

/** Host-registered scene rewrite — see {@link setExportSceneTransform}. */
let exportSceneTransform: ExportSceneTransform | undefined;

/**
 * Register a last-pass rewrite of every storage-backed export's scene: the
 * loaded record goes through it on its way into the SVG generator.
 *
 * For host content kinds the engine knows nothing about — a composite of
 * ordinary nodes plus a hidden record, say — whose DRAWN form depends on a
 * host setting that can change after the page was last baked. Such a host
 * re-derives that geometry here and every rasterizing path (journal entry
 * images, page thumbnails, file and zip export) picks it up at once,
 * instead of each remembering to ask.
 *
 * Purely cosmetic by contract: the transform sees a copy on its way out and
 * nothing it returns is written back to storage. Keep it SYNCHRONOUS and
 * cheap — it runs once per export, and there are three per saved page.
 */
export function setExportSceneTransform(fn: ExportSceneTransform | undefined): void {
  exportSceneTransform = fn;
}

/** The transform {@link setExportSceneTransform} registered, for a caller
 *  driving {@link generateCompositionSVGCore} directly — the same reason
 *  {@link getDefaultSVGFontResolver} is readable. */
export function getExportSceneTransform(): ExportSceneTransform | undefined {
  return exportSceneTransform;
}

/** Optional knobs for the storage-backed export wrappers. */
export interface CompositionExportOptions {
  /** Font-embedding hook for text nodes — see {@link SVGFontResolver}.
   *  Strongly recommended for PNG export: the rasterizer loads the SVG
   *  into a detached <img>, which cannot reach page-registered fonts,
   *  so un-embedded families fall back to the browser default. */
  fontResolver?: SVGFontResolver;
  /** Emit images from their full-resolution `originalImageId` copy. Set for
   *  real file exports; leave off for thumbnails/previews (see
   *  {@link CompositionSVGInputs.preferOriginalImages}).
   *
   *  On a RASTER export it is a budget rather than a switch: the raster
   *  exporters below pass their own long edge as
   *  {@link CompositionSVGInputs.rasterLongEdgePx}, so a 300 px thumbnail of
   *  a photo page samples the display copy even with this on, and only a
   *  raster that genuinely draws the photo larger than its display copy pays
   *  for the master. */
  preferOriginalImages?: boolean;
  /** The raster's long edge in pixels — see
   *  {@link CompositionSVGInputs.rasterLongEdgePx}. Set by the raster
   *  exporters from their own `maxDimension`; a caller generating SVG for a
   *  file leaves it off. */
  rasterLongEdgePx?: number;
  /** Export a CUTOUT — only the selected objects, framed tightly on them, on a
   *  transparent canvas. See {@link CompositionSVGInputs.subset}. Pair with
   *  {@link exportCompositionPNG}: JPEG has no alpha, so a cutout exported as
   *  JPEG lands on a white backdrop. */
  subset?: CompositionSubsetSelector;
  /** Paint every glyph this color instead of its authored one — for a cutout
   *  that lands on a backdrop the page never had. See
   *  {@link CompositionSVGInputs.textColorOverride}. */
  textColorOverride?: RGBColor;
  /** Stroke every line an SVG object draws in this color instead of its
   *  authored one, fills left alone — the same intent as `textColorOverride`
   *  for a cutout that is line art. See
   *  {@link CompositionSVGInputs.strokeColorOverride}. */
  strokeColorOverride?: RGBColor;
  /** Objects `strokeColorOverride` reaches; the rest keep their authored ink.
   *  See {@link CompositionSVGInputs.strokeOverrideOnly}. */
  strokeOverrideOnly?: CompositionSubsetSelector;
  /** SVG objects laid over the whole scene in their own ink, and framed on
   *  with it — a reveal's stand-in for a thing the page no longer holds. See
   *  {@link CompositionSVGInputs.overlaySvgObjects}. */
  overlaySvgObjects?: SVGObject[];
  /** Frame on `overlaySvgObjects` without painting them — the plain twin of
   *  an overlaid export. See {@link CompositionSVGInputs.drawOverlay}. */
  drawOverlay?: boolean;
  /** With `subset`: draw the selection, framed as the whole page's plain export
   *  is — the cutout lays over that export exactly. See
   *  {@link CompositionSVGInputs.frameOnScene}. */
  frameOnScene?: boolean;
  /** A translucent wash over the whole frame under everything drawn, a cutout
   *  included. See {@link CompositionSVGInputs.backdrop}. */
  backdrop?: Paint;
  /** Objects whose FILLS take `strokeColorOverride` too — for a picture made
   *  only of fills (a baked rig), which the line override would otherwise
   *  slide straight off. See {@link CompositionSVGInputs.silhouette}. */
  silhouette?: CompositionSubsetSelector;
  /** Objects that draw only their strokes — the fill comes off and the
   *  outline is left. See {@link CompositionSVGInputs.strokesOnly}. */
  strokesOnly?: CompositionSubsetSelector;
  /** Repaint every paint island in this color — or through this per-texel
   *  tone — texel alphas kept; the same intent as `strokeColorOverride` for
   *  the raster brush's marks. See
   *  {@link CompositionSVGInputs.paintColorOverride}. */
  paintColorOverride?: PaintInk;
  /** Drop every text node's authored drop shadow — for a cutout that leaves
   *  behind the page the shadow was cast against. See
   *  {@link CompositionSVGInputs.dropTextShadow}. */
  dropTextShadow?: boolean;
  /** How to read the stored record — see {@link CompositionIOOptions}. Pass
   *  `false` for a PAGE-ANCHORED composition, so the export sees the same
   *  coordinates and `strokeScale` the editor holds. It matters whenever an
   *  explicit `strokeScale` is supplied: normalization multiplies the stored
   *  one by the content scale factor, so an absolute override would land at a
   *  different weight for every page depending on how big its content is. */
  normalize?: boolean;
  /** Uniform breathing margin around the export frame, as a fraction of its
   *  longer edge — content-framed exports only (a frame-pinned export keeps
   *  its exact edge) — see {@link CompositionSVGInputs.viewBoxPadFraction}. */
  viewBoxPadFraction?: number;
  /** Crop the finished frame to a shape, panned toward a point — for an
   *  export that must come out square (say) without losing the one thing
   *  the square is for. See {@link CompositionSVGInputs.frameCrop}. */
  frameCrop?: ExportFrameCrop;
  /** Frame SVG objects on their inked extent (geometry + stroke half-width),
   *  as subset cutouts do — see {@link CompositionSVGInputs.frameInkExtents}.
   *  For content-framed exports, where the bare geometry slices boundary
   *  strokes in half. */
  frameInkExtents?: boolean;
  /** Frame on `overlaySvgObjects` alone, cropping whatever is drawn outside
   *  them — for an export that has to register against another picture of
   *  the same rect. See {@link CompositionSVGInputs.frameOnOverlay}. */
  frameOnOverlay?: boolean;
  /**
   * A composition ALREADY LOADED, used instead of reading the record by id.
   *
   * One journal tick draws the same page four or five times over — card
   * thumb, full-screen view, seed reveal, Today cutout — and each by-id
   * export used to re-enter {@link loadCompositionState}, which re-reads
   * every image blob out of IndexedDB across the structured-clone boundary.
   * For a page with three photos that was tens of megabytes of reads per
   * tick, for a record that had not changed between the first call and the
   * last. Load once, pass it here, and the rest is free.
   *
   * It must be the load the exports would have done themselves — same id,
   * same {@link normalize} — because nothing here can check that. `normalize`
   * is then only about how the CALLER loaded it.
   */
  scene?: Partial<CompositionState>;
}

/**
 * Load a PNG data URI for a figure to use as raster fallback in SVG export.
 */
async function loadFigurePngDataUri(fig: CompositionFigure): Promise<string | null> {
  if (fig.fileId) {
    return loadBakedFigurePng(fig.fileId);
  }
  return null;
}

/**
 * The storage-backed {@link CompositionSVGInputs.loadFigure} — reads a figure
 * file's layers + clip box out of IndexedDB.
 *
 * Exported because the SVG core is pure and every browser-side caller has to
 * supply the same reader: `exportCompositionSVG` below, and any host that
 * generates SVG from LIVE (unsaved) composition state rather than from a
 * stored record — e.g. an editor's eyedropper snapshot, which must see what is
 * on screen right now. Two copies of this would silently diverge the moment
 * the figure record grows a field.
 */
export async function storageFigureLoader(
  fileId: string,
): Promise<CompositionFigureLoadResult | null> {
  const [fileState, clipBox] = await Promise.all([
    loadFileStateLite(fileId),
    loadClipBox(fileId),
  ]);
  if (!fileState) return null;
  return {
    layers: fileState.layers,
    widthL0: fileState.widthL0,
    heightL0: fileState.heightL0,
    originL0X: fileState.originL0X,
    originL0Y: fileState.originL0Y,
    clipBox: clipBox ?? null,
  };
}

/** Raster fallback for asset figures with no vector data (legacy-only read).
 *  Exported alongside {@link storageFigureLoader} for the same reason. */
export const storageFigurePngLoader = loadFigurePngDataUri;

// The v29 visual features (text nodes, gradient fills, shadow/glow/border
// filters, image feColorMatrix tints, background paint) need no special
// handling in any of the exporters below: they are emitted as standard SVG by
// the generator and the browser's own SVG renderer rasterizes them. The one
// gap is fonts — pass `options.fontResolver` so families are embedded as
// @font-face data URIs (a detached <img> cannot see fonts registered on the
// page).

/**
 * Re-head an exported SVG so its own width/height ARE the pixels it is about
 * to be rasterized into. The viewBox is untouched, so nothing about the
 * drawing changes — only the size the document says it is.
 *
 * This matters because of how the raster path works: the string goes into a
 * detached `<img>` and is then drawn onto a canvas with
 * `drawImage(img, 0, 0, w, h)`. WebKit rasterizes an SVG image ONCE, at the
 * size the document declares, and `drawImage` then scales that bitmap —
 * vector art does not get re-rendered at the destination size the way the
 * naming suggests. The generator declares `viewBox / 10`, which for a page
 * is about 595 px, so the 1080 px viewer image was a 1.8x blow-up of a
 * 595 px raster: soft edges, and stepped bands anywhere the page holds a
 * smooth ramp (a paint overlay stretched across a shape is exactly that,
 * which is where it showed up first).
 */
function svgAtRasterSize(svg: string, width: number, height: number): string {
  const open = svg.indexOf('<svg');
  if (open < 0) return svg;
  const close = svg.indexOf('>', open);
  if (close < 0) return svg;
  const tag = svg.slice(open, close)
    .replace(/\swidth="[^"]*"/, ` width="${width}"`)
    .replace(/\sheight="[^"]*"/, ` height="${height}"`);
  return svg.slice(0, open) + tag + svg.slice(close);
}

/**
 * Export the composition's SVG and compute the output raster dimensions that
 * fit within `maxDimension` while preserving the SVG's aspect ratio. Shared
 * by the PNG and JPEG exporters. Returns null when there's nothing to draw.
 *
 * The SVG comes back sized to those dimensions — see {@link svgAtRasterSize}.
 */
/**
 * A composition FRAMED AND READY TO ENCODE: the SVG document, already
 * re-headed to the pixel box it is about to be drawn into, and that box.
 *
 * It is a separate step from encoding because the encode can need doing
 * twice. An export drawn to fit a byte cap (entryRaster's `exportUnderCap`)
 * overshoots and draws again smaller — and the two attempts differ in
 * NOTHING but the root `width`/`height`. Re-entering the by-id export for
 * the retry re-read the record, re-hydrated every photo, and rebuilt the
 * whole base64'd string to produce a document identical to the one already
 * in hand. Prepare once, {@link resizePreparedRaster}, encode again.
 */
export interface PreparedRaster {
  svg: string;
  width: number;
  height: number;
  /** The long edge the document is currently headed at, which is what the
   *  caller asked for — `width` or `height`, whichever the aspect made
   *  larger. Saves the caller re-deriving it to step the retry down. */
  longEdge: number;
}

/** The pixel box `maxDimension` gives a document of this aspect: the long
 *  edge is `maxDimension`, the short one follows. */
function rasterBoxFor(svgW: number, svgH: number, maxDimension: number): { width: number; height: number } {
  return svgW >= svgH
    ? { width: Math.round(maxDimension), height: Math.round(maxDimension * (svgH / svgW)) }
    : { height: Math.round(maxDimension), width: Math.round(maxDimension * (svgW / svgH)) };
}

/**
 * Frame a composition for a raster of at most `maxDimension` px on the long
 * edge: generate its SVG, read the aspect off the document, and re-head it at
 * the pixel box that fits. Null when there is nothing to draw.
 *
 * Exported for callers that encode more than once from one document — see
 * {@link PreparedRaster}. The ordinary exporters below go through it too, so
 * there is one framing rule rather than two.
 */
export async function prepareCompositionRaster(
  compId: string,
  maxDimension: number,
  strokeScale?: number,
  options?: CompositionExportOptions,
): Promise<PreparedRaster | null> {
  // The raster's long edge IS the export's pixel budget for image masters
  // (rasterLongEdgePx) — a caller-supplied value would be a second answer to
  // the same question, so this one wins.
  const svg = await exportCompositionSVG(
    compId, undefined, strokeScale, { ...options, rasterLongEdgePx: maxDimension });
  if (!svg) return null;

  // Parse SVG width/height to preserve aspect ratio
  const wMatch = svg.match(/\bwidth="([^"]*)"/);
  const hMatch = svg.match(/\bheight="([^"]*)"/);
  const svgW = wMatch ? parseFloat(wMatch[1]) : 0;
  const svgH = hMatch ? parseFloat(hMatch[1]) : 0;
  if (svgW <= 0 || svgH <= 0) return null;

  const { width, height } = rasterBoxFor(svgW, svgH, maxDimension);
  return { svg: svgAtRasterSize(svg, width, height), width, height, longEdge: maxDimension };
}

/**
 * The same document re-headed for a SMALLER (or larger) raster — the retry
 * of an export that overshot its byte cap.
 *
 * Only the root width/height move; the drawing is untouched, so this is a
 * string splice rather than a re-render. One thing it deliberately does NOT
 * redo is the image-master budget (`rasterLongEdgePx`): a document prepared
 * for 2160 px keeps the master a 1080 px retry would not have asked for.
 * That costs the retry a larger decode, never fidelity — and it is the whole
 * point, since re-deciding would mean re-reading and re-encoding every photo.
 */
export function resizePreparedRaster(prepared: PreparedRaster, maxDimension: number): PreparedRaster {
  const { width, height } = rasterBoxFor(prepared.width, prepared.height, maxDimension);
  return {
    svg: svgAtRasterSize(prepared.svg, width, height),
    width,
    height,
    longEdge: maxDimension,
  };
}

/** Encode a prepared raster as the image its pixels call for — PNG where the
 *  frame has any transparency, JPEG at `jpegQuality` where it is opaque. The
 *  encode half of {@link exportCompositionImageSized}, for a caller driving
 *  the two halves itself. */
export function encodePreparedImage(prepared: PreparedRaster, jpegQuality: number): Promise<string | null> {
  return rasterizeSvgToImageDataUri(prepared.svg, prepared.width, prepared.height, jpegQuality);
}

/** Encode a prepared raster as a PNG, alpha intact — the encode half of
 *  {@link exportCompositionPNGSized}. */
export function encodePreparedPNG(prepared: PreparedRaster): Promise<string | null> {
  return rasterizeSvgToPngDataUri(prepared.svg, prepared.width, prepared.height);
}

/** A raster export together with the pixel dimensions it was drawn at, for
 *  callers that need the artifact's aspect without re-decoding the image. */
export interface SizedRasterExport {
  dataUri: string;
  width: number;
  height: number;
}

/** Frame the export, then encode it — the one body behind every raster
 *  exporter below, so the framing rules (aspect fit, "nothing to draw" →
 *  null) cannot differ between PNG, JPEG and the encoder-by-alpha export. */
async function exportCompositionRaster(
  compId: string,
  maxDimension: number,
  strokeScale: number | undefined,
  options: CompositionExportOptions | undefined,
  encode: (svg: string, width: number, height: number) => Promise<string | null>,
): Promise<SizedRasterExport | null> {
  const target = await prepareCompositionRaster(compId, maxDimension, strokeScale, options);
  if (!target) return null;
  const dataUri = await encode(target.svg, target.width, target.height);
  // The masters this export may have pulled in are megabytes apiece and
  // nothing else wants them — the bytes are already inside `target.svg`.
  purgeImageAssets('original');
  return dataUri ? { dataUri, width: target.width, height: target.height } : null;
}

/**
 * Export the composition as a PNG data URI at up to `maxDimension` px on the
 * long edge, alpha intact — nothing is painted where the composition draws
 * nothing, so the artifact composites onto whatever shows it.
 */
export async function exportCompositionPNG(
  compId: string,
  maxDimension: number,
  strokeScale?: number,
  options?: CompositionExportOptions,
): Promise<string | null> {
  const sized = await exportCompositionPNGSized(compId, maxDimension, strokeScale, options);
  return sized?.dataUri ?? null;
}

/**
 * {@link exportCompositionPNG}, returning the raster's pixel dimensions
 * alongside the data URI — the alpha-preserving counterpart of
 * {@link exportCompositionJPEGSized}, for a composition whose export frame is
 * its own content and whose aspect therefore isn't knowable up front.
 */
export async function exportCompositionPNGSized(
  compId: string,
  maxDimension: number,
  strokeScale?: number,
  options?: CompositionExportOptions,
): Promise<SizedRasterExport | null> {
  return exportCompositionRaster(
    compId, maxDimension, strokeScale, options, rasterizeSvgToPngDataUri);
}

/**
 * Export the composition as a JPEG data URI at up to `maxDimension` px on the
 * long edge. Far smaller than PNG for a photographic artifact, at the cost of
 * alpha: JPEG has none, so the frame is flood-filled white first and an export
 * that draws nothing in a corner lands on a white block there. `quality` is
 * 0..1 (default 0.82). Pair with `options.preferOriginalImages` so embedded
 * photos sample the full-res copy.
 */
export async function exportCompositionJPEG(
  compId: string,
  maxDimension: number,
  quality: number = 0.82,
  strokeScale?: number,
  options?: CompositionExportOptions,
): Promise<string | null> {
  const sized = await exportCompositionJPEGSized(compId, maxDimension, quality, strokeScale, options);
  return sized?.dataUri ?? null;
}

/**
 * {@link exportCompositionJPEG}, returning the raster's pixel dimensions
 * alongside the data URI. For a composition whose export frame is its own
 * content (no page frame), the aspect isn't knowable up front — this hands it
 * to the caller without decoding the encoded image back.
 */
export async function exportCompositionJPEGSized(
  compId: string,
  maxDimension: number,
  quality: number = 0.82,
  strokeScale?: number,
  options?: CompositionExportOptions,
): Promise<SizedRasterExport | null> {
  return exportCompositionRaster(compId, maxDimension, strokeScale, options, (svg, w, h) =>
    rasterizeSvgToJpegDataUri(svg, w, h, quality));
}

/**
 * Export the composition as the raster its pixels call for: a PNG data URI,
 * alpha intact, when the frame has any transparency; a JPEG at
 * `jpegQuality` (0..1) when it is opaque edge to edge — see
 * {@link rasterizeSvgToImageDataUri}. Framed exactly as the PNG and JPEG
 * exporters frame it. Read the mime off the data URI.
 */
export async function exportCompositionImage(
  compId: string,
  maxDimension: number,
  jpegQuality: number,
  strokeScale?: number,
  options?: CompositionExportOptions,
): Promise<string | null> {
  const sized = await exportCompositionImageSized(compId, maxDimension, jpegQuality, strokeScale, options);
  return sized?.dataUri ?? null;
}

/** {@link exportCompositionImage}, returning the raster's pixel dimensions
 *  alongside the data URI, as {@link exportCompositionPNGSized} does. */
export async function exportCompositionImageSized(
  compId: string,
  maxDimension: number,
  jpegQuality: number,
  strokeScale?: number,
  options?: CompositionExportOptions,
): Promise<SizedRasterExport | null> {
  return exportCompositionRaster(compId, maxDimension, strokeScale, options, (svg, w, h) =>
    rasterizeSvgToImageDataUri(svg, w, h, jpegQuality));
}

/**
 * Export a composition as an SVG document string.
 * Figures with file data are rendered as vector SVG; other figures fall
 * back to embedded PNG <image> elements — a legacy-only path (nothing
 * writes baked_fig_png_* keys anymore, so it cannot fire for fresh data).
 *
 * Thin storage-backed wrapper around `generateCompositionSVGCore`.
 */
export async function exportCompositionSVG(
  compId: string,
  cancelled?: () => boolean,
  strokeScale?: number,
  options?: CompositionExportOptions,
): Promise<string | null> {
  const loaded = options?.scene ?? await loadCompositionState(
    compId,
    options?.normalize === undefined ? undefined : { normalize: options.normalize },
  );
  if (!loaded) return null;
  return exportCompositionSVGFromState(loaded, strokeScale, options, cancelled);
}

/**
 * The scene's blobs plus, when this export can actually use them, the export
 * MASTERS its image nodes reference.
 *
 * A loaded composition holds display copies only (persistence's
 * `loadCompositionState`): the master is ten times the bytes and the canvas
 * never draws it, so pinning it for a whole editing session bought nothing.
 * The export path is the one consumer that wants it, and only sometimes —
 * `preferOriginalImages` is a pixel budget (compositionSVGCore's
 * `rasterLongEdgePx`), so a 300 px card thumb needs no master at all.
 *
 * The filter here is the budget's cheap upper bound: a node draws at most
 * the whole frame, so it cannot exceed its display copy unless the raster
 * itself does. That reads zero masters for a thumbnail and every master a
 * full-size view might sample, without having to know the frame — the
 * generator's exact per-node check still decides which get used.
 *
 * Nothing is written back into the caller's state: the merged record lives
 * for this one generate, and the masters are dropped from the cache as soon
 * as the raster is encoded (see `exportCompositionRaster`).
 */
async function withExportMasters(
  scene: Partial<CompositionState>,
  options: CompositionExportOptions | undefined,
): Promise<Record<string, Uint8Array>> {
  const blobs = scene.imageBlobs ?? {};
  if (!options?.preferOriginalImages) return blobs;
  const rasterPx = options.rasterLongEdgePx;
  const wanted: string[] = [];
  for (const img of scene.images ?? []) {
    const id = img.originalImageId;
    if (id == null || blobs[id]) continue;
    const displayEdge = Math.max(img.pixelWidth ?? 0, img.pixelHeight ?? 0);
    // No raster size named (a real .svg file, drawn at any scale) → always.
    if (rasterPx !== undefined && displayEdge > 0 && rasterPx <= displayEdge) continue;
    wanted.push(id);
  }
  if (wanted.length === 0) return blobs;
  return { ...blobs, ...await loadImageAssets(wanted, 'original') };
}

/**
 * {@link exportCompositionSVG} without the read: the same generator call,
 * the same host transform and the same defaults, driven from a composition
 * the caller already holds.
 *
 * It is the body of the by-id wrapper above, exported because a caller that
 * draws ONE page several ways — the journal's tick: thumb, view, reveal,
 * cutout — should pay for one hydration rather than one per picture (the
 * blobs are megabytes; the JSON is not). Callers that go through the raster
 * exporters get the same saving by passing
 * {@link CompositionExportOptions.scene}.
 */
export async function exportCompositionSVGFromState(
  state: Partial<CompositionState>,
  strokeScale?: number,
  options?: CompositionExportOptions,
  cancelled?: () => boolean,
): Promise<string | null> {
  // The host's last word on how its own content draws (rig sketch vs
  // classic, say) — see setExportSceneTransform.
  const partial = exportSceneTransform ? exportSceneTransform(state) : state;
  const imageBlobs = await withExportMasters(partial, options);
  return generateCompositionSVGCore({
    name: partial.name ?? 'composition',
    figures: partial.figures ?? [],
    svgObjects: partial.svgObjects ?? [],
    images: partial.images ?? [],
    imageBlobs,
    texts: partial.texts ?? [],
    background: partial.background,
    paintObjects: partial.paintObjects,
    patternObjects: partial.patternObjects,
    fontResolver: options?.fontResolver ?? defaultFontResolver,
    preferOriginalImages: options?.preferOriginalImages,
    rasterLongEdgePx: options?.rasterLongEdgePx,
    subset: options?.subset,
    textColorOverride: options?.textColorOverride,
    strokeColorOverride: options?.strokeColorOverride,
    strokeOverrideOnly: options?.strokeOverrideOnly,
    overlaySvgObjects: options?.overlaySvgObjects,
    drawOverlay: options?.drawOverlay,
    frameOnScene: options?.frameOnScene,
    backdrop: options?.backdrop,
    silhouette: options?.silhouette,
    strokesOnly: options?.strokesOnly,
    paintColorOverride: options?.paintColorOverride,
    dropTextShadow: options?.dropTextShadow,
    viewBoxPadFraction: options?.viewBoxPadFraction,
    frameCrop: options?.frameCrop,
    frameInkExtents: options?.frameInkExtents,
    frameOnOverlay: options?.frameOnOverlay,
    groups: partial.groups ?? [],
    sceneOrder: partial.sceneOrder,
    // The state's own graph, when it has one and still describes these
    // arrays — a page the editor is holding says more about its poses
    // than its legacy arrays can. `exportGraph` rebuilds when it doesn't,
    // which covers a stored record (no graph) and a host transform that
    // rewrote the arrays (`setExportSceneTransform`) alike.
    graph: partial.graph,
    strokeScale: strokeScale ?? partial.strokeScale,
    loadFigure: storageFigureLoader,
    loadBakedFigurePng: loadFigurePngDataUri,
  }, cancelled);
}
