import { findItem } from '@/engine/compositionOps';
import { worldSnapshot, type LeafWorldSnapshot } from '@/engine/worldSnapshot';
import type { CompositionState, PathSegment, SVGObject } from '@/engine/types';
import { rotatedAabb } from '@/editor/resizeMath';
import { worldTurnDeg } from '../transformGestures';
import { graphOf } from '@/engine/sceneHitFrame';
import { matApplyPoint } from '@/engine/sceneTransform';
import { drawnLeaf } from '../drawnPose';
import {
  buildGroupSelectedMulti, buildPlaceShape, buildResizeNodes, buildRotateNodeFree, commitEntry,
  createEditorSession,
} from '../editorSession';
import { commitCanvasPaint, createCanvasPaintWorking, stampCanvasPaint } from '@/engine/canvasPaint';
import { createPaintObjectFromTiles, mintPaintObjectId } from '@/engine/paintObject';
import type { PaintObject, RGBColor } from '@/engine/types';
import { makeBlankComposition } from '@/editor/blankComposition';

// Shared fixtures for the editor package's tests (the apps' own copies add
// the fixtures that need a format: a stored Reimagine page, say).

/** The unfilled photo placeholder as an app spells it (its sentinel imageId
 *  is the app's own word, persisted in its pages): a made-up one for the
 *  package's tests. */
export const TEST_PHOTO_PLACEHOLDER = {
  imageId: 'test:photo-placeholder', mime: 'image/png' as const, pixelW: 8, pixelH: 8,
};

/**
 * The cheapest committable PAINT ISLAND: one dab of ink at (x, y), so the
 * object's 1:1 bbox == contentRect hugs that dab. Shared by every suite that
 * needs a real island in `state.paintObjects` — remember to register the id
 * in `state.sceneOrder` too, the way a commit does.
 *
 * Stamp at a texel center (k/8 + 1/16, e.g. 20.0625) when a test samples the
 * exact texel back: off-center, the Gaussian falloff deposits at srcA < 1.
 */
export function makePaintIsland(
  x: number,
  y: number,
  opts: { radius?: number; color?: RGBColor; alpha?: number } = {},
): PaintObject {
  const w = createCanvasPaintWorking();
  stampCanvasPaint(w, x, y, opts.radius ?? 1, opts.color ?? { r: 255, g: 0, b: 0 }, opts.alpha ?? 1);
  return createPaintObjectFromTiles(mintPaintObjectId(), commitCanvasPaint(w))!;
}

// ── Rendered pose ──────────────────────────────────────────────────────
// What a node LOOKS like, independent of how the legacy view spells it.
// One pose has many spellings in the legacy fields — a turn of -30 and one
// of 330, a flip about one axis and a flip about the other plus a half
// turn — and the scene graph keeps the pose, not the wording. Tests that
// care where something is read it through these.

/** The world-space snapshot of one leaf: content box, centre, one
 *  canonical turn, one flip bit, drawn path. */
export function poseOf(state: CompositionState, id: string): LeafWorldSnapshot {
  const snap = worldSnapshot(state).find((s) => s.id === id);
  if (!snap) throw new Error(`no leaf ${id}`);
  return snap;
}

/** The turn a node is drawn at, in (-180, 180] — what the rotate slider
 *  seats on. 0 for a node that carries none. */
export function turnOf(state: CompositionState, id: string): number {
  return worldTurnDeg(state, id);
}

/** The axis-aligned box a node's DRAWN content occupies: an svg's path
 *  box turned by its angle, a bbox kind's box as stored (its own turn is
 *  already folded into the stored box's swap and its free angle into the
 *  AABB). */
export function drawnAabb(state: CompositionState, id: string) {
  const ref = findItem(state, id);
  if (!ref) throw new Error(`no item ${id}`);
  const { cellX, cellY, cellWidth, cellHeight } = ref.item;
  const angle = (ref.item as { angleDeg?: number }).angleDeg ?? 0;
  return rotatedAabb({ cellX, cellY, cellWidth, cellHeight }, angle);
}

/** The world path an svg is drawn as, its own free angle applied. */
export function drawnSegments(state: CompositionState, id: string): PathSegment[] {
  const ref = findItem(state, id);
  if (!ref || ref.kind !== 'svg') throw new Error(`no svg ${id}`);
  const svg = ref.item as SVGObject;
  const angle = svg.angleDeg ?? 0;
  if (!angle) return svg.segments.map((seg) => ({ ...seg }));
  const cx = svg.cellX + svg.cellWidth / 2, cy = svg.cellY + svg.cellHeight / 2;
  const rad = (angle * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const turn = (p: readonly [number, number]): [number, number] => {
    const dx = p[0] - cx, dy = p[1] - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  };
  return svg.segments.map((seg) => seg.kind === 'arc'
    ? { kind: 'arc', start: turn(seg.start), end: turn(seg.end), center: turn(seg.center) }
    : { kind: 'line', start: turn(seg.start), end: turn(seg.end) });
}

/** Every vertex of `a` within 1e-6 of its counterpart in `b`, after
 *  `map` is applied to `b`'s points. */
export function expectSegmentsClose(
  a: readonly PathSegment[], b: readonly PathSegment[],
  map: (p: readonly [number, number]) => readonly [number, number] = (p) => p,
): void {
  expect(a.length).toBe(b.length);
  a.forEach((seg, i) => {
    const other = b[i];
    expect(seg.kind).toBe(other.kind);
    const pts: [readonly [number, number], readonly [number, number]][] = [
      [seg.start, map(other.start)], [seg.end, map(other.end)],
    ];
    if (seg.kind === 'arc' && other.kind === 'arc') pts.push([seg.center, map(other.center)]);
    for (const [p, q] of pts) {
      expect(p[0]).toBeCloseTo(q[0], 6);
      expect(p[1]).toBeCloseTo(q[1], 6);
    }
  });
}

/**
 * A paint island the legacy fields CANNOT describe: turned off the
 * quarters, bound into a group, and the group then stretched along one
 * axis. What it is drawn as is a parallelogram, and a box plus an angle
 * can only name the nearest rectangle around it (plan §2.9) — so every
 * reader still spelling the pose out of those fields answers about ground
 * the ink does not cover, and misses ground it does.
 *
 * Two dabs far apart, so the island's box is much larger than either: a
 * blob at the centre would read the same both ways, since the nearest
 * rectangle shares the true shape's centre.
 *
 * Returns the state, the island as it was BEFORE the transform (its tile
 * coordinates are world coordinates there), and `at` — where the first dab
 * is drawn now, taken from the graph.
 */
export function shearedIslandFixture(): {
  state: CompositionState;
  island: PaintObject;
  at: [number, number];
} {
  const w = createCanvasPaintWorking();
  stampCanvasPaint(w, 18.0625, 18.0625, 0.5, { r: 255, g: 0, b: 0 }, 1);
  stampCanvasPaint(w, 26.0625, 26.0625, 0.5, { r: 0, g: 0, b: 255 }, 1);
  const island = createPaintObjectFromTiles('pnt_sheared', commitCanvasPaint(w)!)!;
  let session = createEditorSession({
    ...makeBlankComposition('occ_shear'),
    paintObjects: [island],
    sceneOrder: [island.id],
  });
  // A second member, so the group has room to stretch around the island.
  const rect = buildPlaceShape(
    'rect', { cellX: 30, cellY: 18, cellWidth: 4, cellHeight: 4 }, { r: 40, g: 40, b: 40 },
  );
  session = commitEntry(session, rect);
  const ids = [island.id, rect.id!];
  session = commitEntry(session, buildRotateNodeFree(session.state, island.id, 40)!);
  session = commitEntry(session, buildGroupSelectedMulti(session.state, ids)!);
  session = commitEntry(session, buildResizeNodes(
    session.state, ids,
    { cellX: 16, cellY: 16, cellWidth: 20, cellHeight: 8 },
    { cellX: 16, cellY: 16, cellWidth: 44, cellHeight: 8 },
  )!);
  const d = drawnLeaf(graphOf(session.state), island.id)!;
  return {
    state: session.state,
    island,
    at: matApplyPoint(d.world, 18.0625 - island.cellX, 18.0625 - island.cellY),
  };
}
