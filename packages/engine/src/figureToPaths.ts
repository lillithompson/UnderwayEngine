/**
 * Convert a CompositionFigure's cached SVG elements into PathSegment[]
 * in L0-cell space. Used by join to bake figure visuals into an SVGObject.
 *
 * Handles <path d="...">, <rect>, and <circle> elements. SVG coordinates are in
 * the figure cache's SVG-unit space (256 units = 1 L0 cell). The figure's
 * placement (cellX/Y/Width/Height) maps the SVG viewport onto the canvas.
 */

import { CompositionFigure, PathSegment, RGBColor, SVGObject, SVGSubpath } from './types';
import { getFigureSVGSync, CachedFigureSVG } from './svgFigureCache';
import { blendColor, recolorPixel } from './colorBlend';
import { figureArtLayout, figureArtPoint, rotateMirrorAround } from './figureArtLayout';
import { computeSVGBbox } from './sceneGraph';
import { maxStrokeWidth, SVG_UNITS_PER_L0_CELL } from './svgExport';
import { effectiveStrokeMultiplier } from './strokeScale';
import { cubicPointAt, readPathData } from './svgPathData';
import { svgArcCentre, svgArcPieces, svgArcPoint } from './svgArc';
import { ELLIPSE_POLYLINE_SEGMENTS } from './compositionArcMath';
import { AffineMatrix, applyMatrix, parseTransform } from './svgTransform';

export interface ColoredSegments {
  color: RGBColor;
  segments: PathSegment[];
  /** True when the group's source SVG elements were fill-painted (color
   *  cells export as filled rects) rather than stroked (sprite line art).
   *  Callers building an SVGObject map fill groups to `SVGSubpath.fill`. */
  isFill?: boolean;
}

/**
 * Convert a repeating-pattern figure into an equivalent TILED `SVGObject`
 * (one tile of vector geometry + the same tile grid), so the color brush can
 * recolor individual repeated copies via `segmentOverrides` instead of
 * expanding the whole pattern into a giant flat SVG.
 *
 * Bakes exactly ONE tile of the figure's geometry, positioned at the tile-grid
 * anchor (`cellX + tileOffset`) so it matches `buildSVGObjectTileContent`'s
 * `minX` convention, then carries over the region bbox, tile dims, and offset.
 * The figure's `colorOverride` tint is baked into the segment colors.
 *
 * Returns null when: the figure isn't a `repeat` tile, its tile dims are
 * missing, it's rotated/mirrored (caller should fall back to flat expansion —
 * the tiled-SVG rotation convention differs), or its SVG isn't cached yet.
 *
 * `cached` is the figure's art when the caller holds it already — an
 * import baking a file it has not stored ({@link bakeFiguresToSVGObjects});
 * left out, the art is the cache's.
 */
export function figureToTiledSVGObject(
  fig: CompositionFigure, newId: string, cached?: CachedFigureSVG,
): SVGObject | null {
  if (fig.tileMode !== 'repeat' || !fig.tileWidthL0 || !fig.tileHeightL0) return null;
  if ((fig.rotation ?? 0) !== 0 || fig.mirrorH || fig.mirrorV) return null;

  const tileW = fig.tileWidthL0;
  const tileH = fig.tileHeightL0;
  const offX = fig.tileOffsetXL0 ?? 0;
  const offY = fig.tileOffsetYL0 ?? 0;
  // Anchor = where the SVG-object tile renderer places tile-local (0,0).
  const anchorX = fig.cellX + offX;
  const anchorY = fig.cellY + offY;

  const bakeFig: CompositionFigure = {
    ...fig,
    rotation: 0, mirrorH: false, mirrorV: false,
    cellX: anchorX, cellY: anchorY,
    cellWidth: tileW, cellHeight: tileH,
  };
  const baked = cached
    ? convertCachedSVGToColoredSegments(cached, bakeFig)
    : bakeFigureToColoredSegments(bakeFig);
  if (!baked) return null;
  const body = coloredSegmentsBody(tintColoredSegments(baked, fig));
  if (!body) return null;

  return {
    id: newId,
    ...body,
    name: fig.name,
    cellX: fig.cellX, cellY: fig.cellY, cellWidth: fig.cellWidth, cellHeight: fig.cellHeight,
    tileMode: 'repeat',
    tileWidthL0: tileW,
    tileHeightL0: tileH,
    ...(offX !== 0 ? { tileOffsetXL0: offX } : {}),
    ...(offY !== 0 ? { tileOffsetYL0: offY } : {}),
    ...(fig.groupId ? { groupId: fig.groupId } : {}),
  };
}

/**
 * The vector body an object draws from colour groups: every drawn group's
 * segments as the object's own, one subpath per group — a fill group
 * flagged `fill`, so colour cells paint as filled rects and sprite art as
 * strokes — and the first group's colour as the object's. The ONE place a
 * baked figure's groups become an SVGObject's fields (the flat bake, the
 * tiled bake and a pattern's view); a group with no segments is left out,
 * and with nothing drawn there is no body. The caller adds the id, the box
 * and the bookkeeping.
 */
export function coloredSegmentsBody(
  groups: readonly ColoredSegments[],
): Pick<SVGObject, 'segments' | 'color' | 'subpaths'> | null {
  const drawn = groups.filter((g) => g.segments.length > 0);
  if (drawn.length === 0) return null;
  return {
    segments: drawn.flatMap((g) => g.segments),
    color: drawn[0].color,
    subpaths: drawn.map((g) => {
      const sub: SVGSubpath = { segments: g.segments, color: g.color };
      if (g.isFill) sub.fill = true;
      return sub;
    }),
  };
}

/**
 * The figure's `colorOverride` tint baked into each group's colour — the
 * recolour the renderer would apply at draw time, applied to the data
 * instead, so a baked copy looks the same as the figure did. A figure with
 * no override comes back as it went in. Fill flags survive.
 */
export function tintColoredSegments(groups: ColoredSegments[], fig: CompositionFigure): ColoredSegments[] {
  const baseline = fig.colorOverride;
  if (!baseline) return groups;
  const bakeMode = fig.colorOverrideBlendMode;
  const tint = (base: RGBColor) =>
    bakeMode != null ? blendColor(base, baseline, bakeMode, 1) : recolorPixel(base, baseline);
  return groups.map((g) => ({ ...g, color: tint(g.color) }));
}

/**
 * The width a figure's sprite strokes are drawn at, in world cells: the
 * art's own stroke-width (SVG units, 256 per cell) under the legacy ×200
 * multiplier every figure renderer and the SVG export apply to the
 * composition's `strokeScale` (compositionSVGCore: "figures keep the
 * legacy ×200"), the same at every placement scale because
 * buildFigureSVGContent compensates the art's widths for it. Undefined when
 * the art strokes nothing — colour cells alone, which fill.
 *
 * The svg node layer reads the SAME stored `strokeScale` as base pixels
 * (svgStrokeWidthUnits: 5 × strokeScale px at 16 px per cell), so a baked
 * figure left to the composition-wide width would draw at 1/12.5 of the
 * line it had — a Facet file's 0.04 came out as a 0.2 px hairline.
 */
export function figureStrokeWidthCells(cached: CachedFigureSVG, strokeScale: number): number | undefined {
  const art = maxStrokeWidth(cached.elements);
  if (art <= 0) return undefined;
  return art * effectiveStrokeMultiplier(strokeScale) / SVG_UNITS_PER_L0_CELL;
}

/**
 * A figure as the SVGObject that draws the same thing: its art placed,
 * turned and mirrored into the figure's box by the one layout every reader
 * of a figure shares (convertCachedSVGToColoredSegments), one subpath per
 * colour (colour cells as fills, sprite art as strokes), the override tint
 * baked in, the box the segments' own AABB (the invariant every svg reader
 * holds — not the figure's placement box, which its ink need not fill),
 * and the stroke width the figure was drawn at ({@link
 * figureStrokeWidthCells}, from the composition's `strokeScale`) as the
 * object's own. Scene bookkeeping (name, group, locked, hidden) carries
 * over.
 *
 * For a canvas with no figure render path — the shared editor draws
 * svgObjects, images, texts, paint and patterns, and a `CompositionFigure`
 * nowhere (CanvasSurface's renderNode) — this is how a figure becomes
 * visible at all. Null when the art has no drawable element: there is
 * nothing to show, in this editor or the one that wrote it.
 */
export function bakeFigureToSVGObject(
  fig: CompositionFigure, cached: CachedFigureSVG, strokeScale: number, id: string = fig.id,
): SVGObject | null {
  const dress = (obj: SVGObject): SVGObject => {
    if (fig.name != null) obj.name = fig.name;
    if (fig.groupId) obj.groupId = fig.groupId;
    if (fig.preGroupName != null) obj.preGroupName = fig.preGroupName;
    if (fig.locked) obj.locked = true;
    if (fig.hidden) obj.hidden = true;
    const width = figureStrokeWidthCells(cached, strokeScale);
    if (width != null) obj.stroke = { width };
    return obj;
  };
  if (fig.tileMode === 'repeat') {
    const tiled = figureToTiledSVGObject(fig, id, cached);
    if (tiled) return dress(tiled);
  }
  const body = coloredSegmentsBody(tintColoredSegments(convertCachedSVGToColoredSegments(cached, fig), fig));
  if (!body) return null;
  return dress({ id, ...body, ...computeSVGBbox(body.segments) });
}

/**
 * Every figure whose file is in `svgByFileId` baked ({@link
 * bakeFigureToSVGObject}) under its own id, so a scene order and a group
 * that named the figure name the svg; the rest — an atlas-sprite figure, a
 * file the bundle did not carry — stay figures. A figure whose art is
 * empty is dropped: it drew nothing where it came from either.
 * `strokeScale` is the composition's stored one, which sets the width the
 * figures' strokes were drawn at.
 */
export function bakeFiguresToSVGObjects(
  figures: readonly CompositionFigure[],
  svgByFileId: ReadonlyMap<string, CachedFigureSVG>,
  strokeScale: number,
): { figures: CompositionFigure[]; svgObjects: SVGObject[] } {
  const kept: CompositionFigure[] = [];
  const svgObjects: SVGObject[] = [];
  for (const fig of figures) {
    const cached = fig.fileId ? svgByFileId.get(fig.fileId) : undefined;
    if (!cached) { kept.push(fig); continue; }
    const svg = bakeFigureToSVGObject(fig, cached, strokeScale);
    if (svg) svgObjects.push(svg);
  }
  return { figures: kept, svgObjects };
}

/**
 * Bake a figure into PathSegments in L0-cell space, grouped by color.
 * Returns null if the figure's SVG is not cached yet.
 */
export function bakeFigureToSegments(fig: CompositionFigure): PathSegment[] | null {
  const groups = bakeFigureToColoredSegments(fig);
  if (!groups) return null;
  return groups.flatMap(g => g.segments);
}

/**
 * Bake a figure into PathSegments grouped by stroke/fill color.
 * Each group has its own color so join can preserve per-element colors.
 */
export function bakeFigureToColoredSegments(fig: CompositionFigure): ColoredSegments[] | null {
  const cached = getFigureSVGSync(fig);
  if (!cached) return null;
  return convertCachedSVGToColoredSegments(cached, fig);
}

/**
 * Rotate (CW) and mirror a single PathSegment around (cx, cy), in the one
 * mirrors-then-rotate order every reader of a figure's art shares
 * ({@link rotateMirrorAround}).
 */
export function transformSegmentAroundCenter(
  seg: PathSegment,
  cx: number, cy: number,
  rotation: 0 | 90 | 180 | 270,
  mirrorH: boolean,
  mirrorV: boolean,
): PathSegment {
  const t = (p: readonly [number, number]): [number, number] =>
    rotateMirrorAround(p[0], p[1], cx, cy, rotation, mirrorH, mirrorV);
  if (seg.kind === 'arc') {
    return { kind: 'arc', start: t(seg.start), end: t(seg.end), center: t(seg.center) };
  }
  return { kind: 'line', start: t(seg.start), end: t(seg.end) };
}

export function convertCachedSVGToColoredSegments(
  cached: CachedFigureSVG,
  fig: CompositionFigure,
): ColoredSegments[] {
  const byColor = new Map<string, ColoredSegments>();
  const rotation = fig.rotation ?? 0;
  const mirrorH = fig.mirrorH ?? false;
  const mirrorV = fig.mirrorV ?? false;

  // The same layout the exporter's markup takes, emitted in L0 cells rather
  // than SVG units — hence `unitsPerCell` 1. Unlike the exporter this bakes
  // the figure's whole box, never its `quads`.
  const layout = figureArtLayout(fig, rotation, cached, 1);

  /** SVG units → L0-cell space. */
  const toL0 = (sx: number, sy: number): [number, number] =>
    figureArtPoint(layout, sx, sy, rotation, mirrorH, mirrorV);

  function getColorGroup(el: string): ColoredSegments {
    const { color, isFill } = parseElementPaint(el);
    const key = `${color.r},${color.g},${color.b}|${isFill ? 'f' : 's'}`;
    let entry = byColor.get(key);
    if (!entry) {
      entry = { color, segments: [] };
      if (isFill) entry.isFill = true;
      byColor.set(key, entry);
    }
    return entry;
  }

  for (const el of cached.elements) {
    // Parse the element's transform attribute (translate, scale, rotate)
    const xform = elementTransform(el);

    // Apply element transform then figure placement transform
    const mapPt = (x: number, y: number): [number, number] => {
      const [tx, ty] = applyMatrix(xform, x, y);
      return toL0(tx, ty);
    };

    const group = getColorGroup(el);

    if (el.match(/^<(path|line|polyline|polygon) /)) {
      const dMatch = el.match(/\bd="([^"]*)"/);
      if (dMatch) {
        const pathSegs = parseSVGPathD(dMatch[1]);
        for (const seg of pathSegs) {
          if (seg.kind === 'arc') {
            group.segments.push({
              kind: 'arc',
              start: mapPt(seg.start[0], seg.start[1]),
              end: mapPt(seg.end[0], seg.end[1]),
              center: mapPt(seg.center[0], seg.center[1]),
            });
          } else {
            group.segments.push({
              kind: 'line',
              start: mapPt(seg.start[0], seg.start[1]),
              end: mapPt(seg.end[0], seg.end[1]),
            });
          }
        }
      }
    } else if (el.startsWith('<rect ')) {
      const x = parseAttr(el, 'x') ?? 0;
      const y = parseAttr(el, 'y') ?? 0;
      const w = parseAttr(el, 'width') ?? 0;
      const h = parseAttr(el, 'height') ?? 0;
      if (w > 0 && h > 0) {
        const tl = mapPt(x, y);
        const tr = mapPt(x + w, y);
        const br = mapPt(x + w, y + h);
        const bl = mapPt(x, y + h);
        group.segments.push({ kind: 'line', start: tl, end: tr });
        group.segments.push({ kind: 'line', start: tr, end: br });
        group.segments.push({ kind: 'line', start: br, end: bl });
        group.segments.push({ kind: 'line', start: bl, end: tl });
      }
    } else if (el.startsWith('<circle ')) {
      const cx = parseAttr(el, 'cx') ?? 0;
      const cy = parseAttr(el, 'cy') ?? 0;
      const r = parseAttr(el, 'r') ?? 0;
      if (r > 0) {
        const top = mapPt(cx, cy - r);
        const right = mapPt(cx + r, cy);
        const bottom = mapPt(cx, cy + r);
        const left = mapPt(cx - r, cy);
        const center = mapPt(cx, cy);
        group.segments.push({ kind: 'arc', start: top, end: right, center });
        group.segments.push({ kind: 'arc', start: right, end: bottom, center });
        group.segments.push({ kind: 'arc', start: bottom, end: left, center });
        group.segments.push({ kind: 'arc', start: left, end: top, center });
      }
    }
  }
  // Clip segments to the figure's placement bounds so the join result
  // matches the rendering path's <svg overflow="hidden"> viewport.
  // Line segments are clipped via Liang-Barsky. Arc segments are trimmed
  // to the portion of the circle within the clip rect — the curve shape
  // is preserved (same center, same radius, shorter arc).
  const minX = fig.cellX;
  const minY = fig.cellY;
  const maxX = fig.cellX + fig.cellWidth;
  const maxY = fig.cellY + fig.cellHeight;

  return [...byColor.values()]
    .map(g => ({
      ...g,
      segments: clipSegmentsToRect(g.segments, minX, minY, maxX, maxY),
    }))
    .filter(g => g.segments.length > 0);
}

// ── Segment clipping ────────────────────────────────────────────────

/** Clip a line segment to an axis-aligned rect (Liang-Barsky). */
function clipLineToRect(
  s: readonly [number, number], e: readonly [number, number],
  minX: number, minY: number, maxX: number, maxY: number,
): { start: [number, number]; end: [number, number] } | null {
  const dx = e[0] - s[0], dy = e[1] - s[1];
  let t0 = 0, t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else       { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  if (!clip(-dx, s[0] - minX) || !clip(dx, maxX - s[0]) ||
      !clip(-dy, s[1] - minY) || !clip(dy, maxY - s[1]) || t0 > t1) return null;
  return {
    start: [s[0] + t0 * dx, s[1] + t0 * dy],
    end:   [s[0] + t1 * dx, s[1] + t1 * dy],
  };
}

/** Trim an arc segment to the portion inside an axis-aligned rect.
 *  The result is a shorter arc on the same circle (same center and radius)
 *  with new start/end at the rect boundaries. Returns null if the arc
 *  doesn't pass through the rect. */
function clipArcToRect(
  seg: { start: readonly [number, number]; end: readonly [number, number]; center: readonly [number, number] },
  minX: number, minY: number, maxX: number, maxY: number,
): PathSegment | null {
  const cx = seg.center[0], cy = seg.center[1];
  const r = Math.sqrt((seg.start[0] - cx) ** 2 + (seg.start[1] - cy) ** 2);
  if (r < 1e-10) return null;

  const inside = (p: readonly [number, number]) =>
    p[0] >= minX - 1e-9 && p[0] <= maxX + 1e-9 &&
    p[1] >= minY - 1e-9 && p[1] <= maxY + 1e-9;

  if (inside(seg.start) && inside(seg.end) && inside(seg.center)) return seg as PathSegment;

  const sa = Math.atan2(seg.start[1] - cy, seg.start[0] - cx);
  const ea = Math.atan2(seg.end[1] - cy, seg.end[0] - cx);

  // Sweep from start to end — use the shorter path (< π for quarter circles)
  let sweep = ea - sa;
  if (sweep > Math.PI) sweep -= 2 * Math.PI;
  if (sweep < -Math.PI) sweep += 2 * Math.PI;

  // Check if an angle is on the arc [sa, sa+sweep]
  const onArc = (a: number): boolean => {
    let d = a - sa;
    if (sweep >= 0) {
      while (d < -1e-9) d += 2 * Math.PI;
      while (d > 2 * Math.PI - 1e-9) d -= 2 * Math.PI;
      return d <= sweep + 1e-9;
    } else {
      while (d > 1e-9) d -= 2 * Math.PI;
      while (d < -2 * Math.PI + 1e-9) d += 2 * Math.PI;
      return d >= sweep - 1e-9;
    }
  };

  // Signed angular distance from start along the arc
  const arcDist = (a: number): number => {
    let d = a - sa;
    if (sweep >= 0) {
      while (d < -1e-9) d += 2 * Math.PI;
      while (d > 2 * Math.PI - 1e-9) d -= 2 * Math.PI;
    } else {
      while (d > 1e-9) d -= 2 * Math.PI;
      while (d < -2 * Math.PI + 1e-9) d += 2 * Math.PI;
    }
    return d;
  };

  // Find circle–clip-boundary intersection points that lie on the arc
  // and within the boundary segment, then sort by arc parameter.
  const hits: { pt: [number, number]; t: number }[] = [];

  // Horizontal boundaries (y = k)
  for (const yK of [minY, maxY]) {
    const dy = yK - cy;
    const disc = r * r - dy * dy;
    if (disc < 0) continue;
    const dx = Math.sqrt(disc);
    for (const x of [cx - dx, cx + dx]) {
      if (x < minX - 1e-9 || x > maxX + 1e-9) continue;
      const a = Math.atan2(yK - cy, x - cx);
      if (onArc(a)) hits.push({ pt: [x, yK], t: arcDist(a) });
    }
  }
  // Vertical boundaries (x = k)
  for (const xK of [minX, maxX]) {
    const dx = xK - cx;
    const disc = r * r - dx * dx;
    if (disc < 0) continue;
    const dy = Math.sqrt(disc);
    for (const y of [cy - dy, cy + dy]) {
      if (y < minY - 1e-9 || y > maxY + 1e-9) continue;
      const a = Math.atan2(y - cy, xK - cx);
      if (onArc(a)) hits.push({ pt: [xK, y], t: arcDist(a) });
    }
  }

  // Include start/end if inside the rect
  const sIn = inside(seg.start), eIn = inside(seg.end);
  if (sIn) hits.push({ pt: [seg.start[0], seg.start[1]], t: 0 });
  if (eIn) hits.push({ pt: [seg.end[0], seg.end[1]], t: sweep });

  if (hits.length < 2) {
    // Fewer than two crossings/contained endpoints — the arc at most
    // grazes the rect; drop it.
    return null;
  }

  // Sort by arc parameter; first and last define the trimmed arc
  hits.sort((a, b) => (sweep >= 0 ? a.t - b.t : b.t - a.t));
  const newStart = hits[0].pt;
  const newEnd = hits[hits.length - 1].pt;

  const len = Math.sqrt((newStart[0] - newEnd[0]) ** 2 + (newStart[1] - newEnd[1]) ** 2);
  if (len < 1e-9) return null;

  return { kind: 'arc', start: newStart, end: newEnd, center: [cx, cy] };
}

/** Clip segments to an axis-aligned rectangle. Line segments are clipped
 *  via Liang-Barsky. Arc segments are trimmed to the portion of the
 *  circle inside the rect (preserving curve shape). */
export function clipSegmentsToRect(
  segments: PathSegment[],
  minX: number, minY: number, maxX: number, maxY: number,
): PathSegment[] {
  const result: PathSegment[] = [];
  for (const seg of segments) {
    if (seg.kind === 'line') {
      const c = clipLineToRect(seg.start, seg.end, minX, minY, maxX, maxY);
      if (c) result.push({ kind: 'line', start: c.start, end: c.end });
    } else {
      const c = clipArcToRect(seg, minX, minY, maxX, maxY);
      if (c) result.push(c);
    }
  }
  return result;
}

/** Extract stroke or fill color from an SVG element string. */
function parseElementPaint(el: string): { color: RGBColor; isFill: boolean } {
  // Try stroke first (paths use stroke), then fill (rects use fill)
  const strokeMatch = el.match(/\bstroke="rgb\((\d+),\s*(\d+),\s*(\d+)\)"/);
  if (strokeMatch) {
    return { color: { r: +strokeMatch[1], g: +strokeMatch[2], b: +strokeMatch[3] }, isFill: false };
  }
  const fillMatch = el.match(/\bfill="rgb\((\d+),\s*(\d+),\s*(\d+)\)"/);
  if (fillMatch) {
    return { color: { r: +fillMatch[1], g: +fillMatch[2], b: +fillMatch[3] }, isFill: true };
  }
  return { color: { r: 255, g: 255, b: 255 }, isFill: false }; // default white stroke
}

// ── SVG transform parsing ───────────────────────────────────────────

/** An element's `transform` attribute as its matrix, by the engine's one
 *  reader of one (svgTransform.ts); the identity when it has none. */
function elementTransform(el: string): AffineMatrix {
  const match = el.match(/\btransform="([^"]*)"/);
  return parseTransform(match ? match[1] : '');
}

function parseAttr(el: string, name: string): number | undefined {
  const match = el.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? parseFloat(match[1]) : undefined;
}

// ── SVG path `d` attribute parser ───────────────────────────────────

/** How far a cubic's two ends may differ in their distance from the center
 *  its end normals meet at, as a share of the larger, and still be a
 *  circle's arc. simplifySVG writes a circle's arc to two decimals, which
 *  moves its ends' distances a hair apart; an ellipse's are apart by its
 *  axes' difference. */
const CIRCULAR_CUBIC_TOLERANCE = 0.01;

interface RawLineSeg { kind: 'line'; start: [number, number]; end: [number, number] }
interface RawArcSeg { kind: 'arc'; start: [number, number]; end: [number, number]; center: [number, number] }
type RawSeg = RawLineSeg | RawArcSeg;

/**
 * Parse an SVG path `d` attribute into PathSegments, read by the engine's
 * one path-data reader (svgPathData.ts), relative commands as well as
 * absolute. The curves in figure SVGs are quarter circles aligned to the
 * grid: cubic beziers (C/S) are converted to exact arc segments by computing
 * the center from the tangent directions at start and end (one that is no
 * circle's arc, an ellipse's, is chords instead), and a quadratic's
 * center is start + end − its control point. An arc (A) is the circle or
 * ellipse it draws ({@link convertSVGArc}). Path data that breaks the
 * grammar is baked up to its first error, as SVG draws it.
 */
function parseSVGPathD(d: string): RawSeg[] {
  const segments: RawSeg[] = [];
  const line = (x0: number, y0: number, x: number, y: number) => {
    segments.push({ kind: 'line', start: [x0, y0], end: [x, y] });
  };
  readPathData(d, {
    moveTo() {},
    lineTo: line,
    /** A cubic bezier as a quarter-circle arc segment. The center is the
     *  intersection of:
     *  - the line through start, perpendicular to the tangent at start (cp1 − start)
     *  - the line through end, perpendicular to the tangent at end (end − cp2)
     *  A cubic whose two ends are not the same distance from that center is
     *  no circle's arc (an elliptical arc, which simplifySVG writes as cubics
     *  since report 7f84afc7): it is chords along the cubic, as many to its
     *  turn as an elliptical A has ({@link convertSVGArc}), where an arc
     *  segment would draw it broken (report b452acb8). */
    cubicTo(x0, y0, cp1x, cp1y, cp2x, cp2y, ex, ey) {
      const t1x = cp1x - x0, t1y = cp1y - y0;
      const t2x = ex - cp2x, t2y = ey - cp2y;
      const center = lineLineIntersect(
        x0, y0, -t1y, t1x,  // from start, perpendicular to tangent at start
        ex, ey, -t2y, t2x,  // from end, perpendicular to tangent at end
      );
      if (!center) {
        // Degenerate (collinear tangents) — treat as line
        line(x0, y0, ex, ey);
        return;
      }
      const r0 = Math.hypot(x0 - center[0], y0 - center[1]);
      const r1 = Math.hypot(ex - center[0], ey - center[1]);
      if (Math.abs(r0 - r1) <= CIRCULAR_CUBIC_TOLERANCE * Math.max(r0, r1)) {
        segments.push({ kind: 'arc', start: [x0, y0], end: [ex, ey], center });
        return;
      }
      const turn = Math.abs(Math.atan2(t1x * t2y - t1y * t2x, t1x * t2x + t1y * t2y));
      const n = Math.max(1, Math.ceil(turn / ((2 * Math.PI) / ELLIPSE_POLYLINE_SEGMENTS) - 1e-9));
      let px = x0, py = y0;
      for (let i = 1; i <= n; i++) {
        const [x, y] = i === n ? [ex, ey] : cubicPointAt(x0, y0, cp1x, cp1y, cp2x, cp2y, ex, ey, i / n);
        line(px, py, x, y);
        px = x; py = y;
      }
    },
    /** A quadratic bezier as a quarter-circle arc segment. For a quarter
     *  circle, the single control point sits at the tangent-intersection
     *  corner, diagonally opposite the arc center across the chord:
     *  center = start + end − corner. */
    quadTo(x0, y0, cpx, cpy, ex, ey) {
      segments.push({ kind: 'arc', start: [x0, y0], end: [ex, ey], center: [x0 + ex - cpx, y0 + ey - cpy] });
    },
    arcTo(x0, y0, rx, ry, rotationDeg, largeArc, sweep, x, y) {
      convertSVGArc(x0, y0, rx, ry, rotationDeg, largeArc, sweep, x, y, segments);
    },
    close(x0, y0, startX, startY) {
      if (x0 !== startX || y0 !== startY) line(x0, y0, startX, startY);
    },
  });
  return segments;
}

/**
 * An SVG arc command as PathSegments, from the engine's one conversion of
 * one (svgArc.ts). The engine's arc segment is circular and is drawn as the
 * MINOR arc between its ends, so a circle's arc becomes arcs of a quarter
 * turn or less about its centre — a large arc several of them, never one
 * drawn the short way round. An ellipse's becomes lines, as every ellipse
 * the engine draws is ({@link ELLIPSE_POLYLINE_SEGMENTS} to a full turn): its
 * arc segment can hold no ellipse. An arc with no curve to it (a zero
 * radius, coincident ends) is the line to its end. Pieces start and end
 * exactly on the arc's own ends.
 */
function convertSVGArc(
  x1: number, y1: number, rx: number, ry: number,
  xRot: number, largeArc: boolean, sweep: boolean,
  x2: number, y2: number, out: RawSeg[],
): void {
  const arc = svgArcCentre(x1, y1, rx, ry, xRot, largeArc, sweep, x2, y2);
  const circle = arc !== null && arc.rx === arc.ry;
  const n = arc ? svgArcPieces(arc, circle ? Math.PI / 2 : (2 * Math.PI) / ELLIPSE_POLYLINE_SEGMENTS) : 0;
  if (!arc || n === 0) {
    out.push({ kind: 'line', start: [x1, y1], end: [x2, y2] });
    return;
  }
  let start: [number, number] = [x1, y1];
  for (let i = 1; i <= n; i++) {
    const end: [number, number] = i === n ? [x2, y2] : svgArcPoint(arc, arc.theta1 + (arc.dTheta * i) / n);
    out.push(circle ? { kind: 'arc', start, end, center: [arc.cx, arc.cy] } : { kind: 'line', start, end });
    start = end;
  }
}

/** Intersect two lines (point + direction). Returns null if parallel. */
function lineLineIntersect(
  px: number, py: number, dx: number, dy: number,
  qx: number, qy: number, ex: number, ey: number,
): [number, number] | null {
  const denom = dx * ey - dy * ex;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((qx - px) * ey - (qy - py) * ex) / denom;
  return [px + t * dx, py + t * dy];
}
