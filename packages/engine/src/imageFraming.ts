// Image framing (the "Crop" bar): how an image's bitmap fills its frame
// (bbox). Four modes — Fill (cover + zoom), Fit (contain + margin letterbox),
// Crop (cover + straighten), Tile (repeating). These are PURE geometry helpers
// shared by the DOM preview (NodeLayer) and the SVG export (compositionSVGCore)
// so the two can't drift, and unit-tested in node.
//
// Lengths here (margin, tileGap, offset) are in the same world-cell units as
// the node bbox; zoom is a cover-relative scale (1 = plain cover), angle is in
// degrees, tileScale is a 0–1 relative size. The bar maps its pt/percent ranges
// onto these (see CropBar).

export type ImageFramingMode = 'fill' | 'fit' | 'crop' | 'tile';

/** Crop aspect ratio (drives the on-canvas crop rect; the rect handles are
 *  canvas-side, so today this only records intent). */
export type ImageCropRatio = 'free' | 'square' | 'fourFive' | 'sixteenNine';

/** Per-image framing. All but `mode` are optional so untouched images stay
 *  clean in the JSON; unset fields fall back to {@link FRAMING_DEFAULTS}. */
export interface ImageFraming {
  mode: ImageFramingMode;
  /** Fill zoom: cover-relative scale ≥ 1 (1 = plain cover). Design 100–300%. */
  zoom?: number;
  /** Fit letterbox inset between artwork and frame edge, in world cells. */
  margin?: number;
  /** Crop aspect ratio. */
  ratio?: ImageCropRatio;
  /** Crop straighten angle in degrees, −45…45. */
  angle?: number;
  /** Tile relative size, 0–1 (design 0–100). */
  tileScale?: number;
  /** Tile gap between tiles, in world cells. */
  tileGap?: number;
  /** Pan within the frame, in world cells (Fill/Crop; set on the canvas —
   *  deferred, so 0 for now). */
  offsetX?: number;
  offsetY?: number;
}

/** Defaults mirroring the design's per-mode defaults (Zoom 130%, Margin 14pt =
 *  0.875 cell, Ratio 1:1, Straighten 0°, Size 46, Spacing 6pt = 0.375 cell). */
export const FRAMING_DEFAULTS = {
  zoom: 1.3,
  margin: 0.875,
  ratio: 'square' as ImageCropRatio,
  angle: 0,
  tileScale: 0.46,
  tileGap: 0.375,
  offsetX: 0,
  offsetY: 0,
};

export interface ResolvedFraming {
  mode: ImageFramingMode;
  zoom: number;
  margin: number;
  ratio: ImageCropRatio;
  angle: number;
  tileScale: number;
  tileGap: number;
  offsetX: number;
  offsetY: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

/** Fill unset fields with defaults and clamp to their valid ranges, so both
 *  render paths work from one concrete, sanitized shape. */
export function resolveFraming(f: ImageFraming): ResolvedFraming {
  return {
    mode: f.mode,
    zoom: clamp(f.zoom ?? FRAMING_DEFAULTS.zoom, 1, 3),
    margin: Math.max(0, f.margin ?? FRAMING_DEFAULTS.margin),
    ratio: f.ratio ?? FRAMING_DEFAULTS.ratio,
    angle: clamp(f.angle ?? FRAMING_DEFAULTS.angle, -45, 45),
    tileScale: clamp01(f.tileScale ?? FRAMING_DEFAULTS.tileScale),
    tileGap: Math.max(0, f.tileGap ?? FRAMING_DEFAULTS.tileGap),
    offsetX: f.offsetX ?? 0,
    offsetY: f.offsetY ?? 0,
  };
}

/** The cover rectangle for Fill/Crop: the box the (cover-fit) bitmap is drawn
 *  into, scaled by `scale` about the frame center and panned by the offset.
 *  Callers clip it to the frame [0,0,frameW,frameH] and draw the bitmap with
 *  cover semantics (CSS `object-fit: cover` / SVG `preserveAspectRatio slice`).
 *  At scale 1, offset 0 this is exactly the frame. */
export function coverRect(
  frameW: number,
  frameH: number,
  scale: number,
  offsetX = 0,
  offsetY = 0,
): { x: number; y: number; w: number; h: number } {
  const w = frameW * scale;
  const h = frameH * scale;
  return {
    x: (frameW - w) / 2 + offsetX,
    y: (frameH - h) / 2 + offsetY,
    w,
    h,
  };
}

/** Minimum uniform scale so a cover-fit frame rotated by `angleDeg` still
 *  covers the frame with no empty corners. Derived from the axis-aligned
 *  bounding box of the rotated frame: `|cos| + max(W/H, H/W)·|sin|`. */
export function straightenCoverScale(angleDeg: number, frameW: number, frameH: number): number {
  if (frameW <= 0 || frameH <= 0) return 1;
  const a = (Math.abs(angleDeg) * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  return c + s * Math.max(frameW / frameH, frameH / frameW);
}

// Tile size maps the 0–1 relative scale onto a fraction of the frame width, so
// larger = bigger tiles = fewer of them. Tuned so the design's default (0.46)
// lands ~5 columns across, matching the prototype.
const TILE_MIN_FRAC = 0.06;
const TILE_MAX_FRAC = 0.4;

export interface TileGeometry {
  /** One tile's size in world cells (aspect preserved from the bitmap). */
  tileW: number;
  tileH: number;
  /** Tile pitch (tile + gap). */
  stepX: number;
  stepY: number;
  /** Columns / rows needed to cover the frame (clipped at the edges). */
  cols: number;
  rows: number;
}

/** Tile layout for a `frameW×frameH` frame given the bitmap aspect (w/h), the
 *  relative tile size and the gap. Tiles start at the frame's top-left. */
export function tileGeometry(
  frameW: number,
  frameH: number,
  imageAspect: number,
  tileScale: number,
  tileGap: number,
): TileGeometry {
  const frac = TILE_MIN_FRAC + clamp01(tileScale) * (TILE_MAX_FRAC - TILE_MIN_FRAC);
  const tileW = Math.max(1e-3, frameW * frac);
  const tileH = imageAspect > 0 ? tileW / imageAspect : tileW;
  const gap = Math.max(0, tileGap);
  const stepX = tileW + gap;
  const stepY = tileH + gap;
  return {
    tileW,
    tileH,
    stepX,
    stepY,
    cols: Math.max(1, Math.ceil(frameW / stepX)),
    rows: Math.max(1, Math.ceil(frameH / stepY)),
  };
}

/** The numeric aspect (w/h) a crop ratio resolves to; `free` follows the
 *  frame's own aspect. */
export function cropRatioValue(ratio: ImageCropRatio, frameAspect: number): number {
  switch (ratio) {
    case 'square': return 1;
    case 'fourFive': return 4 / 5;
    case 'sixteenNine': return 16 / 9;
    case 'free':
    default:
      return frameAspect;
  }
}
