import { PathSegment, RGBColor, SVGObject } from './types';
import { SVG_UNITS_PER_L0_CELL, SVG_STROKE_WIDTH } from './svgExport';
import { computeSweepFlag, arcRadius, chainSegmentsLoops } from './compositionArcMath';
import { packKey, unpackKey, forEachVisibleTile } from './tileSegmentOverrides';
import { borderDashPattern, paintToSvg } from './paintSvg';
import { tintFillToPaint } from './imageTintFill';
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
    // Fill subpaths first so stroke subpaths draw on top of them.
    for (const sub of obj.subpaths) {
      if (!sub.fill) continue;
      const fd = buildTileFillPathD(sub.segments, minX, minY);
      if (fd) {
        const { r, g, b } = sub.color;
        result += `<path d="${fd}" fill="rgb(${r},${g},${b})" stroke="none" fill-rule="nonzero" />`;
      }
    }
    for (const sub of obj.subpaths) {
      if (sub.fill) continue;
      const d = buildTilePathD(sub.segments, minX, minY);
      if (d) {
        const { r, g, b } = sub.color;
        result += `<path d="${d}" ${attrs} stroke="rgb(${r},${g},${b})" />`;
      }
    }
    return result;
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
 * Build a closed SVG `d` attribute for a fill. Chains the segments into one
 * or more closed loops and emits each as its own `M…Z` subpath. Multiple
 * subpaths are required for shapes that aren't a single loop — a geometric
 * union can produce disjoint regions and/or holes (outer loop + inner loops).
 * With `fill-rule="nonzero"` (set on the fill <path>), a counter-wound inner
 * loop renders as a hole and disjoint loops each fill. Returns '' on failure.
 */
export function buildClosedFillPathD(segments: ReadonlyArray<PathSegment>): string {
  const loops = chainSegmentsLoops(segments);
  if (!loops) return '';
  return loops.map(loop => buildPathD(loop) + ' Z').join(' ');
}

/**
 * Tile-local variant of buildClosedFillPathD (coordinates relative to minX, minY).
 */
export function buildTileFillPathD(segments: ReadonlyArray<PathSegment>, minX: number, minY: number): string {
  const loops = chainSegmentsLoops(segments);
  if (!loops) return '';
  return loops.map(loop => buildTilePathD(loop, minX, minY) + ' Z').join(' ');
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
 * Wrap an SVGObject's finished markup in its whole-object opacity and edge
 * soften — the Opacity bar's two rows. Returns the content unchanged when the
 * object has neither, so the overwhelmingly common case emits nothing new.
 *
 * Both markup builders — the live DOM node layer via
 * {@link buildSVGObjectContent} and the SVG exporter — go through here, the
 * same single-source rule as {@link svgFillPresentation} and
 * {@link svgStrokePresentation}.
 *
 * The soften is a mask whose content is the shape's own silhouette (the
 * corner-rounded outline, filled when closed, stroked at the drawn width)
 * eroded inward and then blurred. The feather depth is `edgeSoften × half the
 * shorter bbox side`; eroding by half of it and blurring the rest (σ = a fifth
 * of the depth, so the 2.5σ tail spans the eroded half) puts the END of the
 * ramp at the original edge — the edge itself is at 0 opacity, fully opaque
 * only a feather-depth in. A plain blur would center the ramp ON the edge and
 * leave it at ~50%. At 0 the mask is the shape itself (hard edges); at 1 the
 * shape fades to transparent toward its edges. A mask — never a filter on the
 * shape itself — so the geometry the stroke and fill draw is untouched, and
 * the filter cost is paid only by objects that opted in. Geometry is in SVG
 * units (both builders' `d` space); the mask and filter regions are stated
 * explicitly in userSpaceOnUse because the defaults resolve against the
 * viewport, not the object (see the alignment mask's caveat in
 * {@link svgStrokePresentation}).
 */
export function wrapSVGObjectOpacity(
  obj: SVGObject,
  content: string,
  strokeScale: number,
): string {
  if (!content) return content;
  const alpha = obj.opacity == null ? 1 : clamp01(obj.opacity);
  const soften = clamp01(obj.edgeSoften ?? 0);
  if (alpha >= 1 && soften <= 0) return content;
  const opacityAttr = alpha < 1 ? ` opacity="${roundOpacity(alpha)}"` : '';
  let defs = '';
  let maskAttr = '';
  if (soften > 0 && obj.cellWidth > 0 && obj.cellHeight > 0 && obj.segments.length > 0) {
    const u = SVG_UNITS_PER_L0_CELL;
    // The silhouette follows the same corner rounding the stroke draws with.
    const radius = svgStrokeRadiusCells(obj);
    const segments = radius > 0 ? roundPathCorners(obj.segments, radius) : obj.segments;
    const closedD = buildClosedFillPathD(segments);
    const d = closedD || buildPathD(segments);
    if (d) {
      // Stroke width in geometry units so the silhouette covers the stroke.
      // (The DOM layer's visible stroke is non-scaling — constant screen px —
      // which a static mask can't track; at base zoom the two agree, and the
      // mask is only a fade so the mismatch is invisible in practice.)
      const sw = svgStrokeWidthCells(obj, strokeScale, u) * u;
      // Feather depth, split between an inward erode and the blur that fades
      // the eroded half back out to the ORIGINAL edge (see the doc comment).
      // The erode needs a closed silhouette to eat into; the open-path
      // fallback (never offered the control) skips it and just blurs.
      const depth = soften * 0.5 * Math.min(obj.cellWidth, obj.cellHeight) * u;
      const erode = closedD ? depth / 2 : 0;
      const sigma = closedD ? depth / 5 : depth / 2;
      // Region: bbox + stroke overhang + the blur's 3σ tail.
      const pad = sw / 2 + sigma * 3 + u;
      const mx = obj.cellX * u - pad;
      const my = obj.cellY * u - pad;
      const mw = obj.cellWidth * u + pad * 2;
      const mh = obj.cellHeight * u + pad * 2;
      const safe = svgDefIdSafe(obj.id);
      const filterId = `uw-soften-f-${safe}`;
      const maskId = `uw-soften-m-${safe}`;
      const fillAttr = closedD ? ' fill="white"' : ' fill="none"';
      const erodePrim = erode > 0
        ? `<feMorphology operator="erode" radius="${roundOpacity(erode)}" />`
        : '';
      defs = `<defs><filter id="${filterId}" filterUnits="userSpaceOnUse" `
        + `x="${mx}" y="${my}" width="${mw}" height="${mh}">`
        + `${erodePrim}<feGaussianBlur stdDeviation="${roundOpacity(sigma)}" /></filter>`
        + `<mask id="${maskId}" maskUnits="userSpaceOnUse" `
        + `x="${mx}" y="${my}" width="${mw}" height="${mh}">`
        + `<g filter="url(#${filterId})">`
        + `<path d="${d}"${fillAttr} stroke="white" stroke-width="${sw}" `
        + `stroke-linecap="round" stroke-linejoin="round" fill-rule="nonzero" /></g>`
        + `</mask></defs>`;
      maskAttr = ` mask="url(#${maskId})"`;
    }
  }
  if (!opacityAttr && !maskAttr) return content;
  return `${defs}<g${opacityAttr}${maskAttr}>${content}</g>`;
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
): string {
  if (obj.segments.length === 0) return '';
  const radius = svgStrokeRadiusCells(obj);
  const { defs, attrs, segments } = svgStrokePresentation(obj, strokeScale, unitsPerCell, { nonScaling: true });

  let result = defs;

  // Fill path — rendered before strokes so the outline sits on top, and
  // following the same (possibly corner-rounded) outline the stroke does.
  // svgFillPresentation decides the paint (and skips a pattern-fill mask,
  // whose fill belongs to the tiled figure beneath it).
  const fill = svgFillPresentation(obj, `grad_${obj.id}`);
  if (fill) {
    const fd = buildClosedFillPathD(segments);
    if (fd) result += `${fill.defs}<path d="${fd}" ${fill.attrs} stroke="none" fill-rule="nonzero" />`;
  }

  if (Array.isArray(obj.subpaths) && obj.subpaths.length > 0) {
    // Fill subpaths first so stroke subpaths draw on top of them.
    for (const sub of obj.subpaths) {
      if (!sub.fill) continue;
      const fd = buildClosedFillPathD(sub.segments);
      if (fd) {
        const { r, g, b } = sub.color;
        result += `<path d="${fd}" fill="rgb(${r},${g},${b})" stroke="none" fill-rule="nonzero" />`;
      }
    }
    for (const sub of obj.subpaths) {
      if (sub.fill) continue;
      const rounded = radius > 0 ? roundPathCorners(sub.segments, radius) : sub.segments;
      const d = buildPathD(rounded);
      if (d) {
        const { r, g, b } = sub.color;
        result += `<path d="${d}" ${attrs} stroke="rgb(${r},${g},${b})" />`;
      }
    }
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
  // object drew, so fill, stroke and decorations fade as one layer.
  return wrapSVGObjectOpacity(obj, result, strokeScale);
}
