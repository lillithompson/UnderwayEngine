// The Color brush's ERASER (bug report 6b36fe8b): the last option on the
// recolour brush's radial menu turns the brush from restaining what it
// crosses into CUTTING it away. Not an opacity, not a mask: the stroked
// geometry under the disc is removed from the path, and the path is cut at
// the disc's edge — a "cut" vertex lands exactly where the circle crosses
// each segment — so what is left keeps the very curve it had. A line stays
// the same line, shorter; a quarter-arc stays on its own circle, with a
// shorter sweep (engine subSegment keeps an arc's centre).
//
// The geometry is held as FRACTIONS of each original segment rather than as
// segments, which is what lets one stroke serve three frames at once: the
// dabs are tested in the shape's hit frame (sceneHitFrame — the frame its
// free turn and its group's pose are taken out of), the preview draws in
// the node's drawn frame (shapeStrokePreview), and the commit rewrites the
// STORED world segments. All three are the same path under a rigid map, and
// a fraction along a line or an arc's sweep survives a rigid map unchanged.
//
// Kept free of DOM / React so the cut is node-testable; the canvas owns the
// gesture, the preview and the commit (CanvasSurface's paint gesture).
//
// A target takes PAINT by the same discs (`paintVectorTarget`; DrawBots'
// Paint effect): the stretch a disc covers is not cut away but recoloured,
// held as coloured runs of each segment beside the fractions still
// standing. A disc that cuts and one that paints commute — one takes
// geometry, the other colours what is left — so the two are kept apart and
// read together (`paintedPiecesOfSegment`), and the record a painted target
// leaves (`erasedSvg`) is its pieces regrouped by colour, as the Color
// brush's commit regroups a path (`regroupSegmentsByColor`).

import type {
  CompUndoEntry, CompUndoOp, CompositionState, PathSegment, RGBColor, SVGObject, SVGSubpath,
} from '@/engine/types';
import { colorsEqual } from '@/engine/colorBlend';
import { segLength, subSegment, translateSegments } from '@/engine/compositionArcMath';
import { svgSolidFillColor } from '@/engine/compositionMergeObjects';
import { buildRemoveObjectOps, flattenSVGSegmentsWithColor, regroupSegmentsByColor } from '@/engine/compositionOps';
import { lineStyleArt, lineStyleOf } from '@/engine/lineStyle';
import { computeSVGBbox } from '@/engine/sceneGraph';
import { leafHitFrame } from '@/engine/sceneHitFrame';
import { LOCAL_IDENTITY, localMatrix } from '@/engine/sceneTransform';
import {
  MIN_ERASE_PIECE_CELLS, type SegmentInterval, segmentCircleCover, subtractIntervals, vectorErasable,
} from '@/engine/segmentCircleCut';
import { svgObjectFillFlooded } from '@/engine/svgPathBuilder';
import { drawnLeaf } from './drawnPose';
import { graphOf } from './transformGestures';

// The disc-cut geometry lives in the engine (`segmentCircleCut.ts`), where
// DrawBots' kernel reads it too; re-exported for this module's callers.
export { MIN_ERASE_PIECE_CELLS, segmentCircleCover, subtractIntervals, vectorErasable };
export type { SegmentInterval };

const EPS = 1e-9;

/** What a paint lays on a path (`paintVectorTarget`): a colour, or a rule
 *  that makes each stretch's new colour from the one it had (a hue turned
 *  a step, say), so two colours under one disc each change in their own
 *  way. */
export type PaintInk = RGBColor | ((from: RGBColor) => RGBColor);

/** A run of one segment a paint has recoloured, as fractions of it, and
 *  the colour it draws in now: [from, to, colour]. */
export type PaintedRun = readonly [number, number, RGBColor];

/** One path the stroke has reached: its flat (subpaths-first) segment list
 *  in the hit frame, and the fractions of each still standing. */
export interface VectorEraseTarget {
  /** The committed record as the stroke found it. */
  readonly svg: SVGObject;
  /** Flat segments in the hit frame — the order `flattenSVGSegmentsWithColor`
   *  walks, which the stored record, the hit frame and the drawn frame all
   *  share. */
  readonly local: readonly PathSegment[];
  readonly toLocal: (x: number, y: number) => [number, number];
  readonly lengthScale: number;
  /** Per flat index, what is left of that segment. */
  kept: SegmentInterval[][];
  /** Per flat index, the runs of that segment a paint has recoloured —
   *  sorted, disjoint, the latest paint over any before it. Absent until a
   *  paint changes a colour, so a target that is only cut is what it
   *  always was. */
  painted?: PaintedRun[][];
  /** A filled shape's fill as the paints have left it: each paint that
   *  reached the path recolours the whole of it (a fill is one colour).
   *  Absent while it is the record's own. */
  fill?: RGBColor;
  /** Per flat index, the segment's own colour (the record's, or its
   *  subpath's): what a paint's rule starts from. Read on the first paint. */
  colors?: readonly RGBColor[];
  /** Bumped on every dab that cut something — what the preview redraws on. */
  rev: number;
  /** The flat indices the dabs have changed since a preview last drew the
   *  target (`vectorErasePreview` empties it), so a cut redraws the chunks
   *  it touched and not the path. A caller with no preview never reads it. */
  changed: number[];
}

export interface VectorEraseState {
  /** Per svg id: its target, or null once it has been found uncuttable. */
  readonly targets: Map<string, VectorEraseTarget | null>;
  readonly filterIds: Set<string> | null;
  readonly skipIds: Set<string>;
}

export function createVectorEraseState(
  filterIds: Set<string> | null, skipIds: Set<string>,
): VectorEraseState {
  return { targets: new Map(), filterIds, skipIds };
}

/** A path's flat segment list — the engine's walk: subpaths when it has
 *  them, else its segments. */
function flatOf(svg: SVGObject): PathSegment[] {
  return flattenSVGSegmentsWithColor(svg).map((e) => e.segment);
}

/**
 * A fresh target for `svg` — its flat segments in the hit frame and every
 * fraction still standing — or null when it may not be cut
 * (`vectorErasable`, with `cutFills` passed on) or its frame would not keep
 * the stored segment order. Not cached: `eraseVectorDab` keeps one per
 * stroke, DrawBots' flush one per node and flush (bug 9a6bd320).
 */
export function vectorEraseTarget(
  state: CompositionState, svg: SVGObject, cutFills = false,
): VectorEraseTarget | null {
  if (!vectorErasable(svg, cutFills)) return null;
  const d = drawnLeaf(graphOf(state), svg.id);
  const frame = d ? leafHitFrame(d.node, d.world) : null;
  const local = flatOf((frame?.object ?? svg) as SVGObject);
  const stored = flatOf(svg);
  // The frame keeps the stored path's segment order; if it ever did not,
  // a fraction would land on the wrong segment — so such a path is left
  // alone rather than cut somewhere the finger was not.
  if (local.length !== stored.length || stored.length === 0) return null;
  return {
    svg,
    local,
    toLocal: frame ? (x, y) => frame.toLocal(x, y) : (x, y) => [x, y],
    lengthScale: frame?.lengthScale ?? 1,
    kept: stored.map(() => [[0, 1]]),
    rev: 0,
    changed: [],
  };
}

function targetFor(
  es: VectorEraseState, state: CompositionState, svg: SVGObject,
): VectorEraseTarget | null {
  const known = es.targets.get(svg.id);
  if (known !== undefined) return known;
  const target = vectorEraseTarget(state, svg);
  es.targets.set(svg.id, target);
  return target;
}

/** Every flat segment of `t` with something still standing that the disc
 *  at world (cellX, cellY) covers part of: its flat index and the fractions
 *  covered, in the hit frame. The one walk a cut and a paint share. */
function forEachCover(
  t: VectorEraseTarget, cellX: number, cellY: number, radiusCells: number,
  visit: (i: number, cover: SegmentInterval[]) => void,
): void {
  const [lx, ly] = t.toLocal(cellX, cellY);
  const r = radiusCells * t.lengthScale;
  for (let i = 0; i < t.local.length; i++) {
    if (t.kept[i].length === 0) continue;
    const seg = t.local[i];
    // A line both of whose ends lie more than r past the disc on one
    // side cannot meet it: the common case on a long path, settled with
    // four compares and no arithmetic (an arc's bulge needs the cover).
    if (seg.kind === 'line') {
      const x0 = seg.start[0], y0 = seg.start[1], x1 = seg.end[0], y1 = seg.end[1];
      if ((x0 < lx - r && x1 < lx - r) || (x0 > lx + r && x1 > lx + r)
        || (y0 < ly - r && y1 < ly - r) || (y0 > ly + r && y1 > ly + r)) continue;
    }
    const cover = segmentCircleCover(seg, lx, ly, r);
    if (cover.length > 0) visit(i, cover);
  }
}

/** One disc at world (cellX, cellY) taken out of `t`'s standing fractions.
 *  True when it cut something (and `t.rev` was bumped). */
export function cutVectorTarget(
  t: VectorEraseTarget, cellX: number, cellY: number, radiusCells: number,
): boolean {
  let cutHere = false;
  forEachCover(t, cellX, cellY, radiusCells, (i, cover) => {
    const next = subtractIntervals(t.kept[i], cover);
    if (next.length === t.kept[i].length
      && next.every((iv, k) => iv[0] === t.kept[i][k][0] && iv[1] === t.kept[i][k][1])) return;
    t.kept[i] = next;
    t.changed.push(i);
    cutHere = true;
  });
  if (cutHere) t.rev += 1;
  return cutHere;
}

/**
 * `runs` (one segment's, of base colour `base`) with `cover` painted by
 * `to`: every stretch the cover reaches takes the colour `to` makes of the
 * one it had — a run's, or the base — and what the cover misses stays.
 * Sorted and disjoint; neighbours of one colour are one run, and a stretch
 * back in the base colour is no run at all.
 */
function paintRuns(
  runs: readonly PaintedRun[], cover: readonly SegmentInterval[], to: (from: RGBColor) => RGBColor, base: RGBColor,
): PaintedRun[] {
  const parts: Array<[number, number, RGBColor]> = [];
  for (const [f0, f1, c] of runs) {
    for (const [k0, k1] of subtractIntervals([[f0, f1]], cover)) parts.push([k0, k1, c]);
  }
  for (const [c0, c1] of cover) {
    let from = c0;
    for (const [f0, f1, c] of runs) {
      if (f1 <= from || f0 >= c1) continue;
      if (f0 > from) parts.push([from, f0, to(base)]);
      parts.push([Math.max(from, f0), Math.min(c1, f1), to(c)]);
      from = Math.min(c1, f1);
    }
    if (from < c1) parts.push([from, c1, to(base)]);
  }
  parts.sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number, RGBColor]> = [];
  for (const part of parts) {
    if (colorsEqual(part[2], base)) continue;
    const last = out[out.length - 1];
    if (last && part[0] - last[1] < EPS && colorsEqual(last[2], part[2])) last[1] = part[1];
    else out.push(part);
  }
  return out;
}

const sameRuns = (a: readonly PaintedRun[], b: readonly PaintedRun[]): boolean =>
  a.length === b.length && a.every((run, k) => run[0] === b[k][0] && run[1] === b[k][1] && colorsEqual(run[2], b[k][2]));

/**
 * One disc at world (cellX, cellY) PAINTED onto `t`: the stretch of each
 * standing segment it covers takes `ink` — a colour, or the colour its
 * rule makes of the one each stretch had — and a filled shape's fill takes
 * it whole, since a fill is one colour. Nothing is cut. True when a colour
 * changed (and `t.rev` was bumped): a disc that misses the path, or lays
 * the colour already there, changes nothing.
 */
export function paintVectorTarget(
  t: VectorEraseTarget, cellX: number, cellY: number, radiusCells: number, ink: PaintInk,
): boolean {
  const to = typeof ink === 'function' ? ink : () => ink;
  let reached = false;
  let changed = false;
  forEachCover(t, cellX, cellY, radiusCells, (i, cover) => {
    reached = true;
    const colors = (t.colors ??= flattenSVGSegmentsWithColor(t.svg).map((e) => e.color));
    const had = t.painted?.[i] ?? [];
    const next = paintRuns(had, cover, to, colors[i]);
    if (sameRuns(next, had)) return;
    (t.painted ??= t.local.map(() => []))[i] = next;
    t.changed.push(i);
    changed = true;
  });
  if (!reached) return false;
  const fill = t.fill ?? svgSolidFillColor(t.svg);
  if (fill) {
    const next = to(fill);
    if (!colorsEqual(next, fill)) { t.fill = { r: next.r, g: next.g, b: next.b }; changed = true; }
  }
  if (changed) t.rev += 1;
  return changed;
}

/** True when a cut has taken some of `t`: a fraction of one of its
 *  segments no longer stands. A painted target that is not cut keeps its
 *  fill (recoloured); a cut one's outline is open, so its fill goes. */
export function targetIsCut(t: VectorEraseTarget): boolean {
  return t.kept.some((kept) => !(kept.length === 1 && kept[0][0] === 0 && kept[0][1] === 1));
}

/**
 * One eraser dab at world (cellX, cellY): cut every stroked path under the
 * disc. Returns true when anything was cut, so the caller redraws the
 * preview only then. Hidden, locked and frame-boundary objects (`skipIds`)
 * are never cut; a selection (`filterIds`) confines the stroke to itself.
 */
export function eraseVectorDab(
  es: VectorEraseState, state: CompositionState,
  cellX: number, cellY: number, radiusCells: number,
): boolean {
  let changed = false;
  for (const svg of state.svgObjects) {
    if (svg.locked || svg.hidden) continue;
    if (es.skipIds.has(svg.id)) continue;
    if (es.filterIds && !es.filterIds.has(svg.id)) continue;
    // The disc cull stampPaintBrush uses: the stored box's half-diagonal
    // holds the shape whatever its free turn.
    if (Math.hypot(cellX - (svg.cellX + svg.cellWidth / 2), cellY - (svg.cellY + svg.cellHeight / 2))
      > radiusCells + Math.hypot(svg.cellWidth, svg.cellHeight) / 2) continue;
    const t = targetFor(es, state, svg);
    if (t && cutVectorTarget(t, cellX, cellY, radiusCells)) changed = true;
  }
  return changed;
}

/** The segments left of flat segment `i`, by the target's kept fractions
 *  of it: `seg` is that segment in any rigidly-related frame, in cells
 *  (the drawn frame for a preview, the stored world segment for the
 *  commit). The whole segment, as the very object, when nothing has cut
 *  it. Slivers under {@link MIN_ERASE_PIECE_CELLS} drop out. */
export function keptPiecesOfSegment(t: VectorEraseTarget, i: number, seg: PathSegment): PathSegment[] {
  const kept = t.kept[i] ?? [[0, 1]];
  if (kept.length === 1 && kept[0][0] === 0 && kept[0][1] === 1) return [seg];
  const len = segLength(seg);
  const out: PathSegment[] = [];
  for (const [f0, f1] of kept) {
    if ((f1 - f0) * len < MIN_ERASE_PIECE_CELLS) continue;
    out.push(subSegment(seg, f0, f1));
  }
  return out;
}

/**
 * `keptPiecesOfSegment`, each piece with the colour a paint gave it
 * (`paint`; none: the segment's own): a kept run is cut again wherever a
 * painted run begins or ends inside it. A sliver under {@link
 * MIN_ERASE_PIECE_CELLS} beside another piece joins that piece rather than
 * dropping out, so a path that is only painted keeps every bit of its
 * line — a closed outline stays closed under its fill.
 */
export function paintedPiecesOfSegment(
  t: VectorEraseTarget, i: number, seg: PathSegment,
): Array<{ segment: PathSegment; paint?: RGBColor }> {
  const runs = t.painted?.[i];
  if (!runs || runs.length === 0) return keptPiecesOfSegment(t, i, seg).map((segment) => ({ segment }));
  const len = segLength(seg);
  const out: Array<{ segment: PathSegment; paint?: RGBColor }> = [];
  for (const [k0, k1] of t.kept[i] ?? [[0, 1]]) {
    const parts: Array<[number, number, RGBColor | undefined]> = [];
    let from = k0;
    for (const [p0, p1, c] of runs) {
      if (p1 <= from || p0 >= k1) continue;
      if (p0 > from) parts.push([from, p0, undefined]);
      parts.push([Math.max(from, p0), Math.min(k1, p1), c]);
      from = Math.min(k1, p1);
    }
    if (from < k1) parts.push([from, k1, undefined]);
    for (let k = 0; k < parts.length && parts.length > 1; k++) {
      if ((parts[k][1] - parts[k][0]) * len >= MIN_ERASE_PIECE_CELLS) continue;
      if (k > 0) parts[k - 1][1] = parts[k][1];
      else parts[1][0] = parts[0][0];
      parts.splice(k, 1);
      k--;
    }
    for (const [f0, f1, paint] of parts) {
      if ((f1 - f0) * len < MIN_ERASE_PIECE_CELLS) continue;
      out.push({ segment: f0 === 0 && f1 === 1 ? seg : subSegment(seg, f0, f1), ...(paint ? { paint } : null) });
    }
  }
  return out;
}

/**
 * A PAINTED target's path in any rigidly-related frame — `segments` and
 * `subpaths` are the record's own, or the node's local ones — as its cuts
 * and paints leave it: every piece in the colour it now draws in,
 * regrouped into the record's two-tier colour shape
 * (`regroupSegmentsByColor`, the Color brush's commit). A painted piece of
 * a path whose LINE STYLE stamps art is marked `ink`, so the art is
 * stamped in the paint alone (`SVGSubpath.ink`); a subpath that was ink
 * stays so where no paint reached it.
 */
export function paintedGeometry(
  t: VectorEraseTarget, color: RGBColor, segments: readonly PathSegment[], subpaths: readonly SVGSubpath[] | undefined,
): { color: RGBColor; segments: PathSegment[]; subpaths?: SVGSubpath[] } {
  const style = lineStyleOf(t.svg);
  const inks = !!style && lineStyleArt(style) !== null;
  const entries: Array<{ segment: PathSegment; color: RGBColor; ink?: boolean }> = [];
  let idx = 0;
  const walk = (segs: readonly PathSegment[], base: RGBColor, wasInk: boolean): void => {
    for (const seg of segs) {
      for (const piece of paintedPiecesOfSegment(t, idx++, seg)) {
        if (piece.paint) entries.push({ segment: piece.segment, color: piece.paint, ...(inks ? { ink: true } : null) });
        else entries.push({ segment: piece.segment, color: base, ...(wasInk ? { ink: true } : null) });
      }
    }
  };
  if (Array.isArray(subpaths) && subpaths.length > 0) {
    for (const sub of subpaths) walk(sub.segments, sub.color, !!sub.ink);
  } else {
    walk(segments, color, false);
  }
  return regroupSegmentsByColor(entries);
}

/** The segments left of one flat segment list — `keptPiecesOfSegment` per
 *  flat index, in order. */
export function keptPieces(
  t: VectorEraseTarget, flat: readonly PathSegment[],
): PathSegment[][] {
  return flat.map((seg, i) => keptPiecesOfSegment(t, i, seg));
}

/**
 * The stored record with the stroke's cuts applied, or null when nothing of
 * it is left (the commit removes it then). A PAINTED target's record is
 * its pieces regrouped by colour (`paintedGeometry`), its `color` the
 * first group's, and — a filled shape no cut has opened — its fill
 * repainted flat in the paint (`svgObjectFillFlooded`); one a cut has
 * opened keeps the fill it had, which is its caller's to take off.
 *
 * The path is drawn turned by its free `angleDeg` (and leaned by `shear`)
 * about its stored box's CENTRE, and the box shrinks to what is left — so
 * the pivot moves. The survivors are carried by the difference, which is
 * what keeps every piece drawn exactly where it was: drawn = L(p − c) + c,
 * so moving c to c' takes a shift of L(c' − c) − (c' − c).
 */
export function erasedSvg(t: VectorEraseTarget): SVGObject | null {
  const svg = t.svg;
  let segments: PathSegment[];
  let subpaths: SVGSubpath[] | undefined;
  let color = svg.color;
  if (t.painted) {
    ({ color, segments, subpaths } = paintedGeometry(t, svg.color, svg.segments, svg.subpaths));
  } else if (Array.isArray(svg.subpaths) && svg.subpaths.length > 0) {
    const pieces = keptPieces(t, flatOf(svg));
    subpaths = [];
    let idx = 0;
    for (const sub of svg.subpaths) {
      const cut: PathSegment[] = [];
      for (let k = 0; k < sub.segments.length; k++) cut.push(...pieces[idx++]);
      if (cut.length > 0) subpaths.push({ ...sub, segments: cut });
    }
    segments = subpaths.flatMap((s) => s.segments);
  } else {
    segments = keptPieces(t, flatOf(svg)).flat();
  }
  if (segments.length === 0) return null;
  // Painted and not cut: every piece stands where it did, so the box, the
  // pivot and the straddle box are the record's own, and its fill takes
  // the paint. (The identity stash goes as a cut's does: it is the path
  // before the paint.)
  if (!targetIsCut(t)) {
    const painted: SVGObject = {
      ...svg, ...(t.painted ? { color } : null), segments, subpaths,
      identitySegments: undefined, identityCellX: undefined, identityCellY: undefined,
    };
    return t.fill ? svgObjectFillFlooded(painted, t.fill) : painted;
  }

  let bbox = computeSVGBbox(segments);
  const L = localMatrix({
    ...LOCAL_IDENTITY, rotationDeg: svg.angleDeg ?? 0,
    ...(svg.shear ? { shear: svg.shear } : {}),
  });
  const dcx = bbox.cellX + bbox.cellWidth / 2 - (svg.cellX + svg.cellWidth / 2);
  const dcy = bbox.cellY + bbox.cellHeight / 2 - (svg.cellY + svg.cellHeight / 2);
  const sx = L.a * dcx + L.c * dcy - dcx;
  const sy = L.b * dcx + L.d * dcy - dcy;
  if (Math.abs(sx) > EPS || Math.abs(sy) > EPS) {
    segments = translateSegments(segments, sx, sy);
    if (subpaths) subpaths = subpaths.map((s) => ({ ...s, segments: translateSegments(s.segments, sx, sy) }));
    bbox = { ...bbox, cellX: bbox.cellX + sx, cellY: bbox.cellY + sy };
  }

  // An H/V line's straddle box (creationBox) gives a zero-thickness line
  // its body. Kept on the axis the line has no extent along; the other axis
  // shrinks with the line.
  let creationBox = svg.creationBox;
  if (creationBox) {
    const thinX = bbox.cellWidth < EPS;
    const thinY = bbox.cellHeight < EPS;
    creationBox = {
      minX: thinX ? creationBox.minX + sx : bbox.cellX,
      width: thinX ? creationBox.width : bbox.cellWidth,
      minY: thinY ? creationBox.minY + sy : bbox.cellY,
      height: thinY ? creationBox.height : bbox.cellHeight,
    };
  }

  return {
    ...svg, ...(t.painted ? { color } : null), segments, subpaths, ...bbox,
    ...(creationBox ? { creationBox } : {}),
    identitySegments: undefined, identityCellX: undefined, identityCellY: undefined,
  };
}

function editOp(prev: SVGObject, next: SVGObject): CompUndoOp {
  return {
    op: 'editSVGSegments', svgId: prev.id,
    oldSegments: prev.segments, newSegments: next.segments,
    oldSubpaths: prev.subpaths ?? null, newSubpaths: next.subpaths ?? null,
    ...(prev.creationBox || next.creationBox
      ? { oldCreationBox: prev.creationBox, newCreationBox: next.creationBox }
      : {}),
    oldCellX: prev.cellX, oldCellY: prev.cellY,
    oldCellWidth: prev.cellWidth, oldCellHeight: prev.cellHeight,
    newCellX: next.cellX, newCellY: next.cellY,
    newCellWidth: next.cellWidth, newCellHeight: next.cellHeight,
    // The quarter-turn and mirror flags stay what they were — the cut moves
    // nothing — while the identity stash the turn cycle returns to is the
    // uncut path, so it goes (undo brings it back).
    preserveOrientation: true,
    oldRotation: prev.rotation, newRotation: prev.rotation,
    oldMirrorH: prev.mirrorH, newMirrorH: prev.mirrorH,
    oldMirrorV: prev.mirrorV, newMirrorV: prev.mirrorV,
    oldIdentitySegments: prev.identitySegments, newIdentitySegments: undefined,
    oldIdentityCellX: prev.identityCellX, newIdentityCellX: undefined,
    oldIdentityCellY: prev.identityCellY, newIdentityCellY: undefined,
  };
}

/** The stroke as ONE undo entry: a segment rewrite per path it cut, and a
 *  removal (group-safe) per path it cut away entirely. Null when the stroke
 *  cut nothing. */
export function buildVectorEraseEntry(
  state: CompositionState, es: VectorEraseState,
): CompUndoEntry | null {
  const entry: CompUndoEntry = [];
  const gone: string[] = [];
  for (const t of es.targets.values()) {
    if (!t || t.rev === 0) continue;
    // The record the stroke cut must still be the one on the page.
    const current = state.svgObjects.find((o) => o.id === t.svg.id);
    if (current !== t.svg) continue;
    const next = erasedSvg(t);
    if (next) entry.push(editOp(t.svg, next));
    else gone.push(t.svg.id);
  }
  if (gone.length > 0) entry.push(...buildRemoveObjectOps(state, gone));
  return entry.length > 0 ? entry : null;
}
