/**
 * Convert a CompositionFigure's cached SVG elements into PathSegment[]
 * in L0-cell space. Used by join to bake figure visuals into an SVGObject.
 *
 * Handles <path d="...">, <rect>, and <circle> elements. SVG coordinates are in
 * the figure cache's SVG-unit space (256 units = 1 L0 cell). The figure's
 * placement (cellX/Y/Width/Height) maps the SVG viewport onto the canvas.
 */

import { CompositionFigure, PathSegment, RGBColor, SVGObject } from './types';
import { getFigureSVGSync, CachedFigureSVG } from './svgFigureCache';
import { blendColor, recolorPixel } from './colorBlend';

export interface ColoredSegments {
  color: RGBColor;
  segments: PathSegment[];
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
 */
export function figureToTiledSVGObject(fig: CompositionFigure, newId: string): SVGObject | null {
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
  let colorGroups = bakeFigureToColoredSegments(bakeFig);
  if (!colorGroups || colorGroups.length === 0) return null;

  // Bake the figure's colorOverride tint into the segment colors (same recipe
  // as the flat expand path) so the converted object looks identical.
  const baseline = fig.colorOverride;
  if (baseline) {
    const bakeMode = fig.colorOverrideBlendMode;
    const tint = (base: RGBColor) =>
      bakeMode != null ? blendColor(base, baseline, bakeMode, 1) : recolorPixel(base, baseline);
    colorGroups = colorGroups.map(g => ({ color: tint(g.color), segments: g.segments }));
  }

  const primary = colorGroups[0];
  const allSegments = colorGroups.flatMap(g => g.segments);
  const subpaths = colorGroups.length > 1
    ? colorGroups.map(g => ({ segments: g.segments, color: g.color }))
    : undefined;

  return {
    id: newId,
    segments: allSegments,
    color: primary.color,
    subpaths,
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
 * Rotate (CW) and mirror a single PathSegment around (cx, cy). Mirrors are
 * applied before rotation, matching the SVG transform order used by
 * buildFigureSVGContent and buildBlockSVGContent (rightmost-first applied
 * to the point).
 */
export function transformSegmentAroundCenter(
  seg: PathSegment,
  cx: number, cy: number,
  rotation: 0 | 90 | 180 | 270,
  mirrorH: boolean,
  mirrorV: boolean,
): PathSegment {
  const t = (p: readonly [number, number]): [number, number] => {
    let x = p[0] - cx;
    let y = p[1] - cy;
    if (mirrorV) y = -y;
    if (mirrorH) x = -x;
    if (rotation === 90)       { const k = x; x = -y; y = k; }
    else if (rotation === 180) { x = -x; y = -y; }
    else if (rotation === 270) { const k = x; x = y; y = -k; }
    return [x + cx, y + cy];
  };
  if (seg.kind === 'arc') {
    return { kind: 'arc', start: t(seg.start), end: t(seg.end), center: t(seg.center) };
  }
  return { kind: 'line', start: t(seg.start), end: t(seg.end) };
}

function convertCachedSVGToColoredSegments(
  cached: CachedFigureSVG,
  fig: CompositionFigure,
): ColoredSegments[] {
  const byColor = new Map<string, { color: RGBColor; segments: PathSegment[] }>();
  const svgW = cached.svgWidth;
  const svgH = cached.svgHeight;
  const rotation = fig.rotation ?? 0;
  const mirrorH = fig.mirrorH ?? false;
  const mirrorV = fig.mirrorV ?? false;

  // Match buildFigureSVGContent: cellWidth/cellHeight reflect the
  // post-rotation bounding box for 90°/270°, so un-swap to get the
  // original content size, then rotate around the bbox center to land
  // in the swapped bbox.
  const rotSwapped = rotation === 90 || rotation === 270;
  const contentW = rotSwapped ? fig.cellHeight : fig.cellWidth;
  const contentH = rotSwapped ? fig.cellWidth : fig.cellHeight;

  // Uniform aspect-preserving scale (matches rendering — prevents skew
  // when the figure's source aspect doesn't match its placement bounds).
  const rawSx = contentW / svgW;
  const rawSy = contentH / svgH;
  const scale = Math.abs(rawSx - rawSy) > 1e-9 ? Math.min(rawSx, rawSy) : rawSx;

  const qCx = fig.cellX + fig.cellWidth / 2;
  const qCy = fig.cellY + fig.cellHeight / 2;
  const scaledW = svgW * scale;
  const scaledH = svgH * scale;
  const posX = qCx - scaledW / 2;
  const posY = qCy - scaledH / 2;

  // SVG units → L0-cell space, then apply mirrors and rotation around
  // (qCx, qCy). SVG transform order is t1 t2 ... tN with rightmost
  // applied first to the point: mirrorV → mirrorH → rotate → translate.
  const toL0 = (sx: number, sy: number): [number, number] => {
    let x = sx * scale + posX - qCx;
    let y = sy * scale + posY - qCy;
    if (mirrorV) y = -y;
    if (mirrorH) x = -x;
    if (rotation === 90)       { const t = x; x = -y; y = t; }
    else if (rotation === 180) { x = -x; y = -y; }
    else if (rotation === 270) { const t = x; x = y; y = -t; }
    return [x + qCx, y + qCy];
  };

  function getColorGroup(el: string): { color: RGBColor; segments: PathSegment[] } {
    const color = parseElementColor(el);
    const key = `${color.r},${color.g},${color.b}`;
    let entry = byColor.get(key);
    if (!entry) { entry = { color, segments: [] }; byColor.set(key, entry); }
    return entry;
  }

  for (const el of cached.elements) {
    // Parse the element's transform attribute (translate, scale, rotate)
    const xform = parseTransform(el);

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
      color: g.color,
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
function parseElementColor(el: string): RGBColor {
  // Try stroke first (paths use stroke), then fill (rects use fill)
  const strokeMatch = el.match(/\bstroke="rgb\((\d+),\s*(\d+),\s*(\d+)\)"/);
  if (strokeMatch) return { r: +strokeMatch[1], g: +strokeMatch[2], b: +strokeMatch[3] };
  const fillMatch = el.match(/\bfill="rgb\((\d+),\s*(\d+),\s*(\d+)\)"/);
  if (fillMatch) return { r: +fillMatch[1], g: +fillMatch[2], b: +fillMatch[3] };
  return { r: 255, g: 255, b: 255 }; // default white
}

// ── SVG transform parsing ───────────────────────────────────────────

/** 2D affine matrix [a, b, c, d, e, f] where:
 *  x' = a*x + c*y + e
 *  y' = b*x + d*y + f */
type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function multiplyMatrices(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/** Parse a CSS/SVG transform string into a combined affine matrix. */
function parseTransform(el: string): Matrix {
  const match = el.match(/\btransform="([^"]*)"/);
  if (!match) return IDENTITY;
  const transformStr = match[1];

  let result: Matrix = IDENTITY;
  const fnRe = /(translate|scale|rotate|matrix)\(([^)]*)\)/g;
  let m: RegExpExecArray | null;

  while ((m = fnRe.exec(transformStr)) !== null) {
    const fn = m[1];
    const args = m[2].split(/[\s,]+/).map(Number);
    let mat: Matrix;
    switch (fn) {
      case 'translate':
        mat = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
        break;
      case 'scale': {
        const sx = args[0] ?? 1;
        const sy = args[1] ?? sx;
        mat = [sx, 0, 0, sy, 0, 0];
        break;
      }
      case 'rotate': {
        const deg = args[0] ?? 0;
        const cx = args[1] ?? 0;
        const cy = args[2] ?? 0;
        const rad = deg * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        // rotate(θ, cx, cy) = translate(cx,cy) · rotate(θ) · translate(-cx,-cy)
        mat = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
        break;
      }
      case 'matrix':
        mat = [args[0], args[1], args[2], args[3], args[4], args[5]];
        break;
      default:
        mat = IDENTITY;
    }
    result = multiplyMatrices(result, mat);
  }
  return result;
}

function parseAttr(el: string, name: string): number | undefined {
  const match = el.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? parseFloat(match[1]) : undefined;
}

// ── SVG path `d` attribute parser ───────────────────────────────────

interface RawLineSeg { kind: 'line'; start: [number, number]; end: [number, number] }
interface RawArcSeg { kind: 'arc'; start: [number, number]; end: [number, number]; center: [number, number] }
type RawSeg = RawLineSeg | RawArcSeg;

/**
 * Parse an SVG path `d` attribute into PathSegments.
 * All curves in figure SVGs are quarter circles aligned to the grid.
 * Cubic beziers (C/S) are converted to exact arc segments by computing
 * the center from the tangent directions at start and end.
 */
function parseSVGPathD(d: string): RawSeg[] {
  const segments: RawSeg[] = [];
  const tokens = tokenizePath(d);
  let curX = 0, curY = 0;
  let moveX = 0, moveY = 0;
  let lastCpX = 0, lastCpY = 0;
  let lastCmd = '';
  let i = 0;

  function lineTo(x: number, y: number) {
    segments.push({ kind: 'line', start: [curX, curY], end: [x, y] });
    curX = x; curY = y;
  }

  /** Convert a cubic bezier to a quarter-circle arc segment.
   *  The center is the intersection of:
   *  - line through start, perpendicular to tangent at start (cp1-start)
   *  - line through end, perpendicular to tangent at end (end-cp2) */
  function cubicTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, ex: number, ey: number) {
    // Tangent direction at start: cp1 - start
    const t1x = cp1x - curX, t1y = cp1y - curY;
    // Tangent direction at end: end - cp2
    const t2x = ex - cp2x, t2y = ey - cp2y;

    // Find center as intersection of perpendicular lines from start and end
    const center = lineLineIntersect(
      curX, curY, -t1y, t1x,  // from start, perpendicular to tangent at start
      ex, ey, -t2y, t2x,       // from end, perpendicular to tangent at end
    );

    if (center) {
      segments.push({ kind: 'arc', start: [curX, curY], end: [ex, ey], center });
    } else {
      // Degenerate (collinear tangents) — treat as line
      segments.push({ kind: 'line', start: [curX, curY], end: [ex, ey] });
    }
    curX = ex; curY = ey;
    lastCpX = cp2x; lastCpY = cp2y;
  }

  /** Convert a quadratic bezier to a quarter-circle arc segment.
   *  For a quarter circle, the single control point sits at the
   *  tangent-intersection corner, diagonally opposite the arc center
   *  across the chord: center = start + end − corner. */
  function quadTo(cpx: number, cpy: number, ex: number, ey: number) {
    segments.push({
      kind: 'arc',
      start: [curX, curY],
      end: [ex, ey],
      center: [curX + ex - cpx, curY + ey - cpy],
    });
    curX = ex; curY = ey;
    lastCpX = cpx; lastCpY = cpy;
  }

  while (i < tokens.length) {
    const cmd = tokens[i];
    if (typeof cmd === 'number') { i++; continue; }
    i++;
    switch (cmd) {
      case 'M':
        curX = tokens[i++] as number;
        curY = tokens[i++] as number;
        moveX = curX; moveY = curY;
        while (i < tokens.length && typeof tokens[i] === 'number') {
          const x = tokens[i++] as number;
          const y = tokens[i++] as number;
          lineTo(x, y);
        }
        break;
      case 'L':
        while (i < tokens.length && typeof tokens[i] === 'number') {
          lineTo(tokens[i++] as number, tokens[i++] as number);
        }
        break;
      case 'H':
        while (i < tokens.length && typeof tokens[i] === 'number') {
          lineTo(tokens[i++] as number, curY);
        }
        break;
      case 'V':
        while (i < tokens.length && typeof tokens[i] === 'number') {
          lineTo(curX, tokens[i++] as number);
        }
        break;
      case 'C':
        while (i < tokens.length && typeof tokens[i] === 'number') {
          const cp1x = tokens[i++] as number, cp1y = tokens[i++] as number;
          const cp2x = tokens[i++] as number, cp2y = tokens[i++] as number;
          const ex = tokens[i++] as number, ey = tokens[i++] as number;
          cubicTo(cp1x, cp1y, cp2x, cp2y, ex, ey);
        }
        break;
      case 'S':
        while (i < tokens.length && typeof tokens[i] === 'number') {
          // Reflect last control point
          const cp1x = (lastCmd === 'C' || lastCmd === 'S') ? 2 * curX - lastCpX : curX;
          const cp1y = (lastCmd === 'C' || lastCmd === 'S') ? 2 * curY - lastCpY : curY;
          const cp2x = tokens[i++] as number, cp2y = tokens[i++] as number;
          const ex = tokens[i++] as number, ey = tokens[i++] as number;
          cubicTo(cp1x, cp1y, cp2x, cp2y, ex, ey);
          lastCmd = 'S';
        }
        break;
      case 'Q':
        while (i < tokens.length && typeof tokens[i] === 'number') {
          const cpx = tokens[i++] as number, cpy = tokens[i++] as number;
          const ex = tokens[i++] as number, ey = tokens[i++] as number;
          quadTo(cpx, cpy, ex, ey);
        }
        break;
      case 'T':
        while (i < tokens.length && typeof tokens[i] === 'number') {
          const cpx = (lastCmd === 'Q' || lastCmd === 'T') ? 2 * curX - lastCpX : curX;
          const cpy = (lastCmd === 'Q' || lastCmd === 'T') ? 2 * curY - lastCpY : curY;
          const ex = tokens[i++] as number, ey = tokens[i++] as number;
          quadTo(cpx, cpy, ex, ey);
          lastCmd = 'T';
        }
        break;
      case 'A':
        // SVG arc: rx ry x-rotation large-arc-flag sweep-flag x y
        while (i < tokens.length && typeof tokens[i] === 'number') {
          const rx = tokens[i++] as number, ry = tokens[i++] as number;
          const xRot = tokens[i++] as number;
          const largeArc = tokens[i++] as number;
          const sweep = tokens[i++] as number;
          const ex = tokens[i++] as number, ey = tokens[i++] as number;
          convertSVGArc(curX, curY, rx, ry, xRot, largeArc, sweep, ex, ey, segments);
          curX = ex; curY = ey;
        }
        break;
      case 'Z':
      case 'z':
        if (curX !== moveX || curY !== moveY) {
          lineTo(moveX, moveY);
        }
        curX = moveX; curY = moveY;
        break;
      default:
        while (i < tokens.length && typeof tokens[i] === 'number') i++;
        break;
    }
    if (cmd !== 'S' && cmd !== 'T') lastCmd = cmd as string;
  }
  return segments;
}

/**
 * Convert an SVG arc command to a PathSegment.
 * All arcs in figure SVGs are circular quarter circles — compute center
 * directly from the SVG spec endpoint-to-center algorithm.
 */
function convertSVGArc(
  x1: number, y1: number, rx: number, ry: number,
  xRot: number, largeArc: number, sweep: number,
  x2: number, y2: number, out: RawSeg[],
): void {
  const dx = x2 - x1, dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1e-6 || rx < 1e-6 || ry < 1e-6) {
    out.push({ kind: 'line', start: [x1, y1], end: [x2, y2] });
    return;
  }

  // SVG spec endpoint-to-center conversion
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = xRot * Math.PI / 180;
  const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
  const x1p = cosPhi * (x1 - x2) / 2 + sinPhi * (y1 - y2) / 2;
  const y1p = -sinPhi * (x1 - x2) / 2 + cosPhi * (y1 - y2) / 2;

  let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }

  const num = Math.max(0, rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p);
  const denom = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const sq = denom > 0 ? Math.sqrt(num / denom) : 0;
  const sign = (largeArc === sweep) ? -1 : 1;
  const cxp = sign * sq * (rx * y1p / ry);
  const cyp = sign * sq * -(ry * x1p / rx);
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  out.push({ kind: 'arc', start: [x1, y1], end: [x2, y2], center: [cx, cy] });
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

/** Tokenize an SVG path d string into commands and numbers. */
function tokenizePath(d: string): (string | number)[] {
  const tokens: (string | number)[] = [];
  const re = /([MLHVCSQTAZmlhvcsqtaz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(d)) !== null) {
    if (match[1]) tokens.push(match[1]);
    else if (match[2]) tokens.push(parseFloat(match[2]));
  }
  return tokens;
}
