import storage from './storage';
import { Layer, FileConfig } from './types';
import { saveCompositionThumbnail } from './persistence';
import { exportCompositionSVG } from './compositionExport';
import { exportToSVG, multiplyStrokeWidths, SVG_STROKE_WIDTH, SVG_UNITS_PER_L0_CELL } from './svgExport';
import { strokeScaleForUnits } from './svgStroke';
import { rasterizeSvgToPixels } from './svgRasterize';
import { isPaintingActive, onPaintingEnd } from './loadTile';
import { getThumbnailLineWidth } from './thumbnailLineWidthStore';
import { BG_BLACK } from './colors';

const THUMB_SIZE = 256;

/** Per-file generation counters for cancellation */
const generationMap = new Map<string, number>();

/** Yield to the event loop — 8ms gives touch events time to process */
function yieldTick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 8));
}

/** Check if this generation is still current for the given fileId */
function isCurrent(fileId: string, gen: number): boolean {
  return generationMap.get(fileId) === gen;
}

export { encodePNG, toBase64 } from './pngcodec';
import { encodePNG, toBase64 } from './pngcodec';

/**
 * Shared SVG-to-thumbnail pipeline.
 * Thickens strokes, fits within maxSize preserving aspect ratio, rasterizes via GPU, and encodes to a data URI.
 */
export async function svgToThumbnailDataUri(
  svg: string,
  contentW: number,
  contentH: number,
  maxSize: number,
  cancelled: () => boolean,
  isCompositionThumbnail: boolean = false,
  /** Composition `strokeScale` value (the user's Line Width setting,
   *  v4+ semantics: a multiple of STROKE_SCALE_CELLS world cells). When
   *  provided, the stroke multiplier targets the *line* stroke width rather
   *  than the max baked into the SVG. This is
   *  invariant under "scale content and strokeScale proportionally", so
   *  a tiny composition with a tiny stroke renders at the same apparent
   *  thumbnail thickness as a full-scale composition with the default
   *  stroke. Without it, figure-sprite strokes (pre-compensated by
   *  `strokeScale / geomScale` for placement scale) dominate the MAX
   *  and squash the line strokes to invisibility. */
  baseStrokeScale?: number,
): Promise<string | null> {
  // Compute thumbnail pixel dimensions preserving aspect ratio
  const aspect = contentW / contentH;
  let thumbW: number;
  let thumbH: number;
  if (aspect >= 1) {
    thumbW = maxSize;
    thumbH = Math.max(1, Math.round(maxSize / aspect));
  } else {
    thumbW = Math.max(1, Math.round(maxSize * aspect));
    thumbH = maxSize;
  }

  // Parse viewBox to get SVG coordinate-space width
  const vbMatch = svg.match(/viewBox="([^"]*)"/);
  let svgCoordW = contentW;
  if (vbMatch) {
    const parts = vbMatch[1].split(/\s+/);
    svgCoordW = parseFloat(parts[2]);
  }

  // Dynamic stroke multiplier: target a constant thumbnail stroke width
  // for the *line* stroke baseline (the width an object with no stroke block
  // exports at, from the user's Line Width setting). Picking the baseline this way
  // is invariant under "scale content and strokeScale together" — a
  // small-bbox composition with a small strokeScale renders at the same
  // apparent thumbnail thickness as a full-bbox composition with a
  // proportionally larger strokeScale, because content shrinks but
  // rasterScale grows in lockstep.
  //
  // Why not MAX(stroke-width) in the SVG: figure-sprite strokes are
  // pre-multiplied by `strokeScale / geomScale` inside `buildFigureSVGContent`
  // to compensate for placement-scale (so a tiny placed figure renders
  // its strokes at the same VISUAL thickness as a full-size one). That
  // makes their SVG-unit values much larger than line strokes for small
  // figures, which would dominate MAX and squash the line strokes to
  // near-zero. Targeting the baseline strokeScale avoids this.
  //
  // For non-composition thumbnails (figure thumbnails) we fall back to
  // the MAX-based formula since there's no baseStrokeScale to reference.
  const rasterScale = thumbW / svgCoordW;
  // Composition thumbnails use the user-tunable target stroke width
  // (Settings → "Thumbnail Line Width"). Figure thumbnails keep their
  // fixed target since their callers don't expose a setting.
  const TARGET_PX = isCompositionThumbnail ? getThumbnailLineWidth() : 2.5;

  let strokeMultiplier = 1;
  if (isCompositionThumbnail && baseStrokeScale != null && baseStrokeScale > 0) {
    // Line stroke in SVG units — the width generateCompositionSVGCore actually
    // emitted for an object with no stroke block, so it has to be read from
    // the same helper the exporter uses rather than restated as a literal.
    const baseSw = SVG_STROKE_WIDTH
      * strokeScaleForUnits(baseStrokeScale, SVG_UNITS_PER_L0_CELL);
    if (rasterScale > 0) strokeMultiplier = TARGET_PX / (baseSw * rasterScale);
  } else {
    const swMatches = svg.match(/stroke-width="([^"]+)"/g) ?? [];
    let maxSw = 0;
    for (const m of swMatches) {
      const v = parseFloat(m.slice('stroke-width="'.length, -1));
      if (Number.isFinite(v) && v > maxSw) maxSw = v;
    }
    if (maxSw > 0 && rasterScale > 0) {
      strokeMultiplier = TARGET_PX / (maxSw * rasterScale);
    }
  }
  svg = multiplyStrokeWidths(svg, strokeMultiplier);

  // Expand the outer viewBox by half the post-multiplier max stroke width
  // so strokes hugging the content bbox aren't clipped at the SVG edge.
  // The editor renderer naturally allows strokes to spill past bbox edges
  // because it draws into an unbounded canvas; the SVG export's tight
  // bbox-sized viewBox doesn't, hence "cut off at the rect boundary" in
  // thumbnails. Re-scan stroke widths now that the multiplier has been
  // applied so the padding covers whatever post-multiplier stroke is
  // largest (figure compensation can make these much larger than the
  // line baseline, and we'd rather over-pad slightly than clip).
  const postSwMatches = svg.match(/stroke-width="([^"]+)"/g) ?? [];
  let postMaxSw = 0;
  for (const m of postSwMatches) {
    const v = parseFloat(m.slice('stroke-width="'.length, -1));
    if (Number.isFinite(v) && v > postMaxSw) postMaxSw = v;
  }
  const pad = postMaxSw / 2;
  const vbMatchForPad = svg.match(/viewBox="([^"]*)"/);
  if (vbMatchForPad && pad > 0) {
    const [vbX, vbY, vbW, vbH] = vbMatchForPad[1].split(/\s+/).map(parseFloat);
    const newVbX = vbX - pad;
    const newVbY = vbY - pad;
    const newVbW = vbW + 2 * pad;
    const newVbH = vbH + 2 * pad;
    svg = svg.replace(
      /viewBox="[^"]*"/,
      `viewBox="${newVbX} ${newVbY} ${newVbW} ${newVbH}"`,
    );
  }

  // Override SVG width/height to thumbnail pixel size
  svg = svg.replace(
    /(<svg\s[^>]*?)width="[^"]*"\s*height="[^"]*"/,
    `$1width="${thumbW}" height="${thumbH}"`,
  );

  // Composition thumbnails: inject an opaque background rect so the
  // PNG isn't transparent. Without it, the default white-stroke content
  // (figures + default-color SVG paths) rasterizes to white pixels on a
  // transparent canvas, which looks "completely black" when displayed on
  // the dark UI thumbnail tile. The background matches the editor canvas
  // (BG_BLACK) so the thumbnail reads as a miniature of the editor view.
  // Uses the padded viewBox so the background fills the full rasterized canvas.
  if (isCompositionThumbnail) {
    const vbForBg = svg.match(/viewBox="([^"]*)"/);
    if (vbForBg) {
      const [vbX, vbY, vbW, vbH] = vbForBg[1].split(/\s+/).map(parseFloat);
      const bgRect = `<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="${BG_BLACK}"/>`;
      // Inject right after the opening <svg ...> tag.
      svg = svg.replace(/(<svg\s[^>]*?>)/, `$1${bgRect}`);
    }
  }

  await yieldTick();
  if (cancelled()) return null;

  // Rasterize SVG to pixels via GPU
  const pixels = await rasterizeSvgToPixels(svg, thumbW, thumbH);
  if (!pixels || cancelled()) return null;

  await yieldTick();
  if (cancelled()) return null;

  // Encode PNG and produce data URI
  const pngBytes = encodePNG(pixels, thumbW, thumbH);
  const base64 = toBase64(pngBytes);
  return `data:image/png;base64,${base64}`;
}

// ── Thumbnail event listeners ───────────────────────────────────────────

type ThumbnailListener = (fileId: string, dataUri: string) => void;
const thumbnailListeners = new Set<ThumbnailListener>();

export function onThumbnailReady(cb: ThumbnailListener): void {
  thumbnailListeners.add(cb);
}

export function offThumbnailReady(cb: ThumbnailListener): void {
  thumbnailListeners.delete(cb);
}

function notifyThumbnailListeners(fileId: string, dataUri: string): void {
  for (const cb of thumbnailListeners) cb(fileId, dataUri);
}

// ── Retry-on-painting-end ───────────────────────────────────────────────

const pendingThumbnailRetry = new Set<string>();

function scheduleThumbnailRetry(fileId: string, layers: Layer[], fileConfig: FileConfig): void {
  if (pendingThumbnailRetry.has(fileId)) return;
  pendingThumbnailRetry.add(fileId);
  onPaintingEnd(() => {
    pendingThumbnailRetry.delete(fileId);
    generateThumbnail(fileId, layers, fileConfig);
  });
}

// ── Public API ──────────────────────────────────────────────────────────

export function generateThumbnail(fileId: string, layers: Layer[], fileConfig: FileConfig): Promise<void> {
  const gen = (generationMap.get(fileId) ?? 0) + 1;
  generationMap.set(fileId, gen);

  const hasVisible = layers.some(l => l.visible);

  if (!hasVisible) {
    // No visible layers — remove any existing thumbnail
    return storage.removeItem(`thumb_${fileId}`).catch(() => {});
  }

  // Defer if a paint stroke is active — retry automatically when stroke ends
  if (isPaintingActive()) {
    scheduleThumbnailRetry(fileId, layers, fileConfig);
    return Promise.resolve();
  }

  const fw = fileConfig.widthL0 ?? 32;
  const fh = fileConfig.heightL0 ?? 32;

  let abortedByPainting = false;

  return (async () => {
    // Pass full layers array — exportToSVG filters visible internally,
    // and the one-entry cache can match bakeFile's Phase 7 call.
    const svg = exportToSVG(layers, fileConfig);

    await yieldTick();
    if (!isCurrent(fileId, gen)) return;
    if (isPaintingActive()) { abortedByPainting = true; return; }

    const dataUri = await svgToThumbnailDataUri(
      svg, fw, fh, THUMB_SIZE,
      () => {
        if (!isCurrent(fileId, gen)) return true;
        if (isPaintingActive()) { abortedByPainting = true; return true; }
        return false;
      },
    );
    if (!dataUri || !isCurrent(fileId, gen)) return;

    await storage.setItem(`thumb_${fileId}`, dataUri);
    notifyThumbnailListeners(fileId, dataUri);
  })().catch(() => {}).finally(() => {
    if (abortedByPainting && isCurrent(fileId, gen)) {
      scheduleThumbnailRetry(fileId, layers, fileConfig);
    }
  });
}

// ── Composition Thumbnail ────────────────────────────────────────────────

// 256 px keeps per-thumbnail base64 strings near ~500 KB. A 512 px thumbnail
// produced >2 MB data URIs, which Hermes retains as UTF-16 (~4 MB heap each)
// for every composition held by the gallery screen.
const COMP_THUMB_SIZE = 256;

/** Per-composition generation counters for cancellation */
const compGenerationMap = new Map<string, number>();

function isCompCurrent(compId: string, gen: number): boolean {
  return compGenerationMap.get(compId) === gen;
}

/**
 * Generate a thumbnail for a composition using the SVG export pipeline.
 * Stroke widths are multiplied so thin lines remain visible at thumbnail scale.
 * The thumbnail aspect ratio matches the content bounding box so the preview
 * tightly frames the design on all devices.
 * Async and non-blocking — should be called via setTimeout(0) from the save path.
 */
export async function generateCompositionThumbnail(
  compId: string,
): Promise<void> {
  const gen = (compGenerationMap.get(compId) ?? 0) + 1;
  compGenerationMap.set(compId, gen);

  // Load the composition partial alongside the SVG so the thumbnail
  // pipeline can target the user's strokeScale for its stroke multiplier.
  // Without this, the multiplier falls back to MAX(stroke-width) which is
  // dominated by figure-sprite strokes (pre-compensated for placement
  // scale) and squashes line strokes to invisibility for small-scale
  // compositions.
  const { loadCompositionState } = await import('./persistence');
  const partial = await loadCompositionState(compId);
  const baseStrokeScale = partial?.strokeScale;

  // Export composition as SVG (loads state from persistence)
  const svg = await exportCompositionSVG(compId, () => !isCompCurrent(compId, gen));
  if (!svg || !isCompCurrent(compId, gen)) return;

  // Derive content dimensions from the SVG's viewBox (tight bounding box)
  let contentW: number, contentH: number;
  const vbMatch = svg.match(/viewBox="([^"]*)"/);
  if (vbMatch) {
    const parts = vbMatch[1].split(/\s+/);
    contentW = parseFloat(parts[2]);
    contentH = parseFloat(parts[3]);
  } else {
    const wMatch = svg.match(/\bwidth="([^"]*)"/);
    const hMatch = svg.match(/\bheight="([^"]*)"/);
    contentW = wMatch ? parseFloat(wMatch[1]) : 256;
    contentH = hMatch ? parseFloat(hMatch[1]) : 256;
  }

  await yieldTick();
  if (!isCompCurrent(compId, gen)) return;

  const dataUri = await svgToThumbnailDataUri(
    svg, contentW, contentH, COMP_THUMB_SIZE,
    () => !isCompCurrent(compId, gen),
    true,
    baseStrokeScale,
  );
  if (!dataUri || !isCompCurrent(compId, gen)) return;

  await saveCompositionThumbnail(compId, dataUri);
}
