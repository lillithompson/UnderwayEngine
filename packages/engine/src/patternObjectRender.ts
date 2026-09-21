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
  RGBColor,
  SVGObject,
  SVGSubpath,
} from './types';
import {
  buildPatternLayerView,
  patternIsEmpty,
  PATTERN_CELL_L0,
} from './patternObject';
import { shapePatternGrid } from './shapePatternFill';
import { exportLayersToSVGInner, SVG_UNITS_PER_L0_CELL } from './svgExport';
import { simplifySVG } from './simplifySVG';
import {
  convertCachedSVGToColoredSegments,
  ColoredSegments,
} from './figureToPaths';
import type { CachedFigureSVG } from './svgFigureBuilders';
import { normalizeClosedSegments } from './compositionArcMath';
import { buildSVGObjectContent, withSVGObjectStrokeColor } from './svgPathBuilder';
import { strokeScaleForUnits } from './svgStroke';

const svgViewCache = new WeakMap<PatternObject, SVGObject | null>();

/**
 * Second-level cache: the BAKE itself, keyed on the `cells` array.
 *
 * The per-object WeakMap above only helps a render that hands back the SAME
 * object. A slider drag doesn't: every preview frame builds `{...p, stroke}`
 * — a fresh object carrying the SAME cells — so the object cache missed on
 * every frame and re-baked a whole 16×16 grid per frame, exactly the
 * per-frame work the note above promises never happens.
 *
 * None of stroke / angleDeg / opacity / hidden / groupId / name feeds the
 * bake; they are applied ON TOP of the finished view (see
 * withPatternPresentation). So the bake is cached against the cells array a
 * presentation-only edit carries forward unchanged, guarded by a key over
 * everything that DOES feed it — a cell edit mints a new cells array, and a
 * resize / rotate / repeat toggle moves the key.
 */
const bakeCache = new WeakMap<
  readonly (import('./types').CellState)[],
  { key: string; view: SVGObject | null }
>();

/** Everything the bake reads, as one comparable string. Presentation fields
 *  are deliberately absent — that omission is the whole point. */
function bakeKey(p: PatternObject): string {
  return [
    p.id, p.cols, p.rows,
    p.cellX, p.cellY, p.cellWidth, p.cellHeight,
    p.rotation ?? 0, p.mirrorH ? 1 : 0, p.mirrorV ? 1 : 0,
    p.tileMode ?? '', p.tileWidthL0 ?? '', p.tileHeightL0 ?? '',
    p.tileOffsetXL0 ?? 0, p.tileOffsetYL0 ?? 0,
  ].join('|');
}

/** The baked view wearing this object's presentation. A shallow copy, so
 *  the shared segment / subpath arrays are never rewritten under a caller
 *  holding an earlier view. */
function withPatternPresentation(base: SVGObject, p: PatternObject): SVGObject {
  const view: SVGObject = { ...base, name: p.name };
  if (p.stroke) view.stroke = p.stroke; else delete view.stroke;
  if (p.angleDeg) view.angleDeg = p.angleDeg; else delete view.angleDeg;
  if (p.opacity != null) view.opacity = p.opacity; else delete view.opacity;
  // The Fade row rides the view too: the mix is applied to the finished
  // SVGObject downstream (`fadedSVGObject`, at every draw site), so a
  // pattern fades through exactly the code every other kind fades through
  // — and the bake beneath it is untouched, which is why the fade costs
  // nothing and the cells come back when the slider does.
  if (p.fade != null) view.fade = p.fade; else delete view.fade;
  if (p.fadeColor != null) view.fadeColor = p.fadeColor; else delete view.fadeColor;
  if (p.hidden) view.hidden = true; else delete view.hidden;
  if (p.groupId) view.groupId = p.groupId; else delete view.groupId;
  return view;
}

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
    { nonScaling: false, paintOverlaySlot: 'canvas' },
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
  const key = bakeKey(p);
  const hit = bakeCache.get(p.cells);
  const baked = hit && hit.key === key ? hit.view : null;
  let view: SVGObject | null;
  if (hit && hit.key === key) {
    view = baked ? withPatternPresentation(baked, p) : null;
  } else {
    view = buildPatternSVGView(p);
    bakeCache.set(p.cells, { key, view });
    view = view ? withPatternPresentation(view, p) : null;
  }
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
  // The presentation fields are NOT set here — this result is cached and
  // shared across every object that bakes the same way, so wearing one
  // object's stroke would hand it to the next. withPatternPresentation
  // dresses a copy, per call. What they are and why they don't bake:
  //   • stroke — width/dash render through svgStrokePresentation's
  //     world-based formula at MARKUP time, in both the flat and the tiled
  //     path, which is what keeps the line weight identical across a
  //     repeat toggle;
  //   • angleDeg — the free angle is applied by the node layer / export at
  //     draw time, same as every bbox kind (the DISCRETE rotation/mirror
  //     is baked into the segments by the figure-placement transform
  //     above, and so is keyed into bakeKey);
  //   • opacity / hidden / groupId / name — scene bookkeeping.
  return view;
}

/**
 * The baked TILES of a closed shape's pattern fill, in the shape's own
 * local space — ready to be clipped to its outline and painted over its
 * solid fill (`shapePatternFillMarkup`). '' when the shape carries no
 * fill, or none of the fill's cells is filled.
 *
 * Here, beside the bake it is one call away from, rather than in
 * shapePatternFill.ts: that module is the grid's, and compositionOps
 * imports it — while this pipeline's imports reach compositionOps, which
 * is the same cycle that put this whole file beside patternObject.ts.
 *
 * `strokeScale` is the composition-wide one, not a unit-converted copy:
 * the markup is drawn in SVG units like every other pattern render site
 * (see {@link patternViewNodeMarkup}), so the tiles inside a shape carry
 * the same world line weight as the tiles in a pattern object beside it.
 * `grow` is the drawn geometry's per-axis stretch (`growX` / `growY`),
 * which the TILE has to be grown by for the same reason a stroke width is
 * — see {@link shapePatternGrid}, which also derives the tiles' own line
 * from the shape's out of the `strokeScale` this passes on.
 */
export function shapePatternFillTiles(
  svg: SVGObject, strokeScale: number, grow?: { gx: number; gy: number },
): string {
  const grid = shapePatternGrid(svg, { ...grow, strokeScale });
  if (!grid) return '';
  const view = patternSVGView(grid);
  if (!view) return '';
  return patternViewNodeMarkup(view, strokeScale);
}

/**
 * One pattern grid as a square data-URI thumbnail, `size` px — what the
 * pattern-fill swatch row shows for each pattern already on the page.
 *
 * The bake, in the grid's own box, wrapped in an `<svg>` whose viewBox is
 * that box: the swatch is the pattern drawn exactly as the canvas draws
 * it, rather than a second rendering of the cells. Null for an empty grid
 * (there is no picture of nothing to offer).
 *
 * Cached on the view the bake already caches, so a row of swatches
 * re-renders without re-encoding: the string is long, and a pattern that
 * has not changed hands back the very same one.
 */
const thumbUris = new WeakMap<SVGObject, Map<string, string>>();

export function patternGridThumbnailUri(
  p: PatternObject, size: number, strokeScale: number = 1, ink?: RGBColor,
): string | null {
  const baked = patternSVGView(p);
  if (!baked) return null;
  // Re-inked when the caller says so: a swatch is CHROME, and the ink a
  // pattern happens to be painted in is not what it is offering (white
  // tiles on a light chip are no swatch at all). The same choice the tile
  // menu's own thumbnails make — buildTileSvgDataUri inks them in the
  // panel's ink — through the engine's one re-ink helper, fills included.
  const view = ink ? withSVGObjectStrokeColor(baked, ink, { floodFills: true }) : baked;
  const key = `${size}|${strokeScale}|${ink ? `${ink.r},${ink.g},${ink.b}` : ''}`;
  let byKey = thumbUris.get(baked);
  const hit = byKey?.get(key);
  if (hit) return hit;
  const u = SVG_UNITS_PER_L0_CELL;
  const w = Math.max(view.cellWidth, 1e-3) * u;
  const h = Math.max(view.cellHeight, 1e-3) * u;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view.cellX * u} ${view.cellY * u} ${w} ${h}"`
    + ` width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" fill="none">`
    + `${patternViewNodeMarkup(view, strokeScale)}</svg>`;
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  if (!byKey) { byKey = new Map(); thumbUris.set(baked, byKey); }
  byKey.set(key, uri);
  return uri;
}
