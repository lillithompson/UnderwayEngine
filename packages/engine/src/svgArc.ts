// An SVG elliptical arc — path data's `A` — turned from the endpoints it is
// written with into the centre, radii and angles it is drawn from, in ONE
// place: the conversion the SVG 1.1 implementation notes give (F.6.5, with
// F.6.6's radii made positive and scaled up when the ends are too far apart
// for them). Three readers draw an arc, each its own way and each from this:
// the picture geometry (the editor's formats/svgImageGeometry) samples it to
// chords, the figure bake (figureToPaths) makes it the engine's circular arc
// segments, or lines for an ellipse, and the SVG simplifier (simplifySVG)
// writes it as the cubics that draw it. svgPathData.ts reads the command
// itself.
//
// Imports nothing, so a script can compile it from its TypeScript alone
// (scripts that read the simplifier that way serve it this module too).

/**
 * An arc in centre form. Its point at angle t is the ellipse's
 * `(cx, cy) + R(φ)·(rx cos t, ry sin t)` ({@link svgArcPoint}), and it runs
 * from `theta1` through `dTheta`: positive is the way of increasing angle,
 * which on a screen (y down) is clockwise, the sweep flag's way.
 */
export interface SvgArcCentre {
  cx: number;
  cy: number;
  /** The radii as drawn: made positive, and scaled up together when the
   *  ends are too far apart for the radii written. */
  rx: number;
  ry: number;
  /** The cosine and sine of the x-axis rotation φ. */
  cosPhi: number;
  sinPhi: number;
  /** Start angle and signed sweep, radians. */
  theta1: number;
  dTheta: number;
}

/**
 * An arc from (x1, y1) to (x2, y2) as SVG writes it, in centre form. Null
 * when the spec draws it as a straight line or not at all — a radius of zero
 * (below 1e-9) or ends that are the same point — for the caller to draw as
 * its line to the end. Radii and rotation are as written (a negative radius
 * is the same as its positive, as the spec says); data that is not a number
 * reads through as NaN.
 */
export function svgArcCentre(
  x1: number, y1: number, rx: number, ry: number, rotationDeg: number,
  largeArc: boolean, sweep: boolean, x2: number, y2: number,
): SvgArcCentre | null {
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx < 1e-9 || ry < 1e-9 || (x1 === x2 && y1 === y2)) return null;
  const phi = (rotationDeg * Math.PI) / 180;
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
  const coef = (largeArc === sweep ? -1 : 1) * (den > 0 ? Math.sqrt(num / den) : 0);
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
  return { cx, cy, rx, ry, cosPhi: cosP, sinPhi: sinP, theta1, dTheta };
}

/** The arc's ellipse at angle t. */
export function svgArcPoint(arc: SvgArcCentre, t: number): [number, number] {
  const ex = arc.rx * Math.cos(t), ey = arc.ry * Math.sin(t);
  return [arc.cosPhi * ex - arc.sinPhi * ey + arc.cx, arc.sinPhi * ex + arc.cosPhi * ey + arc.cy];
}

/**
 * How many equal pieces an arc's sweep takes so that none turns through
 * more than `maxTurn` radians: at least one, and an exact multiple of
 * `maxTurn` is that many, not one more. Zero for a sweep that is not a
 * number.
 */
export function svgArcPieces(arc: SvgArcCentre, maxTurn: number): number {
  const n = Math.ceil(Math.abs(arc.dTheta) / maxTurn - 1e-9);
  return n >= 1 ? n : Number.isNaN(n) ? 0 : 1;
}

/**
 * The arc as the cubic Béziers that draw it, one to each quarter turn or
 * less, as `[x1, y1, x2, y2, x, y]` six numbers a cubic (its two control
 * points and its end), starting from (x1, y1). The first starts and the last
 * ends exactly on the arc's own ends. Each is the standard quarter-or-less
 * circle cubic (control arms 4/3·tan(Δ/4) of the radius) carried onto the
 * ellipse, which an affine map does exactly; a quarter turn strays from the
 * true curve by under 0.03% of its larger radius. Null where {@link svgArcCentre}
 * is, and for a sweep that is not a number: the caller's line to the end.
 */
export function svgArcToCubics(
  x1: number, y1: number, rx: number, ry: number, rotationDeg: number,
  largeArc: boolean, sweep: boolean, x2: number, y2: number,
): number[] | null {
  const arc = svgArcCentre(x1, y1, rx, ry, rotationDeg, largeArc, sweep, x2, y2);
  if (!arc) return null;
  const n = svgArcPieces(arc, Math.PI / 2);
  if (n === 0) return null;
  const step = arc.dTheta / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const { rx: a, ry: b, cosPhi: c, sinPhi: s } = arc;
  /** The ellipse's derivative at t, which a cubic's arm runs along. */
  const tangent = (t: number): [number, number] => {
    const dx = -a * Math.sin(t), dy = b * Math.cos(t);
    return [c * dx - s * dy, s * dx + c * dy];
  };
  const out: number[] = [];
  let px = x1, py = y1;
  let [tx, ty] = tangent(arc.theta1);
  for (let i = 1; i <= n; i++) {
    const t = arc.theta1 + (arc.dTheta * i) / n;
    const [ex, ey] = i === n ? [x2, y2] : svgArcPoint(arc, t);
    const [ux, uy] = tangent(t);
    out.push(px + k * tx, py + k * ty, ex - k * ux, ey - k * uy, ex, ey);
    px = ex; py = ey; tx = ux; ty = uy;
  }
  return out;
}
