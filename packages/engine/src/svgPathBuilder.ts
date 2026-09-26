import { PathSegment, RGBColor, SVGObject, SVGSubpath } from './types';
import { SVG_UNITS_PER_L0_CELL, SVG_STROKE_WIDTH } from './svgExport';
import {
  computeSweepFlag, arcRadius, chainSegments, closedSegmentLoops, computeSignedArea, reverseSegment,
} from './compositionArcMath';
import { packKey, unpackKey, forEachVisibleTile } from './tileSegmentOverrides';
import { borderDashPattern, innerGlowBandFilter, paintToSvg, scaleEffects } from './paintSvg';
import { tintFillToPaint } from './imageTintFill';
import { shapePatternFillIsEmpty } from './shapePatternFill';
import { PaintOverlaySlot, shapePaintOverlaySVG } from './imagePaintOverlay';
import { svgEndpointsMarkup } from './svgEndpoints';
import {
  roundPathCorners,
  svgDefIdSafe,
  svgStrokeAlignment,
  svgStrokeDefId,
  svgStrokeRadiusCells,
  svgStrokeWidthCells,
  svgStrokeWidthUnits,
} from './svgStroke';

/**
 * Convert an array of PathSegments into an SVG `d` attribute string
 * translated so coordinates are relative to (minX, minY) in L0-cell space.
 * Used for tile-local paths in repeat/pattern rendering.
 */
export function buildTilePathD(
  segments: ReadonlyArray<PathSegment>,
  minX: number,
  minY: number,
): string {
  const u = SVG_UNITS_PER_L0_CELL;
  let d = '';
  let curX = NaN, curY = NaN;
  for (const seg of segments) {
    if (seg.start[0] !== curX || seg.start[1] !== curY) {
      d += `M ${(seg.start[0] - minX) * u},${(seg.start[1] - minY) * u} `;
    }
    if (seg.kind === 'arc') {
      const r = arcRadius(seg) * u;
      const sf = computeSweepFlag(seg.start, seg.end, seg.center);
      d += `A ${r},${r} 0 0,${sf} ${(seg.end[0] - minX) * u},${(seg.end[1] - minY) * u} `;
    } else {
      d += `L ${(seg.end[0] - minX) * u},${(seg.end[1] - minY) * u} `;
    }
    curX = seg.end[0]; curY = seg.end[1];
  }
  return d.trim();
}

/**
 * How {@link buildPathD} maps L0-cell space into the output coordinate
 * system. Must be a similarity transform (uniform scale, no shear), so an
 * arc stays circular and one radius still describes it.
 */
export interface PathProjection {
  /** cell-space point → output-space point. */
  point(x: number, y: number): [number, number];
  /** cell-space length → output-space length. */
  length(v: number): number;
}

/** The default: L0-cell space scaled by SVG_UNITS_PER_L0_CELL, which is what
 *  every SVG-markup caller (export, thumbnails, node layers) wants. */
const SVG_UNIT_PROJECTION: PathProjection = {
  point: (x, y) => [x * SVG_UNITS_PER_L0_CELL, y * SVG_UNITS_PER_L0_CELL],
  length: (v) => v * SVG_UNITS_PER_L0_CELL,
};

/**
 * Convert an array of PathSegments into an SVG `d` attribute string.
 *
 * Coordinates default to L0-cell space scaled by SVG_UNITS_PER_L0_CELL. Pass
 * a `projection` to emit the same path in another space — CozyJournal's
 * editor uses this to draw a live line/arc draft in SCREEN pixels through the
 * camera, rather than keeping a second copy of this walk.
 */
export function buildPathD(
  segments: ReadonlyArray<PathSegment>,
  projection: PathProjection = SVG_UNIT_PROJECTION,
): string {
  let d = '';
  let curX = NaN, curY = NaN;
  for (const seg of segments) {
    if (seg.start[0] !== curX || seg.start[1] !== curY) {
      const [sx, sy] = projection.point(seg.start[0], seg.start[1]);
      d += `M ${sx},${sy} `;
    }
    const [ex, ey] = projection.point(seg.end[0], seg.end[1]);
    if (seg.kind === 'arc') {
      const r = projection.length(arcRadius(seg));
      const sf = computeSweepFlag(seg.start, seg.end, seg.center);
      d += `A ${r},${r} 0 0,${sf} ${ex},${ey} `;
    } else {
      d += `L ${ex},${ey} `;
    }
    curX = seg.end[0];
    curY = seg.end[1];
  }
  return d.trim();
}

/**
 * Build tile-local SVG path element(s) for an SVGObject in repeat mode.
 * Vertices are translated so the content starts at (0,0) relative to
 * obj.cellX/cellY — the canonical origin used by the tile texture
 * rasterizers.
 *
 * Note: no `vector-effect="non-scaling-stroke"`. The rasterizer renders
 * this content inside a `<svg viewBox="0 0 tileW tileH" width="texPx"
 * height="texPx">`, so the natural viewBox→viewport transform scales the
 * stroke to the right canvas-pixel width — matching the figure-tile
 * rasterizer's approach. Adding non-scaling-stroke here would peg the
 * stroke at its raw value in canvas pixels, ignoring viewBox scale, and
 * the on-screen stroke would no longer track the non-tile-mode stroke
 * (which is rendered in the DOM at the same SVG-unit width).
 */
export function buildSVGObjectTileContent(obj: SVGObject, strokeScale: number): string {
  if (obj.segments.length === 0) return '';
  // Use the tile-grid anchor (cellX + tileOffset) as the translation
  // origin. tileOffset compensates for origin-side resizes so
  // cellX + tileOffset is invariant — the tile content stays at a fixed
  // position in the texture regardless of region expansion. Without this,
  // expanding the region up/left shifts content within the tile while the
  // shader's u_tileOffset also compensates, causing double-shift gaps.
  //
  // Note: we use cellX + offset rather than bare cellX because the
  // earlier clip-arc fix (using authoritative bbox origin instead of
  // segment-derived min) is preserved — tileOffset is 0 when the region
  // hasn't been resized, so the behavior is identical for non-resized
  // objects.
  const minX = obj.cellX + (obj.tileOffsetXL0 ?? 0);
  const minY = obj.cellY + (obj.tileOffsetYL0 ?? 0);
  const sw = SVG_STROKE_WIDTH * strokeScale;
  const attrs = `fill="none" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;

  let result = '';

  // Fill path — rendered before strokes so the outline sits on top.
  if (obj.fillColor) {
    const fd = buildTileFillPathD(obj.segments, minX, minY);
    if (fd) {
      const { r, g, b } = obj.fillColor;
      const oa = obj.fillOpacity != null && obj.fillOpacity < 1 ? ` fill-opacity="${obj.fillOpacity}"` : '';
      result += `<path d="${fd}" fill="rgb(${r},${g},${b})"${oa} stroke="none" fill-rule="nonzero" />`;
    }
  }

  if (Array.isArray(obj.subpaths) && obj.subpaths.length > 0) {
    return result + buildSubpathsMarkup(obj.subpaths, attrs, (segs) => buildTilePathD(segs, minX, minY));
  }

  const d = buildTilePathD(obj.segments, minX, minY);
  if (!d) return result;
  const { r: cr, g: cg, b: cb } = obj.color;
  result += `<path d="${d}" ${attrs} stroke="rgb(${cr},${cg},${cb})" />`;
  return result;
}

/**
 * Build the markup for a tiled SVG object EXPANDED into one `<g>` per visible
 * repeated copy, applying sparse per-copy segment color overrides
 * (`obj.segmentOverrides`). Each copy draws the full tile (fill + every
 * segment), with painted segments at their override color and the rest at the
 * base color — so a copy is a self-contained vector redraw (editable in
 * export; opaque-replaces the repeating bitmap in the live overlay).
 *
 * Coordinates are absolute world SVG-units, so the caller wraps the result in
 * the region-clipping `<svg viewBox>` (same as the `<pattern>` path) to clip
 * partial edge copies. Shared by SVG export and the live DOM overlay so the
 * two can't drift. Returns '' when the object has no geometry.
 *
 * Options:
 *  - `onlyPainted`: emit a `<g>` only for copies that have ≥1 override. The
 *    live overlay uses this — the repeating bitmap already draws every copy at
 *    its base color, so only painted copies need a vector redraw on top
 *    (export omits it so the standalone vector contains every copy).
 *  - `opaqueBg`: a CSS color drawn as a full opaque tile-sized `<rect>` behind
 *    each emitted copy. The live overlay passes the pattern's background color
 *    so a painted copy fully occludes the bitmap beneath it (the seam fix);
 *    transparent-background patterns pass nothing and accept a faint edge halo.
 */
export function buildExpandedTileSVGObjectContent(
  obj: SVGObject,
  strokeScale: number,
  opts?: { onlyPainted?: boolean; opaqueBg?: string },
): string {
  if (obj.segments.length === 0) return '';
  const u = SVG_UNITS_PER_L0_CELL;
  const anchorX = obj.cellX + (obj.tileOffsetXL0 ?? 0);
  const anchorY = obj.cellY + (obj.tileOffsetYL0 ?? 0);
  const twL0 = obj.tileWidthL0 ?? obj.cellWidth;
  const thL0 = obj.tileHeightL0 ?? obj.cellHeight;
  const sw = SVG_STROKE_WIDTH * strokeScale;
  const attrs = `fill="none" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;
  const overrides = obj.segmentOverrides;

  // Set of (col,row) that carry ≥1 override (only needed for onlyPainted).
  // Built whenever onlyPainted is set — an empty set (no overrides) correctly
  // emits nothing.
  let paintedCells: Set<number> | null = null;
  if (opts?.onlyPainted) {
    paintedCells = new Set();
    for (const key of overrides?.keys() ?? []) {
      const { col, row } = unpackKey(key);
      paintedCells.add((col << 16) ^ (row & 0xffff));
    }
  }

  // Flat (segment, base color) list — subpaths-when-present, else segments —
  // matching flattenSVGSegmentsWithColor's ordering so override keys line up.
  const flat: Array<{ seg: PathSegment; base: RGBColor }> = [];
  if (Array.isArray(obj.subpaths) && obj.subpaths.length > 0) {
    for (const sub of obj.subpaths) for (const seg of sub.segments) flat.push({ seg, base: sub.color });
  } else {
    for (const seg of obj.segments) flat.push({ seg, base: obj.color });
  }

  // Fill is shared across copies (no per-copy fill override), built once
  // relative to the anchor tile.
  let fillMarkup = '';
  if (obj.fillColor) {
    const fd = buildTileFillPathD(obj.segments, anchorX, anchorY);
    if (fd) {
      const { r, g, b } = obj.fillColor;
      const oa = obj.fillOpacity != null && obj.fillOpacity < 1 ? ` fill-opacity="${obj.fillOpacity}"` : '';
      fillMarkup = `<path d="${fd}" fill="rgb(${r},${g},${b})"${oa} stroke="none" fill-rule="nonzero" />`;
    }
  }
  // Opaque backing rect (seam fix) — drawn first so it sits under fill+strokes.
  // Tile-local coords (0,0)–(tileW,tileH); the copy <g> translate places it.
  const bgRect = opts?.opaqueBg
    ? `<rect x="0" y="0" width="${twL0 * u}" height="${thL0 * u}" fill="${opts.opaqueBg}" stroke="none" />`
    : '';

  const colorKey = (c: RGBColor) => (c.r << 16) | (c.g << 8) | c.b;
  const out: string[] = [];
  forEachVisibleTile(obj, (col, row) => {
    if (paintedCells && !paintedCells.has((col << 16) ^ (row & 0xffff))) return;
    let copy = bgRect + fillMarkup;
    // Group contiguous same-color runs to minimize path count.
    let runColor: RGBColor | null = null;
    let runSegs: PathSegment[] = [];
    const flush = () => {
      if (runSegs.length === 0 || !runColor) return;
      const d = buildTilePathD(runSegs, anchorX, anchorY);
      if (d) copy += `<path d="${d}" ${attrs} stroke="rgb(${runColor.r},${runColor.g},${runColor.b})" />`;
      runSegs = [];
    };
    for (let i = 0; i < flat.length; i++) {
      const k = overrides ? packKey(col, row, i) : null;
      const ov = k != null && overrides ? overrides.get(k) : undefined;
      const color = ov ?? flat[i].base;
      if (runColor && colorKey(runColor) === colorKey(color)) {
        runSegs.push(flat[i].seg);
      } else {
        flush();
        runColor = color;
        runSegs = [flat[i].seg];
      }
    }
    flush();
    if (copy) {
      // Path/fill/bg above are tile-local (relative to the anchor tile). Place
      // this copy at its true world top-left: anchor + (col,row)·tile, in SVG
      // units. (Omitting the anchor term renders every copy shifted by
      // -anchor, i.e. outside the region viewBox for any non-origin pattern.)
      const tx = (anchorX + col * twL0) * u;
      const ty = (anchorY + row * thL0) * u;
      out.push(tx === 0 && ty === 0 ? `<g>${copy}</g>` : `<g transform="translate(${tx},${ty})">${copy}</g>`);
    }
  });
  return out.join('');
}

/**
 * Complete markup for a `tileMode: 'repeat'` SVGObject's REGION: the stored
 * segments are one pattern unit, repeated across the object's bbox on the
 * `tileWidthL0 × tileHeightL0` grid anchored at `cellX/Y + tileOffset` (the
 * offset compensates origin-side resizes so the pattern stays put in world
 * space). Coordinates are absolute world SVG-units, matching the non-tiled
 * markup, so the same `<svg viewBox>` frames both.
 *
 * Two shapes, matching the export renderer exactly:
 *  - sparse per-copy paint (`segmentOverrides`): a `<pattern>` can't express
 *    different colors per repeated copy, so expand into one `<g>` per visible
 *    copy with overrides baked in, clipped by a nested region `<svg>`.
 *  - otherwise: a `<defs><pattern>` of the single tile + a region `<rect>`
 *    filled with it — the browser does the repetition.
 *
 * Shared by the composition exporter (which wraps it in effects/mask clips)
 * and the live DOM node layer via {@link buildSVGObjectContent}, so pattern
 * mode can't render one way on the canvas and another in the export. Both
 * of those callers reach the object's whole-object opacity through the flat
 * path alone, so the tiled markup wraps itself in it here — see the return.
 *
 * `unitsPerCell` is the unit the CALLER's strokes are measured in (see
 * {@link buildSVGObjectContent}) — SVG units for the export (the default),
 * the layer's base pixel for the DOM. The tile is always drawn in SVG units
 * and scaled by the region's viewBox transform (no non-scaling
 * vector-effect works inside a `<pattern>`), so the legacy
 * strokeScale-derived width — a raw number independent of `unitsPerCell` —
 * is rescaled into SVG units here. Without this a repeat toggle in the DOM
 * would thin every stroke by the SVG-unit/base-pixel ratio.
 */
export function buildTiledSVGObjectRegionMarkup(
  svg: SVGObject,
  strokeScale: number,
  unitsPerCell: number = SVG_UNITS_PER_L0_CELL,
): string {
  if (svg.segments.length === 0) return '';
  const U = SVG_UNITS_PER_L0_CELL;
  const regionX = svg.cellX * U;
  const regionY = svg.cellY * U;
  const regionW = svg.cellWidth * U;
  const regionH = svg.cellHeight * U;
  // Legacy widths are `SVG_STROKE_WIDTH × strokeScale` in the caller's units;
  // the viewBox transform renders one SVG unit as unitsPerCell/U of them, so
  // pre-multiplying the scale by U/unitsPerCell lands the drawn stroke at
  // exactly the caller's width. Stroke-block widths are authored in world
  // cells and unaffected (svgStrokePresentation multiplies them by the U
  // passed below, never by strokeScale).
  const tileStrokeScale = strokeScale * (U / unitsPerCell);

  if (svg.segmentOverrides && svg.segmentOverrides.size > 0) {
    const instances = buildExpandedTileSVGObjectContent(svg, tileStrokeScale);
    return wrapSVGObjectOpacity(svg,
      `<svg x="${regionX}" y="${regionY}" width="${regionW}" height="${regionH}" overflow="hidden" `
      + `viewBox="${regionX} ${regionY} ${regionW} ${regionH}">${instances}</svg>`,
      tileStrokeScale);
  }

  // Per-object stroke attrs in SVG units, no non-scaling vector-effect: the
  // pattern content scales with the region's viewBox transform like the
  // figure-tile rasterizer's output (see buildSVGObjectTileContent's note).
  const attrs = svgStrokePresentation(svg, tileStrokeScale, U).attrs;
  // Tile-grid anchor (cellX + tileOffset) — fixed in the pattern tile
  // regardless of region expansion (the double-shift bug guard).
  const sMinX = svg.cellX + (svg.tileOffsetXL0 ?? 0);
  const sMinY = svg.cellY + (svg.tileOffsetYL0 ?? 0);
  // Fill path — rendered before strokes, anchored to the tile grid. The paint
  // comes from the same helper the non-tiled markup uses.
  let tileContent = '';
  const fillPres = svgFillPresentation(svg, `grad_${svg.id}`);
  if (fillPres) {
    const chained = chainSegments(svg.segments);
    if (chained) {
      const fd = buildTilePathD(chained, sMinX, sMinY) + ' Z';
      tileContent += `${fillPres.defs}<path d="${fd}" ${fillPres.attrs} stroke="none" fill-rule="nonzero" />`;
    }
  }
  if (Array.isArray(svg.subpaths) && svg.subpaths.length > 0) {
    tileContent += buildSubpathsMarkup(svg.subpaths, attrs, (segs) => buildTilePathD(segs, sMinX, sMinY));
  } else {
    const d = buildTilePathD(svg.segments, sMinX, sMinY);
    const { r, g, b } = svg.color;
    tileContent += `<path d="${d}" ${attrs} stroke="rgb(${r},${g},${b})" />`;
  }
  const tileW = (svg.tileWidthL0 ?? svg.cellWidth) * U;
  const tileH = (svg.tileHeightL0 ?? svg.cellHeight) * U;
  const patOrgX = regionX + (svg.tileOffsetXL0 ?? 0) * U;
  const patOrgY = regionY + (svg.tileOffsetYL0 ?? 0) * U;
  const patId = `pat_svg_${svgDefIdSafe(svg.id)}`;
  // The whole-object Opacity row rides the REGION, the same wrap the flat
  // markup ends with. Without it the Opacity slider moved nothing for
  // anything in repeat mode — which is every pattern, since a dragged-out
  // one is born repeating: the flat path wraps at its returns and this one
  // returned early, above them. Fade went on working throughout, because
  // fade moves the colours the markup is built from rather than wrapping
  // what it drew, which is exactly why only half the page looked broken.
  return wrapSVGObjectOpacity(svg,
    `<defs><pattern id="${patId}" patternUnits="userSpaceOnUse" `
    + `x="${patOrgX}" y="${patOrgY}" width="${tileW}" height="${tileH}">`
    + tileContent
    + `</pattern></defs>`
    + `<rect x="${regionX}" y="${regionY}" width="${regionW}" height="${regionH}" fill="url(#${patId})" stroke="none" />`,
    tileStrokeScale);
}

/**
 * Build a closed SVG `d` attribute for a fill: every loop the segments
 * ENCLOSE, each as its own `M…Z` subpath. Multiple subpaths are required for
 * shapes that aren't a single loop — a geometric union can produce disjoint
 * regions and/or holes (outer loop + inner loops). With `fill-rule="nonzero"`
 * (set on the fill <path>), a counter-wound inner loop renders as a hole and
 * disjoint loops each fill. Returns '' when nothing closes.
 *
 * What does NOT close is simply left out (`closedSegmentLoops`), rather than
 * refusing the whole object: a MERGED object can hold a closed loop and a
 * loose line at once — flatten a rectangle together with a stroke beside it —
 * and the rectangle is still an area to paint. The loose chain goes on
 * drawing as the stroke it is.
 */
export function buildClosedFillPathD(segments: ReadonlyArray<PathSegment>): string {
  return closedSegmentLoops(segments).map(loop => buildPathD(loop) + ' Z').join(' ');
}

/**
 * Tile-local variant of buildClosedFillPathD (coordinates relative to minX, minY).
 */
export function buildTileFillPathD(segments: ReadonlyArray<PathSegment>, minX: number, minY: number): string {
  return closedSegmentLoops(segments)
    .map(loop => buildTilePathD(loop, minX, minY) + ' Z').join(' ');
}

function sameColor(a: RGBColor, b: RGBColor): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

/** One fill subpath's closed loops, wound so the subpath as a whole turns
 *  positively. Only the WHOLE subpath is ever flipped, so its own holes stay
 *  counter-wound to its outline; what the flip buys is that two subpaths
 *  sharing one `d` under `fill-rule="nonzero"` add where they overlap
 *  instead of cancelling into a hole. */
function positivelyWoundLoops(segments: readonly PathSegment[]): PathSegment[][] {
  const loops = closedSegmentLoops(segments);
  let area = 0;
  for (const loop of loops) area += computeSignedArea(loop);
  if (area >= 0) return loops;
  return loops.map((loop) => loop.map(reverseSegment).reverse());
}

/**
 * The markup for an object's colored SUBPATHS — fills first, strokes on top.
 *
 * A RUN of consecutive subpaths of one color and kind is ONE `<path>`: a
 * merge of five same-colored shapes is one object, and it exports as one
 * compound path rather than five, so a vector editor opens it as the single
 * shape it is on the canvas. Only consecutive runs combine — pulling a
 * same-colored subpath past a different-colored one would change which
 * draws on top.
 *
 * Shared by the export and every live/tile markup builder, which differ only
 * in how a segment list becomes a `d` (`pathD`: world or tile-local units)
 * and whether stroke corners round (`strokeSegments`).
 */
export function buildSubpathsMarkup(
  subpaths: readonly SVGSubpath[],
  strokeAttrs: string,
  pathD: (segments: readonly PathSegment[]) => string,
  strokeSegments: (segments: readonly PathSegment[]) => readonly PathSegment[] = (s) => s,
): string {
  let out = '';
  for (const fill of [true, false]) {
    let runColor: RGBColor | null = null;
    let runD: string[] = [];
    const flush = () => {
      if (runColor && runD.length > 0) {
        const { r, g, b } = runColor;
        out += fill
          ? `<path d="${runD.join(' ')}" fill="rgb(${r},${g},${b})" stroke="none" fill-rule="nonzero" />`
          : `<path d="${runD.join(' ')}" ${strokeAttrs} stroke="rgb(${r},${g},${b})" />`;
      }
      runD = [];
    };
    for (const sub of subpaths) {
      if (!!sub.fill !== fill) continue;
      if (!runColor || !sameColor(runColor, sub.color)) {
        flush();
        runColor = sub.color;
      }
      if (fill) {
        for (const loop of positivelyWoundLoops(sub.segments)) runD.push(pathD(loop) + ' Z');
      } else {
        const d = pathD(strokeSegments(sub.segments));
        if (d) runD.push(d);
      }
    }
    flush();
  }
  return out;
}

/**
 * Whether a vector object ENCLOSES AN AREA — whether there is an interior to
 * fill at all.
 *
 * The geometric question behind the Fill and Pattern pages, and deliberately
 * not the same as the SUBTYPE question (`svgHasFill`, which says what the
 * tool that drew it offers): a merged collection of lines is subtype
 * `stroke` — it has loose ends — and can still hold a perfectly good closed
 * loop to paint inside. Anything that closes gets an interior, however it
 * came to be.
 */
export function svgEnclosesArea(obj: Pick<SVGObject, 'segments'>): boolean {
  return closedSegmentLoops(obj.segments).length > 0;
}

/**
 * Whether a shape paints an interior at all — through any of the three fields
 * that can carry one (the editable `fill` block, a flattened `fillPaint`, or
 * the legacy `fillColor`). A pattern-fill mask reads as UNFILLED: its own path
 * renders outline-only, its color painted as the tiled figure's background.
 *
 * Callers that only care whether there is area content, rather than how to
 * paint it, should ask this rather than testing one field — a shape filled from
 * the Fill bar carries `fill` and none of the older two.
 */
export function svgIsFilled(
  obj: Pick<SVGObject, 'fill' | 'fillPaint' | 'fillColor' | 'isPatternFill'>,
): boolean {
  if (obj.isPatternFill) return false;
  return !!(obj.fill || obj.fillPaint || obj.fillColor);
}

/**
 * Whether the shape draws a LINE of its own — the other half of the question
 * {@link svgIsFilled} asks about the interior.
 *
 * A width of exactly 0 is how "no outline" is authored (the Fill bar hands a
 * filled shape `stroke: { width: 0 }`); an absent width means the
 * composition's own, which is always drawn. A shape with SUBPATHS draws those
 * instead of its own chain, so it strokes only if one of them is a stroke —
 * a baked rig, which is filled subpaths and nothing else, strokes nothing.
 */
export function svgIsStroked(
  obj: Pick<SVGObject, 'stroke' | 'segments' | 'subpaths'>,
): boolean {
  if (obj.stroke?.width === 0) return false;
  if (obj.subpaths && obj.subpaths.length > 0) return obj.subpaths.some((sub) => !sub.fill);
  return obj.segments.length > 0;
}

/**
 * The shape with its FILL taken off, so it draws as the outline it was drawn
 * with — a wireframe of itself. Every field that paints the interior goes:
 * the editable `fill` block, the flattened `fillPaint`, the legacy
 * `fillColor`/`fillOpacity`, and any filled subpath. The geometry, the
 * stroke and the object's id are untouched, so it poses, masks, clips and
 * casts exactly as it did.
 *
 * For a small picture of a page where a filled shape would read as a blob:
 * see {@link CompositionSVGInputs.strokesOnly}, which names the objects this
 * is applied to. A shape that has no stroke to fall back on is NOT one to
 * hand this — it would draw nothing at all — which is the caller's rule to
 * keep ({@link svgIsStroked}).
 */
export function svgObjectStrokesOnly(obj: SVGObject): SVGObject {
  const out: SVGObject = { ...obj };
  delete out.fill;
  delete out.fillPaint;
  delete out.fillColor;
  delete out.fillOpacity;
  if (obj.subpaths && obj.subpaths.length > 0) {
    out.subpaths = obj.subpaths.filter((sub) => !sub.fill);
  }
  return out;
}

/**
 * Whether the shape draws ANYTHING inside its own outline — a paint of any
 * kind, or a PATTERN fill's tiles (v67+), which repeat inside the outline
 * and are clipped to it.
 *
 * The question a reader asks about the shape's interior: is there ink in
 * there to see, to occlude with, or to tap. `svgIsFilled` is the narrower
 * one — which of the three paint fields to draw — and says nothing about a
 * pattern fill, whose tiles are a layer of their own.
 *
 * An EMPTY pattern tile draws nothing at all (a fill freshly added, before
 * anything is painted into it), so it is not an interior either.
 */
export function svgPaintsInterior(
  obj: Pick<SVGObject, 'fill' | 'fillPaint' | 'fillColor' | 'isPatternFill' | 'patternFill'>,
): boolean {
  return svgIsFilled(obj) || !shapePatternFillIsEmpty(obj.patternFill);
}

/**
 * Whether a shape paints its OWN inner glow, rather than leaving it to the
 * filter its node effects hang on.
 *
 * An inner glow is the band of light just inside an edge, and the node
 * filter gathers it inside the node's own alpha. For a shape with no fill
 * that alpha is the STROKE — so the band lands inside the line, spilling to
 * both sides of it, and reads as a glowing tube rather than as light inside
 * a shape. Which is not an inner glow at all.
 *
 * So a shape that encloses an area paints the band itself, inside that area:
 * the light a filled shape would have had just inside its edge, with nothing
 * filling the middle. See {@link svgInnerGlowBandMarkup}.
 *
 * An OPEN path has no interior for this to be true of, and falls back to the
 * filter, which widens the line to the glow's own radius first — the only
 * inside a line has (`paintSvg.outlineCastDilate`).
 */
export function svgDrawsOwnInnerGlow(
  obj: Pick<SVGObject, 'effects' | 'fill' | 'fillPaint' | 'fillColor' | 'isPatternFill' | 'segments'>,
): boolean {
  return !!obj.effects?.innerGlow && !svgIsFilled(obj) && svgEnclosesArea(obj);
}

/**
 * That band, as markup: the shape's own closed outline, painted as an
 * invisible SOURCE and filtered down to the light just inside it.
 *
 * The `<path>` is filled opaque because the filter reads its ALPHA and
 * floods the glow's own colour in — the fill colour never reaches the page.
 * What the element emits is the band and not the source that cast it
 * ({@link innerGlowBandFilter}), so the middle stays exactly as empty as the
 * shape the user drew.
 *
 * `segments` are the ones already rendered — corner-rounded, and in the
 * caller's units — so the band follows the outline the stroke does, and
 * `unitsPerCell` puts the glow's own lengths in that same space. Empty
 * string for every shape that doesn't ask for this, which is nearly all of
 * them.
 */
export function svgInnerGlowBandMarkup(
  obj: SVGObject,
  segments: ReadonlyArray<PathSegment>,
  unitsPerCell: number,
): string {
  const glow = obj.effects?.innerGlow;
  if (!glow || svgIsFilled(obj)) return '';
  // An empty `d` IS the open-path case {@link svgDrawsOwnInnerGlow} rules
  // out, asked once instead of walking the loops twice over.
  const d = buildClosedFillPathD(segments);
  if (!d) return '';
  const scaled = scaleEffects({ innerGlow: glow }, unitsPerCell).innerGlow!;
  const { defs, filterRef } = innerGlowBandFilter(scaled, `uw-iglow-${svgDefIdSafe(obj.id)}`);
  return `<defs>${defs}</defs>`
    + `<path d="${d}" fill="#000000" stroke="none" fill-rule="nonzero" filter="${filterRef}" />`;
}

/**
 * The paint half of a shape's fill: everything deciding HOW the fill path is
 * painted — the `fill`, its `fill-opacity` and blend mode, plus any gradient
 * `<defs>` those reference — leaving the `d` to the caller.
 *
 * The geometry is the caller's because the two markup builders derive it
 * differently (world SVG units in the exporter, tile-local coordinates in the
 * pattern path) while the paint is identical; splitting it here is what stops a
 * fill rendering one way on the canvas and another in the export, exactly as
 * {@link svgStrokePresentation} does for the stroke.
 *
 * Precedence matches the field docs: the editable `fill` block (what the Fill
 * bar authors) outranks the flattened `fillPaint`, which outranks the legacy
 * `fillColor`/`fillOpacity`. Returns null when the object has no fill, or when
 * it is a pattern-fill mask — that one renders outline-only, its `fillColor`
 * painted as the tiled figure's background instead of as its own fill.
 *
 * `defId` must be unique within the document: a gradient fill emits a `<defs>`
 * the returned attrs reference by id.
 */
export function svgFillPresentation(
  obj: Pick<SVGObject, 'fill' | 'fillPaint' | 'fillColor' | 'fillOpacity' | 'isPatternFill'>,
  defId: string,
): { defs: string; attrs: string } | null {
  if (!svgIsFilled(obj)) return null;
  if (obj.fill) {
    const p = paintToSvg(tintFillToPaint(obj.fill), defId);
    // The bar's Opacity row is the whole fill layer's opacity, so it multiplies
    // whatever alpha the Paint itself carries rather than replacing it.
    const alpha = clamp01(p.fillOpacity ?? 1) * clamp01(obj.fill.opacity);
    const oa = alpha < 1 ? ` fill-opacity="${roundOpacity(alpha)}"` : '';
    // 'normal' is the default compositing, so an unblended fill emits no style
    // at all — one less attribute on the overwhelmingly common case.
    const blend = obj.fill.blend !== 'normal' ? ` style="mix-blend-mode:${obj.fill.blend}"` : '';
    return { defs: p.defs ? `<defs>${p.defs}</defs>` : '', attrs: `fill="${p.fill}"${oa}${blend}` };
  }
  if (obj.fillPaint) {
    // Gradient geometry is unit-bbox space → objectBoundingBox defs resolve
    // against the fill path's own bbox. The id is node-prefixed by the caller
    // so several gradient fills coexist in one document.
    const p = paintToSvg(obj.fillPaint, defId);
    const oa = p.fillOpacity !== undefined ? ` fill-opacity="${p.fillOpacity}"` : '';
    return { defs: p.defs ? `<defs>${p.defs}</defs>` : '', attrs: `fill="${p.fill}"${oa}` };
  }
  if (obj.fillColor) {
    const { r, g, b } = obj.fillColor;
    const oa = obj.fillOpacity != null && obj.fillOpacity < 1 ? ` fill-opacity="${obj.fillOpacity}"` : '';
    return { defs: '', attrs: `fill="rgb(${r},${g},${b})"${oa}` };
  }
  return null;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Trim float noise out of the emitted opacity (0.5 × 0.7 = 0.35, not 0.3499…). */
const roundOpacity = (v: number): number => Math.round(v * 1e4) / 1e4;

/**
 * Wrap an SVGObject's finished markup in its whole-object opacity — the
 * Opacity bar's first row. Returns the content unchanged at full opacity, so
 * the overwhelmingly common case emits nothing new.
 *
 * Every markup builder ends here — the flat one
 * ({@link buildSVGObjectContent}, the live DOM node layer's path), the SVG
 * exporter's own flat path, and the tiled region
 * ({@link buildTiledSVGObjectRegionMarkup}, which both of the others hand
 * repeat mode off to) — the same single-source rule as
 * {@link svgFillPresentation} and {@link svgStrokePresentation}. The tiled
 * one was the exception until 2026-09-19, and a pattern is born repeating,
 * so the Opacity row moved nothing on the one kind whose page had just
 * grown it.
 *
 * The bar's SECOND row used to be Soften, and this wrapped an eroded,
 * blurred silhouette mask around the markup for it. The row is Fade now
 * (engine/fade.ts) and fade is not a mask at all — it moves the colours the
 * markup is built FROM, before a single path is written — so nothing of it
 * reaches here. What went with the mask is a `<filter>` on the render path:
 * a feMorphology and a feGaussianBlur per softened object, which was the
 * most expensive thing this file could emit.
 */
export function wrapSVGObjectOpacity(
  obj: SVGObject,
  content: string,
  _strokeScale: number,
): string {
  if (!content) return content;
  const alpha = obj.opacity == null ? 1 : clamp01(obj.opacity);
  if (alpha >= 1) return content;
  return wearOrWrap(content, `opacity="${roundOpacity(alpha)}"`);
}

/** One self-closing element and nothing else: `<path … />`, `<image … />`,
 *  `<rect … />`. No `<` or `>` can sit inside an attribute the builders
 *  write (path data, colours, ids, base64), so the tag runs to its own end. */
const SOLE_ELEMENT = /^<([a-zA-Z][\w:-]*)\b([^<>]*)\/>$/;

/**
 * Hand `attrs` — `opacity="0.5"`, `clip-path="url(#…)"`, `filter="url(#…)"`,
 * `transform="matrix(…)"` — to the markup: a lone element WEARS them, and
 * only several elements share a `<g>` to carry them.
 *
 * The two are the same picture. Every attribute this is used for applies
 * to an element and to a group alike, and a group of one element paints
 * exactly as that element would with the attribute on it — a lone path at
 * half opacity, a lone path clipped, a lone path posed. What the group
 * bought was nothing but a wrapper round every stroke in the file, which
 * is how an exported drawing came to be a nest of `<g>`s with one `<path>`
 * at the bottom of each. So the wrapper is kept for the markup that needs
 * it (a fill path and a stroke path, a defs block and its user), for an
 * element that already carries one of the attributes, which cannot take a
 * second — and for an element that already wears a `transform`. That one
 * is not a nicety: an element's transform is the space its other
 * attributes are read in, so a world-space clip put on a posed element
 * would clip against a posed copy of the mask. Wrapping keeps the clip
 * outside the pose, which is the order the callers nest them in.
 */
export function wearOrWrap(markup: string, attrs: string): string {
  const m = SOLE_ELEMENT.exec(markup);
  if (m) {
    const names = attrs.match(/[\w-]+(?==")/g) ?? [];
    const worn = m[2];
    if (!worn.includes(' transform=') && !names.some((n) => worn.includes(` ${n}=`))) {
      return `<${m[1]} ${attrs}${worn}/>`;
    }
  }
  return `<g ${attrs}>${markup}</g>`;
}

/**
 * The stroke presentation an SVGObject's own `stroke` block asks for: the
 * shared `<path>` attributes, any `<defs>` they reference, and the (possibly
 * corner-rounded) segments to draw.
 *
 * Both markup builders — the live DOM node layer via
 * {@link buildSVGObjectContent} and the SVG exporter — go through here, so a
 * stroke can never render one way on the canvas and another in the export.
 *
 * `unitsPerCell` is how many units of the emitted `stroke-width` one world
 * cell spans, and the caller owns it because it depends on where the markup
 * lands: the exporter draws in SVG units (`SVG_UNITS_PER_L0_CELL`), while the
 * DOM layer sets `vector-effect="non-scaling-stroke"` and so measures in the
 * pixels of the box it sits in (`BASE_CELL_PX`). `nonScaling` selects that
 * vector-effect. An object with no stroke block ignores `unitsPerCell`
 * entirely and renders at `strokeScale` exactly as it did before.
 */
export function svgStrokePresentation(
  obj: SVGObject,
  strokeScale: number,
  unitsPerCell: number,
  opts?: { nonScaling?: boolean },
): { defs: string; attrs: string; segments: readonly PathSegment[] } {
  const sw = svgStrokeWidthUnits(obj, strokeScale, unitsPerCell);
  // Corner rounding is a render-time reshape of the segment chain; the stored
  // geometry is untouched so hit testing and bbox math keep seeing the drawn
  // shape. Radius 0 (the default) returns the segments unchanged.
  const radius = svgStrokeRadiusCells(obj);
  const segments = radius > 0 ? roundPathCorners(obj.segments, radius) : obj.segments;

  // Stroke alignment. SVG has no `stroke-alignment`, so an inside/outside
  // stroke is drawn at DOUBLE width and then clipped (inside) or masked
  // (outside) against the filled path — exact for any closed path, and no
  // geometry offsetting to go wrong. 'center' (and every open path) skips all
  // of this and strokes plainly.
  const align = svgStrokeAlignment(obj);
  let defs = '';
  let alignAttr = '';
  let strokeWidth = sw;
  if (align !== 'center') {
    const clipD = buildClosedFillPathD(segments);
    if (clipD) {
      strokeWidth = sw * 2;
      if (align === 'inside') {
        const id = svgStrokeDefId(obj.id, 'clip');
        defs = `<defs><clipPath id="${id}"><path d="${clipD}" /></clipPath></defs>`;
        alignAttr = ` clip-path="url(#${id})"`;
      } else {
        const id = svgStrokeDefId(obj.id, 'mask');
        // White keeps, black drops: a box comfortably larger than the object
        // (the stroke can only reach half its width past the path) minus the
        // filled interior leaves just the outer half of the doubled stroke.
        const u = SVG_UNITS_PER_L0_CELL;
        const pad = Math.max(obj.cellWidth, obj.cellHeight) * 0.5 * u + u;
        const mx = obj.cellX * u - pad;
        const my = obj.cellY * u - pad;
        const mw = obj.cellWidth * u + pad * 2;
        const mh = obj.cellHeight * u + pad * 2;
        // The mask REGION must be stated explicitly. `<mask>` defaults to
        // x/y/width/height of -10%/-10%/120%/120%, and under
        // maskUnits="userSpaceOnUse" those percentages resolve against the
        // VIEWPORT — i.e. a box near the user-space origin, not around this
        // object, which sits out at (cellX·u, cellY·u). Leaving them implicit
        // put every object outside its own mask region and erased it.
        defs = `<defs><mask id="${id}" maskUnits="userSpaceOnUse" `
          + `x="${mx}" y="${my}" width="${mw}" height="${mh}">`
          + `<rect x="${mx}" y="${my}" width="${mw}" height="${mh}" fill="white" />`
          + `<path d="${clipD}" fill="black" fill-rule="nonzero" />`
          + `</mask></defs>`;
        alignAttr = ` mask="url(#${id})"`;
      }
    }
  }

  // Dash shares the border effect's pattern table, so a dashed stroke and a
  // dashed border of the same density read the same. The pattern is in world
  // cells; the stroke unit is not, hence the conversion.
  const pattern = borderDashPattern(obj.stroke?.dash);
  const dashAttr = pattern
    ? ` stroke-dasharray="${pattern[0] * unitsPerCell} ${pattern[1] * unitsPerCell}"`
    : '';
  const ve = opts?.nonScaling ? ' vector-effect="non-scaling-stroke"' : '';

  return {
    defs,
    attrs: `fill="none" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${ve}${dashAttr}${alignAttr}`,
    segments,
  };
}

/**
 * The same object with every STROKE it paints in `color`: its own `color`, each
 * stroked subpath's, and every per-copy tile override. Geometry, effects and
 * FILLS are untouched.
 *
 * For a cutout export landing on a backdrop the page never had — see
 * {@link CompositionSVGInputs.strokeColorOverride}. Recoloring the node up
 * front rather than at each `stroke="…"` site means every downstream builder —
 * the tiled region markup, the endpoint decorations, the subpath loops —
 * inherits the override without threading a color of its own.
 *
 * A fill keeps its authored paint because it is an AREA, not a line: flooding
 * it too would turn line art into a silhouette, and it reads against the
 * backdrop on its own the way a hairline stroke doesn't.
 *
 * `floodFills` asks for exactly that silhouette, for an object whose picture
 * IS its fills — a baked Figgie rig is nothing but filled subpaths, so the
 * plain override slides off it and leaves a tan mannequin sitting in an
 * otherwise white cutout. Callers name those objects one at a time (see
 * `CompositionSVGInputs.silhouette`) rather than flipping the rule for
 * everything, because for ordinary line art the rule is right.
 */
export function withSVGObjectStrokeColor(
  obj: SVGObject,
  color: RGBColor,
  opts?: { floodFills?: boolean },
): SVGObject {
  const out: SVGObject = { ...obj, color };
  if (obj.subpaths) {
    out.subpaths = obj.subpaths.map((sub) => (
      sub.fill && !opts?.floodFills ? sub : { ...sub, color }
    ));
  }
  if (obj.segmentOverrides && obj.segmentOverrides.size > 0) {
    const overrides = new Map<number, RGBColor>();
    for (const key of obj.segmentOverrides.keys()) overrides.set(key, color);
    out.segmentOverrides = overrides;
  }
  return out;
}

/**
 * A shape's baked pattern tiles, clipped to its own closed outline — the
 * markup a pattern fill actually contributes, shared by the live DOM
 * layer (through {@link buildSVGObjectContent}) and the SVG export, so
 * the canvas and the exported page cannot clip one pattern two ways.
 *
 * '' when there are no tiles or the shape has no closed outline to hold
 * them: a pattern fill in an unclosed path would spill across the page,
 * so it draws nothing at all rather than nearly the right thing.
 *
 * The clip id is the object's, which is unique within a document by
 * construction, so two patterned shapes in one export never share one.
 */
export function shapePatternFillMarkup(
  obj: SVGObject, tiles: string, closedD: string,
): string {
  if (!tiles || !closedD) return '';
  const id = `patfill_${obj.id}`;
  return `<defs><clipPath id="${id}" clipPathUnits="userSpaceOnUse">`
    + `<path d="${closedD}" fill-rule="nonzero" /></clipPath></defs>`
    + `<g clip-path="url(#${id})">${tiles}</g>`;
}

/**
 * Build complete SVG path element(s) for an SVGObject, including
 * multi-color subpath support, optional solid fill, and the object's own
 * per-object stroke settings (see {@link svgStrokePresentation}).
 *
 * `unitsPerCell` is the DOM node layer's `BASE_CELL_PX` — see
 * {@link svgStrokePresentation} for why the caller owns that unit.
 */
export function buildSVGObjectContent(
  obj: SVGObject,
  strokeScale: number,
  unitsPerCell: number,
  opts?: {
    /** Default true — the DOM node layer's convention: strokes carry
     *  `vector-effect="non-scaling-stroke"` with widths in the layer's
     *  base pixels. Pass false to stroke in USER-SPACE units instead (the
     *  caller then passes SVG units + a strokeScaleForUnits-converted
     *  scale, like the exporter's own flat path). The pattern node layer
     *  needs this: its tiled (repeat) markup can only stroke in user
     *  space, and WKWebView resolves non-scaling strokes against the
     *  device CTM — so under camera zoom the two conventions disagree and
     *  a repeat toggle visibly changed the line weight. */
    nonScaling?: boolean;
    /** Pixel carrier for a color-tool paint layer — default 'image' (PNG
     *  data URI, the export's self-contained form). The live DOM node layer
     *  passes 'canvas' and draws the slot after mount; see
     *  {@link PaintOverlaySlot} for why the DOM must not inline pixels. */
    paintOverlaySlot?: PaintOverlaySlot;
    /** The shape's PATTERN fill, already baked into tile markup in this
     *  object's own space (`shapePatternFillTiles`) — clipped here to the
     *  same closed outline the solid fill paints and drawn over it, under
     *  the strokes.
     *
     *  Passed IN rather than baked here because the bake's import chain
     *  (patternObjectRender → figureToPaths → … → compositionOps) reaches
     *  back into this module; the clip is built here because it is the
     *  fill's own outline, corner rounding and all, and neither renderer
     *  should be building a second copy of it. */
    patternFillMarkup?: string;
  },
): string {
  if (obj.segments.length === 0) return '';
  // Pattern mode: the stored segments are one tile; render the repeating
  // region instead of the single unit, with the stroke widths converted from
  // this caller's units into the tile's SVG-unit space — see
  // buildTiledSVGObjectRegionMarkup.
  if (obj.tileMode === 'repeat') return buildTiledSVGObjectRegionMarkup(obj, strokeScale, unitsPerCell);
  const radius = svgStrokeRadiusCells(obj);
  const { defs, attrs, segments } = svgStrokePresentation(obj, strokeScale, unitsPerCell, { nonScaling: opts?.nonScaling ?? true });

  let result = defs;

  // Fill path — rendered before strokes so the outline sits on top, and
  // following the same (possibly corner-rounded) outline the stroke does.
  // svgFillPresentation decides the paint (and skips a pattern-fill mask,
  // whose fill belongs to the tiled figure beneath it).
  const fill = svgFillPresentation(obj, `grad_${obj.id}`);
  const patternTiles = opts?.patternFillMarkup ?? '';
  const closedD = fill || obj.paintOverlay || patternTiles ? buildClosedFillPathD(segments) : '';
  let fillMarkup = '';
  if (fill && closedD) {
    fillMarkup = `${fill.defs}<path d="${closedD}" ${fill.attrs} stroke="none" fill-rule="nonzero" />`;
  }
  // Color-tool paint layer (v49): the low-res bitmap stretched over the bbox
  // and clipped to the same closed outline the fill paints, blended with its
  // one mode. Isolated together with the fill so the blend composites
  // against the shape's own interior, not the canvas behind it — the same
  // confinement the image node's overlay gets. Sits under the strokes (and
  // any recolored fill subpaths), so painted outlines stay legible.
  if (obj.paintOverlay && closedD) {
    const u = SVG_UNITS_PER_L0_CELL;
    const overlay = shapePaintOverlaySVG(
      obj.paintOverlay, obj.id, closedD,
      obj.cellX * u, obj.cellY * u, obj.cellWidth * u, obj.cellHeight * u,
      opts?.paintOverlaySlot,
    );
    fillMarkup = `<g style="isolation:isolate">${fillMarkup}${overlay}</g>`;
  }
  result += fillMarkup;
  // The PATTERN fill (v67), over the solid fill and under the strokes: a
  // shape carrying both shows its colour through the gaps in the tiles,
  // and its own outline on top of them either way. Clipped to the fill's
  // own closed outline — the tiles are baked across the shape's whole box
  // and it is the clip that makes them a FILL.
  result += shapePatternFillMarkup(obj, patternTiles, closedD);

  if (Array.isArray(obj.subpaths) && obj.subpaths.length > 0) {
    result += buildSubpathsMarkup(obj.subpaths, attrs, (segs) => buildPathD(segs),
      radius > 0 ? (segs) => roundPathCorners(segs, radius) : undefined);
    return wrapSVGObjectOpacity(obj, result, strokeScale);
  }

  const d = buildPathD(segments);
  if (!d) return wrapSVGObjectOpacity(obj, result, strokeScale);
  const { r: cr, g: cg, b: cb } = obj.color;
  result += `<path d="${d}" ${attrs} stroke="rgb(${cr},${cg},${cb})" />`;
  // Endpoint decorations last, so they sit on top of the stroke they cap. They
  // are sized off the stroke's width in CELLS, which is what makes them match
  // the line in whichever space this markup lands in.
  result += svgEndpointsMarkup(obj, segments, svgStrokeWidthCells(obj, strokeScale, unitsPerCell));
  // The whole-object Opacity bar (opacity + edge soften) wraps everything the
  // object drew, so fill, stroke and decorations fade as one layer — and the
  // inner-glow band goes OUTSIDE it, where the node's effects filter sits,
  // so the two inner glows (filtered and painted) land in the same place in
  // the stack.
  return wrapSVGObjectOpacity(obj, result, strokeScale)
    + svgInnerGlowBandMarkup(obj, segments, unitsPerCell);
}
