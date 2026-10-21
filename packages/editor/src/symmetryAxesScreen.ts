import { BASE_CELL_PX } from './cameraMath';
import type { SymmetryOverlayModel } from './canvasSymmetry';
import { HAIRLINE_PX } from './selectionOutline';
import type { Viewport } from '@/engine/types';

// The canvas-symmetry axis overlay — Facet's mirror lines — drawn in
// SCREEN space: a handful of <line>s in a viewport-sized <svg> beside the
// world layer, re-anchored through the camera on every pan/zoom frame
// (applyLiveCamera), exactly the way the paint veil is.
//
// It used to be DOM inside the camera-scaled world layer, its center axes
// and diagonals run 128 cells past the symmetry frame on every side so the
// mirror reads as canvas-wide. That extent became the WORLD LAYER'S OWN
// bounds: a compositing layer thousands of CSS px on a side, a ~300 MB
// backing store (Web Inspector's Layers panel: one div, 302 MB of a 328 MB
// page). And its hairlines counter-scaled through `var(--cj-zoom-inv)`, so
// every zoom frame re-styled them, repainting lines that crossed the whole
// giant layer — a fresh 300 MB buffer per frame, ~400 MB/s of IOSurface
// until iOS killed the WebContent process at ~1.7 GB (the device log:
// footprint 1765 MB, resident 163 MB). Screen-space lines cost nothing at
// any zoom, never widen the world layer, and repaint only a viewport-sized
// overlay of their own.
//
// The same drawing: the accent-coloured center axes (solid where the axis
// rides a cell border, dashed where it bisects cells — Facet's semantic),
// dimmer within-half quarter lines for quad / row / col that keep to the
// frame, and always-dashed diagonals through the center. Center axes and
// diagonals span the whole view; the dash rhythm is world px so the dashes
// stick to the grid like the axes themselves.

/** Facet's mirror-overlay accent (#38BDF8 at its 0.7 line alpha). */
export const AXIS_COLOR = 'rgba(56,189,248,0.7)';
export const QUARTER_COLOR = 'rgba(56,189,248,0.35)';
export const DIAG_COLOR = 'rgba(56,189,248,0.5)';

/** The world layer's transform, as worldLayerTransform hands it out:
 *  screen = translate + world px × scale. */
export interface WorldTransform {
  translateX: number;
  translateY: number;
  scale: number;
}

/** One line to draw, in screen px. `dash` is the dash period in screen px
 *  (half on, half off), null for a solid line; `dashOffset` phases the
 *  pattern so dashes stay glued to the world grid while the view moves. */
export interface AxisSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  dash: number | null;
  dashOffset: number;
}

/** The screen-px stroke every axis is drawn with — a hairline at any zoom,
 *  with no counter-scaling to keep in step, since nothing here is scaled. */
export const AXIS_STROKE_PX = HAIRLINE_PX;

const mod = (a: number, m: number): number => ((a % m) + m) % m;

/**
 * The lines the overlay draws for `model`, mapped through the world
 * transform `t` onto a `viewport`-sized screen. Lines that miss the view
 * are dropped; center axes and diagonals are clipped to the view's edges,
 * quarter lines to the frame. Empty when the scale is not positive.
 */
export function symmetryAxisSegments(
  model: SymmetryOverlayModel,
  t: WorldTransform,
  viewport: Viewport,
): AxisSegment[] {
  if (!(t.scale > 0)) return [];
  if (model.bounded && model.angleDeg) return turnedBoundedSegments(model, t);
  const vw = viewport.width;
  const vh = viewport.height;
  const sx = (cellX: number) => t.translateX + cellX * BASE_CELL_PX * t.scale;
  const sy = (cellY: number) => t.translateY + cellY * BASE_CELL_PX * t.scale;
  const period = model.dashPeriod * BASE_CELL_PX * t.scale;
  const f = model.frame;
  const out: AxisSegment[] = [];
  // The box a line may run across: the view — or, for a pattern-scoped
  // mirror (model.bounded), the frame's own screen rect within the view,
  // so no axis runs past the pattern's edges. Quarter lines always keep
  // to the frame.
  const fx1 = Math.max(0, sx(f.cellX));
  const fx2 = Math.min(vw, sx(f.cellX + f.cellWidth));
  const fy1 = Math.max(0, sy(f.cellY));
  const fy2 = Math.min(vh, sy(f.cellY + f.cellHeight));
  const bx1 = model.bounded ? fx1 : 0;
  const bx2 = model.bounded ? fx2 : vw;
  const by1 = model.bounded ? fy1 : 0;
  const by2 = model.bounded ? fy2 : vh;
  if (bx2 <= bx1 || by2 <= by1) return [];

  for (const l of model.lines) {
    const color = l.quarter ? QUARTER_COLOR : AXIS_COLOR;
    const dash = l.dashed ? period : null;
    if (l.kind === 'v') {
      const x = sx(l.at);
      if (x < bx1 - AXIS_STROKE_PX || x > bx2 + AXIS_STROKE_PX) continue;
      const y1 = l.quarter ? fy1 : by1;
      const y2 = l.quarter ? fy2 : by2;
      if (y2 <= y1) continue;
      // Phase from the world's y = 0 down to where this segment starts.
      out.push({ x1: x, y1, x2: x, y2, color, dash, dashOffset: dash ? mod(y1 - sy(0), dash) : 0 });
    } else {
      const y = sy(l.at);
      if (y < by1 - AXIS_STROKE_PX || y > by2 + AXIS_STROKE_PX) continue;
      const x1 = l.quarter ? fx1 : bx1;
      const x2 = l.quarter ? fx2 : bx2;
      if (x2 <= x1) continue;
      out.push({ x1, y1: y, x2, y2: y, color, dash, dashOffset: dash ? mod(x1 - sx(0), dash) : 0 });
    }
  }

  // Diagonals through the frame center, ±45° in the world — which is ±45°
  // on screen too, the world being uniformly scaled. Each is the infinite
  // line clipped to the box; dashes phase from the center outward.
  const cx = sx(f.cellX + f.cellWidth / 2);
  const cy = sy(f.cellY + f.cellHeight / 2);
  const diagPeriod = period * Math.SQRT2;
  const diagonal = (slope: 1 | -1) => {
    // y = cy + slope · (x − cx); walk x across the box and clip to y.
    let xa = bx1;
    let xb = bx2;
    const yAt = (x: number) => cy + slope * (x - cx);
    const xAt = (y: number) => cx + slope * (y - cy);
    // Clip against the top and bottom edges by solving for x.
    const xs = [xa, xb, xAt(by1), xAt(by2)].filter((x) => x >= bx1 && x <= bx2 && yAt(x) >= by1 - 1e-9 && yAt(x) <= by2 + 1e-9);
    if (xs.length < 2) return;
    xa = Math.min(...xs);
    xb = Math.max(...xs);
    if (xb - xa < 1e-6) return;
    const x1 = xa; const y1 = yAt(xa); const x2 = xb; const y2 = yAt(xb);
    const fromCenter = Math.hypot(x1 - cx, y1 - cy) * (x1 < cx ? -1 : 1);
    out.push({ x1, y1, x2, y2, color: DIAG_COLOR, dash: diagPeriod, dashOffset: mod(fromCenter, diagPeriod) });
  };
  if (model.diag1) diagonal(1);
  if (model.diag2) diagonal(-1);
  return out;
}

/**
 * A bounded model TURNED with its pattern: every line is a segment across
 * the frame in the grid's own (unrotated) frame — centre axes edge to edge,
 * quarter lines the same, diagonals corner-ward to where they leave the
 * box — rotated about the frame's centre by the pattern's angle and then
 * projected to the screen. Nothing is clipped to the view (the lines never
 * leave the pattern's box, and the <svg> clips what leaves the screen);
 * dashes phase from each segment's start, in world px.
 */
function turnedBoundedSegments(model: SymmetryOverlayModel, t: WorldTransform): AxisSegment[] {
  const f = model.frame;
  const cx = f.cellX + f.cellWidth / 2;
  const cy = f.cellY + f.cellHeight / 2;
  const rad = ((model.angleDeg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const period = model.dashPeriod * BASE_CELL_PX * t.scale;
  // World cells (unrotated) → turned about the centre → screen px.
  const project = (x: number, y: number): [number, number] => {
    const dx = x - cx;
    const dy = y - cy;
    const wx = cx + dx * cos - dy * sin;
    const wy = cy + dx * sin + dy * cos;
    return [t.translateX + wx * BASE_CELL_PX * t.scale, t.translateY + wy * BASE_CELL_PX * t.scale];
  };
  const out: AxisSegment[] = [];
  const push = (ax: number, ay: number, bx: number, by: number, color: string, dash: number | null) => {
    const [x1, y1] = project(ax, ay);
    const [x2, y2] = project(bx, by);
    out.push({ x1, y1, x2, y2, color, dash, dashOffset: 0 });
  };
  for (const l of model.lines) {
    const color = l.quarter ? QUARTER_COLOR : AXIS_COLOR;
    const dash = l.dashed ? period : null;
    if (l.kind === 'v') {
      if (l.at < f.cellX || l.at > f.cellX + f.cellWidth) continue;
      push(l.at, f.cellY, l.at, f.cellY + f.cellHeight, color, dash);
    } else {
      if (l.at < f.cellY || l.at > f.cellY + f.cellHeight) continue;
      push(f.cellX, l.at, f.cellX + f.cellWidth, l.at, color, dash);
    }
  }
  // Diagonals through the centre at ±45° in the grid's frame, clipped to
  // the box: the reach is the shorter half-extent.
  const r = Math.min(f.cellWidth, f.cellHeight) / 2;
  const diagPeriod = period * Math.SQRT2;
  if (model.diag1) push(cx - r, cy - r, cx + r, cy + r, DIAG_COLOR, diagPeriod);
  if (model.diag2) push(cx - r, cy + r, cx + r, cy - r, DIAG_COLOR, diagPeriod);
  return out;
}

/** The minimum of an SVG <line> element the writer touches. */
export interface AxisLineElement {
  setAttribute(name: string, value: string): void;
  remove(): void;
}

/** The minimum of the <g> the writer draws into. */
export interface AxisGroupElement {
  readonly children: ArrayLike<AxisLineElement>;
  appendChild(el: AxisLineElement): void;
  createLine(): AxisLineElement;
}

/**
 * Write `segments` into `group` as <line> children, reusing the ones there
 * (created once through `group.createLine`, removed when fewer are needed)
 * — no allocation on the pan/zoom path once the count is stable.
 */
export function writeSymmetryAxes(group: AxisGroupElement, segments: readonly AxisSegment[]): void {
  while (group.children.length > segments.length) group.children[group.children.length - 1].remove();
  while (group.children.length < segments.length) group.appendChild(group.createLine());
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const el = group.children[i];
    el.setAttribute('x1', String(s.x1));
    el.setAttribute('y1', String(s.y1));
    el.setAttribute('x2', String(s.x2));
    el.setAttribute('y2', String(s.y2));
    el.setAttribute('stroke', s.color);
    el.setAttribute('stroke-width', String(AXIS_STROKE_PX));
    if (s.dash) {
      el.setAttribute('stroke-dasharray', `${s.dash / 2} ${s.dash / 2}`);
      el.setAttribute('stroke-dashoffset', String(s.dashOffset));
    } else {
      el.setAttribute('stroke-dasharray', 'none');
      el.setAttribute('stroke-dashoffset', '0');
    }
  }
}

/** Wrap a real SVG <g> for {@link writeSymmetryAxes}. */
export function axisGroupOf(g: SVGGElement): AxisGroupElement {
  return {
    get children() { return g.children as unknown as ArrayLike<AxisLineElement>; },
    appendChild: (el) => { g.appendChild(el as unknown as Node); },
    createLine: () => g.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'line') as unknown as AxisLineElement,
  };
}
