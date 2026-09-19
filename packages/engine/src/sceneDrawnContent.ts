/**
 * A leaf's content spelled in its OWN space, ready to be drawn through its
 * world matrix (P5 of docs/transform-refactor.md).
 *
 * The drawing twin of `sceneHitFrame.localHitObject`, which does the same
 * job for the testers. Most kinds need nothing more than that — their
 * content is a box and the matrix carries it. Two do:
 *
 * - an **svg**, because a stroke width is a WORLD quantity drawn in user
 *   space, so a path carried through a scaled matrix would come out with a
 *   scaled stroke;
 * - a **pattern**, whose cells are baked by `patternSVGView` and must be
 *   baked in the frame they will be drawn in.
 *
 * Both answers were the host's (`web/editor/drawnPose.ts`), which is where
 * the node layer reads them. They live here so the SVG export can read the
 * very same thing: the screen and the export drawing one node two ways is
 * the class of bug this whole refactor is about.
 */

import { SceneNode, mapSegments } from './sceneGraph';
import {
  Bbox, Mat2D, matApplyBbox, matEquals, matInvert, matIsSimilarity, matMul,
  matTurnFrame, matUniformScale,
} from './sceneTransform';
import { localContentBox } from './sceneHitFrame';
import { fadedSVGObject } from './fade';
import type { PatternObject, SVGObject } from './types';

export interface SvgLocalGeometry {
  /** The object to build markup from: local geometry scaled by `scale`,
   *  its box likewise, no free angle — the matrix carries the pose. */
  object: SVGObject;
  /** That object's box: the element's size and the `<svg>` viewBox. */
  box: Bbox;
  /** What the element (or the export's `<g>`) wears: the world matrix's
   *  TURN, with everything the vertices now carry taken out of it. A
   *  similarity leaves the familiar matrix-over-its-uniform-scale. */
  matrix: Mat2D;
  /** The uniform scale taken out of the matrix — the single factor world
   *  lengths grew by, which for an off-square matrix is the geometric
   *  mean of its two axis factors. */
  scale: number;
}

/**
 * The split every path-backed kind draws by: what the VERTICES carry, and
 * what the element's matrix is left wearing.
 *
 * A stroke width is a world quantity drawn in user space, so anything the
 * matrix scales it by is a line changing WEIGHT because its group was
 * resized. Everything but the TURN is therefore folded into the geometry,
 * where points carry it exactly, and taken back out of the matrix.
 *
 * A similarity keeps the exact arithmetic it always had — one factor out of
 * the matrix and into the path — so its box and its element matrix come out
 * bit for bit what they were. Anything else hands the path everything but
 * the turn, lean included.
 */
function drawnSplit(world: Mat2D, lb: Bbox): {
  s: number; grow: Mat2D; turn: Mat2D; box: Bbox;
} {
  const s = matUniformScale(world) || 1;
  const square = matIsSimilarity(world);
  const turn = matTurnFrame(world);
  const grow: Mat2D = square
    ? { a: s, b: 0, c: 0, d: s, e: 0, f: 0 }
    : matMul(matInvert(turn), { ...world, e: 0, f: 0 });
  const box: Bbox = square
    ? { x: lb.x * s, y: lb.y * s, width: lb.width * s, height: lb.height * s }
    : matApplyBbox(grow, lb);
  return { s, grow, turn, box };
}

/** How far a {@link drawnSplit} stretched each of the path's own axes:
 *  `s` on both for a similarity, and exactly so — Math.hypot(s, 0) is s. */
function growAxes(grow: Mat2D): { gx: number; gy: number } {
  return { gx: Math.hypot(grow.a, grow.b), gy: Math.hypot(grow.c, grow.d) };
}

const svgGeometry = new WeakMap<SceneNode, { world: Mat2D; content: unknown; out: SvgLocalGeometry }>();

/**
 * An svg's local content, ready for `buildSVGObjectContent` — its geometry
 * in the node's own space, and its colours as they should be DRAWN (the
 * Fade row's, see the bottom of this function).
 *
 * A stroke width is a WORLD quantity — 0.3125 cells at the default, an
 * authored width verbatim — and the markup builder draws it in user
 * space, so a path drawn through a scaled matrix would come out with a
 * scaled stroke. The matrix's scale is therefore folded into the VERTICES
 * instead (the path is drawn `scale` times bigger) and divided out of the
 * matrix the element wears, which leaves the stroke exactly the authored
 * width.
 *
 * Under a matrix pulled OFF-SQUARE — a member of a stretched bound group
 * — one uniform factor is not enough: what is left over still stretches
 * one axis against the other, and the stroke came out fat one way and
 * thin the other, which is a line changing WEIGHT because its group was
 * resized. So what the element wears is the matrix's turn alone
 * ({@link matTurnFrame}) and the vertices carry the whole of the
 * rest, lean included. A path is points and carries it exactly, so the
 * shape is the same shape either way — only the stroke dressing it stops
 * being stretched. For a similarity the two are the same split, computed
 * the same way, so nothing ordinary moves by a hair.
 *
 * A repeat-mode path's tile pitch and offset are lengths of the same kind
 * as its vertices, so they scale with them — each along its own axis, so
 * an off-square stretch tiles wider without tiling taller.
 *
 * `content` names the object whose NON-geometry fields to keep, for a
 * caller holding a variant of the node's own payload — the export's
 * `strokeColorOverride` replaces an object wholesale and keeps its id.
 * The geometry always comes off the node, which is the exact one.
 */
export function svgLocalGeometry(
  node: SceneNode, world: Mat2D, content?: SVGObject,
): SvgLocalGeometry {
  const source = content ?? (node.content as SVGObject | undefined) ?? ({ id: node.id } as SVGObject);
  const hit = svgGeometry.get(node);
  if (hit && matEquals(hit.world, world) && hit.content === source) return hit.out;

  const { s, grow, turn, box } = drawnSplit(world, localContentBox(node));
  const object: SVGObject = {
    ...source,
    id: node.id,
    segments: mapSegments(node.localSegments ?? [], grow),
    cellX: box.x, cellY: box.y, cellWidth: box.width, cellHeight: box.height,
  };
  // Only the free angle: an svg's quarter turns are baked into its
  // vertices (`leafNodeFromLegacy`), so `rotation` / the mirror flags on an
  // svg are a record of how it got here, not a transform anyone re-applies.
  delete object.angleDeg;
  delete object.creationBox;
  if (node.localSubpaths) {
    // Paired by index with the source's, so a variant's per-subpath colours
    // survive: `withSVGObjectStrokeColor` maps the list one for one.
    object.subpaths = node.localSubpaths.map((sp, i) => ({
      ...(source.subpaths?.[i] ?? sp),
      segments: mapSegments(sp.segments, grow),
    }));
  } else {
    delete object.subpaths;
  }
  if (object.tileMode === 'repeat') {
    const { gx, gy } = growAxes(grow);
    if (object.tileWidthL0 != null) object.tileWidthL0 *= gx;
    if (object.tileHeightL0 != null) object.tileHeightL0 *= gy;
    if (object.tileOffsetXL0 != null) object.tileOffsetXL0 *= gx;
    if (object.tileOffsetYL0 != null) object.tileOffsetYL0 *= gy;
  }
  const out: SvgLocalGeometry = {
    // …and finally the FADE, applied once, here, where both renderers read
    // the object they draw from: every colour the markup will paint with —
    // stroke, subpaths, per-copy overrides, fill and border — mixed toward
    // the object's fade target (engine/fade.ts). Nothing downstream knows
    // about fade, which is exactly why the screen and the export cannot
    // disagree about it. Returns the same object untouched when there is no
    // fade, so the cache below keeps its identity on the common path.
    object: fadedSVGObject(object), box, scale: s,
    matrix: { ...turn, e: world.e, f: world.f },
  };
  svgGeometry.set(node, { world, content: source, out });
  return out;
}

const patternObjects = new WeakMap<SceneNode, PatternObject>();

/**
 * A pattern's content as the bake wants it, in the node's own space: its
 * cells in the un-turned local box at the origin, with no quarter turn,
 * flip or free angle of its own — the matrix supplies all three. Cached
 * per node so `patternSVGView`'s own per-object cache hits.
 */
export function patternLocalObject(node: SceneNode): PatternObject {
  const hit = patternObjects.get(node);
  if (hit) return hit;
  const lb = localContentBox(node);
  const local: PatternObject = {
    ...(node.content as PatternObject),
    id: node.id,
    cellX: 0, cellY: 0, cellWidth: lb.width, cellHeight: lb.height,
  };
  delete local.rotation;
  delete local.mirrorH;
  delete local.mirrorV;
  delete local.angleDeg;
  patternObjects.set(node, local);
  return local;
}

const patternGeometry = new WeakMap<SceneNode, { world: Mat2D; out: SvgLocalGeometry | null }>();

/**
 * A pattern's content in the node's own space, on the SAME terms as an
 * svg's — `patternSVGView` baked in the local box, then grown by everything
 * the element's matrix gives back ({@link drawnSplit}).
 *
 * A pattern used to be drawn with the FULL matrix on both the screen and
 * the export: consistent between the two, and different from an svg, whose
 * stroke is the authored world width whatever the matrix does. So the same
 * line weight read one way inside a scaled group as a Line and another as a
 * pattern's, and an off-square group leaned a pattern's strokes while
 * leaving an svg's upright (plan §5.10, answered 2026-09-18: a pattern's
 * strokes ARE lines in that sense). Its cells bake to a PATH, so it can
 * carry the grow in its vertices exactly as an svg does — lean included —
 * and the repeat-mode tile pitch rides along the same way.
 *
 * `view` is the caller's baked view of {@link patternLocalObject}; passing
 * it keeps the one `patternSVGView` cache shared with the caller rather
 * than baking a second time. Null when the grid is empty.
 */
export function patternLocalGeometry(
  node: SceneNode, world: Mat2D, view: SVGObject | null,
): SvgLocalGeometry | null {
  const hit = patternGeometry.get(node);
  if (hit && matEquals(hit.world, world)) return hit.out;
  let out: SvgLocalGeometry | null = null;
  if (view) {
    const lb = localContentBox(node);
    const { s, grow, turn, box } = drawnSplit(world, { x: 0, y: 0, width: lb.width, height: lb.height });
    const object: SVGObject = {
      ...view,
      segments: mapSegments(view.segments ?? [], grow),
      cellX: box.x, cellY: box.y, cellWidth: box.width, cellHeight: box.height,
    };
    if (view.subpaths) {
      object.subpaths = view.subpaths.map((sp) => ({ ...sp, segments: mapSegments(sp.segments, grow) }));
    }
    if (object.tileMode === 'repeat') {
      const { gx, gy } = growAxes(grow);
      if (object.tileWidthL0 != null) object.tileWidthL0 *= gx;
      if (object.tileHeightL0 != null) object.tileHeightL0 *= gy;
      if (object.tileOffsetXL0 != null) object.tileOffsetXL0 *= gx;
      if (object.tileOffsetYL0 != null) object.tileOffsetYL0 *= gy;
    }
    out = {
      object: fadedSVGObject(object), box, scale: s,
      matrix: { ...turn, e: world.e, f: world.f },
    };
  }
  patternGeometry.set(node, { world, out });
  return out;
}
