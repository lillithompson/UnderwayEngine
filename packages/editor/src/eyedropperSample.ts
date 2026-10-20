import {
  generateCompositionSVGCore,
  getDefaultSVGFontResolver,
  storageFigureLoader,
  storageFigurePngLoader,
} from '@/engine/compositionExport';
import { sampleColorFromScene } from '@/engine/eyedropperSampler';
import { sampleSnapshot, type EyedropperSnapshot } from '@/engine/eyedropperSnapshot';
import { rasterizeSvgToPixels } from '@/engine/svgRasterize';
import { SVG_UNITS_PER_L0_CELL } from '@/engine/svgExport';
import type { CompositionState, Paint, RGBColor } from '@/engine/types';

// What the eyedropper samples.
//
// The editor's canvas is DOM, not GL (the WebGL layer draws only the grid), so
// there are no framebuffer pixels to read back — engine `sampleColorFromGL` and
// `captureEyedropperSnapshot` both assume Facet's layout and neither fits here.
// What this canvas DOES have is an exact renderer of its own state: the SVG
// export core, which draws photos, gradient fills, tints, effects and text the
// same way the canvas does. So the snapshot is that SVG, rasterized once when
// the eyedropper arms, and a sample is a pixel read out of it.
//
// The snapshot is in WORLD space, not screen space: its viewBox is the export's
// content/page box in SVG units (`SVG_UNITS_PER_L0_CELL` per world cell), so a
// sample is located by world cell and the result does not change when the
// camera pans or zooms under it.
//
// Cost: one rasterization per arming (bounded by SNAPSHOT_MAX_PX on the long
// edge — ~4 MB of pixels at the cap) and one released copy per disarm. Dragging
// the loupe costs a single array read per move, so the drag itself stays free.

/** Long edge of the rasterized snapshot, in px. The loupe reads one pixel, so
 *  this only bounds sampling RESOLUTION: 1024 px across a page is finer than a
 *  finger can aim at 1× zoom, and it keeps the buffer near 4 MB. */
export const SNAPSHOT_MAX_PX = 1024;

/** A rasterized composition plus the world→pixel mapping to sample it by. */
export interface CanvasSnapshot extends EyedropperSnapshot {
  /** The SVG viewBox the pixels cover, in SVG units (cell × SVG_UNITS_PER_L0_CELL). */
  viewBox: { x: number; y: number; width: number; height: number };
}

/** Parse the `viewBox` of an SVG document string. Null when it has none (or an
 *  unparseable one), which is the caller's cue that the snapshot is unusable —
 *  without the box there is no way to place a world cell in the pixels. */
export function parseSvgViewBox(
  svg: string,
): { x: number; y: number; width: number; height: number } | null {
  const m = svg.match(/\bviewBox="([-\d.eE+\s]+)"/);
  if (!m) return null;
  const parts = m[1].trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x, y, width, height] = parts;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/** Where a world cell lands in the snapshot's pixel grid. Fractional; the
 *  sampler floors it (a sample is the pixel the point is inside). */
export function cellToSnapshotPx(
  snapshot: CanvasSnapshot,
  cellX: number,
  cellY: number,
): { x: number; y: number } {
  const { viewBox: vb } = snapshot;
  return {
    x: ((cellX * SVG_UNITS_PER_L0_CELL) - vb.x) / vb.width * snapshot.width,
    y: ((cellY * SVG_UNITS_PER_L0_CELL) - vb.y) / vb.height * snapshot.height,
  };
}

/** Rasterize the LIVE composition state for sampling. Null when there is
 *  nothing drawn (an empty page), when the raster fails, or when the SVG
 *  carries no usable viewBox — every one of which the caller answers the same
 *  way: fall back to {@link sampleEditorColor}'s scene-graph path.
 *
 *  Takes state rather than a composition id on purpose: the eyedropper has to
 *  see unsaved edits, which a stored-record export would miss. */
export async function captureCanvasSnapshot(
  state: CompositionState,
  maxDimension: number = SNAPSHOT_MAX_PX,
): Promise<CanvasSnapshot | null> {
  const svg = await generateCompositionSVGCore({
    name: state.name || 'composition',
    figures: state.figures,
    svgObjects: state.svgObjects,
    images: state.images ?? [],
    imageBlobs: state.imageBlobs ?? {},
    texts: state.texts ?? [],
    background: state.background,
    paintObjects: state.paintObjects,
    patternObjects: state.patternObjects,
    groups: state.groups ?? [],
    sceneOrder: state.sceneOrder,
    // The live graph, not a rebuild off the arrays. This is the one export
    // whose state has been transformed since it was last saved, so it is
    // the one whose arrays are only the graph's approximation of itself —
    // handing over the arrays alone is handing over the approximation.
    graph: state.graph,
    strokeScale: state.strokeScale,
    // The app's registered export fonts (registerExportFonts at editor mount),
    // read through the engine rather than imported: a glyph rasterized in a
    // fallback face sits in slightly different pixels than the one on screen.
    fontResolver: getDefaultSVGFontResolver(),
    loadFigure: storageFigureLoader,
    loadBakedFigurePng: storageFigurePngLoader,
  });
  if (!svg) return null;

  const viewBox = parseSvgViewBox(svg);
  if (!viewBox) return null;

  // Fit the long edge to the cap, preserving the viewBox aspect so a cell maps
  // to the same pixel size on both axes.
  const long = Math.max(viewBox.width, viewBox.height);
  const scale = maxDimension / long;
  const width = Math.max(1, Math.round(viewBox.width * scale));
  const height = Math.max(1, Math.round(viewBox.height * scale));

  const pixels = await rasterizeSvgToPixels(svg, width, height);
  if (!pixels) return null;
  return { pixels, width, height, viewBox };
}

/** The color a solid paint shows. Gradients have no single color, so the
 *  background fallback only answers for solids — a gradient page falls through
 *  to the snapshot, which drew the gradient properly. */
function solidPaintColor(paint: Paint | undefined): RGBColor | null {
  return paint && paint.kind === 'solid' ? paint.color : null;
}

/**
 * The color under a world cell: the rasterized pixel when the snapshot has one
 * (i.e. something is drawn there), else the scene graph's answer, else the
 * page's own background.
 *
 * The scene-graph path is not just a fallback for a failed raster — it is what
 * answers while the first raster is still in flight, so the loupe shows a real
 * color the moment it appears. It hit-tests the same `findSceneObjectAtCell`
 * the canvas tap uses, so what the loupe reports is the object a tap there
 * would select.
 *
 * Null means "nothing to sample here" (empty canvas, no background): the caller
 * keeps whatever color it last had rather than committing a color the user
 * never pointed at.
 */
export function sampleEditorColor(
  state: CompositionState,
  snapshot: CanvasSnapshot | null,
  cellX: number,
  cellY: number,
): RGBColor | null {
  if (snapshot) {
    const { x, y } = cellToSnapshotPx(snapshot, cellX, cellY);
    // Transparent / out-of-bounds reads null here, and fall through: the
    // snapshot is framed on the CONTENT, so a point outside it is page, not a
    // hole in the drawing.
    const hit = sampleSnapshot(snapshot, x, y);
    if (hit) return hit;
  }

  const scene = sampleColorFromScene(state, cellX, cellY);
  if (scene.color) return scene.color;

  return solidPaintColor(state.background);
}
