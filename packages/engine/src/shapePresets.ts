/**
 * Parametric shape presets for the composition editor. Authoring sugar
 * only: each preset generates plain `SVGObject` geometry (PathSegment
 * loops in L0-cell space) — no new node kind, so every downstream path
 * (fills, boolean ops, join, export, hit-test) works unchanged.
 *
 * Invariant: every preset returns a CLOSED loop — segment[i].end is the
 * same coordinates as segment[i+1].start and the last end equals the
 * first start. Fills and boolean ops depend on this, so point values are
 * computed once and shared between adjacent segments.
 *
 * Arc segments are circular (see PathSegment), so rounded corners use a
 * single radius and non-square ellipses fall back to a polyline.
 */

import { PathSegment, RGBColor, Paint, SVGObject } from './types';
import { computeRectSegments } from './compositionLineBboxMath';
import { computeCircleSegments } from './compositionArcMath';
import type { Bbox } from './sceneNodeGeometry';

export type ShapePresetKind =
  | 'rect'
  | 'roundedRect'
  | 'ellipse'
  | 'star'
  | 'banner'
  | 'speechBubble'
  | 'comicFrame';

export interface ShapePresetOptions {
  /** roundedRect / speechBubble corner radius in L0 cells. Clamped to
   *  half the short side (arcs are circular — one radius). */
  radius?: number;
  /** star: number of points (default 5, min 3). */
  points?: number;
  /** star: inner vertex radius as a fraction of the outer (default 0.45). */
  innerRatio?: number;
  /** banner: chevron notch depth in L0 cells (default 20% of width),
   *  clamped to half the width. */
  notchDepth?: number;
  /** speechBubble: which bottom corner the tail points toward. */
  tailCorner?: 'bottomLeft' | 'bottomRight';
}

/** Line segments count used for the non-square ellipse approximation. */
const ELLIPSE_POLYLINE_SEGMENTS = 32;

/** Fraction of bbox height reserved for the speech-bubble tail. */
const BUBBLE_TAIL_HEIGHT_FRAC = 0.25;

/** Chain a point loop into line segments, closing last→first. Adjacent
 *  segments share the exact same point values so closure is exact.
 *  Zero-length runs are skipped (degenerate option values). */
function loopToSegments(points: [number, number][]): PathSegment[] {
  const segs: PathSegment[] = [];
  for (let i = 0; i < points.length; i++) {
    const start = points[i];
    const end = points[(i + 1) % points.length];
    if (start[0] === end[0] && start[1] === end[1]) continue;
    segs.push({ kind: 'line', start, end });
  }
  return segs;
}

/** Rounded rect between (x0,y0)-(x1,y1) with corner radius r, clockwise.
 *  Shared by roundedRect and the speech-bubble body (which splices a tail
 *  into the bottom edge via `bottomEdgePoints`). */
function roundedRectSegments(
  x0: number, y0: number, x1: number, y1: number, r: number,
  bottomEdgePoints?: [number, number][],
): PathSegment[] {
  if (r <= 0) {
    // Degenerate radius: plain quad, still honoring any tail waypoints
    // (bottom edge runs right→left in the clockwise loop).
    return loopToSegments([
      [x0, y0], [x1, y0], [x1, y1],
      ...(bottomEdgePoints ?? []),
      [x0, y1],
    ]);
  }
  const segs: PathSegment[] = [];
  const a: [number, number] = [x0 + r, y0];
  const b: [number, number] = [x1 - r, y0];
  const c: [number, number] = [x1, y0 + r];
  const d: [number, number] = [x1, y1 - r];
  const e: [number, number] = [x1 - r, y1];
  const f: [number, number] = [x0 + r, y1];
  const g: [number, number] = [x0, y1 - r];
  const h: [number, number] = [x0, y0 + r];
  const pushLine = (start: [number, number], end: [number, number]) => {
    if (start[0] !== end[0] || start[1] !== end[1]) segs.push({ kind: 'line', start, end });
  };
  pushLine(a, b);
  segs.push({ kind: 'arc', start: b, end: c, center: [x1 - r, y0 + r] });
  pushLine(c, d);
  segs.push({ kind: 'arc', start: d, end: e, center: [x1 - r, y1 - r] });
  // Bottom edge runs right→left; splice in tail waypoints when provided.
  let prev = e;
  for (const pt of bottomEdgePoints ?? []) {
    pushLine(prev, pt);
    prev = pt;
  }
  pushLine(prev, f);
  segs.push({ kind: 'arc', start: f, end: g, center: [x0 + r, y1 - r] });
  pushLine(g, h);
  segs.push({ kind: 'arc', start: h, end: a, center: [x0 + r, y0 + r] });
  return segs;
}

function starSegments(bbox: Bbox, points: number, innerRatio: number): PathSegment[] {
  const n = Math.max(3, Math.round(points));
  const ratio = Math.min(Math.max(innerRatio, 0.05), 0.95);
  // Unit star (radius 1, top point up), then affinely map its AABB onto
  // the bbox so the star exactly fills it regardless of point count.
  const raw: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const outerAngle = -Math.PI / 2 + (k * 2 * Math.PI) / n;
    const innerAngle = outerAngle + Math.PI / n;
    raw.push([Math.cos(outerAngle), Math.sin(outerAngle)]);
    raw.push([ratio * Math.cos(innerAngle), ratio * Math.sin(innerAngle)]);
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of raw) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const sx = bbox.cellWidth / (maxX - minX);
  const sy = bbox.cellHeight / (maxY - minY);
  const mapped: [number, number][] = raw.map(([x, y]) => [
    bbox.cellX + (x - minX) * sx,
    bbox.cellY + (y - minY) * sy,
  ]);
  return loopToSegments(mapped);
}

function bannerSegments(bbox: Bbox, notchDepth: number): PathSegment[] {
  const x0 = bbox.cellX, y0 = bbox.cellY;
  const x1 = x0 + bbox.cellWidth, y1 = y0 + bbox.cellHeight;
  const cy = y0 + bbox.cellHeight / 2;
  const n = Math.min(Math.max(notchDepth, 0), bbox.cellWidth / 2);
  return loopToSegments([
    [x0, y0], [x1, y0],       // top edge
    [x1 - n, cy],             // right chevron notch
    [x1, y1], [x0, y1],       // bottom edge
    [x0 + n, cy],             // left chevron notch
  ]);
}

function speechBubbleSegments(bbox: Bbox, radius: number | undefined, tailCorner: 'bottomLeft' | 'bottomRight'): PathSegment[] {
  const x0 = bbox.cellX, y0 = bbox.cellY;
  const w = bbox.cellWidth, h = bbox.cellHeight;
  const x1 = x0 + w;
  const y1 = y0 + h;
  const tailH = h * BUBBLE_TAIL_HEIGHT_FRAC;
  const yb = y1 - tailH; // bubble body bottom
  // Corner radius must leave room for the tail base on the bottom edge
  // (base fractions below start at 0.25 / end at 0.75 of the width).
  const rMax = Math.min(0.2 * w, (yb - y0) / 2);
  const r = Math.min(Math.max(radius ?? rMax, 0), rMax);
  // Bottom edge is traversed right→left; list waypoints in that order.
  const tail: [number, number][] = tailCorner === 'bottomLeft'
    ? [[x0 + 0.45 * w, yb], [x0 + 0.15 * w, y1], [x0 + 0.25 * w, yb]]
    : [[x0 + 0.75 * w, yb], [x0 + 0.85 * w, y1], [x0 + 0.55 * w, yb]];
  return roundedRectSegments(x0, y0, x1, yb, r, tail);
}

/**
 * Generate the closed segment loop for a preset shape filling `bbox`.
 * Geometry is in absolute L0 cells (same space as SVGObject segments).
 */
export function buildShapePreset(
  kind: ShapePresetKind,
  bbox: Bbox,
  options?: ShapePresetOptions,
): { segments: PathSegment[]; closed: true } {
  const x0 = bbox.cellX, y0 = bbox.cellY;
  const x1 = x0 + bbox.cellWidth, y1 = y0 + bbox.cellHeight;
  let segments: PathSegment[];
  switch (kind) {
    case 'rect':
    case 'comicFrame':
      // comicFrame is geometrically a plain rect; the panel-border look
      // comes from stroke width app-side.
      segments = computeRectSegments(x0, y0, x1, y1);
      break;
    case 'roundedRect': {
      const short = Math.min(bbox.cellWidth, bbox.cellHeight);
      const r = Math.min(Math.max(options?.radius ?? short / 4, 0), short / 2);
      segments = roundedRectSegments(x0, y0, x1, y1, r);
      break;
    }
    case 'ellipse':
      if (bbox.cellWidth === bbox.cellHeight) {
        // Square bbox: exact circle from 4 quarter arcs.
        segments = computeCircleSegments(x0, y0, x1, y1);
      } else {
        // Circular arcs cannot represent an ellipse; approximate with a
        // polyline. Start at -90° so all 4 cardinal points are sampled
        // (32 divides evenly) and the AABB exactly matches the bbox.
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        const rx = bbox.cellWidth / 2, ry = bbox.cellHeight / 2;
        const pts: [number, number][] = [];
        for (let i = 0; i < ELLIPSE_POLYLINE_SEGMENTS; i++) {
          const angle = -Math.PI / 2 + (i * 2 * Math.PI) / ELLIPSE_POLYLINE_SEGMENTS;
          pts.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]);
        }
        segments = loopToSegments(pts);
      }
      break;
    case 'star':
      segments = starSegments(bbox, options?.points ?? 5, options?.innerRatio ?? 0.45);
      break;
    case 'banner':
      segments = bannerSegments(bbox, options?.notchDepth ?? bbox.cellWidth * 0.2);
      break;
    case 'speechBubble':
      segments = speechBubbleSegments(bbox, options?.radius, options?.tailCorner ?? 'bottomLeft');
      break;
  }
  return { segments, closed: true };
}

/**
 * Assemble a complete SVGObject from a preset. The caller mints the id
 * (ids are minted by the reducer layer, mirroring every other add-node
 * path). The bbox is the world frame; preset geometry always spans it
 * exactly, so `cell*` equals the passed bbox.
 */
export function buildShapeSVGObject(
  id: string,
  kind: ShapePresetKind,
  bbox: Bbox,
  color: RGBColor,
  options?: ShapePresetOptions & { fillColor?: RGBColor; fillPaint?: Paint },
): SVGObject {
  const { segments } = buildShapePreset(kind, bbox, options);
  const obj: SVGObject = {
    id,
    segments,
    color,
    cellX: bbox.cellX,
    cellY: bbox.cellY,
    cellWidth: bbox.cellWidth,
    cellHeight: bbox.cellHeight,
  };
  // Plain-rect presets get the rectangle shapeKind so existing
  // rectangle-specific scale/snap behavior applies.
  if (kind === 'rect' || kind === 'comicFrame') obj.shapeKind = 'rectangle';
  if (options?.fillColor) obj.fillColor = options.fillColor;
  if (options?.fillPaint) obj.fillPaint = options.fillPaint;
  return obj;
}
