import { CompositionFigure } from './types';
import { loadCompositionState, loadFileStateLite, loadClipBox } from './persistence';
import { loadBakedFigurePng } from './bake';
import { encodePNG, toBase64 } from './pngcodec';
import { rasterizeSvgToPixels } from './svgRasterize';
import {
  generateCompositionSVGCore,
  type CompositionFigureLoadResult,
  type CompositionSVGInputs,
} from './compositionSVGCore';

// Re-export the pure core + its public types so existing callers that
// `import { generateCompositionSVGCore } from './compositionExport'`
// keep working. The actual implementation lives in compositionSVGCore.ts,
// kept pure so Node-side tooling can call it without dragging in
// IndexedDB / WebGL / react-native.
export { generateCompositionSVGCore };
export type { CompositionFigureLoadResult, CompositionSVGInputs };

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
 * Export a composition as a PNG data URI.
 * Generates SVG via exportCompositionSVG, then rasterizes to pixels
 * at the correct aspect ratio fitting within maxDimension.
 */
export async function exportCompositionPNG(
  compId: string,
  maxDimension: number,
  strokeScale?: number,
): Promise<string | null> {
  const svg = await exportCompositionSVG(compId, undefined, strokeScale);
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

  const pixels = await rasterizeSvgToPixels(svg, width, height);
  if (!pixels) return null;

  const pngBytes = encodePNG(pixels, width, height);
  const base64 = toBase64(pngBytes);
  return `data:image/png;base64,${base64}`;
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
): Promise<string | null> {
  const partial = await loadCompositionState(compId);
  if (!partial) return null;
  return generateCompositionSVGCore({
    name: partial.name ?? 'composition',
    figures: partial.figures ?? [],
    svgObjects: partial.svgObjects ?? [],
    images: partial.images ?? [],
    imageBlobs: partial.imageBlobs ?? {},
    groups: partial.groups ?? [],
    sceneOrder: partial.sceneOrder,
    strokeScale: strokeScale ?? partial.strokeScale,
    loadFigure: async (fileId) => {
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
    },
    loadBakedFigurePng: loadFigurePngDataUri,
  }, cancelled);
}
