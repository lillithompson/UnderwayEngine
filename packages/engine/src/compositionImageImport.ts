import { ImageObject } from './types';
import { compSnapStep } from './compositionCellMath';

/**
 * Reference-image import pipeline. Decodes a picked PNG/JPG, downsamples
 * its longest edge to {@link MAX_EDGE_PX}, re-encodes the bytes (PNG when
 * the source had alpha, JPEG otherwise), and produces a fresh
 * `ImageObject` placed at the given cell + sized so its longest edge
 * spans {@link DEFAULT_LONGEST_EDGE_CELLS} cells at the active grid level
 * while preserving the source aspect.
 *
 * The cap exists because the editor's WebView decodes one bitmap per
 * unique data URI and we want each decoded bitmap to stay well under
 * the 16 MB IOSurface budget on iOS (1024² × 4 bytes = ~4 MB). Tuning
 * this number is the only knob users get for image quality vs. memory.
 */
export const MAX_EDGE_PX = 1024;

/** Default placement size (in grid-level cells) along the image's longest
 *  edge. Converted to L0 cells at import time via the active grid level.
 *  Eight cells matches the figure-default footprint so the image lands
 *  at a comfortable size relative to the working grid. */
export const DEFAULT_LONGEST_EDGE_CELLS = 8;

/** JPEG quality used when re-encoding a downsampled non-alpha image.
 *  0.9 is the sweet spot — visual artifacts vanish while bytes are
 *  ~3x smaller than PNG for photographic content. */
const JPEG_QUALITY = 0.9;

/** Result returned by {@link prepareImageImport}: bytes ready for
 *  `state.imageBlobs` and an `ImageObject` ready for `state.images`. */
export interface ImageImportResult {
  image: ImageObject;
  bytes: Uint8Array;
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
): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
  // First decode at native resolution so we can read intrinsic dims
  // and decide the resize ratio. Skipping this step (decoding directly
  // with resizeWidth/Height) means we'd have to know the target
  // dimensions in advance, which we don't.
  const native = await createImageBitmap(blob);
  const longest = Math.max(native.width, native.height);
  if (longest <= MAX_EDGE_PX) {
    return { bitmap: native, width: native.width, height: native.height };
  }
  const scale = MAX_EDGE_PX / longest;
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

/**
 * Center-crop rectangle (in source pixels) that makes a `srcW`×`srcH` bitmap
 * match `targetAspect` (width ÷ height) by COVER: the largest centered
 * sub-rect of that aspect. Used when replacing an image's pixels so the
 * incoming bitmap fills the existing node's box exactly, cropping the
 * overflow rather than letterboxing it. Pure — unit-tested.
 */
export function coverCropRect(
  srcW: number,
  srcH: number,
  targetAspect: number,
): { sx: number; sy: number; sw: number; sh: number } {
  // Degenerate inputs → no crop (caller guards, but stay total).
  if (!(targetAspect > 0) || srcW <= 0 || srcH <= 0) {
    return { sx: 0, sy: 0, sw: Math.max(1, srcW), sh: Math.max(1, srcH) };
  }
  const srcAspect = srcW / srcH;
  if (srcAspect > targetAspect) {
    // Source is too wide for the box → crop the left/right margins.
    const sw = Math.max(1, Math.round(srcH * targetAspect));
    return { sx: Math.round((srcW - sw) / 2), sy: 0, sw, sh: srcH };
  }
  // Source is too tall (or an exact match) → crop the top/bottom margins.
  const sh = Math.max(1, Math.round(srcW / targetAspect));
  return { sx: 0, sy: Math.round((srcH - sh) / 2), sw: srcW, sh };
}

/** Result of {@link prepareImageReplacement}: a fresh blob key + the
 *  cover-cropped, downsampled bytes and their intrinsic dimensions. Carries
 *  no bbox — replacement keeps the target node's existing box. */
export interface ImageReplacementResult {
  imageId: string;
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg';
  pixelWidth: number;
  pixelHeight: number;
}

/**
 * Replacement import pipeline: decode the picked file, cover-crop it to
 * `targetAspect` (the box being replaced), downsample the crop so its
 * longest edge is at most {@link MAX_EDGE_PX}, and re-encode. Because the
 * result already matches the box aspect, the caller keeps the node's bbox
 * unchanged and the new image fills it with the overflow cropped away.
 *
 * Throws if decoding fails (corrupt / unsupported file).
 */
export async function prepareImageReplacement(
  rawBytes: Uint8Array,
  sourceMimeType: string,
  targetAspect: number,
): Promise<ImageReplacementResult> {
  const sourceBlob = new Blob([rawBytes as BlobPart], { type: sourceMimeType });
  const native = await createImageBitmap(sourceBlob);
  const crop = coverCropRect(native.width, native.height, targetAspect);
  // Downsample the CROP (not the full source) so the longest cropped edge
  // lands within the memory budget.
  const longest = Math.max(crop.sw, crop.sh);
  const scale = longest > MAX_EDGE_PX ? MAX_EDGE_PX / longest : 1;
  const dw = Math.max(1, Math.round(crop.sw * scale));
  const dh = Math.max(1, Math.round(crop.sh * scale));
  const canvas = new OffscreenCanvas(dw, dh);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  // Crop + downsample in one draw: source sub-rect → full dest canvas.
  ctx.drawImage(native, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, dw, dh);
  native.close?.();
  const cropped = await createImageBitmap(canvas);
  const hasAlpha = bitmapHasAlpha(cropped);
  const { bytes, mimeType } = await reencodeBitmap(cropped, dw, dh, hasAlpha);
  cropped.close?.();
  return { imageId: mintImageId(), bytes, mimeType, pixelWidth: dw, pixelHeight: dh };
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
  const sourceBlob = new Blob([rawBytes as BlobPart], { type: sourceMimeType });
  const { bitmap, width, height } = await decodeAndDownsample(sourceBlob);
  const hasAlpha = bitmapHasAlpha(bitmap);
  const { bytes, mimeType } = await reencodeBitmap(bitmap, width, height, hasAlpha);
  bitmap.close?.();
  const bbox = placementBbox(width, height, centerCellX, centerCellY, gridLevel ?? 0);
  const image: ImageObject = {
    id: mintImageNodeId(),
    name,
    imageId: mintImageId(),
    mimeType,
    pixelWidth: width,
    pixelHeight: height,
    cellX: bbox.cellX,
    cellY: bbox.cellY,
    cellWidth: bbox.cellWidth,
    cellHeight: bbox.cellHeight,
  };
  return { image, bytes };
}

/** Sniff a filename to decide whether to route through the image-import
 *  pipeline (vs. the JSON figure-set import). Returns the canonical MIME
 *  type when matched, or null otherwise. */
export function detectImageMimeType(filename: string): 'image/png' | 'image/jpeg' | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return null;
}
