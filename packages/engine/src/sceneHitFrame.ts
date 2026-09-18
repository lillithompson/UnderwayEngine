/**
 * What a hit test tests, read off the scene graph (P5 of
 * docs/transform-refactor.md). The engine twin of the host's
 * `web/editor/drawnPose.ts`, and built to the same rule.
 *
 * A leaf is DRAWN as its local content carried through its world matrix.
 * So a world query point belongs to that leaf exactly when the INVERSE
 * matrix carries the point inside the local content — and every per-kind
 * tester the engine already has (the geometry adapters' `hitTest`,
 * `svgPathHitsPoint`, `paintObjectAlphaHitTest`) can run unchanged in that
 * frame, given the leaf's content spelled in it.
 *
 * This replaces `unrotatePointForNode`, which undid a leaf's own free
 * `angleDeg` about its bbox centre and nothing else. That was right while
 * the legacy fields told the whole truth, and stops being right the moment
 * a node carries a scale of its own or sits inside a bound group that has
 * been stretched: the legacy box is then only the NEAREST RECTANGLE around
 * a parallelogram (plan §2.9), so taps near a sheared member's edges land
 * where nothing is drawn and miss where something is. The inverse matrix
 * has no such gap — it is exact for every affine, shear included.
 *
 * Nothing here reads a pose field. The one thing it reads off `content` is
 * a FIGURE's discrete `rotation`, and only to undo the legacy model's own
 * inconsistency about quads — see `quadSpinDeg`.
 */

import {
  Bbox, LOCAL_IDENTITY, MAT_IDENTITY, Mat2D, localMatrix, matApplyBbox, matApplyPoint,
  matEquals, matInvert, matMul, matTranslate, matUniformScale,
} from './sceneTransform';
import {
  LegacyLeaf, SceneGraph, SceneNode, fromLegacy, getNode, segmentsBbox, worldMatrix,
} from './sceneGraph';
import type { CompositionFigure, CompositionState, SVGObject } from './types';
import { dropLocalCaches } from './legacyLocalCaches';

/**
 * A composition's graph: the one it carries, else built on the spot.
 *
 * A state that carries a graph edits it in place on every entry
 * (`runOnGraph`), so the one it carries is always current; a state
 * that carries none — a test fixture, an import, a page the editor never
 * opened — pays one O(n) conversion to be asked a question about what it
 * draws.
 */
export function graphOf(state: CompositionState): SceneGraph {
  return state.graph ?? fromLegacy(state);
}

/** A leaf's content box in its own space: the stored box for a bbox kind
 *  (and a repeat-mode svg's region), else the path's own bounds. */
export function localContentBox(node: SceneNode): Bbox {
  if (node.localBox) return node.localBox;
  if (node.localSegments) return segmentsBbox(node.localSegments);
  return { x: 0, y: 0, width: 0, height: 0 };
}

/**
 * The quarter turn a leaf's CONTENT sits at inside its own local frame.
 *
 * Zero for every kind but one. A figure's quad list is stored ALREADY
 * TURNED — `rotateFigureIndividual90CW` rewrites each offset into the new
 * orientation and swaps the box — while the node's local box is the
 * un-turned content box (`poseToTransform` reads it through
 * `contentBoxCells`). So a quarter-turned figure's quads live one quarter
 * turn away from the frame its own `localBox` names, and a frame that
 * ignored that would test them sideways.
 *
 * The legacy model's inconsistency, not the graph's, and it is carried
 * here rather than fixed because a figure takes no free gesture at all
 * (plan Q1) — quarter turns and a uniform scale are its whole vocabulary,
 * so nothing else in the refactor has to know. It goes away with the quad
 * list.
 */
function quadSpinDeg(node: SceneNode): number {
  if (node.kind !== 'figure') return 0;
  return (node.content as CompositionFigure | undefined)?.rotation ?? 0;
}

/**
 * A leaf's local frame for hit testing.
 *
 * `object` and `toLocal` are a matched pair: the object's geometry is
 * spelled in the very space `toLocal` maps into, so a tester handed both
 * is exact.
 */
export interface NodeHitFrame {
  readonly kind: SceneNode['kind'];
  /** The content box, in the frame. */
  readonly box: Bbox;
  /** The leaf's content with its pose fields replaced by `box` and its
   *  geometry by the local geometry — what the per-kind testers take. */
  readonly object: LegacyLeaf;
  /** The node's world AABB: a cheap reject before anything is mapped. */
  readonly aabb: Bbox;
  /**
   * The frame's own space → the node's LOCAL space: the way OUT, for a
   * caller that draws the frame's content rather than testing a point in
   * it. `matMul(world, toNode)` carries `object` to the page.
   *
   * The identity for every kind but a quarter-turned figure, whose quads
   * are stored a quarter away from the frame `localBox` names — see
   * {@link quadSpinDeg}. Its exact inverse is the second half of
   * {@link toLocal}, so a drawer and a tester cannot disagree about where
   * the content sits.
   */
  readonly toNode: Mat2D;
  /** A world point, in the frame. */
  toLocal(x: number, y: number): [number, number];
  /** World length → frame length, the inverse of the matrix's uniform
   *  scale. A tolerance is a WORLD quantity (it comes off the camera), so
   *  it is carried in through this before being compared with anything the
   *  frame measures. 1 for an unscaled node. */
  readonly lengthScale: number;
}

/**
 * One frame per (node, world pose), kept by node identity.
 *
 * The graph is copy-on-write, so a node nothing has touched is the SAME
 * object from one call to the next, and its world matrix is compared
 * entry-wise because an ancestor moving gives an untouched node a new
 * matrix with the same numbers. Without this a pointer drag over a busy
 * page would take an inverse and clone every leaf's content on every
 * move; with it, a scene that is standing still is framed once.
 */
const frameCache = new WeakMap<SceneNode, { world: Mat2D; frame: NodeHitFrame }>();

/**
 * The frame for one leaf at a given world matrix.
 *
 * Split out from {@link nodeHitFrame} so a caller holding a bare legacy
 * object — one that lives in no graph — can build the same frame from
 * `leafNodeFromLegacy` + `localMatrix(node.transform)` and cannot test it
 * differently from the way the graph would.
 */
export function leafHitFrame(node: SceneNode, world: Mat2D): NodeHitFrame {
  const hit = frameCache.get(node);
  if (hit && matEquals(hit.world, world)) return hit.frame;
  const frame = buildLeafHitFrame(node, world);
  frameCache.set(node, { world, frame });
  return frame;
}

function buildLeafHitFrame(node: SceneNode, world: Mat2D): NodeHitFrame {
  const local = localContentBox(node);
  const spinDeg = quadSpinDeg(node);
  const swap = spinDeg === 90 || spinDeg === 270;
  const box: Bbox = swap
    ? { x: 0, y: 0, width: local.height, height: local.width }
    : local;

  let inv: Mat2D;
  try { inv = matInvert(world); } catch { inv = MAT_IDENTITY; }
  // Content frame → local frame: lift the turned box off its own corner,
  // turn the quarter back out, and seat it on the local box's centre.
  // Spelled in this direction because it is the one a DRAWER needs, and
  // taken back the other way for `toLocal` — a rotation and a translation
  // is never singular, and one spelling cannot drift from the other.
  // The identity whenever `spinDeg` is 0, which is every kind but a
  // quarter-turned figure.
  const toNode: Mat2D = spinDeg === 0 ? MAT_IDENTITY : matMul(
    matTranslate(local.x + local.width / 2, local.y + local.height / 2),
    matMul(
      localMatrix({ ...LOCAL_IDENTITY, rotationDeg: -spinDeg }),
      matTranslate(-box.width / 2, -box.height / 2),
    ),
  );
  const toContent = spinDeg === 0 ? null : matInvert(toNode);

  return {
    kind: node.kind,
    box,
    object: localHitObject(node, box),
    aabb: matApplyBbox(world, local),
    toNode,
    toLocal(x: number, y: number): [number, number] {
      const p = matApplyPoint(inv, x, y);
      return toContent ? matApplyPoint(toContent, p[0], p[1]) : p;
    },
    lengthScale: 1 / (matUniformScale(world) || 1),
  };
}

/** The frame for a node of `graph`, or null for a group or an unknown id. */
export function nodeHitFrame(graph: SceneGraph, id: string): NodeHitFrame | null {
  const node = getNode(graph, id);
  if (!node || node.kind === 'group') return null;
  return leafHitFrame(node, worldMatrix(graph, id));
}

/**
 * A leaf's content as a legacy-shaped object in its OWN space: the pose
 * fields replaced by the local box, an svg's geometry by its local path.
 *
 * The pose channels are cleared rather than carried, because the frame the
 * object is handed to has already spent them: a tester that read
 * `angleDeg` here would turn a path that is already un-turned. What stays
 * is everything that is not pose — colour, stroke, locked / hidden, a
 * paint island's tile rect, a pattern's cells, `tileMode` — which is what
 * the testers are actually asking about.
 */
export function localHitObject(node: SceneNode, box: Bbox = localContentBox(node)): LegacyLeaf {
  const out = { ...(node.content ?? { id: node.id }) } as LegacyLeaf & Record<string, unknown>;
  out.id = node.id;
  out.groupId = node.parentId;
  out.cellX = box.x;
  out.cellY = box.y;
  out.cellWidth = box.width;
  out.cellHeight = box.height;
  // A figure's quads are stored in the content frame `quadSpinDeg` names,
  // so its discrete `rotation` has been spent by the frame too.
  out.rotation = undefined;
  out.mirrorH = undefined;
  out.mirrorV = undefined;
  out.angleDeg = undefined;
  if (node.kind === 'svg') {
    const svg = out as SVGObject;
    svg.segments = (node.localSegments ?? []) as SVGObject['segments'];
    if (node.localSubpaths) svg.subpaths = node.localSubpaths as SVGObject['subpaths'];
    else delete svg.subpaths;
    if (node.localCreationBox) {
      const b = node.localCreationBox;
      svg.creationBox = { minX: b.x, minY: b.y, width: b.width, height: b.height };
    } else {
      delete svg.creationBox;
    }
  }
  // The local caches are a second copy of a grouped leaf's pose and say
  // nothing about content; a tester that found one would read a pose the
  // frame has already spent.
  dropLocalCaches(out);
  return out;
}
