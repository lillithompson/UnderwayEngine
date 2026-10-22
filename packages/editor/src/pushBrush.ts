// The PUSH brush's vector half, and the seam for a host's own.
//
// Push is the one brush in the colour group that lays no colour down: what
// is under the disc MOVES with it, by the same soft falloff every other
// brush colours with. Three kinds of thing can be under it, and each takes
// the push in the only way its own geometry can:
//
//   raster paint — texels smear along the drag (engine smudgeCanvasPaint,
//                  driven from paintBrush.ts's island targets, which this
//                  module deliberately leaves alone: the island pipeline
//                  already owns the working sets, the dirty-tile preview
//                  and the commit).
//   vector paths — every path POINT under the disc moves by its own weight,
//                  so a straight line bends and a shape's outline bulges
//                  (engine warpSegments keeps arcs arcs and joins joined).
//   a HOST's own  — a node whose geometry is a BAKE of something else
//                  pushes the something else, through
//                  `HostPushTargets` (sessionHost.ts). CozyJournal's rig
//                  re-poses its joints: same solver, same strength, same
//                  stage clamp as the rig-only brush it began as. Only
//                  where it is armed from has changed.
//
// Everything here is pure, so the deformation is node-testable; the canvas
// owns the gesture, the live preview and the commit.

import {
  CompUndoOp, CompositionState, PaintStrokeDraft, PathSegment, SVGObject, SVGSubpath,
} from '@/engine/types';
import { applyCompOps, computeSVGBbox } from '@/engine/compositionOps';
import { SessionEntry, buildPaintStroke, buildReplaceSceneOp } from './editorSession';
import type { PaintObjectStrokeState } from './paintBrush';
import { type HostPushTargets, sessionHost } from './sessionHost';
import { warpSegments } from '@/engine/compositionArcMath';
import { gaussianFalloff } from '@/engine/colorBlend';

/** The brush's weight at a point `d` from its centre — the same Gaussian
 *  bell, read the same way, that every other dab in the group deposits
 *  through. A push and a paint stroke of the same size therefore have the
 *  same edge, which is what makes the tool read as one brush. */
export function pushWeight(distCells: number, radiusCells: number, strength: number): number {
  if (!(radiusCells > 0) || !(strength > 0)) return 0;
  const t = distCells / radiusCells;
  if (t >= 1) return 0;
  return strength * gaussianFalloff(t * t);
}

/** One vector object the stroke may warp. `segments`/`subpaths` are the
 *  live geometry the dabs accumulate into. */
export interface PushSvgTarget {
  id: string;
  segments: PathSegment[];
  subpaths?: SVGSubpath[];
  /** Bbox centre + half-diagonal at stroke start, for the per-dab cull.
   *  Grows as the geometry does, so a shape dragged out from under its own
   *  box keeps taking the brush. */
  cx: number;
  cy: number;
  reach: number;
  moved: boolean;
}

export interface PushStrokeState {
  /** The host's own pass, resolved at the press, or null for a page with
   *  nothing of the host's on it. */
  host: HostPushTargets | null;
  svgs: PushSvgTarget[];
}

/**
 * Everything on the page the push brush may move, resolved once at the
 * press (the scene cannot change mid-stroke).
 *
 * A SELECTION is the brush's filter, exactly as it is for the other three:
 * with something selected the stroke may only touch that. Hidden, locked
 * and hidden-group members are never touched by any brush, and neither are
 * frame boundary rects (`skipIds`).
 *
 * Two kinds of vector object sit it out for reasons of their own. A GROUPED
 * one keeps a pre-transform copy of its geometry that only the group pass
 * may rebuild, so warping its world segments would desync the two. A TILED
 * one (a pattern) draws its geometry over and over across a region — a warp
 * would bend every repeat identically, which is not what pushing one of
 * them looks like. A node the HOST answers for is excluded too, but it is
 * not sitting out: its geometry is a bake of something else, so pushing it
 * means pushing what it was baked FROM, which is what `host` is for.
 */
export function createPushStrokeState(
  state: CompositionState,
  filterIds: Set<string> | null,
  skipIds: Set<string>,
): PushStrokeState {
  const host = sessionHost().nodes?.pushTargets?.(state, filterIds, skipIds) ?? null;
  const svgs: PushSvgTarget[] = [];
  for (const o of state.svgObjects) {
    if (host?.ids.has(o.id) || skipIds.has(o.id)) continue;
    // Grouped objects are out entirely, so a hidden GROUP needs no separate
    // check — its members were never candidates.
    if (o.hidden || o.locked || o.groupId || o.tileMode) continue;
    if (filterIds && !filterIds.has(o.id)) continue;
    svgs.push({
      id: o.id,
      segments: o.segments,
      subpaths: o.subpaths,
      cx: o.cellX + o.cellWidth / 2,
      cy: o.cellY + o.cellHeight / 2,
      reach: Math.hypot(o.cellWidth, o.cellHeight) / 2,
      moved: false,
    });
  }
  return { host, svgs };
}

/**
 * One dab: everything under the disc at (`cellX`, `cellY`) takes the travel
 * (`dxCells`, `dyCells`) scaled by its own distance from the centre.
 *
 * The HOST's half gets the dab in page cells and does what its own kind of
 * geometry asks of it; nothing about that deformation is this module's.
 *
 * Returns which halves changed, so the canvas can skip the previews that
 * have nothing to redraw.
 */
export function pushDab(
  ps: PushStrokeState,
  cellX: number,
  cellY: number,
  radiusCells: number,
  dxCells: number,
  dyCells: number,
  strength: number,
): { host: boolean; svgs: boolean } {
  let host = false;
  let svgs = false;
  if (!(strength > 0) || !(radiusCells > 0)) return { host, svgs };
  if (!(Math.hypot(dxCells, dyCells) > 0)) return { host, svgs };
  if (ps.host?.push(cellX, cellY, radiusCells, dxCells, dyCells, strength)) host = true;
  if (ps.svgs.length > 0) {
    const warp = (x: number, y: number): [number, number] => {
      const w = pushWeight(Math.hypot(x - cellX, y - cellY), radiusCells, strength);
      return w > 0 ? [x + dxCells * w, y + dyCells * w] : [x, y];
    };
    for (const t of ps.svgs) {
      if (Math.hypot(cellX - t.cx, cellY - t.cy) > t.reach + radiusCells) continue;
      const segments = t.subpaths
        ? undefined
        : warpSegments(t.segments, warp);
      const subpaths = t.subpaths
        ? t.subpaths.map((s) => ({ ...s, segments: warpSegments(s.segments, warp) }))
        : undefined;
      const flat = subpaths ? subpaths.flatMap((s) => s.segments) : segments!;
      if (!movedAny(t.segments, flat)) continue;
      t.segments = flat;
      t.subpaths = subpaths;
      // Re-centre the cull on what the geometry has become: a shape pushed
      // clear of where its box was must still answer the next dab.
      const bbox = computeSVGBbox(flat);
      t.cx = bbox.cellX + bbox.cellWidth / 2;
      t.cy = bbox.cellY + bbox.cellHeight / 2;
      t.reach = Math.hypot(bbox.cellWidth, bbox.cellHeight) / 2;
      t.moved = true;
      svgs = true;
    }
  }
  return { host, svgs };
}

/** Did the warp actually move a point? A dab whose disc missed every point
 *  of a path must not mark it dirty — that would rewrite the geometry (and
 *  commit an undo entry) for a stroke that changed nothing. */
function movedAny(before: readonly PathSegment[], after: readonly PathSegment[]): boolean {
  for (let i = 0; i < after.length; i++) {
    const a = before[i];
    const b = after[i];
    if (!a) return true;
    if (a.start[0] !== b.start[0] || a.start[1] !== b.start[1]) return true;
    if (a.end[0] !== b.end[0] || a.end[1] !== b.end[1]) return true;
  }
  return false;
}

/** The touched vector objects as they should be committed: warped geometry
 *  with a bbox refitted to it. Untouched objects are not listed, so they
 *  ride through the entry by reference. */
export function touchedPushSvgs(ps: PushStrokeState): Map<string, Partial<SVGObject>> {
  const out = new Map<string, Partial<SVGObject>>();
  for (const t of ps.svgs) {
    if (!t.moved) continue;
    out.set(t.id, {
      segments: t.segments,
      ...(t.subpaths ? { subpaths: t.subpaths } : {}),
      ...computeSVGBbox(t.segments),
      // The warped geometry IS the object's identity now: cached
      // pre-rotation segments describe a shape that no longer exists.
      identitySegments: undefined,
      identityCellX: undefined,
      identityCellY: undefined,
    });
  }
  return out;
}

/** Whether the stroke moved anything at all. */
export function pushStrokeChanged(ps: PushStrokeState): boolean {
  return !!ps.host?.changed() || ps.svgs.some((s) => s.moved);
}

/**
 * Commit a finished push stroke as ONE undo entry — every kind of thing it
 * moved, in one step, because one drag is one action however many kinds of
 * object were under it.
 *
 * Order matters, and for the reason it always does around `replaceScene`:
 * that op snapshots every collection, so each part has to be built against
 * the state the parts before it leave behind. The HOST's ops go first (a
 * rig's re-bake is its own swap of `svgObjects` plus the record text), then
 * the warped paths as one swap on top of those, then the island half
 * through the shared paint-stroke commit — which is what keeps the growth
 * rule, the erased-empty prune and the z-restore in exactly one place.
 *
 * Null when the stroke moved nothing at all.
 */
export function buildPushStroke(
  state: CompositionState,
  ps: PushStrokeState,
  draft: PaintStrokeDraft,
  paintState: PaintObjectStrokeState | null,
): SessionEntry | null {
  const ops: CompUndoOp[] = [];
  let mid = state;
  const hostOps = ps.host?.commit(mid) ?? [];
  if (hostOps.length > 0) {
    ops.push(...hostOps);
    mid = applyCompOps(mid, hostOps);
  }
  const warped = touchedPushSvgs(ps);
  if (warped.size > 0) {
    const op = buildReplaceSceneOp(mid, {
      svgObjects: mid.svgObjects.map((o) => {
        const next = warped.get(o.id);
        return next ? { ...o, ...next } : o;
      }),
    });
    ops.push(op);
    mid = applyCompOps(mid, [op]);
  }
  const islands = paintState && paintState.rev > 0
    ? buildPaintStroke(mid, draft, undefined, undefined, undefined, paintState)
    : null;
  if (islands) ops.push(...islands.entry);
  return ops.length > 0 ? { entry: ops } : null;
}
