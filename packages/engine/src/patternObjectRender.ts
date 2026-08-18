/**
 * PatternObject SVG bake: cells → SVG elements (exportLayersToSVGInner)
 * → colored PathSegments (figureToPaths) → a derived SVGObject "view"
 * that the existing render and export paths consume unchanged. In repeat
 * mode the view carries the tileMode fields so
 * buildTiledSVGObjectRegionMarkup repeats the block.
 *
 * Separate from patternObject.ts because this pipeline's import chain
 * (figureToPaths → svgFigureCache → persistence) reaches compositionOps,
 * which itself imports patternObject.ts for op application — folding the
 * bake in there would close an import cycle.
 *
 * PatternObject is immutable-per-edit (every reducer replaces the
 * object), so a WeakMap keyed on the object memoizes the bake: painting
 * re-bakes once per commit, while pan/zoom/move re-renders hit only the
 * cache. A full 16×16 grid bakes in the low milliseconds — tap-frequency
 * work, never per-frame work (the 90 fps rule).
 */

import {
  CompositionFigure,
  FileConfig,
  PatternObject,
  SVGObject,
  SVGSubpath,
} from './types';
import {
  buildPatternLayerView,
  patternIsEmpty,
  PATTERN_CELL_L0,
} from './patternObject';
import { exportLayersToSVGInner, SVG_UNITS_PER_L0_CELL } from './svgExport';
import { simplifySVG } from './simplifySVG';
import {
  convertCachedSVGToColoredSegments,
  ColoredSegments,
} from './figureToPaths';
import type { CachedFigureSVG } from './svgFigureBuilders';
import { normalizeClosedSegments } from './compositionArcMath';
import { buildSVGObjectContent } from './svgPathBuilder';
import { strokeScaleForUnits } from './svgStroke';

const svgViewCache = new WeakMap<PatternObject, SVGObject | null>();

/**
 * The inner markup the DOM node layer mounts for a pattern view — the ONE
 * markup call every pattern render site shares (the node layer, the paint
 * stroke's live preview, its restore path).
 *
 * Strokes are authored in USER-SPACE units in BOTH modes, the exporter's
 * convention, with no `vector-effect`: the tiled (repeat) markup can only
 * stroke in user space, and WKWebView resolves non-scaling strokes against
 * the device CTM — so under camera zoom the DOM layer's usual non-scaling
 * flat strokes sat at a different width than the tiled ones, and toggling
 * repeat visibly changed the line weight. One convention, no jump.
 */
export function patternViewNodeMarkup(view: SVGObject, strokeScale: number): string {
  return buildSVGObjectContent(
    view,
    strokeScaleForUnits(strokeScale, SVG_UNITS_PER_L0_CELL),
    SVG_UNITS_PER_L0_CELL,
    { nonScaling: false },
  );
}

/** Bake the pattern's cells into cached-figure-SVG form (elements in SVG
 *  units, 256 per L0). Returns null when the grid is empty. */
export function bakePatternElements(p: PatternObject): CachedFigureSVG | null {
  if (patternIsEmpty(p)) return null;
  const layer = buildPatternLayerView(p);
  const fileConfig: FileConfig = {
    id: p.id,
    name: p.name ?? '',
    widthL0: p.cols * PATTERN_CELL_L0,
    heightL0: p.rows * PATTERN_CELL_L0,
  };
  const result = exportLayersToSVGInner([layer], fileConfig);
  if (result.elements.length === 0) return null;
  return {
    elements: simplifySVG(result.elements),
    svgWidth: result.widthL0 * SVG_UNITS_PER_L0_CELL,
    svgHeight: result.heightL0 * SVG_UNITS_PER_L0_CELL,
  };
}

/**
 * Derived SVGObject for rendering / export. Null when the pattern has no
 * drawable content — an empty pattern renders as nothing (no fill, no
 * border; hit testing stays bbox-definitive via the geometry adapter).
 *
 * Stretch mode: the cols×rows block is baked into the world bbox (the
 * figure-placement transform applies the discrete rotation/mirror).
 * Repeat mode: one block is baked into the intrinsic tile box anchored at
 * `cellX + tileOffset` (buildTiledSVGObjectRegionMarkup's minX convention,
 * mirroring figureToTiledSVGObject) and the view carries the region bbox
 * plus tile fields.
 */
export function patternSVGView(p: PatternObject): SVGObject | null {
  if (svgViewCache.has(p)) return svgViewCache.get(p) ?? null;
  const view = buildPatternSVGView(p);
  svgViewCache.set(p, view);
  return view;
}

function buildPatternSVGView(p: PatternObject): SVGObject | null {
  const cached = bakePatternElements(p);
  if (!cached) return null;

  const repeat = p.tileMode === 'repeat' && p.tileWidthL0 != null && p.tileHeightL0 != null;
  const offX = p.tileOffsetXL0 ?? 0;
  const offY = p.tileOffsetYL0 ?? 0;
  const bakeBox = repeat
    ? { cellX: p.cellX + offX, cellY: p.cellY + offY, cellWidth: p.tileWidthL0!, cellHeight: p.tileHeightL0! }
    : { cellX: p.cellX, cellY: p.cellY, cellWidth: p.cellWidth, cellHeight: p.cellHeight };

  const bakeFig = {
    id: `${p.id}_bake`,
    figureKey: `pattern_${p.id}`,
    ...bakeBox,
    resolutionX: p.cols,
    resolutionY: p.rows,
    rotation: p.rotation ?? 0,
    mirrorH: p.mirrorH ?? false,
    mirrorV: p.mirrorV ?? false,
  } as CompositionFigure;

  const groups = convertCachedSVGToColoredSegments(cached, bakeFig)
    .filter((g: ColoredSegments) => g.segments.length > 0);
  if (groups.length === 0) return null;
  const allSegments = normalizeClosedSegments(groups.flatMap((g) => g.segments));
  if (allSegments.length === 0) return null;

  const subpaths = groups.map((g) => {
    const sub: SVGSubpath = { segments: g.segments, color: g.color };
    if (g.isFill) sub.fill = true;
    return sub;
  });

  const view: SVGObject = {
    id: p.id,
    name: p.name,
    segments: allSegments,
    color: groups[0].color,
    subpaths,
    cellX: p.cellX,
    cellY: p.cellY,
    cellWidth: p.cellWidth,
    cellHeight: p.cellHeight,
  };
  if (repeat) {
    view.tileMode = 'repeat';
    view.tileWidthL0 = p.tileWidthL0;
    view.tileHeightL0 = p.tileHeightL0;
    if (offX !== 0) view.tileOffsetXL0 = offX;
    if (offY !== 0) view.tileOffsetYL0 = offY;
  }
  // The authored stroke block rides onto the view: width/dash render
  // through svgStrokePresentation's world-based formula in BOTH the flat
  // and the tiled markup, which is what keeps the line weight identical
  // across a repeat toggle.
  if (p.stroke) view.stroke = p.stroke;
  // The discrete rotation/mirror are baked into the segments by the
  // figure-placement transform above; the free angle is applied by the
  // node layer / export at draw time, same as every bbox kind.
  if (p.angleDeg) view.angleDeg = p.angleDeg;
  if (p.opacity != null) view.opacity = p.opacity;
  if (p.hidden) view.hidden = true;
  if (p.groupId) view.groupId = p.groupId;
  return view;
}
