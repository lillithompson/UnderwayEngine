import type { ImageObject, PathSegment } from '@/engine/types';
import { coverImageRect, effectiveFraming, straightenCoverScale } from '@/engine/imageFraming';

// The GEOMETRY of an SVG picture placed on a page as an ImageObject — the
// outlines its `<path>`s draw, in WORLD cells, laid where the picture is
// actually drawn. Adrift's template ships its bottle and the bottle's
// interior as two such pictures (pageTemplate.ts): the Mask picture's one
// closed shape is where the words must go and the Bottle picture's lines
// are what the scattered words must not cross, and neither can be read off
// the bitmap the canvas paints. So the document is read as vector data:
// every shape element is flattened to a polyline in the document's viewBox
// units, then mapped through the rectangle the picture's framing draws its
// bitmap into (the Crop bar's Fill / Fit / Crop — imageFraming.ts, the same
// math the export and the canvas use).
//
// Deliberately a reader of DRAWINGS, not a general SVG engine: shape
// elements only (path, line, polyline, polygon, rect, circle, ellipse), no
// element transforms, no nested viewports, curves sampled to short chords.
// The picture's own rotation and mirror are not applied either — the
// template pictures this serves are locked, axis-aligned art — and a Tile
// framing has no single drawn rectangle to map through, so it yields no
// geometry at all.

/** One flattened shape, in the units of whatever space it was read in:
 *  `points` is [x0, y0, x1, y1, …]; `closed` when the shape closes on its
 *  first point (a `Z`, a polygon, a rect, a circle). */
export interface SvgPolyline {
  points: number[];
  closed: boolean;
}

export interface SvgViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Chords per curve. A cubic is the long, free curve of an illustration;
 *  the rest are short and regular. Fine enough that a chord never strays a
 *  visible fraction of a cell from the drawn curve at page scale, coarse
 *  enough that a whole bottle is a few hundred edges for the word scatter
 *  to test against. */
const CUBIC_SAMPLES = 16;
const QUAD_SAMPLES = 10;
const ARC_SAMPLES = 16;
const ELLIPSE_SAMPLES = 32;

/** The root's `viewBox`, or its `width`/`height` when it has none. Null for
 *  a document that declares neither (nothing to map coordinates through). */
export function parseSvgViewBox(svg: string): SvgViewBox | null {
  const root = svg.match(/<svg\b[^>]*>/);
  if (!root) return null;
  const vb = attr(root[0], 'viewBox');
  if (vb) {
    const nums = vb.trim().split(/[\s,]+/).map(Number);
    if (nums.length === 4 && nums.every(Number.isFinite) && nums[2] > 0 && nums[3] > 0) {
      return { x: nums[0], y: nums[1], width: nums[2], height: nums[3] };
    }
  }
  const w = parseFloat(attr(root[0], 'width') ?? '');
  const h = parseFloat(attr(root[0], 'height') ?? '');
  return w > 0 && h > 0 ? { x: 0, y: 0, width: w, height: h } : null;
}

/** An attribute's raw value (either quote style), or undefined. */
function attr(el: string, name: string): string | undefined {
  const m = el.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`));
  return m ? (m[1] ?? m[2]) : undefined;
}

function num(el: string, name: string, fallback = 0): number {
  const v = parseFloat(attr(el, name) ?? '');
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Every shape element of the document, flattened, in viewBox units. Element
 * order is document order; a `<path>` with several subpaths yields one
 * polyline per subpath.
 */
export function svgPolylines(svg: string): SvgPolyline[] {
  const out: SvgPolyline[] = [];
  const re = /<(path|line|polyline|polygon|rect|circle|ellipse)\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    const el = m[0];
    switch (m[1]) {
      case 'path': {
        const d = attr(el, 'd');
        if (d) out.push(...pathPolylines(d));
        break;
      }
      case 'line':
        out.push({ points: [num(el, 'x1'), num(el, 'y1'), num(el, 'x2'), num(el, 'y2')], closed: false });
        break;
      case 'polyline':
      case 'polygon': {
        const points = (attr(el, 'points') ?? '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
        if (points.length >= 4) out.push({ points: points.slice(0, points.length - (points.length % 2)), closed: m[1] === 'polygon' });
        break;
      }
      case 'rect': {
        const x = num(el, 'x'), y = num(el, 'y'), w = num(el, 'width'), h = num(el, 'height');
        if (w > 0 && h > 0) out.push({ points: [x, y, x + w, y, x + w, y + h, x, y + h], closed: true });
        break;
      }
      case 'circle':
      case 'ellipse': {
        const cx = num(el, 'cx'), cy = num(el, 'cy');
        const rx = m[1] === 'circle' ? num(el, 'r') : num(el, 'rx');
        const ry = m[1] === 'circle' ? rx : num(el, 'ry');
        if (rx > 0 && ry > 0) {
          const points: number[] = [];
          for (let i = 0; i < ELLIPSE_SAMPLES; i++) {
            const a = (2 * Math.PI * i) / ELLIPSE_SAMPLES;
            points.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
          }
          out.push({ points, closed: true });
        }
        break;
      }
    }
  }
  return out;
}

/** Tokenize a path `d` string into command letters and numbers. */
function tokenizePathData(d: string): (string | number)[] {
  const tokens: (string | number)[] = [];
  const re = /([MLHVCSQTAZmlhvcsqtaz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) tokens.push(m[1]);
    else tokens.push(parseFloat(m[2]));
  }
  return tokens;
}

/**
 * A path's `d` data as polylines, one per subpath. Every command the spec
 * defines, absolute and relative; curves are sampled into chords (see the
 * sample counts above). Implicit repeats (`M x y x y`, `L x y x y`) are
 * honoured, as is the rule that an `M`'s extra pairs are `L`s.
 */
export function pathPolylines(d: string): SvgPolyline[] {
  const out: SvgPolyline[] = [];
  const tokens = tokenizePathData(d);
  let points: number[] = [];
  let closed = false;
  let cx = 0, cy = 0;       // current point
  let sx = 0, sy = 0;       // subpath start
  let lcx = 0, lcy = 0;     // last control point (for S / T reflection)
  let lastCmd = '';
  let i = 0;

  const flush = () => {
    if (points.length >= 4) out.push({ points, closed });
    points = [];
    closed = false;
  };
  const moveTo = (x: number, y: number) => {
    flush();
    cx = sx = x;
    cy = sy = y;
    points.push(x, y);
  };
  const lineTo = (x: number, y: number) => {
    if (points.length === 0) points.push(cx, cy);
    points.push(x, y);
    cx = x;
    cy = y;
  };
  const cubicTo = (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => {
    const x0 = cx, y0 = cy;
    for (let k = 1; k <= CUBIC_SAMPLES; k++) {
      const t = k / CUBIC_SAMPLES, u = 1 - t;
      lineTo(
        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
      );
    }
    lcx = x2;
    lcy = y2;
  };
  const quadTo = (x1: number, y1: number, x: number, y: number) => {
    const x0 = cx, y0 = cy;
    for (let k = 1; k <= QUAD_SAMPLES; k++) {
      const t = k / QUAD_SAMPLES, u = 1 - t;
      lineTo(u * u * x0 + 2 * u * t * x1 + t * t * x, u * u * y0 + 2 * u * t * y1 + t * t * y);
    }
    lcx = x1;
    lcy = y1;
  };
  const hasNum = () => i < tokens.length && typeof tokens[i] === 'number';
  const next = () => tokens[i++] as number;

  while (i < tokens.length) {
    const tok = tokens[i];
    if (typeof tok === 'number') { i++; continue; }
    i++;
    const cmd = tok.toUpperCase();
    const rel = tok !== cmd;
    const ox = () => (rel ? cx : 0);
    const oy = () => (rel ? cy : 0);
    switch (cmd) {
      case 'M': {
        if (!hasNum()) break;
        moveTo(ox() + next(), oy() + next());
        while (hasNum()) lineTo(ox() + next(), oy() + next());
        break;
      }
      case 'L':
        while (hasNum()) lineTo(ox() + next(), oy() + next());
        break;
      case 'H':
        while (hasNum()) lineTo(ox() + next(), cy);
        break;
      case 'V':
        while (hasNum()) lineTo(cx, oy() + next());
        break;
      case 'C':
        while (hasNum()) {
          const x1 = ox() + next(), y1 = oy() + next();
          const x2 = ox() + next(), y2 = oy() + next();
          cubicTo(x1, y1, x2, y2, ox() + next(), oy() + next());
        }
        break;
      case 'S':
        while (hasNum()) {
          const reflect = lastCmd === 'C' || lastCmd === 'S';
          const x1 = reflect ? 2 * cx - lcx : cx, y1 = reflect ? 2 * cy - lcy : cy;
          const x2 = ox() + next(), y2 = oy() + next();
          cubicTo(x1, y1, x2, y2, ox() + next(), oy() + next());
          lastCmd = 'S';
        }
        break;
      case 'Q':
        while (hasNum()) {
          const x1 = ox() + next(), y1 = oy() + next();
          quadTo(x1, y1, ox() + next(), oy() + next());
        }
        break;
      case 'T':
        while (hasNum()) {
          const reflect = lastCmd === 'Q' || lastCmd === 'T';
          const x1 = reflect ? 2 * cx - lcx : cx, y1 = reflect ? 2 * cy - lcy : cy;
          quadTo(x1, y1, ox() + next(), oy() + next());
          lastCmd = 'T';
        }
        break;
      case 'A':
        while (hasNum()) {
          const rx = next(), ry = next(), rot = next();
          const large = next() !== 0, sweep = next() !== 0;
          const x = ox() + next(), y = oy() + next();
          for (const [px, py] of arcPoints(cx, cy, rx, ry, rot, large, sweep, x, y)) lineTo(px, py);
          lineTo(x, y);
        }
        break;
      case 'Z':
        closed = true;
        flush();
        cx = sx;
        cy = sy;
        break;
    }
    if (cmd !== 'S' && cmd !== 'T') lastCmd = cmd;
  }
  flush();
  return out;
}

/**
 * Interior sample points of an SVG elliptical arc (the spec's endpoint →
 * centre conversion, F.6.5), excluding both endpoints. A degenerate arc
 * (zero radius, coincident ends) samples to nothing — the caller's line to
 * the endpoint is then the whole of it.
 */
function arcPoints(
  x1: number, y1: number, rx: number, ry: number, rotDeg: number,
  large: boolean, sweep: boolean, x2: number, y2: number,
): [number, number][] {
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx < 1e-9 || ry < 1e-9 || (x1 === x2 && y1 === y2)) return [];
  const phi = (rotDeg * Math.PI) / 180;
  const cosP = Math.cos(phi), sinP = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const num = Math.max(0, rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p);
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (large === sweep ? -1 : 1) * (den > 0 ? Math.sqrt(num / den) : 0);
  const cxp = coef * ((rx * y1p) / ry);
  const cyp = coef * (-(ry * x1p) / rx);
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  else if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
  const pts: [number, number][] = [];
  for (let k = 1; k < ARC_SAMPLES; k++) {
    const t = theta1 + (dTheta * k) / ARC_SAMPLES;
    const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
    pts.push([cosP * ex - sinP * ey + cx, sinP * ex + cosP * ey + cy]);
  }
  return pts;
}

/**
 * The world rectangle an image's FULL bitmap is drawn into — the box the
 * document's viewBox maps onto. Fill and Crop draw the cover-scaled bitmap
 * centred and panned, overflowing the bbox where it is clipped
 * (imageFraming.coverImageRect); Fit letterboxes it inside the margin. A node
 * with no framing record reads as the plain cover it is drawn with
 * (effectiveFraming) — it is NOT stretched to the bbox, which is what the
 * retired `preserveAspectRatio="none"` draw did. Null for a Tile framing.
 */
export function imageContentRect(
  img: Pick<ImageObject, 'cellX' | 'cellY' | 'cellWidth' | 'cellHeight' | 'pixelWidth' | 'pixelHeight' | 'framing'>,
): { x: number; y: number; w: number; h: number } | null {
  const iw = img.cellWidth, ih = img.cellHeight;
  const aspect = img.pixelWidth > 0 && img.pixelHeight > 0
    ? img.pixelWidth / img.pixelHeight
    : (ih > 0 ? iw / ih : 1);
  const f = effectiveFraming(img.framing);
  if (f.mode === 'tile') return null;
  if (f.mode === 'fit') {
    const m = Math.min(f.margin, Math.min(iw, ih) / 2);
    const bw = Math.max(0, iw - 2 * m), bh = Math.max(0, ih - 2 * m);
    const s = Math.min(bw / aspect, bh);
    const w = aspect * s, h = s;
    return { x: img.cellX + m + (bw - w) / 2, y: img.cellY + m + (bh - h) / 2, w, h };
  }
  const scale = f.mode === 'crop' ? straightenCoverScale(f.angle, iw, ih) : f.zoom;
  const r = coverImageRect(iw, ih, aspect, scale, f.offsetX, f.offsetY);
  return { x: img.cellX + r.x, y: img.cellY + r.y, w: r.w, h: r.h };
}

/**
 * The shapes an SVG picture draws, in WORLD cells: the document's polylines
 * mapped from its viewBox onto the rectangle the image is drawn into. The
 * viewBox is fitted to that rectangle edge to edge — exact for an image
 * whose stored pixel size keeps the document's aspect (the import derives
 * one from the other), and out by the rounding of that size otherwise.
 * Empty for a document with no viewBox, or an image whose framing draws no
 * one rectangle (Tile).
 */
export function svgImageWorldPolylines(
  img: Parameters<typeof imageContentRect>[0],
  svg: string,
): SvgPolyline[] {
  const vb = parseSvgViewBox(svg);
  const rect = imageContentRect(img);
  if (!vb || !rect) return [];
  const sx = rect.w / vb.width;
  const sy = rect.h / vb.height;
  return svgPolylines(svg).map(({ points, closed }) => {
    const mapped = new Array<number>(points.length);
    for (let i = 0; i < points.length; i += 2) {
      mapped[i] = rect.x + (points[i] - vb.x) * sx;
      mapped[i + 1] = rect.y + (points[i + 1] - vb.y) * sy;
    }
    return { points: mapped, closed };
  });
}

/** A polyline as engine line segments — consecutive, endpoint-sharing, and
 *  (for a closed one) returning exactly to its first point, so the engine's
 *  loop chaining (pointInClosedPath) recognizes the ring. Repeated points
 *  are skipped; a closing point the data already carries is not doubled. */
export function polylineSegments(poly: SvgPolyline): PathSegment[] {
  const p = poly.points;
  const segs: PathSegment[] = [];
  let x = p[0], y = p[1];
  for (let i = 2; i < p.length; i += 2) {
    const nx = p[i], ny = p[i + 1];
    if (nx === x && ny === y) continue;
    segs.push({ kind: 'line', start: [x, y], end: [nx, ny] });
    x = nx;
    y = ny;
  }
  if (poly.closed && segs.length > 0 && (x !== p[0] || y !== p[1])) {
    segs.push({ kind: 'line', start: [x, y], end: [p[0], p[1]] });
  }
  return segs;
}

/** Axis-aligned area of a polyline's points (its bbox's area) — a cheap
 *  "how big is this shape" for picking the largest of several. */
export function polylineBboxArea(poly: SvgPolyline): number {
  const p = poly.points;
  if (p.length < 2) return 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    x0 = Math.min(x0, p[i]);
    x1 = Math.max(x1, p[i]);
    y0 = Math.min(y0, p[i + 1]);
    y1 = Math.max(y1, p[i + 1]);
  }
  return (x1 - x0) * (y1 - y0);
}
