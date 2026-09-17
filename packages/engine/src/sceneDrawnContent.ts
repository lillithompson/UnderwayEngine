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
import { Bbox, Mat2D, matEquals, matUniformScale } from './sceneTransform';
import { localContentBox } from './sceneHitFrame';
import type { PatternObject, SVGObject } from './types';

export interface SvgLocalGeometry {
  /** The object to build markup from: local geometry scaled by `scale`,
   *  its box likewise, no free angle — the matrix carries the pose. */
  object: SVGObject;
  /** That object's box: the element's size and the `<svg>` viewBox. */
  box: Bbox;
  /** The world matrix with the uniform scale taken out: what the element
   *  (or the export's `<g>`) wears. */
  matrix: Mat2D;
  /** The uniform scale taken out of the matrix. */
  scale: number;
}

const svgGeometry = new WeakMap<SceneNode, { world: Mat2D; content: unknown; out: SvgLocalGeometry }>();

/**
 * An svg's local content, ready for `buildSVGObjectContent`.
 *
 * A stroke width is a WORLD quantity — 0.3125 cells at the default, an
 * authored width verbatim — and the markup builder draws it in user
 * space, so a path drawn through a scaled matrix would come out with a
 * scaled stroke. The matrix's uniform scale is therefore folded into the
 * VERTICES instead (the path is drawn `scale` times bigger) and divided
 * out of the matrix the element wears, which leaves a similarity's stroke
 * exactly the authored width. Under a matrix pulled off-square — a member
 * of a stretched bound group — what remains is the anisotropy, and the
 * stroke leans with it; the geometry is exact either way.
 *
 * A repeat-mode path's tile pitch and offset are lengths of the same kind
 * as its vertices, so they scale with them.
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

  const s = matUniformScale(world) || 1;
  const grow: Mat2D = { a: s, b: 0, c: 0, d: s, e: 0, f: 0 };
  const lb = localContentBox(node);
  const box: Bbox = { x: lb.x * s, y: lb.y * s, width: lb.width * s, height: lb.height * s };
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
    if (object.tileWidthL0 != null) object.tileWidthL0 *= s;
    if (object.tileHeightL0 != null) object.tileHeightL0 *= s;
    if (object.tileOffsetXL0 != null) object.tileOffsetXL0 *= s;
    if (object.tileOffsetYL0 != null) object.tileOffsetYL0 *= s;
  }
  const out: SvgLocalGeometry = {
    object, box, scale: s,
    matrix: { a: world.a / s, b: world.b / s, c: world.c / s, d: world.d / s, e: world.e, f: world.f },
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
