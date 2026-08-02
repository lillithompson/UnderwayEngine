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

/** Size (in frame units) of the FULL bitmap when cover-scaled to fill a
 *  `frameW×frameH` frame and then enlarged by `scale` (≥1, from zoom or the
 *  straighten cover factor). The result overflows the frame on its loose axis —
 *  that overflow is exactly the slack a pan can travel into. */
export function coverDrawSize(
  frameW: number,
  frameH: number,
  imageAspect: number,
  scale: number,
): { w: number; h: number } {
  const aspect = imageAspect > 0 ? imageAspect : (frameH > 0 ? frameW / frameH : 1);
  // Cover: the smallest uniform scale of the bitmap (natural size aspect×1)
  // that still covers the frame, times the requested extra `scale`.
  const coverS = Math.max(frameW / aspect, frameH) * Math.max(scale, 0);
  return { w: aspect * coverS, h: coverS };
}

/** Clamp a Fill/Crop pan offset so the cover-scaled bitmap still fully covers
 *  the frame — the offset can never drag an empty edge into view. Range per
 *  axis is ±half the overflow, so a tight axis (no overflow) can't pan at all.
 *  Same units as `frameW`/`offsetX`. Used by both the render and the commit so
 *  the stored offset and the drawn one agree. */
export function clampPanOffset(
  frameW: number,
  frameH: number,
  imageAspect: number,
  scale: number,
  offsetX: number,
  offsetY: number,
): { offsetX: number; offsetY: number } {
  const { w, h } = coverDrawSize(frameW, frameH, imageAspect, scale);
  const rx = Math.max(0, (w - frameW) / 2);
  const ry = Math.max(0, (h - frameH) / 2);
  // `|| 0` folds a clamped -0 (from a tight axis) back to +0 so callers store a
  // clean zero, not negative zero.
  return { offsetX: clamp(offsetX, -rx, rx) || 0, offsetY: clamp(offsetY, -ry, ry) || 0 };
}

/** The rectangle (in frame-local units) the FULL bitmap is drawn into for
 *  Fill/Crop, sized to the cover-scaled bitmap (so it overflows the frame) and
 *  positioned centered + panned by the offset (clamped so the frame stays
 *  covered). Callers clip it to the frame [0,0,frameW,frameH] and draw the
 *  bitmap at this exact aspect (no further crop). At offset 0 the visible region
 *  is the centered cover crop — identical to the old frame-sized cover box, so
 *  existing offset-0 framings render byte-for-byte the same; a nonzero offset
 *  slides the crop across the bitmap to reveal any part of it. */
export function coverImageRect(
  frameW: number,
  frameH: number,
  imageAspect: number,
  scale: number,
  offsetX = 0,
  offsetY = 0,
): { x: number; y: number; w: number; h: number } {
  const { w, h } = coverDrawSize(frameW, frameH, imageAspect, scale);
  const off = clampPanOffset(frameW, frameH, imageAspect, scale, offsetX, offsetY);
  return {
    x: (frameW - w) / 2 + off.offsetX,
    y: (frameH - h) / 2 + off.offsetY,
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
