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

import type {
  CompUndoEntry, CompUndoOp, CompositionState, PathSegment, SVGObject, SVGSubpath,
} from '@/engine/types';
import { segLength, subSegment, translateSegments } from '@/engine/compositionArcMath';
import { buildRemoveObjectOps, flattenSVGSegmentsWithColor } from '@/engine/compositionOps';
import { computeSVGBbox } from '@/engine/sceneGraph';
import { leafHitFrame } from '@/engine/sceneHitFrame';
import { LOCAL_IDENTITY, localMatrix } from '@/engine/sceneTransform';
import {
  MIN_ERASE_PIECE_CELLS, type SegmentInterval, segmentCircleCover, subtractIntervals, vectorErasable,
} from '@/engine/segmentCircleCut';
import { drawnLeaf } from './drawnPose';
import { graphOf } from './transformGestures';

// The disc-cut geometry lives in the engine (`segmentCircleCut.ts`), where
// DrawBots' kernel reads it too; re-exported for this module's callers.
export { MIN_ERASE_PIECE_CELLS, segmentCircleCover, subtractIntervals, vectorErasable };
export type { SegmentInterval };

const EPS = 1e-9;

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
  /** Bumped on every dab that cut something — what the preview redraws on. */
  rev: number;
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

/** One disc at world (cellX, cellY) taken out of `t`'s standing fractions.
 *  True when it cut something (and `t.rev` was bumped). */
export function cutVectorTarget(
  t: VectorEraseTarget, cellX: number, cellY: number, radiusCells: number,
): boolean {
  const [lx, ly] = t.toLocal(cellX, cellY);
  const r = radiusCells * t.lengthScale;
  let cutHere = false;
  for (let i = 0; i < t.local.length; i++) {
    if (t.kept[i].length === 0) continue;
    const cover = segmentCircleCover(t.local[i], lx, ly, r);
    if (cover.length === 0) continue;
    const next = subtractIntervals(t.kept[i], cover);
    if (next.length === t.kept[i].length
      && next.every((iv, k) => iv[0] === t.kept[i][k][0] && iv[1] === t.kept[i][k][1])) continue;
    t.kept[i] = next;
    cutHere = true;
  }
  if (cutHere) t.rev += 1;
  return cutHere;
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

/** The segments left of one flat segment list, by the target's kept
 *  fractions — per flat index, in order. `flat` is that same path in any
 *  rigidly-related frame, in cells (the drawn frame for a preview, the
 *  stored world segments for the commit). Slivers under
 *  {@link MIN_ERASE_PIECE_CELLS} drop out. */
export function keptPieces(
  t: VectorEraseTarget, flat: readonly PathSegment[],
): PathSegment[][] {
  return flat.map((seg, i) => {
    const kept = t.kept[i] ?? [[0, 1]];
    if (kept.length === 1 && kept[0][0] === 0 && kept[0][1] === 1) return [seg];
    const len = segLength(seg);
    const out: PathSegment[] = [];
    for (const [f0, f1] of kept) {
      if ((f1 - f0) * len < MIN_ERASE_PIECE_CELLS) continue;
      out.push(subSegment(seg, f0, f1));
    }
    return out;
  });
}

/**
 * The stored record with the stroke's cuts applied, or null when nothing of
 * it is left (the commit removes it then).
 *
 * The path is drawn turned by its free `angleDeg` (and leaned by `shear`)
 * about its stored box's CENTRE, and the box shrinks to what is left — so
 * the pivot moves. The survivors are carried by the difference, which is
 * what keeps every piece drawn exactly where it was: drawn = L(p − c) + c,
 * so moving c to c' takes a shift of L(c' − c) − (c' − c).
 */
export function erasedSvg(t: VectorEraseTarget): SVGObject | null {
  const svg = t.svg;
  const pieces = keptPieces(t, flatOf(svg));
  let segments: PathSegment[];
  let subpaths: SVGSubpath[] | undefined;
  if (Array.isArray(svg.subpaths) && svg.subpaths.length > 0) {
    subpaths = [];
    let idx = 0;
    for (const sub of svg.subpaths) {
      const cut: PathSegment[] = [];
      for (let k = 0; k < sub.segments.length; k++) cut.push(...pieces[idx++]);
      if (cut.length > 0) subpaths.push({ ...sub, segments: cut });
    }
    segments = subpaths.flatMap((s) => s.segments);
  } else {
    segments = pieces.flat();
  }
  if (segments.length === 0) return null;

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
    ...svg, segments, subpaths, ...bbox,
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
