import { ImageObject } from './types';
import { compSnapStep } from './compositionCellMath';

/**
 * Reference-image import pipeline. Decodes a picked PNG/JPG (or rasterizes
 * a picked SVG — see {@link SVG_MIME_TYPE}), downsamples
 * its longest edge to {@link MAX_EDGE_PX}, re-encodes the bytes (PNG when
 * the source had alpha, JPEG otherwise), and produces a fresh
 * `ImageObject` placed at the given cell + sized so its longest edge
 * spans {@link DEFAULT_LONGEST_EDGE_CELLS} cells at the active grid level
 * while preserving the source aspect.
 *
 * The cap exists because the editor's WebView decodes one bitmap per
 * unique data URI and we want each decoded bitmap to stay well under
 * the 16 MB IOSurface budget on iOS (1024² × 4 bytes = ~4 MB). Tuning
 * this number is the only knob users get for on-screen quality vs. memory.
 *
 * Export quality is decoupled from this cap: a second, higher-resolution
 * copy (bounded to {@link ORIGINAL_MAX_EDGE_PX}) is stored alongside the
 * display bitmap and preferred when rasterizing/exporting, so shrinking
 * this display cap never costs export fidelity.
 */
export const MAX_EDGE_PX = 1024;

/**
 * Longest-edge cap for the *original* copy kept for export. Larger than
 * {@link MAX_EDGE_PX} so exports stay sharp for real phone/camera photos,
 * but still bounded so a single import can't balloon the saved file (or a
 * decode) without limit — 4096² × 4 ≈ 64 MB decoded, which only ever
 * happens transiently during export, never on the canvas hot path. When
 * the source already fits {@link MAX_EDGE_PX} no separate original is
 * stored (display bytes are already full resolution).
 */
export const ORIGINAL_MAX_EDGE_PX = 4096;

/** Default placement size (in grid-level cells) along the image's longest
 *  edge. Converted to L0 cells at import time via the active grid level.
 *  Eight cells matches the figure-default footprint so the image lands
 *  at a comfortable size relative to the working grid. */
export const DEFAULT_LONGEST_EDGE_CELLS = 8;

/** JPEG quality used when re-encoding a downsampled non-alpha image.
 *  0.9 is the sweet spot — visual artifacts vanish while bytes are
 *  ~3x smaller than PNG for photographic content. */
const JPEG_QUALITY = 0.9;

/** The one vector source format the pipeline accepts. An SVG is RASTERIZED at
 *  import — rendered at the pipeline's own resolution caps and re-encoded as
 *  PNG — because everything downstream of import (the binary persistence
 *  format, export data URIs, the native decode path) speaks
 *  `'image/png' | 'image/jpeg'` only. Rendering AT the cap rather than at the
 *  file's intrinsic size is what keeps a 24px icon crisp: vectors have no
 *  native resolution to lose. */
export const SVG_MIME_TYPE = 'image/svg+xml';

/** Result returned by {@link prepareImageImport}: bytes ready for
 *  `state.imageBlobs` and an `ImageObject` ready for `state.images`. */
export interface ImageImportResult {
  image: ImageObject;
  /** Display bytes, keyed by `image.imageId`. */
  bytes: Uint8Array;
  /** Full-resolution (≤{@link ORIGINAL_MAX_EDGE_PX}) bytes, keyed by
   *  `image.originalImageId`. Present only when the source was larger than
   *  the display cap — otherwise `bytes` is already full resolution and no
   *  separate original is stored. */
  originalBytes?: Uint8Array;
}

/** Mint a fresh imageId. Random suffix is enough — collisions across a
 *  single composition's import flow are astronomically unlikely. */
function mintImageId(): string {
  return 'imgblob_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

/** Mint a fresh ImageObject node id (separate namespace from the blob
 *  key so duplicating a node mints a new node id but keeps the same
 *  blob id, sharing pixel bytes across instances). */
function mintImageNodeId(): string {
  return 'img_' + Date.now().toString() + '_' + Math.random().toString(36).slice(2, 6);
}

/**
 * Detect whether a decoded bitmap has any non-opaque pixels. Sampled —
 * we don't decode every pixel, just a sparse grid. Photographs almost
 * never have alpha; UI screenshots and PNG icons usually do. Used to
 * pick the re-encode format (PNG to preserve transparency, JPEG
 * otherwise).
 */
function bitmapHasAlpha(bitmap: ImageBitmap): boolean {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return true;
  ctx.drawImage(bitmap, 0, 0);
  const w = bitmap.width;
  const h = bitmap.height;
  // 16×16 grid of sample points keeps cost O(256) regardless of image
  // size. False positives (alpha=255 sampled but a stray semi-transparent
  // pixel exists elsewhere) just downgrade JPEG → PNG, which is safe.
  const stepX = Math.max(1, Math.floor(w / 16));
  const stepY = Math.max(1, Math.floor(h / 16));
  for (let y = 0; y < h; y += stepY) {
    for (let x = 0; x < w; x += stepX) {
      const px = ctx.getImageData(x, y, 1, 1).data;
      if (px[3] < 255) return true;
    }
  }
  return false;
}

/**
 * Is this picked file an SVG? The mime type settles it when the platform
 * supplies one; otherwise sniff the head of the bytes — file inputs on some
 * platforms hand over `.svg` files with an empty `type`, and an SVG document
 * can only open with an XML declaration, a doctype, a comment, or the `<svg>`
 * root itself.
 */
export function looksLikeSvg(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === SVG_MIME_TYPE) return true;
  if (mimeType && mimeType !== 'application/octet-stream') return false;
  const head = new TextDecoder().decode(bytes.slice(0, 512))
    .replace(/^\uFEFF/, '').trimStart();
  if (head.startsWith('<svg')) return true;
  const preamble = head.startsWith('<?xml') || head.startsWith('<!--') || head.startsWith('<!DOCTYPE');
  return preamble && head.includes('<svg');
}

/**
 * The intrinsic size an SVG document declares, used only for its ASPECT (the
 * raster is rendered at the pipeline's edge cap regardless). Root `width` /
 * `height` attributes win when both are plain numbers (px or unitless); the
 * `viewBox` extent is the fallback — icon SVGs routinely carry only that —
 * and a document declaring neither rasterizes square. Attribute parsing is a
 * regex over the root tag rather than a DOM parse so the decision is the same
 * everywhere, browser or not.
 */
export function svgIntrinsicSize(svgText: string): { width: number; height: number } {
  const root = /<svg\b[^>]*>/i.exec(svgText)?.[0];
  if (root) {
    const attr = (name: string): number | null => {
      const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(root);
      const raw = m ? (m[2] ?? m[3]) : null;
      const num = raw ? /^\s*([0-9.]+)\s*(px)?\s*$/.exec(raw) : null;
      const n = num ? parseFloat(num[1]) : NaN;
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const w = attr('width');
    const h = attr('height');
    if (w != null && h != null) return { width: w, height: h };
    const vbRaw = new RegExp('\\bviewBox\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i').exec(root);
    const vb = (vbRaw ? (vbRaw[2] ?? vbRaw[3]) : '').trim().split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { width: vb[2], height: vb[3] };
  }
  return { width: 1, height: 1 };
}

/**
 * Render an SVG blob to a bitmap whose longest edge IS `maxEdge` — up- or
 * downscaled, since a vector is sharp at any size. `createImageBitmap`
 * cannot decode SVG blobs (Chrome and WebKit both refuse), so the decode
 * goes through an `Image` element and an object URL, then draws into an
 * OffscreenCanvas at the target size.
 */
async function rasterizeSvg(
  blob: Blob,
  maxEdge: number,
): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
  const { width, height } = svgIntrinsicSize(await blob.text());
  const scale = maxEdge / Math.max(width, height);
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = new OffscreenCanvas(targetW, targetH);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
    ctx.drawImage(img, 0, 0, targetW, targetH);
    return { bitmap: await createImageBitmap(canvas), width: targetW, height: targetH };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Decode the picked file's bytes and downsample the result so the
 * longest edge is at most {@link MAX_EDGE_PX}. Returns the bitmap plus
 * the new pixel dimensions.
 *
 * Uses `createImageBitmap` because it can decode + resize in one pass
 * without round-tripping through HTMLImageElement (which is what costs
 * us IOSurface memory on iOS). The `resizeWidth` / `resizeHeight` /
 * `resizeQuality` options are honored on every modern WebKit; we fall
 * back to a manual canvas resize when the browser ignores them.
 */
async function decodeAndDownsample(
  blob: Blob,
  maxEdge: number = MAX_EDGE_PX,
): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
  // First decode at native resolution so we can read intrinsic dims
  // and decide the resize ratio. Skipping this step (decoding directly
  // with resizeWidth/Height) means we'd have to know the target
  // dimensions in advance, which we don't.
  const native = await createImageBitmap(blob);
  const longest = Math.max(native.width, native.height);
  if (longest <= maxEdge) {
    return { bitmap: native, width: native.width, height: native.height };
  }
  const scale = maxEdge / longest;
  const targetW = Math.max(1, Math.round(native.width * scale));
  const targetH = Math.max(1, Math.round(native.height * scale));
  // Re-decode (or copy) at the target size. We use createImageBitmap on
  // the original blob a second time when the platform supports it; the
  // first decode is then GC'd quickly. On platforms where resizeWidth
  // is silently ignored, fall back to drawing through OffscreenCanvas.
  try {
    const resized = await createImageBitmap(blob, {
      resizeWidth: targetW,
      resizeHeight: targetH,
      resizeQuality: 'high',
    });
    if (resized.width === targetW && resized.height === targetH) {
      native.close?.();
      return { bitmap: resized, width: targetW, height: targetH };
    }
    resized.close?.();
  } catch {
    // fall through to canvas resize
  }
  const canvas = new OffscreenCanvas(targetW, targetH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  ctx.drawImage(native, 0, 0, targetW, targetH);
  native.close?.();
  const resized = await createImageBitmap(canvas);
  return { bitmap: resized, width: targetW, height: targetH };
}

/**
 * Re-encode a bitmap to a Uint8Array. PNG when alpha is present (so the
 * transparency survives), JPEG otherwise (3x smaller for photographs).
 * Returns both the bytes and the chosen MIME type so the caller can
 * record it on the ImageObject.
 */
async function reencodeBitmap(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  hasAlpha: boolean,
): Promise<{ bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg' }> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  ctx.drawImage(bitmap, 0, 0);
  const mimeType = hasAlpha ? 'image/png' : 'image/jpeg';
  const blob = await canvas.convertToBlob(
    hasAlpha ? { type: 'image/png' } : { type: 'image/jpeg', quality: JPEG_QUALITY },
  );
  const buf = await blob.arrayBuffer();
  return { bytes: new Uint8Array(buf), mimeType };
}

/** One full decode → (optional) downsample → alpha-detect → re-encode pass.
 *  Shared by the fresh-import and replacement pipelines (and called twice by
 *  each — once for the display copy, once for the original) so the encode
 *  logic lives in exactly one place. `forceAlpha`, when given, skips the
 *  per-scale alpha sample and pins the output format so a node's display and
 *  original copies never disagree on mime (which would mislabel the data URI
 *  at export). */
async function prepareScaledEncoding(
  sourceBlob: Blob,
  maxEdge: number,
  forceAlpha?: boolean,
): Promise<{ bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg'; width: number; height: number; hasAlpha: boolean }> {
  // An SVG source rasterizes AT the edge cap (see rasterizeSvg) and always
  // encodes as PNG: vector art is drawn on transparency far more often than
  // not, and JPEG would flatten it onto a background forever.
  const isSvg = sourceBlob.type === SVG_MIME_TYPE;
  const { bitmap, width, height } = isSvg
    ? await rasterizeSvg(sourceBlob, maxEdge)
    : await decodeAndDownsample(sourceBlob, maxEdge);
  const hasAlpha = forceAlpha ?? (isSvg || bitmapHasAlpha(bitmap));
  const { bytes, mimeType } = await reencodeBitmap(bitmap, width, height, hasAlpha);
  bitmap.close?.();
  return { bytes, mimeType, width, height, hasAlpha };
}

/**
 * Compute the placement bbox for a freshly imported image so its
 * longest edge spans {@link DEFAULT_LONGEST_EDGE_CELLS} cells at the given
 * grid level, aspect preserved, centered on `(centerCellX, centerCellY)`.
 * Returns float L0 cell coords — the caller can snap to the grid if desired.
 */
export function placementBbox(
  pixelWidth: number,
  pixelHeight: number,
  centerCellX: number,
  centerCellY: number,
  gridLevel: number = 0,
): { cellX: number; cellY: number; cellWidth: number; cellHeight: number } {
  const longest = Math.max(pixelWidth, pixelHeight);
  const l0Step = compSnapStep(gridLevel);
  const longestCells = DEFAULT_LONGEST_EDGE_CELLS * l0Step;
  const cellsPerPx = longestCells / longest;
  const cellWidth = pixelWidth * cellsPerPx;
  const cellHeight = pixelHeight * cellsPerPx;
  return {
    cellX: centerCellX - cellWidth / 2,
    cellY: centerCellY - cellHeight / 2,
    cellWidth,
    cellHeight,
  };
}

/** Result of {@link prepareImageReplacement}: a fresh blob key + the full,
 *  downsampled bytes and their intrinsic dimensions. Carries no bbox —
 *  replacement keeps the target node's existing box and cover-fits the whole
 *  bitmap into it (via the node's Fill framing), so nothing is discarded. */
export interface ImageReplacementResult {
  imageId: string;
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg';
  pixelWidth: number;
  pixelHeight: number;
  /** Full-resolution copy for export; present only when the source exceeded
   *  the display cap. Register under `originalImageId` in `imageBlobs`. */
  originalImageId?: string;
  originalBytes?: Uint8Array;
}

/**
 * Replacement import pipeline: decode the picked file, downsample its longest
 * edge to at most {@link MAX_EDGE_PX}, and re-encode — the SAME decode path as
 * a fresh import, minus the bbox. The FULL bitmap is kept (no crop baked into
 * the bytes); the caller keeps the node's box and sets a Fill framing so the
 * whole image cover-fits it, with the overflow clipped non-destructively. That
 * way Crop mode's Fit/Fill can still reach the pixels outside the visible box —
 * the bug where a landscape photo dropped into a portrait slot lost the sides.
 *
 * Throws if decoding fails (corrupt / unsupported file).
 */
export async function prepareImageReplacement(
  rawBytes: Uint8Array,
  sourceMimeType: string,
): Promise<ImageReplacementResult> {
  const sourceBlob = new Blob([rawBytes as BlobPart], { type: importSourceType(rawBytes, sourceMimeType) });
  const original = await prepareScaledEncoding(sourceBlob, ORIGINAL_MAX_EDGE_PX);
  const needsSeparateOriginal =
    Math.max(original.width, original.height) > MAX_EDGE_PX;
  const display = needsSeparateOriginal
    ? await prepareScaledEncoding(sourceBlob, MAX_EDGE_PX, original.hasAlpha)
    : original;
  const result: ImageReplacementResult = {
    imageId: mintImageId(),
    bytes: display.bytes,
    mimeType: display.mimeType,
    pixelWidth: display.width,
    pixelHeight: display.height,
  };
  if (needsSeparateOriginal) {
    result.originalImageId = mintImageId();
    result.originalBytes = original.bytes;
  }
  return result;
}

/**
 * The full import pipeline. Pass the raw bytes from the file picker plus
 * the desired placement center (in L0 cells); receive back an
 * `ImageObject` and the downsampled byte payload to register in
 * `state.imageBlobs`.
 *
 * `gridLevel` controls the placement size: the image's longest edge spans
 * {@link DEFAULT_LONGEST_EDGE_CELLS} cells at the given grid level. Defaults
 * to L0 when omitted.
 *
 * Throws if decoding fails (corrupt file, unsupported format) — callers
 * should surface that to the user as "couldn't import this image".
 */
export async function prepareImageImport(
  rawBytes: Uint8Array,
  sourceMimeType: string,
  centerCellX: number,
  centerCellY: number,
  name?: string,
  gridLevel?: number,
): Promise<ImageImportResult> {
  const sourceBlob = new Blob([rawBytes as BlobPart], { type: importSourceType(rawBytes, sourceMimeType) });
  // Encode the export-quality original first, then the display copy. When the
  // source already fits the display cap the two are identical, so we skip the
  // second decode and store no separate original. The display copy is pinned
  // to the original's alpha decision so their mime types can't diverge.
  const original = await prepareScaledEncoding(sourceBlob, ORIGINAL_MAX_EDGE_PX);
  const needsSeparateOriginal =
    Math.max(original.width, original.height) > MAX_EDGE_PX;
  const display = needsSeparateOriginal
    ? await prepareScaledEncoding(sourceBlob, MAX_EDGE_PX, original.hasAlpha)
    : original;

  const bbox = placementBbox(display.width, display.height, centerCellX, centerCellY, gridLevel ?? 0);
  const image: ImageObject = {
    id: mintImageNodeId(),
    name,
    imageId: mintImageId(),
    mimeType: display.mimeType,
    pixelWidth: display.width,
    pixelHeight: display.height,
    cellX: bbox.cellX,
    cellY: bbox.cellY,
    cellWidth: bbox.cellWidth,
    cellHeight: bbox.cellHeight,
  };
  if (!needsSeparateOriginal) {
    return { image, bytes: display.bytes };
  }
  image.originalImageId = mintImageId();
  return { image, bytes: display.bytes, originalBytes: original.bytes };
}

/** The type the import pipeline treats a picked file's bytes as: the caller's
 *  mime, upgraded to {@link SVG_MIME_TYPE} when the file is an SVG the
 *  platform mislabelled or left untyped (see looksLikeSvg). The blob HAS to
 *  carry the SVG type for the decode to route through rasterizeSvg — and for
 *  the `Image` element inside it to render the markup at all. */
function importSourceType(rawBytes: Uint8Array, sourceMimeType: string): string {
  return looksLikeSvg(rawBytes, sourceMimeType) ? SVG_MIME_TYPE : sourceMimeType;
}

/** Sniff a filename to decide whether to route through the image-import
 *  pipeline (vs. the JSON figure-set import). Returns the canonical MIME
 *  type when matched, or null otherwise. */
export function detectImageMimeType(filename: string): 'image/png' | 'image/jpeg' | 'image/svg+xml' | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.svg')) return SVG_MIME_TYPE;
  return null;
}
