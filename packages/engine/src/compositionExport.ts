import { CompositionFigure, RGBColor } from './types';
import { loadCompositionState, loadFileStateLite, loadClipBox } from './persistence';
import { loadBakedFigurePng } from './bake';
import { encodePNG, toBase64 } from './pngcodec';
import { rasterizeSvgToPixels, rasterizeSvgToJpegDataUri } from './svgRasterize';
import {
  generateCompositionSVGCore,
  type CompositionFigureLoadResult,
  type CompositionSubsetScene,
  type CompositionSubsetSelector,
  type CompositionSVGInputs,
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

/** Optional knobs for the storage-backed export wrappers. */
export interface CompositionExportOptions {
  /** Font-embedding hook for text nodes — see {@link SVGFontResolver}.
   *  Strongly recommended for PNG export: the rasterizer loads the SVG
   *  into a detached <img>, which cannot reach page-registered fonts,
   *  so un-embedded families fall back to the browser default. */
  fontResolver?: SVGFontResolver;
  /** Emit images from their full-resolution `originalImageId` copy. Set for
   *  real file exports; leave off for thumbnails/previews (see
   *  {@link CompositionSVGInputs.preferOriginalImages}). */
  preferOriginalImages?: boolean;
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
  /** How to read the stored record — see {@link CompositionIOOptions}. Pass
   *  `false` for a PAGE-ANCHORED composition, so the export sees the same
   *  coordinates and `strokeScale` the editor holds. It matters whenever an
   *  explicit `strokeScale` is supplied: normalization multiplies the stored
   *  one by the content scale factor, so an absolute override would land at a
   *  different weight for every page depending on how big its content is. */
  normalize?: boolean;
  /** Uniform breathing margin around the export frame, as a fraction of its
   *  longer edge — see {@link CompositionSVGInputs.viewBoxPadFraction}. */
  viewBoxPadFraction?: number;
  /** Frame SVG objects on their inked extent (geometry + stroke half-width),
   *  as subset cutouts do — see {@link CompositionSVGInputs.frameInkExtents}.
   *  For content-framed exports, where the bare geometry slices boundary
   *  strokes in half. */
  frameInkExtents?: boolean;
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

/**
 * Export a composition as a PNG data URI.
 * Generates SVG via exportCompositionSVG, then rasterizes to pixels
 * at the correct aspect ratio fitting within maxDimension.
 *
 * The v29 visual features (text nodes, gradient fills, shadow/glow/border
 * filters, image feColorMatrix tints, background paint) need no special
 * handling here: they are emitted as standard SVG by the generator and
 * the browser's own SVG renderer rasterizes them in rasterizeSvgToPixels.
 * The one gap is fonts — pass `options.fontResolver` so families are
 * embedded as @font-face data URIs (a detached <img> cannot see fonts
 * registered on the page).
 */
/**
 * Export the composition's SVG and compute the output raster dimensions that
 * fit within `maxDimension` while preserving the SVG's aspect ratio. Shared
 * by the PNG and JPEG exporters. Returns null when there's nothing to draw.
 */
async function exportCompositionRasterTarget(
  compId: string,
  maxDimension: number,
  strokeScale?: number,
  options?: CompositionExportOptions,
): Promise<{ svg: string; width: number; height: number } | null> {
  const svg = await exportCompositionSVG(compId, undefined, strokeScale, options);
  if (!svg) return null;

  // Parse SVG width/height to preserve aspect ratio
  const wMatch = svg.match(/\bwidth="([^"]*)"/);
  const hMatch = svg.match(/\bheight="([^"]*)"/);
  const svgW = wMatch ? parseFloat(wMatch[1]) : 0;
  const svgH = hMatch ? parseFloat(hMatch[1]) : 0;
  if (svgW <= 0 || svgH <= 0) return null;

  let width: number;
  let height: number;
  if (svgW >= svgH) {
    width = Math.round(maxDimension);
    height = Math.round(maxDimension * (svgH / svgW));
  } else {
    height = Math.round(maxDimension);
    width = Math.round(maxDimension * (svgW / svgH));
  }
  return { svg, width, height };
}

export async function exportCompositionPNG(
  compId: string,
  maxDimension: number,
  strokeScale?: number,
  options?: CompositionExportOptions,
): Promise<string | null> {
  const target = await exportCompositionRasterTarget(compId, maxDimension, strokeScale, options);
  if (!target) return null;

  const pixels = await rasterizeSvgToPixels(target.svg, target.width, target.height);
  if (!pixels) return null;

  const pngBytes = encodePNG(pixels, target.width, target.height);
  const base64 = toBase64(pngBytes);
  return `data:image/png;base64,${base64}`;
}

/** A raster export together with the pixel dimensions it was drawn at, for
 *  callers that need the artifact's aspect without re-decoding the image. */
export interface SizedRasterExport {
  dataUri: string;
  width: number;
  height: number;
}

/**
 * Export the composition as a JPEG data URI at up to `maxDimension` px on the
 * long edge. JPEG (no alpha, white backdrop) is far smaller than PNG for the
 * journal's photographic/paper artifacts, which matters because these images
 * ride the WebView bridge. `quality` is 0..1 (default 0.82). Pair with
 * `options.preferOriginalImages` so embedded photos sample the full-res copy.
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
  const target = await exportCompositionRasterTarget(compId, maxDimension, strokeScale, options);
  if (!target) return null;
  const dataUri = await rasterizeSvgToJpegDataUri(target.svg, target.width, target.height, quality);
  return dataUri ? { dataUri, width: target.width, height: target.height } : null;
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
  const partial = await loadCompositionState(
    compId,
    options?.normalize === undefined ? undefined : { normalize: options.normalize },
  );
  if (!partial) return null;
  return generateCompositionSVGCore({
    name: partial.name ?? 'composition',
    figures: partial.figures ?? [],
    svgObjects: partial.svgObjects ?? [],
    images: partial.images ?? [],
    imageBlobs: partial.imageBlobs ?? {},
    texts: partial.texts ?? [],
    background: partial.background,
    canvasPaint: partial.canvasPaint,
    fontResolver: options?.fontResolver ?? defaultFontResolver,
    preferOriginalImages: options?.preferOriginalImages,
    subset: options?.subset,
    textColorOverride: options?.textColorOverride,
    strokeColorOverride: options?.strokeColorOverride,
    viewBoxPadFraction: options?.viewBoxPadFraction,
    frameInkExtents: options?.frameInkExtents,
    groups: partial.groups ?? [],
    sceneOrder: partial.sceneOrder,
    strokeScale: strokeScale ?? partial.strokeScale,
    loadFigure: storageFigureLoader,
    loadBakedFigurePng: loadFigurePngDataUri,
  }, cancelled);
}
